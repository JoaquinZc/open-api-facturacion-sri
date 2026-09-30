import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TemplateService } from './template.service';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  resolve: jest.fn((...args: string[]) => args.join('/')),
  extname: jest.fn((f: string) => {
    const i = f.lastIndexOf('.');
    return i > 0 ? f.substring(i) : '';
  }),
  parse: jest.fn((f: string) => ({ name: f.replace(/\.\w+$/, ''), ext: '' })),
}));

jest.mock('../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    templates: '/fake/templates',
  },
}));

jest.mock('../../common/utils/file.utils', () => ({
  formatFileSize: jest.fn((size: number) => `${size} B`),
}));

import * as fs from 'fs';

describe('TemplateService', () => {
  let service: TemplateService;
  const mockTemplatesDir = '/fake/templates';

  beforeEach(async () => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const module = await Test.createTestingModule({
      providers: [TemplateService],
    }).compile();

    service = module.get(TemplateService);
  });

  describe('getTemplatesDir', () => {
    it('should return the templates directory', () => {
      expect(service.getTemplatesDir()).toBe(mockTemplatesDir);
    });
  });

  describe('getSupportedFormats', () => {
    it('should return supported formats array', () => {
      const formats = service.getSupportedFormats();
      expect(formats).toContain('.docx');
      expect(formats).toContain('.odt');
      expect(formats).toContain('.html');
      expect(formats).toContain('.xlsx');
      expect(formats).toContain('.ods');
    });
  });

  describe('listTemplatesWithMetadata', () => {
    it('should return templates with metadata', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'report.docx',
        'invoice.odt',
        'readme.txt',
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        birthtime: new Date('2026-01-01'),
        mtime: new Date('2026-01-02'),
      });

      const result = service.listTemplatesWithMetadata();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('report');
      expect(result[0].extension).toBe('.docx');
    });

    it('should return empty list when directory does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);

      const result = service.listTemplatesWithMetadata();
      expect(result).toHaveLength(0);
    });
  });

  describe('templateExists', () => {
    it('should return true when template exists', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'report.docx',
        'other.odt',
      ]);
      expect(service.templateExists('report')).toBe(true);
    });

    it('should return false when template does not exist', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['other.odt']);
      expect(service.templateExists('missing')).toBe(false);
    });

    it('should return false when directory does not exist', () => {
      (fs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(service.templateExists('report')).toBe(false);
    });
  });

  describe('findTemplate', () => {
    it('should return template filename when found', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['report.docx']);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 2048,
        birthtime: new Date('2026-01-01'),
        mtime: new Date('2026-01-02'),
      });

      const result = service.findTemplate('report');
      expect(result).toBeDefined();
      expect(result).toContain('report');
    });

    it('should throw NotFoundException when template not found', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['other.docx']);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        birthtime: new Date(),
        mtime: new Date(),
      });

      expect(() => service.findTemplate('report')).toThrow(NotFoundException);
    });
  });

  describe('deleteTemplate', () => {
    it('should delete an existing template', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['report.docx']);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        birthtime: new Date(),
        mtime: new Date(),
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = service.deleteTemplate('report');
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should throw NotFoundException when template does not exist', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['other.docx']);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        birthtime: new Date(),
        mtime: new Date(),
      });

      expect(() => service.deleteTemplate('report')).toThrow(NotFoundException);
    });
  });

  describe('getTemplateInfo', () => {
    it('should return info for a template file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 4096,
        birthtime: new Date('2026-01-01'),
        mtime: new Date('2026-01-02'),
      });

      const result = service.getTemplateInfo('report.docx');
      expect(result.size).toBe(4096);
      expect(result.name).toBe('report.docx');
      expect(result.id).toBe('report');
      expect(result.extension).toBe('.docx');
    });

    it('should throw NotFoundException when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(() => service.getTemplateInfo('missing.docx')).toThrow(
        NotFoundException,
      );
    });
  });
});
