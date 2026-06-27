use serde::{Deserialize, Serialize};

/// Kind of host terminal app. Classified from comm (the executable path).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerminalKind {
    TerminalApp,
    ITerm2,
    VsCode,
    Ghostty,
    Unknown,
}

/// Information for one process line (from ps -o pid=,ppid=,comm=).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcRow {
    pub pid: u32,
    pub ppid: u32,
    pub comm: String,
}

/// The host terminal reached (PID and kind).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostTerminal {
    pub pid: u32,
    pub kind: TerminalKind,
}

/// Determines the host terminal kind from comm (the executable's absolute path).
/// Case-insensitive substring match. Checks specific names first, then generic ones.
pub fn classify_comm(comm: &str) -> TerminalKind {
    let c = comm.to_lowercase();
    if c.contains("ghostty") {
        TerminalKind::Ghostty
    } else if c.contains("iterm") {
        TerminalKind::ITerm2
    } else if c.contains("visual studio code") || c.contains("code helper") || c.contains("/electron") {
        TerminalKind::VsCode
    } else if c.contains("terminal.app") {
        TerminalKind::TerminalApp
    } else {
        TerminalKind::Unknown
    }
}

/// Extracts (pid, sessionId) from the contents of `~/.claude/sessions/<pid>.json` written by Claude Code.
/// The claude process does not keep the JSONL open, so lsof cannot find it, but this file
/// is the official mapping of session_id -> running claude PID (no hook required).
pub fn parse_session_entry(json: &str) -> Option<(u32, String)> {
    #[derive(Deserialize)]
    struct SessionFile {
        pid: u32,
        #[serde(rename = "sessionId")]
        session_id: String,
    }
    let f: SessionFile = serde_json::from_str(json).ok()?;
    Some((f.pid, f.session_id))
}

/// Parses `ps -axo pid=,ppid=,comm=` output.
/// Each line: leading-space-padded pid, ppid, and space-separated comm (comm itself may contain spaces).
pub fn parse_ps_rows(out: &str) -> Vec<ProcRow> {
    out.lines()
        .filter_map(|line| {
            let mut it = line.trim_start().split_whitespace();
            let pid = it.next()?.parse::<u32>().ok()?;
            let ppid = it.next()?.parse::<u32>().ok()?;
            let comm = it.collect::<Vec<_>>().join(" ");
            if comm.is_empty() {
                return None;
            }
            Some(ProcRow { pid, ppid, comm })
        })
        .collect()
}

/// Walks ppid from start_pid and returns the first known terminal found.
/// Stops at pid 1 or when no parent is found. Limited to 64 levels to prevent cycles/runaways.
pub fn find_host_terminal(start_pid: u32, rows: &[ProcRow]) -> Option<HostTerminal> {
    let by_pid = |pid: u32| rows.iter().find(|r| r.pid == pid);
    let mut cur = start_pid;
    for _ in 0..64 {
        let row = by_pid(cur)?;
        let kind = classify_comm(&row.comm);
        if kind != TerminalKind::Unknown {
            return Some(HostTerminal { pid: row.pid, kind });
        }
        if row.ppid <= 1 {
            return None;
        }
        cur = row.ppid;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_known_terminals() {
        assert_eq!(
            classify_comm("/Applications/Ghostty.app/Contents/MacOS/ghostty"),
            TerminalKind::Ghostty
        );
        assert_eq!(
            classify_comm("/Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
            TerminalKind::VsCode
        );
        assert_eq!(
            classify_comm("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
            TerminalKind::TerminalApp
        );
        assert_eq!(
            classify_comm("/Applications/iTerm.app/Contents/MacOS/iTerm2"),
            TerminalKind::ITerm2
        );
        assert_eq!(classify_comm("/bin/zsh"), TerminalKind::Unknown);
    }

    #[test]
    fn parse_session_entry_extracts_pid_and_sid() {
        // The real format of ~/.claude/sessions/<pid>.json.
        let json = r#"{"pid":90684,"sessionId":"1aa1f939-f6a0-4f8c","cwd":"/x","status":"busy"}"#;
        let (pid, sid) = parse_session_entry(json).unwrap();
        assert_eq!(pid, 90684);
        assert_eq!(sid, "1aa1f939-f6a0-4f8c");
    }

    #[test]
    fn parse_session_entry_rejects_garbage() {
        assert!(parse_session_entry("not json").is_none());
        // Also None when pid is missing.
        assert!(parse_session_entry(r#"{"sessionId":"x"}"#).is_none());
    }

    #[test]
    fn parse_ps_rows_parses_columns() {
        // `ps -axo pid=,ppid=,comm=` format (leading-space-padded, comm contains spaces).
        let out = "  4321   4310 /bin/zsh\n  4310   4200 /Applications/Ghostty.app/Contents/MacOS/ghostty\n";
        let rows = parse_ps_rows(out);
        assert_eq!(rows[0], ProcRow { pid: 4321, ppid: 4310, comm: "/bin/zsh".into() });
        assert_eq!(rows[1].comm, "/Applications/Ghostty.app/Contents/MacOS/ghostty");
    }

    #[test]
    fn find_host_walks_ppid_chain() {
        let rows = vec![
            ProcRow { pid: 4321, ppid: 4310, comm: "/usr/local/bin/claude".into() },
            ProcRow { pid: 4310, ppid: 4200, comm: "/bin/zsh".into() },
            ProcRow { pid: 4200, ppid: 1, comm: "/Applications/Ghostty.app/Contents/MacOS/ghostty".into() },
        ];
        let host = find_host_terminal(4321, &rows).unwrap();
        assert_eq!(host.pid, 4200);
        assert_eq!(host.kind, TerminalKind::Ghostty);
    }

    #[test]
    fn find_host_returns_none_when_no_terminal() {
        let rows = vec![
            ProcRow { pid: 10, ppid: 1, comm: "/bin/zsh".into() },
        ];
        assert!(find_host_terminal(10, &rows).is_none());
    }

    #[test]
    fn parse_ps_rows_preserves_spaces_in_comm() {
        let out = "  100     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron\n";
        let rows = parse_ps_rows(out);
        assert_eq!(rows[0].pid, 100);
        assert_eq!(rows[0].ppid, 1);
        assert_eq!(rows[0].comm, "/Applications/Visual Studio Code.app/Contents/MacOS/Electron");
    }
}
