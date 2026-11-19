import { FeedbackError } from "./errors.ts";
import type {
  CreateFeedbackThreadInput,
  FeedbackAnchor,
  FeedbackAttachment,
  FeedbackCommentInput,
  FeedbackScreen,
  FeedbackUser,
} from "./types.ts";

export const FEEDBACK_LIMITS = Object.freeze({
  bodyLength: 2000,
  attachments: 5,
  mentions: 20,
});

const imageTypes = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif",
  "image/bmp", "image/heic", "image/heif",
]);

export function invalid(message: string): never {
  throw new FeedbackError("INVALID_INPUT", message);
}

function record(value: unknown, field: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${field} must be an object.`);
  }
}

export function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  const result = value.trim();
  if (!result || result.length > maximum) invalid(`${field} must contain 1 to ${maximum} characters.`);
  return result;
}

function imageUrl(value: unknown, field: string, allowLocalFile = false): string {
  const result = text(value, field, 4096);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    return invalid(`${field} must be an absolute supported image URI.`);
  }
  const local = allowLocalFile && ["file:", "content:"].includes(parsed.protocol);
  if ((!local && !["https:", "http:", "blob:"].includes(parsed.protocol)) || parsed.username || parsed.password) {
    invalid(`${field} must use a supported image URI without embedded credentials.`);
  }
  return result;
}

export function normalizeUser(value: FeedbackUser): FeedbackUser {
  record(value, "user");
  const result: FeedbackUser = {
    id: text(value.id, "user.id", 128), name: text(value.name, "user.name", 100),
  };
  if (value.avatarUrl !== undefined) result.avatarUrl = imageUrl(value.avatarUrl, "user.avatarUrl");
  return result;
}

export function normalizeScreen(value: FeedbackScreen): FeedbackScreen {
  record(value, "screen");
  const result: FeedbackScreen = { id: text(value.id, "screen.id", 512) };
  if (value.resourceId !== undefined) result.resourceId = text(value.resourceId, "screen.resourceId", 512);
  if (value.version !== undefined) result.version = text(value.version, "screen.version", 100);
  return result;
}

function coordinate(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${field} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function dimension(value: unknown, field: string): number {
  const result = coordinate(value, field, 0, 100000);
  if (result === 0) invalid(`${field} must be greater than zero.`);
  return result;
}

export function normalizeAnchor(value: FeedbackAnchor): FeedbackAnchor {
  record(value, "anchor");
  return {
    id: text(value.id, "anchor.id", 512), x: coordinate(value.x, "anchor.x", 0, 1),
    y: coordinate(value.y, "anchor.y", 0, 1), width: dimension(value.width, "anchor.width"),
    height: dimension(value.height, "anchor.height"), viewportWidth: dimension(value.viewportWidth, "anchor.viewportWidth"),
    viewportHeight: dimension(value.viewportHeight, "anchor.viewportHeight"),
    scrollX: coordinate(value.scrollX, "anchor.scrollX", 0, 10000000),
    scrollY: coordinate(value.scrollY, "anchor.scrollY", 0, 10000000),
  };
}

function attachment(value: FeedbackAttachment): FeedbackAttachment {
  record(value, "attachment");
  const mimeType = text(value.mimeType, "attachment.mimeType", 100).toLowerCase();
  if (!imageTypes.has(mimeType)) invalid("Only supported raster image attachments are accepted.");
  return {
    id: text(value.id, "attachment.id", 128), name: text(value.name, "attachment.name", 255),
    url: imageUrl(value.url, "attachment.url", true), mimeType,
  };
}

export interface NormalizedCommentInput {
  body: string;
  attachments: FeedbackAttachment[];
  mentions: string[];
  clientMutationId: string;
}

export interface NormalizedThreadInput extends NormalizedCommentInput {
  screen: FeedbackScreen;
  anchor: FeedbackAnchor;
  resolved: boolean;
}

export function normalizeComment(value: FeedbackCommentInput): NormalizedCommentInput {
  record(value, "comment");
  if (typeof value.body !== "string") invalid("body must be a string.");
  const body = value.body.trim();
  if (body.length > FEEDBACK_LIMITS.bodyLength) invalid(`body must be at most ${FEEDBACK_LIMITS.bodyLength} characters.`);
  if (value.attachments !== undefined && !Array.isArray(value.attachments)) invalid("attachments must be an array.");
  const attachments = (value.attachments ?? []).map(attachment);
  if (attachments.length > FEEDBACK_LIMITS.attachments) invalid(`At most ${FEEDBACK_LIMITS.attachments} images are allowed.`);
  if (new Set(attachments.map((item) => item.id)).size !== attachments.length) invalid("Attachment IDs must be unique.");
  if (!body && !attachments.length) invalid("A comment needs text or an image.");
  if (value.mentions !== undefined && !Array.isArray(value.mentions)) invalid("mentions must be an array.");
  const mentions = [...new Set((value.mentions ?? []).map((id) => text(id, "mention", 128)))];
  if (mentions.length > FEEDBACK_LIMITS.mentions) invalid(`At most ${FEEDBACK_LIMITS.mentions} users can be mentioned.`);
  return {
    body, attachments, mentions, clientMutationId: text(value.clientMutationId, "clientMutationId", 128),
  };
}

export function normalizeThread(value: CreateFeedbackThreadInput): NormalizedThreadInput {
  record(value, "thread");
  if (value.resolved !== undefined && typeof value.resolved !== "boolean") invalid("resolved must be a boolean.");
  return { ...normalizeComment(value), screen: normalizeScreen(value.screen), anchor: normalizeAnchor(value.anchor), resolved: value.resolved ?? false };
}
