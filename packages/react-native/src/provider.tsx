import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import type { FeedbackAdapter, FeedbackNotification, FeedbackScreen, FeedbackThread } from "@won005/feedback-core";
import type { PickImages } from "./composer.js";
import { DragHandle, IconButton } from "./controls.js";
import { FeedbackPanel } from "./panel.js";
import type { PanelSelection } from "./panel.js";
import {
  anchorDescriptor, constrainPosition, contains, findTouchTarget, measureWindow, parseAnchorDescriptor,
  PIN_SIZE, ROOT_SURFACE, surfaceDescriptor, toFeedbackAnchor, usableArea,
} from "./placement.js";
import type { FeedbackInsets, Point, Size } from "./placement.js";
import { createAnchorRegistry, createSurfaceRegistry } from "./registry.js";
import type { AnchorEntry } from "./registry.js";
import { createFeedbackSession, sameScreen } from "./session.js";
import type { FeedbackSession } from "./session.js";

export interface FeedbackProviderProps {
  adapter: FeedbackAdapter;
  screen: FeedbackScreen;
  accentColor?: string;
  onError?: (error: unknown) => void;
  onNavigate?: (notification: FeedbackNotification) => Promise<void> | void;
  onPickImages?: PickImages;
  insets?: FeedbackInsets;
  children: ReactNode;
}

export interface FeedbackSurfaceProps {
  id: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export interface FeedbackAnchorProps {
  id: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

type Navigation = { notice: FeedbackNotification; adapter: FeedbackAdapter; userId: string; origin: FeedbackScreen };
type Pin = { thread: FeedbackThread; number: number };
type OpenPanel = {
  selection: PanelSelection; point: Point; session: FeedbackSession; access: number; anchoredTo?: AnchorEntry;
};

const defaultInsets: FeedbackInsets = {};
const Providers = createContext<{
  session: FeedbackSession;
  accent: string;
  insets: FeedbackInsets;
  onPickImages: PickImages | undefined;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  surfaces: ReturnType<typeof createSurfaceRegistry>;
  navigation: Navigation | undefined;
  clearNavigation: (target: Navigation) => void;
  navigate: (notice: FeedbackNotification, userId: string) => void;
} | null>(null);
const SurfaceDepth = createContext(-1);
const AnchorDepth = createContext(0);
const Surfaces = createContext<{
  registry: ReturnType<typeof createAnchorRegistry>;
  pins: Map<string, Pin[]>;
  draft: { id: string; point: Point } | undefined;
  accent: string;
  open: (thread: FeedbackThread, anchor: AnchorEntry, point: Point) => void;
} | null>(null);

export function FeedbackProvider({
  adapter, screen, accentColor = "#d92d39", onError, onNavigate, onPickImages, insets = defaultInsets, children,
}: FeedbackProviderProps) {
  const { id, resourceId, version } = screen;
  const [enabled, setEnabled] = useState(false);
  const [navigation, setNavigation] = useState<Navigation>();
  const [surfaces] = useState(createSurfaceRegistry);
  const errorHandler = useRef(onError);
  const currentAdapter = useRef(adapter);
  useLayoutEffect(() => {
    errorHandler.current = onError;
    currentAdapter.current = adapter;
  }, [onError, adapter]);
  const session = useMemo(() => createFeedbackSession(adapter, {
    id, ...(resourceId === undefined ? {} : { resourceId }), ...(version === undefined ? {} : { version }),
  }, (error) => errorHandler.current?.(error)), [adapter, id, resourceId, version]);
  useLayoutEffect(() => session.start(), [session]);
  useLayoutEffect(() => { setNavigation(undefined); }, [adapter]);

  const clearNavigation = (target: Navigation) => setNavigation((current) => current === target ? undefined : current);
  const navigate = (notice: FeedbackNotification, userId: string) => {
    if (!onNavigate) return;
    const target = { notice, adapter, userId, origin: session.screen };
    setNavigation(target);
    const handleError = (error: unknown) => {
      clearNavigation(target);
      if (currentAdapter.current === adapter) errorHandler.current?.(error);
    };
    try {
      void Promise.resolve(onNavigate(notice)).catch(handleError);
    } catch (error) {
      handleError(error);
    }
  };

  return (
    <Providers.Provider value={{
      session, accent: accentColor, insets, onPickImages, enabled, setEnabled, surfaces,
      navigation, clearNavigation, navigate,
    }}>
      <Surface id={ROOT_SURFACE}>{children}</Surface>
    </Providers.Provider>
  );
}

export function FeedbackSurface({ id, style, children }: FeedbackSurfaceProps) {
  if (!id.trim() || id === ROOT_SURFACE) throw new Error("FeedbackSurface needs a unique, non-empty id.");
  return <Surface id={id} style={style}>{children}</Surface>;
}

function Surface({ id, style, children }: FeedbackSurfaceProps) {
  const provider = useContext(Providers);
  if (!provider) throw new Error("FeedbackSurface must be inside FeedbackProvider.");
  return <ManagedSurface provider={provider} id={id} style={style}>{children}</ManagedSurface>;
}

function ManagedSurface({
  provider, id, style, children,
}: FeedbackSurfaceProps & { provider: NonNullable<React.ContextType<typeof Providers>> }) {
  const depth = useContext(SurfaceDepth) + 1;
  const { accent, enabled, insets, session, surfaces } = provider;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const entry = useMemo(() => ({ id, depth }), [id, depth]);
  const [registry] = useState(createAnchorRegistry);
  const surfaceState = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot);
  const active = surfaceState.active === entry && surfaceState.unique;
  const anchorRevision = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  const usable = active && snapshot.access?.allowed === true;
  const [collapsed, setCollapsed] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<Point>();
  const [openPanel, setOpenPanel] = useState<OpenPanel>();
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [keyboardTop, setKeyboardTop] = useState<number>();
  const surface = useRef<View>(null);
  const pinRequest = useRef(0);
  useLayoutEffect(() => surfaces.register(entry), [surfaces, entry]);
  useLayoutEffect(() => {
    if (!usable || !enabled) setOpenPanel(undefined);
  }, [usable, enabled]);

  const anchoredTo = openPanel?.anchoredTo;
  const anchorLost = anchoredTo !== undefined && (!registry.has(anchoredTo) || !registry.isUnique(anchoredTo.id));
  useLayoutEffect(() => {
    if (anchorLost) setOpenPanel(undefined);
  }, [anchorLost, anchorRevision]);

  const panel = usable && enabled && !anchorLost &&
    openPanel?.session === session && openPanel.access === snapshot.accessRevision
    ? openPanel
    : undefined;
  const panelSelection = panel?.selection;
  const draftDescriptor = panelSelection?.kind === "draft" ? parseAnchorDescriptor(panelSelection.anchor.id) : undefined;
  const pins = useMemo(() => {
    const anchored = new Map<string, Pin[]>();
    const viewport: Pin[] = [];
    if (!usable || !enabled) return { anchored, viewport };
    snapshot.threads.forEach((thread, index) => {
      const descriptor = parseAnchorDescriptor(thread.anchor.id);
      if (descriptor?.surfaceId !== id) return;
      const pin = { thread, number: index + 1 };
      if (descriptor.anchorId === undefined) viewport.push(pin);
      else {
        const matching = anchored.get(descriptor.anchorId) ?? [];
        matching.push(pin);
        anchored.set(descriptor.anchorId, matching);
      }
    });
    return { anchored, viewport };
  }, [enabled, usable, snapshot.threads, id]);

  const bounds = usableArea(size, insets, keyboardTop);
  const toolbarSize = { width: collapsed ? 42 : 152, height: 40 };
  const toolbarPoint = constrainPosition(toolbarPosition ?? {
    x: bounds.x + bounds.width - toolbarSize.width - 12,
    y: bounds.y + bounds.height - toolbarSize.height - 12,
  }, bounds, toolbarSize);
  const panelSize = {
    width: Math.min(322, Math.max(0, bounds.width - 8)),
    height: Math.min(panelSelection?.kind === "draft" ? 290 : 410, bounds.height),
  };
  const panelPoint = panel ? constrainPosition(panel.point, bounds, panelSize) : toolbarPoint;

  const showPanel = (selection: PanelSelection, point: Point, origin?: AnchorEntry) => {
    ++pinRequest.current;
    setOpenPanel({
      selection, point, session, access: snapshot.accessRevision, ...(origin ? { anchoredTo: origin } : {}),
    });
  };
  const closePanel = () => {
    ++pinRequest.current;
    if (!panelSelection) return;
    setOpenPanel((current) => current === panel || current?.selection === panelSelection ? undefined : current);
    Keyboard.dismiss();
  };
  const openThread = (thread: FeedbackThread, point?: Point, commentId?: string) => {
    showPanel({
      kind: "thread", id: thread.id, ...(commentId === undefined ? {} : { commentId }),
    }, point ? { x: point.x + 12, y: point.y + 12 }
      : { x: toolbarPoint.x, y: toolbarPoint.y - panelSize.height - 8 });
  };
  const openAnchoredThread = (thread: FeedbackThread, anchor: AnchorEntry, point: Point) => {
    const request = ++pinRequest.current;
    const valid = session.capture();
    void Promise.all([measureWindow(surface.current), measureWindow(anchor.measure())]).then(([viewport, area]) => {
      const currentSurface = surfaces.getSnapshot();
      if (!valid() || request !== pinRequest.current || !registry.has(anchor) || !registry.isUnique(anchor.id) ||
        currentSurface.active !== entry || !currentSurface.unique) return;
      openThread(thread, viewport && area ? {
        x: area.x - viewport.x + point.x,
        y: area.y - viewport.y + point.y,
      } : undefined);
    });
  };
  const targetThread = panelSelection?.kind === "thread"
    ? snapshot.threads.find((thread) => thread.id === panelSelection.id)
    : undefined;

  useLayoutEffect(() => {
    const target = provider.navigation;
    if (!active || !snapshot.access || !target || target.adapter !== session.adapter) return;
    if (!snapshot.access.allowed || target.userId !== snapshot.access.userId) {
      provider.clearNavigation(target);
      return;
    }
    if (!sameScreen(target.notice.screen, session.screen)) {
      if (!sameScreen(target.origin, session.screen)) provider.clearNavigation(target);
      return;
    }
    const thread = snapshot.threads.find((item) => item.id === target.notice.threadId);
    if (!thread) return;
    provider.clearNavigation(target);
    provider.setEnabled(true);
    openThread(thread, undefined, target.notice.commentId);
  }, [active, provider.navigation, snapshot.access, snapshot.threads, session]);

  useLayoutEffect(() => {
    if (!active) return;
    let current = true;
    let keyboardEvent = 0;
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow", (event) => {
      const request = ++keyboardEvent;
      void measureWindow(surface.current).then((windowArea) => {
        if (current && request === keyboardEvent && windowArea) {
          setKeyboardTop(Math.max(0, event.endCoordinates.screenY - windowArea.y));
        }
      });
    });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => {
      ++keyboardEvent;
      setKeyboardTop(undefined);
    });
    return () => {
      current = false;
      show.remove();
      hide.remove();
      setKeyboardTop(undefined);
    };
  }, [active]);

  const canCapture = usable && enabled && !panel;
  const pressed = useRef((_: Point) => {});
  const pressRequest = useRef(0);
  useLayoutEffect(() => {
    pressed.current = (localPoint) => {
      if (!canCapture) return;
      const request = ++pressRequest.current;
      const valid = session.capture();
      const revision = registry.getSnapshot();
      const entries = registry.getEntries();
      void Promise.all([
        measureWindow(surface.current),
        Promise.all(entries.map(async (anchor) => ({
          anchor,
          depth: anchor.depth,
          area: await measureWindow(anchor.measure()),
          unique: registry.isUnique(anchor.id),
        }))),
      ]).then(([viewport, measured]) => {
        if (!valid() || pressRequest.current !== request || revision !== registry.getSnapshot() ||
          surfaces.getSnapshot().active !== entry || !surfaces.getSnapshot().unique || !viewport) return;
        // Use the detector's local position with the root's measured window origin.
        // Android can report different inset offsets for gesture and measurement window coordinates.
        const point = { x: viewport.x + localPoint.x, y: viewport.y + localPoint.y };
        if (!contains(viewport, point)) return;
        const match = findTouchTarget(point, measured.flatMap((anchor) =>
          anchor.area ? [{ ...anchor, area: anchor.area }] : []));
        if (match === null) return;
        const descriptor = match ? anchorDescriptor(id, match.anchor.id) : surfaceDescriptor(id);
        if (descriptor.length > 512) return;
        showPanel({
          kind: "draft",
          anchor: toFeedbackAnchor(descriptor, point, match?.area ?? viewport, viewport),
        }, { x: localPoint.x + 12, y: localPoint.y + 12 }, match?.anchor);
      });
    };
    return () => { ++pressRequest.current; };
  }, [canCapture, session, snapshot.accessRevision, registry, surfaces, entry, id]);

  const hold = useMemo(() => Gesture.LongPress()
    .withTestId(id === ROOT_SURFACE ? "feedback-long-press" : `feedback-long-press:${id}`)
    .enabled(canCapture)
    .minDuration(500)
    .maxDistance(10)
    .numberOfPointers(1)
    .shouldCancelWhenOutside(true)
    .cancelsTouchesInView(true)
    .runOnJS(true)
    .onEnd(({ x, y }, recognized) => {
      if (recognized) pressed.current({ x, y });
    }), [canCapture, id]);

  return (
    <SurfaceDepth.Provider value={depth}>
      <GestureHandlerRootView style={[styles.root, style]}>
        <View
          ref={surface}
          collapsable={false}
          testID={id === ROOT_SURFACE ? "feedback-surface" : `feedback-surface:${id}`}
          onLayout={({ nativeEvent }) => {
            const { width, height } = nativeEvent.layout;
            setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
          }}
          style={styles.root}
        >
          <GestureDetector gesture={hold}>
            <View
              style={styles.root}
              collapsable={false}
              accessibilityElementsHidden={Boolean(panel)}
              importantForAccessibility={panel ? "no-hide-descendants" : "auto"}
            >
              <Surfaces.Provider value={{
                registry, pins: pins.anchored, accent, open: openAnchoredThread,
                draft: draftDescriptor?.anchorId && panelSelection?.kind === "draft"
                  ? { id: draftDescriptor.anchorId, point: panelSelection.anchor }
                  : undefined,
              }}>
                <AnchorDepth.Provider value={0}>{children}</AnchorDepth.Provider>
              </Surfaces.Provider>
            </View>
          </GestureDetector>
          {usable && size.width > 0 && size.height > 0 && (
            <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.overlay]}>
              {pins.viewport.map(({ thread, number }) => (
                <ThreadPin
                  key={thread.id} thread={thread} number={number} size={size} accent={accent}
                  onOpen={(point) => openThread(thread, point)}
                />
              ))}
              {draftDescriptor && draftDescriptor.anchorId === undefined && panelSelection?.kind === "draft" && (
                <DraftPin point={panelSelection.anchor} size={size} accent={accent} />
              )}
              {panel && (
                <Pressable
                  testID="feedback-dismiss-layer"
                  onPress={closePanel}
                  accessible={false}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <View style={[styles.toolbar, { left: toolbarPoint.x, top: toolbarPoint.y, ...toolbarSize }]}>
                {collapsed ? (
                  <DragHandle label="피드백 바 펼치기" position={toolbarPoint} move={setToolbarPosition}
                    onPress={() => setCollapsed(false)} />
                ) : (
                  <>
                    <DragHandle label="피드백 바 이동" position={toolbarPoint} move={setToolbarPosition} />
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: enabled }}
                      accessibilityLabel={enabled ? "피드백 끄기" : "피드백 켜기"}
                      onPress={() => {
                        if (enabled) closePanel();
                        provider.setEnabled(!enabled);
                      }}
                      style={[styles.toggle, enabled && { backgroundColor: accent }]}
                    >
                      <Text style={[styles.toggleText, enabled && styles.toggleOn]}>{enabled ? "ON" : "OFF"}</Text>
                    </Pressable>
                    <IconButton
                      name="bell" label="알림 열기" color={accent}
                      badge={snapshot.notifications.filter((notice) => !notice.read).length}
                      onPress={() => {
                        if (panelSelection?.kind === "notifications") {
                          closePanel();
                        } else {
                          provider.setEnabled(true);
                          showPanel({ kind: "notifications" }, {
                            x: toolbarPoint.x, y: toolbarPoint.y - panelSize.height - 8,
                          });
                        }
                      }}
                    />
                    <IconButton name="collapse" label="피드백 바 접기" onPress={() => setCollapsed(true)} />
                  </>
                )}
              </View>
              {panel && panelSelection && snapshot.access && panelSize.width > 0 && panelSize.height > 44 && (
                <FeedbackPanel
                  key={panelSelection.kind === "thread" ? `thread:${panelSelection.id}:${panelSelection.commentId ?? ""}` : panelSelection.kind}
                  selection={panelSelection} session={session} access={snapshot.access} accent={accent}
                  size={panelSize} position={panelPoint} users={snapshot.users} thread={targetThread}
                  notifications={snapshot.notifications} onPickImages={provider.onPickImages}
                  move={(point) => setOpenPanel((current) => current?.selection === panelSelection
                    ? { ...current, point: constrainPosition(point, bounds, panelSize) }
                    : current)}
                  close={closePanel}
                  onCreateThread={(thread) => openThread(thread, { x: panelPoint.x - 12, y: panelPoint.y - 12 })}
                  onOpenNotification={(notice) => {
                    if (!sameScreen(notice.screen, session.screen)) {
                      closePanel();
                      if (snapshot.access) provider.navigate(notice, snapshot.access.userId);
                      return;
                    }
                    const thread = snapshot.threads.find((item) => item.id === notice.threadId);
                    if (thread) openThread(thread, undefined, notice.commentId);
                    else showPanel({
                      kind: "thread", id: notice.threadId,
                      ...(notice.commentId === undefined ? {} : { commentId: notice.commentId }),
                    }, panelPoint);
                  }}
                />
              )}
            </View>
          )}
        </View>
      </GestureHandlerRootView>
    </SurfaceDepth.Provider>
  );
}

export function FeedbackAnchor({ id, style, children }: FeedbackAnchorProps) {
  const surface = useContext(Surfaces);
  if (!surface) return <View style={style}>{children}</View>;
  return <RegisteredAnchor id={id} style={style} surface={surface}>{children}</RegisteredAnchor>;
}

function RegisteredAnchor({
  id, style, children, surface,
}: FeedbackAnchorProps & { surface: NonNullable<React.ContextType<typeof Surfaces>> }) {
  const depth = useContext(AnchorDepth);
  const view = useRef<View>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const { registry, draft, accent } = surface;
  const entry = useMemo(() => ({ id, depth, measure: () => view.current }), [id, depth]);
  useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  useLayoutEffect(() => {
    if (!id.trim()) return;
    return registry.register(entry);
  }, [entry, id, registry]);
  const unique = registry.isUnique(id) && size.width > 0 && size.height > 0;

  return (
    <View
      ref={view}
      collapsable={false}
      style={style}
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      }}
    >
      <AnchorDepth.Provider value={depth + 1}>{children}</AnchorDepth.Provider>
      {unique && surface.pins.get(id)?.map(({ thread, number }) => (
        <ThreadPin key={thread.id} thread={thread} number={number} size={size} accent={accent}
          onOpen={(point) => surface.open(thread, entry, point)} />
      ))}
      {unique && draft?.id === id && <DraftPin point={draft.point} size={size} accent={accent} />}
    </View>
  );
}

function ThreadPin({ thread, number, size, accent, onOpen }: {
  thread: FeedbackThread;
  number: number;
  size: Size;
  accent: string;
  onOpen: (point: Point) => void;
}) {
  const point = { x: thread.anchor.x * size.width, y: thread.anchor.y * size.height };
  return (
    <Pressable
      accessibilityLabel={`댓글 ${number} 열기`}
      accessibilityHint={thread.resolved ? "해결된 댓글" : undefined}
      accessibilityRole="button"
      hitSlop={5}
      onPress={(event) => {
        event.stopPropagation();
        onOpen(point);
      }}
      style={[
        styles.pin,
        {
          backgroundColor: thread.resolved ? "#766869" : accent,
          left: Math.max(0, Math.min(size.width - PIN_SIZE, point.x - PIN_SIZE / 2)),
          top: Math.max(0, Math.min(size.height - PIN_SIZE, point.y - PIN_SIZE / 2)),
        },
      ]}
    >
      <Text style={styles.pinText} numberOfLines={1}>{number}</Text>
    </Pressable>
  );
}

function DraftPin({ point, size, accent }: { point: Point; size: Size; accent: string }) {
  return (
    <View
      pointerEvents="none"
      testID="feedback-draft-pin"
      style={[styles.pin, {
        backgroundColor: accent, opacity: 0.7,
        left: Math.max(0, Math.min(size.width - PIN_SIZE, point.x * size.width - PIN_SIZE / 2)),
        top: Math.max(0, Math.min(size.height - PIN_SIZE, point.y * size.height - PIN_SIZE / 2)),
      }]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { zIndex: 10 },
  toolbar: {
    position: "absolute", flexDirection: "row", justifyContent: "center", gap: 2, alignItems: "center",
    borderRadius: 11, paddingHorizontal: 4, backgroundColor: "#ffffff",
    borderColor: "#ead8d8", borderWidth: StyleSheet.hairlineWidth, shadowColor: "#281216",
    shadowOpacity: 0.17, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  toggle: {
    minWidth: 32, paddingHorizontal: 6, height: 25, alignItems: "center", justifyContent: "center",
    borderRadius: 12, backgroundColor: "#eee5e5",
  },
  toggleText: { color: "#554747", fontSize: 10, fontWeight: "700" },
  toggleOn: { color: "#ffffff" },
  pin: {
    position: "absolute", zIndex: 3, elevation: 2, width: PIN_SIZE, height: PIN_SIZE,
    borderTopLeftRadius: 13, borderTopRightRadius: 13, borderBottomRightRadius: 13, borderBottomLeftRadius: 4,
    borderColor: "#ffffff", borderWidth: 1.5, justifyContent: "center", alignItems: "center",
  },
  pinText: { fontSize: 10, color: "#ffffff", fontWeight: "700" },
});
