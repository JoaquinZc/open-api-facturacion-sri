/**
 * =====================================================================
 * DB Bootstrap — carga database/init.sql una sola vez
 * =====================================================================
 * Se ejecuta en el arranque del contenedor, ANTES de levantar Nest.
 *
 * Comportamiento:
 *   - Si el esquema nunca se cargó  → ejecuta init.sql en una transacción.
 *   - Si ya se cargó                → no hace nada y deja pasar.
 *   - Si el esquema ya existía pero sin marca (cargado a mano con psql)
 *     → solo registra la marca, NO vuelve a ejecutar el SQL.
 *
 * Es seguro con varias réplicas arrancando a la vez: usa un advisory lock
 * de PostgreSQL para que solo una haga el trabajo y el resto espere.
 *
 * Además crea el SUPERADMIN inicial a partir de BOOTSTRAP_ADMIN_EMAIL y
 * BOOTSTRAP_ADMIN_PASSWORD. No va sembrado en init.sql para no dejar una
 * contraseña en texto plano dentro del repositorio.
 *
 * Variables opcionales:
 *   DB_BOOTSTRAP_SKIP=true            → omite el bootstrap por completo
 *   DB_INIT_SQL_PATH=/ruta            → ruta alterna al init.sql
 *   BOOTSTRAP_ADMIN_RESET_PASSWORD=true → reescribe la contraseña del admin
 *                                         aunque el usuario ya exista
 * =====================================================================
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcrypt';
import { Client } from 'pg';

/** Clave del advisory lock. Arbitraria pero estable: no debe cambiar nunca. */
const ADVISORY_LOCK_KEY = 727164081;

/** Tabla marca que registra que el init.sql ya corrió. */
const MARKER_TABLE = 'public.schema_bootstrap';

/** Tabla que se usa como evidencia de un esquema precargado a mano. */
const SENTINEL_TABLE = 'public.usuarios';

const MAX_CONNECT_ATTEMPTS = 5;

/** Mismo coste que usa AuthService para que los hashes sean homogéneos. */
const BCRYPT_ROUNDS = 12;

const log = (msg: string) => console.log(`[db-bootstrap] ${msg}`);

function resolveInitSqlPath(): string {
  if (process.env.DB_INIT_SQL_PATH) return process.env.DB_INIT_SQL_PATH;
  // dist/scripts/db-bootstrap.js → <raíz>/database/init.sql
  return join(__dirname, '..', '..', 'database', 'init.sql');
}

function readInitSql(): string {
  const path = resolveInitSqlPath();
  const raw = readFileSync(path, 'utf8');

  // pg_dump 17 emite `SET transaction_timeout`, un GUC que solo existe desde
  // PostgreSQL 17. Contra un servidor 16 o menor ese SET aborta el script
  // entero, así que se elimina: es tuning de sesión, no afecta al esquema.
  return raw.replace(/^SET transaction_timeout = .*$/gm, '');
}

function buildClient(): Client {
  return new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:
      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: parseInt(
      process.env.DB_CONNECTION_TIMEOUT ?? '10000',
      10,
    ),
    application_name: 'open-api-facturacion-sri-bootstrap',
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * La base puede tardar en aceptar conexiones cuando todo el stack arranca a la
 * vez (Railway, docker-compose). Reintenta con backoff antes de rendirse.
 */
async function connectWithRetry(): Promise<Client> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    const client = buildClient();
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      const waitMs = attempt * 2000;
      log(
        `conexión fallida (intento ${attempt}/${MAX_CONNECT_ATTEMPTS}): ${(error as Error).message}. Reintentando en ${waitMs}ms...`,
      );
      if (attempt < MAX_CONNECT_ATTEMPTS) await sleep(waitMs);
    }
  }

  throw lastError;
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [table],
  );
  return rows[0]?.exists === true;
}

async function markApplied(client: Client, source: string): Promise<void> {
  await client.query(
    `INSERT INTO ${MARKER_TABLE} (id, source) VALUES (1, $1)
     ON CONFLICT (id) DO NOTHING`,
    [source],
  );
}

/**
 * Crea el SUPERADMIN inicial. Sin él no hay forma de entrar: POST /auth/register
 * exige rol SUPERADMIN, así que el primer usuario solo puede nacer aquí.
 *
 * Por defecto NO toca un usuario que ya exista, para no pisar una contraseña
 * cambiada con PATCH /auth/change-password en cada despliegue.
 */
async function seedAdmin(client: Client): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    log(
      '⚠️  BOOTSTRAP_ADMIN_EMAIL y/o BOOTSTRAP_ADMIN_PASSWORD sin configurar → no se creó ningún superadmin.',
    );
    return;
  }

  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM public.usuarios WHERE email = $1',
    [email],
  );

  if (rows.length > 0) {
    if (process.env.BOOTSTRAP_ADMIN_RESET_PASSWORD !== 'true') {
      log(`superadmin ${email} ya existe → sin cambios.`);
      return;
    }

    await client.query(
      `UPDATE public.usuarios
          SET password_hash = $2,
              rol           = 'SUPERADMIN'::public.user_role,
              activo        = true,
              updated_at    = now()
        WHERE email = $1`,
      [email, await bcrypt.hash(password, BCRYPT_ROUNDS)],
    );
    log(
      `🔑 contraseña de ${email} restablecida (BOOTSTRAP_ADMIN_RESET_PASSWORD=true). Quita esa variable para que no vuelva a pasar.`,
    );
    return;
  }

  await client.query(
    `INSERT INTO public.usuarios (email, password_hash, rol, tenant_id, activo)
     VALUES ($1, $2, 'SUPERADMIN'::public.user_role, NULL, true)
     ON CONFLICT (email) DO NOTHING`,
    [email, await bcrypt.hash(password, BCRYPT_ROUNDS)],
  );
  log(`✅ superadmin ${email} creado.`);
}

/**
 * Cambios de esquema **posteriores** a `init.sql`.
 *
 * 🔴 `init.sql` se aplica **una sola vez en la vida de la base**. En cuanto
 * queda la marca no se vuelve a mirar, así que una columna añadida allí llega
 * únicamente a las instalaciones nuevas: la que está en producción no la ve
 * nunca. Ese es exactamente el fallo que se descubre cuando el despliegue va
 * bien y luego revienta una consulta por una columna que «ya está en el SQL».
 *
 * Por eso esto corre **en cada arranque** y es aditivo e idempotente: solo
 * `ADD COLUMN IF NOT EXISTS`, nada que borre ni reescriba. No hace falta un
 * framework de migraciones para un puñado de columnas, pero sí hace falta que
 * alguien las aplique.
 *
 * **Reglas para añadir aquí:**
 *   - Solo operaciones que se puedan repetir sin efecto (`IF NOT EXISTS`).
 *   - Nunca `DROP` ni `ALTER TYPE`: eso necesita una ventana y un respaldo.
 *   - Nunca una columna `NOT NULL` sin `DEFAULT`: bloquea el arranque contra
 *     una tabla con filas.
 */
const ADDITIVE_MIGRATIONS: Array<{ nombre: string; sql: string }> = [
  {
    nombre: 'emisores: datos de marca para el RIDE',
    sql: `
      ALTER TABLE public.emisores
        ADD COLUMN IF NOT EXISTS eslogan  character varying(160),
        ADD COLUMN IF NOT EXISTS ciudad   character varying(120),
        ADD COLUMN IF NOT EXISTS email    character varying(255),
        ADD COLUMN IF NOT EXISTS web      character varying(255),
        ADD COLUMN IF NOT EXISTS telefono character varying(40),
        ADD COLUMN IF NOT EXISTS logo_url character varying(500)
    `,
  },
  {
    /*
     * El respaldo de los XML cuando el almacenamiento de objetos no responde.
     *
     * 🔴 **No es una copia de todo: solo se rellena si la subida falló.** El
     * guardado ocurre después de mandar el comprobante al SRI, así que no puede
     * fallar — si lanzara, la transacción haría rollback, el comprobante
     * desaparecería de la base y el SRI seguiría teniéndolo. Estas dos columnas
     * son lo que hace que ese caso no pierda el documento.
     *
     * `text` y no `varchar`: un XML de factura ronda los 10 KB pero no hay un
     * tope razonable que poner, y en PostgreSQL los dos se almacenan igual.
     */
    nombre: 'comprobante_xmls: respaldo del contenido',
    sql: `
      ALTER TABLE public.comprobante_xmls
        ADD COLUMN IF NOT EXISTS xml_firmado_contenido    text,
        ADD COLUMN IF NOT EXISTS xml_autorizado_contenido text
    `,
  },
];

async function applyAdditiveMigrations(client: Client): Promise<void> {
  for (const { nombre, sql } of ADDITIVE_MIGRATIONS) {
    try {
      await client.query(sql);
      log(`· ${nombre}`);
    } catch (error) {
      // Se informa y se sigue: una migración aditiva que falla no debe impedir
      // que arranque el servicio. Lo contrario deja la API caída por una
      // columna opcional.
      log(`⚠️  «${nombre}» falló: ${(error as Error).message}`);
    }
  }
}

async function run(): Promise<void> {
  if (process.env.DB_BOOTSTRAP_SKIP === 'true') {
    log('DB_BOOTSTRAP_SKIP=true → se omite el bootstrap.');
    return;
  }

  const client = await connectWithRetry();

  try {
    // Serializa entre réplicas: la primera hace el trabajo, las demás esperan
    // aquí y al entrar ya encuentran la marca puesta.
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (
        id          integer PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        source      text NOT NULL,
        CONSTRAINT schema_bootstrap_single_row CHECK (id = 1)
      )
    `);

    const { rows } = await client.query<{ applied_at: Date; source: string }>(
      `SELECT applied_at, source FROM ${MARKER_TABLE} WHERE id = 1`,
    );

    if (rows.length > 0) {
      log(
        `esquema ya inicializado el ${rows[0].applied_at.toISOString()} (${rows[0].source}) → nada que aplicar.`,
      );
    } else if (await tableExists(client, SENTINEL_TABLE)) {
      // Esquema cargado a mano antes de existir este script: se respeta lo que
      // hay y solo se deja la marca, para no reventar contra objetos existentes.
      log(
        `${SENTINEL_TABLE} ya existe pero no había marca → se registra como preexistente sin ejecutar init.sql.`,
      );
      await markApplied(client, 'preexisting');
    } else {
      const sql = readInitSql();
      log(`aplicando ${resolveInitSqlPath()}...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await markApplied(client, 'init.sql');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      log('✅ esquema inicializado correctamente.');
    }

    // Corre siempre, tanto si el esquema se acaba de crear como si ya estaba:
    // es la única vía por la que un cambio de esquema llega a la base que ya
    // está en producción.
    await applyAdditiveMigrations(client);

    // Corre siempre: cubre el caso de una base con esquema pero sin superadmin.
    await seedAdmin(client);
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
      .catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(`[db-bootstrap] ❌ falló: ${error.message}`);
    process.exit(1);
  });
