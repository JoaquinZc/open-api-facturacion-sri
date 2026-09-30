import { Test } from '@nestjs/testing';
import { UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { DatabaseService } from '../../database/database.service';
import { UserRole, JwtPayload } from './dto/auth.dto';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let db: jest.Mocked<DatabaseService>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  const mockUser = {
    id: 'user-uuid-1',
    email: 'admin@test.com',
    password_hash: '$2b$12$hashedpassword',
    rol: UserRole.SUPERADMIN,
    tenant_id: null,
    activo: true,
  };

  const mockDecodedToken = {
    sub: 'user-uuid-1',
    email: 'admin@test.com',
    rol: UserRole.SUPERADMIN,
    tenantId: null,
    type: 'access',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 28800,
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: DatabaseService,
          useValue: {
            queryOne: jest.fn(),
            query: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
            decode: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'jwt.expiresIn') return '8h';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    db = module.get(DatabaseService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);

    jest.clearAllMocks();
  });

  describe('login', () => {
    const loginDto = { email: 'admin@test.com', password: 'Admin123!' };

    it('debe retornar tokens cuando las credenciales son válidas', async () => {
      db.queryOne.mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
      jwtService.sign.mockReturnValueOnce('access-token');
      jwtService.sign.mockReturnValueOnce('refresh-token');
      jwtService.decode.mockReturnValueOnce(mockDecodedToken);

      const result = await service.login(loginDto);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        rol: mockUser.rol,
        tenantId: undefined,
      });
      expect(db.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, email, password_hash, rol, tenant_id, activo'),
        [loginDto.email],
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE usuarios SET last_login'),
        [mockUser.id],
      );
    });

    it('debe lanzar UnauthorizedException si el usuario no existe', async () => {
      db.queryOne.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Credenciales inválidas');
    });

    it('debe lanzar UnauthorizedException si el usuario está inactivo', async () => {
      db.queryOne.mockResolvedValue({ ...mockUser, activo: false });

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('El usuario está inactivo');
    });

    it('debe lanzar UnauthorizedException si la contraseña es incorrecta', async () => {
      db.queryOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Credenciales inválidas');
    });

    it('debe llamar bcrypt.compare con la contraseña y el hash', async () => {
      db.queryOne.mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
      jwtService.sign.mockReturnValue('token');
      jwtService.decode.mockReturnValueOnce(mockDecodedToken);

      await service.login(loginDto);

      expect(bcrypt.compare).toHaveBeenCalledWith(loginDto.password, mockUser.password_hash);
    });
  });

  describe('refreshToken', () => {
    const refreshDto = { refreshToken: 'valid-refresh-token' };
    const refreshPayload: JwtPayload = {
      sub: 'user-uuid-1',
      email: 'admin@test.com',
      rol: UserRole.SUPERADMIN,
      tenantId: null,
      type: 'refresh',
    };

    it('debe refrescar tokens exitosamente con un refresh token válido', async () => {
      jwtService.verify.mockReturnValue(refreshPayload);
      db.queryOne.mockResolvedValue({ id: 'user-uuid-1', activo: true });
      jwtService.sign.mockReturnValueOnce('new-access-token').mockReturnValueOnce('new-refresh-token');
      jwtService.decode.mockReturnValueOnce({ exp: Math.floor(Date.now() / 1000) + 28800 });

      const result = await service.refreshToken(refreshDto);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.user.email).toBe(refreshPayload.email);
    });

    it('debe lanzar UnauthorizedException si el token no es de tipo refresh', async () => {
      jwtService.verify.mockReturnValueOnce({ ...refreshPayload, type: 'access' });

      await expect(service.refreshToken(refreshDto)).rejects.toThrow(UnauthorizedException);
    });

    it('debe lanzar UnauthorizedException si el token es inválido/expirado', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshToken(refreshDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.refreshToken(refreshDto)).rejects.toThrow('Refresh token inválido o expirado');
    });

    it('debe lanzar UnauthorizedException si el usuario está inactivo en BD', async () => {
      jwtService.verify.mockReturnValueOnce(refreshPayload);
      db.queryOne.mockResolvedValueOnce({ id: 'user-uuid-1', activo: false });

      await expect(service.refreshToken(refreshDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('register', () => {
    const registerDto = {
      email: 'newuser@test.com',
      password: 'NewPass123!',
      rol: UserRole.USER,
    };

    it('debe registrar un nuevo usuario exitosamente', async () => {
      db.queryOne
        .mockResolvedValueOnce(null) // email no existe
        .mockResolvedValueOnce({ // INSERT RETURNING
          id: 'new-uuid',
          email: registerDto.email,
          rol: registerDto.rol,
          tenant_id: null,
        });
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-password');

      const result = await service.register(registerDto);

      expect(result).toEqual({
        id: 'new-uuid',
        email: registerDto.email,
        rol: registerDto.rol,
        tenantId: null,
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 12);
      expect(db.queryOne).toHaveBeenNthCalledWith(2,
        expect.stringContaining('INSERT INTO usuarios'),
        [registerDto.email, 'hashed-password', registerDto.rol, null],
      );
    });

    it('debe asignar rol USER por defecto si no se especifica', async () => {
      db.queryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'new-uuid',
          email: registerDto.email,
          rol: UserRole.USER,
          tenant_id: null,
        });
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-password');

      await service.register({ email: registerDto.email, password: registerDto.password });

      expect(db.queryOne).toHaveBeenNthCalledWith(2,
        expect.stringContaining('INSERT INTO usuarios'),
        [registerDto.email, 'hashed-password', UserRole.USER, null],
      );
    });

    it('debe lanzar ConflictException si el email ya existe', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 'existing-uuid' });

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('debe lanzar NotFoundException si el tenantId no existe o está inactivo', async () => {
      db.queryOne
        .mockResolvedValueOnce(null) // email no existe
        .mockResolvedValueOnce(null); // tenant no encontrado

      await expect(
        service.register({ ...registerDto, tenantId: 'nonexistent-tenant' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe validar que el tenant esté ACTIVO al registrar', async () => {
      db.queryOne
        .mockResolvedValueOnce(null) // email no existe
        .mockResolvedValueOnce({ id: 'tenant-uuid' }) // tenant existe y activo
        .mockResolvedValueOnce({ // INSERT RETURNING
          id: 'new-uuid',
          email: registerDto.email,
          rol: UserRole.ADMIN,
          tenant_id: 'tenant-uuid',
        });
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed-password');

      await service.register({
        email: registerDto.email,
        password: registerDto.password,
        rol: UserRole.ADMIN,
        tenantId: 'tenant-uuid',
      });

      expect(db.queryOne).toHaveBeenNthCalledWith(2,
        expect.stringContaining("SELECT id FROM tenants WHERE id = $1 AND estado = 'ACTIVO'"),
        ['tenant-uuid'],
      );
    });
  });

  describe('changePassword', () => {
    const userId = 'user-uuid-1';
    const currentPassword = 'OldPass123!';
    const newPassword = 'NewPass456!';

    it('debe cambiar la contraseña cuando la actual es válida', async () => {
      db.queryOne.mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('new-hash');
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

      await service.changePassword(userId, currentPassword, newPassword);

      expect(bcrypt.compare).toHaveBeenCalledWith(currentPassword, mockUser.password_hash);
      expect(bcrypt.hash).toHaveBeenCalledWith(newPassword, 12);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE usuarios SET password_hash'),
        ['new-hash', userId],
      );
    });

    it('debe lanzar NotFoundException si el usuario no existe', async () => {
      db.queryOne.mockResolvedValueOnce(null);

      await expect(service.changePassword(userId, currentPassword, newPassword)).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar UnauthorizedException si la contraseña actual es incorrecta', async () => {
      db.queryOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.changePassword(userId, currentPassword, newPassword)).rejects.toThrow(UnauthorizedException);
      await expect(service.changePassword(userId, currentPassword, newPassword)).rejects.toThrow('La contraseña actual es incorrecta');
    });
  });

  describe('validatePayload', () => {
    const payload: JwtPayload = {
      sub: 'user-uuid-1',
      email: 'admin@test.com',
      rol: UserRole.SUPERADMIN,
      tenantId: null,
      type: 'access',
    };

    it('debe retornar el payload si el usuario existe y está activo', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 'user-uuid-1', activo: true });

      const result = await service.validatePayload(payload);

      expect(result).toEqual(payload);
    });

    it('debe lanzar UnauthorizedException si el usuario no existe', async () => {
      db.queryOne.mockResolvedValue(null);

      await expect(service.validatePayload(payload)).rejects.toThrow(UnauthorizedException);
      await expect(service.validatePayload(payload)).rejects.toThrow('Token inválido o usuario inactivo');
    });

    it('debe lanzar UnauthorizedException si el usuario está inactivo', async () => {
      db.queryOne.mockResolvedValue({ id: 'user-uuid-1', activo: false });

      await expect(service.validatePayload(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('debe rechazar refresh tokens usados como access tokens', async () => {
      db.queryOne.mockResolvedValue({ id: 'user-uuid-1', activo: true });

      await expect(
        service.validatePayload({ ...payload, type: 'refresh' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.validatePayload({ ...payload, type: 'refresh' }),
      ).rejects.toThrow('Token de refresco no permitido para acceder a recursos');
    });
  });

  describe('generateTokens (via login)', () => {
    it('debe incluir expiresIn calculado desde el token decodificado', async () => {
      db.queryOne.mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

      const futureExp = Math.floor(Date.now() / 1000) + 28800;
      jwtService.sign.mockReturnValueOnce('access-token');
      jwtService.sign.mockReturnValueOnce('refresh-token');
      jwtService.decode.mockReturnValueOnce({ ...mockDecodedToken, exp: futureExp });

      const result = await service.login({ email: 'admin@test.com', password: 'Admin123!' });

      expect(result.expiresIn).toBeGreaterThan(0);
      expect(result.expiresIn).toBeLessThanOrEqual(28800);
      expect(result.expiresAt).toBeDefined();
    });

    it('debe usar configService para expiresIn del access token', async () => {
      db.queryOne.mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
      jwtService.sign.mockReturnValueOnce('access-token');
      jwtService.sign.mockReturnValueOnce('refresh-token');
      jwtService.decode.mockReturnValueOnce(mockDecodedToken);

      await service.login({ email: 'admin@test.com', password: 'Admin123!' });

      expect(configService.get).toHaveBeenCalledWith('jwt.expiresIn', '8h');
      expect(jwtService.sign).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ type: 'access' }),
        { expiresIn: '8h' },
      );
    });

    it('debe generar refresh token con expiración de 7d', async () => {
      db.queryOne.mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
      jwtService.sign.mockReturnValueOnce('access-token');
      jwtService.sign.mockReturnValueOnce('refresh-token');
      jwtService.decode.mockReturnValueOnce(mockDecodedToken);

      await service.login({ email: 'admin@test.com', password: 'Admin123!' });

      expect(jwtService.sign).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ type: 'refresh' }),
        { expiresIn: '7d' },
      );
    });
  });
});
