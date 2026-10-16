#!/usr/bin/env python3
"""Genera src-tauri/migrations/023_exogena_catalog_seed.sql a partir del Excel de códigos de la DIAN.

    python3 scripts/gen-exogena-catalog.py "/ruta/Codigos de Dptos munic y paises.xlsx"

El Excel es solo la fuente de desarrollo: la aplicación instalada usa el SQL generado (versionado en el
repositorio) y nunca lee esa ruta. Solo biblioteca estándar. Se valida que cada municipio de cinco
caracteres («76001») descomponga en un departamento existente («76») y un municipio de tres («001»).
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
CATALOG_VERSION = "2025.1"
SOURCE = "Material Exógena DIAN 2025 (Resolución Única 00227 de 2025)"

# Tipos de documento DIAN. Los de la lista confirmada para esta fase más los del formato oficial 2025.
DOCUMENT_TYPES = [
    ("11", "Registro civil de nacimiento"),
    ("12", "Tarjeta de identidad"),
    ("13", "Cédula de ciudadanía"),
    ("14", "Certificado de la Registraduría para sucesiones ilíquidas de personas sin documento"),
    ("15", "Sucesión ilíquida"),
    ("21", "Tarjeta de extranjería"),
    ("22", "Cédula de extranjería"),
    ("31", "NIT"),
    ("33", "Identificación de extranjeros diferente al NIT asignado por la DIAN"),
    ("41", "Pasaporte"),
    ("42", "Documento de identificación extranjero"),
    ("43", "Sin identificación del exterior o para uso definido por la DIAN"),
    ("44", "Documento de identificación extranjero persona jurídica"),
    ("46", "Carné diplomático"),
    ("47", "Permiso especial de permanencia (PEP)"),
    ("48", "Permiso por protección temporal (PPT)"),
]


def read_rows(path: str):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    book = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    first = book.find("m:sheets", NS)[0]
    target = rels[first.get("{%s}id" % NS["r"])].lstrip("/")
    target = target if target.startswith("xl/") else "xl/" + target
    for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
        cells = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find("m:v", NS)
            if c.get("t") == "s" and v is not None:
                cells[col] = shared[int(v.text)]
            elif c.find("m:is", NS) is not None:
                cells[col] = "".join(t.text or "" for t in c.find("m:is", NS).iter("{%s}t" % NS["m"]))
            elif v is not None:
                cells[col] = v.text
        yield int(row.get("r")), {k: v.strip() for k, v in cells.items() if v and v.strip()}


def q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main(src: str, out: str):
    departments, municipalities, countries = {}, {}, {}
    for number, c in read_rows(src):
        if number < 5:
            continue
        if "A" in c:
            departments[c["A"].zfill(2)] = c["B"]
        if "E" in c:
            municipalities[c["E"].zfill(5)] = c["D"]
        if "G" in c:
            countries[c["G"].zfill(3)] = c["H"]
    assert len(departments) == 33, len(departments)
    for code, name in municipalities.items():
        assert len(code) == 5 and code[:2] in departments, f"municipio {code} {name} sin departamento"
    assert countries["169"].upper() == "COLOMBIA"

    lines = [
        "-- 023: catálogos Exógena de sistema (generado por scripts/gen-exogena-catalog.py; no editar a mano).",
        f"-- Fuente: {SOURCE}. Versión {CATALOG_VERSION}.",
        "-- Solo inserta valores de sistema (is_system = 1): el usuario puede desactivarlos o renombrarlos, nunca eliminarlos.",
        "",
        f"INSERT OR REPLACE INTO exo_catalog_meta (key, value) VALUES ('version', {q(CATALOG_VERSION)}), ('source', {q(SOURCE)});",
        "",
    ]
    stamp = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"

    def block(table: str, columns: str, rows):
        lines.append(f"INSERT OR IGNORE INTO {table} ({columns}, is_system, is_active, updated_at) VALUES")
        body = [f"    ({', '.join(q(x) for x in row)}, 1, 1, {stamp})" for row in rows]
        lines.append(",\n".join(body) + ";")
        lines.append("")

    block("exo_document_types", "code, description", DOCUMENT_TYPES)
    block("exo_countries", "code, name", sorted(countries.items()))
    block("exo_departments", "code, name", sorted(departments.items()))
    block("exo_municipalities", "dept_code, code, name", [(code[:2], code[2:], name) for code, name in sorted(municipalities.items())])
    Path(out).write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(DOCUMENT_TYPES)} tipos, {len(countries)} países, {len(departments)} departamentos, {len(municipalities)} municipios -> {out}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    default_out = Path(__file__).resolve().parent.parent / "src-tauri" / "migrations" / "023_exogena_catalog_seed.sql"
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else str(default_out))
