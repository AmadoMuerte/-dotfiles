import { tileDragTargetAtPointer, tileDropZoneAtPointer } from "../src/window-manager.ts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const targets = new Map([
  ["B", { rect: { x: 500, y: 0, width: 500, height: 700 }, index: 1 }],
]);

check(tileDragTargetAtPointer(targets, 500, 350) === null, "target edge must be a dead zone");
const first = tileDragTargetAtPointer(targets, 512, 350);
const repeated = tileDragTargetAtPointer(targets, 512, 350);
check(first?.windowId === "B" && first.index === 1, "pointer inside target must select B");
check(repeated?.windowId === first.windowId, "repeated pointer position must keep the same target");
check(tileDragTargetAtPointer(targets, 511, 350) === null, "leaving the inset must clear the target");
check(tileDragTargetAtPointer(targets, 512, 350)?.windowId === "B", "re-entering must select B again");

const rect = targets.get("B")!.rect;
check(tileDropZoneAtPointer(rect, 520, 350) === "left", "left 30% must select left");
check(tileDropZoneAtPointer(rect, 980, 350) === "right", "right 30% must select right");
check(tileDropZoneAtPointer(rect, 750, 20) === "top", "top 30% must select top");
check(tileDropZoneAtPointer(rect, 750, 680) === "bottom", "bottom 30% must select bottom");
check(tileDropZoneAtPointer(rect, 750, 350) === "center", "middle must select center/swap");

console.log("tile drag target: ok");
