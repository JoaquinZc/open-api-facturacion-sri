import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SriSoapClient } from './sri-soap.client';
import { SriSoapFactoryService } from './sri-soap-factory.service';

describe('SriSoapClient', () => {
  let service: SriSoapClient;
  let configService: jest.Mocked<ConfigService>;
  let soapFactory: jest.Mocked<SriSoapFactoryService>;
  let mockRecepcionClient: any;
  let mockAutorizacionClient: any;

  // 49 dígitos: fecha(8) + tipoComp(2) + RUC(13) + ambiente(1) + serie(6) + secuencial(9) + codigoNumerico(8) + tipoEmision(1) + dv(1)
  //             07022026    01          0924383631001  1          001001      000000001          12345678          1                 1
  const CLAVE_ACCESO = '0702202601092438363100110010010000000011234567811';

  beforeEach(async () => {
    mockRecepcionClient = {
      validarComprobanteAsync: jest.fn(),
    };
    mockAutorizacionClient = {
      autorizacionComprobanteAsync: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SriSoapClient,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'sri.rateLimiting.recepcion.retries') return 3;
              if (key === 'sri.rateLimiting.recepcion.delayMs') return 100;
              if (key === 'sri.rateLimiting.autorizacion.retries') return 5;
              if (key === 'sri.rateLimiting.autorizacion.delayMs') return 100;
              if (key === 'sri.rateLimiting.autorizacion.backoffMultiplier')
                return 1.5;
              return defaultValue;
            }),
          },
        },
        {
          provide: SriSoapFactoryService,
          useValue: {
            getRecepcionClient: jest
              .fn()
              .mockResolvedValue(mockRecepcionClient),
            getAutorizacionClient: jest
              .fn()
              .mockResolvedValue(mockAutorizacionClient),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<SriSoapClient>(SriSoapClient);
    configService = moduleRef.get(ConfigService);
    soapFactory = moduleRef.get(SriSoapFactoryService);

    // Espiar delayWithBackoff para evitar esperas reales
    jest.spyOn(service as any, 'delayWithBackoff').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── validarComprobante ────────────────────────────────────────

  describe('validarComprobante', () => {
    it('debe enviar XML en base64 y retornar respuesta RECIBIDA', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);

      const result = await service.validarComprobante('<factura/>', '1');

      expect(result.estado).toBe('RECIBIDA');
      // Con tiempo de espera: sin él, una recepción colgada no terminaba nunca.
      expect(mockRecepcionClient.validarComprobanteAsync).toHaveBeenCalledWith(
        { xml: expect.any(String) },
        { timeout: 10_000 },
      );
      const callArg =
        mockRecepcionClient.validarComprobanteAsync.mock.calls[0][0];
      expect(Buffer.from(callArg.xml, 'base64').toString('utf-8')).toBe(
        '<factura/>',
      );
    });

    it('debe retornar DEVUELTA cuando el SRI devuelve comprobantes con errores', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        {
          RespuestaRecepcionComprobante: {
            estado: 'DEVUELTA',
            comprobantes: {
              comprobante: [
                {
                  claveAcceso: CLAVE_ACCESO,
                  mensajes: {
                    mensaje: [
                      {
                        identificador: 'ERROR-1',
                        mensaje: 'XML inválido',
                        tipo: 'ERROR',
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      ]);

      const result = await service.validarComprobante('<factura/>', '1');

      expect(result.estado).toBe('DEVUELTA');
      expect(result.comprobantes).toBeDefined();
      expect(result.comprobantes!.comprobante).toHaveLength(1);
    });

    it('debe manejar respuesta sin wrapper RespuestaRecepcionComprobante', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { estado: 'RECIBIDA' },
      ]);

      const result = await service.validarComprobante('<factura/>', '1');

      expect(result.estado).toBe('RECIBIDA');
    });

    it('debe lanzar error cuando el cliente SOAP falla', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockRejectedValue(
        new Error('Connection refused'),
      );

      await expect(
        service.validarComprobante('<factura/>', '1'),
      ).rejects.toThrow('Connection refused');
    });

    it('debe usar ambiente 2 para produccion', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);

      await service.validarComprobante('<factura/>', '2');

      expect(soapFactory.getRecepcionClient).toHaveBeenCalledWith('2');
    });
  });

  // ── autorizarComprobante ──────────────────────────────────────

  describe('autorizarComprobante', () => {
    it('debe consultar autorizacion y retornar respuesta con AUTORIZADO', async () => {
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            claveAccesoConsultada: CLAVE_ACCESO,
            numeroComprobantes: '1',
            autorizaciones: {
              autorizacion: [
                {
                  estado: 'AUTORIZADO',
                  numeroAutorizacion: '1234567890',
                  fechaAutorizacion: '2026-02-07T12:00:00-05:00',
                  ambiente: '1',
                  comprobante: '<factura>autorizado</factura>',
                  mensajes: { mensaje: [] },
                },
              ],
            },
          },
        },
      ]);

      const result = await service.autorizarComprobante(CLAVE_ACCESO);

      expect(result.claveAccesoConsultada).toBe(CLAVE_ACCESO);
      expect(result.numeroComprobantes).toBe('1');
      expect(result.autorizaciones!.autorizacion[0].estado).toBe('AUTORIZADO');
    });

    it('debe lanzar error cuando claveAcceso no tiene 49 digitos', async () => {
      await expect(service.autorizarComprobante('123')).rejects.toThrow(
        'La clave de acceso debe tener 49 dígitos',
      );
    });

    it('debe extraer ambiente desde la posicion 23 de la clave de acceso', async () => {
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        { RespuestaAutorizacionComprobante: { numeroComprobantes: '0' } },
      ]);

      await service.autorizarComprobante(CLAVE_ACCESO);

      expect(soapFactory.getAutorizacionClient).toHaveBeenCalledWith('1');
    });

    it('debe manejar respuesta sin wrapper RespuestaAutorizacionComprobante', async () => {
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        { claveAccesoConsultada: CLAVE_ACCESO, numeroComprobantes: '1' },
      ]);

      const result = await service.autorizarComprobante(CLAVE_ACCESO);

      expect(result.claveAccesoConsultada).toBe(CLAVE_ACCESO);
    });

    it('debe lanzar error cuando el cliente SOAP falla', async () => {
      mockAutorizacionClient.autorizacionComprobanteAsync.mockRejectedValue(
        new Error('Timeout'),
      );

      await expect(service.autorizarComprobante(CLAVE_ACCESO)).rejects.toThrow(
        'Timeout',
      );
    });

    it('debe manejar autorizacion con estado NO AUTORIZADO y mensajes', async () => {
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            claveAccesoConsultada: CLAVE_ACCESO,
            numeroComprobantes: '1',
            autorizaciones: {
              autorizacion: [
                {
                  estado: 'NO AUTORIZADO',
                  numeroAutorizacion: '',
                  ambiente: '1',
                  mensajes: {
                    mensaje: [
                      {
                        identificador: 'ERR-1',
                        mensaje: 'Error en campo X',
                        tipo: 'ERROR',
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      ]);

      const result = await service.autorizarComprobante(CLAVE_ACCESO);

      expect(result.autorizaciones!.autorizacion[0].estado).toBe(
        'NO AUTORIZADO',
      );
    });
  });

  // ── enviarYAutorizar ──────────────────────────────────────────

  describe('enviarYAutorizar', () => {
    it('debe completar flujo completo: recepcion RECIBIDA → autorizacion AUTORIZADO', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            claveAccesoConsultada: CLAVE_ACCESO,
            numeroComprobantes: '1',
            autorizaciones: {
              autorizacion: {
                estado: 'AUTORIZADO',
                numeroAutorizacion: '1234567890',
                fechaAutorizacion: '2026-02-07T12:00:00-05:00',
                ambiente: '1',
                comprobante: '<factura>autorizado</factura>',
                mensajes: { mensaje: [] },
              },
            },
          },
        },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.success).toBe(true);
      expect(result.estado).toBe('AUTORIZADO');
      expect(result.numeroAutorizacion).toBe('1234567890');
      expect(result.xmlAutorizado).toBe('<factura>autorizado</factura>');
    });

    it('debe retornar DEVUELTA cuando recepcion devuelve DEVUELTA con mensajes', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        {
          RespuestaRecepcionComprobante: {
            estado: 'DEVUELTA',
            comprobantes: {
              comprobante: [
                {
                  claveAcceso: CLAVE_ACCESO,
                  mensajes: {
                    mensaje: [
                      {
                        identificador: 'ERR-1',
                        mensaje: 'Campo requerido',
                        tipo: 'ERROR',
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.success).toBe(false);
      expect(result.estado).toBe('DEVUELTA');
      expect(result.mensajes).toHaveLength(1);
      expect(result.mensajes[0].identificador).toBe('ERR-1');
    });

    it('debe reintentar recepcion con backoff cuando hay error de red', async () => {
      mockRecepcionClient.validarComprobanteAsync
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce([
          { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
        ]);
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            numeroComprobantes: '1',
            autorizaciones: {
              autorizacion: {
                estado: 'AUTORIZADO',
                numeroAutorizacion: '123',
                ambiente: '1',
              },
            },
          },
        },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.success).toBe(true);
      expect(result.estado).toBe('AUTORIZADO');
      expect(mockRecepcionClient.validarComprobanteAsync).toHaveBeenCalledTimes(
        2,
      );
    });

    it('debe lanzar error cuando todos los reintentos de recepcion fallan', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      await expect(
        service.enviarYAutorizar('<factura/>', CLAVE_ACCESO),
      ).rejects.toThrow('ECONNREFUSED');

      expect(mockRecepcionClient.validarComprobanteAsync).toHaveBeenCalledTimes(
        3,
      );
    });

    it('debe retornar NO AUTORIZADO cuando SRI rechaza', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            numeroComprobantes: '1',
            autorizaciones: {
              autorizacion: {
                estado: 'NO AUTORIZADO',
                ambiente: '1',
                mensajes: {
                  mensaje: [
                    {
                      identificador: 'ERR-1',
                      mensaje: 'Clave de acceso incorrecta',
                      tipo: 'ERROR',
                    },
                  ],
                },
              },
            },
          },
        },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.success).toBe(false);
      expect(result.estado).toBe('NO AUTORIZADO');
      expect(result.mensajes).toHaveLength(1);
    });

    it('«CLAVE ACCESO REGISTRADA» (43) no es devolución: sigue a la autorización', async () => {
      // El primer intento se cortó por tiempo pero llegó; el reenvío dice 43.
      mockRecepcionClient.validarComprobanteAsync
        .mockRejectedValueOnce(new Error('timeout of 10000ms exceeded'))
        .mockResolvedValueOnce([
          {
            RespuestaRecepcionComprobante: {
              estado: 'DEVUELTA',
              comprobantes: {
                comprobante: {
                  claveAcceso: CLAVE_ACCESO,
                  mensajes: {
                    mensaje: {
                      identificador: '43',
                      mensaje: 'CLAVE ACCESO REGISTRADA',
                      tipo: 'ERROR',
                    },
                  },
                },
              },
            },
          },
        ]);
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            numeroComprobantes: '1',
            autorizaciones: {
              autorizacion: {
                estado: 'AUTORIZADO',
                numeroAutorizacion: CLAVE_ACCESO,
                fechaAutorizacion: '2026-10-02T12:02:49-05:00',
                ambiente: '1',
              },
            },
          },
        },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.success).toBe(true);
      expect(result.estado).toBe('AUTORIZADO');
    });

    it('un error de red al consultar la autorización no tumba la emisión: EN PROCESO con la clave', async () => {
      // Ya RECIBIDA: lanzar haría que Business reemitiera con otro secuencial.
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);
      mockAutorizacionClient.autorizacionComprobanteAsync.mockRejectedValue(
        new Error('read ECONNRESET'),
      );

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.estado).toBe('EN PROCESO');
      expect(result.claveAcceso).toBe(CLAVE_ACCESO);
      expect(
        mockAutorizacionClient.autorizacionComprobanteAsync,
      ).toHaveBeenCalledTimes(5);
    });

    it('tras un error de red, el siguiente intento de autorización sí cuenta', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);
      mockAutorizacionClient.autorizacionComprobanteAsync
        .mockRejectedValueOnce(new Error('read ECONNRESET'))
        .mockResolvedValueOnce([
          {
            RespuestaAutorizacionComprobante: {
              numeroComprobantes: '1',
              autorizaciones: {
                autorizacion: { estado: 'AUTORIZADO', ambiente: '1' },
              },
            },
          },
        ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.estado).toBe('AUTORIZADO');
    });

    it('debe retornar EN PROCESO cuando se agotan reintentos de autorizacion', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            numeroComprobantes: '1',
            autorizaciones: {
              autorizacion: { estado: 'EN PROCESO', ambiente: '1' },
            },
          },
        },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.success).toBe(false);
      expect(result.estado).toBe('EN PROCESO');
      expect(result.mensajes[0].identificador).toBe('TIMEOUT');
      expect(
        mockAutorizacionClient.autorizacionComprobanteAsync,
      ).toHaveBeenCalledTimes(5);
    });

    it('debe manejar autorizacion como array con multiple elementos', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            numeroComprobantes: '2',
            autorizaciones: {
              autorizacion: [
                { estado: 'EN PROCESO', ambiente: '1' },
                {
                  estado: 'AUTORIZADO',
                  numeroAutorizacion: '999',
                  ambiente: '1',
                },
              ],
            },
          },
        },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      // Debe tomar el primer elemento del array
      expect(result.estado).toBe('EN PROCESO');
    });

    it('debe llamar delayWithBackoff entre reintentos de autorizacion', async () => {
      const delaySpy = jest.spyOn(service as any, 'delayWithBackoff');
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'RECIBIDA' } },
      ]);
      mockAutorizacionClient.autorizacionComprobanteAsync.mockResolvedValue([
        {
          RespuestaAutorizacionComprobante: {
            numeroComprobantes: '1',
            autorizaciones: {
              autorizacion: { estado: 'EN PROCESO', ambiente: '1' },
            },
          },
        },
      ]);

      await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      // 5 intentos de autorizacion → 4 llamadas a delayWithBackoff (no en intento 1)
      expect(delaySpy).toHaveBeenCalledTimes(4);
    });
  });

  // ── delayWithBackoff ──────────────────────────────────────────

  describe('delayWithBackoff', () => {
    it('debe calcular delay exponencial con cap de 30s', async () => {
      // Restaurar implementación real para este test
      jest.spyOn(service as any, 'delayWithBackoff').mockRestore();

      const delaySpy = jest.spyOn(global, 'setTimeout');
      delaySpy.mockImplementation((cb: any) => {
        cb();
        return undefined as any;
      });

      await (service as any).delayWithBackoff(2000, 3, 1.5);

      // delay = min(2000 * 1.5^2, 30000) = min(4500, 30000) = 4500
      expect(delaySpy).toHaveBeenCalledWith(expect.any(Function), 4500);

      delaySpy.mockRestore();
    });

    it('debe capear el delay a 30 segundos', async () => {
      jest.spyOn(service as any, 'delayWithBackoff').mockRestore();

      const delaySpy = jest.spyOn(global, 'setTimeout');
      delaySpy.mockImplementation((cb: any) => {
        cb();
        return undefined as any;
      });

      await (service as any).delayWithBackoff(10000, 10, 3);

      // delay = min(10000 * 3^9, 30000) = min(196830000, 30000) = 30000
      expect(delaySpy).toHaveBeenCalledWith(expect.any(Function), 30000);

      delaySpy.mockRestore();
    });
  });

  // ── extractMensajes (via enviarYAutorizar) ────────────────────

  describe('extractMensajes - comprobante unico (no array)', () => {
    it('debe extraer mensajes cuando comprobante es un objeto unico', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        {
          RespuestaRecepcionComprobante: {
            estado: 'DEVUELTA',
            comprobantes: {
              comprobante: {
                claveAcceso: CLAVE_ACCESO,
                mensajes: {
                  mensaje: {
                    identificador: 'ERR-1',
                    mensaje: 'Error',
                    tipo: 'ERROR',
                  },
                },
              },
            },
          },
        },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.mensajes).toHaveLength(1);
      expect(result.mensajes[0].identificador).toBe('ERR-1');
    });
  });

  describe('extractMensajes - sin comprobantes', () => {
    it('debe retornar mensajes vacios cuando no hay comprobantes', async () => {
      mockRecepcionClient.validarComprobanteAsync.mockResolvedValue([
        { RespuestaRecepcionComprobante: { estado: 'DEVUELTA' } },
      ]);

      const result = await service.enviarYAutorizar('<factura/>', CLAVE_ACCESO);

      expect(result.mensajes).toEqual([]);
    });
  });
});
