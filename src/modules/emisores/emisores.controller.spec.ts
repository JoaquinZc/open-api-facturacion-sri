import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EmisoresController } from './emisores.controller';
import { EmisoresService } from './emisores.service';
import {
  CreateEmisorDto,
  UpdateEmisorDto,
  QueryEmisoresDto,
  EmisorEstado,
  EmisorAmbiente,
} from './dto';
import { UserRole, JwtPayload } from '../auth/dto/auth.dto';

describe('EmisoresController', () => {
  let controller: EmisoresController;
  let emisoresService: jest.Mocked<EmisoresService>;

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

  const mockPaginatedResponse = {
    data: [mockEmisorResponse],
    nextCursor: null,
    hasMore: false,
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [EmisoresController],
      providers: [
        {
          provide: EmisoresService,
          useValue: {
            findAll: jest.fn(),
            findAllByTenant: jest.fn(),
            findOne: jest.fn(),
            findOneSecured: jest.fn(),
            validateEmisorAccess: jest.fn(),
            validateRucAccess: jest.fn(),
            findByRuc: jest.fn(),
            findByTenantId: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            uploadCertificado: jest.fn(),
            deleteCertificado: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(EmisoresController);
    emisoresService = module.get(EmisoresService);

    jest.clearAllMocks();
  });

  // ─── GET /emisores ──────────────────────────────────────────────────────

  describe('GET /emisores', () => {
    const query: QueryEmisoresDto = { limit: 20 };

    it('debe listar todos los emisores si el usuario es SUPERADMIN', async () => {
      emisoresService.findAll.mockResolvedValueOnce(mockPaginatedResponse);

      const result = await controller.findAll(query, superadminUser);

      expect(emisoresService.findAll).toHaveBeenCalledWith(query);
      expect(emisoresService.findAllByTenant).not.toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
    });

    it('debe listar solo emisores del tenant si el usuario no es SUPERADMIN', async () => {
      emisoresService.findAllByTenant.mockResolvedValueOnce(
        mockPaginatedResponse,
      );

      const result = await controller.findAll(query, tenantUser);

      expect(emisoresService.findAllByTenant).toHaveBeenCalledWith(
        'tenant-uuid-1',
        query,
      );
      expect(emisoresService.findAll).not.toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
    });
  });

  // ─── GET /emisores/:id ──────────────────────────────────────────────────

  describe('GET /emisores/:id', () => {
    it('debe retornar el emisor si el acceso es válido', async () => {
      emisoresService.findOneSecured.mockResolvedValueOnce(mockEmisorResponse);

      const result = await controller.findOne('emisor-uuid-1', superadminUser);

      expect(emisoresService.findOneSecured).toHaveBeenCalledWith(
        'emisor-uuid-1',
        superadminUser,
      );
      expect(result.id).toBe('emisor-uuid-1');
    });

    it('debe propagar ForbiddenException si el acceso es denegado', async () => {
      emisoresService.findOneSecured.mockRejectedValueOnce(
        new ForbiddenException('No tienes acceso a este emisor'),
      );

      await expect(
        controller.findOne('emisor-uuid-1', tenantUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe propagar NotFoundException si el emisor no existe', async () => {
      emisoresService.findOneSecured.mockRejectedValueOnce(
        new NotFoundException('Emisor no encontrado'),
      );

      await expect(
        controller.findOne('non-existent', superadminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── POST /emisores ─────────────────────────────────────────────────────

  describe('POST /emisores', () => {
    const createDto: CreateEmisorDto = {
      ruc: '1712345678001',
      razonSocial: 'Empresa Test S.A.',
      direccionMatriz: 'Av. Principal 123',
      ambiente: EmisorAmbiente.PRUEBAS,
    };

    it('debe crear un emisor exitosamente', async () => {
      emisoresService.create.mockResolvedValueOnce(mockEmisorResponse);

      const result = await controller.create(createDto, superadminUser);

      expect(emisoresService.create).toHaveBeenCalledWith(createDto);
      expect(result.id).toBe('emisor-uuid-1');
    });

    it('debe forzar tenantId del usuario si no es SUPERADMIN', async () => {
      emisoresService.create.mockResolvedValueOnce(mockEmisorResponse);

      const dtoWithTenant = { ...createDto, tenantId: '' };
      await controller.create(dtoWithTenant, tenantUser);

      expect(dtoWithTenant.tenantId).toBe('tenant-uuid-1');
      expect(emisoresService.create).toHaveBeenCalledWith(dtoWithTenant);
    });

    it('no debe sobrescribir tenantId si es SUPERADMIN', async () => {
      emisoresService.create.mockResolvedValueOnce(mockEmisorResponse);

      const dtoWithTenant = { ...createDto, tenantId: 'custom-tenant' };
      await controller.create(dtoWithTenant, superadminUser);

      expect(dtoWithTenant.tenantId).toBe('custom-tenant');
    });

    it('debe propagar BadRequestException si el RUC ya existe', async () => {
      emisoresService.create.mockRejectedValueOnce(
        new BadRequestException('Ya existe un emisor con RUC 1712345678001'),
      );

      await expect(
        controller.create(createDto, superadminUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── PUT /emisores/:id ──────────────────────────────────────────────────

  describe('PUT /emisores/:id', () => {
    const updateDto: UpdateEmisorDto = {
      razonSocial: 'Empresa Updated S.A.',
    };

    it('debe actualizar el emisor si el acceso es válido', async () => {
      emisoresService.findOneSecured.mockResolvedValueOnce(mockEmisorResponse);
      emisoresService.update.mockResolvedValueOnce({
        ...mockEmisorResponse,
        razonSocial: 'Empresa Updated S.A.',
      });

      const result = await controller.update(
        'emisor-uuid-1',
        updateDto,
        tenantUser,
      );

      expect(emisoresService.findOneSecured).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
      expect(emisoresService.update).toHaveBeenCalledWith(
        'emisor-uuid-1',
        updateDto,
      );
      expect(result.razonSocial).toBe('Empresa Updated S.A.');
    });

    it('debe verificar acceso antes de actualizar', async () => {
      emisoresService.findOneSecured.mockRejectedValueOnce(
        new ForbiddenException('No tienes acceso a este emisor'),
      );

      await expect(
        controller.update('emisor-uuid-1', updateDto, otherTenantUser()),
      ).rejects.toThrow(ForbiddenException);
      expect(emisoresService.update).not.toHaveBeenCalled();
    });

    it('debe propagar NotFoundException si el emisor no existe', async () => {
      emisoresService.findOneSecured.mockRejectedValueOnce(
        new NotFoundException('Emisor no encontrado'),
      );

      await expect(
        controller.update('non-existent', updateDto, superadminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── DELETE /emisores/:id ───────────────────────────────────────────────

  describe('DELETE /emisores/:id', () => {
    it('debe inactivar el emisor si el acceso es válido', async () => {
      emisoresService.findOneSecured.mockResolvedValueOnce(mockEmisorResponse);
      emisoresService.delete.mockResolvedValueOnce({
        ...mockEmisorResponse,
        estado: 'INACTIVO',
      });

      const result = await controller.delete('emisor-uuid-1', tenantUser);

      expect(emisoresService.findOneSecured).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
      expect(emisoresService.delete).toHaveBeenCalledWith('emisor-uuid-1');
      expect(result.estado).toBe('INACTIVO');
    });

    it('debe verificar acceso antes de eliminar', async () => {
      emisoresService.findOneSecured.mockRejectedValueOnce(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        controller.delete('emisor-uuid-1', otherTenantUser()),
      ).rejects.toThrow(ForbiddenException);
      expect(emisoresService.delete).not.toHaveBeenCalled();
    });

    it('debe propagar BadRequestException si ya está inactivo', async () => {
      emisoresService.findOneSecured.mockResolvedValueOnce(mockEmisorResponse);
      emisoresService.delete.mockRejectedValueOnce(
        new BadRequestException('El emisor ya se encuentra inactivo'),
      );

      await expect(
        controller.delete('emisor-uuid-1', superadminUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // Helper
  function otherTenantUser(): JwtPayload {
    return {
      sub: 'user-uuid-3',
      email: 'other@test.com',
      rol: UserRole.ADMIN,
      tenantId: 'tenant-uuid-2',
    };
  }
});
