import { useLayoutEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { FEEDBACK_LIMITS } from "@won005/feedback-core";
import type { FeedbackAttachment, FeedbackCommentInput, FeedbackUser } from "@won005/feedback-core";
import { IconButton } from "./controls.js";
import type { FeedbackSession } from "./session.js";

export type PickImages = (remaining: number) => Promise<FeedbackAttachment[] | undefined>;

let mutationSequence = 0;

function mutationId(): string {
  mutationSequence++;
  return `native-${Date.now().toString(36)}-${mutationSequence}-${Math.random().toString(36).slice(2)}`;
}

export function displayableImage(attachment: FeedbackAttachment): boolean {
  return /^image\/(png|jpeg|webp|gif|avif|bmp|heic|heif)$/i.test(attachment.mimeType) &&
    /^(?:https?:\/\/|file:\/\/\/|content:\/\/)/i.test(attachment.url);
}

type Mention = { id: string; name: string };

function visibleMentions(body: string, mentions: Mention[]): Mention[] {
  return mentions.filter(({ name }) => {
    const label = `@${name}`;
    let index = body.indexOf(label);
    while (index !== -1) {
      const before = body[index - 1];
      const after = body[index + label.length];
      if ((!before || /\s/.test(before)) && (!after || /[\s.,!?;:)]/.test(after))) return true;
      index = body.indexOf(label, index + label.length);
    }
    return false;
  });
}

export function Composer({
  accent, label, submitLabel, session, users, onPickImages, disabled, initialBody = "", initialMentions = [],
  editing = false, hasExistingImages = false, draftResolved, autoFocus = false, onSubmit, onViewImage, onCancel,
}: {
  accent: string;
  label: string;
  submitLabel: string;
  session: FeedbackSession;
  users: FeedbackUser[];
  onPickImages?: PickImages | undefined;
  disabled: boolean;
  initialBody?: string;
  initialMentions?: string[];
  editing?: boolean;
  hasExistingImages?: boolean;
  draftResolved?: boolean;
  autoFocus?: boolean;
  onSubmit: (input: FeedbackCommentInput) => Promise<boolean>;
  onViewImage: (image: FeedbackAttachment) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [mentions, setMentions] = useState<Mention[]>(() => users.filter((user) => initialMentions.includes(user.id)));
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [cursor, setCursor] = useState(initialBody.length);
  const [nextSelection, setNextSelection] = useState<{ start: number; end: number }>();
  const alive = useRef(false);
  const inFlight = useRef(false);
  const lastMutation = useRef<{ key: string; id: string } | undefined>(undefined);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const mentionQuery = /(?:^|\s)@([^\s@]*)$/.exec(body.slice(0, cursor))?.[1];
  const candidates = mentionQuery === undefined ? [] : users
    .filter((user) => user.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 5);
  const canSubmit = Boolean(body.trim() || attachments.length || hasExistingImages);
  const busy = disabled || picking || submitting;

  const pick = async () => {
    if (!onPickImages || inFlight.current || busy) return;
    const remaining = FEEDBACK_LIMITS.attachments - attachments.length;
    if (remaining <= 0) return;
    inFlight.current = true;
    setPicking(true);
    setImageError(false);
    const result = await session.perform(() => onPickImages(remaining), { refreshAfter: false });
    inFlight.current = false;
    if (!alive.current) return;
    setPicking(false);
    if (!result) return;
    if (!result.ok) {
      setImageError(true);
      return;
    }
    const selected = result.value?.filter(displayableImage) ?? [];
    if (result.value?.length !== selected.length && result.value !== undefined) setImageError(true);
    setAttachments((current) => {
      const byId = new Map(current.map((image) => [image.id, image]));
      for (const image of selected) {
        if (byId.size >= FEEDBACK_LIMITS.attachments) break;
        if (!byId.has(image.id)) byId.set(image.id, image);
      }
      return [...byId.values()];
    });
  };

  const submit = async () => {
    if (!canSubmit || busy || inFlight.current) return;
    const submittedBody = body.trim();
    const mentionedIds = visibleMentions(submittedBody, mentions).map(({ id }) => id);
    const key = JSON.stringify([submittedBody, attachments, mentionedIds, draftResolved]);
    const mutation = lastMutation.current?.key === key ? lastMutation.current : { key, id: mutationId() };
    lastMutation.current = mutation;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const submitted = await onSubmit({
        body: submittedBody, attachments, mentions: mentionedIds, clientMutationId: mutation.id,
      });
      if (submitted && alive.current) {
        lastMutation.current = undefined;
        setBody("");
        setCursor(0);
        setMentions([]);
        setAttachments([]);
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setSubmitting(false);
    }
  };

  const select = (user: FeedbackUser) => {
    if (mentionQuery === undefined) return;
    const before = body.slice(0, cursor - mentionQuery.length - 1);
    const replacement = `${before}@${user.name} `;
    const updated = replacement + body.slice(cursor);
    if (updated.length > FEEDBACK_LIMITS.bodyLength) return;
    setBody(updated);
    setCursor(replacement.length);
    setNextSelection({ start: replacement.length, end: replacement.length });
    setMentions((current) => {
      const visible = visibleMentions(updated, current);
      if (visible.some(({ id }) => id === user.id) || visible.length >= FEEDBACK_LIMITS.mentions) return visible;
      return [...visible, user];
    });
  };

  return (
    <View style={styles.composer}>
      {candidates.length > 0 && !busy && (
        <View style={styles.mentions}>
          {candidates.map((user) => (
            <Pressable
              key={user.id}
              accessibilityRole="button"
              accessibilityLabel={`${user.name} 멘션 선택`}
              onPress={() => select(user)}
              style={styles.mention}
            >
              <Text style={styles.mentionText}>@{user.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {imageError && <Text accessibilityRole="alert" style={styles.error}>사진을 불러오지 못했습니다.</Text>}
      <Attachments items={attachments} onView={onViewImage} onRemove={busy ? undefined : (id) =>
        setAttachments((current) => current.filter((item) => item.id !== id))} />
      <TextInput
        accessibilityLabel={label}
        autoFocus={autoFocus}
        editable={!busy}
        maxLength={FEEDBACK_LIMITS.bodyLength}
        multiline
        onChangeText={(updated) => {
          setBody(updated);
          setMentions((current) => visibleMentions(updated, current));
          setCursor(Math.max(0, Math.min(updated.length, cursor + updated.length - body.length)));
          setNextSelection(undefined);
        }}
        onSelectionChange={({ nativeEvent }) => {
          setCursor(nativeEvent.selection.end);
          if (nextSelection && nativeEvent.selection.end === nextSelection.end) setNextSelection(undefined);
        }}
        selection={nextSelection}
        placeholder={label}
        placeholderTextColor="#776d6d"
        style={styles.input}
        value={body}
      />
      <View style={styles.buttons}>
        {onPickImages && !editing && (
          <IconButton
            name="image" label="사진 선택" onPress={() => void pick()}
            disabled={busy || attachments.length >= FEEDBACK_LIMITS.attachments}
          />
        )}
        {onCancel && (
          <Pressable accessibilityRole="button" accessibilityLabel="수정 취소" onPress={onCancel} disabled={busy}>
            <Text style={styles.cancel}>취소</Text>
          </Pressable>
        )}
        <View style={styles.spacer} />
        <IconButton
          name="send" label={submitLabel} onPress={() => void submit()}
          color="#ffffff" background={accent} disabled={busy || !canSubmit}
        />
      </View>
    </View>
  );
}

export function Attachments({ items, onView, onRemove }: {
  items: FeedbackAttachment[];
  onView: (image: FeedbackAttachment) => void;
  onRemove?: ((id: string) => void) | undefined;
}) {
  return (
    <View style={styles.attachments}>
      {items.filter(displayableImage).map((item) => (
        <View key={item.id} style={styles.attachment}>
          <Pressable
            accessibilityLabel={`${item.name} 크게 보기`}
            accessibilityRole="button"
            onPress={() => onView(item)}
          >
            <Image source={{ uri: item.url }} style={styles.thumbnail} resizeMode="cover" />
          </Pressable>
          {onRemove && (
            <Pressable
              accessibilityLabel={`${item.name} 제거`}
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => onRemove(item.id)}
              style={styles.remove}
            >
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { padding: 10, borderTopColor: "#eee5e5", borderTopWidth: StyleSheet.hairlineWidth },
  input: {
    paddingVertical: 6, paddingHorizontal: 8, minHeight: 38, maxHeight: 92, color: "#2c2323",
    fontSize: 12, textAlignVertical: "top", backgroundColor: "#faf6f6", borderRadius: 7,
  },
  buttons: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 6 },
  spacer: { flex: 1 },
  cancel: { color: "#625b5b", fontSize: 12, paddingVertical: 7, paddingHorizontal: 4 },
  mentions: { backgroundColor: "#fff3f3", borderRadius: 7, marginBottom: 6 },
  mention: { paddingHorizontal: 9, paddingVertical: 7 },
  mentionText: { color: "#722128", fontSize: 12 },
  error: { color: "#ae1c28", fontSize: 12, paddingBottom: 5 },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  attachment: { marginBottom: 6 },
  thumbnail: { backgroundColor: "#eee5e5", width: 46, height: 46, borderRadius: 6 },
  remove: {
    alignItems: "center", justifyContent: "center", position: "absolute", top: -3, right: -3,
    width: 17, height: 17, backgroundColor: "#2c2323", borderRadius: 9,
  },
  removeText: { color: "#ffffff", fontSize: 13, lineHeight: 15 },
});
