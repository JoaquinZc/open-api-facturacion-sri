import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentController } from './document.controller';
import {
  DocumentService,
  SUPPORTED_FORMATS,
  MIME_TYPES,
} from './document.service';
import { TemplateService } from '../template/template.service';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  basename: jest.fn((f: string) => f.split('/').pop()),
}));

jest.mock('../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    pdfs: '/fake/pdfs',
  },
}));

jest.mock('../../common/utils/file.utils', () => ({
  formatFileSize: jest.fn((bytes: number) => `${bytes} bytes`),
}));

describe('DocumentController', () => {
  let controller: DocumentController;
  let documentService: { generateDocument: jest.Mock; getMimeType: jest.Mock };
  let templateService: { findTemplate: jest.Mock };
  let configService: { get: jest.Mock };
  let mockResponse: any;

  beforeEach(async () => {
    documentService = {
      generateDocument: jest.fn().mockResolvedValue(Buffer.from('fake-doc')),
      getMimeType: jest.fn(
        (format: string) => MIME_TYPES[format] || 'application/octet-stream',
      ),
    };
    templateService = {
      findTemplate: jest.fn((id: string) => `/fake/templates/${id}.docx`),
    };
    configService = { get: jest.fn((key: string) => 'http://test.com') };

    const module = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        { provide: DocumentService, useValue: documentService },
        { provide: TemplateService, useValue: templateService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get(DocumentController);

    mockResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };
  });

  describe('getSupportedFormats', () => {
    it('should return supported formats and MIME types', () => {
      const result = controller.getSupportedFormats();

      expect(result.success).toBe(true);
      expect(result.data.formats).toEqual(SUPPORTED_FORMATS);
      expect(result.data.mimeTypes).toEqual(MIME_TYPES);
    });
  });

  describe('generateDocumentAndDownload', () => {
    it('should throw BadRequestException when no JSON data provided', async () => {
      await expect(
        controller.generateDocumentAndDownload(
          'tpl',
          {} as any,
          mockResponse,
          'pdf',
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no format specified', async () => {
      await expect(
        controller.generateDocumentAndDownload(
          'tpl',
          { title: 'Test' },
          mockResponse,
          undefined,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate and download document with header format', async () => {
      await controller.generateDocumentAndDownload(
        'tpl',
        { title: 'Test' },
        mockResponse,
        'pdf',
        undefined,
      );

      expect(templateService.findTemplate).toHaveBeenCalledWith('tpl');
      expect(documentService.generateDocument).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should use query format when header format not provided', async () => {
      await controller.generateDocumentAndDownload(
        'tpl',
        { title: 'Test' },
        mockResponse,
        undefined,
        'docx',
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    });

    it('should use body.format as fallback', async () => {
      await controller.generateDocumentAndDownload(
        'tpl',
        { jsonData: { title: 'Test' }, format: 'pdf' },
        mockResponse,
        undefined,
        undefined,
      );

      expect(documentService.generateDocument).toHaveBeenCalledWith(
        { title: 'Test' },
        expect.any(String),
        'pdf',
      );
    });
  });

  describe('generateDocumentAndSave', () => {
    it('should throw BadRequestException when no JSON data provided', async () => {
      await expect(
        controller.generateDocumentAndSave(
          'tpl',
          {} as any,
          undefined,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no format specified', async () => {
      await expect(
        controller.generateDocumentAndSave(
          'tpl',
          { title: 'Test' },
          undefined,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate, save and return file info', async () => {
      const result = await controller.generateDocumentAndSave(
        'tpl',
        { title: 'Test' },
        'pdf',
        undefined,
      );

      expect(result.success).toBe(true);
      expect(result.data.fileName).toMatch(/^documento_\d+\.pdf$/);
      expect(result.data.fileUrl).toContain('/pdfs/documents/');
      expect(result.data.format).toBe('pdf');
    });
  });
});
