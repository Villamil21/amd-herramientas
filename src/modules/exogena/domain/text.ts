export const digitsOnly = (value: string) => value.replace(/\D/g, "");

/** NIT solo con dígitos y sin dígito de verificación: «901.398.069-1» → «901398069». */
export const nitDigits = (value: string) => digitsOnly(value.split("-")[0] ?? "");
