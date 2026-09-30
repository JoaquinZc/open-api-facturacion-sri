import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { EmisoresService } from '../emisores/emisores.service';
import { DatabaseService } from '../../database/database.service';
import { UserRole, JwtPayload } from '../auth/dto/auth.dto';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let webhooksService: jest.Mocked<WebhooksService>;
  let emisoresService: jest.Mocked<EmisoresService>;
  let db: jest.Mocked<DatabaseService>;

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

  const mockWebhookResponse = {
    id: 'wh-uuid-1',
    nombre: 'Mi Webhook',
    url: 'https://example.com/webhook',
    eventos: ['comprobante.autorizado'],
    emisorId: 'emisor-uuid-1',
    secreto: 'whsec_****',
    activo: true,
    reintentosMax: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockLogsResponse = {
    data: [
      {
        id: 'log-1',
        evento: 'comprobante.autorizado',
        payload: { claveAcceso: '123' },
        statusCode: 200,
        respuesta: 'OK',
        intento: 1,
        exitoso: true,
        error: undefined,
        tiempoRespuestaMs: 150,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    totalPages: 1,
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        {
          provide: WebhooksService,
          useValue: {
            findAll: jest.fn(),
            findAllByTenant: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            regenerateSecret: jest.fn(),
            getLogs: jest.fn(),
          },
        },
        {
          provide: EmisoresService,
          useValue: {
            validateEmisorAccess: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DatabaseService,
          useValue: {
            queryOne: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(WebhooksController);
    webhooksService = module.get(WebhooksService);
    emisoresService = module.get(EmisoresService);
    db = module.get(DatabaseService);
  });

  // ─── getEventos ────────────────────────────────────────────────────────

  describe('getEventos', () => {
    it('debe retornar la lista de eventos disponibles con descripciones', () => {
      const result = controller.getEventos();

      expect(result.eventos).toContain('comprobante.autorizado');
      expect(result.eventos).toContain('comprobante.rechazado');
      expect(result.eventos).toContain('certificado.vencido');
      expect(result.descripciones['comprobante.autorizado']).toBeDefined();
      expect(result.descripciones['certificado.vencido']).toBeDefined();
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('debe listar todos los webhooks para SUPERADMIN sin filtro emisor', async () => {
      webhooksService.findAll.mockResolvedValue([mockWebhookResponse]);

      const result = await controller.findAll(undefined, superadminUser);

      expect(result).toHaveLength(1);
      expect(webhooksService.findAll).toHaveBeenCalledWith(undefined);
    });

    it('debe listar webhooks filtrados por tenant para usuarios no-SUPERADMIN', async () => {
      webhooksService.findAllByTenant.mockResolvedValue([mockWebhookResponse]);

      const result = await controller.findAll(undefined, tenantUser);

      expect(result).toHaveLength(1);
      expect(webhooksService.findAllByTenant).toHaveBeenCalledWith(
        'tenant-uuid-1',
        undefined,
      );
    });

    it('debe validar acceso al emisor cuando se filtra por emisorId', async () => {
      webhooksService.findAll.mockResolvedValue([mockWebhookResponse]);

      await controller.findAll('emisor-uuid-1', superadminUser);

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        superadminUser,
      );
    });

    it('debe pasar emisorId al servicio para SUPERADMIN', async () => {
      webhooksService.findAll.mockResolvedValue([mockWebhookResponse]);

      await controller.findAll('emisor-uuid-1', superadminUser);

      expect(webhooksService.findAll).toHaveBeenCalledWith('emisor-uuid-1');
    });

    it('debe pasar emisorId y tenantId a findAllByTenant para no-SUPERADMIN', async () => {
      webhooksService.findAllByTenant.mockResolvedValue([mockWebhookResponse]);

      await controller.findAll('emisor-uuid-1', tenantUser);

      expect(webhooksService.findAllByTenant).toHaveBeenCalledWith(
        'tenant-uuid-1',
        'emisor-uuid-1',
      );
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('debe retornar un webhook por ID para SUPERADMIN', async () => {
      webhooksService.findOne.mockResolvedValue(mockWebhookResponse);

      const result = await controller.findOne('wh-uuid-1', superadminUser);

      expect(result.id).toBe('wh-uuid-1');
      expect(db.queryOne).not.toHaveBeenCalled();
    });

    it('debe validar ownership para usuarios no-SUPERADMIN', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'tenant-uuid-1' } as any);
      webhooksService.findOne.mockResolvedValue(mockWebhookResponse);

      const result = await controller.findOne('wh-uuid-1', tenantUser);

      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT tenant_id FROM webhook_configs'),
        ['wh-uuid-1'],
      );
      expect(result.id).toBe('wh-uuid-1');
    });

    it('debe lanzar NotFoundException si el webhook no pertenece al tenant', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'tenant-uuid-2' } as any);

      await expect(controller.findOne('wh-uuid-1', tenantUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('debe lanzar NotFoundException si el webhook no existe en BD', async () => {
      db.queryOne.mockResolvedValue(null);

      await expect(controller.findOne('wh-uuid-1', tenantUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('debe lanzar NotFoundException si el webhook no tiene tenant_id', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: null } as any);

      await expect(controller.findOne('wh-uuid-1', tenantUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreateWebhookDto = {
      nombre: 'Nuevo Webhook',
      url: 'https://example.com/hook',
      eventos: ['comprobante.autorizado'],
    };

    it('debe crear un webhook vinculado al tenant del usuario', async () => {
      webhooksService.create.mockResolvedValue({
        ...mockWebhookResponse,
        secreto: 'whsec_newsecret',
      });

      const result = await controller.create(dto, tenantUser);

      expect(result.secreto).toBe('whsec_newsecret');
      expect(webhooksService.create).toHaveBeenCalledWith(dto, 'tenant-uuid-1');
    });

    it('debe validar acceso al emisor cuando dto.emisorId está presente', async () => {
      const dtoWithEmisor = { ...dto, emisorId: 'emisor-uuid-1' };
      webhooksService.create.mockResolvedValue(mockWebhookResponse);

      await controller.create(dtoWithEmisor, tenantUser);

      expect(emisoresService.validateEmisorAccess).toHaveBeenCalledWith(
        'emisor-uuid-1',
        tenantUser,
      );
    });

    it('debe pasar tenantId undefined para SUPERADMIN', async () => {
      webhooksService.create.mockResolvedValue(mockWebhookResponse);

      await controller.create(dto, superadminUser);

      expect(webhooksService.create).toHaveBeenCalledWith(dto, undefined);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    const dto: UpdateWebhookDto = {
      nombre: 'Webhook Actualizado',
      activo: false,
    };

    it('debe actualizar un webhook para SUPERADMIN', async () => {
      webhooksService.update.mockResolvedValue({
        ...mockWebhookResponse,
        nombre: 'Webhook Actualizado',
        activo: false,
      });

      const result = await controller.update('wh-uuid-1', dto, superadminUser);

      expect(result.nombre).toBe('Webhook Actualizado');
      expect(webhooksService.update).toHaveBeenCalledWith('wh-uuid-1', dto);
    });

    it('debe validar ownership antes de actualizar para no-SUPERADMIN', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'tenant-uuid-1' } as any);
      webhooksService.update.mockResolvedValue(mockWebhookResponse);

      await controller.update('wh-uuid-1', dto, tenantUser);

      expect(db.queryOne).toHaveBeenCalled();
      expect(webhooksService.update).toHaveBeenCalledWith('wh-uuid-1', dto);
    });

    it('debe lanzar NotFoundException si no pertenece al tenant', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'other-tenant' } as any);

      await expect(
        controller.update('wh-uuid-1', dto, tenantUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('debe inactivar un webhook para SUPERADMIN', async () => {
      webhooksService.delete.mockResolvedValue({
        ...mockWebhookResponse,
        activo: false,
      });

      const result = await controller.delete('wh-uuid-1', superadminUser);

      expect(result.activo).toBe(false);
      expect(webhooksService.delete).toHaveBeenCalledWith('wh-uuid-1');
    });

    it('debe validar ownership antes de eliminar para no-SUPERADMIN', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'tenant-uuid-1' } as any);
      webhooksService.delete.mockResolvedValue({
        ...mockWebhookResponse,
        activo: false,
      });

      await controller.delete('wh-uuid-1', tenantUser);

      expect(db.queryOne).toHaveBeenCalled();
    });

    it('debe lanzar NotFoundException si no pertenece al tenant', async () => {
      db.queryOne.mockResolvedValue(null);

      await expect(controller.delete('wh-uuid-1', tenantUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── regenerateSecret ──────────────────────────────────────────────────

  describe('regenerateSecret', () => {
    it('debe regenerar el secreto para SUPERADMIN', async () => {
      webhooksService.regenerateSecret.mockResolvedValue({
        ...mockWebhookResponse,
        secreto: 'whsec_newregenerated',
      });

      const result = await controller.regenerateSecret(
        'wh-uuid-1',
        superadminUser,
      );

      expect(result.secreto).toBe('whsec_newregenerated');
    });

    it('debe validar ownership antes de regenerar para no-SUPERADMIN', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'tenant-uuid-1' } as any);
      webhooksService.regenerateSecret.mockResolvedValue(mockWebhookResponse);

      await controller.regenerateSecret('wh-uuid-1', tenantUser);

      expect(db.queryOne).toHaveBeenCalled();
    });

    it('debe lanzar NotFoundException si no pertenece al tenant', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'other' } as any);

      await expect(
        controller.regenerateSecret('wh-uuid-1', tenantUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getLogs ───────────────────────────────────────────────────────────

  describe('getLogs', () => {
    it('debe retornar logs paginados para SUPERADMIN', async () => {
      webhooksService.getLogs.mockResolvedValue(mockLogsResponse);

      const result = await controller.getLogs(
        'wh-uuid-1',
        superadminUser,
        1,
        50,
      );

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(webhooksService.getLogs).toHaveBeenCalledWith('wh-uuid-1', 1, 50);
    });

    it('debe usar valores por defecto si page y limit no se proporcionan', async () => {
      webhooksService.getLogs.mockResolvedValue(mockLogsResponse);

      await controller.getLogs('wh-uuid-1', superadminUser);

      // Number(undefined) || 1 = 1, Number(undefined) || 50 = 50
      expect(webhooksService.getLogs).toHaveBeenCalledWith('wh-uuid-1', 1, 50);
    });

    it('debe validar ownership antes de obtener logs para no-SUPERADMIN', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'tenant-uuid-1' } as any);
      webhooksService.getLogs.mockResolvedValue(mockLogsResponse);

      await controller.getLogs('wh-uuid-1', tenantUser, 2, 10);

      expect(db.queryOne).toHaveBeenCalled();
      expect(webhooksService.getLogs).toHaveBeenCalledWith('wh-uuid-1', 2, 10);
    });

    it('debe lanzar NotFoundException si no pertenece al tenant', async () => {
      db.queryOne.mockResolvedValue({ tenant_id: 'other' } as any);

      await expect(controller.getLogs('wh-uuid-1', tenantUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
