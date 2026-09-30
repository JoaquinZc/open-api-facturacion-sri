import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EmisoresService } from './emisores.service';
import { DatabaseService } from '../../database/database.service';
import { EncryptionService } from '../../common/services/encryption.service';
import {
  CreateEmisorDto,
  UpdateEmisorDto,
  QueryEmisoresDto,
  EmisorEstado,
  EmisorAmbiente,
} from './dto';
import { UserRole, JwtPayload } from '../auth/dto/auth.dto';

jest.mock('node-forge');

describe('EmisoresService', () => {
  let service: EmisoresService;
  let cache: { del: jest.Mock };
  let db: jest.Mocked<DatabaseService>;
  let encryptionService: jest.Mocked<EncryptionService>;

  const mockEmisorRow = {
    id: 'emisor-uuid-1',
    ruc: '1712345678001',
    razon_social: 'Empresa Test S.A.',
    nombre_comercial: 'Empresa Test',
    direccion_matriz: 'Av. Principal 123',
    obligado_contabilidad: true,
    contribuyente_especial: '12345',
    agente_retencion: 'RET-001',
    contribuyente_rimpe: false,
    ambiente: '1',
    estado: 'ACTIVO',
    tenant_id: 'tenant-uuid-1',
    tiene_certificado: false,
    certificado_valido_hasta: null,
    certificado_sujeto: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  };

  const mockEmisorResponse = {
    id: 'emisor-uuid-1',
    ruc: '1712345678001',
    razonSocial: 'Empresa Test S.A.',
    nombreComercial: 'Empresa Test',
    direccionMatriz: 'Av. Principal 123',
    obligadoContabilidad: true,
    contribuyenteEspecial: '12345',
    agenteRetencion: 'RET-001',
    contribuyenteRimpe: false,
    ambiente: '1',
    estado: 'ACTIVO',
    tenantId: 'tenant-uuid-1',
    tieneCertificado: false,
    certificadoValidoHasta: undefined,
    certificadoSujeto: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const superadminUser: JwtPayload = {
    sub: 'user-uuid-1',
    email: 'admin@test.com',
    rol: UserRole.SUPERADMIN,
    tenantId: null,
  };

  const tenantUser: JwtPayload = {
    sub: 'user-uuid-2',
    email: 'user@test.com',
    rol: UserRole.ADMIN,
    tenantId: 'tenant-uuid-1',
  };

  const otherTenantUser: JwtPayload = {
    sub: 'user-uuid-3',
    email: 'other@test.com',
    rol: UserRole.ADMIN,
    tenantId: 'tenant-uuid-2',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmisoresService,
        {
          provide: DatabaseService,
          useValue: {
            query: jest.fn(),
            queryOne: jest.fn(),
            transaction: jest.fn(),
          },
        },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: jest.fn(),
            decrypt: jest.fn(),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: { del: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(EmisoresService);
    cache = module.get(CACHE_MANAGER);
    db = module.get(DatabaseService);
    encryptionService = module.get(EncryptionService);

    jest.clearAllMocks();
  });

  // ─── findAll ────────────────────────────────────────────────────────────

  describe('findAll', () => {
    const query: QueryEmisoresDto = { limit: 20 };

    it('debe retornar emisores paginados con cursor y hasMore', async () => {
      const rows = [mockEmisorRow];
      db.query.mockResolvedValueOnce({ rows } as any);

      const result = await service.findAll(query);

      expect(result.data).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.data[0].ruc).toBe('1712345678001');
    });

    it('debe calcular hasMore y nextCursor cuando hay más resultados', async () => {
      const rows = Array.from({ length: 21 }, (_, i) => ({
        ...mockEmisorRow,
        id: `emisor-uuid-${i + 1}`,
      }));
      db.query.mockResolvedValueOnce({ rows } as any);

      const result = await service.findAll({ limit: 20 });

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('emisor-uuid-20');
      expect(result.data).toHaveLength(20);
    });

    it('debe filtrar por estado cuando se proporciona', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await service.findAll({ estado: EmisorEstado.INACTIVO });

      const callArgs = db.query.mock.calls[0];
      expect(callArgs[1]).toContain('INACTIVO');
    });

    it('debe filtrar por tenantId cuando se proporciona', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await service.findAll({ tenantId: 'tenant-uuid-1' });

      const callArgs = db.query.mock.calls[0];
      expect(callArgs[1]).toContain('tenant-uuid-1');
    });

    it('debe filtrar por cursor cuando se proporciona', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await service.findAll({ cursor: 'some-cursor-uuid' });

      const callArgs = db.query.mock.calls[0];
      expect(callArgs[1]).toContain('some-cursor-uuid');
    });

    it('debe usar limit por defecto 20 si no se especifica', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await service.findAll({});

      const sql = db.query.mock.calls[0][0] as string;
      expect(sql).toContain('LIMIT');
      const params = db.query.mock.calls[0][1] as unknown[];
      expect(params[params.length - 1]).toBe(21);
    });
  });

  // ─── findAllByTenant ────────────────────────────────────────────────────

  describe('findAllByTenant', () => {
    it('debe filtrar emisores por tenant_id', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.findAllByTenant('tenant-uuid-1', { limit: 20 });

      expect(result.data).toHaveLength(1);
      const sql = db.query.mock.calls[0][0] as string;
      expect(sql).toContain('tenant_id = $1');
    });

    it('debe aplicar cursor y estado correctamente', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await service.findAllByTenant('tenant-uuid-1', {
        cursor: 'cursor-uuid',
        estado: EmisorEstado.INACTIVO,
      });

      const params = db.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('tenant-uuid-1');
      expect(params).toContain('INACTIVO');
      expect(params).toContain('cursor-uuid');
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('debe retornar el emisor cuando existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.findOne('emisor-uuid-1');

      expect(result.id).toBe('emisor-uuid-1');
    });

    it('debe lanzar NotFoundException cuando no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── findOneSecured ─────────────────────────────────────────────────────

  describe('findOneSecured', () => {
    it('debe retornar el emisor si es SUPERADMIN', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.findOneSecured('emisor-uuid-1', superadminUser);

      expect(result.id).toBe('emisor-uuid-1');
    });

    it('debe retornar el emisor si pertenece al tenant del usuario', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.findOneSecured('emisor-uuid-1', tenantUser);

      expect(result.id).toBe('emisor-uuid-1');
    });

    it('debe lanzar ForbiddenException si pertenece a otro tenant', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      await expect(
        service.findOneSecured('emisor-uuid-1', otherTenantUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe lanzar ForbiddenException si el emisor no tiene tenant y el usuario no es SUPERADMIN', async () => {
      const noTenantRow = { ...mockEmisorRow, tenant_id: null };
      db.query.mockResolvedValueOnce({ rows: [noTenantRow] } as any);

      await expect(
        service.findOneSecured('emisor-uuid-1', tenantUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── validateEmisorAccess ───────────────────────────────────────────────

  describe('validateEmisorAccess', () => {
    it('debe retornar el emisor si es SUPERADMIN', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.validateEmisorAccess('emisor-uuid-1', superadminUser);

      expect(result.id).toBe('emisor-uuid-1');
    });

    it('debe retornar el emisor si pertenece al tenant del usuario', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.validateEmisorAccess('emisor-uuid-1', tenantUser);

      expect(result.id).toBe('emisor-uuid-1');
    });

    it('debe lanzar ForbiddenException si pertenece a otro tenant', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      await expect(
        service.validateEmisorAccess('emisor-uuid-1', otherTenantUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe lanzar ForbiddenException si el usuario no tiene tenantId', async () => {
      const userNoTenant: JwtPayload = {
        sub: 'user-uuid-4',
        email: 'notenant@test.com',
        rol: UserRole.USER,
        tenantId: undefined as any,
      };
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      await expect(
        service.validateEmisorAccess('emisor-uuid-1', userNoTenant),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe lanzar NotFoundException si el emisor no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.validateEmisorAccess('non-existent', superadminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── validateRucAccess ──────────────────────────────────────────────────

  describe('validateRucAccess', () => {
    it('debe retornar el emisor si es SUPERADMIN', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.validateRucAccess('1712345678001', superadminUser);

      expect(result.ruc).toBe('1712345678001');
    });

    it('debe retornar el emisor si el RUC pertenece al tenant del usuario', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.validateRucAccess('1712345678001', tenantUser);

      expect(result.ruc).toBe('1712345678001');
    });

    it('debe lanzar ForbiddenException si el RUC pertenece a otro tenant', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      await expect(
        service.validateRucAccess('1712345678001', otherTenantUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe lanzar NotFoundException si el RUC no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.validateRucAccess('9999999999999', superadminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findByRuc ──────────────────────────────────────────────────────────

  describe('findByRuc', () => {
    it('debe retornar el emisor cuando existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.findByRuc('1712345678001');

      expect(result).not.toBeNull();
      expect(result!.ruc).toBe('1712345678001');
    });

    it('debe retornar null cuando no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      const result = await service.findByRuc('9999999999999');

      expect(result).toBeNull();
    });
  });

  // ─── findByTenantId ─────────────────────────────────────────────────────

  describe('findByTenantId', () => {
    it('debe retornar emisores activos del tenant', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any);

      const result = await service.findByTenantId('tenant-uuid-1');

      expect(result).toHaveLength(1);
      expect(result[0].estado).toBe('ACTIVO');
      const sql = db.query.mock.calls[0][0] as string;
      expect(sql).toContain("estado = 'ACTIVO'");
    });

    it('debe retornar array vacío si el tenant no tiene emisores', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      const result = await service.findByTenantId('empty-tenant');

      expect(result).toEqual([]);
    });
  });

  // ─── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    const createDto: CreateEmisorDto = {
      ruc: '1712345678001',
      razonSocial: 'Empresa Test S.A.',
      direccionMatriz: 'Av. Principal 123',
      ambiente: EmisorAmbiente.PRUEBAS,
    };

    it('debe crear un emisor exitosamente', async () => {
      // findByRuc → no existe
      db.query
        .mockResolvedValueOnce({ rows: [] } as any) // findByRuc
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // INSERT
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne

      const result = await service.create(createDto);

      expect(result.id).toBe('emisor-uuid-1');
      expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('debe lanzar BadRequestException si el RUC ya existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findByRuc → existe

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('debe lanzar BadRequestException si no se especifica ambiente', async () => {
      const noAmbienteDto = { ...createDto, ambiente: undefined } as any;

      db.query.mockResolvedValueOnce({ rows: [] } as any); // findByRuc → no existe

      await expect(service.create(noAmbienteDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('debe lanzar BadRequestException si el ambiente es inválido', async () => {
      const invalidAmbienteDto = { ...createDto, ambiente: 'invalid' as any };

      db.query.mockResolvedValueOnce({ rows: [] } as any); // findByRuc → no existe

      await expect(service.create(invalidAmbienteDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('debe aceptar ambiente como código SRI "1"', async () => {
      const codigoDto = { ...createDto, ambiente: '1' as any };

      db.query
        .mockResolvedValueOnce({ rows: [] } as any) // findByRuc
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // INSERT
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne

      await service.create(codigoDto);

      const insertParams = db.query.mock.calls[1][1] as unknown[];
      expect(insertParams).toContain('1');
    });

    it('debe aceptar ambiente como código SRI "2" (produccion)', async () => {
      const codigoDto = { ...createDto, ambiente: '2' as any };

      db.query
        .mockResolvedValueOnce({ rows: [] } as any) // findByRuc
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // INSERT
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne

      await service.create(codigoDto);

      const insertParams = db.query.mock.calls[1][1] as unknown[];
      expect(insertParams).toContain('2');
    });
  });

  // ─── update ─────────────────────────────────────────────────────────────

  describe('update', () => {
    it('debe actualizar campos proporcionados', async () => {
      const updateDto: UpdateEmisorDto = {
        razonSocial: 'Empresa Updated S.A.',
        ambiente: EmisorAmbiente.PRODUCCION,
      };

      db.query
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any) // findOne (verificar existe)
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // UPDATE
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne (retorno)

      const result = await service.update('emisor-uuid-1', updateDto);

      expect(result.id).toBe('emisor-uuid-1');
      const updateSql = db.query.mock.calls[1][0] as string;
      expect(updateSql).toContain('razon_social');
      expect(updateSql).toContain('ambiente');
    });

    /**
     * 🔴 La emisión lee el emisor de la caché. Sin borrarla, pasar a
     * producción no llega a los comprobantes hasta que caduca.
     */
    it('borra la ficha cacheada del emisor para que la emisión vea el cambio', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any) // findOne
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // UPDATE
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne

      await service.update('emisor-uuid-1', {
        ambiente: EmisorAmbiente.PRODUCCION,
      });

      expect(cache.del).toHaveBeenCalledWith(`emisor:ruc:${mockEmisorRow.ruc}`);
    });

    it('debe actualizar estado con normalización a mayúsculas', async () => {
      const updateDto: UpdateEmisorDto = {
        estado: EmisorEstado.INACTIVO,
      };

      db.query
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any) // findOne
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // UPDATE
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne

      await service.update('emisor-uuid-1', updateDto);

      const updateParams = db.query.mock.calls[1][1] as unknown[];
      expect(updateParams).toContain('INACTIVO');
    });

    it('debe retornar el emisor sin actualizar si no hay campos', async () => {
      const updateDto: UpdateEmisorDto = {};

      db.query
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any) // findOne (verificar existe)
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne (retorno)

      const result = await service.update('emisor-uuid-1', updateDto);

      expect(result.id).toBe('emisor-uuid-1');
      expect(db.query).toHaveBeenCalledTimes(2); // 2 findOne calls, no UPDATE
    });

    it('debe lanzar NotFoundException si el emisor no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any); // findOne → no existe

      await expect(
        service.update('non-existent', { razonSocial: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar BadRequestException si el ambiente es inválido', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne

      await expect(
        service.update('emisor-uuid-1', { ambiente: 'invalid' as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── delete ─────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('debe inactivar un emisor activo', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any) // findOne
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // UPDATE estado
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne (retorno)

      const result = await service.delete('emisor-uuid-1');

      expect(result.id).toBe('emisor-uuid-1');
      const updateSql = db.query.mock.calls[1][0] as string;
      expect(updateSql).toContain('INACTIVO');
    });

    it('debe lanzar BadRequestException si ya está inactivo', async () => {
      const inactivoRow = { ...mockEmisorRow, estado: 'INACTIVO' };
      db.query.mockResolvedValueOnce({ rows: [inactivoRow] } as any); // findOne

      await expect(service.delete('emisor-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('debe lanzar NotFoundException si no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(service.delete('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── uploadCertificado ──────────────────────────────────────────────────

  describe('uploadCertificado', () => {
    it('debe guardar el certificado en BD con password encriptado', async () => {
      const mockCertInfo = {
        validoHasta: new Date('2027-01-01'),
        sujeto: 'CN=Test Cert',
      };

      // Spy on the private method via prototype
      jest
        .spyOn(service as any, 'extractCertificateInfo')
        .mockReturnValueOnce(mockCertInfo);

      encryptionService.encrypt.mockResolvedValueOnce('encrypted-password');

      db.query
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any) // findOne
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // UPDATE cert
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne (retorno)

      const result = await service.uploadCertificado(
        'emisor-uuid-1',
        Buffer.from('fake-p12'),
        'password123',
      );

      expect(result.id).toBe('emisor-uuid-1');
      expect(encryptionService.encrypt).toHaveBeenCalledWith('password123');
    });

    it('debe lanzar BadRequestException si el certificado es inválido', async () => {
      jest
        .spyOn(service as any, 'extractCertificateInfo')
        .mockImplementationOnce(() => {
          throw new Error('Certificado inválido');
        });

      db.query.mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne

      await expect(
        service.uploadCertificado('emisor-uuid-1', Buffer.from('bad'), 'pass'),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar NotFoundException si el emisor no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.uploadCertificado('non-existent', Buffer.from('p12'), 'pass'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── deleteCertificado ──────────────────────────────────────────────────

  describe('deleteCertificado', () => {
    it('debe eliminar el certificado del emisor', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any) // findOne
        .mockResolvedValueOnce({ rows: [{ id: 'emisor-uuid-1' }] } as any) // UPDATE (set NULL)
        .mockResolvedValueOnce({ rows: [mockEmisorRow] } as any); // findOne (retorno)

      const result = await service.deleteCertificado('emisor-uuid-1');

      expect(result.id).toBe('emisor-uuid-1');
      const updateSql = db.query.mock.calls[1][0] as string;
      expect(updateSql).toContain('certificado_p12 = NULL');
    });

    it('debe lanzar NotFoundException si el emisor no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.deleteCertificado('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── mapToResponse (implicit via all methods) ───────────────────────────

  describe('mapToResponse (cobertura indirecta)', () => {
    it('debe mapear correctamente row a EmisorResponseDto', async () => {
      const rowWithCert = {
        ...mockEmisorRow,
        tiene_certificado: true,
        certificado_valido_hasta: new Date('2027-01-01'),
        certificado_sujeto: 'CN=Test',
      };
      db.query.mockResolvedValueOnce({ rows: [rowWithCert] } as any);

      const result = await service.findOne('emisor-uuid-1');

      expect(result.tieneCertificado).toBe(true);
      expect(result.certificadoSujeto).toBe('CN=Test');
      expect(result.certificadoValidoHasta).toBe('2027-01-01T00:00:00.000Z');
    });
  });
});
