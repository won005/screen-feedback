import type { FeedbackErrorCode } from "./types.ts";

export class FeedbackError extends Error {
  readonly code: FeedbackErrorCode;

  constructor(code: FeedbackErrorCode, message: string) {
    super(message);
    this.name = "FeedbackError";
    this.code = code;
  }
}
