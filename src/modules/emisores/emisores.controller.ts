import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Logger,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { EmisoresService } from './emisores.service';
import {
  CreateEmisorDto,
  UpdateEmisorDto,
  EmisorResponseDto,
  QueryEmisoresDto,
  PaginatedEmisoresResponseDto,
} from './dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '../auth/dto/auth.dto';

@ApiTags('Emisores')
@ApiBearerAuth('JWT')
@Controller('emisores')
export class EmisoresController {
  private readonly logger = new Logger(EmisoresController.name);

  constructor(private readonly emisoresService: EmisoresService) {}

  @Get()
  @ApiOperation({ summary: 'Listar emisores con paginación keyset' })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de emisores',
    type: PaginatedEmisoresResponseDto,
  })
  async findAll(
    @Query() query: QueryEmisoresDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PaginatedEmisoresResponseDto> {
    // SUPERADMIN ve todos, otros ven solo los de su tenant
    if (user.rol === UserRole.SUPERADMIN) {
      return this.emisoresService.findAll(query);
    }
    return this.emisoresService.findAllByTenant(user.tenantId!, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un emisor por ID' })
  @ApiResponse({
    status: 200,
    description: 'Emisor encontrado',
    type: EmisorResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Emisor no encontrado' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmisorResponseDto> {
    return this.emisoresService.findOneSecured(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo emisor' })
  @ApiResponse({
    status: 201,
    description: 'Emisor creado',
    type: EmisorResponseDto,
  })
  @ApiResponse({ status: 400, description: 'RUC ya existe' })
  async create(
    @Body() dto: CreateEmisorDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmisorResponseDto> {
    // Si no es SUPERADMIN, forzar el tenantId del usuario
    if (user.rol !== UserRole.SUPERADMIN && user.tenantId) {
      dto.tenantId = user.tenantId;
    }
    return this.emisoresService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar un emisor' })
  @ApiResponse({
    status: 200,
    description: 'Emisor actualizado',
    type: EmisorResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Emisor no encontrado' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmisorDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmisorResponseDto> {
    // Verificar acceso al emisor antes de actualizar
    await this.emisoresService.findOneSecured(id, user);
    return this.emisoresService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Inactivar un emisor (eliminación lógica)' })
  @ApiResponse({
    status: 200,
    description: 'Emisor inactivado',
    type: EmisorResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Emisor ya está inactivo' })
  @ApiResponse({ status: 404, description: 'Emisor no encontrado' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmisorResponseDto> {
    await this.emisoresService.findOneSecured(id, user);
    return this.emisoresService.delete(id);
  }
}
