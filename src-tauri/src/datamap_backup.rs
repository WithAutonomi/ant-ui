//! Datamap backup: bundle every persisted `.datamap` file into a single zip
//! the user can store off-device, and restore from such a zip on another
//! machine.
//!
//! A datamap is the only *local* key to re-download a private upload (see
//! `config::write_datamap_for`) — losing it orphans the data on the network.
//! This is therefore a data-safety feature, not a convenience.
//!
//! Archive layout:
//! ```text
//! manifest.json          (format_version, exported_at_unix, app_version, entries[])
//! datamaps/<name>.datamap
//! ```
//! The export is driven off `upload_history.json` entries (authoritative,
//! wherever the file lives on disk), then sweeps the datamap directories for
//! any orphan `.datamap` files not referenced by history so nothing is missed.
//!
//! The public commands resolve global paths (history file, datamap dirs); the
//! zip read/write logic is factored into `write_archive` / `import_archive`
//! which take explicit paths so they can be unit-tested against temp dirs.

use crate::config::{self, UploadHistory, UploadHistoryEntry};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const FORMAT_VERSION: u32 = 1;
const MANIFEST_NAME: &str = "manifest.json";
const DATAMAP_PREFIX: &str = "datamaps/";

#[derive(Serialize, Deserialize)]
struct ManifestEntry {
    /// Path of the datamap inside the archive (e.g. `datamaps/foo.jpg.datamap`).
    archive_path: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    size_bytes: u64,
    #[serde(default)]
    address: String,
    #[serde(default)]
    public_address: Option<String>,
    #[serde(default)]
    uploaded_at: String,
    /// Found by directory sweep with no matching `upload_history` entry.
    #[serde(default)]
    orphan: bool,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    format_version: u32,
    exported_at_unix: u64,
    app_version: String,
    entries: Vec<ManifestEntry>,
}

#[derive(Serialize)]
pub struct ExportSummary {
    pub count: usize,
    pub orphan_count: usize,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped_duplicates: usize,
}

/// One datamap file slated for export, with its history metadata if known.
struct Source {
    path: PathBuf,
    entry: Option<UploadHistoryEntry>,
    orphan: bool,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Every directory that may hold `.datamap` files: the fresh-install Documents
/// location and the legacy config dir. Both are swept so users who upgraded
/// across the datamap-dir migration still get a complete backup.
fn candidate_datamap_dirs() -> Vec<PathBuf> {
    let documents = config::datamap_dir();
    let legacy = config::config_path();
    if documents == legacy {
        vec![documents]
    } else {
        vec![documents, legacy]
    }
}

// ── Export ──────────────────────────────────────────────────────────────────

pub fn export_datamaps(dest_zip: &str) -> Result<ExportSummary, String> {
    let history =
        UploadHistory::load().map_err(|e| format!("Failed to read upload history: {e}"))?;
    let sources = collect_sources(&history, &candidate_datamap_dirs());
    if sources.is_empty() {
        return Err("No datamaps found to export".to_string());
    }
    write_archive(&sources, Path::new(dest_zip))
}

/// Build the export source list: history-referenced datamaps first
/// (authoritative metadata), then any orphan `*.datamap` files found under
/// `dirs` that history doesn't reference.
fn collect_sources(history: &UploadHistory, dirs: &[PathBuf]) -> Vec<Source> {
    let mut sources: Vec<Source> = Vec::new();
    let mut included: HashSet<PathBuf> = HashSet::new();

    for e in &history.entries {
        if let Some(p) = &e.data_map_file {
            let path = PathBuf::from(p);
            if path.is_file() && included.insert(path.clone()) {
                sources.push(Source {
                    path,
                    entry: Some(e.clone()),
                    orphan: false,
                });
            }
        }
    }

    for dir in dirs {
        let rd = match std::fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for de in rd.filter_map(|d| d.ok()) {
            let path = de.path();
            if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("datamap") {
                continue;
            }
            if included.insert(path.clone()) {
                sources.push(Source {
                    path,
                    entry: None,
                    orphan: true,
                });
            }
        }
    }

    sources
}

/// Write `sources` (+ a manifest) into a zip at `dest_zip`.
fn write_archive(sources: &[Source], dest_zip: &Path) -> Result<ExportSummary, String> {
    let file = std::fs::File::create(dest_zip)
        .map_err(|e| format!("Failed to create {}: {e}", dest_zip.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();

    let mut manifest_entries: Vec<ManifestEntry> = Vec::with_capacity(sources.len());
    let mut used_names: HashSet<String> = HashSet::new();
    let mut orphan_count = 0usize;

    for src in sources {
        if src.orphan {
            orphan_count += 1;
        }
        let bytes = std::fs::read(&src.path)
            .map_err(|e| format!("Failed to read {}: {e}", src.path.display()))?;
        let base = src
            .path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("datamap")
            .to_string();
        let archive_path = format!("{DATAMAP_PREFIX}{}", unique_name(&base, &mut used_names));

        zip.start_file(&archive_path, opts)
            .map_err(|e| format!("Failed to add {archive_path}: {e}"))?;
        zip.write_all(&bytes)
            .map_err(|e| format!("Failed to write {archive_path}: {e}"))?;

        let entry = src.entry.as_ref();
        manifest_entries.push(ManifestEntry {
            archive_path,
            name: entry.map(|e| e.name.clone()).unwrap_or_default(),
            size_bytes: entry.map(|e| e.size_bytes).unwrap_or(0),
            address: entry.map(|e| e.address.clone()).unwrap_or_default(),
            public_address: entry.and_then(|e| e.public_address.clone()),
            uploaded_at: entry.map(|e| e.uploaded_at.clone()).unwrap_or_default(),
            orphan: src.orphan,
        });
    }

    let manifest = Manifest {
        format_version: FORMAT_VERSION,
        exported_at_unix: now_unix(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        entries: manifest_entries,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {e}"))?;
    zip.start_file(MANIFEST_NAME, opts)
        .map_err(|e| format!("Failed to add manifest: {e}"))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("Failed to write manifest: {e}"))?;

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {e}"))?;

    let bytes = std::fs::metadata(dest_zip).map(|m| m.len()).unwrap_or(0);
    Ok(ExportSummary {
        count: sources.len(),
        orphan_count,
        bytes,
    })
}

// ── Import ──────────────────────────────────────────────────────────────────

pub fn import_datamaps(src_zip: &str) -> Result<ImportSummary, String> {
    let target_dir = config::resolve_datamap_output_dir();
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create datamap dir: {e}"))?;

    let mut history =
        UploadHistory::load().map_err(|e| format!("Failed to read upload history: {e}"))?;
    let existing: HashSet<String> = history
        .entries
        .iter()
        .map(|e| e.address.clone())
        .filter(|a| !a.is_empty())
        .collect();

    let (summary, new_entries) = import_archive(Path::new(src_zip), &target_dir, &existing)?;

    if !new_entries.is_empty() {
        history.entries.extend(new_entries);
        history
            .save()
            .map_err(|e| format!("Failed to save upload history: {e}"))?;
    }
    Ok(summary)
}

/// Extract every `datamaps/*` file from `src_zip` into `target_dir`, deduping
/// against `existing_addrs` (by manifest address) and against identical files
/// already on disk. Returns the summary plus the new history rows the caller
/// should persist. Does not touch global state, so it's unit-testable.
fn import_archive(
    src_zip: &Path,
    target_dir: &Path,
    existing_addrs: &HashSet<String>,
) -> Result<(ImportSummary, Vec<UploadHistoryEntry>), String> {
    let file = std::fs::File::open(src_zip)
        .map_err(|e| format!("Failed to open {}: {e}", src_zip.display()))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip archive: {e}"))?;

    // Read & validate the manifest if present. Foreign zips may lack one — we
    // still import any datamaps/* files, just without history metadata.
    let manifest: Option<Manifest> = match archive.by_name(MANIFEST_NAME) {
        Ok(mut f) => {
            let mut s = String::new();
            f.read_to_string(&mut s)
                .map_err(|e| format!("Failed to read manifest: {e}"))?;
            let m: Manifest =
                serde_json::from_str(&s).map_err(|e| format!("Invalid manifest: {e}"))?;
            if m.format_version > FORMAT_VERSION {
                return Err(format!(
                    "Backup format v{} is newer than this app supports (v{FORMAT_VERSION}). Update Autonomi and try again.",
                    m.format_version
                ));
            }
            Some(m)
        }
        Err(_) => None,
    };
    let meta: HashMap<String, &ManifestEntry> = manifest
        .as_ref()
        .map(|m| {
            m.entries
                .iter()
                .map(|e| (e.archive_path.clone(), e))
                .collect()
        })
        .unwrap_or_default();

    let mut seen_addrs = existing_addrs.clone();
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut new_entries: Vec<UploadHistoryEntry> = Vec::new();

    for i in 0..archive.len() {
        let mut f = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {e}"))?;
        if !f.is_file() {
            continue;
        }
        // enclosed_name() rejects absolute paths and `..` traversal (zip-slip).
        let name = match f.enclosed_name() {
            Some(p) => p.to_string_lossy().replace('\\', "/"),
            None => continue,
        };
        if !name.starts_with(DATAMAP_PREFIX) {
            continue;
        }
        // Use basename only — never honor nested paths inside datamaps/.
        let base = match Path::new(&name).file_name().and_then(|s| s.to_str()) {
            Some(b) if !b.is_empty() => b.to_string(),
            _ => continue,
        };

        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes)
            .map_err(|e| format!("Failed to read {name}: {e}"))?;

        let entry_meta = meta.get(&name).copied();
        let addr = entry_meta.map(|m| m.address.clone()).unwrap_or_default();

        // Address-level dedupe — matches loadHistory's dedupe on address.
        if !addr.is_empty() && seen_addrs.contains(&addr) {
            skipped += 1;
            continue;
        }

        match write_without_clobber(target_dir, &base, &bytes)? {
            None => {
                // Identical file already on disk.
                skipped += 1;
            }
            Some(dest_path) => {
                imported += 1;
                if !addr.is_empty() {
                    seen_addrs.insert(addr.clone());
                }
                // Add a history row so the imported datamap appears in the
                // Files table. Orphan datamaps (no manifest metadata) land on
                // disk but get no row — there's no upload record to show.
                if let Some(m) = entry_meta {
                    if !m.orphan {
                        new_entries.push(UploadHistoryEntry {
                            name: if m.name.is_empty() {
                                base.clone()
                            } else {
                                m.name.clone()
                            },
                            size_bytes: m.size_bytes,
                            address: m.address.clone(),
                            cost: None,
                            uploaded_at: m.uploaded_at.clone(),
                            data_map_file: Some(dest_path.to_string_lossy().into_owned()),
                            gas_cost: None,
                            public_address: m.public_address.clone(),
                        });
                    }
                }
            }
        }
    }

    Ok((
        ImportSummary {
            imported,
            skipped_duplicates: skipped,
        },
        new_entries,
    ))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Make `base` unique within `used`, inserting `-N` before the `.datamap`
/// suffix on collision (e.g. two same-named files from different dirs).
fn unique_name(base: &str, used: &mut HashSet<String>) -> String {
    if used.insert(base.to_string()) {
        return base.to_string();
    }
    let (stem, ext) = split_datamap(base);
    let mut n = 1;
    loop {
        let cand = format!("{stem}-{n}{ext}");
        if used.insert(cand.clone()) {
            return cand;
        }
        n += 1;
    }
}

/// Write `bytes` to `dir/base`. Returns `Ok(None)` when an identical file is
/// already present (caller treats as a duplicate). On a collision with
/// *differing* content, writes under a `-imported-N` suffix and returns that
/// path. Never overwrites an existing file.
fn write_without_clobber(dir: &Path, base: &str, bytes: &[u8]) -> Result<Option<PathBuf>, String> {
    let direct = dir.join(base);
    if direct.exists() {
        if std::fs::read(&direct).map(|b| b == bytes).unwrap_or(false) {
            return Ok(None);
        }
        let (stem, ext) = split_datamap(base);
        let mut n = 1;
        loop {
            let cand = dir.join(format!("{stem}-imported-{n}{ext}"));
            if !cand.exists() {
                std::fs::write(&cand, bytes)
                    .map_err(|e| format!("Failed to write {}: {e}", cand.display()))?;
                return Ok(Some(cand));
            }
            n += 1;
        }
    }
    std::fs::write(&direct, bytes)
        .map_err(|e| format!("Failed to write {}: {e}", direct.display()))?;
    Ok(Some(direct))
}

/// Split a datamap filename into (stem, ext) so a numeric suffix can be
/// inserted before the trailing `.datamap` (e.g. `a.jpg.datamap` →
/// (`a.jpg`, `.datamap`)). Falls back to (whole, "") if the suffix is absent.
fn split_datamap(base: &str) -> (&str, &str) {
    match base.strip_suffix(".datamap") {
        Some(stem) => (stem, ".datamap"),
        None => (base, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Unique temp dir, no external crate. Best-effort; left on disk if a test
    /// panics, which is fine for CI ephemerality.
    fn temp_dir(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ant-dmtest-{pid}-{nanos}-{n}-{tag}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(name: &str, addr: &str, path: &Path) -> UploadHistoryEntry {
        UploadHistoryEntry {
            name: name.into(),
            size_bytes: 0,
            address: addr.into(),
            cost: None,
            uploaded_at: String::new(),
            data_map_file: Some(path.to_string_lossy().into_owned()),
            gas_cost: None,
            public_address: None,
        }
    }

    fn make_zip(files: &[(&str, &str, &[u8])]) -> PathBuf {
        let src = temp_dir("src");
        let sources: Vec<Source> = files
            .iter()
            .map(|(name, addr, bytes)| {
                let path = src.join(format!("{name}.datamap"));
                std::fs::write(&path, bytes).unwrap();
                Source {
                    path: path.clone(),
                    entry: Some(entry(name, addr, &path)),
                    orphan: false,
                }
            })
            .collect();
        let zip_path = temp_dir("zip").join("backup.zip");
        write_archive(&sources, &zip_path).unwrap();
        zip_path
    }

    #[test]
    fn round_trip_export_import() {
        let zip = make_zip(&[("a.txt", "0xaaa", b"alpha"), ("b.txt", "0xbbb", b"bravo")]);

        let target = temp_dir("target");
        let (imp, new_entries) = import_archive(&zip, &target, &HashSet::new()).unwrap();

        assert_eq!(imp.imported, 2);
        assert_eq!(imp.skipped_duplicates, 0);
        assert_eq!(new_entries.len(), 2);
        assert_eq!(
            std::fs::read(target.join("a.txt.datamap")).unwrap(),
            b"alpha"
        );
        assert_eq!(
            std::fs::read(target.join("b.txt.datamap")).unwrap(),
            b"bravo"
        );
        // History rows point at the extracted files.
        assert!(new_entries.iter().all(|e| e
            .data_map_file
            .as_deref()
            .is_some_and(|p| p.ends_with(".datamap"))));
    }

    #[test]
    fn skips_address_already_in_history() {
        let zip = make_zip(&[("a.txt", "0xaaa", b"alpha")]);
        let target = temp_dir("target");
        let mut existing = HashSet::new();
        existing.insert("0xaaa".to_string());

        let (imp, new_entries) = import_archive(&zip, &target, &existing).unwrap();

        assert_eq!(imp.imported, 0);
        assert_eq!(imp.skipped_duplicates, 1);
        assert!(new_entries.is_empty());
        // Nothing written when the address is already known.
        assert!(!target.join("a.txt.datamap").exists());
    }

    #[test]
    fn skips_identical_file_already_on_disk() {
        let zip = make_zip(&[("a.txt", "0xaaa", b"alpha")]);
        let target = temp_dir("target");

        let (first, _) = import_archive(&zip, &target, &HashSet::new()).unwrap();
        assert_eq!(first.imported, 1);

        // Re-import with empty history: file is byte-identical on disk → skip.
        let (second, _) = import_archive(&zip, &target, &HashSet::new()).unwrap();
        assert_eq!(second.imported, 0);
        assert_eq!(second.skipped_duplicates, 1);
    }

    #[test]
    fn does_not_clobber_a_differing_file() {
        let zip = make_zip(&[("a.txt", "0xaaa", b"new-content")]);
        let target = temp_dir("target");
        // Pre-existing DIFFERENT file at the same name.
        std::fs::write(target.join("a.txt.datamap"), b"old-content").unwrap();

        let (imp, _) = import_archive(&zip, &target, &HashSet::new()).unwrap();

        assert_eq!(imp.imported, 1);
        // Original is untouched; new content lands under a suffix.
        assert_eq!(
            std::fs::read(target.join("a.txt.datamap")).unwrap(),
            b"old-content"
        );
        assert_eq!(
            std::fs::read(target.join("a.txt-imported-1.datamap")).unwrap(),
            b"new-content"
        );
    }

    #[test]
    fn export_counts_orphans_separately() {
        let src = temp_dir("src");
        let known = src.join("known.txt.datamap");
        let orphan = src.join("orphan.txt.datamap");
        std::fs::write(&known, b"k").unwrap();
        std::fs::write(&orphan, b"o").unwrap();
        let sources = vec![
            Source {
                path: known.clone(),
                entry: Some(entry("known.txt", "0xkkk", &known)),
                orphan: false,
            },
            Source {
                path: orphan.clone(),
                entry: None,
                orphan: true,
            },
        ];
        let zip = temp_dir("zip").join("backup.zip");

        let summary = write_archive(&sources, &zip).unwrap();

        assert_eq!(summary.count, 2);
        assert_eq!(summary.orphan_count, 1);
        assert!(summary.bytes > 0);
    }

    #[test]
    fn unique_name_suffixes_collisions() {
        let mut used = HashSet::new();
        assert_eq!(unique_name("a.jpg.datamap", &mut used), "a.jpg.datamap");
        assert_eq!(unique_name("a.jpg.datamap", &mut used), "a.jpg-1.datamap");
        assert_eq!(unique_name("a.jpg.datamap", &mut used), "a.jpg-2.datamap");
    }
}
