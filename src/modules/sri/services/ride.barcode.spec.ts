/**
 * El código de barras del RIDE tiene que **leerse**, no solo generarse.
 *
 * Esta prueba existe porque durante un tiempo no se leía y nada lo delataba:
 * el PNG salía, la imagen aparecía en el PDF y el símbolo estaba perfectamente
 * codificado —se podía decodificar a mano y devolvía la clave exacta—, pero
 * `bwip-js` lo genera pegado al borde y Code 128 exige diez módulos de blanco
 * a cada lado. Sin ellos el lector no encuentra el patrón de inicio y **no
 * devuelve nada**. Un fallo así no aparece en ningún log: solo lo descubre
 * quien acerca el móvil a la factura.
 *
 * Así que se comprueban las dos cosas por separado:
 *   1. Que la secuencia de barras decodifica de vuelta a la clave de acceso.
 *   2. Que el PNG lleva la zona muda.
 */
import bwipjs from 'bwip-js';

/** Una clave de acceso real: 49 dígitos, los que emite el sistema. */
const CLAVE = '1708202601131699500800110010010000000109324839210';

/**
 * Las mismas opciones que usa `RideService.generarBarcode()`.
 *
 * Están duplicadas a propósito: el método es privado y sacarlo a una constante
 * exportada solo para la prueba acoplaría el servicio a su test. Si alguien
 * cambia el servicio y no esto, la prueba de la zona muda deja de proteger —
 * por eso el nombre del campo aparece también en el comentario de allí.
 */
const OPCIONES = {
  bcid: 'code128' as const,
  text: CLAVE,
  paddingwidth: 12,
  height: 15,
  scale: 3,
  includetext: false,
  backgroundcolor: 'FFFFFF',
};

/** Tabla estándar de Code 128: 107 símbolos. El último, el de parada. */
const PATRONES = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];

/**
 * Los anchos de barra y espacio del símbolo.
 *
 * `bwipjs.raw()` declara una unión —o los anchos, o un mapa de píxeles—, y
 * cuál devuelve depende de la simbología. Code 128 siempre da el primero, pero
 * TypeScript no lo sabe, así que se comprueba en tiempo de ejecución en vez de
 * afirmarlo con un `as`: si algún día cambia, esto falla con un mensaje claro
 * en lugar de un `undefined` más adelante.
 */
function anchosDe(texto: string): number[] {
  const raw = bwipjs.raw({ bcid: 'code128', text: texto })[0];

  if (!('sbs' in raw)) {
    throw new Error('bwip-js no devolvió los anchos del símbolo');
  }

  return Array.from(raw.sbs, Number);
}

interface Decodificado {
  texto: string;
  checksumOk: boolean;
  modulos: number;
}

/**
 * Decodifica la secuencia de anchos que devuelve `bwipjs.raw()`.
 *
 * ⚠️ **El significado de cada valor depende del subconjunto activo.** En el
 * subconjunto C el 99 es el par de dígitos «99»; solo en A y B es el salto a
 * C. Confundirlo hace que la clave decodificada pierda dos cifras justo donde
 * lleve un 99, que es un fallo que parece un error del generador.
 */
function decodificar(sbs: ArrayLike<number>): Decodificado {
  const anchos = Array.from(sbs, Number);
  const simbolos: number[] = [];

  for (let i = 0; i < anchos.length; ) {
    const largo = anchos.length - i === 7 ? 7 : 6;
    const trozo = anchos.slice(i, i + largo).join('');
    const idx = PATRONES.indexOf(trozo);
    if (idx === -1) throw new Error(`patrón desconocido en ${i}: ${trozo}`);
    simbolos.push(idx);
    i += largo;
  }

  if (simbolos[simbolos.length - 1] !== 106) {
    throw new Error('el símbolo de parada no está donde debe');
  }

  const inicio = simbolos[0];
  const datos = simbolos.slice(1, -2);
  const checksum = simbolos[simbolos.length - 2];

  let suma = inicio;
  datos.forEach((v, n) => {
    suma += v * (n + 1);
  });

  let modo = { 103: 'A', 104: 'B', 105: 'C' }[inicio];
  let texto = '';

  for (const v of datos) {
    if (modo === 'C') {
      if (v === 100) {
        modo = 'B';
        continue;
      }
      if (v === 101) {
        modo = 'A';
        continue;
      }
      texto += String(v).padStart(2, '0');
      continue;
    }
    if (v === 99) {
      modo = 'C';
      continue;
    }
    if (v === 101 && modo === 'B') {
      modo = 'A';
      continue;
    }
    if (v === 100 && modo === 'A') {
      modo = 'B';
      continue;
    }
    texto += String.fromCharCode(v + 32);
  }

  return {
    texto,
    checksumOk: checksum === suma % 103,
    modulos: anchos.reduce((a, b) => a + b, 0),
  };
}

describe('código de barras del RIDE', () => {
  it('decodifica de vuelta a la misma clave de acceso', () => {
    const r = decodificar(anchosDe(CLAVE));

    expect(r.texto).toBe(CLAVE);
    expect(r.checksumOk).toBe(true);
  });

  it('deja zona muda a ambos lados', async () => {
    const png = await bwipjs.toBuffer(OPCIONES);

    // Ancho del PNG: bytes 16..19 de la cabecera IHDR.
    const anchoPx = png.readUInt32BE(16);
    const modulosDelSimbolo = decodificar(anchosDe(CLAVE)).modulos;

    const zonaMudaPorLado =
      (anchoPx - modulosDelSimbolo * OPCIONES.scale) / 2 / OPCIONES.scale;

    // ISO/IEC 15417 §5.2 pide diez módulos como mínimo.
    expect(zonaMudaPorLado).toBeGreaterThanOrEqual(10);
  });

  it('cabe en la plantilla con barras lo bastante anchas para un lector', async () => {
    const png = await bwipjs.toBuffer(OPCIONES);
    const modulosTotales = png.readUInt32BE(16) / OPCIONES.scale;

    /*
     * El hueco que `ride.docx` reserva al código: `wp:extent cx="5580000"`,
     * en EMU (360000 = 1 cm). Estaba en 66 mm dentro de una celda y por eso
     * ningún móvil lo leía; se sacó a una franja a lo ancho de la página.
     */
    const anchoMm = (5580000 / 360000) * 10;
    const anchoDeModuloMm = anchoMm / modulosTotales;

    expect(anchoDeModuloMm).toBeGreaterThanOrEqual(0.25);
  });
});
