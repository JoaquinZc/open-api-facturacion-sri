import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RealtimeService } from './realtime.service';
import { UserRole } from '../auth/dto/auth.dto';
import { DatabaseService } from '../../database/database.service';

describe('RealtimeService', () => {
  let service: RealtimeService;
  let jwtService: { verify: jest.Mock };
  let configService: { get: jest.Mock };
  let db: { queryOne: jest.Mock };

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

    // El tenant de cada emisor, como lo devolvería `emisores`.
    db = {
      queryOne: jest.fn((_sql: string, [emisorId]: string[]) =>
        Promise.resolve(
          { 'emisor-a': { tenant_id: 'tenant-1' } }[emisorId] ?? null,
        ),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        RealtimeService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: DatabaseService, useValue: db },
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

    /** Conecta y devuelve lo que va recibiendo esa conexión. */
    const conectar = (
      id: string,
      rol: UserRole,
      tenantId: string | null,
    ): string[] => {
      const recibidos: string[] = [];
      service
        .createConnection(id, {
          sub: id,
          email: `${id}@test.com`,
          rol,
          tenantId: tenantId as any,
        })
        .subscribe((e) => recibidos.push(String(e.data.claveAcceso)));
      return recibidos;
    };

    // R0 de retenciones: ningún evento de comprobante trae `tenantId`, y sin él
    // `broadcast` se lo mandaba a todas las conexiones.
    it('sin tenantId, lo resuelve por el emisor: solo lo ve su tenant', async () => {
      const suyo = conectar('c1', UserRole.USER, 'tenant-1');
      const ajeno = conectar('c2', UserRole.USER, 'tenant-2');

      await service.handleComprobanteAutorizado({
        claveAcceso: 'CLAVE-A',
        emisorId: 'emisor-a',
      });

      expect(suyo).toEqual(['CLAVE-A']);
      expect(ajeno).toEqual([]);
    });

    it('sin tenant ni emisor conocido: solo lo ve el SUPERADMIN', async () => {
      const usuario = conectar('c1', UserRole.USER, 'tenant-1');
      const admin = conectar('adm', UserRole.SUPERADMIN, null);

      await service.handleComprobanteAnulado({ claveAcceso: 'CLAVE-X' });
      await service.handleComprobantePersistenciaFallida({
        claveAcceso: 'CLAVE-Y',
        emisorId: 'emisor-desconocido',
      });

      expect(usuario).toEqual([]);
      expect(admin).toEqual(['CLAVE-X', 'CLAVE-Y']);
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
