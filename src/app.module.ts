import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import configuration from './config/configuration';

// Common Services
import { EncryptionModule } from './common/services/encryption.module';
import { AuditModule } from './common/services/audit.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { QueueModule } from './common/queues/queue.module';
import { RedisCacheModule } from './common/cache/redis-cache.module';

// Database Module
import { DatabaseModule } from './database';

// Auth Module
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

// Feature Modules
import { TemplateModule } from './modules/template/template.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { CertificateModule } from './modules/certificate/certificate.module';
import { DocumentModule } from './modules/document/document.module';
import { ImageModule } from './modules/image/image.module';
import { StatusModule } from './modules/status/status.module';
import { SriModule } from './modules/sri/sri.module';
import { EmisoresModule } from './modules/emisores/emisores.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { PuntosEmisionModule } from './modules/puntos-emision/puntos-emision.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { CatalogosModule } from './modules/catalogos/catalogos.module';

import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    // Configuration Module
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),

    // Rate Limiting Global
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('throttler.ttl', 60000),
          limit: configService.get<number>('throttler.limit', 100),
        },
      ],
      inject: [ConfigService],
    }),

    /*
     * ═══ Los PDF ya NO se sirven como ficheros estáticos ══════════════════
     *
     * 🔴 **Era la única vía sin autenticación de todo el servicio.** El
     * `JwtAuthGuard` global no protegía nada de esto: el middleware de
     * estáticos responde antes de que ninguna guarda llegue a ejecutarse. Y
     * los nombres eran `documento_${Date.now()}.pdf` — un timestamp en
     * milisegundos, enumerable si se sabe más o menos cuándo se generó.
     *
     * Cualquiera con la URL —o con paciencia— podía descargar el documento de
     * cualquier emisor, saltándose por completo el aislamiento por tenant.
     *
     * **No se pierde nada al quitarlo:**
     *
     * - El **RIDE** nunca pasó por aquí. `GET /sri/comprobantes/:clave/ride`
     *   lo regenera en memoria en cada descarga, con JWT y validación de
     *   acceso al comprobante. Es el camino correcto y el único que usa
     *   `business`.
     * - Lo que sí caía en `/data/pdfs` eran las salidas de `POST /pdf/generate*`,
     *   un generador genérico heredado del proyecto original. Se comprobó que
     *   **ni `business` ni el panel referencian ninguna URL `/pdfs/`**.
     *
     * Si algún día hace falta entregar un fichero guardado, la forma es un
     * endpoint autenticado que compruebe el tenant —como hacen el RIDE y el
     * XML—, no un directorio abierto.
     */

    // Common Services
    EncryptionModule,
    AuditModule,
    QueueModule,
    RedisCacheModule,

    // Database Module
    DatabaseModule,

    // Auth Module (before feature modules)
    AuthModule,

    // Feature Modules
    TemplateModule,
    PdfModule,
    CertificateModule,
    DocumentModule,
    ImageModule,
    StatusModule,
    SriModule,
    EmisoresModule,
    WebhooksModule,
    TenantsModule,
    PuntosEmisionModule,
    RealtimeModule,
    CatalogosModule,
  ],
  providers: [
    // Guard JWT global — protege todos los endpoints excepto @Public()
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Guard de roles global
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Guard de rate limiting global
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Interceptor de auditoría global
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
