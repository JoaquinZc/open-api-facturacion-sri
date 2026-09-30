import { Test } from '@nestjs/testing';
import { CatalogoValidatorService } from './catalogo-validator.service';
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

  const mockRetencionesRows = [
    {
      tipo: 'RENTA',
      codigo: '312',
      descripcion: 'Servicios profesionales',
      porcentaje: '1.00',
    },
    {
      tipo: 'IVA',
      codigo: '701',
      descripcion: 'Retención IVA 10%',
      porcentaje: '10.00',
    },
    {
      tipo: 'ISD',
      codigo: '451',
      descripcion: 'ISD salida',
      porcentaje: '2.00',
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
    it('debe validar retencion RENTA 312', async () => {
      const result = await service.validateRetencion('RENTA', '312');
      expect(result.valid).toBe(true);
      expect(result.retencion).toBeDefined();
      expect(result.retencion!.descripcion).toBe('Servicios profesionales');
    });

    it('debe validar retencion IVA 701', async () => {
      const result = await service.validateRetencion('IVA', '701');
      expect(result.valid).toBe(true);
      expect(result.retencion!.porcentaje).toBe(10);
    });

    it('debe retornar invalid cuando la retencion no existe', async () => {
      const result = await service.validateRetencion('RENTA', '999');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no encontrado');
    });
  });

  // ── validateRetenciones ───────────────────────────────────────

  describe('validateRetenciones', () => {
    it('debe validar retenciones con tipo RENTA (codigo no empieza con 7 ni 45)', async () => {
      const result = await service.validateRetenciones([
        { codigo: '1', codigoRetencion: '312' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('debe inferir tipo IVA cuando codigoRetencion empieza con 7', async () => {
      const result = await service.validateRetenciones([
        { codigo: '2', codigoRetencion: '701' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('debe inferir tipo ISD cuando codigoRetencion empieza con 45', async () => {
      const result = await service.validateRetenciones([
        { codigo: '6', codigoRetencion: '451' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('debe retornar errors cuando alguna retencion es invalida', async () => {
      const result = await service.validateRetenciones([
        { codigo: '1', codigoRetencion: '312' },
        { codigo: '1', codigoRetencion: '999' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('debe retornar valid true para array vacio', async () => {
      const result = await service.validateRetenciones([]);
      expect(result.valid).toBe(true);
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
    it('debe retornar retenciones filtradas por tipo RENTA', async () => {
      const result = await service.getRetencionesPorTipo('RENTA');
      expect(result).toHaveLength(1);
      expect(result[0].codigo).toBe('312');
    });

    it('debe retornar retenciones filtradas por tipo IVA', async () => {
      const result = await service.getRetencionesPorTipo('IVA');
      expect(result).toHaveLength(1);
      expect(result[0].codigo).toBe('701');
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

      // loadCache hace 6 queries por carga
      const totalQueries = db.query.mock.calls.length;
      expect(totalQueries).toBe(6);
    });

    it('debe recargar cache despues de forceRefreshCache', async () => {
      await service.validateImpuesto('2', '2');
      const queriesAfterFirst = db.query.mock.calls.length;

      await service.forceRefreshCache();
      const queriesAfterRefresh = db.query.mock.calls.length;

      expect(queriesAfterRefresh).toBe(queriesAfterFirst + 6);
    });

    it('debe reutilizar cache entre diferentes validaciones', async () => {
      await service.validateImpuesto('2', '2');
      await service.validateFormaPago('01');
      await service.validateRetencion('RENTA', '312');
      await service.validateTipoIdentificacion('04');

      const totalQueries = db.query.mock.calls.length;
      expect(totalQueries).toBe(6);
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
