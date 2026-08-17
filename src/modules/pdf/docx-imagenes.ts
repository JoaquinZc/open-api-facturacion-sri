import JSZip from 'jszip';

/**
 * Mete imágenes generadas dentro de una plantilla `.docx` **antes** de mandarla
 * a Carbone.
 *
 * ═══ Por qué no lo hace Carbone ═══════════════════════════════════════════
 *
 * Carbone tiene un mecanismo para esto: se pone la etiqueta —`{d.emisor.logo}`—
 * en el **texto alternativo** de una imagen de relleno y él sustituye el
 * binario. Funciona… en algunas ediciones.
 *
 * 🔴 **Se comprobó y no es fiable.** Renderizando `ride.docx` con Carbone 3.8.2
 * sustituye todas las etiquetas de texto, incluidas las del encabezado y el
 * pie, pero **las imágenes se quedan como estaban**: escribe el Data URI en el
 * atributo `descr` y deja `word/media/image1.png` byte a byte igual. Esa
 * versión no trae ni un formateador de imagen. El `:barcode(code128)` ya había
 * dado antes `Formatter "barcode" is disabled in the Community Edition`, así
 * que la edición desplegada recorta funciones.
 *
 * Y el fallo es **silencioso y verosímil**: el relleno de `ride.docx` es un
 * código de barras decorativo y el logo de Darkmelon. Un RIDE con el relleno
 * sin sustituir **parece correcto** — hasta que alguien escanea el código y no
 * sale la clave de acceso.
 *
 * Así que la sustitución se hace aquí, donde se puede verificar. Carbone se
 * queda solo con el texto, que es lo que hace bien en cualquier edición.
 *
 * ═══ Cómo se localiza cada imagen ═════════════════════════════════════════
 *
 * **Por su texto alternativo, igual que antes.** La plantilla se sigue editando
 * en Word exactamente igual: se pone una imagen de relleno con
 * `{d.emisor.logo}` en el texto alternativo. Lo único que cambia es quién hace
 * la sustitución.
 *
 * El recorrido es: `<wp:docPr descr="{etiqueta}">` → el `<a:blip r:embed="rIdN">`
 * que le sigue → `rIdN` en el `.rels` de esa parte → `media/imageN.png`.
 */

/** Las partes del documento donde puede haber imágenes con etiqueta. */
const PARTES = /^word\/(document|header\d*|footer\d*)\.xml$/;

/** Firmas de fichero, para no fiarnos de la extensión de nadie. */
const FIRMAS: Array<{ ext: string; tipo: string; magic: number[] }> = [
  { ext: 'png', tipo: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpeg', tipo: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { ext: 'gif', tipo: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
];

export interface ResultadoInyeccion {
  docx: Buffer;
  /** Etiquetas que sí se sustituyeron. Para poder registrarlo y verlo. */
  sustituidas: string[];
  /** Etiquetas que se pidieron y no se encontraron en la plantilla. */
  noEncontradas: string[];
}

function formatoDe(bytes: Buffer): { ext: string; tipo: string } | null {
  return FIRMAS.find((f) => f.magic.every((b, i) => bytes[i] === b)) ?? null;
}

/** `word/header1.xml` → `word/_rels/header1.xml.rels` */
function relsDe(parte: string): string {
  const i = parte.lastIndexOf('/');
  return `${parte.slice(0, i)}/_rels/${parte.slice(i + 1)}.rels`;
}

/**
 * El identificador de relación de la imagen que lleva esta etiqueta.
 *
 * Se busca el `<a:blip r:embed="…">` **posterior** al `<wp:docPr>` con la
 * etiqueta, que es el orden que fija el esquema de OOXML. Se limita a los 4000
 * caracteres siguientes para no saltar a la imagen de al lado si esta viniera
 * sin `blip` por lo que sea.
 */
function embedDeLaEtiqueta(xml: string, etiqueta: string): string | null {
  const docPr = xml.indexOf(`descr="${etiqueta}"`);
  if (docPr === -1) return null;

  const trozo = xml.slice(docPr, docPr + 4000);
  const blip = /<a:blip[^>]*r:embed="([^"]+)"/.exec(trozo);

  return blip?.[1] ?? null;
}

/**
 * Sustituye las imágenes de relleno de una plantilla `.docx`.
 *
 * @param plantilla el `.docx` tal cual está en disco
 * @param imagenes  etiqueta (`'{d.emisor.logo}'`) → bytes de la imagen nueva
 *
 * **Nunca lanza por una imagen.** Una etiqueta que no aparece en la plantilla,
 * o unos bytes que no son una imagen reconocible, se anotan y se siguen: un
 * logo que no se puede poner no puede impedir que se emita un comprobante.
 * Sí lanza si el `.docx` no se puede abrir, porque entonces no hay documento.
 */
export async function inyectarImagenesEnDocx(
  plantilla: Buffer,
  imagenes: Record<string, Buffer>,
): Promise<ResultadoInyeccion> {
  const zip = await JSZip.loadAsync(plantilla);

  const partes = Object.keys(zip.files).filter((n) => PARTES.test(n));
  const sustituidas: string[] = [];
  const noEncontradas: string[] = [];

  // Se cachean las partes leídas: `document.xml` puede llevar varias etiquetas.
  const xmls = new Map<string, string>();
  const leer = async (nombre: string): Promise<string> => {
    if (!xmls.has(nombre)) {
      xmls.set(nombre, (await zip.file(nombre)?.async('string')) ?? '');
    }
    return xmls.get(nombre)!;
  };

  /*
   * Un mismo fichero de media puede estar referenciado por dos etiquetas si
   * Word dedujo que las imágenes de relleno eran idénticas y las unificó.
   * Sustituir las dos dejaría la última ganando en silencio, con una de las
   * dos imágenes equivocada en el PDF — así que se detecta y se dice.
   */
  const yaUsados = new Map<string, string>();

  /** Extensiones nuevas que habrá que declarar en `[Content_Types].xml`. */
  const extensiones = new Set<string>();

  for (const [etiqueta, bytes] of Object.entries(imagenes)) {
    const formato = formatoDe(bytes);
    if (!formato) {
      noEncontradas.push(etiqueta);
      continue;
    }

    let colocada = false;

    for (const parte of partes) {
      const xml = await leer(parte);
      const embed = embedDeLaEtiqueta(xml, etiqueta);
      if (!embed) continue;

      const rels = await leer(relsDe(parte));
      const destino = new RegExp(`Id="${embed}"[^>]*Target="([^"]+)"`).exec(
        rels,
      )?.[1];

      if (!destino) continue;

      // El Target es relativo a la carpeta de la parte: `media/image1.png`.
      const ruta = `${parte.slice(0, parte.lastIndexOf('/'))}/${destino}`;

      const previa = yaUsados.get(ruta);
      if (previa && previa !== etiqueta) {
        throw new Error(
          `«${etiqueta}» y «${previa}» apuntan al mismo fichero (${ruta}): en la plantilla ` +
            `son la misma imagen de relleno, así que una de las dos saldría mal. ` +
            `Cambia una de las dos imágenes en el Word para que sean distintas.`,
        );
      }
      yaUsados.set(ruta, etiqueta);

      /*
       * ⚠️ **El tipo se resuelve por la extensión del fichero, no por su
       * contenido.** Meter un JPEG en `media/image2.png` deja un documento que
       * Word da por dañado, así que si el formato no coincide se escribe en un
       * fichero con la extensión correcta y se repunta la relación.
       *
       * El fichero viejo se deja donde está: pesa unos KB y quitarlo obligaría
       * a comprobar que nadie más lo referencia. Un adjunto huérfano no rompe
       * nada; una relación rota, sí.
       */
      const extActual = ruta.slice(ruta.lastIndexOf('.') + 1).toLowerCase();
      let rutaFinal = ruta;

      if (extActual !== formato.ext) {
        rutaFinal = `${ruta.slice(0, ruta.lastIndexOf('.'))}.${formato.ext}`;

        xmls.set(
          relsDe(parte),
          rels.replace(
            new RegExp(`(Id="${embed}"[^>]*Target=")${destino}(")`),
            `$1${destino.slice(0, destino.lastIndexOf('.'))}.${formato.ext}$2`,
          ),
        );

        extensiones.add(formato.ext);
      }

      zip.file(rutaFinal, bytes);

      /*
       * Se neutraliza el texto alternativo. Si se dejara la etiqueta, Carbone
       * escribiría el Data URI entero dentro del atributo `descr` — decenas de
       * miles de caracteres de base64 en el XML, por imagen, para nada. Y de
       * paso se evita que una edición con soporte de imágenes intente
       * sustituirla otra vez encima de lo que ya se puso aquí.
       */
      xmls.set(
        parte,
        xml.replace(`descr="${etiqueta}"`, `descr="${etiqueta.slice(1, -1)}"`),
      );

      sustituidas.push(etiqueta);
      colocada = true;
      break;
    }

    if (!colocada) noEncontradas.push(etiqueta);
  }

  /*
   * Cada extensión nueva tiene que estar declarada: un `.docx` con un JPEG que
   * `[Content_Types].xml` no menciona lo abre Word diciendo que está dañado.
   * La plantilla solo trae `png`, que es lo que usan los rellenos.
   */
  if (extensiones.size > 0) {
    const nombre = '[Content_Types].xml';
    let ct = await leer(nombre);

    for (const ext of extensiones) {
      if (ct.includes(`Extension="${ext}"`)) continue;

      const tipo = FIRMAS.find((f) => f.ext === ext)!.tipo;
      ct = ct.replace(
        /(<Default Extension="png"[^>]*\/>)/,
        `$1<Default Extension="${ext}" ContentType="${tipo}"/>`,
      );
    }

    xmls.set(nombre, ct);
  }

  for (const [nombre, xml] of xmls) {
    zip.file(nombre, xml);
  }

  return {
    docx: await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    }),
    sustituidas,
    noEncontradas,
  };
}
