use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const TRAY_ID: &str = "timebook-main-tray";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayRunningItem {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayRecentTag {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TraySyncPayload {
    pub mode_label: String,
    pub running: Vec<TrayRunningItem>,
    pub recent_tags: Vec<TrayRecentTag>,
    pub widget_visible: bool,
}

pub fn truncate_label(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    let prefix: String = chars.into_iter().take(max_chars.saturating_sub(1)).collect();
    format!("{prefix}…")
}

pub fn format_tray_tooltip(payload: &TraySyncPayload) -> String {
    let mode = if payload.mode_label.trim().is_empty() {
        "单机模式"
    } else {
        payload.mode_label.trim()
    };
    if payload.running.is_empty() {
        format!("时间簿（{mode}）· 当前空闲")
    } else {
        format!("时间簿（{mode}）· {} 个专注进行中", payload.running.len())
    }
}

pub fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    payload: &TraySyncPayload,
) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    let status_text = format_tray_tooltip(payload);
    let status_item = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
    menu.append(&status_item)?;

    if !payload.running.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        for item in payload.running.iter().take(3) {
            let id = format!("stop:{}", item.id);
            let label = format!("结束：{}", truncate_label(&item.title, 22));
            let mi = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            menu.append(&mi)?;
        }
        let stop_all = MenuItem::with_id(app, "stop_all", "结束全部进行中计时", true, None::<&str>)?;
        menu.append(&stop_all)?;
    }

    if !payload.recent_tags.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        let header = MenuItem::with_id(
            app,
            "recent_header",
            "一键开始最近常用事项",
            false,
            None::<&str>,
        )?;
        menu.append(&header)?;
        for tag in payload.recent_tags.iter().take(5) {
            let id = format!("start_tag:{}", tag.id);
            let label = format!("▶ {}", truncate_label(&tag.label, 22));
            let mi = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            menu.append(&mi)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let widget_label = if payload.widget_visible {
        "隐藏悬浮小窗"
    } else {
        "显示悬浮小窗"
    };
    let toggle_widget = MenuItem::with_id(app, "toggle_widget", widget_label, true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, "show_main", "打开时间簿主窗口", true, None::<&str>)?;
    let quit_app = MenuItem::with_id(app, "quit", "彻底退出时间簿", true, None::<&str>)?;

    menu.append(&toggle_widget)?;
    menu.append(&show_main)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&quit_app)?;

    Ok(menu)
}

pub fn setup_tray<R: Runtime>(
    app: &AppHandle<R>,
    initial_payload: &TraySyncPayload,
) -> tauri::Result<TrayIcon<R>> {
    let menu = build_tray_menu(app, initial_payload)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(format_tray_tooltip(initial_payload))
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "show_main" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.unminimize();
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                "toggle_widget" => {
                    let _ = app.emit("timebook://tray-toggle-widget", ());
                }
                "stop_all" => {
                    let _ = app.emit_to(
                        "main",
                        "timebook://tray-action",
                        serde_json::json!({ "action": "stop_all" }),
                    );
                }
                "quit" => {
                    app.exit(0);
                }
                _ if id.starts_with("stop:") => {
                    let session_id = &id[5..];
                    let _ = app.emit_to(
                        "main",
                        "timebook://tray-action",
                        serde_json::json!({ "action": "stop_one", "sessionId": session_id }),
                    );
                }
                _ if id.starts_with("start_tag:") => {
                    let tag_id = &id[10..];
                    let _ = app.emit_to(
                        "main",
                        "timebook://tray-quick-start",
                        serde_json::json!({ "tagId": tag_id }),
                    );
                }
                _ => {}
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)
}

pub fn update_tray<R: Runtime>(
    app: &AppHandle<R>,
    payload: &TraySyncPayload,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let menu = build_tray_menu(app, payload).map_err(|e| format!("构建托盘菜单失败: {e}"))?;
    tray.set_menu(Some(menu))
        .map_err(|e| format!("更新托盘菜单失败: {e}"))?;
    tray.set_tooltip(Some(&format_tray_tooltip(payload)))
        .map_err(|e| format!("更新托盘提示失败: {e}"))?;
    Ok(())
}
