import { useReplayStore, type ReplaySpeed } from "../stores/replayStore";
import { durationMs } from "./replayEngine";
import { formatClock } from "./timeFormat";
import { useT } from "../i18n";

const SPEEDS: ReplaySpeed[] = [1, 4, 16];

/** Transport bar: play/pause, scrubber, clock, and playback speed. */
export function ReplayControls() {
  const t = useT();
  const data = useReplayStore((s) => s.data);
  const playheadMs = useReplayStore((s) => s.playheadMs);
  const playing = useReplayStore((s) => s.playing);
  const speed = useReplayStore((s) => s.speed);
  const { play, pause, seek, setSpeed } = useReplayStore.getState();

  if (!data) return null;
  const duration = durationMs(data);

  return (
    <div className="replay-controls">
      <button
        className="btn replay-play"
        onClick={playing ? pause : play}
        aria-label={playing ? t("replay.player.pause") : t("replay.player.play")}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <span className="replay-clock">
        {formatClock(playheadMs)} / {formatClock(duration)}
      </span>
      <input
        className="replay-scrubber"
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={100}
        value={playheadMs}
        onChange={(e) => seek(Number(e.currentTarget.value))}
      />
      <div className="replay-speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`replay-speed-btn ${speed === s ? "active" : ""}`}
            onClick={() => setSpeed(s)}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
