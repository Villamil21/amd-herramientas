-- Alias persistentes de tipos de documento de identificación: otra denominación con la que llega el tipo de documento en una
-- factura (CC, C.C., Cédula de ciudadanía, PPT…) y el código Exógena al que equivale. Tabla propia porque `exo_aliases` limita sus
-- tipos; la clave es la denominación en mayúsculas, sin tildes ni signos ni espacios. Se siembran las denominaciones habituales
-- como alias editables y eliminables.
CREATE TABLE IF NOT EXISTS exo_document_type_aliases (
    alias_key   TEXT NOT NULL PRIMARY KEY CHECK (alias_key <> ''),
    alias       TEXT NOT NULL,
    target      TEXT NOT NULL CHECK (target <> ''),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO exo_document_type_aliases (alias_key, alias, target, created_at, updated_at)
SELECT column1, column2, column3, '2026-10-17T00:00:00Z', '2026-10-17T00:00:00Z' FROM (VALUES
    ('CC', 'CC', '13'),
    ('CEDULA', 'CEDULA', '13'),
    ('CEDULADECIUDADANIA', 'CEDULA DE CIUDADANIA', '13'),
    ('CEDULACIUDADANIA', 'CEDULA CIUDADANIA', '13'),
    ('CEDCIUDADANIA', 'CED. CIUDADANIA', '13'),
    ('CEDULADECIUDADANIACOLOMBIANA', 'CEDULA DE CIUDADANIA COLOMBIANA', '13'),
    ('CE', 'CE', '22'),
    ('CEDULADEEXTRANJERIA', 'CEDULA DE EXTRANJERIA', '22'),
    ('CEDULAEXTRANJERIA', 'CEDULA EXTRANJERIA', '22'),
    ('CEDEXTRANJERIA', 'CED. EXTRANJERIA', '22'),
    ('TE', 'TE', '21'),
    ('TARJETADEEXTRANJERIA', 'TARJETA DE EXTRANJERIA', '21'),
    ('TARJETAEXTRANJERIA', 'TARJETA EXTRANJERIA', '21'),
    ('TI', 'TI', '12'),
    ('TARJETADEIDENTIDAD', 'TARJETA DE IDENTIDAD', '12'),
    ('TARJETAIDENTIDAD', 'TARJETA IDENTIDAD', '12'),
    ('RC', 'RC', '11'),
    ('REGISTROCIVIL', 'REGISTRO CIVIL', '11'),
    ('REGISTROCIVILDENACIMIENTO', 'REGISTRO CIVIL DE NACIMIENTO', '11'),
    ('NIT', 'NIT', '31'),
    ('NUMERODEIDENTIFICACIONTRIBUTARIA', 'NUMERO DE IDENTIFICACION TRIBUTARIA', '31'),
    ('NUMEROIDENTIFICACIONTRIBUTARIA', 'NUMERO IDENTIFICACION TRIBUTARIA', '31'),
    ('PA', 'PA', '41'),
    ('PASAPORTE', 'PASAPORTE', '41'),
    ('PASSPORT', 'PASSPORT', '41'),
    ('DIE', 'DIE', '42'),
    ('DOCUMENTODEIDENTIFICACIONEXTRANJERO', 'DOCUMENTO DE IDENTIFICACION EXTRANJERO', '42'),
    ('DOCUMENTOIDENTIFICACIONEXTRANJERO', 'DOCUMENTO IDENTIFICACION EXTRANJERO', '42'),
    ('PEP', 'PEP', '47'),
    ('PERMISOESPECIALDEPERMANENCIA', 'PERMISO ESPECIAL DE PERMANENCIA', '47'),
    ('PPT', 'PPT', '48'),
    ('PERMISOPORPROTECCIONTEMPORAL', 'PERMISO POR PROTECCION TEMPORAL', '48'),
    ('PERMISODEPROTECCIONTEMPORAL', 'PERMISO DE PROTECCION TEMPORAL', '48'),
    ('CARNEDIPLOMATICO', 'CARNE DIPLOMATICO', '46'),
    ('CD', 'CD', '46'),
    ('SUCESIONILIQUIDA', 'SUCESION ILIQUIDA', '15')
);
