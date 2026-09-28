mod commands;
mod database;
mod error;
mod models;
mod services;
mod startup;
mod state;

use std::sync::Mutex;

use tauri::Manager;

use crate::database::Db;
use crate::services::paths::AppPaths;
use crate::state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let paths = AppPaths::resolve(app.handle())?;
            let version = app.package_info().version.to_string();
            let (conn, startup) = startup::init(&paths, &version);
            if let Some(err) = &startup.database_error {
                eprintln!("[startup] {err}");
            }
            app.manage(Db(Mutex::new(conn)));
            app.manage(AppState {
                paths,
                startup,
                pending_backup: Mutex::new(None),
                saved_files: Mutex::new(Vec::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_startup_info,
            commands::app::get_data_location,
            commands::app::reveal_data_folder,
            commands::companies::list_companies,
            commands::companies::create_company,
            commands::companies::update_company,
            commands::companies::delete_company,
            commands::companies::pick_company_logo,
            commands::companies::get_logo_data_url,
            commands::signers::list_certificate_signers,
            commands::signers::create_certificate_signer,
            commands::signers::update_certificate_signer,
            commands::signers::delete_certificate_signer,
            commands::signers::pick_certificate_signature,
            commands::signers::get_signature_data_url,
            commands::concepts::list_concepts,
            commands::concepts::create_concept,
            commands::concepts::update_concept,
            commands::concepts::delete_concept,
            commands::files::pick_excel_file,
            commands::files::load_dropped_excel,
            commands::files::save_pdf,
            commands::files::save_excel,
            commands::files::open_saved_file,
            commands::statements::pick_statement_pdf,
            commands::backup::export_backup,
            commands::backup::pick_backup_file,
            commands::backup::apply_pending_backup,
            commands::backup::discard_pending_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicación");
}
