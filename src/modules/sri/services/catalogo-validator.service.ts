import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { hoyEnEcuador } from '../../../common/utils/fecha-ecuador';

/**
 * Tarifa de impuesto del catálogo
 */
export interface TarifaImpuesto {
  codigo_porcentaje: string;
  descripcion: string;
  porcentaje: number;
  impuesto_codigo: string;
  impuesto_nombre: string;
}

/**
 * Código de retención del catálogo, con su vigencia (`aaaa-mm-dd`).
 *
 * Un mismo código puede tener varias filas: cuando el SRI cambia el porcentaje,
 * se añade una con el nuevo `vigenteDesde` (p. ej. el 312 pasó del 1,75 % al
 * 2 % el 01-03-2026). Vale la más reciente que ya haya empezado.
 */
export interface CodigoRetencion {
  tipo: string;
  codigo: string;
  descripcion: string;
  porcentaje: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

/** Sustento tributario (Tabla 5 del Catálogo ATS). */
export interface SustentoTributario {
  codigo: string;
  descripcion: string;
  /** `codDocSustento` que admite, con dos dígitos. */
  documentos: string[];
  vigenteDesde: string;
  vigenteHasta: string | null;
}

/** Un `<retencion>` del comprobante 07, lo que se valida de él. */
export interface RetencionAValidar {
  codigo: string;
  codigoRetencion: string;
  baseImponible?: number;
  porcentajeRetener?: number;
  valorRetenido?: number;
}

/**
 * `<codigo>` del impuesto retenido → tipo del catálogo (ficha técnica,
 * Tabla 19). Antes el tipo se adivinaba por el prefijo del código de retención
 * («empieza por 7 → IVA»), que con los códigos reales del IVA (1, 2, 3, 9…)
 * los confundía con la renta.
 */
export const TIPO_POR_CODIGO_IMPUESTO: Record<string, string> = {
  '1': 'RENTA',
  '2': 'IVA',
  '6': 'ISD',
};

/**
 * `baseImponible × porcentajeRetener / 100`, redondeado a centavos.
 *
 * En centavos y enteros para que la mitad se redondee hacia arriba de verdad:
 * en coma flotante `1.005 * 100` es `100.4999…` y se iría hacia abajo.
 */
export function valorRetenidoEsperado(
  baseImponible: number,
  porcentaje: number,
): number {
  const baseCentavos = Math.round(baseImponible * 100);
  const porcentajeCentesimas = Math.round(porcentaje * 100);
  return Math.round((baseCentavos * porcentajeCentesimas) / 10000) / 100;
}

/** La fila vigente el día `fecha` (`aaaa-mm-dd`): la más reciente que ya empezó. */
function vigenteEl<
  T extends { vigenteDesde: string; vigenteHasta: string | null },
>(filas: T[] | undefined, fecha: string): T | undefined {
  return (filas ?? [])
    .filter(
      (f) =>
        f.vigenteDesde <= fecha && (!f.vigenteHasta || f.vigenteHasta >= fecha),
    )
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0];
}

/**
 * Forma de pago del catálogo
 */
export interface FormaPago {
  codigo: string;
  descripcion: string;
}

/**
 * Tipo de identificación del catálogo
 */
export interface TipoIdentificacion {
  codigo: string;
  descripcion: string;
  longitud: number | null;
  regex_validacion: string | null;
}

/**
 * Documento sustento del catálogo
 */
export interface DocumentoSustento {
  codigo: string;
  descripcion: string;
}

/**
 * Motivo traslado del catálogo
 */
export interface MotivoTraslado {
  codigo: string;
  descripcion: string;
}

/**
 * Servicio para validar códigos contra los catálogos almacenados en base de datos
 */
@Injectable()
export class CatalogoValidatorService {
  private readonly logger = new Logger(CatalogoValidatorService.name);

  // Caches para evitar consultas repetitivas
  private tarifasCache: Map<string, TarifaImpuesto> = new Map();
  /** `tipo-codigo` → todas sus vigencias. */
  private retencionesCache: Map<string, CodigoRetencion[]> = new Map();
  /** `codigo` → todas sus vigencias. */
  private sustentosCache: Map<string, SustentoTributario[]> = new Map();
  private formasPagoCache: Map<string, FormaPago> = new Map();
  private tiposIdentificacionCache: Map<string, TipoIdentificacion> = new Map();
  private documentosSustentoCache: Map<string, DocumentoSustento> = new Map();
  private motivosTrasladoCache: Map<string, MotivoTraslado> = new Map();

  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
  private loadingPromise: Promise<void> | null = null; // FIX P7: Semáforo anti-carga paralela

  constructor(private readonly db: DatabaseService) {}

  // =====================================================
  // VALIDACIONES DE IMPUESTOS
  // =====================================================

  async validateImpuesto(
    codigoImpuesto: string,
    codigoPorcentaje: string,
  ): Promise<{ valid: boolean; tarifa?: TarifaImpuesto; error?: string }> {
    await this.refreshCacheIfNeeded();

    const key = `${codigoImpuesto}-${codigoPorcentaje}`;
    const tarifa = this.tarifasCache.get(key);

    if (!tarifa) {
      return {
        valid: false,
        error: `Código de impuesto ${codigoImpuesto} con tarifa ${codigoPorcentaje} no encontrado en catálogo`,
      };
    }

    return { valid: true, tarifa };
  }

  async validateImpuestos(
    impuestos: Array<{ codigo: string; codigoPorcentaje: string }>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const imp of impuestos) {
      const result = await this.validateImpuesto(
        imp.codigo,
        imp.codigoPorcentaje,
      );
      if (!result.valid && result.error) {
        errors.push(result.error);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // =====================================================
  // VALIDACIONES DE RETENCIONES
  // =====================================================

  /**
   * El código de retención vigente el día `fecha` (`aaaa-mm-dd`, por defecto
   * hoy en Ecuador).
   */
  async validateRetencion(
    tipo: string,
    codigo: string,
    fecha: string = hoyEnEcuador(),
  ): Promise<{ valid: boolean; retencion?: CodigoRetencion; error?: string }> {
    await this.refreshCacheIfNeeded();

    const filas = this.retencionesCache.get(`${tipo}-${codigo}`);

    if (!filas?.length) {
      return {
        valid: false,
        error: `Código de retención ${codigo} de tipo ${tipo} no encontrado en catálogo`,
      };
    }

    const retencion = vigenteEl(filas, fecha);
    if (!retencion) {
      return {
        valid: false,
        error: `Código de retención ${codigo} de tipo ${tipo} no está vigente el ${fecha}`,
      };
    }

    return { valid: true, retencion };
  }

  /**
   * Valida cada `<retencion>` del comprobante a la fecha de emisión:
   *   - el tipo sale de `codigo` (1 renta, 2 IVA, 6 ISD), no del prefijo;
   *   - el código existe y está vigente ese día;
   *   - si viene el porcentaje, es **el del catálogo** ese día;
   *   - si vienen base y valor, `valorRetenido` es `base × % / 100` redondeado
   *     a centavos, con un centavo de tolerancia (la regla de redondeo del SRI
   *     no está escrita en ninguna fuente leída).
   */
  async validateRetenciones(
    retenciones: RetencionAValidar[],
    fecha: string = hoyEnEcuador(),
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const ret of retenciones) {
      const tipo = TIPO_POR_CODIGO_IMPUESTO[ret.codigo];
      if (!tipo) {
        errors.push(
          `codigo ${ret.codigo} no es un impuesto retenido: 1 (renta), 2 (IVA) o 6 (ISD)`,
        );
        continue;
      }

      const result = await this.validateRetencion(
        tipo,
        ret.codigoRetencion,
        fecha,
      );
      if (!result.valid || !result.retencion) {
        if (result.error) errors.push(result.error);
        continue;
      }

      const porcentajeCatalogo = result.retencion.porcentaje;
      if (
        ret.porcentajeRetener !== undefined &&
        Math.abs(ret.porcentajeRetener - porcentajeCatalogo) > 0.001
      ) {
        errors.push(
          `El porcentaje de ${tipo} ${ret.codigoRetencion} el ${fecha} es ${porcentajeCatalogo} %, no ${ret.porcentajeRetener} %`,
        );
        continue;
      }

      if (ret.baseImponible !== undefined && ret.valorRetenido !== undefined) {
        const esperado = valorRetenidoEsperado(
          ret.baseImponible,
          ret.porcentajeRetener ?? porcentajeCatalogo,
        );
        // En centavos, para que 0,01 de tolerancia no dependa de la coma flotante.
        if (
          Math.abs(
            Math.round(ret.valorRetenido * 100) - Math.round(esperado * 100),
          ) > 1
        ) {
          errors.push(
            `valorRetenido de ${tipo} ${ret.codigoRetencion} debe ser ${ret.baseImponible} × ${ret.porcentajeRetener ?? porcentajeCatalogo} % = ${esperado.toFixed(2)}, no ${ret.valorRetenido}`,
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // =====================================================
  // VALIDACIONES DE SUSTENTO TRIBUTARIO (Tabla 5)
  // =====================================================

  /**
   * `codSustento` vigente el día `fecha` y que admita ese `codDocSustento`
   * (p. ej. el 01, crédito de IVA, no admite una nota de venta 02).
   */
  async validateSustento(
    codSustento: string,
    codDocSustento: string,
    fecha: string = hoyEnEcuador(),
  ): Promise<{
    valid: boolean;
    sustento?: SustentoTributario;
    error?: string;
  }> {
    await this.refreshCacheIfNeeded();

    const sustento = vigenteEl(this.sustentosCache.get(codSustento), fecha);
    if (!sustento) {
      return {
        valid: false,
        error: `Sustento tributario ${codSustento} no encontrado en catálogo o no vigente el ${fecha}`,
      };
    }

    if (!sustento.documentos.includes(codDocSustento)) {
      return {
        valid: false,
        error: `El sustento ${codSustento} (${sustento.descripcion}) no admite el documento ${codDocSustento}; admite ${sustento.documentos.join(', ')}`,
      };
    }

    return { valid: true, sustento };
  }

  // =====================================================
  // VALIDACIONES DE FORMAS DE PAGO
  // =====================================================

  async validateFormaPago(
    codigo: string,
  ): Promise<{ valid: boolean; formaPago?: FormaPago; error?: string }> {
    await this.refreshCacheIfNeeded();

    const formaPago = this.formasPagoCache.get(codigo);

    if (!formaPago) {
      return {
        valid: false,
        error: `Forma de pago ${codigo} no encontrada en catálogo`,
      };
    }

    return { valid: true, formaPago };
  }

  async validateFormasPago(
    pagos: Array<{ formaPago: string }>,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const pago of pagos) {
      const result = await this.validateFormaPago(pago.formaPago);
      if (!result.valid && result.error) {
        errors.push(result.error);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // =====================================================
  // VALIDACIONES DE TIPOS DE IDENTIFICACIÓN
  // =====================================================

  async validateTipoIdentificacion(codigo: string): Promise<{
    valid: boolean;
    tipoIdentificacion?: TipoIdentificacion;
    error?: string;
  }> {
    await this.refreshCacheIfNeeded();

    const tipoIdentificacion = this.tiposIdentificacionCache.get(codigo);

    if (!tipoIdentificacion) {
      return {
        valid: false,
        error: `Tipo de identificación ${codigo} no encontrado en catálogo`,
      };
    }

    return { valid: true, tipoIdentificacion };
  }

  // =====================================================
  // VALIDACIONES DE DOCUMENTOS SUSTENTO
  // =====================================================

  async validateDocumentoSustento(codigo: string): Promise<{
    valid: boolean;
    documentoSustento?: DocumentoSustento;
    error?: string;
  }> {
    await this.refreshCacheIfNeeded();

    const documentoSustento = this.documentosSustentoCache.get(codigo);

    if (!documentoSustento) {
      return {
        valid: false,
        error: `Documento sustento ${codigo} no encontrado en catálogo`,
      };
    }

    return { valid: true, documentoSustento };
  }

  // =====================================================
  // VALIDACIONES DE MOTIVOS TRASLADO (Guía Remisión)
  // =====================================================

  async validateMotivoTraslado(codigo: string): Promise<{
    valid: boolean;
    motivoTraslado?: MotivoTraslado;
    error?: string;
  }> {
    await this.refreshCacheIfNeeded();

    const motivoTraslado = this.motivosTrasladoCache.get(codigo);

    if (!motivoTraslado) {
      return {
        valid: false,
        error: `Motivo de traslado ${codigo} no encontrado en catálogo`,
      };
    }

    return { valid: true, motivoTraslado };
  }

  // =====================================================
  // MÉTODOS DE CONSULTA
  // =====================================================

  async getTarifasVigentes(codigoImpuesto: string): Promise<TarifaImpuesto[]> {
    await this.refreshCacheIfNeeded();
    const tarifas: TarifaImpuesto[] = [];
    for (const [, tarifa] of this.tarifasCache) {
      if (tarifa.impuesto_codigo === codigoImpuesto) {
        tarifas.push(tarifa);
      }
    }
    return tarifas;
  }

  /** Los códigos de un tipo vigentes el día `fecha` (por defecto hoy). */
  async getRetencionesPorTipo(
    tipo: string,
    fecha: string = hoyEnEcuador(),
  ): Promise<CodigoRetencion[]> {
    await this.refreshCacheIfNeeded();
    const retenciones: CodigoRetencion[] = [];
    for (const [, filas] of this.retencionesCache) {
      const vigente = vigenteEl(filas, fecha);
      if (vigente && vigente.tipo === tipo) {
        retenciones.push(vigente);
      }
    }
    return retenciones.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  /** Los sustentos vigentes el día `fecha` (por defecto hoy). */
  async getSustentos(
    fecha: string = hoyEnEcuador(),
  ): Promise<SustentoTributario[]> {
    await this.refreshCacheIfNeeded();
    const sustentos: SustentoTributario[] = [];
    for (const [, filas] of this.sustentosCache) {
      const vigente = vigenteEl(filas, fecha);
      if (vigente) sustentos.push(vigente);
    }
    return sustentos.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  async getFormasPago(): Promise<FormaPago[]> {
    await this.refreshCacheIfNeeded();
    return Array.from(this.formasPagoCache.values());
  }

  async getTiposIdentificacion(): Promise<TipoIdentificacion[]> {
    await this.refreshCacheIfNeeded();
    return Array.from(this.tiposIdentificacionCache.values());
  }

  async getDocumentosSustento(): Promise<DocumentoSustento[]> {
    await this.refreshCacheIfNeeded();
    return Array.from(this.documentosSustentoCache.values());
  }

  async getMotivosTraslado(): Promise<MotivoTraslado[]> {
    await this.refreshCacheIfNeeded();
    return Array.from(this.motivosTrasladoCache.values());
  }

  // =====================================================
  // CARGA DE CACHE
  // =====================================================

  private async refreshCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now > this.cacheExpiry) {
      // Si ya hay una carga en curso, esperamos que termine en lugar de lanzar otra
      if (this.loadingPromise) {
        return this.loadingPromise;
      }
      this.loadingPromise = this.loadCache()
        .then(() => {
          this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
        })
        .finally(() => {
          this.loadingPromise = null;
        });
      return this.loadingPromise;
    }
  }

  private async loadCache(): Promise<void> {
    this.logger.log('Cargando todos los catálogos SRI...');

    try {
      // 1. Cargar tarifas de impuestos
      const tarifas = await this.db.query<any>(`
        SELECT 
          t.codigo_porcentaje, t.descripcion, t.porcentaje,
          i.codigo as impuesto_codigo, i.nombre as impuesto_nombre
        FROM catalogo_tarifas_impuesto t
        JOIN catalogo_impuestos i ON t.impuesto_id = i.id
        WHERE t.activo = true
        AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= CURRENT_DATE)
      `);
      this.tarifasCache.clear();
      for (const tarifa of tarifas.rows) {
        const key = `${tarifa.impuesto_codigo}-${tarifa.codigo_porcentaje}`;
        this.tarifasCache.set(key, {
          codigo_porcentaje: tarifa.codigo_porcentaje,
          descripcion: tarifa.descripcion,
          porcentaje: parseFloat(tarifa.porcentaje),
          impuesto_codigo: tarifa.impuesto_codigo,
          impuesto_nombre: tarifa.impuesto_nombre,
        });
      }

      // 2. Cargar códigos de retención, **con todas sus vigencias**: cuál vale
      // depende de la fecha de emisión, no de hoy. Las fechas como texto para
      // que `pg` no las convierta en un instante en la zona del servidor.
      const retenciones = await this.db.query<{
        tipo: string;
        codigo: string;
        descripcion: string;
        porcentaje: string;
        vigente_desde: string | null;
        vigente_hasta: string | null;
      }>(`
        SELECT tipo, codigo, descripcion, porcentaje,
               to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
               to_char(vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta
        FROM catalogo_retenciones WHERE activo = true
      `);
      this.retencionesCache.clear();
      for (const ret of retenciones.rows) {
        const key = `${ret.tipo}-${ret.codigo}`;
        const filas = this.retencionesCache.get(key) ?? [];
        filas.push({
          tipo: ret.tipo,
          codigo: ret.codigo,
          descripcion: ret.descripcion,
          porcentaje: parseFloat(ret.porcentaje),
          vigenteDesde: ret.vigente_desde ?? '0000-01-01',
          vigenteHasta: ret.vigente_hasta ?? null,
        });
        this.retencionesCache.set(key, filas);
      }

      // 3. Cargar formas de pago
      const formasPago = await this.db.query<any>(`
        SELECT codigo, descripcion FROM catalogo_formas_pago WHERE activo = true
      `);
      this.formasPagoCache.clear();
      for (const fp of formasPago.rows) {
        this.formasPagoCache.set(fp.codigo, {
          codigo: fp.codigo,
          descripcion: fp.descripcion,
        });
      }

      // 4. Cargar tipos de identificación
      const tiposIdent = await this.db.query<any>(`
        SELECT codigo, descripcion, longitud, regex_validacion 
        FROM catalogo_tipos_identificacion WHERE activo = true
      `);
      this.tiposIdentificacionCache.clear();
      for (const ti of tiposIdent.rows) {
        this.tiposIdentificacionCache.set(ti.codigo, {
          codigo: ti.codigo,
          descripcion: ti.descripcion,
          longitud: ti.longitud,
          regex_validacion: ti.regex_validacion,
        });
      }

      // 5. Cargar documentos sustento
      const docsSustento = await this.db.query<any>(`
        SELECT codigo, descripcion FROM catalogo_documentos_sustento WHERE activo = true
      `);
      this.documentosSustentoCache.clear();
      for (const ds of docsSustento.rows) {
        this.documentosSustentoCache.set(ds.codigo, {
          codigo: ds.codigo,
          descripcion: ds.descripcion,
        });
      }

      // 6. Cargar motivos traslado
      const motivosTraslado = await this.db.query<any>(`
        SELECT codigo, descripcion FROM catalogo_motivos_traslado WHERE activo = true
      `);
      this.motivosTrasladoCache.clear();
      for (const mt of motivosTraslado.rows) {
        this.motivosTrasladoCache.set(mt.codigo, {
          codigo: mt.codigo,
          descripcion: mt.descripcion,
        });
      }

      // 7. Sustento tributario (Tabla 5). La tabla la crea `db-bootstrap` desde
      // R0; si esa migración no corrió, **no se tumba el resto**: las facturas
      // no la usan, y una retención sin catálogo de sustento se rechaza sola.
      this.sustentosCache.clear();
      try {
        const sustentos = await this.db.query<{
          codigo: string;
          descripcion: string;
          documentos_sustento: string[] | null;
          vigente_desde: string;
          vigente_hasta: string | null;
        }>(`
          SELECT codigo, descripcion, documentos_sustento,
                 to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
                 to_char(vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta
          FROM catalogo_sustento_tributario WHERE activo = true
        `);
        for (const s of sustentos.rows) {
          const filas = this.sustentosCache.get(s.codigo) ?? [];
          filas.push({
            codigo: s.codigo,
            descripcion: s.descripcion,
            documentos: s.documentos_sustento ?? [],
            vigenteDesde: s.vigente_desde,
            vigenteHasta: s.vigente_hasta ?? null,
          });
          this.sustentosCache.set(s.codigo, filas);
        }
      } catch (error) {
        this.logger.warn(
          `Sin catálogo de sustento tributario: ${(error as Error).message}`,
        );
      }

      this.logger.log(
        `Catálogos cargados: ${this.tarifasCache.size} tarifas, ` +
          `${this.retencionesCache.size} retenciones, ${this.formasPagoCache.size} formas pago, ` +
          `${this.tiposIdentificacionCache.size} tipos ident, ${this.documentosSustentoCache.size} docs sustento, ` +
          `${this.motivosTrasladoCache.size} motivos traslado`,
      );
    } catch (error) {
      this.logger.error(
        `Error cargando catálogos: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async forceRefreshCache(): Promise<void> {
    this.cacheExpiry = 0;
    await this.refreshCacheIfNeeded();
  }
}
