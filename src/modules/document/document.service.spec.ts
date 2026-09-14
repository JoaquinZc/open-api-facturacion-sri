import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from './document.service';

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

jest.mock('fs', () => ({
  createReadStream: jest.fn(() => ({ path: '/fake/templates/report.docx' })),
}));

jest.mock('path', () => ({
  basename: jest.fn((f: string) => f.split('/').pop()),
  join: jest.fn((...args: string[]) => args.join('/')),
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
    pdfsDocuments: '/fake/pdfs/documents',
  },
}));

import axios from 'axios';
import { createReadStream } from 'fs';

describe('DocumentService', () => {
  let service: DocumentService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
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
        DocumentService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(DocumentService);
  });

  describe('getSupportedFormats', () => {
    it('should return supported formats array', () => {
      const formats = service.getSupportedFormats();
      expect(formats).toContain('pdf');
      expect(formats).toContain('docx');
      expect(formats).toContain('odt');
      expect(formats).toContain('xlsx');
      expect(formats).toContain('html');
    });
  });

  describe('getMimeTypes', () => {
    it('should return MIME types mapping', () => {
      const mimes = service.getMimeTypes();
      expect(mimes['pdf']).toBe('application/pdf');
      expect(mimes['docx']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });
  });

  describe('getMimeType', () => {
    it('should return correct MIME type for known format', () => {
      expect(service.getMimeType('pdf')).toBe('application/pdf');
      expect(service.getMimeType('docx')).toContain('wordprocessingml');
    });

    it('should return application/octet-stream for unknown format', () => {
      expect(service.getMimeType('unknown')).toBe('application/octet-stream');
    });
  });

  describe('generateDocument', () => {
    it('should generate document via Carbone API', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
        .mockResolvedValueOnce({ data: { success: true, data: { renderId: 'rnd-456' } } });
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true } })
        .mockResolvedValueOnce({ data: Buffer.from('fake-doc') });

      const result = await service.generateDocument(
        { title: 'Test' },
        '/fake/templates/report.docx',
        'pdf',
      );

      expect(result).toBeDefined();
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should throw error for unsupported format', async () => {
      await expect(
        service.generateDocument({ title: 'Test' }, '/fake/templates/report.docx', 'xyz'),
      ).rejects.toThrow();
    });

    it('should retry the template upload with a fresh stream while Carbone wakes up', async () => {
      jest.useFakeTimers();
      (createReadStream as jest.Mock).mockClear();
      try {
        (axios.post as jest.Mock)
          .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
          .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
          .mockResolvedValueOnce({ data: { success: true, data: { renderId: 'rnd-456' } } });
        (axios.get as jest.Mock)
          .mockResolvedValueOnce({ data: { success: true } })
          .mockResolvedValueOnce({ data: Buffer.from('fake-doc') });

        const doc = service.generateDocument({ title: 'Test' }, '/fake/templates/report.docx', 'pdf');
        await jest.advanceTimersByTimeAsync(1000);

        await expect(doc).resolves.toBeDefined();
        // Un flujo solo se lee una vez: el reintento tiene que abrir otro.
        expect(createReadStream).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should throw error when template upload fails', async () => {
      (axios.post as jest.Mock).mockResolvedValueOnce({ data: { success: false } });

      await expect(
        service.generateDocument({ title: 'Test' }, '/fake/templates/report.docx', 'pdf'),
      ).rejects.toThrow();
    });

    it('should retry on status check failure', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
        .mockResolvedValueOnce({ data: { success: true, data: { renderId: 'rnd-456' } } });
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { success: false } })
        .mockResolvedValueOnce({ data: { success: true } })
        .mockResolvedValueOnce({ data: Buffer.from('fake-doc') });

      const result = await service.generateDocument(
        { title: 'Test' },
        '/fake/templates/report.docx',
        'pdf',
      );
      expect(result).toBeDefined();
    });

    it('should throw timeout when status never succeeds', async () => {
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { success: true, data: { templateId: 'tpl-123' } } })
        .mockResolvedValueOnce({ data: { success: true, data: { renderId: 'rnd-456' } } });
      (axios.get as jest.Mock).mockResolvedValue({ data: { success: false } });

      await expect(
        service.generateDocument({ title: 'Test' }, '/fake/templates/report.docx', 'pdf'),
      ).rejects.toThrow('Tiempo de espera agotado');
    });
  });
});
