import {
  IVA_CASILLEROS_104,
  IVA_TABLA_20,
  MIGRACIONES_CATALOGO_RETENCIONES,
  RENTA_DESDE_2026_03_01,
  SUSTENTOS,
} from './catalogo-retenciones';

const renta = (codigo: string) =>
  RENTA_DESDE_2026_03_01.find((f) => f.codigo === codigo)?.porcentaje;

describe('Catálogo de retenciones (fase R0)', () => {
  it('renta: los porcentajes de la NAC-DGERCGC26-00000009', () => {
    // Art. 2 de la resolución, por numeral; y el residual del art. 3.
    expect(renta('343')).toBe(1); // RIMPE emprendedor y «otras al 1 %»
    expect(renta('310')).toBe(1); // transporte
    expect(renta('312')).toBe(2); // bienes muebles (era 1,75)
    expect(renta('343B')).toBe(2); // construcción (era 1,75)
    expect(renta('307')).toBe(3); // mano de obra (era 2)
    expect(renta('309')).toBe(3); // publicidad (era 2,75)
    expect(renta('3440')).toBe(3); // residual, art. 3 (era 2,75)
    expect(renta('303A')).toBe(5); // profesionales de sociedades (era 3)
    expect(renta('3482')).toBe(5); // comisiones a sociedades (era 3)
    expect(renta('303')).toBe(10);
    expect(renta('320')).toBe(10); // arriendo de inmuebles
    expect(renta('332')).toBe(0); // negocio popular
  });

  it('renta: deja fuera dividendos, exterior y porcentajes variables', () => {
    const codigos = RENTA_DESDE_2026_03_01.map((f) => f.codigo);
    for (const fuera of ['325', '326', '327', '338', '346', '3481', '350']) {
      expect(codigos).not.toContain(fuera);
    }
    expect(codigos.every((c) => c < '400')).toBe(true);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('IVA: los códigos de la tabla 20 de la ficha técnica, no los casilleros del 104', () => {
    const porCodigo = Object.fromEntries(
      IVA_TABLA_20.map((f) => [f.codigo, f.porcentaje]),
    );
    expect(porCodigo).toEqual({
      '9': 10,
      '10': 20,
      '1': 30,
      '11': 50,
      '2': 70,
      '3': 100,
      '7': 0,
      '8': 0,
    });
    for (const casillero of IVA_CASILLEROS_104) {
      expect(porCodigo[casillero]).toBeUndefined();
    }
  });

  it('caben en las columnas: código ≤ 5 (comprobante_retenciones) y descripción ≤ 500', () => {
    for (const f of [...RENTA_DESDE_2026_03_01, ...IVA_TABLA_20]) {
      expect(f.codigo.length).toBeLessThanOrEqual(5);
      expect(f.descripcion.length).toBeLessThanOrEqual(500);
      expect(f.porcentaje).toBeLessThan(1000); // numeric(5,2)
    }
  });

  it('sustento: la Tabla 5, con los documentos que admite cada uno', () => {
    const s = (codigo: string) => SUSTENTOS.find((x) => x.codigo === codigo)!;
    // La nota de venta (02) no da crédito de IVA: el 01 no la admite.
    expect(s('01').documentos).not.toContain('02');
    expect(s('02').documentos).toContain('02');
    expect(s('06').documentos).toContain('01');
    // El 00 dejó de valer el 28-02-2015.
    expect(s('00').vigenteHasta).toBe('2015-02-28');
    expect(
      SUSTENTOS.filter((x) => !x.vigenteHasta).map((x) => x.codigo),
    ).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
    ]);
  });

  it('el SQL no borra nada y se puede repetir', () => {
    for (const { nombre, sql } of MIGRACIONES_CATALOGO_RETENCIONES) {
      expect({
        nombre,
        destructivo: /\b(DROP|DELETE|TRUNCATE)\b/i.test(sql),
      }).toEqual({
        nombre,
        destructivo: false,
      });
      for (const insert of sql.match(
        /INSERT INTO[\s\S]*?;|INSERT INTO[\s\S]*$/g,
      ) ?? []) {
        expect(insert).toMatch(/ON CONFLICT/);
      }
      // Todo UPDATE se acota con su WHERE.
      for (const update of sql.match(/UPDATE [\s\S]*?;/g) ?? []) {
        expect(update).toMatch(/WHERE/);
      }
    }
  });

  it('cada descripción entra entera como literal SQL', () => {
    const sql = MIGRACIONES_CATALOGO_RETENCIONES.map((m) => m.sql).join('\n');
    for (const f of [
      ...RENTA_DESDE_2026_03_01,
      ...IVA_TABLA_20,
      ...SUSTENTOS,
    ]) {
      expect(sql).toContain(`'${f.descripcion.replace(/'/g, "''")}'`);
    }
  });
});
