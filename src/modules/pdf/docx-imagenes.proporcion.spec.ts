import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';
import JSZip from 'jszip';
import { inyectarImagenesEnDocx } from './docx-imagenes';

/**
 * Que el logo **no salga deformado**.
 *
 * 🔴 El hueco de la plantilla tiene tamaño fijo —el del logo mide 32,9 × 13,7 mm,
 * o sea 2,40:1— y Word estira lo que se meta dentro hasta llenarlo. La imagen
 * era la correcta y se veía aplastada, que es la clase de fallo que parece de
 * la imagen y no lo es.
 *
 * ⚠️ Y el detalle que lo hizo fallar la primera vez: en una imagen flotante
 * —`wp:anchor`, que es como está el logo en la cabecera— el `wp:extent` va
 * **antes** del `wp:docPr`, no después. Buscar solo hacia delante desde la
 * etiqueta no lo encontraba, y el ajuste no hacía nada sin decirlo.
 */
const PLANTILLA = join(__dirname, '..', '..', '..', 'templates', 'ride.docx');
const LOGO = '{d.emisor.logo}';

/** Un PNG transparente de las dimensiones que se pidan. */
function png(w: number, h: number): Buffer {
  const crc32 = (buf: Buffer): number => {
    let c: number;
    let crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
      c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const chunk = (tipo: string, datos: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([len, cuerpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const fila = Buffer.alloc(1 + w * 4);
  const idat = deflateSync(Buffer.concat(Array<Buffer>(h).fill(fila)));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function huecoDelLogo(docx: Buffer): Promise<{ cx: number; cy: number }> {
  const zip = await JSZip.loadAsync(docx);
  const xml = (await zip.file('word/header1.xml')?.async('string')) ?? '';
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);

  if (!m) throw new Error('no se encontró el hueco del logo');
  return { cx: Number(m[1]), cy: Number(m[2]) };
}

(existsSync(PLANTILLA) ? describe : describe.skip)(
  'proporción del logo en ride.docx',
  () => {
    let plantilla: Buffer;
    let original: { cx: number; cy: number };

    beforeAll(async () => {
      plantilla = readFileSync(PLANTILLA);
      original = await huecoDelLogo(plantilla);
    });

    it.each([
      ['apaisado', 840, 240],
      ['cuadrado', 400, 400],
      ['vertical', 240, 840],
      ['muy apaisado', 1200, 100],
    ])('un logo %s conserva su proporción', async (_n, w, h) => {
      const { docx } = await inyectarImagenesEnDocx(plantilla, {
        [LOGO]: png(w, h),
      });
      const hueco = await huecoDelLogo(docx);

      expect(hueco.cx / hueco.cy).toBeCloseTo(w / h, 2);
    });

    it('nunca se sale del hueco que se diseñó en Word', async () => {
      for (const [w, h] of [
        [840, 240],
        [400, 400],
        [240, 840],
      ]) {
        const { docx } = await inyectarImagenesEnDocx(plantilla, {
          [LOGO]: png(w, h),
        });
        const hueco = await huecoDelLogo(docx);

        expect(hueco.cx).toBeLessThanOrEqual(original.cx);
        expect(hueco.cy).toBeLessThanOrEqual(original.cy);
      }
    });

    /**
     * Los dos sitios que llevan el tamaño tienen que quedar iguales: `wp:extent`
     * es el hueco en el flujo del documento y `a:ext` el del dibujo. Si
     * discrepan, Word y LibreOffice pintan cosas distintas y la imagen sale
     * recortada.
     */
    it('cuadra el tamaño del hueco y el del dibujo', async () => {
      const { docx } = await inyectarImagenesEnDocx(plantilla, {
        [LOGO]: png(400, 400),
      });

      const zip = await JSZip.loadAsync(docx);
      const xml = (await zip.file('word/header1.xml')?.async('string')) ?? '';

      const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(xml);

      expect(ext?.[1]).toBe(extent?.[1]);
      expect(ext?.[2]).toBe(extent?.[2]);
    });
  },
);
