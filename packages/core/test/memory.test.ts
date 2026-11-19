import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFeedbackStore, FeedbackError } from "../src/index.ts";
import type { FeedbackAnchor, FeedbackEvent } from "../src/types.ts";

const users = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "carol", name: "Carol" },
  { id: "moderator", name: "Moderator" },
  { id: "guest", name: "Guest" },
];
const screen = { id: "property", resourceId: "opaque-a", version: "1" };
const anchor: FeedbackAnchor = {
  id: "details:heading", x: 0.25, y: 0.5, width: 240, height: 40,
  viewportWidth: 1200, viewportHeight: 800, scrollX: 0, scrollY: 0,
};
const photo = { id: "image-1", name: "example.png", url: "https://example.test/photo.png", mimeType: "image/png" };
const input = (clientMutationId = "mutation-1") => ({ screen, anchor, body: "Make this clearer", clientMutationId });

function setup() {
  let id = 0;
  return createMemoryFeedbackStore({
    users, allowedUserIds: ["alice", "bob", "carol", "moderator"], moderatorIds: ["moderator"],
    now: () => new Date("2026-11-18T00:00:00.000Z"), createId: () => `id-${++id}`,
  });
}

const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof FeedbackError);
  assert.equal(error.code, expected);
  return true;
};

test("resolved drafts keep their status and mutation identity", async () => {
  const adapter = setup().forUser("alice");
  const draft = { ...input(), resolved: true };
  const thread = await adapter.createThread(draft);
  assert.equal(thread.resolved, true);
  assert.deepEqual(await adapter.createThread(draft), thread);
  await assert.rejects(adapter.createThread({ ...draft, resolved: false }), code("MUTATION_CONFLICT"));
  await assert.rejects(adapter.createThread({ ...input("bad-status"), resolved: "yes" } as never), code("INVALID_INPUT"));
});

test("local native images remain host-owned and executable URLs are rejected", async () => {
  const adapter = setup().forUser("alice");
  for (const [index, url] of ["file:///sandbox/picture.png", "content://photos/picture/1"].entries()) {
    const thread = await adapter.createThread({ ...input(`local-${index}`), body: "", attachments: [{ ...photo, url }] });
    assert.equal(thread.comments[0]!.attachments[0]!.url, url);
  }
  await assert.rejects(adapter.createThread({ ...input("unsafe-url"), attachments: [{ ...photo, url: "javascript:alert(1)" }] }), code("INVALID_INPUT"));
});

test("access is explicit and moderation never grants participation implicitly", async () => {
  const store = setup();
  assert.deepEqual(await store.forUser("alice").getAccess(), { userId: "alice", allowed: true, canDeleteAny: false });
  assert.deepEqual(await store.forUser("moderator").getAccess(), { userId: "moderator", allowed: true, canDeleteAny: true });
  assert.deepEqual(await store.forUser("guest").getAccess(), { userId: "guest", allowed: false, canDeleteAny: false });
  store.setAccess("moderator", false);
  assert.deepEqual(await store.forUser("moderator").getAccess(), { userId: "moderator", allowed: false, canDeleteAny: false });
});

test("unlisted users cannot read or mutate threads, names, notifications, or likes", async () => {
  const store = setup();
  const thread = await store.forUser("alice").createThread(input());
  const guest = store.forUser("guest");
  await assert.rejects(guest.listThreads(screen), code("ACCESS_DENIED"));
  await assert.rejects(guest.getUsers(), code("ACCESS_DENIED"));
  await assert.rejects(guest.getNotifications(), code("ACCESS_DENIED"));
  await assert.rejects(guest.createThread(input()), code("ACCESS_DENIED"));
  await assert.rejects(guest.addComment(thread.id, { body: "No", clientMutationId: "no" }), code("ACCESS_DENIED"));
  await assert.rejects(guest.setResolved(thread.id, true, thread.version), code("ACCESS_DENIED"));
  await assert.rejects(guest.deleteThread(thread.id), code("ACCESS_DENIED"));
  await assert.rejects(guest.toggleLike(thread.id, thread.comments[0]!.id), code("ACCESS_DENIED"));
  await assert.rejects(guest.editComment(thread.id, thread.comments[0]!.id, { body: "Changed", version: 1 }), code("ACCESS_DENIED"));
  await assert.rejects(guest.deleteComment(thread.id, thread.comments[0]!.id), code("ACCESS_DENIED"));
  await assert.rejects(guest.markNotificationRead("hidden"), code("ACCESS_DENIED"));
});

test("pins, plain text comments, replies, and author metadata are shared across allowed users", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const thread = await alice.createThread({ ...input(), body: "<script>alert('plain text')</script>" });
  const updated = await store.forUser("bob").addComment(thread.id, { body: "A reply", clientMutationId: "reply-1" });
  assert.equal(updated.comments.length, 2);
  assert.equal(updated.comments[0]!.body, "<script>alert('plain text')</script>");
  assert.equal(updated.comments[1]!.author.id, "bob");
  assert.deepEqual(updated.anchor, anchor);
  assert.equal(updated.createdAt, "2026-11-18T00:00:00.000Z");
  assert.deepEqual(await alice.listThreads(screen), [updated]);
});

test("resource identity separates screens while version remains origin metadata", async () => {
  const store = setup();
  const adapter = store.forUser("alice");
  await adapter.createThread(input());
  assert.equal((await adapter.listThreads({ ...screen, resourceId: "opaque-b" })).length, 0);
  assert.equal((await adapter.listThreads({ ...screen, id: "repair" })).length, 0);
  assert.equal((await adapter.listThreads({ ...screen, version: "2" })).length, 1);
});

test("revocation blocks reads and writes and suppresses future data events", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const bob = store.forUser("bob");
  const events: FeedbackEvent[] = [];
  const unsubscribe = bob.subscribe((event) => events.push(event));
  const thread = await alice.createThread(input());
  assert.deepEqual(events, [{ type: "changed", screenId: "property" }]);
  store.setAccess("bob", false);
  assert.deepEqual(events.at(-1), { type: "access-changed" });
  await assert.rejects(bob.listThreads(screen), code("ACCESS_DENIED"));
  await assert.rejects(bob.addComment(thread.id, { body: "Blocked", clientMutationId: "revoked" }), code("ACCESS_DENIED"));
  const lengthAfterRevocation = events.length;
  await alice.addComment(thread.id, { body: "Allowed", clientMutationId: "reply" });
  assert.equal(events.length, lengthAfterRevocation);
  store.setAccess("bob", true);
  assert.deepEqual(events.at(-1), { type: "access-changed" });
  assert.equal((await bob.listThreads(screen))[0]!.comments.length, 2);
  unsubscribe();
  await alice.setResolved(thread.id, true, (await alice.listThreads(screen))[0]!.version);
  assert.equal(events.length, lengthAfterRevocation + 1);
});

test("only thread authors and moderators may delete a thread and its notifications", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const thread = await alice.createThread(input());
  await assert.rejects(store.forUser("bob").deleteThread(thread.id), code("DELETE_FORBIDDEN"));
  assert.equal((await alice.listThreads(screen)).length, 1);
  await store.forUser("moderator").deleteThread(thread.id);
  assert.deepEqual(await alice.listThreads(screen), []);
  assert.deepEqual(await store.forUser("bob").getNotifications(), []);
  const second = await alice.createThread(input("second"));
  await alice.deleteThread(second.id);
  assert.deepEqual(await alice.listThreads(screen), []);
});

test("each account has one like per comment and toggling removes it", async () => {
  const store = setup();
  const thread = await store.forUser("alice").createThread(input());
  const bob = store.forUser("bob");
  const commentId = thread.comments[0]!.id;
  let updated = await bob.toggleLike(thread.id, commentId);
  assert.deepEqual(updated.comments[0]!.likedBy, ["bob"]);
  updated = await store.forUser("carol").toggleLike(thread.id, commentId);
  assert.deepEqual(updated.comments[0]!.likedBy.sort(), ["bob", "carol"]);
  updated = await bob.toggleLike(thread.id, commentId);
  assert.deepEqual(updated.comments[0]!.likedBy, ["carol"]);
});

test("any allowed participant can resolve or reopen but stale versions fail atomically", async () => {
  const store = setup();
  const thread = await store.forUser("alice").createThread(input());
  const bob = store.forUser("bob");
  const resolved = await bob.setResolved(thread.id, true, thread.version);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.version, thread.version + 1);
  await assert.rejects(bob.setResolved(thread.id, false, thread.version), code("VERSION_CONFLICT"));
  const reopened = await store.forUser("carol").setResolved(thread.id, false, resolved.version);
  assert.equal(reopened.resolved, false);
});

test("identical retries create exactly one thread and reply and produce no extra notifications", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const first = await alice.createThread(input());
  assert.equal((await alice.createThread(input())).id, first.id);
  const reply = { body: "Reply", clientMutationId: "reply" };
  await store.forUser("bob").addComment(first.id, reply);
  const notificationCount = (await alice.getNotifications()).length;
  const retry = await store.forUser("bob").addComment(first.id, reply);
  assert.equal(retry.comments.length, 2);
  assert.equal((await alice.getNotifications()).length, notificationCount);
  assert.equal((await alice.listThreads(screen)).length, 1);
});

test("mutation IDs are scoped to actors and reject reuse for another payload or operation", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const first = await alice.createThread(input());
  await assert.rejects(alice.createThread({ ...input(), body: "Changed" }), code("MUTATION_CONFLICT"));
  await assert.rejects(alice.addComment(first.id, { body: "Reply", clientMutationId: "mutation-1" }), code("MUTATION_CONFLICT"));
  assert.notEqual((await store.forUser("bob").createThread(input())).id, first.id);
  await alice.deleteThread(first.id);
  await assert.rejects(alice.createThread(input()), code("NOT_FOUND"));
});

test("mentions are allowed-only, deduplicated, exclude self, and override reply notifications", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const thread = await alice.createThread({ ...input(), mentions: ["bob", "bob", "alice"] });
  assert.deepEqual(thread.comments[0]!.mentions, ["bob", "alice"]);
  assert.equal((await alice.getNotifications()).length, 0);
  const bobNotifications = await store.forUser("bob").getNotifications();
  assert.equal(bobNotifications.length, 1);
  assert.equal(bobNotifications[0]!.kind, "mention");
  assert.equal(bobNotifications[0]!.actor.id, "alice");
  assert.deepEqual(bobNotifications[0]!.screen, screen);
  await store.forUser("bob").addComment(thread.id, { body: "Please review", mentions: ["alice", "carol"], clientMutationId: "reply" });
  const aliceNotifications = await alice.getNotifications();
  assert.equal(aliceNotifications.length, 1);
  assert.equal(aliceNotifications[0]!.kind, "mention");
  assert.equal((await store.forUser("carol").getNotifications()).filter((n) => n.kind === "mention").length, 1);
  await assert.rejects(alice.addComment(thread.id, { body: "No guest mention", mentions: ["guest"], clientMutationId: "guest" }), code("INVALID_INPUT"));
  assert.equal((await alice.listThreads(screen))[0]!.comments.length, 2);
});

test("notification read state belongs to its recipient and cannot be changed by another user", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const bob = store.forUser("bob");
  await alice.createThread(input());
  const notification = (await bob.getNotifications())[0]!;
  await assert.rejects(alice.markNotificationRead(notification.id), code("NOT_FOUND"));
  assert.equal((await bob.getNotifications())[0]!.read, false);
  await bob.markNotificationRead(notification.id);
  await bob.markNotificationRead(notification.id);
  assert.equal((await bob.getNotifications())[0]!.read, true);
});

test("empty text requires an image and image metadata is validated without uploading bytes", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  await assert.rejects(alice.createThread({ ...input(), body: "  " }), code("INVALID_INPUT"));
  const thread = await alice.createThread({ ...input(), body: "  ", attachments: [photo] });
  assert.equal(thread.comments[0]!.body, "");
  assert.deepEqual(thread.comments[0]!.attachments, [photo]);
  await assert.rejects(alice.createThread({ ...input("bad-type"), attachments: [{ ...photo, mimeType: "text/html" }] }), code("INVALID_INPUT"));
  await assert.rejects(alice.createThread({ ...input("bad-url"), attachments: [{ ...photo, url: "javascript:alert(1)" }] }), code("INVALID_INPUT"));
  await assert.rejects(alice.createThread({ ...input("svg"), attachments: [{ ...photo, mimeType: "image/svg+xml" }] }), code("INVALID_INPUT"));
  assert.equal(alice.uploadAttachment, undefined);
});

test("invalid coordinates, excessive body text, and unknown users never mutate stored state", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  for (const patch of [{ x: Number.NaN }, { x: 1.01 }, { width: 0 }, { viewportHeight: Infinity }, { scrollY: -1 }]) {
    await assert.rejects(alice.createThread({ ...input(), anchor: { ...anchor, ...patch } }), code("INVALID_INPUT"));
  }
  await assert.rejects(alice.createThread({ ...input(), body: "x".repeat(2001) }), code("INVALID_INPUT"));
  assert.throws(() => store.forUser("unknown"), code("INVALID_INPUT"));
  assert.throws(() => store.setAccess("unknown", true), code("INVALID_INPUT"));
  assert.deepEqual(await alice.listThreads(screen), []);
});

test("returned values and caller-owned inputs cannot alter store data or access policy", async () => {
  const initialUsers = structuredClone(users);
  const allowed = ["alice", "bob"];
  const store = createMemoryFeedbackStore({ users: initialUsers, allowedUserIds: allowed });
  initialUsers[0]!.name = "Changed externally";
  allowed.push("guest");
  const alice = store.forUser("alice");
  const threadInput = structuredClone(input());
  const thread = await alice.createThread(threadInput);
  threadInput.anchor.x = 0.99;
  thread.comments[0]!.body = "Tampered";
  thread.comments[0]!.author.name = "Tampered name";
  const listed = (await alice.listThreads(screen))[0]!;
  assert.equal(listed.comments[0]!.body, "Make this clearer");
  assert.equal(listed.comments[0]!.author.name, "Alice");
  assert.equal(listed.anchor.x, 0.25);
  assert.equal((await store.forUser("guest").getAccess()).allowed, false);
});

test("listener failures do not roll back writes and unsubscribe is idempotent", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const events: FeedbackEvent[] = [];
  const unsubscribe = alice.subscribe(() => { throw new Error("Host listener failure"); });
  alice.subscribe((event) => events.push(event));
  const thread = await alice.createThread(input());
  assert.equal((await alice.listThreads(screen))[0]!.id, thread.id);
  assert.equal(events.length, 1);
  unsubscribe();
  unsubscribe();
  store.setAccess("alice", false);
  assert.deepEqual(events.at(-1), { type: "access-changed" });
});

test("only the comment author can edit and stale edits preserve text, images, and prior notifications", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const thread = await alice.createThread({ ...input(), attachments: [photo], mentions: ["bob"] });
  const comment = thread.comments[0]!;
  assert.equal(comment.version, 1);
  await assert.rejects(store.forUser("bob").editComment(thread.id, comment.id, { body: "No", version: 1 }), code("EDIT_FORBIDDEN"));
  await assert.rejects(store.forUser("moderator").editComment(thread.id, comment.id, { body: "No", version: 1 }), code("EDIT_FORBIDDEN"));
  const edited = await alice.editComment(thread.id, comment.id, { body: "Updated", mentions: ["bob", "carol"], version: 1 });
  assert.equal(edited.comments[0]!.body, "Updated");
  assert.equal(edited.comments[0]!.version, 2);
  assert.equal(edited.comments[0]!.editedAt, "2026-11-18T00:00:00.000Z");
  assert.deepEqual(edited.comments[0]!.attachments, [photo]);
  assert.equal((await store.forUser("bob").getNotifications()).length, 1);
  assert.equal((await store.forUser("carol").getNotifications()).filter((n) => n.kind === "mention").length, 1);
  await assert.rejects(alice.editComment(thread.id, comment.id, { body: "Stale", version: 1 }), code("VERSION_CONFLICT"));
  assert.equal((await alice.listThreads(screen))[0]!.comments[0]!.body, "Updated");
  const imageOnly = await alice.editComment(thread.id, comment.id, { body: "", version: 2 });
  assert.equal(imageOnly.comments[0]!.body, "");
  assert.deepEqual(imageOnly.comments[0]!.attachments, [photo]);
  assert.deepEqual(imageOnly.comments[0]!.mentions, ["bob", "carol"]);
});

test("reply deletion preserves other replies and root ownership and removes its likes, images, and notifications", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const bob = store.forUser("bob");
  const initial = await alice.createThread(input());
  const withReply = await bob.addComment(initial.id, { body: "Reply to remove", attachments: [photo], clientMutationId: "reply" });
  const deletedReplyId = withReply.comments[1]!.id;
  const withOther = await alice.addComment(initial.id, { body: "Keep this", clientMutationId: "other" });
  await alice.toggleLike(initial.id, deletedReplyId);
  await assert.rejects(store.forUser("carol").deleteComment(initial.id, deletedReplyId), code("DELETE_FORBIDDEN"));
  await assert.rejects(alice.deleteComment(initial.id, initial.comments[0]!.id), code("INVALID_INPUT"));
  const removed = await store.forUser("moderator").deleteComment(initial.id, deletedReplyId);
  assert.deepEqual(removed.comments.map((comment) => comment.id), [initial.comments[0]!.id, withOther.comments[2]!.id]);
  assert.equal((await alice.getNotifications()).some((notification) => notification.commentId === deletedReplyId), false);
  await assert.rejects(bob.addComment(initial.id, { body: "Reply to remove", attachments: [photo], clientMutationId: "reply" }), code("NOT_FOUND"));
  const ownReply = await bob.addComment(initial.id, { body: "Own reply", clientMutationId: "own" });
  const afterOwnDelete = await bob.deleteComment(initial.id, ownReply.comments.at(-1)!.id);
  assert.equal(afterOwnDelete.comments.length, 2);
});

test("a notification carries the exact screen and resource for host navigation", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const first = await alice.createThread(input());
  const otherScreen = { id: "repair", resourceId: "opaque-b", version: "2" };
  const second = await alice.createThread({ ...input("other-screen"), screen: otherScreen });
  const notifications = await store.forUser("bob").getNotifications();
  assert.deepEqual(notifications.find((item) => item.threadId === first.id)!.screen, screen);
  assert.deepEqual(notifications.find((item) => item.threadId === second.id)!.screen, otherScreen);
  notifications[0]!.screen.id = "tampered";
  assert.deepEqual((await store.forUser("bob").getNotifications())[0]!.screen, otherScreen);
});

test("concurrent retries converge and concurrent status updates cannot overwrite one another", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const [first, second] = await Promise.all([alice.createThread(input()), alice.createThread(input())]);
  assert.equal(first.id, second.id);
  assert.equal((await store.forUser("bob").getNotifications()).length, 1);
  const results = await Promise.allSettled([
    store.forUser("bob").setResolved(first.id, true, first.version),
    store.forUser("carol").setResolved(first.id, true, first.version),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejection = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejection.reason.code, "VERSION_CONFLICT");
});

test("a comment ID from another thread cannot be liked, edited, or deleted", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const first = await alice.createThread(input());
  const second = await alice.createThread(input("another"));
  const foreignComment = second.comments[0]!.id;
  await assert.rejects(alice.toggleLike(first.id, foreignComment), code("NOT_FOUND"));
  await assert.rejects(alice.editComment(first.id, foreignComment, { body: "Cross-thread", version: 1 }), code("NOT_FOUND"));
  await assert.rejects(alice.deleteComment(first.id, foreignComment), code("NOT_FOUND"));
  assert.deepEqual(await alice.listThreads(screen), [first, second]);
});

test("revocation during event delivery prevents later callbacks from receiving thread events", async () => {
  const store = setup();
  const alice = store.forUser("alice");
  const events: FeedbackEvent[] = [];
  alice.subscribe((event) => {
    if (event.type === "changed") store.setAccess("bob", false);
  });
  store.forUser("bob").subscribe((event) => events.push(event));
  await alice.createThread(input());
  assert.deepEqual(events, [{ type: "access-changed" }]);
});

test("ungranted subscriptions observe only their own access changes and allowed users are listed explicitly", async () => {
  const store = setup();
  const guest = store.forUser("guest");
  const events: FeedbackEvent[] = [];
  guest.subscribe((event) => events.push(event));
  await store.forUser("alice").createThread(input());
  store.setAccess("bob", false);
  assert.deepEqual(events, []);
  store.setAccess("guest", true);
  assert.deepEqual(events, [{ type: "access-changed" }]);
  assert.equal((await guest.getUsers()).some((user) => user.id === "bob"), false);
  assert.equal((await guest.getUsers()).some((user) => user.id === "guest"), true);
});

test("invalid generated IDs fail before committing a thread or its notifications", async () => {
  const store = createMemoryFeedbackStore({ users, allowedUserIds: ["alice", "bob"], createId: () => "duplicate" });
  const alice = store.forUser("alice");
  const events: FeedbackEvent[] = [];
  alice.subscribe((event) => events.push(event));
  await assert.rejects(alice.createThread(input()), code("INVALID_INPUT"));
  assert.deepEqual(await alice.listThreads(screen), []);
  assert.deepEqual(await store.forUser("bob").getNotifications(), []);
  assert.deepEqual(events, []);
});
