import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { SriHealthIndicator } from './sri.health';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  readdirSync: jest.fn(() => ['file1.pdf', 'file2.pdf']),
}));

jest.mock('../../common/utils/storage-paths', () => ({
  STORAGE_PATHS: {
    pdfs: '/fake/pdfs',
    certs: '/fake/certs',
    templates: '/fake/templates',
  },
}));

describe('StatusController', () => {
  let controller: StatusController;
  let statusService: { getStatus: jest.Mock };
  let health: { check: jest.Mock };
  let db: { isHealthy: jest.Mock };
  let redis: { isHealthy: jest.Mock };
  let sri: { isHealthy: jest.Mock };
  let memory: { checkHeap: jest.Mock; checkRSS: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    statusService = {
      getStatus: jest.fn(() => ({ status: 'ok', version: '1.0.0' })),
    };
    health = {
      check: jest.fn(async (checks) => {
        const results: Record<string, any> = {};
        for (const check of checks) {
          try {
            Object.assign(results, await check());
          } catch (e) {
            Object.assign(results, { error: (e as Error).message });
          }
        }
        return results;
      }),
    };
    db = { isHealthy: jest.fn(async () => ({ database: { status: 'up' } })) };
    redis = { isHealthy: jest.fn(async () => ({ redis: { status: 'up' } })) };
    sri = { isHealthy: jest.fn(async () => ({ sri_soap: { status: 'up' } })) };
    memory = {
      checkHeap: jest.fn(async () => ({ memory_heap: { status: 'up' } })),
      checkRSS: jest.fn(async () => ({ memory_rss: { status: 'up' } })),
    };
    configService = { get: jest.fn((key, def) => def) };

    const module = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [
        { provide: StatusService, useValue: statusService },
        { provide: HealthCheckService, useValue: health },
        { provide: DatabaseHealthIndicator, useValue: db },
        { provide: RedisHealthIndicator, useValue: redis },
        { provide: SriHealthIndicator, useValue: sri },
        { provide: MemoryHealthIndicator, useValue: memory },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get(StatusController);
  });

  describe('getStatus', () => {
    it('should return status with health checks', async () => {
      const result = await controller.getStatus();

      expect(result.status).toBe('ok');
      expect(result.health).toBeDefined();
      expect(health.check).toHaveBeenCalled();
      expect(db.isHealthy).toHaveBeenCalledWith('database');
      expect(redis.isHealthy).toHaveBeenCalledWith('redis');
      expect(sri.isHealthy).toHaveBeenCalledWith('sri_soap');
    });

    it('should use config thresholds for memory checks', async () => {
      configService.get = jest.fn((key, def) => {
        if (key === 'healthChecks.memoryHeapMb') return 200;
        if (key === 'healthChecks.memoryRssMb') return 400;
        return def;
      });

      await controller.getStatus();

      expect(memory.checkHeap).toHaveBeenCalledWith(
        'memory_heap',
        200 * 1024 * 1024,
      );
      expect(memory.checkRSS).toHaveBeenCalledWith(
        'memory_rss',
        400 * 1024 * 1024,
      );
    });
  });

  describe('root', () => {
    it('should be defined (redirect handled by decorator)', () => {
      expect(controller.root).toBeDefined();
    });
  });
});
