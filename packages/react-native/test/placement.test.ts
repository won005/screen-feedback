import {
  anchorDescriptor,
  findTouchTarget,
  parseAnchorDescriptor,
  relativePosition,
  surfaceDescriptor,
} from "../src/placement.js";

const area = { x: 10, y: 30, width: 200, height: 300 };
const point = { x: 110, y: 180 };

test("encodes anchors and surfaces without colliding when IDs contain punctuation", () => {
  expect(parseAnchorDescriptor(anchorDescriptor("sheet/1", "row:42"))).toEqual({
    surfaceId: "sheet/1",
    anchorId: "row:42",
  });
  expect(parseAnchorDescriptor(surfaceDescriptor("sheet/1"))).toEqual({ surfaceId: "sheet/1" });
  expect(parseAnchorDescriptor("row:42")).toBeUndefined();
});

test("selects the innermost measured anchor and refuses duplicate or overlapping targets", () => {
  const outer = { id: "list", area, depth: 0, unique: true };
  const inner = { id: "row", area, depth: 1, unique: true };
  expect(findTouchTarget(point, [outer, inner])).toBe(inner);
  expect(findTouchTarget(point, [outer, { ...inner, unique: false }])).toBeNull();
  expect(findTouchTarget(point, [outer, inner, { ...inner, id: "other-row" }])).toBeNull();
  expect(findTouchTarget({ x: 0, y: 0 }, [outer])).toBeUndefined();
});

test("stores tap coordinates proportionally to the measured anchor", () => {
  expect(relativePosition(point, area)).toEqual({ x: 0.5, y: 0.5 });
});
