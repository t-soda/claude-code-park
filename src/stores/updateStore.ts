import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "installed"
  | "error";

// The Update handle is a class instance (holds the download RID), so it lives
// outside the zustand state; the store only mirrors plain display data.
let pending: Update | null = null;

interface UpdateState {
  status: UpdateStatus;
  /** Version offered by the endpoint while status is available/downloading/installed. */
  version: string | null;
  /** Download progress 0–100, or null while the total size is unknown. */
  progress: number | null;
  error: string | null;
  /** True once the banner was dismissed; the offer stays reachable from Settings. */
  dismissed: boolean;
  checkForUpdate: (opts?: { silent?: boolean }) => Promise<void>;
  installAndRelaunch: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  progress: null,
  error: null,
  dismissed: false,

  async checkForUpdate({ silent = false } = {}) {
    const { status } = get();
    // An offer or a running download must not be clobbered by a re-check.
    if (status === "checking" || status === "downloading" || status === "installed") return;
    set({ status: "checking", error: null });
    // Update wraps an OS-side resource handle; release the previous offer before replacing it.
    const previous = pending;
    pending = null;
    if (previous) await previous.close().catch(() => {});
    try {
      const update = await check();
      if (update) {
        pending = update;
        set({ status: "available", version: update.version, dismissed: false });
      } else {
        // The startup check stays invisible unless it finds something.
        set({ status: silent ? "idle" : "upToDate", version: null });
      }
    } catch (e) {
      // Startup check failures (offline, no published release yet) are not worth a banner.
      set(silent ? { status: "idle" } : { status: "error", error: String(e) });
    }
  },

  async installAndRelaunch() {
    const update = pending;
    if (!update || get().status === "downloading") return;
    set({ status: "downloading", progress: null, dismissed: false });
    try {
      let total: number | null = null;
      let received = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            break;
          case "Progress":
            received += event.data.chunkLength;
            if (total) {
              set({ progress: Math.min(100, Math.round((received / total) * 100)) });
            }
            break;
          case "Finished":
            set({ progress: 100 });
            break;
        }
      });
      set({ status: "installed" });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e), progress: null });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
