use super::entry::RawEntry;
use super::parse::parse_line;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// A reader that incrementally reads append-only JSONL, retaining a byte offset.
/// - A trailing segment not ending in a newline (a write in progress) is held until next time.
/// - If the file shrinks (rotation/recreation), the offset is reset.
#[derive(Default)]
pub struct TailReader {
    offsets: HashMap<PathBuf, u64>,
}

impl TailReader {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers the file as known and advances the read position to the end (starts watching only, without reading existing content).
    pub fn mark_read_to_end(&mut self, path: &Path) {
        if let Ok(meta) = std::fs::metadata(path) {
            self.offsets.insert(path.to_path_buf(), meta.len());
        }
    }

    /// Parses and returns the complete lines appended since the previous offset.
    pub fn read_new(&mut self, path: &Path) -> Vec<RawEntry> {
        let mut entries = Vec::new();
        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return entries,
        };
        let len = match file.metadata() {
            Ok(m) => m.len(),
            Err(_) => return entries,
        };
        let mut offset = *self.offsets.get(path).unwrap_or(&0);
        // File shrank -> treat as recreated and read from the start.
        if len < offset {
            offset = 0;
        }
        if len == offset {
            return entries;
        }
        if file.seek(SeekFrom::Start(offset)).is_err() {
            return entries;
        }
        let mut buf = Vec::new();
        if file.read_to_end(&mut buf).is_err() {
            return entries;
        }
        // Process up to the last newline as "complete lines"; the remainder (a write in progress) goes to next time.
        let last_nl = buf.iter().rposition(|&b| b == b'\n');
        let complete_len = match last_nl {
            Some(pos) => pos + 1,
            None => 0, // no complete line yet
        };
        if complete_len > 0 {
            let text = String::from_utf8_lossy(&buf[..complete_len]);
            for line in text.lines() {
                if let Some(e) = parse_line(line) {
                    entries.push(e);
                }
            }
        }
        self.offsets
            .insert(path.to_path_buf(), offset + complete_len as u64);
        entries
    }
}
