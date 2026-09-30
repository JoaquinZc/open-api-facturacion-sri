import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../auth/dto/auth.dto';

describe('RealtimeController', () => {
  let controller: RealtimeController;
  let realtimeService: {
    validateToken: jest.Mock;
    createConnection: jest.Mock;
  };

  beforeEach(async () => {
    realtimeService = {
      validateToken: jest.fn(),
      createConnection: jest.fn(() => ({ subscribe: jest.fn() })),
    };

    const module = await Test.createTestingModule({
      controllers: [RealtimeController],
      providers: [
        { provide: RealtimeService, useValue: realtimeService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
      ],
    }).compile();

    controller = module.get(RealtimeController);
  });

  describe('events', () => {
    it('should throw UnauthorizedException when no token provided', () => {
      expect(() => controller.events('')).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token is invalid', () => {
      realtimeService.validateToken.mockReturnValue(null);
      expect(() => controller.events('invalid-token')).toThrow(
        UnauthorizedException,
      );
    });

    it('should create connection when token is valid', () => {
      const payload = {
        sub: 'user-1',
        email: 'test@test.com',
        rol: UserRole.ADMIN,
        tenantId: 't-1',
      };
      realtimeService.validateToken.mockReturnValue(payload);
      realtimeService.createConnection.mockReturnValue({
        subscribe: jest.fn(),
      });

      const result = controller.events('valid-token');
      expect(result).toBeDefined();
      expect(realtimeService.validateToken).toHaveBeenCalledWith('valid-token');
      expect(realtimeService.createConnection).toHaveBeenCalled();
    });
  });
});
