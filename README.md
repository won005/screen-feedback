# Screen Feedback

웹과 React Native 앱에 화면 위치별 댓글을 붙이는 MIT 라이선스 SDK.

SitePing의 앵커 구현을 활용함. 서버 없는 메모리 모드와 선택형 자체 호스팅 서버를 제공하며, 인증은 사용하는 서비스와 연결함. 별도 로그인 화면·관리사이트는 포함하지 않음.

## 기능

- 웹 우클릭·앱 길게 누르기로 위치 댓글 작성
- ON/OFF, 자유 이동·접기·펼치기가 가능한 작은 툴바
- 상단 손잡이로 옮기는 댓글창과 바깥 클릭으로 닫기
- 댓글·답글·수정·삭제·좋아요·해결·재열기
- @사용자 선택, 알림함·읽음 표시·해당 화면 이동
- 사진 선택·제거·사진만 등록·전체 사진 크게 보기
- 빨간 기본 테마, 작은 선 아이콘, 성공 토스트 없는 답글·수정

## 실행

저장소 개발·검증에는 Node 24 이상과 npm을 사용함.

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run dev:web
```

웹 예제는 표시된 로컬 주소에서 실행됨. 화면 우클릭으로 댓글을 남기고, 계정을 전환해 같은 메모리 저장소의 댓글·알림을 확인할 수 있음. 사진 파일은 브라우저 메모리에만 두며 전송하지 않음.

```bash
npm run dev:mobile
```

Expo Go에서 QR을 열어 iOS/Android 예제를 실행함. 네이티브 의존성·앱 모달 사용법은 [앱 SDK 안내](packages/react-native/README.md)를 참조함.

예제는 같은 실행 프로세스의 메모리를 공유함. 새로고침·앱 재시작 후 작성 데이터는 유지되지 않으며 서로 다른 기기 사이에서 공유되지 않음.

## 패키지

| 패키지 | 역할 |
|---|---|
| `@won005/feedback-core` | 공통 계약, 메모리 예제 저장소, SitePing 상대 좌표 계산 |
| `@won005/feedback-http` | 웹·앱 공통 JWT HTTP·WebSocket·사진 어댑터 |
| `@won005/feedback-react` | React 웹 오버레이, SitePing의 semantic/shadow DOM 앵커 |
| `@won005/feedback-react-native` | 네이티브 위치 측정·길게 누르기·동일 댓글 UI |

npm 레지스트리 게시 전 버전임. 빌드 후 설치용 tarball을 만들 수 있음.

```bash
npm run pack:check
```

`artifacts/packages/`에 생성된 core와 사용할 렌더러의 `.tgz`를 같은 명령에서 설치함.

```bash
npm install ./won005-feedback-core-0.1.0.tgz ./won005-feedback-react-0.1.0.tgz
```

## 실제 서버 연결

서버 패키지 `@won005/feedback-server`를 Oracle ARM VM 등에 자체 호스팅할 수 있음. SQLite에 댓글·알림·사진을 보존하고 프로젝트별로 운영자가 허용한 계정만 공유함. 호스트의 로그인 JWT 공개키·issuer·audience를 연결해야 하며 공개 API 키만으로 사용자 신원을 신뢰하지 않음.

웹·앱에서 메모리 어댑터 대신 `createHttpFeedbackAdapter({ baseUrl, projectId, getToken })`를 전달함. UI는 같은 FeedbackAdapter 계약을 사용함. [HTTP 연동](packages/http/README.md), [Oracle 실행·백업·복구](deploy/oracle/README.md), [서버 계약](docs/oracle-server.md) 참조.

Oracle VM·DNS·인증 제공자 설정과 원격 건강 확인은 실제 배포 단계임. SDK·서버 소스와 로컬 검증을 완료해도 배포가 자동 완료되는 것은 아님.

## 웹 연동

```tsx
import { createMemoryFeedbackStore } from '@won005/feedback-core';
import { FeedbackOverlay } from '@won005/feedback-react';

// 데모용. 실제 서비스에서는 서버와 연결한 FeedbackAdapter를 전달함.
const store = createMemoryFeedbackStore({
  users: [{ id: 'reviewer', name: '테스터' }],
  allowedUserIds: ['reviewer'],
});
const adapter = store.forUser('reviewer');

export function Screen() {
  return <>
    <section data-feedback-anchor="summary">요약 화면</section>
    <FeedbackOverlay
      adapter={adapter}
      screen={{ id: 'overview', resourceId: 'opaque-resource', version: '1' }}
      onNavigate={notification => { /* 호스트 라우터로 notification.screen에 이동 */ }}
    />
  </>;
}
```

Provider/어댑터는 렌더링마다 새로 만들지 않고 안정된 참조로 유지함. 서버 렌더링 환경에서도 저장소에는 요청 간 실사용자 데이터를 보관하지 않음.

## 앱 연동

```tsx
import { FeedbackProvider, FeedbackAnchor } from '@won005/feedback-react-native';

<FeedbackProvider adapter={adapter} screen={{ id: 'overview' }}>
  <FeedbackAnchor id="summary"><Summary /></FeedbackAnchor>
</FeedbackProvider>
```

루트에 설치하면 기본 surface가 제공됨. 호스트의 네이티브 `Modal`에는 `FeedbackSurface`를 추가함. 사진 선택은 `onPickImages`, 화면 이동은 `onNavigate`로 연결함. [상세 계약](packages/react-native/README.md)

## 저장·권한·사진 연결

[FeedbackAdapter](packages/core/src/types.ts)는 댓글 저장/조회/수정/삭제, 상태·좋아요·사용자·알림·구독과 선택적 `uploadAttachment`를 정의함. SDK가 백엔드 종류를 결정하지 않으므로 기존 서비스 API로 구현할 수 있음.

- `getAccess`는 UI 사용 가능 여부를 전달함. 배포 서비스의 인증 경계는 실제 서버이며 매 요청·구독·사진 접근에서 사용자와 권한을 검증해야 함.
- 메모리 저장소의 `forUser`·`setAccess`는 로컬 예제 제어용임. 공개 API 인증으로 사용하지 않음.
- 사진은 호스트가 제공한 메타데이터·URL만 사용함. 웹 예제는 임시 blob URL, 앱 예제는 선택한 로컬 사진 URI를 사용함. 실제 업로드·보관·접근 URL 발급은 호스트가 담당함.
- SDK는 화면 텍스트·폼 값·URL·스크린샷·콘솔·네트워크 기록을 자동 수집하지 않음.
- `data-feedback-anchor`/앱 앵커 ID에는 개인정보나 화면 문구 대신 안정된 불투명 키를 지정함. 중복·제거된 키는 임의의 다른 요소로 연결하지 않음.
- 웹의 키 없는 위치는 같은 화면 폭에서 문서 좌표로 추적함. 폭이 달라지면 숨김. 레이아웃 변경에도 정확한 위치가 필요하면 앵커를 지정함.
- 댓글은 일반 텍스트로 표시함. 업로드 서버는 파일 크기·실제 형식·허용 유형을 별도로 검사해야 함.

## SitePing 재사용과 라이선스

기준은 [SitePing `fd64185`](https://github.com/NeosiaNexus/SitePing/tree/fd64185eda976c13c2c5e9a5fa20debf077b9004)임. `anchor.ts`의 상대 좌표·shadow host 탐색과 `resolver.ts`의 semantic 후보 조회 방식을 발췌·수정해 실제 캡처·재측정 경로에서 사용함. 원본의 자동 텍스트 문맥·fingerprint·CSS/XPath·fuzzy scan 수집 경로는 포함하지 않음. 네이티브 UI·공통 협업 계약은 이 저장소에서 구현함.

원저작권과 MIT 허가 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있으며 설치용 패키지에도 포함됨. 이 저장소의 코드는 [MIT](LICENSE)로 배포함.

## 검증 범위

코어 29개·HTTP 3개·서버 11개·웹 25개·앱 15개 테스트로 권한·삭제 범위·상태 충돌·멘션·구독 실패·사진 보기·화면 전환을 검사함. 서버는 실제 SQLite·HTTP·WebSocket과 별도 프로세스의 사진 정리 경합·백업 복구를 검증함. ARM64 비루트 컨테이너의 JWT·HTTP·재시작 보존, Compose 설정·Caddy 설정을 확인함. 실제 웹 브라우저에서 댓글 등록, 댓글창 드래그, 툴바 접기·펼치기, 사진 선택·전체 보기, 일반 모달·열린 Shadow DOM 모달 내부 입력을 확인함.

Expo 예제의 Android·iOS Hermes 번들 생성은 확인함. 실제 기기나 에뮬레이터에서의 길게 누르기·드래그·키보드·사진 권한·네이티브 모달 상호작용은 아직 검증하지 않음. 앱에 적용하기 전 대상 기기에서 확인해야 함.
