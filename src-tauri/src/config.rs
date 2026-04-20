use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Extension for persisted datamap files. Kept public so the frontend's file
/// picker and sanity checks can share a single source of truth.
pub const DATAMAP_EXTENSION: &str = "datamap";

#[derive(Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub storage_dir: Option<String>,
    #[serde(default)]
    pub download_dir: Option<String>,
    #[serde(default = "default_daemon_url")]
    pub daemon_url: String,
    #[serde(default)]
    pub bell_on_critical: bool,
    #[serde(default)]
    pub earnings_address: Option<String>,
    #[serde(default)]
    pub indelible_url: Option<String>,
    #[serde(default)]
    pub indelible_api_key: Option<String>,
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetaResult {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadHistoryEntry {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub cost: Option<String>,
    #[serde(default)]
    pub uploaded_at: String,
    /// Absolute path to the serialized DataMap JSON file persisted alongside
    /// this history entry. `None` for legacy entries written before datamap
    /// persistence existed.
    #[serde(default)]
    pub data_map_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UploadHistory {
    #[serde(default)]
    pub entries: Vec<UploadHistoryEntry>,
}

fn default_theme_mode() -> String {
    "dark".to_string()
}

fn default_daemon_url() -> String {
    // Try to discover the daemon port from the port file
    if let Some(url) = discover_daemon_url() {
        return url;
    }
    "http://127.0.0.1:12500".to_string()
}

/// Read the daemon port file written by `ant node daemon start`.
/// Location: %APPDATA%\ant\daemon.port (Windows), ~/.local/share/ant/daemon.port (Linux),
/// ~/Library/Application Support/ant/daemon.port (macOS).
pub fn discover_daemon_url() -> Option<String> {
    let data_dir = if cfg!(target_os = "macos") {
        dirs::home_dir()?
            .join("Library")
            .join("Application Support")
            .join("ant")
    } else if cfg!(target_os = "windows") {
        // matches ant-core: %APPDATA%\ant
        std::env::var("APPDATA")
            .ok()
            .map(PathBuf::from)?
            .join("ant")
    } else {
        dirs::data_dir()?.join("ant")
    };

    let port_file = data_dir.join("daemon.port");
    let contents = std::fs::read_to_string(&port_file).ok()?;
    let port: u16 = contents.trim().parse().ok()?;
    Some(format!("http://127.0.0.1:{port}"))
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            storage_dir: None,
            download_dir: None,
            daemon_url: default_daemon_url(),
            bell_on_critical: false,
            earnings_address: None,
            indelible_url: None,
            indelible_api_key: None,
            theme_mode: default_theme_mode(),
        }
    }
}

pub(crate) fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("autonomi")
        .join("ant-gui")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanDatamap {
    /// Absolute path to the .datamap file on disk.
    pub path: String,
    /// Basename with the `.datamap` extension stripped — the original upload's
    /// filename stem. Shown to the user to jog their memory about which file
    /// this datamap belongs to.
    pub suggested_name: String,
    /// File modification time as an ISO-8601 string (UTC). Proxy for "when
    /// you uploaded this" when the real upload timestamp is gone from history.
    pub modified_at: String,
}

/// List `.datamap` files in the app config directory that aren't referenced by
/// any entry in `known_paths`. Used by the Settings → Advanced rescue flow to
/// surface datamaps orphaned by a wiped `upload_history.json` so the user can
/// re-import them and resume downloading.
pub fn scan_orphan_datamaps(known_paths: &[String]) -> Result<Vec<OrphanDatamap>, String> {
    let dir = config_path();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let known: std::collections::HashSet<PathBuf> = known_paths
        .iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .collect();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read config dir: {e}"))?;

    let mut orphans = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some(DATAMAP_EXTENSION) {
            continue;
        }
        let canonical = match std::fs::canonicalize(&path) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if known.contains(&canonical) {
            continue;
        }

        let suggested_name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let modified_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                // Format as an ISO-8601 UTC string without pulling in chrono —
                // just enough precision for a display label.
                let secs = d.as_secs() as i64;
                let nanos = d.subsec_nanos();
                format_iso_utc(secs, nanos)
            })
            .unwrap_or_default();

        orphans.push(OrphanDatamap {
            path: canonical.to_string_lossy().into_owned(),
            suggested_name,
            modified_at,
        });
    }

    Ok(orphans)
}

/// Minimal ISO-8601 UTC formatter. Avoids a chrono dep just for a label.
fn format_iso_utc(secs: i64, nanos: u32) -> String {
    let (y, mo, d, h, mi, s) = epoch_to_ymdhms(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{:03}Z", nanos / 1_000_000)
}

/// Convert unix epoch seconds to (year, month, day, hour, minute, second)
/// in UTC. Implements the civil-from-days algorithm so we don't pull in chrono.
fn epoch_to_ymdhms(secs: i64) -> (i32, u8, u8, u8, u8, u8) {
    let days = secs.div_euclid(86_400);
    let seconds_of_day = secs.rem_euclid(86_400) as u32;
    let h = (seconds_of_day / 3600) as u8;
    let mi = ((seconds_of_day % 3600) / 60) as u8;
    let s = (seconds_of_day % 60) as u8;

    // Howard Hinnant's days_from_civil inverse.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i32) + era as i32 * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let mo = (if mp < 10 { mp + 3 } else { mp - 9 }) as u8;
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d, h, mi, s)
}

/// Resolve the OS-appropriate default downloads directory. Returns
/// `~/Downloads` on macOS/Linux and `C:\Users\<name>\Downloads` on Windows,
/// falling back to `<home>/Downloads` if the platform-specific lookup fails.
pub fn platform_default_download_dir() -> Option<PathBuf> {
    dirs::download_dir().or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
}

impl AppConfig {
    fn config_file() -> PathBuf {
        config_path().join("config.toml")
    }

    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::config_file();
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(&path)?;
        let config: AppConfig = toml::from_str(&content)?;
        Ok(config)
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let dir = config_path();
        std::fs::create_dir_all(&dir)?;
        let content = toml::to_string_pretty(self)?;
        std::fs::write(Self::config_file(), content)?;
        Ok(())
    }
}

impl UploadHistory {
    fn history_file() -> PathBuf {
        config_path().join("upload_history.json")
    }

    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::history_file();
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(&path)?;
        let history: UploadHistory = serde_json::from_str(&content)?;
        Ok(history)
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let dir = config_path();
        std::fs::create_dir_all(&dir)?;
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(Self::history_file(), content)?;
        Ok(())
    }
}

pub fn get_file_metas(paths: &[String]) -> Result<Vec<FileMetaResult>, String> {
    paths
        .iter()
        .map(|p| {
            let path = std::path::Path::new(p);
            let meta = std::fs::metadata(path).map_err(|e| format!("{p}: {e}"))?;
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            Ok(FileMetaResult {
                path: p.clone(),
                name,
                size: meta.len(),
            })
        })
        .collect()
}

/// Persist a serialized DataMap JSON string alongside `upload_history.json`.
///
/// The file is named after the upload's original basename (with its extension
/// stripped) plus `.datamap` — e.g. `test.pdf` becomes `test.datamap`. When a
/// file of that name already exists, a numeric suffix is appended so we never
/// overwrite a prior datamap: `test (2).datamap`, `test (3).datamap`, …
///
/// Returns the absolute path to the written file.
pub fn write_datamap_for(original_name: &str, json: &str) -> Result<PathBuf, String> {
    let stem = sanitize_stem(original_name);
    let dir = config_path();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {e}"))?;

    // Cap the number of collision attempts at a generous-but-finite limit so a
    // pathological state (e.g. thousands of collisions) yields an error rather
    // than an infinite loop.
    const MAX_COLLISION_ATTEMPTS: u32 = 10_000;
    for attempt in 0..MAX_COLLISION_ATTEMPTS {
        let file_name = if attempt == 0 {
            format!("{stem}.{DATAMAP_EXTENSION}")
        } else {
            format!("{stem} ({}).{DATAMAP_EXTENSION}", attempt + 1)
        };
        let path = dir.join(&file_name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut f) => {
                f.write_all(json.as_bytes())
                    .map_err(|e| format!("Failed to write datamap: {e}"))?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Failed to create datamap file: {e}")),
        }
    }
    Err("Unable to reserve a datamap filename after many attempts".into())
}

/// Reduce an arbitrary upload filename to a safe datamap filename stem: drop
/// the final extension, replace characters that are awkward on disk across
/// platforms with `_`, and fall back to "datamap" if the result is empty.
fn sanitize_stem(original_name: &str) -> String {
    let raw = Path::new(original_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '(' | ')') {
                c
            } else {
                '_'
            }
        })
        .collect();

    let trimmed = cleaned
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();

    if trimmed.is_empty() {
        "datamap".to_string()
    } else {
        trimmed
    }
}
