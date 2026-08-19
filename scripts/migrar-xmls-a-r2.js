#!/usr/bin/env node
/**
 * Sube al almacenamiento de objetos los XML que quedaron en el disco.
 *
 * ═══ Para qué ═════════════════════════════════════════════════════════════
 *
 * Hasta el 2026-08-18 los XML firmados y autorizados se escribían solo en
 * `{XMLS_DIR}`, y `comprobante_xmls` guardaba la ruta relativa. Los emitidos
 * antes de ese cambio siguen ahí y **desaparecen en cuanto se quite el
 * volumen**: son los documentos que Ecuador obliga a conservar siete años y el
 * XML autorizado no se puede regenerar.
 *
 * Esto los copia a S3/R2 **con la misma clave que ya tienen en la base**, así
 * que no hay que tocar ninguna fila: el servicio los encontrará solo.
 *
 * ═══ Cómo se usa ══════════════════════════════════════════════════════════
 *
 * Tiene que correr **donde esté montado el volumen** — dentro del contenedor:
 *
 *     railway run node scripts/migrar-xmls-a-r2.js          # de prueba
 *     railway run node scripts/migrar-xmls-a-r2.js --subir  # de verdad
 *
 * Sin `--subir` no escribe nada: recorre, compara y dice qué haría. **Ese es el
 * modo por defecto a propósito** — conviene ver el recuento antes de mover
 * documentos fiscales.
 *
 * Es **reentrante**: lo que ya está arriba y coincide en tamaño se salta, así
 * que se puede repetir sin duplicar ni gastar transferencia de más.
 *
 * ═══ Cuándo se puede borrar el volumen ════════════════════════════════════
 *
 * Cuando esto termine diciendo `faltan por subir: 0`. Ni antes.
 */
const { readdirSync, statSync, readFileSync } = require('fs');
const { join, relative, sep } = require('path');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');

const SUBIR = process.argv.includes('--subir');

const XMLS_DIR = process.env.XMLS_DIR || '/data/xmls';
const BUCKET = process.env.S3_BUCKET;
const PREFIX = (process.env.S3_PREFIX || '').replace(/\/+$/, '');

if (!BUCKET || !process.env.S3_ACCESS_KEY_ID) {
  console.error(
    'Faltan las variables de S3 (S3_BUCKET, S3_ACCESS_KEY_ID, …). ' +
      'Este script tiene que correr con la misma configuración que el servicio.',
  );
  process.exit(1);
}

const client = new S3Client({
  region: process.env.S3_REGION || 'auto',
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

/** Todos los `.xml` bajo el directorio, en profundidad. */
function listarXmls(dir) {
  let encontrados = [];

  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.error(`No se pudo leer ${dir}: ${e.message}`);
    return encontrados;
  }

  for (const e of entradas) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) encontrados = encontrados.concat(listarXmls(ruta));
    else if (e.name.endsWith('.xml')) encontrados.push(ruta);
  }

  return encontrados;
}

const fullKey = (key) => (PREFIX ? `${PREFIX}/${key}` : key);

/** ¿Está ya arriba y con el mismo tamaño? */
async function yaEsta(key, bytes) {
  try {
    const r = await client.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: fullKey(key) }),
    );
    return r.ContentLength === bytes;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`Directorio : ${XMLS_DIR}`);
  console.log(`Bucket     : ${BUCKET}${PREFIX ? ` (prefijo ${PREFIX})` : ''}`);
  console.log(`Modo       : ${SUBIR ? 'SUBIENDO' : 'solo comprobar (usa --subir para escribir)'}`);
  console.log('');

  const ficheros = listarXmls(XMLS_DIR);

  if (ficheros.length === 0) {
    console.log(
      'No hay ningún XML en el disco. O ya se migraron, o este contenedor no ' +
        'tiene el volumen montado — comprueba XMLS_DIR antes de dar por hecho ' +
        'que no hay nada que salvar.',
    );
    return;
  }

  console.log(`Encontrados: ${ficheros.length} XML\n`);

  let subidos = 0;
  let saltados = 0;
  const fallidos = [];

  for (const ruta of ficheros) {
    // La clave es la ruta relativa, con barras normales: es exactamente lo que
    // guarda `comprobante_xmls`, así que las filas siguen valiendo sin tocarlas.
    const key = relative(XMLS_DIR, ruta).split(sep).join('/');
    const bytes = statSync(ruta).size;

    if (await yaEsta(key, bytes)) {
      saltados++;
      continue;
    }

    if (!SUBIR) {
      console.log(`  faltaría: ${key}`);
      subidos++;
      continue;
    }

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: fullKey(key),
          Body: readFileSync(ruta),
          ContentType: 'application/xml',
        }),
      );
      subidos++;
      if (subidos % 50 === 0) console.log(`  … ${subidos} subidos`);
    } catch (e) {
      fallidos.push({ key, motivo: e.message });
    }
  }

  console.log('');
  console.log(`ya estaban        : ${saltados}`);
  console.log(`${SUBIR ? 'subidos' : 'faltan por subir'} : ${subidos}`);
  console.log(`fallidos          : ${fallidos.length}`);

  for (const f of fallidos) console.log(`  ✗ ${f.key} — ${f.motivo}`);

  console.log('');
  if (fallidos.length > 0) {
    console.log('🔴 Hay fallos. NO quites el volumen: esos documentos solo están en el disco.');
    process.exit(1);
  } else if (!SUBIR && subidos > 0) {
    console.log(`Faltan ${subidos} por subir. Repite con --subir.`);
  } else if (subidos === 0 && saltados > 0) {
    console.log('✅ Todo está en el almacenamiento de objetos. Ya se puede quitar el volumen.');
  } else {
    console.log('✅ Subida completa. Vuelve a correrlo sin --subir para confirmar antes de quitar el volumen.');
  }
}

main().catch((e) => {
  console.error('FALLÓ:', e.message);
  process.exit(1);
});
