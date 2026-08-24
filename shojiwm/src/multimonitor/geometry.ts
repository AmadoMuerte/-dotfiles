export type Direction = "left" | "right" | "up" | "down";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NamedRect extends Rect {
  name: string;
}

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function axisDistance(from: Rect, to: Rect, direction: Direction): number {
  if (direction === "left") return from.x - (to.x + to.width);
  if (direction === "right") return to.x - (from.x + from.width);
  if (direction === "up") return from.y - (to.y + to.height);
  return to.y - (from.y + from.height);
}

function liesBeyondEdge(from: Rect, to: Rect, direction: Direction): boolean {
  if (direction === "left") return to.x + to.width <= from.x;
  if (direction === "right") return to.x >= from.x + from.width;
  if (direction === "up") return to.y + to.height <= from.y;
  return to.y >= from.y + from.height;
}

function crossAxisDistance(from: Rect, to: Rect, direction: Direction): number {
  const a = center(from);
  const b = center(to);
  return direction === "left" || direction === "right"
    ? Math.abs(b.y - a.y)
    : Math.abs(b.x - a.x);
}

function isInDirection(from: Rect, to: Rect, direction: Direction): boolean {
  const a = center(from);
  const b = center(to);
  if (direction === "left") return b.x < a.x;
  if (direction === "right") return b.x > a.x;
  if (direction === "up") return b.y < a.y;
  return b.y > a.y;
}

export function findOutputInDirection<T extends NamedRect>(
  outputs: readonly T[],
  currentName: string,
  direction: Direction,
): T | undefined {
  const current = outputs.find((output) => output.name === currentName);
  if (!current) return undefined;
  return outputs
    .filter(
      (output) =>
        output.name !== current.name &&
        isInDirection(current, output, direction),
    )
    .sort((a, b) => {
      const edgeRank = Number(!liesBeyondEdge(current, a, direction)) -
        Number(!liesBeyondEdge(current, b, direction));
      const aAxis = Math.max(0, axisDistance(current, a, direction));
      const bAxis = Math.max(0, axisDistance(current, b, direction));
      return (
        edgeRank ||
        aAxis - bAxis ||
        crossAxisDistance(current, a, direction) -
          crossAxisDistance(current, b, direction)
      );
    })[0];
}

export function findRectInDirection<T extends Rect>(
  rects: readonly T[],
  origin: Rect,
  direction: Direction,
): T | undefined {
  return rects
    .filter((rect) => isInDirection(origin, rect, direction))
    .sort((a, b) => {
      const originCenter = center(origin);
      const aCenter = center(a);
      const bCenter = center(b);
      const aDistance =
        (aCenter.x - originCenter.x) ** 2 +
        (aCenter.y - originCenter.y) ** 2;
      const bDistance =
        (bCenter.x - originCenter.x) ** 2 +
        (bCenter.y - originCenter.y) ** 2;
      return aDistance - bDistance;
    })[0];
}

export function findNearestRect<T extends Rect>(
  rects: readonly T[],
  origin: Rect,
): T | undefined {
  const originCenter = center(origin);
  return rects.slice().sort((a, b) => {
    const aCenter = center(a);
    const bCenter = center(b);
    const aDistance =
      (aCenter.x - originCenter.x) ** 2 +
      (aCenter.y - originCenter.y) ** 2;
    const bDistance =
      (bCenter.x - originCenter.x) ** 2 +
      (bCenter.y - originCenter.y) ** 2;
    return aDistance - bDistance;
  })[0];
}

export function projectRectToOutputEdge(
  rect: Rect,
  from: Rect,
  to: Rect,
  direction: Direction,
): Rect {
  const rectCenter = center(rect);
  const fromCenter = center(from);
  const xRatio = from.width > 0
    ? (rectCenter.x - from.x) / from.width
    : 0.5;
  const yRatio = from.height > 0
    ? (rectCenter.y - from.y) / from.height
    : 0.5;
  const x = direction === "left"
    ? to.x + to.width
    : direction === "right"
      ? to.x
      : to.x + Math.max(0, Math.min(1, xRatio)) * to.width;
  const y = direction === "up"
    ? to.y + to.height
    : direction === "down"
      ? to.y
      : to.y + Math.max(0, Math.min(1, yRatio)) * to.height;
  return { x, y, width: 0, height: 0 };
}

export function moveRectBetweenAreas(
  rect: Rect,
  from: Rect,
  to: Rect,
): Rect {
  const width = Math.min(rect.width, to.width);
  const height = Math.min(rect.height, to.height);
  const xRatio =
    from.width > rect.width
      ? (rect.x - from.x) / (from.width - rect.width)
      : 0.5;
  const yRatio =
    from.height > rect.height
      ? (rect.y - from.y) / (from.height - rect.height)
      : 0.5;
  return {
    x: to.x + Math.max(0, Math.min(1, xRatio)) * (to.width - width),
    y: to.y + Math.max(0, Math.min(1, yRatio)) * (to.height - height),
    width,
    height,
  };
}
