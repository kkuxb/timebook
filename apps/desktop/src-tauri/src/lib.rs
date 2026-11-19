pub mod storage;
pub mod tray;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::storage::{
    ensure_daily_local_backup, is_isolated_mode, now_millis, read_desktop_config,
    read_local_snapshot, resolve_data_dir, resolve_default_backup_dir, run_local_backup,
    shanghai_today_str, write_desktop_config, write_local_snapshot, DesktopConfig,
    WidgetPosition, MAX_BACKUP_KEEP,
};
use crate::tray::{setup_tray, update_tray, TraySyncPayload};

pub struct DesktopState {
    pub data_dir: PathBuf,
    pub is_isolated: bool,
    pub config: Mutex<DesktopConfig>,
    pub registered_shortcut: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitStateResponse {
    pub config: DesktopConfig,
    pub snapshot: Option<Value>,
    pub data_dir: String,
    pub is_isolated: bool,
    pub today_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSnapshotResponse {
    pub saved_at: u64,
    pub last_local_backup_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResultResponse {
    pub path: String,
    pub date: String,
    pub saved_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastPayload {
    pub revision: u64,
    pub source_window: String,
}

fn show_and_focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn show_launcher(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("launcher") {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit_to("launcher", "timebook://launcher-opened", ());
    }
}

fn parse_shortcut(raw: &str) -> Result<Shortcut, String> {
    raw.trim()
        .parse::<Shortcut>()
        .map_err(|_| format!("快捷键格式无效：{raw}（示例：CommandOrControl+Alt+T）"))
}

fn apply_shortcut(
    app: &AppHandle,
    old_shortcut: Option<&str>,
    new_shortcut: &str,
) -> Result<(), String> {
    let trimmed = new_shortcut.trim();
    if trimmed.is_empty() {
        return Err("全局快捷键不能为空".to_string());
    }
    let parsed_new = parse_shortcut(trimmed)?;
    let gs = app.global_shortcut();

    if let Some(old) = old_shortcut {
        if old.eq_ignore_ascii_case(trimmed) && gs.is_registered(parsed_new) {
            return Ok(());
        }
        if let Ok(parsed_old) = parse_shortcut(old) {
            let _ = gs.unregister(parsed_old);
        }
    }

    if let Err(err) = gs.register(parsed_new) {
        // 尝试恢复旧快捷键，避免彻底无快捷键
        if let Some(old) = old_shortcut {
            if let Ok(parsed_old) = parse_shortcut(old) {
                let _ = gs.register(parsed_old);
            }
        }
        return Err(format!("全局快捷键「{trimmed}」可能已被其他程序占用：{err}"));
    }
    Ok(())
}

fn sync_autostart_os(app: &AppHandle, enabled: bool, is_isolated: bool) {
    if is_isolated {
        return;
    }
    let manager = app.autolaunch();
    if enabled {
        let _ = manager.enable();
    } else {
        let _ = manager.disable();
    }
}

#[tauri::command]
fn desktop_get_init_state(state: tauri::State<'_, DesktopState>) -> Result<InitStateResponse, String> {
    let cfg = state
        .config
        .lock()
        .map_err(|_| "读取桌面配置锁失败".to_string())?
        .clone();
    let snapshot = read_local_snapshot(&state.data_dir)?;
    Ok(InitStateResponse {
        config: cfg,
        snapshot,
        data_dir: state.data_dir.to_string_lossy().to_string(),
        is_isolated: state.is_isolated,
        today_date: shanghai_today_str(),
    })
}

#[tauri::command]
fn desktop_save_snapshot(
    state: tauri::State<'_, DesktopState>,
    snapshot: Value,
) -> Result<SaveSnapshotResponse, String> {
    write_local_snapshot(&state.data_dir, &snapshot)?;
    let today = shanghai_today_str();
    let mut cfg = state
        .config
        .lock()
        .map_err(|_| "更新桌面配置锁失败".to_string())?;
    let backup_dir = PathBuf::from(&cfg.backup_dir);
    if run_local_backup(&state.data_dir, &backup_dir, &today, MAX_BACKUP_KEEP).is_ok() {
        if cfg.last_local_backup_date.as_deref() != Some(&today) {
            cfg.last_local_backup_date = Some(today);
            let _ = write_desktop_config(&state.data_dir, &cfg);
        }
    }
    Ok(SaveSnapshotResponse {
        saved_at: now_millis(),
        last_local_backup_date: cfg.last_local_backup_date.clone(),
    })
}

#[tauri::command]
fn desktop_save_config(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    mut config: DesktopConfig,
) -> Result<DesktopConfig, String> {
    let prev_cfg = state
        .config
        .lock()
        .map_err(|_| "读取桌面配置锁失败".to_string())?
        .clone();

    if config.backup_dir.trim().is_empty() {
        config.backup_dir = prev_cfg.backup_dir.clone();
    }
    if config.global_shortcut.trim().is_empty() {
        config.global_shortcut = prev_cfg.global_shortcut.clone();
    }

    // 处理全局快捷键更新
    let old_shortcut = state
        .registered_shortcut
        .lock()
        .map_err(|_| "快捷键锁失败".to_string())?
        .clone();

    if old_shortcut.as_deref() != Some(config.global_shortcut.as_str()) {
        apply_shortcut(&app, old_shortcut.as_deref(), &config.global_shortcut)?;
        if let Ok(mut guard) = state.registered_shortcut.lock() {
            *guard = Some(config.global_shortcut.clone());
        }
    }

    // 处理开机自启（隔离模式下不改宿主机注册表）
    if prev_cfg.autostart != config.autostart {
        sync_autostart_os(&app, config.autostart, state.is_isolated);
    }

    // 处理悬浮小窗显隐
    if prev_cfg.widget_visible != config.widget_visible {
        if let Some(win) = app.get_webview_window("widget") {
            if config.widget_visible {
                let _ = win.show();
            } else {
                let _ = win.hide();
            }
        }
    }

    write_desktop_config(&state.data_dir, &config)?;
    if let Ok(mut guard) = state.config.lock() {
        *guard = config.clone();
    }

    let _ = app.emit("timebook://config-updated", &config);
    Ok(config)
}

#[tauri::command]
fn desktop_run_local_backup(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> Result<BackupResultResponse, String> {
    let today = shanghai_today_str();
    let mut cfg = state
        .config
        .lock()
        .map_err(|_| "备份配置锁失败".to_string())?;
    let backup_dir = PathBuf::from(&cfg.backup_dir);
    let path = run_local_backup(&state.data_dir, &backup_dir, &today, MAX_BACKUP_KEEP)?;
    cfg.last_local_backup_date = Some(today.clone());
    write_desktop_config(&state.data_dir, &cfg)?;
    let _ = app.emit("timebook://config-updated", &*cfg);
    Ok(BackupResultResponse {
        path: path.to_string_lossy().to_string(),
        date: today,
        saved_at: now_millis(),
    })
}

#[tauri::command]
fn desktop_set_widget_expanded(app: AppHandle, expanded: bool, count: usize) -> Result<(), String> {
    let Some(win) = app.get_webview_window("widget") else {
        return Ok(());
    };
    let (width, height) = if expanded {
        let rows = count.max(1).min(4) as f64;
        (336.0, 96.0 + rows * 44.0)
    } else {
        (284.0, 52.0)
    };
    win.set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|e| format!("调整小窗尺寸失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn desktop_set_widget_visibility(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(win) = app.get_webview_window("widget") else {
        return Ok(());
    };
    if visible {
        let _ = win.show();
    } else {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
fn desktop_sync_tray(app: AppHandle, payload: TraySyncPayload) -> Result<(), String> {
    update_tray(&app, &payload)
}

#[tauri::command]
fn desktop_broadcast_state(app: AppHandle, payload: Value) -> Result<(), String> {
    app.emit("timebook://state-updated", payload)
        .map_err(|e| format!("广播桌面状态失败: {e}"))
}

#[tauri::command]
fn desktop_window_action(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    action: String,
) -> Result<(), String> {
    match action.as_str() {
        "minimizeMain" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.minimize();
            }
        }
        "closeMain" => {
            let close_to_tray = state
                .config
                .lock()
                .map(|c| c.close_to_tray)
                .unwrap_or(true);
            if close_to_tray {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            } else {
                app.exit(0);
            }
        }
        "showMain" => {
            show_and_focus_main(&app);
        }
        "toggleWidget" => {
            let mut cfg = state
                .config
                .lock()
                .map_err(|_| "配置锁失败".to_string())?;
            cfg.widget_visible = !cfg.widget_visible;
            let visible = cfg.widget_visible;
            let _ = write_desktop_config(&state.data_dir, &cfg);
            if let Some(win) = app.get_webview_window("widget") {
                if visible {
                    let _ = win.show();
                } else {
                    let _ = win.hide();
                }
            }
            let _ = app.emit("timebook://config-updated", &*cfg);
        }
        "showWidget" => {
            if let Some(win) = app.get_webview_window("widget") {
                let _ = win.show();
            }
        }
        "hideWidget" => {
            if let Some(win) = app.get_webview_window("widget") {
                let _ = win.hide();
            }
        }
        "showLauncher" => {
            show_launcher(&app);
        }
        "hideLauncher" => {
            if let Some(win) = app.get_webview_window("launcher") {
                let _ = win.hide();
            }
        }
        "quitApp" => {
            app.exit(0);
        }
        other => return Err(format!("未知窗口动作: {other}")),
    }
    Ok(())
}

pub fn run() {
    let start_minimized = std::env::args().any(|a| a == "--minimized");

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_launcher(app);
                    }
                })
                .build(),
        )
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = webview.eval(
                    r#"
                    (async function () {
                      try {
                        if (location.hostname !== 'tauri.localhost') return;
                        var hadCtrl = Boolean(navigator.serviceWorker && navigator.serviceWorker.controller);
                        var hadRegs = false;
                        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                          var regs = await navigator.serviceWorker.getRegistrations();
                          hadRegs = regs.length > 0;
                          await Promise.all(regs.map(function (r) { return r.unregister(); }));
                        }
                        if (typeof caches !== 'undefined' && caches.keys) {
                          var keys = await caches.keys();
                          await Promise.all(keys.map(function (k) { return caches.delete(k); }));
                        }
                        if ((hadCtrl || hadRegs) && !sessionStorage.getItem('tb_sw_purged')) {
                          sessionStorage.setItem('tb_sw_purged', '1');
                          location.reload();
                        }
                      } catch (_) {}
                    })();
                    "#,
                );
            }
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let isolated = is_isolated_mode();
            let app_data = app.path().app_data_dir().ok();
            let docs_dir = app.path().document_dir().ok();
            let data_dir = resolve_data_dir(app_data);
            let default_backup = resolve_default_backup_dir(&data_dir, docs_dir);

            let config = read_desktop_config(&data_dir, &default_backup);
            let _ = write_desktop_config(&data_dir, &config);

            // 必须第一时间注册 DesktopState，防止已启动的 WebView 抢跑调用 desktop_get_init_state 失败
            app.manage(DesktopState {
                data_dir: data_dir.clone(),
                is_isolated: isolated,
                config: Mutex::new(config.clone()),
                registered_shortcut: Mutex::new(None),
            });

            // 启动时自动确保当天本地备份快照
            let today = shanghai_today_str();
            {
                let state = app.state::<DesktopState>();
                if let Ok(mut cfg_guard) = state.config.lock() {
                    let _ = ensure_daily_local_backup(&data_dir, &mut cfg_guard, &today);
                };
            }

            // 初始化系统托盘
            let initial_tray = TraySyncPayload {
                mode_label: if config.connection_mode == "nas" {
                    "NAS 同步".to_string()
                } else {
                    "单机模式".to_string()
                },
                running: vec![],
                recent_tags: vec![],
                widget_visible: config.widget_visible,
            };
            let _ = setup_tray(&app_handle, &initial_tray);

            // 注册全局快捷键（如失败不崩溃）
            if let Ok(()) = apply_shortcut(&app_handle, None, &config.global_shortcut) {
                let state = app.state::<DesktopState>();
                if let Ok(mut guard) = state.registered_shortcut.lock() {
                    *guard = Some(config.global_shortcut.clone());
                };
            }

            // 恢复悬浮小窗位置
            if let Some(widget_win) = app.get_webview_window("widget") {
                if let Some(pos) = &config.widget_position {
                    let _ = widget_win.set_position(PhysicalPosition::new(pos.x, pos.y));
                }
            }

            // 若非 --minimized 静默启动，展示主窗口（及悬浮小窗）
            if !start_minimized {
                show_and_focus_main(&app_handle);
                if config.widget_visible && !config.auto_hide_widget_when_idle {
                    if let Some(widget_win) = app.get_webview_window("widget") {
                        let _ = widget_win.show();
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if label == "main" {
                        let close_to_tray = window
                            .try_state::<DesktopState>()
                            .and_then(|s| s.config.lock().ok().map(|c| c.close_to_tray))
                            .unwrap_or(true);
                        if close_to_tray {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    } else if label == "widget" || label == "launcher" {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                WindowEvent::Moved(pos) => {
                    if label == "widget" && pos.x > -10000 && pos.y > -10000 {
                        let Some(state) = window.try_state::<DesktopState>() else {
                            return;
                        };
                        let data_dir = state.data_dir.clone();
                        let updated_cfg = if let Ok(mut cfg) = state.config.lock() {
                            cfg.widget_position = Some(WidgetPosition { x: pos.x, y: pos.y });
                            Some(cfg.clone())
                        } else {
                            None
                        };
                        if let Some(cfg) = updated_cfg {
                            let _ = write_desktop_config(&data_dir, &cfg);
                        }
                    }
                }
                WindowEvent::Focused(false) => {
                    if label == "launcher" {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_get_init_state,
            desktop_save_snapshot,
            desktop_save_config,
            desktop_run_local_backup,
            desktop_set_widget_expanded,
            desktop_set_widget_visibility,
            desktop_sync_tray,
            desktop_broadcast_state,
            desktop_window_action,
        ])
        .run(tauri::generate_context!())
        .expect("运行时间簿桌面端失败");
}

#[cfg(test)]
mod tests {
    use super::storage::*;
    use super::tray::*;
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{prefix}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_shanghai_date_boundaries() {
        // 2026-11-18 16:00:00 UTC == 2026-11-19 00:00:00 +08:00
        let ts_midnight_bj = 1_795_017_600;
        assert_eq!(timestamp_to_shanghai_date(ts_midnight_bj), "2026-11-19");
        assert_eq!(timestamp_to_shanghai_date(ts_midnight_bj - 1), "2026-11-18");
    }

    #[test]
    fn test_atomic_snapshot_and_config_roundtrip() {
        let dir = make_temp_dir("tb-rust-snap");
        let default_bk = dir.join("backups");

        let cfg = read_desktop_config(&dir, &default_bk);
        assert_eq!(cfg.connection_mode, "local");
        assert_eq!(cfg.widget_skin, "light");
        assert_eq!(cfg.global_shortcut, DEFAULT_SHORTCUT);
        assert!(cfg.close_to_tray);
        assert!(!cfg.autostart);

        let snap = json!({
            "version": 1,
            "savedAt": 1700000000000u64,
            "modules": [{ "id": "m1", "name": "工作" }],
            "tags": [],
            "sessions": [],
            "todos": [],
            "todoChecks": []
        });
        write_local_snapshot(&dir, &snap).unwrap();
        let loaded = read_local_snapshot(&dir).unwrap().unwrap();
        assert_eq!(loaded["modules"][0]["name"], "工作");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_backup_rotation_keeps_latest_30() {
        let dir = make_temp_dir("tb-rust-bk");
        let backup_dir = dir.join("backups");
        fs::create_dir_all(&backup_dir).unwrap();

        let snap = json!({ "version": 1, "savedAt": 1, "modules": [] });
        write_local_snapshot(&dir, &snap).unwrap();

        // 预先生成 34 个旧日期备份
        for day in 1..=34 {
            let fname = format!("timebook-local-2026-10-{day:02}.json");
            fs::write(backup_dir.join(fname), b"{}").unwrap();
        }

        let created = run_local_backup(&dir, &backup_dir, "2026-11-19", 30).unwrap();
        assert!(created.exists());

        let mut remaining: Vec<String> = fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        remaining.sort();

        assert_eq!(remaining.len(), 30);
        assert_eq!(remaining.last().unwrap(), "timebook-local-2026-11-19.json");
        // 最早的 2026-10-01 ~ 2026-10-05（5个）应已被轮转清理
        assert!(!remaining.contains(&"timebook-local-2026-10-01.json".to_string()));
        assert!(!remaining.contains(&"timebook-local-2026-10-05.json".to_string()));
        assert!(remaining.contains(&"timebook-local-2026-10-06.json".to_string()));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_tray_formatting() {
        let empty = TraySyncPayload {
            mode_label: "单机模式".to_string(),
            running: vec![],
            recent_tags: vec![],
            widget_visible: true,
        };
        assert_eq!(format_tray_tooltip(&empty), "时间簿（单机模式）· 当前空闲");

        let busy = TraySyncPayload {
            mode_label: "NAS 同步".to_string(),
            running: vec![
                TrayRunningItem {
                    id: "s1".to_string(),
                    title: "核心开发".to_string(),
                },
                TrayRunningItem {
                    id: "s2".to_string(),
                    title: "文档梳理".to_string(),
                },
            ],
            recent_tags: vec![],
            widget_visible: false,
        };
        assert_eq!(format_tray_tooltip(&busy), "时间簿（NAS 同步）· 2 个专注进行中");
        assert_eq!(truncate_label("这是一个超长的事项标题名称", 6), "这是一个超…");
    }
}
