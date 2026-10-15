# Team PM App

원격 팀용 프로젝트 관리 웹앱. 현재 **설계 완료, 구현 전** 단계.

## 먼저 읽을 문서

- `docs/DESIGN.md` — 설계의 기준(권한 매트릭스, ERD, API, 소켓, 폴더 구조, 마일스톤)
- `docs/ROADMAP.md` — 현재 단계와 체크리스트, 미정 결정 사항
- `docs/CONVENTIONS.md` — 규약과 마일스톤 완료 정의
- `docs/DEPLOYMENT.md` — 배포 구성과 환경변수

## 작업 원칙

- 마일스톤(M0~M9.5) 순서를 따르고, 1차/2차/최종 점검 전에는 반드시 **배포해서 확인**한다.
- 설계와 다르게 구현해야 하면 코드를 바꾸기 전에 `docs/DESIGN.md` 를 먼저 고친다.
- Supabase는 순수 Postgres로만 쓴다(Auth/Realtime/PostgREST 사용 안 함). `DATABASE_URL` 과 `service_role` 키는 클라이언트에 노출하지 않는다.
- 새 테이블은 같은 마이그레이션에서 RLS를 켠다.
- 배포는 Vercel 함수(상시 프로세스 아님)다. 메모리에 룸·캐시·스케줄러 상태를 두지 말고, 스케줄은 Vercel Cron, 소켓은 Redis adapter를 쓴다. DB는 Transaction pooler(prepared statement 비활성).
- 마일스톤을 끝내면 `docs/ROADMAP.md` 체크리스트를 갱신한다.
- 문서는 한국어로 작성한다.
