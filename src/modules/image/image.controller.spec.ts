import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';

jest.mock('../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    pdfsImages: '/fake/pdfs/images',
  },
  sanitizeFilename: jest.fn((name: string) => name.replace(/\s/g, '_')),
}));

jest.mock('../../common/utils/file.utils', () => ({
  formatFileSize: jest.fn((bytes: number) => `${bytes} bytes`),
}));

describe('ImageController', () => {
  let controller: ImageController;
  let imageService: {
    buildImageUrl: jest.Mock;
    listImages: jest.Mock;
    deleteImage: jest.Mock;
  };

  beforeEach(async () => {
    imageService = {
      buildImageUrl: jest.fn(
        (name: string) => `http://test.com/images/${name}`,
      ),
      listImages: jest.fn(() => ({
        images: [{ name: 'img1.png', size: 1024, createdAt: new Date() }],
        total: 1,
        pagination: { page: 1, limit: 20, totalPages: 1 },
      })),
      deleteImage: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [ImageController],
      providers: [{ provide: ImageService, useValue: imageService }],
    }).compile();

    controller = module.get(ImageController);
  });

  describe('uploadImage', () => {
    it('should throw BadRequestException when no file provided', () => {
      expect(() => controller.uploadImage(undefined as any)).toThrow(
        BadRequestException,
      );
    });

    it('should return upload result when file is provided', () => {
      const file = {
        filename: 'test.png',
        size: 1024,
        mimetype: 'image/png',
      } as Express.Multer.File;
      const result = controller.uploadImage(file);

      expect(result.success).toBe(true);
      expect(result.data.fileName).toBe('test.png');
      expect(result.data.fileUrl).toBe('http://test.com/images/test.png');
      expect(imageService.buildImageUrl).toHaveBeenCalledWith('test.png');
    });
  });

  describe('listImages', () => {
    it('should list images with default options', () => {
      const result = controller.listImages();

      expect(result.success).toBe(true);
      expect(result.data.images).toHaveLength(1);
      expect(result.data.total).toBe(1);
      expect(imageService.listImages).toHaveBeenCalledWith({});
    });

    it('should list images with pagination options', () => {
      controller.listImages('2', '10');

      expect(imageService.listImages).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
      });
    });
  });

  describe('deleteImage', () => {
    it('should throw BadRequestException when no fileName provided', () => {
      expect(() => controller.deleteImage('')).toThrow(BadRequestException);
    });

    it('should delete image and return success', () => {
      const result = controller.deleteImage('test.png');

      expect(result.success).toBe(true);
      expect(result.data.message).toContain('test.png');
      expect(imageService.deleteImage).toHaveBeenCalledWith('test.png');
    });
  });
});
