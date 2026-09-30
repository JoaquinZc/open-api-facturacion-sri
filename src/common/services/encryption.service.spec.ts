import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;
  let configService: jest.Mocked<ConfigService>;

  const validKey = 'my-secret-encryption-key-32b';
  const validSalt = 'my-salt-value';

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'encryptionKey') return validKey;
              if (key === 'encryptionSalt') return validSalt;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(EncryptionService);
    configService = module.get(ConfigService);
  });

  // ─── Inicialización ────────────────────────────────────────────────────

  describe('inicialización', () => {
    it('debe inicializar correctamente con ENCRYPTION_KEY y ENCRYPTION_SALT', () => {
      expect(service).toBeDefined();
      expect(configService.get).toHaveBeenCalledWith('encryptionKey');
      expect(configService.get).toHaveBeenCalledWith('encryptionSalt');
    });

    it('debe lanzar error si ENCRYPTION_KEY no está definida', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            EncryptionService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string) => {
                  if (key === 'encryptionKey') return undefined;
                  if (key === 'encryptionSalt') return validSalt;
                  return undefined;
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('ENCRYPTION_KEY y ENCRYPTION_SALT son requeridas');
    });

    it('debe lanzar error si ENCRYPTION_SALT no está definida', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            EncryptionService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string) => {
                  if (key === 'encryptionKey') return validKey;
                  if (key === 'encryptionSalt') return undefined;
                  return undefined;
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('ENCRYPTION_KEY y ENCRYPTION_SALT son requeridas');
    });

    it('debe lanzar error si ambas env vars están ausentes', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            EncryptionService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn(() => undefined),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('ENCRYPTION_KEY y ENCRYPTION_SALT son requeridas');
    });
  });

  // ─── encrypt ───────────────────────────────────────────────────────────

  describe('encrypt', () => {
    it('debe encriptar texto plano y retornar formato iv:encrypted', async () => {
      const plainText = 'password-secreto-123';
      const encrypted = await service.encrypt(plainText);

      expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
      const [ivHex, encryptedHex] = encrypted.split(':');
      expect(ivHex).toHaveLength(32); // 16 bytes IV = 32 hex chars
      expect(encryptedHex.length).toBeGreaterThan(0);
    });

    it('debe generar IVs diferentes en cada encriptación (aleatoriedad)', async () => {
      const plainText = 'mismo-texto';
      const enc1 = await service.encrypt(plainText);
      const enc2 = await service.encrypt(plainText);

      expect(enc1).not.toBe(enc2);
      // El IV debe ser diferente
      expect(enc1.split(':')[0]).not.toBe(enc2.split(':')[0]);
    });

    it('debe encriptar strings vacíos', async () => {
      const encrypted = await service.encrypt('');

      expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    });

    it('debe encriptar caracteres especiales y unicode', async () => {
      const plainText = 'contraseñañüé@#$%^&*()';
      const encrypted = await service.encrypt(plainText);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('debe encriptar strings largos', async () => {
      const plainText = 'A'.repeat(10000);
      const encrypted = await service.encrypt(plainText);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });
  });

  // ─── decrypt ───────────────────────────────────────────────────────────

  describe('decrypt', () => {
    it('debe desencriptar correctamente texto previamente encriptado', async () => {
      const plainText = 'mi-password-secreto';
      const encrypted = await service.encrypt(plainText);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('debe lanzar error si el formato no es iv:encrypted', async () => {
      await expect(service.decrypt('formato-invalido')).rejects.toThrow(
        'Formato de texto encriptado inválido',
      );
    });

    it('debe lanzar error si falta la parte encrypted', async () => {
      await expect(service.decrypt('abc123')).rejects.toThrow(
        'Formato de texto encriptado inválido',
      );
    });

    it('debe lanzar error si el IV no es hex válido', async () => {
      await expect(service.decrypt('no-hex:abc123')).rejects.toThrow();
    });

    it('debe poder desencriptar múltiples valores en secuencia', async () => {
      const texts = ['uno', 'dos', 'tres'];
      const encrypted = await Promise.all(texts.map((t) => service.encrypt(t)));
      const decrypted = await Promise.all(
        encrypted.map((e) => service.decrypt(e)),
      );

      expect(decrypted).toEqual(texts);
    });
  });

  // ─── Round-trip (encrypt → decrypt) ────────────────────────────────────

  describe('round-trip encrypt/decrypt', () => {
    it('debe mantener integridad del texto para passwords de certificados', async () => {
      const certPassword = 'MyCertP@ssw0rd!2026';
      const encrypted = await service.encrypt(certPassword);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(certPassword);
    });

    it('debe funcionar con el mismo servicio instancia múltiples veces (key cache)', async () => {
      const text1 = 'password1';
      const text2 = 'password2';

      const enc1 = await service.encrypt(text1);
      const enc2 = await service.encrypt(text2);

      const dec1 = await service.decrypt(enc1);
      const dec2 = await service.decrypt(enc2);

      expect(dec1).toBe(text1);
      expect(dec2).toBe(text2);
    });
  });

  // ─── deriveKey cache (indirecto) ───────────────────────────────────────

  describe('deriveKey cache', () => {
    it('debe cachear la clave derivada (segunda encriptación no recalcula)', async () => {
      // Primera encriptación deriva y cachea la clave
      const enc1 = await service.encrypt('test1');
      expect(enc1).toBeDefined();

      // Segunda encriptación usa clave cacheada
      const enc2 = await service.encrypt('test2');
      expect(enc2).toBeDefined();

      // Ambas deben ser desencriptables con la misma instancia
      expect(await service.decrypt(enc1)).toBe('test1');
      expect(await service.decrypt(enc2)).toBe('test2');
    });
  });
});
