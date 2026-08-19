import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { PdfImageService } from './pdf-image.service';
import { inyectarImagenesEnDocx } from './docx-imagenes';

export interface ImageData {
  url: string;
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly carboneApi: string;
  private readonly pdfRenderConfig: {
    maxAttempts: number;
    retryDelay: number;
  };
  private readonly carboneRenderOptions: Record<string, unknown>;

  constructor(
    private configService: ConfigService,
    private pdfImageService: PdfImageService,
  ) {
    this.carboneApi = this.configService.get<string>('carboneApi')!;
    this.pdfRenderConfig = {
      maxAttempts: this.configService.get<number>('pdfRender.maxAttempts') || 2,
      retryDelay: this.configService.get<number>('pdfRender.retryDelay') || 10,
    };
    this.carboneRenderOptions =
      this.configService.get('carboneRenderOptions') || {};
  }

  /**
   * Generate a PDF using the Carbone API
   */
  async generatePDF(
    jsonData: Record<string, unknown>,
    templatePath: string,
    /**
     * Imágenes que se meten en la plantilla **antes** de subirla, localizadas
     * por su texto alternativo: `{ '{d.emisor.logo}': <bytes> }`.
     *
     * Se hace aquí y no con el mecanismo de imágenes de Carbone porque **se
     * comprobó que la edición desplegada no lo aplica**: sustituye el texto
     * alternativo por el Data URI y deja el binario intacto, así que el PDF
     * sale con la imagen de relleno de la plantilla. Ver `docx-imagenes.ts`.
     */
    imagenes?: Record<string, Buffer>,
  ): Promise<Buffer> {
    // 1. Upload template to Carbone
    const formData = new FormData();
    // Buffer y no flujo: es lo que permite calcular `Content-Length` (ver abajo).
    // El tipo va explícito: `readFileSync` devuelve un `Buffer<ArrayBuffer>` y
    // JSZip uno `<ArrayBufferLike>`, que no encajan sin ensancharlo aquí.
    let templateBuffer: Buffer = readFileSync(templatePath);
    const ext = extname(templatePath).toLowerCase();

    if (imagenes && Object.keys(imagenes).length > 0) {
      const r = await inyectarImagenesEnDocx(templateBuffer, imagenes);
      templateBuffer = r.docx;

      if (r.noEncontradas.length > 0) {
        // No se detiene el render: un documento sin logo sigue siendo válido.
        // Pero conviene saberlo, porque el síntoma en el PDF es una imagen de
        // relleno que *parece* correcta.
        this.logger.warn(
          `No se pudieron colocar estas imágenes en ${basename(templatePath)}: ` +
            `${r.noEncontradas.join(', ')}. El PDF saldrá con el relleno de la plantilla.`,
        );
      }
    }
    const contentTypes: Record<string, string> = {
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.odt': 'application/vnd.oasis.opendocument.text',
      '.html': 'text/html',
      '.xlsx':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    };
    formData.append('template', templateBuffer, {
      filename: basename(templatePath),
      contentType: contentTypes[ext] || 'application/octet-stream',
    });

    /**
     * **Se manda con `Content-Length`, no troceado.**
     *
     * Con un `createReadStream`, `form-data` no puede saber el tamaño por
     * adelantado y axios envía la petición con `Transfer-Encoding: chunked`.
     * Carbone la acepta y le asigna un identificador, pero el fichero **no llega
     * a escribirse**; luego, al verificar el tipo, falla con
     * `ENOENT: open '/app/template/c_…'` y responde 415 «tipo no soportado» —
     * un mensaje que apunta al formato de la plantilla cuando el problema es
     * que no hay plantilla.
     *
     * Leerla a memoria permite calcular la longitud. Son unos pocos KB de HTML,
     * así que el coste es irrelevante frente a que el RIDE no se genere.
     */
    const headers: Record<string, string> = {
      ...formData.getHeaders(),
      Accept: 'application/json',
    };

    try {
      headers['Content-Length'] = String(formData.getLengthSync());
    } catch {
      // Solo se puede calcular si todas las partes son buffers o cadenas. Si
      // alguna fuera un flujo, se envía como antes en vez de romper.
    }

    const templateResponse = await axios.post(
      `${this.carboneApi}/template`,
      formData,
      {
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    );

    if (
      !templateResponse.data?.success ||
      !templateResponse.data?.data?.templateId
    ) {
      throw new Error('Error al obtener el ID del template');
    }

    const templateId = templateResponse.data.data.templateId;

    // 2. Render PDF
    const renderResponse = await axios.post(
      `${this.carboneApi}/render/${templateId}`,
      {
        data: jsonData,
        ...this.carboneRenderOptions,
      },
    );

    if (!renderResponse.data?.success || !renderResponse.data?.data?.renderId) {
      throw new Error('Error al iniciar el renderizado');
    }

    const renderId = renderResponse.data.data.renderId;

    // 3. Wait and check status
    let attempts = 0;
    const maxAttempts = this.pdfRenderConfig.maxAttempts;

    while (attempts < maxAttempts) {
      const statusResponse = await axios.get(`${this.carboneApi}/status`);

      if (statusResponse.data.success || statusResponse.data.ready) {
        // 4. Download the PDF
        const pdfResponse = await axios.get(
          `${this.carboneApi}/render/${renderId}`,
          { responseType: 'arraybuffer' },
        );

        return Buffer.from(pdfResponse.data);
      }

      attempts++;
      await new Promise((resolve) =>
        setTimeout(resolve, this.pdfRenderConfig.retryDelay),
      );
    }

    throw new Error('Tiempo de espera agotado');
  }

  /**
   * Generate a PDF with images using post-processing
   */
  async generatePDFWithImages(
    jsonData: Record<string, unknown>,
    templatePath: string,
    images?: ImageData[],
  ): Promise<Buffer> {
    try {
      // 1. Generate base PDF using Carbone
      const pdfBuffer = await this.generatePDF(jsonData, templatePath);

      // 2. Add images if provided
      if (!images || images.length === 0) {
        return pdfBuffer;
      }

      // 3. Process PDF to add images
      return await this.pdfImageService.addImagesToPdf(pdfBuffer, images);
    } catch (error) {
      this.logger.error('Error al generar PDF con imágenes:', error);
      throw error;
    }
  }
}
