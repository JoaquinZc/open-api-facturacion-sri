/**
 * Fechas de calendario del SRI: un **día**, no un instante.
 *
 * Las vigencias de los catálogos y la `fechaEmision` de un comprobante son
 * días de Ecuador. Se manejan como texto `aaaa-mm-dd`, que se compara bien
 * como cadena y no arrastra la zona horaria del servidor (Railway corre en UTC:
 * entre las 19:00 y las 24:00 de Ecuador, `new Date()` ya es «mañana»).
 */

/** Hoy en Ecuador (UTC-5, sin horario de verano), como `aaaa-mm-dd`. */
export function hoyEnEcuador(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

/** `dd/mm/aaaa` (formato del SRI) → `aaaa-mm-dd`. */
export function fechaSriAIso(fecha: string): string {
  const [dia, mes, anio] = fecha.split('/');
  return `${anio}-${mes}-${dia}`;
}

/** ¿Es `aaaa-mm-dd` y un día que existe? */
export function esFechaIso(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}
