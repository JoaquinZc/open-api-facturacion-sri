/**
 * El logo se descarga de una URL guardada en la ficha del emisor, y eso es una
 * primitiva peligrosa: **este servicio hace una petición HTTP que decide otro.**
 *
 * Sin filtro, `http://169.254.169.254/…` son las credenciales de la instancia
 * en la nube, `http://….railway.internal` es la red privada del despliegue y
 * `http://127.0.0.1:3000/…` es esta misma API saltándose el proxy — y la
 * respuesta acabaría dentro de un PDF que alguien descarga.
 *
 * Hoy la única URL que llega de verdad es la del almacenamiento de imágenes, no
 * texto que escriba nadie. Pero el filtro protege del mañana, y estas pruebas
 * existen para que siga estando cuando alguien reorganice este archivo.
 */
import { RideService } from './ride.service';

/**
 * `esDireccionPublica` y `destinoPermitido` son privados. Se llega a ellos por
 * el prototipo en vez de exportarlos solo para la prueba: sacarlos a la API
 * pública del servicio invitaría a usarlos desde fuera, que es justo lo que no
 * se quiere de una comprobación de seguridad — se usa la que hace la descarga.
 */
type ConPrivados = {
  esDireccionPublica(ip: string): boolean;
  destinoPermitido(u: URL): Promise<boolean>;
  logger: { warn: (m: string) => void };
};

const svc = Object.create(RideService.prototype) as ConPrivados;
svc.logger = { warn: () => undefined };

describe('a dónde puede ir la descarga del logo', () => {
  describe('direcciones que NO puede alcanzar', () => {
    const prohibidas = [
      ['169.254.169.254', 'metadatos de la instancia — el caso que más duele'],
      ['127.0.0.1', 'esta misma máquina'],
      ['0.0.0.0', 'todas las interfaces locales'],
      ['10.1.2.3', 'red privada clase A'],
      ['172.16.0.1', 'red privada — límite inferior'],
      ['172.31.255.254', 'red privada — límite superior'],
      ['192.168.1.1', 'red privada doméstica'],
      ['100.64.0.1', 'CGNAT'],
      ['224.0.0.1', 'multidifusión'],
      ['::1', 'localhost en IPv6'],
      ['fe80::1', 'enlace local IPv6'],
      ['fd00::1', 'única local IPv6'],
      ['::ffff:127.0.0.1', 'IPv4 disfrazada de IPv6'],
      ['::ffff:169.254.169.254', 'metadatos disfrazados de IPv6'],
    ];

    it.each(prohibidas)('%s — %s', (ip) => {
      expect(svc.esDireccionPublica(ip)).toBe(false);
    });
  });

  describe('direcciones que sí puede alcanzar', () => {
    const permitidas = [
      '8.8.8.8',
      '1.1.1.1',
      '172.15.0.1', // justo por debajo del rango privado
      '172.32.0.1', // justo por encima
      '192.169.0.1', // no es 192.168
      '100.63.0.1', // por debajo del CGNAT
      '2606:4700::1111',
    ];

    it.each(permitidas)('%s', (ip) => {
      expect(svc.esDireccionPublica(ip)).toBe(true);
    });
  });

  describe('protocolos', () => {
    it.each([
      ['file:///etc/passwd', 'leería ficheros del contenedor'],
      ['ftp://ejemplo.com/logo.png', 'no es HTTP'],
      ['data:image/png;base64,AAAA', 'no es una descarga'],
      ['gopher://ejemplo.com/', 'clásico para hablar con otros servicios'],
    ])('rechaza %s — %s', async (url) => {
      await expect(svc.destinoPermitido(new URL(url))).resolves.toBe(false);
    });
  });

  /**
   * **El nombre no dice a dónde va.** `logo.example.com` puede tener un
   * registro A a `127.0.0.1`, así que el filtro mira la IP resuelta y no la
   * cadena de la URL. Esta prueba usa un nombre que el propio estándar reserva
   * para resolver a localhost.
   */
  it('rechaza un nombre público que resuelve a una dirección interna', async () => {
    // `localhost` es el caso comprobable sin depender de DNS externo.
    await expect(
      svc.destinoPermitido(new URL('http://localhost:3000/logo.png')),
    ).resolves.toBe(false);
  });

  it('rechaza un nombre que no resuelve, en vez de intentar la petición', async () => {
    await expect(
      svc.destinoPermitido(
        new URL('http://este-nombre-no-existe.invalid/logo.png'),
      ),
    ).resolves.toBe(false);
  });
});
