# 배포 계획

> 결정: **Vercel + Supabase.** 프론트와 Express를 하나의 Vercel 프로젝트로 배포한다(동일 오리진).
> 비용 원칙: **무료 플랜 범위 안에서만 사용한다**(Vercel Hobby, Supabase Free, Redis 무료 옵션). Redis는 Socket.io 다중 인스턴스 전달 용도로만 쓴다. 한도 초과가 확인되면 기능을 줄이거나 다시 결정한다.
> 일정: 첫 배포는 M1 직후(M1.5). M0는 로컬 개발만 한다.

## 1. 구성

```
브라우저 ──▶ Vercel 프로젝트 (하나의 도메인)
              ├─ /            정적 프론트 (React/Vite)
              ├─ /api/*       Express (Vercel Function, Node.js, Fluid Compute)
              ├─ /socket.io   Socket.io (WebSocket, Vercel Function)
              └─ Cron         /api/cron/* 주기 호출
                 │                    │
                 ▼                    ▼
          Supabase Postgres      Redis (Vercel Marketplace)
          (Transaction pooler)   Socket.io adapter
```

- 프론트와 API가 같은 오리진이므로 `SameSite=Strict` refresh 쿠키가 그대로 동작한다. 도메인을 따로 살 필요 없고 `*.vercel.app` 으로 충분하다.
- Supabase는 순수 Postgres로만 사용한다. 클라이언트는 Supabase에 직접 접속하지 않는다.
- Express 앱은 `http.Server` 를 export 해서 Vercel Function으로 실행한다(로컬 개발은 `listen`).

## 2. Vercel에서 달라지는 점 (설계 반영 사항)

| 항목 | 상시 서버라면 | Vercel에서는 |
|---|---|---|
| 스케줄러 | node-cron 이 프로세스 안에서 실행 | **Vercel Cron** 이 `/api/cron/*` 를 호출. `CRON_SECRET` 으로 요청 검증 |
| Socket.io 다중 인스턴스 | 단일 인스턴스면 불필요 | **Redis adapter 필수.** 인스턴스가 임의로 늘고, 연결은 한 인스턴스에 고정됨 |
| 소켓 전송 방식 | long-polling 폴백 가능 | 클라이언트에서 `transports: ['websocket']` 고정, `path` 를 함수 경로에 맞춤 |
| 연결 수명 | 계속 유지 | 함수 최대 실행시간(Hobby 300초)에 끊김 → 재연결 + 재조회가 정상 흐름 |
| 메모리 상태 | 룸·접속자 상태를 메모리에 둘 수 있음 | 두지 않는다. 필요하면 Redis |
| DB 연결 | 풀 유지 | **Transaction pooler(6543)**, prepared statement 비활성, 풀 크기 작게 |
| 요청 크기 | 제한 없음 | 요청/응답 본문 4.5MB (현재 기능엔 영향 없음, 파일 첨부는 범위 밖) |

> 기능은 REST 쓰기 → 소켓 푸시 구조라, REST를 처리한 인스턴스에서 `io.to(room).emit()` 하면 Redis adapter가 다른 인스턴스의 소켓에 전달한다.

## 3. 위험과 검증 (M1.5 스파이크)

Vercel에서 Socket.io + Redis adapter 조합이 이 앱 요구(1초 내 반영)를 만족하는지 **M1.5(첫 배포)에서 먼저 검증한다.**

- [ ] 배포본에서 두 브라우저가 WebSocket으로 연결되고 메시지가 서로 전달됨
- [ ] 서로 다른 인스턴스에 붙어도 전달됨(Redis adapter 경유)
- [ ] 연결이 끊긴 뒤 자동 재연결됨
- [ ] Vercel Cron이 현재 요금제에서 매시간 실행 가능한지 확인(요금제별 제한 확인)
- [ ] Redis 무료 한도로 2~10명 사용량이 충분한지 확인

스파이크가 실패하면 대안은 둘 중 하나다.
1. Express(소켓·cron)만 별도 상시 서버(Render 등)로 분리하고 프론트는 Vercel에서 `/api` rewrite로 연결
2. 실시간을 Supabase Realtime으로 교체(설계의 "Supabase는 DB 전용" 결정을 바꾸는 안)

## 4. 환경변수

Vercel 프로젝트 설정에 Production / Preview 를 나눠 등록한다. 비밀값은 저장소에 커밋하지 않는다.

| 이름 | 설명 | 비고 |
|---|---|---|
| `DATABASE_URL` | Supabase **Transaction pooler** 연결 문자열 | 비밀 |
| `JWT_ACCESS_SECRET` | Access JWT 서명 키 | 비밀 |
| `JWT_REFRESH_SECRET` | Refresh JWT 서명 키 | 비밀 |
| `REDIS_URL` | Socket.io adapter용 Redis | Marketplace 연동 시 자동 주입될 수 있음 |
| `CRON_SECRET` | Cron 엔드포인트 검증 | 비밀 |
| `CLIENT_ORIGIN` | CORS 화이트리스트(동일 오리진이면 최소 설정) | |
| `NODE_ENV` | `production` | |

클라이언트: `VITE_API_BASE_URL` (기본 `/api/v1`).

규칙: `service_role` 키와 `DATABASE_URL` 은 클라이언트 번들에 절대 넣지 않는다. dev와 prod는 서로 다른 Supabase 프로젝트와 시크릿을 쓴다. Preview 배포는 dev DB를 쓴다.

## 5. 단계별 배포

| 시점 | 배포 내용 | 확인 |
|---|---|---|
| M1.5 | 첫 배포: `/health`, 로그인 + **WebSocket 스파이크** | `/health` 가 DB 연결과 함께 응답, HTTPS, 쿠키 동작, 스파이크 체크리스트(§3) |
| M1 | 인증 | 로그인·새로고침 세션 유지(쿠키) |
| M3.5 | **1차 점검 배포** | `ROADMAP.md` 1차 확인 목록 |
| M5 | 실시간 | WebSocket 연결·재연결·다중 인스턴스 전달 |
| M6.5 | **2차 점검 배포** | `ROADMAP.md` 2차 확인 목록 |
| M7 | 알림 | Cron 실행 확인(실제 스케줄 도달) |
| M9.5 | **최종 배포** | 완성 기준 5개 항목, 보안 체크리스트 |

## 6. 마이그레이션

- `node-pg-migrate` 로 `server/db/migrations/` 에 순서대로 작성한다.
- 마이그레이션은 **배포 파이프라인과 분리해 수동으로** prod DB에 적용한다(Vercel 빌드에서 자동 실행하지 않음). 배포 전에 먼저 적용하고, 되돌릴 수 있는 `down` 을 함께 작성한다.
- 모든 테이블은 마이그레이션에서 `ENABLE ROW LEVEL SECURITY` 를 켠다(정책은 두지 않음).
- 마이그레이션은 Transaction pooler가 아니라 **direct 또는 Session pooler** 연결로 실행한다.

## 7. 스모크 테스트 (배포 직후)

1. `GET /health` 200, DB 연결 확인
2. 가입 → 로그인 → 새로고침 후 세션 유지
3. 프로젝트 생성 → 멤버 초대 → 작업 생성
4. 비멤버 계정으로 접근 시 403
5. (M5 이후) 브라우저 두 개에서 실시간 반영, 탭 새로고침 후 재연결
6. (M7 이후) Cron 로그 확인
7. Vercel 런타임 로그에 에러 없음

## 8. 롤백·운영

- 문제가 생기면 Vercel에서 이전 배포로 즉시 롤백(Instant Rollback)한다. DB 마이그레이션이 포함된 배포는 `down` 으로 되돌릴 수 있는지 먼저 확인한다.
- Supabase 백업과 PITR 여부는 요금제에서 확인한다(M9).
- 로그는 `pino` 구조화 로그를 Vercel 런타임 로그로 확인한다. 함수 로그는 요청별로 분리되지 않을 수 있으므로 요청 ID를 로그에 포함한다.
