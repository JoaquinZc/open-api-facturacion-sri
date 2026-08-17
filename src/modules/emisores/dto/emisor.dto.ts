import {
  IsString,
  IsOptional,
  IsBoolean,
  Length,
  MaxLength,
  Matches,
  IsNotEmpty,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

// Enums estrictos para ambiente y estado
export enum EmisorAmbiente {
  PRUEBAS = 'pruebas',
  PRODUCCION = 'produccion',
  /** Soporte para códigos SRI directos */
  CODIGO_PRUEBAS = '1',
  CODIGO_PRODUCCION = '2',
}

export enum EmisorEstado {
  ACTIVO = 'ACTIVO',
  INACTIVO = 'INACTIVO',
}

export class QueryEmisoresDto {
  @ApiPropertyOptional({
    description:
      'Cursor (UUID) para paginación keyset (ID del último emisor de la página anterior)',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado del emisor',
    enum: EmisorEstado,
  })
  @IsOptional()
  @IsEnum(EmisorEstado)
  estado?: EmisorEstado;

  @ApiPropertyOptional({
    description: 'Filtrar por tenant ID',
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({
    description: 'Cantidad máxima de registros a retornar',
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value !== undefined ? parseInt(String(value), 10) : 20,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateEmisorDto {
  @ApiProperty({ description: 'RUC del emisor (13 dígitos)' })
  @IsString()
  @Length(13, 13)
  @Matches(/^\d{13}$/, { message: 'El RUC debe tener 13 dígitos' })
  ruc: string;

  @ApiProperty({ description: 'Razón social' })
  @IsString()
  @IsNotEmpty()
  razonSocial: string;

  @ApiPropertyOptional({ description: 'Nombre comercial' })
  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @ApiProperty({ description: 'Dirección matriz' })
  @IsString()
  @IsNotEmpty()
  direccionMatriz: string;

  @ApiPropertyOptional({ description: 'Obligado a llevar contabilidad' })
  @IsOptional()
  @IsBoolean()
  obligadoContabilidad?: boolean;

  @ApiPropertyOptional({ description: 'Número de contribuyente especial' })
  @IsOptional()
  @IsString()
  contribuyenteEspecial?: string;

  @ApiPropertyOptional({ description: 'Código de agente de retención' })
  @IsOptional()
  @IsString()
  agenteRetencion?: string;

  @ApiPropertyOptional({ description: 'Es contribuyente RIMPE' })
  @IsOptional()
  @IsBoolean()
  contribuyenteRimpe?: boolean;

  @ApiPropertyOptional({
    description: 'Ambiente SRI',
    enum: EmisorAmbiente,
    example: EmisorAmbiente.PRUEBAS,
  })
  @IsOptional()
  @IsEnum(EmisorAmbiente, {
    message: `ambiente debe ser uno de: ${Object.values(EmisorAmbiente).join(', ')}`,
  })
  ambiente?: EmisorAmbiente;

  @ApiPropertyOptional({
    description: 'ID del tenant al que pertenece el emisor',
  })
  @IsOptional()
  @IsString()
  tenantId?: string;

  /* ─── Datos de marca del RIDE ─────────────────────────────────────────────
   *
   * **No son fiscales.** El SRI no los pide, no viajan en el XML firmado y no
   * afectan a la autorización: solo se imprimen en el PDF, en la cabecera y el
   * pie de `ride.docx`. Viven en el emisor —y no en cada comprobante— porque
   * son de la empresa y no del documento: cambiar el teléfono no debería
   * obligar a reemitir nada.
   */

  @ApiPropertyOptional({ description: 'Eslogan bajo el logo del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  eslogan?: string;

  @ApiPropertyOptional({ description: 'Ciudad, para el pie del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ciudad?: string;

  @ApiPropertyOptional({ description: 'Email de contacto del pie del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'Sitio web del pie del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  web?: string;

  @ApiPropertyOptional({ description: 'Teléfono de contacto del pie del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @ApiPropertyOptional({
    description:
      'URL pública del logo. Se descarga al generar el RIDE y se cachea; si no responde, el PDF sale sin logo pero se genera igual.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}

export class UpdateEmisorDto {
  @ApiPropertyOptional({ description: 'Razón social' })
  @IsOptional()
  @IsString()
  razonSocial?: string;

  @ApiPropertyOptional({ description: 'Nombre comercial' })
  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @ApiPropertyOptional({ description: 'Dirección matriz' })
  @IsOptional()
  @IsString()
  direccionMatriz?: string;

  @ApiPropertyOptional({ description: 'Obligado a llevar contabilidad' })
  @IsOptional()
  @IsBoolean()
  obligadoContabilidad?: boolean;

  @ApiPropertyOptional({ description: 'Número de contribuyente especial' })
  @IsOptional()
  @IsString()
  contribuyenteEspecial?: string;

  @ApiPropertyOptional({ description: 'Código de agente de retención' })
  @IsOptional()
  @IsString()
  agenteRetencion?: string;

  @ApiPropertyOptional({ description: 'Es contribuyente RIMPE' })
  @IsOptional()
  @IsBoolean()
  contribuyenteRimpe?: boolean;

  @ApiPropertyOptional({
    description: 'Ambiente SRI',
    enum: EmisorAmbiente,
  })
  @IsOptional()
  @IsEnum(EmisorAmbiente, {
    message: `ambiente debe ser uno de: ${Object.values(EmisorAmbiente).join(', ')}`,
  })
  ambiente?: EmisorAmbiente;

  @ApiPropertyOptional({
    description: 'Estado del emisor',
    enum: EmisorEstado,
  })
  @IsOptional()
  @IsEnum(EmisorEstado, {
    message: `estado debe ser uno de: ${Object.values(EmisorEstado).join(', ')}`,
  })
  estado?: EmisorEstado;

  // ─── Datos de marca del RIDE ──────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Eslogan bajo el logo del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  eslogan?: string;

  @ApiPropertyOptional({ description: 'Ciudad, para el pie del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ciudad?: string;

  @ApiPropertyOptional({ description: 'Email de contacto del pie del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'Sitio web del pie del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  web?: string;

  @ApiPropertyOptional({ description: 'Teléfono de contacto del pie del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @ApiPropertyOptional({ description: 'URL pública del logo del RIDE' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}

export class EmisorResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  ruc: string;

  @ApiProperty()
  razonSocial: string;

  @ApiPropertyOptional()
  nombreComercial?: string;

  @ApiProperty()
  direccionMatriz: string;

  @ApiProperty()
  obligadoContabilidad: boolean;

  @ApiPropertyOptional()
  contribuyenteEspecial?: string;

  @ApiPropertyOptional()
  agenteRetencion?: string;

  @ApiProperty()
  contribuyenteRimpe: boolean;

  @ApiProperty()
  ambiente: string;

  @ApiProperty({ enum: EmisorEstado })
  estado: string;

  @ApiPropertyOptional()
  tenantId?: string;

  @ApiProperty()
  tieneCertificado: boolean;

  @ApiPropertyOptional()
  certificadoValidoHasta?: string;

  @ApiPropertyOptional()
  certificadoSujeto?: string;

  @ApiPropertyOptional()
  eslogan?: string;

  @ApiPropertyOptional()
  ciudad?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  web?: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiPropertyOptional()
  logoUrl?: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class UploadCertificadoDto {
  @ApiProperty({ description: 'Contraseña del certificado P12' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class PaginatedEmisoresResponseDto {
  @ApiProperty({ type: [EmisorResponseDto] })
  data: EmisorResponseDto[];

  @ApiPropertyOptional({
    description: 'Cursor para la siguiente página, null si no hay más',
  })
  nextCursor: string | null;

  @ApiProperty({ description: 'Indica si hay más elementos disponibles' })
  hasMore: boolean;
}
