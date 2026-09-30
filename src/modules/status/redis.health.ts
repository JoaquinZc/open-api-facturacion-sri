import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import Redis from 'ioredis';

/**
 * Health check para Redis.
 * BullMQ depende completamente de Redis — si falla, las colas se detienen silenciosamente.
 * Lee la configuración desde redis.* de configuration.ts.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const client = new Redis({
      host: this.configService.getOrThrow<string>('redis.host'),
      port: this.configService.getOrThrow<number>('redis.port'),
      password: this.configService.get<string>('redis.password') || undefined,
      db: this.configService.getOrThrow<number>('redis.db'),
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    try {
      await client.connect();
      await client.ping();
      return this.getStatus(key, true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: msg }),
      );
    } finally {
      // Siempre cerrar la conexión de diagnóstico
      await client.quit().catch(() => client.disconnect());
    }
  }
}
