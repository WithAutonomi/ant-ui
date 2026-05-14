use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
    /// Max concurrent quote/upload operations. Defaults to 1 — testing shows
    /// concurrent uploads slow down non-linearly (2 files ≠ 2× time, often
    /// 4–12× on real networks), so serial is the safe default. Power users
    /// can tune up to 8 via Settings → Advanced.
    #[serde(default = "default_upload_concurrency")]
    pub upload_concurrency: u32,
    /// Opt-in to pre-release auto-updates (rc / beta builds). Off by default;
    /// internal-tester convenience. The endpoint URL is resolved once at app
    /// init from this flag, so toggling requires an app restart to take effect.
    #[serde(default)]
    pub prerelease_channel: bool,
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
    /// Pre-formatted ETH gas cost for the upload's payment tx(s). `None` for
    /// legacy entries written before gas was tracked, or for already-stored
    /// uploads where no payment tx ran.
    #[serde(default)]
    pub gas_cost: Option<String>,
    /// On-network chunk address of the published `DataMap` for public
    /// uploads. `None` for private uploads and for legacy entries.
    #[serde(default)]
    pub public_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UploadHistory {
    #[serde(default)]
    pub entries: Vec<UploadHistoryEntry>,
}

fn default_theme_mode() -> String {
    "dark".to_string()
}

fn default_upload_concurrency() -> u32 {
    1
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
            upload_concurrency: default_upload_concurrency(),
            prerelease_channel: false,
        }
    }
}

pub(crate) fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("autonomi")
        .join("ant-gui")
}

/// User-addressable directory for persisted datamap files on **fresh
/// installs**. Lives under `~/Documents/Autonomi/Datamaps/` (or the
/// platform equivalent of Documents) so the OS file picker can navigate
/// to them — fixes the macOS gap where `~/Library` is hidden by default
/// in NSOpenPanel.
///
/// Existing installs keep writing into `config_path()` via
/// `resolve_datamap_output_dir()` so the upgrade does not split their
/// datamaps across two locations. Only callers that need the "where do
/// new writes go" answer should use `resolve_datamap_output_dir()`;
/// this function is the new-install default.
///
/// Falls back to `<home>/Documents/Autonomi/Datamaps` if `dirs::document_dir`
/// can't resolve the platform path (very unusual), and to `./Autonomi/Datamaps`
/// only if even `dirs::home_dir` fails (effectively a no-home embedded env).
pub fn datamap_dir() -> PathBuf {
    dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Autonomi")
        .join("Datamaps")
}

/// Decide where the *next* datamap write should land. Existing installs
/// (those whose `config_path()` already contains one or more `.datamap`
/// files) keep writing into the legacy location so a single user does not
/// end up with their datamaps scattered across two directories after the
/// upgrade. Fresh installs go to `datamap_dir()` so the OS file picker can
/// reach them.
///
/// Detection is stateless: on every write, we look at the legacy dir's
/// current contents. After the first new-install write the rule continues
/// to return `datamap_dir()` because the legacy dir never gains a
/// `.datamap` file. After the first existing-install write the rule
/// continues to return `config_path()` because the legacy dir still has
/// the original `.datamap` files alongside the new one.
fn resolve_datamap_output_dir() -> PathBuf {
    let legacy = config_path();
    let has_legacy_datamaps = legacy
        .read_dir()
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|entry| entry.path().extension().and_then(|s| s.to_str()) == Some("datamap"))
        })
        .unwrap_or(false);
    if has_legacy_datamaps {
        legacy
    } else {
        datamap_dir()
    }
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
        // Write to a tempfile alongside the target then rename. A crash or
        // short write that hits the tempfile leaves the live history file
        // intact — `std::fs::write` would truncate it before failing, and
        // every prior upload's datamap on disk would lose its index entry.
        let final_path = Self::history_file();
        let tmp_path = dir.join("upload_history.json.tmp");
        std::fs::write(&tmp_path, content)?;
        std::fs::rename(&tmp_path, &final_path)?;
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

/// Persist a serialized DataMap in the user-addressable datamap directory
/// (`~/Documents/Autonomi/Datamaps/` on fresh installs, the legacy config
/// dir on existing installs — see `resolve_datamap_output_dir`). The file
/// is named after the upload's original basename with `.datamap` appended,
/// preserving the original extension (e.g. `holiday.jpg` →
/// `holiday.jpg.datamap`). On collision the upstream `NumericSuffix` policy
/// inserts `-N` between the basename and `.datamap`.
///
/// Returns the absolute path to the written file.
///
/// Format is the canonical msgpack produced by `ant_core::data::write_datamap`,
/// so ant-cli, ant-tui, and any other consumer of the upstream module reads
/// back the same on-disk bytes. The read side (`autonomi_ops::read_datamap_file`)
/// still accepts legacy JSON datamaps written by older builds via the first-byte
/// sniff in upstream's `read_datamap`, so existing entries in `upload_history.json`
/// keep working.
pub fn write_datamap_for(
    original_name: &str,
    dm: &ant_core::data::DataMap,
) -> Result<PathBuf, String> {
    let dir = resolve_datamap_output_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create datamap dir: {e}"))?;
    ant_core::data::write_datamap(
        &dir,
        original_name,
        dm,
        ant_core::data::CollisionPolicy::NumericSuffix,
    )
    .map_err(|e| format!("Failed to write datamap: {e}"))
}
