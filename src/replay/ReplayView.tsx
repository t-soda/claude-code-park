import { useReplayStore } from "../stores/replayStore";
import { ReplaySessionBrowser, sessionTitle } from "./ReplaySessionBrowser";
import { ReplayStage } from "./ReplayStage";
import { ReplayControls } from "./ReplayControls";
import { ReplayLog } from "./ReplayLog";
import { useT } from "../i18n";

/**
 * The Replay tab: a browser of past sessions, or — once one is opened — the
 * player (office canvas + transport controls) with the synchronized event log.
 */
export function ReplayView() {
  const t = useT();
  const data = useReplayStore((s) => s.data);
  const close = useReplayStore.getState().close;

  // Keep the browser (and its already-fetched list) mounted while a session is
  // loading or fails to load, instead of replacing it with a bare skeleton that
  // discards the list and re-fetches from scratch on the next visit.
  if (!data) return <ReplaySessionBrowser />;

  const title = sessionTitle(data.meta);
  return (
    <div className="replay-layout">
      <div className="replay-main">
        <div className="replay-head">
          <button className="btn secondary replay-back" onClick={close}>
            ‹ {t("replay.player.back")}
          </button>
          <span className="replay-title" title={title}>
            {title}
          </span>
          <span className="replay-head-note">{t("replay.player.railsNote")}</span>
        </div>
        <div className="replay-stage-wrap">
          <ReplayStage />
        </div>
        <ReplayControls />
      </div>
      <ReplayLog />
    </div>
  );
}
