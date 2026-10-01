import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClaveAccesoService } from './clave-acceso.service';
import {
  ComprobantesRecibidosService,
  fechaSriADia,
} from './comprobantes-recibidos.service';
import type { SriSoapClient } from './sri-soap.client';

const claves = new ClaveAccesoService();

/** Una clave válida: los 48 primeros dígitos y el verificador que cuadre. */
function claveValida(base48: string): string {
  for (let d = 0; d <= 9; d++) {
    if (claves.validate(base48 + d)) return base48 + d;
  }
  throw new Error('sin verificador');
}

// 30/09/2026 · factura 01 · RUC del proveedor · producción · 001-002-000000123
const CLAVE = claveValida('300920260117900123450012001002000000123123456781');

/** El XML autorizado de una factura 1.1.0 de un proveedor, recortado a lo que se lee. */
const XML_FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.1.0">
  <infoTributaria>
    <ambiente>2</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>LACTEOS DEL VALLE S.A.</razonSocial>
    <nombreComercial>EL VALLE</nombreComercial>
    <ruc>1790012345001</ruc>
    <claveAcceso>${CLAVE}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>001</estab>
    <ptoEmi>002</ptoEmi>
    <secuencial>000000123</secuencial>
    <dirMatriz>QUITO</dirMatriz>
    <agenteRetencion>1</agenteRetencion>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>30/09/2026</fechaEmision>
    <obligadoContabilidad>SI</obligadoContabilidad>
    <tipoIdentificacionComprador>04</tipoIdentificacionComprador>
    <razonSocialComprador>SABOR ANDINO S.A.S.</razonSocialComprador>
    <identificacionComprador>1791234567001</identificacionComprador>
    <totalSinImpuestos>110.00</totalSinImpuestos>
    <totalDescuento>0.00</totalDescuento>
    <totalConImpuestos>
      <totalImpuesto>
        <codigo>2</codigo>
        <codigoPorcentaje>4</codigoPorcentaje>
        <baseImponible>100.00</baseImponible>
        <valor>15.00</valor>
      </totalImpuesto>
      <totalImpuesto>
        <codigo>2</codigo>
        <codigoPorcentaje>0</codigoPorcentaje>
        <baseImponible>10.00</baseImponible>
        <tarifa>0</tarifa>
        <valor>0.00</valor>
      </totalImpuesto>
    </totalConImpuestos>
    <propina>0.00</propina>
    <importeTotal>125.00</importeTotal>
    <moneda>DOLAR</moneda>
    <pagos>
      <pago>
        <formaPago>20</formaPago>
        <total>125.00</total>
        <plazo>30</plazo>
        <unidadTiempo>dias</unidadTiempo>
      </pago>
    </pagos>
  </infoFactura>
</factura>`;

function servicio(respuesta: unknown) {
  const autorizarComprobante = jest.fn(() =>
    respuesta instanceof Error
      ? Promise.reject(respuesta)
      : Promise.resolve(respuesta),
  );
  const soap = { autorizarComprobante } as unknown as SriSoapClient;
  return {
    autorizarComprobante,
    svc: new ComprobantesRecibidosService(soap, claves),
  };
}

const AUTORIZADA = {
  estado: 'AUTORIZADO',
  numeroAutorizacion: CLAVE,
  fechaAutorizacion: '2026-09-30T10:15:00-05:00',
  ambiente: 'PRODUCCIÓN',
  comprobante: XML_FACTURA,
};

describe('🔴 Comprobantes recibidos: leer del SRI la factura de un proveedor (retenciones R2)', () => {
  it('lee número, fecha (como día), comprador, bases por tarifa y forma de pago', async () => {
    const { svc } = servicio({ autorizaciones: { autorizacion: AUTORIZADA } });

    const f = await svc.consultar(CLAVE);

    expect(f).toMatchObject({
      claveAcceso: CLAVE,
      numeroAutorizacion: CLAVE,
      ambiente: '2',
      codDoc: '01',
      numero: '001-002-000000123',
      fechaEmision: '2026-09-30',
      emisor: { ruc: '1790012345001', razonSocial: 'LACTEOS DEL VALLE S.A.' },
      comprador: { identificacion: '1791234567001', tipoIdentificacion: '04' },
      totalSinImpuestos: 110,
      importeTotal: 125,
      pagos: [{ formaPago: '20', total: 125, plazo: 30, unidadTiempo: 'dias' }],
    });
    // Sin <tarifa>, el porcentaje sale del código (Tabla 17: 4 = 15 %).
    expect(f.impuestos).toEqual([
      {
        codigo: '2',
        codigoPorcentaje: '4',
        tarifa: 15,
        baseImponible: 100,
        valor: 15,
      },
      {
        codigo: '2',
        codigoPorcentaje: '0',
        tarifa: 0,
        baseImponible: 10,
        valor: 0,
      },
    ]);
    expect(f.xml).toBe(XML_FACTURA);
  });

  it('una clave reenviada trae un rechazo y la autorización: manda la autorizada', async () => {
    const { svc } = servicio({
      autorizaciones: {
        autorizacion: [
          { estado: 'NO AUTORIZADO', ambiente: 'PRODUCCIÓN' },
          AUTORIZADA,
        ],
      },
    });

    await expect(svc.consultar(CLAVE)).resolves.toMatchObject({
      numero: '001-002-000000123',
    });
  });

  it('una clave mal escrita no llega al SRI', async () => {
    const { svc, autorizarComprobante } = servicio({});
    const mala = CLAVE.slice(0, 48) + ((Number(CLAVE[48]) + 1) % 10);

    await expect(svc.consultar(mala)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(autorizarComprobante).not.toHaveBeenCalled();
  });

  it('el SRI no la tiene: 404; no la autorizó: 409', async () => {
    await expect(
      servicio({ autorizaciones: undefined }).svc.consultar(CLAVE),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      servicio({
        autorizaciones: {
          autorizacion: { estado: 'NO AUTORIZADO', ambiente: '2' },
        },
      }).svc.consultar(CLAVE),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('🔴 el SRI caído no es «no existe»: 503', async () => {
    await expect(
      servicio(new Error('ETIMEDOUT')).svc.consultar(CLAVE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('una clave de otro tipo de comprobante no se lee como factura', async () => {
    const claveNc = claveValida(
      '300920260417900123450012001002000000123123456781',
    );
    const { svc } = servicio({
      autorizaciones: {
        autorizacion: { ...AUTORIZADA, comprobante: '<notaCredito/>' },
      },
    });

    await expect(svc.consultar(claveNc)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('la fecha del SRI es dd/mm/aaaa y sale como día', () => {
    expect(fechaSriADia('01/03/2026')).toBe('2026-03-01');
    expect(() => fechaSriADia('2026-03-01')).toThrow(
      UnprocessableEntityException,
    );
  });
});
