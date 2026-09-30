import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SecuencialesController } from './secuenciales.controller';
import { PuntosEmisionService } from './puntos-emision.service';
import { EmisoresService } from '../emisores/emisores.service';
import { UpdateSecuencialDto } from './dto';
import { UserRole, JwtPayload } from '../auth/dto/auth.dto';

describe('SecuencialesController', () => {
  let controller: SecuencialesController;
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

  const mockSecuencialResponse = {
    id: 'sec-uuid-1',
    puntoEmisionId: 'pe-uuid-1',
    tipoComprobante: '01',
    tipoDescripcion: 'Factura',
    ultimoSecuencial: 5,
    proximoSecuencial: 6,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockSecuencialWithEstab = {
    ...mockSecuencialResponse,
    establecimiento: '001',
    puntoEmision: '001',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [SecuencialesController],
      providers: [
        {
          provide: PuntosEmisionService,
          useValue: {
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

    controller = module.get(SecuencialesController);
    service = module.get(PuntosEmisionService);
    emisoresService = module.get(EmisoresService);

    jest.clearAllMocks();
  });

  // ─── GET :emisorId ──────────────────────────────────────────────────────

  describe('GET /emisores/secuenciales/:emisorId', () => {
    it('debe listar todos los secuenciales del emisor después de validar acceso', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.getAllSecuencialesByEmisor.mockResolvedValueOnce([
        mockSecuencialWithEstab,
      ]);

      const result = await controller.getAllByEmisor(
        'emisor-uuid-1',
        tenantUser,
      );

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
      expect(service.getAllSecuencialesByEmisor).toHaveBeenCalledWith(
        'emisor-uuid-1',
      );
      expect(result).toHaveLength(1);
      expect(result[0].establecimiento).toBe('001');
    });

    it('debe propagar ForbiddenException si el acceso es denegado', async () => {
      emisoresService.validateEmisorAccess.mockRejectedValueOnce(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        controller.getAllByEmisor('emisor-uuid-1', tenantUser),
      ).rejects.toThrow(ForbiddenException);
      expect(service.getAllSecuencialesByEmisor).not.toHaveBeenCalled();
    });
  });

  // ─── GET :emisorId/:puntoEmisionId ──────────────────────────────────────

  describe('GET /emisores/secuenciales/:emisorId/:puntoEmisionId', () => {
    it('debe listar secuenciales de un punto específico después de validar acceso', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.getSecuenciales.mockResolvedValueOnce([mockSecuencialResponse]);

      const result = await controller.getSecuenciales(
        'emisor-uuid-1',
        'pe-uuid-1',
        superadminUser,
      );

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        superadminUser,
      );
      expect(service.getSecuenciales).toHaveBeenCalledWith(
        'emisor-uuid-1',
        'pe-uuid-1',
      );
      expect(result).toHaveLength(1);
      expect(result[0].tipoComprobante).toBe('01');
    });

    it('debe propagar NotFoundException si el punto no existe', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.getSecuenciales.mockRejectedValueOnce(
        new NotFoundException('Punto no encontrado'),
      );

      await expect(
        controller.getSecuenciales(
          'emisor-uuid-1',
          'non-existent',
          superadminUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── PATCH :emisorId/:puntoEmisionId/:tipoComprobante ───────────────────

  describe('PATCH /emisores/secuenciales/:emisorId/:puntoEmisionId/:tipoComprobante', () => {
    const updateDto: UpdateSecuencialDto = { ultimoSecuencial: 100 };

    it('debe actualizar un secuencial después de validar acceso', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.updateSecuencial.mockResolvedValueOnce({
        ...mockSecuencialResponse,
        ultimoSecuencial: 100,
        proximoSecuencial: 101,
      });

      const result = await controller.updateSecuencial(
        'emisor-uuid-1',
        'pe-uuid-1',
        '01',
        updateDto,
        tenantUser,
      );

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
      expect(service.updateSecuencial).toHaveBeenCalledWith(
        'emisor-uuid-1',
        'pe-uuid-1',
        '01',
        updateDto,
      );
      expect(result.ultimoSecuencial).toBe(100);
    });

    it('debe propagar BadRequestException si el tipo es inválido', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.updateSecuencial.mockRejectedValueOnce(
        new BadRequestException('Tipo de comprobante inválido'),
      );

      await expect(
        controller.updateSecuencial(
          'emisor-uuid-1',
          'pe-uuid-1',
          '99',
          updateDto,
          superadminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe propagar NotFoundException si el secuencial no existe', async () => {
      emisoresService.validateEmisorAccess.mockResolvedValueOnce({} as any);
      service.updateSecuencial.mockRejectedValueOnce(
        new NotFoundException('Secuencial no encontrado'),
      );

      await expect(
        controller.updateSecuencial(
          'emisor-uuid-1',
          'pe-uuid-1',
          '07',
          updateDto,
          superadminUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe propagar ForbiddenException si el acceso es denegado', async () => {
      emisoresService.validateEmisorAccess.mockRejectedValueOnce(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        controller.updateSecuencial(
          'emisor-uuid-1',
          'pe-uuid-1',
          '01',
          updateDto,
          tenantUser,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(service.updateSecuencial).not.toHaveBeenCalled();
    });
  });
});
