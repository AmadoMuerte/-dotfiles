export const WORKSPACES_PER_MONITOR = 7;

export function workspaceBelongsToMonitor(_index: number, _monitor: string): boolean {
  return true;
}

export function monitorForWorkspace(_index: number, fallbackMonitor: string): string {
  return fallbackMonitor;
}
