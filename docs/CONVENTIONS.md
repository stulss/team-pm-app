# 개발 규약

구현 중 일관성을 위한 최소 규칙. API 규격과 데이터 모델은 [DESIGN.md](DESIGN.md)가 기준이다.

## 1. Git

- `main` 은 항상 배포 가능한 상태로 유지한다.
- 브랜치: `feat/<마일스톤>-<내용>` (예: `feat/m1-auth`), 수정은 `fix/…`, 문서는 `docs/…`.
- 커밋 메시지: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). 본문에 마일스톤 번호를 적으면 추적이 쉽다.
- 마일스톤 하나 = 가능하면 PR 하나.
- `.env`, 비밀값, `node_modules` 는 커밋하지 않는다.

## 2. 코드 스타일

- ESLint + Prettier 를 M0에서 설정하고 서버·클라이언트가 같은 규칙을 쓴다.
- 서버 구조: `routes → controller → service → repository`. SQL은 repository 에만 둔다.
- SQL은 **파라미터 바인딩만** 사용한다(문자열 연결 금지).
- 입력은 모두 zod 로 검증한다(`validate` 미들웨어).
- 파일/폴더는 `DESIGN.md` §3 구조를 따른다. 구조를 바꾸면 그 문서도 함께 고친다.

## 3. API

- Base `/api/v1`, JSON, ID는 UUID, 날짜는 ISO 8601(`due_date` 만 `YYYY-MM-DD`).
- 에러는 `{ error: { code, message, details? } }` 형식. 코드는 대문자 스네이크(`VALIDATION_ERROR`, `FORBIDDEN` …).
- 상태 코드: 200/201/204, 400, 401, 403, 404, 409, 429.
- 목록은 `?page&limit` 와 `{ data, meta }` 응답.
- 변경은 REST로만 하고 소켓은 푸시 전용이다(`DESIGN.md` §2.4).
- 모든 task/comment 접근 시 프로젝트 멤버십을 검증한다.

## 4. DB

- 변경은 항상 마이그레이션 파일로 한다(`NNN_설명.sql`). 이미 적용된 파일은 수정하지 않고 새 파일을 추가한다.
- 새 테이블은 같은 마이그레이션에서 RLS를 켠다.
- 자주 조회하는 조건에는 `DESIGN.md` §1.2 의 인덱스를 먼저 만든다.

## 5. 프론트엔드

- 서버 상태는 TanStack Query, 인증 상태는 AuthContext.
- Access 토큰은 메모리에만 두고 localStorage 에 저장하지 않는다.
- 댓글 등 사용자 입력은 텍스트로 렌더링한다(HTML 삽입 금지).
- 빈 상태·로딩·에러 UI를 화면마다 둔다.

## 6. 테스트

- 서버: vitest + supertest 테스트(메모리 저장소). 권한(403)·검증(400) 케이스를 기능마다 포함한다.
- SQL 동작(조인·FK·CASCADE·동시 요청)은 메모리 테스트로 검증되지 않는다. 실제 DB 를 쓰는 `npm run smoke -w server` 에 항목을 추가한다(로컬 또는 `BASE_URL`/`VERCEL_BYPASS` 로 배포본).
- 화면 흐름은 `npm run e2e`(설치된 Chrome 을 구동하는 playwright-core)에 단계를 추가한다. 스모크·e2e 가 만드는 데이터는 `@example.test` 이메일로 한정하고 종료 시 삭제한다.
- 클라이언트: 핵심 컴포넌트 위주. 최종 단계에서 핵심 흐름 E2E(Playwright, 선택).
- 테스트용 DB는 개발용 Supabase 프로젝트와 분리한다(로컬 postgres 또는 별도 스키마).

## 7. 완료 정의 (마일스톤 단위)

마일스톤을 끝냈다고 하려면 모두 만족해야 한다.

- [ ] `DESIGN.md` §4 의 완료 기준 충족
- [ ] 새 API에 권한·검증 테스트 존재, 전체 테스트 통과
- [ ] lint 통과
- [ ] 마이그레이션이 빈 DB에서 처음부터 적용됨
- [ ] 필요한 환경변수가 `.env.example` 과 `DEPLOYMENT.md` 에 반영됨
- [ ] `ROADMAP.md` 체크리스트 갱신

## 8. 운영 코드 규칙 (최종 단계에서 추가)

- **로그**: 서버는 `console` 대신 `utils/logger.js`(pino)를 쓴다. 토큰·쿠키·비밀번호는 로그에 남기지 않는다(redact 설정, 새 필드가 생기면 목록에 추가).
- **레이트리밋**: 개발·테스트에서는 꺼져 있고 `NODE_ENV=production` 에서만 켜진다. 한도 동작은 `tests/rateLimit.test.js` 와 운영 설정 Preview 에서 검증한다. 운영에 스모크·e2e 를 돌릴 때는 가입 한도(IP당 시간당 20건) 때문에 한 시간에 두 번까지만 돌린다.
- **DB TLS**: 연결 문자열에 `sslmode` 를 넣지 않는다(코드가 내장한 Supabase CA 로 설정). 비상시에만 `DB_SSL_VERIFY=false`.
- **마이그레이션과 배포 순서**: `main` 푸시는 곧 Production 배포다. 새 마이그레이션이 있으면 **코드보다 먼저** 적용한다.
- **실DB 로만 잡히는 문제가 많다**(동시성, CTE 가시성, 시계 차이, 정렬 동점 규칙). 새 SQL 은 메모리 테스트만으로 끝내지 말고 `smoke.mjs` 에 항목을 추가한다.
- **e2e 는 상태를 공유하는 하나의 시나리오**다. 단계를 추가할 때 뒤 단계가 쓰는 데이터를 바꾸지 않도록 대상을 명시하고, 다른 화면으로 이동했다면 다음 단계 시작에서 돌아온다.

