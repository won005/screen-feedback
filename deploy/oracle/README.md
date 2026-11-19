# Oracle Always Free 배포

Ubuntu ARM64 VM에서 서버 1개와 Caddy HTTPS 프록시를 실행함. 계정의 홈 리전에서 Always Free 대상임을 확인하고 A1 2 OCPU·RAM 12GB 이내로 생성함. 무료 한도는 계정·정책에 따라 달라질 수 있으므로 콘솔의 한도와 비용 표시가 기준임. 자원 부족이면 중단하며 유료 VM으로 자동 대체하지 않음.

## 먼저 필요한 값

- Oracle VM과 SSH 연결: Ubuntu ARM64, 영구 디스크, 운영자 공개키. SSH 22는 운영자 IP로 제한함. 앱 공개 포트는 80/443만 허용하며 8080을 인터넷에 열지 않음.
- 도메인: VM의 공인 IP로 DNS A 레코드를 연결함. 연결하지 않은 AAAA 레코드는 만들지 않음.
- 호스트 JWT: 실제 로그인 서비스의 issuer·audience·HTTPS JWKS URL. RS256/ES256의 sub·iat·exp를 포함한 1시간 이내 토큰을 사용함. SDK에 비밀키를 넣지 않음. 기존 로그인 방식이 이 계약과 다르면 호스트에서 피드백용 토큰 발급 경로를 연결해야 함.
- 운영자가 허용할 계정의 JWT sub와 표시 이름. 이름·이메일을 임의로 JWT sub 대신 사용하지 않음.

## 실행

Docker Engine과 Compose 플러그인을 공식 배포판에서 설치한 후 이 저장소의 검증된 커밋을 체크아웃함. .env는 서버에서만 작성하고 권한을 600으로 제한함.

```sh
cd deploy/oracle
cp .env.example .env
chmod 600 .env
# .env의 도메인·웹 origin·JWT 설정을 채움.
# PHOTO_TICKET_KEY는 서버에서 openssl rand -base64 32로 생성한 값 사용.
docker compose build server
docker compose run --rm server project product
docker compose run --rm server grant product '<jwt-sub>' '테스터 이름'
docker compose up -d
curl --fail https://feedback.example.com/healthz
```

표시된 도메인은 예제이므로 본인 도메인으로 교체함. 관리자가 다른 사람의 댓글을 삭제할 수 있어야 하면 grant 마지막 인자에 moderator를 추가함. revoke product '<jwt-sub>'로 허용을 취소함. 이 명령은 이름·계정 ID를 셸 이력에 남길 수 있으므로 공유 터미널에서 실제 개인정보를 입력하지 않음.

`feedback_data` 볼륨에 DB·사진을 보존함. 일반 `docker compose down`은 볼륨을 보존하지만 `down -v`는 데이터를 삭제하므로 사용하지 않음. Caddy 데이터 볼륨은 인증서와 계정 상태를 보존함. 인증 토큰·사진 티켓을 프록시 로그에 남기지 않도록 URI·Authorization·Cookie 필터를 적용함.

## 백업·복구·업데이트

```sh
docker compose exec server node /app/node_modules/@won005/feedback-server/dist/cli.js backup /data/backup.sqlite
docker compose cp server:/data/backup.sqlite ./backup.sqlite
```

backup 대상은 존재하지 않는 새 파일이어야 함. 백업은 댓글과 사진을 모두 포함하므로 암호화·접근 제한해 별도 위치에 보관함. 서버 디스크의 백업만으로 VM 회수·장애를 대비하지 않음. `backup.sqlite`는 저장소에 올리지 않음.

복구는 서비스를 중지한 상태에서 백업 DB를 feedback_data의 feedback.sqlite로 복사하고 소유자를 컨테이너 node 사용자(UID 1000)로 맞춘 뒤 시작함. 이전 DB 파일 세트(feedback.sqlite·-wal·-shm)는 삭제하지 말고 별도 위치에 보존함. 백업과 기존 WAL 파일을 혼합하지 않음. 복구 후 건강 상태·로그인 계정의 댓글·사진·다른 계정의 접근 거부를 확인함.

업데이트 전 백업하고 새 커밋에서 이미지를 다시 빌드함. `docker compose up -d --no-deps server` 후 건강 상태와 기존 댓글·사진을 확인함. 현재 schema version 1만 지원하며 더 높은 버전 DB는 시작을 거부함. 구버전 롤백이 DB와 호환되지 않으면 백업으로 복구함.

서버 생성·DNS·JWT 설정·원격 건강 확인까지 완료해야 배포 완료임. 로컬 테스트나 ARM 이미지 빌드 통과를 Oracle 배포 성공으로 취급하지 않음. Oracle 유휴 자원 회수를 피하려고 인위적인 부하를 만들지 않음.
