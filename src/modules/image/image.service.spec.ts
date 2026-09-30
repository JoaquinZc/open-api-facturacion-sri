import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { ImageService } from './image.service';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  extname: jest.fn((f: string) => {
    const i = f.lastIndexOf('.');
    return i > 0 ? f.substring(i) : '';
  }),
}));

jest.mock('../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    pdfsImages: '/fake/pdfs/images',
  },
}));

jest.mock('../../common/utils/file.utils', () => ({
  formatFileSize: jest.fn((size: number) => `${size} B`),
}));

import * as fs from 'fs';

describe('ImageService', () => {
  let service: ImageService;
  const mockImagesDir = '/fake/pdfs/images';

  beforeEach(async () => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const module = await Test.createTestingModule({
      providers: [
        ImageService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'http://localhost:3001') },
        },
      ],
    }).compile();

    service = module.get(ImageService);
  });

  describe('getImagesDir', () => {
    it('should return the images directory', () => {
      expect(service.getImagesDir()).toBe(mockImagesDir);
    });
  });

  describe('listImages', () => {
    it('should return images with metadata', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'logo.png',
        'banner.jpg',
        'readme.txt',
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 51200,
        birthtime: new Date('2026-01-01'),
        mtime: new Date('2026-01-02'),
      });

      const result = service.listImages();

      expect(result.images).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.images[0].name).toBe('logo.png');
    });

    it('should filter only valid image extensions', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'a.png',
        'b.jpg',
        'c.jpeg',
        'd.gif',
        'e.webp',
        'f.txt',
        'g.pdf',
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        birthtime: new Date(),
        mtime: new Date(),
      });

      const result = service.listImages();
      expect(result.images).toHaveLength(5);
    });

    it('should return empty list when directory does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);

      const result = service.listImages();
      expect(result.images).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should apply pagination', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'a.png',
        'b.png',
        'c.png',
        'd.png',
        'e.png',
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 100,
        birthtime: new Date(),
        mtime: new Date(),
      });

      const result = service.listImages({ page: 1, limit: 2 });
      expect(result.images).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.pagination).toBeDefined();
      expect(result.pagination!.totalPages).toBe(3);
    });
  });

  describe('deleteImage', () => {
    it('should delete an existing image', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = service.deleteImage('logo.png');
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should throw NotFoundException when image does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(() => service.deleteImage('missing.png')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('buildImageUrl', () => {
    it('should build a URL for an image', () => {
      const url = service.buildImageUrl('logo.png');
      expect(url).toContain('logo.png');
    });
  });
});
