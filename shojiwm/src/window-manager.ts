import {
  createWindowStack,
  createWindowState,
  dropWindowState,
  markManagedWindowDirty,
  markWindowDirty,
  read,
  seconds,
  COMPOSITOR,
  type EasingFunction,
  type GestureSwipeEvent,
  type OutputChangeEvent,
  type PointerMoveEvent,
  type ReadonlySignal,
  type WaylandWindow,
  type WindowActivateRequestEvent,
  type WindowFullscreenRequestEvent,
  type WindowMaximizeRequestEvent,
  type WindowMinimizeRequestEvent,
  type WindowMoveEvent,
  type WindowResizeEvent,
  type WindowResizeRect,
} from "shoji_wm";
import type { ManagedWindowRect, WindowSizeConstraints } from "shoji_wm/types";
import { playRectAnimation, stopRectAnimation } from "./window-animation";
import {
  monitorForWorkspace,
  workspaceBelongsToMonitor,
  WORKSPACES_PER_MONITOR,
} from "./workspaces";
import { windowRule } from "./window-rules";
import { PRIMARY_MONITOR } from "./monitors";
import { theme } from "./theme";
import {
  TileTree,
  type TileDropZone,
  type TileNode,
  type TileRect,
  type TileResizeHandle,
} from "./tiling/tree";
import {
  findOutputInDirection,
  findNearestRect,
  findRectInDirection,
  moveRectBetweenAreas,
  projectRectToOutputEdge,
  type Rect,
} from "./multimonitor/geometry";

export type WindowDirection = "left" | "right" | "up" | "down";

export type SnapZone =
  | "maximize"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const WINDOW_STATE_RECT = createWindowState<ManagedWindowRect>("rect", {
  default: (window) => window.rect,
});
export const WINDOW_STATE_RESTORE_RECT =
  createWindowState<ManagedWindowRect | null>("restoreRect", {
    default: null,
  });
export const WINDOW_STATE_MINIMIZED = createWindowState<boolean>("minimized", {
  default: false,
});
export const WINDOW_STATE_MINIMIZE_VISUAL_IDLE = createWindowState<boolean>(
  "minimizeVisualIdle",
  {
    default: false,
  },
);
export const WINDOW_STATE_MAXIMIZED = createWindowState<boolean>("maximized", {
  default: false,
});
export const WINDOW_STATE_FULLSCREEN = createWindowState<boolean>(
  "fullscreen",
  {
    default: false,
  },
);
// Pre-fullscreen rect, kept separate from WINDOW_STATE_RESTORE_RECT so a
// window that was maximized before going fullscreen restores back to its
// maximized rect (and the maximize restore rect underneath stays intact).
export const WINDOW_STATE_FULLSCREEN_RESTORE_RECT =
  createWindowState<ManagedWindowRect | null>("fullscreenRestoreRect", {
    default: null,
  });
export const WINDOW_STATE_WORKSPACE_VISIBLE = createWindowState<boolean>(
  "workspaceVisible",
  {
    default: true,
  },
);
export const WINDOW_STATE_WORKSPACE_OFFSET_Y = createWindowState<number>(
  "workspaceOffsetY",
  {
    default: 0,
  },
);
export const WINDOW_STATE_WORKSPACE_OPACITY = createWindowState<number>(
  "workspaceOpacity",
  {
    default: 1,
  },
);
export const WINDOW_STATE_TILE_DRAGGING = createWindowState<boolean>(
  "tileDragging",
  {
    default: false,
  },
);
export const WINDOW_STATE_TILED = createWindowState<boolean>("tiled", {
  default: false,
});
export const WINDOW_STATE_VISIBLE_OUTPUTS = createWindowState<string[] | null>(
  "visibleOutputs",
  {
    default: null,
  },
);
export const WINDOW_STATE_FLOATING_RECT =
  createWindowState<ManagedWindowRect | null>("floatingRect", {
    default: null,
  });
export const WINDOW_STATE_FORCE_FLOATING = createWindowState<boolean>(
  "forceFloating",
  { default: false },
);
export const WINDOW_STATE_SNAP_ZONE = createWindowState<SnapZone | null>(
  "snapZone",
  {
    default: null,
  },
);
export const WINDOW_STATE_SNAP_MONITOR = createWindowState<string | null>(
  "snapMonitor",
  {
    default: null,
  },
);

const INITIAL_TILEABILITY_SETTLE_DURATION = seconds(1);
const WINDOW_MANAGEMENT_ANIMATION_DURATION =
  theme.animation.windowManagementDuration;
const UNMAXIMIZE_GRAB_ANIMATION_DURATION = 90;
const WINDOW_MANAGEMENT_EASING = theme.animation.windowEasing;
const WINDOW_OPEN_EASING = theme.animation.windowEasing;
const WINDOW_CLOSE_EASING = theme.animation.windowEasing;
const WINDOW_MINIMIZE_RECT_EASING = theme.animation.windowEasing;
const WINDOW_UNMINIMIZE_RECT_EASING = theme.animation.windowEasing;
const WINDOW_MINIMIZE_OPACITY_EASING = theme.animation.windowEasing;
const WINDOW_UNMINIMIZE_OPACITY_EASING = theme.animation.windowEasing;
export const TILE_ANIMATION_DURATION = theme.animation.layoutDuration;
const WORKSPACE_SWITCH_ANIMATION_DURATION = theme.animation.workspaceDuration;
const WORKSPACE_GESTURE_FINGERS = 3;
const WORKSPACE_GESTURE_AXIS_LOCK_PX = 8;
const WORKSPACE_GESTURE_THRESHOLD_RATIO = 0.22;
const WORKSPACE_GESTURE_VELOCITY_THRESHOLD = 900;
const TILE_DRAG_WORKSPACE_EDGE_PX = 80;
const TILE_DRAG_WORKSPACE_SWITCH_INTERVAL_MS = 420;
const TILE_DRAG_TARGET_INSET_PX = 12;
export const TILE_GAP = theme.metrics.innerGap;
const MANAGED_WINDOW_ONLY_REBUILD_SUPPRESSION = {
  allowManagedWindowOnly: true,
  onViolation: "fallback-last",
} as const;
const STRICT_MANAGED_WINDOW_ONLY_REBUILD_SUPPRESSION = {
  allowManagedWindowOnly: true,
  onViolation: "fallback",
} as const;
const MANAGED_WINDOW_ONLY_ANIMATION = {
  suppressSSDRebuild: true,
} as const;

export function tileDragTargetAtPointer(
  targets: ReadonlyMap<string, { rect: TileRect; index: number }>,
  pointerX: number,
  pointerY: number,
): { windowId: string; index: number } | null {
  for (const [windowId, { rect, index }] of targets) {
    const insetX = Math.min(TILE_DRAG_TARGET_INSET_PX, rect.width / 4);
    const insetY = Math.min(TILE_DRAG_TARGET_INSET_PX, rect.height / 4);
    if (
      pointerX >= rect.x + insetX &&
      pointerX <= rect.x + rect.width - insetX &&
      pointerY >= rect.y + insetY &&
      pointerY <= rect.y + rect.height - insetY
    ) {
      return { windowId, index };
    }
  }
  return null;
}

export function tileDropZoneAtPointer(
  rect: TileRect,
  pointerX: number,
  pointerY: number,
): TileDropZone | null {
  const insetX = Math.min(TILE_DRAG_TARGET_INSET_PX, rect.width / 4);
  const insetY = Math.min(TILE_DRAG_TARGET_INSET_PX, rect.height / 4);
  if (
    pointerX < rect.x + insetX ||
    pointerX > rect.x + rect.width - insetX ||
    pointerY < rect.y + insetY ||
    pointerY > rect.y + rect.height - insetY
  ) return null;
  const x = (pointerX - rect.x) / rect.width;
  const y = (pointerY - rect.y) / rect.height;
  if (x < 0.3 && y >= 0.3 && y <= 0.7) return "left";
  if (x > 0.7 && y >= 0.3 && y <= 0.7) return "right";
  if (y < 0.3) return "top";
  if (y > 0.7) return "bottom";
  return "center";
}

// Windows-style edge snapping for floating drags. Distances are logical px.
//   - within SNAP_EDGE_PX of an edge triggers that edge's zone
//   - within SNAP_CORNER_PX of a corner (along both axes) triggers a quarter
//   - SNAP_GAP_PX is the gap left between adjacent halves/quarters
const SNAP_EDGE_PX = 16;
const SNAP_CORNER_PX = 140;
const SNAP_GAP_PX = 8;

/** Monitor-local logical rect (relative to the monitor origin) for the bar. */
export interface SnapPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapPreviewPayload {
  monitor: string;
  rect: SnapPreviewRect | null;
  kind: "floating" | "tiling";
  zone?: TileDropZone;
  style?: typeof theme.dropIndicator;
}

export type SnapPreviewBroadcaster = (preview: SnapPreviewPayload) => void;
export type WorkspaceChangeBroadcaster = () => void;

type LayoutSnapZone = Exclude<SnapZone, "maximize">;

function markWindowCompositionDirty(window: WaylandWindow): void {
  markWindowDirty(window.id);
}

interface LayoutOptions {
  suppressSSDRebuild?: boolean;
  animate?: boolean;
  preserveMissingActive?: boolean;
  cancelRectAnimations?: boolean;
}

interface HybridWindowManagerSnapshot {
  currentMonitor: string;
  activeWorkspaceByMonitor: [string, number][];
  workspaces: WorkspaceSnapshot[];
}

interface WorkspaceSnapshot {
  monitor: string;
  index: number;
  activeWindowId: string | null;
  tileTree: TileNode | null;
  windows: WorkspaceWindowSnapshot[];
}

interface WorkspaceWindowSnapshot {
  id: string;
  floatingRect?: ManagedWindowRect | null;
  restoreRect?: ManagedWindowRect | null;
  snapZone?: SnapZone | null;
  snapMonitor?: string | null;
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
  fullscreenRestoreRect?: ManagedWindowRect | null;
  forceFloating: boolean;
}

/**
 * Compact, serializable view of the workspace layout for external clients
 * (e.g. the bar) consumed over the IPC transport. Per-monitor so a per-output
 * bar can render just its own workspaces.
 */
export interface WorkspacesViewWindow {
  id: string;
  appId?: string;
  title: string;
  focused: boolean;
  /** epoch ms — most recent focus time for MRU ordering. 0 if never focused. */
  lastFocusedAt: number;
}

export interface WorkspacesViewWorkspace {
  index: number;
  windowCount: number;
  active: boolean;
  windows: WorkspacesViewWindow[];
}

export interface WorkspacesViewMonitor {
  name: string;
  active: number;
  workspaces: WorkspacesViewWorkspace[];
}

export interface WorkspacesView {
  currentMonitor: string;
  monitors: WorkspacesViewMonitor[];
}

interface WorkspaceGestureState {
  monitor: string;
  currentIndex: number;
  direction: -1 | 1;
  distance: number;
  fromWorkspace: Workspace;
  toWorkspace: Workspace | null;
  fromOffsetY: number;
  toOffsetY: number;
  fromOpacity: number;
  toOpacity: number;
}

export interface WorkspaceGestureSpeedConfig {
  /**
   * Vertical three-finger swipe movement multiplier for workspace switching.
   */
  workspaceSwitchFactor?: number;
  /**
   * Vertical release velocity multiplier for deciding whether to commit a
   * workspace switch. Defaults to workspaceSwitchFactor when omitted.
   */
  workspaceSwitchVelocityFactor?: number;
}

interface ResolvedWorkspaceGestureSpeedConfig {
  workspaceSwitchFactor: number;
  workspaceSwitchVelocityFactor: number;
}

const DEFAULT_WORKSPACE_GESTURE_SPEED: ResolvedWorkspaceGestureSpeedConfig = {
  workspaceSwitchFactor: 1,
  workspaceSwitchVelocityFactor: 1,
};

function hotReloadDebugEnabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string> } })
    .process?.env;
  const value = env?.SHOJI_HOT_RELOAD_DEBUG;
  return value !== undefined && value !== "" && value !== "0";
}

function hotReloadDebug(
  message: string,
  details: Record<string, unknown> = {},
): void {
  if (!hotReloadDebugEnabled()) {
    return;
  }
  console.info(`hot-reload ${message}`, JSON.stringify(details));
}

function layoutDebugEnabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string> } })
    .process?.env;
  const value = env?.SHOJI_LAYOUT_DEBUG;
  return value !== undefined && value !== "" && value !== "0";
}

function layoutDebug(message: string, details: Record<string, unknown> = {}): void {
  if (layoutDebugEnabled()) console.info(`[layout] ${message}`, JSON.stringify(details));
}

function sanitizeGestureSpeedFactor(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

const OPEN_ANIMATION_CHANNEL = "window.open";
const CLOSE_ANIMATION_CHANNEL = "window.close";
const MINIMIZE_ANIMATION_CHANNEL = "window.minimize";
const WORKSPACE_VISUAL_ANIMATION_CHANNEL = "workspace.visual";
const WORKSPACE_VISUAL_RECT_ANIMATION_CHANNEL = `${WORKSPACE_VISUAL_ANIMATION_CHANNEL}.rect`;
const WORKSPACE_VISUAL_OPACITY_ANIMATION_CHANNEL = `${WORKSPACE_VISUAL_ANIMATION_CHANNEL}.opacity`;
export const WINDOW_BORDER_PX = theme.metrics.borderWidth;
export const TITLEBAR_HEIGHT = theme.metrics.titlebarHeight;
export const MAXIMIZED_WINDOW_PADDING = {
  top: 8,
  right: 8,
  bottom: 8,
  left: 8,
};

export class HybridWindowManager {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly activeWorkspaceByMonitor = new Map<string, number>();
  private readonly windowStack = createWindowStack();
  private readonly naturalRootRect: (rect: WaylandWindow) => ManagedWindowRect;
  // Tracks MRU focus time per window id so the dock can pick "the most recent
  // window of an app" deterministically. Updated by recordFocus().
  private readonly lastFocusedAt = new Map<string, number>();
  private readonly lastFocusedWindowByWorkspace = new Map<string, string>();
  private focusedWindowId: string | null = null;
  private readonly pendingInitialFocusByWindowId = new Map<string, number>();
  private readonly tileabilityByWindowId = new Map<string, boolean>();
  private readonly tileabilitySubscriptionsByWindowId = new Map<
    string,
    () => void
  >();
  private currentMonitor: string;
  private isGrabbing = false;
  private resizingWindowId: string | null = null;
  private tileDrag: {
    window: WaylandWindow;
    workspace: Workspace;
    lastWorkspaceSwitchAt: number;
  } | null = null;
  private floatingDrag: {
    window: WaylandWindow;
    workspace: Workspace;
    lastWorkspaceSwitchAt: number;
  } | null = null;
  private maximizedMoveDrag: {
    windowId: string;
    width: number;
    height: number;
  } | null = null;
  private workspaceGesture: WorkspaceGestureState | null = null;
  private workspaceGestureSpeed = { ...DEFAULT_WORKSPACE_GESTURE_SPEED };
  // Broadcasts the active snap-zone preview rect to external clients (the bar).
  private snapPreviewBroadcaster: SnapPreviewBroadcaster | null = null;
  private workspaceChangeBroadcaster: WorkspaceChangeBroadcaster | null = null;
  // Pending Windows-style snap decision for the in-flight floating drag.
  private floatingSnap: {
    windowId: string;
    monitor: string;
    zone: SnapZone;
    rect: ManagedWindowRect;
  } | null = null;

  public constructor(
    naturalRootRect: (rect: WaylandWindow) => ManagedWindowRect,
  ) {
    this.currentMonitor = "";
    this.naturalRootRect = naturalRootRect;
    this.syncWorkspaces();
  }

  public configureWorkspaceGestureSpeed(
    config: WorkspaceGestureSpeedConfig,
  ): void {
    const workspaceSwitchFactor = sanitizeGestureSpeedFactor(
      config.workspaceSwitchFactor,
      DEFAULT_WORKSPACE_GESTURE_SPEED.workspaceSwitchFactor,
    );
    this.workspaceGestureSpeed = {
      workspaceSwitchFactor,
      workspaceSwitchVelocityFactor: sanitizeGestureSpeedFactor(
        config.workspaceSwitchVelocityFactor,
        workspaceSwitchFactor,
      ),
    };
  }

  public onPointerMove(event: PointerMoveEvent) {
    this.syncWorkspaces();
    this.currentMonitor = event.outputName ?? this.currentMonitor;
    this.focusWindowAtPointerTarget(event.target, event.outputName);
  }

  public onGestureSwipe(event: GestureSwipeEvent) {
    if (event.fingers !== WORKSPACE_GESTURE_FINGERS) {
      return;
    }

    this.syncWorkspaces();

    if (event.phase === "begin") {
      this.workspaceGesture = null;
      this.currentMonitor = this.gestureMonitor(event);
      return;
    }

    if (event.phase === "update") {
      const absX = Math.abs(event.totalX);
      const absY = Math.abs(event.totalY * this.workspaceGestureSpeed.workspaceSwitchFactor);
      if (Math.max(absX, absY) >= WORKSPACE_GESTURE_AXIS_LOCK_PX && absY >= absX) {
        this.updateWorkspaceGesture(event);
      }
      return;
    }

    this.finishWorkspaceGesture(event);
  }

  public onOutputChange(event: OutputChangeEvent) {
    const liveMonitors = new Set(
      event.outputs
        .filter((output) => output.enabled)
        .map((output) => output.name),
    );
    if (liveMonitors.size === 0) {
      return;
    }

    const fallbackMonitor =
      (this.currentMonitor && liveMonitors.has(this.currentMonitor)
        ? this.currentMonitor
        : undefined) ?? Array.from(liveMonitors)[0];
    if (!fallbackMonitor) {
      return;
    }

    const orphanedWorkspaces = Array.from(this.workspaces.values()).filter(
      (workspace) => !liveMonitors.has(workspace.monitor),
    );
    if (orphanedWorkspaces.length === 0) {
      this.syncWorkspaces();
      this.refreshUsableAreaLayouts();
      return;
    }

    const orphanedActiveWorkspaceByMonitor = new Map(
      Array.from(this.activeWorkspaceByMonitor.entries()).filter(
        ([monitor]) => !liveMonitors.has(monitor),
      ),
    );

    for (const monitor of Array.from(this.activeWorkspaceByMonitor.keys())) {
      if (!liveMonitors.has(monitor)) {
        this.activeWorkspaceByMonitor.delete(monitor);
      }
    }

    for (const workspace of orphanedWorkspaces) {
      const oldKey = workspaceKey(workspace.monitor, workspace.index);
      this.workspaces.delete(oldKey);

      if (workspace.windowCount() === 0) {
        continue;
      }

      const targetMonitor = fallbackMonitor;
      const wasActiveOnRemovedMonitor =
        orphanedActiveWorkspaceByMonitor.get(workspace.monitor) ===
        workspace.index;
      const targetIndex = this.availableWorkspaceIndex(
        targetMonitor,
        workspace.index,
      );
      if (targetIndex === undefined) {
        const target = this.ensureWorkspace(
          targetMonitor,
          Math.max(1, Math.min(WORKSPACES_PER_MONITOR, workspace.index)),
        );
        for (const window of workspace.listWindows()) {
          const moved = workspace.takeWindowForMove(window);
          if (moved) target.addMovedWindow(moved.window, moved.snapshot);
        }
        if (wasActiveOnRemovedMonitor) {
          this.activeWorkspaceByMonitor.set(targetMonitor, target.index);
        }
        target.applyLayout({ suppressSSDRebuild: false, animate: false });
        continue;
      }
      workspace.moveToMonitor(targetMonitor, targetIndex);
      this.workspaces.set(workspaceKey(targetMonitor, targetIndex), workspace);
      if (
        wasActiveOnRemovedMonitor ||
        !this.activeWorkspaceByMonitor.has(targetMonitor)
      ) {
        this.activeWorkspaceByMonitor.set(targetMonitor, targetIndex);
      }
      workspace.setVisible(workspace.isActive());
      workspace.applyLayout({
        suppressSSDRebuild: false,
        animate: false,
        preserveMissingActive: true,
      });
    }

    if (!liveMonitors.has(this.currentMonitor)) {
      this.currentMonitor = fallbackMonitor;
    }
    this.syncWorkspaces();
    this.refreshUsableAreaLayouts();
    this.syncWorkspaceVisibility();
  }

  public onOpen(window: WaylandWindow) {
    this.trackWindowTileability(window);
    window.focus();
    this.windowStack.add(window);

    window.setCloseAnimationDuration(theme.animation.closeDuration);
  }

  private trackWindowTileability(window: WaylandWindow) {
    this.untrackWindowTileability(window.id);
    this.tileabilityByWindowId.set(
      window.id,
      window.isResizable.peek() && !window.isTransient.peek(),
    );

    const onChange = () => {
      const wasTileable = this.tileabilityByWindowId.get(window.id);
      const isTileable =
        window.isResizable.peek() && !window.isTransient.peek();
      if (wasTileable === undefined || wasTileable === isTileable) {
        return;
      }

      this.tileabilityByWindowId.set(window.id, isTileable);
      if (!isTileable) {
        this.pendingInitialFocusByWindowId.delete(window.id);
      }
      const workspace = this.findWorkspaceForWindow(window);
      if (!workspace) {
        return;
      }

      workspace.reclassifyWindow(window, wasTileable);
      this.applyWorkspaceStackPolicy(workspace);
    };

    const unsubscribeResizable = window.isResizable.subscribe(onChange);
    const unsubscribeTransient = window.isTransient.subscribe(onChange);
    this.tileabilitySubscriptionsByWindowId.set(window.id, () => {
      unsubscribeResizable();
      unsubscribeTransient();
    });
  }

  private untrackWindowTileability(windowId: string) {
    this.tileabilitySubscriptionsByWindowId.get(windowId)?.();
    this.tileabilitySubscriptionsByWindowId.delete(windowId);
    this.tileabilityByWindowId.delete(windowId);
  }

  public dispose() {
    for (const unsubscribe of this.tileabilitySubscriptionsByWindowId.values()) {
      unsubscribe();
    }
    this.tileabilitySubscriptionsByWindowId.clear();
    this.tileabilityByWindowId.clear();
    this.deferredInitialLayoutWindowIds.clear();
  }

  private readonly restoredDuringInitialConfigure = new Set<string>();
  private readonly deferredInitialLayoutWindowIds = new Set<string>();

  private initializeWindowLayout(
    window: WaylandWindow,
  ): {
    workspace: Workspace | undefined;
    restoredExistingWindow: boolean;
  } {
    const existingWorkspace = this.findWorkspaceForWindow(window);
    if (existingWorkspace) {
      return {
        workspace: existingWorkspace,
        restoredExistingWindow: this.restoredDuringInitialConfigure.has(
          window.id,
        ),
      };
    }

    let restoredExistingWindow = false;
    const workspace =
      this.findWorkspaceRestoringWindow(window) ?? this.getCurrentWorkspace();
    if (workspace) {
      restoredExistingWindow = workspace.addWindow(window);
      if (
        !restoredExistingWindow &&
        workspace.shouldTile(window)
      ) {
        this.trackPendingInitialFocus(window);
      }
      this.applyWorkspaceStackPolicy(workspace);
      this.syncWorkspaceVisibility();
    } else {
      window.state[WINDOW_STATE_RECT].set(this.naturalRootRect(window));
    }

    if (window.isMaximized()) {
      window.state[WINDOW_STATE_RESTORE_RECT].set(
        this.initialRestoreRectForMaximizedWindow(window),
      );
      window.state[WINDOW_STATE_RECT].set(this.maximizedRectForWindow(window));
      window.state[WINDOW_STATE_MAXIMIZED].set(true);
    }

    if (restoredExistingWindow) {
      this.restoredDuringInitialConfigure.add(window.id);
    }
    return { workspace, restoredExistingWindow };
  }

  public onInitialConfigure(window: WaylandWindow) {
    if (this.shouldDeferInitialWindowLayout(window)) {
      this.deferredInitialLayoutWindowIds.add(window.id);
      return;
    }

    this.deferredInitialLayoutWindowIds.delete(window.id);
    const { workspace, restoredExistingWindow } =
      this.initializeWindowLayout(window);
    hotReloadDebug("hybrid-initial-configure", {
      windowId: window.id,
      title: window.title.peek(),
      workspace: workspace
        ? { monitor: workspace.monitor, index: workspace.index }
        : null,
      restoredExistingWindow,
      rect: window.state[WINDOW_STATE_RECT](),
    });
  }

  private shouldDeferInitialWindowLayout(window: WaylandWindow): boolean {
    if (this.findWorkspaceRestoringWindow(window)) {
      return false;
    }

    // Maximized/fullscreen windows need an output-sized initial configure.
    if (window.isMaximized.peek() || window.isFullscreen.peek()) {
      return false;
    }

    // A floating window must commit its natural client size before it can be
    // centered. Using the pre-commit geometry here feeds the degenerate-size
    // fallback into the initial configure and makes fixed-size dialogs huge.
    if (!window.isResizable.peek() || window.isTransient.peek()) {
      return true;
    }

    // With no min/max constraints, Wayland cannot yet distinguish an
    // unconstrained tiled window from a client that will declare a fixed size
    // on its first frame.
    return !this.hasInitialTileabilityDecision(window);
  }

  private hasInitialTileabilityDecision(window: WaylandWindow): boolean {
    const constraints = window.sizeConstraints.peek();
    return constraints.min != null || constraints.max != null;
  }

  public snapshot(): HybridWindowManagerSnapshot {
    const snapshot = {
      currentMonitor: this.currentMonitor,
      activeWorkspaceByMonitor: Array.from(
        this.activeWorkspaceByMonitor.entries(),
      ),
      workspaces: Array.from(this.workspaces.values()).map((workspace) =>
        workspace.snapshot(),
      ),
    };
    hotReloadDebug("hybrid-snapshot", {
      currentMonitor: snapshot.currentMonitor,
      workspaceCount: snapshot.workspaces.length,
      workspaces: snapshot.workspaces.map((workspace) => ({
        monitor: workspace.monitor,
        index: workspace.index,
        activeWindowId: workspace.activeWindowId,
        windowIds: workspace.windows.map((window) => window.id),
      })),
    });
    return snapshot;
  }

  public restore(snapshot: HybridWindowManagerSnapshot) {
    hotReloadDebug("hybrid-restore", {
      currentMonitor: snapshot.currentMonitor,
      workspaceCount: snapshot.workspaces.length,
      workspaces: snapshot.workspaces.map((workspace) => ({
        monitor: workspace.monitor,
        index: workspace.index,
        activeWindowId: workspace.activeWindowId,
        windowIds: workspace.windows.map((window) => window.id),
      })),
    });
    this.currentMonitor = snapshot.currentMonitor;
    this.lastFocusedWindowByWorkspace.clear();
    this.activeWorkspaceByMonitor.clear();
    for (const [monitor, index] of snapshot.activeWorkspaceByMonitor) {
      this.activeWorkspaceByMonitor.set(monitor, index);
    }
    this.workspaces.clear();
    for (const workspaceSnapshot of snapshot.workspaces) {
      const workspace = this.ensureWorkspace(
        workspaceSnapshot.monitor,
        workspaceSnapshot.index,
      );
      workspace.restore(workspaceSnapshot);
    }
  }

  public onFirstCommit(window: WaylandWindow) {
    if (!this.tileabilityByWindowId.has(window.id)) {
      this.trackWindowTileability(window);
    }
    if (!this.windowStack.has(window)) {
      this.windowStack.add(window, { at: "back" });
    }
    window.setCloseAnimationDuration(theme.animation.closeDuration);

    this.deferredInitialLayoutWindowIds.delete(window.id);
    const initialized = this.initializeWindowLayout(window);
    const restoredDuringInitialConfigure =
      this.restoredDuringInitialConfigure.delete(window.id);
    const restoredExistingWindow =
      initialized.restoredExistingWindow || restoredDuringInitialConfigure;
    const workspace = initialized.workspace;
    if (!restoredExistingWindow) {
      scheduleOpenAnimation(window);
    }
    hotReloadDebug("hybrid-first-commit", {
      windowId: window.id,
      title: window.title.peek(),
      workspace: workspace
        ? { monitor: workspace.monitor, index: workspace.index }
        : null,
      restoredExistingWindow,
      scheduledOpenAnimation: !restoredExistingWindow,
    });
  }

  public onStartClose(window: WaylandWindow) {
    scheduleCloseAnimation(window);
    if (this.resizingWindowId === window.id) {
      this.resizingWindowId = null;
      this.isGrabbing = false;
    }
    if (this.focusedWindowId === window.id) this.focusedWindowId = null;
    this.removeWindowFromFocusHistory(window.id);

    for (const workspace of this.workspaces.values()) {
      const nextFocus = workspace.removeWindow(window);
      if (nextFocus !== undefined) {
        workspace.applyLayout();
        nextFocus?.focus();
        break;
      }
    }
    this.syncWorkspaceVisibility();
  }

  public onClose(window: WaylandWindow) {
    if (this.focusedWindowId === window.id) this.focusedWindowId = null;
    this.removeWindowFromFocusHistory(window.id);
    this.lastFocusedAt.delete(window.id);
    this.restoredDuringInitialConfigure.delete(window.id);
    this.deferredInitialLayoutWindowIds.delete(window.id);
    this.pendingInitialFocusByWindowId.delete(window.id);
    this.untrackWindowTileability(window.id);
    this.windowStack.remove(window);
    for (const workspace of this.workspaces.values()) {
      if (workspace.removeWindow(window) !== undefined) {
        workspace.applyLayout();
      }
    }
    this.syncWorkspaceVisibility();
    // `window.state[...]` (used for e.g. WINDOW_STATE_RECT, minimized, etc.)
    // is backed by a module-level `signalsByWindowId` map in window-state.ts
    // keyed by window id. Nothing else clears that entry when a window
    // closes, so every window ever opened accumulates its own permanent
    // entry there for the lifetime of the compositor process. This doesn't
    // explain GPU/VRAM growth (that's the native closing-snapshot leak,
    // fixed on the Rust side), but it's the same class of bug on the JS
    // heap and should be cleaned up alongside it.
    dropWindowState(window.id);
  }

  public onFocus(window: WaylandWindow, focused: boolean) {
    const workspace = this.findWorkspaceForWindow(window);
    if (focused) {
      this.focusedWindowId = window.id;
      if (workspace) {
        this.currentMonitor = workspace.monitor;
        this.lastFocusedWindowByWorkspace.set(
          workspaceKey(workspace.monitor, workspace.index),
          window.id,
        );
      }
      this.windowStack.raise(window);
      if (this.shouldDeferFocusLayoutForInitialOpen(window, workspace)) {
        this.applyWorkspaceStackPolicy(workspace);
        return;
      }
      if (workspace?.isActive()) {
        workspace.focusWindow(window);
        this.applyWorkspaceStackPolicy(workspace);
      }
    } else if (this.focusedWindowId === window.id) {
      this.focusedWindowId = null;
    }
  }

  public onWindowResize(event: WindowResizeEvent) {
    if (!read(event.window.isResizable)) {
      return;
    }

    const workspace = this.findWorkspaceForWindow(event.window);
    if (event.phase === "start") {
      this.isGrabbing = true;
      this.resizingWindowId = event.window.id;
      this.currentMonitor = event.outputName ?? workspace?.monitor ?? this.currentMonitor;
      if (this.windowStack.has(event.window)) this.windowStack.raise(event.window);
      event.window.focus();
    }
    if (event.phase === "end" || event.phase === "cancel") {
      this.isGrabbing = false;
      this.resizingWindowId = null;
    }
    if (workspace?.shouldTile(event.window)) {
      workspace.resizeTile(event);
      this.applyWorkspaceStackPolicy(workspace);
      return;
    }

    if (event.phase === "start" || event.phase === "update") {
      this.beginInteractiveUnmaximize(event.window);
    }

    const nextRect = this.constrainResizeRect(event);
    stopRectAnimation(event.window, WINDOW_STATE_RECT);
    event.window.state[WINDOW_STATE_RECT].set(nextRect);
    workspace?.syncFloatingWindowRect(event.window, nextRect);
    this.applyWorkspaceStackPolicy(workspace);
  }

  public onWindowMove(event: WindowMoveEvent) {
    const workspace = this.findWorkspaceForWindow(event.window);
    if (workspace?.shouldTile(event.window)) {
      this.onTileWindowMove(event, workspace);
      this.applyWorkspaceStackPolicy(workspace);
      return;
    }

    if (workspace) {
      this.onFloatingWindowMove(event, workspace);
      return;
    }

    const window = event.window;
    if (event.phase === "start" && window.state[WINDOW_STATE_MAXIMIZED]()) {
      const restoreRect =
        window.state[WINDOW_STATE_RESTORE_RECT]() ?? event.currentRect;
      this.maximizedMoveDrag = {
        windowId: window.id,
        width: read(restoreRect.width),
        height: read(restoreRect.height),
      };
      this.beginInteractiveUnmaximize(window);
    }
    if (event.phase === "start") {
      this.isGrabbing = true;
      this.clearWindowSnapState(window);
    }

    const maximizedMoveDrag =
      this.maximizedMoveDrag?.windowId === window.id
        ? this.maximizedMoveDrag
        : null;
    if (maximizedMoveDrag) {
      const nextRect = this.restoreRectForMaximizedMove(
        event,
        maximizedMoveDrag.width,
        maximizedMoveDrag.height,
      );
      if (event.phase === "start") {
        playRectAnimation(
          window,
          WINDOW_STATE_RECT,
          nextRect,
          WINDOW_MANAGEMENT_EASING,
          UNMAXIMIZE_GRAB_ANIMATION_DURATION,
        );
      } else {
        stopRectAnimation(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(nextRect);
      }
      if (event.phase === "end") {
        this.isGrabbing = false;
        this.maximizedMoveDrag = null;
        this.finishFloatingDragSnap(event, workspace);
      } else if (event.phase === "cancel") {
        this.isGrabbing = false;
        this.maximizedMoveDrag = null;
        this.finishFloatingDragSnap(event, workspace);
      } else {
        this.updateFloatingDragSnap(event);
      }
      return;
    }

    if (event.phase === "end" || event.phase === "cancel") {
      this.isGrabbing = false;
      const snapped = this.finishFloatingDragSnap(event, workspace);
      if (!snapped) {
        stopRectAnimation(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(event.currentRect);
      }
      this.applyWorkspaceStackPolicy(workspace);
      return;
    }

    this.updateFloatingDragSnap(event);
    stopRectAnimation(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(event.currentRect);
    this.applyWorkspaceStackPolicy(workspace);
  }

  private onFloatingWindowMove(event: WindowMoveEvent, workspace: Workspace) {
    const window = event.window;
    if (
      event.phase === "start" ||
      !this.floatingDrag ||
      this.floatingDrag.window.id !== window.id
    ) {
      this.isGrabbing = true;
      this.floatingDrag = {
        window,
        workspace,
        lastWorkspaceSwitchAt: event.timestamp,
      };
      if (window.state[WINDOW_STATE_MAXIMIZED]()) {
        const restoreRect =
          window.state[WINDOW_STATE_RESTORE_RECT]() ?? event.currentRect;
        this.maximizedMoveDrag = {
          windowId: window.id,
          width: read(restoreRect.width),
          height: read(restoreRect.height),
        };
        this.beginInteractiveUnmaximize(window);
      }
      this.clearWindowSnapState(window);
    }

    const drag = this.floatingDrag;
    if (!drag) {
      return;
    }

    const maximizedMoveDrag =
      this.maximizedMoveDrag?.windowId === window.id
        ? this.maximizedMoveDrag
        : null;
    const nextRect: ManagedWindowRect = maximizedMoveDrag
      ? this.restoreRectForMaximizedMove(
          event,
          maximizedMoveDrag.width,
          maximizedMoveDrag.height,
        )
      : event.currentRect;

    if (maximizedMoveDrag && event.phase === "start") {
      playRectAnimation(
        window,
        WINDOW_STATE_RECT,
        nextRect,
        WINDOW_MANAGEMENT_EASING,
        UNMAXIMIZE_GRAB_ANIMATION_DURATION,
      );
    } else {
      stopRectAnimation(window, WINDOW_STATE_RECT);
      window.state[WINDOW_STATE_RECT].set(nextRect);
    }

    if (event.phase !== "cancel") {
      const targetWorkspace = this.workspaceForFloatingDrag(event, drag);
      if (targetWorkspace !== drag.workspace) {
        drag.workspace.removeFloatingWindow(window);
        drag.workspace.applyLayout();
        if (targetWorkspace.shouldTile(window)) {
          this.clearFloatingSnapPreview();
          targetWorkspace.adoptTileDragWindow(window, nextRect);
          drag.workspace = targetWorkspace;
          this.floatingDrag = null;
          this.tileDrag = {
            window,
            workspace: targetWorkspace,
            lastWorkspaceSwitchAt: event.timestamp,
          };
          this.syncWorkspaceVisibility();
          targetWorkspace.updateTileDrag(
            window,
            nextRect,
            event.currentPointer.x,
            event.currentPointer.y,
          );
          this.emitSnapPreview(
            targetWorkspace.monitor,
            targetWorkspace.tileDragPreviewRect(),
            "tiling",
            targetWorkspace.tileDragZone() ?? undefined,
          );
          this.applyWorkspaceStackPolicy(targetWorkspace);
          if (event.phase === "end") {
            targetWorkspace.endTileDrag(window, false);
            this.tileDrag = null;
            this.maximizedMoveDrag = null;
            this.isGrabbing = false;
          }
          window.focus();
          return;
        }
        targetWorkspace.adoptFloatingWindow(window, nextRect);
        drag.workspace = targetWorkspace;
        this.syncWorkspaceVisibility();
        window.focus();
      } else {
        targetWorkspace.syncFloatingWindowRect(window, nextRect);
      }

      this.applyWorkspaceStackPolicy(targetWorkspace);
      this.updateFloatingDragSnap(event);
    }

    if (event.phase === "end" || event.phase === "cancel") {
      const snapped = this.finishFloatingDragSnap(event, drag.workspace);
      if (!snapped) {
        stopRectAnimation(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(nextRect);
        drag.workspace.syncFloatingWindowRect(window, nextRect);
      }
      this.applyWorkspaceStackPolicy(drag.workspace);
      this.floatingDrag = null;
      if (maximizedMoveDrag) {
        this.maximizedMoveDrag = null;
      }
      this.isGrabbing = false;
    }
  }

  private onTileWindowMove(event: WindowMoveEvent, workspace: Workspace) {
    const window = event.window;
    if (
      event.phase === "start" ||
      !this.tileDrag ||
      this.tileDrag.window.id !== window.id
    ) {
      this.isGrabbing = true;
      workspace.beginTileDrag(window, event.currentRect);
      this.tileDrag = {
        window,
        workspace,
        lastWorkspaceSwitchAt: event.timestamp,
      };
    }

    const drag = this.tileDrag;
    if (!drag) {
      return;
    }

    if (event.phase === "end" || event.phase === "cancel") {
      this.emitSnapPreview(drag.workspace.monitor, null, "tiling");
      drag.workspace.endTileDrag(window, event.phase === "cancel");
      this.tileDrag = null;
      this.isGrabbing = false;
      return;
    }

    let targetWorkspace = this.workspaceForTileDrag(event, drag);
    if (targetWorkspace !== drag.workspace) {
      this.emitSnapPreview(drag.workspace.monitor, null, "tiling");
      drag.workspace.removeTileDragWindow(window);
      drag.workspace.applyLayout();
      if (!targetWorkspace.shouldTile(window)) {
        window.state[WINDOW_STATE_TILE_DRAGGING].set(false);
        targetWorkspace.adoptFloatingWindow(window, event.currentRect);
        this.tileDrag = null;
        this.floatingDrag = {
          window,
          workspace: targetWorkspace,
          lastWorkspaceSwitchAt: event.timestamp,
        };
        this.syncWorkspaceVisibility();
        this.applyWorkspaceStackPolicy(targetWorkspace);
        this.updateFloatingDragSnap(event);
        return;
      }
      targetWorkspace.adoptTileDragWindow(window, event.currentRect);
      drag.workspace = targetWorkspace;
      this.syncWorkspaceVisibility();
    }

    targetWorkspace.updateTileDrag(
      window,
      event.currentRect,
      event.currentPointer.x,
      event.currentPointer.y,
    );
    this.emitSnapPreview(
      targetWorkspace.monitor,
      targetWorkspace.tileDragPreviewRect(),
      "tiling",
      targetWorkspace.tileDragZone() ?? undefined,
    );
  }

  public onWindowMaximizeRequest(event: WindowMaximizeRequestEvent) {
    const workspace = this.findWorkspaceForWindow(event.window);
    if (this.isGrabbing) {
      return;
    }

    const window = event.window;
    window.state[WINDOW_STATE_MINIMIZED].set(false);
    this.clearWindowSnapState(window);

    if (workspace?.shouldTile(window)) {
      if (!event.maximized) {
        window.state[WINDOW_STATE_RESTORE_RECT].set(null);
        window.state[WINDOW_STATE_MAXIMIZED].set(false);
        workspace.applyLayout();
        this.applyWorkspaceStackPolicy(workspace);
        return;
      }

      window.state[WINDOW_STATE_RESTORE_RECT].set(null);
      window.state[WINDOW_STATE_MAXIMIZED].set(true);
      // Reapply even when this tile is already active.
      workspace.panToWindow(window);
      this.applyWorkspaceStackPolicy(workspace);
      window.focus();
      return;
    }

    if (!event.maximized) {
      const restoreRect = window.state[WINDOW_STATE_RESTORE_RECT]();
      if (restoreRect) {
        workspace?.syncFloatingWindowRect(window, restoreRect);
        playRectAnimation(
          window,
          WINDOW_STATE_RECT,
          restoreRect,
          WINDOW_MANAGEMENT_EASING,
          WINDOW_MANAGEMENT_ANIMATION_DURATION,
        );
      }
      window.state[WINDOW_STATE_RESTORE_RECT].set(null);
      window.state[WINDOW_STATE_MAXIMIZED].set(false);
      return;
    }

    if (!window.state[WINDOW_STATE_MAXIMIZED]()) {
      const currentRect = window.state[WINDOW_STATE_RECT]();
      const currentWidth = read(currentRect.width);
      const currentHeight = read(currentRect.height);
      if (currentWidth > 1 && currentHeight > 1) {
        window.state[WINDOW_STATE_RESTORE_RECT].set(currentRect);
      }
    }
    const maximizedRect = this.maximizedRectForWindow(window);
    workspace?.syncFloatingWindowRect(window, maximizedRect);
    playRectAnimation(
      window,
      WINDOW_STATE_RECT,
      maximizedRect,
      WINDOW_MANAGEMENT_EASING,
      WINDOW_MANAGEMENT_ANIMATION_DURATION,
    );
    window.state[WINDOW_STATE_MAXIMIZED].set(true);
    this.applyWorkspaceStackPolicy(workspace);
  }

  public onWindowMinimizeRequest(event: WindowMinimizeRequestEvent) {
    const wasMinimized = event.window.state[WINDOW_STATE_MINIMIZED]();
    const workspace = this.findWorkspaceForWindow(event.window);
    if (wasMinimized !== event.minimized) {
      stopRectAnimation(event.window, WINDOW_STATE_RECT);
      if (!event.minimized) {
        event.window.state[WINDOW_STATE_MINIMIZE_VISUAL_IDLE].set(false);
      }
      event.window.state[WINDOW_STATE_MINIMIZED].set(event.minimized);
      workspace?.setWindowMinimized(event.window, event.minimized);
      if (event.minimized) {
        event.window.state[WINDOW_STATE_MINIMIZE_VISUAL_IDLE].set(true);
      }
      markWindowCompositionDirty(event.window);
      scheduleMinimizeAnimation(event.window, event.minimized);
    }
    if (workspace) {
      if (!event.minimized && workspace.shouldTile(event.window)) {
        workspace.focusWindow(event.window);
      } else if (wasMinimized === event.minimized) {
        workspace.applyLayout();
      }
      this.applyWorkspaceStackPolicy(workspace);
    }
  }

  public onWindowActivateRequest(event: WindowActivateRequestEvent) {
    const wasMinimized = event.window.state[WINDOW_STATE_MINIMIZED]();
    if (wasMinimized) {
      this.onWindowMinimizeRequest({
        window: event.window,
        minimized: false,
        source:
          event.source === "xdg-activation" ||
          event.source === "xwayland" ||
          event.source === "keybind"
            ? event.source
            : "api",
        timestamp: event.timestamp,
      });
    }
    const workspace = this.findWorkspaceForWindow(event.window);
    if (workspace) {
      // If the window is on another workspace, switch with the same
      // slide/fade animation as keyboard/gesture switching (no-op if same).
      this.switchWorkspaceTo(workspace.monitor, workspace.index, {
        focusActiveAfter: false,
      });
    }
    // Focus the target window after switching (overrides switchWorkspaceTo's focusActiveWindow).
    event.window.focus();
  }

  public toggleFocusedWindowFullscreen() {
    const focused = this.focusedWorkspaceWindow();
    if (!focused) {
      return;
    }
    if (focused.window.state[WINDOW_STATE_FULLSCREEN]()) {
      focused.window.unfullscreen();
    } else {
      focused.window.fullscreen();
    }
  }

  public toggleFocusedWindowFloating() {
    withManagedWindowOnlySSDRebuildSuppressed(() => {
      const focused = this.focusedWorkspaceWindow();
      if (!focused || !read(focused.window.isResizable) || focused.window.isTransient()) {
        return;
      }
      const wasTileable = focused.workspace.shouldTile(focused.window);
      if (wasTileable && focused.window.state[WINDOW_STATE_MAXIMIZED]()) {
        focused.window.state[WINDOW_STATE_MAXIMIZED].set(false);
        focused.window.state[WINDOW_STATE_RESTORE_RECT].set(null);
        focused.window.unmaximize();
      }
      focused.window.state[WINDOW_STATE_FORCE_FLOATING].set(wasTileable);
      focused.workspace.reclassifyWindow(focused.window, wasTileable);
      this.applyWorkspaceStackPolicy(focused.workspace);
    });
  }

  public focusDirection(direction: WindowDirection) {
    const focused = this.focusedWorkspaceWindow();
    const workspace = focused?.workspace ?? this.getCurrentWorkspace();
    if (!workspace) {
      return;
    }
    if (workspace.focusDirection(direction)) {
      this.currentMonitor = workspace.monitor;
      this.applyWorkspaceStackPolicy(workspace);
      return;
    }

    const targetOutput = findOutputInDirection(
      this.outputRects(),
      workspace.monitor,
      direction,
    );
    if (!targetOutput) return;
    const targetWorkspace = this.workspaceForMonitor(targetOutput.name);
    if (!targetWorkspace) return;

    const focusedRect = focused
      ? numericRect(focused.window.state[WINDOW_STATE_RECT]())
      : this.outputRect(workspace.monitor);
    const sourceOutput = this.outputRect(workspace.monitor);
    const originRect = focusedRect && sourceOutput
      ? projectRectToOutputEdge(
          focusedRect,
          sourceOutput,
          targetOutput,
          direction,
        )
      : focusedRect;
    const candidate = originRect
      ? targetWorkspace.nearestTile(originRect)
      : undefined;
    const fallbackId = this.lastFocusedWindowByWorkspace.get(
      workspaceKey(targetWorkspace.monitor, targetWorkspace.index),
    );
    const next =
      candidate ??
      (fallbackId ? targetWorkspace.visibleWindowById(fallbackId) : undefined) ??
      targetWorkspace.commandWindow();
    if (next) {
      this.currentMonitor = targetOutput.name;
      targetWorkspace.focusWindow(next);
      next.focus();
    }
    this.applyWorkspaceStackPolicy(targetWorkspace);
  }

  public moveFocusedWindow(direction: WindowDirection) {
    withManagedWindowOnlySSDRebuildSuppressed(() => {
      const focused = this.focusedWorkspaceWindow();
      if (!focused) {
        return;
      }
      if (focused.workspace.shouldTile(focused.window)) {
        focused.workspace.swapFocusedTile(direction);
      } else {
        const step = 100;
        focused.workspace.moveFocusedFloatingWindow(
          direction === "left" ? -step : direction === "right" ? step : 0,
          direction === "up" ? -step : direction === "down" ? step : 0,
        );
      }
      this.applyWorkspaceStackPolicy(focused.workspace);
    });
  }

  public moveFocusedWindowToOutput(direction: WindowDirection) {
    withManagedWindowOnlySSDRebuildSuppressed(() => {
      this.syncWorkspaces();
      const focused = this.focusedWorkspaceWindow();
      if (!focused || this.isGrabbing) return;
      const { workspace: fromWorkspace, window } = focused;
      const targetOutput = findOutputInDirection(
        this.outputRects(),
        fromWorkspace.monitor,
        direction,
      );
      if (!targetOutput) return;
      const targetWorkspace = this.workspaceForMonitor(targetOutput.name);
      if (!targetWorkspace || targetWorkspace === fromWorkspace) return;
      if (targetWorkspace.hasWindow(window)) return;

      const sourceArea = fromWorkspace.usableRect();
      const targetArea = targetWorkspace.usableRect();
      const wasFloating = !fromWorkspace.shouldTile(window);
      const moved = fromWorkspace.takeWindowForMove(window);
      if (!moved) return;
      if (wasFloating) {
        const floatingRect = moveRectBetweenAreas(
          numericRect(
            moved.snapshot.floatingRect ??
              window.state[WINDOW_STATE_RECT](),
          ),
          sourceArea,
          targetArea,
        );
        moved.snapshot.floatingRect = floatingRect;
        if (moved.snapshot.restoreRect) {
          moved.snapshot.restoreRect = moveRectBetweenAreas(
            numericRect(moved.snapshot.restoreRect),
            sourceArea,
            targetArea,
          );
        }
        if (moved.snapshot.fullscreenRestoreRect) {
          moved.snapshot.fullscreenRestoreRect = moveRectBetweenAreas(
            numericRect(moved.snapshot.fullscreenRestoreRect),
            sourceArea,
            targetArea,
          );
        }
      }
      moved.snapshot.snapZone = null;
      moved.snapshot.snapMonitor = null;

      targetWorkspace.addMovedWindow(window, moved.snapshot);
      this.currentMonitor = targetOutput.name;
      this.removeWindowFromFocusHistory(window.id);
      this.lastFocusedWindowByWorkspace.set(
        workspaceKey(targetWorkspace.monitor, targetWorkspace.index),
        window.id,
      );
      fromWorkspace.applyLayout();
      targetWorkspace.applyLayout();
      targetWorkspace.focusWindow(window);
      window.focus();
      this.applyWorkspaceStackPolicy(fromWorkspace);
      this.applyWorkspaceStackPolicy(targetWorkspace);
      this.syncWorkspaceVisibility();
      this.workspaceChangeBroadcaster?.();
    });
  }

  public resizeFocusedWindow(deltaX: number, deltaY: number) {
    const focused = this.focusedWorkspaceWindow();
    if (!focused || !read(focused.window.isResizable)) {
      return;
    }
    focused.workspace.resizeFocusedWindow(deltaX, deltaY);
    this.applyWorkspaceStackPolicy(focused.workspace);
  }

  public activateCurrentMonitorWorkspace(index: number) {
    const monitor = monitorForWorkspace(index, this.getCurrentMonitorName());
    if (monitor) {
      this.switchWorkspaceTo(monitor, index);
    }
  }

  public moveFocusedWindowToWorkspace(direction: -1 | 1) {
    const focused = this.focusedWorkspaceWindow();
    if (!focused) {
      return;
    }
    this.moveFocusedWindowToWorkspaceIndex(focused.workspace.index + direction);
  }

  public moveFocusedWindowToWorkspaceIndex(targetIndex: number) {
    withManagedWindowOnlySSDRebuildSuppressed(() => {
      this.syncWorkspaces();
      if (targetIndex < 1 || targetIndex > WORKSPACES_PER_MONITOR) {
        return;
      }
      const focused = this.focusedWorkspaceWindow();
      if (!focused) {
        return;
      }
      const { workspace: fromWorkspace, window } = focused;
      if (targetIndex === fromWorkspace.index) {
        return;
      }

      const targetMonitor = monitorForWorkspace(targetIndex, fromWorkspace.monitor);
      const targetWorkspace = this.ensureWorkspace(targetMonitor, targetIndex);
      const moved = fromWorkspace.takeWindowForMove(window);
      if (!moved) {
        return;
      }

      targetWorkspace.addMovedWindow(window, moved.snapshot);
      fromWorkspace.applyLayout();
      targetWorkspace.applyLayout();
      this.switchWorkspaceTo(targetMonitor, targetIndex, {
        focusActiveAfter: false,
      });
      targetWorkspace.panToWindow(window);
      window.focus();
      this.applyWorkspaceStackPolicy(fromWorkspace);
      this.applyWorkspaceStackPolicy(targetWorkspace);
      this.syncWorkspaceVisibility();
    });
  }

  public closeFocusedWindow() {
    for (const workspace of this.workspaces.values()) {
      const focused = workspace.focusedWindow();
      if (focused) {
        focused.close();
        return;
      }
    }
  }

  public toggleFocusedWindowMaximize() {
    for (const workspace of this.workspaces.values()) {
      const focused = workspace.focusedWindow();
      if (!focused || !read(focused.isResizable)) {
        continue;
      }

      if (focused.state[WINDOW_STATE_MAXIMIZED]()) {
        focused.unmaximize();
      } else {
        focused.maximize();
      }
      return;
    }
  }

  public refreshUsableAreaLayouts() {
    this.syncWorkspaces();
    // While a window is being interactively dragged, do not re-apply the
    // usable-area layout. It would clobber the in-flight drag — most visibly,
    // a maximized window (which stays WINDOW_STATE_MAXIMIZED during the
    // unmaximize-grab) gets snapped back to its full rect, flashing maximized
    // whenever a layer surface mounts/unmounts (e.g. the snap-preview overlay).
    // The layout is re-applied by the next layout event once the drag ends.
    if (this.isGrabbing) {
      return;
    }
    for (const workspace of this.workspaces.values()) {
      workspace.refreshUsableAreaLayout();
      for (const window of workspace.listWindows()) {
        const zone = window.state[WINDOW_STATE_SNAP_ZONE]();
        const monitor = window.state[WINDOW_STATE_SNAP_MONITOR]();
        if (!isLayoutSnapZone(zone) || monitor !== workspace.monitor) continue;
        const rect = this.snapZoneRect(monitor, zone);
        if (!rect) continue;
        stopRectAnimation(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(rect);
        workspace.syncFloatingWindowRect(window, rect);
      }
    }
    this.syncWorkspaceVisibility();
  }

  public switchWorkspace(direction: -1 | 1) {
    const monitor = this.currentMonitor || COMPOSITOR.output.list.at(0);
    if (!monitor) {
      return;
    }
    const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    const targetIndex = this.nextWorkspaceIndex(monitor, currentIndex, direction);
    if (targetIndex !== undefined) {
      this.switchWorkspaceTo(monitor, targetIndex);
    }
  }

  /**
   * Animated switch to an explicit workspace index on a monitor. Direction is
   * inferred from the current index so the same vertical slide/fade transition
   * as keyboard/gesture switching plays (used by the IPC `workspaces.activate`).
   */
  public switchWorkspaceTo(
    monitor: string,
    targetIndex: number,
    options: { focusActiveAfter?: boolean } = {},
  ) {
    this.workspaceGesture = null;
    this.syncWorkspaces();
    if (
      !monitor ||
      targetIndex < 1 ||
      targetIndex > WORKSPACES_PER_MONITOR ||
      !workspaceBelongsToMonitor(targetIndex, monitor)
    ) {
      return;
    }

    const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    if (targetIndex === currentIndex) {
      return;
    }
    const direction: -1 | 1 = targetIndex > currentIndex ? 1 : -1;

    const fromWorkspace = this.ensureWorkspace(monitor, currentIndex);
    const toWorkspace = this.ensureWorkspace(monitor, targetIndex);
    const distance = this.workspaceTransitionDistance(monitor);

    this.activeWorkspaceByMonitor.set(monitor, targetIndex);
    this.currentMonitor = monitor;

    for (const workspace of this.workspaces.values()) {
      if (workspace === fromWorkspace || workspace === toWorkspace) {
        continue;
      }
      workspace.setVisible(workspace.isActive());
    }

    fromWorkspace.animateWorkspaceTransition({
      fromOffsetY: 0,
      toOffsetY: -direction * distance,
      fromOpacity: 1,
      toOpacity: 0,
      visibleAfter: false,
    });
    toWorkspace.prepareWorkspaceTransition(direction * distance, 0);
    toWorkspace.applyLayout();
    toWorkspace.animateWorkspaceTransition({
      fromOffsetY: direction * distance,
      toOffsetY: 0,
      fromOpacity: 0,
      toOpacity: 1,
      visibleAfter: true,
    });
    // Callers that explicitly want to focus a *different* window after the
    // transition (e.g. dock activation) opt out of the implicit focus so the
    // resulting onFocus callback chain does not stomp on their pan.
    if (options.focusActiveAfter !== false) {
      toWorkspace.focusActiveWindow();
    }
    this.applyWorkspaceStackPolicy(fromWorkspace);
    this.applyWorkspaceStackPolicy(toWorkspace);
    this.workspaceChangeBroadcaster?.();
  }

  public getCurrentWorkspace(): Workspace | undefined {
    this.syncWorkspaces();
    return (
      this.workspaceForMonitor(this.currentMonitor) ??
      this.workspaces.values().next().value
    );
  }

  /** Name (connector) of the monitor under the cursor; updated on pointer move. */
  public getCurrentMonitorName(): string {
    this.syncWorkspaces();
    return this.currentMonitor || COMPOSITOR.output.list.at(0) || "";
  }

  /**
   * Compact per-monitor workspace view for external clients (the bar) over IPC.
   */
  public viewForIpc(): WorkspacesView {
    this.syncWorkspaces();

    const byMonitor = new Map<string, WorkspacesViewWorkspace[]>();
    for (const workspace of this.workspaces.values()) {
      const active =
        this.activeWorkspaceByMonitor.get(workspace.monitor) ===
        workspace.index;
      const list = byMonitor.get(workspace.monitor) ?? [];
      const windows: WorkspacesViewWindow[] = workspace
        .listWindows()
        .map((window) => ({
          id: window.id,
          appId: window.appId(),
          title: window.title(),
          focused: window.isFocused(),
          lastFocusedAt: this.lastFocusedAt.get(window.id) ?? 0,
        }));
      list.push({
        index: workspace.index,
        windowCount: workspace.windowCount(),
        active,
        windows,
      });
      byMonitor.set(workspace.monitor, list);
    }

    const monitors: WorkspacesViewMonitor[] = COMPOSITOR.output.list.map(
      (name) => {
        const active = this.activeWorkspaceByMonitor.get(name) ?? 1;
        const workspaces = byMonitor.get(name) ?? [];
        if (!workspaces.some((workspace) => workspace.index === active)) {
          workspaces.push({
            index: active,
            windowCount: 0,
            active: true,
            windows: [],
          });
        }
        workspaces.sort((a, b) => a.index - b.index);
        return { name, active, workspaces };
      },
    );

    return { currentMonitor: this.currentMonitor, monitors };
  }

  /**
   * Update MRU stamp for `windowId`. The dock uses this to pick the "most
   * recently used" window per app for left-click focus.
   */
  public recordFocus(windowId: string) {
    this.lastFocusedAt.set(windowId, Date.now());
  }

  private trackPendingInitialFocus(window: WaylandWindow) {
    const token = Date.now();
    this.pendingInitialFocusByWindowId.set(window.id, token);
    setTimeout(() => {
      if (this.pendingInitialFocusByWindowId.get(window.id) === token) {
        this.pendingInitialFocusByWindowId.delete(window.id);
      }
    }, WINDOW_MANAGEMENT_ANIMATION_DURATION);
  }

  private shouldDeferFocusLayoutForInitialOpen(
    window: WaylandWindow,
    workspace: Workspace | undefined,
  ): boolean {
    if (!workspace || !workspace.isActive()) {
      return false;
    }
    if (this.pendingInitialFocusByWindowId.delete(window.id)) {
      return false;
    }
    for (const pendingWindowId of this.pendingInitialFocusByWindowId.keys()) {
      if (
        workspace.isActiveWindowId(pendingWindowId) &&
        workspace.findWindowById(pendingWindowId)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find a managed window by id by scanning every workspace. Used by the
   * `windows.activate` IPC handler to bridge bar clicks to focus + workspace
   * switch.
   */
  public findWindowById(windowId: string): WaylandWindow | undefined {
    for (const workspace of this.workspaces.values()) {
      const found = workspace.findWindowById(windowId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /** Every managed window across all workspaces (debug/IPC use). */
  public listWindows(): WaylandWindow[] {
    const windows: WaylandWindow[] = [];
    for (const workspace of this.workspaces.values()) {
      windows.push(...workspace.listWindows());
    }
    return windows;
  }

  /**
   * Activate window by id (dock-style "go to this window"). Plays a unified
   * sequence: unminimize → switch workspace (if different) → pan within the
   * workspace so the target is centered → focus. Doing the pan synchronously
   * here (instead of relying on the onFocus → focusWindow callback) gives the
   * same in-sync animation as `Super+Ctrl+Left/Right` and guarantees a visible
   * pan even when the target is already in the viewport.
   *
   * Returns true if the window existed.
   */
  public activateWindowById(windowId: string): boolean {
    const window = this.findWindowById(windowId);
    if (!window) {
      return false;
    }
    const workspace = this.findWorkspaceForWindow(window);
    if (!workspace) {
      return false;
    }

    if (window.state[WINDOW_STATE_MINIMIZED]()) {
      this.onWindowMinimizeRequest({
        window,
        minimized: false,
        source: "api",
        timestamp: Date.now(),
      });
    }

    // Cross-workspace: switch first with the existing slide/fade. Skip the
    // implicit focusActiveWindow — we explicitly focus the target below, and
    // letting switchWorkspaceTo focus the previous active would queue an
    // onFocus → focusWindow → applyLayout cycle that overrides our pan.
    this.switchWorkspaceTo(workspace.monitor, workspace.index, {
      focusActiveAfter: false,
    });

    // Always pan to the target inside the workspace (force-center even if it
    // is already on-screen). This is the "go to this window" gesture.
    workspace.panToWindow(window);

    // Focus last so it overrides switchWorkspaceTo's focusActiveWindow().
    window.focus();
    return true;
  }

  /**
   * Activate a specific workspace on a monitor (external/IPC entry point).
   * Plays the same slide/fade transition as keyboard/gesture switching.
   */
  public activate(monitor: string, index: number) {
    if (!monitor || index < 1 || index > WORKSPACES_PER_MONITOR) {
      return;
    }
    this.switchWorkspaceTo(monitorForWorkspace(index, monitor), index);
  }

  public getWindowZIndex(window: WaylandWindow): ReadonlySignal<number> {
    return this.windowStack.zIndex(window);
  }

  private beginInteractiveUnmaximize(window: WaylandWindow): boolean {
    if (!window.state[WINDOW_STATE_MAXIMIZED]()) {
      return false;
    }

    window.state[WINDOW_STATE_MAXIMIZED].set(false);
    window.state[WINDOW_STATE_RESTORE_RECT].set(null);
    this.clearWindowSnapState(window);
    window.unmaximize();
    return true;
  }

  private applyWorkspaceStackPolicy(workspace: Workspace | undefined) {
    if (!workspace) {
      return;
    }

    const floating = workspace
      .floatingWindows()
      .filter((window) => this.windowStack.has(window))
      .sort(
        (a, b) =>
          this.windowStack.zIndexValue(a) - this.windowStack.zIndexValue(b),
      );

    for (const window of floating) {
      this.windowStack.raise(window);
    }
  }

  private syncWorkspaces() {
    for (const monitor of COMPOSITOR.output.list) {
      if (!this.activeWorkspaceByMonitor.has(monitor)) {
        this.activeWorkspaceByMonitor.set(monitor, 1);
      }
      if (
        !workspaceBelongsToMonitor(
          this.activeWorkspaceByMonitor.get(monitor) ?? 1,
          monitor,
        )
      ) {
        this.activeWorkspaceByMonitor.set(monitor, 1);
      }
      for (let index = 1; index <= WORKSPACES_PER_MONITOR; index += 1) {
        if (workspaceBelongsToMonitor(index, monitor)) {
          this.ensureWorkspace(monitor, index);
        }
      }
    }

    if (
      !this.currentMonitor ||
      !COMPOSITOR.output.list.includes(this.currentMonitor)
    ) {
      this.currentMonitor = COMPOSITOR.output.list.includes(PRIMARY_MONITOR)
        ? PRIMARY_MONITOR
        : (COMPOSITOR.output.list.at(0) ?? "");
    }
  }

  private workspaceForMonitor(monitor: string): Workspace | undefined {
    if (!monitor) {
      return undefined;
    }
    return this.ensureWorkspace(
      monitor,
      this.activeWorkspaceByMonitor.get(monitor) ?? 1,
    );
  }

  private ensureWorkspace(monitor: string, index: number): Workspace {
    monitor = monitorForWorkspace(index, monitor);
    index = Math.max(1, Math.min(WORKSPACES_PER_MONITOR, index));
    const key = workspaceKey(monitor, index);
    let workspace = this.workspaces.get(key);
    if (!workspace) {
      workspace = new Workspace(
        index,
        monitor,
        this.naturalRootRect,
        (window) => this.maximizedRectForWindow(window, monitor),
        (monitor) => this.getActiveWorkspaceIndex(monitor),
      );
      this.workspaces.set(key, workspace);
    }
    return workspace;
  }

  private getActiveWorkspaceIndex(monitor: string): number {
    return this.activeWorkspaceByMonitor.get(monitor) ?? 1;
  }

  private nextWorkspaceIndex(
    monitor: string,
    currentIndex: number,
    direction: -1 | 1,
  ): number | undefined {
    for (
      let index = currentIndex + direction;
      index >= 1 && index <= WORKSPACES_PER_MONITOR;
      index += direction
    ) {
      if (workspaceBelongsToMonitor(index, monitor)) {
        return index;
      }
    }
    return undefined;
  }

  private focusedWorkspaceWindow(): { workspace: Workspace; window: WaylandWindow } | undefined {
    const current = this.getCurrentWorkspace();
    const active = Array.from(this.workspaces.values()).filter(
      (workspace) => workspace.isActive() && workspace !== current,
    );
    const candidates = current ? [current, ...active] : active;
    if (this.focusedWindowId) {
      for (const workspace of candidates) {
        const window = workspace.findWindowById(this.focusedWindowId);
        if (window && !window.state[WINDOW_STATE_MINIMIZED]()) return { workspace, window };
      }
    }
    return candidates
      .map((workspace) => ({ workspace, window: workspace.commandWindow() }))
      .find((entry): entry is { workspace: Workspace; window: WaylandWindow } => entry.window !== undefined);
  }

  private removeWindowFromFocusHistory(windowId: string): void {
    for (const [key, id] of this.lastFocusedWindowByWorkspace) {
      if (id === windowId) this.lastFocusedWindowByWorkspace.delete(key);
    }
  }

  private outputRects(): Array<Rect & { name: string }> {
    return COMPOSITOR.output.outputs.flatMap((output) =>
      output.resolution
        ? [
            {
              name: output.name,
              x: output.position.x,
              y: output.position.y,
              width: output.resolution.width / output.scale,
              height: output.resolution.height / output.scale,
            },
          ]
        : [],
    );
  }

  private outputRect(monitor: string): Rect | undefined {
    return this.outputRects().find((output) => output.name === monitor);
  }

  private gestureMonitor(event: GestureSwipeEvent): string {
    const outputName = event.outputName;
    if (outputName && COMPOSITOR.output.list.includes(outputName)) {
      return outputName;
    }
    return this.currentMonitor || COMPOSITOR.output.list.at(0) || "";
  }

  private updateWorkspaceGesture(event: GestureSwipeEvent) {
    const monitor = this.gestureMonitor(event);
    if (!monitor) {
      return;
    }

    const distance = Math.max(1, this.workspaceTransitionDistance(monitor));
    const scaledTotalY =
      event.totalY * this.workspaceGestureSpeed.workspaceSwitchFactor;
    const rawOffsetY = clamp(scaledTotalY, -distance, distance);
    if (Math.abs(rawOffsetY) < 1) {
      return;
    }

    const direction: -1 | 1 = rawOffsetY < 0 ? 1 : -1;
    const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    const nextIndex = currentIndex + direction;
    const fromWorkspace = this.ensureWorkspace(monitor, currentIndex);
    const toWorkspace =
      nextIndex >= 1 && nextIndex <= WORKSPACES_PER_MONITOR
        ? this.ensureWorkspace(monitor, nextIndex)
        : null;
    const targetChanged =
      this.workspaceGesture?.monitor !== monitor ||
      this.workspaceGesture.currentIndex !== currentIndex ||
      this.workspaceGesture.toWorkspace !== toWorkspace;

    this.currentMonitor = monitor;

    if (!toWorkspace) {
      if (targetChanged) {
        for (const workspace of this.workspaces.values()) {
          if (workspace === fromWorkspace) {
            continue;
          }
          workspace.setVisible(workspace.isActive());
        }
      }
      const resistanceOffsetY = rawOffsetY * 0.25;
      fromWorkspace.setWorkspaceGestureVisual(resistanceOffsetY, 1);
      this.workspaceGesture = {
        monitor,
        currentIndex,
        direction,
        distance,
        fromWorkspace,
        toWorkspace: null,
        fromOffsetY: resistanceOffsetY,
        toOffsetY: direction * distance,
        fromOpacity: 1,
        toOpacity: 0,
      };
      return;
    }

    const progress = clamp(Math.abs(rawOffsetY) / distance, 0, 1);
    const toOffsetY = direction * distance + rawOffsetY;
    const fromOpacity = 1 - progress;
    const toOpacity = progress;

    if (targetChanged) {
      for (const workspace of this.workspaces.values()) {
        if (workspace === fromWorkspace || workspace === toWorkspace) {
          continue;
        }
        workspace.setVisible(workspace.isActive());
      }
      toWorkspace.applyLayout();
    }

    fromWorkspace.setWorkspaceGestureVisual(rawOffsetY, fromOpacity);
    toWorkspace.setWorkspaceGestureVisual(toOffsetY, toOpacity);
    this.applyWorkspaceStackPolicy(fromWorkspace);
    this.applyWorkspaceStackPolicy(toWorkspace);

    this.workspaceGesture = {
      monitor,
      currentIndex,
      direction,
      distance,
      fromWorkspace,
      toWorkspace,
      fromOffsetY: rawOffsetY,
      toOffsetY,
      fromOpacity,
      toOpacity,
    };
  }

  private finishWorkspaceGesture(event: GestureSwipeEvent) {
    const gesture = this.workspaceGesture;
    this.workspaceGesture = null;
    if (!gesture) {
      return;
    }

    const shouldCommit =
      event.phase === "end" &&
      gesture.toWorkspace !== null &&
      (Math.abs(
        event.totalY * this.workspaceGestureSpeed.workspaceSwitchFactor,
      ) >=
        gesture.distance * WORKSPACE_GESTURE_THRESHOLD_RATIO ||
        Math.abs(
          event.velocityY *
            this.workspaceGestureSpeed.workspaceSwitchVelocityFactor,
        ) >= WORKSPACE_GESTURE_VELOCITY_THRESHOLD);

    if (shouldCommit && gesture.toWorkspace) {
      this.activeWorkspaceByMonitor.set(
        gesture.monitor,
        gesture.currentIndex + gesture.direction,
      );
      this.currentMonitor = gesture.monitor;
      gesture.fromWorkspace.animateWorkspaceTransition({
        fromOffsetY: gesture.fromOffsetY,
        toOffsetY: -gesture.direction * gesture.distance,
        fromOpacity: gesture.fromOpacity,
        toOpacity: 0,
        visibleAfter: false,
      });
      gesture.toWorkspace.animateWorkspaceTransition({
        fromOffsetY: gesture.toOffsetY,
        toOffsetY: 0,
        fromOpacity: gesture.toOpacity,
        toOpacity: 1,
        visibleAfter: true,
      });
      gesture.toWorkspace.focusActiveWindow();
      this.applyWorkspaceStackPolicy(gesture.fromWorkspace);
      this.applyWorkspaceStackPolicy(gesture.toWorkspace);
      return;
    }

    gesture.fromWorkspace.animateWorkspaceTransition({
      fromOffsetY: gesture.fromOffsetY,
      toOffsetY: 0,
      fromOpacity: gesture.fromOpacity,
      toOpacity: 1,
      visibleAfter: true,
    });
    if (gesture.toWorkspace) {
      gesture.toWorkspace.animateWorkspaceTransition({
        fromOffsetY: gesture.toOffsetY,
        toOffsetY: gesture.direction * gesture.distance,
        fromOpacity: gesture.toOpacity,
        toOpacity: 0,
        visibleAfter: false,
      });
    }
    this.applyWorkspaceStackPolicy(gesture.fromWorkspace);
  }

  private focusWindowAtPointerTarget(
    target: PointerMoveEvent["target"],
    monitorHint?: string,
  ) {
    if (target.kind !== "window") {
      return;
    }

    const workspace = Array.from(this.workspaces.values()).find((workspace) =>
      workspace.findWindowById(target.windowId),
    );
    const window = workspace?.findWindowById(target.windowId);
    if (!workspace || !window) {
      return;
    }

    if (!workspace.isActive()) {
      return;
    }

    const focused = workspace.focusWindowUnderPointer(window);
    if (!focused) {
      return;
    }

    this.currentMonitor =
      monitorHint && COMPOSITOR.output.list.includes(monitorHint)
        ? monitorHint
        : workspace.monitor;
  }

  private availableWorkspaceIndex(
    monitor: string,
    preferredIndex: number,
  ): number | undefined {
    const preferred = this.workspaces.get(workspaceKey(monitor, preferredIndex));
    if (!preferred || preferred.windowCount() === 0) return preferredIndex;
    for (let index = 1; index <= WORKSPACES_PER_MONITOR; index += 1) {
      if ((this.workspaces.get(workspaceKey(monitor, index))?.windowCount() ?? 0) === 0) {
        return index;
      }
    }
    return undefined;
  }

  private syncWorkspaceVisibility() {
    for (const workspace of this.workspaces.values()) {
      workspace.setVisible(workspace.isActive());
    }
  }

  private findWorkspaceForWindow(window: WaylandWindow): Workspace | undefined {
    for (const workspace of this.workspaces.values()) {
      if (workspace.hasWindow(window)) {
        return workspace;
      }
    }
    return undefined;
  }

  private findWorkspaceRestoringWindow(
    window: WaylandWindow,
  ): Workspace | undefined {
    for (const workspace of this.workspaces.values()) {
      if (workspace.isRestoringWindow(window.id)) {
        return workspace;
      }
    }
    return undefined;
  }

  private workspaceForTileDrag(
    event: WindowMoveEvent,
    drag: NonNullable<HybridWindowManager["tileDrag"]>,
  ): Workspace {
    const monitor =
      event.outputName && COMPOSITOR.output.list.includes(event.outputName)
        ? event.outputName
        : drag.workspace.monitor;
    let index = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    const edgeDirection = this.tileDragWorkspaceEdgeDirection(
      monitor,
      event.currentPointer.y,
    );

    if (
      event.modifiers.shift &&
      edgeDirection !== 0 &&
      event.timestamp - drag.lastWorkspaceSwitchAt >=
        TILE_DRAG_WORKSPACE_SWITCH_INTERVAL_MS
    ) {
      const nextIndex = Math.max(1, index + edgeDirection);
      if (nextIndex !== index) {
        this.currentMonitor = monitor;
        this.switchWorkspace(edgeDirection);
        drag.lastWorkspaceSwitchAt = event.timestamp;
        index = this.activeWorkspaceByMonitor.get(monitor) ?? nextIndex;
      }
    }

    return this.ensureWorkspace(monitor, index);
  }

  private workspaceForFloatingDrag(
    event: WindowMoveEvent,
    drag: NonNullable<HybridWindowManager["floatingDrag"]>,
  ): Workspace {
    const monitor =
      event.outputName && COMPOSITOR.output.list.includes(event.outputName)
        ? event.outputName
        : drag.workspace.monitor;
    let index = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    const edgeDirection = this.tileDragWorkspaceEdgeDirection(
      monitor,
      event.currentPointer.y,
    );

    if (
      event.modifiers.shift &&
      edgeDirection !== 0 &&
      event.timestamp - drag.lastWorkspaceSwitchAt >=
        TILE_DRAG_WORKSPACE_SWITCH_INTERVAL_MS
    ) {
      const nextIndex = Math.max(1, index + edgeDirection);
      if (nextIndex !== index) {
        this.currentMonitor = monitor;
        this.switchWorkspace(edgeDirection);
        drag.lastWorkspaceSwitchAt = event.timestamp;
        index = this.activeWorkspaceByMonitor.get(monitor) ?? nextIndex;
      }
    }

    return this.ensureWorkspace(monitor, index);
  }

  private tileDragWorkspaceEdgeDirection(
    monitor: string,
    y: number,
  ): -1 | 0 | 1 {
    const rect = this.workspaceViewportRect(monitor);
    const top = read(rect.y);
    const height = read(rect.height);
    if (y < top + TILE_DRAG_WORKSPACE_EDGE_PX) {
      return -1;
    }
    if (y > top + height - TILE_DRAG_WORKSPACE_EDGE_PX) {
      return 1;
    }
    return 0;
  }

  private workspaceTransitionDistance(monitor: string): number {
    return read(this.workspaceViewportRect(monitor).height);
  }

  private workspaceViewportRect(monitor: string): ManagedWindowRect {
    const usable = COMPOSITOR.layer.usableArea(monitor);
    if (usable) {
      return usable;
    }

    const output = COMPOSITOR.output.current[monitor];
    if (output?.resolution) {
      return {
        x: output.position.x,
        y: output.position.y,
        width: output.resolution.width / output.scale,
        height: output.resolution.height / output.scale,
      };
    }

    return {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    };
  }

  private constrainResizeRect(event: WindowResizeEvent): ManagedWindowRect {
    const constraints = event.window.sizeConstraints();
    const extra = this.clientToRootSizeExtra(event.window);
    const minWidth = Math.max(1, constraints.min?.width ?? 1) + extra.width;
    const minHeight = Math.max(1, constraints.min?.height ?? 1) + extra.height;
    const maxWidth = constrainedMax(constraints, "width", extra.width);
    const maxHeight = constrainedMax(constraints, "height", extra.height);

    const width = clamp(
      event.currentRect.width,
      minWidth,
      Math.max(minWidth, maxWidth),
    );
    const height = clamp(
      event.currentRect.height,
      minHeight,
      Math.max(minHeight, maxHeight),
    );

    return {
      x: resizeOriginForAxis(
        event.startRect,
        event.currentRect,
        width,
        event.edges.left,
        "x",
      ),
      y: resizeOriginForAxis(
        event.startRect,
        event.currentRect,
        height,
        event.edges.top,
        "y",
      ),
      width,
      height,
    };
  }

  private clientToRootSizeExtra(window: WaylandWindow): {
    width: number;
    height: number;
  } {
    const natural = this.naturalRootRect(window);
    return {
      width: Math.max(0, read(natural.width) - window.position.width),
      height: Math.max(0, read(natural.height) - window.position.height),
    };
  }

  private maximizedRectForWindow(
    window: WaylandWindow,
    preferredOutput?: string,
  ): ManagedWindowRect {
    const rect = window.state[WINDOW_STATE_RECT]();
    const centerX = read(rect.x) + read(rect.width) / 2;
    const centerY = read(rect.y) + read(rect.height) / 2;
    const outputName =
      preferredOutput ??
      this.outputNameAt(centerX, centerY) ??
      this.currentMonitor;
    const output = outputName
      ? COMPOSITOR.output.current[outputName]
      : undefined;
    const usable = outputName
      ? COMPOSITOR.layer.usableArea(outputName)
      : undefined;

    if (usable) {
      return insetRect(
        {
          x: usable.x,
          y: usable.y,
          width: usable.width,
          height: usable.height,
        },
        MAXIMIZED_WINDOW_PADDING,
      );
    }
    if (output?.resolution) {
      return insetRect(
        {
          x: output.position.x,
          y: output.position.y,
          width: output.resolution.width / output.scale,
          height: output.resolution.height / output.scale,
        },
        MAXIMIZED_WINDOW_PADDING,
      );
    }
    return rect;
  }

  // Fullscreen covers the entire output: unlike maximize it ignores the
  // usable area (exclusive-zone bars) and applies no padding, so the client
  // surface spans edge to edge. This is also what lets the tty backend
  // collapse the frame to a single scanout-capable element.
  private fullscreenRectForWindow(
    window: WaylandWindow,
    preferredOutput?: string,
  ): ManagedWindowRect {
    const rect = window.state[WINDOW_STATE_RECT]();
    const centerX = read(rect.x) + read(rect.width) / 2;
    const centerY = read(rect.y) + read(rect.height) / 2;
    const outputName =
      preferredOutput ??
      this.outputNameAt(centerX, centerY) ??
      this.currentMonitor;
    const output = outputName
      ? COMPOSITOR.output.current[outputName]
      : undefined;
    if (output?.resolution) {
      return {
        x: output.position.x,
        y: output.position.y,
        width: output.resolution.width / output.scale,
        height: output.resolution.height / output.scale,
      };
    }
    return rect;
  }

  public onWindowFullscreenRequest(event: WindowFullscreenRequestEvent) {
    if (this.isGrabbing) {
      return;
    }
    const window = event.window;
    const workspace = this.findWorkspaceForWindow(window);
    window.state[WINDOW_STATE_MINIMIZED].set(false);
    this.clearWindowSnapState(window);

    if (!event.fullscreen) {
      const restoreRect = window.state[WINDOW_STATE_FULLSCREEN_RESTORE_RECT]();
      window.state[WINDOW_STATE_FULLSCREEN].set(false);
      window.state[WINDOW_STATE_FULLSCREEN_RESTORE_RECT].set(null);
      // A tiled window returns to its computed slot; a floating one animates
      // back to where it was before going fullscreen.
      if (workspace?.shouldTile(window)) {
        workspace.applyLayout();
        this.applyWorkspaceStackPolicy(workspace);
        return;
      }
      if (restoreRect) {
        workspace?.syncFloatingWindowRect(window, restoreRect);
        playRectAnimation(
          window,
          WINDOW_STATE_RECT,
          restoreRect,
          WINDOW_MANAGEMENT_EASING,
          WINDOW_MANAGEMENT_ANIMATION_DURATION,
        );
      }
      this.applyWorkspaceStackPolicy(workspace);
      return;
    }

    if (!window.state[WINDOW_STATE_FULLSCREEN]()) {
      const currentRect = window.state[WINDOW_STATE_RECT]();
      const currentWidth = read(currentRect.width);
      const currentHeight = read(currentRect.height);
      if (currentWidth > 1 && currentHeight > 1) {
        window.state[WINDOW_STATE_FULLSCREEN_RESTORE_RECT].set(currentRect);
      }
    }
    const fullscreenRect = this.fullscreenRectForWindow(
      window,
      event.outputName,
    );
    window.state[WINDOW_STATE_FULLSCREEN].set(true);
    workspace?.focusWindow(window);
    workspace?.syncFloatingWindowRect(window, fullscreenRect);
    playRectAnimation(
      window,
      WINDOW_STATE_RECT,
      fullscreenRect,
      WINDOW_MANAGEMENT_EASING,
      WINDOW_MANAGEMENT_ANIMATION_DURATION,
    );
    this.applyWorkspaceStackPolicy(workspace);
    window.focus();
  }

  private initialRestoreRectForMaximizedWindow(
    window: WaylandWindow,
  ): ManagedWindowRect {
    const maximizedRect = this.maximizedRectForWindow(window);
    const width = Math.max(1, read(maximizedRect.width) * 0.7);
    const height = Math.max(1, read(maximizedRect.height) * 0.7);
    return {
      x: read(maximizedRect.x) + (read(maximizedRect.width) - width) / 2,
      y: read(maximizedRect.y) + (read(maximizedRect.height) - height) / 2,
      width,
      height,
    };
  }

  private restoreRectForMaximizedMove(
    event: WindowMoveEvent,
    width: number,
    height: number,
  ): ManagedWindowRect {
    const pointer = event.currentPointer;
    const titlebarCenterY = WINDOW_BORDER_PX + TITLEBAR_HEIGHT / 2;
    const pointerOffsetY =
      event.source === "modifier"
        ? height / 2
        : Math.min(height / 2, titlebarCenterY);

    return {
      x: pointer.x - width / 2,
      y: pointer.y - pointerOffsetY,
      width,
      height,
    };
  }

  private outputNameAt(x: number, y: number): string | undefined {
    for (const name of COMPOSITOR.output.list) {
      const output = COMPOSITOR.output.current[name];
      if (!output?.resolution) {
        continue;
      }
      const width = output.resolution.width / output.scale;
      const height = output.resolution.height / output.scale;
      if (
        x >= output.position.x &&
        y >= output.position.y &&
        x < output.position.x + width &&
        y < output.position.y + height
      ) {
        return name;
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Snap zones (Windows-style edge snapping for floating drags + tiling drag
  // slot preview). The bar renders the preview rect; this side decides the
  // zone, broadcasts the preview, and applies the snap on drop.
  // -------------------------------------------------------------------------

  public setSnapPreviewBroadcaster(broadcaster: SnapPreviewBroadcaster | null) {
    this.snapPreviewBroadcaster = broadcaster;
  }

  public setWorkspaceChangeBroadcaster(
    broadcaster: WorkspaceChangeBroadcaster | null,
  ) {
    this.workspaceChangeBroadcaster = broadcaster;
  }

  /** Full logical rect of a monitor (ignores reserved insets). */
  private monitorFullRect(monitor: string): ManagedWindowRect | null {
    const output = COMPOSITOR.output.current[monitor];
    if (!output?.resolution) {
      return null;
    }
    return {
      x: output.position.x,
      y: output.position.y,
      width: output.resolution.width / output.scale,
      height: output.resolution.height / output.scale,
    };
  }

  /** Usable area inset by the maximized padding — the base for all snap rects. */
  private monitorSnapBaseRect(monitor: string): ManagedWindowRect | null {
    const usable =
      COMPOSITOR.layer.usableArea(monitor) ?? this.monitorFullRect(monitor);
    if (!usable) {
      return null;
    }
    return insetRect(usable, MAXIMIZED_WINDOW_PADDING);
  }

  /** Resolve the snap zone for a pointer near the physical screen edges. */
  private floatingSnapZoneAt(
    monitor: string,
    px: number,
    py: number,
  ): SnapZone | null {
    const full = this.monitorFullRect(monitor);
    if (!full) {
      return null;
    }
    const left = read(full.x);
    const top = read(full.y);
    const right = left + read(full.width);
    const bottom = top + read(full.height);

    const nearLeft = px <= left + SNAP_EDGE_PX;
    const nearRight = px >= right - SNAP_EDGE_PX;
    const nearTop = py <= top + SNAP_EDGE_PX;

    // Corners win over edges so the quarters stay reachable.
    if (nearLeft && py <= top + SNAP_CORNER_PX) return "top-left";
    if (nearLeft && py >= bottom - SNAP_CORNER_PX) return "bottom-left";
    if (nearRight && py <= top + SNAP_CORNER_PX) return "top-right";
    if (nearRight && py >= bottom - SNAP_CORNER_PX) return "bottom-right";
    if (nearTop) return "maximize";
    if (nearLeft) return "left";
    if (nearRight) return "right";
    return null;
  }

  /** Target rect (global logical coords) for a snap zone on a monitor. */
  private snapZoneRect(
    monitor: string,
    zone: SnapZone,
  ): ManagedWindowRect | null {
    const base = this.monitorSnapBaseRect(monitor);
    if (!base) {
      return null;
    }
    const bx = read(base.x);
    const by = read(base.y);
    const bw = read(base.width);
    const bh = read(base.height);
    const halfW = (bw - SNAP_GAP_PX) / 2;
    const halfH = (bh - SNAP_GAP_PX) / 2;
    const rightX = bx + halfW + SNAP_GAP_PX;
    const bottomY = by + halfH + SNAP_GAP_PX;

    switch (zone) {
      case "maximize":
        return { x: bx, y: by, width: bw, height: bh };
      case "left":
        return { x: bx, y: by, width: halfW, height: bh };
      case "right":
        return { x: rightX, y: by, width: halfW, height: bh };
      case "top-left":
        return { x: bx, y: by, width: halfW, height: halfH };
      case "top-right":
        return { x: rightX, y: by, width: halfW, height: halfH };
      case "bottom-left":
        return { x: bx, y: bottomY, width: halfW, height: halfH };
      case "bottom-right":
        return { x: rightX, y: bottomY, width: halfW, height: halfH };
    }
  }

  private setWindowSnapState(
    workspace: Workspace | undefined,
    window: WaylandWindow,
    monitor: string,
    zone: LayoutSnapZone,
  ): void {
    if (workspace) {
      for (const other of workspace.listWindows()) {
        if (other.id === window.id) {
          continue;
        }
        if (
          other.state[WINDOW_STATE_SNAP_MONITOR]() === monitor &&
          snapZonesConflict(other.state[WINDOW_STATE_SNAP_ZONE](), zone)
        ) {
          this.clearWindowSnapState(other);
        }
      }
    }

    window.state[WINDOW_STATE_SNAP_ZONE].set(zone);
    window.state[WINDOW_STATE_SNAP_MONITOR].set(monitor);
  }

  private clearWindowSnapState(window: WaylandWindow): void {
    window.state[WINDOW_STATE_SNAP_ZONE].set(null);
    window.state[WINDOW_STATE_SNAP_MONITOR].set(null);
  }

  /** Broadcast a preview rect (converted to monitor-local) or a hide (null). */
  private emitSnapPreview(
    monitor: string,
    rect: ManagedWindowRect | null,
    kind: "floating" | "tiling",
    zone?: TileDropZone,
  ) {
    if (!this.snapPreviewBroadcaster) {
      return;
    }
    if (!rect) {
      this.snapPreviewBroadcaster({ monitor, rect: null, kind });
      return;
    }
    const output = COMPOSITOR.output.current[monitor];
    const ox = output?.position.x ?? 0;
    const oy = output?.position.y ?? 0;
    this.snapPreviewBroadcaster({
      monitor,
      kind,
      zone,
      style: kind === "tiling" ? theme.dropIndicator : undefined,
      rect: {
        x: read(rect.x) - ox,
        y: read(rect.y) - oy,
        width: read(rect.width),
        height: read(rect.height),
      },
    });
  }

  /** Update the floating-drag snap candidate + preview during a move. */
  private updateFloatingDragSnap(event: WindowMoveEvent) {
    if (event.modifiers.shift) {
      this.clearFloatingSnapPreview();
      return;
    }
    if (event.phase === "start") {
      this.clearFloatingSnapPreview();
      return;
    }
    if (event.phase === "end" || event.phase === "cancel") {
      return;
    }

    const monitor =
      event.outputName && COMPOSITOR.output.list.includes(event.outputName)
        ? event.outputName
        : this.currentMonitor;
    const zone = monitor
      ? this.floatingSnapZoneAt(
          monitor,
          event.currentPointer.x,
          event.currentPointer.y,
        )
      : null;

    if (!monitor || !zone) {
      this.clearFloatingSnapPreview();
      return;
    }

    const rect = this.snapZoneRect(monitor, zone);
    if (!rect) {
      this.clearFloatingSnapPreview();
      return;
    }
    if (
      this.floatingSnap &&
      (this.floatingSnap.windowId !== event.window.id ||
        this.floatingSnap.monitor !== monitor)
    ) {
      this.emitSnapPreview(this.floatingSnap.monitor, null, "floating");
    }
    this.floatingSnap = { windowId: event.window.id, monitor, zone, rect };
    this.emitSnapPreview(monitor, rect, "floating");
  }

  private clearFloatingSnapPreview() {
    if (!this.floatingSnap) {
      return;
    }
    this.emitSnapPreview(this.floatingSnap.monitor, null, "floating");
    this.floatingSnap = null;
  }

  /**
   * Apply the pending snap on drop (or clear it on cancel). Returns true if the
   * window was snapped, so the caller skips leaving it at the drop position.
   */
  private finishFloatingDragSnap(
    event: WindowMoveEvent,
    workspace: Workspace | undefined,
  ): boolean {
    if (event.modifiers.shift) {
      this.clearFloatingSnapPreview();
      return false;
    }
    const snap = this.floatingSnap;
    this.floatingSnap = null;
    if (!snap || snap.windowId !== event.window.id) {
      if (snap) {
        this.emitSnapPreview(snap.monitor, null, "floating");
      }
      return false;
    }

    this.emitSnapPreview(snap.monitor, null, "floating");
    if (event.phase !== "end") {
      return false;
    }

    const window = event.window;
    const isMaximized = window.state[WINDOW_STATE_MAXIMIZED]();

    if (snap.zone === "maximize") {
      this.clearWindowSnapState(window);
      // Route through the real maximize so the compositor `isMaximized` state
      // (and therefore the SSD maximize/restore icon) stays in sync. Calling
      // maximize() fires onWindowMaximizeRequest, which applies the rect.
      if (!isMaximized) {
        window.maximize();
      } else {
        // Already maximized (e.g. re-dropped on the top edge): just re-apply
        // the maximized rect for the monitor under the cursor.
        const rect = this.maximizedRectForWindow(window);
        playRectAnimation(
          window,
          WINDOW_STATE_RECT,
          rect,
          WINDOW_MANAGEMENT_EASING,
          WINDOW_MANAGEMENT_ANIMATION_DURATION,
        );
        workspace?.syncFloatingWindowRect(window, rect);
      }
    } else {
      // Half / quarter: ensure the window is unmaximized first (syncs the SSD
      // icon), with the restore rect cleared so unmaximize() does not animate
      // back to it and fight the snap, then place it at the zone rect.
      if (isMaximized) {
        window.state[WINDOW_STATE_RESTORE_RECT].set(null);
        window.state[WINDOW_STATE_MAXIMIZED].set(false);
        window.unmaximize();
      }
      playRectAnimation(
        window,
        WINDOW_STATE_RECT,
        snap.rect,
        WINDOW_MANAGEMENT_EASING,
        WINDOW_MANAGEMENT_ANIMATION_DURATION,
      );
      this.setWindowSnapState(workspace, window, snap.monitor, snap.zone);
      workspace?.syncFloatingWindowRect(window, snap.rect);
    }
    this.applyWorkspaceStackPolicy(workspace);
    return true;
  }
}

export class Workspace {
  public index: number;
  private readonly windows: WaylandWindow[] = [];
  private readonly tileTree = new TileTree();
  private readonly naturalRootRect: (
    window: WaylandWindow,
  ) => ManagedWindowRect;
  private readonly maximizedRootRect: (
    window: WaylandWindow,
  ) => ManagedWindowRect;
  private readonly activeWorkspaceIndex: (monitor: string) => number;
  private readonly restoredWindowStateById = new Map<
    string,
    WorkspaceWindowSnapshot
  >();
  private activeWindowId: string | null = null;
  private visibilityAnimationToken = 0;
  private draggingWindowId: string | null = null;
  private tileDragTargets = new Map<string, { rect: TileRect; index: number }>();
  private tileDragTargetWindowId: string | null = null;
  private tileDragDropZone: TileDropZone | null = null;
  private tileDragPreview: ManagedWindowRect | null = null;
  private lastAppliedTileViewportRect: ManagedWindowRect | null = null;
  private readonly initialTileStateByWindowId = new Map<
    string,
    {
      activeWindowId: string | null;
      token: number;
    }
  >();
  private initialTileStateToken = 0;
  private pointerResize: {
    windowId: string;
    horizontal: TileResizeHandle | null;
    vertical: TileResizeHandle | null;
    wasMaximized: boolean;
  } | null = null;
  private readonly minimizedTileIndexByWindowId = new Map<string, number>();
  public monitor: string;

  public constructor(
    index: number,
    monitor: string,
    naturalRootRect: (window: WaylandWindow) => ManagedWindowRect,
    maximizedRootRect: (window: WaylandWindow) => ManagedWindowRect,
    activeWorkspaceIndex: (monitor: string) => number,
  ) {
    this.index = index;
    this.monitor = monitor;
    this.naturalRootRect = naturalRootRect;
    this.maximizedRootRect = maximizedRootRect;
    this.activeWorkspaceIndex = activeWorkspaceIndex;
  }

  public moveToMonitor(monitor: string, index: number) {
    this.monitor = monitor;
    this.index = index;
    for (const window of this.windows) {
      if (window.state[WINDOW_STATE_SNAP_MONITOR]() !== monitor) {
        window.state[WINDOW_STATE_SNAP_ZONE].set(null);
        window.state[WINDOW_STATE_SNAP_MONITOR].set(null);
      }
      this.syncWindowVisibleOutputs(window);
      if (window.state[WINDOW_STATE_FULLSCREEN]()) {
        window.state[WINDOW_STATE_RECT].set(this.fullscreenRootRect(window));
        continue;
      }
      if (window.state[WINDOW_STATE_MAXIMIZED]()) {
        window.state[WINDOW_STATE_RECT].set(this.maximizedRootRect(window));
        continue;
      }

      if (!this.shouldTile(window)) {
        const rect = this.clampRectToViewport(
          window.state[WINDOW_STATE_RECT](),
        );
        window.state[WINDOW_STATE_RECT].set(rect);
        window.state[WINDOW_STATE_FLOATING_RECT].set(
          this.viewportRectToFloatingContentRect(rect),
        );
      }
    }
  }

  public addWindow(
    window: WaylandWindow,
  ): boolean {
    if (this.windows.map((window) => window.id).includes(window.id)) {
      hotReloadDebug("workspace-add-existing-skip", {
        monitor: this.monitor,
        index: this.index,
        windowId: window.id,
        windowIds: this.windows.map((window) => window.id),
      });
      return false;
    }
    const previousActiveWindowId = this.activeWindowId;
    const restored = this.restoredWindowStateById.get(window.id);
    if (!restored && windowRule(window)?.floating) {
      window.state[WINDOW_STATE_FORCE_FLOATING].set(true);
    }
    if (
      this.shouldTile(window) &&
      !restored?.forceFloating &&
      !restored?.minimized &&
      !this.tileTree.has(window.id)
    ) {
      this.tileTree.insert(window.id, this.activeWindowId, numericRect(this.tileViewportRect()));
      layoutDebug("insert", { window: window.id, workspace: `${this.monitor}:${this.index}` });
    }
    this.windows.push(window);
    if (!restored && this.shouldTile(window)) {
      this.activeWindowId = window.id;
    }
    if (restored) {
      window.cancelAnimation();
      hotReloadDebug("workspace-add-restored-cancel-animation", {
        monitor: this.monitor,
        index: this.index,
        windowId: window.id,
        activeWindowId: this.activeWindowId,
        restoredWindowIds: Array.from(this.restoredWindowStateById.keys()),
        windowIds: this.windows.map((window) => window.id),
      });
      this.restoredWindowStateById.delete(window.id);
      window.state[WINDOW_STATE_FLOATING_RECT].set(
        restored.floatingRect ?? null,
      );
      window.state[WINDOW_STATE_RESTORE_RECT].set(restored.restoreRect ?? null);
      window.state[WINDOW_STATE_SNAP_ZONE].set(restored.snapZone ?? null);
      window.state[WINDOW_STATE_SNAP_MONITOR].set(restored.snapMonitor ?? null);
      window.state[WINDOW_STATE_MINIMIZED].set(restored.minimized);
      window.state[WINDOW_STATE_MINIMIZE_VISUAL_IDLE].set(restored.minimized);
      window.state[WINDOW_STATE_MAXIMIZED].set(restored.maximized);
      window.state[WINDOW_STATE_FULLSCREEN].set(restored.fullscreen ?? false);
      window.state[WINDOW_STATE_FULLSCREEN_RESTORE_RECT].set(
        restored.fullscreenRestoreRect ?? null,
      );
      window.state[WINDOW_STATE_FORCE_FLOATING].set(restored.forceFloating);
    }
    const visible = this.isActive();
    window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(visible);
    window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
    window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(visible ? 1 : 0);
    this.syncWindowVisibleOutputs(window);

    if (!COMPOSITOR.output.list.includes(this.monitor)) {
      return restored !== undefined;
    }

    if (this.shouldTile(window)) {
      const initialRect = this.centeredFloatingRect(window);
      window.state[WINDOW_STATE_FLOATING_RECT].set(
        restored?.floatingRect ?? initialRect,
      );
      this.rememberInitialTileState(window, previousActiveWindowId);
      this.applyLayout({
        suppressSSDRebuild: false,
        animate: restored === undefined,
        preserveMissingActive: restored !== undefined,
      });
    } else {
      const initialRect = this.centeredFloatingRect(window);
      const contentRect =
        restored?.floatingRect ??
        this.viewportRectToFloatingContentRect(initialRect);
      window.state[WINDOW_STATE_FLOATING_RECT].set(contentRect);
      window.state[WINDOW_STATE_RECT].set(
        this.floatingContentRectToViewportRect(contentRect),
      );
    }
    hotReloadDebug("workspace-add-window", {
      monitor: this.monitor,
      index: this.index,
      windowId: window.id,
      restored: restored !== undefined,
      shouldTile: this.shouldTile(window),
      activeWindowId: this.activeWindowId,
      windowIds: this.windows.map((window) => window.id),
      rect: window.state[WINDOW_STATE_RECT](),
      floatingRect: window.state[WINDOW_STATE_FLOATING_RECT](),
    });
    return restored !== undefined;
  }

  private rememberInitialTileState(
    window: WaylandWindow,
    activeWindowId: string | null,
  ): void {
    const token = ++this.initialTileStateToken;
    this.initialTileStateByWindowId.set(window.id, {
      activeWindowId,
      token,
    });
    setTimeout(() => {
      if (this.initialTileStateByWindowId.get(window.id)?.token === token) {
        this.initialTileStateByWindowId.delete(window.id);
      }
    }, INITIAL_TILEABILITY_SETTLE_DURATION);
  }

  public removeWindow(window: WaylandWindow): WaylandWindow | null | undefined {
    const index = this.windows.findIndex((current) => current.id === window.id);
    if (index >= 0) {
      // Both describe the tile sequence this window is still part of, so they
      // have to be read before the splice takes it out.
      const wasTile = this.tileTree.has(window.id);
      const tileIndex = this.tileTree.leafIds().indexOf(window.id);
      this.windows.splice(index, 1);
      this.tileTree.remove(window.id);
      layoutDebug("remove", { window: window.id, workspace: `${this.monitor}:${this.index}` });
      this.minimizedTileIndexByWindowId.delete(window.id);
      this.initialTileStateByWindowId.delete(window.id);
      if (this.draggingWindowId === window.id) {
        this.draggingWindowId = null;
        window.state[WINDOW_STATE_TILE_DRAGGING].set(false);
      }
      if (this.pointerResize?.windowId === window.id) this.pointerResize = null;
      let nextFocus: WaylandWindow | null = null;
      if (this.activeWindowId === window.id) {
        nextFocus = this.successorForRemovedWindow(wasTile, tileIndex);
        this.activeWindowId = nextFocus?.id ?? null;
      }
      return nextFocus;
    }
    if (this.restoredWindowStateById.delete(window.id)) {
      this.tileTree.remove(window.id);
      return null;
    }
    return undefined;
  }

  /**
   * The window that inherits focus when the active one is removed, or null to
   * leave that to the compositor.
   *
   * "The tile that slid into its place" is only an answer for a tile in a
   * tiled workspace. A dialog that never held a slot has no next-one-along,
   * and naming one
   * anyway is what sent focus to the wrong window: dismissing an SSH approval
   * prompt jumped to the password manager's main window instead of returning
   * to the terminal that had asked for it.
   *
   * Declining is not caution, it is the better answer. The compositor elects
   * the window the user most recently typed in or clicked on, which is what
   * "put me back where I was" means, and is something this layer cannot work
   * out for itself: it focuses every window at onOpen, so "was focused" cannot
   * separate a terminal in use from a dialog that appeared beside it.
   */
  private successorForRemovedWindow(
    wasTile: boolean,
    tileIndex: number,
  ): WaylandWindow | null {
    if (!wasTile || tileIndex < 0) {
      return null;
    }
    const tileable = this.tileableWindows();
    return tileable[Math.min(tileIndex, tileable.length - 1)] ?? null;
  }

  public removeTileDragWindow(window: WaylandWindow) {
    const index = this.windows.findIndex((current) => current.id === window.id);
    if (index < 0) {
      return;
    }
    this.windows.splice(index, 1);
    this.tileTree.remove(window.id);
    this.draggingWindowId = null;
    this.tileDragTargets.clear();
    this.tileDragTargetWindowId = null;
    this.tileDragDropZone = null;
    this.tileDragPreview = null;
  }

  public removeFloatingWindow(window: WaylandWindow) {
    const index = this.windows.findIndex((current) => current.id === window.id);
    if (index < 0) {
      return;
    }
    this.windows.splice(index, 1);
    this.tileTree.remove(window.id);
    if (this.activeWindowId === window.id) {
      this.activeWindowId =
        this.activeWindow(this.tileableWindows())?.id ?? null;
    }
  }

  public hasWindow(window: WaylandWindow): boolean {
    return this.windows.some((current) => current.id === window.id);
  }

  public windowCount(): number {
    return this.windows.length;
  }

  /**
   * Snapshot of every window currently in this workspace. The returned array
   * is a copy; mutating it is safe and won't affect the workspace state.
   */
  public listWindows(): WaylandWindow[] {
    return this.windows.slice();
  }

  public findWindowById(windowId: string): WaylandWindow | undefined {
    return this.windows.find((window) => window.id === windowId);
  }

  public isActiveWindowId(windowId: string): boolean {
    return this.activeWindowId === windowId;
  }

  public takeWindowForMove(
    window: WaylandWindow,
  ): { window: WaylandWindow; snapshot: WorkspaceWindowSnapshot } | null {
    if (!this.hasWindow(window)) {
      return null;
    }

    const snapshot = this.snapshotWindow(window);
    this.removeWindow(window);
    return { window, snapshot };
  }

  public addMovedWindow(
    window: WaylandWindow,
    snapshot: WorkspaceWindowSnapshot,
  ): boolean {
    this.restoredWindowStateById.set(window.id, snapshot);
    return this.addWindow(window);
  }

  public isRestoringWindow(windowId: string): boolean {
    return this.restoredWindowStateById.has(windowId);
  }

  public isActive(): boolean {
    return this.activeWorkspaceIndex(this.monitor) === this.index;
  }

  public refreshUsableAreaLayout() {
    if (!COMPOSITOR.output.list.includes(this.monitor)) {
      return;
    }

    const nextViewportRect = this.tileViewportRect();
    if (
      this.lastAppliedTileViewportRect &&
      managedRectEquals(this.lastAppliedTileViewportRect, nextViewportRect)
    ) {
      return;
    }
    this.applyLayout({
      suppressSSDRebuild: false,
      animate: false,
      preserveMissingActive: true,
    });
  }

  public setVisible(visible: boolean) {
    this.visibilityAnimationToken += 1;
    for (const window of this.windows) {
      this.syncWindowVisibleOutputs(window);
      if (window.state[WINDOW_STATE_TILE_DRAGGING]()) {
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
        continue;
      }
      window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(visible);
      window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
      window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(visible ? 1 : 0);
    }
  }

  public prepareWorkspaceTransition(offsetY: number, opacity: number) {
    this.visibilityAnimationToken += 1;
    for (const window of this.windows) {
      this.syncWindowVisibleOutputs(window);
      if (window.state[WINDOW_STATE_TILE_DRAGGING]()) {
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
        continue;
      }
      window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
      window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(offsetY);
      window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(opacity);
    }
  }

  public setWorkspaceGestureVisual(offsetY: number, opacity: number) {
    this.visibilityAnimationToken += 1;
    for (const window of this.windows) {
      this.syncWindowVisibleOutputs(window);
      cancelWorkspaceVisualAnimation(window);
      if (window.state[WINDOW_STATE_TILE_DRAGGING]()) {
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
        continue;
      }
      window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
      window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(offsetY);
      window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(opacity);
    }
  }

  public animateWorkspaceTransition(options: {
    fromOffsetY: number;
    toOffsetY: number;
    fromOpacity: number;
    toOpacity: number;
    visibleAfter: boolean;
  }) {
    const token = this.visibilityAnimationToken + 1;
    this.visibilityAnimationToken = token;

    for (const window of this.windows) {
      this.syncWindowVisibleOutputs(window);
      if (window.state[WINDOW_STATE_TILE_DRAGGING]()) {
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
        continue;
      }
      // Minimized windows are hidden purely by `idle` — their composed
      // opacity stays at the workspace value. Scheduling the visual
      // animation would both bypass the idle render gate (animating
      // windows stay renderable while idle) and override the composed
      // opacity, so the "hidden" window would fade in with the workspace
      // switch. Keep them on static state only.
      if (
        window.state[WINDOW_STATE_MINIMIZED]() ||
        window.state[WINDOW_STATE_MINIMIZE_VISUAL_IDLE]()
      ) {
        cancelWorkspaceVisualAnimation(window);
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(options.toOpacity);
        continue;
      }
      // Same ordering rule as prepare: schedule first, then flip
      // VISIBLE. For from-workspace this is mostly a no-op (VISIBLE was
      // already true), but for to-workspace's second call this keeps
      // the same invariant in case prepareWorkspaceTransition's hold
      // animation has already completed (e.g., rapid switches).
      scheduleWorkspaceVisualAnimation(
        window,
        options.fromOffsetY,
        options.toOffsetY,
        options.fromOpacity,
        options.toOpacity,
        theme.animation.workspaceEasing,
        WORKSPACE_SWITCH_ANIMATION_DURATION,
      );
      window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
    }

    const VISIBILITY_COMMIT_BEFORE_END_MS = 32;

    setTimeout(
      () => {
        if (this.visibilityAnimationToken !== token) {
          return;
        }
        withManagedWindowOnlySSDRebuildSuppressed(() => {
          this.setVisible(options.visibleAfter);
        });
      },
      Math.max(
        0,
        WORKSPACE_SWITCH_ANIMATION_DURATION - VISIBILITY_COMMIT_BEFORE_END_MS,
      ),
    );
  }

  public applyLayout(options: LayoutOptions = {}) {
    this.syncTileTreeMembership();
    const tileable = this.tileableWindows();
    const animate = options.animate ?? true;
    const suppressSSDRebuild = options.suppressSSDRebuild ?? true;
    const canSuppress = this.canSuppressLayoutSSDRebuild(tileable);
    const animationOptions =
      animate && suppressSSDRebuild && canSuppress
        ? MANAGED_WINDOW_ONLY_ANIMATION
        : undefined;

    if (tileable.length === 0) {
      this.activeWindowId = null;
      this.validateLayoutState(new Map(), this.tileViewportRect());
      hotReloadDebug("workspace-apply-layout-empty", {
        monitor: this.monitor,
        index: this.index,
        animate,
        suppressSSDRebuild,
        canSuppress,
        floatingWindowIds: this.floatingWindows().map((window) => window.id),
      });
      this.applyFloatingLayout(
        animationOptions,
        animate,
      );
      return;
    }

    if (
      !this.activeWindowId ||
      !tileable.some((window) => window.id === this.activeWindowId)
    ) {
      if (!options.preserveMissingActive) {
        this.activeWindowId = tileable.at(-1)?.id ?? null;
      }
    }

    const viewportRect = this.tileViewportRect(tileable.length);
    this.lastAppliedTileViewportRect = snapshotManagedRect(viewportRect);
    const rects = this.tileTree.rects(numericRect(viewportRect), TILE_GAP);
    this.validateLayoutState(rects, viewportRect);
    const appliedRects: Record<string, ManagedWindowRect> = {};

    tileable.forEach((window) => {
      const tiledRect = rects.get(window.id) ?? viewportRect;
      const rect = window.state[WINDOW_STATE_FULLSCREEN]()
        ? this.fullscreenRootRect(window)
        : window.state[WINDOW_STATE_MAXIMIZED]()
          ? this.maximizedRootRect(window)
          : tiledRect;
      appliedRects[window.id] = rect;
      if (window.id !== this.draggingWindowId) {
        if (animate) {
          playRectAnimation(
            window,
            WINDOW_STATE_RECT,
            rect,
            WINDOW_MANAGEMENT_EASING,
            TILE_ANIMATION_DURATION,
            animationOptions,
          );
        } else {
          if (options.cancelRectAnimations !== false) {
            stopRectAnimation(window, WINDOW_STATE_RECT);
          }
          window.state[WINDOW_STATE_RECT].set(rect);
        }
      }
    });

    hotReloadDebug("workspace-apply-layout", {
      monitor: this.monitor,
      index: this.index,
      animate,
      suppressSSDRebuild,
      canSuppress,
      activeWindowId: this.activeWindowId,
      tileableWindowIds: tileable.map((window) => window.id),
      floatingWindowIds: this.floatingWindows().map((window) => window.id),
      appliedRects,
    });
    this.applyFloatingLayout(
      animationOptions,
      animate,
    );
  }

  public resizeTile(event: WindowResizeEvent) {
    const tileable = this.tileableWindows();
    if (!tileable.some((window) => window.id === event.window.id)) {
      return;
    }

    const wasMaximized = event.window.state[WINDOW_STATE_MAXIMIZED]();
    if (
      (event.phase === "start" || event.phase === "update") &&
      event.window.state[WINDOW_STATE_MAXIMIZED]()
    ) {
      event.window.state[WINDOW_STATE_MAXIMIZED].set(false);
      event.window.state[WINDOW_STATE_RESTORE_RECT].set(null);
      event.window.unmaximize();
    }

    stopRectAnimation(event.window, WINDOW_STATE_RECT);
    this.activeWindowId = event.window.id;

    const viewportRect = numericRect(this.tileViewportRect());
    if (event.phase === "start" || this.pointerResize?.windowId !== event.window.id) {
      this.pointerResize = {
        windowId: event.window.id,
        wasMaximized,
        horizontal:
          event.edges.top || event.edges.bottom
            ? this.tileTree.beginPointerResize(
                event.window.id,
                "horizontal",
                event.edges.top,
                viewportRect,
                TILE_GAP,
              )
            : null,
        vertical:
          event.edges.left || event.edges.right
            ? this.tileTree.beginPointerResize(
                event.window.id,
                "vertical",
                event.edges.left,
                viewportRect,
                TILE_GAP,
              )
            : null,
      };
      layoutDebug("pointer-resize start", {
        window: event.window.id,
        horizontal: this.pointerResize.horizontal !== null,
        vertical: this.pointerResize.vertical !== null,
      });
    }

    const resize = this.pointerResize;
    if (!resize) return;
    if (event.phase === "cancel") {
      if (resize.vertical) this.tileTree.updatePointerResize(resize.vertical, 0);
      if (resize.horizontal) this.tileTree.updatePointerResize(resize.horizontal, 0);
      if (resize.wasMaximized) {
        event.window.state[WINDOW_STATE_MAXIMIZED].set(true);
        event.window.maximize();
      }
    } else {
      const ratios: number[] = [];
      if (resize.vertical) ratios.push(this.tileTree.updatePointerResize(resize.vertical, event.delta.x));
      if (resize.horizontal) ratios.push(this.tileTree.updatePointerResize(resize.horizontal, event.delta.y));
      layoutDebug("pointer-resize ratio", { window: event.window.id, ratios });
    }
    this.applyLayout({ animate: false });
    if (event.phase === "end" || event.phase === "cancel") {
      layoutDebug("pointer-resize end", { window: event.window.id });
      this.pointerResize = null;
    }
  }

  public beginTileDrag(window: WaylandWindow, rect: ManagedWindowRect) {
    if (!this.shouldTile(window)) {
      return;
    }
    this.activeWindowId = window.id;
    this.draggingWindowId = window.id;
    this.resetTileDragTargets(window.id);
    const wasMaximized = window.state[WINDOW_STATE_MAXIMIZED]();
    window.state[WINDOW_STATE_MAXIMIZED].set(false);
    window.state[WINDOW_STATE_RESTORE_RECT].set(null);
    if (wasMaximized) {
      window.unmaximize();
    }
    window.state[WINDOW_STATE_TILE_DRAGGING].set(true);
    this.syncWindowVisibleOutputs(window);
    window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
    window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
    window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
    stopRectAnimation(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(rect);
    this.applyLayout();
  }

  public adoptTileDragWindow(window: WaylandWindow, rect: ManagedWindowRect) {
    if (!this.hasWindow(window)) {
      this.windows.push(window);
    }
    const visible = this.isActive();
    this.activeWindowId = window.id;
    if (!this.tileTree.has(window.id)) {
      this.tileTree.insert(window.id, null, numericRect(this.tileViewportRect()));
    }
    this.draggingWindowId = window.id;
    this.resetTileDragTargets(window.id);
    window.state[WINDOW_STATE_TILE_DRAGGING].set(true);
    this.syncWindowVisibleOutputs(window);
    window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
    window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
    window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(visible ? 1 : 0);
    stopRectAnimation(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(rect);
  }

  public adoptFloatingWindow(window: WaylandWindow, rect: ManagedWindowRect) {
    if (!this.hasWindow(window)) {
      this.windows.push(window);
    }
    const visible = this.isActive();
    this.activeWindowId = window.id;
    this.tileTree.remove(window.id);
    this.syncWindowVisibleOutputs(window);
    resetWorkspaceVisualState(window, visible);
    window.state[WINDOW_STATE_FLOATING_RECT].set(
      this.viewportRectToFloatingContentRect(rect),
    );
    stopRectAnimation(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(rect);
  }

  public updateTileDrag(
    window: WaylandWindow,
    rect: ManagedWindowRect,
    pointerX: number,
    pointerY: number,
  ) {
    if (this.draggingWindowId !== window.id) {
      this.beginTileDrag(window, rect);
    }
    this.activeWindowId = window.id;
    stopRectAnimation(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(rect);
    const target = this.tileDragTargetForPointer(pointerX, pointerY);
    if (!target) {
      this.tileDragTargetWindowId = null;
      this.tileDragDropZone = null;
      this.tileDragPreview = null;
      return;
    }
    const zone = tileDropZoneAtPointer(target.rect, pointerX, pointerY);
    if (!zone) return;
    if (target.windowId === this.tileDragTargetWindowId && zone === this.tileDragDropZone) return;
    this.tileDragTargetWindowId = target.windowId;
    this.tileDragDropZone = zone;
    this.tileDragPreview = this.tileTree.previewDrop(
      window.id,
      target.windowId,
      zone,
      numericRect(this.tileViewportRect()),
      TILE_GAP,
    );
  }

  public endTileDrag(window: WaylandWindow, cancelled: boolean) {
    if (this.draggingWindowId !== window.id) {
      return;
    }
    this.draggingWindowId = null;
    if (!cancelled && this.tileDragTargetWindowId && this.tileDragDropZone) {
      this.tileTree.drop(window.id, this.tileDragTargetWindowId, this.tileDragDropZone);
      this.syncWindowsToTileTreeOrder();
    }
    this.tileDragTargets.clear();
    this.tileDragTargetWindowId = null;
    this.tileDragDropZone = null;
    this.tileDragPreview = null;
    window.state[WINDOW_STATE_TILE_DRAGGING].set(false);
    this.syncWindowVisibleOutputs(window);
    window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
    window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(this.isActive() ? 1 : 0);
    if (!cancelled) {
      this.activeWindowId = window.id;
    }
    this.applyLayout();
    if (!cancelled && this.isActive()) {
      window.focus();
    }
  }

  public focusWindow(window: WaylandWindow) {
    if (!this.shouldTile(window)) {
      return;
    }
    if (this.activeWindowId === window.id) {
      return;
    }
    this.activeWindowId = window.id;
    this.applyLayout();
  }

  /**
   * Make a tiled target active and apply its workspace layout.
   */
  public panToWindow(window: WaylandWindow) {
    if (!this.shouldTile(window)) {
      return;
    }
    this.activeWindowId = window.id;
    this.applyLayout();
  }

  public focusWindowUnderPointer(
    window: WaylandWindow,
  ): WaylandWindow | undefined {
    if (
      !this.hasWindow(window) ||
      window.state[WINDOW_STATE_MINIMIZED]()
    ) {
      return undefined;
    }

    const focused = this.focusedWindow();
    if (
      focused &&
      focused.id !== window.id &&
      this.areTransientRelatives(focused, window)
    ) {
      return undefined;
    }

    if (read(window.isFocused)) {
      return undefined;
    }

    if (this.shouldTile(window)) {
      const previousActiveWindowId = this.activeWindowId;
      this.activeWindowId = window.id;
      if (previousActiveWindowId !== window.id) {
        this.reapplyStaticManagedLayout();
      }
    }
    window.focus();
    return window;
  }

  private areTransientRelatives(a: WaylandWindow, b: WaylandWindow): boolean {
    return (
      this.isTransientChildOf(a, b) ||
      this.isTransientChildOf(b, a) ||
      this.hasUnparentedTransientAffinity(a, b)
    );
  }

  private isTransientChildOf(
    child: WaylandWindow,
    parent: WaylandWindow,
  ): boolean {
    return child.isTransient() && child.parentId() === parent.id;
  }

  private hasUnparentedTransientAffinity(
    a: WaylandWindow,
    b: WaylandWindow,
  ): boolean {
    const transient = !this.shouldTile(a) && a.isTransient() ? a : null;
    const other =
      transient === a ? b : !this.shouldTile(b) && b.isTransient() ? b : null;
    if (!transient || !other || transient.parentId()) {
      return false;
    }

    const transientAppId = transient.appId();
    return transientAppId !== undefined && transientAppId === other.appId();
  }

  private reapplyStaticManagedLayout(): void {
    const tileable = this.tileableWindows();
    if (tileable.length === 0) {
      return;
    }

    withManagedWindowOnlySSDRebuildSuppressed(
      () => {
        this.applyLayout({
          animate: false,
          preserveMissingActive: true,
          cancelRectAnimations: false,
        });
      },
      { strict: true },
    );
    for (const window of tileable) {
      markManagedWindowDirty(window.id);
    }
  }

  public focusDirection(direction: WindowDirection): boolean {
    const focused = this.focusedWindow();
    if (!focused) {
      const active = this.activeWindow();
      if (!active) return false;
      active.focus();
      return true;
    }
    const focusedRect = focused.state[WINDOW_STATE_RECT]();
    const focusedX = read(focusedRect.x) + read(focusedRect.width) / 2;
    const focusedY = read(focusedRect.y) + read(focusedRect.height) / 2;
    const candidates = this.windows
      .filter(
        (window) =>
          window.id !== focused.id &&
          !window.state[WINDOW_STATE_MINIMIZED](),
      )
      .map((window) => {
        const rect = window.state[WINDOW_STATE_RECT]();
        const x = read(rect.x) + read(rect.width) / 2;
        const y = read(rect.y) + read(rect.height) / 2;
        const dx = x - focusedX;
        const dy = y - focusedY;
        const inDirection =
          (direction === "left" && dx < 0) ||
          (direction === "right" && dx > 0) ||
          (direction === "up" && dy < 0) ||
          (direction === "down" && dy > 0);
        return { window, dx, dy, inDirection };
      })
      .filter(({ inDirection }) => inDirection)
      .sort((a, b) => {
        const aDistance = a.dx * a.dx + a.dy * a.dy;
        const bDistance = b.dx * b.dx + b.dy * b.dy;
        return aDistance - bDistance;
      });
    const next = candidates[0]?.window;
    if (!next) {
      return false;
    }
    this.activeWindowId = next.id;
    if (this.shouldTile(next)) {
      this.applyLayout();
    }
    next.focus();
    return true;
  }

  public nearestTile(origin: Rect): WaylandWindow | undefined {
    const candidates = this.tileableWindows().map((window) => ({
      window,
      ...numericRect(window.state[WINDOW_STATE_RECT]()),
    }));
    return findNearestRect(candidates, origin)?.window;
  }

  public visibleWindowById(windowId: string): WaylandWindow | undefined {
    return this.windows.find(
      (window) =>
        window.id === windowId && this.isTileable(window),
    );
  }

  public usableRect(): Rect {
    const output = COMPOSITOR.output.current[this.monitor];
    const usable = COMPOSITOR.layer.usableArea(this.monitor);
    if (usable) return usable;
    if (output?.resolution) {
      return {
        x: output.position.x,
        y: output.position.y,
        width: output.resolution.width / output.scale,
        height: output.resolution.height / output.scale,
      };
    }
    return { x: 0, y: 0, width: 1280, height: 720 };
  }

  public swapFocusedTile(direction: WindowDirection): boolean {
    const focused = this.focusedWindow();
    if (!focused || !this.shouldTile(focused)) return false;
    const rect = focused.state[WINDOW_STATE_RECT]();
    const x = read(rect.x) + read(rect.width) / 2;
    const y = read(rect.y) + read(rect.height) / 2;
    const next = this.tileableWindows()
      .filter((window) => window.id !== focused.id)
      .map((window) => {
        const candidate = window.state[WINDOW_STATE_RECT]();
        return {
          window,
          dx: read(candidate.x) + read(candidate.width) / 2 - x,
          dy: read(candidate.y) + read(candidate.height) / 2 - y,
        };
      })
      .filter(({ dx, dy }) =>
        (direction === "left" && dx < 0) ||
        (direction === "right" && dx > 0) ||
        (direction === "up" && dy < 0) ||
        (direction === "down" && dy > 0),
      )
      .sort((a, b) => a.dx * a.dx + a.dy * a.dy - (b.dx * b.dx + b.dy * b.dy))[0]?.window;
    if (!next || !this.tileTree.swap(focused.id, next.id)) return false;
    this.activeWindowId = focused.id;
    this.applyLayout();
    focused.focus();
    return true;
  }

  public moveFocusedFloatingWindow(deltaX: number, deltaY: number) {
    const focused = this.focusedWindow();
    if (!focused || this.shouldTile(focused)) {
      return;
    }
    const rect = focused.state[WINDOW_STATE_RECT]();
    const nextRect = {
      x: read(rect.x) + deltaX,
      y: read(rect.y) + deltaY,
      width: read(rect.width),
      height: read(rect.height),
    };
    focused.state[WINDOW_STATE_RECT].set(nextRect);
    this.syncFloatingWindowRect(focused, nextRect);
  }

  public resizeFocusedWindow(deltaX: number, deltaY: number) {
    const focused = this.focusedWindow();
    if (!focused || !read(focused.isResizable)) {
      return;
    }
    if (this.shouldTile(focused)) {
      const edge: WindowDirection =
        deltaX < 0 ? "left" : deltaX > 0 ? "right" : deltaY < 0 ? "up" : "down";
      if (this.tileTree.resizeEdge(focused.id, edge)) {
        this.applyLayout();
      }
      return;
    }
    const rect = focused.state[WINDOW_STATE_RECT]();
    const nextRect = {
      x: read(rect.x),
      y: read(rect.y),
      width: Math.max(1, read(rect.width) + deltaX),
      height: Math.max(1, read(rect.height) + deltaY),
    };
    focused.state[WINDOW_STATE_RECT].set(nextRect);
    this.syncFloatingWindowRect(focused, nextRect);
  }

  public focusActiveWindow() {
    const active = this.windows.find(
      (window) => window.id === this.activeWindowId,
    );
    active?.focus();
  }

  public shouldTile(window: WaylandWindow): boolean {
    const constraints = window.sizeConstraints();
    const fixedSize =
      constraints.min?.width === constraints.max?.width &&
      constraints.min?.height === constraints.max?.height &&
      constraints.min !== undefined;
    return (
      window.isResizable() &&
      !window.isTransient() &&
      !fixedSize &&
      !window.state[WINDOW_STATE_FORCE_FLOATING]()
    );
  }

  public reclassifyWindow(window: WaylandWindow, wasTileable: boolean) {
    if (!this.hasWindow(window)) {
      this.syncWindowVisibleOutputs(window);
      return;
    }

    const isTileable = this.shouldTile(window);
    if (wasTileable === isTileable) {
      return;
    }

    let restoredInitialActiveWindowId: string | null | undefined;
    if (!isTileable) {
      const windowIndex = this.tileTree.leafIds().indexOf(window.id);
      this.tileTree.remove(window.id);
      const initialTileState = this.initialTileStateByWindowId.get(window.id);
      this.initialTileStateByWindowId.delete(window.id);
      if (initialTileState) {
        restoredInitialActiveWindowId = initialTileState.activeWindowId;
      }
      stopRectAnimation(window, WINDOW_STATE_RECT);

      if (this.activeWindowId === window.id) {
        // The slot this window has just vacated by ceasing to be tileable.
        const tileable = this.tileableWindows();
        this.activeWindowId =
          (restoredInitialActiveWindowId &&
          tileable.some(
            (current) => current.id === restoredInitialActiveWindowId,
          )
            ? restoredInitialActiveWindowId
            : tileable[Math.min(windowIndex, tileable.length - 1)]?.id) ?? null;
      }
    } else {
      this.tileTree.insert(window.id, this.activeWindowId, numericRect(this.tileViewportRect()));
      const contentRect = window.state[WINDOW_STATE_FLOATING_RECT]();
      const viewportRect = contentRect
        ? this.floatingContentRectToViewportRect(contentRect)
        : window.state[WINDOW_STATE_RECT]();
      window.state[WINDOW_STATE_FLOATING_RECT].set(viewportRect);
      if (read(window.isFocused) || !this.activeWindowId) {
        this.activeWindowId = window.id;
      }
    }

    this.syncWindowVisibleOutputs(window);
    this.applyLayout({
      suppressSSDRebuild: false,
      preserveMissingActive: true,
    });
  }

  public setWindowMinimized(window: WaylandWindow, minimized: boolean): void {
    if (!this.shouldTile(window)) return;
    if (minimized) {
      const index = this.tileTree.leafIds().indexOf(window.id);
      this.minimizedTileIndexByWindowId.set(window.id, index);
      this.tileTree.remove(window.id);
      if (this.activeWindowId === window.id) {
        const remaining = this.tileableWindows();
        this.activeWindowId = remaining[Math.min(Math.max(0, index), remaining.length - 1)]?.id ?? null;
        this.activeWindow()?.focus();
      }
      layoutDebug("remove minimized", { window: window.id, workspace: `${this.monitor}:${this.index}` });
    } else if (!this.tileTree.has(window.id)) {
      this.tileTree.insert(window.id, this.activeWindowId, numericRect(this.tileViewportRect()));
      const index = this.minimizedTileIndexByWindowId.get(window.id);
      if (index !== undefined && index >= 0) this.tileTree.moveToIndex(window.id, index);
      this.minimizedTileIndexByWindowId.delete(window.id);
      this.activeWindowId = window.id;
      layoutDebug("insert restored", { window: window.id, workspace: `${this.monitor}:${this.index}` });
    }
    this.applyLayout();
  }

  public snapshot(): WorkspaceSnapshot {
    return {
      monitor: this.monitor,
      index: this.index,
      activeWindowId: this.activeWindowId,
      tileTree: this.tileTree.snapshot(),
      windows: this.windows.map((window) => this.snapshotWindow(window)),
    };
  }

  public restore(snapshot: WorkspaceSnapshot) {
    this.activeWindowId = snapshot.activeWindowId;
    this.tileTree.restore(snapshot.tileTree ?? null);
    this.restoredWindowStateById.clear();
    for (const window of snapshot.windows) {
      this.restoredWindowStateById.set(window.id, window);
    }
    hotReloadDebug("workspace-restore", {
      monitor: this.monitor,
      index: this.index,
      activeWindowId: this.activeWindowId,
      restoredWindowIds: Array.from(this.restoredWindowStateById.keys()),
    });
  }

  public getWindows(): WaylandWindow[] {
    return Array.from(this.windows);
  }

  private snapshotWindow(window: WaylandWindow): WorkspaceWindowSnapshot {
    return {
      id: window.id,
      floatingRect: window.state[WINDOW_STATE_FLOATING_RECT](),
      restoreRect: window.state[WINDOW_STATE_RESTORE_RECT](),
      snapZone: window.state[WINDOW_STATE_SNAP_ZONE](),
      snapMonitor: window.state[WINDOW_STATE_SNAP_MONITOR](),
      minimized: window.state[WINDOW_STATE_MINIMIZED](),
      maximized: window.state[WINDOW_STATE_MAXIMIZED](),
      fullscreen: window.state[WINDOW_STATE_FULLSCREEN](),
      fullscreenRestoreRect: window.state[WINDOW_STATE_FULLSCREEN_RESTORE_RECT](),
      forceFloating: window.state[WINDOW_STATE_FORCE_FLOATING](),
    };
  }

  private syncWindowVisibleOutputs(window: WaylandWindow) {
    window.state[WINDOW_STATE_TILED].set(this.shouldTile(window));
    window.state[WINDOW_STATE_VISIBLE_OUTPUTS].set([this.monitor]);
  }

  private canSuppressLayoutSSDRebuild(_tileable: WaylandWindow[]): boolean {
    // Opening windows may still be building decoration structure, labels,
    // icons, and shader inputs. SSD rebuild suppression is global, so using
    // it for existing windows' layout animation would also hide those
    // initial decoration updates until an unrelated interaction occurs.
    return true;
  }

  /**
   * Whether `window` occupies a slot in the tile sequence right now.
   * Minimized windows are excluded because they hold no slot, so they must
   * not be counted when translating a position into that sequence.
   */
  private isTileable(window: WaylandWindow): boolean {
    return this.shouldTile(window) && !window.state[WINDOW_STATE_MINIMIZED]();
  }

  private tileableWindows(): WaylandWindow[] {
    const byId = new Map(
      this.windows.filter((window) => this.isTileable(window)).map((window) => [window.id, window]),
    );
    return this.tileTree.leafIds().flatMap((id) => {
      const window = byId.get(id);
      return window ? [window] : [];
    });
  }

  private syncTileTreeMembership(): void {
    if (this.restoredWindowStateById.size > 0) return;
    const expected = this.windows.filter((window) => this.isTileable(window));
    const expectedIds = new Set(expected.map((window) => window.id));
    for (const id of this.tileTree.leafIds()) {
      if (!expectedIds.has(id)) this.tileTree.remove(id);
    }
    for (const window of expected) {
      if (!this.tileTree.has(window.id)) {
        this.tileTree.insert(window.id, this.activeWindowId, numericRect(this.tileViewportRect()));
        layoutDebug("repair missing leaf", {
          window: window.id,
          workspace: `${this.monitor}:${this.index}`,
        });
      }
    }
  }

  private validateLayoutState(
    rects: ReadonlyMap<string, TileRect>,
    viewport: ManagedWindowRect,
  ): void {
    if (!layoutDebugEnabled() || this.restoredWindowStateById.size > 0) return;
    const expected = new Set(
      this.windows.filter((window) => this.isTileable(window)).map((window) => window.id),
    );
    const errors = this.tileTree.validate(expected);
    if (this.activeWindowId && !this.windows.some((window) => window.id === this.activeWindowId)) {
      errors.push(`focused window ${this.activeWindowId} does not exist`);
    }
    const left = read(viewport.x);
    const top = read(viewport.y);
    const right = left + read(viewport.width);
    const bottom = top + read(viewport.height);
    for (const [id, rect] of rects) {
      const values = [rect.x, rect.y, rect.width, rect.height];
      if (values.some((value) => !Number.isFinite(value)) || rect.width <= 0 || rect.height <= 0) {
        errors.push(`invalid geometry for ${id}: ${JSON.stringify(rect)}`);
      } else if (
        rect.x < left - 0.001 ||
        rect.y < top - 0.001 ||
        rect.x + rect.width > right + 0.001 ||
        rect.y + rect.height > bottom + 0.001
      ) {
        errors.push(`geometry outside usable area for ${id}: ${JSON.stringify(rect)}`);
      }
    }
    if (errors.length > 0) {
      console.error(
        `[layout] invariant violation workspace=${this.monitor}:${this.index}`,
        JSON.stringify({ errors, tree: this.tileTree.dump() }),
      );
    }
  }

  public focusedWindow(): WaylandWindow | undefined {
    return this.windows.find((window) => read(window.isFocused));
  }

  public commandWindow(): WaylandWindow | undefined {
    return this.focusedWindow() ?? this.activeWindow();
  }

  public syncFloatingWindowRect(
    window: WaylandWindow,
    viewportRect: ManagedWindowRect,
  ) {
    if (this.shouldTile(window)) {
      return;
    }
    window.state[WINDOW_STATE_FLOATING_RECT].set(
      this.viewportRectToFloatingContentRect(viewportRect),
    );
  }

  private activeWindow(windows = this.windows): WaylandWindow | undefined {
    return windows.find((window) => window.id === this.activeWindowId);
  }

  private resetTileDragTargets(draggedWindowId: string): void {
    const ids = this.tileTree.leafIds();
    const rects = this.tileTree.rects(numericRect(this.tileViewportRect()), TILE_GAP);
    this.tileDragTargets = new Map(
      ids.flatMap((windowId, index) => {
        const rect = rects.get(windowId);
        const window = this.findWindowById(windowId);
        return windowId === draggedWindowId || !rect || !window || window.state[WINDOW_STATE_FULLSCREEN]()
          ? []
          : [[windowId, { rect, index }] as const];
      }),
    );
    this.tileDragTargetWindowId = null;
    this.tileDragDropZone = null;
    this.tileDragPreview = null;
  }

  private tileDragTargetForPointer(
    pointerX: number,
    pointerY: number,
  ): { windowId: string; index: number; rect: TileRect } | null {
    const target = tileDragTargetAtPointer(this.tileDragTargets, pointerX, pointerY);
    if (!target) return null;
    const rect = this.tileDragTargets.get(target.windowId)?.rect;
    return rect ? { ...target, rect } : null;
  }

  public tileDragPreviewRect(): ManagedWindowRect | null {
    return this.tileDragPreview;
  }

  public tileDragZone(): TileDropZone | null {
    return this.tileDragDropZone;
  }

  private syncWindowsToTileTreeOrder(): void {
    const order = new Map(this.tileTree.leafIds().map((id, index) => [id, index]));
    this.windows.sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  public floatingWindows(): WaylandWindow[] {
    return this.windows.filter(
      (window) =>
        !this.shouldTile(window) && !window.state[WINDOW_STATE_MINIMIZED](),
    );
  }

  private applyFloatingLayout(
    animationOptions: LayoutOptions | undefined,
    animate = true,
  ) {
    for (const window of this.floatingWindows()) {
      // A maximized window's rect is owned by the maximize flow.
      if (window.state[WINDOW_STATE_MAXIMIZED]()) {
        continue;
      }
      const contentRect =
        window.state[WINDOW_STATE_FLOATING_RECT]() ??
        this.viewportRectToFloatingContentRect(
          this.centeredFloatingRect(window),
        );
      window.state[WINDOW_STATE_FLOATING_RECT].set(contentRect);
      const rect = this.floatingContentRectToViewportRect(contentRect);
      if (animate) {
        playRectAnimation(
          window,
          WINDOW_STATE_RECT,
          rect,
          WINDOW_MANAGEMENT_EASING,
          TILE_ANIMATION_DURATION,
          animationOptions,
        );
      } else {
        stopRectAnimation(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(rect);
      }
      hotReloadDebug("workspace-apply-floating-layout", {
        monitor: this.monitor,
        index: this.index,
        animate,
        windowId: window.id,
        rect,
        contentRect,
      });
    }
  }

  private centeredFloatingRect(window: WaylandWindow): ManagedWindowRect {
    const sizeRect = this.naturalRootRect(window);
    const monitor = COMPOSITOR.output.current[this.monitor];
    if (!monitor?.resolution) {
      return sizeRect;
    }

    const usableRect = COMPOSITOR.layer.usableArea(this.monitor);
    const logicalWidth =
      usableRect?.width ?? monitor.resolution.width / monitor.scale;
    const logicalHeight =
      usableRect?.height ?? monitor.resolution.height / monitor.scale;
    const logicalX = usableRect?.x ?? monitor.position.x;
    const logicalY = usableRect?.y ?? monitor.position.y;

    let width = read(sizeRect.width);
    let height = read(sizeRect.height);
    // Reading the natural size while the client geometry is still unsettled
    // (≈0, e.g. right after the first commit) yields a degenerate rect that
    // is nothing but the SSD frame. Freezing that as the floating restore
    // rect would later configure the client to a tiny size when switching to
    // floating restore. Fall back to a default size based on the usable area
    // only when the rect is clearly degenerate (frame + titlebar at most).
    // 50px is a conservative threshold that no real app's natural size ever
    // falls under.
    const DEGENERATE_SIZE_PX = 50;
    if (width < DEGENERATE_SIZE_PX || height < DEGENERATE_SIZE_PX) {
      width = Math.round(logicalWidth * 0.6);
      height = Math.round(logicalHeight * 0.7);
    }
    const rule = windowRule(window);
    if (rule?.widthFraction !== undefined) {
      width = Math.round(logicalWidth * rule.widthFraction);
    }
    if (rule?.heightFraction !== undefined) {
      height = Math.round(logicalHeight * rule.heightFraction);
    }

    return {
      x: logicalX + (logicalWidth - width) / 2,
      y: logicalY + (logicalHeight - height) / 2,
      width,
      height,
    };
  }

  private viewportRectToFloatingContentRect(
    rect: ManagedWindowRect,
  ): ManagedWindowRect {
    return {
      x: read(rect.x),
      y: read(rect.y),
      width: read(rect.width),
      height: read(rect.height),
    };
  }

  private floatingContentRectToViewportRect(
    rect: ManagedWindowRect,
  ): ManagedWindowRect {
    return {
      x: read(rect.x),
      y: read(rect.y),
      width: read(rect.width),
      height: read(rect.height),
    };
  }

  private clampRectToViewport(rect: ManagedWindowRect): ManagedWindowRect {
    const viewport = this.tileViewportRect();
    const width = read(rect.width);
    const height = read(rect.height);
    const minX = read(viewport.x);
    const minY = read(viewport.y);
    const maxX = minX + Math.max(0, read(viewport.width) - width);
    const maxY = minY + Math.max(0, read(viewport.height) - height);
    return {
      x: clamp(read(rect.x), minX, maxX),
      y: clamp(read(rect.y), minY, maxY),
      width,
      height,
    };
  }

  private tileViewportRect(tileCount = this.tileTree.leafIds().length): ManagedWindowRect {
    const monitor = COMPOSITOR.output.current[this.monitor];
    const usableRect = COMPOSITOR.layer.usableArea(this.monitor);
    const base =
      usableRect ??
      (monitor?.resolution
        ? {
            x: monitor.position.x,
            y: monitor.position.y,
            width: monitor.resolution.width / monitor.scale,
            height: monitor.resolution.height / monitor.scale,
          }
        : {
            x: 0,
            y: 0,
            width: 1280,
            height: 720,
          });

    const outerGap =
      tileCount === 1 ? theme.metrics.singleWindowGap : theme.metrics.outerGap;
    return insetRect(base, {
      top: outerGap,
      right: outerGap,
      bottom: outerGap,
      left: outerGap,
    });
  }

  private fullscreenRootRect(window: WaylandWindow): ManagedWindowRect {
    const monitor = COMPOSITOR.output.current[this.monitor];
    if (monitor?.resolution) {
      return {
        x: monitor.position.x,
        y: monitor.position.y,
        width: monitor.resolution.width / monitor.scale,
        height: monitor.resolution.height / monitor.scale,
      };
    }
    return window.state[WINDOW_STATE_RECT]();
  }
}

function workspaceKey(monitor: string, index: number): string {
  return `${monitor}:${index}`;
}

function constrainedMax(
  constraints: WindowSizeConstraints,
  axis: "width" | "height",
  extra: number,
): number {
  const max = constraints.max?.[axis];
  return max && max > 0 ? max + extra : Number.POSITIVE_INFINITY;
}

function resizeOriginForAxis(
  start: WindowResizeRect,
  current: WindowResizeRect,
  constrainedSize: number,
  negativeEdge: boolean,
  axis: "x" | "y",
): number {
  if (!negativeEdge) {
    return current[axis];
  }

  const startSize = axis === "x" ? start.width : start.height;
  return start[axis] + startSize - constrainedSize;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function insetRect(
  rect: ManagedWindowRect,
  padding: { top: number; right: number; bottom: number; left: number },
): ManagedWindowRect {
  const width = Math.max(1, read(rect.width) - padding.left - padding.right);
  const height = Math.max(1, read(rect.height) - padding.top - padding.bottom);
  return {
    x: read(rect.x) + padding.left,
    y: read(rect.y) + padding.top,
    width,
    height,
  };
}

function snapshotManagedRect(rect: ManagedWindowRect): ManagedWindowRect {
  return {
    x: read(rect.x),
    y: read(rect.y),
    width: read(rect.width),
    height: read(rect.height),
  };
}

function numericRect(rect: ManagedWindowRect): TileRect {
  return {
    x: read(rect.x),
    y: read(rect.y),
    width: read(rect.width),
    height: read(rect.height),
  };
}

function managedRectEquals(
  a: ManagedWindowRect,
  b: ManagedWindowRect,
): boolean {
  return (
    read(a.x) === read(b.x) &&
    read(a.y) === read(b.y) &&
    read(a.width) === read(b.width) &&
    read(a.height) === read(b.height)
  );
}

function isLayoutSnapZone(zone: SnapZone | null): zone is LayoutSnapZone {
  return zone !== null && zone !== "maximize";
}

function snapZonesConflict(
  current: SnapZone | null,
  next: LayoutSnapZone,
): boolean {
  if (!isLayoutSnapZone(current)) {
    return false;
  }
  if (current === next) {
    return true;
  }

  if (next === "left") {
    return current === "top-left" || current === "bottom-left";
  }
  if (next === "right") {
    return current === "top-right" || current === "bottom-right";
  }
  if (current === "left") {
    return next === "top-left" || next === "bottom-left";
  }
  if (current === "right") {
    return next === "top-right" || next === "bottom-right";
  }
  return false;
}

function withManagedWindowOnlySSDRebuildSuppressed<T>(
  callback: () => T,
  options: { strict?: boolean } = {},
): T {
  return COMPOSITOR.runtime.withSSDRebuildSuppressed(
    options.strict
      ? STRICT_MANAGED_WINDOW_ONLY_REBUILD_SUPPRESSION
      : MANAGED_WINDOW_ONLY_REBUILD_SUPPRESSION,
    callback,
  );
}

// Rect deltas use `add` so open/close/workspace motion can layer on top of
// override-mode layout animation. Open/close opacity uses `multiply`; workspace
// opacity is a separate override channel so an inactive workspace whose base
// opacity is already 0 can still fade back in deterministically.

function scheduleOpenAnimation(window: WaylandWindow): void {
  window.scheduleAnimation({
    channel: OPEN_ANIMATION_CHANNEL,
    rect: {
      from: { x: 0, y: theme.animation.openOffsetY, width: 0, height: 0 },
      to: { x: 0, y: 0, width: 0, height: 0 },
      duration: theme.animation.openDuration,
      easing: WINDOW_OPEN_EASING,
      mode: "add",
    },
    opacity: {
      from: 0,
      to: 1,
      duration: theme.animation.openDuration,
      easing: WINDOW_OPEN_EASING,
      mode: "multiply",
    },
  });
}

function scheduleCloseAnimation(window: WaylandWindow): void {
  window.scheduleAnimation({
    channel: CLOSE_ANIMATION_CHANNEL,
    rect: {
      from: { x: 0, y: 0, width: 0, height: 0 },
      to: { x: 0, y: theme.animation.closeOffsetY, width: 0, height: 0 },
      duration: theme.animation.closeDuration,
      easing: WINDOW_CLOSE_EASING,
      mode: "add",
    },
    opacity: {
      from: 1,
      to: 0,
      duration: theme.animation.closeDuration,
      easing: WINDOW_CLOSE_EASING,
      mode: "multiply",
    },
  });
}

function scheduleMinimizeAnimation(
  window: WaylandWindow,
  minimized: boolean,
): void {
  window.scheduleAnimation({
    channel: MINIMIZE_ANIMATION_CHANNEL,
    rect: {
      from: minimized
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: 0, y: theme.animation.minimizeOffsetY, width: 0, height: 0 },
      to: minimized
        ? { x: 0, y: theme.animation.minimizeOffsetY, width: 0, height: 0 }
        : { x: 0, y: 0, width: 0, height: 0 },
      duration: theme.animation.openDuration,
      easing: minimized
        ? WINDOW_MINIMIZE_RECT_EASING
        : WINDOW_UNMINIMIZE_RECT_EASING,
      mode: "add",
    },
    opacity: {
      from: minimized ? 1 : 0,
      to: minimized ? 0 : 1,
      duration: theme.animation.openDuration,
      easing: minimized
        ? WINDOW_MINIMIZE_OPACITY_EASING
        : WINDOW_UNMINIMIZE_OPACITY_EASING,
      mode: "multiply",
    },
  });
}

function scheduleWorkspaceVisualAnimation(
  window: WaylandWindow,
  fromOffsetY: number,
  toOffsetY: number,
  fromOpacity: number,
  toOpacity: number,
  easing: EasingFunction,
  duration: number,
): void {
  cancelWorkspaceVisualAnimation(window);
  window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
  window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(toOpacity);

  window.scheduleAnimation({
    channel: WORKSPACE_VISUAL_RECT_ANIMATION_CHANNEL,
    rect: {
      from: { x: 0, y: fromOffsetY, width: 0, height: 0 },
      to: { x: 0, y: toOffsetY, width: 0, height: 0 },
      duration,
      easing,
      mode: "add",
    },
  });
  window.scheduleAnimation({
    channel: WORKSPACE_VISUAL_OPACITY_ANIMATION_CHANNEL,
    opacity: {
      from: fromOpacity,
      to: toOpacity,
      duration,
      easing,
      mode: "multiply",
    },
  });
}

function resetWorkspaceVisualState(
  window: WaylandWindow,
  visible: boolean,
): void {
  cancelWorkspaceVisualAnimation(window);
  window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(visible);
  window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
  window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(visible ? 1 : 0);
}

function cancelWorkspaceVisualAnimation(window: WaylandWindow): void {
  window.cancelAnimation(WORKSPACE_VISUAL_ANIMATION_CHANNEL);
  window.cancelAnimation(WORKSPACE_VISUAL_RECT_ANIMATION_CHANNEL);
  window.cancelAnimation(WORKSPACE_VISUAL_OPACITY_ANIMATION_CHANNEL);
}
