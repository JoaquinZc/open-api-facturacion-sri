import { carboneTodaviaNoEsta, conCarboneDespierto } from './carbone-despertar';

const http = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const conexion = (code: string) => Object.assign(new Error(code), { code });

describe('carboneTodaviaNoEsta', () => {
  it.each([502, 503, 504])(
    'sí con HTTP %i: es el proxy mientras arranca',
    (s) => {
      expect(carboneTodaviaNoEsta(http(s))).toBe(true);
    },
  );

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'])(
    'sí con %s sin respuesta',
    (code) => {
      expect(carboneTodaviaNoEsta(conexion(code))).toBe(true);
    },
  );

  it.each([400, 415, 500])('no con HTTP %i: Carbone ya contestó', (s) => {
    expect(carboneTodaviaNoEsta(http(s))).toBe(false);
  });

  it('no con un error sin código, que es un fallo nuestro', () => {
    expect(carboneTodaviaNoEsta(new TypeError('x is not a function'))).toBe(
      false,
    );
    expect(carboneTodaviaNoEsta(null)).toBe(false);
  });
});

describe('conCarboneDespierto', () => {
  const dormir = jest.fn((ms: number) => Promise.resolve(void ms));

  beforeEach(() => dormir.mockClear());

  it('reintenta mientras despierta y devuelve la respuesta buena', async () => {
    const accion = jest
      .fn()
      .mockRejectedValueOnce(http(502))
      .mockRejectedValueOnce(conexion('ECONNREFUSED'))
      .mockResolvedValueOnce('ok');
    const logger = { warn: jest.fn() };

    await expect(conCarboneDespierto(accion, { dormir, logger })).resolves.toBe(
      'ok',
    );

    expect(accion).toHaveBeenCalledTimes(3);
    expect(dormir.mock.calls).toEqual([[1000], [2000]]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('no reintenta cuando Carbone contesta que no', async () => {
    const accion = jest.fn().mockRejectedValue(http(415));

    await expect(conCarboneDespierto(accion, { dormir })).rejects.toThrow(
      'HTTP 415',
    );
    expect(accion).toHaveBeenCalledTimes(1);
    expect(dormir).not.toHaveBeenCalled();
  });

  it('se rinde tras los intentos y lanza el último error', async () => {
    const accion = jest.fn().mockRejectedValue(http(502));

    await expect(
      conCarboneDespierto(accion, { dormir, intentos: 3, esperaBaseMs: 10 }),
    ).rejects.toThrow('HTTP 502');
    expect(accion).toHaveBeenCalledTimes(3);
    expect(dormir.mock.calls).toEqual([[10], [20]]);
  });

  it('con los valores por defecto no espera más de 10 s', async () => {
    const accion = jest.fn().mockRejectedValue(http(502));

    await expect(conCarboneDespierto(accion, { dormir })).rejects.toThrow();
    const total = dormir.mock.calls.reduce((s, [ms]) => s + ms, 0);
    expect(total).toBe(10_000);
  });
});
