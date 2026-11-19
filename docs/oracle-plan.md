# Oracle 서버 연결 구현 계획

**Goal:** Oracle ARM 서버에서 운영할 피드백 API·사진·실시간 연결과 공통 HTTP 어댑터 제공.

**Architecture:** 기존 core 상태 규칙을 신뢰된 스냅샷으로 복원해 SQLite 트랜잭션 안에서 실행함. JWT 신원과 SQLite 멤버십은 서버가 검증함. 플랫폼 UI는 별도 HTTP 어댑터만 연결함.

**Tech Stack:** Node 24, node:sqlite, TypeScript, jose, ws, file-type, Docker Compose, Caddy.

**Spec:** [oracle-server.md](oracle-server.md)

## 제약과 검토 중점

main과 기존 SDK PR을 보존하고 feat/oracle-backend에서 작업함. 외부 계정 비밀·서버 주소·개인키는 저장소나 로그에 넣지 않음. 기존 테스트를 유지함. 단일 프로세스·단일 인스턴스로 제한함. 관리사이트·npm 게시·유료 VM 자동 대체는 구현하지 않음.

JWT·프로젝트 경계, 만료·권한 회수, 사진 메타데이터 위조, 저장 실패 후 성공 이벤트, 재시작·재시도·사진 삭제를 우선 검증함.

1. [x] core 스냅샷: `createStatefulFeedbackStore(options,state?)`와 `exportState()` 추가. 메모리 SDK API 유지. 재시작·사용자 입력 복사·삭제 tombstone 회귀 RED→GREEN.
2. [x] 서버: `packages/server/src/{store,auth,photos,server,cli,index}.ts`. SQLite·JWT·사진·WebSocket·명시 RPC 구현. 신원·영속성·격리·실패·사진·실시간의 실제 HTTP/WS 통합 검사 RED→GREEN.
3. [x] 어댑터: `packages/http/src/{index,adapter}.ts`와 테스트. FeedbackAdapter 완전 구현, 웹·앱 사진 입력, 토큰 회전·재연결·오류 전달 확인.
4. [x] 배포 구성: `deploy/oracle/{Dockerfile,compose.yaml,Caddyfile,.env.example}`와 운영 안내. 타입·빌드·기존 회귀·서버/어댑터 검사·패키징·ARM 이미지 확인.
5. [x] 독립 리뷰 및 회귀 수정. 전체 83개 검사, 4개 SDK tarball, ARM64 비루트 컨테이너의 JWT·HTTP·재시작 보존, Caddy·Compose 구문 검사 통과.
6. [ ] 브랜치 게시와 기존 SDK 위에 쌓는 Draft PR.
7. [ ] Oracle 콘솔에서 무료 용량 확인 후 VM 생성·배포·원격 검증. 로그인/DNS/인증 설정을 확보하지 못하면 배포 미완료로 구분함.
