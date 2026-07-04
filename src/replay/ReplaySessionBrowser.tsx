import { useEffect, useState } from "react";
import type { ReplaySessionMeta } from "../bindings";
import { useReplayStore } from "../stores/replayStore";
import { formatClock } from "./timeFormat";
import { useT } from "../i18n";

/** Last path segment of the working directory (compact project label). */
function projectName(meta: ReplaySessionMeta): string {
  const parts = meta.project.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? meta.project;
}

/** Display title for a session: prefer the slug, then the first prompt, else the id. */
export function sessionTitle(meta: ReplaySessionMeta): string {
  return meta.slug ?? meta.first_prompt ?? meta.session_id;
}

/** A still-running session's badge (Ended sessions show none — their history is complete). */
function StatusBadge({ status }: { status: ReplaySessionMeta["status"] }) {
  const t = useT();
  if (status === "Ended") return null;
  return (
    <span className={`replay-status-badge status-${status.toLowerCase()}`}>
      {status === "Active" ? t("replay.browser.statusActive") : t("replay.browser.statusIdle")}
    </span>
  );
}

/** Browser of past (ended) sessions; clicking a row opens the player. */
export function ReplaySessionBrowser() {
  const t = useT();
  const list = useReplayStore((s) => s.list);
  const listLoading = useReplayStore((s) => s.listLoading);
  const listError = useReplayStore((s) => s.listError);
  const dataError = useReplayStore((s) => s.dataError);
  const dataLoading = useReplayStore((s) => s.dataLoading);
  const { loadList, open } = useReplayStore.getState();
  // Which row was clicked, so only that card shows the opening state (a large
  // session can take a second+ to load; without this the click feels ignored).
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    // Refresh on every visit: sessions end all the time while the app is open.
    void loadList();
  }, [loadList]);

  return (
    <div className="panel">
      <h2>{t("replay.title")}</h2>
      <div className="sub">{t("replay.subtitle")}</div>
      {listError && <div className="err">{t("replay.browser.fetchError", { error: listError })}</div>}
      {dataError && <div className="err">{t("replay.player.loadError", { error: dataError })}</div>}
      {/* Only the very first-ever fetch shows the skeleton; a later refresh keeps
          showing whatever list (or empty state) is already there. */}
      {list === null && listLoading ? (
        <div className="replay-browser" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card replay-row">
              <span className="skel skel-name" />
            </div>
          ))}
        </div>
      ) : list === null || list.length === 0 ? (
        <div className="empty">{t("replay.browser.empty")}</div>
      ) : (
        <div className="replay-browser">
          {list.map((meta) => (
            <div
              key={meta.session_id}
              className={`card clickable replay-row ${
                dataLoading && openingId === meta.session_id ? "opening" : ""
              }`}
              onClick={() => {
                if (dataLoading) return; // one open at a time
                setOpeningId(meta.session_id);
                void open(meta.session_id);
              }}
            >
              <div className="title">
                {sessionTitle(meta)}
                <StatusBadge status={meta.status} />
              </div>
              <div className="desc replay-row-meta">
                <span className="replay-row-project">{projectName(meta)}</span>
                {meta.git_branch && <span className="replay-row-branch">{meta.git_branch}</span>}
                <span>{new Date(meta.started_at_ms).toLocaleString()}</span>
                <span>⏱ {formatClock(meta.ended_at_ms - meta.started_at_ms)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
