// 실제 브라우저(설치된 Chrome)로 핵심 화면 흐름을 점검한다. (M2 시점: 인증 + 프로젝트/멤버/사용자 관리)
//
//   서버(4000)와 클라이언트(5173)를 띄운 뒤:  npm run e2e
//   BASE_URL=https://<배포 URL> VERCEL_BYPASS=<토큰> npm run e2e   # 배포본 점검
//   HEADED=1 npm run e2e                                          # 브라우저 창을 보면서 실행
//
// 생성하는 데이터는 모두 ui-*@example.test / "ui-" 프로젝트이며 종료 시 삭제한다. (DIRECT_URL 필요: server/.env)
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('Chrome/Edge 를 찾을 수 없습니다. CHROME_PATH 를 지정하세요.');

const run = Date.now().toString(36);
const emailOf = (k) => `ui-${run}-${k}@example.test`;
const PASSWORD = 'S3cure!pass';
const T = 8000;

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
let failed = 0;
const step = async (label, fn) => {
  try {
    await fn();
    console.log(`PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${label}\n      ${String(err.message).split('\n')[0]}`);
  }
};

async function cleanup() {
  await db.query(
    `DELETE FROM projects WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'ui-%@example.test')`,
  );
  await db.query(`DELETE FROM users WHERE email LIKE 'ui-%@example.test'`);
}

const apiRegister = async (k) => {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.VERCEL_BYPASS && { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS }),
    },
    body: JSON.stringify({ email: emailOf(k), password: PASSWORD, name: `ui-${k}` }),
  });
  if (res.status !== 201) throw new Error(`register ${k}: ${res.status}`);
  // 이메일 인증이 켜진 환경(운영)에서는 DB 에서 인증 처리한다.
  await db.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [emailOf(k)]);
};

const apiHeaders = (token) => ({
  'content-type': 'application/json',
  ...(token && { authorization: `Bearer ${token}` }),
  ...(process.env.VERCEL_BYPASS && { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS }),
});
const apiCall = async (method, path, token, body) => {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: apiHeaders(token),
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const apiLogin = async (k) =>
  (await apiCall('POST', '/auth/login', null, { email: emailOf(k), password: PASSWORD })).body
    .accessToken;

await db.connect();
const browser = await chromium.launch({ executablePath: CHROME, headless: !process.env.HEADED });
// 개발 서버(Vite)는 처음 열 때 화면이 다시 그려지거나 새로고침돼, 방금 입력한 값이 사라질 수 있다.
// 모든 fill 을 "입력 → 값이 유지되는지 확인 → 아니면 잠시 뒤 다시 입력" 으로 바꿔 이 경쟁을 흡수한다.
let fillPatched = false;
const stabilizeFill = (page) => {
  if (fillPatched) return;
  fillPatched = true;
  const Locator = page.locator('body').constructor;
  const original = Locator.prototype.fill;
  Locator.prototype.fill = async function stableFill(value, options) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await original.call(this, value, options);
      await new Promise((r) => setTimeout(r, 150));
      if ((await this.inputValue().catch(() => value)) === value) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`입력값이 유지되지 않음: ${value}`);
  };
};
const newPage = async () => {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    extraHTTPHeaders: process.env.VERCEL_BYPASS
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS }
      : {},
  });
  const page = await ctx.newPage();
  stabilizeFill(page);
  page.setDefaultTimeout(T);
  page.on('pageerror', (e) => console.log('      [pageerror]', e.message));
  return page;
};
const login = async (page, k) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('이메일').fill(emailOf(k));
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByRole('link', { name: '프로젝트', exact: true }).waitFor();
};
const logout = async (page) => {
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.getByRole('heading', { name: '로그인' }).waitFor();
};

try {
  await cleanup();

  // 가입은 UI 로 한 명, 나머지는 API 로 빠르게
  const page = await newPage();
  await step('비로그인 상태로 / 접속하면 /login 으로 이동', async () => {
    await page.goto(`${BASE}/`);
    await page.waitForURL('**/login');
  });
  await step('UI 에서 회원가입하면 프로젝트 화면으로 이동', async () => {
    await page.getByRole('link', { name: '회원가입' }).click();
    await page.getByLabel('이름').fill('ui-manager');
    await page.getByLabel('이메일').fill(emailOf('manager'));
    await page.getByLabel(/비밀번호/).fill(PASSWORD);
    await page.getByRole('button', { name: '가입하기' }).click();
    // 이메일 인증이 켜져 있으면 "메일을 확인해 주세요" 가 먼저 나온다 → DB 에서 인증 처리 후 로그인
    const pending = page.getByRole('heading', { name: '이메일을 확인해 주세요' });
    const home = page.getByRole('heading', { name: '프로젝트', exact: true });
    await pending.or(home).waitFor();
    if (await pending.isVisible()) {
      await db.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [
        emailOf('manager'),
      ]);
      await login(page, 'manager');
    }
    await home.waitFor();
  });
  for (const k of ['admin', 'member', 'outsider']) await apiRegister(k);
  const roles = { admin: 'admin', manager: 'manager', member: 'member', outsider: 'member' };
  for (const [k, role] of Object.entries(roles)) {
    await db.query('UPDATE users SET role = $2 WHERE email = $1', [emailOf(k), role]);
  }
  await logout(page).catch(() => {});

  // ---- manager
  await step('로그인 시 틀린 비밀번호는 오류 메시지', async () => {
    await page.goto(`${BASE}/login`);
    await page.getByLabel('이메일').fill(emailOf('manager'));
    await page.getByLabel('비밀번호').fill('wrong-password');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.getByRole('alert').filter({ hasText: '올바르지 않습니다' }).waitFor();
  });
  await step('manager 로그인: 새 프로젝트 버튼 있음, 사용자 관리 링크 없음', async () => {
    await login(page, 'manager');
    await page.getByRole('button', { name: '새 프로젝트' }).waitFor();
    if ((await page.getByRole('link', { name: '사용자 관리' }).count()) !== 0) {
      throw new Error('manager 에게 사용자 관리 링크가 보임');
    }
  });

  let projectUrl;
  await step('프로젝트 생성: 멤버 검색해서 추가 → 상세 화면으로 이동', async () => {
    await page.getByRole('button', { name: '새 프로젝트' }).click();
    await page.getByLabel('이름', { exact: true }).fill(`ui-${run}-리뉴얼`);
    await page.getByPlaceholder('이름 또는 이메일로 검색').fill(`ui-${run}-member`);
    await page.getByRole('button', { name: /ui-member/ }).click();
    await page.getByRole('button', { name: '만들기' }).click();
    await page.getByRole('heading', { name: `ui-${run}-리뉴얼` }).waitFor();
    projectUrl = page.url();
    await page.getByRole('heading', { name: '멤버 (2)' }).waitFor();
    await page.getByText('소유자', { exact: true }).waitFor();
  });
  await step('새로고침해도 세션과 화면이 유지됨', async () => {
    await page.reload();
    await page.getByRole('heading', { name: `ui-${run}-리뉴얼` }).waitFor();
    if (page.url() !== projectUrl) throw new Error(`URL 변경: ${page.url()}`);
  });
  await step('프로젝트 수정(이름 변경) 반영', async () => {
    await page.getByRole('button', { name: '수정' }).click();
    await page.getByLabel('이름').fill(`ui-${run}-개편`);
    await page.getByRole('button', { name: '저장' }).click();
    await page.getByRole('heading', { name: `ui-${run}-개편` }).waitFor();
  });
  await step('멤버 추가/제거', async () => {
    await page.getByPlaceholder('이름 또는 이메일로 검색').fill(`ui-${run}-outsider`);
    await page.getByRole('button', { name: /ui-outsider/ }).click();
    await page.getByRole('heading', { name: '멤버 (3)' }).waitFor();
    await page
      .locator('li', { hasText: 'ui-outsider' })
      .getByRole('button', { name: '제거' })
      .click();
    await page.getByRole('heading', { name: '멤버 (2)' }).waitFor();
  });
  // waitForFunction 의 콜백은 브라우저에서 실행되므로 document 를 쓸 수 있다.
  const waitRows = (p, n) =>
    // eslint-disable-next-line no-undef
    p.waitForFunction((count) => document.querySelectorAll('tbody tr').length === count, n);
  const addTask = async (p, title, fill = async () => {}) => {
    await p.getByRole('button', { name: '작업 추가' }).click();
    const dialog = p.getByRole('dialog');
    await dialog.getByLabel('제목').fill(title);
    await fill(dialog);
    await dialog.getByRole('button', { name: '만들기' }).click();
    await dialog.waitFor({ state: 'detached' });
  };
  await step(
    '작업 추가: 담당자·우선순위·지난 마감일을 넣으면 목록에 나타나고 지연 표시',
    async () => {
      await page.getByRole('tab', { name: '목록' }).click();
      await addTask(page, '디자인 시안', async (dialog) => {
        await dialog.getByLabel('설명').fill('피그마 시안 반영');
        await dialog.getByLabel('담당자').selectOption({ label: 'ui-member' });
        await dialog.getByLabel('우선순위').selectOption('high');
        await dialog.getByLabel('마감일').fill('2020-01-01');
      });
      const row = page.getByRole('row', { name: /디자인 시안/ });
      await row.waitFor();
      await row.getByText('ui-member').waitFor();
      await row.getByText('(지연)').waitFor();
      await waitRows(page, 1);
    },
  );
  await step('필터(담당자·검색)와 초기화', async () => {
    await addTask(page, '배포 준비');
    await waitRows(page, 2);

    await page.getByLabel('담당자 필터').selectOption({ label: 'ui-member' });
    await waitRows(page, 1);
    await page.getByRole('row', { name: /디자인 시안/ }).waitFor();
    if ((await page.getByRole('row', { name: /배포 준비/ }).count()) !== 0) {
      throw new Error('담당자 필터가 적용되지 않음');
    }
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await waitRows(page, 2);

    await page.getByLabel('작업 검색').fill('배포');
    await waitRows(page, 1);
    await page.getByRole('row', { name: /배포 준비/ }).waitFor();
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await waitRows(page, 2);
  });
  await step('목록에서 상태를 바꾸면 저장되고 새로고침 후에도 유지', async () => {
    await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/v1\/tasks\//.test(r.url()) && r.request().method() === 'PATCH',
      ),
      page.getByLabel('배포 준비 상태').selectOption('done'),
    ]);
    await page.reload();
    const select = page.getByLabel('배포 준비 상태');
    await select.waitFor();
    if ((await select.inputValue()) !== 'done') throw new Error('상태가 유지되지 않음');
  });
  await step('작업 수정(제목 변경) 반영', async () => {
    await page.getByRole('button', { name: '디자인 시안', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('제목').fill('디자인 시안 v2');
    await dialog.getByRole('button', { name: '저장' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('row', { name: /디자인 시안 v2/ }).waitFor();
  });
  await step('작업 삭제(확인 대화상자)', async () => {
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '배포 준비', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
    await waitRows(page, 1);
    if ((await page.getByRole('row', { name: /배포 준비/ }).count()) !== 0) {
      throw new Error('삭제된 작업이 남아 있음');
    }
  });

  const card = (p, title) => p.locator('[data-task-id]').filter({ hasText: title });
  const column = (p, status) => p.locator(`section[data-status="${status}"]`);
  // 포인터로 source 를 target 위로 끌어다 놓는다. where: 'center' | 'top'
  const drag = async (p, source, target, where = 'center') => {
    // 화면 밖의 카드는 마우스 이벤트를 받지 못하므로 먼저 스크롤한다. 화면 가장자리 근처에서 끌면
    // 드래그 라이브러리가 창을 자동 스크롤해 놓을 위치가 어긋나므로, 끌 카드를 화면 가운데로 둔다.
    await source.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await target.scrollIntoViewIfNeeded();
    const s = await source.boundingBox();
    const t = await target.boundingBox();
    const sx = s.x + s.width / 2;
    const sy = s.y + s.height / 2;
    await p.mouse.move(sx, sy);
    await p.mouse.down();
    await p.mouse.move(sx + 12, sy + 12, { steps: 4 }); // 드래그 시작 거리(6px)를 넘긴다
    await p.mouse.move(t.x + t.width / 2, where === 'top' ? t.y + 4 : t.y + t.height / 2, {
      steps: 20,
    });
    await p.mouse.up();
  };
  const dbTask = async (title) =>
    (await db.query('SELECT status, position FROM tasks WHERE title = $1', [title])).rows[0];
  const pollUntil = async (fn, label) => {
    for (let i = 0; i < 40; i += 1) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`시간 초과: ${label}`);
  };

  await step('보드: 카드가 컬럼에 보이고, 다른 컬럼으로 드래그하면 저장됨', async () => {
    await page.getByRole('tab', { name: '보드' }).click();
    await column(page, 'todo').locator('[data-task-id]', { hasText: '디자인 시안 v2' }).waitFor();
    await drag(page, card(page, '디자인 시안 v2'), column(page, 'in_progress'));
    await column(page, 'in_progress')
      .locator('[data-task-id]', { hasText: '디자인 시안 v2' })
      .waitFor();
    await pollUntil(
      async () => (await dbTask('디자인 시안 v2')).status === 'in_progress',
      'DB 상태',
    );
    await page.reload(); // 보기 방식(보드)은 유지된다
    await column(page, 'in_progress')
      .locator('[data-task-id]', { hasText: '디자인 시안 v2' })
      .waitFor();
  });
  await step('보드: 같은 컬럼에서 순서를 바꾸면 새로고침 후에도 유지', async () => {
    await addTask(page, '첫째');
    await addTask(page, '둘째');
    const todoTitles = () => column(page, 'todo').locator('.task-card-title').allTextContents();
    await pollUntil(async () => (await todoTitles()).join() === '첫째,둘째', '초기 순서');
    await drag(page, card(page, '둘째'), card(page, '첫째'), 'top');
    await pollUntil(async () => (await todoTitles()).join() === '둘째,첫째', '드래그 후 순서');
    await pollUntil(
      async () => (await dbTask('둘째')).position < (await dbTask('첫째')).position,
      'DB position',
    );
    await page.reload();
    await pollUntil(async () => (await todoTitles()).join() === '둘째,첫째', '새로고침 후 순서');
  });
  await step('보드: 담당자 필터가 보드에도 적용됨', async () => {
    await page.getByLabel('담당자 필터').selectOption({ label: 'ui-member' });
    await card(page, '디자인 시안 v2').waitFor();
    await pollUntil(async () => (await card(page, '첫째').count()) === 0, '필터 적용');
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await card(page, '첫째').waitFor();
    await page.getByRole('tab', { name: '목록' }).click();
  });

  // DB 에서 같은 정의로 기대값을 직접 계산한다. (오늘 = 앱과 같은 Asia/Seoul 기준)
  const dbDashboard = async (projectId) => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE status = 'done'))::int AS done,
              (count(*) FILTER (WHERE status <> 'done'
                 AND due_date < (now() AT TIME ZONE 'Asia/Seoul')::date))::int AS overdue
       FROM tasks WHERE project_id = $1`,
      [projectId],
    );
    const r = rows[0];
    return { ...r, percent: r.total ? Math.round((r.done / r.total) * 1000) / 10 : 0 };
  };
  const stat = (p, id) => p.getByTestId(id).textContent();
  await step('대시보드: 프로젝트 화면의 집계 수치가 실제 데이터와 일치', async () => {
    const projectId = projectUrl.split('/').pop();
    await page.getByRole('tab', { name: '목록' }).click();
    await page.getByRole('region', { name: '프로젝트 요약' }).waitFor();
    const expected = await dbDashboard(projectId);
    await pollUntil(
      async () => Number(await stat(page, 'stat-total')) === expected.total,
      '전체 수',
    );
    if (Number(await stat(page, 'stat-done')) !== expected.done) throw new Error('완료 수 불일치');
    if (Number(await stat(page, 'stat-overdue')) !== expected.overdue) {
      throw new Error('지연 수 불일치');
    }
    if ((await stat(page, 'progress-percent')) !== `${expected.percent}%`) {
      throw new Error(
        `진행률 불일치: ${await stat(page, 'progress-percent')} vs ${expected.percent}%`,
      );
    }
    // 지연된 작업 목록에 지난 마감의 작업 제목이 보여야 한다 (e2e 에서 2020-01-01 마감으로 만든 작업)
    await page.getByRole('region', { name: '프로젝트 요약' }).getByText('디자인 시안 v2').waitFor();
  });
  await step('대시보드: 작업 상태를 바꾸면 요약이 새로고침 없이 갱신됨', async () => {
    const projectId = projectUrl.split('/').pop();
    const before = await dbDashboard(projectId);
    // 뒤 단계에서 쓰는 작업을 건드리지 않도록 대상을 명시한다. (진행 중이던 작업을 완료로)
    const select = page.getByLabel('디자인 시안 v2 상태');
    await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/v1\/tasks\//.test(r.url()) && r.request().method() === 'PATCH',
      ),
      select.selectOption('done'),
    ]);
    const after = await dbDashboard(projectId);
    if (after.done !== before.done + 1)
      throw new Error('DB 의 완료 수가 늘지 않음 (테스트 전제 오류)');
    await pollUntil(
      async () => Number(await stat(page, 'stat-done')) === after.done,
      '완료 수 갱신',
    );
    await pollUntil(
      async () => (await stat(page, 'progress-percent')) === `${after.percent}%`,
      '진행률 갱신',
    );
  });
  await step('대시보드: 전체 대시보드에 프로젝트별 진행률이 표시됨', async () => {
    const projectId = projectUrl.split('/').pop();
    const expected = await dbDashboard(projectId);
    await page.getByRole('link', { name: '대시보드' }).click();
    await page.getByRole('heading', { name: '대시보드' }).waitFor();
    const row = page.locator(`li[data-project-id="${projectId}"]`);
    await row.waitFor();
    await row.getByText(`${expected.percent}%`).waitFor();
    await row.getByText(`${expected.done}/${expected.total}`).waitFor();
    if (Number(await stat(page, 'stat-total')) < expected.total) {
      throw new Error('전체 작업 수가 프로젝트 합계보다 작음');
    }
  });

  await step('보관 → 진행 중 목록에서 사라지고 보관됨 탭에 나타남', async () => {
    // 앞 단계(전체 대시보드)에서 이동했으므로 프로젝트 화면으로 돌아온다.
    await page.goto(projectUrl);
    await page.getByRole('heading', { name: `ui-${run}-개편` }).waitFor();
    await page.getByRole('button', { name: '보관', exact: true }).click();
    await page.getByText('보관됨', { exact: true }).first().waitFor();
    if ((await page.getByRole('button', { name: '작업 추가' }).count()) !== 0) {
      throw new Error('보관된 프로젝트에 작업 추가 버튼이 보임');
    }
    await page.getByRole('button', { name: '디자인 시안 v2', exact: true }).click();
    await page.getByText('보관된 프로젝트의 작업은 수정할 수 없습니다.').waitFor();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '닫기', exact: true })
      .first()
      .click();
    await page.getByRole('link', { name: '← 프로젝트' }).click();
    await page.getByText('아직 프로젝트가 없습니다').waitFor();
    await page.getByRole('tab', { name: '보관됨' }).click();
    await page.getByRole('link', { name: `ui-${run}-개편` }).waitFor();
    await page.getByRole('link', { name: `ui-${run}-개편` }).click();
    await page.getByRole('button', { name: '보관 해제' }).click();
    await page.getByRole('button', { name: '보관', exact: true }).waitFor();
  });
  await step('로그아웃하면 /login 으로 이동하고 뒤로가기로 들어갈 수 없음', async () => {
    await logout(page);
    await page.goto(projectUrl);
    await page.waitForURL('**/login');
  });

  // ---- member
  const member = await newPage();
  await step('member: 프로젝트가 보이고, 남의 프로젝트에는 수정/멤버 추가 UI 가 없음', async () => {
    await login(member, 'member');
    await member.getByRole('link', { name: `ui-${run}-개편` }).waitFor();
    // 공개 가입 사용자도 자기 프로젝트를 만들 수 있다
    await member.getByRole('button', { name: '새 프로젝트' }).waitFor();
    await member.getByRole('link', { name: `ui-${run}-개편` }).click();
    await member.getByRole('heading', { name: /멤버 \(2\)/ }).waitFor();
    for (const name of ['수정', '보관', '삭제']) {
      if ((await member.getByRole('button', { name, exact: true }).count()) !== 0) {
        throw new Error(`member 에게 '${name}' 버튼이 보임`);
      }
    }
    if ((await member.getByPlaceholder('이름 또는 이메일로 검색').count()) !== 0) {
      throw new Error('member 에게 멤버 추가 UI 가 보임');
    }
    if ((await member.getByLabel('초대할 멤버 이메일').count()) !== 0) {
      throw new Error('소유자가 아닌 member 에게 이메일 초대 UI 가 보임');
    }
  });
  await step('member: 작업을 만들 수 있고, 남이 만든 작업에는 삭제 버튼이 없음', async () => {
    await member.getByRole('tab', { name: '목록' }).click();
    await addTask(member, 'member 작업');
    await member.getByRole('row', { name: /member 작업/ }).waitFor();

    await member.getByRole('button', { name: '디자인 시안 v2', exact: true }).click();
    const others = member.getByRole('dialog');
    await others.getByRole('button', { name: '저장' }).waitFor();
    if ((await others.getByRole('button', { name: '삭제' }).count()) !== 0) {
      throw new Error('member 에게 남이 만든 작업의 삭제 버튼이 보임');
    }
    await others.getByRole('button', { name: '취소' }).click();
    await others.waitFor({ state: 'detached' });

    await member.getByRole('button', { name: 'member 작업', exact: true }).click();
    await member.getByRole('dialog').getByRole('button', { name: '삭제' }).waitFor();
    await member.getByRole('dialog').getByRole('button', { name: '취소' }).click();
  });
  await step('member: 내 작업 페이지에 배정된 작업만 프로젝트 링크와 함께 보임', async () => {
    await member.getByRole('link', { name: '내 작업' }).click();
    await member.getByRole('heading', { name: '내 작업' }).waitFor();
    await member.getByRole('row', { name: /디자인 시안 v2/ }).waitFor();
    await member.getByRole('link', { name: `ui-${run}-개편` }).waitFor();
    if ((await member.getByRole('row', { name: /member 작업/ }).count()) !== 0) {
      throw new Error('배정되지 않은 작업이 내 작업에 보임');
    }
  });
  await step('member: /admin/users 는 접근 권한 없음 화면', async () => {
    await member.goto(`${BASE}/admin/users`);
    await member.getByRole('heading', { name: '접근 권한이 없습니다' }).waitFor();
  });

  // ---- outsider
  const outsider = await newPage();
  await step('비멤버: 프로젝트 URL 직접 접근 시 접근 권한 없음', async () => {
    await login(outsider, 'outsider');
    await outsider.goto(projectUrl);
    await outsider.getByRole('heading', { name: '접근 권한이 없습니다' }).waitFor();
  });
  await step('공개 가입 사용자: 직접 프로젝트를 만들고 이메일로 초대·삭제까지 한다', async () => {
    const selfName = `ui-${run}-셀프`;
    await outsider.goto(`${BASE}/`);
    await outsider.getByRole('button', { name: '새 프로젝트' }).click();
    await outsider.getByLabel('이름').fill(selfName);
    await outsider.getByRole('button', { name: '만들기' }).click();
    await outsider.getByRole('heading', { name: selfName }).waitFor();
    // 일반 사용자는 사용자 목록 검색이 없고 이메일로만 초대한다
    if ((await outsider.getByPlaceholder('이름 또는 이메일로 검색').count()) !== 0) {
      throw new Error('일반 사용자에게 사용자 목록 검색 UI 가 보임');
    }
    await outsider.getByLabel('초대할 멤버 이메일').fill('nobody-' + emailOf('x'));
    await outsider.getByRole('button', { name: '추가', exact: true }).click();
    await outsider.getByRole('alert').filter({ hasText: '찾을 수 없습니다' }).waitFor();
    await outsider.getByLabel('초대할 멤버 이메일').fill(emailOf('member'));
    await outsider.getByRole('button', { name: '추가', exact: true }).click();
    await outsider.getByRole('heading', { name: /멤버 \(2\)/ }).waitFor();

    // 초대받은 사람 화면에 프로젝트가 나타난다
    await member.goto(`${BASE}/`);
    await member.getByRole('link', { name: selfName }).waitFor();

    await outsider.once('dialog', (d) => d.accept());
    await outsider.getByRole('button', { name: '삭제', exact: true }).click();
    await outsider.getByRole('heading', { name: '프로젝트', exact: true }).waitFor();
    await member.reload();
    await member.getByRole('heading', { name: '프로젝트', exact: true }).waitFor();
    if ((await member.getByRole('link', { name: selfName }).count()) !== 0) {
      throw new Error('삭제된 프로젝트가 초대받은 사용자에게 남아 있음');
    }
  });

  // ---- 이메일 인증 / 비밀번호 재설정 화면 (링크는 DB 에 토큰을 넣어 흉내 낸다. 메일 발송은 단위 테스트가 검증)
  await apiRegister('mailuser');
  const mailer = await newPage();
  const putToken = async (kind, expiresInMs = 3600_000) => {
    const token = crypto.randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO email_tokens (user_id, kind, token_hash, expires_at)
       SELECT id, $2, $3, now() + ($4 || ' milliseconds')::interval FROM users WHERE email = $1`,
      [
        emailOf('mailuser'),
        kind,
        crypto.createHash('sha256').update(token).digest('hex'),
        String(expiresInMs),
      ],
    );
    return token;
  };
  // 개발 서버(Vite)는 처음 열 때 화면이 다시 그려지거나 새로고침돼 입력값이 사라질 수 있다.
  // 네트워크가 잠잠해진 뒤 입력하고, 값이 유지되는지 확인한다(안 되면 다시 입력).
  const settle = (p) => p.waitForLoadState('networkidle');
  const fillStable = async (locator, value) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await locator.fill(value);
      await locator.page().waitForTimeout(200);
      if ((await locator.inputValue()) === value) return;
      await settle(locator.page());
    }
    throw new Error(`입력값이 유지되지 않음: ${value}`);
  };
  await step('이메일 인증 링크: 인증 완료 화면, 같은 링크를 다시 열면 실패 화면', async () => {
    await db.query('UPDATE users SET email_verified_at = NULL WHERE email = $1', [
      emailOf('mailuser'),
    ]);
    const token = await putToken('verify');
    await mailer.goto(`${BASE}/verify-email?token=${token}`);
    await mailer.getByRole('heading', { name: '이메일 인증이 완료되었습니다' }).waitFor();
    await mailer.goto(`${BASE}/verify-email?token=${token}`);
    await mailer.getByRole('heading', { name: '인증하지 못했습니다' }).waitFor();
    await mailer.getByRole('alert').filter({ hasText: '만료되었거나 이미 사용' }).waitFor();
  });
  await step('비밀번호 찾기: 이메일을 넣으면 가입 여부와 관계없이 같은 안내', async () => {
    await mailer.goto(`${BASE}/login`);
    await settle(mailer);
    await mailer.getByRole('link', { name: '비밀번호를 잊으셨나요?' }).click();
    await mailer.getByRole('heading', { name: '비밀번호 찾기' }).waitFor();
    await settle(mailer);
    const input = mailer.getByLabel('이메일');
    const address = `nobody-${run}@example.test`;
    await fillStable(input, address);
    const requested = [];
    mailer.on('request', (r) => {
      if (r.url().includes('/auth/forgot-password')) requested.push(r.postData());
    });
    await mailer.getByRole('button', { name: '재설정 링크 보내기' }).click();
    try {
      await mailer.getByRole('heading', { name: '메일을 확인해 주세요' }).waitFor();
    } catch (e) {
      console.log('      [진단] 요청 수:', requested.length, '입력값:', await input.inputValue());
      console.log(
        '      [진단] 화면:',
        (await mailer.locator('body').innerText()).split('\n').join(' | '),
      );
      throw e;
    }
  });
  await step('비밀번호 재설정: 확인 불일치 오류 → 설정 완료 → 새 비밀번호로만 로그인', async () => {
    const token = await putToken('reset');
    await mailer.goto(`${BASE}/reset-password?token=${token}`);
    await settle(mailer);
    await fillStable(mailer.getByLabel('새 비밀번호 (8자 이상)'), 'N3w-secure-pass');
    await fillStable(mailer.getByLabel('새 비밀번호 확인'), 'different-pass-1');
    await mailer.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await mailer.getByRole('alert').filter({ hasText: '서로 다릅니다' }).waitFor();
    await fillStable(mailer.getByLabel('새 비밀번호 확인'), 'N3w-secure-pass');
    await mailer.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await mailer.getByRole('heading', { name: '비밀번호를 바꿨습니다' }).waitFor();

    await mailer.goto(`${BASE}/login`);
    await settle(mailer);
    await fillStable(mailer.getByLabel('이메일'), emailOf('mailuser'));
    await fillStable(mailer.getByLabel('비밀번호'), PASSWORD);
    await mailer.getByRole('button', { name: '로그인' }).click();
    await mailer.getByRole('alert').filter({ hasText: '올바르지 않습니다' }).waitFor();
    await fillStable(mailer.getByLabel('비밀번호'), 'N3w-secure-pass');
    await mailer.getByRole('button', { name: '로그인' }).click();
    await mailer.getByRole('link', { name: '프로젝트', exact: true }).waitFor();
  });
  await step('재설정 링크: 만료된 링크는 오류, 링크 없이 열면 안내 화면', async () => {
    const expired = await putToken('reset', -1000);
    const fresh = await newPage();
    await fresh.goto(`${BASE}/reset-password?token=${expired}`);
    await settle(fresh);
    await fillStable(fresh.getByLabel('새 비밀번호 (8자 이상)'), 'Another-pass-9');
    await fillStable(fresh.getByLabel('새 비밀번호 확인'), 'Another-pass-9');
    await fresh.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await fresh.getByRole('alert').filter({ hasText: '만료되었거나 이미 사용' }).waitFor();
    await fresh.goto(`${BASE}/reset-password`);
    await fresh.getByRole('heading', { name: '올바르지 않은 링크' }).waitFor();
  });

  // 이메일 인증이 켜진 환경(운영)에서만 의미가 있다: 인증 전에는 로그인이 막히고 재발송 버튼이 나온다.
  await step(
    '이메일 인증 켜짐: 인증 전 로그인은 안내와 재발송 버튼, 인증 후 로그인 성공',
    async () => {
      const res = await fetch(`${BASE}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(process.env.VERCEL_BYPASS && {
            'x-vercel-protection-bypass': process.env.VERCEL_BYPASS,
          }),
        },
        body: JSON.stringify({
          email: emailOf('unverified'),
          password: PASSWORD,
          name: 'ui-unverified',
        }),
      });
      const body = await res.json();
      if (!body.needsVerification) {
        console.log('      (이 환경은 메일이 꺼져 있어 인증을 요구하지 않음 — 건너뜀)');
        return;
      }
      if (body.accessToken) throw new Error('인증 전인데 세션이 발급됨');
      const p = await newPage();
      await p.goto(`${BASE}/login`);
      await p.getByLabel('이메일').fill(emailOf('unverified'));
      await p.getByLabel('비밀번호').fill(PASSWORD);
      await p.getByRole('button', { name: '로그인' }).click();
      await p.getByRole('alert').filter({ hasText: '이메일 인증이 필요합니다' }).waitFor();
      await p.getByRole('button', { name: '인증 메일 다시 받기' }).click();
      await p.getByRole('status').filter({ hasText: '다시 보냈습니다' }).waitFor();
      await db.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [
        emailOf('unverified'),
      ]);
      await p.getByRole('button', { name: '로그인' }).click();
      await p.getByRole('link', { name: '프로젝트', exact: true }).waitFor();
    },
  );

  // ---- 실시간: 서로 다른 두 브라우저(사용자)가 같은 프로젝트 보드를 본다
  const rtManager = await newPage();
  const rtMember = await newPage();
  let rtReady = false;
  await step('실시간 준비: 두 사용자가 같은 프로젝트 보드를 열어 둠', async () => {
    await login(rtManager, 'manager');
    await login(rtMember, 'member');
    for (const p of [rtManager, rtMember]) {
      await p.goto(projectUrl);
      await p.getByRole('tab', { name: '보드' }).click();
      await column(p, 'todo').locator('[data-task-id]', { hasText: '둘째' }).waitFor();
    }
    rtReady = true;
  });
  await step('실시간: 한쪽에서 카드를 옮기면 다른 사용자 화면에 새로고침 없이 반영', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    // 소켓이 방에 입장할 시간을 준다 (입장 전에 일어난 변경은 재조회로 보정되지만, 지연 측정을 위해)
    await new Promise((r) => setTimeout(r, 800));
    const start = { t: 0 };
    const seen = column(rtMember, 'review')
      .locator('[data-task-id]', { hasText: '둘째' })
      .waitFor({ timeout: 5000 });
    await drag(rtManager, card(rtManager, '둘째'), column(rtManager, 'review'));
    start.t = Date.now();
    await seen;
    const elapsed = Date.now() - start.t;
    console.log(`      (드롭 후 상대 화면 반영까지 ${elapsed}ms)`);
    if (elapsed > 2000) throw new Error(`반영이 너무 느림: ${elapsed}ms`);
    if (
      (await column(rtMember, 'todo').locator('[data-task-id]', { hasText: '둘째' }).count()) !== 0
    ) {
      throw new Error('이전 컬럼에 카드가 남아 있음');
    }
  });
  await step('실시간: 한쪽에서 만든 작업이 다른 화면에 나타나고, 삭제하면 사라짐', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    await addTask(rtManager, '실시간 작업');
    await column(rtMember, 'todo')
      .locator('[data-task-id]', { hasText: '실시간 작업' })
      .waitFor({ timeout: 5000 });
    rtManager.once('dialog', (d) => d.accept());
    await rtManager.locator('[data-task-id]').filter({ hasText: '실시간 작업' }).click();
    await rtManager.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
    await pollUntil(async () => (await card(rtMember, '실시간 작업').count()) === 0, '삭제 반영');
  });
  await step('댓글: 한쪽이 쓰면 열려 있는 다른 사용자 화면에 실시간으로 나타남', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    await card(rtManager, '둘째').click();
    await card(rtMember, '둘째').click();
    const mDlg = rtManager.getByRole('dialog');
    const uDlg = rtMember.getByRole('dialog');
    await mDlg.getByLabel('새 댓글').fill('시안 확인 부탁드립니다');
    await mDlg.getByRole('button', { name: '댓글 등록' }).click();
    await mDlg.getByText('시안 확인 부탁드립니다').waitFor();
    await uDlg.getByText('시안 확인 부탁드립니다').waitFor({ timeout: 5000 });

    await uDlg.getByLabel('새 댓글').fill('확인했어요 <b>굵게</b>');
    await uDlg.getByRole('button', { name: '댓글 등록' }).click();
    await mDlg.getByText('확인했어요 <b>굵게</b>').waitFor({ timeout: 5000 });
    // 사용자 입력은 HTML 로 해석되지 않고 문자 그대로 보여야 한다.
    if ((await mDlg.locator('.comment-body b').count()) !== 0) {
      throw new Error('댓글의 HTML 이 해석됨 (XSS 위험)');
    }
  });
  await step(
    '댓글: 수정은 작성자만, 수정/삭제 결과가 상대 화면에 반영(수정됨·삭제된 댓글)',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const mDlg = rtManager.getByRole('dialog');
      const uDlg = rtMember.getByRole('dialog');
      const byText = (dlg, text) => dlg.locator('li.comment', { hasText: text });

      // member 는 manager 의 댓글을 수정/삭제할 수 없고, 자기 댓글만 수정할 수 있다.
      const managersInMemberView = byText(uDlg, '시안 확인 부탁드립니다');
      for (const name of ['수정', '삭제']) {
        if ((await managersInMemberView.getByRole('button', { name, exact: true }).count()) !== 0) {
          throw new Error(`member 에게 남의 댓글의 '${name}' 버튼이 보임`);
        }
      }
      await byText(uDlg, '확인했어요').getByRole('button', { name: '수정', exact: true }).click();
      await uDlg.getByLabel('댓글 수정').fill('확인 완료했습니다');
      await uDlg.getByRole('button', { name: '저장', exact: true }).last().click();
      const edited = byText(mDlg, '확인 완료했습니다');
      await edited.waitFor({ timeout: 5000 });
      await edited.getByText('(수정됨)').waitFor();

      // manager 는 남의 댓글도 삭제할 수 있다 → 양쪽에서 "삭제된 댓글" 로 가려진다.
      rtManager.once('dialog', (d) => d.accept());
      await edited.getByRole('button', { name: '삭제', exact: true }).click();
      await mDlg.getByText('삭제된 댓글').waitFor();
      await uDlg.getByText('삭제된 댓글').waitFor({ timeout: 5000 });
      if ((await uDlg.getByText('확인 완료했습니다').count()) !== 0) {
        throw new Error('삭제된 댓글의 본문이 남아 있음');
      }
    },
  );
  await step('댓글: 카드의 댓글 수 배지가 두 화면에 반영됨 (삭제된 댓글 제외)', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    for (const p of [rtManager, rtMember]) {
      await p.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
      await p.getByRole('dialog').waitFor({ state: 'detached' });
    }
    await card(rtManager, '둘째').getByText('댓글 1').waitFor();
    await card(rtMember, '둘째').getByText('댓글 1').waitFor({ timeout: 5000 });
  });
  const unread = async (p) => {
    const badge = p.getByTestId('unread-count');
    return (await badge.count()) ? Number((await badge.textContent()).replace('+', '')) : 0;
  };
  await step('알림: 담당자로 지정되면 상대 화면의 벨 배지가 실시간으로 올라감', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    const before = await unread(rtMember);
    await addTask(rtManager, '알림 작업', async (dialog) => {
      await dialog.getByLabel('담당자').selectOption({ label: 'ui-member' });
    });
    await pollUntil(async () => (await unread(rtMember)) === before + 1, '배지 증가');
  });
  await step('알림: 목록에서 알림을 누르면 해당 작업이 열리고 읽음 처리됨', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    const before = await unread(rtMember);
    await rtMember.locator('.bell-button').click();
    const panel = rtMember.getByRole('dialog', { name: '알림 목록' });
    const item = panel.getByRole('button', {
      name: /ui-manager님이 '알림 작업' 작업을 배정했습니다/,
    });
    await item.waitFor();
    await item.click();
    await rtMember.getByRole('dialog', { name: '작업 수정' }).waitFor();
    if (!rtMember.url().includes('task=')) throw new Error('알림 링크에 task 파라미터가 없음');
    await pollUntil(async () => (await unread(rtMember)) === before - 1, '읽음 처리');
    await rtMember
      .getByRole('dialog', { name: '작업 수정' })
      .getByRole('button', { name: '취소' })
      .click();
    await rtMember.waitForURL((u) => !u.search.includes('task='));
  });
  await step('알림: 내 작업에 댓글이 달리면 알림이 오고, 모두 읽음으로 배지가 사라짐', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    const before = await unread(rtMember);
    await card(rtManager, '알림 작업').click();
    const dlg = rtManager.getByRole('dialog');
    await dlg.getByLabel('새 댓글').fill('이 작업 확인 부탁해요');
    await dlg.getByRole('button', { name: '댓글 등록' }).click();
    await dlg.getByText('이 작업 확인 부탁해요').waitFor();
    await dlg.getByRole('button', { name: '닫기', exact: true }).click();
    await pollUntil(async () => (await unread(rtMember)) === before + 1, '댓글 알림 배지');

    await rtMember.locator('.bell-button').click();
    const panel = rtMember.getByRole('dialog', { name: '알림 목록' });
    await panel.getByText(/ui-manager님이 '알림 작업' 작업에 댓글을 남겼습니다/).waitFor();
    await panel.getByRole('button', { name: '모두 읽음' }).click();
    await pollUntil(async () => (await unread(rtMember)) === 0, '모두 읽음');
    await rtMember.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
  });
  await step(
    '멘션: @ 자동완성으로 고르면 강조되고, 멘션된 담당자에게는 알림이 한 건만 간다',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const before = await unread(rtMember);
      await card(rtManager, '알림 작업').click();
      const dlg = rtManager.getByRole('dialog');
      const box = dlg.getByLabel('새 댓글');
      await box.click();
      await box.pressSequentially('@ui-me', { delay: 40 });
      const list = dlg.getByRole('listbox', { name: '멘션 후보' });
      await list.waitFor();
      const options = list.getByRole('option');
      if ((await options.count()) !== 1) throw new Error('후보가 멤버 한 명으로 좁혀지지 않음');
      await options.first().getByText('ui-member').waitFor();
      // 본인(ui-manager)과 비멤버(ui-outsider)는 후보에 없다
      await box.fill('');
      await box.pressSequentially('@ui-', { delay: 40 });
      await list.waitFor();
      const names = await list.getByRole('option').allInnerTexts();
      if (names.some((n) => n.includes('ui-manager') || n.includes('ui-outsider'))) {
        throw new Error(`후보에 있으면 안 되는 사람이 있음: ${names.join(' / ')}`);
      }
      await box.fill('');
      await box.pressSequentially('@ui-me', { delay: 40 });
      await list.waitFor();
      await rtManager.keyboard.press('Enter'); // 선택
      await list.waitFor({ state: 'detached' });
      if (!(await box.inputValue()).startsWith('@ui-member ')) {
        throw new Error(`선택 후 본문이 이상함: ${await box.inputValue()}`);
      }
      await box.pressSequentially('멘션 확인 부탁해요', { delay: 10 });
      await dlg.getByRole('button', { name: '댓글 등록' }).click();
      await dlg.locator('.comment-body .mention', { hasText: '@ui-member' }).waitFor();
      await dlg.getByRole('button', { name: '닫기', exact: true }).click();

      // 담당자이기도 한 멘션 대상에게는 멘션 알림 1건만 (댓글 알림 중복 없음)
      await pollUntil(async () => (await unread(rtMember)) === before + 1, '멘션 알림 배지');
      await new Promise((r) => setTimeout(r, 1500));
      if ((await unread(rtMember)) !== before + 1) throw new Error('알림이 중복으로 옴');

      await rtMember.locator('.bell-button').click();
      const panel = rtMember.getByRole('dialog', { name: '알림 목록' });
      const mention = panel.getByRole('button', {
        name: /ui-manager님이 '알림 작업' 작업의 댓글에서 회원님을 언급했습니다/,
      });
      await mention.waitFor();
      if ((await panel.getByText(/작업에 댓글을 남겼습니다/).count()) !== 1) {
        throw new Error('멘션 댓글에 대해 댓글 알림이 추가로 생성됨(중복)');
      }
      await mention.click();
      const taskDlg = rtMember.getByRole('dialog', { name: '작업 수정' });
      await taskDlg.waitFor();
      await taskDlg.locator('.comment-body .mention', { hasText: '@ui-member' }).waitFor();
      await taskDlg.getByRole('button', { name: '취소' }).click();
      await rtMember.waitForURL((u) => !u.search.includes('task='));
    },
  );
  await step('멘션: 고른 뒤 본문에서 지우면 멘션 없이 등록되고 알림도 가지 않음', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    // 앞 단계에서 누른 멘션 알림의 읽음 처리(비동기)가 반영된 뒤의 값을 기준으로 삼는다
    await pollUntil(async () => (await unread(rtMember)) === 0, '이전 알림 읽음 반영');
    const before = await unread(rtMember);
    await card(rtManager, '알림 작업').click();
    const dlg = rtManager.getByRole('dialog');
    const box = dlg.getByLabel('새 댓글');
    await box.click();
    await box.pressSequentially('@ui-me', { delay: 40 });
    await dlg.getByRole('listbox', { name: '멘션 후보' }).waitFor();
    await rtManager.keyboard.press('Enter');
    await box.fill('멘션을 지웠어요');
    await dlg.getByRole('button', { name: '댓글 등록' }).click();
    const done = dlg.locator('.comment-body', { hasText: '멘션을 지웠어요' });
    await done.waitFor();
    if ((await done.locator('.mention').count()) !== 0) throw new Error('지운 멘션이 강조됨');
    await dlg.getByRole('button', { name: '닫기', exact: true }).click();
    // 멘션은 없지만 담당자이므로 일반 댓글 알림은 1건 온다 (멘션 알림은 없음)
    await pollUntil(async () => (await unread(rtMember)) === before + 1, '댓글 알림 배지');
    await rtMember.locator('.bell-button').click();
    const panel = rtMember.getByRole('dialog', { name: '알림 목록' });
    await panel.getByRole('button', { name: '모두 읽음' }).click();
    await pollUntil(async () => (await unread(rtMember)) === 0, '모두 읽음');
    await rtMember.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
  });
  await step('실시간: 연결이 끊긴 동안 생긴 변경은 재연결 후 다시 불러와 보정됨', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    const [adminToken, managerToken] = [await apiLogin('admin'), await apiLogin('manager')];
    const memberId = (await db.query('SELECT id FROM users WHERE email = $1', [emailOf('member')]))
      .rows[0].id;
    const projectId = projectUrl.split('/').pop();

    // 역할 변경 API 는 해당 사용자의 소켓 연결을 끊는다(같은 역할로 보내도 동일). 끊긴 직후 작업을 만든다.
    const forced = await apiCall('PATCH', `/users/${memberId}/role`, adminToken, {
      role: 'member',
    });
    if (forced.status !== 200) throw new Error(`역할 변경 실패: ${forced.status}`);
    const created = await apiCall('POST', `/projects/${projectId}/tasks`, managerToken, {
      title: '끊긴 동안 생성',
    });
    if (created.status !== 201) throw new Error(`작업 생성 실패: ${created.status}`);

    // 이벤트는 놓쳤지만, 재연결되면 전체를 다시 불러와 나타나야 한다.
    await column(rtMember, 'todo')
      .locator('[data-task-id]', { hasText: '끊긴 동안 생성' })
      .waitFor({ timeout: 15000 });
  });
  await step('채팅: 보낸 메시지가 상대 화면에 새로고침 없이 나타나고 줄바꿈이 유지됨', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    const mChat = rtManager.getByRole('region', { name: '프로젝트 채팅' });
    const uChat = rtMember.getByRole('region', { name: '프로젝트 채팅' });
    await mChat.scrollIntoViewIfNeeded();
    const box = mChat.getByLabel('채팅 메시지');
    await box.click();
    await box.pressSequentially('안녕하세요 <b>굵게</b>', { delay: 10 });
    await rtManager.keyboard.press('Shift+Enter'); // 줄바꿈 (전송 아님)
    await box.pressSequentially('두 번째 줄', { delay: 10 });
    if ((await mChat.locator('.chat-body').count()) !== 0) throw new Error('Shift+Enter 로 전송됨');
    await rtManager.keyboard.press('Enter');
    const mine = mChat.locator('.chat-body', { hasText: '두 번째 줄' });
    await mine.waitFor();
    const theirs = uChat.locator('.chat-body', { hasText: '두 번째 줄' });
    await theirs.waitFor({ timeout: 5000 });
    if (!(await theirs.innerText()).includes('안녕하세요 <b>굵게</b>\n두 번째 줄')) {
      throw new Error(`본문이 달라짐: ${await theirs.innerText()}`);
    }
    if ((await uChat.locator('.chat-body b').count()) !== 0) throw new Error('HTML 이 해석됨');
    if ((await box.inputValue()) !== '') throw new Error('전송 후 입력창이 비워지지 않음');
  });
  await step(
    '채팅: 답장이 양쪽에 보이고, 삭제는 작성자·소유자만 할 수 있으며 삭제하면 상대 화면에서도 사라짐',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const mChat = rtManager.getByRole('region', { name: '프로젝트 채팅' });
      const uChat = rtMember.getByRole('region', { name: '프로젝트 채팅' });
      const box = uChat.getByLabel('채팅 메시지');
      await box.click();
      await box.pressSequentially('네 확인했어요', { delay: 10 });
      await uChat.getByRole('button', { name: '보내기' }).click();
      await mChat.locator('.chat-body', { hasText: '네 확인했어요' }).waitFor({ timeout: 5000 });
      // 멤버는 남(소유자)의 메시지를 지울 수 없고, 자기 메시지에만 삭제 버튼이 있다
      const others = uChat.locator('.chat-msg', { hasText: '두 번째 줄' });
      if ((await others.getByRole('button', { name: '삭제' }).count()) !== 0) {
        throw new Error('남의 메시지에 삭제 버튼이 보임');
      }
      // 소유자는 멤버의 메시지도 지울 수 있다
      const replyOnManager = mChat.locator('.chat-msg', { hasText: '네 확인했어요' });
      rtManager.once('dialog', (d) => d.accept());
      await replyOnManager.getByRole('button', { name: '삭제' }).click();
      await replyOnManager.waitFor({ state: 'detached' });
      await uChat
        .locator('.chat-body', { hasText: '네 확인했어요' })
        .waitFor({ state: 'detached', timeout: 5000 });
      // 작성자는 자기 메시지를 지운다
      const first = mChat.locator('.chat-msg', { hasText: '두 번째 줄' });
      rtManager.once('dialog', (d) => d.accept());
      await first.getByRole('button', { name: '삭제' }).click();
      await uChat
        .locator('.chat-body', { hasText: '두 번째 줄' })
        .waitFor({ state: 'detached', timeout: 5000 });
    },
  );
  await step(
    '채팅 멘션: @ 로 고르면 강조되고, 멘션된 사람에게 알림이 가며 누르면 프로젝트로 이동',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const before = await unread(rtMember);
      const mChat = rtManager.getByRole('region', { name: '프로젝트 채팅' });
      const uChat = rtMember.getByRole('region', { name: '프로젝트 채팅' });
      const box = mChat.getByLabel('채팅 메시지');
      await box.click();
      await box.pressSequentially('@ui-me', { delay: 40 });
      const list = mChat.getByRole('listbox', { name: '멘션 후보' });
      await list.waitFor();
      if ((await list.getByRole('option').count()) !== 1)
        throw new Error('후보가 한 명으로 좁혀지지 않음');
      await rtManager.keyboard.press('Enter'); // 후보 선택(전송 아님)
      await list.waitFor({ state: 'detached' });
      if ((await mChat.locator('.chat-body').count()) !== 0)
        throw new Error('후보를 고르다 전송됨');
      if (!(await box.inputValue()).startsWith('@ui-member ')) {
        throw new Error(`선택 후 본문이 이상함: ${await box.inputValue()}`);
      }
      await box.pressSequentially('채팅 멘션 확인', { delay: 10 });
      await rtManager.keyboard.press('Enter'); // 이번에는 전송
      await mChat.locator('.chat-body .mention', { hasText: '@ui-member' }).waitFor();
      await uChat
        .locator('.chat-body .mention', { hasText: '@ui-member' })
        .waitFor({ timeout: 5000 });

      await pollUntil(async () => (await unread(rtMember)) === before + 1, '채팅 멘션 알림 배지');
      await rtMember.locator('.bell-button').click();
      const panel = rtMember.getByRole('dialog', { name: '알림 목록' });
      const note = panel.getByRole('button', { name: /채팅에서 회원님을 언급했습니다/ });
      await note.waitFor();
      await note.click();
      await rtMember.waitForURL(
        (u) => u.pathname.startsWith('/projects/') && !u.search.includes('task='),
      );
      await rtMember.getByRole('region', { name: '프로젝트 채팅' }).waitFor();
      // 읽음 처리 후 정리(뒤 단계에 영향 없게)
      await pollUntil(async () => (await unread(rtMember)) === before, '읽음 처리');
    },
  );
  await step('레이아웃: 채팅·활동 기록·멤버는 오른쪽 사이드, 작업·투표는 본문에 있음', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    const side = rtMember.locator('.project-side');
    const main = rtMember.locator('.project-main');
    await side.getByRole('region', { name: '프로젝트 채팅' }).waitFor();
    await side.getByRole('region', { name: '활동 기록' }).waitFor();
    await side.getByRole('heading', { name: /^멤버/ }).waitFor();
    await main.getByRole('region', { name: '투표', exact: true }).waitFor();
    const mainBox = await main.boundingBox();
    const sideBox = await side.boundingBox();
    if (!(sideBox.x > mainBox.x + mainBox.width - 1))
      throw new Error('사이드가 본문 오른쪽에 있지 않음');
    if ((await main.getByRole('region', { name: '프로젝트 채팅' }).count()) !== 0) {
      throw new Error('채팅이 본문에 있음');
    }
  });
  await step(
    '통합검색: 상단 검색창으로 작업·댓글을 찾고, 결과를 누르면 그 작업이 열림',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const box = rtMember.getByRole('searchbox', { name: '통합검색' });
      await box.click();
      await box.pressSequentially('알림 작업', { delay: 20 });
      await rtMember.keyboard.press('Enter');
      await rtMember.waitForURL((u) => u.pathname === '/search' && u.search.includes('q='));
      const tasks = rtMember.getByRole('region', { name: '작업' });
      const link = tasks.getByRole('link', { name: '알림 작업' });
      await link.waitFor();
      if ((await tasks.locator('mark').count()) === 0) throw new Error('검색어가 강조되지 않음');

      // 댓글 본문으로도 찾는다 (멘션 단계에서 남긴 댓글)
      await box.fill('');
      await box.pressSequentially('멘션 확인', { delay: 20 });
      await rtMember.keyboard.press('Enter');
      const comments = rtMember.getByRole('region', { name: '댓글' });
      await comments.getByText('멘션 확인 부탁해요').first().waitFor();

      // 결과 없음 안내, 그리고 1글자는 검색하지 않음
      await box.fill('');
      await box.pressSequentially('없는말abcxyz', { delay: 20 });
      await rtMember.keyboard.press('Enter');
      await rtMember.getByText('결과가 없습니다').waitFor();

      await box.fill('');
      await box.pressSequentially('알림 작업', { delay: 20 });
      await rtMember.keyboard.press('Enter');
      await rtMember
        .getByRole('region', { name: '작업' })
        .getByRole('link', { name: '알림 작업' })
        .click();
      const dlg = rtMember.getByRole('dialog', { name: '작업 수정' });
      await dlg.waitFor();
      await dlg.getByRole('button', { name: '취소' }).click();
      await rtMember.waitForURL((u) => !u.search.includes('task='));
      await rtMember.getByRole('region', { name: '프로젝트 채팅' }).waitFor();
    },
  );
  await step(
    '모아보기: 멘션·알림·남의 활동이 한 화면에 모이고, 멘션을 누르면 그 작업이 열림',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      await rtMember.getByRole('link', { name: '모아보기' }).click();
      await rtMember.waitForURL((u) => u.pathname === '/feed');
      const mentions = rtMember.getByRole('region', { name: '나를 멘션한 댓글' });
      await mentions.getByText('멘션 확인 부탁해요').waitFor();
      // 내가 한 활동은 빼고 남(ui-manager)이 한 활동만 보인다
      const acts = rtMember.getByRole('region', { name: '내가 없는 동안의 활동' });
      await acts.getByText('ui-manager').first().waitFor();
      if ((await acts.getByText('ui-member님이').count()) !== 0) {
        throw new Error('내가 한 활동이 남의 활동 목록에 있음');
      }
      // 안 읽은 알림 영역이 있고, 마감 영역은 비어 있다는 안내가 보인다
      await rtMember.getByRole('region', { name: '안 읽은 알림' }).waitFor();
      await rtMember.getByRole('region', { name: '마감 임박·지연 작업' }).waitFor();

      await mentions.getByRole('link', { name: '알림 작업' }).first().click();
      const dlg = rtMember.getByRole('dialog', { name: '작업 수정' });
      await dlg.waitFor();
      await dlg.getByRole('button', { name: '취소' }).click();
      await rtMember.waitForURL((u) => !u.search.includes('task='));
      await rtMember.getByRole('region', { name: '프로젝트 채팅' }).waitFor();
    },
  );
  await step(
    '투표: 만들면 상대 화면에 나타나고, 투표·변경 결과가 두 화면에 실시간 반영됨',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const mPoll = rtManager.getByRole('region', { name: '투표', exact: true });
      const uPoll = rtMember.getByRole('region', { name: '투표', exact: true });
      await mPoll.scrollIntoViewIfNeeded();
      await mPoll.getByRole('button', { name: '새 투표' }).click();
      await mPoll.getByLabel('질문').fill('점심 메뉴는?');
      await mPoll.getByLabel('선택지 1').fill('한식');
      await mPoll.getByLabel('선택지 2').fill('중식');
      await mPoll.getByRole('button', { name: '투표 만들기' }).click();
      await mPoll.getByText('점심 메뉴는?').waitFor();
      await uPoll.getByText('점심 메뉴는?').waitFor({ timeout: 5000 });

      // 멤버가 첫 선택지에 투표 → 두 화면 모두 1표(100%)
      await uPoll.getByRole('radio', { name: '한식' }).click();
      await uPoll.getByText('1표 (100%)').waitFor();
      await mPoll.getByText('1표 (100%)').waitFor({ timeout: 5000 });
      // 소유자 화면에서는 내 선택이 아니므로 체크되어 있지 않다(누가 골랐는지 보이지 않음)
      if (await mPoll.getByRole('radio', { name: '한식' }).isChecked()) {
        throw new Error('남의 선택이 내 선택으로 보임');
      }
      if ((await mPoll.getByText('ui-member').count()) !== 0) {
        throw new Error('투표한 사람의 이름이 노출됨');
      }
      // 소유자도 투표, 멤버는 마음을 바꿈
      await mPoll.getByRole('radio', { name: '중식' }).click();
      await uPoll.getByText('2명 참여').waitFor({ timeout: 5000 });
      await uPoll.getByRole('radio', { name: '중식' }).click();
      await uPoll.getByText('2표 (100%)').waitFor();
      await mPoll.getByText('2표 (100%)').waitFor({ timeout: 5000 });
      await mPoll.getByText('0표 (0%)').waitFor();
    },
  );
  await step('투표: 소유자가 마감하면 상대는 더 투표할 수 없고, 삭제하면 사라짐', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    const mPoll = rtManager.getByRole('region', { name: '투표', exact: true });
    const uPoll = rtMember.getByRole('region', { name: '투표', exact: true });
    // 소유자가 아닌 멤버(만든 사람도 아님)에게는 마감·삭제 버튼이 없다
    if ((await uPoll.getByRole('button', { name: '마감' }).count()) !== 0) {
      throw new Error('권한 없는 멤버에게 마감 버튼이 보임');
    }
    rtManager.once('dialog', (d) => d.accept());
    await mPoll.getByRole('button', { name: '마감' }).click();
    await uPoll.getByText('마감', { exact: true }).waitFor({ timeout: 5000 });
    if (!(await uPoll.getByRole('radio', { name: '한식' }).isDisabled())) {
      throw new Error('마감된 투표에 투표할 수 있음');
    }
    rtManager.once('dialog', (d) => d.accept());
    await mPoll.getByRole('button', { name: '삭제' }).click();
    await uPoll.getByText('점심 메뉴는?').waitFor({ state: 'detached', timeout: 5000 });
  });
  await step(
    '활동 기록: 이동·생성·삭제·댓글이 타임라인에 기록되고 다른 사용자 화면에 실시간 반영',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const feed = rtMember.getByRole('region', { name: '활동 기록' });
      await feed.scrollIntoViewIfNeeded();
      // 앞선 단계의 동작이 이미 기록돼 있다 (보고 있는 화면의 새로고침 없이 갱신된 상태)
      await feed.getByText('옮겼습니다').first().waitFor({ timeout: 5000 });
      await feed.getByText('“실시간 작업”').first().waitFor({ timeout: 5000 });
      await feed.getByText('삭제했습니다').first().waitFor({ timeout: 5000 });
      await feed.getByText('댓글을 남겼습니다').first().waitFor({ timeout: 5000 });
      if ((await feed.getByText('ui-manager').count()) === 0) {
        throw new Error('행위자 이름이 보이지 않음');
      }
      // 지금 이 순간 일어나는 변경도 새로고침 없이 나타난다
      await addTask(rtManager, '활동 실시간 확인');
      await feed.getByText('“활동 실시간 확인”').first().waitFor({ timeout: 5000 });
      // 댓글 본문은 기록에 나오지 않는다
      if ((await feed.getByText('<b>굵게</b>').count()) !== 0) {
        throw new Error('댓글 본문이 활동 기록에 노출됨');
      }
    },
  );
  await step('활동 기록: 작업 모달의 "변경 이력"에 그 작업의 기록만 보임', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    await card(rtManager, '활동 실시간 확인').click();
    const dialog = rtManager.getByRole('dialog');
    const history = dialog.getByRole('region', { name: '변경 이력' });
    await history.getByText('만들었습니다').waitFor({ timeout: 5000 });
    if ((await history.getByText('“둘째”').count()) !== 0) {
      throw new Error('다른 작업의 기록이 섞여 있음');
    }
    await dialog.getByRole('button', { name: '취소' }).click();
    await dialog.waitFor({ state: 'detached' });
  });
  await step(
    '히스토리 공유: 활동 기록을 CSV 로 내려받는다 (BOM·머리글·행, 수식 무력화)',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      await addTask(rtManager, '=1+1 수식 제목');
      await rtManager
        .getByRole('region', { name: '활동 기록' })
        .getByText('“=1+1 수식 제목”')
        .first()
        .waitFor({ timeout: 5000 });
      const [download] = await Promise.all([
        rtManager.waitForEvent('download'),
        rtManager.getByRole('button', { name: 'CSV 내보내기' }).click(),
      ]);
      if (!download.suggestedFilename().startsWith('활동기록-')) {
        throw new Error(`파일 이름이 이상함: ${download.suggestedFilename()}`);
      }
      const text = readFileSync(await download.path(), 'utf8');
      if (text.charCodeAt(0) !== 0xfeff) throw new Error('UTF-8 BOM 이 없음');
      const lines = text.slice(1).trim().split('\r\n');
      if (lines[0] !== '일시,행위자,내용,동작') throw new Error(`머리글이 이상함: ${lines[0]}`);
      if (!lines.some((l) => l.includes('ui-manager') && l.includes('task.created'))) {
        throw new Error('작업 생성 행이 없음');
      }
      if (!lines.some((l) => l.includes('프로젝트를 만들었습니다'))) {
        throw new Error('프로젝트 생성 행이 없음');
      }
      // 시간 오름차순(오래된 것부터): 프로젝트 생성이 작업 생성보다 앞
      const created = lines.findIndex((l) => l.includes('project.created'));
      const task = lines.findIndex((l) => l.includes('=1+1 수식 제목'));
      if (!(created > 0 && task > created)) throw new Error('시간 순서가 오름차순이 아님');
      if (lines.some((l) => /(^|,)=/.test(l))) throw new Error('수식으로 시작하는 칸이 있음');
    },
  );
  await step(
    '히스토리 공유: 소유자만 링크를 만들고, 로그인 없이 열람하고, 폐기하면 막힌다',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      // 소유자가 아닌 멤버 화면에는 공유 링크 영역이 없다
      if ((await rtMember.getByRole('region', { name: '공유 링크' }).count()) !== 0) {
        throw new Error('멤버에게 공유 링크 관리 영역이 보임');
      }
      const share = rtManager.getByRole('region', { name: '공유 링크' });
      await share.scrollIntoViewIfNeeded();
      await share.getByRole('button', { name: '링크 만들기' }).click();
      const input = share.getByLabel('공유 링크 주소');
      await input.waitFor();
      const url = await input.inputValue();
      if (!/\/share\/[A-Za-z0-9_-]{43}$/.test(url)) throw new Error(`링크 형태가 이상함: ${url}`);

      // 완전히 새 브라우저(로그인 없음)로 연다
      const visitor = await newPage();
      await visitor.goto(url);
      await visitor.getByRole('heading', { name: `ui-${run}-개편` }).waitFor();
      await visitor.getByText('읽기 전용 공유').waitFor();
      await visitor.getByText('“활동 실시간 확인”').first().waitFor();
      if ((await visitor.getByRole('link', { name: '로그아웃' }).count()) !== 0) {
        throw new Error('공개 페이지에 로그인 UI 가 보임');
      }
      const body = await visitor.locator('body').innerText();
      if (/@example\.test/.test(body)) throw new Error('이메일이 공개 페이지에 노출됨');
      if (/멤버로 (추가|제거)/.test(body) || body.includes('공유 링크를 만들었습니다')) {
        throw new Error('멤버·공유 기록이 공개 페이지에 노출됨');
      }

      // 소유자 화면의 목록에 링크가 보이고, 폐기하면 방문자가 바로 막힌다
      await share
        .getByText(/조회 \d+회/)
        .first()
        .waitFor();
      rtManager.once('dialog', (d) => d.accept());
      await share.getByRole('button', { name: '폐기' }).first().click();
      await share.getByRole('button', { name: '폐기' }).first().waitFor({ state: 'detached' });
      await visitor.reload();
      await visitor.getByRole('heading', { name: '열 수 없는 링크입니다' }).waitFor();

      // 만든·폐기한 사실은 멤버의 활동 기록에 남는다
      const feed = rtMember.getByRole('region', { name: '활동 기록' });
      await feed.getByText('공유 링크를 폐기했습니다').first().waitFor({ timeout: 5000 });
      await feed.getByText('읽기 전용 공유 링크를 만들었습니다').first().waitFor({ timeout: 5000 });
    },
  );
  await step('히스토리 공유: 엉뚱한 주소는 열 수 없는 링크 안내', async () => {
    const stranger = await newPage();
    await stranger.goto(`${BASE}/share/${'q'.repeat(43)}`);
    await stranger.getByRole('heading', { name: '열 수 없는 링크입니다' }).waitFor();
  });
  // ---- 협업 기능 확장 (M16~M20): 활동 기록 단계가 오래된 기록을 확인하므로 그 뒤에 둔다
  // ---- 하위 작업·라벨 (M16)
  const closeDialog = async (p) => {
    await p.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
    await p.getByRole('dialog').waitFor({ state: 'detached' });
  };
  await step(
    '라벨·체크리스트: 작업에 라벨을 만들어 붙이고 항목을 추가하면 두 화면의 카드에 라벨·진행률이 실시간 반영',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      await card(rtManager, '둘째').click();
      const dlg = rtManager.getByRole('dialog');
      await dlg.getByLabel('새 라벨 이름').fill('ui-버그');
      await dlg.getByLabel('새 라벨 색').selectOption('red');
      await dlg.getByRole('button', { name: '만들고 붙이기' }).click();
      await dlg.getByRole('button', { name: 'ui-버그', pressed: true }).waitFor();

      const checklist = dlg.getByRole('region', { name: '체크리스트' });
      for (const text of ['시안 확인', '배포']) {
        await checklist.getByLabel('체크리스트 항목').fill(text);
        await checklist.getByRole('button', { name: '추가', exact: true }).click();
        await checklist.getByText(text, { exact: true }).waitFor();
      }
      await checklist.getByRole('checkbox').first().click();
      await checklist.getByTestId('checklist-progress').filter({ hasText: '1/2' }).waitFor();
      await closeDialog(rtManager);

      for (const [p, timeout] of [
        [rtManager, T],
        [rtMember, 5000],
      ]) {
        await card(p, '둘째').getByText('ui-버그', { exact: true }).waitFor({ timeout });
        await card(p, '둘째').getByText('✓ 1/2').waitFor({ timeout });
      }
    },
  );
  await step('라벨 필터: 라벨로 거르면 그 라벨이 붙은 작업만 남고, 해제하면 돌아옴', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    await rtMember.getByLabel('라벨 필터').selectOption({ label: 'ui-버그' });
    await card(rtMember, '둘째').waitFor();
    await pollUntil(
      async () => (await rtMember.locator('[data-task-id]').count()) === 1,
      '라벨 필터 적용',
    );
    await rtMember.getByLabel('라벨 필터').selectOption('');
    await pollUntil(
      async () => (await rtMember.locator('[data-task-id]').count()) > 1,
      '라벨 필터 해제',
    );
  });
  await step('체크리스트: 열어 둔 다른 사용자의 모달에 체크 변경이 실시간 반영', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    await card(rtManager, '둘째').click();
    await card(rtMember, '둘째').click();
    const mList = rtManager.getByRole('dialog').getByRole('region', { name: '체크리스트' });
    const uList = rtMember.getByRole('dialog').getByRole('region', { name: '체크리스트' });
    await uList.getByTestId('checklist-progress').filter({ hasText: '1/2' }).waitFor();
    await mList.getByRole('checkbox').nth(1).click();
    await uList.getByTestId('checklist-progress').filter({ hasText: '2/2' }).waitFor({
      timeout: 5000,
    });
    if (!(await uList.getByRole('checkbox').nth(1).isChecked())) {
      throw new Error('상대 화면의 체크 상태가 갱신되지 않음');
    }
    for (const p of [rtManager, rtMember]) await closeDialog(p);
    await card(rtMember, '둘째').getByText('✓ 2/2').waitFor({ timeout: 5000 });
  });
  await step(
    '라벨 관리: 소유자는 이름·색을 바꾸고 삭제하며 상대 화면에 반영, 만든 사람이 아닌 멤버는 수정 불가',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      // 라벨은 manager(소유자)가 만들었다. member 는 만든 사람도 소유자도 아니라 입력이 잠긴다.
      await rtMember.getByRole('button', { name: '라벨 관리' }).click();
      const uDlg = rtMember.getByRole('dialog', { name: '라벨 관리' });
      if (!(await uDlg.getByLabel('ui-버그 이름').isDisabled())) {
        throw new Error('권한 없는 멤버가 라벨 이름을 고칠 수 있음');
      }
      if ((await uDlg.getByRole('button', { name: '삭제' }).count()) !== 0) {
        throw new Error('권한 없는 멤버에게 라벨 삭제 버튼이 보임');
      }
      await closeDialog(rtMember);

      await rtManager.getByRole('button', { name: '라벨 관리' }).click();
      const mDlg = rtManager.getByRole('dialog', { name: '라벨 관리' });
      await mDlg.getByLabel('ui-버그 이름').fill('ui-결함');
      await mDlg.getByRole('button', { name: '저장' }).click();
      await card(rtMember, '둘째').getByText('ui-결함', { exact: true }).waitFor({ timeout: 5000 });

      rtManager.once('dialog', (d) => d.accept());
      await mDlg.getByRole('button', { name: '삭제' }).click();
      await pollUntil(
        async () => (await card(rtMember, '둘째').locator('.label-chip').count()) === 0,
        '라벨 삭제 반영',
      );
      await closeDialog(rtManager);
    },
  );
  // ---- 캘린더 보기·저장된 필터 (M17)
  await step(
    '캘린더: 마감일이 오늘인 작업이 오늘 칸에 보이고, 달 이동·오늘 버튼·카드 열기가 동작',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const taskId = await card(rtMember, '둘째').getAttribute('data-task-id');
      const today = new Date().toLocaleDateString('sv-SE');
      const token = await apiLogin('manager');
      const patched = await apiCall('PATCH', `/tasks/${taskId}`, token, { dueDate: today });
      if (patched.status !== 200) throw new Error(`마감일 지정 실패: ${patched.status}`);

      await rtMember.getByRole('tab', { name: '캘린더' }).click();
      const now = new Date();
      const title = rtMember.getByTestId('calendar-title');
      await title.filter({ hasText: `${now.getFullYear()}년 ${now.getMonth() + 1}월` }).waitFor();
      const cell = rtMember.locator(`[data-date="${today}"]`);
      await cell.getByRole('button', { name: '둘째' }).waitFor();
      if (!(await cell.getAttribute('class')).includes('today')) {
        throw new Error('오늘 칸이 강조되지 않음');
      }

      await rtMember.getByRole('button', { name: '다음 달' }).click();
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await title.filter({ hasText: `${next.getFullYear()}년 ${next.getMonth() + 1}월` }).waitFor();
      if ((await rtMember.locator(`[data-date="${today}"]`).count()) !== 0) {
        throw new Error('다음 달에 오늘 칸이 남아 있음');
      }
      await rtMember.getByRole('button', { name: '오늘', exact: true }).click();
      await rtMember
        .locator(`[data-date="${today}"]`)
        .getByRole('button', { name: '둘째' })
        .click();
      await rtMember.getByRole('dialog').getByLabel('제목').waitFor();
      await closeDialog(rtMember);
    },
  );
  await step('캘린더: 상태 필터가 캘린더에도 적용됨', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    const today = new Date().toLocaleDateString('sv-SE');
    const chip = rtMember.locator(`[data-date="${today}"]`).getByRole('button', { name: '둘째' });
    await chip.waitFor();
    await rtMember.getByLabel('상태 필터').selectOption('done');
    await chip.waitFor({ state: 'detached' });
    await rtMember.getByLabel('상태 필터').selectOption('');
    await chip.waitFor();
    await rtMember.getByRole('tab', { name: '보드' }).click();
    await column(rtMember, 'todo').waitFor();
  });
  await step(
    '저장된 필터: 저장 → 초기화 → 불러와 적용, 새로고침 후에도 남고, 다른 사용자에게는 안 보이며, 삭제됨',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      await rtMember.getByLabel('우선순위 필터').selectOption({ label: '긴급' });
      await rtMember.getByRole('button', { name: '이 조건 기억하기' }).click();
      await rtMember.getByLabel('기억할 필터 이름').fill('ui-긴급');
      await rtMember.getByRole('button', { name: '기억', exact: true }).click();
      await rtMember.getByLabel('저장된 필터').locator('option', { hasText: 'ui-긴급' }).waitFor({
        state: 'attached',
      });

      await rtMember.getByRole('button', { name: '필터 초기화' }).click();
      if ((await rtMember.getByLabel('우선순위 필터').inputValue()) !== '') {
        throw new Error('초기화되지 않음');
      }
      await rtMember.getByLabel('저장된 필터').selectOption({ label: 'ui-긴급' });
      await pollUntil(
        async () => (await rtMember.getByLabel('우선순위 필터').inputValue()) === 'urgent',
        '저장된 필터 적용',
      );

      // 서버에 저장돼 새로고침해도 남고, 개인용이라 다른 사용자(소유자)에게는 보이지 않는다
      await rtMember.reload();
      await rtMember
        .getByLabel('저장된 필터')
        .locator('option', { hasText: 'ui-긴급' })
        .waitFor({ state: 'attached' });
      await rtManager.reload();
      await rtManager.getByLabel('저장된 필터').waitFor();
      if (
        (await rtManager
          .getByLabel('저장된 필터')
          .locator('option', { hasText: 'ui-긴급' })
          .count()) !== 0
      ) {
        throw new Error('다른 사용자에게 개인 필터가 보임');
      }

      await rtMember.getByLabel('저장된 필터').selectOption({ label: 'ui-긴급' });
      await rtMember.getByRole('button', { name: '기억 지우기' }).click();
      await pollUntil(
        async () =>
          (await rtMember
            .getByLabel('저장된 필터')
            .locator('option', { hasText: 'ui-긴급' })
            .count()) === 0,
        '필터 삭제 반영',
      );
      // 이후 단계를 위해 적용돼 있던 조건을 풀어 둔다
      await rtMember.getByRole('button', { name: '필터 초기화' }).click();
      await pollUntil(
        async () => (await rtMember.getByLabel('우선순위 필터').inputValue()) === '',
        '필터 초기화',
      );
    },
  );
  // ---- 의존성·타임라인 (M18)
  const plusDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString('sv-SE');
  };
  const depProjectId = projectUrl.match(/projects\/([0-9a-f-]{36})/)?.[1];
  let depTaskA;
  let depTaskB;
  await step(
    '선행 작업: 모달에서 지정하면 두 화면의 카드에 ⛔ 배지가 실시간 반영되고, 순환 지정은 오류로 막힘',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const token = await apiLogin('manager');
      const mk = async (body) => {
        const r = await apiCall('POST', `/projects/${depProjectId}/tasks`, token, body);
        if (r.status !== 201) throw new Error(`작업 생성 실패: ${r.status}`);
        return r.body;
      };
      depTaskA = await mk({ title: '선행 작업 A', dueDate: plusDays(2) });
      depTaskB = await mk({ title: '후행 작업 B', startDate: plusDays(0), dueDate: plusDays(3) });
      await card(rtManager, '후행 작업 B').waitFor();
      await card(rtMember, '후행 작업 B').waitFor({ timeout: 5000 });

      await card(rtManager, '후행 작업 B').click();
      const dlg = rtManager.getByRole('dialog');
      const section = dlg.getByRole('region', { name: '선행 작업' });
      await section.getByLabel('선행 작업 선택').selectOption({ label: '선행 작업 A (할 일)' });
      await section.getByRole('button', { name: '선행으로 지정' }).click();
      await section
        .getByRole('list', { name: '선행 작업 목록' })
        .getByText('선행 작업 A')
        .waitFor();
      await closeDialog(rtManager);
      for (const [p, timeout] of [
        [rtManager, T],
        [rtMember, 5000],
      ]) {
        await card(p, '후행 작업 B').getByText('⛔ 선행 1').waitFor({ timeout });
      }

      // 반대로 A 가 B 를 기다리게 하면 순환 → 오류 메시지, 연결은 생기지 않음
      await card(rtManager, '선행 작업 A').click();
      const aSection = rtManager.getByRole('dialog').getByRole('region', { name: '선행 작업' });
      await aSection.getByText('이 작업을 기다리는 작업').waitFor();
      await aSection.getByLabel('선행 작업 선택').selectOption({ label: '후행 작업 B (할 일)' });
      await aSection.getByRole('button', { name: '선행으로 지정' }).click();
      await aSection.getByRole('alert').filter({ hasText: '순환' }).waitFor();
      if ((await card(rtManager, '선행 작업 A').getByText('⛔').count()) !== 0) {
        throw new Error('순환 연결이 만들어짐');
      }
      await closeDialog(rtManager);
    },
  );
  await step(
    '타임라인: 막대가 기간에 맞게 그려지고 선행 작업보다 먼저 시작하면 일정 충돌 표시, 기간 이동 동작',
    async () => {
      if (!depTaskB) throw new Error('준비 단계 실패');
      await rtMember.getByRole('tab', { name: '타임라인' }).click();
      const rowB = rtMember.locator(`[data-task-id="${depTaskB.id}"]`);
      await rowB.locator('.tl-bar').waitFor();
      await rowB.getByText('⚠ 일정 충돌').waitFor();
      await rowB.getByText('⛔ 1').waitFor();
      if (!(await rowB.locator('.tl-bar').getAttribute('class')).includes('conflict')) {
        throw new Error('충돌한 막대가 강조되지 않음');
      }
      const rowA = rtMember.locator(`[data-task-id="${depTaskA.id}"]`);
      await rowA.locator('.tl-bar').waitFor();
      if ((await rowA.getByText('일정 충돌').count()) !== 0) {
        throw new Error('선행이 없는 작업에 충돌이 표시됨');
      }

      // 기간을 앞으로 옮기면 오늘 기준 작업은 창 밖으로 나가고, 오늘로 돌아오면 다시 보임
      const title = rtMember.getByTestId('timeline-title');
      const before = await title.textContent();
      await rtMember.getByRole('button', { name: '다음 기간' }).click();
      await rtMember.getByRole('button', { name: '다음 기간' }).click();
      await rtMember.getByRole('button', { name: '다음 기간' }).click();
      if ((await title.textContent()) === before) throw new Error('기간이 바뀌지 않음');
      await rowB.waitFor({ state: 'detached' });
      await rtMember.getByRole('button', { name: '오늘', exact: true }).click();
      await rtMember.locator(`[data-task-id="${depTaskB.id}"] .tl-bar`).waitFor();

      await rtMember.locator(`[data-task-id="${depTaskB.id}"] .tl-bar`).click();
      await rtMember.getByRole('dialog').getByLabel('시작일').waitFor();
      if ((await rtMember.getByRole('dialog').getByLabel('시작일').inputValue()) !== plusDays(0)) {
        throw new Error('모달의 시작일이 맞지 않음');
      }
      await closeDialog(rtMember);
    },
  );
  await step(
    '선행 작업이 완료되면 후행 작업의 ⛔ 배지와 일정 충돌 표시가 사라짐 (실시간)',
    async () => {
      if (!depTaskA) throw new Error('준비 단계 실패');
      const token = await apiLogin('manager');
      const done = await apiCall('PATCH', `/tasks/${depTaskA.id}`, token, { status: 'done' });
      if (done.status !== 200) throw new Error(`완료 처리 실패: ${done.status}`);
      await rtMember
        .locator(`[data-task-id="${depTaskB.id}"]`)
        .getByText('⚠ 일정 충돌')
        .waitFor({ state: 'detached', timeout: 5000 });
      await rtMember.getByRole('tab', { name: '보드' }).click();
      await card(rtMember, '후행 작업 B').waitFor();
      await pollUntil(
        async () => (await card(rtMember, '후행 작업 B').getByText('⛔').count()) === 0,
        '완료된 선행 작업의 배지 제거',
      );
      // 정리: 이후 단계에 영향이 없도록 만든 작업을 지운다
      for (const t of [depTaskA, depTaskB]) await apiCall('DELETE', `/tasks/${t.id}`, token);
    },
  );
  // ---- 이모지 반응 (M19)
  await step(
    '반응(댓글): 한쪽이 달면 열려 있는 다른 화면에 개수·이름이 실시간 반영되고, 다시 누르면 거둠',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      await card(rtManager, '둘째').click();
      await card(rtMember, '둘째').click();
      const mDlg = rtManager.getByRole('dialog');
      const uDlg = rtMember.getByRole('dialog');
      // 앞 단계에서 댓글이 모두 삭제돼 있으므로 새로 쓴다
      await mDlg.getByLabel('새 댓글').fill('반응 테스트 댓글');
      await mDlg.getByRole('button', { name: '댓글 등록' }).click();
      const mComment = mDlg.locator('li.comment', { hasText: '반응 테스트 댓글' });
      const uComment = uDlg.locator('li.comment', { hasText: '반응 테스트 댓글' });
      await uComment.waitFor({ timeout: 5000 });

      await uComment.getByRole('button', { name: '반응 추가' }).click();
      await uComment.getByRole('button', { name: '좋아요 반응' }).click();
      await uComment.getByRole('button', { name: '좋아요 1명: ui-member' }).waitFor();
      await mComment
        .getByRole('button', { name: '좋아요 1명: ui-member' })
        .waitFor({ timeout: 5000 });

      // 같은 반응을 다른 사람이 누르면 개수가 늘고, 눌린 상태(aria-pressed)와 이름이 보인다
      await mComment.getByRole('button', { name: '좋아요 1명: ui-member' }).click();
      const both = mComment.getByRole('button', {
        name: /좋아요 2명: ui-member, ui-manager|좋아요 2명: ui-manager, ui-member/,
      });
      await both.waitFor();
      if ((await both.getAttribute('aria-pressed')) !== 'true')
        throw new Error('내가 누른 표시 없음');
      await uComment.getByRole('button', { name: /좋아요 2명/ }).waitFor({ timeout: 5000 });

      // 내 반응만 거둔다
      await both.click();
      await mComment.getByRole('button', { name: '좋아요 1명: ui-member' }).waitFor();
      await uComment
        .getByRole('button', { name: '좋아요 1명: ui-member' })
        .waitFor({ timeout: 5000 });
      if ((await mComment.locator('.comment-meta').getByText('(수정됨)').count()) !== 0) {
        throw new Error('반응이 수정됨 표시를 만듦');
      }
      for (const p of [rtManager, rtMember]) await closeDialog(p);
    },
  );
  await step(
    '반응(채팅): 메시지에 반응을 달면 상대 화면에 실시간 반영되고 다시 누르면 거둠',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      const mChat = rtManager.getByRole('region', { name: '프로젝트 채팅' });
      const uChat = rtMember.getByRole('region', { name: '프로젝트 채팅' });
      await mChat.getByLabel('채팅 메시지').fill('반응 테스트 메시지');
      await mChat.getByRole('button', { name: '보내기' }).click();
      const uMsg = uChat.locator('li.chat-msg', { hasText: '반응 테스트 메시지' });
      const mMsg = mChat.locator('li.chat-msg', { hasText: '반응 테스트 메시지' });
      await uMsg.waitFor({ timeout: 5000 });

      await uMsg.getByRole('button', { name: '반응 추가' }).click();
      await uMsg.getByRole('button', { name: '축하 반응' }).click();
      await uMsg.getByRole('button', { name: '축하 1명: ui-member' }).waitFor();
      await mMsg.getByRole('button', { name: '축하 1명: ui-member' }).waitFor({ timeout: 5000 });
      await uMsg.getByRole('button', { name: '축하 1명: ui-member' }).click();
      await pollUntil(
        async () => (await mMsg.getByRole('button', { name: /축하/ }).count()) === 0,
        '채팅 반응 거두기 반영',
      );
    },
  );
  // ---- 댓글 스레드 (M20)
  await step(
    '스레드: 답글은 원 댓글 아래에 묶여 두 화면에 실시간 반영되고, 답글에는 답글 버튼이 없으며, 알림이 감',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      await card(rtManager, '둘째').click();
      await card(rtMember, '둘째').click();
      const mDlg = rtManager.getByRole('dialog');
      const uDlg = rtMember.getByRole('dialog');
      const root = (dlg) => dlg.locator('li.comment:not(.reply)', { hasText: '반응 테스트 댓글' });
      await root(uDlg).waitFor();

      // 앞 단계에서 manager 가 쓴 댓글에 member 가 답글을 단다
      await root(uDlg).getByRole('button', { name: '답글', exact: true }).click();
      await uDlg.getByLabel('답글 내용').fill('첫 답글입니다');
      await uDlg.getByRole('button', { name: '답글 등록' }).click();
      const uReply = root(uDlg).locator('li.comment.reply', { hasText: '첫 답글입니다' });
      await uReply.waitFor();
      const mReply = root(mDlg).locator('li.comment.reply', { hasText: '첫 답글입니다' });
      await mReply.waitFor({ timeout: 5000 });

      // 답글에는 다시 답글을 달 수 없다 (버튼 없음), 답글에도 수정·반응은 가능하다
      if ((await mReply.getByRole('button', { name: '답글', exact: true }).count()) !== 0) {
        throw new Error('답글에 답글 버튼이 보임');
      }
      await mReply.getByRole('button', { name: '반응 추가' }).click();
      await mReply.getByRole('button', { name: '하트 반응' }).click();
      await uReply.getByRole('button', { name: '하트 1명: ui-manager' }).waitFor({ timeout: 5000 });

      // manager 가 새 댓글을 쓰고 member 가 답글을 달면, 원 댓글 작성자(manager)의 벨에 답글 알림이 온다
      await mDlg.getByLabel('새 댓글').fill('manager 의 댓글');
      await mDlg.getByRole('button', { name: '댓글 등록' }).click();
      const mineRoot = uDlg.locator('li.comment:not(.reply)', { hasText: 'manager 의 댓글' });
      await mineRoot.waitFor({ timeout: 5000 });
      await mineRoot.getByRole('button', { name: '답글', exact: true }).click();
      await uDlg.getByLabel('답글 내용').fill('알림 확인용 답글');
      await uDlg.getByRole('button', { name: '답글 등록' }).click();
      await mDlg
        .locator('li.comment:not(.reply)', { hasText: 'manager 의 댓글' })
        .locator('li.comment.reply', { hasText: '알림 확인용 답글' })
        .waitFor({ timeout: 5000 });
      for (const p of [rtManager, rtMember]) await closeDialog(p);

      const bell = rtManager.locator('.bell-button');
      await bell.click();
      await rtManager
        .getByText('회원님의 댓글에 답글을 남겼습니다')
        .first()
        .waitFor({ timeout: 5000 });
      await bell.click();
    },
  );
  await step(
    '스레드: 원 댓글을 지워도 답글은 남고, 카드의 댓글 수는 삭제되지 않은 댓글만 센다',
    async () => {
      if (!rtReady) throw new Error('준비 단계 실패');
      await card(rtManager, '둘째').click();
      await card(rtMember, '둘째').click();
      const mDlg = rtManager.getByRole('dialog');
      const uDlg = rtMember.getByRole('dialog');
      const target = mDlg.locator('li.comment:not(.reply)', { hasText: 'manager 의 댓글' });
      rtManager.once('dialog', (d) => d.accept());
      await target.getByRole('button', { name: '삭제', exact: true }).first().click();
      const uTarget = uDlg.locator('li.comment:not(.reply)', { hasText: '삭제된 댓글' });
      await uTarget
        .locator('li.comment.reply', { hasText: '알림 확인용 답글' })
        .waitFor({ timeout: 5000 });
      // 삭제된 댓글에는 답글 버튼이 없다
      const placeholder = uDlg
        .locator('[data-comment-id]')
        .filter({ hasText: '삭제된 댓글' })
        .first();
      if (
        (await placeholder
          .locator(':scope > .comment-meta')
          .getByRole('button', { name: '답글', exact: true })
          .count()) !== 0
      ) {
        throw new Error('삭제된 댓글에 답글 버튼이 보임');
      }
      for (const p of [rtManager, rtMember]) await closeDialog(p);
    },
  );
  await step('실시간: 멤버를 제거하면 해당 사용자 화면이 접근 권한 없음으로 바뀜', async () => {
    if (!rtReady) throw new Error('준비 단계 실패');
    await rtManager
      .locator('li', { hasText: 'ui-member' })
      .getByRole('button', { name: '제거' })
      .click();
    await rtMember
      .getByRole('heading', { name: '접근 권한이 없습니다' })
      .waitFor({ timeout: 5000 });
  });

  // ---- 모바일: 좁은 화면(폭 375px)에서 가로 스크롤 없이 쓸 수 있어야 한다
  const mobile = await newPage();
  await mobile.setViewportSize({ width: 375, height: 800 });
  const horizontalOverflow = async (p) =>
    Number(await p.evaluate('document.documentElement.scrollWidth - window.innerWidth'));
  await step('모바일(375px): 주요 화면에 페이지 가로 스크롤이 없음', async () => {
    await login(mobile, 'manager');
    const checks = [
      ['프로젝트 목록', `${BASE}/`, mobile.getByRole('heading', { name: '프로젝트', exact: true })],
      ['프로젝트 상세', projectUrl, mobile.getByRole('heading', { name: `ui-${run}-개편` })],
      ['대시보드', `${BASE}/dashboard`, mobile.getByRole('heading', { name: '대시보드' })],
      ['내 작업', `${BASE}/tasks/mine`, mobile.getByRole('heading', { name: '내 작업' })],
    ];
    for (const [name, url, marker] of checks) {
      await mobile.goto(url);
      await marker.waitFor();
      const overflow = await horizontalOverflow(mobile);
      if (overflow > 1) throw new Error(`${name}: 가로로 ${overflow}px 넘침`);
    }
  });
  await step('모바일(375px): 작업 모달과 알림 패널이 화면 안에 들어옴', async () => {
    await mobile.goto(projectUrl);
    await mobile.getByRole('tab', { name: '보드' }).click();
    await card(mobile, '알림 작업').waitFor();
    await card(mobile, '알림 작업').click();
    const dialog = mobile.getByRole('dialog', { name: '작업 수정' });
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    if (box.x < 0 || box.x + box.width > 375.5)
      throw new Error(`모달이 화면을 벗어남: ${JSON.stringify(box)}`);
    if ((await horizontalOverflow(mobile)) > 1) throw new Error('모달을 열면 가로 스크롤이 생김');
    await dialog.getByRole('button', { name: '취소' }).click();
    await dialog.waitFor({ state: 'detached' });

    await mobile.locator('.bell-button').click();
    const panel = mobile.getByRole('dialog', { name: '알림 목록' });
    await panel.waitFor();
    const pbox = await panel.boundingBox();
    if (pbox.x < 0 || pbox.x + pbox.width > 375.5)
      throw new Error(`알림 패널이 화면을 벗어남: ${JSON.stringify(pbox)}`);
    await mobile.keyboard.press('Escape');
  });
  await step('모바일(375px): 보드는 자체 가로 스크롤로 컬럼을 모두 볼 수 있음', async () => {
    const info = await mobile.evaluate(`(() => {
      const b = document.querySelector('.board');
      return { client: b.clientWidth, scroll: b.scrollWidth };
    })()`);
    if (info.scroll <= info.client)
      throw new Error('보드가 좁은 화면에서 스크롤되지 않음(컬럼이 잘리거나 압축됨)');
    if ((await horizontalOverflow(mobile)) > 1) throw new Error('보드 때문에 페이지가 가로로 넘침');
  });

  // ---- admin
  const admin = await newPage();
  await step('admin: 사용자 관리에서 역할 변경 (member → manager)', async () => {
    await login(admin, 'admin');
    await admin.getByRole('link', { name: '사용자 관리' }).click();
    await admin.getByPlaceholder('이름 또는 이메일로 검색').fill(`ui-${run}-member`);
    const select = admin.getByLabel('ui-member 역할');
    await select.waitFor();
    await select.selectOption('manager');
    // 변경 요청이 반영될 때까지 DB 를 최대 5초 폴링한다.
    for (let i = 0; i < 25; i += 1) {
      const { rows } = await db.query('SELECT role FROM users WHERE email = $1', [
        emailOf('member'),
      ]);
      if (rows[0].role === 'manager') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const { rows } = await db.query('SELECT role FROM users WHERE email = $1', [emailOf('member')]);
    if (rows[0].role !== 'manager') throw new Error(`DB role = ${rows[0].role}`);
  });
  await step('admin: 마지막 admin 은 강등할 수 없고 오류 메시지가 보임', async () => {
    await admin.getByPlaceholder('이름 또는 이메일로 검색').fill('');
    await admin.getByPlaceholder('이름 또는 이메일로 검색').fill(`ui-${run}-admin`);
    const adminCountBefore = (
      await db.query("SELECT count(*)::int n FROM users WHERE role = 'admin' AND is_active")
    ).rows[0].n;
    if (adminCountBefore !== 1) return; // 다른 admin 이 있는 DB 에서는 이 검사를 건너뜀
    await admin.getByLabel('ui-admin 역할').selectOption('member');
    await admin.getByRole('alert').filter({ hasText: '마지막 관리자' }).waitFor();
  });
  await step('admin: 프로젝트 삭제(확인 대화상자) 후 목록에서 사라짐', async () => {
    admin.once('dialog', (d) => d.accept());
    await admin.goto(projectUrl);
    await admin.getByRole('heading', { name: `ui-${run}-개편` }).waitFor();
    // 프로젝트 머리 카드의 삭제 버튼(채팅·투표의 삭제 버튼과 구분)
    await admin
      .locator('.project-main > .card')
      .first()
      .getByRole('button', { name: '삭제' })
      .click();
    await admin.getByRole('heading', { name: '프로젝트', exact: true }).waitFor();
    const { rowCount } = await db.query('SELECT 1 FROM projects WHERE name = $1', [
      `ui-${run}-개편`,
    ]);
    if (rowCount !== 0) throw new Error('DB 에 프로젝트가 남아 있음');
    const tasks = await db.query('SELECT 1 FROM tasks WHERE project_id = $1', [
      projectUrl.split('/').pop(),
    ]);
    if (tasks.rowCount !== 0) throw new Error('프로젝트 삭제 후 작업이 남아 있음 (CASCADE)');
  });
} catch (err) {
  failed += 1;
  console.error('ERROR', err);
} finally {
  await browser.close();
  await cleanup();
  await db.end();
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
