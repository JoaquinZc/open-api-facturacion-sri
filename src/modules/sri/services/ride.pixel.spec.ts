/**
 * Que el píxel de relleno **sea de verdad transparente**.
 *
 * 🔴 Esta prueba existe porque durante meses no lo fue. La constante se llamaba
 * `PIXEL_TRANSPARENTE`, el comentario decía «transparente», y su único píxel
 * era `RGBA(0, 0, 255, 127)`: azul puro al 50 %. Sobre el papel blanco de una
 * factura eso es un morado claro — un rectángulo liso de color en el hueco del
 * logo de cualquier negocio que no tenga logo propio.
 *
 * Nadie lo vio porque **nunca llegaba a dibujarse**: Carbone no sustituía
 * imágenes, así que el hueco conservaba el relleno del Word. Al arreglar la
 * sustitución, el píxel equivocado pasó a ser visible en cada factura.
 *
 * «Es transparente» es exactamente la clase de afirmación que todo el mundo da
 * por buena leyendo el nombre de la constante. Así que se comprueba: se
 * descomprime el PNG y se mira el canal alfa.
 */
import { inflateSync } from 'zlib';
import { RideService } from './ride.service';

/** El canal alfa del primer píxel de un PNG RGBA de 8 bits. */
function alfaDelPrimerPixel(png: Buffer): number {
  if (png.readUInt32BE(16) !== 1 || png.readUInt32BE(20) !== 1) {
    throw new Error('se esperaba un PNG de 1×1');
  }
  if (png[24] !== 8) throw new Error(`bit depth ${png[24]}, se esperaba 8`);
  if (png[25] !== 6) {
    // Sin canal alfa no puede ser transparente, se llame como se llame.
    throw new Error(`color type ${png[25]}: el PNG no tiene canal alfa`);
  }

  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.toString('ascii', off + 4, off + 8) === 'IDAT') {
      // Fila = byte de filtro + R, G, B, A.
      return inflateSync(png.subarray(off + 8, off + 8 + len))[4];
    }
    off += 12 + len;
  }

  throw new Error('el PNG no tiene chunk IDAT');
}

describe('el píxel de relleno del RIDE', () => {
  // Es privado y estático: se llega por la clase, sin exportarlo solo para esto.
  const pixel = (RideService as unknown as { PIXEL_TRANSPARENTE: Buffer })
    .PIXEL_TRANSPARENTE;

  it('es un PNG válido de 1×1 con canal alfa', () => {
    expect(pixel).toBeInstanceOf(Buffer);
    expect([...pixel.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(pixel.readUInt32BE(16)).toBe(1);
    expect(pixel.readUInt32BE(20)).toBe(1);
  });

  it('tiene alfa 0 — invisible sobre cualquier fondo', () => {
    expect(alfaDelPrimerPixel(pixel)).toBe(0);
  });
});
