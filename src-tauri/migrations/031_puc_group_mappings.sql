-- 031: Clasificación de PUC por grupo de cuatro dígitos. Solo adiciones.
--
-- La clasificación en Estados Financieros se decide por los primeros cuatro dígitos del PUC (2370 cubre 237005, 237006,
-- 237010…). `origin` conserva de dónde viene cada decisión: 'manual' (una cuenta puntual, flujo anterior), 'group'
-- (clasificación del grupo de cuatro dígitos) o 'consolidated:AAAA' (una clasificación antigua de seis dígitos que se
-- reemplazó al resolver el grupo AAAA; la fila antigua queda solo en el historial).

ALTER TABLE fs_puc_mappings ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE fs_puc_mapping_history ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
