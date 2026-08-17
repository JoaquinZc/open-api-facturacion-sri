# Logos del RIDE

Un fichero PNG por emisor, **nombrado con su RUC**:

```
templates/logos/1391939437001.png   ← DARKMELON CONSULTING S.A.S.
templates/logos/1316995008001.png   ← el negocio que emite sus propias BO/RC
```

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
