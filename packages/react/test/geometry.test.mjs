import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clampPosition, sameScreen, anchorPoint, selectAnchor, captureAnchor, measureAnchor } from "../src/geometry.ts";

test("drag bounds keep expanded and collapsed controls inside the viewport", () => {
  assert.deepEqual(clampPosition({ x: -100, y: 2000 }, { width: 320, height: 640 }, { width: 260, height: 48 }), { x: 8, y: 584 });
  assert.deepEqual(clampPosition({ x: 900, y: 2000 }, { width: 320, height: 640 }, { width: 44, height: 44 }), { x: 268, y: 588 });
  assert.deepEqual(clampPosition({ x: 300, y: 40 }, { width: 200, height: 100 }, { width: 300, height: 120 }), { x: 8, y: 8 });
});

test("screen matching isolates resource instances while tolerating version changes", () => {
  assert.equal(sameScreen({ id: "detail", resourceId: "a", version: "1" }, { id: "detail", resourceId: "a", version: "2" }), true);
  assert.equal(sameScreen({ id: "detail", resourceId: "a" }, { id: "detail", resourceId: "b" }), false);
  assert.equal(sameScreen({ id: "detail" }, { id: "list" }), false);
});

test("relative anchors follow resizing and reject missing or ambiguous elements", () => {
  const rect = { left: 20, top: 30, width: 200, height: 100 };
  assert.deepEqual(anchorPoint({ x: 0.25, y: 0.75 }, rect), { x: 70, y: 105 });
  assert.equal(selectAnchor([], "a"), null);
  assert.equal(selectAnchor([{ key: "a", element: 1 }, { key: "a", element: 2 }], "a"), null);
  assert.equal(selectAnchor([{ key: "a", element: 1 }, { key: "b", element: 2 }], "a"), 1);
});

function environment(elements) {
  return {
    defaultView: { innerWidth: 1000, innerHeight: 800, scrollX: 0, scrollY: 100 },
    querySelectorAll(selector) { return elements.filter((element) => element.getAttribute(selector === "[id]" ? "id" : "data-feedback-anchor") !== null); },
  };
}
function element(key, rect, parent = null) {
  return {
    parentElement: parent,
    isConnected: true,
    getAttribute(name) {
      assert.ok(name === "id" || name === "data-feedback-anchor", "no page text or input values are read");
      return name === "data-feedback-anchor" ? key : null;
    },
    getBoundingClientRect() { return rect; },
  };
}

test("capture chooses an explicit unique ancestor and remeasures after resize", () => {
  const rect = { left: 20, top: 30, width: 200, height: 100 };
  const parent = element("stable-card", rect);
  const child = element(null, rect, parent);
  const document = environment([parent, child]);
  const anchor = captureAnchor(child, { x: 70, y: 105 }, document);
  assert.equal(anchor.id, "data:stable-card");
  assert.equal(anchor.x, 0.25);
  assert.equal(anchor.y, 0.75);
  rect.width = 400;
  assert.deepEqual(measureAnchor(anchor, document), { x: 120, y: 105 });
  parent.isConnected = false;
  assert.equal(measureAnchor(anchor, document), null);
});

test("duplicate or absent anchors remain unresolved instead of selecting the wrong node", () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 };
  const first = element("duplicate", rect);
  const second = element("duplicate", rect);
  const document = environment([first, second]);
  const anchor = captureAnchor(first, { x: 40, y: 20 }, document);
  assert.equal(anchor.id, "unanchored");
  assert.equal(measureAnchor(anchor, document), null);
  assert.equal(measureAnchor({ ...anchor, id: "data:duplicate" }, document), null);
});

test("SitePing semantic anchors cross open shadow roots and fail closed on duplicate keys", () => {
  const dom = new JSDOM('<main data-feedback-anchor="outer"><div id="host"></div></main>');
  const document = dom.window.document;
  const shadow = document.getElementById("host").attachShadow({ mode: "open" });
  shadow.innerHTML = '<section data-feedback-anchor="inside"><button>private context</button></section>';
  const section = shadow.querySelector("section");
  section.getBoundingClientRect = () => ({ left: 20, top: 30, width: 200, height: 100 });
  const anchor = captureAnchor(shadow.querySelector("button"), { x: 70, y: 80 }, document);
  assert.equal(anchor.id, "data:inside");
  assert.deepEqual(measureAnchor(anchor, document), { x: 70, y: 80 });
  document.body.insertAdjacentHTML("beforeend", '<aside data-feedback-anchor="inside"></aside>');
  assert.equal(measureAnchor(anchor, document), null);
  section.remove();
  document.querySelector("aside").remove();
  assert.equal(measureAnchor(anchor, document), null);
  dom.window.close();
});

test("capture does not read screen text, input values, URLs or generated element IDs", () => {
  const dom = new JSDOM('<section data-feedback-anchor="safe"><input id="private-id" aria-label="private label" value="private value"></section>', { url: 'https://example.test/private' });
  const document = dom.window.document, section = document.querySelector("section"), input = document.querySelector("input");
  section.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  for (const node of [section, input]) {
    Object.defineProperty(node, "textContent", { get() { throw new Error("Page text must not be read."); } });
    Object.defineProperty(node, "value", { get() { throw new Error("Form values must not be read."); } });
  }
  const anchor = captureAnchor(input, { x: 20, y: 30 }, document);
  assert.equal(anchor.id, "data:safe");
  assert.equal(JSON.stringify(anchor).includes("private"), false);
  assert.equal("textSnippet" in anchor, false);
  assert.equal("cssSelector" in anchor, false);
  assert.deepEqual(measureAnchor(anchor, document), { x: 20, y: 30 });
  dom.window.close();
});

test("unregistered page points track scrolling and hide after incompatible width changes", () => {
  const document = environment([]);
  const anchor = captureAnchor(null, { x: 100, y: 200 }, document);
  assert.equal(anchor.id, "page");
  document.defaultView.scrollY = 150;
  assert.deepEqual(measureAnchor(anchor, document), { x: 100, y: 150 });
  document.defaultView.innerWidth = 400;
  assert.equal(measureAnchor(anchor, document), null);
});
