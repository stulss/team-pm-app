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

await db.connect();
const browser = await chromium.launch({ executablePath: CHROME, headless: !process.env.HEADED });
const newPage = async () => {
  const ctx = await browser.newContext({
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
      await page.getByRole('heading', { name: '작업 (1)' }).waitFor();
    },
  );
  await step('필터(담당자·검색)와 초기화', async () => {
    await addTask(page, '배포 준비');
    await page.getByRole('heading', { name: '작업 (2)' }).waitFor();

    await page.getByLabel('담당자 필터').selectOption({ label: 'ui-member' });
    await page.getByRole('heading', { name: '작업 (1)' }).waitFor();
    await page.getByRole('row', { name: /디자인 시안/ }).waitFor();
    if ((await page.getByRole('row', { name: /배포 준비/ }).count()) !== 0) {
      throw new Error('담당자 필터가 적용되지 않음');
    }
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await page.getByRole('heading', { name: '작업 (2)' }).waitFor();

    await page.getByLabel('작업 검색').fill('배포');
    await page.getByRole('heading', { name: '작업 (1)' }).waitFor();
    await page.getByRole('row', { name: /배포 준비/ }).waitFor();
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await page.getByRole('heading', { name: '작업 (2)' }).waitFor();
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
    await page.getByRole('heading', { name: '작업 (1)' }).waitFor();
    if ((await page.getByRole('row', { name: /배포 준비/ }).count()) !== 0) {
      throw new Error('삭제된 작업이 남아 있음');
    }
  });

  await step('보관 → 진행 중 목록에서 사라지고 보관됨 탭에 나타남', async () => {
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
