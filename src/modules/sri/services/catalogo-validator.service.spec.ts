import { Test } from '@nestjs/testing';
import {
  CatalogoValidatorService,
  valorRetenidoEsperado,
} from './catalogo-validator.service';
import { DatabaseService } from '../../../database/database.service';

describe('CatalogoValidatorService', () => {
  let service: CatalogoValidatorService;
  let db: jest.Mocked<DatabaseService>;

  // ── Mock data ─────────────────────────────────────────────────

  const mockTarifasRows = [
    {
      codigo_porcentaje: '2',
      descripcion: 'IVA 12%',
      porcentaje: '12.00',
      impuesto_codigo: '2',
      impuesto_nombre: 'IVA',
    },
    {
      codigo_porcentaje: '0',
      descripcion: 'IVA 0%',
      porcentaje: '0.00',
      impuesto_codigo: '2',
      impuesto_nombre: 'IVA',
    },
    {
      codigo_porcentaje: '5',
      descripcion: 'IVA 5%',
      porcentaje: '5.00',
      impuesto_codigo: '2',
      impuesto_nombre: 'IVA',
    },
  ];

  // Como las devuelve `loadCache`: fechas ya en texto (`to_char`).
  const mockRetencionesRows = [
    // El 312 cambió el 01-03-2026 (NAC-DGERCGC26-00000009): dos vigencias.
    {
      tipo: 'RENTA',
      codigo: '312',
      descripcion: 'Bienes muebles (tabla 2024)',
      porcentaje: '1.75',
      vigente_desde: '2024-03-01',
      vigente_hasta: '2026-02-28',
    },
    {
      tipo: 'RENTA',
      codigo: '312',
      descripcion: 'Transferencia de bienes muebles de naturaleza corporal',
      porcentaje: '2.00',
      vigente_desde: '2026-03-01',
      vigente_hasta: null,
    },
    // Código de IVA «1» (30 %): el mismo texto que un código de renta posible.
    {
      tipo: 'IVA',
      codigo: '1',
      descripcion: 'Retención 30 % del IVA (bienes)',
      porcentaje: '30.00',
      vigente_desde: '2024-01-01',
      vigente_hasta: null,
    },
    {
      tipo: 'ISD',
      codigo: '4580',
      descripcion: 'Retención ISD',
      porcentaje: '5.00',
      vigente_desde: '2024-01-01',
      vigente_hasta: null,
    },
  ];

  const mockSustentosRows = [
    {
      codigo: '01',
      descripcion: 'Crédito Tributario para declaración de IVA',
      documentos_sustento: ['01', '03', '04', '05'],
      vigente_desde: '2000-01-01',
      vigente_hasta: null,
    },
    {
      codigo: '02',
      descripcion: 'Costo o Gasto para declaración de IR',
      documentos_sustento: ['01', '02', '03'],
      vigente_desde: '2000-01-01',
      vigente_hasta: null,
    },
  ];

  const mockFormasPagoRows = [
    { codigo: '01', descripcion: 'Sin utilización del sistema financiero' },
    { codigo: '16', descripcion: 'Tarjeta de débito' },
    { codigo: '19', descripcion: 'Tarjeta de crédito' },
  ];

  const mockTiposIdentRows = [
    {
      codigo: '04',
      descripcion: 'RUC',
      longitud: 13,
      regex_validacion: '^\\d{13}$',
    },
    {
      codigo: '05',
      descripcion: 'Cédula',
      longitud: 10,
      regex_validacion: '^\\d{10}$',
    },
    {
      codigo: '07',
      descripcion: 'Consumidor Final',
      longitud: 13,
      regex_validacion: null,
    },
  ];

  const mockDocsSustentoRows = [
    { codigo: '01', descripcion: 'Factura' },
    { codigo: '04', descripcion: 'Nota de crédito' },
  ];

  const mockMotivosTrasladoRows = [
    { codigo: '01', descripcion: 'Venta' },
    { codigo: '02', descripcion: 'Compra' },
  ];

  function setupDbMock() {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('catalogo_tarifas_impuesto')) {
        return { rows: mockTarifasRows } as any;
      }
      if (sql.includes('catalogo_retenciones')) {
        return { rows: mockRetencionesRows } as any;
      }
      if (sql.includes('catalogo_formas_pago')) {
        return { rows: mockFormasPagoRows } as any;
      }
      if (sql.includes('catalogo_tipos_identificacion')) {
        return { rows: mockTiposIdentRows } as any;
      }
      if (sql.includes('catalogo_documentos_sustento')) {
        return { rows: mockDocsSustentoRows } as any;
      }
      if (sql.includes('catalogo_motivos_traslado')) {
        return { rows: mockMotivosTrasladoRows } as any;
      }
      if (sql.includes('catalogo_sustento_tributario')) {
        return { rows: mockSustentosRows } as any;
      }
      return { rows: [] } as any;
    });
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogoValidatorService,
        {
          provide: DatabaseService,
          useValue: {
            query: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<CatalogoValidatorService>(CatalogoValidatorService);
    db = moduleRef.get(DatabaseService);
    setupDbMock();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── validateImpuesto ──────────────────────────────────────────

  describe('validateImpuesto', () => {
    it('debe validar impuesto IVA 12% (codigo 2, porcentaje 2)', async () => {
      const result = await service.validateImpuesto('2', '2');
      expect(result.valid).toBe(true);
      expect(result.tarifa).toBeDefined();
      expect(result.tarifa!.descripcion).toBe('IVA 12%');
      expect(result.tarifa!.porcentaje).toBe(12);
    });

    it('debe validar impuesto IVA 0% (codigo 2, porcentaje 0)', async () => {
      const result = await service.validateImpuesto('2', '0');
      expect(result.valid).toBe(true);
      expect(result.tarifa!.porcentaje).toBe(0);
    });

    it('debe retornar invalid cuando el impuesto no existe', async () => {
      const result = await service.validateImpuesto('2', '99');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrado');
    });

    it('debe retornar invalid cuando el codigo de impuesto no existe', async () => {
      const result = await service.validateImpuesto('99', '2');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrado');
    });
  });

  // ── validateImpuestos ─────────────────────────────────────────

  describe('validateImpuestos', () => {
    it('debe validar array con todos los impuestos validos', async () => {
      const result = await service.validateImpuestos([
        { codigo: '2', codigoPorcentaje: '2' },
        { codigo: '2', codigoPorcentaje: '0' },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('debe retornar errors cuando algun impuesto es invalido', async () => {
      const result = await service.validateImpuestos([
        { codigo: '2', codigoPorcentaje: '2' },
        { codigo: '2', codigoPorcentaje: '99' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('no encontrado');
    });

    it('debe retornar valid true para array vacio', async () => {
      const result = await service.validateImpuestos([]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ── validateRetencion ─────────────────────────────────────────

  describe('validateRetencion', () => {
    it('elige la vigencia del día pedido', async () => {
      const antes = await service.validateRetencion(
        'RENTA',
        '312',
        '2026-02-15',
      );
      const despues = await service.validateRetencion(
        'RENTA',
        '312',
        '2026-03-01',
      );
      expect(antes.retencion!.porcentaje).toBe(1.75);
      expect(despues.retencion!.porcentaje).toBe(2);
      expect(despues.retencion!.vigenteDesde).toBe('2026-03-01');
    });

    it('sin fecha, usa la de hoy: el 312 vale el 2 %', async () => {
      const result = await service.validateRetencion('RENTA', '312');
      expect(result.retencion!.porcentaje).toBe(2);
    });

    it('existe pero no está vigente ese día', async () => {
      const result = await service.validateRetencion(
        'RENTA',
        '312',
        '2023-12-31',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no está vigente el 2023-12-31');
    });

    it('debe retornar invalid cuando la retencion no existe', async () => {
      const result = await service.validateRetencion('RENTA', '999');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrado');
    });
  });

  // ── validateRetenciones ───────────────────────────────────────

  describe('validateRetenciones', () => {
    const HOY = '2026-09-30';

    it('el tipo sale de `codigo`, no del prefijo: 2 + «1» es el 30 % del IVA', async () => {
      // Antes «1» no empezaba por 7 y se buscaba como renta: no existía.
      const result = await service.validateRetenciones(
        [
          {
            codigo: '2',
            codigoRetencion: '1',
            baseImponible: 15,
            porcentajeRetener: 30,
            valorRetenido: 4.5,
          },
        ],
        HOY,
      );
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('el mismo «1» como renta no existe', async () => {
      const result = await service.validateRetenciones(
        [{ codigo: '1', codigoRetencion: '1' }],
        HOY,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('de tipo RENTA no encontrado');
    });

    it('ISD por su código 6', async () => {
      const result = await service.validateRetenciones(
        [{ codigo: '6', codigoRetencion: '4580' }],
        HOY,
      );
      expect(result.valid).toBe(true);
    });

    it('rechaza un codigo de impuesto que no es 1, 2 ni 6', async () => {
      const result = await service.validateRetenciones(
        [{ codigo: '3', codigoRetencion: '312' }],
        HOY,
      );
      expect(result.errors[0]).toContain('1 (renta), 2 (IVA) o 6 (ISD)');
    });

    it('rechaza el porcentaje de la tabla derogada', async () => {
      // 312 al 1,75 % era la tabla de 2024; desde el 01-03-2026 es el 2 %.
      const result = await service.validateRetenciones(
        [
          {
            codigo: '1',
            codigoRetencion: '312',
            baseImponible: 100,
            porcentajeRetener: 1.75,
            valorRetenido: 1.75,
          },
        ],
        HOY,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('es 2 %, no 1.75 %');
    });

    it('acepta el porcentaje de la tabla derogada si la fecha es anterior', async () => {
      const result = await service.validateRetenciones(
        [
          {
            codigo: '1',
            codigoRetencion: '312',
            baseImponible: 100,
            porcentajeRetener: 1.75,
            valorRetenido: 1.75,
          },
        ],
        '2026-02-27',
      );
      expect(result.valid).toBe(true);
    });

    it('valorRetenido = base × % / 100, redondeado; tolera un centavo', async () => {
      // 125,90 × 2 % = 2,518 → 2,52.
      const con = (valorRetenido: number) =>
        service.validateRetenciones(
          [
            {
              codigo: '1',
              codigoRetencion: '312',
              baseImponible: 125.9,
              porcentajeRetener: 2,
              valorRetenido,
            },
          ],
          HOY,
        );
      expect((await con(2.52)).valid).toBe(true);
      expect((await con(2.51)).valid).toBe(true);
      expect((await con(2.53)).valid).toBe(true);
      const mal = await con(2.5);
      expect(mal.valid).toBe(false);
      expect(mal.errors[0]).toContain('= 2.52, no 2.5');
    });

    it('debe retornar errors cuando alguna retencion es invalida', async () => {
      const result = await service.validateRetenciones(
        [
          { codigo: '1', codigoRetencion: '312' },
          { codigo: '1', codigoRetencion: '999' },
        ],
        HOY,
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('debe retornar valid true para array vacio', async () => {
      const result = await service.validateRetenciones([]);
      expect(result.valid).toBe(true);
    });
  });

  describe('valorRetenidoEsperado', () => {
    it('redondea la mitad hacia arriba, sin errores de coma flotante', () => {
      // 100,50 × 1 % = 1,005: en coma flotante 1.005 * 100 es 100.4999…
      expect(valorRetenidoEsperado(100.5, 1)).toBe(1.01);
      expect(valorRetenidoEsperado(125.9, 1.75)).toBe(2.2);
      expect(valorRetenidoEsperado(1000, 2)).toBe(20);
      expect(valorRetenidoEsperado(0, 30)).toBe(0);
    });
  });

  // ── validateSustento (Tabla 5) ────────────────────────────────

  describe('validateSustento', () => {
    it('acepta un sustento que admite el documento', async () => {
      const result = await service.validateSustento('01', '01', '2026-09-30');
      expect(result.valid).toBe(true);
    });

    it('rechaza el crédito de IVA (01) sobre una nota de venta (02)', async () => {
      const result = await service.validateSustento('01', '02', '2026-09-30');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no admite el documento 02');
    });

    it('rechaza un sustento que no existe', async () => {
      const result = await service.validateSustento('99', '01', '2026-09-30');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrado');
    });

    it('si la tabla de sustento no existe, el resto de catálogos sigue cargando', async () => {
      db.query.mockImplementation(async (sql: string) => {
        if (sql.includes('catalogo_sustento_tributario')) {
          throw new Error(
            'relation "catalogo_sustento_tributario" does not exist',
          );
        }
        if (sql.includes('catalogo_tarifas_impuesto')) {
          return { rows: mockTarifasRows } as any;
        }
        return { rows: [] } as any;
      });

      expect((await service.validateImpuesto('2', '2')).valid).toBe(true);
      expect((await service.validateSustento('01', '01')).valid).toBe(false);
    });
  });

  // ── validateFormaPago ─────────────────────────────────────────

  describe('validateFormaPago', () => {
    it('debe validar forma de pago 01', async () => {
      const result = await service.validateFormaPago('01');
      expect(result.valid).toBe(true);
      expect(result.formaPago).toBeDefined();
      expect(result.formaPago!.descripcion).toContain('Sin utilización');
    });

    it('debe validar forma de pago 19 (tarjeta crédito)', async () => {
      const result = await service.validateFormaPago('19');
      expect(result.valid).toBe(true);
    });

    it('debe retornar invalid cuando forma de pago no existe', async () => {
      const result = await service.validateFormaPago('99');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrada');
    });
  });

  // ── validateFormasPago ────────────────────────────────────────

  describe('validateFormasPago', () => {
    it('debe validar array con formas de pago validas', async () => {
      const result = await service.validateFormasPago([
        { formaPago: '01' },
        { formaPago: '16' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('debe retornar errors cuando alguna forma de pago es invalida', async () => {
      const result = await service.validateFormasPago([
        { formaPago: '01' },
        { formaPago: '99' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  // ── validateTipoIdentificacion ────────────────────────────────

  describe('validateTipoIdentificacion', () => {
    it('debe validar tipo 04 (RUC)', async () => {
      const result = await service.validateTipoIdentificacion('04');
      expect(result.valid).toBe(true);
      expect(result.tipoIdentificacion!.longitud).toBe(13);
    });

    it('debe validar tipo 05 (Cédula)', async () => {
      const result = await service.validateTipoIdentificacion('05');
      expect(result.valid).toBe(true);
    });

    it('debe retornar invalid cuando tipo no existe', async () => {
      const result = await service.validateTipoIdentificacion('99');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrado');
    });
  });

  // ── validateDocumentoSustento ─────────────────────────────────

  describe('validateDocumentoSustento', () => {
    it('debe validar documento sustento 01 (Factura)', async () => {
      const result = await service.validateDocumentoSustento('01');
      expect(result.valid).toBe(true);
      expect(result.documentoSustento!.descripcion).toBe('Factura');
    });

    it('debe retornar invalid cuando documento sustento no existe', async () => {
      const result = await service.validateDocumentoSustento('99');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrado');
    });
  });

  // ── validateMotivoTraslado ────────────────────────────────────

  describe('validateMotivoTraslado', () => {
    it('debe validar motivo traslado 01 (Venta)', async () => {
      const result = await service.validateMotivoTraslado('01');
      expect(result.valid).toBe(true);
      expect(result.motivoTraslado!.descripcion).toBe('Venta');
    });

    it('debe retornar invalid cuando motivo traslado no existe', async () => {
      const result = await service.validateMotivoTraslado('99');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrado');
    });
  });

  // ── Métodos de consulta (get) ─────────────────────────────────

  describe('getTarifasVigentes', () => {
    it('debe retornar tarifas filtradas por codigo de impuesto', async () => {
      const result = await service.getTarifasVigentes('2');
      expect(result).toHaveLength(3);
      expect(result.every((t) => t.impuesto_codigo === '2')).toBe(true);
    });

    it('debe retornar array vacio cuando no hay tarifas para el impuesto', async () => {
      const result = await service.getTarifasVigentes('99');
      expect(result).toHaveLength(0);
    });
  });

  describe('getRetencionesPorTipo', () => {
    it('debe retornar retenciones filtradas por tipo RENTA, una por código', async () => {
      const result = await service.getRetencionesPorTipo('RENTA');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ codigo: '312', porcentaje: 2 });
    });

    it('a una fecha pasada devuelve la vigencia de entonces', async () => {
      const result = await service.getRetencionesPorTipo('RENTA', '2025-06-01');
      expect(result[0].porcentaje).toBe(1.75);
    });

    it('debe retornar retenciones filtradas por tipo IVA', async () => {
      const result = await service.getRetencionesPorTipo('IVA');
      expect(result).toHaveLength(1);
      expect(result[0].codigo).toBe('1');
    });

    it('incluye el ISD', async () => {
      const result = await service.getRetencionesPorTipo('ISD');
      expect(result.map((r) => r.codigo)).toEqual(['4580']);
    });
  });

  describe('getSustentos', () => {
    it('devuelve los sustentos vigentes con sus documentos', async () => {
      const result = await service.getSustentos();
      expect(result.map((s) => s.codigo)).toEqual(['01', '02']);
      expect(result[1].documentos).toContain('02');
    });
  });

  describe('getFormasPago', () => {
    it('debe retornar todas las formas de pago', async () => {
      const result = await service.getFormasPago();
      expect(result).toHaveLength(3);
    });
  });

  describe('getTiposIdentificacion', () => {
    it('debe retornar todos los tipos de identificacion', async () => {
      const result = await service.getTiposIdentificacion();
      expect(result).toHaveLength(3);
    });
  });

  describe('getDocumentosSustento', () => {
    it('debe retornar todos los documentos sustento', async () => {
      const result = await service.getDocumentosSustento();
      expect(result).toHaveLength(2);
    });
  });

  describe('getMotivosTraslado', () => {
    it('debe retornar todos los motivos traslado', async () => {
      const result = await service.getMotivosTraslado();
      expect(result).toHaveLength(2);
    });
  });

  // ── Cache mechanism ───────────────────────────────────────────

  describe('Cache mechanism', () => {
    it('debe cargar cache solo una vez en llamadas consecutivas', async () => {
      await service.validateImpuesto('2', '2');
      await service.validateImpuesto('2', '2');
      await service.validateImpuesto('2', '2');

      // loadCache hace 7 queries por carga (la 7.ª, el sustento tributario)
      const totalQueries = db.query.mock.calls.length;
      expect(totalQueries).toBe(7);
    });

    it('debe recargar cache despues de forceRefreshCache', async () => {
      await service.validateImpuesto('2', '2');
      const queriesAfterFirst = db.query.mock.calls.length;

      await service.forceRefreshCache();
      const queriesAfterRefresh = db.query.mock.calls.length;

      expect(queriesAfterRefresh).toBe(queriesAfterFirst + 7);
    });

    it('debe reutilizar cache entre diferentes validaciones', async () => {
      await service.validateImpuesto('2', '2');
      await service.validateFormaPago('01');
      await service.validateRetencion('RENTA', '312');
      await service.validateTipoIdentificacion('04');

      const totalQueries = db.query.mock.calls.length;
      expect(totalQueries).toBe(7);
    });
  });

  // ── Error handling en loadCache ───────────────────────────────

  describe('loadCache error handling', () => {
    it('debe propagar error cuando la BD falla', async () => {
      db.query.mockRejectedValueOnce(new Error('DB connection failed'));

      await expect(service.validateImpuesto('2', '2')).rejects.toThrow(
        'DB connection failed',
      );
    });
  });
});
