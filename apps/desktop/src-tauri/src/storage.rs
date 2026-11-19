use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SNAPSHOT_FILENAME: &str = "timebook-local.json";
pub const CONFIG_FILENAME: &str = "desktop-config.json";
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Alt+T";
pub const MAX_BACKUP_KEEP: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopConfig {
    pub connection_mode: String,
    pub server_url: String,
    pub session_token: String,
    pub backup_dir: String,
    pub last_local_backup_date: Option<String>,
    pub widget_visible: bool,
    pub auto_hide_widget_when_idle: bool,
    pub widget_skin: String,
    pub widget_position: Option<WidgetPosition>,
    pub close_to_tray: bool,
    pub autostart: bool,
    pub global_shortcut: String,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            connection_mode: "local".to_string(),
            server_url: String::new(),
            session_token: String::new(),
            backup_dir: String::new(),
            last_local_backup_date: None,
            widget_visible: true,
            auto_hide_widget_when_idle: false,
            widget_skin: "light".to_string(),
            widget_position: None,
            close_to_tray: true,
            autostart: false,
            global_shortcut: DEFAULT_SHORTCUT.to_string(),
        }
    }
}

/// 判断当前是否处于环境变量隔离测试模式（不触碰真实系统文档目录与注册表）
pub fn is_isolated_mode() -> bool {
    std::env::var("TIMEBOOK_DESKTOP_DATA_DIR")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// 解析桌面数据目录：优先使用 TIMEBOOK_DESKTOP_DATA_DIR，否则使用系统应用数据目录
pub fn resolve_data_dir(app_data_dir: Option<PathBuf>) -> PathBuf {
    if let Ok(custom) = std::env::var("TIMEBOOK_DESKTOP_DATA_DIR") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    app_data_dir.unwrap_or_else(|| std::env::temp_dir().join("com.timebook.desktop"))
}

/// 解析默认本地备份目录
pub fn resolve_default_backup_dir(data_dir: &Path, user_docs_dir: Option<PathBuf>) -> PathBuf {
    if is_isolated_mode() {
        return data_dir.join("backups");
    }
    user_docs_dir
        .unwrap_or_else(|| data_dir.to_path_buf())
        .join("TimebookBackups")
}

/// 原子写入文件：先写入同目录临时文件，再替换目标文件
pub fn atomic_write_bytes(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let tmp_name = format!(
        "{}.tmp",
        target
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("timebook")
    );
    let tmp_path = target.with_file_name(tmp_name);
    fs::write(&tmp_path, bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;
    if let Err(err) = fs::rename(&tmp_path, target) {
        // Windows 偶发目标被只读或短暂句柄锁定时回退为删除后重命名
        let _ = fs::remove_file(target);
        fs::rename(&tmp_path, target).map_err(|e2| format!("原子替换文件失败: {err}; {e2}"))?;
    }
    Ok(())
}

/// 将 Unix 秒时间戳转为北京时间（UTC+8）自然日 YYYY-MM-DD
pub fn timestamp_to_shanghai_date(unix_secs: i64) -> String {
    let shanghai_secs = unix_secs + 8 * 3600;
    let days = shanghai_secs.div_euclid(86_400);
    // Howard Hinnant civil_from_days 算法
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    format!("{year:04}-{m:02}-{d:02}")
}

pub fn shanghai_today_str() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    timestamp_to_shanghai_date(secs)
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read_local_snapshot(data_dir: &Path) -> Result<Option<Value>, String> {
    let path = data_dir.join(SNAPSHOT_FILENAME);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取本地快照失败: {e}"))?;
    let val: Value = serde_json::from_str(&raw).map_err(|e| format!("解析本地快照失败: {e}"))?;
    Ok(Some(val))
}

pub fn write_local_snapshot(data_dir: &Path, snapshot: &Value) -> Result<(), String> {
    if !snapshot.is_object() {
        return Err("本地快照必须是 JSON 对象".to_string());
    }
    let bytes = serde_json::to_vec_pretty(snapshot).map_err(|e| format!("序列化快照失败: {e}"))?;
    atomic_write_bytes(&data_dir.join(SNAPSHOT_FILENAME), &bytes)
}

pub fn read_desktop_config(data_dir: &Path, default_backup: &Path) -> DesktopConfig {
    let path = data_dir.join(CONFIG_FILENAME);
    let mut cfg = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<DesktopConfig>(&s).ok())
            .unwrap_or_default()
    } else {
        DesktopConfig::default()
    };

    if cfg.backup_dir.trim().is_empty() {
        cfg.backup_dir = default_backup.to_string_lossy().to_string();
    }
    if cfg.global_shortcut.trim().is_empty() {
        cfg.global_shortcut = DEFAULT_SHORTCUT.to_string();
    }
    if cfg.connection_mode != "local" && cfg.connection_mode != "nas" {
        cfg.connection_mode = "local".to_string();
    }
    if cfg.widget_skin != "light" && cfg.widget_skin != "dark" {
        cfg.widget_skin = "light".to_string();
    }
    cfg
}

pub fn write_desktop_config(data_dir: &Path, config: &DesktopConfig) -> Result<(), String> {
    let bytes =
        serde_json::to_vec_pretty(config).map_err(|e| format!("序列化桌面配置失败: {e}"))?;
    atomic_write_bytes(&data_dir.join(CONFIG_FILENAME), &bytes)
}

/// 生成每日本地备份文件（timebook-local-YYYY-MM-DD.json），并按文件名轮转保留最近 max_keep 份
pub fn run_local_backup(
    data_dir: &Path,
    backup_dir: &Path,
    date_str: &str,
    max_keep: usize,
) -> Result<PathBuf, String> {
    let snapshot_path = data_dir.join(SNAPSHOT_FILENAME);
    let payload_bytes = if snapshot_path.exists() {
        fs::read(&snapshot_path).map_err(|e| format!("读取本地快照失败: {e}"))?
    } else {
        let empty = serde_json::json!({
            "version": 1,
            "savedAt": now_millis(),
            "modules": [],
            "tags": [],
            "sessions": [],
            "todos": [],
            "todoChecks": []
        });
        serde_json::to_vec_pretty(&empty).map_err(|e| format!("构造默认快照失败: {e}"))?
    };

    fs::create_dir_all(backup_dir).map_err(|e| format!("创建备份目录失败: {e}"))?;
    let target = backup_dir.join(format!("timebook-local-{date_str}.json"));
    atomic_write_bytes(&target, &payload_bytes)?;

    // 轮转清理超出数量的历史备份
    if max_keep > 0 {
        if let Ok(entries) = fs::read_dir(backup_dir) {
            let mut backup_files: Vec<(String, PathBuf)> = entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with("timebook-local-") && name.ends_with(".json") {
                        Some((name, e.path()))
                    } else {
                        None
                    }
                })
                .collect();
            backup_files.sort_by(|a, b| b.0.cmp(&a.0));
            for (_, old_path) in backup_files.into_iter().skip(max_keep) {
                let _ = fs::remove_file(old_path);
            }
        }
    }

    Ok(target)
}

pub fn ensure_daily_local_backup(
    data_dir: &Path,
    config: &mut DesktopConfig,
    today_str: &str,
) -> Result<Option<PathBuf>, String> {
    let backup_dir = PathBuf::from(&config.backup_dir);
    let expected_file = backup_dir.join(format!("timebook-local-{today_str}.json"));
    if config.last_local_backup_date.as_deref() == Some(today_str) && expected_file.exists() {
        return Ok(None);
    }
    let created = run_local_backup(data_dir, &backup_dir, today_str, MAX_BACKUP_KEEP)?;
    config.last_local_backup_date = Some(today_str.to_string());
    write_desktop_config(data_dir, config)?;
    Ok(Some(created))
}
