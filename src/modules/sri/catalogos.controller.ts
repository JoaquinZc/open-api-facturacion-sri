import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import {
  CatalogoValidatorService,
  TIPO_POR_CODIGO_IMPUESTO,
} from './services/catalogo-validator.service';
import { esFechaIso, hoyEnEcuador } from '../../common/utils/fecha-ecuador';

@ApiTags('Catálogos SRI')
@Controller('catalogos')
export class CatalogosController {
  private readonly logger = new Logger(CatalogosController.name);

  constructor(private readonly catalogoService: CatalogoValidatorService) {}

  @Get('impuestos')
  @ApiOperation({
    summary: 'Listar tarifas de impuestos',
    description:
      'Obtiene todas las tarifas de impuestos vigentes (IVA, ICE, IRBPNR)',
  })
  @ApiResponse({ status: 200, description: 'Lista de tarifas de impuestos' })
  async listarImpuestos(): Promise<{ impuestos: any[] }> {
    this.logger.log('GET /catalogos/impuestos');

    // Get all tarifas for each impuesto type
    const iva = await this.catalogoService.getTarifasVigentes('2');
    const ice = await this.catalogoService.getTarifasVigentes('3');
    const irbpnr = await this.catalogoService.getTarifasVigentes('5');

    return {
      impuestos: [
        {
          codigo: '2',
          nombre: 'IVA',
          tarifas: iva.map((t) => ({
            codigoPorcentaje: t.codigo_porcentaje,
            descripcion: t.descripcion,
            porcentaje: t.porcentaje,
          })),
        },
        {
          codigo: '3',
          nombre: 'ICE',
          tarifas: ice.map((t) => ({
            codigoPorcentaje: t.codigo_porcentaje,
            descripcion: t.descripcion,
            porcentaje: t.porcentaje,
          })),
        },
        {
          codigo: '5',
          nombre: 'IRBPNR',
          tarifas: irbpnr.map((t) => ({
            codigoPorcentaje: t.codigo_porcentaje,
            descripcion: t.descripcion,
            porcentaje: t.porcentaje,
          })),
        },
      ],
    };
  }

  @Get('retenciones')
  @ApiOperation({
    summary: 'Listar códigos de retención',
    description:
      'Los códigos de renta, IVA e ISD vigentes a una fecha (por defecto, hoy en Ecuador). Es la fecha de emisión de la retención la que decide el porcentaje: la tabla de renta cambió el 01-03-2026.',
  })
  @ApiQuery({
    name: 'fecha',
    required: false,
    description: 'Fecha de emisión, aaaa-mm-dd. Por defecto, hoy en Ecuador.',
    example: '2026-09-30',
  })
  @ApiResponse({ status: 200, description: 'Lista de códigos de retención' })
  @ApiResponse({ status: 400, description: 'Fecha con formato inválido' })
  async listarRetenciones(
    @Query('fecha') fechaPedida?: string,
  ): Promise<{ fecha: string; retenciones: any[] }> {
    this.logger.log('GET /catalogos/retenciones');
    const fecha = this.fechaDeConsulta(fechaPedida);

    const retenciones = await Promise.all(
      Object.entries(TIPO_POR_CODIGO_IMPUESTO).map(
        async ([codigoImpuesto, tipo]) => ({
          tipo,
          codigoImpuesto,
          codigos: (
            await this.catalogoService.getRetencionesPorTipo(tipo, fecha)
          ).map((r) => ({
            codigo: r.codigo,
            descripcion: r.descripcion,
            porcentaje: r.porcentaje,
            vigenteDesde: r.vigenteDesde,
            vigenteHasta: r.vigenteHasta,
          })),
        }),
      ),
    );

    return { fecha, retenciones };
  }

  @Get('sustentos')
  @ApiOperation({
    summary: 'Listar sustentos tributarios',
    description:
      'Tabla 5 del Catálogo ATS: los codSustento vigentes a una fecha y qué codDocSustento admite cada uno.',
  })
  @ApiQuery({
    name: 'fecha',
    required: false,
    description: 'aaaa-mm-dd. Por defecto, hoy en Ecuador.',
  })
  @ApiResponse({ status: 200, description: 'Lista de sustentos tributarios' })
  async listarSustentos(
    @Query('fecha') fechaPedida?: string,
  ): Promise<{ fecha: string; sustentos: any[] }> {
    this.logger.log('GET /catalogos/sustentos');
    const fecha = this.fechaDeConsulta(fechaPedida);

    const sustentos = await this.catalogoService.getSustentos(fecha);
    return {
      fecha,
      sustentos: sustentos.map((s) => ({
        codigo: s.codigo,
        descripcion: s.descripcion,
        documentosSustento: s.documentos,
      })),
    };
  }

  /** `aaaa-mm-dd` pedida, o hoy en Ecuador. */
  private fechaDeConsulta(fecha?: string): string {
    if (fecha === undefined || fecha === '') return hoyEnEcuador();
    if (!esFechaIso(fecha)) {
      throw new BadRequestException(
        `fecha debe ser una fecha aaaa-mm-dd válida, no «${fecha}»`,
      );
    }
    return fecha;
  }

  @Get('formas-pago')
  @ApiOperation({
    summary: 'Listar formas de pago',
    description: 'Obtiene todas las formas de pago válidas',
  })
  @ApiResponse({ status: 200, description: 'Lista de formas de pago' })
  async listarFormasPago(): Promise<{ formasPago: any[] }> {
    this.logger.log('GET /catalogos/formas-pago');

    const formasPago = await this.catalogoService.getFormasPago();

    return {
      formasPago: formasPago.map((fp) => ({
        codigo: fp.codigo,
        descripcion: fp.descripcion,
      })),
    };
  }

  @Get('tipos-identificacion')
  @ApiOperation({
    summary: 'Listar tipos de identificación',
    description: 'Obtiene todos los tipos de identificación válidos',
  })
  @ApiResponse({ status: 200, description: 'Lista de tipos de identificación' })
  async listarTiposIdentificacion(): Promise<{ tiposIdentificacion: any[] }> {
    this.logger.log('GET /catalogos/tipos-identificacion');

    const tipos = await this.catalogoService.getTiposIdentificacion();

    return {
      tiposIdentificacion: tipos.map((ti) => ({
        codigo: ti.codigo,
        descripcion: ti.descripcion,
        longitud: ti.longitud,
      })),
    };
  }

  @Get('documentos-sustento')
  @ApiOperation({
    summary: 'Listar documentos sustento',
    description: 'Obtiene todos los códigos de documentos sustento válidos',
  })
  @ApiResponse({ status: 200, description: 'Lista de documentos sustento' })
  async listarDocumentosSustento(): Promise<{ documentosSustento: any[] }> {
    this.logger.log('GET /catalogos/documentos-sustento');

    const documentos = await this.catalogoService.getDocumentosSustento();

    return {
      documentosSustento: documentos.map((ds) => ({
        codigo: ds.codigo,
        descripcion: ds.descripcion,
      })),
    };
  }

  @Get('motivos-traslado')
  @ApiOperation({
    summary: 'Listar motivos de traslado',
    description: 'Obtiene todos los motivos de traslado para guías de remisión',
  })
  @ApiResponse({ status: 200, description: 'Lista de motivos de traslado' })
  async listarMotivosTraslado(): Promise<{ motivosTraslado: any[] }> {
    this.logger.log('GET /catalogos/motivos-traslado');

    const motivos = await this.catalogoService.getMotivosTraslado();

    return {
      motivosTraslado: motivos.map((mt) => ({
        codigo: mt.codigo,
        descripcion: mt.descripcion,
      })),
    };
  }
}
