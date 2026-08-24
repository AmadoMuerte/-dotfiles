import { COMPOSITOR } from "shoji_wm";
import { APPLICATIONS, launch } from "./applications";
import { WORKSPACES_PER_MONITOR } from "./workspaces";
import type { HybridWindowManager } from "./window-manager";
import { theme } from "./theme";

function command(command: string): () => void {
  return () => COMPOSITOR.process.spawn({ command });
}

export function configureKeybinds(manager: HybridWindowManager): void {
  COMPOSITOR.key.bind("terminal", "Super+T", () => launch(APPLICATIONS.terminal));
  COMPOSITOR.key.bind("file-manager", "Super+E", () => launch(APPLICATIONS.fileManager));
  COMPOSITOR.key.bind("launcher", "Super+A", command("fuzzel"));
  COMPOSITOR.key.bind("close-focused-window", "Super+Q", () => manager.closeFocusedWindow());
  COMPOSITOR.key.bind("close-focused-window-force", "Super+Shift+Q", () => manager.closeFocusedWindow());
  COMPOSITOR.key.bind("fullscreen", "Super+W", () => manager.toggleFocusedWindowFullscreen());
  COMPOSITOR.key.bind("toggle-floating", "Super+F", () => manager.toggleFocusedWindowFloating());
  COMPOSITOR.key.bind("toggle-floating-alternate", "Super+V", () => manager.toggleFocusedWindowFloating());
  COMPOSITOR.key.bind("toggle-floating-pinned", "Super+Shift+F", () => manager.toggleFocusedWindowFloating());

  for (const [direction, key] of [
    ["left", "Left"],
    ["right", "Right"],
    ["up", "Up"],
    ["down", "Down"],
  ] as const) {
    COMPOSITOR.key.bind(`focus-${direction}`, `Super+${key}`, () => manager.focusDirection(direction));
    COMPOSITOR.key.bind(`move-${direction}`, `Super+Ctrl+${key}`, () => manager.moveFocusedWindow(direction));
  }

  const resizeStep = theme.metrics.splitResizeStep;
  COMPOSITOR.key.bind("resize-left", "Super+Shift+Left", () => manager.resizeFocusedWindow(-resizeStep, 0));
  COMPOSITOR.key.bind("resize-right", "Super+Shift+Right", () => manager.resizeFocusedWindow(resizeStep, 0));
  COMPOSITOR.key.bind("resize-up", "Super+Shift+Up", () => manager.resizeFocusedWindow(0, -resizeStep));
  COMPOSITOR.key.bind("resize-down", "Super+Shift+Down", () => manager.resizeFocusedWindow(0, resizeStep));

  for (let index = 1; index <= WORKSPACES_PER_MONITOR; index += 1) {
    COMPOSITOR.key.bind(`workspace-${index}`, `Super+${index}`, () => manager.activateCurrentMonitorWorkspace(index));
    COMPOSITOR.key.bind(`move-to-workspace-${index}`, `Super+Shift+${index}`, () => manager.moveFocusedWindowToWorkspaceIndex(index));
  }
  COMPOSITOR.key.bind("workspace-next", "Super+WheelScrollDown", () => manager.switchWorkspace(1));
  COMPOSITOR.key.bind("workspace-previous", "Super+WheelScrollUp", () => manager.switchWorkspace(-1));

  COMPOSITOR.key.bind("screenshot-region", "Super+Shift+S", command('grim -g "$(slurp)" - | swappy -f -'));
  COMPOSITOR.key.bind("volume-up", "XF86AudioRaiseVolume", command("pamixer -i 5"));
  COMPOSITOR.key.bind("volume-down", "XF86AudioLowerVolume", command("pamixer -d 5"));
  COMPOSITOR.key.bind("volume-mute", "XF86AudioMute", command("pamixer -t"));
  COMPOSITOR.key.bind("microphone-mute", "XF86AudioMicMute", command("pamixer --default-source -t"));
  COMPOSITOR.key.bind("brightness-up", "XF86MonBrightnessUp", command("brightnessctl set 10%+"));
  COMPOSITOR.key.bind("brightness-down", "XF86MonBrightnessDown", command("brightnessctl set 10%-"));
}
