import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  const mockContext = (): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: undefined }),
        getResponse: () => ({
          status: jest.fn().mockReturnThis(),
          send: jest.fn(),
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
    reflector = module.get(Reflector);

    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(guard).toBeDefined();
  });

  it('debe retornar true si la ruta está marcada como @Public()', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true);

    const result = guard.canActivate(mockContext());

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      'isPublic',
      expect.any(Array),
    );
  });

  it('debe consultar IS_PUBLIC_KEY en handler y class cuando es público', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true);

    guard.canActivate(mockContext());

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
      expect.anything(),
      expect.anything(),
    ]);
  });
});
