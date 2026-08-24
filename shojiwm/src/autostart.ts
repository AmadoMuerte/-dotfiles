import { COMPOSITOR } from "shoji_wm";

export function configureAutostart(): void {
  COMPOSITOR.process.once("dbus-environment", {
    command: ["dbus-update-activation-environment", "--systemd", "--all"],
    runPolicy: "once-per-session",
  });
  COMPOSITOR.process.once("noctalia", {
    command: ["noctalia"],
    runPolicy: "once-per-session",
  });
  COMPOSITOR.process.once("root-xhost", {
    command: ["xhost", "+SI:localuser:root"],
    runPolicy: "once-per-session",
  });
  COMPOSITOR.process.once("kdeconnect-indicator", {
    command: ["kdeconnect-indicator"],
    runPolicy: "once-per-session",
  });
}
