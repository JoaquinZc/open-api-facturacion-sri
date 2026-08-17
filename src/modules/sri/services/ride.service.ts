import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
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
  private static readonly PIXEL_TRANSPARENTE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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
    const qrDataUri = await this.generarQr(comprobante.clave_acceso as string);
    const logoDataUri = this.cargarLogo(comprobante.ruc_emisor as string);

    const rideData = this.mapComprobanteToRideData(
      comprobante,
      detalles,
      totales,
      impuestos,
      pagos,
      infoAdicional,
      { qrDataUri, logoDataUri },
    );

    const templatePath = this.templateService.findTemplate(
      RideService.RIDE_TEMPLATE_ID,
    );

    return this.pdfService.generatePDF(
      rideData as AnyRecord,
      templatePath,
    );
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
   * ⚠️ La ficha técnica del SRI describe un **código de barras** (GS1-128) para
   * la clave de acceso. Aquí va un QR porque `qrcode` ya es una dependencia del
   * proyecto y el código de barras exigiría añadir otra que no se puede
   * verificar sin desplegar. Los 49 dígitos impresos —que son la parte que
   * exige la norma— están junto al QR. Si se quiere el Code 128, es cambiar
   * este método.
   *
   * Si falla, **no tumba el RIDE**: se devuelve un píxel transparente. Un
   * comprobante sin QR sigue siendo válido; uno que no se genera, no existe.
   */
  private async generarQr(claveAcceso: string): Promise<string> {
    if (!claveAcceso) return RideService.PIXEL_TRANSPARENTE;

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
      return RideService.PIXEL_TRANSPARENTE;
    }
  }

  /**
   * El logo del emisor, si lo tiene.
   *
   * Se busca por RUC en `{TEMPLATES_DIR}/logos/{ruc}.png`. Es deliberadamente
   * simple: las plantillas ya viajan en la imagen, así que añadir un logo es
   * dejar un fichero al lado, sin tocar la base de datos ni el despliegue.
   *
   * Sin logo se devuelve un píxel transparente en vez de una cadena vacía: así
   * la plantilla no necesita preguntar y no queda el hueco de una imagen rota.
   */
  private cargarLogo(rucEmisor: string): string {
    if (!rucEmisor) return RideService.PIXEL_TRANSPARENTE;

    try {
      const ruta = join(
        this.templateService.templatesDir,
        'logos',
        `${rucEmisor}.png`,
      );

      if (!existsSync(ruta)) return RideService.PIXEL_TRANSPARENTE;

      const png = readFileSync(ruta).toString('base64');
      return `data:image/png;base64,${png}`;
    } catch {
      return RideService.PIXEL_TRANSPARENTE;
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
    extras: { qrDataUri: string; logoDataUri: string },
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
        logo: extras.logoDataUri,
        /*
         * Estos cinco no existen en el comprobante: son datos de marca, no
         * fiscales, y el SRI no los guarda. Se emiten vacíos para que la
         * plantilla no imprima la etiqueta cruda. Si algún día hacen falta,
         * el sitio es la ficha del emisor.
         */
        eslogan: '',
        ciudad: '',
        email: '',
        web: '',
        telefono: '',
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
         * El código que acompaña a la clave de acceso, como imagen embebida.
         *
         * 🔴 **No se usa `:barcode(code128)` de Carbone.** Es una función de la
         * edición Enterprise, y el contenedor corre en Community:
         *
         *     Formatter "barcode" is disabled in the Community Edition
         *
         * La imagen se llama `carbone-ee`, pero sin licencia arranca en CE — así
         * que no es cuestión de actualizar, ahí no va a existir nunca. Y el
         * fallo **tumba el render completo con un 500**: no se pierde solo esa
         * imagen, no sale ningún RIDE.
         *
         * Así que la imagen viaja ya generada, por el mismo camino que el logo
         * —un Data URI en el texto alternativo—, que es mecanismo probado.
         *
         * ⚠️ Hoy es un **QR**, no el Code 128 que describe la ficha técnica del
         * SRI. Para tener el código de barras hay dos caminos: licenciar Carbone
         * Enterprise, o generarlo aquí con una librería y seguir mandándolo por
         * este mismo campo — la plantilla no habría que tocarla. Los 49 dígitos
         * impresos, que son la parte que exige la norma, están en el documento
         * en cualquier caso.
         */
        claveAccesoBarcode: extras.qrDataUri,
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
      logoDataUri: extras.logoDataUri,
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
