import { XmlBuilderService } from './xml-builder.service';
import {
  Factura,
  NotaCredito,
  NotaDebito,
  Retencion,
  GuiaRemision,
  InfoTributaria,
} from '../interfaces';
import {
  TipoComprobante,
  Ambiente,
  TipoEmision,
  TipoIdentificacion,
  FormaPago,
} from '../constants';
import {
  FACTURA_VERSION,
  NOTA_CREDITO_VERSION,
  NOTA_DEBITO_VERSION,
  RETENCION_VERSION,
  GUIA_REMISION_VERSION,
} from '../constants';

describe('XmlBuilderService', () => {
  let service: XmlBuilderService;

  beforeEach(() => {
    service = new XmlBuilderService();
  });

  // ── Fixtures ──────────────────────────────────────────────────

  function createInfoTributaria(
    overrides?: Partial<InfoTributaria>,
  ): InfoTributaria {
    return {
      ambiente: Ambiente.PRUEBAS,
      tipoEmision: TipoEmision.NORMAL,
      razonSocial: 'Empresa Test S.A.',
      nombreComercial: 'TestComercial',
      ruc: '0924383631001',
      claveAcceso: '070220260109243836310011001000000001123456781',
      codDoc: TipoComprobante.FACTURA,
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000001',
      dirMatriz: 'Av. Amazonas 123, Quito',
      ...overrides,
    };
  }

  function createFactura(overrides?: Partial<Factura>): Factura {
    return {
      infoTributaria: createInfoTributaria(),
      infoFactura: {
        fechaEmision: '07/02/2026',
        dirEstablecimiento: 'Av. Amazonas 123, Quito',
        obligadoContabilidad: 'SI',
        tipoIdentificacionComprador: TipoIdentificacion.CEDULA,
        razonSocialComprador: 'Juan Pérez',
        identificacionComprador: '1710034065',
        totalSinImpuestos: 100.0,
        totalDescuento: 0.0,
        totalConImpuestos: [
          {
            codigo: '2',
            codigoPorcentaje: '2',
            baseImponible: 100.0,
            tarifa: 12.0,
            valor: 12.0,
          },
        ],
        importeTotal: 112.0,
        moneda: 'USD',
        pagos: [
          {
            formaPago: FormaPago.SIN_UTILIZACION_SISTEMA_FINANCIERO,
            total: 112.0,
          },
        ],
      },
      detalles: [
        {
          codigoPrincipal: 'PROD001',
          codigoAuxiliar: 'AUX001',
          descripcion: 'Producto de prueba',
          unidadMedida: 'Unidad',
          cantidad: 2,
          precioUnitario: 50.0,
          descuento: 0.0,
          precioTotalSinImpuesto: 100.0,
          impuestos: [
            {
              codigo: '2',
              codigoPorcentaje: '2',
              tarifa: 12.0,
              baseImponible: 100.0,
              valor: 12.0,
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  function createNotaCredito(): NotaCredito {
    return {
      infoTributaria: createInfoTributaria({
        codDoc: TipoComprobante.NOTA_CREDITO,
        claveAcceso: '070220260409243836310011001000000001123456781',
      }),
      infoNotaCredito: {
        fechaEmision: '07/02/2026',
        dirEstablecimiento: 'Av. Amazonas 123, Quito',
        tipoIdentificacionComprador: TipoIdentificacion.CEDULA,
        razonSocialComprador: 'Juan Pérez',
        identificacionComprador: '1710034065',
        obligadoContabilidad: 'SI',
        codDocModificado: '01',
        numDocModificado: '001-001-000000001',
        fechaEmisionDocSustento: '01/02/2026',
        totalSinImpuestos: 100.0,
        valorModificacion: 112.0,
        moneda: 'USD',
        totalConImpuestos: [
          {
            codigo: '2',
            codigoPorcentaje: '2',
            baseImponible: 100.0,
            valor: 12.0,
          },
        ],
        motivo: 'Devolución de producto',
      },
      detalles: [
        {
          codigoInterno: 'PROD001',
          descripcion: 'Producto devuelto',
          cantidad: 1,
          precioUnitario: 100.0,
          descuento: 0.0,
          precioTotalSinImpuesto: 100.0,
          impuestos: [
            {
              codigo: '2',
              codigoPorcentaje: '2',
              tarifa: 12.0,
              baseImponible: 100.0,
              valor: 12.0,
            },
          ],
        },
      ],
    };
  }

  function createNotaDebito(): NotaDebito {
    return {
      infoTributaria: createInfoTributaria({
        codDoc: TipoComprobante.NOTA_DEBITO,
        claveAcceso: '070220260509243836310011001000000001123456781',
      }),
      infoNotaDebito: {
        fechaEmision: '07/02/2026',
        dirEstablecimiento: 'Av. Amazonas 123, Quito',
        tipoIdentificacionComprador: TipoIdentificacion.CEDULA,
        razonSocialComprador: 'Juan Pérez',
        identificacionComprador: '1710034065',
        obligadoContabilidad: 'SI',
        codDocModificado: '01',
        numDocModificado: '001-001-000000001',
        fechaEmisionDocSustento: '01/02/2026',
        totalSinImpuestos: 100.0,
        impuestos: [
          {
            codigo: '2',
            codigoPorcentaje: '2',
            baseImponible: 100.0,
            tarifa: 12.0,
            valor: 12.0,
          },
        ],
        valorTotal: 112.0,
      },
      motivos: [{ razon: 'Interés por mora', valor: 12.0 }],
    };
  }

  function createRetencion(): Retencion {
    return {
      infoTributaria: createInfoTributaria({
        codDoc: TipoComprobante.COMPROBANTE_RETENCION,
        claveAcceso: '070220260709243836310011001000000001123456781',
      }),
      infoCompRetencion: {
        fechaEmision: '07/02/2026',
        dirEstablecimiento: 'Av. Amazonas 123, Quito',
        obligadoContabilidad: 'SI',
        tipoIdentificacionSujetoRetenido: TipoIdentificacion.RUC,
        razonSocialSujetoRetenido: 'Proveedor S.A.',
        identificacionSujetoRetenido: '0991234567001',
        periodoFiscal: '02/2026',
      },
      impuestos: [
        {
          codigo: '1',
          codigoRetencion: '312',
          baseImponible: 1000.0,
          porcentajeRetener: 1.0,
          valorRetenido: 10.0,
          codDocSustento: '01',
          codSustento: '01',
          numDocSustento: '001-001-000000001',
          fechaEmisionDocSustento: '01/02/2026',
          totalSinImpuestos: 1000.0,
          importeTotal: 1120.0,
          pagoLocExt: '01',
          formaPago: '01',
          impuestosDocSustento: [
            {
              codImpuestoDocSustento: '2',
              codigoPorcentaje: '2',
              baseImponible: 1000.0,
              tarifa: 12.0,
              valorImpuesto: 120.0,
            },
          ],
        },
      ],
    };
  }

  function createGuiaRemision(): GuiaRemision {
    return {
      infoTributaria: createInfoTributaria({
        codDoc: TipoComprobante.GUIA_REMISION,
        claveAcceso: '070220260609243836310011001000000001123456781',
      }),
      infoGuiaRemision: {
        dirEstablecimiento: 'Av. Amazonas 123, Quito',
        dirPartida: 'Bodega Central, Quito',
        razonSocialTransportista: 'Transportes Rápidos Cía. Ltda.',
        tipoIdentificacionTransportista: TipoIdentificacion.RUC,
        rucTransportista: '0991234567001',
        obligadoContabilidad: 'SI',
        fechaIniTransporte: '07/02/2026',
        fechaFinTransporte: '10/02/2026',
        placa: 'ABC-123',
      },
      destinatarios: [
        {
          tipoIdentificacionDestinatario: '05',
          identificacionDestinatario: '1710034065',
          razonSocialDestinatario: 'Juan Pérez',
          dirDestinatario: 'Av. Eloy Alfaro 456, Guayaquil',
          motivoTraslado: '01',
          detalles: [
            {
              codigoInterno: 'PROD001',
              descripcion: 'Producto transportado',
              cantidad: 10,
            },
          ],
        },
      ],
    };
  }

  // ── buildFactura ──────────────────────────────────────────────

  describe('buildFactura', () => {
    it('debe generar XML válido con declaración y encoding UTF-8', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    });

    it('debe incluir elemento raiz factura con version correcta', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<factura');
      expect(xml).toContain(`version="${FACTURA_VERSION}"`);
      expect(xml).toContain('id="comprobante"');
    });

    it('debe incluir infoTributaria con todos los campos', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<ambiente>1</ambiente>');
      expect(xml).toContain('<tipoEmision>1</tipoEmision>');
      expect(xml).toContain('<razonSocial>Empresa Test S.A.</razonSocial>');
      expect(xml).toContain('<nombreComercial>TestComercial</nombreComercial>');
      expect(xml).toContain('<ruc>0924383631001</ruc>');
      expect(xml).toContain('<codDoc>01</codDoc>');
      expect(xml).toContain('<estab>001</estab>');
      expect(xml).toContain('<ptoEmi>001</ptoEmi>');
      expect(xml).toContain('<secuencial>000000001</secuencial>');
      expect(xml).toContain('<dirMatriz>Av. Amazonas 123, Quito</dirMatriz>');
    });

    it('debe incluir infoTributaria sin nombreComercial cuando no se proporciona', () => {
      const factura = createFactura();
      factura.infoTributaria.nombreComercial = undefined;
      const xml = service.buildFactura(factura);
      expect(xml).not.toContain('<nombreComercial>');
    });

    it('debe incluir infoTributaria con agenteRetencion cuando se proporciona', () => {
      const factura = createFactura();
      factura.infoTributaria.agenteRetencion = '123';
      const xml = service.buildFactura(factura);
      expect(xml).toContain('<agenteRetencion>123</agenteRetencion>');
    });

    it('debe incluir infoTributaria con contribuyenteRimpe cuando se proporciona', () => {
      const factura = createFactura();
      factura.infoTributaria.contribuyenteRimpe = 'CONTRIBUYENTE RÉGIMEN RIMPE';
      const xml = service.buildFactura(factura);
      expect(xml).toContain(
        '<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>',
      );
    });

    it('debe incluir infoFactura con campos obligatorios', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<fechaEmision>07/02/2026</fechaEmision>');
      expect(xml).toContain('<obligadoContabilidad>SI</obligadoContabilidad>');
      expect(xml).toContain(
        '<tipoIdentificacionComprador>05</tipoIdentificacionComprador>',
      );
      expect(xml).toContain(
        '<razonSocialComprador>Juan Pérez</razonSocialComprador>',
      );
      expect(xml).toContain(
        '<identificacionComprador>1710034065</identificacionComprador>',
      );
    });

    it('debe formatear decimales con 2 posiciones para totales', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<totalSinImpuestos>100.00</totalSinImpuestos>');
      expect(xml).toContain('<totalDescuento>0.00</totalDescuento>');
      expect(xml).toContain('<importeTotal>112.00</importeTotal>');
    });

    it('debe formatear cantidad y precioUnitario con 6 decimales', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<cantidad>2.000000</cantidad>');
      expect(xml).toContain('<precioUnitario>50.000000</precioUnitario>');
    });

    it('debe incluir totalConImpuestos con estructura correcta', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<totalConImpuestos>');
      expect(xml).toContain('<totalImpuesto>');
      expect(xml).toContain('<codigo>2</codigo>');
      expect(xml).toContain('<codigoPorcentaje>2</codigoPorcentaje>');
      expect(xml).toContain('<baseImponible>100.00</baseImponible>');
      expect(xml).toContain('<tarifa>12.00</tarifa>');
      expect(xml).toContain('<valor>12.00</valor>');
    });

    it('debe incluir pagos con formaPago y total', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<pagos>');
      expect(xml).toContain('<formaPago>01</formaPago>');
      expect(xml).toContain('<total>112.00</total>');
    });

    it('debe incluir plazo y unidadTiempo cuando se proporciona', () => {
      const factura = createFactura();
      factura.infoFactura.pagos[0].plazo = 30;
      factura.infoFactura.pagos[0].unidadTiempo = 'dias';
      const xml = service.buildFactura(factura);
      expect(xml).toContain('<plazo>30</plazo>');
      expect(xml).toContain('<unidadTiempo>dias</unidadTiempo>');
    });

    it('debe incluir dirección del comprador cuando se proporciona', () => {
      const factura = createFactura();
      factura.infoFactura.direccionComprador = 'Av. Eloy Alfaro 456';
      const xml = service.buildFactura(factura);
      expect(xml).toContain(
        '<direccionComprador>Av. Eloy Alfaro 456</direccionComprador>',
      );
    });

    it('debe incluir propina cuando se proporciona', () => {
      const factura = createFactura();
      factura.infoFactura.propina = 5.0;
      const xml = service.buildFactura(factura);
      expect(xml).toContain('<propina>5.00</propina>');
    });

    it('debe incluir moneda cuando se proporciona', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<moneda>USD</moneda>');
    });

    it('debe incluir detalles con codigoAuxiliar cuando se proporciona', () => {
      const xml = service.buildFactura(createFactura());
      expect(xml).toContain('<codigoAuxiliar>AUX001</codigoAuxiliar>');
    });

    it('debe incluir detallesAdicionales cuando se proporcionan', () => {
      const factura = createFactura();
      factura.detalles[0].detallesAdicionales = [
        { nombre: 'color', valor: 'rojo' },
      ];
      const xml = service.buildFactura(factura);
      expect(xml).toContain('<detallesAdicionales>');
      expect(xml).toContain('nombre="color"');
      expect(xml).toContain('valor="rojo"');
    });

    it('debe incluir retenciones cuando se proporcionan', () => {
      const factura = createFactura();
      factura.retenciones = [
        { codigo: '1', codigoPorcentaje: '312', tarifa: 1.0, valor: 10.0 },
      ];
      const xml = service.buildFactura(factura);
      expect(xml).toContain('<retenciones>');
      expect(xml).toContain('<retencion>');
      expect(xml).toContain('<codigo>1</codigo>');
      expect(xml).toContain('<valor>10.00</valor>');
    });

    it('debe incluir infoAdicional cuando se proporciona', () => {
      const factura = createFactura();
      factura.infoAdicional = [{ nombre: 'email', valor: 'juan@test.com' }];
      const xml = service.buildFactura(factura);
      expect(xml).toContain('<infoAdicional>');
      expect(xml).toContain('nombre="email"');
      expect(xml).toContain('juan@test.com');
    });

    it('debe incluir contribuyenteEspecial cuando se proporciona', () => {
      const factura = createFactura();
      factura.infoFactura.contribuyenteEspecial = '12345';
      const xml = service.buildFactura(factura);
      expect(xml).toContain(
        '<contribuyenteEspecial>12345</contribuyenteEspecial>',
      );
    });

    it('debe incluir guiaRemision cuando se proporciona', () => {
      const factura = createFactura();
      factura.infoFactura.guiaRemision = '001-001-000000001';
      const xml = service.buildFactura(factura);
      expect(xml).toContain('<guiaRemision>001-001-000000001</guiaRemision>');
    });
  });

  // ── buildNotaCredito ──────────────────────────────────────────

  describe('buildNotaCredito', () => {
    it('debe generar XML con elemento raiz notaCredito y version correcta', () => {
      const xml = service.buildNotaCredito(createNotaCredito());
      expect(xml).toContain('<notaCredito');
      expect(xml).toContain(`version="${NOTA_CREDITO_VERSION}"`);
    });

    it('debe incluir infoNotaCredito con campos obligatorios', () => {
      const xml = service.buildNotaCredito(createNotaCredito());
      expect(xml).toContain('<fechaEmision>07/02/2026</fechaEmision>');
      expect(xml).toContain('<codDocModificado>01</codDocModificado>');
      expect(xml).toContain(
        '<numDocModificado>001-001-000000001</numDocModificado>',
      );
      expect(xml).toContain(
        '<fechaEmisionDocSustento>01/02/2026</fechaEmisionDocSustento>',
      );
      expect(xml).toContain('<motivo>Devolución de producto</motivo>');
    });

    it('debe incluir valorModificacion formateado a 2 decimales', () => {
      const xml = service.buildNotaCredito(createNotaCredito());
      expect(xml).toContain('<valorModificacion>112.00</valorModificacion>');
    });

    it('debe incluir detalles con codigoInterno', () => {
      const xml = service.buildNotaCredito(createNotaCredito());
      expect(xml).toContain('<codigoInterno>PROD001</codigoInterno>');
    });

    it('debe incluir infoAdicional cuando se proporciona', () => {
      const nc = createNotaCredito();
      nc.infoAdicional = [{ nombre: 'email', valor: 'test@test.com' }];
      const xml = service.buildNotaCredito(nc);
      expect(xml).toContain('<infoAdicional>');
      expect(xml).toContain('nombre="email"');
    });

    it('debe incluir rise cuando se proporciona', () => {
      const nc = createNotaCredito();
      nc.infoNotaCredito.rise = '123456';
      const xml = service.buildNotaCredito(nc);
      expect(xml).toContain('<rise>123456</rise>');
    });
  });

  // ── buildNotaDebito ───────────────────────────────────────────

  describe('buildNotaDebito', () => {
    it('debe generar XML con elemento raiz notaDebito y version correcta', () => {
      const xml = service.buildNotaDebito(createNotaDebito());
      expect(xml).toContain('<notaDebito');
      expect(xml).toContain(`version="${NOTA_DEBITO_VERSION}"`);
    });

    it('debe incluir infoNotaDebito con campos obligatorios', () => {
      const xml = service.buildNotaDebito(createNotaDebito());
      expect(xml).toContain('<fechaEmision>07/02/2026</fechaEmision>');
      expect(xml).toContain('<codDocModificado>01</codDocModificado>');
      expect(xml).toContain(
        '<numDocModificado>001-001-000000001</numDocModificado>',
      );
      expect(xml).toContain('<valorTotal>112.00</valorTotal>');
    });

    it('debe incluir motivos con razon y valor', () => {
      const xml = service.buildNotaDebito(createNotaDebito());
      expect(xml).toContain('<motivos>');
      expect(xml).toContain('<motivo>');
      expect(xml).toContain('<razon>Interés por mora</razon>');
      expect(xml).toContain('<valor>12.00</valor>');
    });

    it('debe incluir impuestos en infoNotaDebito', () => {
      const xml = service.buildNotaDebito(createNotaDebito());
      expect(xml).toContain('<impuestos>');
      expect(xml).toContain('<codigo>2</codigo>');
      expect(xml).toContain('<valor>12.00</valor>');
    });

    it('debe incluir infoAdicional cuando se proporciona', () => {
      const nd = createNotaDebito();
      nd.infoAdicional = [{ nombre: 'nota', valor: 'texto adicional' }];
      const xml = service.buildNotaDebito(nd);
      expect(xml).toContain('<infoAdicional>');
      expect(xml).toContain('nombre="nota"');
    });
  });

  // ── buildRetencion ────────────────────────────────────────────

  describe('buildRetencion', () => {
    it('debe generar XML con elemento raiz comprobanteRetencion y version correcta', () => {
      const xml = service.buildRetencion(createRetencion());
      expect(xml).toContain('<comprobanteRetencion');
      expect(xml).toContain(`version="${RETENCION_VERSION}"`);
    });

    it('debe incluir infoCompRetencion con campos obligatorios', () => {
      const xml = service.buildRetencion(createRetencion());
      expect(xml).toContain('<fechaEmision>07/02/2026</fechaEmision>');
      expect(xml).toContain(
        '<tipoIdentificacionSujetoRetenido>04</tipoIdentificacionSujetoRetenido>',
      );
      expect(xml).toContain(
        '<razonSocialSujetoRetenido>Proveedor S.A.</razonSocialSujetoRetenido>',
      );
      expect(xml).toContain(
        '<identificacionSujetoRetenido>0991234567001</identificacionSujetoRetenido>',
      );
      expect(xml).toContain('<periodoFiscal>02/2026</periodoFiscal>');
    });

    it('debe incluir parteRel con valor por defecto NO', () => {
      const xml = service.buildRetencion(createRetencion());
      expect(xml).toContain('<parteRel>NO</parteRel>');
    });

    it('debe incluir docsSustento con docSustento', () => {
      const xml = service.buildRetencion(createRetencion());
      expect(xml).toContain('<docsSustento>');
      expect(xml).toContain('<docSustento>');
      expect(xml).toContain('<codDocSustento>01</codDocSustento>');
      expect(xml).toContain('<numDocSustento>001001000000001</numDocSustento>');
    });

    it('debe incluir retenciones dentro de docSustento', () => {
      const xml = service.buildRetencion(createRetencion());
      expect(xml).toContain('<retenciones>');
      expect(xml).toContain('<codigoRetencion>312</codigoRetencion>');
      expect(xml).toContain('<porcentajeRetener>1.00</porcentajeRetener>');
      expect(xml).toContain('<valorRetenido>10.00</valorRetenido>');
    });

    it('debe incluir impuestosDocSustento', () => {
      const xml = service.buildRetencion(createRetencion());
      expect(xml).toContain('<impuestosDocSustento>');
      expect(xml).toContain(
        '<codImpuestoDocSustento>2</codImpuestoDocSustento>',
      );
      expect(xml).toContain('<valorImpuesto>120.00</valorImpuesto>');
    });

    it('debe incluir pagos dentro de docSustento', () => {
      const xml = service.buildRetencion(createRetencion());
      expect(xml).toContain('<pagos>');
      expect(xml).toContain('<formaPago>01</formaPago>');
    });

    it('debe lanzar BadRequestException cuando tipoIdentificacion es 08 sin tipoSujetoRetenido', () => {
      const ret = createRetencion();
      ret.infoCompRetencion.tipoIdentificacionSujetoRetenido =
        '08' as TipoIdentificacion;
      ret.infoCompRetencion.tipoSujetoRetenido = undefined;
      expect(() => service.buildRetencion(ret)).toThrow(
        'tipoSujetoRetenido es requerido',
      );
    });

    it('debe incluir tipoSujetoRetenido cuando tipoIdentificacion es 08', () => {
      const ret = createRetencion();
      ret.infoCompRetencion.tipoIdentificacionSujetoRetenido =
        '08' as TipoIdentificacion;
      ret.infoCompRetencion.tipoSujetoRetenido = '01';
      const xml = service.buildRetencion(ret);
      expect(xml).toContain('<tipoSujetoRetenido>01</tipoSujetoRetenido>');
    });

    it('debe incluir infoAdicional cuando se proporciona', () => {
      const ret = createRetencion();
      ret.infoAdicional = [{ nombre: 'email', valor: 'test@test.com' }];
      const xml = service.buildRetencion(ret);
      expect(xml).toContain('<infoAdicional>');
      expect(xml).toContain('nombre="email"');
    });
  });

  // ── buildGuiaRemision ─────────────────────────────────────────

  describe('buildGuiaRemision', () => {
    it('debe generar XML con elemento raiz guiaRemision y version correcta', () => {
      const xml = service.buildGuiaRemision(createGuiaRemision());
      expect(xml).toContain('<guiaRemision');
      expect(xml).toContain(`version="${GUIA_REMISION_VERSION}"`);
    });

    it('debe incluir infoGuiaRemision con campos obligatorios', () => {
      const xml = service.buildGuiaRemision(createGuiaRemision());
      expect(xml).toContain('<dirPartida>Bodega Central, Quito</dirPartida>');
      expect(xml).toContain(
        '<razonSocialTransportista>Transportes Rápidos Cía. Ltda.</razonSocialTransportista>',
      );
      expect(xml).toContain(
        '<rucTransportista>0991234567001</rucTransportista>',
      );
      expect(xml).toContain(
        '<fechaIniTransporte>07/02/2026</fechaIniTransporte>',
      );
      expect(xml).toContain(
        '<fechaFinTransporte>10/02/2026</fechaFinTransporte>',
      );
      expect(xml).toContain('<placa>ABC-123</placa>');
    });

    it('debe incluir destinatarios con detalles', () => {
      const xml = service.buildGuiaRemision(createGuiaRemision());
      expect(xml).toContain('<destinatarios>');
      expect(xml).toContain('<destinatario>');
      expect(xml).toContain(
        '<identificacionDestinatario>1710034065</identificacionDestinatario>',
      );
      expect(xml).toContain('<motivoTraslado>01</motivoTraslado>');
    });

    it('debe incluir detalles del destinatario con cantidad formateada a 6 decimales', () => {
      const xml = service.buildGuiaRemision(createGuiaRemision());
      expect(xml).toContain('<cantidad>10.000000</cantidad>');
      expect(xml).toContain('<descripcion>Producto transportado</descripcion>');
    });

    it('debe incluir campos opcionales del destinatario cuando se proporcionan', () => {
      const gr = createGuiaRemision();
      gr.destinatarios[0].docAduaneroUnico = 'ABC123';
      gr.destinatarios[0].ruta = 'Quito-Guayaquil';
      gr.destinatarios[0].codEstabDestino = '002';
      const xml = service.buildGuiaRemision(gr);
      expect(xml).toContain('<docAduaneroUnico>ABC123</docAduaneroUnico>');
      expect(xml).toContain('<ruta>Quito-Guayaquil</ruta>');
      expect(xml).toContain('<codEstabDestino>002</codEstabDestino>');
    });

    it('debe incluir infoAdicional cuando se proporciona', () => {
      const gr = createGuiaRemision();
      gr.infoAdicional = [{ nombre: 'observacion', valor: 'Entrega urgente' }];
      const xml = service.buildGuiaRemision(gr);
      expect(xml).toContain('<infoAdicional>');
      expect(xml).toContain('nombre="observacion"');
    });

    it('debe incluir rise cuando se proporciona', () => {
      const gr = createGuiaRemision();
      gr.infoGuiaRemision.rise = '123456';
      const xml = service.buildGuiaRemision(gr);
      expect(xml).toContain('<rise>123456</rise>');
    });

    it('debe incluir contribuyenteEspecial cuando se proporciona', () => {
      const gr = createGuiaRemision();
      gr.infoGuiaRemision.contribuyenteEspecial = '789';
      const xml = service.buildGuiaRemision(gr);
      expect(xml).toContain(
        '<contribuyenteEspecial>789</contribuyenteEspecial>',
      );
    });
  });

  // ── parseXml ──────────────────────────────────────────────────

  describe('parseXml', () => {
    it('debe parsear XML generado y retornar objeto con estructura correcta', async () => {
      const xml = service.buildFactura(createFactura());
      const parsed = await service.parseXml<any>(xml);
      expect(parsed.factura).toBeDefined();
      expect(parsed.factura.$.version).toBe(FACTURA_VERSION);
      expect(parsed.factura.infoTributaria.ruc).toBe('0924383631001');
    });

    it('debe preservar atributos al parsear', async () => {
      const xml = service.buildFactura(createFactura());
      const parsed = await service.parseXml<any>(xml);
      expect(parsed.factura.$.id).toBe('comprobante');
    });

    it('debe retornar detalles como array al parsear', async () => {
      const xml = service.buildFactura(createFactura());
      const parsed = await service.parseXml<any>(xml);
      expect(parsed.factura.detalles).toBeDefined();
      expect(parsed.factura.detalles.detalle).toBeDefined();
    });
  });
});
