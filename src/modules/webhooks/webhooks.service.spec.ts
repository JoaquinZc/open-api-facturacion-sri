import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { DatabaseService } from '../../database/database.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let db: jest.Mocked<DatabaseService>;
  let webhookQueue: { add: jest.Mock };

  const mockWebhookRow = {
    id: 'wh-uuid-1',
    nombre: 'Mi Webhook',
    url: 'https://example.com/webhook',
    eventos: ['comprobante.autorizado', 'comprobante.rechazado'],
    emisor_id: 'emisor-uuid-1',
    secreto: 'whsec_abcdefghijklmnopqrstuvwx',
    activo: true,
    reintentos_max: 3,
    tenant_id: 'tenant-uuid-1',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  };

  const mockLogRow = {
    id: 'log-uuid-1',
    evento: 'comprobante.autorizado',
    payload: {
      claveAcceso: '1234567890123456789012345678901234567890123456789',
    },
    status_code: 200,
    respuesta: 'OK',
    intento: 1,
    exitoso: true,
    error: null,
    tiempo_respuesta_ms: 150,
    created_at: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    webhookQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: DatabaseService,
          useValue: {
            query: jest.fn(),
            queryOne: jest.fn(),
          },
        },
        {
          provide: getQueueToken('webhook-dispatch'),
          useValue: webhookQueue,
        },
      ],
    }).compile();

    service = module.get(WebhooksService);
    db = module.get(DatabaseService);
  });

  // ─── Event Listeners ───────────────────────────────────────────────────

  describe('handleComprobanteAutorizado', () => {
    it('debe despachar evento comprobante.autorizado con emisorId del payload', async () => {
      const emitSpy = jest.spyOn(service, 'emit').mockResolvedValue(undefined);
      const payload = { claveAcceso: '1234567890', emisorId: 'emisor-uuid-1' };

      await service.handleComprobanteAutorizado(payload);

      expect(emitSpy).toHaveBeenCalledWith(
        'comprobante.autorizado',
        payload,
        'emisor-uuid-1',
      );
    });
  });

  describe('handleComprobanteRechazado', () => {
    it('debe despachar evento comprobante.rechazado con emisorId del payload', async () => {
      const emitSpy = jest.spyOn(service, 'emit').mockResolvedValue(undefined);
      const payload = { claveAcceso: '1234567890', emisorId: 'emisor-uuid-1' };

      await service.handleComprobanteRechazado(payload);

      expect(emitSpy).toHaveBeenCalledWith(
        'comprobante.rechazado',
        payload,
        'emisor-uuid-1',
      );
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('debe listar todos los webhooks sin filtro de emisor', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('wh-uuid-1');
      expect(result[0].nombre).toBe('Mi Webhook');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM webhook_configs'),
        [],
      );
    });

    it('debe filtrar por emisorId cuando se proporciona', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.findAll('emisor-uuid-1');

      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE emisor_id = $1'),
        ['emisor-uuid-1'],
      );
    });
  });

  // ─── findAllByTenant ───────────────────────────────────────────────────

  describe('findAllByTenant', () => {
    it('debe listar webhooks filtrados por tenant', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.findAllByTenant('tenant-uuid-1');

      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1'),
        ['tenant-uuid-1'],
      );
    });

    it('debe filtrar por tenant y emisor cuando ambos se proporcionan', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      await service.findAllByTenant('tenant-uuid-1', 'emisor-uuid-1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('AND emisor_id = $2'),
        ['tenant-uuid-1', 'emisor-uuid-1'],
      );
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('debe retornar un webhook por ID', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.findOne('wh-uuid-1');

      expect(result.id).toBe('wh-uuid-1');
      expect(result.nombre).toBe('Mi Webhook');
    });

    it('debe lanzar NotFoundException si el webhook no existe', async () => {
      db.query.mockResolvedValue({ rows: [] } as any);

      await expect(service.findOne('non-existent')).rejects.toThrow(
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

    it('debe crear un webhook y retornar con secreto visible', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.create(dto, 'tenant-uuid-1');

      expect(result.id).toBe('wh-uuid-1');
      expect(result.secreto).toMatch(/^whsec_[a-f0-9]+$/);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO webhook_configs'),
        expect.arrayContaining([
          'Nuevo Webhook',
          'https://example.com/hook',
          ['comprobante.autorizado'],
        ]),
      );
    });

    it('debe usar reintentosMax por defecto 3 si no se especifica', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      await service.create(dto);

      const callArgs = db.query.mock.calls[0][1] as any[];
      expect(callArgs).toContain(3);
    });

    it('debe usar reintentosMax del DTO si se especifica', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const dtoWithRetries = { ...dto, reintentosMax: 5 };
      await service.create(dtoWithRetries);

      const callArgs = db.query.mock.calls[0][1] as any[];
      expect(callArgs).toContain(5);
    });

    it('debe enmascarar el secreto en mapToResponse pero retornarlo visible en create', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.create(dto);

      // create retorna secreto visible (no enmascarado)
      expect(result.secreto).toMatch(/^whsec_/);
      expect(result.secreto).not.toContain('*');
    });
  });

  // ─── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    const dto: UpdateWebhookDto = {
      nombre: 'Webhook Actualizado',
      url: 'https://example.com/updated',
    };

    it('debe actualizar campos proporcionados', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any) // findOne
        .mockResolvedValueOnce({
          rows: [{ ...mockWebhookRow, nombre: 'Webhook Actualizado' }],
        } as any); // UPDATE

      const result = await service.update('wh-uuid-1', dto);

      expect(result.nombre).toBe('Webhook Actualizado');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE webhook_configs SET'),
        expect.arrayContaining([
          'Webhook Actualizado',
          'https://example.com/updated',
          'wh-uuid-1',
        ]),
      );
    });

    it('debe actualizar solo activo', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any) // findOne
        .mockResolvedValueOnce({
          rows: [{ ...mockWebhookRow, activo: false }],
        } as any); // UPDATE

      const result = await service.update('wh-uuid-1', { activo: false });

      expect(result.activo).toBe(false);
    });

    it('debe retornar findOne sin UPDATE si no hay campos para actualizar', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.update('wh-uuid-1', {});

      expect(result.id).toBe('wh-uuid-1');
      // Se llama a findOne dos veces (validación inicial + retorno sin UPDATE), no se ejecuta UPDATE
      expect(db.query).toHaveBeenCalledTimes(2);
      // Ninguna llamada debe contener UPDATE
      const allCalls = db.query.mock.calls.map((c) => c[0]);
      expect(allCalls.some((q) => q.includes('UPDATE'))).toBe(false);
    });

    it('debe lanzar NotFoundException si el webhook no existe', async () => {
      db.query.mockResolvedValue({ rows: [] } as any);

      await expect(service.update('non-existent', dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('debe inactivar un webhook activo (soft delete)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any) // findOne
        .mockResolvedValueOnce({
          rows: [{ ...mockWebhookRow, activo: false }],
        } as any); // UPDATE

      const result = await service.delete('wh-uuid-1');

      expect(result.activo).toBe(false);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SET activo = false'),
        ['wh-uuid-1'],
      );
    });

    it('debe lanzar BadRequestException si el webhook ya está inactivo', async () => {
      db.query.mockResolvedValue({
        rows: [{ ...mockWebhookRow, activo: false }],
      } as any);

      await expect(service.delete('wh-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('debe lanzar NotFoundException si el webhook no existe', async () => {
      db.query.mockResolvedValue({ rows: [] } as any);

      await expect(service.delete('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── regenerateSecret ──────────────────────────────────────────────────

  describe('regenerateSecret', () => {
    it('debe regenerar el secreto y retornarlo visible', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any) // findOne
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any); // UPDATE

      const result = await service.regenerateSecret('wh-uuid-1');

      expect(result.secreto).toMatch(/^whsec_[a-f0-9]+$/);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SET secreto = $1'),
        expect.arrayContaining([expect.stringMatching(/^whsec_/), 'wh-uuid-1']),
      );
    });

    it('debe lanzar NotFoundException si el webhook no existe', async () => {
      db.query.mockResolvedValue({ rows: [] } as any);

      await expect(service.regenerateSecret('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getLogs ───────────────────────────────────────────────────────────

  describe('getLogs', () => {
    it('debe retornar logs paginados', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any) // findOne
        .mockResolvedValueOnce({ rows: [{ count: '25' }] } as any) // COUNT
        .mockResolvedValueOnce({ rows: [mockLogRow] } as any); // data

      const result = await service.getLogs('wh-uuid-1', 1, 50);

      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].evento).toBe('comprobante.autorizado');
    });

    it('debe limitar limit a 100 máximo', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any) // findOne
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any) // COUNT
        .mockResolvedValueOnce({ rows: [] } as any); // data

      await service.getLogs('wh-uuid-1', 1, 200);

      // Verificar que el LIMIT en la query usa 100, no 200
      const dataCall = db.query.mock.calls[2];
      expect(dataCall[1]).toContain(100);
    });

    it('debe calcular totalPages correctamente con múltiples páginas', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any)
        .mockResolvedValueOnce({ rows: [{ count: '150' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await service.getLogs('wh-uuid-1', 1, 50);

      expect(result.totalPages).toBe(3);
    });

    it('debe lanzar NotFoundException si el webhook no existe', async () => {
      db.query.mockResolvedValue({ rows: [] } as any);

      await expect(service.getLogs('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── emit (BullMQ dispatch) ────────────────────────────────────────────

  describe('emit', () => {
    it('debe encolar jobs en BullMQ para webhooks suscritos', async () => {
      const configs = [
        {
          id: 'wh-1',
          url: 'https://a.com/hook',
          secreto: 'sec1',
          reintentos_max: 3,
        },
        {
          id: 'wh-2',
          url: 'https://b.com/hook',
          secreto: 'sec2',
          reintentos_max: 5,
        },
      ];
      db.query.mockResolvedValue({ rows: configs } as any);

      await service.emit(
        'comprobante.autorizado',
        { claveAcceso: '123' },
        'emisor-uuid-1',
      );

      expect(webhookQueue.add).toHaveBeenCalledTimes(2);
      expect(webhookQueue.add).toHaveBeenCalledWith(
        'webhook-comprobante.autorizado',
        expect.objectContaining({
          configId: 'wh-1',
          url: 'https://a.com/hook',
          evento: 'comprobante.autorizado',
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
        }),
      );
    });

    it('debe usar attempts=5 por defecto si reintentos_max es null', async () => {
      db.query.mockResolvedValue({
        rows: [
          {
            id: 'wh-1',
            url: 'https://a.com/hook',
            secreto: 'sec1',
            reintentos_max: null,
          },
        ],
      } as any);

      await service.emit('comprobante.rechazado', { claveAcceso: '456' });

      expect(webhookQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ attempts: 5 }),
      );
    });

    it('no debe encolar nada si no hay webhooks suscritos', async () => {
      db.query.mockResolvedValue({ rows: [] } as any);

      await service.emit('comprobante.creado', { claveAcceso: '789' });

      expect(webhookQueue.add).not.toHaveBeenCalled();
    });

    /** El SQL sin espacios repetidos, para comparar condiciones. */
    const sqlDe = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ');

    it('con emisor: el webhook sin emisor solo recibe si es del tenant del emisor', async () => {
      db.query.mockResolvedValue({ rows: [] } as any);

      await service.emit(
        'comprobante.autorizado',
        { data: 'test' },
        'emisor-uuid-1',
      );

      const sql = sqlDe(db.query.mock.calls[0]);
      expect(sql).toContain('emisor_id = $2');
      expect(sql).toContain(
        'emisor_id IS NULL AND tenant_id = (SELECT tenant_id FROM emisores WHERE id = $2)',
      );
      expect(sql).toContain('emisor_id IS NULL AND tenant_id IS NULL');
      // El fallo: «emisor_id IS NULL» a secas abría el evento a todos los
      // webhooks sin emisor, de cualquier tenant.
      expect(sql).not.toMatch(/emisor_id IS NULL OR/);
      expect(db.query.mock.calls[0][1]).toEqual([
        'comprobante.autorizado',
        'emisor-uuid-1',
      ]);
    });

    it('sin emisor: solo los webhooks globales, nunca los de un tenant', async () => {
      db.query.mockResolvedValue({ rows: [] } as any);

      await service.emit('comprobante.anulado', { claveAcceso: '123' });

      const sql = sqlDe(db.query.mock.calls[0]);
      expect(sql).toContain('AND emisor_id IS NULL AND tenant_id IS NULL');
      expect(db.query.mock.calls[0][1]).toEqual(['comprobante.anulado']);
    });
  });

  // ─── Helpers privados (indirectamente via respuestas) ──────────────────

  describe('maskSecret (indirecto)', () => {
    it('debe enmascarar el secreto en respuestas de findAll', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.findAll();

      // El secreto debe estar enmascarado (contiene *)
      expect(result[0].secreto).toContain('*');
      expect(result[0].secreto).not.toBe(mockWebhookRow.secreto);
    });

    it('debe enmascarar el secreto en respuestas de findOne', async () => {
      db.query.mockResolvedValue({ rows: [mockWebhookRow] } as any);

      const result = await service.findOne('wh-uuid-1');

      expect(result.secreto).toContain('*');
    });
  });

  describe('mapLogToResponse (indirecto)', () => {
    it('debe mapear correctamente los campos de log', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockWebhookRow] } as any)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
        .mockResolvedValueOnce({ rows: [mockLogRow] } as any);

      const result = await service.getLogs('wh-uuid-1');

      expect(result.data[0].statusCode).toBe(200);
      expect(result.data[0].exitoso).toBe(true);
      expect(result.data[0].intento).toBe(1);
      expect(result.data[0].tiempoRespuestaMs).toBe(150);
      expect(result.data[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });
});
