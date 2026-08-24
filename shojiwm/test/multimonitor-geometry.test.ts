import {
  findOutputInDirection,
  findRectInDirection,
  moveRectBetweenAreas,
  projectRectToOutputEdge,
} from "../src/multimonitor/geometry.ts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const outputs = [
  { name: "left", x: 0, y: 200, width: 1000, height: 700 },
  { name: "right", x: 1000, y: 0, width: 1000, height: 900 },
  { name: "above", x: 200, y: -700, width: 800, height: 700 },
];

check(
  findOutputInDirection(outputs, "left", "right")?.name === "right",
  "right output must follow real geometry",
);
check(
  findOutputInDirection(outputs, "left", "up")?.name === "above",
  "staggered output above must be found",
);
check(
  findOutputInDirection(outputs, "above", "up") === undefined,
  "missing direction must return undefined",
);

const origin = { x: 800, y: 300, width: 200, height: 200 };
const nearest = findRectInDirection(
  [
    { id: "far", x: 1100, y: 0, width: 200, height: 200 },
    { id: "near", x: 1000, y: 300, width: 200, height: 200 },
  ],
  origin,
  "right",
);
check(nearest?.id === "near", "nearest directional rect must win");

const projected = projectRectToOutputEdge(
  { x: 800, y: 550, width: 200, height: 100 },
  outputs[0],
  outputs[1],
  "right",
);
check(
  projected.x === 1000 && Math.abs(projected.y - 514.2857) < 0.001,
  "cross-axis position must project onto the target edge",
);

const moved = moveRectBetweenAreas(
  { x: 400, y: 300, width: 200, height: 100 },
  { x: 0, y: 0, width: 1000, height: 700 },
  { x: 1000, y: 100, width: 500, height: 350 },
);
check(moved.x === 1150 && moved.y === 225, "relative placement must be preserved");

const clamped = moveRectBetweenAreas(
  { x: -100, y: -100, width: 900, height: 800 },
  { x: 0, y: 0, width: 1000, height: 700 },
  { x: 1000, y: 100, width: 500, height: 350 },
);
check(
  clamped.x === 1000 &&
    clamped.y === 100 &&
    clamped.width === 500 &&
    clamped.height === 350,
  "oversized rect must fit target area",
);

console.log("multimonitor geometry: ok");
