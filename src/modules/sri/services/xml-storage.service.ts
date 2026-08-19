import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ObjectStorageService } from '../../../common/storage/object-storage.service';

/** Lo que se guarda de un XML: dónde quedó, y su contenido si no se pudo subir. */
export interface XmlGuardado {
  /** Clave en el almacenamiento de objetos. `null` si no se pudo subir. */
  path: string | null;
  /**
   * El XML entero. **Solo se rellena cuando la subida falló**, para que quien
   * llama lo escriba en la base dentro de su transacción.
   */
  contenido: string | null;
}

export interface XmlsGuardados {
  sinFirma?: XmlGuardado;
  firmado?: XmlGuardado;
  autorizado?: XmlGuardado;
}

/**
 * Dónde viven los XML de los comprobantes.
 *
 * ═══ Qué cambió y por qué ═════════════════════════════════════════════════
 *
 * Vivían **solo en el disco del contenedor**, y `comprobante_xmls` guardaba
 * rutas, no contenido. Sin un volumen, cada despliegue los borraba — y el XML
 * autorizado es el documento que Ecuador obliga a conservar **siete años**. El
 * RIDE no importa, se regenera de la base; este no: lleva la firma XAdES-BES y
 * el sello del SRI.
 *
 * Ahora van a **S3/R2**, que es almacenamiento de verdad: con copias, sin
 * depender de que un contenedor siga vivo, y sin volúmenes.
 *
 * ═══ Por qué hay un respaldo en la base ═══════════════════════════════════
 *
 * 🔴 **Este guardado ocurre después de mandar el comprobante al SRI.** El orden
 * real es firmar → enviar → guardar, así que cuando esto corre el SRI ya puede
 * haberlo autorizado. Si aquí se lanzara, la transacción haría rollback, el
 * comprobante desaparecería de la base y el SRI seguiría teniéndolo: al
 * reintentar saldría «CLAVE ACCESO REGISTRADA» y ese documento quedaría
 * inalcanzable para siempre.
 *
 * Por eso **subir a S3 no puede ser un punto de fallo**. Si falla, el XML sale
 * por `contenido` y quien llama lo escribe en la base — dentro de la misma
 * transacción, así que se guarda o no se guarda nada, pero nunca se pierde.
 *
 * ═══ Al leer se mira en tres sitios ═══════════════════════════════════════
 *
 * S3 → respaldo en la base → **disco**. El tercero es para los comprobantes
 * emitidos antes de este cambio, que siguen donde estaban mientras el
 * contenedor no se recicle. No es un sitio donde escribir: es una vía de
 * lectura para lo que ya existe.
 */
@Injectable()
export class XmlStorageService {
  private readonly logger = new Logger(XmlStorageService.name);

  /** Solo para leer lo emitido antes del cambio. Aquí ya no se escribe. */
  private readonly legacyDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly storage: ObjectStorageService,
  ) {
    this.legacyDir =
      this.configService.get<string>('directories.xmls') || '../xmls';
  }

  /**
   * La clave del objeto: `{ruc}/{año}/{mes}/{tipo}/{clave}.xml`.
   *
   * **Se conserva la misma forma que tenían las rutas en disco**, y no por
   * nostalgia: las filas que ya están en `comprobante_xmls` guardan justo eso,
   * así que la misma cadena sirve para buscar en S3 y en el disco heredado sin
   * tener que migrar nada ni distinguir de dónde vino cada fila.
   */
  private buildKey(
    ruc: string,
    claveAcceso: string,
    fechaEmision: Date,
    tipo: 'sin_firma' | 'firmado' | 'autorizado',
  ): string {
    const subdir = {
      sin_firma: 'sin_firmar',
      firmado: 'firmados',
      autorizado: 'autorizados',
    }[tipo];
    const year = fechaEmision.getFullYear().toString();
    const month = (fechaEmision.getMonth() + 1).toString().padStart(2, '0');

    return `${ruc}/${year}/${month}/${subdir}/${claveAcceso}.xml`;
  }

  /**
   * Guarda un XML. **Nunca lanza** — ver la nota de la clase.
   */
  async saveXml(
    ruc: string,
    claveAcceso: string,
    fechaEmision: Date,
    tipo: 'sin_firma' | 'firmado' | 'autorizado',
    xmlContent: string,
  ): Promise<XmlGuardado> {
    const key = this.buildKey(ruc, claveAcceso, fechaEmision, tipo);

    if (!this.storage.isEnabled()) {
      // Sin almacenamiento configurado el respaldo no es una degradación: es el
      // único sitio durable que hay.
      return { path: null, contenido: xmlContent };
    }

    try {
      await this.storage.put(key, xmlContent, 'application/xml');
      return { path: key, contenido: null };
    } catch (error) {
      this.logger.error(
        `No se pudo subir el XML ${tipo} de ${claveAcceso}: ${(error as Error).message}. ` +
          `Se guarda en la base como respaldo — el comprobante no se pierde.`,
      );
      return { path: null, contenido: xmlContent };
    }
  }

  /** Guarda las versiones que se le pasen, en paralelo. */
  async saveAllXmls(
    ruc: string,
    claveAcceso: string,
    fechaEmision: Date,
    xmlSinFirma?: string,
    xmlFirmado?: string,
    xmlAutorizado?: string,
  ): Promise<XmlsGuardados> {
    const [sinFirma, firmado, autorizado] = await Promise.all([
      xmlSinFirma
        ? this.saveXml(ruc, claveAcceso, fechaEmision, 'sin_firma', xmlSinFirma)
        : Promise.resolve(undefined),
      xmlFirmado
        ? this.saveXml(ruc, claveAcceso, fechaEmision, 'firmado', xmlFirmado)
        : Promise.resolve(undefined),
      xmlAutorizado
        ? this.saveXml(
            ruc,
            claveAcceso,
            fechaEmision,
            'autorizado',
            xmlAutorizado,
          )
        : Promise.resolve(undefined),
    ]);

    return { sinFirma, firmado, autorizado };
  }

  /**
   * Lee un XML por su clave, con el respaldo que quien llama haya sacado de la
   * base.
   *
   * El orden importa: **primero el respaldo**, porque si existe es que la
   * subida falló y en S3 no hay nada que buscar. Ahorra un viaje de red por
   * cada lectura de un comprobante que se guardó en un mal momento.
   */
  async readXml(
    relativePath: string | null,
    contenidoDeRespaldo?: string | null,
  ): Promise<string | null> {
    if (contenidoDeRespaldo) return contenidoDeRespaldo;
    if (!relativePath) return null;

    const deS3 = await this.storage.getText(relativePath);
    if (deS3) return deS3;

    /*
     * El disco heredado: comprobantes emitidos antes de este cambio. Solo
     * lectura, y solo mientras el contenedor no se haya reciclado — si ya se
     * recicló, esos ficheros no existen y no hay nada que hacer, que es
     * exactamente el problema que este cambio evita hacia delante.
     */
    const rutaLocal = join(this.legacyDir, relativePath);
    if (existsSync(rutaLocal)) {
      this.logger.warn(
        `XML ${relativePath} servido desde el disco heredado. ` +
          `No está en el almacenamiento de objetos: se perderá al reciclar el contenedor.`,
      );
      return readFileSync(rutaLocal, 'utf-8');
    }

    return null;
  }
}
