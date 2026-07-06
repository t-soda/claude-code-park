pub mod entry;
pub mod meta;
pub mod parse;
pub mod tail;

pub use tail::TailReader;

use entry::RawEntry;
use std::path::Path;

/// Streams every parseable line of a JSONL file to `f`, without ever holding the
/// whole file (or a Vec of all entries) in memory. Unreadable files are a no-op,
/// unparseable / invalid-UTF-8 lines are skipped (same tolerance as TailReader).
pub fn for_each_entry(path: &Path, mut f: impl FnMut(&RawEntry)) {
    use std::io::BufRead;
    let Ok(file) = std::fs::File::open(path) else {
        return;
    };
    let mut reader = std::io::BufReader::new(file);
    let mut raw = Vec::new();
    loop {
        raw.clear();
        // Decode lossily like TailReader does: BufRead::lines() yields Err on an
        // invalid-UTF-8 line, which would silently end the scan mid-file.
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        if let Some(e) = parse::parse_line(&String::from_utf8_lossy(&raw)) {
            f(&e);
        }
    }
}
