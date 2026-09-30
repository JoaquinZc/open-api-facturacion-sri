/**
 * Las dos leyendas del RIMPE, literales, como las exige la ficha técnica de
 * comprobantes electrónicos (esquema offline v2.32, Anexo 22): etiqueta
 * `<contribuyenteRimpe>` en `infoTributaria`, entre `<agenteRetencion>` y
 * `</infoTributaria>`.
 *
 * Hasta el 2026-09-30 solo se aceptaba la primera, así que un negocio popular
 * no podía emitir con la leyenda que le corresponde.
 */
export const LEYENDA_RIMPE_EMPRENDEDOR = 'CONTRIBUYENTE RÉGIMEN RIMPE';
export const LEYENDA_RIMPE_NEGOCIO_POPULAR =
  'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE';

export const LEYENDAS_RIMPE = [
  LEYENDA_RIMPE_EMPRENDEDOR,
  LEYENDA_RIMPE_NEGOCIO_POPULAR,
] as const;

export type LeyendaRimpe = (typeof LEYENDAS_RIMPE)[number];

/** La categoría dentro del RIMPE, que es lo que decide la leyenda. */
export const CATEGORIAS_RIMPE = ['emprendedor', 'negocio_popular'] as const;
export type CategoriaRimpe = (typeof CATEGORIAS_RIMPE)[number];

/**
 * La leyenda de un emisor tal como está guardado: `contribuyente_rimpe` es el
 * booleano de siempre y `categoria_rimpe` lo distingue. Un RIMPE sin categoría
 * (los de antes de esa columna) es emprendedor, que es lo que imprimía.
 */
export function leyendaRimpe(
  contribuyenteRimpe: unknown,
  categoria: unknown,
): LeyendaRimpe | '' {
  if (categoria === 'negocio_popular') return LEYENDA_RIMPE_NEGOCIO_POPULAR;
  if (contribuyenteRimpe === true || contribuyenteRimpe === 'true') {
    return LEYENDA_RIMPE_EMPRENDEDOR;
  }
  return '';
}
