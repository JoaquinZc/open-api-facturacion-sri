import { Injectable, Logger } from '@nestjs/common';
import * as soap from 'soap';
import { Client } from 'soap';

@Injectable()
export class SriSoapFactoryService {
  private readonly logger = new Logger(SriSoapFactoryService.name);

  // Cache de clientes en memoria. Clave: tipo_ambiente (ej: 'recepcion_1')
  private clients = new Map<string, Client>();

  /**
   * Para bajar el WSDL. Es lo primero que hace un proceso recién desplegado, y
   * sin límite un SRI lento lo dejaba colgado sin fin (2026-10-02).
   */
  private static readonly WSDL_TIMEOUT_MS = 15_000;

  private readonly WSDL_URLS = {
    recepcion: {
      '1': 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl', // Pruebas
      '2': 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl', // Producción
    },
    autorizacion: {
      '1': 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl', // Pruebas
      '2': 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl', // Producción
    },
  };

  /**
   * Obtiene (o crea y cachea) un cliente SOAP para el servicio de Recepción
   * @param ambiente '1' para Pruebas, '2' para Producción
   */
  async getRecepcionClient(ambiente: '1' | '2'): Promise<Client> {
    const cacheKey = `recepcion_${ambiente}`;

    if (this.clients.has(cacheKey)) {
      return this.clients.get(cacheKey)!;
    }

    const wsdlUrl = this.WSDL_URLS.recepcion[ambiente];
    if (!wsdlUrl) {
      throw new Error(`Ambiente no válido para recepción: ${ambiente}`);
    }

    this.logger.log(
      `Creando nuevo cliente SOAP de Recepción para ambiente ${ambiente}`,
    );
    const client = await soap.createClientAsync(wsdlUrl, {
      wsdl_options: { timeout: SriSoapFactoryService.WSDL_TIMEOUT_MS },
    });

    this.clients.set(cacheKey, client);
    return client;
  }

  /**
   * Obtiene (o crea y cachea) un cliente SOAP para el servicio de Autorización
   * @param ambiente '1' para Pruebas, '2' para Producción
   */
  async getAutorizacionClient(ambiente: '1' | '2'): Promise<Client> {
    const cacheKey = `autorizacion_${ambiente}`;

    if (this.clients.has(cacheKey)) {
      return this.clients.get(cacheKey)!;
    }

    const wsdlUrl = this.WSDL_URLS.autorizacion[ambiente];
    if (!wsdlUrl) {
      throw new Error(`Ambiente no válido para autorización: ${ambiente}`);
    }

    this.logger.log(
      `Creando nuevo cliente SOAP de Autorización para ambiente ${ambiente}`,
    );
    const client = await soap.createClientAsync(wsdlUrl, {
      wsdl_options: { timeout: SriSoapFactoryService.WSDL_TIMEOUT_MS },
    });

    this.clients.set(cacheKey, client);
    return client;
  }
}
