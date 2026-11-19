# @won005/feedback-react-native

React Native 화면에 위치별 댓글을 붙이는 SDK. React 19.1, React Native 0.81, Expo 54 환경을 대상으로 함. 앱이 제공한 `FeedbackAdapter`로 사용자 접근, 저장, 알림을 처리함.

## 설치

```sh
npm install @won005/feedback-core @won005/feedback-react-native
npx expo install react-native-gesture-handler react-native-svg
```

Expo를 사용하지 않는 프로젝트는 React Native 0.81에 맞는 `react-native-gesture-handler` 2.28과 `react-native-svg` 15.12 이상을 설치하고 사용 중인 네이티브 설정에 맞춰 빌드함.

## 화면과 앵커 연결

```tsx
import { FeedbackAnchor, FeedbackProvider } from "@won005/feedback-react-native";

<FeedbackProvider
  adapter={adapter}
  screen={{ id: "items", resourceId: listId, version: "1" }}
  onNavigate={({ screen }) => openList(screen.resourceId)}
  onPickImages={pickImages}
  insets={safeAreaInsets}
>
  <ItemList renderItem={(item) => (
    <FeedbackAnchor id={item.id}>
      <ItemRow item={item} />
    </FeedbackAnchor>
  )} />
</FeedbackProvider>
```

- `FeedbackProvider`는 기본 표시 영역과 제스처 루트를 제공함. `screen.id`와 `resourceId`가 같은 댓글을 표시하고, 작성 시점의 버전은 `screen.version`에 보존함. 계정 전환 시 해당 계정의 어댑터 인스턴스를 전달함.
- `FeedbackAnchor`는 긴 목록이나 레이아웃이 바뀌는 화면에서 핀을 해당 요소에 붙임. ID는 같은 영역 안에서 유일한 데이터 ID를 사용하고 목록 인덱스는 피함. 요소가 사라지거나 ID가 겹치면 연결된 핀을 숨김. 연결이 모호한 지점에서 길게 누르면 초안을 열지 않음.
- 앵커 밖에서 작성한 핀은 현재 표시 영역의 너비·높이에 대한 비율로 저장함. 스크롤되는 콘텐츠에 함께 이동할 핀은 해당 콘텐츠를 `FeedbackAnchor`로 감쌈.
- `insets`로 화면 안전 영역을 전달하면 바와 댓글창 이동 범위에 반영함. `accentColor`로 기본 빨간색을 바꿀 수 있음.
- `onNavigate`에는 타 화면 알림의 `FeedbackNotification`이 전달됨. 콜백에서 화면을 연 뒤 해당 `screen`을 Provider에 전달하면 SDK가 댓글을 엶. 현재 화면의 댓글은 SDK가 직접 엶.

### 앱의 네이티브 모달

React Native `Modal`은 별도 네이티브 레이어에 표시됨. 모달 내용의 맨 위를 `FeedbackSurface`로 감싸면 해당 레이어 안에 바와 핀, 댓글창이 표시됨.

```tsx
import { Modal } from "react-native";
import { FeedbackSurface } from "@won005/feedback-react-native";

{showDetail && (
  <Modal visible onRequestClose={closeDetail}>
    <FeedbackSurface id="item-detail">
      <ItemDetail />
    </FeedbackSurface>
  </Modal>
)}
```

`FeedbackSurface`는 같은 Provider 아래에서 고유한 ID를 사용함. 가장 안쪽에 열린 영역이 바와 댓글창을 표시하므로 모달을 닫을 때 영역도 언마운트함. `FeedbackSurface`와 `FeedbackAnchor`에는 일반 View `style`을 전달할 수 있음.

## 사진과 권한

- `onPickImages(remaining)`에서 앱의 사진 선택 UI를 열고 선택한 이미지의 `FeedbackAttachment[]`를 반환함. 선택을 취소했으면 빈 배열이나 `undefined`를 반환함. `remaining`은 현재 더 붙일 수 있는 사진 수임.
- 이미지 메타데이터와 URI는 앱이 제공함. 로컬 예제는 파일·콘텐츠 URI를 메모리 어댑터에 기록함. 다른 사용자가 볼 사진은 앱에서 저장하고 접근 가능한 HTTPS URL을 반환함.
- 어댑터 실패와 사진 선택 콜백 실패는 `onError`로 전달됨. 실제 저장 서비스는 매 요청에 사용자 신원과 작업 권한을 확인해야 함.

## 사용

1. 바에서 **ON**을 켜고 댓글을 남길 위치를 길게 누름.
2. 텍스트 또는 사진을 넣고 등록함. **@**로 사용자를 선택할 수 있음.
3. 핀을 눌러 답글을 달거나 해결 상태를 바꿈. 질문을 삭제할 때는 답글도 함께 삭제되는지 확인함.
4. 점 손잡이를 드래그해 바나 댓글창을 이동함. 바깥을 누르면 댓글창과 임시 핀이 닫힘.
