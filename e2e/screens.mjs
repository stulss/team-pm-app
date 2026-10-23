// 화면 디자인 점검용: 실제로 쓰는 것처럼 데모 데이터를 채우고 주요 화면을 캡처한다.
//
//   서버(4000)와 클라이언트(5173)를 띄운 뒤:  npm run screens
//   OUT=<폴더> npm run screens        # 캡처를 저장할 폴더 (기본: e2e/.screens)
//   THEME=dark npm run screens        # 다크 모드로 캡처
//
// 생성하는 데이터는 모두 demo-*@example.test 이며 종료 시 삭제한다. (DIRECT_URL 필요: server/.env)
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const API = `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1`;
const OUT =
  process.env.OUT ??
  new URL('./.screens', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light';
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('Chrome/Edge 를 찾을 수 없습니다. CHROME_PATH 를 지정하세요.');
mkdirSync(OUT, { recursive: true });

const run = Date.now().toString(36);
const PASSWORD = 'S3cure!pass';
const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
const emailOf = (k) => `demo-${run}-${k}@example.test`;

const call = async (method, path, token, body) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return json;
};
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
};

async function cleanup() {
  await db.query(
    `DELETE FROM projects WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'demo-%@example.test')`,
  );
  await db.query(`DELETE FROM users WHERE email LIKE 'demo-%@example.test'`);
}

async function seed() {
  const people = {};
  for (const [k, name] of [
    ['admin', '김관리'],
    ['pm', '이서연'],
    ['dev', '박지훈'],
    ['design', '최하늘'],
    ['qa', '정민수'],
  ]) {
    const r = await call('POST', '/auth/register', null, {
      email: emailOf(k),
      password: PASSWORD,
      name,
    });
    people[k] = { id: r.user.id, name };
  }
  await db.query('UPDATE users SET role = $2 WHERE id = $1', [people.admin.id, 'admin']);
  await db.query('UPDATE users SET role = $2 WHERE id = $1', [people.pm.id, 'manager']);
  const tokens = {};
  for (const k of Object.keys(people)) {
    tokens[k] = (
      await call('POST', '/auth/login', null, { email: emailOf(k), password: PASSWORD })
    ).accessToken;
  }

  const project = await call('POST', '/projects', tokens.pm, {
    name: '모바일 앱 2.0 리뉴얼',
    description: '신규 온보딩과 결제 개편을 포함한 2.0 릴리스. 11월 말 출시 목표.',
    memberIds: [people.dev.id, people.design.id, people.qa.id],
  });
  await call('POST', '/projects', tokens.pm, {
    name: '마케팅 캠페인 Q4',
    description: '연말 프로모션 준비',
    memberIds: [people.design.id],
  });
  await call('POST', '/projects', tokens.pm, {
    name: '고객 지원 개선',
    memberIds: [people.qa.id, people.dev.id],
  });

  const label = async (name, color) =>
    await call('POST', `/projects/${project.id}/labels`, tokens.pm, { name, color });
  // 반복 작업(M41) 화면용
  await call('POST', `/projects/${project.id}/recurrences`, tokens.pm, {
    title: '주간 회의록 정리',
    frequency: 'weekly',
    weekday: 1,
    dueAfterDays: 3,
  });
  await call('POST', `/projects/${project.id}/recurrences`, tokens.pm, {
    title: '월말 정산 확인',
    frequency: 'monthly',
    monthDay: 31,
    priority: 'high',
  });
  const L = {
    feature: await label('기능', 'blue'),
    bug: await label('버그', 'red'),
    design: await label('디자인', 'purple'),
    urgent: await label('긴급', 'orange'),
    docs: await label('문서', 'gray'),
  };

  const mk = async (who, title, extra) =>
    call('POST', `/projects/${project.id}/tasks`, tokens[who], { title, ...extra });
  const t = {};
  t.onboard = await mk('pm', '신규 온보딩 플로우 설계', {
    description: '첫 실행 시 3단계 안내와 권한 요청 화면.',
    status: 'done',
    priority: 'high',
    assigneeId: people.design.id,
    startDate: day(-12),
    dueDate: day(-5),
  });
  t.api = await mk('pm', '결제 API 연동', {
    description: 'PG사 SDK 연동 및 결제 실패 처리.',
    status: 'in_progress',
    priority: 'urgent',
    assigneeId: people.dev.id,
    startDate: day(-3),
    dueDate: day(4),
  });
  t.pay = await mk('pm', '결제 화면 UI 구현', {
    status: 'todo',
    priority: 'high',
    assigneeId: people.dev.id,
    startDate: day(2),
    dueDate: day(9),
  });
  t.icons = await mk('pm', '아이콘 세트 정리', {
    status: 'review',
    priority: 'medium',
    assigneeId: people.design.id,
    startDate: day(-6),
    dueDate: day(1),
  });
  t.crash = await mk('qa', '안드로이드 13 크래시 재현', {
    description: '특정 기기에서 앱 시작 직후 종료.',
    status: 'in_progress',
    priority: 'urgent',
    assigneeId: people.qa.id,
    dueDate: day(-1),
  });
  t.push = await mk('pm', '푸시 알림 문구 검수', {
    status: 'todo',
    priority: 'low',
    assigneeId: people.pm.id,
    dueDate: day(6),
  });
  t.release = await mk('pm', '릴리스 노트 작성', {
    status: 'todo',
    priority: 'medium',
    dueDate: day(14),
  });
  t.perf = await mk('dev', '앱 시작 속도 개선', {
    status: 'review',
    priority: 'medium',
    assigneeId: people.dev.id,
    startDate: day(-2),
    dueDate: day(3),
  });
  t.a11y = await mk('qa', '접근성 점검 (스크린리더)', {
    status: 'todo',
    priority: 'medium',
    assigneeId: people.qa.id,
  });
  t.store = await mk('pm', '스토어 스크린샷 준비', {
    status: 'done',
    priority: 'low',
    assigneeId: people.design.id,
    startDate: day(-9),
    dueDate: day(-4),
  });

  const lab = (task, ...ls) =>
    call('PUT', `/tasks/${task.id}/labels`, tokens.pm, { labelIds: ls.map((l) => l.id) });
  await lab(t.onboard, L.design, L.feature);
  await lab(t.api, L.feature, L.urgent);
  await lab(t.pay, L.feature, L.design);
  await lab(t.icons, L.design);
  await lab(t.crash, L.bug, L.urgent);
  await lab(t.perf, L.feature);
  await lab(t.release, L.docs);

  const items = async (task, list, doneCount) => {
    for (const [i, content] of list.entries()) {
      const r = await call('POST', `/tasks/${task.id}/checklist`, tokens.pm, { content });
      if (i < doneCount)
        await call('PATCH', `/tasks/${task.id}/checklist/${r.item.id}`, tokens.pm, {
          isDone: true,
        });
    }
  };
  await items(
    t.api,
    ['SDK 키 발급', '결제 요청 구현', '실패·취소 처리', '영수증 화면 연결', '샌드박스 테스트'],
    2,
  );
  await items(t.onboard, ['와이어프레임', '카피 확정', '개발 인계'], 3);
  await items(t.crash, ['재현 환경 구성', '로그 수집', '원인 분석'], 1);

  await call('POST', `/tasks/${t.pay.id}/dependencies`, tokens.pm, { dependsOnId: t.api.id });
  await call('POST', `/tasks/${t.release.id}/dependencies`, tokens.pm, { dependsOnId: t.pay.id });

  const c1 = await call('POST', `/tasks/${t.api.id}/comments`, tokens.pm, {
    body: `@${people.dev.name} 결제 실패 케이스 우선순위를 먼저 정리해 주세요.`,
    mentionIds: [people.dev.id],
  });
  await call('POST', `/tasks/${t.api.id}/comments`, tokens.dev, {
    body: '네, 오늘 중으로 공유할게요. 샌드박스 키는 받았습니다.',
    parentId: c1.id,
  });
  const c2 = await call('POST', `/tasks/${t.api.id}/comments`, tokens.qa, {
    body: '테스트 시나리오 초안을 문서에 올렸습니다.',
  });
  await call('PUT', `/comments/${c1.id}/reactions/thumbs_up`, tokens.dev);
  await call('PUT', `/comments/${c1.id}/reactions/eyes`, tokens.qa);
  await call('PUT', `/comments/${c2.id}/reactions/party`, tokens.pm);
  await call('PUT', `/comments/${c2.id}/reactions/party`, tokens.dev);

  for (const [who, body] of [
    ['pm', '오늘 스탠드업은 10시입니다. 결제 연동 이슈 위주로 이야기해요.'],
    ['dev', '결제 SDK 샌드박스 연결 완료했습니다 🙌'],
    ['design', '아이콘 세트 검토 요청 올렸어요. 리뷰 부탁드립니다.'],
    ['qa', `@${people.dev.name} 안드로이드 13 크래시 로그 공유드립니다.`],
  ]) {
    const mentionIds = body.includes('@') ? [people.dev.id] : [];
    const m = await call('POST', `/projects/${project.id}/chat`, tokens[who], { body, mentionIds });
    if (who === 'dev')
      await call('PUT', `/projects/${project.id}/chat/${m.id}/reactions/party`, tokens.pm);
  }

  const poll = await call('POST', `/projects/${project.id}/polls`, tokens.pm, {
    question: '출시일을 언제로 할까요?',
    options: ['11월 25일(화)', '11월 28일(금)', '12월 2일(화)'],
  });
  await call('PUT', `/projects/${project.id}/polls/${poll.id}/vote`, tokens.dev, {
    optionIds: [poll.options[1].id],
  });
  await call('PUT', `/projects/${project.id}/polls/${poll.id}/vote`, tokens.design, {
    optionIds: [poll.options[1].id],
  });
  await call('PUT', `/projects/${project.id}/polls/${poll.id}/vote`, tokens.qa, {
    optionIds: [poll.options[0].id],
  });

  await call('POST', `/projects/${project.id}/saved-filters`, tokens.pm, {
    name: '내 긴급 작업',
    filters: { assignee: 'me', priority: 'urgent' },
  });
  return { people, project, t, tokens };
}

await db.connect();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  await cleanup();
  const { people, project, t } = await seed();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: THEME,
    locale: 'ko-KR',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const shot = async (name, opts = {}) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${THEME}-${name}.png`, fullPage: opts.full ?? false });
    console.log('saved', `${THEME}-${name}.png`);
  };

  // 로그인 전 화면
  await page.goto(`${BASE}/login`);
  await shot('01-login');
  await page.goto(`${BASE}/register`);
  await shot('02-register');

  await page.goto(`${BASE}/login`);
  await page.getByLabel('이메일').fill(emailOf('pm'));
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByRole('link', { name: '프로젝트', exact: true }).waitFor();
  await shot('03-projects', { full: true });

  await page.goto(`${BASE}/projects/${project.id}`);
  await page.getByRole('tab', { name: '보드' }).click();
  await page.locator('[data-task-id]').first().waitFor();
  await shot('04-board', { full: true });
  for (const [tab, file] of [
    ['목록', '05-list'],
    ['캘린더', '06-calendar'],
    ['타임라인', '07-timeline'],
  ]) {
    await page.getByRole('tab', { name: tab }).click();
    await shot(file, { full: true });
  }
  await page.getByRole('tab', { name: '보드' }).click();
  await page.locator('[data-task-id]', { hasText: '결제 API 연동' }).click();
  await page.getByRole('dialog').getByLabel('제목').waitFor();
  await shot('08-task-modal');
  await page.getByRole('dialog').evaluate((d) => d.scrollTo?.(0, d.scrollHeight));
  await page
    .getByRole('dialog')
    .locator('.modal-body')
    .evaluate((el) => (el.scrollTop = el.scrollHeight))
    .catch(() => {});
  await shot('09-task-modal-bottom');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+K');
  await page.getByRole('dialog', { name: '명령 팔레트' }).waitFor();
  await page.keyboard.type('결제');
  await shot('10-palette');
  await page.keyboard.press('Escape');

  await page.locator('.bell-button').click();
  await shot('11-notifications');
  await page.locator('.bell-button').click();

  for (const [path, file] of [
    ['/dashboard', '12-dashboard'],
    ['/feed', '13-feed'],
    ['/tasks/mine', '14-mine'],
    ['/search?q=결제', '15-search'],
    ['/settings', '16-settings'],
  ]) {
    await page.goto(`${BASE}${path}`);
    await shot(file, { full: true });
  }

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: THEME,
    locale: 'ko-KR',
    isMobile: !process.env.NOMOBILE,
  });
  const m = await mobile.newPage();
  m.setDefaultTimeout(10000);
  await m.goto(`${BASE}/login`);
  await m.getByLabel('이메일').fill(emailOf('pm'));
  await m.getByLabel('비밀번호').fill(PASSWORD);
  await m.getByRole('button', { name: '로그인' }).click();
  await m.getByRole('link', { name: '프로젝트', exact: true }).waitFor();
  await m.waitForTimeout(500);
  await m.screenshot({ path: `${OUT}/${THEME}-20-mobile-projects.png` });
  await m.goto(`${BASE}/projects/${project.id}`);
  await m.locator('[data-task-id]').first().waitFor();
  await m.waitForTimeout(500);
  await m.screenshot({ path: `${OUT}/${THEME}-21-mobile-board.png` });
  // 가로 스크롤이 생기면(= 페이지가 화면보다 넓으면) 바로 알 수 있게 확인한다
  const overflow = await m.evaluate('document.documentElement.scrollWidth - window.innerWidth');
  if (overflow !== 0) console.log('WARN 모바일 화면에 가로 스크롤이 있습니다:', overflow);
  console.log('saved mobile');
  void people;
  void t;
} catch (err) {
  console.error('ERROR', err);
  process.exitCode = 1;
} finally {
  await cleanup();
  await db.end();
  await browser.close();
}
