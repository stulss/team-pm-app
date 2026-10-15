// 실제 브라우저(설치된 Chrome)로 핵심 화면 흐름을 점검한다. (M2 시점: 인증 + 프로젝트/멤버/사용자 관리)
//
//   서버(4000)와 클라이언트(5173)를 띄운 뒤:  npm run e2e
//   BASE_URL=https://<배포 URL> VERCEL_BYPASS=<토큰> npm run e2e   # 배포본 점검
//   HEADED=1 npm run e2e                                          # 브라우저 창을 보면서 실행
//
// 생성하는 데이터는 모두 ui-*@example.test / "ui-" 프로젝트이며 종료 시 삭제한다. (DIRECT_URL 필요: server/.env)
import { existsSync } from 'node:fs';
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
const newPage = async () => {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    extraHTTPHeaders: process.env.VERCEL_BYPASS
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS }
      : {},
  });
  const page = await ctx.newPage();
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
    await page.getByRole('heading', { name: '프로젝트', exact: true }).waitFor();
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
    // 화면 밖의 카드는 마우스 이벤트를 받지 못하므로 먼저 스크롤한다.
    await source.scrollIntoViewIfNeeded();
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
  await step('member: 프로젝트가 보이고, 생성/수정/멤버 추가 UI 가 없음', async () => {
    await login(member, 'member');
    await member.getByRole('link', { name: `ui-${run}-개편` }).waitFor();
    if ((await member.getByRole('button', { name: '새 프로젝트' }).count()) !== 0) {
      throw new Error('member 에게 새 프로젝트 버튼이 보임');
    }
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
    await admin.getByRole('button', { name: '삭제' }).click();
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
