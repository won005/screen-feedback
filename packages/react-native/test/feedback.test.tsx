import { useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import { act, fireEvent, render, screen as view, waitFor } from "@testing-library/react-native";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { State } from "react-native-gesture-handler";
import { createMemoryFeedbackStore } from "@won005/feedback-core";
import type { FeedbackAdapter, FeedbackAttachment, FeedbackEvent, FeedbackThread } from "@won005/feedback-core";
import { FeedbackAnchor, FeedbackProvider, FeedbackSurface } from "../src/index.js";
import { anchorDescriptor, surfaceDescriptor } from "../src/placement.js";

const screen = { id: "tasks", resourceId: "today" };
const photo: FeedbackAttachment = {
  id: "photo-1", name: "메모.jpg", url: "https://example.com/photo.jpg", mimeType: "image/jpeg",
};
const user = { id: "mina", name: "미나" };
const otherUser = { id: "jun", name: "준" };
const baseAnchor = {
  id: surfaceDescriptor("$root"), x: 0.5, y: 0.5, width: 320, height: 600,
  viewportWidth: 320, viewportHeight: 600, scrollX: 0, scrollY: 0,
};
const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 600 } } };

function setup() {
  return createMemoryFeedbackStore({ users: [user, otherUser], allowedUserIds: [user.id, otherUser.id] });
}

function Wrapper({ adapter, resourceId = "today", onPickImages }: {
  adapter: FeedbackAdapter;
  resourceId?: string;
  onPickImages?: () => Promise<FeedbackAttachment[]>;
}) {
  return (
    <FeedbackProvider adapter={adapter} screen={{ id: "tasks", resourceId }} onPickImages={onPickImages}>
      <Text>할 일</Text>
    </FeedbackProvider>
  );
}

function layoutSurface(surfaceId?: string) {
  fireEvent(view.getByTestId(surfaceId ? `feedback-surface:${surfaceId}` : "feedback-surface"), "layout", layout);
}

async function longPress(cancelled = false, surfaceId?: string) {
  await act(async () => {
    // Gesture Handler updates its Jest registry with setImmediate after a render.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const handler = getByGestureTestId(surfaceId ? `feedback-long-press:${surfaceId}` : "feedback-long-press");
    fireGestureHandler(handler, [
      { state: State.BEGAN, x: 88, y: 120 },
      { state: State.ACTIVE, x: 88, y: 120 },
      { state: cancelled ? State.CANCELLED : State.END, x: 88, y: 120 },
    ]);
  });
}

beforeEach(() => {
  jest.spyOn(View.prototype, "measureInWindow").mockImplementation((callback) => callback(0, 0, 320, 600));
});

afterEach(() => jest.restoreAllMocks());

test("an access-approved user can post a resolved thread with only an image", async () => {
  const adapter = setup().forUser(user.id);
  render(<Wrapper adapter={adapter} onPickImages={async () => [photo]} />);
  layoutSurface();
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  await longPress();
  fireEvent.press(await view.findByLabelText("해결 표시"));
  fireEvent.press(view.getByLabelText("사진 선택"));
  await view.findByLabelText("메모.jpg 제거");
  fireEvent.press(view.getByLabelText("메모.jpg 제거"));
  expect(view.queryByLabelText("메모.jpg 제거")).toBeNull();
  fireEvent.press(view.getByLabelText("사진 선택"));
  await view.findByLabelText("메모.jpg 제거");
  fireEvent.press(view.getByLabelText("등록"));
  await waitFor(async () => {
    const [thread] = await adapter.listThreads(screen);
    expect(thread?.resolved).toBe(true);
    expect(thread?.comments[0]?.body).toBe("");
    expect(thread?.comments[0]?.attachments).toEqual([photo]);
  });
  fireEvent.press(await view.findByLabelText("메모.jpg 크게 보기"));
  expect(view.getByLabelText("사진 닫기")).toBeTruthy();
  fireEvent(view.UNSAFE_getByType(Modal), "requestClose");
  expect(view.queryByLabelText("사진 닫기")).toBeNull();
});

test("switching resources discards both old read results and an in-flight image selection", async () => {
  const adapter = setup().forUser(user.id);
  const originalList = adapter.listThreads;
  let completeList!: (threads: FeedbackThread[]) => void;
  let completePick!: (photos: FeedbackAttachment[]) => void;
  const pendingPick = new Promise<FeedbackAttachment[]>((resolve) => { completePick = resolve; });
  const tree = render(<Wrapper adapter={adapter} onPickImages={() => pendingPick} />);
  layoutSurface();
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  await longPress();
  fireEvent.changeText(await view.findByLabelText("새 댓글"), "이전 화면 초안");
  fireEvent.press(view.getByLabelText("사진 선택"));
  jest.spyOn(adapter, "listThreads").mockImplementationOnce(() =>
    new Promise<FeedbackThread[]>((resolve) => { completeList = resolve; }),
  );
  const input = {
    body: "이전 화면 댓글", clientMutationId: "seed",
    screen, anchor: baseAnchor,
  };
  let staleThread!: FeedbackThread;
  await act(async () => { staleThread = await adapter.createThread(input); });
  tree.rerender(<Wrapper adapter={adapter} resourceId="tomorrow" onPickImages={async () => []} />);
  await act(async () => {
    completeList([staleThread]);
    completePick([photo]);
  });
  await longPress();
  expect(await view.findByLabelText("새 댓글")).toHaveDisplayValue("");
  expect(view.queryByLabelText("메모.jpg 제거")).toBeNull();
  expect(view.queryByLabelText("댓글 1 열기")).toBeNull();
  expect(await originalList({ ...screen, resourceId: "tomorrow" })).toEqual([]);
});

test("reply deletion confirms and preserves its parent question", async () => {
  const adapter = setup().forUser(user.id);
  const thread = await adapter.createThread({
    screen, body: "질문", clientMutationId: "question",
    anchor: baseAnchor,
  });
  await adapter.addComment(thread.id, { body: "답글 내용", clientMutationId: "reply" });
  const confirm = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  render(<Wrapper adapter={adapter} />);
  layoutSurface();
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  fireEvent.press(await view.findByLabelText("댓글 1 열기"), { stopPropagation: jest.fn() });
  fireEvent.press(await view.findByLabelText("답글 삭제"));
  expect(confirm.mock.calls[0]?.[1]).toContain("답글");
  const buttons = confirm.mock.calls[0]?.[2];
  expect((await adapter.listThreads(screen))[0]?.comments).toHaveLength(2);
  await act(async () => { buttons?.find((button) => button.style === "destructive")?.onPress?.(); });
  await waitFor(async () => {
    expect((await adapter.listThreads(screen))[0]?.comments.map((comment) => comment.body)).toEqual(["질문"]);
  });
  fireEvent.press(view.getByLabelText("질문 및 답글 삭제"));
  const questionDialog = confirm.mock.calls[1];
  expect(questionDialog?.[1]).toContain("모든 답글");
  await act(async () => { questionDialog?.[2]?.find((button) => button.style === "destructive")?.onPress?.(); });
  expect(await adapter.listThreads(screen)).toEqual([]);
});

test("a cancelled gesture preserves host presses; dismissing a draft preserves saved pins", async () => {
  const adapter = setup().forUser(user.id);
  await adapter.createThread({ screen, anchor: baseAnchor, body: "등록됨", clientMutationId: "saved" });
  const normalPress = jest.fn();
  render(
    <FeedbackProvider adapter={adapter} screen={screen}>
      <Pressable onPress={normalPress} accessibilityLabel="호스트 버튼" />
    </FeedbackProvider>,
  );
  layoutSurface();
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  await longPress(true);
  expect(view.queryByLabelText("등록")).toBeNull();
  fireEvent.press(view.getByLabelText("호스트 버튼"));
  expect(normalPress).toHaveBeenCalledTimes(1);
  await longPress();
  expect(await view.findByTestId("feedback-draft-pin", { includeHiddenElements: true })).toBeTruthy();
  fireEvent.press(view.getByTestId("feedback-dismiss-layer", { includeHiddenElements: true }));
  expect(view.queryByTestId("feedback-draft-pin", { includeHiddenElements: true })).toBeNull();
  expect(view.getByLabelText("댓글 1 열기")).toBeTruthy();
  expect(await adapter.listThreads(screen)).toHaveLength(1);
});

test("pins are hidden when a stable anchor is duplicated or unmounted", async () => {
  const adapter = setup().forUser(user.id);
  await adapter.createThread({
    screen, anchor: { ...baseAnchor, id: anchorDescriptor("$root", "card") }, body: "앵커 댓글",
    clientMutationId: "saved-anchor",
  });
  function Cards({ count }: { count: number }) {
    return (
      <FeedbackProvider adapter={adapter} screen={screen}>
        {count > 0 && <FeedbackAnchor id="card"><Text>첫 번째 행</Text></FeedbackAnchor>}
        {count > 1 && <FeedbackAnchor id="card"><Text>두 번째 행</Text></FeedbackAnchor>}
      </FeedbackProvider>
    );
  }
  const tree = render(<Cards count={1} />);
  layoutSurface();
  fireEvent(view.getByText("첫 번째 행"), "layout", layout);
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  expect(await view.findByLabelText("댓글 1 열기")).toBeTruthy();
  tree.rerender(<Cards count={2} />);
  fireEvent(view.getByText("두 번째 행"), "layout", layout);
  expect(view.queryByLabelText("댓글 1 열기")).toBeNull();
  await longPress();
  expect(view.queryByLabelText("등록")).toBeNull();
  tree.rerender(<Cards count={0} />);
  expect(view.queryByLabelText("댓글 1 열기")).toBeNull();
});

test("a native modal captures a draft on its own surface", async () => {
  const adapter = setup().forUser(user.id);
  render(
    <FeedbackProvider adapter={adapter} screen={screen}>
      <Modal visible onRequestClose={() => {}}>
        <FeedbackSurface id="detail"><Text>상세</Text></FeedbackSurface>
      </Modal>
    </FeedbackProvider>,
  );
  layoutSurface("detail");
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  await longPress(false, "detail");
  fireEvent.changeText(await view.findByLabelText("새 댓글"), "모달 댓글");
  fireEvent.press(view.getByLabelText("등록"));
  await waitFor(async () => {
    const [thread] = await adapter.listThreads(screen);
    expect(thread?.anchor.id).toBe(surfaceDescriptor("detail"));
  });
});

test("a notification marks itself read and opens its destination on the host screen", async () => {
  const store = setup();
  const adapter = store.forUser(user.id);
  const destination = { ...screen, resourceId: "tomorrow" };
  await store.forUser(otherUser.id).createThread({
    screen: destination, anchor: baseAnchor, body: "@미나 다음 화면의 질문", mentions: [user.id],
    clientMutationId: "mention",
  });
  const navigate = jest.fn();
  function Routed() {
    const [current, setCurrent] = useState(screen);
    return (
      <FeedbackProvider
        adapter={adapter} screen={current}
        onNavigate={(notice) => {
          navigate(notice.screen);
          setCurrent(destination);
        }}
      >
        <Text>{current.resourceId}</Text>
      </FeedbackProvider>
    );
  }
  render(<Routed />);
  layoutSurface();
  fireEvent.press(await view.findByLabelText("알림 열기"));
  const noticeButton = await view.findByLabelText("준 알림 열기");
  await act(async () => { fireEvent.press(noticeButton); });
  expect(await view.findByText("@미나 다음 화면의 질문")).toBeTruthy();
  expect(navigate).toHaveBeenCalledWith(destination);
  const [notice] = await adapter.getNotifications();
  expect(notice?.read).toBe(true);
});

test("access revocation clears an open draft immediately and leaves no draft after regrant", async () => {
  const store = setup();
  const adapter = store.forUser(user.id);
  render(<Wrapper adapter={adapter} />);
  layoutSurface();
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  await longPress();
  expect(await view.findByLabelText("새 댓글")).toBeTruthy();
  await act(async () => { store.setAccess(user.id, false); });
  expect(view.queryByLabelText("새 댓글")).toBeNull();
  expect(view.queryByLabelText("피드백 끄기")).toBeNull();
  await act(async () => { store.setAccess(user.id, true); });
  expect(await view.findByLabelText("피드백 끄기")).toBeTruthy();
  expect(view.queryByTestId("feedback-draft-pin")).toBeNull();
});

test("a subscription exception reports the error and preserves the host screen with feedback closed", async () => {
  const adapter = setup().forUser(user.id);
  const error = new Error("Subscription unavailable");
  jest.spyOn(adapter, "subscribe").mockImplementation(() => { throw error; });
  const getAccess = jest.spyOn(adapter, "getAccess");
  const onError = jest.fn();
  render(
    <FeedbackProvider adapter={adapter} screen={screen} onError={onError}>
      <Text>할 일</Text>
    </FeedbackProvider>,
  );
  layoutSurface();
  await act(async () => {});
  expect(view.getByText("할 일")).toBeTruthy();
  expect(onError).toHaveBeenCalledWith(error);
  expect(getAccess).not.toHaveBeenCalled();
  expect(view.queryByLabelText("피드백 켜기")).toBeNull();
});

test("an invalid subscription cleanup leaves feedback closed even if the adapter emits later", async () => {
  const adapter = setup().forUser(user.id);
  let emit: ((event: FeedbackEvent) => void) | undefined;
  jest.spyOn(adapter, "subscribe").mockImplementation((listener) => {
    emit = listener;
    return undefined as unknown as () => void;
  });
  const onError = jest.fn();
  render(
    <FeedbackProvider adapter={adapter} screen={screen} onError={onError}>
      <Text>할 일</Text>
    </FeedbackProvider>,
  );
  layoutSurface();
  await act(async () => { emit?.({ type: "access-changed" }); });
  expect(view.getByText("할 일")).toBeTruthy();
  expect(onError).toHaveBeenCalledWith(expect.any(TypeError));
  expect(view.queryByLabelText("피드백 켜기")).toBeNull();
});

test("a selected mention is persisted; the author can edit and like the resulting comment", async () => {
  const store = setup();
  const adapter = store.forUser(user.id);
  render(<Wrapper adapter={adapter} />);
  layoutSurface();
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  await longPress();
  const composer = await view.findByLabelText("새 댓글");
  fireEvent.changeText(composer, "@준");
  fireEvent.press(await view.findByLabelText("준 멘션 선택"));
  expect(composer).toHaveDisplayValue("@준 ");
  await act(async () => { fireEvent.press(view.getByLabelText("등록")); });
  expect((await store.forUser(otherUser.id).getNotifications())[0]?.kind).toBe("mention");
  fireEvent.press(await view.findByLabelText("질문 수정"));
  fireEvent.changeText(view.getByLabelText("댓글 내용 수정"), "@준 새 요청");
  await act(async () => { fireEvent.press(view.getByLabelText("수정 저장")); });
  expect(await view.findByText("편집됨")).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText("좋아요")); });
  expect(await view.findByLabelText("좋아요 취소")).toBeTruthy();
  const [thread] = await adapter.listThreads(screen);
  expect(thread?.comments[0]).toMatchObject({ body: "@준 새 요청", mentions: [otherUser.id], likedBy: [user.id] });
});

test("a mention was removed and typing the same text does not send a mention notification", async () => {
  const store = setup();
  const adapter = store.forUser(user.id);
  render(<Wrapper adapter={adapter} />);
  layoutSurface();
  fireEvent.press(await view.findByLabelText("피드백 켜기"));
  await longPress();
  const composer = await view.findByLabelText("새 댓글");
  fireEvent.changeText(composer, "@준");
  fireEvent.press(await view.findByLabelText("준 멘션 선택"));
  fireEvent.changeText(composer, "준 ");
  fireEvent.changeText(composer, "@준 확인해 주세요");
  await act(async () => { fireEvent.press(view.getByLabelText("등록")); });
  const [thread] = await adapter.listThreads(screen);
  expect(thread?.comments[0]).toMatchObject({ body: "@준 확인해 주세요", mentions: [] });
  const notices = await store.forUser(otherUser.id).getNotifications();
  expect(notices.map(({ kind }) => kind)).toEqual(["comment"]);
});
