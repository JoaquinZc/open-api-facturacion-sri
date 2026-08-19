import { XmlStorageService } from './xml-storage.service';

/**
 * El XML autorizado es el documento que Ecuador obliga a conservar siete años,
 * y **no se puede regenerar**: lleva la firma XAdES-BES y el sello del SRI.
 *
 * Lo que estas pruebas fijan no es «sube a S3», sino algo más estrecho: que
 * **no hay forma de perderlo**. En concreto, que un fallo del almacenamiento no
 * se propaga — porque este código corre después de que el SRI ya haya recibido
 * el comprobante, y una excepción aquí haría rollback de la transacción y
 * dejaría la base sin un documento que el SRI sí tiene.
 */
describe('XmlStorageService', () => {
  const XML = '<?xml version="1.0"?><factura>…</factura>';
  const RUC = '1316995008001';
  const CLAVE = '1708202601131699500800110010010000000109324839210';
  const FECHA = new Date(2026, 7, 17); // agosto de 2026

  let storage: {
    isEnabled: jest.Mock;
    put: jest.Mock;
    getText: jest.Mock;
  };
  let service: XmlStorageService;

  beforeEach(() => {
    storage = {
      isEnabled: jest.fn(() => true),
      put: jest.fn().mockResolvedValue(undefined),
      getText: jest.fn().mockResolvedValue(null),
    };

    const configService = {
      get: jest.fn(() => '/no-existe-a-proposito'),
    };

    service = new XmlStorageService(configService as never, storage as never);
  });

  describe('al guardar', () => {
    it('sube con una clave por RUC, año, mes y tipo', async () => {
      const r = await service.saveXml(RUC, CLAVE, FECHA, 'autorizado', XML);

      expect(storage.put).toHaveBeenCalledWith(
        `${RUC}/2026/08/autorizados/${CLAVE}.xml`,
        XML,
        'application/xml',
      );
      expect(r).toEqual({
        path: `${RUC}/2026/08/autorizados/${CLAVE}.xml`,
        contenido: null,
      });
    });

    /**
     * 🔴 **La prueba que justifica el diseño.**
     *
     * Si esto lanzara, la transacción del comprobante haría rollback y la fila
     * desaparecería de la base — pero el SRI ya lo tiene. Al reintentar saldría
     * «CLAVE ACCESO REGISTRADA» y ese documento quedaría inalcanzable.
     */
    it('si la subida falla, devuelve el contenido en vez de lanzar', async () => {
      storage.put.mockRejectedValue(new Error('S3 no responde'));

      const r = await service.saveXml(RUC, CLAVE, FECHA, 'autorizado', XML);

      expect(r.path).toBeNull();
      expect(r.contenido).toBe(XML);
    });

    it('sin almacenamiento configurado, el respaldo es el único sitio', async () => {
      storage.isEnabled.mockReturnValue(false);

      const r = await service.saveXml(RUC, CLAVE, FECHA, 'firmado', XML);

      expect(storage.put).not.toHaveBeenCalled();
      expect(r).toEqual({ path: null, contenido: XML });
    });

    it('guarda las tres versiones y omite las que no se pasan', async () => {
      const r = await service.saveAllXmls(
        RUC,
        CLAVE,
        FECHA,
        undefined,
        XML,
        XML,
      );

      expect(r.sinFirma).toBeUndefined();
      expect(r.firmado?.path).toContain('/firmados/');
      expect(r.autorizado?.path).toContain('/autorizados/');
      expect(storage.put).toHaveBeenCalledTimes(2);
    });
  });

  describe('al leer', () => {
    it('el respaldo gana y ahorra el viaje a la red', async () => {
      const r = await service.readXml('ruta/cualquiera.xml', XML);

      expect(r).toBe(XML);
      expect(storage.getText).not.toHaveBeenCalled();
    });

    it('sin respaldo, va al almacenamiento', async () => {
      storage.getText.mockResolvedValue(XML);

      const r = await service.readXml('ruta/cualquiera.xml', null);

      expect(storage.getText).toHaveBeenCalledWith('ruta/cualquiera.xml');
      expect(r).toBe(XML);
    });

    it('sin ruta ni respaldo, devuelve null en vez de lanzar', async () => {
      await expect(service.readXml(null, null)).resolves.toBeNull();
    });

    it('devuelve null si no está en ninguna parte', async () => {
      await expect(service.readXml('no/existe.xml', null)).resolves.toBeNull();
    });
  });
});
