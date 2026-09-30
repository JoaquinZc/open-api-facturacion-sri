import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RealtimeService } from './realtime.service';
import { UserRole } from '../auth/dto/auth.dto';

describe('RealtimeService', () => {
  let service: RealtimeService;
  let jwtService: { verify: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    jwtService = {
      verify: jest.fn((token: string) => {
        if (token === 'valid-token') {
          return {
            sub: 'user-1',
            email: 'test@test.com',
            rol: UserRole.USER,
            tenantId: 'tenant-1',
          };
        }
        throw new Error('Invalid token');
      }),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'jwt.secret') return 'test-secret';
        return undefined;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        RealtimeService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(RealtimeService);
  });

  describe('validateToken', () => {
    it('should return payload for valid token', () => {
      const result = service.validateToken('valid-token');
      expect(result).toBeDefined();
      expect(result!.sub).toBe('user-1');
      expect(result!.tenantId).toBe('tenant-1');
    });

    it('should return null for invalid token', () => {
      const result = service.validateToken('invalid-token');
      expect(result).toBeNull();
    });
  });

  describe('createConnection', () => {
    it('should create a connection and return observable', () => {
      const payload = {
        sub: 'user-1',
        email: 'test@test.com',
        rol: UserRole.USER,
        tenantId: 'tenant-1',
      };
      const observable = service.createConnection('client-1', payload);
      expect(observable).toBeDefined();
    });

    it('should allow multiple connections', () => {
      const payload = {
        sub: 'user-2',
        email: 'test2@test.com',
        rol: UserRole.ADMIN,
        tenantId: 'tenant-2',
      };
      service.createConnection('client-1', {
        sub: 'u1',
        email: 'e',
        rol: UserRole.USER,
        tenantId: 't1',
      });
      service.createConnection('client-2', payload);
    });
  });

  describe('removeConnection', () => {
    it('should remove an existing connection', () => {
      const payload = {
        sub: 'user-1',
        email: 'test@test.com',
        rol: UserRole.USER,
        tenantId: 'tenant-1',
      };
      service.createConnection('client-1', payload);
      service.removeConnection('client-1');
    });

    it('should not throw when removing non-existent connection', () => {
      expect(() => service.removeConnection('non-existent')).not.toThrow();
    });
  });

  describe('event handlers', () => {
    it('should broadcast comprobante.autorizado event', () => {
      const payload = {
        sub: 'user-1',
        email: 'test@test.com',
        rol: UserRole.USER,
        tenantId: 'tenant-1',
      };
      service.createConnection('client-1', payload);

      expect(() =>
        service.handleComprobanteAutorizado({
          claveAcceso: '1234567890123456789012345678901234567890123456789',
          estado: 'AUTORIZADO',
          tenantId: 'tenant-1',
        }),
      ).not.toThrow();
    });

    it('should broadcast comprobante.rechazado event', () => {
      expect(() =>
        service.handleComprobanteRechazado({
          claveAcceso: '1234567890123456789012345678901234567890123456789',
          estado: 'RECHAZADO',
          tenantId: 'tenant-1',
        }),
      ).not.toThrow();
    });

    it('should broadcast comprobante.creado event', () => {
      expect(() =>
        service.handleComprobanteCreado({
          claveAcceso: '1234567890123456789012345678901234567890123456789',
          estado: 'PENDIENTE',
          tenantId: 'tenant-1',
        }),
      ).not.toThrow();
    });

    it('should broadcast comprobante.anulado event', () => {
      expect(() =>
        service.handleComprobanteAnulado({
          claveAcceso: '1234567890123456789012345678901234567890123456789',
          tenantId: 'tenant-1',
        }),
      ).not.toThrow();
    });

    it('should broadcast plantilla.creada event', () => {
      expect(() =>
        service.handlePlantillaCreada({ templateId: 'report' }),
      ).not.toThrow();
    });

    it('should broadcast plantilla.eliminada event', () => {
      expect(() =>
        service.handlePlantillaEliminada({ templateId: 'report' }),
      ).not.toThrow();
    });

    it('should broadcast certificado.subido event', () => {
      expect(() =>
        service.handleCertificadoSubido({
          fileName: 'cert.p12',
          tenantId: 'tenant-1',
        }),
      ).not.toThrow();
    });

    it('should broadcast certificado.eliminado event', () => {
      expect(() =>
        service.handleCertificadoEliminado({
          fileName: 'cert.p12',
          tenantId: 'tenant-1',
        }),
      ).not.toThrow();
    });
  });

  describe('broadcast filtering', () => {
    it('should only send events to matching tenant', () => {
      const payload1 = {
        sub: 'u1',
        email: 'e1',
        rol: UserRole.USER,
        tenantId: 'tenant-1',
      };
      const payload2 = {
        sub: 'u2',
        email: 'e2',
        rol: UserRole.USER,
        tenantId: 'tenant-2',
      };

      service.createConnection('client-1', payload1);
      service.createConnection('client-2', payload2);

      expect(() =>
        service.handleComprobanteAutorizado({
          claveAcceso: 'test',
          estado: 'AUTORIZADO',
          tenantId: 'tenant-1',
        }),
      ).not.toThrow();
    });

    it('should send events to all tenants for SUPERADMIN', () => {
      const adminPayload = {
        sub: 'admin',
        email: 'admin@test.com',
        rol: UserRole.SUPERADMIN,
        tenantId: null as any,
      };
      service.createConnection('admin-client', adminPayload);

      expect(() =>
        service.handleComprobanteAutorizado({
          claveAcceso: 'test',
          estado: 'AUTORIZADO',
          tenantId: 'tenant-99',
        }),
      ).not.toThrow();
    });
  });
});
