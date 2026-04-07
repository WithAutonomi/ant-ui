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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetaResult {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadHistoryEntry {
    pub name: String,
    pub size_bytes: u64,
    pub address: String,
    pub cost: Option<String>,
    pub uploaded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UploadHistory {
    #[serde(default)]
    pub entries: Vec<UploadHistoryEntry>,
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
        }
    }
}

pub(crate) fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("autonomi")
        .join("ant-gui")
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
