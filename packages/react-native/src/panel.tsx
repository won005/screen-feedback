import { useLayoutEffect, useRef, useState } from "react";
import { Alert, Image, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type {
  FeedbackAccess, FeedbackAnchor, FeedbackAttachment, FeedbackComment, FeedbackNotification,
  FeedbackThread, FeedbackUser,
} from "@won005/feedback-core";
import { Attachments, Composer } from "./composer.js";
import type { PickImages } from "./composer.js";
import { DragHandle, IconButton } from "./controls.js";
import type { Point, Size } from "./placement.js";
import type { FeedbackSession } from "./session.js";

export type PanelSelection =
  | { kind: "draft"; anchor: FeedbackAnchor }
  | { kind: "thread"; id: string; commentId?: string }
  | { kind: "notifications" };

function errorText(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "ACCESS_DENIED" || code === "DELETE_FORBIDDEN" || code === "EDIT_FORBIDDEN") {
    return "이 작업에 필요한 권한이 없습니다.";
  }
  if (code === "VERSION_CONFLICT") return "내용이 변경되었습니다. 다시 확인해 주세요.";
  if (code === "NOT_FOUND") return "댓글을 찾을 수 없습니다.";
  return "저장하지 못했습니다. 다시 시도해 주세요.";
}

function confirmDeletion(reply: boolean, onConfirm: () => void) {
  Alert.alert(
    reply ? "답글을 삭제할까요?" : "질문을 삭제할까요?",
    reply ? "이 답글을 삭제합니다." : "질문과 모든 답글을 삭제합니다.",
    [{ text: "취소", style: "cancel" }, { text: "삭제", style: "destructive", onPress: onConfirm }],
  );
}

export function FeedbackPanel({
  accent, selection, position, size, move, close, session, access, users, thread, notifications,
  onOpenNotification, onPickImages, onCreateThread,
}: {
  accent: string;
  selection: PanelSelection;
  position: Point;
  size: Size;
  move: (point: Point) => void;
  close: () => void;
  session: FeedbackSession;
  access: FeedbackAccess;
  users: FeedbackUser[];
  thread: FeedbackThread | undefined;
  notifications: FeedbackNotification[];
  onOpenNotification: (notice: FeedbackNotification) => void;
  onPickImages: PickImages | undefined;
  onCreateThread: (thread: FeedbackThread) => void;
}) {
  const [draftResolved, setDraftResolved] = useState(false);
  const [editing, setEditing] = useState<FeedbackComment>();
  const [viewer, setViewer] = useState<FeedbackAttachment>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const alive = useRef(false);
  const inFlight = useRef(false);
  const list = useRef<ScrollView>(null);
  const rowOffsets = useRef(new Map<string, number>());
  const scrolledTo = useRef<string | undefined>(undefined);
  const contentLaidOut = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const perform = async <T,>(work: () => Promise<T>, done?: (value: T) => void) => {
    if (!alive.current || inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    const result = await session.perform(work);
    inFlight.current = false;
    if (!alive.current) return false;
    setBusy(false);
    if (!result) return false;
    if (!result.ok) {
      setError(errorText(result.error));
      return false;
    }
    done?.(result.value);
    return true;
  };

  const adapter = session.adapter;
  const canDelete = (comment: FeedbackComment) => access.canDeleteAny || comment.author.id === access.userId;
  const firstComment = thread?.comments[0];
  const resolved = selection.kind === "draft" ? draftResolved : thread?.resolved;
  const title = selection.kind === "draft" ? "새 댓글" : selection.kind === "notifications" ? "알림" : "댓글";
  const closeViewer = () => setViewer(undefined);
  const deleteThread = (current: FeedbackThread) => confirmDeletion(false, () => {
    void perform(() => adapter.deleteThread(current.id), close);
  });
  const scrollToComment = () => {
    if (selection.kind !== "thread" || !selection.commentId || !contentLaidOut.current ||
      scrolledTo.current === selection.commentId) return;
    const y = rowOffsets.current.get(selection.commentId);
    if (y === undefined) return;
    list.current?.scrollTo({ y, animated: false });
    scrolledTo.current = selection.commentId;
  };

  return (
    <View style={[styles.panel, {
      left: position.x, top: position.y, width: size.width, maxHeight: size.height,
    }]} accessibilityViewIsModal>
      <View style={styles.header}>
        <DragHandle label="댓글창 이동" position={position} move={move} />
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        <View style={styles.spacer} />
        {selection.kind === "draft" || thread ? (
          <IconButton
            name={resolved ? "reopen" : "check"}
            label={resolved ? "해결 표시 해제" : "해결 표시"}
            color={resolved ? accent : "#625b5b"}
            selected={Boolean(resolved)}
            disabled={busy}
            onPress={() => {
              if (selection.kind === "draft") setDraftResolved((current) => !current);
              else if (thread) void perform(() => adapter.setResolved(thread.id, !thread.resolved, thread.version));
            }}
          />
        ) : null}
        {selection.kind === "draft" && (
          <IconButton name="trash" label="초안 삭제" onPress={close} disabled={busy} />
        )}
        {thread && firstComment && canDelete(firstComment) && (
          <IconButton name="trash" label="질문 및 답글 삭제" onPress={() => deleteThread(thread)} disabled={busy} />
        )}
        <IconButton name="close" label="댓글창 닫기" onPress={close} />
      </View>
      <ScrollView
        ref={list}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        style={styles.scroll}
        onContentSizeChange={() => {
          contentLaidOut.current = true;
          scrollToComment();
        }}
      >
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {selection.kind === "draft" && (
          <Composer
            accent={accent} label="새 댓글" submitLabel="등록" autoFocus session={session}
            users={users} onPickImages={onPickImages} disabled={busy} onViewImage={setViewer}
            draftResolved={draftResolved}
            onSubmit={(input) => perform(() => adapter.createThread({
              ...input, screen: session.screen, anchor: selection.anchor, resolved: draftResolved,
            }), (created) => {
              Keyboard.dismiss();
              onCreateThread(created);
            })}
          />
        )}
        {thread?.comments.map((comment, index) => {
          const own = comment.author.id === access.userId;
          const liked = comment.likedBy.includes(access.userId);
          const reply = index > 0;
          return (
            <View
              key={comment.id}
              style={[styles.row, reply && styles.reply]}
              onLayout={({ nativeEvent }) => {
                rowOffsets.current.set(comment.id, nativeEvent.layout.y);
                scrollToComment();
              }}
            >
              <View style={styles.rowTitle}>
                <View style={styles.avatar} accessible={false}>
                  <Text style={[styles.avatarText, { color: accent }]}>{Array.from(comment.author.name)[0] ?? "?"}</Text>
                </View>
                <Text style={styles.author}>{comment.author.name}</Text>
                {comment.editedAt && <Text style={styles.edited}>편집됨</Text>}
              </View>
              {editing?.id === comment.id ? (
                <Composer
                  accent={accent} label="댓글 내용 수정" submitLabel="수정 저장" autoFocus editing
                  initialBody={editing.body} initialMentions={editing.mentions}
                  hasExistingImages={editing.attachments.length > 0} session={session}
                  users={users} disabled={busy} onViewImage={setViewer} onCancel={() => setEditing(undefined)}
                  onSubmit={({ body, mentions }) => perform(
                    () => adapter.editComment(thread.id, editing.id, { body, mentions: mentions ?? [], version: editing.version }),
                    () => {
                      Keyboard.dismiss();
                      setEditing(undefined);
                    },
                  )}
                />
              ) : <Text selectable style={styles.body}>{comment.body}</Text>}
              <Attachments items={comment.attachments} onView={setViewer} />
              <View style={styles.actions}>
                <IconButton
                  name="heart" label={liked ? "좋아요 취소" : "좋아요"} color={liked ? accent : "#625b5b"}
                  selected={liked} onPress={() => void perform(() => adapter.toggleLike(thread.id, comment.id))}
                  disabled={busy}
                />
                {comment.likedBy.length > 0 && <Text style={styles.actionCount}>{comment.likedBy.length}</Text>}
                <View style={styles.spacer} />
                {own && (
                  <IconButton
                    name="edit" label={reply ? "답글 수정" : "질문 수정"}
                    onPress={() => setEditing(comment)} disabled={busy || editing?.id === comment.id}
                  />
                )}
                {canDelete(comment) && (
                  <IconButton
                    name="trash" label={reply ? "답글 삭제" : "질문 삭제"} disabled={busy}
                    onPress={() => {
                      if (!reply) deleteThread(thread);
                      else confirmDeletion(true, () => {
                        void perform(() => adapter.deleteComment(thread.id, comment.id));
                      });
                    }}
                  />
                )}
              </View>
            </View>
          );
        })}
        {thread && (
          <Composer
            accent={accent} label="답글 작성" submitLabel="답글 등록" session={session}
            users={users} onPickImages={onPickImages} disabled={busy} onViewImage={setViewer}
            onSubmit={(input) => perform(() => adapter.addComment(thread.id, input), Keyboard.dismiss)}
          />
        )}
        {selection.kind === "thread" && !thread && <Text style={styles.empty}>댓글을 찾을 수 없습니다.</Text>}
        {selection.kind === "notifications" && notifications.length === 0 && (
          <Text style={styles.empty}>새 알림이 없습니다.</Text>
        )}
        {selection.kind === "notifications" && notifications.map((notice) => (
          <View key={notice.id} style={styles.noticeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${notice.actor.name} 알림 열기`}
              style={styles.notice}
              disabled={busy}
              onPress={() => void perform(async () => {
                if (!notice.read) await adapter.markNotificationRead(notice.id);
              }, () => onOpenNotification(notice))}
            >
              {!notice.read && <View style={[styles.dot, { backgroundColor: accent }]} />}
              <View style={styles.spacer}>
                <Text style={styles.author}>{notice.actor.name}</Text>
                <Text style={styles.body} numberOfLines={2}>{notice.body}</Text>
              </View>
            </Pressable>
            {!notice.read && (
              <IconButton name="check" label="알림 읽음 표시" disabled={busy}
                onPress={() => void perform(() => adapter.markNotificationRead(notice.id))} />
            )}
          </View>
        ))}
      </ScrollView>
      {viewer && <ImageViewer image={viewer} close={closeViewer} />}
    </View>
  );
}

function ImageViewer({ image, close }: { image: FeedbackAttachment; close: () => void }) {
  const [window, setWindow] = useState<Size>();
  const [natural, setNatural] = useState<Size>();
  const scale = window && natural && natural.width > 0 && natural.height > 0
    ? Math.min(window.width * 0.88 / natural.width, window.height * 0.78 / natural.height)
    : undefined;
  const size = scale !== undefined && natural
    ? { width: natural.width * scale, height: natural.height * scale }
    : styles.viewerImage;
  return (
    <Modal
      visible transparent animationType="fade" presentationStyle="overFullScreen"
      hardwareAccelerated onRequestClose={close}
    >
      <View
        style={styles.viewer}
        accessibilityViewIsModal
        onLayout={({ nativeEvent }) => setWindow(nativeEvent.layout)}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="사진 바깥 닫기"
          accessibilityRole="button"
          onPress={close}
        />
        <View style={size}>
          <Image
            accessible accessibilityLabel={image.name} source={{ uri: image.url }}
            resizeMode="contain" style={styles.fullImage}
            onLoad={({ nativeEvent }) => setNatural(nativeEvent.source)}
          />
        </View>
        <View style={styles.viewerClose}>
          <IconButton name="close" label="사진 닫기" color="#ffffff" background="#4f4142" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute", backgroundColor: "#ffffff", borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ead8d8", borderRadius: 11, shadowColor: "#281216", shadowOpacity: 0.18,
    shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  header: {
    flexDirection: "row", alignItems: "center", paddingRight: 5, minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee5e5",
  },
  title: { color: "#332729", fontSize: 13, fontWeight: "700", flexShrink: 1 },
  spacer: { flex: 1 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  row: { paddingHorizontal: 10, paddingTop: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#eee5e5" },
  reply: { marginLeft: 10 },
  rowTitle: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  avatar: { width: 23, height: 23, borderRadius: 12, backgroundColor: "#fff0f1", alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 10, fontWeight: "700" },
  author: { fontSize: 12, fontWeight: "700", color: "#332729" },
  edited: { fontSize: 10, color: "#726565" },
  body: { fontSize: 13, lineHeight: 19, color: "#392e30", marginTop: 3, marginBottom: 4 },
  actions: { flexDirection: "row", alignItems: "center", marginBottom: 2 },
  actionCount: { fontSize: 11, color: "#625b5b" },
  empty: { padding: 14, fontSize: 12, color: "#625b5b" },
  error: { paddingHorizontal: 10, paddingTop: 7, color: "#ae1c28", fontSize: 12 },
  noticeRow: { flexDirection: "row", alignItems: "center", paddingRight: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#eee5e5" },
  notice: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, padding: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  viewer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(23,14,15,0.94)" },
  viewerImage: { width: "88%", height: "78%" },
  fullImage: { width: "100%", height: "100%" },
  viewerClose: { position: "absolute", top: 24, right: 20 },
});
