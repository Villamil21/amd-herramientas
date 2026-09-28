# Diseño: Certificado de composición accionaria

## Objetivo

Incorporar el submódulo **Composición Accionaria** en Certificados. Generará
un PDF de una página con datos persistidos de la empresa, sus accionistas y un
firmante reutilizable, conservando la composición visual del documento de
referencia sin reutilizarlo como fondo.

## Enfoque elegido

Se ampliará el patrón actual del certificado de retención: React compone un
modelo de documento validado y jsPDF lo exporta. La vista previa y el PDF
consumirán ese mismo modelo y la misma especificación de layout.

Alternativas descartadas:

1. HTML independiente para vista previa y un layout PDF separado: implica
   riesgo de divergencia.
2. Usar el PDF de ejemplo como fondo: impide datos realmente dinámicos y no
   escala a múltiples socios.

## Persistencia

Una migración SQLite exclusivamente aditiva añadirá el DV y los datos de
capital a `companies`; tablas relacionadas guardarán accionistas ordenados y
firmantes. Las imágenes de firma se copiarán al directorio de datos de la
aplicación, igual que los logos, y SQLite guardará solo el identificador
persistente. Las rutas y las nuevas tablas se incluirán en exportación y
restauración de respaldos.

## Cálculos y validación

El modelo de certificado validará empresa, logo, NIT/DV, ciudad, ambos
capitales, accionistas, porcentaje total exacto, firmante e imagen PNG. Para
cada capital se calcularán importes con números internos y formatos
colombianos solo al presentar.

Las acciones se distribuirán mediante el método de restos mayores: se asigna
la parte entera de cada cuota y las unidades restantes se entregan en orden de
mayor fracción, usando el orden del accionista como desempate. Así la suma
siempre coincide con el total; si los porcentajes no permiten una distribución
válida, se bloqueará la exportación con un mensaje claro.

## Layout y PDF

El certificado tendrá logo contenido, título, textos legales, tablas de
Capital Suscrito y Pagado con el orden de columnas solicitado, totales,
constancia en español y firma sin línea de cédula. Un cálculo `fitToSinglePage`
medirá el contenido y aplicará una escala uniforme a tipografía, márgenes,
padding y recursos hasta caber en una página carta/A4 definida por el módulo.
El PDF se construirá siempre con una única página.

## Flujo

1. El usuario completa información accionaria desde Empresas y administra
   Firmas en Configuración.
2. Selecciona empresa y firmante en el certificado.
3. La validación habilita la vista previa.
4. La exportación recompone el modelo con la hora real y guarda un PDF con
   nombre saneado.

## Pruebas

Se cubrirán migración sin pérdida de empresas, cálculos con uno, dos y muchos
accionistas, porcentajes inválidos, distribución de enteros, texto de fecha en
español, validación de firma y garantía de una sola página.
