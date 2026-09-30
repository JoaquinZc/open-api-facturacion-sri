import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PuntosEmisionService } from './puntos-emision.service';
import { DatabaseService } from '../../database/database.service';
import { TipoComprobante } from '../sri/constants';
import {
  CreatePuntoEmisionDto,
  UpdatePuntoEmisionDto,
  UpdateSecuencialDto,
} from './dto';

describe('PuntosEmisionService', () => {
  let service: PuntosEmisionService;
  let db: jest.Mocked<DatabaseService>;

  const mockPuntoRow = {
    id: 'pe-uuid-1',
    emisor_id: 'emisor-uuid-1',
    establecimiento_id: 'est-uuid-1',
    establecimiento: '001',
    punto_emision: '001',
    direccion: 'Av. Principal 123',
    descripcion: 'Caja Principal',
    estado: 'ACTIVO',
    created_at: new Date('2026-01-01'),
  };

  const mockSecuencialRow = {
    id: 'sec-uuid-1',
    punto_emision_id: 'pe-uuid-1',
    tipo_comprobante: '01',
    ultimo_secuencial: '5',
    updated_at: new Date('2026-01-01'),
  };

  const mockClient = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PuntosEmisionService,
        {
          provide: DatabaseService,
          useValue: {
            query: jest.fn(),
            queryOne: jest.fn(),
            transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PuntosEmisionService);
    db = module.get(DatabaseService);

    jest.clearAllMocks();
    mockClient.query.mockReset();
  });

  // ─── findAll ────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('debe retornar puntos de emisión con secuenciales', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any) // SELECT puntos
        .mockResolvedValueOnce({
          rows: [
            { tipo_comprobante: '01', ultimo_secuencial: '5' },
            { tipo_comprobante: '04', ultimo_secuencial: '2' },
          ],
        } as any); // getSecuencialesMap

      const result = await service.findAll('emisor-uuid-1');

      expect(result).toHaveLength(1);
      expect(result[0].establecimiento).toBe('001');
      expect(result[0].puntoEmision).toBe('001');
      expect(result[0].secuenciales).toEqual({ '01': 5, '04': 2 });
    });

    it('debe retornar array vacío si el emisor no tiene puntos', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      const result = await service.findAll('emisor-uuid-1');

      expect(result).toEqual([]);
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('debe retornar un punto de emisión específico', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any) // SELECT punto
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any); // getSecuencialesMap

      const result = await service.findOne('emisor-uuid-1', 'pe-uuid-1');

      expect(result.id).toBe('pe-uuid-1');
      expect(result.secuenciales).toEqual({ '01': 5 });
    });

    it('debe lanzar NotFoundException si no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.findOne('emisor-uuid-1', 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    const createDto: CreatePuntoEmisionDto = {
      establecimiento: '001',
      puntoEmision: '001',
      direccionEstablecimiento: 'Av. Test 123',
      descripcion: 'Caja Principal',
    };

    it('debe crear punto de emisión con establecimiento y secuenciales existentes', async () => {
      // emisor existe
      db.queryOne.mockResolvedValueOnce({ id: 'emisor-uuid-1' } as any);
      // no existe punto previo
      db.queryOne.mockResolvedValueOnce(null);

      // transaction
      db.transaction.mockImplementationOnce(async (callback) => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [{ id: 'est-uuid-1' }] } as any) // SELECT establecimiento
          .mockResolvedValueOnce({ rows: [] } as any) // UPDATE direccion (no-op return)
          .mockResolvedValueOnce({ rows: [{ id: 'pe-uuid-1' }] } as any) // INSERT punto
          .mockResolvedValueOnce({ rows: [] } as any) // INSERT secuencial 01
          .mockResolvedValueOnce({ rows: [] } as any) // INSERT secuencial 04
          .mockResolvedValueOnce({ rows: [] } as any) // INSERT secuencial 05
          .mockResolvedValueOnce({ rows: [] } as any) // INSERT secuencial 06
          .mockResolvedValueOnce({ rows: [] } as any); // INSERT secuencial 07
        return callback(mockClient as any);
      });

      // findOne after create
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any) // SELECT punto
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '0' }],
        } as any); // getSecuencialesMap

      const result = await service.create('emisor-uuid-1', createDto);

      expect(result.id).toBe('pe-uuid-1');
      expect(mockClient.query).toHaveBeenCalledTimes(8); // 1 SELECT + 1 UPDATE + 1 INSERT punto + 5 INSERT secuenciales
    });

    it('debe crear establecimiento nuevo si no existe', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 'emisor-uuid-1' } as any);
      db.queryOne.mockResolvedValueOnce(null);

      db.transaction.mockImplementationOnce(async (callback) => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as any) // SELECT establecimiento → no existe
          .mockResolvedValueOnce({ rows: [{ id: 'est-uuid-new' }] } as any) // INSERT establecimiento
          .mockResolvedValueOnce({ rows: [{ id: 'pe-uuid-1' }] } as any) // INSERT punto
          .mockResolvedValueOnce({ rows: [] } as any)
          .mockResolvedValueOnce({ rows: [] } as any)
          .mockResolvedValueOnce({ rows: [] } as any)
          .mockResolvedValueOnce({ rows: [] } as any)
          .mockResolvedValueOnce({ rows: [] } as any);
        return callback(mockClient as any);
      });

      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '0' }],
        } as any);

      await service.create('emisor-uuid-1', createDto);

      const insertEstabCall = mockClient.query.mock.calls[1];
      const sql = insertEstabCall[0] as string;
      expect(sql).toContain('INSERT INTO establecimientos');
    });

    it('debe lanzar NotFoundException si el emisor no existe', async () => {
      db.queryOne.mockResolvedValueOnce(null);

      await expect(service.create('non-existent', createDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('debe lanzar ConflictException si el punto ya existe', async () => {
      db.queryOne
        .mockResolvedValueOnce({ id: 'emisor-uuid-1' } as any)
        .mockResolvedValueOnce({ id: 'pe-existing' } as any);

      await expect(service.create('emisor-uuid-1', createDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── update ─────────────────────────────────────────────────────────────

  describe('update', () => {
    const updateDto: UpdatePuntoEmisionDto = {
      descripcion: 'Caja Actualizada',
      estado: 'INACTIVO',
      direccionEstablecimiento: 'Nueva Dir 456',
    };

    it('debe actualizar descripción y estado del punto', async () => {
      // findOne (verificar existe)
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any) // SELECT punto
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any); // getSecuencialesMap
      // UPDATE establecimiento direccion
      db.query.mockResolvedValueOnce({ rows: [] } as any);
      // UPDATE punto
      db.query.mockResolvedValueOnce({ rows: [] } as any);
      // findOne (retorno)
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);

      const result = await service.update(
        'emisor-uuid-1',
        'pe-uuid-1',
        updateDto,
      );

      expect(result.id).toBe('pe-uuid-1');
      // Verificar que se actualizó establecimiento
      const estabUpdateCall = db.query.mock.calls[2];
      const estabSql = estabUpdateCall[0] as string;
      expect(estabSql).toContain('UPDATE establecimientos');
    });

    it('debe actualizar solo descripción si no hay direccionEstablecimiento ni estado', async () => {
      const partialDto: UpdatePuntoEmisionDto = { descripcion: 'Nueva desc' };

      // findOne
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);
      // UPDATE punto
      db.query.mockResolvedValueOnce({ rows: [] } as any);
      // findOne retorno
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);

      const result = await service.update(
        'emisor-uuid-1',
        'pe-uuid-1',
        partialDto,
      );

      expect(result.id).toBe('pe-uuid-1');
    });

    it('debe lanzar NotFoundException si el punto no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any); // findOne → no existe

      await expect(
        service.update('emisor-uuid-1', 'non-existent', {
          descripcion: 'test',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── delete ─────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('debe inactivar un punto activo', async () => {
      // findOne
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);
      // UPDATE estado
      db.query.mockResolvedValueOnce({ rows: [] } as any);
      // findOne retorno
      db.query
        .mockResolvedValueOnce({
          rows: [{ ...mockPuntoRow, estado: 'INACTIVO' }],
        } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);

      const result = await service.delete('emisor-uuid-1', 'pe-uuid-1');

      expect(result.estado).toBe('INACTIVO');
      const updateSql = db.query.mock.calls[2][0] as string;
      expect(updateSql).toContain('INACTIVO');
    });

    it('debe lanzar BadRequestException si ya está inactivo', async () => {
      const inactivoRow = { ...mockPuntoRow, estado: 'INACTIVO' };
      db.query
        .mockResolvedValueOnce({ rows: [inactivoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);

      await expect(
        service.delete('emisor-uuid-1', 'pe-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getAllSecuencialesByEmisor ─────────────────────────────────────────

  describe('getAllSecuencialesByEmisor', () => {
    it('debe retornar todos los secuenciales agrupados por punto', async () => {
      const rows = [
        {
          id: 'sec-1',
          punto_emision_id: 'pe-uuid-1',
          tipo_comprobante: '01',
          ultimo_secuencial: '5',
          updated_at: new Date('2026-01-01'),
          establecimiento: '001',
          punto_emision: '001',
        },
        {
          id: 'sec-2',
          punto_emision_id: 'pe-uuid-1',
          tipo_comprobante: '04',
          ultimo_secuencial: '2',
          updated_at: new Date('2026-01-01'),
          establecimiento: '001',
          punto_emision: '001',
        },
      ];
      db.query.mockResolvedValueOnce({ rows } as any);

      const result = await service.getAllSecuencialesByEmisor('emisor-uuid-1');

      expect(result).toHaveLength(2);
      expect(result[0].tipoComprobante).toBe('01');
      expect(result[0].tipoDescripcion).toBe('Factura');
      expect(result[0].proximoSecuencial).toBe(6);
      expect(result[0].establecimiento).toBe('001');
    });

    it('debe retornar "Desconocido" para tipo no reconocido', async () => {
      const rows = [
        {
          id: 'sec-x',
          punto_emision_id: 'pe-uuid-1',
          tipo_comprobante: '99',
          ultimo_secuencial: '0',
          updated_at: new Date('2026-01-01'),
          establecimiento: '001',
          punto_emision: '001',
        },
      ];
      db.query.mockResolvedValueOnce({ rows } as any);

      const result = await service.getAllSecuencialesByEmisor('emisor-uuid-1');

      expect(result[0].tipoDescripcion).toBe('Desconocido');
    });
  });

  // ─── getSecuenciales ────────────────────────────────────────────────────

  describe('getSecuenciales', () => {
    it('debe retornar secuenciales de un punto específico', async () => {
      // findOne (verificar existe)
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);
      // getSecuenciales query
      db.query.mockResolvedValueOnce({
        rows: [
          {
            ...mockSecuencialRow,
            tipo_comprobante: '01',
            ultimo_secuencial: '5',
          },
          {
            ...mockSecuencialRow,
            tipo_comprobante: '04',
            ultimo_secuencial: '2',
          },
        ],
      } as any);

      const result = await service.getSecuenciales(
        'emisor-uuid-1',
        'pe-uuid-1',
      );

      expect(result).toHaveLength(2);
      expect(result[0].tipoComprobante).toBe('01');
      expect(result[0].ultimoSecuencial).toBe(5);
      expect(result[0].proximoSecuencial).toBe(6);
    });

    it('debe lanzar NotFoundException si el punto no existe', async () => {
      db.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.getSecuenciales('emisor-uuid-1', 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateSecuencial ───────────────────────────────────────────────────

  describe('updateSecuencial', () => {
    const updateDto: UpdateSecuencialDto = { ultimoSecuencial: 100 };

    it('debe actualizar el secuencial exitosamente', async () => {
      // findOne (verificar existe)
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);
      // UPDATE secuencial
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'sec-uuid-1',
            punto_emision_id: 'pe-uuid-1',
            tipo_comprobante: '01',
            ultimo_secuencial: '100',
            updated_at: new Date('2026-01-01'),
          },
        ],
      } as any);

      const result = await service.updateSecuencial(
        'emisor-uuid-1',
        'pe-uuid-1',
        '01',
        updateDto,
      );

      expect(result.ultimoSecuencial).toBe(100);
      expect(result.proximoSecuencial).toBe(101);
    });

    it('debe lanzar BadRequestException si el tipo de comprobante es inválido', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);

      await expect(
        service.updateSecuencial('emisor-uuid-1', 'pe-uuid-1', '99', updateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar BadRequestException si el secuencial es negativo', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);

      await expect(
        service.updateSecuencial('emisor-uuid-1', 'pe-uuid-1', '01', {
          ultimoSecuencial: -1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar NotFoundException si el secuencial no existe para el punto', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockPuntoRow] } as any)
        .mockResolvedValueOnce({
          rows: [{ tipo_comprobante: '01', ultimo_secuencial: '5' }],
        } as any);
      db.query.mockResolvedValueOnce({ rows: [] } as any); // UPDATE → no rows

      await expect(
        service.updateSecuencial('emisor-uuid-1', 'pe-uuid-1', '07', updateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── mapToResponse (cobertura indirecta) ────────────────────────────────

  describe('mapToResponse (cobertura indirecta)', () => {
    it('debe mapear correctamente con secuenciales undefined', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockPuntoRow] } as any);
      db.query.mockResolvedValueOnce({ rows: [] } as any); // sin secuenciales

      const result = await service.findAll('emisor-uuid-1');

      expect(result[0].secuenciales).toEqual({});
    });
  });
});
