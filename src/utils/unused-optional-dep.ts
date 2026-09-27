// jsPDF importa html2canvas, canvg y dompurify solo para doc.html() y SVG,
// funciones que la app no usa. Se reemplazan por este módulo vacío (vite.config.ts)
// para no empaquetar ~380 KB innecesarios.
export default {};
