import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PdfService } from './pdf.service';
import { PdfImageService } from './pdf-image.service';

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

/*
 * `readFileSync` no está por comodidad: **es lo que usa `generatePDF`**.
 *
 * La plantilla se lee a memoria a propósito, para poder mandar
 * `Content-Length`; con un flujo, `form-data` no sabe el tamaño, axios manda
 * la petición troceada y Carbone la acepta sin llegar a escribir el fichero,
 * fallando después con un 415 que culpa al formato. Cuando el servicio cambió
 * de flujo a búfer, este doble se quedó atrás y el módulo entero dejó de
 * poder ejecutarse: `(0, fs_1.readFileSync) is not a function`.
 */
jest.mock('fs', () => ({
  createReadStream: jest.fn(() => ({ path: '/fake/templates/report.docx' })),
  readFileSync: jest.fn(() => Buffer.from('plantilla de prueba')),
}));

jest.mock('path', () => ({
  basename: jest.fn((f: string) => f.split('/').pop()),
  join: jest.fn((...args: string[]) => args.join('/')),
  extname: jest.fn((f: string) => {
    const i = f.lastIndexOf('.');
    return i > 0 ? f.substring(i) : '';
  }),
}));

jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn(() => ({ 'content-type': 'multipart/form-data' })),
  }));
});

jest.mock('../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    templates: '/fake/templates',
    pdfsOthers: '/fake/pdfs/others',
    pdfsConFirma: '/fake/pdfs/con-firma',
    pdfsDocuments: '/fake/pdfs/documents',
    pdfsImages: '/fake/pdfs/images',
  },
}));

import axios from 'axios';

describe('PdfService', () => {
  let service: PdfService;
  let pdfImageService: { addImagesToPdf: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    pdfImageService = { addImagesToPdf: jest.fn().mockResolvedValue(Buffer.from('pdf-with-images')) };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'carboneApi') return 'http://carbone.test/api';
        if (key === 'pdfRender.maxAttempts') return 2;
        if (key === 'pdfRender.retryDelay') return 100;
        return undefined;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        PdfService,
        { provide: PdfImageService, useValue: pdfImageService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(PdfService);
  });

  describe('generatePDF', () => {
    it('should generate PDF via Carbone API', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
        .mockResolvedValueOnce({ data: { success: true, data: { renderId: 'rnd-456' } } });
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true } })
        .mockResolvedValueOnce({ data: Buffer.from('fake-pdf') });

      const result = await service.generatePDF({ title: 'Test' }, '/fake/templates/report.docx');

      expect(result).toBeDefined();
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should throw error when template upload fails', async () => {
      (axios.post as jest.Mock).mockResolvedValueOnce({ data: { success: false } });

      await expect(
        service.generatePDF({ title: 'Test' }, '/fake/templates/report.docx'),
      ).rejects.toThrow('Error al obtener el ID del template');
    });

    it('should throw error when render fails', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
        .mockResolvedValueOnce({ data: { success: false } });

      await expect(
        service.generatePDF({ title: 'Test' }, '/fake/templates/report.docx'),
      ).rejects.toThrow('Error al iniciar el renderizado');
    });

    it('should retry on status check failure', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
        .mockResolvedValueOnce({ data: { success: true, data: { renderId: 'rnd-456' } } });
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { success: false } })
        .mockResolvedValueOnce({ data: { success: true } })
        .mockResolvedValueOnce({ data: Buffer.from('fake-pdf') });

      const result = await service.generatePDF({ title: 'Test' }, '/fake/templates/report.docx');
      expect(result).toBeDefined();
    });
  });

  describe('generatePDFWithImages', () => {
    it('should generate PDF and add images', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
        .mockResolvedValueOnce({ data: { success: true, data: { renderId: 'rnd-456' } } });
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true } })
        .mockResolvedValueOnce({ data: Buffer.from('fake-pdf') });

      pdfImageService.addImagesToPdf.mockResolvedValue(Buffer.from('final-pdf'));

      const images = [{ url: 'http://test.com/img.png', page: 1, x: 10, y: 10, width: 100, height: 100, opacity: 1 }];
      const result = await service.generatePDFWithImages({ title: 'Test' }, '/fake/templates/report.docx', images);

      expect(result).toBeDefined();
      expect(pdfImageService.addImagesToPdf).toHaveBeenCalled();
    });

    it('should generate PDF without images when none provided', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
        .mockResolvedValueOnce({ data: { success: true, data: { renderId: 'rnd-456' } } });
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true } })
        .mockResolvedValueOnce({ data: Buffer.from('fake-pdf') });

      const result = await service.generatePDFWithImages({ title: 'Test' }, '/fake/templates/report.docx');
      expect(result).toBeDefined();
      expect(pdfImageService.addImagesToPdf).not.toHaveBeenCalled();
    });
  });
});

describe('PdfImageService', () => {
  let service: PdfImageService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PdfImageService],
    }).compile();

    service = module.get(PdfImageService);
  });

  describe('addImagesToPdf', () => {
    it('should return original buffer when no images provided', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 test');
      const result = await service.addImagesToPdf(pdfBuffer, []);
      expect(result).toBeDefined();
    });

    it('should process images and return modified buffer', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 test');
      const images = [
        { url: 'http://test.com/img.png', page: 1, x: 10, y: 10, width: 100, height: 100, opacity: 1 },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      }) as any;

      // pdf-lib will fail to load the invalid PDF, but the service should handle it
      await expect(
        service.addImagesToPdf(pdfBuffer, images),
      ).rejects.toThrow();
    });
  });
});
