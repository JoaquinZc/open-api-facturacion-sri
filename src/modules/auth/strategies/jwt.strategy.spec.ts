import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from '../auth.service';
import { JwtPayload, UserRole } from '../dto/auth.dto';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: jest.Mocked<ConfigService>;
  let authService: jest.Mocked<AuthService>;

  const mockPayload: JwtPayload = {
    sub: 'user-uuid-1',
    email: 'admin@test.com',
    rol: UserRole.SUPERADMIN,
    tenantId: null,
    type: 'access',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'jwt.secret') return 'test-jwt-secret';
              return undefined;
            }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            validatePayload: jest.fn(),
          },
        },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
    configService = module.get(ConfigService);
    authService = module.get(AuthService);

    // No usar clearAllMocks: el constructor de JwtStrategy llama a configService.get
    // durante la compilación del módulo. Limpiar mocks borraría ese registro.
    authService.validatePayload.mockClear();
  });

  it('debe estar definida', () => {
    expect(strategy).toBeDefined();
  });

  it('debe configurar secretOrKey desde ConfigService', () => {
    expect(configService.get).toHaveBeenCalledWith('jwt.secret');
  });

  describe('validate', () => {
    it('debe retornar el payload validado por AuthService', async () => {
      authService.validatePayload.mockResolvedValueOnce(mockPayload);

      const result = await strategy.validate(mockPayload);

      expect(result).toEqual(mockPayload);
      expect(authService.validatePayload).toHaveBeenCalledWith(mockPayload);
    });

    it('debe propagar UnauthorizedException si el payload es inválido', async () => {
      authService.validatePayload.mockRejectedValueOnce(
        new UnauthorizedException('Token inválido o usuario inactivo'),
      );

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('debe rechazar refresh tokens', async () => {
      const refreshPayload = { ...mockPayload, type: 'refresh' as const };
      authService.validatePayload.mockRejectedValueOnce(
        new UnauthorizedException(
          'Token de refresco no permitido para acceder a recursos',
        ),
      );

      await expect(strategy.validate(refreshPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('debe validar payload con tenantId', async () => {
      const tenantPayload: JwtPayload = {
        ...mockPayload,
        tenantId: 'tenant-abc',
        rol: UserRole.ADMIN,
      };
      authService.validatePayload.mockResolvedValueOnce(tenantPayload);

      const result = await strategy.validate(tenantPayload);

      expect(result.tenantId).toBe('tenant-abc');
      expect(result.rol).toBe(UserRole.ADMIN);
    });
  });
});
