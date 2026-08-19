import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Almacenamiento de objetos: S3, o cualquier cosa compatible.
 *
 * ═══ Por qué existe ═══════════════════════════════════════════════════════
 *
 * Los XML firmados y autorizados vivían **solo en el disco del contenedor**, y
 * `comprobante_xmls` guardaba rutas, no contenido. Sin un volumen, cada
 * despliegue los borraba — y son los documentos que Ecuador obliga a conservar
 * siete años. El RIDE no importa, se regenera; el XML autorizado no: lleva la
 * firma XAdES-BES y el sello del SRI, y no se puede reconstruir.
 *
 * ═══ R2 y S3 ══════════════════════════════════════════════════════════════
 *
 * Es el mismo protocolo. La única diferencia es `S3_ENDPOINT`: con él apunta a
 * Cloudflare R2 (`https://<cuenta>.r2.cloudflarestorage.com`), sin él va a AWS.
 * R2 además exige `region: 'auto'`, que es el valor por defecto de aquí.
 *
 * ═══ Si no está configurado ═══════════════════════════════════════════════
 *
 * `isEnabled()` devuelve `false` y quien llama decide. **No se lanza al
 * arrancar**: un entorno de desarrollo sin credenciales tiene que poder
 * levantar el servicio, y quien depende de esto ya tiene su propio respaldo.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('storage.bucket') ?? '';
    this.prefix = this.configService.get<string>('storage.prefix') ?? '';

    const accessKeyId =
      this.configService.get<string>('storage.accessKeyId') ?? '';
    const secretAccessKey =
      this.configService.get<string>('storage.secretAccessKey') ?? '';

    if (!this.bucket || !accessKeyId || !secretAccessKey) {
      this.client = null;
      this.logger.warn(
        'Almacenamiento de objetos SIN configurar (falta bucket o credenciales). ' +
          'Los XML se guardarán en la base como respaldo, pero conviene configurarlo: ' +
          'el disco del contenedor no sobrevive a un despliegue.',
      );
      return;
    }

    const endpoint = this.configService.get<string>('storage.endpoint');

    this.client = new S3Client({
      // R2 exige 'auto'; en AWS se pone la región real por variable.
      region: this.configService.get<string>('storage.region') ?? 'auto',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: { accessKeyId, secretAccessKey },
    });

    this.logger.log(
      `Almacenamiento de objetos listo: ${this.bucket}` +
        (endpoint ? ` (${endpoint})` : ' (AWS S3)'),
    );
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * La clave completa, con el prefijo configurado.
   *
   * El prefijo permite compartir un bucket entre servicios sin que se pisen —
   * que es el caso si se reutiliza el mismo bucket que ya usa `business` para
   * las imágenes.
   */
  private fullKey(key: string): string {
    return this.prefix ? `${this.prefix.replace(/\/+$/, '')}/${key}` : key;
  }

  /**
   * Sube un objeto. **Lanza si falla**: quien llama decide qué hacer, y en el
   * caso de los XML eso significa caer al respaldo en la base.
   */
  async put(
    key: string,
    body: Buffer | string,
    contentType: string,
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Almacenamiento de objetos no configurado');
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.fullKey(key),
        Body: typeof body === 'string' ? Buffer.from(body, 'utf-8') : body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Descarga un objeto como texto. `null` si no está o si falla.
   *
   * **No lanza**: quien lo pide tiene otros sitios donde mirar —el respaldo de
   * la base, o el disco heredado— y un fallo aquí no debe cortar esa cadena.
   */
  async getText(key: string): Promise<string | null> {
    if (!this.client) return null;

    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
      );

      return (await res.Body?.transformToString('utf-8')) ?? null;
    } catch (error) {
      // Un objeto que no está es lo normal cuando se busca en varios sitios;
      // solo interesa el registro cuando falla por otra cosa.
      const nombre = (error as { name?: string }).name;
      if (nombre !== 'NoSuchKey' && nombre !== 'NotFound') {
        this.logger.warn(`No se pudo leer ${key}: ${(error as Error).message}`);
      }
      return null;
    }
  }

  /**
   * URL temporal de descarga directa.
   *
   * **Es lo que evita tener que servir el fichero desde aquí**: el cliente lo
   * baja del almacenamiento y este servicio no hace de intermediario. Caduca,
   * así que una URL filtrada deja de valer sola — al revés que un directorio
   * estático abierto, que fue justo el problema que se retiró.
   */
  async presignedUrl(key: string, expiresIn = 900): Promise<string | null> {
    if (!this.client) return null;

    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
        { expiresIn },
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo firmar la URL de ${key}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
