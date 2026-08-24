import { TileTree, type TileNode } from "../src/tiling/tree.ts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const area = { x: 10, y: 20, width: 1000, height: 700 };
const nested: TileNode = {
  type: "split",
  direction: "vertical",
  ratio: 0.5,
  first: { type: "leaf", windowId: "A" },
  second: {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: { type: "leaf", windowId: "B" },
    second: { type: "leaf", windowId: "C" },
  },
};

const tree = new TileTree();
tree.restore(nested);
const bottom = tree.beginPointerResize("B", "horizontal", false, area);
const left = tree.beginPointerResize("B", "vertical", true, area);
check(bottom, "B bottom edge must select the B/C split");
check(left, "B left edge must select the A/(B,C) split");
tree.updatePointerResize(bottom, 10_000);
tree.updatePointerResize(left, -10_000);
check(tree.dump().includes("vertical(0.200"), "vertical ratio must clamp at MIN_RATIO");
check(tree.dump().includes("horizontal(0.800"), "horizontal ratio must clamp at MAX_RATIO");

const keyboard = new TileTree();
keyboard.restore(nested);
check(keyboard.resizeEdge("B", "left"), "left must resize the parent boundary of right-side B");
check(keyboard.dump().startsWith("vertical(0.450"), "left must expand right-side B to the left");
check(keyboard.resizeEdge("B", "right"), "right must move the same parent boundary");
check(keyboard.dump().startsWith("vertical(0.500"), "right must shrink right-side B, not apply left-leaf semantics");
check(keyboard.resizeEdge("B", "down"), "down must resize the B/C boundary");
check(keyboard.dump().includes("horizontal(0.550"), "down must expand B downward");

tree.moveToIndex("C", 0);
check(tree.leafIds().join("") === "CAB", "tree order must follow moveToIndex");
for (const id of ["A", "C", "B"]) {
  tree.remove(id);
  check(tree.validate(new Set(tree.leafIds())).length === 0, "tree must stay valid after collapse");
  for (const rect of tree.rects(area).values()) {
    check(
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x >= area.x &&
        rect.y >= area.y &&
        rect.x + rect.width <= area.x + area.width + 0.001 &&
        rect.y + rect.height <= area.y + area.height + 0.001,
      `invalid rect ${JSON.stringify(rect)}`,
    );
  }
}
check(tree.leafIds().length === 0, "closing the final window must leave an empty tree");

for (const zone of ["left", "right", "top", "bottom", "center"] as const) {
  const drop = new TileTree();
  drop.restore(nested);
  const before = drop.dump();
  const preview = drop.previewDrop("A", "B", zone, area);
  check(preview, `${zone} must produce prospective geometry`);
  check(drop.dump() === before, `${zone} preview must not mutate the tree`);
  check(drop.drop("A", "B", zone), `${zone} drop must apply`);
  check(drop.validate(new Set(["A", "B", "C"])).length === 0, `${zone} drop must keep the tree valid`);
  check(JSON.stringify(drop.rects(area).get("A")) === JSON.stringify(preview), `${zone} preview must match applied geometry`);
}

const stress = new TileTree();
for (const id of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
  stress.insert(id, id === "1" ? null : String(Number(id) - 1), area);
  stress.insert(id, null, area);
  check(new Set(stress.leafIds()).size === stress.leafIds().length, "insert must be idempotent");
}
const restored = new TileTree();
restored.restore(stress.snapshot());
check(restored.dump() === stress.dump(), "snapshot must preserve topology and ratios");
for (const id of ["4", "1", "7", "2", "8", "3", "6", "5"]) {
  restored.remove(id);
  check(restored.validate(new Set(restored.leafIds())).length === 0, `collapse failed after ${id}`);
  for (const rect of restored.rects({ x: 0, y: 0, width: 3, height: 2 }).values()) {
    check(rect.width > 0 && rect.height > 0, "tiny output must not produce zero-sized tiles");
  }
}

console.log("tiling-tree stress: ok");
