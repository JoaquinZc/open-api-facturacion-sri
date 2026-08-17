# Logos del RIDE

`RideService.cargarLogo()` busca el logo en tres sitios, **en este orden**:

1. **`emisores.logo_url`** — la URL que manda el negocio al darse de alta. Se
   descarga una vez y se cachea en memoria por URL.
2. **`templates/logos/{ruc}.png`** — un fichero dentro de la imagen del
   contenedor, que es esta carpeta.
3. **Un píxel transparente**, si no hay ninguna de las dos.

**Nunca falla.** Un comprobante sin logo sigue siendo válido; uno que no se
genera, no existe.

## Cuál de los dos usar

| | URL | Fichero aquí |
|---|---|---|
| Cuántos emisores | Muchos | Uno o dos, fijos |
| Quién lo cambia | El dueño del negocio, desde el panel | Quien despliega |
| Cuándo se ve el cambio | Al reiniciar (la caché no se invalida sola) | Al desplegar |
| Coste | Una petición por instancia y URL | Ninguno |

La URL es la vía normal: un PNG commiteado por cada negocio no escala, y el
panel ya tiene la imagen de cada uno. El fichero queda para emisores que no
salen de un formulario.

## El de Darkmelon

`1391939437001.png` está aquí porque Darkmelon emite las CO, BC y BQ de todos
los negocios y su logo no cambia: un viaje de red por cada RIDE de plataforma
no compensa.

Sale del isotipo oficial —«El Núcleo Iluminado»— que vive en
`deliveria-frontend/src/components/brand.tsx` (`DarkmelonMark`): círculo
`#1A1A2E` de radio 80 y cuña cian `#00BFFF` entre los radios 80 y 100, sobre un
viewBox de 200×200, acompañado del wordmark en Arial Bold del mismo `#1A1A2E`.

**Se omite el resplandor blanco** que la marca lleva en pantalla: está pensado
para fondo oscuro y sobre papel blanco no se ve — solo engordaría el fichero.

Para regenerarlo tras un cambio de marca, es ese SVG convertido a PNG a 840×240
con fondo transparente.

## Recomendaciones para cualquiera de los dos

- **PNG con fondo transparente.** El RIDE se imprime en blanco y negro a menudo.
- **Ancho de 300–600 px.** La plantilla lo limita a unos 150 pt de ancho; más
  resolución solo engorda el PDF, que viaja en cada descarga.
- **Apaisado mejor que cuadrado**: el hueco es más ancho que alto.
- **Máximo 2 MB.** Por encima se descarta: el logo viaja en base64 dentro de la
  petición a Carbone y engorda un tercio por el camino.

---

## Cómo llega la imagen al documento

`ride.docx` coloca el logo en el **encabezado** (`header1.xml`), con la etiqueta
`{d.emisor.logo}` en el texto alternativo de una imagen de relleno. Se edita en
Word como cualquier imagen: el tamaño y la posición que le des son los que sale.

🔴 **Pero la sustitución no la hace Carbone.** Se comprobó renderizando esta
plantilla: Carbone cambia todas las etiquetas de texto y **deja el binario de la
imagen intacto**, escribiendo el Data URI en el atributo `descr`. La edición
desplegada no trae soporte de imágenes.

La hace `src/modules/pdf/docx-imagenes.ts`, que mete los bytes en el `.docx`
antes de subirlo. El texto alternativo se sigue usando para localizar el hueco,
así que **editar la plantilla no cambia**.

Consecuencia que sí importa: **cuando no hay logo se escribe un píxel
transparente**, no se deja el hueco sin tocar. Si no se sustituyera, quedaría el
relleno de la plantilla — que es el logo de Darkmelon — en la factura de otro
negocio.

Si mueves la imagen o la sustituyes en Word, `docx-imagenes.spec.ts` corre
contra esta plantilla y avisa si la etiqueta deja de encontrarse.
