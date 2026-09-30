import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PuntosEmisionController } from './puntos-emision.controller';
import { PuntosEmisionService } from './puntos-emision.service';
import { EmisoresService } from '../emisores/emisores.service';
import { CreatePuntoEmisionDto, UpdatePuntoEmisionDto } from './dto';
import { UserRole, JwtPayload } from '../auth/dto/auth.dto';

describe('PuntosEmisionController', () => {
  let controller: PuntosEmisionController;
  let service: jest.Mocked<PuntosEmisionService>;
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

  const mockPuntoResponse = {
    id: 'pe-uuid-1',
    emisorId: 'emisor-uuid-1',
    establecimientoId: 'est-uuid-1',
    establecimiento: '001',
    puntoEmision: '001',
    direccion: 'Av. Principal 123',
    descripcion: 'Caja Principal',
    estado: 'ACTIVO',
    secuenciales: { '01': 5, '04': 2 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [PuntosEmisionController],
      providers: [
        {
          provide: PuntosEmisionService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            getAllSecuencialesByEmisor: jest.fn(),
            getSecuenciales: jest.fn(),
            updateSecuencial: jest.fn(),
          },
        },
        {
          provide: EmisoresService,
          useValue: {
            validateEmisorAccess: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(PuntosEmisionController);
    service = module.get(PuntosEmisionService);
    emisoresService = module.get(EmisoresService);

    jest.clearAllMocks();
  });

  // ─── GET :emisorId ──────────────────────────────────────────────────────

  describe('GET /emisores/puntos-emision/:emisorId', () => {
    it('debe listar puntos de emisión después de validar acceso', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.findAll.mockResolvedValueOnce([mockPuntoResponse]);

      const result = await controller.findAll('emisor-uuid-1', tenantUser);

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
      expect(service.findAll).toHaveBeenCalledWith('emisor-uuid-1');
      expect(result).toHaveLength(1);
    });

    it('debe propagar ForbiddenException si el acceso es denegado', async () => {
      emisoresService.validateEmisorAccess.mockRejectedValueOnce(
        new ForbiddenException('No tienes acceso a este emisor'),
      );

      await expect(
        controller.findAll('emisor-uuid-1', tenantUser),
      ).rejects.toThrow(ForbiddenException);
      expect(service.findAll).not.toHaveBeenCalled();
    });
  });

  // ─── GET :emisorId/:puntoEmisionId ──────────────────────────────────────

  describe('GET /emisores/puntos-emision/:emisorId/:puntoEmisionId', () => {
    it('debe retornar un punto específico después de validar acceso', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.findOne.mockResolvedValueOnce(mockPuntoResponse);

      const result = await controller.findOne(
        'emisor-uuid-1',
        'pe-uuid-1',
        superadminUser,
      );

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        superadminUser,
      );
      expect(service.findOne).toHaveBeenCalledWith(
        'emisor-uuid-1',
        'pe-uuid-1',
      );
      expect(result.id).toBe('pe-uuid-1');
    });

    it('debe propagar NotFoundException si el punto no existe', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.findOne.mockRejectedValueOnce(
        new NotFoundException('Punto de emisión no encontrado'),
      );

      await expect(
        controller.findOne('emisor-uuid-1', 'non-existent', superadminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── POST :emisorId ─────────────────────────────────────────────────────

  describe('POST /emisores/puntos-emision/:emisorId', () => {
    const createDto: CreatePuntoEmisionDto = {
      establecimiento: '001',
      puntoEmision: '001',
      direccionEstablecimiento: 'Av. Test 123',
      descripcion: 'Caja Principal',
    };

    it('debe crear un punto de emisión después de validar acceso', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.create.mockResolvedValueOnce(mockPuntoResponse);

      const result = await controller.create(
        'emisor-uuid-1',
        createDto,
        tenantUser,
      );

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
      expect(service.create).toHaveBeenCalledWith('emisor-uuid-1', createDto);
      expect(result.id).toBe('pe-uuid-1');
    });

    it('debe propagar ConflictException si el punto ya existe', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.create.mockRejectedValueOnce(
        new ConflictException('Ya existe un punto de emisión 001-001'),
      );

      await expect(
        controller.create('emisor-uuid-1', createDto, tenantUser),
      ).rejects.toThrow(ConflictException);
    });

    it('debe propagar ForbiddenException si el acceso es denegado', async () => {
      emisoresService.validateEmisorAccess.mockRejectedValueOnce(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        controller.create('emisor-uuid-1', createDto, tenantUser),
      ).rejects.toThrow(ForbiddenException);
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  // ─── PUT :emisorId/:puntoEmisionId ──────────────────────────────────────

  describe('PUT /emisores/puntos-emision/:emisorId/:puntoEmisionId', () => {
    const updateDto: UpdatePuntoEmisionDto = {
      descripcion: 'Caja Actualizada',
      estado: 'INACTIVO',
    };

    it('debe actualizar un punto después de validar acceso', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.update.mockResolvedValueOnce({
        ...mockPuntoResponse,
        descripcion: 'Caja Actualizada',
      });

      const result = await controller.update(
        'emisor-uuid-1',
        'pe-uuid-1',
        updateDto,
        tenantUser,
      );

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
      expect(service.update).toHaveBeenCalledWith(
        'emisor-uuid-1',
        'pe-uuid-1',
        updateDto,
      );
      expect(result.descripcion).toBe('Caja Actualizada');
    });

    it('debe propagar NotFoundException si el punto no existe', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.update.mockRejectedValueOnce(
        new NotFoundException('Punto no encontrado'),
      );

      await expect(
        controller.update(
          'emisor-uuid-1',
          'non-existent',
          updateDto,
          superadminUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── DELETE :emisorId/:puntoEmisionId ───────────────────────────────────

  describe('DELETE /emisores/puntos-emision/:emisorId/:puntoEmisionId', () => {
    it('debe inactivar un punto después de validar acceso', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.delete.mockResolvedValueOnce({
        ...mockPuntoResponse,
        estado: 'INACTIVO',
      });

      const result = await controller.delete(
        'emisor-uuid-1',
        'pe-uuid-1',
        tenantUser,
      );

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
      expect(service.delete).toHaveBeenCalledWith('emisor-uuid-1', 'pe-uuid-1');
      expect(result.estado).toBe('INACTIVO');
    });

    it('debe propagar BadRequestException si ya está inactivo', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.delete.mockRejectedValueOnce(
        new BadRequestException('El punto ya está inactivo'),
      );

      await expect(
        controller.delete('emisor-uuid-1', 'pe-uuid-1', superadminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe propagar ForbiddenException si el acceso es denegado', async () => {
      emisoresService.validateEmisorAccess.mockRejectedValueOnce(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        controller.delete('emisor-uuid-1', 'pe-uuid-1', tenantUser),
      ).rejects.toThrow(ForbiddenException);
      expect(service.delete).not.toHaveBeenCalled();
    });
  });
});
