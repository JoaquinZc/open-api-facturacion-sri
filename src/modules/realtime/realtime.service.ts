import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject, Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, UserRole } from '../auth/dto/auth.dto';
import { DatabaseService } from '../../database/database.service';

export interface RealtimeEvent {
  event: string;
  data: Record<string, unknown>;
}

interface ClientConnection {
  id: string;
  tenantId: string | null;
  rol: UserRole;
  subject: Subject<RealtimeEvent>;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly connections = new Map<string, ClientConnection>();
  private readonly jwtSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
  ) {
    this.jwtSecret = this.configService.get<string>('jwt.secret')!;
  }

  validateToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.verify<JwtPayload>(token, {
        secret: this.jwtSecret,
      });
    } catch {
      return null;
    }
  }

  createConnection(
    clientId: string,
    payload: JwtPayload,
  ): Observable<RealtimeEvent> {
    const subject = new Subject<RealtimeEvent>();
    const connection: ClientConnection = {
      id: clientId,
      tenantId: payload.tenantId,
      rol: payload.rol,
      subject,
    };
    this.connections.set(clientId, connection);
    this.logger.log(
      `Cliente SSE conectado: ${clientId} (tenant: ${payload.tenantId}, rol: ${payload.rol})`,
    );

    return new Observable<RealtimeEvent>((subscriber) => {
      const sub = subject.subscribe(subscriber);
      return () => {
        sub.unsubscribe();
        this.removeConnection(clientId);
      };
    });
  }

  removeConnection(clientId: string): void {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.subject.complete();
      this.connections.delete(clientId);
      this.logger.log(`Cliente SSE desconectado: ${clientId}`);
    }
  }

  private broadcast(
    event: string,
    data: Record<string, unknown>,
    tenantId?: string | null,
  ): void {
    for (const conn of this.connections.values()) {
      if (
        tenantId &&
        conn.rol !== UserRole.SUPERADMIN &&
        conn.tenantId !== tenantId
      ) {
        continue;
      }
      conn.subject.next({ event, data });
    }
  }

  /**
   * Los eventos de comprobante, solo al tenant del emisor.
   *
   * 🔴 Ningún emisor de estos eventos pone `tenantId`, y `broadcast` sin tenant
   * los manda a **todas** las conexiones: cualquier cuenta de cualquier negocio
   * veía las claves de acceso de los demás. Ahora el tenant sale del emisor, y si
   * no se puede saber, el evento solo llega al SUPERADMIN. 2026-09-30, R0.
   */
  private async broadcastComprobante(
    event: string,
    data: Record<string, unknown>,
    payload: { tenantId?: string | null; emisorId?: string | null },
  ): Promise<void> {
    const tenantId = payload.tenantId ?? (await this.tenantDe(payload));
    if (tenantId) {
      this.broadcast(event, data, tenantId);
      return;
    }
    for (const conn of this.connections.values()) {
      if (conn.rol === UserRole.SUPERADMIN) conn.subject.next({ event, data });
    }
  }

  private async tenantDe(payload: {
    emisorId?: string | null;
  }): Promise<string | null> {
    if (!payload.emisorId) return null;
    try {
      const row = await this.db.queryOne<{ tenant_id: string | null }>(
        'SELECT tenant_id FROM emisores WHERE id = $1',
        [payload.emisorId],
      );
      return row?.tenant_id ?? null;
    } catch (error) {
      this.logger.warn(
        `No se pudo resolver el tenant del emisor ${payload.emisorId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  @OnEvent('comprobante.autorizado')
  async handleComprobanteAutorizado(payload: any): Promise<void> {
    await this.broadcastComprobante(
      'comprobante.autorizado',
      {
        claveAcceso: payload.claveAcceso,
        estado: payload.estado,
        tipoComprobante: payload.tipoComprobante,
      },
      payload,
    );
  }

  @OnEvent('comprobante.rechazado')
  async handleComprobanteRechazado(payload: any): Promise<void> {
    await this.broadcastComprobante(
      'comprobante.rechazado',
      {
        claveAcceso: payload.claveAcceso,
        estado: payload.estado,
        tipoComprobante: payload.tipoComprobante,
      },
      payload,
    );
  }

  @OnEvent('comprobante.creado')
  async handleComprobanteCreado(payload: any): Promise<void> {
    await this.broadcastComprobante(
      'comprobante.creado',
      {
        claveAcceso: payload.claveAcceso,
        estado: payload.estado,
        tipoComprobante: payload.tipoComprobante,
      },
      payload,
    );
  }

  @OnEvent('comprobante.anulado')
  async handleComprobanteAnulado(payload: any): Promise<void> {
    await this.broadcastComprobante(
      'comprobante.anulado',
      {
        claveAcceso: payload.claveAcceso,
      },
      payload,
    );
  }

  @OnEvent('comprobante.persistencia_fallida')
  async handleComprobantePersistenciaFallida(payload: any): Promise<void> {
    this.logger.warn(
      `Persistencia fallida para comprobante ${payload.claveAcceso}`,
    );
    await this.broadcastComprobante(
      'comprobante.persistencia_fallida',
      {
        claveAcceso: payload.claveAcceso,
        tipoComprobante: payload.tipoComprobante,
        emisorRuc: payload.emisorRuc,
      },
      payload,
    );
  }

  @OnEvent('plantilla.creada')
  handlePlantillaCreada(payload: any): void {
    this.broadcast('plantilla.creada', payload);
  }

  @OnEvent('plantilla.eliminada')
  handlePlantillaEliminada(payload: any): void {
    this.broadcast('plantilla.eliminada', payload);
  }

  @OnEvent('certificado.subido')
  handleCertificadoSubido(payload: any): void {
    this.broadcast('certificado.subido', payload, payload.tenantId);
  }

  @OnEvent('certificado.eliminado')
  handleCertificadoEliminado(payload: any): void {
    this.broadcast('certificado.eliminado', payload, payload.tenantId);
  }
}
