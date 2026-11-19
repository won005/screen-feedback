import { createElement, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryFeedbackStore, type FeedbackAdapter, type FeedbackAttachment } from "@won005/feedback-core";
import { FeedbackOverlay } from "@won005/feedback-react";
import { ModalExamples } from "./ModalExamples.js";
import "./style.css";
import "./modal.css";

const users = [{ id: "minsu", name: "민수" }, { id: "jieun", name: "지은" }];
const store = createMemoryFeedbackStore({ users, allowedUserIds: users.map(user => user.id), moderatorIds: ["minsu"] });
const screen = { id: "board", resourceId: "demo", version: "1" };
const seed = await store.forUser("minsu").createThread({
  screen, anchor: { id: "data:task-schedule", x: .8, y: .2, width: 300, height: 160, viewportWidth: 1200, viewportHeight: 800, scrollX: 0, scrollY: 0 },
  body: "이 카드에서 마감일을 바로 바꿀 수 있으면 좋겠어요.", clientMutationId: "seed-question",
});
await store.forUser("jieun").addComment(seed.id, { body: "@민수 날짜 옆에 편집 버튼을 두면 어떨까요?", mentions: ["minsu"], clientMutationId: "seed-reply" });

// Local image bytes remain in this page's memory. Nothing is uploaded or persisted.
const urls = new Set<string>();
function localAdapter(userId: string): FeedbackAdapter {
  return {
    ...store.forUser(userId),
    async uploadAttachment(value: unknown): Promise<FeedbackAttachment> {
      if (!(value instanceof File)) throw new Error("Expected an image File.");
      const url = URL.createObjectURL(value); urls.add(url);
      return { id: crypto.randomUUID(), name: value.name, url, mimeType: value.type };
    },
  };
}
window.addEventListener("pagehide", () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); });

function App() {
  const [user, setUser] = useState("minsu");
  const [page, setPage] = useState("board");
  const [compact, setCompact] = useState(false);
  const [done, setDone] = useState(false);
  const adapter = useMemo(() => localAdapter(user), [user]);
  return <>
    <header className="app-header"><a className="brand" href="#">S<span>스튜디오</span></a><span className="workspace">제품 팀 작업 공간</span><label>테스트 계정 <select aria-label="테스트 계정" value={user} onChange={event => setUser(event.target.value)}>{users.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label></header>
    <div className="app-layout"><nav className="sidebar" aria-label="업무 메뉴"><button className={page === "board" ? "active" : ""} onClick={() => setPage("board")}>작업 보드</button><button className={page === "notes" ? "active" : ""} onClick={() => setPage("notes")}>팀 메모</button><p>피드백은 이 브라우저 안에서만 공유돼요. 새로고침하면 예제 데이터로 돌아와요.</p></nav>
    <main><div className="page-heading"><div><span className="eyebrow">팀 프로젝트</span><h1>{page === "board" ? "이번 주 작업" : "팀 메모"}</h1></div><button className="layout-button" onClick={() => setCompact(value => !value)}>{compact ? "넓게 보기" : "좁게 보기"}</button></div>
      {page === "board" ? <><section className="overview" data-feedback-anchor="weekly-summary"><span>이번 주 진행 상황</span><strong>{done ? "4" : "3"}<small> / 6 완료</small></strong><div className="progress"><i style={{ width: done ? "66%" : "50%" }} /></div><p>남은 작업을 확인하고 다음 일정을 준비하세요.</p></section>
      <div className={`cards ${compact ? "compact" : ""}`}><article className="task-card" data-feedback-anchor="task-schedule"><div className="card-top"><span className="label">진행 중</span><time>11월 23일</time></div><h2>프로젝트 일정 정리</h2><p>팀에서 정한 주요 일정과 담당자를 한눈에 볼 수 있게 정리해요.</p><footer><span className="avatar">민</span><span>민수</span><button onClick={() => setDone(value => !value)}>{done ? "완료 취소" : "완료하기"}</button></footer></article>
      <article className="task-card" data-feedback-anchor="task-research"><div className="card-top"><span className="label neutral">예정</span><time>11월 25일</time></div><h2>사용자 의견 살펴보기</h2><p>이번에 모인 의견을 바탕으로 다음에 개선할 부분을 정해요.</p><footer><span className="avatar">지</span><span>지은</span><button onClick={() => setPage("notes")}>메모 보기</button></footer></article></div>
      <section className="next-section" data-feedback-anchor="next-week"><h2>다음 주에 할 일</h2><p>새 작업이 정해지면 여기에 모아볼 수 있어요.</p></section></> : <section className="note-page" data-feedback-anchor="team-note"><h2>다음 회의에서 이야기할 내용</h2><p>일정 변경을 더 쉽게 확인하는 방법과 새로 들어온 피드백을 함께 살펴봐요.</p><button onClick={() => setPage("board")}>작업 보드로 돌아가기</button></section>}
    <ModalExamples /></main></div>
    <FeedbackOverlay adapter={adapter} screen={{ id: page, resourceId: "demo", version: "1" }} initialEnabled onNavigate={notification => setPage(notification.screen.id)} />
  </>;
}
createRoot(document.getElementById("root")!).render(createElement(App));
