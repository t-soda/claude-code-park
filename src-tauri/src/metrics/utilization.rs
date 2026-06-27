use chrono::{DateTime, Duration, Utc};

/// Gap threshold (seconds) for joining active intervals. Event gaps within this are considered active.
const GAP_SECS: i64 = 120;

/// Definition of an aggregation window (key, start time).
pub struct Window {
    pub key: &'static str,
    pub start: DateTime<Utc>,
}

/// Creates the today / 7d / 30d windows from the current time.
pub fn windows(now: DateTime<Utc>) -> Vec<Window> {
    vec![
        Window { key: "today", start: now - Duration::hours(24) },
        Window { key: "7d", start: now - Duration::days(7) },
        Window { key: "30d", start: now - Duration::days(30) },
    ]
}

/// Computes active seconds from a sorted timestamp sequence.
/// Joins and adds consecutive event gaps within GAP_SECS. An isolated event counts as at least 1 second.
pub fn active_seconds(sorted_ts: &[DateTime<Utc>]) -> u64 {
    if sorted_ts.is_empty() {
        return 0;
    }
    if sorted_ts.len() == 1 {
        return 1;
    }
    let mut total: i64 = 0;
    for pair in sorted_ts.windows(2) {
        let gap = pair[1].signed_duration_since(pair[0]).num_seconds();
        if (0..=GAP_SECS).contains(&gap) {
            total += gap;
        }
    }
    total.max(1) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn connects_within_gap_and_breaks_on_long_gap() {
        let ts = vec![
            t("2026-06-21T10:00:00Z"),
            t("2026-06-21T10:00:30Z"), // +30s joined
            t("2026-06-21T10:01:00Z"), // +30s joined
            t("2026-06-21T12:00:00Z"), // large gap -> not added
            t("2026-06-21T12:00:10Z"), // +10s joined
        ];
        assert_eq!(active_seconds(&ts), 70);
    }

    #[test]
    fn single_event_is_one_second() {
        assert_eq!(active_seconds(&[t("2026-06-21T10:00:00Z")]), 1);
        assert_eq!(active_seconds(&[]), 0);
    }
}
