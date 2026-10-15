# Team PM App

2~10명 규모의 원격 팀이 프로젝트와 작업을 칸반 보드로 함께 관리하는 웹앱.

> 상태: M0(기반 세팅) 완료. 다음은 M1(인증), 첫 배포는 M1 직후.

## 스택

React(Vite) · Node.js + Express · Supabase(관리형 PostgreSQL, DB 전용) · Socket.io(+Redis adapter) · JWT

배포: Vercel(프론트 + Express 함수, 단일 프로젝트) + Supabase

## 문서

| 문서 | 내용 |
|---|---|
| [docs/PROJECT_GOAL.md](docs/PROJECT_GOAL.md) | 목표, 대상, 핵심 기능, 완성 기준 |
| [docs/DESIGN.md](docs/DESIGN.md) | 설계 — 권한, ERD, API, 소켓, 폴더 구조, 마일스톤 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 1차/2차/최종 단계 체크리스트, 의사결정 대기 목록 |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 배포 구성, 환경변수, 스모크 테스트 |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Git·코드·API·테스트 규약, 완료 정의 |

## 진행 단계

1. **1차 중간점검** — 인증, 프로젝트·멤버, 작업 CRUD, **배포 확인**
2. **2차 중간점검** — 칸반, 실시간, 댓글 (MVP 완성)
3. **최종본** — 알림, 대시보드, 보안·테스트, 프로덕션 배포

## 개발 환경

요구 사항: Node 22 이상, Supabase(dev) 프로젝트.

```
npm install
cp server/.env.example server/.env   # DATABASE_URL 등 입력
npm run dev                           # server(4000) + client(5173, /api 프록시)
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | client + server 동시 실행 |
| `npm test` | 서버 테스트(메모리 저장소) |
| `npm run smoke -w server` | 실제 서버+DB 스모크(서버를 먼저 띄울 것) |
| `npm run e2e` | 브라우저 e2e(서버·클라이언트를 먼저 띄울 것, Chrome 필요) |
| `npm run lint` / `npm run format:check` | 정적 검사 |
| `npm run build` | 클라이언트 빌드 |
| `npm run migrate -w server -- up` | 마이그레이션 적용(`DIRECT_URL` 사용) |

환경변수와 배포는 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 참고.
