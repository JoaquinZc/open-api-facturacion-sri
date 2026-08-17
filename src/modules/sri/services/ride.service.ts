import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
// `bwip-js` es CommonJS puro (`export = BwipJs`), así que va como import por
// defecto y no con `* as` — con `esModuleInterop` activo, esa forma no compila.
import bwipjs from 'bwip-js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PdfService } from '../../pdf/pdf.service';
import { TemplateService } from '../../template/template.service';
import { SriRepositoryService } from './sri-repository.service';
import { TIPO_COMPROBANTE_DESCRIPCIONES } from '../constants';
import { Ambiente, TipoEmision, TipoIdentificacion } from '../constants/sri.enums';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

@Injectable()
export class RideService {
  private readonly logger = new Logger(RideService.name);
  private static readonly RIDE_TEMPLATE_ID = 'ride';

  /**
   * PNG de 1×1 transparente.
   *
   * Se usa cuando no hay logo o el QR falla. **Es mejor que una cadena vacía**:
   * un `src=""` deja en LibreOffice el hueco de una imagen rota, y obligaría a
   * poner condicionales en la plantilla — que es justo lo que no se quiere,
   * porque un condicional mal escrito en Carbone imprime el marcador en el PDF.
   */
  /**
   * PNG de 1×1 transparente.
   *
   * 🔴 **Es obligatorio, no un adorno.** Las imágenes se meten en la plantilla
   * sustituyendo su relleno, y el relleno de `ride.docx` es el logo de
   * Darkmelon y un código de barras decorativo. No sustituir cuando falta el
   * dato **no deja el hueco vacío: deja el relleno**, y entonces la factura de
   * un negocio saldría con el logo de Darkmelon y un código que no es su clave
   * de acceso. Poner el píxel transparente es lo que borra el hueco.
   */
  private static readonly PIXEL_TRANSPARENTE = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  /**
   * Logos ya descargados, por URL. `null` significa «se intentó y no se pudo»,
   * que también se recuerda: si el servidor del logo está caído, no tiene
   * sentido esperar el tiempo de espera completo en cada RIDE que se pida.
   */
  private static readonly cacheDeLogos = new Map<string, Buffer | null>();

  /** Un RIDE es una descarga interactiva: nadie espera cinco segundos por un logo. */
  private static readonly LOGO_TIMEOUT_MS = 4000;

  /**
   * Tope del logo. El Data URI viaja dentro del cuerpo que se manda a Carbone,
   * y en base64 engorda un tercio; 2 MB de logo son ya 2,7 MB de petición para
   * una imagen que se imprime a 40 mm de ancho.
   */
  private static readonly LOGO_MAX_BYTES = 2 * 1024 * 1024;

  constructor(
    private readonly pdfService: PdfService,
    private readonly templateService: TemplateService,
    private readonly repository: SriRepositoryService,
  ) {}

  /**
   * Genera el RIDE (PDF) de un comprobante por su clave de acceso
   */
  async generarRide(claveAcceso: string): Promise<Buffer> {
    this.logger.log(`Generando RIDE para clave: ${claveAcceso}`);

    const comprobante =
      await this.repository.findComprobanteConDetalles(claveAcceso);
    if (!comprobante) {
      throw new NotFoundException(
        `Comprobante ${claveAcceso} no encontrado`,
      );
    }

    const detalles =
      await this.repository.findDetallesByComprobanteId(comprobante.id);
    const totales =
      await this.repository.findTotalesByComprobanteId(comprobante.id);
    const impuestos =
      await this.repository.findImpuestosByComprobanteId(comprobante.id);
    const pagos =
      await this.repository.findPagosByComprobanteId(comprobante.id);
    const infoAdicional =
      await this.repository.findInfoAdicionalByComprobanteId(comprobante.id);

    /*
     * El QR y el logo se preparan aquí porque uno es asíncrono y el otro lee
     * disco: el mapeo de abajo es una transformación pura y conviene que siga
     * siéndolo.
     */
    const clave = comprobante.clave_acceso as string;
    const qrDataUri = await this.generarQr(clave);
    const barcode = await this.generarBarcode(clave);
    const logo = await this.cargarLogo(
      comprobante.ruc_emisor as string,
      comprobante.emisor_logo_url as string | null,
    );

    const rideData = this.mapComprobanteToRideData(
      comprobante,
      detalles,
      totales,
      impuestos,
      pagos,
      infoAdicional,
      { qrDataUri },
    );

    const templatePath = this.templateService.findTemplate(
      RideService.RIDE_TEMPLATE_ID,
    );

    /*
     * ═══ Las imágenes van por fuera de Carbone ════════════════════════════
     *
     * 🔴 **Se comprobó que la edición desplegada no sustituye imágenes.**
     * Renderizando esta misma plantilla, Carbone cambia todas las etiquetas de
     * texto —incluidas las del encabezado y el pie— pero escribe el Data URI
     * en el atributo `descr` y **deja el binario intacto**. El PDF sale con la
     * imagen de relleno del Word.
     *
     * Y el relleno de `ride.docx` es un **código de barras decorativo**. Un
     * RIDE así parece correcto y no lo es: quien escanee ese código no obtiene
     * la clave de acceso.
     *
     * Así que se meten aquí, en la plantilla, antes de subirla. La etiqueta del
     * texto alternativo se sigue usando —es como se localiza cada hueco—, pero
     * la sustitución la hace `docx-imagenes.ts`, que sí se puede verificar.
     */
    return this.pdfService.generatePDF(rideData as AnyRecord, templatePath, {
      '{d.factura.claveAccesoBarcode}': barcode,
      '{d.emisor.logo}': logo,
    });
  }

  /**
   * Los 49 dígitos en grupos de siete.
   *
   * **No es decoración.** Es la única forma de que alguien pueda dictarlos por
   * teléfono o teclearlos en sri.gob.ec sin perder la cuenta, que es justo para
   * lo que sirve la clave de acceso. Una tira de 49 cifras seguidas se lee mal
   * en papel y peor en una pantalla pequeña.
   */
  private agruparClave(clave: unknown): string {
    const digitos = String(clave ?? '').replace(/\D/g, '');
    return digitos.replace(/(.{7})/g, '$1 ').trim();
  }

  /**
   * El QR de la clave de acceso, como PNG embebido.
   *
   * **Va como imagen y no como fuente ni dibujo HTML**: LibreOffice —que es
   * quien convierte esto a PDF— renderiza imágenes de forma fiable y todo lo
   * demás no.
   *
   * **El código que exige la norma es el de barras**, y lo genera
   * `generarBarcode()`. Este QR se mantiene disponible por si se quiere añadir
   * al lado —algunos RIDE llevan los dos— pero la plantilla no lo usa hoy.
   *
   * ⚠️ Si algún día se añade al Word, **no basta con poner la etiqueta**:
   * hay que pasarlo por `generatePDF(..., imagenes)` como el logo y el código
   * de barras, porque Carbone no sustituye imágenes en esta edición. Por eso
   * este devuelve un Data URI y aquellos devuelven bytes.
   *
   * Si falla, **no tumba el RIDE**: devuelve cadena vacía. Un comprobante sin
   * QR sigue siendo válido; uno que no se genera, no existe.
   */
  private async generarQr(claveAcceso: string): Promise<string> {
    if (!claveAcceso) return '';

    try {
      return await QRCode.toDataURL(claveAcceso, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo generar el QR de ${claveAcceso}: ${(error as Error).message}`,
      );
      return '';
    }
  }

  /**
   * El código de barras de la clave de acceso, como PNG embebido.
   *
   * **Code 128, que es la simbología que describe la ficha técnica del SRI.**
   *
   * Se genera aquí y viaja como Data URI, igual que el logo. La alternativa era
   * el formatter `:barcode()` de Carbone, y no sirve: está reservado a la
   * edición Enterprise y el contenedor corre en Community, donde **tumba el
   * render entero** en vez de omitir la imagen.
   *
   * `bwip-js` no arrastra ninguna dependencia y no necesita `canvas` ni módulos
   * nativos: trae su propio codificador PNG.
   *
   * Si falla, **no se queda sin RIDE**: devuelve un píxel transparente. Un
   * comprobante sin código de barras sigue siendo válido —los 49 dígitos
   * impresos son lo que exige la norma—; uno que no se genera, no existe.
   */
  private async generarBarcode(claveAcceso: string): Promise<Buffer> {
    if (!claveAcceso) return RideService.PIXEL_TRANSPARENTE;

    try {
      const png = await bwipjs.toBuffer({
        bcid: 'code128',
        text: claveAcceso,
        /*
         * 🔴 **La zona muda no es un margen estético: sin ella no se lee.**
         *
         * `bwip-js` genera el PNG pegado al primer y al último módulo, y Code
         * 128 exige diez módulos de blanco a cada lado (ISO/IEC 15417 §5.2).
         * El lector los usa para saber dónde empieza el símbolo; sin ellos no
         * encuentra el patrón de inicio y **no devuelve nada** —ni un dato
         * equivocado, que al menos se notaría—. El código estaba perfectamente
         * codificado y aun así ningún escáner lo veía.
         *
         * Se ponen doce y no diez para tener holgura frente al reescalado que
         * hace LibreOffice al meterlo en el PDF.
         */
        paddingwidth: 12,
        /*
         * Alto en milímetros. Se lee con la pistola apoyada en el papel, pero
         * también con la cámara de un móvil desde la pantalla, y ahí un código
         * bajo se pierde: 15 mm da margen para apuntar sin recortarlo.
         */
        height: 15,
        scale: 3,
        includetext: false,
        backgroundcolor: 'FFFFFF',
      });

      return png;
    } catch (error) {
      this.logger.warn(
        `No se pudo generar el código de barras de ${claveAcceso}: ${(error as Error).message}`,
      );
      return RideService.PIXEL_TRANSPARENTE;
    }
  }

  /**
   * El logo del emisor, si lo tiene.
   *
   * Se busca en tres sitios, en este orden:
   *
   *   1. **`emisores.logo_url`** — la imagen que el propio negocio ya subió a
   *      su ficha. Es la que hace que esto funcione con muchos negocios: el
   *      logo lo pone su dueño y llega solo.
   *   2. **`{TEMPLATES_DIR}/logos/{ruc}.png`** — un fichero en la imagen del
   *      contenedor. Sirve para emisores fijos, como Darkmelon, cuyo logo no
   *      cambia y no merece un viaje de red en cada RIDE.
   *   3. **Un píxel transparente.**
   *
   * 🔴 **El píxel transparente no es «no hacer nada».** El hueco del logo en
   * `ride.docx` lleva de relleno el logo de Darkmelon; si no se sustituye, la
   * factura de un negocio cualquiera sale con la marca de Darkmelon. El píxel
   * es lo que borra el relleno.
   *
   * **Un logo que no se puede traer nunca tumba el RIDE.** Un comprobante sin
   * logo sigue siendo un comprobante válido; uno que no se genera, no existe.
   */
  private async cargarLogo(
    rucEmisor: string,
    logoUrl?: string | null,
  ): Promise<Buffer> {
    const remoto = await this.descargarLogo(logoUrl);
    if (remoto) return remoto;

    if (!rucEmisor) return RideService.PIXEL_TRANSPARENTE;

    try {
      const ruta = join(
        this.templateService.templatesDir,
        'logos',
        `${rucEmisor}.png`,
      );

      if (!existsSync(ruta)) return RideService.PIXEL_TRANSPARENTE;

      return readFileSync(ruta);
    } catch {
      return RideService.PIXEL_TRANSPARENTE;
    }
  }

  /**
   * Descarga el logo de su URL y lo devuelve como Data URI.
   *
   * **Se cachea en memoria por URL.** Sin caché, cada descarga de un RIDE
   * dispararía una petición a un servidor ajeno; con ella, el logo de un
   * negocio se trae una vez por instancia y ya. La caché no se invalida sola:
   * si alguien cambia el logo, se ve en el siguiente reinicio. Es el
   * compromiso correcto para un dato que cambia una vez al año.
   *
   * Devuelve `null` —y no lanza— ante cualquier problema: URL inválida, host
   * caído, tiempo agotado, respuesta que no es una imagen o demasiado grande.
   */
  private async descargarLogo(url?: string | null): Promise<Buffer | null> {
    const limpia = url?.trim();
    if (!limpia) return null;

    const cacheado = RideService.cacheDeLogos.get(limpia);
    if (cacheado !== undefined) return cacheado;

    const resultado = await this.traerLogo(limpia);
    RideService.cacheDeLogos.set(limpia, resultado);
    return resultado;
  }

  private async traerLogo(url: string): Promise<Buffer | null> {
    try {
      // Solo HTTP(S). Sin esto, un `file://` en la ficha de un emisor sería un
      // lector de ficheros del contenedor a través de una URL que escribe el
      // dueño de un negocio.
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        this.logger.warn(`Logo con protocolo no admitido: ${parsed.protocol}`);
        return null;
      }

      const respuesta = await fetch(url, {
        signal: AbortSignal.timeout(RideService.LOGO_TIMEOUT_MS),
        redirect: 'follow',
      });

      if (!respuesta.ok) {
        this.logger.warn(`El logo ${url} respondió ${respuesta.status}`);
        return null;
      }

      const tipo = respuesta.headers.get('content-type') ?? '';
      if (!tipo.startsWith('image/')) {
        this.logger.warn(`El logo ${url} no es una imagen (${tipo})`);
        return null;
      }

      const bytes = Buffer.from(await respuesta.arrayBuffer());

      if (bytes.byteLength > RideService.LOGO_MAX_BYTES) {
        this.logger.warn(
          `El logo ${url} pesa ${bytes.byteLength} bytes; el máximo son ${RideService.LOGO_MAX_BYTES}.`,
        );
        return null;
      }

      return bytes;
    } catch (error) {
      this.logger.warn(
        `No se pudo traer el logo ${url}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapComprobanteToRideData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    comprobante: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    detalles: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    totales: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    impuestos: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pagos: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    infoAdicional: any[],
    /**
     * El logo y el código de barras **ya no viajan aquí**: se meten en la
     * plantilla antes de subirla, porque Carbone no sustituye imágenes en la
     * edición desplegada. Solo queda el QR, que la plantilla no usa.
     */
    extras: { qrDataUri: string },
  ): AnyRecord {
    const esProduccion = comprobante.ambiente === Ambiente.PRODUCCION;

    /*
     * En pruebas la advertencia viaja **dentro del propio texto del ambiente**.
     *
     * Antes era una etiqueta peque\u00f1a que dec\u00eda \u00abPRUEBAS\u00bb y poco m\u00e1s. Un
     * comprobante de pruebas no tiene ninguna validez tributaria, y entregarle
     * uno a un cliente creyendo que es real es un problema serio; que lo diga
     * donde se mira el n\u00famero cuesta lo mismo que no decirlo.
     */
    const ambienteDesc = esProduccion
      ? 'PRODUCCI\u00d3N'
      : 'PRUEBAS \u2014 SIN VALIDEZ TRIBUTARIA';

    const tipoEmisionDesc =
      comprobante.tipo_emision === TipoEmision.CONTINGENCIA
        ? 'CONTINGENCIA'
        : 'NORMAL';

    const tipoCompDesc =
      TIPO_COMPROBANTE_DESCRIPCIONES[comprobante.tipo_comprobante] ||
      comprobante.tipo_comprobante;

    const subtotal = parseFloat(comprobante.subtotal) || 0;
    const totalDescuento = parseFloat(comprobante.total_descuento) || 0;
    const totalImpuestos = parseFloat(comprobante.total_impuestos) || 0;
    const total = parseFloat(comprobante.total) || 0;
    const propina = parseFloat(comprobante.propina) || 0;
    const moneda = comprobante.moneda === 'DOLAR' ? 'USD' : (comprobante.moneda || 'USD');

    // Group impuestos by detalle_id for embedding in detalles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const impuestosByDetalle: Record<string, any[]> = {};
    for (const imp of impuestos) {
      const key = imp.comprobante_detalle_id;
      if (!impuestosByDetalle[key]) impuestosByDetalle[key] = [];
      impuestosByDetalle[key].push({
        codigo: imp.codigo || '',
        codigoPorcentaje: imp.codigo_porcentaje || '',
        tarifa: parseFloat(imp.tarifa) || 0,
        baseImponibleFormato: this.formatMoneda(parseFloat(imp.base_imponible) || 0, moneda),
        valorFormato: this.formatMoneda(parseFloat(imp.valor) || 0, moneda),
      });
    }

    /*
     * ─── Las casillas de totales del RIDE ────────────────────────────────
     *
     * La plantilla las pide por nombre —`subtotal15`, `iva5`, `ice`— y no como
     * una lista, porque **así es el formulario**: un RIDE tiene una casilla fija
     * por tarifa, y las que no aplican se imprimen en cero. Recorrerlas como
     * array obligaba a la plantilla a repetir filas y solo salía la tarifa que
     * la factura usaba, dejando el bloque incompleto.
     *
     * El agrupador es `codigo_porcentaje` del catálogo del SRI:
     *   0 → 0 %   ·   4 → 15 %   ·   5 → 5 %   ·   6 → no objeto   ·   7 → exento
     * El ICE es otro impuesto entero (`codigo` 3), no una tarifa del IVA.
     */
    const baseDe = (cp: string): number =>
      totales
        .filter((t) => String(t.codigo) === '2' && String(t.codigo_porcentaje) === cp)
        .reduce((s, t) => s + (parseFloat(t.base_imponible) || 0), 0);

    const ivaDe = (cp: string): number =>
      totales
        .filter((t) => String(t.codigo) === '2' && String(t.codigo_porcentaje) === cp)
        .reduce((s, t) => s + (parseFloat(t.valor) || 0), 0);

    const totalIce = totales
      .filter((t) => String(t.codigo) === '3')
      .reduce((s, t) => s + (parseFloat(t.valor) || 0), 0);

    const m = (v: number): string => this.formatMoneda(v, moneda);

    return {
      /*
       * ═══ Forma anidada — la que consume `ride.docx` ════════════════════
       *
       * Se separa en `emisor` / `factura` / `cliente` / `totales` porque es
       * como está organizado el documento en papel, y así quien edita la
       * plantilla en Word encuentra el dato donde lo busca.
       *
       * Las claves planas de más abajo se mantienen: son las que usaba la
       * plantilla HTML anterior y no cuesta nada dejarlas por si hiciera falta
       * volver.
       */
      emisor: {
        razonSocial: comprobante.razon_social_emisor || '',
        nombreComercial: comprobante.nombre_comercial || '',
        ruc: comprobante.ruc_emisor || '',
        direccionMatriz: comprobante.direccion_matriz || '',
        direccionSucursal:
          comprobante.direccion_establecimiento ||
          comprobante.direccion_matriz ||
          '',
        contribuyenteEspecial: comprobante.contribuyente_especial || '',
        obligadoContabilidad:
          comprobante.obligado_contabilidad === true ||
          comprobante.obligado_contabilidad === 'true'
            ? 'SI'
            : 'NO',
        regimenRimpe:
          comprobante.contribuyente_rimpe === true ||
          comprobante.contribuyente_rimpe === 'true'
            ? 'CONTRIBUYENTE RÉGIMEN RIMPE'
            : '',
        agenteRetencion:
          comprobante.agente_retencion === true ||
          comprobante.agente_retencion === 'true'
            ? 'AGENTE DE RETENCIÓN'
            : '',
        /*
         * Vacío a propósito: la imagen la coloca `docx-imagenes.ts` metiendo
         * los bytes en la plantilla. Se deja la clave para que Carbone no
         * imprima el marcador crudo si algún día la etiqueta sobrevive en el
         * texto alternativo.
         */
        logo: '',
        /*
         * Datos de marca. **No están en el comprobante, están en el emisor**, y
         * por eso los trae la consulta con alias `emisor_*`: el SRI no los
         * guarda porque no son fiscales, pero el RIDE los imprime en la
         * cabecera y el pie.
         *
         * Se emiten como cadena vacía cuando faltan —nunca `undefined`— para
         * que la plantilla no acabe imprimiendo el marcador crudo.
         */
        eslogan: comprobante.emisor_eslogan || '',
        ciudad: comprobante.emisor_ciudad || '',
        email: comprobante.emisor_email || '',
        web: comprobante.emisor_web || '',
        telefono: comprobante.emisor_telefono || '',
      },

      factura: {
        estab: comprobante.establecimiento || '',
        ptoEmi: comprobante.punto_emision || '',
        secuencial: comprobante.secuencial || '',
        numeroAutorizacion: comprobante.num_autorizacion || '',
        fechaAutorizacion: this.formatFecha(comprobante.fecha_autorizacion),
        ambiente: ambienteDesc,
        tipoEmision: tipoEmisionDesc,
        fechaEmision: this.formatFechaSolo(comprobante.fecha_emision),
        claveAcceso: comprobante.clave_acceso || '',
        claveAccesoAgrupada: this.agruparClave(comprobante.clave_acceso),
        /**
         * El código que acompaña a la clave de acceso: Code 128 de los 49
         * dígitos, que es lo que describe la ficha técnica.
         *
         * **Se deja vacío aquí a propósito.** La imagen la mete
         * `docx-imagenes.ts` en la plantilla antes de subirla. Dos mecanismos
         * de Carbone se descartaron, y por motivos distintos:
         *
         * 1. `:barcode(code128)` — **tumba el render entero con un 500**:
         *    `Formatter "barcode" is disabled in the Community Edition`. La
         *    imagen se llama `carbone-ee` pero sin licencia arranca en CE, así
         *    que ahí no va a existir nunca.
         * 2. La imagen por texto alternativo — **falla en silencio**: se
         *    comprobó renderizando esta misma plantilla y Carbone escribe el
         *    Data URI en el atributo `descr` sin tocar el binario. El PDF sale
         *    con el código de barras decorativo del Word, que parece correcto
         *    y no lleva la clave de acceso.
         */
        claveAccesoBarcode: '',
        /** No se emiten guías de remisión desde aquí. */
        guiaRemision: '',
        /**
         * La leyenda del pie. En pruebas dice lo único que importa decir; en
         * producción va vacía para no ensuciar un documento con validez legal.
         */
        leyenda: esProduccion
          ? ''
          : 'DOCUMENTO EMITIDO EN AMBIENTE DE PRUEBAS — SIN VALIDEZ TRIBUTARIA',
        estado: comprobante.estado || '',
      },

      cliente: {
        razonSocial: comprobante.razon_social_comprador || '',
        identificacion: comprobante.identificacion_comprador || '',
        tipoIdentificacion: this.getTipoIdentificacionDesc(
          comprobante.receptor_tipo_identificacion,
        ),
        direccion: comprobante.receptor_direccion || '',
        telefono: comprobante.receptor_telefono || '',
        email: comprobante.receptor_email || '',
      },

      /*
       * ⚠️ `totales` es un **objeto**, no la lista que usaba la plantilla HTML.
       * Es el único nombre que chocaba entre las dos formas, y gana el
       * documento de Word porque es el que se usa.
       */
      totales: {
        subtotal15: m(baseDe('4')),
        subtotal5: m(baseDe('5')),
        subtotal0: m(baseDe('0')),
        subtotalNoObjeto: m(baseDe('6')),
        subtotalExento: m(baseDe('7')),
        subtotalSinImpuestos: m(subtotal),
        totalDescuento: m(totalDescuento),
        ice: m(totalIce),
        iva15: m(ivaDe('4')),
        iva5: m(ivaDe('5')),
        propina: m(propina),
        valorTotal: m(total),
      },

      // ═══ Forma plana — la que usaba la plantilla HTML ═══════════════════
      rucEmisor: comprobante.ruc_emisor || '',
      razonSocialEmisor: comprobante.razon_social_emisor || '',
      nombreComercial: comprobante.nombre_comercial || '',
      direccionMatriz: comprobante.direccion_matriz || '',
      direccionEstablecimiento: comprobante.direccion_establecimiento || comprobante.direccion_matriz || '',
      obligadoContabilidad: comprobante.obligado_contabilidad === true || comprobante.obligado_contabilidad === 'true' ? 'SI' : 'NO',
      contribuyenteEspecial: comprobante.contribuyente_especial || '',
      agenteRetencion: comprobante.agente_retencion === true || comprobante.agente_retencion === 'true' ? 'SI' : '',
      contribuyenteRimpe: comprobante.contribuyente_rimpe === true || comprobante.contribuyente_rimpe === 'true' ? 'SI' : '',

      // Comprobante
      tipoComprobanteDescripcion: tipoCompDesc,
      ambienteDescripcion: ambienteDesc,
      tipoEmisionDescripcion: tipoEmisionDesc,
      establecimiento: comprobante.establecimiento || '',
      puntoEmision: comprobante.punto_emision || '',
      secuencial: comprobante.secuencial || '',
      numeroComprobante: `${comprobante.establecimiento || ''}-${comprobante.punto_emision || ''}-${comprobante.secuencial || ''}`,
      fechaEmisionFormato: this.formatFechaSolo(comprobante.fecha_emision),
      claveAcceso: comprobante.clave_acceso || '',
      claveAccesoAgrupada: this.agruparClave(comprobante.clave_acceso),
      qrDataUri: extras.qrDataUri,
      /** Vacío: la imagen se mete en la plantilla, no viaja en los datos. */
      logoDataUri: '',
      /**
       * Las menciones que solo aparecen si el emisor las tiene, ya resueltas en
       * una sola cadena. **La plantilla no decide**: un condicional mal escrito
       * en Carbone no falla, imprime el marcador en el PDF.
       */
      emisorLeyendas: [
        comprobante.contribuyente_especial
          ? `CONTRIBUYENTE ESPECIAL Nº ${comprobante.contribuyente_especial}`
          : '',
        comprobante.contribuyente_rimpe === true ||
        comprobante.contribuyente_rimpe === 'true'
          ? 'CONTRIBUYENTE RÉGIMEN RIMPE'
          : '',
        comprobante.agente_retencion === true ||
        comprobante.agente_retencion === 'true'
          ? 'AGENTE DE RETENCIÓN'
          : '',
      ]
        .filter(Boolean)
        .join('  ·  '),
      estado: comprobante.estado || '',
      numAutorizacion: comprobante.num_autorizacion || '',
      fechaAutorizacionFormato: this.formatFecha(
        comprobante.fecha_autorizacion,
      ),

      // Comprador
      razonSocialComprador: comprobante.razon_social_comprador || '',
      identificacionComprador: comprobante.identificacion_comprador || '',
      tipoIdentificacionComprador: this.getTipoIdentificacionDesc(comprobante.receptor_tipo_identificacion),
      receptorDireccion: comprobante.receptor_direccion || '',
      receptorEmail: comprobante.receptor_email || '',
      receptorTelefono: comprobante.receptor_telefono || '',

      // Totales
      subtotalFormato: this.formatMoneda(subtotal, moneda),
      totalDescuentoFormato: this.formatMoneda(totalDescuento, moneda),
      totalImpuestosFormato: this.formatMoneda(totalImpuestos, moneda),
      propinaFormato: this.formatMoneda(propina, moneda),
      totalFormato: this.formatMoneda(total, moneda),
      moneda,

      // Detalles (items) con impuestos embebidos
      detalles: detalles.map((d) => ({
        codigoPrincipal: d.codigo_principal || '',
        codigoAuxiliar: d.codigo_auxiliar || '',
        descripcion: d.descripcion || '',
        /*
         * Los nombres cortos —`cantidad`, `precioUnitario`, `descuento`,
         * `precioTotal`— son los que usa `ride.docx`; los `…Formato` los usaba
         * la plantilla HTML. Ambos llevan el mismo valor ya formateado.
         */
        cantidad: this.formatNumero(parseFloat(d.cantidad) || 0),
        precioUnitario: this.formatMoneda(
          parseFloat(d.precio_unitario) || 0,
          moneda,
        ),
        descuento: this.formatMoneda(parseFloat(d.descuento) || 0, moneda),
        precioTotal: this.formatMoneda(
          parseFloat(d.subtotal) ||
            parseFloat(d.precio_total_sin_impuesto) ||
            (parseFloat(d.cantidad) || 0) *
              (parseFloat(d.precio_unitario) || 0) -
              (parseFloat(d.descuento) || 0),
          moneda,
        ),
        /** La consulta del RIDE no trae los detalles adicionales de la línea. */
        detalleAdicional: '',
        cantidadFormato: this.formatNumero(parseFloat(d.cantidad) || 0),
        precioUnitarioFormato: this.formatMoneda(
          parseFloat(d.precio_unitario) || 0,
          moneda,
        ),
        descuentoFormato: this.formatMoneda(
          parseFloat(d.descuento) || 0,
          moneda,
        ),
        /**
         * El subtotal de la línea.
         *
         * 🔴 **Se lee `d.subtotal`, no `d.precio_total_sin_impuesto`.** La
         * consulta lo devuelve con alias —`precio_total_sin_impuesto AS
         * subtotal` en `findDetallesByComprobanteId`—, así que el nombre de la
         * columna no existe en la fila. `parseFloat(undefined) || 0` daba cero
         * **sin fallar**, y el RIDE imprimía `$0.00` en todas las líneas
         * mientras los totales de abajo salían bien: una factura que se
         * contradice a sí misma delante del cliente.
         *
         * El respaldo recalcula `cantidad × precio − descuento`, que es la
         * definición del campo. Un documento fiscal no debería quedar mal por
         * un dato derivado que no se guardó.
         */
        subtotalFormato: this.formatMoneda(
          parseFloat(d.subtotal) ||
            parseFloat(d.precio_total_sin_impuesto) ||
            (parseFloat(d.cantidad) || 0) *
              (parseFloat(d.precio_unitario) || 0) -
              (parseFloat(d.descuento) || 0),
          moneda,
        ),
        impuestos: impuestosByDetalle[d.id] || [],
      })),

      /*
       * El desglose por tarifa como lista vive ahora en `totalesPorTarifa`.
       * El nombre `totales` lo ocupa el objeto de casillas que consume el
       * documento de Word: era el único choque entre las dos formas.
       */
      totalesPorTarifa: totales.map((t) => ({
        codigo: t.codigo || '',
        descripcion: this.getImpuestoDescripcion(t.codigo),
        codigoPorcentaje: t.codigo_porcentaje || '',
        tarifa: parseFloat(t.tarifa) || 0,
        baseImponibleFormato: this.formatMoneda(
          parseFloat(t.base_imponible) || 0,
          moneda,
        ),
        valorFormato: this.formatMoneda(parseFloat(t.valor) || 0, moneda),
      })),

      /*
       * Cada pago lleva las claves con los dos nombres. `descripcion` y `total`
       * son los que usa `ride.docx`; los `…Formato` los usaba la plantilla HTML.
       * Duplicar dos cadenas por pago no cuesta nada y evita que cambiar de
       * plantilla obligue a tocar este mapeo.
       */
      pagos: pagos.map((p) => ({
        formaPago: p.forma_pago || '',
        descripcion: this.getFormaPagoDescripcion(p.forma_pago),
        total: this.formatMoneda(parseFloat(p.total) || 0, moneda),
        formaPagoDescripcion: this.getFormaPagoDescripcion(p.forma_pago),
        totalFormato: this.formatMoneda(parseFloat(p.total) || 0, moneda),
        plazo: p.plazo ? String(p.plazo) : '',
        unidadTiempo: p.unidad_tiempo || '',
      })),

      // Info adicional
      infoAdicional: (infoAdicional || []).map((ia) => ({
        nombre: ia.nombre || '',
        valor: ia.valor || '',
      })),
    };
  }

  /**
   * Formatea una fecha al formato DD/MM/YYYY HH:mm:ss
   */
  /**
   * Fecha **sin hora**, para la emisión.
   *
   * La fecha de emisión de un comprobante es un día, no un instante: se
   * imprimía como `17/08/2026 00:00:00` y esos ceros no informan de nada.
   * La de autorización sí lleva hora, porque ahí el momento exacto importa.
   */
  private formatFechaSolo(fecha: string | null | undefined): string {
    return this.formatFecha(fecha).split(' ')[0] ?? '';
  }

  private formatFecha(fecha: string | null | undefined): string {
    if (!fecha) return '';
    try {
      const date = new Date(fecha);
      if (isNaN(date.getTime())) return fecha;
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      const hh = String(date.getHours()).padStart(2, '0');
      const min = String(date.getMinutes()).padStart(2, '0');
      const ss = String(date.getSeconds()).padStart(2, '0');
      return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
    } catch {
      return fecha;
    }
  }

  /**
   * Formatea un valor monetario
   */
  private formatMoneda(valor: number, moneda: string = 'USD'): string {
    const simbolo = moneda === 'USD' ? '$' : '';
    return `${simbolo}${valor.toFixed(2)}`;
  }

  /**
   * Formatea un número (cantidad)
   */
  private formatNumero(valor: number): string {
    return valor.toFixed(2);
  }

  /**
   * Descripción del impuesto según código SRI
   */
  private getImpuestoDescripcion(codigo: string): string {
    const descripciones: Record<string, string> = {
      '2': 'IVA',
      '3': 'ICE',
      '5': 'IRB',
    };
    return descripciones[codigo] || 'IMP';
  }

  /**
   * Descripción del tipo de identificación según código SRI
   */
  private getTipoIdentificacionDesc(codigo: string | null | undefined): string {
    if (!codigo) return '';
    const descripciones: Record<string, string> = {
      [TipoIdentificacion.RUC]: 'RUC',
      [TipoIdentificacion.CEDULA]: 'CÉDULA',
      [TipoIdentificacion.PASAPORTE]: 'PASAPORTE',
      [TipoIdentificacion.CONSUMIDOR_FINAL]: 'CONSUMIDOR FINAL',
      [TipoIdentificacion.IDENTIFICACION_EXTERIOR]: 'IDENTIFICACIÓN EXTERIOR',
      [TipoIdentificacion.PLACA]: 'PLACA',
    };
    return descripciones[codigo] || codigo;
  }

  /**
   * Descripción de la forma de pago según código SRI
   */
  private getFormaPagoDescripcion(codigo: string | null | undefined): string {
    if (!codigo) return '';
    const descripciones: Record<string, string> = {
      '01': 'SIN UTILIZACIÓN DEL SISTEMA FINANCIERO',
      '15': 'COMPENSACIÓN DE DEUDAS',
      '16': 'TARJETA DE DÉBITO',
      '17': 'DINERO ELECTRÓNICO',
      '18': 'TARJETA PREPAGO',
      '19': 'TARJETA DE CRÉDITO',
      '20': 'OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO',
      '21': 'ENDOSO DE TÍTULOS',
    };
    return descripciones[codigo] || codigo;
  }
}
