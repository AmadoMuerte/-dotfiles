import { COMPOSITOR, type DisplayConfigDraft } from "shoji_wm";

export const PRIMARY_MONITOR = "DP-1";
export const MONITORS = [PRIMARY_MONITOR, "DP-2"] as const;

export function configureMonitors(): void {
  COMPOSITOR.output.configure((): DisplayConfigDraft => ({
    "DP-1": {
      mode: "extend",
      resolution: { width: 2560, height: 1440, refreshRate: 180 },
      position: "auto",
      scale: 1,
    },
    "DP-2": {
      mode: "extend",
      resolution: { width: 2560, height: 1440, refreshRate: 180 },
      position: "auto",
      scale: 1,
    },
  }));
}
