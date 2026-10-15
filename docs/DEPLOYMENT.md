# 배포·운영

> 결정: **Vercel + Supabase.** 프론트와 Express를 하나의 Vercel 프로젝트로 배포한다(동일 오리진).
> 비용 원칙: **무료 플랜 범위 안에서만 사용한다**(Vercel Hobby, Supabase Free, Redis 무료 플랜). 한도 초과가 확인되면 기능을 줄이거나 다시 결정한다.
> 주소: https://team-pm-app-sand.vercel.app · 저장소: https://github.com/stulss/team-pm-app

## 1. 구성

```
브라우저 ──▶ Vercel 프로젝트 (하나의 도메인, 함수 리전 icn1)
              ├─ /            정적 프론트 (React/Vite)
              ├─ /api/*       Express (Vercel Function, Node.js, Fluid Compute)
              ├─ /api/socket.io  Socket.io (WebSocket, Vercel Function)
              └─ Cron         /api/cron/daily (하루 1회)
                 │                    │
                 ▼                    ▼
          Supabase Postgres      Redis (Vercel Marketplace, 무료)
          (Transaction pooler,    · Socket.io adapter
           TLS 서버 인증서 검증)   · 레이트리밋 카운트
```

- 함수 리전은 Supabase(서울, ap-northeast-2)와 맞춰 `icn1` 로 고정한다(`vercel.json` `regions`). 기본값(iad1)이면 쿼리마다 대륙 간 왕복이 생긴다.
- 프론트와 API가 같은 오리진이므로 `SameSite=Strict` refresh 쿠키가 그대로 동작한다. 도메인을 따로 살 필요 없고 `*.vercel.app` 으로 충분하다.
- Supabase는 순수 Postgres로만 사용한다. 클라이언트는 Supabase에 직접 접속하지 않는다.
- Express 앱은 `http.Server` 를 export 해서 Vercel Function으로 실행한다(로컬 개발은 `listen`).
- **자동 배포**: Vercel 프로젝트는 GitHub `stulss/team-pm-app` 과 연결돼 있고 Production 브랜치는 `main` 이다. `main` 에 푸시하면 Production 이 자동 배포되고, 다른 브랜치는 Preview 가 만들어진다.

## 2. Vercel(서버리스)에서 달라지는 점

| 항목 | 상시 서버라면 | 이 프로젝트에서는 |
|---|---|---|
| 스케줄러 | node-cron 이 프로세스 안에서 실행 | **Vercel Cron** 이 `/api/cron/daily` 를 호출. `CRON_SECRET` 으로 검증 |
| Socket.io 다중 인스턴스 | 단일 인스턴스면 불필요 | **Redis adapter 필수.** 인스턴스가 임의로 늘고, 연결은 한 인스턴스에 고정됨 |
| 소켓 전송 방식 | long-polling 폴백 가능 | `transports: ['websocket']` 고정, `path: /api/socket.io` |
| 연결 수명 | 계속 유지 | Hobby 는 약 300초에 끊김 → 재연결 + 재조회가 정상 흐름(검증됨). 서버가 끊은 연결은 클라이언트가 직접 재연결 |
| 메모리 상태 | 룸·접속자 상태를 메모리에 둘 수 있음 | 두지 않는다. 필요하면 Redis |
| DB 연결 | 풀 유지 | **Transaction pooler(6543)**, prepared statement 미사용, 풀 크기 3 |
| 레이트리밋 | 메모리 | 인스턴스마다 메모리가 달라 한도가 늘어나므로 **Redis 에 카운트 저장**(§5) |

기능은 REST 쓰기 → 소켓 푸시 구조라, REST를 처리한 인스턴스에서 `io.to(room).emit()` 하면 Redis adapter가 다른 인스턴스의 소켓에 전달한다. (배포본 검증: 서로 다른 인스턴스에 붙은 클라이언트 간 전달 20ms, 두 브라우저 간 카드 이동 반영 약 0.3초)

## 3. 환경변수

Vercel 프로젝트 설정(Production / Preview)에 등록한다. 비밀값은 저장소에 커밋하지 않는다. 로컬은 `server/.env`(`server/.env.example` 참고).

| 이름 | 설명 | 비고 |
|---|---|---|
| `DATABASE_URL` | Supabase **Transaction pooler** 연결 문자열 | 비밀. Vercel-Supabase 연동이 주입하는 `POSTGRES_URL` 을 fallback 으로 사용(복사 불필요) |
| `DIRECT_URL` | Supabase Session pooler(5432). 마이그레이션 전용 | 비밀. fallback: `POSTGRES_URL_NON_POOLING` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | JWT 서명 키(32자 이상) | 비밀. 환경별로 다른 값 |
| `REDIS_URL` | Socket.io adapter·레이트리밋용 Redis | Marketplace 연동이 자동 주입 |
| `CRON_SECRET` | Cron 엔드포인트 검증(16자 이상). 없으면 엔드포인트 비활성(503) | 비밀. Vercel Cron 이 `Authorization: Bearer` 로 보냄 |
| `APP_TIMEZONE` | "오늘/내일" 마감 판정 시간대 | 기본 `Asia/Seoul` |
| `ALLOW_REGISTRATION` | `false` 면 새 가입을 막음(첫 계정은 허용) | 기본 `true`. **팀 구성이 끝나면 `false` 권장** |
| `MAX_PROJECTS_PER_USER` / `MAX_MEMBERS_PER_PROJECT` / `MAX_TASKS_PER_PROJECT` | 공개 가입 시 무료 DB 용량을 지키는 사용량 상한(초과 시 409 `LIMIT_REACHED`) | 기본 20 / 50 / 1000. Admin 은 프로젝트 수 제한 없음 |
| `BREVO_API_KEY` / `MAIL_FROM` | 인증·재설정 메일 발송(Brevo 무료 하루 300통). **둘 다 있어야 이메일 인증이 켜진다** | 비밀. 없으면 인증 없이 가입 즉시 사용, 재설정 메일 없음 |
| `MAIL_FROM_NAME` | 보낸 사람 이름 | 기본 `Team PM` |
| `APP_URL` | 메일 링크의 기준 주소 | 예: `https://team-pm-app-sand.vercel.app`. 없으면 Vercel 운영 도메인 |
| `DB_SSL_VERIFY` | DB TLS 서버 인증서 검증 | 기본 `true`. 인증서 문제로 접속이 안 될 때만 비상용 `false` |
| `LOG_LEVEL` | 로그 수준 | 기본 `info` |
| `CLIENT_ORIGIN` | CORS 화이트리스트 | 동일 오리진이므로 보통 비워 둠 |
| `NODE_ENV` | `production` | Vercel 이 자동 설정(Preview 도 production). **레이트리밋은 `production` 일 때만 켜진다** |

클라이언트: `VITE_API_BASE_URL` (기본 `/api/v1`).

규칙: `service_role` 키와 `DATABASE_URL` 은 클라이언트 번들에 절대 넣지 않는다. 현재 Production·Preview·로컬이 **같은 Supabase DB** 를 쓴다(§8 한계 참고).

## 4. 마이그레이션

- `node-pg-migrate` 로 `server/db/migrations/` 에 순서대로 작성한다(001 ~ 006). 되돌릴 수 있는 `down` 을 함께 둔다.
- **자동 적용되지 않는다.** `main` 푸시가 코드를 배포하므로, **새 마이그레이션이 있는 변경은 코드를 푸시하기 전에 먼저 적용한다**(이전 코드가 새 스키마에서 깨지지 않는지 확인).
- 적용: `npm run migrate -w server -- up` (`DIRECT_URL`, Session pooler 사용). Transaction pooler 로는 실행하지 않는다.
- 모든 테이블은 같은 마이그레이션에서 `ENABLE ROW LEVEL SECURITY` 를 켠다(정책은 두지 않음 → Supabase 공개 API 직접 접근 차단).

## 5. 보안 설정 요약 (자세한 점검 결과는 `SECURITY.md`)

- **레이트리밋**: 로그인 IP+이메일 15분 10회, 가입 IP 1시간 20회, 인증·재설정 메일 요청 IP+이메일 1시간 10회, 일반 API IP 분당 600회. 운영에서는 Redis 저장소(`LazyRedisStore`)로 인스턴스 간 공유하고, Redis 장애 시에는 요청을 막지 않는다(fail-open). 개발·테스트에서는 꺼져 있다.
- **DB TLS**: 내장한 Supabase Root 2021 CA 로 서버 인증서를 검증한다(`server/src/config/supabaseCa.js`, **2031-04-26 만료 — 그 전에 교체**).
- **Redis 구간 암호화 없음**: 무료 Redis 엔드포인트는 TLS 를 지원하지 않는다(`rediss://` 거부 확인). 소켓 이벤트·레이트리밋 카운트가 평문으로 오가므로 이벤트에는 작업 제목 등 필요한 정보만 싣고 비밀번호·토큰은 싣지 않는다. TLS 가능한 플랜으로 바꾸면 `REDIS_URL` 을 `rediss://` 로 교체한다.
- **로그**: pino JSON 한 줄/요청(메서드·경로·상태·소요시간·`x-request-id`·사용자 ID). Authorization·쿠키·비밀번호·토큰은 남기지 않는다(운영 로그 200건 검사 확인). 문의가 오면 응답 헤더 `x-request-id` 로 추적한다.
- 요청 본문 100KB 제한, helmet 헤더, 동일 오리진(CORS 닫힘), API 응답 `no-store`.

## 6. 스모크·E2E (배포 직후)

```
BASE_URL=https://team-pm-app-sand.vercel.app npm run smoke -w server   # 실제 DB API 스모크 (159 항목)
BASE_URL=https://team-pm-app-sand.vercel.app npm run e2e               # 브라우저 e2e (49 단계, 모바일 포함)
```

- 보호된 Preview 는 `VERCEL_BYPASS=<토큰>` 을 함께 준다. 둘 다 `@example.test` 계정·`smoke-`/`ui-` 데이터만 만들고 끝나면 삭제한다(실제 계정 불변).
- **운영 환경은 가입 한도(IP당 시간당 20회) 때문에 한 시간에 두 번(= 약 18건)까지** 돌릴 수 있다.
- Cron 은 스모크가 `CRON_SECRET` 으로 직접 호출해 임박·지연·중복 방지·정리를 검증한다. 실제 스케줄 실행은 매일 00:00 UTC(09:00 KST, Hobby 는 ±59분)이며 Vercel 대시보드 Cron 로그에서 확인한다.

## 7. 운영 절차

| 상황 | 방법 |
|---|---|
| 배포 롤백 | Vercel 대시보드에서 이전 배포로 Instant Rollback. 마이그레이션이 포함된 배포는 `down` 가능 여부를 먼저 확인 |
| 메일 설정(이메일 인증·재설정 켜기) | Brevo 에서 발신자(Sender) 이메일 인증 + API 키 발급 → Vercel 환경변수 `BREVO_API_KEY`, `MAIL_FROM`(인증한 발신 주소), `APP_URL` 등록 후 재배포. 켜기 전에 가입한 계정은 로그인 때 "인증 필요" 가 나오고 로그인 화면의 "인증 메일 다시 받기" 로 해결한다(006 마이그레이션 이전 계정은 이미 인증됨) |
| 메일이 안 옴 | Brevo 대시보드 Transactional 로그, 스팸함, `MAIL_FROM` 이 Brevo 에서 인증된 발신자인지, 하루 300통 한도 확인. 서버 로그의 `mail send failed`(상태 코드만 기록) |
| 신규 가입 막기 | Vercel 환경변수 `ALLOW_REGISTRATION=false` 후 재배포(기존 사용자 로그인·사용은 그대로) |
| 사용자 비활성화·역할 변경 | 앱의 `사용자 관리`(Admin). 비활성화하면 세션·소켓이 즉시 끊긴다 |
| JWT 키 교체 | 환경변수 교체 후 재배포 → 모든 세션이 만료되어 재로그인 필요 |
| DB 접속 실패(인증서) | 먼저 `SUPABASE_CA` 만료/교체 여부 확인. 급하면 `DB_SSL_VERIFY=false` 로 임시 복구 후 원인 해결 |
| 마감 알림이 안 옴 | Vercel Cron 로그, `CRON_SECRET` 일치 여부, `GET /api/cron/daily`(Bearer) 수동 호출 결과(`dueSoon`/`overdue` 수) 확인 |
| 문의 추적 | 응답 헤더 `x-request-id` 로 Vercel 런타임 로그 검색 |

### 백업

- Supabase 무료 플랜은 자동 백업·PITR 보장이 제한적이므로 **플랜별 백업 정책을 대시보드(Database → Backups)에서 확인**한다.
- 수동 백업(주기적으로 권장, `pg_dump` 설치 필요):
  ```
  pg_dump "<DIRECT_URL>" --no-owner --format=custom --file=team-pm-$(date +%F).dump
  ```
  복원은 `pg_restore --no-owner -d "<DIRECT_URL>" <파일>`. 덤프 파일에는 비밀번호 해시·개인정보가 있으므로 저장소에 두지 않는다.

## 8. 알려진 한계

- **환경 분리 없음**: Production·Preview·로컬이 하나의 Supabase 프로젝트·Redis 를 공유한다. 실제 팀이 쓰기 시작하면 개발용 Supabase 프로젝트를 분리하는 것이 안전하다(무료 플랜 프로젝트 수 제한 확인).
- **Hobby 제한**: Cron 하루 1회(±59분), 함수 실행 300초(소켓은 재연결로 흡수), 팀 사용·상업적 이용은 약관상 제한될 수 있으니 확인.
- **Redis 무료 한도**: 연결 수(여러 서버 인스턴스가 각각 연결)와 명령 수가 한도에 닿을 수 있다. 사용자 10명 규모에서는 문제가 없었지만 사용량을 가끔 확인한다.
- **공개 가입 운영**: 누구나 가입하고 자기 프로젝트를 만들 수 있다(첫 계정만 admin). 무료 DB 용량은 사용량 상한과 가입 레이트리밋으로 지킨다. 메일(Brevo)을 설정하면 이메일 인증과 비밀번호 재설정이 켜진다. 신고/차단 기능은 없으니, 악용이 보이면 `ALLOW_REGISTRATION=false` 로 가입을 닫거나 Admin 화면에서 해당 계정을 비활성화한다.
