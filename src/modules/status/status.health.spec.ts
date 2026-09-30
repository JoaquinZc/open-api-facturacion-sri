import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { SriHealthIndicator } from './sri.health';
import { DatabaseService } from '../../database/database.service';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  }));
});

describe('Health Indicators', () => {
  describe('DatabaseHealthIndicator', () => {
    let indicator: DatabaseHealthIndicator;
    let db: { query: jest.Mock };

    beforeEach(async () => {
      db = {
        query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      const module = await Test.createTestingModule({
        providers: [
          DatabaseHealthIndicator,
          { provide: DatabaseService, useValue: db },
        ],
      }).compile();

      indicator = module.get(DatabaseHealthIndicator);
    });

    it('should return healthy status when DB query succeeds', async () => {
      const result = await indicator.isHealthy('database');
      expect(result['database'].status).toBe('up');
      expect(db.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should throw HealthCheckError when DB query fails', async () => {
      db.query.mockRejectedValue(new Error('Connection refused'));
      await expect(indicator.isHealthy('database')).rejects.toThrow(
        HealthCheckError,
      );
    });
  });

  describe('RedisHealthIndicator', () => {
    let indicator: RedisHealthIndicator;
    let configService: { getOrThrow: jest.Mock; get: jest.Mock };

    beforeEach(async () => {
      configService = {
        getOrThrow: jest.fn((key: string) => {
          if (key === 'redis.host') return 'localhost';
          if (key === 'redis.port') return 6379;
          if (key === 'redis.db') return 0;
          return undefined;
        }),
        get: jest.fn(() => undefined),
      };

      const module = await Test.createTestingModule({
        providers: [
          RedisHealthIndicator,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      indicator = module.get(RedisHealthIndicator);
    });

    it('should return healthy status when Redis ping succeeds', async () => {
      const result = await indicator.isHealthy('redis');
      expect(result['redis'].status).toBe('up');
    });

    it('should throw HealthCheckError when Redis connection fails', async () => {
      const Redis = require('ioredis');
      Redis.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(new Error('Connection refused')),
        quit: jest.fn().mockResolvedValue('OK'),
        disconnect: jest.fn(),
      }));

      await expect(indicator.isHealthy('redis')).rejects.toThrow(
        HealthCheckError,
      );
    });
  });

  describe('SriHealthIndicator', () => {
    let indicator: SriHealthIndicator;
    let configService: { getOrThrow: jest.Mock };

    beforeEach(async () => {
      configService = {
        getOrThrow: jest.fn(
          () =>
            'https://celcer.sri.gob.ec/ComprobantesElectronicos/ws/recepcionComprobantesOffline?wsdl',
        ),
      };

      const module = await Test.createTestingModule({
        providers: [
          SriHealthIndicator,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      indicator = module.get(SriHealthIndicator);
    });

    it('should return healthy status when SRI is reachable (200)', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 200 }) as any;

      const result = await indicator.isHealthy('sri');
      expect(result['sri'].status).toBe('up');
    });

    it('should return healthy status when SRI returns 405 (Method Not Allowed)', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 405 }) as any;

      const result = await indicator.isHealthy('sri');
      expect(result['sri'].status).toBe('up');
    });

    it('should throw HealthCheckError when SRI returns 500', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 500 }) as any;

      await expect(indicator.isHealthy('sri')).rejects.toThrow(
        HealthCheckError,
      );
    });

    it('should throw HealthCheckError when fetch fails', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('Network error')) as any;

      await expect(indicator.isHealthy('sri')).rejects.toThrow(
        HealthCheckError,
      );
    });
  });
});
