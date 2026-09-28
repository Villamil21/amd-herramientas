use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::to_path;
use crate::database::{signers, Db};
use crate::error::{AppError, AppResult};
use crate::models::signer::{CertificateSigner, CertificateSignerInput};
use crate::services::logos;
use crate::state::AppState;

fn check_file(state: &AppState, v: &CertificateSignerInput) -> AppResult<()> {
    let p = logos::path_for(&state.paths.logos_dir, &v.signature_file)?;
    if !p.exists() || !v.signature_file.ends_with(".png") { return Err(AppError::user("La firma PNG seleccionada no existe.")); }
    Ok(())
}
#[tauri::command] pub fn list_certificate_signers(db:State<'_,Db>,search:Option<String>)->AppResult<Vec<CertificateSigner>> { db.with(|c| signers::list(c,search.as_deref())) }
#[tauri::command] pub fn create_certificate_signer(db:State<'_,Db>,state:State<'_,AppState>,input:CertificateSignerInput)->AppResult<CertificateSigner>{let v=input.validated()?;check_file(&state,&v)?;db.with(|c|{let id=signers::insert(c,&v)?;signers::get(c,id)})}
#[tauri::command] pub fn update_certificate_signer(db:State<'_,Db>,state:State<'_,AppState>,id:i64,input:CertificateSignerInput)->AppResult<CertificateSigner>{let v=input.validated()?;check_file(&state,&v)?;db.with(|c|{let old=signers::get(c,id)?;signers::update(c,id,&v)?;if old.signature_file != v.signature_file { logos::remove(&state.paths.logos_dir,&old.signature_file); }signers::get(c,id)})}
#[tauri::command] pub fn delete_certificate_signer(db:State<'_,Db>,state:State<'_,AppState>,id:i64)->AppResult<()> {db.with(|c|{let s=signers::delete(c,id)?;logos::remove(&state.paths.logos_dir,&s.signature_file);Ok(())})}
#[derive(Serialize)] #[serde(rename_all="camelCase")] pub struct SignatureUpload { pub signature_file:String, pub data_url:String }
#[tauri::command] pub async fn pick_certificate_signature(app:AppHandle,state:State<'_,AppState>)->AppResult<Option<SignatureUpload>> {let Some(file)=app.dialog().file().set_title("Seleccionar firma PNG").add_filter("PNG",&["png"]).blocking_pick_file() else{return Ok(None)};let name=logos::import_from_path(&state.paths.logos_dir,&to_path(file)?)?;if !name.ends_with(".png") {logos::remove(&state.paths.logos_dir,&name);return Err(AppError::user("La firma debe estar en formato PNG."));}let data_url=logos::read_data_url(&state.paths.logos_dir,&name)?.unwrap_or_default();Ok(Some(SignatureUpload{signature_file:name,data_url}))}
#[tauri::command] pub fn get_signature_data_url(state:State<'_,AppState>,signature_file:String)->AppResult<Option<String>> { logos::read_data_url(&state.paths.logos_dir,&signature_file) }
