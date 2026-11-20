import { forwardRef, useRef, type TextareaHTMLAttributes } from "react";

export interface FeedbackTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Defaults to submitting the owning form. The composer owns validation and pending work. */
  onSend?: (() => void) | undefined;
  /** Images use the host's existing upload path; ordinary text keeps native paste behavior. */
  onPasteImages?: ((files: File[]) => void) | undefined;
}

/** Enter submits, Shift+Enter inserts a newline, and IME confirmation never submits. */
export const FeedbackTextarea = forwardRef<HTMLTextAreaElement, FeedbackTextareaProps>(function FeedbackTextarea({
  onSend, onPasteImages, onKeyDown, onPaste, onCompositionStart, onCompositionEnd, onBlur,
  disabled, readOnly, title = "Enter로 전송 · Shift+Enter로 줄바꿈", ...props
}, ref) {
  const composing = useRef(false);
  return <textarea {...props} ref={ref} disabled={disabled} readOnly={readOnly} title={title}
    onCompositionStart={event => { composing.current = true; onCompositionStart?.(event); }}
    onCompositionEnd={event => { composing.current = false; onCompositionEnd?.(event); }}
    onBlur={event => { composing.current = false; onBlur?.(event); }}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.defaultPrevented || disabled || readOnly || event.key !== "Enter" || event.shiftKey ||
          composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault();
      if (onSend) onSend();
      else event.currentTarget.form?.requestSubmit();
    }}
    onPaste={event => {
      onPaste?.(event);
      if (event.defaultPrevented || disabled || readOnly || !onPasteImages) return;
      const fromItems = Array.from(event.clipboardData?.items ?? [])
        .filter(item => item.kind === "file")
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null && file.type.startsWith("image/"));
      const images = fromItems.length ? fromItems : Array.from(event.clipboardData?.files ?? [])
        .filter(file => file.type.startsWith("image/"));
      if (!images.length) return;
      event.preventDefault();
      onPasteImages(images);
    }} />;
});
