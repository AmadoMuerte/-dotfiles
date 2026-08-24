import { COMPOSITOR } from "shoji_wm";

export const APPLICATIONS = {
  terminal: ["ghostty"],
  fileManager: ["nautilus"],
  browser: ["zen-browser"],
  editor: ["gnome-text-editor", "--new-window"],
  calculator: ["gnome-calculator"],
} as const;

export function launch(command: readonly string[]): void {
  COMPOSITOR.process.spawn({ command: [...command] });
}
