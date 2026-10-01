# Comprobante de Retención

Comprobante electrónico tipo `07`, versión 2.0.0 (ficha técnica v2.32, Anexo 10),
emitido por agentes de retención.

---

## Endpoint

```
POST /sri/emitir/retencion
```

---

## Estructura del JSON

```json
{
  "fechaEmision": "30/09/2026",
  "periodoFiscal": "09/2026",
  "emisor": { "...": "como en la factura" },
  "sujetoRetenido": {
    "tipoIdentificacion": "04",
    "identificacion": "0992877000001",
    "razonSocial": "PROVEEDOR S.A.",
    "email": "proveedor@empresa.com",
    "parteRel": "NO"
  },
  "impuestos": [
    {
      "codigo": "1",
      "codigoRetencion": "312",
      "baseImponible": 1000.0,
      "porcentajeRetener": 2,
      "valorRetenido": 20.0,
      "codSustento": "01",
      "codDocSustento": "01",
      "numDocSustento": "001-001-000000001",
      "fechaEmisionDocSustento": "29/09/2026",
      "totalSinImpuestos": 1000.0,
      "importeTotal": 1150.0,
      "formaPago": "20",
      "impuestosDocSustento": [
        {
          "codImpuestoDocSustento": "2",
          "codigoPorcentaje": "4",
          "baseImponible": 1000.0,
          "tarifa": 15,
          "valorImpuesto": 150.0
        }
      ]
    },
    {
      "codigo": "2",
      "codigoRetencion": "1",
      "baseImponible": 150.0,
      "porcentajeRetener": 30,
      "valorRetenido": 45.0,
      "codSustento": "01",
      "codDocSustento": "01",
      "numDocSustento": "001-001-000000001",
      "fechaEmisionDocSustento": "29/09/2026",
      "totalSinImpuestos": 1000.0,
      "importeTotal": 1150.0,
      "formaPago": "20",
      "impuestosDocSustento": [
        {
          "codImpuestoDocSustento": "2",
          "codigoPorcentaje": "4",
          "baseImponible": 1000.0,
          "tarifa": 15,
          "valorImpuesto": 150.0
        }
      ]
    }
  ]
}
```

Cada elemento de `impuestos` es **una retención** con los datos de su factura.
Las que comparten `codDocSustento` y `numDocSustento` se agrupan en un mismo
`<docSustento>` del XML. La retención de IVA se calcula **sobre el IVA** de la
factura (150), no sobre el subtotal.

---

## Sujeto retenido

| Campo                | Obligatorio | Descripción                                      |
| -------------------- | ----------- | ------------------------------------------------ |
| `tipoIdentificacion` | ✅          | Código del tipo de identificación                |
| `identificacion`     | ✅          | RUC, cédula o pasaporte del proveedor            |
| `razonSocial`        | ✅          | Razón social                                     |
| `tipoSujetoRetenido` | Solo con 08 | `01` persona natural, `02` sociedad (exterior)   |
| `parteRel`           | ❌          | `SI` / `NO`: parte relacionada. Por defecto `NO` |
| `email`, `direccion` | ❌          | Van a la información adicional                   |

---

## Cada retención

| Campo                     | Obligatorio | Descripción                                                          |
| ------------------------- | ----------- | -------------------------------------------------------------------- |
| `codigo`                  | ✅          | Impuesto: `1` renta, `2` IVA, `6` ISD. Decide el catálogo            |
| `codigoRetencion`         | ✅          | Código vigente a la fecha de emisión (`GET /catalogos/retenciones`)  |
| `baseImponible`           | ✅          | Base de la retención                                                 |
| `porcentajeRetener`       | ✅          | **El del catálogo** vigente a la fecha de emisión                    |
| `valorRetenido`           | ✅          | `base × % / 100`, a 2 decimales (se tolera ±0,01)                    |
| `codSustento`             | ✅          | Sustento tributario, Tabla 5 del ATS (`GET /catalogos/sustentos`)    |
| `codDocSustento`          | ✅          | Tipo de documento: `01` factura, `02` nota de venta, `03` liquidación |
| `numDocSustento`          | ✅          | `001-001-000000001`                                                  |
| `fechaEmisionDocSustento` | ✅          | `dd/mm/aaaa`                                                         |
| `totalSinImpuestos`       | ✅          | De la factura del proveedor                                          |
| `importeTotal`            | ✅          | De la factura del proveedor                                          |
| `impuestosDocSustento`    | ✅          | Los impuestos de la factura del proveedor                            |
| `formaPago`               | ❌          | Catálogo de formas de pago. Por defecto `01`                         |
| `pagoLocExt`              | ❌          | `01` local (por defecto), `02` exterior                              |

**Qué se rechaza con 400**, antes de ir al SRI:

- un `codigoRetencion` que no existe **o no está vigente** el día de emisión;
- un `porcentajeRetener` distinto del del catálogo ese día;
- un `valorRetenido` que se aparta más de un centavo de `base × % / 100`;
- un `codSustento` que no admite ese `codDocSustento` (p. ej. el `01`, crédito
  de IVA, sobre una nota de venta `02`).

---

## Catálogos

```
GET /catalogos/retenciones?fecha=2026-09-30
GET /catalogos/sustentos?fecha=2026-09-30
```

`fecha` es opcional (`aaaa-mm-dd`, por defecto hoy en Ecuador). Devuelve renta,
IVA e ISD vigentes ese día. **La fecha importa**: la tabla de renta cambió el
01-03-2026 (NAC-DGERCGC26-00000009).

### Renta: los más usados desde el 01-03-2026

| Código | Concepto                                       | %  |
| ------ | ---------------------------------------------- | -- |
| `303`  | Honorarios ligados al título profesional       | 10 |
| `303A` | Servicios profesionales de sociedades          | 5  |
| `304`  | Predomina el intelecto                         | 10 |
| `307`  | Predomina la mano de obra                      | 3  |
| `309`  | Medios de comunicación y publicidad            | 3  |
| `310`  | Transporte                                     | 1  |
| `312`  | Bienes muebles                                 | 2  |
| `320`  | Arrendamiento de inmuebles                     | 10 |
| `332`  | No sujetas (incluye RIMPE negocio popular)     | 0  |
| `343`  | Otras al 1 % (incluye RIMPE emprendedor)       | 1  |
| `343B` | Construcción                                   | 2  |
| `3440` | Residual: lo no listado                        | 3  |
| `3482` | Comisiones a sociedades                        | 5  |

### IVA (ficha técnica, tabla 20)

| Código | %   | Uso habitual                                              |
| ------ | --- | --------------------------------------------------------- |
| `9`    | 10  | Bienes, entre contribuyentes especiales                   |
| `10`   | 20  | Servicios, entre contribuyentes especiales                |
| `1`    | 30  | Bienes                                                    |
| `11`   | 50  |                                                           |
| `2`    | 70  | Servicios                                                 |
| `3`    | 100 | Profesionales, arriendo a persona natural, liquidación    |
| `7`    | 0   | Retención en cero                                         |
| `8`    | 0   | No procede retención                                      |

Los `721`–`731` **no son códigos del XML**: son casilleros del formulario 104.

### ISD

`4580` al 5 % y `4586` al 2,5 % (desde el 01-05-2025, Decreto Ejecutivo 589).

---

## Periodo fiscal

Formato `mm/aaaa`. Ejemplo: `09/2026`.
