import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CertificateService } from './certificate.service';

jest.mock('node-forge', () => {
  const mockCert = {
    subject: {
      getField: jest.fn((key: string) => {
        const map: Record<string, string> = {
          CN: 'Test CN',
          O: 'Test Org',
          C: 'EC',
        };
        return map[key] ? { value: map[key] } : null;
      }),
    },
    issuer: {
      getField: jest.fn((key: string) => {
        const map: Record<string, string> = {
          CN: 'Issuer CN',
          O: 'Issuer Org',
        };
        return map[key] ? { value: map[key] } : null;
      }),
    },
    validity: {
      notBefore: new Date('2025-01-01'),
      notAfter: new Date('2027-12-31'),
    },
    serialNumber: 'ABC123',
    extensions: [{ name: 'basicConstraints', cA: false }],
  };

  return {
    util: {
      createBuffer: jest.fn(() => ({ getBytes: () => 'binary-data' })),
    },
    asn1: {
      fromDer: jest.fn(() => 'asn1-mock'),
    },
    pkcs12: {
      pkcs12FromAsn1: jest.fn(() => ({
        safeContents: [
          {
            safeBags: [
              {
                type: '1.2.840.113549.1.12.10.1.3',
                cert: mockCert,
              },
            ],
          },
        ],
      })),
    },
    pki: {
      oids: { certBag: '1.2.840.113549.1.12.10.1.3' },
    },
  };
});

jest.mock('../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    certs: '/fake/certs',
  },
  sanitizeFilename: jest.fn((name: string) => name),
  generateUniqueFilename: jest.fn((name: string) => `123_${name}`),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(() => Buffer.from('fake-p12')),
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

import * as fs from 'fs';
import * as path from 'path';

describe('CertificateService', () => {
  let service: CertificateService;
  const mockCertsDir = '/fake/certs';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [CertificateService],
    }).compile();

    service = module.get(CertificateService);
  });

  describe('certificateExists', () => {
    it('should return true when file exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      expect(service.certificateExists('test.p12')).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(`${mockCertsDir}/test.p12`);
    });

    it('should return false when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(service.certificateExists('missing.p12')).toBe(false);
    });
  });

  describe('getCertificatePath', () => {
    it('should return joined path', () => {
      const result = service.getCertificatePath('cert.p12');
      expect(result).toBe(`${mockCertsDir}/cert.p12`);
    });
  });

  describe('getCertsDir', () => {
    it('should return the certs directory', () => {
      expect(service.getCertsDir()).toBe(mockCertsDir);
    });
  });

  describe('ensureCertificateDirectory', () => {
    it('should create directory when it does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      service.ensureCertificateDirectory();
      expect(fs.mkdirSync).toHaveBeenCalledWith(mockCertsDir, {
        recursive: true,
      });
    });

    it('should not create directory when it already exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      service.ensureCertificateDirectory();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('listCertificates', () => {
    it('should return all certificates without pagination', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'cert1.p12',
        'cert2.p12',
        'readme.txt',
      ]);
      (fs.statSync as jest.Mock).mockImplementation(() => ({
        size: 1024,
        birthtime: new Date('2026-01-01'),
        mtime: new Date('2026-01-02'),
      }));

      const result = service.listCertificates();

      expect(result.certificates).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.pagination).toBeNull();
      expect(result.certificates[0].name).toBe('cert1.p12');
    });

    it('should return empty list when directory does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);

      const result = service.listCertificates();
      expect(result.certificates).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should apply pagination when options provided', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'a.p12',
        'b.p12',
        'c.p12',
        'd.p12',
        'e.p12',
      ]);
      (fs.statSync as jest.Mock).mockImplementation(() => ({
        size: 100,
        birthtime: new Date(),
        mtime: new Date(),
      }));

      const result = service.listCertificates({ page: 2, limit: 2 });

      expect(result.certificates).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 2,
        limit: 2,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: true,
      });
    });

    it('should sort certificates by modifiedAt descending', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['old.p12', 'new.p12']);
      (fs.statSync as jest.Mock)
        .mockReturnValueOnce({
          size: 100,
          birthtime: new Date('2025-01-01'),
          mtime: new Date('2025-01-01'),
        })
        .mockReturnValueOnce({
          size: 200,
          birthtime: new Date('2026-01-01'),
          mtime: new Date('2026-01-01'),
        });

      const result = service.listCertificates();
      expect(result.certificates[0].name).toBe('new.p12');
      expect(result.certificates[1].name).toBe('old.p12');
    });
  });

  describe('deleteCertificate', () => {
    it('should delete an existing certificate', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = service.deleteCertificate('cert.p12');
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalledWith(`${mockCertsDir}/cert.p12`);
    });

    it('should throw BadRequestException for non-p12 filename', () => {
      expect(() => service.deleteCertificate('cert.txt')).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for empty filename', () => {
      expect(() => service.deleteCertificate('')).toThrow(BadRequestException);
    });

    it('should throw NotFoundException when certificate does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(() => service.deleteCertificate('missing.p12')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCertificateInfo', () => {
    it('should return certificate info when file exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 2048,
        birthtime: new Date('2026-01-01'),
        mtime: new Date('2026-01-02'),
      });

      const result = service.getCertificateInfo('cert.p12');

      expect(result.name).toBe('cert.p12');
      expect(result.size).toBe(2048);
      expect(result.path).toBe(`${mockCertsDir}/cert.p12`);
    });

    it('should throw NotFoundException when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(() => service.getCertificateInfo('missing.p12')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('extractP12CertificateInfo', () => {
    it('should throw NotFoundException when certificate file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(() =>
        service.extractP12CertificateInfo('missing.p12', 'pass'),
      ).toThrow(NotFoundException);
    });

    it('should extract certificate info from P12 buffer', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('fake-p12'));

      const result = service.extractP12CertificateInfo(
        'cert.p12',
        'password123',
      );

      expect(result.subject.commonName).toBe('Test CN');
      expect(result.subject.organization).toBe('Test Org');
      expect(result.subject.country).toBe('EC');
      expect(result.issuer.commonName).toBe('Issuer CN');
      expect(result.serialNumber).toBe('ABC123');
      expect(result.isExpired).toBe(false);
    });
  });

  describe('extractCertInfoFromBuffer', () => {
    it('should extract info from a valid P12 buffer', () => {
      const result = service.extractCertInfoFromBuffer(
        Buffer.from('fake'),
        'pass',
      );

      expect(result.subject).toBeDefined();
      expect(result.issuer).toBeDefined();
      expect(result.validity.notBefore).toBeDefined();
      expect(result.validity.notAfter).toBeDefined();
      expect(result.serialNumber).toBe('ABC123');
    });
  });

  describe('validateCertificateExpiry', () => {
    it('should return valid certificate', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('fake-p12'));

      const result = service.validateCertificateExpiry('cert.p12', 'pass');

      expect(result.isValid).toBe(true);
      expect(result.isExpired).toBe(false);
      expect(result.isNotYetValid).toBe(false);
      expect(result.subject.commonName).toBe('Test CN');
    });

    it('should return expired certificate as invalid', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('fake-p12'));

      // Mock date to be after expiry
      jest.useFakeTimers({ now: new Date('2028-01-01') });

      const result = service.validateCertificateExpiry('cert.p12', 'pass');

      expect(result.isValid).toBe(false);
      expect(result.isExpired).toBe(true);
      expect(result.reason).toContain('expirado');

      jest.useRealTimers();
    });

    it('should return warning when certificate expires within 30 days', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('fake-p12'));

      // Mock date to be 15 days before expiry (2027-12-31)
      jest.useFakeTimers({ now: new Date('2027-12-16') });

      const result = service.validateCertificateExpiry('cert.p12', 'pass');

      expect(result.isValid).toBe(true);
      expect(result.warning).toContain('expira en');
      expect(result.daysUntilExpiry).toBeLessThanOrEqual(30);

      jest.useRealTimers();
    });
  });
});
