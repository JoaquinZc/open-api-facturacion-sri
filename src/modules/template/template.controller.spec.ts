import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

jest.mock('../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    templates: '/fake/templates',
  },
  sanitizeFilename: jest.fn((name: string) => name.replace(/\s/g, '_')),
}));

describe('TemplateController', () => {
  let controller: TemplateController;
  let templateService: {
    listTemplatesWithMetadata: jest.Mock;
    getTemplateInfo: jest.Mock;
    templateExists: jest.Mock;
    deleteTemplate: jest.Mock;
    findTemplate: jest.Mock;
  };
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    templateService = {
      listTemplatesWithMetadata: jest.fn(() => [
        {
          id: 'report',
          name: 'report.docx',
          extension: '.docx',
          size: 1024,
          sizeFormatted: '1 KB',
          isSupported: true,
          modifiedAt: new Date('2025-01-01'),
        },
        {
          id: 'invoice',
          name: 'invoice.odt',
          extension: '.odt',
          size: 2048,
          sizeFormatted: '2 KB',
          isSupported: true,
          modifiedAt: new Date('2025-01-02'),
        },
      ]),
      getTemplateInfo: jest.fn((name: string) => ({
        id: name.replace(/\.[^.]+$/, ''),
        name,
        extension: '.docx',
        size: 1024,
        sizeFormatted: '1 KB',
      })),
      templateExists: jest.fn(() => true),
      deleteTemplate: jest.fn(),
      findTemplate: jest.fn((id: string) => `/fake/templates/${id}.docx`),
    };
    eventEmitter = { emit: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [TemplateController],
      providers: [
        { provide: TemplateService, useValue: templateService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    controller = module.get(TemplateController);
  });

  describe('listTemplates', () => {
    it('should return templates with summary', () => {
      const result = controller.listTemplates();

      expect(result.success).toBe(true);
      expect(result.data.templates).toHaveLength(2);
      expect(result.data.count).toBe(2);
      expect(result.data.summary.totalTemplates).toBe(2);
      expect(result.data.summary.supportedFormats).toBe(2);
      expect(result.data.summary.totalSize).toBe(3072);
    });

    it('should handle empty templates list', () => {
      templateService.listTemplatesWithMetadata.mockReturnValue([]);
      const result = controller.listTemplates();

      expect(result.data.count).toBe(0);
      expect(result.data.summary.lastModified).toBeNull();
    });
  });

  describe('uploadTemplate', () => {
    it('should throw BadRequestException when no file provided', () => {
      expect(() => controller.uploadTemplate(undefined as any)).toThrow(
        BadRequestException,
      );
    });

    it('should upload template and emit event', () => {
      const file = {
        filename: 'report.docx',
        size: 1024,
        originalname: 'report.docx',
      } as Express.Multer.File;
      const result = controller.uploadTemplate(file);

      expect(result.success).toBe(true);
      expect(result.data.template.name).toBe('report.docx');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'plantilla.creada',
        expect.any(Object),
      );
    });
  });

  describe('deleteTemplate', () => {
    it('should throw BadRequestException when no id provided', () => {
      expect(() => controller.deleteTemplate('')).toThrow(BadRequestException);
    });

    it('should throw NotFoundException when template does not exist', () => {
      templateService.templateExists.mockReturnValue(false);
      expect(() => controller.deleteTemplate('notfound')).toThrow(
        NotFoundException,
      );
    });

    it('should delete template and emit event', () => {
      const result = controller.deleteTemplate('report');

      expect(result.success).toBe(true);
      expect(templateService.deleteTemplate).toHaveBeenCalledWith('report');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'plantilla.eliminada',
        expect.any(Object),
      );
    });
  });
});
