import type {
  FeedbackAccess, FeedbackAdapter, FeedbackNotification, FeedbackScreen, FeedbackThread, FeedbackUser,
} from "@won005/feedback-core";

type Snapshot = {
  access: FeedbackAccess | undefined;
  accessRevision: number;
  threads: FeedbackThread[];
  users: FeedbackUser[];
  notifications: FeedbackNotification[];
};

type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function sameScreen(left: FeedbackScreen, right: FeedbackScreen): boolean {
  return left.id === right.id && left.resourceId === right.resourceId;
}

export function createFeedbackSession(
  adapter: FeedbackAdapter,
  screen: FeedbackScreen,
  report: (error: unknown) => void,
) {
  const listeners = new Set<() => void>();
  let scope = 0;
  let request = 0;
  let mounted = false;
  let snapshot: Snapshot = { access: undefined, accessRevision: 0, threads: [], users: [], notifications: [] };

  const publish = (next: Snapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const invalidate = (access?: FeedbackAccess) => {
    const accessRevision = ++scope;
    publish({ access, accessRevision, threads: [], users: [], notifications: [] });
  };

  const refresh = async () => {
    if (!mounted) return;
    const newest = ++request;
    const isLatest = () => mounted && request === newest;
    try {
      const access = await adapter.getAccess();
      if (!isLatest()) return;
      if (snapshot.access?.userId !== access.userId || snapshot.access?.allowed !== access.allowed) {
        invalidate(access);
      } else if (snapshot.access.canDeleteAny !== access.canDeleteAny) {
        publish({ ...snapshot, access });
      }
      if (!access.allowed) return;

      const [threads, users, notifications] = await Promise.all([
        adapter.listThreads(screen),
        adapter.getUsers(),
        adapter.getNotifications(),
      ]);
      if (!isLatest()) return;
      publish({
        access, accessRevision: scope, users, notifications,
        threads: threads.filter((thread) => sameScreen(thread.screen, screen)),
      });
    } catch (error) {
      if (isLatest()) report(error);
    }
  };

  return {
    adapter,
    screen,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      let subscribed = false;
      let unsubscribe: () => void;
      try {
        unsubscribe = adapter.subscribe((event) => {
          if (!subscribed) return;
          if (event.type === "access-changed") invalidate();
          void refresh();
        });
        if (typeof unsubscribe !== "function") {
          throw new TypeError("FeedbackAdapter.subscribe must return an unsubscribe function.");
        }
      } catch (error) {
        report(error);
        return;
      }

      subscribed = true;
      mounted = true;
      void refresh();
      return () => {
        subscribed = false;
        mounted = false;
        ++request;
        invalidate();
        try {
          unsubscribe();
        } catch (error) {
          report(error);
        }
      };
    },
    capture() {
      const revision = scope;
      return () => mounted && snapshot.access?.allowed === true && revision === scope;
    },
    async perform<T>(work: () => Promise<T>, { refreshAfter = true } = {}): Promise<Result<T> | undefined> {
      const revision = scope;
      const isCurrent = () => mounted && snapshot.access?.allowed === true && revision === scope;
      if (!isCurrent()) return;
      try {
        const value = await work();
        if (!isCurrent()) return;
        if (refreshAfter) await refresh();
        if (isCurrent()) return { ok: true, value };
      } catch (error) {
        if (!isCurrent()) return;
        report(error);
        if (refreshAfter) void refresh();
        return { ok: false, error };
      }
    },
  };
}

export type FeedbackSession = ReturnType<typeof createFeedbackSession>;
