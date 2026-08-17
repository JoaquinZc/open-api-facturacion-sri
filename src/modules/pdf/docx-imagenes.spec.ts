/**
 * Que las imágenes del RIDE **acaben dentro del documento**.
 *
 * Esta prueba existe por un fallo que no daba error en ninguna parte: Carbone
 * sustituía todas las etiquetas de texto y las imágenes se quedaban como
 * estaban. Y como el relleno de `ride.docx` es un código de barras decorativo
 * y el logo de Darkmelon, **el PDF parecía correcto**. Solo se notaba al
 * escanear el código y ver que no llevaba la clave de acceso.
 *
 * Se comprueba contra la plantilla real, no contra una de mentira: lo que
 * puede romperse es precisamente que alguien reorganice `ride.docx` en Word y
 * las etiquetas dejen de estar donde se buscan.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';
import { inyectarImagenesEnDocx } from './docx-imagenes';

const PLANTILLA = join(__dirname, '..', '..', '..', 'templates', 'ride.docx');

/** PNG de 1×1, rojo. Reconocible sin ambigüedad dentro del zip. */
const ROJO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z1D/HwAFhAJ/wlseKgAAAABJRU5ErkJggg==',
  'base64',
);

/** GIF de 1×1. Sirve para el caso de un logo que no es PNG. */
const GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const BARCODE = '{d.factura.claveAccesoBarcode}';
const LOGO = '{d.emisor.logo}';

async function abrir(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  return {
    zip,
    async media(nombre: string): Promise<Buffer | null> {
      const f = zip.file(nombre);
      return f ? await f.async('nodebuffer') : null;
    },
    async texto(nombre: string): Promise<string> {
      return (await zip.file(nombre)?.async('string')) ?? '';
    },
  };
}

// La plantilla viaja en el repositorio; si algún día no estuviera, es mejor
// que la prueba lo diga que no que se salte sin ruido.
const hayPlantilla = existsSync(PLANTILLA);

(hayPlantilla ? describe : describe.skip)('imágenes en ride.docx', () => {
  let plantilla: Buffer;

  beforeAll(() => {
    plantilla = readFileSync(PLANTILLA);
  });

  it('sustituye el binario, no solo el texto alternativo', async () => {
    const r = await inyectarImagenesEnDocx(plantilla, {
      [BARCODE]: ROJO,
      [LOGO]: ROJO,
    });

    expect(r.sustituidas.sort()).toEqual([LOGO, BARCODE].sort());
    expect(r.noEncontradas).toEqual([]);

    const original = await abrir(plantilla);
    const nuevo = await abrir(r.docx);

    // Las dos imágenes de relleno tienen que haber cambiado de contenido.
    for (const nombre of ['word/media/image1.png', 'word/media/image2.png']) {
      const antes = await original.media(nombre);
      const despues = await nuevo.media(nombre);

      expect(antes).not.toBeNull();
      expect(despues).not.toBeNull();
      expect(despues!.equals(antes!)).toBe(false);
      expect(despues!.equals(ROJO)).toBe(true);
    }
  });

  it('deja el texto alternativo sin etiqueta, para que Carbone no lo toque', async () => {
    const r = await inyectarImagenesEnDocx(plantilla, {
      [BARCODE]: ROJO,
      [LOGO]: ROJO,
    });

    const nuevo = await abrir(r.docx);

    for (const parte of ['word/document.xml', 'word/header1.xml']) {
      const xml = await nuevo.texto(parte);
      expect(xml).not.toContain(`descr="${BARCODE}"`);
      expect(xml).not.toContain(`descr="${LOGO}"`);
    }
  });

  /**
   * El logo del negocio llega de una URL que escribe su dueño, así que puede
   * no ser PNG. **El tipo en un `.docx` se resuelve por la extensión**: un GIF
   * dentro de `image2.png` deja un documento que Word da por dañado.
   */
  it('renombra y declara el tipo cuando la imagen no es PNG', async () => {
    const r = await inyectarImagenesEnDocx(plantilla, { [LOGO]: GIF });

    expect(r.sustituidas).toEqual([LOGO]);

    const nuevo = await abrir(r.docx);
    const rels = await nuevo.texto('word/_rels/header1.xml.rels');
    const tipos = await nuevo.texto('[Content_Types].xml');

    expect(rels).toContain('.gif');
    expect(tipos).toContain('Extension="gif"');
    expect((await nuevo.media('word/media/image2.gif'))?.equals(GIF)).toBe(
      true,
    );
  });

  it('informa de la etiqueta que no está en la plantilla, sin fallar', async () => {
    const r = await inyectarImagenesEnDocx(plantilla, {
      '{d.no.existe}': ROJO,
    });

    expect(r.sustituidas).toEqual([]);
    expect(r.noEncontradas).toEqual(['{d.no.existe}']);
  });

  it('descarta lo que no sea una imagen reconocible', async () => {
    const r = await inyectarImagenesEnDocx(plantilla, {
      [LOGO]: Buffer.from('<html>404 Not Found</html>'),
    });

    // Un servidor que responde HTML con 200 es un caso real: lo que no puede
    // pasar es que ese HTML acabe dentro del documento.
    expect(r.sustituidas).toEqual([]);
    expect(r.noEncontradas).toEqual([LOGO]);
  });

  it('no toca nada más del documento', async () => {
    const r = await inyectarImagenesEnDocx(plantilla, { [LOGO]: ROJO });

    const original = await abrir(plantilla);
    const nuevo = await abrir(r.docx);

    // El cuerpo no lleva el logo, así que tiene que quedar idéntico.
    expect(await nuevo.texto('word/document.xml')).toBe(
      await original.texto('word/document.xml'),
    );
    expect(await nuevo.texto('word/styles.xml')).toBe(
      await original.texto('word/styles.xml'),
    );
  });
});
