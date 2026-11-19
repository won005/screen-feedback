# @won005/feedback-core

Portable TypeScript contracts and an in-memory reference adapter for screen feedback. No React, React Native, database, transport, or runtime dependencies.

```ts
import { createMemoryFeedbackStore } from "@won005/feedback-core";

const store = createMemoryFeedbackStore({
  users: [
    { id: "reviewer", name: "Reviewer" },
    { id: "owner", name: "Owner" },
  ],
  allowedUserIds: ["reviewer", "owner"],
  moderatorIds: ["owner"],
});

const adapter = store.forUser("reviewer");
const access = await adapter.getAccess();
const unsubscribe = adapter.subscribe(async () => {
  // Recheck access and refetch current state. Events carry no comment content.
  console.log(await adapter.getAccess());
});

await adapter.createThread({
  clientMutationId: crypto.randomUUID(),
  screen: { id: "details", resourceId: "opaque-resource-id", version: "1" },
  anchor: {
    id: "main:heading", x: 0.4, y: 0.5,
    width: 240, height: 40, viewportWidth: 1200, viewportHeight: 800,
    scrollX: 0, scrollY: 0,
  },
  body: "Could this heading be clearer?",
  mentions: ["owner"],
});

store.setAccess("reviewer", false);
unsubscribe();
```

## Adapter contract

`FeedbackAdapter` binds operations to one acting user. `getAccess()` returns that user's ID, participation grant, and moderation capability. All thread, comment, user-list, notification, and like operations check the current grant on every call.

- `listThreads(screen)` matches `screen.id` and `screen.resourceId`. `screen.version` records the originating application version and does not split a discussion across releases.
- `createThread(input)` and `addComment(threadId, input)` accept a caller-generated `clientMutationId`. IDs are scoped to the actor and shared across both operations. Identical normalized retries return the current thread; a different payload or operation raises `MUTATION_CONFLICT`. Whitespace is trimmed, duplicate mentions are removed, and mention ordering does not affect retry matching.
- `editComment(threadId, commentId, { body, mentions?, version })` is author-only, including for moderators. It preserves attachments and likes, increments the comment's version, and sets `editedAt`. Omitted mentions preserve the current list; an empty array removes mentions. Only newly added mentions generate notifications.
- `deleteComment(threadId, commentId)` deletes an author's reply or, for moderators, any reply. Its attachments, likes, and related notifications disappear. The first comment cannot be deleted separately: use `deleteThread` so thread ownership stays stable.
- `setResolved(threadId, resolved, version)` allows every granted participant to resolve or reopen a thread. A stale version raises `VERSION_CONFLICT`. Thread versions start at zero and advance for comments, edits, deletes, likes, and status changes. Comment versions start at one and advance on edits.
- `deleteThread(threadId)` is restricted to the question author or a granted moderator. It removes the conversation and related notifications. Identifier-only mutation tombstones prevent delayed retries from recreating deleted content.
- `toggleLike(threadId, commentId)` adds or removes one vote for the acting account. Comment IDs must belong to the supplied thread.
- `getUsers()` returns only explicitly granted users. Mentions can target only currently granted users. Moderation alone never grants participation.
- `getNotifications()` returns the acting user's inbox, newest first. `markNotificationRead(id)` affects only that inbox and is idempotent. New threads and replies notify other granted users. A mention replaces the ordinary notification for that recipient; authors never notify themselves. Each notification includes its originating screen for host-controlled navigation.
- `subscribe(listener)` observes committed changes. `changed` events contain an optional `screenId`, so consumers should refetch their exact resource. A user without a grant receives only their own `access-changed` events, including grant restoration. Call the returned unsubscribe function when leaving the host session. Notifications are best effort; refetch access, threads, and notifications on reconnect or app focus.

`FeedbackError` exposes a stable `code`: `ACCESS_DENIED`, `INVALID_INPUT`, `NOT_FOUND`, `EDIT_FORBIDDEN`, `DELETE_FORBIDDEN`, `VERSION_CONFLICT`, or `MUTATION_CONFLICT`.

## Images and input

`FEEDBACK_LIMITS` exposes the defaults: 2,000 text characters, five images, and 20 distinct mentions per comment. Text is plain text; host renderers should use text nodes, without interpreting HTML. An empty body is allowed when an image is present.

Attachments contain only `{ id, name, url, mimeType }`. Supported image MIME types are PNG, JPEG, WebP, GIF, AVIF, BMP, HEIC, and HEIF. URLs must use HTTP, HTTPS, or `blob:` and cannot embed credentials. SVG, arbitrary HTML, `javascript:` URLs, and data URLs are rejected. The adapter does not fetch or inspect image bytes.

Hosts provide `uploadAttachment(file)` when they need uploads. They own file validation, storage, image processing, URL authorization, and cleanup of removed files. Deleting metadata does not delete a stored file. The memory adapter deliberately does not implement uploads.

Anchor IDs are opaque strings, never selectors evaluated by the core. Relative coordinates must be finite and between zero and one; element and viewport dimensions must be positive. Hosts supply stable screen/resource/anchor identifiers and decide how unresolved anchors appear. The core never captures screenshots, screen text, DOM content, or URL query parameters.

## Reference-store boundaries

`createMemoryFeedbackStore` is a trusted-host, single-process model for demos, tests, and adapter development. Its state disappears when the store is discarded. `forUser` and `setAccess` are trusted controls, not authentication mechanisms; a network adapter must derive the acting identity from the server session, enforce grants there, and own durable transactions, concurrency, delivery, and upload security.

The store copies inputs and returned values. Host observer failures cannot undo committed writes or interrupt other observers. Grant revocation immediately blocks data calls and future data events while preserving stored conversations. Allowed users share the same feedback space; applications needing tenant separation should create separate stores or enforce workspace boundaries in their server adapter. Access to feedback does not grant access to the host application's underlying business resources.

For deterministic tests, pass `now: () => Date` and `createId: () => string`. IDs must be unique per store. Default IDs are local identifiers for this in-memory model.

## Development

From the repository workspace, run the core test and build scripts. Source tests use Node.js 24's TypeScript support; builds use the workspace TypeScript compiler. Output includes ESM JavaScript and declarations in `dist/`.

```sh
npm run test --workspace @won005/feedback-core
npm run build --workspace @won005/feedback-core
```
