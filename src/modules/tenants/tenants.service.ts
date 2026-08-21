import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
  TenantResponseDto,
  QueryTenantsDto,
  PaginatedTenantsResponseDto,
  TenantEstado,
} from './dto';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(query: QueryTenantsDto): Promise<PaginatedTenantsResponseDto> {
    const limit = query.limit ?? 20;
    const cursor = query.cursor;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (cursor) {
      conditions.push(`t.id > $${params.push(cursor)}`);
    }

    if (query.plan) {
      conditions.push(`t.plan = $${params.push(query.plan)}`);
    }

    if (query.estado) {
      conditions.push(`t.estado = $${params.push(query.estado)}`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const result = await this.db.query(
      `SELECT t.id, t.nombre, t.plan, t.estado, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM emisores e WHERE e.tenant_id = t.id) as emisores_count
       FROM tenants t
       ${whereClause}
       ORDER BY t.id ASC
       LIMIT $${params.push(limit + 1)}`,
      params,
    );

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore ? (rows[rows.length - 1].id as string) : null;

    return {
      data: rows.map((row) => this.mapToResponse(row)),
      nextCursor,
      hasMore,
    };
  }

  async findOne(id: string): Promise<TenantResponseDto> {
    const result = await this.db.query(
      `SELECT t.id, t.nombre, t.plan, t.estado, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM emisores e WHERE e.tenant_id = t.id) as emisores_count
       FROM tenants t
       WHERE t.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Tenant con ID ${id} no encontrado`);
    }

    return this.mapToResponse(result.rows[0]);
  }

  async create(dto: CreateTenantDto): Promise<TenantResponseDto> {
    // El plan por defecto viene de la configuración centralizada
    const planDefault = this.configService.get<string>('tenants.defaultPlan');
    if (!planDefault) {
      throw new InternalServerErrorException(
        'TENANT_DEFAULT_PLAN no está configurado',
      );
    }

    const plan = dto.plan ?? planDefault;

    // Sin id explícito: se genera, como siempre.
    if (!dto.id) {
      const result = await this.db.query(
        `INSERT INTO tenants (nombre, plan, estado)
         VALUES ($1, $2, $3)
         RETURNING id, nombre, plan, estado, created_at, updated_at`,
        [dto.nombre, plan, TenantEstado.ACTIVO],
      );

      this.logger.log(`Tenant creado: ${dto.nombre}`);
      return this.mapToResponse(result.rows[0]);
    }

    /*
     * 🔴 Con id explícito la operación es **idempotente**, y ese es todo su
     * propósito: dos sistemas del mismo cliente llevan el id como constante y
     * llaman aquí sin coordinarse. El primero lo crea; el segundo recibe el
     * que ya existe en vez de un error que tendría que interpretar.
     *
     * `ON CONFLICT DO NOTHING` deja la clave primaria arbitrando la carrera:
     * si los dos llaman a la vez, uno inserta y el otro no, pero ambos acaban
     * con el mismo tenant. No hace falta bloqueo ni reintento.
     *
     * **No actualiza el nombre ni el plan del existente.** Crear no es editar,
     * y para eso está `PUT /tenants/:id`.
     */
    const insert = await this.db.query(
      `INSERT INTO tenants (id, nombre, plan, estado)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, nombre, plan, estado, created_at, updated_at`,
      [dto.id, dto.nombre, plan, TenantEstado.ACTIVO],
    );

    if (insert.rows.length > 0) {
      this.logger.log(`Tenant creado con id fijo ${dto.id}: ${dto.nombre}`);
      return this.mapToResponse(insert.rows[0]);
    }

    this.logger.log(`Tenant ${dto.id} ya existía: se devuelve el existente`);
    return this.findOne(dto.id);
  }

  async update(id: string, dto: UpdateTenantDto): Promise<TenantResponseDto> {
    await this.findOne(id);

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (dto.nombre !== undefined) {
      updates.push(`nombre = $${paramIndex++}`);
      values.push(dto.nombre);
    }
    if (dto.plan !== undefined) {
      updates.push(`plan = $${paramIndex++}`);
      values.push(dto.plan);
    }
    if (dto.estado !== undefined) {
      updates.push(`estado = $${paramIndex++}`);
      values.push(dto.estado);
    }

    if (updates.length === 0) {
      return this.findOne(id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.db.query(
      `UPDATE tenants SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id`,
      values,
    );

    this.logger.log(`Tenant actualizado: ${id}`);
    return this.findOne(result.rows[0].id);
  }

  async delete(id: string): Promise<TenantResponseDto> {
    const tenant = await this.findOne(id);

    if (tenant.estado === 'INACTIVO') {
      throw new BadRequestException(`El tenant ya se encuentra inactivo`);
    }

    // Bloquear inactivación si tiene emisores activos (comportamiento configurable)
    const allowDeleteWithEmisores = this.configService.get<boolean>(
      'tenants.allowDeleteWithEmisores',
      false,
    );

    if (
      !allowDeleteWithEmisores &&
      tenant.emisoresCount &&
      tenant.emisoresCount > 0
    ) {
      throw new ConflictException(
        `No se puede inactivar el tenant: tiene ${tenant.emisoresCount} emisor(es) activo(s). ` +
          `Configure TENANT_ALLOW_DELETE_WITH_EMISORES=true para forzarlo.`,
      );
    }

    if (tenant.emisoresCount && tenant.emisoresCount > 0) {
      this.logger.warn(
        `Tenant ${id} inactivado con ${tenant.emisoresCount} emisores activos (flag ALLOW_DELETE_WITH_EMISORES=true)`,
      );
    }

    await this.db.query(
      `UPDATE tenants SET estado = 'INACTIVO', updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    this.logger.log(`Tenant inactivado: ${id}`);
    return this.findOne(id);
  }

  private mapToResponse(row: Record<string, unknown>): TenantResponseDto {
    return {
      id: row.id as string,
      nombre: row.nombre as string,
      plan: row.plan as string,
      estado: row.estado as string,
      createdAt: (row.created_at as Date)?.toISOString(),
      updatedAt: (row.updated_at as Date)?.toISOString(),
      emisoresCount: Number(row.emisores_count) || 0,
    };
  }
}
