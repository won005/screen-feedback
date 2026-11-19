import { FeedbackError } from "./errors.ts";
import { invalid, normalizeComment, normalizeScreen, normalizeThread, normalizeUser, text } from "./validation.ts";
import type { NormalizedCommentInput } from "./validation.ts";
import type {
  FeedbackAdapter,
  FeedbackComment,
  FeedbackEvent,
  FeedbackNotification,
  FeedbackScreen,
  FeedbackThread,
  FeedbackUser,
  MemoryFeedbackStore,
  MemoryFeedbackStoreOptions,
} from "./types.ts";

interface MutationReceipt {
  fingerprint: string | null;
  threadId: string;
  commentId: string;
}

interface Subscription {
  listener: (event: FeedbackEvent) => void;
}

function copyUser(user: FeedbackUser): FeedbackUser {
  return { ...user };
}

function copyComment(comment: FeedbackComment): FeedbackComment {
  return {
    ...comment, author: copyUser(comment.author), attachments: comment.attachments.map((item) => ({ ...item })),
    mentions: [...comment.mentions], likedBy: [...comment.likedBy],
  };
}

function copyThread(thread: FeedbackThread): FeedbackThread {
  return { ...thread, screen: { ...thread.screen }, anchor: { ...thread.anchor }, comments: thread.comments.map(copyComment) };
}

function copyNotification(notification: FeedbackNotification): FeedbackNotification {
  return { ...notification, screen: { ...notification.screen }, actor: copyUser(notification.actor) };
}

function sameScreen(left: FeedbackScreen, right: FeedbackScreen): boolean {
  return left.id === right.id && left.resourceId === right.resourceId;
}

/**
 * A single-process reference model. The trusted host controls identities and grants.
 * Network adapters must authenticate callers and enforce these checks on the server.
 * Writes have no await points: commit precedes best-effort change notifications.
 */
export function createMemoryFeedbackStore(options: MemoryFeedbackStoreOptions): MemoryFeedbackStore {
  if (!options || !Array.isArray(options.users) || !Array.isArray(options.allowedUserIds)) {
    invalid("users and allowedUserIds must be arrays.");
  }
  const users = new Map<string, FeedbackUser>();
  for (const source of options.users) {
    const user = normalizeUser(source);
    if (users.has(user.id)) invalid("User IDs must be unique.");
    users.set(user.id, user);
  }

  function requireUser(userId: string): FeedbackUser {
    const user = users.get(text(userId, "userId", 128));
    if (!user) invalid("The user is not registered in this store.");
    return user;
  }

  function knownIds(values: readonly string[]): Set<string> {
    if (!Array.isArray(values)) invalid("User ID lists must be arrays.");
    return new Set(values.map((id) => requireUser(id).id));
  }

  const allowed = knownIds(options.allowedUserIds);
  const moderators = knownIds(options.moderatorIds ?? []);
  const now = options.now ?? (() => new Date());
  let sequence = 0;
  const generateId = options.createId ?? (() => `feedback-${Date.now().toString(36)}-${++sequence}`);
  const usedIds = new Set<string>();
  const threads = new Map<string, FeedbackThread>();
  const receipts = new Map<string, Map<string, MutationReceipt>>();
  const notifications = new Map<string, Map<string, FeedbackNotification>>();
  const subscriptions = new Map<string, Set<Subscription>>();

  function nextId(): string {
    const id = text(generateId(), "generated ID", 128);
    if (usedIds.has(id)) invalid("createId must return a unique ID on every call.");
    usedIds.add(id);
    return id;
  }

  function timestamp(): string {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid("now must return a valid Date.");
    return value.toISOString();
  }

  function requireAccess(userId: string): void {
    if (!allowed.has(userId)) throw new FeedbackError("ACCESS_DENIED", "Feedback access has not been granted.");
  }

  function requireThread(threadId: string): FeedbackThread {
    const thread = threads.get(threadId);
    if (!thread) throw new FeedbackError("NOT_FOUND", "The feedback thread was not found.");
    return thread;
  }

  function requireComment(thread: FeedbackThread, commentId: string): FeedbackComment {
    const comment = thread.comments.find((candidate) => candidate.id === commentId);
    if (!comment) throw new FeedbackError("NOT_FOUND", "The comment was not found in this thread.");
    return comment;
  }

  function requireMentions(ids: readonly string[]): void {
    for (const id of ids) {
      if (!users.has(id) || !allowed.has(id)) invalid("Only allowed users can be mentioned.");
    }
  }

  function fingerprint(operation: string, comment: NormalizedCommentInput, context: unknown): string {
    return JSON.stringify({
      operation, context, body: comment.body, attachments: comment.attachments,
      mentions: [...comment.mentions].sort(),
    });
  }

  function priorMutation(userId: string, mutationId: string, payload: string): FeedbackThread | undefined {
    const prior = receipts.get(userId)?.get(mutationId);
    if (!prior) return undefined;
    if (prior.fingerprint === null) throw new FeedbackError("NOT_FOUND", "The original comment was deleted.");
    if (prior.fingerprint !== payload) {
      throw new FeedbackError("MUTATION_CONFLICT", "This mutation ID was already used for a different payload.");
    }
    // Tombstones prevent a delayed retry from recreating a deleted question or reply.
    const thread = requireThread(prior.threadId);
    requireComment(thread, prior.commentId);
    return thread;
  }

  function remember(userId: string, mutationId: string, payload: string, threadId: string, commentId: string): void {
    let entries = receipts.get(userId);
    if (!entries) {
      entries = new Map();
      receipts.set(userId, entries);
    }
    entries.set(mutationId, { fingerprint: payload, threadId, commentId });
  }

  function newComment(user: FeedbackUser, threadId: string, input: NormalizedCommentInput, at: string): FeedbackComment {
    return {
      id: nextId(), threadId, version: 1, author: copyUser(user), body: input.body,
      attachments: input.attachments.map((item) => ({ ...item })),
      mentions: [...input.mentions], likedBy: [], createdAt: at,
    };
  }

  function pendingNotifications(thread: FeedbackThread, comment: FeedbackComment, first: boolean, recipients = [...allowed]) {
    return recipients.filter((id) => allowed.has(id) && id !== comment.author.id).map((recipientId) => {
      const notification: FeedbackNotification = {
        id: nextId(), threadId: thread.id, screen: { ...thread.screen }, commentId: comment.id,
        kind: comment.mentions.includes(recipientId) ? "mention" : first ? "comment" : "reply",
        actor: copyUser(comment.author), body: comment.body, read: false, createdAt: comment.editedAt ?? comment.createdAt,
      };
      return { recipientId, notification };
    });
  }

  function saveNotifications(pending: ReturnType<typeof pendingNotifications>): void {
    for (const { recipientId, notification } of pending) {
      let inbox = notifications.get(recipientId);
      if (!inbox) {
        inbox = new Map();
        notifications.set(recipientId, inbox);
      }
      inbox.set(notification.id, notification);
    }
  }

  function removeNotifications(threadId: string, commentId?: string): void {
    for (const inbox of notifications.values()) {
      for (const [id, notification] of inbox) {
        if (notification.threadId === threadId && (commentId === undefined || notification.commentId === commentId)) {
          inbox.delete(id);
        }
      }
    }
  }

  function redactReceipts(threadId: string, commentId?: string): void {
    for (const entries of receipts.values()) {
      for (const receipt of entries.values()) {
        if (receipt.threadId === threadId && (commentId === undefined || receipt.commentId === commentId)) {
          // Retain identifiers to reject delayed retries, without retaining deleted input text or image URLs.
          receipt.fingerprint = null;
        }
      }
    }
  }

  function emit(event: FeedbackEvent, onlyUserId?: string): void {
    for (const [userId, registrations] of [...subscriptions]) {
      if (onlyUserId !== undefined && userId !== onlyUserId) continue;
      for (const subscription of [...registrations]) {
        if (!registrations.has(subscription)) continue;
        // An earlier callback may synchronously revoke another account.
        if (event.type === "changed" && !allowed.has(userId)) continue;
        try {
          subscription.listener({ ...event });
        } catch {
          // Host observers cannot undo committed state or stop other observers.
        }
      }
    }
  }

  function touch(thread: FeedbackThread): void {
    if (!Number.isSafeInteger(thread.version + 1)) invalid("Thread version limit reached.");
    thread.version += 1;
    thread.updatedAt = timestamp();
  }

  function publish(thread: FeedbackThread): void {
    emit({ type: "changed", screenId: thread.screen.id });
  }

  function forUser(userId: string): FeedbackAdapter {
    const user = requireUser(userId);
    const actorId = user.id;
    return {
      async getAccess() {
        return { userId: actorId, allowed: allowed.has(actorId), canDeleteAny: allowed.has(actorId) && moderators.has(actorId) };
      },

      async getUsers() {
        requireAccess(actorId);
        return [...users.values()].filter((candidate) => allowed.has(candidate.id)).map(copyUser);
      },

      async listThreads(screen) {
        requireAccess(actorId);
        const target = normalizeScreen(screen);
        return [...threads.values()].filter((thread) => sameScreen(thread.screen, target)).map(copyThread);
      },

      async createThread(input) {
        requireAccess(actorId);
        const normalized = normalizeThread(input);
        const payload = fingerprint("thread", normalized, { screen: normalized.screen, anchor: normalized.anchor, resolved: normalized.resolved });
        const prior = priorMutation(actorId, normalized.clientMutationId, payload);
        if (prior) return copyThread(prior);
        requireMentions(normalized.mentions);
        const at = timestamp();
        const threadId = nextId();
        const comment = newComment(user, threadId, normalized, at);
        const thread: FeedbackThread = {
          id: threadId, screen: normalized.screen, anchor: normalized.anchor,
          resolved: normalized.resolved, version: 0, comments: [comment], createdAt: at, updatedAt: at,
        };
        const pending = pendingNotifications(thread, comment, true);
        threads.set(threadId, thread);
        remember(actorId, normalized.clientMutationId, payload, threadId, comment.id);
        saveNotifications(pending);
        const result = copyThread(thread);
        publish(thread);
        return result;
      },

      async addComment(threadId, input) {
        requireAccess(actorId);
        const normalized = normalizeComment(input);
        const payload = fingerprint("reply", normalized, threadId);
        const prior = priorMutation(actorId, normalized.clientMutationId, payload);
        if (prior) return copyThread(prior);
        const thread = copyThread(requireThread(threadId));
        requireMentions(normalized.mentions);
        touch(thread);
        const comment = newComment(user, threadId, normalized, thread.updatedAt);
        thread.comments.push(comment);
        const pending = pendingNotifications(thread, comment, false);
        threads.set(threadId, thread);
        remember(actorId, normalized.clientMutationId, payload, threadId, comment.id);
        saveNotifications(pending);
        const result = copyThread(thread);
        publish(thread);
        return result;
      },

      async editComment(threadId, commentId, input) {
        requireAccess(actorId);
        const thread = copyThread(requireThread(threadId));
        const comment = requireComment(thread, commentId);
        if (comment.author.id !== actorId) throw new FeedbackError("EDIT_FORBIDDEN", "Only the comment author can edit this comment.");
        if (!input || !Number.isSafeInteger(input.version) || input.version < 1) invalid("A positive integer comment version is required.");
        if (comment.version !== input.version) throw new FeedbackError("VERSION_CONFLICT", "The comment changed. Refresh before editing.");
        const normalized = normalizeComment({
          body: input.body, mentions: input.mentions ?? comment.mentions,
          attachments: comment.attachments, clientMutationId: "edit",
        });
        const newMentions = normalized.mentions.filter((id) => !comment.mentions.includes(id));
        requireMentions(newMentions);
        touch(thread);
        comment.body = normalized.body;
        comment.mentions = normalized.mentions;
        comment.version += 1;
        comment.editedAt = thread.updatedAt;
        const pending = pendingNotifications(thread, comment, false, newMentions);
        threads.set(threadId, thread);
        saveNotifications(pending);
        const result = copyThread(thread);
        publish(thread);
        return result;
      },

      async deleteComment(threadId, commentId) {
        requireAccess(actorId);
        const thread = copyThread(requireThread(threadId));
        const comment = requireComment(thread, commentId);
        if (thread.comments[0]?.id === commentId) invalid("Delete the whole thread to remove its first comment.");
        if (comment.author.id !== actorId && !moderators.has(actorId)) {
          throw new FeedbackError("DELETE_FORBIDDEN", "Only the reply author or a moderator can delete this reply.");
        }
        touch(thread);
        thread.comments = thread.comments.filter((candidate) => candidate.id !== commentId);
        threads.set(threadId, thread);
        removeNotifications(threadId, commentId);
        redactReceipts(threadId, commentId);
        const result = copyThread(thread);
        publish(thread);
        return result;
      },

      async setResolved(threadId, resolved, version) {
        requireAccess(actorId);
        if (typeof resolved !== "boolean" || !Number.isSafeInteger(version) || version < 0) invalid("A boolean state and non-negative integer version are required.");
        const thread = copyThread(requireThread(threadId));
        if (thread.version !== version) throw new FeedbackError("VERSION_CONFLICT", "The thread changed. Refresh before changing its status.");
        if (thread.resolved === resolved) return thread;
        touch(thread);
        thread.resolved = resolved;
        threads.set(threadId, thread);
        const result = copyThread(thread);
        publish(thread);
        return result;
      },

      async deleteThread(threadId) {
        requireAccess(actorId);
        const thread = requireThread(threadId);
        if (thread.comments[0]?.author.id !== actorId && !moderators.has(actorId)) {
          throw new FeedbackError("DELETE_FORBIDDEN", "Only the question author or a moderator can delete this thread.");
        }
        threads.delete(threadId);
        removeNotifications(threadId);
        redactReceipts(threadId);
        publish(thread);
      },

      async toggleLike(threadId, commentId) {
        requireAccess(actorId);
        const thread = copyThread(requireThread(threadId));
        const comment = requireComment(thread, commentId);
        const existing = comment.likedBy.indexOf(actorId);
        if (existing === -1) comment.likedBy.push(actorId);
        else comment.likedBy.splice(existing, 1);
        touch(thread);
        threads.set(threadId, thread);
        const result = copyThread(thread);
        publish(thread);
        return result;
      },

      async getNotifications() {
        requireAccess(actorId);
        return [...(notifications.get(actorId)?.values() ?? [])].reverse().map(copyNotification);
      },

      async markNotificationRead(id) {
        requireAccess(actorId);
        const notification = notifications.get(actorId)?.get(id);
        if (!notification) throw new FeedbackError("NOT_FOUND", "The notification was not found in your inbox.");
        if (notification.read) return;
        notification.read = true;
        emit({ type: "changed", screenId: notification.screen.id }, actorId);
      },

      subscribe(listener) {
        if (typeof listener !== "function") invalid("The subscription listener must be a function.");
        let registrations = subscriptions.get(actorId);
        if (!registrations) {
          registrations = new Set();
          subscriptions.set(actorId, registrations);
        }
        const subscription = { listener };
        registrations.add(subscription);
        return () => {
          registrations.delete(subscription);
          if (!registrations.size) subscriptions.delete(actorId);
        };
      },
    };
  }

  return {
    forUser,
    setAccess(userId, enabled) {
      const id = requireUser(userId).id;
      if (typeof enabled !== "boolean") invalid("allowed must be a boolean.");
      if (allowed.has(id) === enabled) return;
      if (enabled) allowed.add(id);
      else allowed.delete(id);
      emit({ type: "access-changed" }, id);
    },
  };
}
