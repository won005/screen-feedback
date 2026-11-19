/** A host-provided identity. Names and avatars are never captured from the screen. */
export interface FeedbackUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

/** Version records where feedback originated; lists match id + resourceId across versions. */
export interface FeedbackScreen {
  id: string;
  resourceId?: string;
  version?: string;
}

/** Opaque renderer descriptor and relative position; the core never evaluates id. */
export interface FeedbackAnchor {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
}

/** Image metadata only. The host owns byte upload, storage, and URL authorization. */
export interface FeedbackAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: string;
}

export interface FeedbackComment {
  id: string;
  threadId: string;
  version: number;
  author: FeedbackUser;
  body: string;
  attachments: FeedbackAttachment[];
  mentions: string[];
  likedBy: string[];
  createdAt: string;
  editedAt?: string;
}

export interface FeedbackThread {
  id: string;
  screen: FeedbackScreen;
  anchor: FeedbackAnchor;
  resolved: boolean;
  version: number;
  comments: FeedbackComment[];
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackNotification {
  id: string;
  threadId: string;
  screen: FeedbackScreen;
  commentId?: string;
  kind: "comment" | "reply" | "mention";
  actor: FeedbackUser;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface FeedbackAccess {
  userId: string;
  allowed: boolean;
  canDeleteAny: boolean;
}

export interface FeedbackCommentInput {
  body: string;
  attachments?: FeedbackAttachment[];
  mentions?: string[];
  /** Unique per acting account. Reuse requires an identical normalized payload. */
  clientMutationId: string;
}

export interface CreateFeedbackThreadInput extends FeedbackCommentInput {
  screen: FeedbackScreen;
  anchor: FeedbackAnchor;
  /** Allows a draft to be posted directly as resolved. Defaults to false. */
  resolved?: boolean;
}

export interface EditFeedbackCommentInput {
  body: string;
  mentions?: string[];
  version: number;
}

export interface FeedbackEvent {
  type: "changed" | "access-changed";
  screenId?: string;
}

export interface FeedbackAdapter {
  getAccess(): Promise<FeedbackAccess>;
  getUsers(): Promise<FeedbackUser[]>;
  listThreads(screen: FeedbackScreen): Promise<FeedbackThread[]>;
  createThread(input: CreateFeedbackThreadInput): Promise<FeedbackThread>;
  addComment(threadId: string, input: FeedbackCommentInput): Promise<FeedbackThread>;
  editComment(threadId: string, commentId: string, input: EditFeedbackCommentInput): Promise<FeedbackThread>;
  deleteComment(threadId: string, commentId: string): Promise<FeedbackThread>;
  setResolved(threadId: string, resolved: boolean, version: number): Promise<FeedbackThread>;
  deleteThread(threadId: string): Promise<void>;
  toggleLike(threadId: string, commentId: string): Promise<FeedbackThread>;
  getNotifications(): Promise<FeedbackNotification[]>;
  markNotificationRead(id: string): Promise<void>;
  /** Own access changes remain observable after revocation; thread events are allowed-only. */
  subscribe(listener: (event: FeedbackEvent) => void): () => void;
  uploadAttachment?(file: unknown): Promise<FeedbackAttachment>;
}

export interface MemoryFeedbackStoreOptions {
  users: readonly FeedbackUser[];
  allowedUserIds: readonly string[];
  moderatorIds?: readonly string[];
  now?: () => Date;
  createId?: () => string;
}

/** Trusted host-side controls for the in-memory reference adapter. */
export interface MemoryFeedbackStore {
  forUser(userId: string): FeedbackAdapter;
  setAccess(userId: string, allowed: boolean): void;
}

export type FeedbackErrorCode =
  | "ACCESS_DENIED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "DELETE_FORBIDDEN"
  | "EDIT_FORBIDDEN"
  | "VERSION_CONFLICT"
  | "MUTATION_CONFLICT";
