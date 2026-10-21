/** NIT con su dígito de verificación: «890.903.938-8». */
export function formatNitDv(nit: string, dv: string): string {
  return `${nit.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}
