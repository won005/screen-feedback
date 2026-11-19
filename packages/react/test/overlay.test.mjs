import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test/", pretendToBeVisual: true });
const view = dom.window;
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLDialogElement", "HTMLTextAreaElement", "Element", "ShadowRoot", "MutationObserver", "Event", "MouseEvent", "KeyboardEvent", "File"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? view : name === "document" ? view.document : view[name] });
}
globalThis.requestAnimationFrame = view.requestAnimationFrame.bind(view);
globalThis.cancelAnimationFrame = view.cancelAnimationFrame.bind(view);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { fireEvent } = await import("@testing-library/react");
const { FeedbackOverlay } = await import("../dist/FeedbackOverlay.js");
const { createMemoryFeedbackStore } = await import("@won005/feedback-core");
const screen = { id: "board", resourceId: "demo" };
const anchor = { id: "data:card", x: .25, y: .5, width: 200, height: 100, viewportWidth: 1024, viewportHeight: 768, scrollX: 0, scrollY: 0 };
const users = [{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }];
let mounted;
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
const flush = () => act(wait);
function setup() { return createMemoryFeedbackStore({ users, allowedUserIds: users.map(user => user.id), moderatorIds: ["alice"] }); }
async function mount(adapter, props = {}, strict = false) {
  document.body.innerHTML = '<main><button data-feedback-anchor="card">작업 카드</button></main><div id="test-root"></div>';
  const card = document.querySelector("[data-feedback-anchor]");
  card.getBoundingClientRect = () => ({ left: 100, top: 120, x: 100, y: 120, width: 200, height: 100, right: 300, bottom: 220 });
  mounted = createRoot(document.getElementById("test-root"));
  await act(async () => { const element = h(FeedbackOverlay, { adapter, screen, initialEnabled: true, ...props }); mounted.render(strict ? h(StrictMode, null, element) : element); await wait(); });
  await flush();
  return card;
}
function ui() { return document.querySelector("[data-feedback-overlay]").shadowRoot; }
function button(label, root = ui()) {
  const found = [...root.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label);
  assert.ok(found, `Expected button: ${label}`); return found;
}
async function click(node) { await act(async () => { fireEvent.click(node); await wait(); }); }
async function enter(text) { await act(async () => { fireEvent.change(ui().querySelector("textarea"), { target: { value: text } }); }); }
async function newComment(card) { await act(async () => { fireEvent.contextMenu(card, { button: 2, clientX: 150, clientY: 160 }); await wait(); }); }
afterEach(async () => { if (mounted) { await act(async () => mounted.unmount()); mounted = null; } document.body.innerHTML = ""; });
after(() => dom.window.close());

test("new drafts expose resolve/delete, retain plain text, and outside clicks discard only unsaved pins", async () => {
  const store = setup(), adapter = store.forUser("alice"), card = await mount(adapter);
  assert.equal(ui().querySelector('[aria-label="댓글 목록"]'), null);
  await newComment(card);
  button("작성 중인 댓글 삭제"); button("해결됨으로 등록");
  await enter("<script>plain comment</script>");
  await click(button("해결됨으로 등록"));
  await click(ui().querySelector(".sf-send"));
  const threads = await adapter.listThreads(screen);
  assert.equal(threads.length, 1); assert.equal(threads[0].resolved, true);
  assert.ok(ui().textContent.includes("<script>plain comment</script>"));
  assert.equal(ui().querySelectorAll("script").length, 0);
  await click(button("댓글창 닫기"));
  await newComment(card); await enter("discard this"); await click(document.querySelector("main"));
  assert.equal(ui().querySelector('[aria-label="새 위치 댓글"]'), null);
  assert.equal((await adapter.listThreads(screen)).length, 1);
  assert.equal(ui().querySelectorAll("button.sf-pin").length, 1);
});

test("likes, editing, individual reply deletion and whole question deletion use their correct boundaries", async () => {
  const store = setup(), adapter = store.forUser("alice");
  const thread = await adapter.createThread({ screen, anchor, body: "root", clientMutationId: "first" });
  await store.forUser("bob").addComment(thread.id, { body: "keep this reply", clientMutationId: "reply" });
  await mount(adapter); await click(ui().querySelector(".sf-pin"));
  const rootComment = ui().querySelector("article.sf-comment");
  await click(button("좋아요", rootComment));
  assert.deepEqual((await adapter.listThreads(screen))[0].comments[0].likedBy, ["alice"]);
  await click(button("댓글 수정", ui().querySelector("article.sf-comment"))); await enter("edited root"); await click(ui().querySelector(".sf-send"));
  assert.equal((await adapter.listThreads(screen))[0].comments[0].body, "edited root");
  assert.ok(ui().textContent.includes("편집됨"));
  await click(button("댓글 삭제", ui().querySelectorAll("article.sf-comment")[1]));
  assert.ok(ui().querySelector('[aria-label="답글 삭제 확인"]'));
  await click(ui().querySelector(".sf-confirm .sf-danger"));
  assert.equal((await adapter.listThreads(screen))[0].comments.length, 1);
  await click(button("질문 삭제")); await click(ui().querySelector(".sf-confirm .sf-danger"));
  assert.equal((await adapter.listThreads(screen)).length, 0);
});

test("draft and posted photos open in the viewer; Escape preserves the comment and closes only the photo", async () => {
  const store = setup();
  const adapter = { ...store.forUser("alice"), async uploadAttachment(file) { return { id: "photo", name: file.name, url: "blob:https://example.test/photo", mimeType: "image/png" }; } };
  const card = await mount(adapter); await newComment(card); await enter("photo draft");
  await act(async () => { fireEvent.change(ui().querySelector('input[type="file"]'), { target: { files: [new File(["example"], "photo.png", { type: "image/png" })] } }); await wait(); });
  await click(button("photo.png 크게 보기"));
  assert.ok(ui().querySelector('[aria-label="첨부 사진 크게 보기"]'));
  assert.equal(ui().querySelector(".sf-controls").hasAttribute("inert"), true);
  await act(async () => { fireEvent.keyDown(button("사진 닫기"), { key: "Escape" }); await wait(); });
  assert.equal(ui().querySelector(".sf-photo-viewer"), null);
  assert.equal(ui().querySelector("textarea").value, "photo draft");
  await click(ui().querySelector(".sf-send")); await click(button("photo.png 크게 보기")); await click(button("사진 닫기"));
  assert.ok(ui().querySelector('[aria-label="댓글 대화"]'));
  assert.equal((await adapter.listThreads(screen))[0].comments[0].attachments.length, 1);
});

test("a stale response cannot leak a previous screen, and access revocation removes feedback", async () => {
  const store = setup(), base = store.forUser("alice");
  const thread = await base.createThread({ screen, anchor, body: "old resource comment", clientMutationId: "old" });
  let finish;
  const adapter = { ...base, listThreads: value => value.id === "board" ? new Promise(resolve => { finish = resolve; }) : base.listThreads(value) };
  await mount(adapter);
  await act(async () => { mounted.render(h(FeedbackOverlay, { adapter, screen: { id: "other", resourceId: "demo" }, initialEnabled: true })); await wait(); });
  await act(async () => { finish([thread]); await wait(); });
  assert.equal(ui().textContent.includes("old resource comment"), false);
  await act(async () => { store.setAccess("alice", false); await wait(); });
  assert.equal(ui().querySelector('[role="toolbar"]'), null);
});

test("StrictMode leaves one portal and the comment movement handle supports keyboard movement", async () => {
  const card = await mount(setup().forUser("alice"), {}, true);
  assert.equal(document.querySelectorAll("[data-feedback-overlay]").length, 1);
  await newComment(card);
  const panel = ui().querySelector('[aria-label="새 위치 댓글"]'), start = parseFloat(panel.style.left);
  await act(async () => { fireEvent.keyDown(button("댓글창 이동. 방향키로도 이동"), { key: "ArrowRight" }); });
  assert.equal(parseFloat(panel.style.left), start + 10);
});

test("late mutation responses cannot resurrect a question deleted by another action", async () => {
  const store = setup(), base = store.forUser("alice");
  const thread = await base.createThread({ screen, anchor, body: "root", clientMutationId: "seed" });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = { ...base, async toggleLike(...args) { const result = await base.toggleLike(...args); await gate; return result; } };
  await mount(adapter); await click(ui().querySelector(".sf-pin")); await click(button("좋아요", ui().querySelector("article")));
  await act(async () => { await base.deleteThread(thread.id); await wait(); });
  assert.equal(ui().querySelectorAll("button.sf-pin").length, 0);
  await act(async () => { release(); await wait(); });
  assert.equal(ui().querySelectorAll("button.sf-pin").length, 0);
});

test("a pending deletion must not close a newly opened draft", async () => {
  const store = setup(), base = store.forUser("alice");
  await base.createThread({ screen, anchor, body: "root", clientMutationId: "seed" });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = { ...base, async deleteThread(id) { await base.deleteThread(id); await gate; } };
  const card = await mount(adapter); await click(ui().querySelector(".sf-pin")); await click(button("질문 삭제")); await click(ui().querySelector(".sf-confirm .sf-danger"));
  await newComment(card); assert.ok(ui().querySelector('[aria-label="새 위치 댓글"]'));
  await act(async () => { release(); await wait(); });
  assert.ok(ui().querySelector('[aria-label="새 위치 댓글"]'));
});

test("removed mention text does not notify that account during create or edit", async () => {
  const store = setup(), adapter = store.forUser("alice"), card = await mount(adapter);
  const pickBob = async () => { await click(button("참여자 멘션")); await click([...ui().querySelectorAll(".sf-member")].find(node => node.textContent.includes("Bob"))); };
  await newComment(card); await pickBob(); await enter("a comment without the selected tag"); await click(ui().querySelector(".sf-send"));
  assert.deepEqual((await adapter.listThreads(screen))[0].comments[0].mentions, []);
  assert.equal((await store.forUser("bob").getNotifications())[0].kind, "comment");
  await click(button("댓글 수정", ui().querySelector("article"))); await pickBob(); await enter(""); await enter("@Bob typed manually after removing the tag"); await click(ui().querySelector(".sf-send"));
  assert.deepEqual((await adapter.listThreads(screen))[0].comments[0].mentions, []);
  assert.equal((await store.forUser("bob").getNotifications()).length, 1);
});

test("removed or duplicated DOM anchors immediately hide their pins", async () => {
  const store = setup(), adapter = store.forUser("alice");
  await adapter.createThread({ screen, anchor, body: "root", clientMutationId: "seed" });
  const card = await mount(adapter);
  await act(async () => { card.remove(); await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(ui().querySelectorAll("button.sf-pin").length, 0);
  await act(async () => { document.querySelector("main").append(card); await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(ui().querySelectorAll("button.sf-pin").length, 1);
  await act(async () => { const duplicate = document.createElement("div"); duplicate.setAttribute("data-feedback-anchor", "card"); document.querySelector("main").append(duplicate); await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(ui().querySelectorAll("button.sf-pin").length, 0);
});

test("the portal belongs to the active native dialog and returns when it closes", async () => {
  await mount(setup().forUser("alice"));
  const dialog = document.createElement("dialog"); document.body.append(dialog);
  await act(async () => { dialog.open = true; dialog.dispatchEvent(new Event("toggle", { bubbles: true })); await wait(); });
  assert.equal(document.querySelector("[data-feedback-overlay]").parentElement, dialog);
  await act(async () => { dialog.open = false; dialog.dispatchEvent(new Event("toggle", { bubbles: true })); await wait(); });
  assert.equal(document.querySelector("[data-feedback-overlay]").parentElement, document.body);
});

for (const invalidReturn of [false, true]) test(`subscription setup ${invalidReturn ? "invalid return" : "throw"} fails closed without removing the host`, async () => {
  const base = setup().forUser("alice"), failures = [];
  let reads = 0;
  const adapter = { ...base, getAccess() { reads++; return base.getAccess(); }, subscribe() { if (invalidReturn) return 42; throw new Error("subscription failed"); } };
  await mount(adapter, { onError: error => failures.push(error) });
  assert.ok(document.querySelector("main"));
  assert.equal(reads, 0);
  assert.equal(ui().querySelector('[role="toolbar"]'), null);
  assert.equal(failures.length, 1);
});

test("reconnecting cancels old upload ownership and restores the composer", async () => {
  const base = setup().forUser("alice");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = { ...base, async uploadAttachment(file) { await gate; return { id: "late-photo", name: file.name, url: "blob:https://example.test/late", mimeType: "image/png" }; } };
  const card = await mount(adapter); await newComment(card); await enter("keep this draft");
  const changeFile = async file => act(async () => { fireEvent.change(ui().querySelector('input[type="file"]'), { target: { files: [file] } }); await wait(); });
  await changeFile(new File(["bad"], "bad.svg", { type: "image/svg+xml" }));
  await changeFile(new File(["photo"], "photo.png", { type: "image/png" }));
  assert.equal(ui().querySelector(".sf-send").disabled, true);
  await click([...ui().querySelectorAll(".sf-error button")].find(node => node.textContent === "다시 연결"));
  await act(async () => { release(); await wait(); });
  assert.equal(ui().querySelector(".sf-send").disabled, false);
  assert.equal(ui().querySelector("textarea").value, "keep this draft");
  assert.equal(ui().querySelectorAll(".sf-attachment").length, 0);
});

test("an unavailable member directory does not hide permitted comments", async () => {
  const base = setup().forUser("alice");
  await base.createThread({ screen, anchor, body: "visible question", clientMutationId: "seed" });
  await mount({ ...base, async getUsers() { throw new Error("directory unavailable"); } });
  assert.equal(ui().querySelectorAll("button.sf-pin").length, 1);
  await click(ui().querySelector(".sf-pin"));
  assert.ok(ui().textContent.includes("visible question"));
});

test("native dialogs in an open shadow root also own the feedback portal", async () => {
  await mount(setup().forUser("alice"));
  const host = document.createElement("div"), shadow = host.attachShadow({ mode: "open" }), dialog = document.createElement("dialog");
  shadow.append(dialog);
  await act(async () => { document.body.append(host); dialog.open = true; await new Promise(resolve => setTimeout(resolve, 50)); });
  const portal = shadow.querySelector("[data-feedback-overlay]");
  assert.ok(portal); assert.equal(portal.parentElement, dialog);
  await act(async () => { dialog.open = false; await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(document.querySelector("[data-feedback-overlay]").parentElement, document.body);
});

test("editing waits for existing mention labels without losing their recipient IDs", async () => {
  const base = setup().forUser("alice");
  await base.createThread({ screen, anchor, body: "@Bob original", mentions: ["bob"], clientMutationId: "seed" });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await mount({ ...base, async getUsers() { await gate; return base.getUsers(); } });
  await click(ui().querySelector(".sf-pin")); await click(button("댓글 수정", ui().querySelector("article")));
  await enter("@Bob corrected");
  assert.equal(ui().querySelector(".sf-send").disabled, true);
  await act(async () => { release(); await wait(); });
  assert.equal(ui().querySelector(".sf-send").disabled, false);
  await click(ui().querySelector(".sf-send"));
  const saved = (await base.listThreads(screen))[0].comments[0];
  assert.equal(saved.body, "@Bob corrected"); assert.deepEqual(saved.mentions, ["bob"]);
});

test("an unavailable former participant does not permanently prevent editing", async () => {
  const store = setup(), base = store.forUser("alice");
  await base.createThread({ screen, anchor, body: "@Bob original", mentions: ["bob"], clientMutationId: "seed" });
  store.setAccess("bob", false);
  await mount(base); await click(ui().querySelector(".sf-pin")); await click(button("댓글 수정", ui().querySelector("article")));
  await enter("updated without the former participant");
  assert.equal(ui().querySelector(".sf-send").disabled, false);
  await click(ui().querySelector(".sf-send"));
  const saved = (await base.listThreads(screen))[0].comments[0];
  assert.equal(saved.body, "updated without the former participant"); assert.deepEqual(saved.mentions, []);
});
