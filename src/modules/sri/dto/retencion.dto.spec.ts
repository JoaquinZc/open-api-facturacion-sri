import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateRetencionDto } from './retencion.dto';

/**
 * La puerta de verdad es el `ValidationPipe` global (`main.ts`), con
 * `whitelist` y `forbidNonWhitelisted`: un campo que el DTO no declara es un
 * 400. Por eso se prueba pasando por él y no llamando al servicio.
 */
describe('CreateRetencionDto — fase R0', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const pasar = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: CreateRetencionDto });

  /** Los mensajes del 400, aplanados. */
  const errores = async (body: unknown): Promise<string> => {
    try {
      await pasar(body);
      return '';
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return JSON.stringify((e as BadRequestException).getResponse());
    }
  };

  function cuerpo(
    impuesto: Record<string, unknown> = {},
    sujeto: Record<string, unknown> = {},
  ) {
    return {
      fechaEmision: '30/09/2026',
      periodoFiscal: '09/2026',
      emisor: {
        ruc: '0924383631001',
        razonSocial: 'Empresa Test S.A.',
        dirMatriz: 'Av. Amazonas 123, Quito',
        establecimiento: '001',
        puntoEmision: '001',
        obligadoContabilidad: 'SI',
      },
      sujetoRetenido: {
        tipoIdentificacion: '04',
        identificacion: '1790012345001',
        razonSocial: 'Proveedor S.A.',
        ...sujeto,
      },
      impuestos: [
        {
          codigo: '1',
          codigoRetencion: '312',
          baseImponible: 100,
          porcentajeRetener: 2,
          valorRetenido: 2,
          codDocSustento: '01',
          codSustento: '01',
          numDocSustento: '001-001-000000123',
          fechaEmisionDocSustento: '29/09/2026',
          totalSinImpuestos: 100,
          importeTotal: 115,
          impuestosDocSustento: [
            {
              codImpuestoDocSustento: '2',
              codigoPorcentaje: '4',
              baseImponible: 100,
              tarifa: 15,
              valorImpuesto: 15,
            },
          ],
          ...impuesto,
        },
      ],
    };
  }

  it('un cuerpo completo pasa', async () => {
    expect(await errores(cuerpo())).toBe('');
  });

  it('codSustento es obligatorio (ya no se copia codDocSustento)', async () => {
    const body = cuerpo();
    delete (body.impuestos[0] as Record<string, unknown>).codSustento;
    expect(await errores(body)).toContain('codSustento');
  });

  it('codigo solo admite 1, 2 o 6', async () => {
    expect(await errores(cuerpo({ codigo: '3' }))).toContain(
      'codigo debe ser 1 (renta), 2 (IVA) o 6 (ISD)',
    );
    expect(await errores(cuerpo({ codigo: '6' }))).toBe('');
  });

  it('parteRel: SI o NO, y opcional', async () => {
    const dto = (await pasar(
      cuerpo({}, { parteRel: 'SI' }),
    )) as CreateRetencionDto;
    expect(dto.sujetoRetenido.parteRel).toBe('SI');
    expect(await errores(cuerpo({}, { parteRel: 'TAL VEZ' }))).toContain(
      'parteRel debe ser SI o NO',
    );
  });
});
