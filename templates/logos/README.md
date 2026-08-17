# Logos del RIDE

Un fichero PNG por emisor, **nombrado con su RUC**:

```
templates/logos/1391939437001.png   ← DARKMELON CONSULTING S.A.S.  (ya está)
templates/logos/1316995008001.png   ← el negocio que emite sus propias BO/RC
```

## De dónde sale el de Darkmelon

Del isotipo oficial —«El Núcleo Iluminado»— que vive en
`deliveria-frontend/src/components/brand.tsx` (`DarkmelonMark`): círculo
`#1A1A2E` de radio 80 y cuña cian `#00BFFF` entre los radios 80 y 100, sobre un
viewBox de 200×200. Aquí se acompaña del wordmark en Arial Bold del mismo
`#1A1A2E`.

**Se omite el resplandor blanco** que la marca lleva en pantalla: está pensado
para fondo oscuro y sobre papel blanco no se ve — solo engordaría el fichero.

Para regenerarlo tras un cambio de marca, es ese SVG convertido a PNG a 840×240
con fondo transparente.

`RideService.cargarLogo()` lo busca por el RUC del comprobante. Si no existe,
usa un píxel transparente y el RIDE sale sin logo — **no falla**.

## Por qué aquí y no en la base de datos

Porque las plantillas ya viajan dentro de la imagen, así que añadir un logo es
dejar un fichero al lado y desplegar. Una columna en `emisores` habría exigido
migración, endpoint de subida y almacenamiento — para un dato que cambia una vez
al año.

Si algún día hay muchos emisores con logo propio, esa es la señal para moverlo a
la base de datos. Con unos pocos, esto sobra.

## Recomendaciones

- **PNG con fondo transparente.** El RIDE se imprime en blanco y negro a menudo.
- **Ancho de 300–600 px.** La plantilla lo limita a 150 pt de ancho y 46 pt de
  alto; más resolución solo engorda el PDF, que viaja en cada descarga.
- **Apaisado mejor que cuadrado**: el hueco es más ancho que alto.
