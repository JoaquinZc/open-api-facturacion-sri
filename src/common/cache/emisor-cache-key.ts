/**
 * Clave de la ficha del emisor en la caché de Redis.
 *
 * La lee `SriRepositoryService.findEmisorByRuc` al emitir y la borra
 * `EmisoresService.update` al cambiar el emisor. **Tienen que ser la misma
 * cadena**: si divergen, un cambio de ambiente tarda el TTL entero en llegar a
 * los comprobantes, y durante ese rato se emite en el ambiente anterior.
 */
export function claveCacheEmisorPorRuc(ruc: string): string {
  return `emisor:ruc:${ruc}`;
}
