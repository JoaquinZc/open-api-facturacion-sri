import { Controller, Get, Logger, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ComprobantesRecibidosService,
  type FacturaRecibida,
} from './services/comprobantes-recibidos.service';

/**
 * **Comprobantes recibidos**: los que otro emitió a nombre de quien pregunta
 * (retenciones R2).
 *
 * 🔴 **Sin `validateClaveAccesoAccess`, a propósito.** La clave lleva el RUC del
 * proveedor, que nunca es un emisor de este tenant: con esa validación la
 * consulta respondería 403 siempre. Lo que lo hace seguro es que **solo lee**
 * —es el servicio público de autorización del SRI— y **no guarda nada**. Pide
 * sesión (el guard JWT es global) y va limitada por IP.
 */
@ApiTags('Comprobantes recibidos')
@ApiBearerAuth()
@Controller('sri/recibidos')
export class ComprobantesRecibidosController {
  private readonly logger = new Logger(ComprobantesRecibidosController.name);

  constructor(private readonly recibidos: ComprobantesRecibidosService) {}

  @Get(':claveAcceso')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Leer del SRI un comprobante recibido',
    description:
      'Trae del servicio de autorización del SRI el XML autorizado de una clave de acceso de otro emisor y lo devuelve leído. No guarda nada. Hoy: facturas (01).',
  })
  @ApiParam({ name: 'claveAcceso', description: '49 dígitos' })
  @ApiResponse({ status: 200, description: 'La factura, leída' })
  @ApiResponse({ status: 400, description: 'Clave mal escrita' })
  @ApiResponse({ status: 404, description: 'El SRI no la tiene' })
  @ApiResponse({ status: 409, description: 'El SRI no la autorizó' })
  @ApiResponse({ status: 422, description: 'No es una factura' })
  @ApiResponse({ status: 503, description: 'El SRI no responde' })
  async consultar(
    @Param('claveAcceso') claveAcceso: string,
  ): Promise<FacturaRecibida> {
    this.logger.log(`GET /sri/recibidos/...${claveAcceso.slice(-8)}`);
    return this.recibidos.consultar(claveAcceso);
  }
}
