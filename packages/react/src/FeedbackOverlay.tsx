import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FeedbackAccess, FeedbackAdapter, FeedbackAnchor, FeedbackAttachment, FeedbackComment, FeedbackNotification, FeedbackScreen, FeedbackThread, FeedbackUser } from "@won005/feedback-core";
import { captureAnchor, clampPosition, measureAnchors, sameScreen, type Point } from "./geometry.js";
import { anchorRoots, ANCHOR_KEY_ATTR } from "./siteping/semantic-anchor.js";
import { styles } from "./styles.js";

export interface FeedbackOverlayProps {
  adapter: FeedbackAdapter;
  screen: FeedbackScreen;
  accentColor?: string;
  onError?: (error: unknown) => void;
  initialEnabled?: boolean;
  /** Called for notifications on another screen. The host owns routing and authorization. */
  onNavigate?: (notification: FeedbackNotification) => void;
}

const adapterKeys = new WeakMap<FeedbackAdapter, number>();
const sessionUi = new WeakMap<FeedbackAdapter, { enabled: boolean; collapsed: boolean; position: Point }>();
const navigationTargets = new WeakMap<FeedbackAdapter, FeedbackNotification>();
let nextAdapterKey = 0;
function adapterKey(adapter: FeedbackAdapter): number {
  let key = adapterKeys.get(adapter);
  if (key === undefined) { key = ++nextAdapterKey; adapterKeys.set(adapter, key); }
  return key;
}

/** Mount one instance per page. A different adapter always starts an isolated session. */
export function FeedbackOverlay(props: FeedbackOverlayProps) {
  return <FeedbackSession key={`${adapterKey(props.adapter)}:${screenIdentity(props.screen)}`} {...props} />;
}

type PopoverHost = HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void };
function usePortal() {
  const [portal, setPortal] = useState<{ host: PopoverHost; root: ShadowRoot | HTMLDivElement } | null>(null);
  useEffect(() => {
    const host = document.createElement("div") as PopoverHost;
    host.setAttribute("data-feedback-overlay", "");
    Object.assign(host.style, { position: "fixed", inset: "0", margin: "0", padding: "0", border: "0", width: "100vw", height: "100dvh", background: "transparent", overflow: "visible", pointerEvents: "none", zIndex: "2147483647" });
    const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    const modalStack: HTMLDialogElement[] = [];
    let observer: MutationObserver | null = null;
    const isModal = (dialog: HTMLDialogElement) => {
      if (!dialog.open) return false;
      if (typeof dialog.showModal !== "function") return true;
      try { return dialog.matches(":modal"); } catch { return dialog.open; }
    };
    const lift = (preferred?: HTMLDialogElement) => {
      const roots = anchorRoots(document);
      const modals = roots.flatMap(root => Array.from(root.querySelectorAll<HTMLDialogElement>("dialog[open]"))).filter(isModal);
      observer?.disconnect();
      for (const root of roots) observer?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
      for (let index = modalStack.length - 1; index >= 0; index--) if (!modals.includes(modalStack[index]!)) modalStack.splice(index, 1);
      for (const dialog of modals) if (!modalStack.includes(dialog)) modalStack.push(dialog);
      if (preferred && modals.includes(preferred)) { const index = modalStack.indexOf(preferred); if (index >= 0) modalStack.splice(index, 1); modalStack.push(preferred); }
      const parent = modalStack.at(-1) ?? document.body;
      if (host.parentElement !== parent) parent.appendChild(host);
      if (!host.showPopover) return;
      try {
        host.setAttribute("popover", "manual");
        if (host.matches(":popover-open")) return;
        host.showPopover();
      } catch { /* Older engines retain the fixed-position overlay. */ }
    };
    lift();
    observer = new MutationObserver((records) => {
      const changed = [...records].reverse().find(record => record.type === "attributes" && record.target instanceof HTMLDialogElement);
      if (changed || records.some(record => record.type === "childList")) lift(changed?.target instanceof HTMLDialogElement ? changed.target : undefined);
    });
    lift();
    const onToggle = (event: Event) => { if (event.target instanceof HTMLDialogElement) lift(event.target.open ? event.target : undefined); };
    const onFocus = (event: FocusEvent) => lift(event.composedPath().find((node): node is HTMLDialogElement => node instanceof HTMLDialogElement && isModal(node)));
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("focusin", onFocus, true);
    setPortal({ host, root });
    return () => { observer?.disconnect(); document.removeEventListener("toggle", onToggle, true); document.removeEventListener("focusin", onFocus, true); host.remove(); };
  }, []);
  return portal;
}

const newMutationId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const screenIdentity = (screen: FeedbackScreen) => JSON.stringify([screen.id, screen.resourceId ?? null, screen.version ?? null]);
const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

function hasMention(body: string, name: string): boolean {
  const token = `@${name}`;
  let index = body.indexOf(token);
  const boundary = (value: string | undefined) => value === undefined || /[\s.,!?…:;()[\]{}]/u.test(value);
  while (index >= 0) {
    if (boundary(body[index - 1]) && boundary(body[index + token.length])) return true;
    index = body.indexOf(token, index + token.length);
  }
  return false;
}

function FeedbackSession({ adapter, screen, accentColor = "#d92d35", initialEnabled = false, onError, onNavigate }: FeedbackOverlayProps) {
  const portal = usePortal();
  const screenKey = screenIdentity(screen);
  const scope = useMemo(() => ({ alive: true, epoch: 0, refreshId: 0, subscribed: false }), [screenKey]);
  const [access, setAccess] = useState<FeedbackAccess | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string; threads: FeedbackThread[] }>({ key: "", threads: [] });
  const threads = snapshot.key === screenKey ? snapshot.threads : [];
  const [notifications, setNotifications] = useState<FeedbackNotification[]>([]);
  const [enabled, setEnabled] = useState(() => sessionUi.get(adapter)?.enabled ?? initialEnabled);
  const [collapsed, setCollapsed] = useState(() => sessionUi.get(adapter)?.collapsed ?? false);
  const [position, setPosition] = useState<Point>(() => sessionUi.get(adapter)?.position ?? { x: 24, y: 24 });
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ anchor: FeedbackAnchor; point: Point } | null>(null);
  const [panel, setPanel] = useState<"notifications" | null>(null);
  const [cardPosition, setCardPosition] = useState<Point | null>(null);
  const [draftResolved, setDraftResolved] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<FeedbackAttachment | null>(null);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [users, setUsers] = useState<FeedbackUser[]>([]);
  const mentionLabels = useRef(new Map<string, string>());
  const [memberDirectoryReady, setMemberDirectoryReady] = useState(false);
  const memberRequest = useRef(0);
  const [memberQuery, setMemberQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<FeedbackComment | null>(null);
  const [deletingReply, setDeletingReply] = useState<FeedbackComment | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const cardDrag = useRef<{ pointer: number; origin: Point; client: Point } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftContext = useRef(0);
  const mutation = useRef<{ signature: string; id: string } | null>(null);
  const operationLock = useRef(false);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const selected = threads.find((thread) => thread.id === selectedId) ?? null;

  useEffect(() => { sessionUi.set(adapter, { enabled, collapsed, position }); }, [adapter, enabled, collapsed, position]);

  const clearDraft = useCallback(() => {
    draftContext.current++;
    setBody(""); setAttachments([]); setMentions([]); setMemberQuery(null); setEditing(null); setDraftResolved(false); setViewingPhoto(null); mutation.current = null;
  }, []);

  const report = useCallback((failure: unknown) => {
    setError("연결 또는 저장을 완료하지 못했습니다. 다시 시도해 주세요.");
    try { errorHandler.current?.(failure); } catch { /* Error observers cannot remove the host application. */ }
  }, []);

  const updateMembers = useCallback(async () => {
    const epoch = scope.epoch, request = ++memberRequest.current;
    const current = () => scope.alive && scope.subscribed && epoch === scope.epoch && request === memberRequest.current;
    try {
      const members = await adapter.getUsers();
      if (!current()) return;
      setUsers(members); mentionLabels.current = new Map(members.map(member => [member.id, member.name]));
      setMemberDirectoryReady(true);
    } catch (failure) {
      if (!current()) return;
      setUsers([]); mentionLabels.current.clear(); setMemberDirectoryReady(false); report(failure);
    }
  }, [adapter, scope, report]);

  const refresh = useCallback(async () => {
    if (!scope.subscribed) return;
    const epoch = scope.epoch;
    const request = ++scope.refreshId;
    const current = () => scope.alive && epoch === scope.epoch && request === scope.refreshId;
    try {
      const permission = await adapter.getAccess();
      if (!current()) return;
      setAccess(permission);
      if (!permission.allowed) {
        setEnabled(false); setSnapshot({ key: screenKey, threads: [] }); setNotifications([]);
        setPending(null); setSelectedId(null); setPanel(null); clearDraft(); return;
      }
      const [nextThreads, nextNotifications] = await Promise.all([adapter.listThreads(screen), adapter.getNotifications()]);
      if (!current()) return;
      setSnapshot({ key: screenKey, threads: nextThreads.filter((thread) => sameScreen(thread.screen, screen)) });
      setNotifications(nextNotifications);
      void updateMembers();
      const target = navigationTargets.get(adapter);
      if (target && sameScreen(target.screen, screen)) {
        navigationTargets.delete(adapter);
        if (nextThreads.some(thread => thread.id === target.threadId)) { setSelectedId(target.threadId); setEnabled(true); }
      }
      setError(null);
    } catch (failure) { if (current()) report(failure); }
  }, [adapter, screenKey, scope, clearDraft, report, updateMembers]);

  useEffect(() => {
    scope.alive = true; scope.epoch++;
    setPending(null); setSelectedId(null); setPanel(null); setMenu(false); setConfirmDelete(false); setDeletingReply(null);
    operationLock.current = false;
    setBusy(false); setUploading(false); clearDraft();
    void refresh();
    return () => { scope.alive = false; scope.epoch++; };
  }, [scope, refresh, clearDraft]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;
    scope.subscribed = false;
    scope.epoch++; scope.refreshId++; memberRequest.current++; draftContext.current++;
    operationLock.current = false; setBusy(false); setUploading(false); setAccess(null);
    setUsers([]); mentionLabels.current.clear(); setMemberDirectoryReady(false);
    try {
      const dispose = adapter.subscribe((event) => {
        if (!active || !scope.alive || !scope.subscribed) return;
        if (event.type === "access-changed") {
          scope.epoch++;
          operationLock.current = false; setBusy(false); setUploading(false);
          setAccess(null); setSnapshot({ key: screenKey, threads: [] }); setNotifications([]); clearDraft();
          setUsers([]); mentionLabels.current.clear(); setMemberDirectoryReady(false); memberRequest.current++;
        }
        void refresh();
      });
      if (typeof dispose !== "function") throw new Error("FeedbackAdapter.subscribe must return an unsubscribe function.");
      unsubscribe = dispose; scope.subscribed = true; void refresh();
    } catch (failure) {
      active = false; scope.epoch++; scope.refreshId++; scope.subscribed = false;
      setAccess(null); setSnapshot({ key: screenKey, threads: [] }); setNotifications([]);
      setPending(null); setSelectedId(null); setPanel(null); clearDraft(); report(failure);
    }
    return () => {
      active = false; scope.subscribed = false; scope.epoch++; scope.refreshId++;
      try { unsubscribe?.(); } catch (failure) { if (scope.alive) report(failure); }
    };
  }, [adapter, scope, refresh, screenKey, clearDraft, report, connectionAttempt]);

  useEffect(() => {
    let frame = 0;
    const active = enabled && access?.allowed;
    const mutations = active && typeof MutationObserver !== "undefined" ? new MutationObserver(() => update()) : null;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => update());
    const observedElements = new Set<Element>();
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const roots = active ? anchorRoots(document) : [];
        mutations?.disconnect();
        const candidates = new Set<Element>([document.documentElement]);
        for (const root of roots) {
          mutations?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: [ANCHOR_KEY_ATTR, "style", "class", "hidden", "open"] });
          for (const element of Array.from(root.querySelectorAll(`[${ANCHOR_KEY_ATTR}]`))) candidates.add(element);
        }
        for (const element of observedElements) if (!candidates.has(element)) { observer?.unobserve(element); observedElements.delete(element); }
        for (const element of candidates) if (!observedElements.has(element)) { observer?.observe(element); observedElements.add(element); }
        const bounds = { width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight };
        setViewport(bounds);
        setPosition((previous) => clampPosition(previous, bounds, { width: collapsed ? 44 : toolbarRef.current?.offsetWidth ?? 270, height: collapsed ? 44 : 48 }));
        setLayoutRevision((revision) => revision + 1);
      });
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", update); document.removeEventListener("scroll", update, true); window.visualViewport?.removeEventListener("resize", update); window.visualViewport?.removeEventListener("scroll", update); observer?.disconnect(); mutations?.disconnect(); };
  }, [collapsed, enabled, access?.allowed]);

  useEffect(() => {
    if (!portal || !access?.allowed) return;
    const isOwn = (event: Event) => event.composedPath().includes(portal.host);
    const context = (event: MouseEvent) => {
      if (!enabled || isOwn(event) || event.button !== 2 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      const target = event.composedPath().find((entry): entry is Element => entry instanceof Element) ?? null;
      const point = { x: event.clientX, y: event.clientY };
      setPending({ anchor: captureAnchor(target, point, document), point }); setSelectedId(null); setPanel(null);
      setMenu(false); setConfirmDelete(false); setCardPosition(null); clearDraft();
    };
    const outside = (event: MouseEvent) => {
      if (isOwn(event)) return;
      setPending(null); setSelectedId(null); setPanel(null); setMemberQuery(null); setMenu(false); setConfirmDelete(false); clearDraft();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (viewingPhoto) { event.preventDefault(); setViewingPhoto(null); return; }
      setPending(null); setSelectedId(null); setPanel(null); setMemberQuery(null); setMenu(false); setConfirmDelete(false); clearDraft();
    };
    document.addEventListener("contextmenu", context, true);
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("contextmenu", context, true); document.removeEventListener("click", outside, true); document.removeEventListener("keydown", escape, true); };
  }, [portal, access?.allowed, enabled, clearDraft, viewingPhoto]);

  const points = useMemo(() => {
    if (typeof document === "undefined" || !enabled || !access?.allowed || !threads.length) return new Map<string, Point | null>();
    const measured = measureAnchors(threads.map(thread => thread.anchor), document);
    return new Map(threads.map((thread, index) => [thread.id, measured[index] ?? null]));
  }, [threads, layoutRevision, enabled, access?.allowed]);

  useEffect(() => { if ((pending || selectedId) && enabled) textRef.current?.focus(); }, [pending, selectedId, enabled]);

  const action = async (perform: () => Promise<FeedbackThread | void>, after?: () => void) => {
    if (operationLock.current || !access?.allowed) return;
    const epoch = scope.epoch;
    const context = draftContext.current;
    scope.refreshId++;
    operationLock.current = true;
    setBusy(true); setError(null);
    try {
      await perform();
      if (!scope.alive || epoch !== scope.epoch) return;
      await refresh();
      if (scope.alive && epoch === scope.epoch && context === draftContext.current) after?.();
    } catch (failure) { if (scope.alive && epoch === scope.epoch) report(failure); }
    finally { if (scope.alive && epoch === scope.epoch) { operationLock.current = false; setBusy(false); } }
  };

  const waitingForMentionLabels = Boolean(editing && !memberDirectoryReady && mentions.some(id => !mentionLabels.current.has(id)));
  const send = () => {
    if (waitingForMentionLabels || uploading || (!body.trim() && attachments.length === 0) || (!pending && !selected)) return;
    const destination = pending ? { anchor: pending.anchor, screen, resolved: draftResolved } : { threadId: selected!.id };
    const payload = { body: body.trim(), attachments, mentions: mentions.filter(id => { const name = mentionLabels.current.get(id); return name !== undefined && hasMention(body, name); }) };
    const signature = JSON.stringify({ destination, ...payload });
    if (mutation.current?.signature !== signature) mutation.current = { signature, id: newMutationId() };
    const input = { ...payload, clientMutationId: mutation.current.id };
    const context = draftContext.current;
    void action(async () => {
      const result = editing && selected
        ? await adapter.editComment(selected.id, editing.id, { body: payload.body, mentions: payload.mentions, version: editing.version })
        : pending ? await adapter.createThread({ ...input, anchor: pending.anchor, screen, resolved: draftResolved }) : await adapter.addComment(selected!.id, input);
      if (scope.alive && context === draftContext.current) { setPending(null); setSelectedId(result.id); clearDraft(); }
      return result;
    });
  };

  const upload = async (file: File | undefined) => {
    if (!file || !adapter.uploadAttachment || uploading) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp", "image/heic", "image/heif"].includes(file.type)) { setError("지원하는 이미지 파일을 선택해 주세요."); return; }
    if (file.size > 5 * 1024 * 1024 || attachments.length >= 5) { setError("사진은 5MB 이하, 최대 5개까지 첨부할 수 있어요."); return; }
    const epoch = scope.epoch;
    const context = draftContext.current;
    setUploading(true);
    try {
      const attachment = await adapter.uploadAttachment(file);
      if (!scope.alive || epoch !== scope.epoch || context !== draftContext.current) return;
      if (!attachment.mimeType.startsWith("image/")) throw new Error("The upload adapter returned a non-image attachment");
      setAttachments((previous) => [...previous, attachment]);
    } catch (failure) { if (scope.alive && epoch === scope.epoch && context === draftContext.current) report(failure); }
    finally { if (scope.alive && epoch === scope.epoch) setUploading(false); }
  };

  const loadMembers = async (query: string) => {
    setMemberQuery(query);
    await updateMembers();
  };

  const chooseMember = (user: FeedbackUser) => {
    mentionLabels.current.set(user.id, user.name);
    setBody((previous) => /@[^\s@]*$/u.test(previous) ? previous.replace(/@[^\s@]*$/u, `@${user.name} `) : `${previous}${previous.endsWith(" ") || !previous ? "" : " "}@${user.name} `);
    setMentions((previous) => [...new Set([...previous, user.id])]);
    setMemberQuery(null); textRef.current?.focus();
  };

  const changeBody = (value: string) => {
    setBody(value);
    setMentions(previous => previous.filter(id => { const name = mentionLabels.current.get(id); return name === undefined || hasMention(value, name); }));
    const match = /@([^\s@]*)$/u.exec(value);
    if (match) void loadMembers(match[1] ?? ""); else setMemberQuery(null);
  };

  const drag = useRef<{ pointer: number; origin: Point; client: Point; moved: boolean; collapsed: boolean } | null>(null);
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, isCollapsed: boolean) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, origin: position, client: { x: event.clientX, y: event.clientY }, moved: false, collapsed: isCollapsed };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    const dx = event.clientX - state.client.x, dy = event.clientY - state.client.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true;
    setPosition(clampPosition({ x: state.origin.x + dx, y: state.origin.y + dy }, viewport, { width: state.collapsed ? 44 : toolbarRef.current?.offsetWidth ?? 270, height: state.collapsed ? 44 : 48 }));
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (state?.pointer !== event.pointerId) return;
    drag.current = null;
    if (state.collapsed && !state.moved) setCollapsed(false);
  };

  const openThread = (id: string) => {
    if (selectedId !== id) clearDraft();
    setEnabled(true); setSelectedId(id); setPending(null); setPanel(null); setMenu(false); setConfirmDelete(false); setDeletingReply(null); setCardPosition(null);
  };
  const openNotification = (notification: FeedbackNotification) => {
    const epoch = scope.epoch;
    void adapter.markNotificationRead(notification.id).then(() => {
      if (scope.alive && epoch === scope.epoch) setNotifications((previous) => previous.map((entry) => entry.id === notification.id ? { ...entry, read: true } : entry));
    }).catch((failure: unknown) => { if (scope.alive && epoch === scope.epoch) report(failure); });
    if (sameScreen(notification.screen, screen)) {
      if (threads.some((thread) => thread.id === notification.threadId)) openThread(notification.threadId);
      else { void refresh(); setError("이 댓글을 현재 화면에서 찾을 수 없습니다."); }
    } else if (onNavigate) { navigationTargets.set(adapter, notification); setPanel(null); onNavigate(notification); }
    else setError("다른 화면에 있는 댓글입니다.");
  };

  if (!portal) return null;
  const unread = notifications.filter((notification) => !notification.read).length;
  const activePoint = pending?.point ?? (selected ? points.get(selected.id) : null) ?? null;
  const panelPoint = clampPosition(cardPosition ?? (activePoint ? { x: activePoint.x + 22, y: activePoint.y - 22 } : { x: viewport.width - 344, y: 24 }), viewport, { width: Math.min(320, viewport.width - 24), height: cardRef.current?.offsetHeight || Math.min(380, viewport.height - 24) });
  const floatingStyle: CSSProperties = { left: position.x, top: position.y };
  const members = users.filter((user) => !memberQuery || user.name.toLocaleLowerCase().includes(memberQuery.toLocaleLowerCase()));
  const canDelete = selected && access && (access.canDeleteAny || selected.comments[0]?.author.id === access.userId);
  const closeThread = () => { setSelectedId(null); setPending(null); setMenu(false); setConfirmDelete(false); setDeletingReply(null); setCardPosition(null); clearDraft(); };
  const toggleMode = () => { setEnabled((previous) => !previous); closeThread(); setPanel(null); };
  const beginCardDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId);
    cardDrag.current = { pointer: event.pointerId, origin: panelPoint, client: { x: event.clientX, y: event.clientY } };
  };
  const moveCardDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = cardDrag.current;
    if (!state || state.pointer !== event.pointerId) return;
    event.preventDefault();
    setCardPosition(clampPosition({ x: state.origin.x + event.clientX - state.client.x, y: state.origin.y + event.clientY - state.client.y }, viewport, { width: cardRef.current?.offsetWidth || 320, height: cardRef.current?.offsetHeight || 380 }));
  };

  return createPortal(<div className="sf-root" style={{ "--accent": accentColor } as CSSProperties}>
    <style>{styles}</style>
    {access?.allowed && <div className="sf-controls" inert={viewingPhoto !== null}>
      {enabled && threads.map((thread, index) => {
        const point = points.get(thread.id);
        if (!point || point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) return null;
        return <button key={thread.id} type="button" className="sf-pin" style={{ left: point.x, top: point.y }} data-resolved={thread.resolved} data-selected={selectedId === thread.id} aria-label={`댓글 ${index + 1}: ${thread.comments[0]?.body || "이미지"}`} onClick={() => openThread(thread.id)}>{thread.resolved ? <Icon name="check" /> : index + 1}</button>;
      })}
      {enabled && pending && <span className="sf-pin" style={{ left: pending.point.x, top: pending.point.y }} aria-hidden="true"><Icon name="plus" /></span>}
      {collapsed ? <button type="button" className="sf-collapsed" data-enabled={enabled} style={floatingStyle} aria-label="피드백 도구 펼치기. 드래그하여 이동" onPointerDown={(event) => beginDrag(event, true)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }} onClick={(event) => { if (event.detail === 0) setCollapsed(false); }}><Icon name="comment" />{unread > 0 && <span className="sf-badge">{unread > 99 ? "99+" : unread}</span>}</button> : <div className="sf-toolbar" style={floatingStyle} ref={toolbarRef} role="toolbar" aria-label="화면 피드백">
        <button type="button" className="sf-grip" aria-label="피드백 도구 이동. 방향키로도 이동" onPointerDown={(event) => beginDrag(event, false)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }} onKeyDown={(event) => {
          const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
          if (!delta) return;
          event.preventDefault(); setPosition((previous) => clampPosition({ x: previous.x + delta[0]!, y: previous.y + delta[1]! }, viewport, { width: toolbarRef.current?.offsetWidth ?? 270, height: 48 }));
        }}><Icon name="grip" /></button>
        <button type="button" className="sf-mode" aria-pressed={enabled} title="ON에서 우클릭하여 위치 댓글 작성" onClick={toggleMode}><span className="sf-switch" />피드백 {enabled ? "ON" : "OFF"}</button>
        <span className="sf-divider" />
        <button type="button" className="sf-icon" aria-label={`알림${unread ? ` ${unread}개 읽지 않음` : ""}`} aria-pressed={panel === "notifications"} onClick={() => { setPanel(panel === "notifications" ? null : "notifications"); closeThread(); }}><Icon name="bell" />{unread > 0 && <span className="sf-badge">{unread > 99 ? "99+" : unread}</span>}</button>
        <button type="button" className="sf-icon" aria-label="도구 접기" onClick={() => setCollapsed(true)}><Icon name="collapse" /></button>
      </div>}
      {panel && <section className="sf-panel" style={{ left: panelPoint.x, top: panelPoint.y }} aria-label="피드백 알림">
        <div className="sf-panel-head"><h2 className="sf-panel-title">알림</h2><button type="button" className="sf-icon" aria-label="알림함 닫기" onClick={() => setPanel(null)}><Icon name="close" /></button></div>
        <div className="sf-list">{notifications.length ? notifications.map((notification) => <button type="button" className="sf-list-item" key={notification.id} data-unread={!notification.read} onClick={() => openNotification(notification)}><Avatar user={notification.actor} /><div className="sf-list-copy"><strong>{notification.actor.name}{notification.kind === "mention" ? "님이 나를 멘션했습니다" : notification.kind === "reply" ? "님의 답글" : "님의 댓글"}</strong><p>{notification.body || "이미지 첨부"}</p><small>{timeLabel(notification.createdAt)}</small></div></button>) : <div className="sf-empty">새로운 알림이 없습니다.</div>}</div>
      </section>}
      {enabled && (pending || selected) && <section ref={cardRef} className="sf-panel" style={{ left: panelPoint.x, top: panelPoint.y }} role="dialog" aria-label={pending ? "새 위치 댓글" : "댓글 대화"}>
        <div className="sf-panel-head">
          <button type="button" className="sf-grip sf-panel-grip" aria-label="댓글창 이동. 방향키로도 이동" onPointerDown={beginCardDrag} onPointerMove={moveCardDrag} onPointerUp={() => { cardDrag.current = null; }} onPointerCancel={() => { cardDrag.current = null; }} onKeyDown={event => {
            const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
            if (!delta) return;
            event.preventDefault(); setCardPosition(clampPosition({ x: panelPoint.x + delta[0]!, y: panelPoint.y + delta[1]! }, viewport, { width: cardRef.current?.offsetWidth || 320, height: cardRef.current?.offsetHeight || 380 }));
          }}><Icon name="grip" /></button>
          <h2 className="sf-panel-title">{pending ? "새 댓글" : selected?.resolved ? "해결된 댓글" : "댓글"}</h2>
          <button type="button" className="sf-icon" disabled={busy} aria-label={pending ? draftResolved ? "해결됨 등록 취소" : "해결됨으로 등록" : selected?.resolved ? "다시 열기" : "해결하기"} aria-pressed={pending ? draftResolved : selected?.resolved} onClick={() => { if (pending) setDraftResolved(value => !value); else if (selected) void action(() => adapter.setResolved(selected.id, !selected.resolved, selected.version)); }}><Icon name={selected?.resolved ? "reopen" : "check"} /></button>
          {(pending || canDelete) && <button type="button" className="sf-icon" disabled={busy} aria-label={pending ? "작성 중인 댓글 삭제" : "질문 삭제"} onClick={() => { if (pending) closeThread(); else setConfirmDelete(true); }}><Icon name="trash" /></button>}
          <button type="button" className="sf-icon" aria-label="댓글창 닫기" onClick={closeThread}><Icon name="close" /></button>
        </div>
        {menu && selected && <div className="sf-menu"><button type="button" disabled={busy} onClick={() => { setMenu(false); void action(() => adapter.setResolved(selected.id, !selected.resolved, selected.version)); }}>{selected.resolved ? "다시 열기" : "해결하기"}</button>{canDelete && <button type="button" className="sf-danger" onClick={() => { setMenu(false); setConfirmDelete(true); }}>댓글 삭제</button>}</div>}
        {selected && !activePoint && <div className="sf-loading">위치 미확인 · 원래 화면 요소를 찾을 수 없습니다.</div>}
        <div className="sf-body">{selected?.comments.map((comment, index) => <CommentCard key={comment.id} comment={comment} currentUserId={access.userId} canDeleteAny={access.canDeleteAny} disabled={busy} onViewPhoto={setViewingPhoto} onLike={() => void action(() => adapter.toggleLike(selected.id, comment.id))} onEdit={() => { clearDraft(); setEditing(comment); setBody(comment.body); setAttachments(comment.attachments); setMentions(comment.mentions); textRef.current?.focus(); }} onDelete={() => { if (index === 0) setConfirmDelete(true); else setDeletingReply(comment); }} />)}</div>
        {(confirmDelete || deletingReply) && selected ? <div className="sf-confirm" role="alertdialog" aria-label={deletingReply ? "답글 삭제 확인" : "댓글 삭제 확인"}><p>{deletingReply ? "이 답글을 삭제할까요?" : "이 댓글과 모든 답글을 삭제할까요?"}<br />삭제한 내용은 복구할 수 없습니다.</p><div className="sf-confirm-actions"><button type="button" onClick={() => { setConfirmDelete(false); setDeletingReply(null); }} disabled={busy}>취소</button><button type="button" className="sf-danger" disabled={busy} onClick={() => {
          if (deletingReply) void action(() => adapter.deleteComment(selected.id, deletingReply.id), () => { if (editing?.id === deletingReply.id) clearDraft(); setDeletingReply(null); });
          else void action(() => adapter.deleteThread(selected.id), () => { setSnapshot((previous) => ({ ...previous, threads: previous.threads.filter((thread) => thread.id !== selected.id) })); closeThread(); clearDraft(); });
        }}>삭제</button></div></div> : <div className="sf-composer">
          {editing && <div className="sf-editing"><strong>댓글 수정</strong><button type="button" onClick={clearDraft} disabled={busy}>취소</button></div>}
          <p className="sf-note">이 피드백은 허용된 참여자에게 공유됩니다.</p>
          {memberQuery !== null && <div className="sf-members" role="listbox" aria-label="멘션할 참여자">{members.length ? members.map((user) => <button type="button" key={user.id} className="sf-member" role="option" aria-selected={false} onClick={() => chooseMember(user)}><Avatar user={user} />{user.name}</button>) : <div className="sf-loading">일치하는 참여자가 없습니다.</div>}</div>}
          <textarea ref={textRef} className="sf-textarea" aria-label={pending ? "댓글 내용" : "답글 내용"} placeholder={pending ? "댓글 남기기…" : "답글 남기기…"} maxLength={2000} value={body} disabled={busy} onChange={(event) => changeBody(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); send(); } }} />
          {attachments.length > 0 && <div className="sf-images">{attachments.map((attachment) => <div key={attachment.id} className="sf-attachment"><button type="button" className="sf-photo-preview" aria-label={`${attachment.name} 크게 보기`} onClick={() => setViewingPhoto(attachment)}><img className="sf-image" src={attachment.url} alt={attachment.name} /></button>{!editing && <button type="button" className="sf-remove-image" disabled={busy} aria-label={`${attachment.name} 첨부 제거`} onClick={() => setAttachments((previous) => previous.filter((entry) => entry.id !== attachment.id))}><Icon name="close" /></button>}</div>)}</div>}
          {uploading && <div className="sf-loading" role="status">이미지를 업로드하고 있습니다.</div>}
          {waitingForMentionLabels && <div className="sf-loading" role="status">기존 멘션 정보를 확인한 뒤 저장할 수 있어요.</div>}
          <div className="sf-composer-bottom"><button type="button" className="sf-icon" disabled={busy} aria-label="참여자 멘션" onClick={() => { if (memberQuery !== null) setMemberQuery(null); else void loadMembers(""); }}><Icon name="mention" /></button>{adapter.uploadAttachment && !editing && <><input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} /><button type="button" className="sf-icon" disabled={busy || uploading} aria-label="이미지 첨부" onClick={() => fileRef.current?.click()}><Icon name="image" /></button></>}<button type="button" className="sf-send" disabled={busy || uploading || waitingForMentionLabels || (!body.trim() && attachments.length === 0)} onClick={send}>{busy ? "전송 중" : editing ? "저장" : "전송"}<Icon name="send" /></button></div>
        </div>}
      </section>}
    </div>}
    {access?.allowed && viewingPhoto && <ImageViewer photo={viewingPhoto} onClose={() => setViewingPhoto(null)} />}
    {error && <div className="sf-error" role="alert"><span>{error}</span><button type="button" onClick={() => { setConnectionAttempt((previous) => previous + 1); void refresh(); }}>다시 연결</button><button type="button" aria-label="오류 닫기" onClick={() => setError(null)}>×</button></div>}
  </div>, portal.root);
}

function Avatar({ user }: { user: FeedbackUser | undefined }) {
  return user?.avatarUrl ? <img className="sf-avatar" src={user.avatarUrl} alt="" /> : <span className="sf-avatar" aria-hidden="true">{user?.name.slice(0, 2) ?? "?"}</span>;
}

function CommentCard({ comment, currentUserId, canDeleteAny, disabled, onLike, onEdit, onDelete, onViewPhoto }: { comment: FeedbackComment; currentUserId: string; canDeleteAny: boolean; disabled: boolean; onLike: () => void; onEdit: () => void; onDelete: () => void; onViewPhoto: (photo: FeedbackAttachment) => void }) {
  const isAuthor = comment.author.id === currentUserId;
  return <article className="sf-comment">
    <div className="sf-author-row"><Avatar user={comment.author} /><span className="sf-name">{comment.author.name}</span><time className="sf-time" dateTime={comment.createdAt}>{timeLabel(comment.createdAt)}{comment.editedAt && " · 편집됨"}</time></div>
    {comment.body && <p className="sf-comment-copy">{comment.body}</p>}
    {comment.attachments.length > 0 && <div className="sf-images">{comment.attachments.map(attachment => <button type="button" className="sf-photo-preview" key={attachment.id} aria-label={`${attachment.name} 크게 보기`} onClick={() => onViewPhoto(attachment)}><img className="sf-image" src={attachment.url} alt={attachment.name} loading="lazy" /></button>)}</div>}
    <div className="sf-comment-actions">
      <button type="button" className="sf-like" aria-label="좋아요" aria-pressed={comment.likedBy.includes(currentUserId)} disabled={disabled} onClick={onLike}><Icon name="thumb" />{comment.likedBy.length}</button>
      {isAuthor && <button type="button" className="sf-comment-action" aria-label="댓글 수정" disabled={disabled} onClick={onEdit}><Icon name="edit" /></button>}
      {(isAuthor || canDeleteAny) && <button type="button" className="sf-comment-action" aria-label="댓글 삭제" disabled={disabled} onClick={onDelete}><Icon name="trash" /></button>}
    </div>
  </article>;
}

function ImageViewer({ photo, onClose }: { photo: FeedbackAttachment; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const root = close.current?.getRootNode();
    const previous = root && "activeElement" in root ? root.activeElement as HTMLElement | null : document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => { queueMicrotask(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }); }); };
  }, [photo.id]);
  return <section className="sf-photo-viewer" role="dialog" aria-modal="true" aria-label="첨부 사진 크게 보기" onKeyDown={event => {
    if (event.key === "Tab") { event.preventDefault(); close.current?.focus(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="sf-photo-header"><span>{photo.name}</span><button ref={close} type="button" className="sf-photo-close" aria-label="사진 닫기" onClick={onClose}><Icon name="close" /></button></header>
    <div className="sf-photo-stage" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><img src={photo.url} alt={photo.name} className="sf-photo-full" onClick={event => {
      const image = event.currentTarget;
      if (!image.naturalWidth || !image.naturalHeight) return;
      const rect = image.getBoundingClientRect();
      const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      const left = rect.left + (rect.width - width) / 2, top = rect.top + (rect.height - height) / 2;
      if (event.clientX < left || event.clientX > left + width || event.clientY < top || event.clientY > top + height) onClose();
    }} /></div>
  </section>;
}

type IconName = "comment" | "bell" | "collapse" | "close" | "grip" | "check" | "reopen" | "more" | "plus" | "mention" | "image" | "send" | "heart" | "thumb" | "edit" | "trash";
function Icon({ name }: { name: IconName }) {
  if (name === "mention") return <span style={{ fontSize: 19, lineHeight: 1 }} aria-hidden="true">@</span>;
  const paths: Record<Exclude<IconName, "mention">, ReactNode> = {
    comment: <path d="M20 11.5a8 8 0 0 1-8 8H4l-1 2v-10a8.5 8.5 0 1 1 17 0Z" />,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></>,
    collapse: <path d="m8 5 7 7-7 7" />, close: <path d="m6 6 12 12M18 6 6 18" />,
    grip: <><circle cx="9" cy="5" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="19" r="1" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    reopen: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
    send: <><path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15" /></>,
    heart: <path d="M20 4a5 5 0 0 0-8 2 5 5 0 0 0-8-2c-5 5 2 10 8 15 6-5 13-10 8-15Z" />,
    thumb: <><path d="M7 10v11H3V10h4Zm0 1 5-8c2 0 2 2 1 6h6a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7" /></>,
    edit: <><path d="m4 16 11-11 4 4L8 20l-5 1 1-5Zm10-10 4 4" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
