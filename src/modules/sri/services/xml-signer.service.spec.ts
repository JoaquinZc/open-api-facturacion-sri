import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { XmlSignerService } from './xml-signer.service';
import { DatabaseService } from '../../../database';
import { EncryptionService } from '../../../common/services/encryption.service';

// ── Mocks de módulos externos ──────────────────────────────────

jest.mock('node-forge', () => {
  const mockPrivateKey = { n: 1, e: 2, d: 3 };
  const mockCert = {
    extensions: [{ name: 'basicConstraints', cA: false }],
  };
  const mockCaCert = {
    extensions: [{ name: 'basicConstraints', cA: true }],
  };

  return {
    util: {
      createBuffer: jest.fn(() => ({ getBytes: () => 'binary-data' })),
      encode64: jest.fn((data: string) => Buffer.from(data).toString('base64')),
    },
    asn1: {
      fromDer: jest.fn(() => 'asn1-mock'),
      toDer: jest.fn(() => ({ getBytes: () => 'der-bytes' })),
      certificateToAsn1: jest.fn(() => 'cert-asn1'),
    },
    pkcs12: {
      pkcs12FromAsn1: jest.fn(() => ({
        safeContents: [
          {
            safeBags: [
              { type: '1.2.840.113549.1.12.10.1.2', key: mockPrivateKey },
              { type: '1.2.840.113549.1.12.10.1.3', cert: mockCert },
              { type: '1.2.840.113549.1.12.10.1.3', cert: mockCaCert },
            ],
          },
        ],
      })),
    },
    pki: {
      oids: {
        pkcs8ShroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
        certBag: '1.2.840.113549.1.12.10.1.3',
      },
      privateKeyToPem: jest.fn(
        () =>
          '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKjQ\n-----END RSA PRIVATE KEY-----',
      ),
      privateKeyFromPem: jest.fn(() => mockPrivateKey),
      privateKeyToAsn1: jest.fn(() => 'priv-asn1'),
      wrapRsaPrivateKey: jest.fn(() => 'wrapped-key'),
      privateKeyInfoToPem: jest.fn(
        () =>
          '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADAN\n-----END PRIVATE KEY-----',
      ),
      certificateToAsn1: jest.fn(() => 'cert-asn1'),
    },
  };
});

jest.mock('xadesjs', () => {
  const mockSignedXmlInstance = {
    Sign: jest.fn().mockResolvedValue({
      GetXml: jest.fn(() => ({
        ownerDocument: {},
        nodeName: 'ds:Signature',
      })),
    }),
  };
  return {
    Application: {
      setEngine: jest.fn(),
    },
    SignedXml: jest.fn(() => mockSignedXmlInstance),
  };
});

jest.mock('xml-core', () => ({
  setNodeDependencies: jest.fn(),
}));

jest.mock('xmldom', () => {
  const mockElement = {
    hasAttribute: jest.fn(() => true),
    getAttribute: jest.fn((attr: string) =>
      attr === 'Id' ? 'comprobante' : '',
    ),
    setAttribute: jest.fn(),
    appendChild: jest.fn(),
    nodeName: 'factura',
  };
  return {
    DOMParser: jest.fn(() => ({
      parseFromString: jest.fn(() => ({
        documentElement: mockElement,
      })),
    })),
    XMLSerializer: jest.fn(() => ({
      serializeToString: jest.fn(
        () => '<factura Id="comprobante"><ds:Signature/></factura>',
      ),
    })),
  };
});

jest.mock('@peculiar/webcrypto', () => ({
  Crypto: jest.fn(() => ({
    subtle: {
      importKey: jest.fn().mockResolvedValue({
        type: 'private',
        algorithm: { name: 'RSASSA-PKCS1-v1_5' },
      }),
    },
  })),
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => Buffer.from('fake-p12-content')),
  existsSync: jest.fn(() => true),
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  resolve: jest.fn((p: string) => p),
  join: jest.fn((...args: string[]) => args.join('/')),
}));

jest.mock('../../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    certs: '/fake/certs',
  },
}));

// ── Test Suite ─────────────────────────────────────────────────

describe('XmlSignerService', () => {
  let service: XmlSignerService;
  let configService: jest.Mocked<ConfigService>;
  let db: jest.Mocked<DatabaseService>;
  let encryptionService: jest.Mocked<EncryptionService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        XmlSignerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'CACHE_CERT_TTL_MS') return 3600000;
              if (key === 'directories.certs') return '/fake/certs';
              return defaultValue;
            }),
          },
        },
        {
          provide: DatabaseService,
          useValue: {
            queryOne: jest.fn(),
          },
        },
        {
          provide: EncryptionService,
          useValue: {
            decrypt: jest.fn().mockResolvedValue('decrypted-password'),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<XmlSignerService>(XmlSignerService);
    configService = moduleRef.get(ConfigService);
    db = moduleRef.get(DatabaseService);
    encryptionService = moduleRef.get(EncryptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── onModuleInit ──────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('debe inicializar sin cargar certificado global', () => {
      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  // ── isCertificateLoaded ───────────────────────────────────────

  describe('isCertificateLoaded', () => {
    it('debe retornar false cuando no hay certificado cargado', () => {
      expect(service.isCertificateLoaded()).toBe(false);
    });

    it('debe retornar true despues de cargar certificado desde buffer', async () => {
      await service.loadCertificateFromBuffer(
        Buffer.from('fake-p12'),
        'password123',
      );
      expect(service.isCertificateLoaded()).toBe(true);
    });
  });

  // ── loadCertificateFromBuffer ─────────────────────────────────

  describe('loadCertificateFromBuffer', () => {
    it('debe cargar certificado P12 desde buffer correctamente', async () => {
      await service.loadCertificateFromBuffer(
        Buffer.from('fake-p12'),
        'password123',
      );
      expect(service.isCertificateLoaded()).toBe(true);
    });

    it('debe lanzar error cuando no se encuentra clave privada o certificado', async () => {
      const forge = require('node-forge');
      forge.pkcs12.pkcs12FromAsn1.mockReturnValueOnce({
        safeContents: [
          {
            safeBags: [],
          },
        ],
      });

      await expect(
        service.loadCertificateFromBuffer(Buffer.from('bad-p12'), 'pass'),
      ).rejects.toThrow(
        'No se encontró clave privada o certificado en el archivo P12',
      );
    });
  });

  // ── loadCertificate (from filesystem) ─────────────────────────

  describe('loadCertificate', () => {
    it('debe cargar certificado desde filesystem', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from('fake-p12-content'));

      await service.loadCertificate('/fake/certs/cert.p12', 'password');
      expect(service.isCertificateLoaded()).toBe(true);
    });

    it('debe lanzar error cuando el archivo no existe', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      await expect(
        service.loadCertificate('/fake/certs/missing.p12', 'password'),
      ).rejects.toThrow('El archivo de certificado no existe');
    });

    it('debe lanzar error cuando la ruta esta fuera del directorio de certificados', async () => {
      const path = require('path');
      const actualPath = jest.requireActual('path');
      path.resolve.mockImplementation((p: string) => {
        if (p === '/other/dir/cert.p12') return '/other/dir/cert.p12';
        return actualPath.resolve(p);
      });

      await expect(
        service.loadCertificate('/other/dir/cert.p12', 'password'),
      ).rejects.toThrow('Ruta de certificado inválida o no permitida');

      path.resolve.mockImplementation((p: string) => p);
    });
  });

  // ── signXml (deprecated global) ───────────────────────────────

  describe('signXml', () => {
    it('debe firmar XML cuando hay certificado global cargado', async () => {
      await service.loadCertificateFromBuffer(Buffer.from('fake-p12'), 'pass');
      const result = await service.signXml(
        '<factura Id="comprobante"></factura>',
      );
      expect(result).toContain('<ds:Signature/>');
    });

    it('debe lanzar error cuando no hay certificado global cargado', async () => {
      await expect(service.signXml('<factura></factura>')).rejects.toThrow(
        'No hay certificado cargado',
      );
    });
  });

  // ── loadEmisorCertificate ─────────────────────────────────────

  describe('loadEmisorCertificate', () => {
    const mockEmisor = {
      certificado_nombre: 'certificado_test.p12',
      certificado_password_encrypted: 'encrypted:password',
    };

    it('debe cargar certificado desde BD y cachearlo', async () => {
      db.queryOne.mockResolvedValue(mockEmisor as any);
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from('fake-p12'));

      const result = await service.loadEmisorCertificate('0924383631001');
      expect(result.privateKey).toBeDefined();
      expect(result.certificate).toBeDefined();
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('FROM emisores'),
        ['0924383631001'],
      );
      expect(encryptionService.decrypt).toHaveBeenCalledWith(
        'encrypted:password',
      );
    });

    it('debe retornar certificado desde cache en segunda llamada', async () => {
      db.queryOne.mockResolvedValue(mockEmisor as any);
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from('fake-p12'));

      await service.loadEmisorCertificate('0924383631001');
      await service.loadEmisorCertificate('0924383631001');

      expect(db.queryOne).toHaveBeenCalledTimes(1);
    });

    it('debe lanzar error cuando el emisor no tiene certificado configurado', async () => {
      db.queryOne.mockResolvedValue(null as any);

      await expect(
        service.loadEmisorCertificate('0924383631001'),
      ).rejects.toThrow('no tiene certificado configurado');
    });

    it('debe lanzar error cuando el emisor no tiene certificado_nombre', async () => {
      db.queryOne.mockResolvedValue({
        certificado_nombre: null,
        certificado_password_encrypted: 'encrypted',
      } as any);

      await expect(
        service.loadEmisorCertificate('0924383631001'),
      ).rejects.toThrow('no tiene certificado configurado');
    });

    it('debe lanzar error cuando el archivo del certificado no existe en filesystem', async () => {
      db.queryOne.mockResolvedValue(mockEmisor as any);
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      await expect(
        service.loadEmisorCertificate('0924383631001'),
      ).rejects.toThrow('no existe en el servidor');
    });

    it('debe recargar certificado cuando el cache ha expirado', async () => {
      db.queryOne.mockResolvedValue(mockEmisor as any);
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from('fake-p12'));

      // Primera carga
      await service.loadEmisorCertificate('0924383631001');

      // Simular expiración de cache modificando el timestamp
      const cached = (service as any).emisorCertificateCache.get(
        '0924383631001',
      );
      cached.loadedAt = Date.now() - 4000000; // > TTL (1h)

      // Segunda carga debe recargar
      await service.loadEmisorCertificate('0924383631001');
      expect(db.queryOne).toHaveBeenCalledTimes(2);
    });
  });

  // ── signXmlForEmisor ──────────────────────────────────────────

  describe('signXmlForEmisor', () => {
    it('debe firmar XML usando certificado del emisor desde BD', async () => {
      db.queryOne.mockResolvedValue({
        certificado_nombre: 'cert.p12',
        certificado_password_encrypted: 'encrypted',
      } as any);
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from('fake-p12'));

      const result = await service.signXmlForEmisor(
        '<factura Id="comprobante"></factura>',
        '0924383631001',
      );
      expect(result).toContain('<factura');
    });

    it('debe lanzar error cuando el XML no tiene elemento raiz', async () => {
      db.queryOne.mockResolvedValue({
        certificado_nombre: 'cert.p12',
        certificado_password_encrypted: 'encrypted',
      } as any);
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from('fake-p12'));

      const xmldom = require('xmldom');
      xmldom.DOMParser.mockImplementationOnce(() => ({
        parseFromString: jest.fn(() => ({ documentElement: null })),
      }));

      await expect(
        service.signXmlForEmisor('<empty></empty>', '0924383631001'),
      ).rejects.toThrow('El documento XML no tiene un elemento raíz');
    });
  });

  // ── Cache management ──────────────────────────────────────────

  describe('clearEmisorCache', () => {
    it('debe limpiar cache de un emisor especifico', async () => {
      db.queryOne.mockResolvedValue({
        certificado_nombre: 'cert.p12',
        certificado_password_encrypted: 'encrypted',
      } as any);
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from('fake-p12'));

      await service.loadEmisorCertificate('0924383631001');
      service.clearEmisorCache('0924383631001');

      // Segunda llamada debe ir a BD de nuevo
      await service.loadEmisorCertificate('0924383631001');
      expect(db.queryOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearAllCache', () => {
    it('debe limpiar cache de todos los emisores', async () => {
      db.queryOne.mockResolvedValue({
        certificado_nombre: 'cert.p12',
        certificado_password_encrypted: 'encrypted',
      } as any);
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(Buffer.from('fake-p12'));

      await service.loadEmisorCertificate('0924383631001');
      await service.loadEmisorCertificate('0991234567001');

      service.clearAllCache();

      await service.loadEmisorCertificate('0924383631001');
      await service.loadEmisorCertificate('0991234567001');

      expect(db.queryOne).toHaveBeenCalledTimes(4);
    });
  });

  // ── clearGlobalCertificate (deprecated) ───────────────────────

  describe('clearGlobalCertificate', () => {
    it('debe limpiar certificado global de memoria', async () => {
      await service.loadCertificateFromBuffer(Buffer.from('fake-p12'), 'pass');
      expect(service.isCertificateLoaded()).toBe(true);

      service.clearGlobalCertificate();
      expect(service.isCertificateLoaded()).toBe(false);
    });
  });
});
