import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EmisorDto } from '../dto/common.dto';
import { leyendaAgenteRetencion } from '../services/ride.service';
import {
  LEYENDA_RIMPE_EMPRENDEDOR,
  LEYENDA_RIMPE_NEGOCIO_POPULAR,
  leyendaRimpe,
} from './rimpe';

/**
 * 🔴 Las dos leyendas del RIMPE (ficha técnica v2.32, Anexo 22). Hasta el
 * 2026-09-30 solo se aceptaba la del emprendedor: un negocio popular no podía
 * emitir con la suya.
 */
describe('RIMPE: emprendedor y negocio popular', () => {
  it('las leyendas son las literales de la ficha (27 y 45 caracteres)', () => {
    expect(LEYENDA_RIMPE_EMPRENDEDOR).toBe('CONTRIBUYENTE RÉGIMEN RIMPE');
    expect(LEYENDA_RIMPE_EMPRENDEDOR).toHaveLength(27);
    expect(LEYENDA_RIMPE_NEGOCIO_POPULAR).toBe(
      'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE',
    );
    expect(LEYENDA_RIMPE_NEGOCIO_POPULAR).toHaveLength(45);
  });

  describe('al emitir, el DTO del emisor acepta las dos y nada más', () => {
    const emisor = (contribuyenteRimpe?: string) =>
      plainToInstance(EmisorDto, {
        ruc: '1790012345001',
        razonSocial: 'X',
        dirMatriz: 'Quito',
        estab: '001',
        ptoEmi: '001',
        puntoEmision: '001',
        establecimiento: '001',
        obligadoContabilidad: 'NO',
        ...(contribuyenteRimpe ? { contribuyenteRimpe } : {}),
      });
    const errorDeRimpe = (valor?: string) =>
      validateSync(emisor(valor)).find(
        (e) => e.property === 'contribuyenteRimpe',
      );

    it.each([LEYENDA_RIMPE_EMPRENDEDOR, LEYENDA_RIMPE_NEGOCIO_POPULAR])(
      'acepta «%s»',
      (leyenda) => {
        expect(errorDeRimpe(leyenda)).toBeUndefined();
      },
    );

    it('sin leyenda también vale (régimen general)', () => {
      expect(errorDeRimpe()).toBeUndefined();
    });

    it('rechaza cualquier otra', () => {
      expect(errorDeRimpe('RIMPE')).toBeDefined();
    });
  });

  describe('en el RIDE, la leyenda sale de la categoría guardada', () => {
    it('negocio popular', () => {
      expect(leyendaRimpe(true, 'negocio_popular')).toBe(
        LEYENDA_RIMPE_NEGOCIO_POPULAR,
      );
    });
    it('emprendedor, y un RIMPE de antes sin categoría', () => {
      expect(leyendaRimpe(true, 'emprendedor')).toBe(LEYENDA_RIMPE_EMPRENDEDOR);
      expect(leyendaRimpe(true, null)).toBe(LEYENDA_RIMPE_EMPRENDEDOR);
      expect(leyendaRimpe('true', null)).toBe(LEYENDA_RIMPE_EMPRENDEDOR);
    });
    it('régimen general: nada', () => {
      expect(leyendaRimpe(false, null)).toBe('');
    });
  });

  describe('🔴 agente de retención: la columna es el número de resolución', () => {
    it('con número, la leyenda con su resolución (antes no salía nunca)', () => {
      expect(leyendaAgenteRetencion('1')).toBe(
        'AGENTE DE RETENCIÓN RESOLUCIÓN Nº 1',
      );
    });
    it('los valores viejos booleanos siguen valiendo', () => {
      expect(leyendaAgenteRetencion(true)).toBe('AGENTE DE RETENCIÓN');
      expect(leyendaAgenteRetencion('true')).toBe('AGENTE DE RETENCIÓN');
    });
    it('vacío o nulo: nada', () => {
      expect(leyendaAgenteRetencion(null)).toBe('');
      expect(leyendaAgenteRetencion('')).toBe('');
      expect(leyendaAgenteRetencion('false')).toBe('');
    });
  });
});
