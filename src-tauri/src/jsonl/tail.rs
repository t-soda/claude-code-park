use super::entry::RawEntry;
use super::parse::parse_line;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Upper bound on bytes materialized per read. A huge unread region (a large session
/// JSONL at startup restore, a timeline fetch, or a file that shrank and reset to 0)
/// is read only from the tail, so a single file can never blow up memory.
const MAX_READ_BYTES: u64 = 16 * 1024 * 1024;
/// Upper bound when salvaging the file's first line for head metadata (entrypoint/cwd).
const MAX_HEAD_LINE_BYTES: u64 = 256 * 1024;

/// A reader that incrementally reads append-only JSONL, retaining a byte offset.
/// - A trailing segment not ending in a newline (a write in progress) is held until next time.
/// - If the file shrinks (rotation/recreation), the offset is reset.
/// - A single read is capped at MAX_READ_BYTES (only the tail is parsed beyond that).
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
        self.read_new_capped(path, MAX_READ_BYTES)
    }

    /// read_new with an explicit cap (separated out for tests).
    fn read_new_capped(&mut self, path: &Path, cap: u64) -> Vec<RawEntry> {
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
        // Cap the read: parse only the tail of an oversized unread region. When this skips
        // the file head on a first read, salvage just the first line — it carries session
        // meta (entrypoint/cwd) that only appears there.
        let mut skip_partial = false;
        if len - offset > cap {
            if offset == 0 {
                if let Some(head) = read_first_line(&mut file) {
                    entries.push(head);
                }
            }
            offset = len - cap;
            // Whether the seek landed mid-line: only when the previous byte isn't a newline
            // (landing exactly on a line start must not drop that complete line).
            skip_partial = !starts_at_line_boundary(&mut file, offset);
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
            // When the read landed mid-line (capped), drop the leading partial line.
            let start = if skip_partial {
                buf[..complete_len]
                    .iter()
                    .position(|&b| b == b'\n')
                    .map(|p| p + 1)
                    .unwrap_or(complete_len)
            } else {
                0
            };
            let text = String::from_utf8_lossy(&buf[start..complete_len]);
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

/// Whether `offset` is the start of a line (= the byte before it is a newline).
/// offset 0 is always a line start. On read failure, assume mid-line (safe side: skip).
fn starts_at_line_boundary(file: &mut File, offset: u64) -> bool {
    if offset == 0 {
        return true;
    }
    let mut b = [0u8; 1];
    file.seek(SeekFrom::Start(offset - 1)).is_ok()
        && file.read_exact(&mut b).is_ok()
        && b[0] == b'\n'
}

/// Reads and parses only the file's first line (bounded; None if it can't be determined).
fn read_first_line(file: &mut File) -> Option<RawEntry> {
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut buf = Vec::new();
    file.take(MAX_HEAD_LINE_BYTES).read_to_end(&mut buf).ok()?;
    let end = buf.iter().position(|&b| b == b'\n')?;
    parse_line(&String::from_utf8_lossy(&buf[..end]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp_file(label: &str, content: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "claude_code_park_tail_test_{}_{}.jsonl",
            label,
            std::process::id()
        ));
        let mut f = File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    fn line(ts: &str, extra: &str) -> String {
        format!(r#"{{"type":"user","timestamp":"{ts}"{extra},"message":{{"role":"user","content":"x"}}}}"#)
    }

    /// A read larger than the cap parses only the tail, but the first line (session meta) is salvaged.
    #[test]
    fn capped_read_keeps_head_meta_and_tail_lines() {
        let head = line("2026-01-01T00:00:00.000Z", r#","entrypoint":"sdk-cli","cwd":"/proj""#);
        let mid = line("2026-01-01T00:00:01.000Z", "");
        let tail_line = line("2026-01-01T00:00:02.000Z", "");
        let content = format!("{head}\n{mid}\n{tail_line}\n");
        let path = tmp_file("capped", &content);

        // Cap so that only the last line fits (+1 to include its trailing newline region).
        let cap = tail_line.len() as u64 + 1;
        let mut r = TailReader::new();
        let entries = r.read_new_capped(&path, cap);

        // head (salvaged) + tail line. The middle line is skipped by the cap.
        assert_eq!(entries.len(), 2, "expected head meta + tail line, got {}", entries.len());
        assert_eq!(entries[0].entrypoint.as_deref(), Some("sdk-cli"));
        assert_eq!(entries[0].cwd.as_deref(), Some("/proj"));
        assert_eq!(entries[1].timestamp.as_deref(), Some("2026-01-01T00:00:02.000Z"));

        // Follow-up appends are read incrementally as usual.
        let extra = line("2026-01-01T00:00:03.000Z", "");
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "{extra}").unwrap();
        let more = r.read_new_capped(&path, cap);
        assert_eq!(more.len(), 1);
        assert_eq!(more[0].timestamp.as_deref(), Some("2026-01-01T00:00:03.000Z"));

        let _ = std::fs::remove_file(&path);
    }

    /// A cap landing mid-line drops the leading partial line instead of mis-parsing it.
    #[test]
    fn capped_read_drops_leading_partial_line() {
        let a = line("2026-01-01T00:00:00.000Z", "");
        let b = line("2026-01-01T00:00:01.000Z", "");
        let content = format!("{a}\n{b}\n");
        let path = tmp_file("midline", &content);

        // Cap cuts into the middle of line b -> only... nothing complete besides the partial,
        // so just the salvaged head line comes back.
        let cap = (b.len() / 2) as u64;
        let mut r = TailReader::new();
        let entries = r.read_new_capped(&path, cap);
        assert_eq!(entries.len(), 1, "only the salvaged first line should be returned");
        assert_eq!(entries[0].timestamp.as_deref(), Some("2026-01-01T00:00:00.000Z"));

        let _ = std::fs::remove_file(&path);
    }

    /// An uncapped (small) read behaves as before: all lines, then incremental appends.
    #[test]
    fn small_read_returns_all_lines() {
        let content = format!("{}\n{}\n", line("2026-01-01T00:00:00.000Z", ""), line("2026-01-01T00:00:01.000Z", ""));
        let path = tmp_file("small", &content);
        let mut r = TailReader::new();
        let entries = r.read_new(&path);
        assert_eq!(entries.len(), 2);
        let _ = std::fs::remove_file(&path);
    }
}
