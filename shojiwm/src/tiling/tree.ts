export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SplitDirection = "horizontal" | "vertical";
export type TileEdge = "left" | "right" | "up" | "down";
export type TileDropZone = "left" | "right" | "top" | "bottom" | "center";

export type TileNode =
  | { type: "leaf"; windowId: string }
  | {
      type: "split";
      direction: SplitDirection;
      ratio: number;
      first: TileNode;
      second: TileNode;
    };

export interface TileResizeHandle {
  node: Extract<TileNode, { type: "split" }>;
  startRatio: number;
  availableSize: number;
}

const RATIO_STEP = 0.05;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

function cloneNode(node: TileNode): TileNode {
  return node.type === "leaf"
    ? { ...node }
    : { ...node, first: cloneNode(node.first), second: cloneNode(node.second) };
}

function splitGeometry(size: number, gap: number, ratio: number) {
  size = Math.max(0.001, size);
  const minimumChildSize = Math.min(1, size / 2);
  const effectiveGap = Math.max(0, Math.min(gap, size - minimumChildSize * 2));
  const availableSize = size - effectiveGap;
  const firstSize = Math.max(
    minimumChildSize,
    Math.min(availableSize - minimumChildSize, Math.round(availableSize * ratio)),
  );
  return { effectiveGap, availableSize, firstSize, secondSize: availableSize - firstSize };
}

export class TileTree {
  private root: TileNode | null = null;

  public insert(windowId: string, focusedId: string | null, area: TileRect): void {
    if (this.has(windowId)) return;
    if (!this.root) {
      this.root = { type: "leaf", windowId };
      return;
    }
    const targetId = this.has(focusedId) ? focusedId! : this.lastLeafId(this.root);
    const target = this.rects(area).get(targetId) ?? area;
    const direction: SplitDirection = target.width >= target.height ? "vertical" : "horizontal";
    this.root = this.replaceLeaf(this.root, targetId, (old) => ({
      type: "split",
      direction,
      ratio: 0.5,
      first: old,
      second: { type: "leaf", windowId },
    }));
  }

  public remove(windowId: string): void {
    this.root = this.removeLeaf(this.root, windowId);
  }

  public has(windowId: string | null): boolean {
    return windowId !== null && this.leafIds().includes(windowId);
  }

  public leafIds(): string[] {
    const ids: string[] = [];
    const visit = (node: TileNode | null): void => {
      if (!node) return;
      if (node.type === "leaf") ids.push(node.windowId);
      else {
        visit(node.first);
        visit(node.second);
      }
    };
    visit(this.root);
    return ids;
  }

  public rects(area: TileRect, gap = 8): Map<string, TileRect> {
    const result = new Map<string, TileRect>();
    const visit = (node: TileNode | null, rect: TileRect): void => {
      if (!node) return;
      if (node.type === "leaf") {
        result.set(node.windowId, rect);
        return;
      }
      const size = node.direction === "vertical" ? rect.width : rect.height;
      const { effectiveGap, firstSize, secondSize } = splitGeometry(size, gap, node.ratio);
      if (node.direction === "vertical") {
        visit(node.first, { ...rect, width: firstSize });
        visit(node.second, { ...rect, x: rect.x + firstSize + effectiveGap, width: secondSize });
      } else {
        visit(node.first, { ...rect, height: firstSize });
        visit(node.second, { ...rect, y: rect.y + firstSize + effectiveGap, height: secondSize });
      }
    };
    visit(this.root, area);
    return result;
  }

  public resize(windowId: string, direction: SplitDirection, delta: -1 | 1): boolean {
    const path = this.pathTo(windowId);
    for (const { node, isFirst } of path) {
      if (node.direction !== direction) continue;
      node.ratio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, node.ratio + RATIO_STEP * (isFirst ? delta : -delta)));
      return true;
    }
    return false;
  }

  public resizeEdge(windowId: string, edge: TileEdge): boolean {
    const direction: SplitDirection = edge === "left" || edge === "right" ? "vertical" : "horizontal";
    const negativeEdge = edge === "left" || edge === "up";
    for (const { node } of this.pathTo(windowId)) {
      if (node.direction !== direction) continue;
      node.ratio = Math.max(
        MIN_RATIO,
        Math.min(MAX_RATIO, node.ratio + (negativeEdge ? -RATIO_STEP : RATIO_STEP)),
      );
      return true;
    }
    return false;
  }

  public beginPointerResize(
    windowId: string,
    direction: SplitDirection,
    negativeEdge: boolean,
    area: TileRect,
    gap = 8,
  ): TileResizeHandle | null {
    for (const { node, isFirst } of this.pathTo(windowId)) {
      if (node.direction !== direction || isFirst === negativeEdge) continue;
      const rect = this.nodeRects(area, gap).get(node);
      if (!rect) return null;
      const size = direction === "vertical" ? rect.width : rect.height;
      const { availableSize } = splitGeometry(size, gap, node.ratio);
      return { node, startRatio: node.ratio, availableSize };
    }
    return null;
  }

  public updatePointerResize(handle: TileResizeHandle, pointerDelta: number): number {
    handle.node.ratio = Math.max(
      MIN_RATIO,
      Math.min(MAX_RATIO, handle.startRatio + pointerDelta / handle.availableSize),
    );
    return handle.node.ratio;
  }

  public moveToIndex(windowId: string, targetIndex: number): boolean {
    const ids = this.leafIds();
    const currentIndex = ids.indexOf(windowId);
    if (currentIndex < 0) return false;
    const boundedTarget = Math.max(0, Math.min(ids.length - 1, targetIndex));
    if (currentIndex === boundedTarget) return false;
    ids.splice(currentIndex, 1);
    ids.splice(boundedTarget, 0, windowId);
    let index = 0;
    const assign = (node: TileNode): void => {
      if (node.type === "leaf") node.windowId = ids[index++];
      else {
        assign(node.first);
        assign(node.second);
      }
    };
    if (this.root) assign(this.root);
    return true;
  }

  public snapshot(): TileNode | null {
    return this.root ? cloneNode(this.root) : null;
  }

  public restore(root: TileNode | null): void {
    this.root = root ? cloneNode(root) : null;
  }

  public validate(expectedWindowIds?: ReadonlySet<string>): string[] {
    const errors: string[] = [];
    const seen = new Set<string>();
    const visit = (node: TileNode | null): void => {
      if (!node) return;
      if (node.type === "leaf") {
        if (!node.windowId) errors.push("leaf has no window");
        if (seen.has(node.windowId)) errors.push(`duplicate window ${node.windowId}`);
        if (expectedWindowIds && !expectedWindowIds.has(node.windowId)) errors.push(`stale window ${node.windowId}`);
        seen.add(node.windowId);
        return;
      }
      if (!node.first || !node.second) errors.push("split does not have two children");
      if (!Number.isFinite(node.ratio) || node.ratio < MIN_RATIO || node.ratio > MAX_RATIO) {
        errors.push(`invalid ${node.direction} ratio ${node.ratio}`);
      }
      visit(node.first);
      visit(node.second);
    };
    visit(this.root);
    if (expectedWindowIds) {
      for (const id of expectedWindowIds) if (!seen.has(id)) errors.push(`missing window ${id}`);
    }
    return errors;
  }

  public dump(): string {
    const print = (node: TileNode | null): string =>
      !node ? "empty" : node.type === "leaf" ? node.windowId : `${node.direction}(${node.ratio.toFixed(3)}, ${print(node.first)}, ${print(node.second)})`;
    return print(this.root);
  }

  public swap(firstId: string, secondId: string): boolean {
    if (firstId === secondId || !this.has(firstId) || !this.has(secondId)) return false;
    const swap = (node: TileNode): void => {
      if (node.type === "leaf") {
        if (node.windowId === firstId) node.windowId = secondId;
        else if (node.windowId === secondId) node.windowId = firstId;
      } else {
        swap(node.first);
        swap(node.second);
      }
    };
    if (this.root) swap(this.root);
    return true;
  }

  public drop(windowId: string, targetId: string, zone: TileDropZone): boolean {
    if (windowId === targetId || !this.has(windowId) || !this.has(targetId)) return false;
    if (zone === "center") return this.swap(windowId, targetId);
    this.root = this.removeLeaf(this.root, windowId);
    if (!this.root) return false;
    const direction: SplitDirection = zone === "left" || zone === "right" ? "vertical" : "horizontal";
    const dragged: TileNode = { type: "leaf", windowId };
    this.root = this.replaceLeaf(this.root, targetId, (target) => ({
      type: "split",
      direction,
      ratio: 0.5,
      first: zone === "left" || zone === "top" ? dragged : target,
      second: zone === "left" || zone === "top" ? target : dragged,
    }));
    return true;
  }

  public previewDrop(
    windowId: string,
    targetId: string,
    zone: TileDropZone,
    area: TileRect,
    gap = 8,
  ): TileRect | null {
    const preview = new TileTree();
    preview.restore(this.snapshot());
    return preview.drop(windowId, targetId, zone)
      ? preview.rects(area, gap).get(windowId) ?? null
      : null;
  }

  private lastLeafId(node: TileNode): string {
    return node.type === "leaf" ? node.windowId : this.lastLeafId(node.second);
  }

  private replaceLeaf(node: TileNode, id: string, replacement: (leaf: Extract<TileNode, { type: "leaf" }>) => TileNode): TileNode {
    if (node.type === "leaf") return node.windowId === id ? replacement(node) : node;
    return { ...node, first: this.replaceLeaf(node.first, id, replacement), second: this.replaceLeaf(node.second, id, replacement) };
  }

  private removeLeaf(node: TileNode | null, id: string): TileNode | null {
    if (!node) return null;
    if (node.type === "leaf") return node.windowId === id ? null : node;
    const first = this.removeLeaf(node.first, id);
    const second = this.removeLeaf(node.second, id);
    return first && second ? { ...node, first, second } : first ?? second;
  }

  private nodeRects(area: TileRect, gap: number): Map<TileNode, TileRect> {
    const result = new Map<TileNode, TileRect>();
    const visit = (node: TileNode, rect: TileRect): void => {
      result.set(node, rect);
      if (node.type === "leaf") return;
      const size = node.direction === "vertical" ? rect.width : rect.height;
      const { effectiveGap, firstSize, secondSize } = splitGeometry(size, gap, node.ratio);
      if (node.direction === "vertical") {
        visit(node.first, { ...rect, width: firstSize });
        visit(node.second, { ...rect, x: rect.x + firstSize + effectiveGap, width: secondSize });
      } else {
        visit(node.first, { ...rect, height: firstSize });
        visit(node.second, { ...rect, y: rect.y + firstSize + effectiveGap, height: secondSize });
      }
    };
    if (this.root) visit(this.root, area);
    return result;
  }

  private pathTo(windowId: string): Array<{ node: Extract<TileNode, { type: "split" }>; isFirst: boolean }> {
    const path: Array<{ node: Extract<TileNode, { type: "split" }>; isFirst: boolean }> = [];
    const visit = (node: TileNode | null): boolean => {
      if (!node) return false;
      if (node.type === "leaf") return node.windowId === windowId;
      if (visit(node.first)) {
        path.push({ node, isFirst: true });
        return true;
      }
      if (visit(node.second)) {
        path.push({ node, isFirst: false });
        return true;
      }
      return false;
    };
    visit(this.root);
    return path;
  }
}
