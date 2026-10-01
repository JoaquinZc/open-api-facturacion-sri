import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as xml2js from 'xml2js';
import { SriSoapClient } from './sri-soap.client';
import { ClaveAccesoService } from './clave-acceso.service';

/**
 * 🔴 **Un comprobante que otro emitió y el SRI autorizó, leído** (retenciones
 * R2; `docs/retenciones/` en el workspace de Darkmelon).
 *
 * Es el servicio web **público** de autorización del SRI: devuelve el XML
 * autorizado de cualquier clave de acceso, sea de quien sea. Por eso esta ruta
 * **no** pasa por `validateClaveAccesoAccess` —la clave es del proveedor, no
 * del que pregunta— y por eso mismo **no guarda nada**: lee y devuelve.
 *
 * Todo sale del SRI, nunca de un tercero.
 */

export interface ImpuestoRecibido {
  /** 2 IVA, 3 ICE, 5 IRBPNR. */
  codigo: string;
  /** Tabla 17 para el IVA: 0 = 0 %, 2 = 12 %, 4 = 15 %, 5 = 5 %, 6 no objeto, 7 exento… */
  codigoPorcentaje: string;
  /** El porcentaje: el del XML o, si no lo trae, el de su código. */
  tarifa: number;
  baseImponible: number;
  valor: number;
}

export interface PagoRecibido {
  /** Tabla 24: 01 sin sistema financiero, 16 débito, 19 crédito, 20 otros… */
  formaPago: string;
  total: number;
  plazo: number | null;
  unidadTiempo: string | null;
}

export interface FacturaRecibida {
  claveAcceso: string;
  numeroAutorizacion: string;
  /** Tal cual la da el SRI (instante con zona). */
  fechaAutorizacion: string | null;
  ambiente: '1' | '2';
  codDoc: '01';
  emisor: {
    ruc: string;
    razonSocial: string;
    nombreComercial: string | null;
    contribuyenteRimpe: string | null;
    agenteRetencion: string | null;
  };
  /** `eee-ppp-sssssssss` */
  numero: string;
  /** `aaaa-mm-dd`: un día, no un instante. */
  fechaEmision: string;
  comprador: {
    tipoIdentificacion: string;
    identificacion: string;
    razonSocial: string;
  };
  totalSinImpuestos: number;
  totalDescuento: number;
  propina: number;
  importeTotal: number;
  impuestos: ImpuestoRecibido[];
  pagos: PagoRecibido[];
  /** El XML autorizado, para guardarlo como prueba. */
  xml: string;
}

/** Tabla 17 de la ficha técnica: el porcentaje de cada código de IVA. */
const TARIFA_IVA: Readonly<Record<string, number>> = {
  '0': 0,
  '2': 12,
  '3': 14,
  '4': 15,
  '5': 5,
  '6': 0,
  '7': 0,
  '8': 8,
  '10': 13,
};

type Nodo = Record<string, unknown>;

function comoLista<T>(valor: T | T[] | undefined | null): T[] {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function texto(nodo: Nodo | undefined, campo: string): string | null {
  const valor = nodo?.[campo];
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number') return String(valor);
  // xml2js deja `{ _: 'texto', $: {...} }` cuando el elemento lleva atributos.
  if (
    valor &&
    typeof valor === 'object' &&
    typeof (valor as Nodo)._ === 'string'
  ) {
    return ((valor as Nodo)._ as string).trim();
  }
  return null;
}

function obligatorio(nodo: Nodo | undefined, campo: string): string {
  const valor = texto(nodo, campo);
  if (!valor) {
    throw new UnprocessableEntityException(
      `El comprobante autorizado no trae «${campo}»`,
    );
  }
  return valor;
}

function numero(nodo: Nodo | undefined, campo: string): number {
  const valor = texto(nodo, campo);
  if (valor === null || valor === '') return 0;
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new UnprocessableEntityException(
      `«${campo}» no es un número en el comprobante: ${valor}`,
    );
  }
  return n;
}

/** `dd/mm/aaaa` → `aaaa-mm-dd`. */
export function fechaSriADia(fecha: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha.trim());
  if (!m) {
    throw new UnprocessableEntityException(
      `La fecha del comprobante no es dd/mm/aaaa: ${fecha}`,
    );
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Lee una factura (codDoc 01) ya parseada por xml2js (`explicitArray: false`).
 * Pura, para poder probarla con el XML de un caso real.
 */
export function leerFactura(
  raiz: Nodo,
  autorizacion: {
    claveAcceso: string;
    numeroAutorizacion: string;
    fechaAutorizacion: string | null;
    xml: string;
  },
): FacturaRecibida {
  const factura = raiz.factura as Nodo | undefined;
  if (!factura) {
    throw new UnprocessableEntityException(
      'El comprobante autorizado no es una factura',
    );
  }

  const tributaria = factura.infoTributaria as Nodo | undefined;
  const info = factura.infoFactura as Nodo | undefined;

  const ambiente = obligatorio(tributaria, 'ambiente');
  const totalConImpuestos = info?.totalConImpuestos as Nodo | undefined;
  const pagos = info?.pagos as Nodo | undefined;

  return {
    claveAcceso: autorizacion.claveAcceso,
    numeroAutorizacion: autorizacion.numeroAutorizacion,
    fechaAutorizacion: autorizacion.fechaAutorizacion,
    ambiente: ambiente === '2' ? '2' : '1',
    codDoc: '01',
    emisor: {
      ruc: obligatorio(tributaria, 'ruc'),
      razonSocial: obligatorio(tributaria, 'razonSocial'),
      nombreComercial: texto(tributaria, 'nombreComercial'),
      contribuyenteRimpe: texto(tributaria, 'contribuyenteRimpe'),
      agenteRetencion: texto(tributaria, 'agenteRetencion'),
    },
    numero: [
      obligatorio(tributaria, 'estab'),
      obligatorio(tributaria, 'ptoEmi'),
      obligatorio(tributaria, 'secuencial'),
    ].join('-'),
    fechaEmision: fechaSriADia(obligatorio(info, 'fechaEmision')),
    comprador: {
      tipoIdentificacion: obligatorio(info, 'tipoIdentificacionComprador'),
      identificacion: obligatorio(info, 'identificacionComprador'),
      razonSocial: obligatorio(info, 'razonSocialComprador'),
    },
    totalSinImpuestos: numero(info, 'totalSinImpuestos'),
    totalDescuento: numero(info, 'totalDescuento'),
    propina: numero(info, 'propina'),
    importeTotal: numero(info, 'importeTotal'),
    impuestos: comoLista(
      totalConImpuestos?.totalImpuesto as Nodo | Nodo[] | undefined,
    ).map((i) => {
      const codigo = obligatorio(i, 'codigo');
      const codigoPorcentaje = obligatorio(i, 'codigoPorcentaje');
      const tarifaXml = texto(i, 'tarifa');
      return {
        codigo,
        codigoPorcentaje,
        tarifa:
          tarifaXml !== null
            ? Number(tarifaXml)
            : codigo === '2'
              ? (TARIFA_IVA[codigoPorcentaje] ?? 0)
              : 0,
        baseImponible: numero(i, 'baseImponible'),
        valor: numero(i, 'valor'),
      };
    }),
    pagos: comoLista(pagos?.pago as Nodo | Nodo[] | undefined).map((p) => ({
      formaPago: obligatorio(p, 'formaPago'),
      total: numero(p, 'total'),
      plazo: texto(p, 'plazo') !== null ? numero(p, 'plazo') : null,
      unidadTiempo: texto(p, 'unidadTiempo'),
    })),
    xml: autorizacion.xml,
  };
}

@Injectable()
export class ComprobantesRecibidosService {
  private readonly logger = new Logger(ComprobantesRecibidosService.name);

  constructor(
    private readonly soap: SriSoapClient,
    private readonly claves: ClaveAccesoService,
  ) {}

  /**
   * Trae del SRI el comprobante autorizado de esa clave y lo devuelve leído.
   * Hoy, solo facturas (R2); las retenciones recibidas llegan en R5.
   */
  async consultar(claveCruda: string): Promise<FacturaRecibida> {
    const claveAcceso = (claveCruda ?? '').replace(/\s/g, '');
    if (!this.claves.validate(claveAcceso)) {
      throw new BadRequestException(
        'La clave de acceso son 49 dígitos y el último no cuadra: revísala',
      );
    }

    let respuesta: Awaited<ReturnType<SriSoapClient['autorizarComprobante']>>;
    try {
      respuesta = await this.soap.autorizarComprobante(claveAcceso);
    } catch (error) {
      this.logger.warn(
        `El SRI no respondió por ...${claveAcceso.slice(-8)}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'El SRI no responde ahora mismo. Vuelve a intentarlo en unos minutos.',
      );
    }

    // Una clave reenviada trae varias respuestas (un rechazo y luego la
    // autorización): manda la autorizada si la hay.
    const lista = comoLista(respuesta.autorizaciones?.autorizacion);
    const auth = lista.find((a) => a.estado === 'AUTORIZADO') ?? lista[0];
    if (!auth) {
      throw new NotFoundException(
        'El SRI no tiene un comprobante con esa clave de acceso',
      );
    }
    if (auth.estado !== 'AUTORIZADO') {
      throw new ConflictException(
        `El SRI tiene ese comprobante como «${auth.estado}», no autorizado`,
      );
    }

    const xml = typeof auth.comprobante === 'string' ? auth.comprobante : '';
    let raiz: Nodo;
    try {
      raiz = (await new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: false,
      }).parseStringPromise(xml)) as Nodo;
    } catch {
      throw new UnprocessableEntityException(
        'El SRI devolvió un comprobante que no se puede leer',
      );
    }

    const codDoc = claveAcceso.substring(8, 10);
    if (codDoc !== '01') {
      throw new UnprocessableEntityException(
        `Esa clave es de un comprobante ${codDoc}; aquí solo se registran facturas (01)`,
      );
    }

    return leerFactura(raiz, {
      claveAcceso,
      numeroAutorizacion: auth.numeroAutorizacion ?? claveAcceso,
      fechaAutorizacion:
        typeof auth.fechaAutorizacion === 'string'
          ? auth.fechaAutorizacion
          : auth.fechaAutorizacion
            ? String(auth.fechaAutorizacion)
            : null,
      xml,
    });
  }
}
