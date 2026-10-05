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
                invoice_folder: Mutex::new(None),
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
            commands::suppliers::list_suppliers,
            commands::suppliers::create_supplier,
            commands::suppliers::update_supplier,
            commands::suppliers::delete_supplier,
            commands::withholding::list_withholding_rates,
            commands::withholding::create_withholding_rate,
            commands::withholding::update_withholding_rates,
            commands::withholding::delete_withholding_rate,
            commands::withholding::count_withholding_rate_usage,
            commands::withholding::list_uvt_values,
            commands::withholding::save_uvt_value,
            commands::withholding::delete_uvt_value,
            commands::withholding::save_supplier_withholding,
            commands::withholding::create_withholding_supplier,
            commands::withholding::set_supplier_fiscal_regime,
            commands::withholding::list_document_title_mappings,
            commands::withholding::save_document_title_mappings,
            commands::withholding::update_document_title_mapping,
            commands::withholding::delete_document_title_mapping,
            commands::invoices::list_vat_document_titles,
            commands::invoices::save_vat_document_titles,
            commands::invoices::update_vat_document_title,
            commands::invoices::delete_vat_document_title,
            commands::self_withholding::list_self_withholding_rates,
            commands::self_withholding::create_self_withholding_rate,
            commands::self_withholding::update_self_withholding_rates,
            commands::self_withholding::delete_self_withholding_rate,
            commands::self_withholding::list_sales_document_types,
            commands::self_withholding::save_sales_document_types,
            commands::self_withholding::update_sales_document_type,
            commands::self_withholding::delete_sales_document_type,
            commands::dropi::list_dropi_status_mappings,
            commands::dropi::save_dropi_status_mappings,
            commands::dropi::update_dropi_status_mapping,
            commands::dropi::delete_dropi_status_mapping,
            commands::identity_documents::list_identity_document_types,
            commands::identity_documents::create_identity_document_type,
            commands::identity_documents::update_identity_document_type,
            commands::identity_documents::delete_identity_document_type,
            commands::files::pick_excel_file,
            commands::files::load_dropped_excel,
            commands::files::save_pdf,
            commands::files::save_excel,
            commands::files::open_saved_file,
            commands::statements::pick_statement_pdf,
            commands::statements::pick_report_txt,
            commands::invoices::pick_invoice_folder,
            commands::invoices::read_invoice_pdf,
            commands::backup::export_backup,
            commands::backup::pick_backup_file,
            commands::backup::apply_pending_backup,
            commands::backup::discard_pending_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicación");
}
