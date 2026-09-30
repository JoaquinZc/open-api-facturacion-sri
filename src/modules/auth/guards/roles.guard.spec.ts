import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { UserRole, JwtPayload } from '../dto/auth.dto';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  const mockUser: JwtPayload = {
    sub: 'admin-1',
    email: 'admin@test.com',
    rol: UserRole.SUPERADMIN,
    tenantId: null,
  };

  const mockContext = (user: JwtPayload | null): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get(RolesGuard);
    reflector = module.get(Reflector);

    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(guard).toBeDefined();
  });

  it('debe retornar true si no hay roles requeridos', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);

    const result = guard.canActivate(
      mockContext({ ...mockUser, rol: UserRole.USER }),
    );

    expect(result).toBe(true);
  });

  it('debe retornar true si no hay roles requeridos (array vacío)', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([]);

    const result = guard.canActivate(
      mockContext({ ...mockUser, rol: UserRole.USER }),
    );

    expect(result).toBe(true);
  });

  it('debe retornar true si el usuario tiene el rol requerido', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([UserRole.SUPERADMIN]);
    const user: JwtPayload = {
      sub: 'admin-1',
      email: 'admin@test.com',
      rol: UserRole.SUPERADMIN,
      tenantId: null,
    };

    const result = guard.canActivate(mockContext(user));

    expect(result).toBe(true);
  });

  it('debe lanzar ForbiddenException si el usuario no tiene el rol requerido', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([UserRole.SUPERADMIN]);
    const user: JwtPayload = {
      sub: 'user-1',
      email: 'user@test.com',
      rol: UserRole.USER,
      tenantId: 'tenant-abc',
    };

    expect(() => guard.canActivate(mockContext(user))).toThrow(
      ForbiddenException,
    );
  });

  it('debe lanzar ForbiddenException si no hay usuario en el request', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPERADMIN]);

    expect(() => guard.canActivate(mockContext(null))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(mockContext(null))).toThrow(
      'No tienes permisos para acceder a este recurso',
    );
  });

  it('debe permitir acceso si el usuario tiene cualquiera de los roles requeridos', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      UserRole.SUPERADMIN,
      UserRole.ADMIN,
    ]);
    const adminUser: JwtPayload = {
      sub: 'admin-1',
      email: 'admin@test.com',
      rol: UserRole.ADMIN,
      tenantId: 'tenant-abc',
    };

    const result = guard.canActivate(mockContext(adminUser));

    expect(result).toBe(true);
  });

  it('debe rechazar acceso si el usuario tiene rol USER y se requiere ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([UserRole.ADMIN]);
    const regularUser: JwtPayload = {
      sub: 'user-1',
      email: 'user@test.com',
      rol: UserRole.USER,
      tenantId: 'tenant-abc',
    };

    expect(() => guard.canActivate(mockContext(regularUser))).toThrow(
      ForbiddenException,
    );
  });

  it('debe incluir los roles requeridos en el mensaje de error', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      UserRole.SUPERADMIN,
      UserRole.ADMIN,
    ]);
    const user: JwtPayload = {
      sub: 'user-1',
      email: 'user@test.com',
      rol: UserRole.USER,
      tenantId: 'tenant-abc',
    };

    try {
      guard.canActivate(mockContext(user));
      fail('Debería haber lanzado ForbiddenException');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).message).toContain('SUPERADMIN');
      expect((e as ForbiddenException).message).toContain('ADMIN');
    }
  });
});
