import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayEvent } from "../bindings";
import { useReplayStore } from "../stores/replayStore";
import { activeRowIndex, logRows } from "./replayEngine";
import { formatClock } from "./timeFormat";
import { useT, type MessageKey } from "../i18n";

/**
 * The synchronized event log beside the replay canvas: highlights the row at the
 * playhead, auto-scrolls to it (until the user scrolls away; the follow chip
 * re-enables it), and clicking a row seeks there.
 */
export function ReplayLog() {
  const t = useT();
  const data = useReplayStore((s) => s.data);
  const playheadMs = useReplayStore((s) => s.playheadMs);
  const seek = useReplayStore.getState().seek;
  const [follow, setFollow] = useState(true);
  const activeRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo(() => (data ? logRows(data) : []), [data]);
  const activeIdx = activeRowIndex(rows, playheadMs);

  useEffect(() => {
    // Re-sync on any active-row change while following, not just while playing:
    // dragging the transport scrubber while paused must also scroll into view.
    if (follow) {
      activeRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx, follow]);

  if (!data) return null;

  return (
    <div className="replay-log">
      <div className="replay-log-head">
        <span>{t("replay.log.title")}</span>
        {!follow && (
          <button className="replay-follow" onClick={() => setFollow(true)}>
            {t("replay.player.follow")}
          </button>
        )}
      </div>
      <div className="replay-log-body" onWheel={() => setFollow(false)}>
        {rows.map((row, i) => (
          <button
            key={i}
            ref={i === activeIdx ? activeRef : undefined}
            className={`replay-log-row ${i === activeIdx ? "active" : ""} ${i > activeIdx ? "future" : ""}`}
            onClick={() => {
              setFollow(true);
              seek(row.at_ms);
            }}
          >
            <span className="log-time">{formatClock(row.at_ms)}</span>
            <span className="log-kind">{kindLabel(row, t)}</span>
            <span className="log-detail">{rowDetail(row)}</span>
            {row.tool_name && <span className="log-tool">{row.tool_name}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

type T = (key: MessageKey) => string;

function kindLabel(row: ReplayEvent, t: T): string {
  switch (row.kind) {
    case "SessionStart":
      return t("replay.log.sessionStart");
    case "UserPrompt":
      return t("replay.log.userPrompt");
    case "TurnEnd":
      return t("replay.log.turnEnd");
    case "SubagentSpawn":
      return t("replay.log.subagentSpawn");
    case "SubagentStop":
      return t("replay.log.subagentStop");
    case "Activity":
      // Same per-WorkKind vocabulary as the character log dialog.
      return t(`activityLog.${row.work ?? "Idle"}` as MessageKey);
    default:
      return row.kind;
  }
}

function rowDetail(row: ReplayEvent): string {
  switch (row.kind) {
    case "UserPrompt":
      return row.text ?? "";
    case "SubagentSpawn":
      return [row.detail, row.text].filter(Boolean).join(" — ");
    case "SubagentStop":
      return row.agent_id ?? "";
    default:
      return row.detail ?? "";
  }
}
