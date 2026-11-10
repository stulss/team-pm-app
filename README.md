# Team PM App

2~10명 규모의 고밀도 원격 팀이 프로젝트와 작업을 칸반 보드로 함께 관리하는 초저지연 실시간 협업 웹앱.

> **운영 상태:** 프로덕션 배포 및 M0~M44 전 마일스톤 검증 완료.  
> **라이브 서비스:** [https://team-pm-app-sand.vercel.app](https://team-pm-app-sand.vercel.app)  
> **포트폴리오 버전:** [team-pm-portfolio](https://github.com/stulss/team-pm-portfolio) (3대 인터랙티브 라이브 샌드박스 탑재)

주요 기능: 프로젝트·멤버·역할 관리 · 작업 CRUD · **칸반 보드(Double-Precision O(1) DND)** · **분산 실시간 동기화(~0.3s)** · 스레드 댓글 & @멘션 · **실시간 알림** · **대시보드 & 모아보기** · **Linear 감성 글로벌 단축키 HUD (`?`) & Ctrl+K 명령 팔레트** · 반응형 (모바일 375px E2E 검증)

## 스택

- **Frontend:** React 19(Vite) · Custom Design Tokens (Zero-runtime CSS, Light/Dark) · TanStack Query v5 · @dnd-kit
- **Backend:** Node.js + Express · Supabase(PostgreSQL 15, Transaction Pooler Port 6543) · Socket.io(+Redis Adapter) · JWT Dual Token Rotation
- **인프라:** Vercel (Front + Serverless Function) + Supabase + Redis Cloud

## 문서

| 문서 | 내용 |
|---|---|
| [docs/PROJECT_GOAL.md](docs/PROJECT_GOAL.md) | 목표, 대상, 핵심 기능, 완성 기준, PM 가치 제안 |
| [docs/DESIGN.md](docs/DESIGN.md) | 설계 — 권한, ERD, API, 소켓, 폴더 구조, 마일스톤(M0~M44) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 단계별 체크리스트, 의사결정 기록(ADR) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 배포 구성, 환경변수, 스모크 테스트, 운영 절차·백업 |
| [docs/SECURITY.md](docs/SECURITY.md) | 보안 점검 결과, Strict RLS, Token Rotation, 알려진 한계 |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Git·코드·API·테스트 규약, 완료 정의 |

## 진행 단계

1. **1차 중간점검** — 인증, 프로젝트·멤버, 작업 CRUD, **배포 확인** ✅
2. **2차 중간점검** — 칸반, 실시간, 댓글 (MVP 완성) ✅
3. **최종 프로덕션 검증** — 알림, 대시보드, 보안·테스트(538개 단위/359개 DB 스모크/89단계 E2E), 프로덕션 배포 완료 ✅
4. **2026 고도화 (6-Agent Council)** — Linear 스타일 단축키 HUD(`?`), Cosmic Onyx 다크 디자인 시스템, 상호 비판 기반 킬러 UX 반영 완료 ✅

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
