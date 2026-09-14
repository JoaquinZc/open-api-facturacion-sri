/**
 * Reintenta una llamada a Carbone mientras el contenedor **está despertando**.
 *
 * ═══ Por qué hace falta ═══════════════════════════════════════════════════
 *
 * Carbone corre en Railway con *serverless*: tras unos 10 minutos sin tráfico
 * se duerme, y lo despierta la siguiente petición por la red privada. Esa
 * primera petición puede recibir un 502 del proxy, o un rechazo de conexión,
 * mientras el contenedor arranca (en torno a un segundo). Sin esto, la primera
 * descarga de un RIDE después de un rato sin uso fallaba y había que pulsar
 * otra vez.
 *
 * ═══ Qué se reintenta y qué no ════════════════════════════════════════════
 *
 * Solo lo que significa «todavía no está»: 502, 503 o 504, o un error de
 * conexión **sin respuesta**. Un 4xx es Carbone contestando que no, y
 * reintentarlo no cambia nada; un error sin código es un fallo nuestro.
 *
 * `accion` construye la petición **entera** en cada intento. Un cuerpo
 * `multipart` se consume al enviarlo —con un flujo o con `form-data` sobre
 * búferes—, así que reenviar el mismo objeto manda un cuerpo vacío.
 */

const CODIGOS_DE_CONEXION = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'EPIPE',
]);

const ESTADOS_DE_ARRANQUE = new Set([502, 503, 504]);

export interface OpcionesDespertar {
  /** Intentos en total, contando el primero. */
  intentos?: number;
  /** La espera crece lineal: base, 2·base, 3·base… */
  esperaBaseMs?: number;
  /** Qué se estaba haciendo, para el log: «subir la plantilla». */
  operacion?: string;
  logger?: { warn(mensaje: string): void };
  /** Solo para las pruebas, que no quieren esperar de verdad. */
  dormir?: (ms: number) => Promise<void>;
}

/** `true` si el error dice que Carbone aún no está, no que haya contestado mal. */
export function carboneTodaviaNoEsta(err: unknown): boolean {
  const e = err as { response?: { status?: number }; code?: unknown } | null;
  if (e?.response) return ESTADOS_DE_ARRANQUE.has(e.response.status ?? 0);
  return typeof e?.code === 'string' && CODIGOS_DE_CONEXION.has(e.code);
}

function describir(err: unknown): string {
  const e = err as { response?: { status?: number }; code?: unknown };
  return e.response ? `HTTP ${e.response.status}` : String(e.code);
}

/**
 * Con los valores por defecto espera como mucho 1 + 2 + 3 + 4 = 10 s, por
 * debajo de los 30 s con los que Business corta la llamada al servicio.
 */
export async function conCarboneDespierto<T>(
  accion: () => Promise<T>,
  {
    intentos = 5,
    esperaBaseMs = 1000,
    operacion = 'llamar a Carbone',
    logger,
    dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: OpcionesDespertar = {},
): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await accion();
    } catch (err) {
      if (intento >= intentos || !carboneTodaviaNoEsta(err)) throw err;

      const espera = esperaBaseMs * intento;
      logger?.warn(
        `Carbone no respondió al ${operacion} (${describir(err)}); puede estar ` +
          `despertando. Intento ${intento + 1}/${intentos} en ${espera} ms.`,
      );
      await dormir(espera);
    }
  }
}
