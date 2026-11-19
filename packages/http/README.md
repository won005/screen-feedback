# 웹·앱 HTTP 어댑터

메모리 어댑터 대신 서버에 연결하는 선택 패키지임. React와 React Native 모두 동일한 FeedbackAdapter를 사용함.

```tsx
import { createHttpFeedbackAdapter } from '@won005/feedback-http';

const adapter = createHttpFeedbackAdapter({
  baseUrl: 'https://feedback.example.com',
  projectId: 'product',
  getToken: () => hostAuth.getAccessToken(),
  onError: reportConnectionError,
});
```

사용 중인 웹 `FeedbackOverlay` 또는 앱 `FeedbackProvider`에 이 어댑터를 전달함. 호스트 인증의 JWT를 매 요청·재연결마다 받으며, 토큰은 서버가 검증함. 같은 계정의 토큰 갱신은 getToken에서 처리하고, 계정이 바뀌면 새 어댑터를 만들어 기존 구독을 해제함. 비밀키·고정 API 키를 웹·앱 번들에 넣지 않음.

HTTP는 localhost 개발 환경에서만 허용함. 일반 연결은 HTTPS와 WSS를 사용함. 기본 fetch·WebSocket 대신 호스트 구현을 주입할 수 있음. 쓰기를 자동 재시도하지 않음. 댓글 생성·답글은 같은 clientMutationId와 같은 내용을 유지하면 서버에서 중복을 방지함.

## 사진

웹은 File/Blob을 uploadAttachment에 전달함. 앱은 호스트가 로컬 사진을 읽어 바이트로 전달함. 어댑터가 파일 경로를 임의로 읽지 않음.

```tsx
const attachment = await adapter.uploadAttachment!({
  bytes: await readSelectedImageBytes(asset.uri),
  name: asset.fileName ?? 'photo.jpg',
  mimeType: asset.mimeType ?? 'image/jpeg',
});
```

앱의 onPickImages 콜백은 위와 같이 업로드한 FeedbackAttachment 목록을 반환하면 됨. 최대 5MB이며 서버에서 실제 파일 형식을 검사함. 서명된 사진 URL은 5분 후 만료함. 어댑터는 구독 중 2분마다 재조회 이벤트를 보내 표시 URL을 갱신함. 만료·권한 회수 후 사진은 서버에서 접근 거부함.

WebSocket은 인증 후 변경 신호만 전달함. 준비·재연결 시 현재 데이터를 다시 읽고, 마지막 구독을 해제하면 연결·재시도·URL 갱신 타이머를 모두 정리함.
