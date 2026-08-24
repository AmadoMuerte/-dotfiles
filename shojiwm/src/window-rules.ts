import type { WaylandWindow } from "shoji_wm";

export interface WindowRule {
  floating?: boolean;
  widthFraction?: number;
  heightFraction?: number;
}

export function windowRule(window: WaylandWindow): WindowRule | undefined {
  switch (window.appId() ?? "") {
    case "org.gnome.Calculator":
      return { floating: true, widthFraction: 0.17, heightFraction: 0.43 };
    default:
      return undefined;
  }
}
