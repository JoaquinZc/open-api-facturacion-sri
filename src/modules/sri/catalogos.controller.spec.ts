import { BadRequestException } from '@nestjs/common';
import { CatalogosController } from './catalogos.controller';
import { CatalogoValidatorService } from './services/catalogo-validator.service';
import { hoyEnEcuador } from '../../common/utils/fecha-ecuador';

describe('CatalogosController — retenciones a una fecha (R0)', () => {
  const catalogo = {
    getRetencionesPorTipo: jest.fn((tipo: string) =>
      Promise.resolve(
        tipo === 'ISD'
          ? [
              {
                tipo,
                codigo: '4580',
                descripcion: 'ISD',
                porcentaje: 5,
                vigenteDesde: '2024-01-01',
                vigenteHasta: null,
              },
            ]
          : [],
      ),
    ),
    getSustentos: jest.fn().mockResolvedValue([]),
  };
  const controller = new CatalogosController(
    catalogo as unknown as CatalogoValidatorService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('sin fecha consulta hoy en Ecuador y devuelve renta, IVA e ISD', async () => {
    const res = await controller.listarRetenciones();

    expect(res.fecha).toBe(hoyEnEcuador());
    expect(res.retenciones.map((r) => [r.tipo, r.codigoImpuesto])).toEqual([
      ['RENTA', '1'],
      ['IVA', '2'],
      ['ISD', '6'],
    ]);
    expect(res.retenciones[2].codigos[0]).toMatchObject({
      codigo: '4580',
      porcentaje: 5,
    });
    expect(catalogo.getRetencionesPorTipo).toHaveBeenCalledWith(
      'RENTA',
      hoyEnEcuador(),
    );
  });

  it('con fecha consulta esa fecha', async () => {
    await controller.listarRetenciones('2026-02-15');
    expect(catalogo.getRetencionesPorTipo).toHaveBeenCalledWith(
      'RENTA',
      '2026-02-15',
    );
  });

  it('una fecha mal formada o inexistente es un 400', async () => {
    await expect(controller.listarRetenciones('15/02/2026')).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.listarRetenciones('2026-02-30')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('hoyEnEcuador', () => {
  it('a las 02:00 UTC todavía es el día anterior en Ecuador', () => {
    expect(hoyEnEcuador(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-30');
    expect(hoyEnEcuador(new Date('2026-10-01T05:00:00Z'))).toBe('2026-10-01');
  });
});
