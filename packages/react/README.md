# React 화면 피드백 SDK

React 19.1 이상에서 `FeedbackOverlay`를 한 번 설치함. 저장·인증·사진 업로드·다른 화면 이동은 호스트가 연결함.

```tsx
<FeedbackOverlay
  adapter={adapter}
  screen={{ id: 'overview', resourceId: 'opaque-id', version: '1' }}
  accentColor="#d92d35"
  initialEnabled={false}
  onError={error => report(error)}
  onNavigate={notification => navigate(notification.screen)}
/>
```

`adapter`는 `@won005/feedback-core`의 `FeedbackAdapter`임. 예제 저장소는 서버 없이 동작하지만 다른 브라우저·기기와 데이터를 공유하지 않음. 실제 서버 연동에서는 서버가 인증·권한을 검증함.

## 위치와 조작

ON 상태에서 웹 화면을 우클릭하면 작성창과 임시 핀이 나타남. 수정키를 누른 우클릭과 키보드 문맥 메뉴는 기존 동작을 유지함. 작성창 바깥 클릭으로 창과 미등록 핀을 닫으며 등록 핀은 유지함.

툴바와 댓글창 손잡이는 드래그 또는 방향키로 이동함. 툴바를 작은 아이콘으로 접고 다시 펼칠 수 있음. 기존 화면 클릭·스크롤은 유지함.

```tsx
<section data-feedback-anchor="summary">...</section>
```

SitePing에서 가져온 semantic 앵커는 중첩된 열린 shadow root도 탐색함. 정확히 하나인 명시 키에만 핀을 연결함. 키 없는 위치는 같은 폭의 문서 좌표로 추적하고 폭이 달라지면 표시하지 않음. 텍스트·폼 값·URL·스크린샷은 수집하지 않음.

## 댓글과 사진

본인 댓글 수정, 좋아요, 어댑터가 허용한 삭제·해결·재열기를 지원함. 질문을 삭제하면 답글과 함께 삭제되며 개별 답글은 따로 삭제함. 새 작성창의 해결 선택은 등록 상태에 반영함.

`uploadAttachment(file)`를 제공하면 사진 선택 버튼이 나타남. 미리보기·제거·사진만 등록·전체 사진 보기와 Escape/닫기를 제공함. 임시 URL 해제와 보관 정책은 URL을 만든 호스트가 관리함. 업로드 성공과 UI 검증은 서버의 파일 형식·크기 검증을 대체하지 않음.

@선택·알림함·읽음 표시는 어댑터 사용자·알림·구독으로 동작함. 다른 화면 알림은 `onNavigate`를 호출하고, 같은 어댑터로 목적 화면이 열리면 해당 질문을 선택함. 답글 등록·댓글 수정에 성공 토스트를 표시하지 않음.

기존 멘션이 있는 댓글은 참여자 정보를 확인한 뒤 저장함. 조회에 성공했는데 대상이 더 이상 허용된 참여자가 아니면 해당 멘션의 수신자 ID만 제거하고 본문은 일반 텍스트로 유지함. 참여자 조회 실패는 다른 댓글 표시와 일반 답글 작성을 막지 않음.

코드와 원저작권 고지는 MIT 라이선스임. 포함된 SitePing 부분은 `THIRD_PARTY_NOTICES.md` 참조.
