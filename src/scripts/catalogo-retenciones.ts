/**
 * =====================================================================
 * Catálogo de retenciones y de sustento tributario, al día
 * =====================================================================
 * Fase R0 de retenciones, 2026-09-30. Lo aplica `db-bootstrap.ts` en cada
 * arranque, porque `init.sql` solo corre una vez en la vida de la base.
 *
 * **De dónde sale cada tabla** (copias leídas enteras, no de memoria):
 *   - **Renta** — Catálogo ATS del SRI, hoja «TABLAS RETENCIONES», Tabla 3.10,
 *     columna «Desde 01/03/2026», que es la tabla de la resolución
 *     NAC-DGERCGC26-00000009. Las columnas del 01/08 y 06/08/2026 solo añaden
 *     la nota de transporte de la NAC-DGERCGC26-00000028 (310 y 332E), sin
 *     cambiar ningún porcentaje fijo de esta lista.
 *   - **IVA** — ficha técnica de comprobantes electrónicos v2.32, Tabla 20.
 *   - **ISD** — misma ficha, Tabla 20 (Decreto Ejecutivo 589 para el 4586).
 *   - **Sustento** — Catálogo ATS, hoja «TABLAS REFERENCIALES», Tabla 5.
 *
 * **Lo que se deja fuera a propósito**: dividendos (325–331, 3250), pagos al
 * exterior (5xx), los códigos con espacio en el catálogo («323 M»…) y los de
 * porcentaje variable (338, 346*, 350, 3481): ninguno tiene un porcentaje que
 * se pueda comprobar, y están fuera del plan de retenciones.
 * =====================================================================
 */

export interface FilaRetencion {
  codigo: string;
  porcentaje: number;
  descripcion: string;
}

export interface FilaSustento {
  codigo: string;
  descripcion: string;
  /** `codDocSustento` que admite, de la misma Tabla 5, con dos dígitos. */
  documentos: string[];
  vigenteDesde: string;
  vigenteHasta?: string;
}

/** Desde cuándo vale la tabla de renta de la NAC-DGERCGC26-00000009. */
export const RENTA_VIGENTE_DESDE = '2026-03-01';

export const RENTA_DESDE_2026_03_01: FilaRetencion[] = [
  {
    codigo: '303',
    porcentaje: 10,
    descripcion:
      'Honorarios profesionales y demás pagos por servicios relacionados con el título profesional',
  },
  {
    codigo: '303A',
    porcentaje: 5,
    descripcion: 'Servicios profesionales prestados por sociedades residentes',
  },
  {
    codigo: '304',
    porcentaje: 10,
    descripcion:
      'Servicios predomina el intelecto no relacionados con el título profesional',
  },
  {
    codigo: '304A',
    porcentaje: 10,
    descripcion:
      'Comisiones y demás pagos por servicios predomina intelecto no relacionados con el título profesional',
  },
  {
    codigo: '304B',
    porcentaje: 10,
    descripcion:
      'Pagos a notarios y registradores de la propiedad y mercantil por sus actividades ejercidas como tales',
  },
  {
    codigo: '304C',
    porcentaje: 10,
    descripcion:
      'Pagos a deportistas, entrenadores, árbitros, miembros del cuerpo técnico por sus actividades ejercidas como tales',
  },
  {
    codigo: '304D',
    porcentaje: 10,
    descripcion: 'Pagos a artistas por sus actividades ejercidas como tales',
  },
  {
    codigo: '304E',
    porcentaje: 10,
    descripcion: 'Honorarios y demás pagos por servicios de docencia',
  },
  {
    codigo: '307',
    porcentaje: 3,
    descripcion: 'Servicios predomina la mano de obra',
  },
  {
    codigo: '308',
    porcentaje: 10,
    descripcion:
      'Utilización o aprovechamiento de la imagen o renombre (personas naturales, sociedades, "influencers")',
  },
  {
    codigo: '309',
    porcentaje: 3,
    descripcion:
      'Servicios prestados por medios de comunicación y agencias de publicidad',
  },
  {
    codigo: '310',
    porcentaje: 1,
    descripcion:
      'Servicio de transporte privado de pasajeros o transporte público o privado de carga',
  },
  {
    codigo: '311',
    porcentaje: 3,
    descripcion:
      'Pagos a través de liquidación de compra (nivel cultural o rusticidad)',
  },
  {
    codigo: '312',
    porcentaje: 2,
    descripcion: 'Transferencia de bienes muebles de naturaleza corporal',
  },
  {
    codigo: '312A',
    porcentaje: 1,
    descripcion:
      'COMPRAS AL PRODUCTOR: de bienes de origen bioacuático, forestal y los descritos el art.27.1 de LRTI',
  },
  {
    codigo: '312C',
    porcentaje: 1.75,
    descripcion:
      'COMPRAS AL COMERCIALIZADOR: de bienes de origen bioacuático, forestal y los descritos el art.27.1 de LRTI',
  },
  {
    codigo: '314A',
    porcentaje: 10,
    descripcion:
      'Regalías por concepto de franquicias de acuerdo al Código INGENIOS (COESCCI) - pago a personas naturales',
  },
  {
    codigo: '314B',
    porcentaje: 10,
    descripcion:
      'Cánones, derechos de autor, marcas, patentes y similares de acuerdo al Código INGENIOS (COESCCI) – pago a personas naturales',
  },
  {
    codigo: '314C',
    porcentaje: 10,
    descripcion:
      'Regalías por concepto de franquicias de acuerdo al Código INGENIOS (COESCCI) - pago a sociades',
  },
  {
    codigo: '314D',
    porcentaje: 10,
    descripcion:
      'Cánones, derechos de autor, marcas, patentes y similares de acuerdo al Código INGENIOS (COESCCI)',
  },
  {
    codigo: '319',
    porcentaje: 2,
    descripcion:
      'Cuotas de arrendamiento mercantil (prestado por sociedades), inclusive la de opción de compra',
  },
  {
    codigo: '320',
    porcentaje: 10,
    descripcion: 'Arrendamiento bienes inmuebles',
  },
  {
    codigo: '322',
    porcentaje: 2,
    descripcion: 'Seguros y reaseguros (primas y cesiones)',
  },
  {
    codigo: '323',
    porcentaje: 3,
    descripcion:
      'Rendimientos financieros pagados a naturales y sociedades (No a IFIs)',
  },
  {
    codigo: '323A',
    porcentaje: 3,
    descripcion: 'Rendimientos financieros depósitos Cta. Corriente',
  },
  {
    codigo: '323B1',
    porcentaje: 3,
    descripcion: 'Rendimientos financieros depósitos Cta. Ahorros Sociedades',
  },
  {
    codigo: '323E',
    porcentaje: 3,
    descripcion: 'Rendimientos financieros depósito a plazo fijo gravados',
  },
  {
    codigo: '323E2',
    porcentaje: 0,
    descripcion: 'Rendimientos financieros depósito a plazo fijo exentos',
  },
  {
    codigo: '323F',
    porcentaje: 3,
    descripcion: 'Rendimientos financieros operaciones de reporto - repos',
  },
  {
    codigo: '323G',
    porcentaje: 3,
    descripcion:
      'Inversiones (captaciones) rendimientos distintos de aquellos pagados a IFIs',
  },
  {
    codigo: '323H',
    porcentaje: 3,
    descripcion: 'Rendimientos financieros obligaciones',
  },
  {
    codigo: '323I',
    porcentaje: 3,
    descripcion: 'Rendimientos financieros bonos convertible en acciones',
  },
  {
    codigo: '323Q',
    porcentaje: 3,
    descripcion: 'Otros intereses y rendimientos financieros gravados',
  },
  {
    codigo: '323R',
    porcentaje: 0,
    descripcion: 'Otros intereses y rendimientos financieros exentos',
  },
  {
    codigo: '323S',
    porcentaje: 3,
    descripcion:
      'Pagos y créditos en cuenta efectuados por el BCE y los depósitos centralizados de valores, en calidad de intermediarios, a instituciones del sistema financiero por cuenta de otras personas naturales y sociedades',
  },
  {
    codigo: '323T',
    porcentaje: 0,
    descripcion:
      'Rendimientos financieros originados en la deuda pública ecuatoriana',
  },
  {
    codigo: '323U',
    porcentaje: 0,
    descripcion:
      'Rendimientos financieros originados en títulos valores de obligaciones de 360 días o más para el financiamiento de proyectos públicos en asociación público-privada',
  },
  {
    codigo: '324A',
    porcentaje: 2,
    descripcion:
      'Intereses en operaciones de crédito entre instituciones del sistema financiero y entidades economía popular y solidaria.',
  },
  {
    codigo: '324B',
    porcentaje: 2,
    descripcion:
      'Inversiones entre instituciones del sistema financiero y entidades economía popular y solidaria',
  },
  {
    codigo: '324C',
    porcentaje: 2,
    descripcion:
      'Pagos y créditos en cuenta efectuados por el BCE y los depósitos centralizados de valores, en calidad de intermediarios, a instituciones del sistema financiero por cuenta de otras instituciones del sistema financiero',
  },
  {
    codigo: '332',
    porcentaje: 0,
    descripcion:
      'Otras compras de bienes y servicios no sujetas a retención (incluye régimen RIMPE - Negocios Populares, para este caso aplica con cualquier forma de pago inclusive los pagos que deban realizar las tarjetas de crédito/débito)',
  },
  { codigo: '332B', porcentaje: 0, descripcion: 'Compra de bienes inmuebles' },
  {
    codigo: '332C',
    porcentaje: 0,
    descripcion: 'Transporte público de pasajeros',
  },
  {
    codigo: '332D',
    porcentaje: 0,
    descripcion:
      'Pagos en el país por transporte de pasajeros o transporte internacional de carga, a compañías nacionales o extranjeras de aviación o marítimas',
  },
  {
    codigo: '332E',
    porcentaje: 0,
    descripcion:
      'Valores entregados por las cooperativas de transporte a sus socios',
  },
  {
    codigo: '332F',
    porcentaje: 0,
    descripcion:
      'Compraventa de divisas distintas al dólar de los Estados Unidos de América',
  },
  {
    codigo: '332G',
    porcentaje: 0,
    descripcion: 'Pagos con tarjeta de crédito',
  },
  {
    codigo: '332H',
    porcentaje: 0,
    descripcion:
      'Pago al exterior tarjeta de crédito reportada por la Emisora de tarjeta de crédito, solo recap',
  },
  {
    codigo: '332I',
    porcentaje: 0,
    descripcion: 'Pago a través de convenio de debito (Clientes IFI`s)',
  },
  {
    codigo: '333',
    porcentaje: 10,
    descripcion:
      'Ganancia en la enajenación de derechos representativos de capital u otros derechos que permitan la exploración, explotación, concesión o similares de sociedades, que se coticen en bolsa de valores del Ecuador',
  },
  {
    codigo: '334',
    porcentaje: 2,
    descripcion:
      'Contraprestación producida por la enajenación de derechos representativos de capital u otros derechos que permitan la exploración, explotación, concesión o similares de sociedades, no cotizados en bolsa de valores del Ecuador',
  },
  {
    codigo: '335',
    porcentaje: 15,
    descripcion:
      'Loterías, rifas, pronósticos deportivos, apuestas y similares',
  },
  // «2/mil» y «3/mil» en el catálogo: 0,20 % y 0,30 %.
  {
    codigo: '336',
    porcentaje: 0.2,
    descripcion: 'Venta de combustibles a comercializadoras',
  },
  {
    codigo: '337',
    porcentaje: 0.3,
    descripcion: 'Venta de combustibles a distribuidores',
  },
  {
    codigo: '340',
    porcentaje: 3,
    descripcion: 'Impuesto único a la exportación de banano',
  },
  {
    codigo: '343',
    porcentaje: 1,
    descripcion:
      'Otras retenciones aplicables el 1% (incluye régimen RIMPE - Emprendedores, para este caso aplica con cualquier forma de pago inclusive los pagos que deban realizar las tarjetas de crédito/débito)',
  },
  { codigo: '343A', porcentaje: 2, descripcion: 'Energía eléctrica' },
  {
    codigo: '343B',
    porcentaje: 2,
    descripcion:
      'Actividades de construcción de obra material inmueble, urbanización, lotización o actividades similares',
  },
  {
    codigo: '343C',
    porcentaje: 2,
    descripcion: 'Recepción de botellas plásticas no retornables de PET',
  },
  {
    codigo: '3440',
    porcentaje: 3,
    descripcion: 'Otras retenciones aplicables el 3%',
  },
  {
    codigo: '344A',
    porcentaje: 2,
    descripcion:
      'Pago local tarjeta de crédito /débito reportada por la Emisora de tarjeta de crédito / entidades del sistema financiero/sistemas auxiliares de pago',
  },
  {
    codigo: '344B',
    porcentaje: 2,
    descripcion:
      'Adquisición de sustancias minerales dentro del territorio nacional',
  },
  {
    codigo: '3480',
    porcentaje: 15,
    descripcion:
      'Impuesto a la renta único sobre los ingresos percibidos por los operadores de pronósticos deportivos',
  },
  {
    codigo: '3482',
    porcentaje: 5,
    descripcion:
      'Comisiones a sociedades, nacionales o extranjeras residentes y establecimientos permanentes domiciliados en el país',
  },
];

/**
 * **IVA: los códigos del XML no son 721–731.** Esos son casilleros del
 * formulario 104, y `init.sql` los traía cruzados (721 al 30 %, cuando en el
 * 104 el 721 es el 10 %). El `<codigoRetencion>` del comprobante 07 lleva los
 * de la Tabla 20 de la ficha técnica, que es la que valida el SRI.
 *
 * `vigente_desde` es el piso del catálogo de este servicio, no la fecha legal:
 * los códigos existen desde 2016 y la versión 2.0.0 es obligatoria desde 2022.
 */
export const IVA_VIGENTE_DESDE = '2024-01-01';

export const IVA_TABLA_20: FilaRetencion[] = [
  {
    codigo: '9',
    porcentaje: 10,
    descripcion:
      'Retención 10 % del IVA (bienes, entre contribuyentes especiales)',
  },
  {
    codigo: '10',
    porcentaje: 20,
    descripcion:
      'Retención 20 % del IVA (servicios, entre contribuyentes especiales)',
  },
  {
    codigo: '1',
    porcentaje: 30,
    descripcion: 'Retención 30 % del IVA (bienes)',
  },
  { codigo: '11', porcentaje: 50, descripcion: 'Retención 50 % del IVA' },
  {
    codigo: '2',
    porcentaje: 70,
    descripcion: 'Retención 70 % del IVA (servicios)',
  },
  {
    codigo: '3',
    porcentaje: 100,
    descripcion:
      'Retención 100 % del IVA (profesionales, arriendo a persona natural, liquidación de compra)',
  },
  {
    codigo: '7',
    porcentaje: 0,
    descripcion: 'Retención en cero (NAC-DGERCGC15-00000284)',
  },
  { codigo: '8', porcentaje: 0, descripcion: 'No procede retención' },
];

/** Los casilleros del 104 que `init.sql` sembró como si fueran códigos. */
export const IVA_CASILLEROS_104 = ['721', '723', '725', '727', '729', '731'];

/**
 * ISD: el 4580 al 5 % ya está sembrado (vigente desde el 01-04-2024 según la
 * ficha). El 4586 al 2,5 % convive con él desde el 01-05-2025.
 */
export const ISD_4586: FilaRetencion & { vigenteDesde: string } = {
  codigo: '4586',
  porcentaje: 2.5,
  descripcion: 'Retención ISD 2,5 % (Decreto Ejecutivo 589)',
  vigenteDesde: '2025-05-01',
};

/**
 * Códigos de renta que `init.sql` trajo de una tabla antigua, con significado
 * equivocado («340 Aplicables el 1%», «343 Aplicables el 25%»…). En la Tabla
 * 3.10 de 2024 y de 2026 el 340 es el banano y el 341, 342 y 344 no existen.
 */
export const RENTA_HEREDADOS_ERRONEOS = ['340', '341', '342', '344'];

export const SUSTENTOS: FilaSustento[] = [
  {
    codigo: '01',
    descripcion:
      'Crédito Tributario para declaración de IVA (servicios y bienes distintos de inventarios y activos fijos)',
    documentos: [
      '01',
      '03',
      '04',
      '05',
      '11',
      '12',
      '21',
      '41',
      '43',
      '47',
      '48',
      '294',
      '344',
    ],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '02',
    descripcion:
      'Costo o Gasto para declaración de IR (servicios y bienes distintos de inventarios y activos fijos)',
    documentos: [
      '01',
      '02',
      '03',
      '04',
      '05',
      '09',
      '11',
      '12',
      '15',
      '19',
      '20',
      '21',
      '41',
      '43',
      '47',
      '48',
      '294',
      '344',
      '364',
    ],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '03',
    descripcion: 'Activo Fijo - Crédito Tributario para declaración de IVA',
    documentos: ['01', '03', '04', '05', '41', '47', '48', '294', '344'],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '04',
    descripcion: 'Activo Fijo - Costo o Gasto para declaración de IR',
    documentos: [
      '01',
      '02',
      '03',
      '04',
      '05',
      '15',
      '41',
      '47',
      '48',
      '294',
      '344',
    ],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '05',
    descripcion:
      'Liquidación Gastos de Viaje, hospedaje y alimentación Gastos IR (a nombre de empleados y no de la empresa)',
    documentos: ['01', '02', '03', '04', '05', '11', '15', '41', '294', '344'],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '06',
    descripcion: 'Inventario - Crédito Tributario para declaración de IVA',
    documentos: ['01', '03', '04', '05', '41', '43', '47', '48', '294', '344'],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '07',
    descripcion: 'Inventario - Costo o Gasto para declaración de IR',
    documentos: [
      '01',
      '02',
      '03',
      '04',
      '05',
      '15',
      '41',
      '43',
      '47',
      '48',
      '294',
      '344',
      '364',
    ],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '08',
    descripcion:
      'Valor pagado para solicitar Reembolso de Gasto (intermediario)',
    documentos: ['01', '02', '03', '04', '05', '21', '294', '344'],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '09',
    descripcion: 'Reembolso por Siniestros',
    documentos: ['01', '04', '05', '45'],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '10',
    descripcion: 'Distribución de Dividendos, Beneficios o Utilidades',
    documentos: ['19'],
    vigenteDesde: '2000-01-01',
  },
  {
    codigo: '11',
    descripcion: 'Convenios de débito o recaudación para IFI´s',
    documentos: ['12'],
    vigenteDesde: '2015-03-01',
  },
  {
    codigo: '12',
    descripcion: 'Impuestos y retenciones presuntivos',
    documentos: ['42'],
    vigenteDesde: '2015-03-01',
  },
  {
    codigo: '13',
    descripcion:
      'Valores reconocidos por entidades del sector público a favor de sujetos pasivos',
    documentos: ['19'],
    vigenteDesde: '2015-03-01',
  },
  {
    codigo: '14',
    descripcion:
      'Valores facturados por socios a operadoras de transporte (que no constituyen gasto de dicha operadora)',
    documentos: ['01', '02', '03', '04', '05'],
    vigenteDesde: '2018-01-01',
  },
  {
    codigo: '15',
    descripcion:
      'Pagos efectuados por consumos propios y de terceros de servicios digitales',
    documentos: ['01', '02', '03', '04', '05', '12', '15'],
    vigenteDesde: '2020-06-01',
  },
  {
    codigo: '00',
    descripcion:
      'Casos especiales cuyo sustento no aplica en las opciones anteriores',
    documentos: ['01', '02', '04', '05', '19', '42'],
    vigenteDesde: '2000-01-01',
    vigenteHasta: '2015-02-28',
  },
];

// ---------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------

/** Literal de texto SQL. Los datos son constantes de este fichero. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const filasRetencion = (tipo: string, desde: string, filas: FilaRetencion[]) =>
  filas
    .map(
      (f) =>
        `(${lit(tipo)}, ${lit(f.codigo)}, ${lit(f.descripcion)}, ${f.porcentaje.toFixed(2)}, ${lit(desde)})`,
    )
    .join(',\n        ');

const insertRetenciones = (filas: string) => `
      INSERT INTO public.catalogo_retenciones (tipo, codigo, descripcion, porcentaje, vigente_desde)
      VALUES
        ${filas}
      ON CONFLICT (tipo, codigo, vigente_desde) DO NOTHING;`;

/**
 * Las migraciones del catálogo, en el formato de `ADDITIVE_MIGRATIONS`.
 *
 * Cada una va en **una sola consulta con varias sentencias**, que PostgreSQL
 * ejecuta como una transacción implícita: o entra entera o no entra.
 *
 * Todas se pueden repetir sin efecto:
 *   - los `INSERT` llevan `ON CONFLICT … DO NOTHING` sobre la clave
 *     `(tipo, codigo, vigente_desde)`, así que **no pisan** lo que se haya
 *     corregido a mano desde `/admin/catalogos`;
 *   - los `UPDATE` se acotan con la condición que los vuelve inertes la segunda
 *     vez (`porcentaje = 25`, `activo = true`).
 * Ninguna borra: lo que estaba mal se **desactiva**, para que un comprobante
 * antiguo que lo use siga pudiendo leerse.
 */
export const MIGRACIONES_CATALOGO_RETENCIONES: Array<{
  nombre: string;
  sql: string;
}> = [
  {
    nombre:
      'comprobante_retenciones: sustento, forma de pago e impuestos del documento',
    sql: `
      ALTER TABLE public.comprobante_retenciones
        ADD COLUMN IF NOT EXISTS cod_sustento character varying(2),
        ADD COLUMN IF NOT EXISTS forma_pago character varying(2),
        ADD COLUMN IF NOT EXISTS impuestos_doc_sustento jsonb
    `,
  },
  {
    // La tabla es entera de este fichero (no tiene pantalla de admin), así que
    // aquí sí se actualiza: una corrección en el código llega a la base.
    nombre: 'catalogo_sustento_tributario (Tabla 5 del Catálogo ATS)',
    sql: `
      CREATE TABLE IF NOT EXISTS public.catalogo_sustento_tributario (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        codigo character varying(2) NOT NULL,
        descripcion character varying(300) NOT NULL,
        documentos_sustento character varying(3)[] NOT NULL DEFAULT '{}',
        vigente_desde date NOT NULL,
        vigente_hasta date,
        activo boolean DEFAULT true,
        created_at timestamp with time zone DEFAULT now(),
        CONSTRAINT catalogo_sustento_tributario_codigo_vigente_desde_key
          UNIQUE (codigo, vigente_desde)
      );
      INSERT INTO public.catalogo_sustento_tributario
        (codigo, descripcion, documentos_sustento, vigente_desde, vigente_hasta)
      VALUES
        ${SUSTENTOS.map(
          (s) =>
            `(${lit(s.codigo)}, ${lit(s.descripcion)}, ARRAY[${s.documentos.map(lit).join(', ')}]::character varying(3)[], ${lit(s.vigenteDesde)}, ${s.vigenteHasta ? lit(s.vigenteHasta) : 'NULL'})`,
        ).join(',\n        ')}
      ON CONFLICT (codigo, vigente_desde) DO UPDATE
        SET descripcion = EXCLUDED.descripcion,
            documentos_sustento = EXCLUDED.documentos_sustento,
            vigente_hasta = EXCLUDED.vigente_hasta;`,
  },
  {
    nombre:
      'catalogo_retenciones: renta desde 01-03-2026 (NAC-DGERCGC26-00000009)',
    sql: `${insertRetenciones(filasRetencion('RENTA', RENTA_VIGENTE_DESDE, RENTA_DESDE_2026_03_01))}
      -- El 343 es el 1 % desde 2024; init.sql lo traía al 25 %.
      UPDATE public.catalogo_retenciones
         SET porcentaje = 1.00,
             descripcion = ${lit(RENTA_DESDE_2026_03_01.find((f) => f.codigo === '343')!.descripcion)},
             updated_at = now()
       WHERE tipo = 'RENTA' AND codigo = '343'
         AND vigente_desde = '2024-01-01' AND porcentaje = 25.00;
      UPDATE public.catalogo_retenciones
         SET activo = false, updated_at = now()
       WHERE tipo = 'RENTA'
         AND codigo IN (${RENTA_HEREDADOS_ERRONEOS.map(lit).join(', ')})
         AND vigente_desde = '2024-01-01'
         AND descripcion LIKE 'Aplicables%'
         AND activo = true;`,
  },
  {
    nombre:
      'catalogo_retenciones: IVA con los códigos del XML (ficha técnica, tabla 20)',
    sql: `${insertRetenciones(filasRetencion('IVA', IVA_VIGENTE_DESDE, IVA_TABLA_20))}
      UPDATE public.catalogo_retenciones
         SET activo = false, updated_at = now()
       WHERE tipo = 'IVA'
         AND codigo IN (${IVA_CASILLEROS_104.map(lit).join(', ')})
         AND activo = true;`,
  },
  {
    nombre: 'catalogo_retenciones: ISD 4586 al 2,5 %',
    sql: insertRetenciones(
      filasRetencion('ISD', ISD_4586.vigenteDesde, [ISD_4586]),
    ),
  },
];
