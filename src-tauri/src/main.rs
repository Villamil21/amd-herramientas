// Evita una consola adicional en builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    amd_herramientas_lib::run()
}
