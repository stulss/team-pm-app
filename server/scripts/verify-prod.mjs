// 운영(Production) 읽기 전용 점검. 새 계정을 만들지 않고 "이미 있는 계정"으로 로그인해서 확인한다.
//
//   npm run verify:prod -w server
//   BASE_URL=https://<배포 URL> npm run verify:prod -w server
//
// 계정 정보는 server/.env 에만 둔다(채팅·커밋에 붙이지 말 것):
//   VERIFY_EMAIL_A / VERIFY_PASSWORD_A   필수
//   VERIFY_EMAIL_B / VERIFY_PASSWORD_B   선택 — 있으면 "다른 사람의 프로젝트는 못 본다"까지 확인
//
// 데이터를 만들거나 바꾸거나 지우지 않는다(GET 과 로그인/로그아웃만). 비밀번호·토큰은 출력하지 않는다.
import { randomUUID } from 'node:crypto';

const BASE_ORIGIN = process.env.BASE_URL ?? 'https://team-pm-app-sand.vercel.app';
const BASE = `${BASE_ORIGIN}/api/v1`;

const REACTION_KEYS = ['thumbs_up', 'heart', 'laugh', 'party', 'wow', 'thanks', 'eyes', 'check'];
let failed = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ← ${extra}`}`);
};

const call = async (method, path, { token, cookie, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      ...(cookie && { cookie }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, res };
};

async function login(label, email, password) {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) {
    check(`${label}: 로그인`, false, `HTTP ${r.status} ${r.body?.error?.code ?? ''}`);
    return null;
  }
  const cookie = (r.res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check(`${label}: 로그인 (200, 액세스 토큰 발급)`, Boolean(r.body.accessToken));
  const me = await call('GET', '/auth/me', { token: r.body.accessToken });
  check(
    `${label}: /auth/me 가 로그인한 이메일과 일치`,
    me.body?.user?.email?.toLowerCase() === email.toLowerCase(),
  );
  return { token: r.body.accessToken, cookie, user: me.body?.user };
}

async function readChecks(label, who) {
  const t = who.token;
  const prefs = who.user?.preferences;
  check(
    `${label}: 내 설정(preferences)에 기본값이 채워져 있음 (M22)`,
    Boolean(prefs) &&
      ['assigned', 'due', 'comment', 'mention'].every(
        (k) => typeof prefs.notifications?.[k] === 'boolean',
      ) &&
      ['system', 'light', 'dark'].includes(prefs.theme) &&
      ['indigo', 'blue', 'teal', 'green', 'rose', 'orange'].includes(prefs.accent) &&
      ['comfortable', 'compact'].includes(prefs.density) &&
      ['board', 'list', 'calendar', 'timeline'].includes(prefs.defaultView),
  );
  const projects = await call('GET', '/projects?limit=100', { token: t });
  check(
    `${label}: 프로젝트 목록 (200)`,
    projects.status === 200 && Array.isArray(projects.body?.data),
  );
  const mine = (projects.body?.data ?? []).map((p) => p.id);
  check(
    `${label}: 프로젝트 목록에 mySettings(고정·음소거)가 있음 (M24)`,
    (projects.body?.data ?? []).every(
      (p) => typeof p.mySettings?.muted === 'boolean' && typeof p.mySettings?.pinned === 'boolean',
    ),
  );
  console.log(`      (${label}: 접근 가능한 프로젝트 ${mine.length}개)`);

  const feed = await call('GET', '/feed', { token: t });
  check(
    `${label}: 모아보기 응답 모양`,
    feed.status === 200 &&
      ['today', 'dueTasks', 'mentions', 'notifications', 'activities'].every((k) => k in feed.body),
    JSON.stringify(Object.keys(feed.body ?? {})),
  );
  const feedIds = [...feed.body.dueTasks, ...feed.body.mentions, ...feed.body.activities].map(
    (x) => x.projectId,
  );
  check(
    `${label}: 모아보기는 내 프로젝트의 것만`,
    feedIds.every((id) => mine.includes(id)),
  );

  const search = await call('GET', '/search?q=%EC%9E%91%EC%97%85', { token: t }); // "작업"
  check(
    `${label}: 통합검색 응답 모양`,
    search.status === 200 &&
      ['projects', 'tasks', 'comments', 'chat'].every((k) => k in search.body),
  );
  if (who.user?.role !== 'admin') {
    const found = [...search.body.tasks, ...search.body.comments, ...search.body.chat].map(
      (x) => x.projectId,
    );
    check(
      `${label}: 통합검색은 내 프로젝트의 것만`,
      found.every((id) => mine.includes(id)) &&
        search.body.projects.every((p) => mine.includes(p.id)),
    );
  }
  check(
    `${label}: 검색어 1자는 400`,
    (await call('GET', '/search?q=a', { token: t })).status === 400,
  );

  // M12b: 알림 조회는 작업 없는 알림(채팅 멘션)도 LEFT JOIN 으로 내려줘야 한다
  const notis = await call('GET', '/notifications?limit=20', { token: t });
  const notiRows = notis.body?.data ?? [];
  check(
    `${label}: 알림 목록 (200, projectId 포함)`,
    notis.status === 200 && Array.isArray(notiRows) && notiRows.every((n) => 'projectId' in n),
    `HTTP ${notis.status}`,
  );
  check(
    `${label}: 안 읽은 알림 수 (200)`,
    (await call('GET', '/notifications/unread-count', { token: t })).status === 200,
  );

  // 프로젝트 하나(가장 최근)의 읽기 API
  if (mine.length > 0) {
    const pid = mine[0];
    const [chat, polls, acts, dash] = await Promise.all([
      call('GET', `/projects/${pid}/chat?limit=5`, { token: t }),
      call('GET', `/projects/${pid}/polls`, { token: t }),
      call('GET', `/projects/${pid}/activities?limit=5`, { token: t }),
      call('GET', `/projects/${pid}/dashboard`, { token: t }),
    ]);
    check(
      `${label}: 채팅 목록 (200, data/nextCursor)`,
      chat.status === 200 && 'nextCursor' in chat.body,
    );
    check(
      `${label}: 채팅 메시지에 reactions 가 있고 허용된 키만 쓰임`,
      (chat.body?.data ?? []).every(
        (m) =>
          Array.isArray(m.reactions) &&
          m.reactions.every((r) => REACTION_KEYS.includes(r.key) && r.users.length > 0),
      ),
    );
    check(`${label}: 투표 목록 (200)`, polls.status === 200 && Array.isArray(polls.body?.data));
    const anonymous = (polls.body?.data ?? []).every(
      (p) =>
        !('votes' in p) &&
        p.options.every((o) => Object.keys(o).sort().join() === 'id,label,votes'),
    );
    check(`${label}: 투표 응답에 투표자 정보가 없음(익명 집계)`, anonymous);
    check(`${label}: 활동 기록 (200)`, acts.status === 200 && Array.isArray(acts.body?.data));
    check(`${label}: 대시보드 (200)`, dash.status === 200);

    // M16: 라벨 목록, 작업 응답의 labels·checklist 필드, 체크리스트 읽기
    const labels = await call('GET', `/projects/${pid}/labels`, { token: t });
    check(
      `${label}: 라벨 목록 (200)`,
      labels.status === 200 &&
        Array.isArray(labels.body?.data) &&
        labels.body.data.every((l) => l.id && l.name && l.color),
    );
    const saved = await call('GET', `/projects/${pid}/saved-filters`, { token: t });
    check(
      `${label}: 저장된 필터 목록 (200, 내 것만)`,
      saved.status === 200 &&
        Array.isArray(saved.body?.data) &&
        saved.body.data.every((f) => f.id && f.name && typeof f.filters === 'object'),
    );
    const board = await call('GET', `/projects/${pid}/tasks?limit=5`, { token: t });
    const tasks = board.body?.data ?? [];
    const proj = await call('GET', `/projects/${pid}`, { token: t });
    check(
      `${label}: 프로젝트 키가 있고 작업 응답에 number·key(키-번호)가 있음 (M25)`,
      /^[A-Z][A-Z0-9]{1,9}$/.test(proj.body?.key ?? '') &&
        tasks.every((x) => Number.isInteger(x.number) && x.key === `${proj.body.key}-${x.number}`),
    );
    if (tasks[0]) {
      const byKey = await call('GET', `/tasks/key/${tasks[0].key}`, { token: t });
      check(
        `${label}: 작업 키로 조회하면 같은 작업 (M25)`,
        byKey.status === 200 && byKey.body.id === tasks[0].id,
      );
      const links = await call('GET', `/tasks/${tasks[0].id}/github-links`, { token: t });
      check(
        `${label}: 작업 응답에 pullRequests 배열이 있고 GitHub 연결 목록이 200 (M26)`,
        links.status === 200 &&
          Array.isArray(links.body?.data) &&
          tasks.every((x) => Array.isArray(x.pullRequests)),
      );
    }
    if (label === 'A') {
      const prov = await call('GET', '/auth/providers', {});
      check(
        'GitHub 로그인: /auth/providers 가 공개로 응답 (M27)',
        prov.status === 200 && typeof prov.body?.github === 'boolean',
      );
      const sessions = await call('GET', '/auth/sessions', { token: t, cookie: who.cookie });
      check(
        '로그인한 기기 목록이 열리고 지금 기기가 하나 있음 (M29)',
        sessions.status === 200 &&
          Array.isArray(sessions.body?.data) &&
          sessions.body.data.filter((x) => x.current).length === 1,
        JSON.stringify(sessions.body)?.slice(0, 200),
      );
      const exp = await fetch(`${BASE}/users/me/export`, {
        headers: { authorization: `Bearer ${t}` },
      });
      const dump = await exp.json().catch(() => null);
      check(
        '내 데이터 내려받기가 첨부 파일 JSON 으로 열림 (M30)',
        exp.status === 200 &&
          /attachment/.test(exp.headers.get('content-disposition') ?? '') &&
          Array.isArray(dump?.projects) &&
          dump?.user?.email === who.user?.email,
      );
      const me = await call('GET', '/auth/me', { token: t });
      check(
        '표시 설정(weekStart·timeFormat)이 내 정보에 있음 (M31)',
        ['sun', 'mon'].includes(me.body?.user?.preferences?.weekStart) &&
          ['12h', '24h'].includes(me.body?.user?.preferences?.timeFormat),
      );
      check(
        '내 정보에 githubLogin·emailLogin 이 있음 (M28)',
        me.status === 200 &&
          'githubLogin' in me.body.user &&
          typeof me.body.user.emailLogin === 'boolean',
      );
    }
    // 웹훅은 로그인 없이 서명으로만 통과한다 — 없는 연결은 존재 여부를 알리지 않고 401
    if (label === 'A') {
      const hook = await fetch(`${BASE_ORIGIN}/api/webhooks/github/${randomUUID()}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
        },
        body: '{}',
      });
      check(
        'GitHub 웹훅: 없는 연결·잘못된 서명은 401 (M26)',
        hook.status === 401,
        `HTTP ${hook.status}`,
      );
    }
    check(
      `${label}: 작업 응답에 labels·checklist·startDate·blockedBy 가 있음`,
      board.status === 200 &&
        tasks.every(
          (x) =>
            Array.isArray(x.labels) &&
            Array.isArray(x.blockedBy) &&
            'startDate' in x &&
            typeof x.checklist?.done === 'number' &&
            x.checklist.total >= x.checklist.done,
        ),
    );
    if (tasks[0]) {
      const comments = await call('GET', `/tasks/${tasks[0].id}/comments`, { token: t });
      check(
        `${label}: 댓글에 reactions 가 있고 허용된 키만 쓰임`,
        comments.status === 200 &&
          comments.body.data.every(
            (c) =>
              Array.isArray(c.reactions) && c.reactions.every((r) => REACTION_KEYS.includes(r.key)),
          ),
      );
      const ids = new Set(comments.body?.data?.map((c) => c.id));
      check(
        `${label}: 댓글에 parentId 가 있고 답글은 같은 작업의 최상위 댓글을 가리킴`,
        comments.body.data.every(
          (c) =>
            'parentId' in c &&
            (c.parentId === null ||
              (ids.has(c.parentId) &&
                comments.body.data.find((p) => p.id === c.parentId).parentId === null)),
        ),
      );
      const items = await call('GET', `/tasks/${tasks[0].id}/checklist`, { token: t });
      check(
        `${label}: 체크리스트 (200) 개수가 작업의 total 과 일치`,
        items.status === 200 && items.body.data.length === tasks[0].checklist.total,
      );
      const deps = await call('GET', `/tasks/${tasks[0].id}/dependencies`, { token: t });
      check(
        `${label}: 선행 작업 조회 (200) blockedBy 가 작업 응답과 일치`,
        deps.status === 200 &&
          Array.isArray(deps.body?.blocks) &&
          deps.body.blockedBy.map((x) => x.id).join() ===
            tasks[0].blockedBy.map((x) => x.id).join(),
      );
    }
  }
  return mine;
}

async function main() {
  console.log(`대상: ${BASE_ORIGIN}\n`);

  // --- 로그인 없이 ---
  const health = await call('GET', '/health');
  check(
    'health: ok, 운영 환경',
    health.status === 200 && health.body?.db === 'ok' && health.body?.env === 'production',
    JSON.stringify(health.body),
  );
  const anyId = '00000000-0000-4000-8000-000000000000';
  for (const path of [
    '/feed',
    '/search?q=ab',
    `/projects/${anyId}/chat`,
    `/projects/${anyId}/polls`,
    `/projects/${anyId}/activities`,
  ]) {
    check(
      `로그인 없이 ${path.split('?')[0].replace(anyId, ':id')} 는 401`,
      (await call('GET', path)).status === 401,
    );
  }
  const page = await fetch(BASE_ORIGIN + '/');
  const html = await page.text();
  check('웹 화면(/) 이 HTML 로 열림', page.status === 200 && html.includes('<div id="root">'));
  // 배포된 화면 번들에 최신 기능(명령 팔레트, M21)이 들어 있는지 확인한다
  const bundlePath = html.match(/\/assets\/index-[^"']+\.js/)?.[0];
  const bundle = bundlePath ? await (await fetch(BASE_ORIGIN + bundlePath)).text() : '';
  check('화면 번들에 명령 팔레트가 포함됨 (M21)', bundle.includes('명령 팔레트'));
  const share = await call('GET', '/shared/' + 'x'.repeat(43));
  check('없는 공유 링크는 404', share.status === 404);

  // --- 계정 A ---
  const {
    VERIFY_EMAIL_A: ea,
    VERIFY_PASSWORD_A: pa,
    VERIFY_EMAIL_B: eb,
    VERIFY_PASSWORD_B: pb,
  } = process.env;
  if (!ea || !pa) {
    console.log(
      '\nVERIFY_EMAIL_A / VERIFY_PASSWORD_A 가 없어 로그인 점검은 건너뜁니다. (server/.env 에 설정)',
    );
    failed += 1;
    return;
  }
  const a = await login('A', ea, pa);
  const b = eb && pb ? await login('B', eb, pb) : null;
  let mineA = [];
  let mineB = [];
  if (a) mineA = await readChecks('A', a);
  if (b) mineB = await readChecks('B', b);

  // --- A 와 B 사이: 서로의 프로젝트는 못 본다(둘 다 일반 사용자일 때) ---
  // 일반 사용자 쪽만 "못 본다"를 확인할 수 있다(Admin 은 모든 프로젝트를 볼 수 있다).
  if (a && b) {
    const onlyA = mineA.filter((id) => !mineB.includes(id));
    const onlyB = mineB.filter((id) => !mineA.includes(id));
    console.log(`      (A 만 접근 ${onlyA.length}개, B 만 접근 ${onlyB.length}개)`);
    for (const [who, label, ids] of [
      [b, 'B', onlyA],
      [a, 'A', onlyB],
    ]) {
      if (who.user.role === 'admin') continue;
      for (const id of ids.slice(0, 3)) {
        const rs = await Promise.all(
          ['chat', 'polls', 'activities', 'dashboard', 'labels', 'saved-filters'].map((p) =>
            call('GET', `/projects/${id}/${p}`, { token: who.token }),
          ),
        );
        check(
          `${label}: 접근 권한이 없는 프로젝트의 채팅·투표·활동·대시보드·라벨·저장된 필터는 403`,
          rs.every((r) => r.status === 403),
          rs.map((r) => r.status).join(),
        );
      }
    }
    if (onlyA.length + onlyB.length === 0) {
      console.log('      (두 계정이 모든 프로젝트를 공유해 권한 분리는 확인하지 못했습니다)');
    }
  }

  // --- 정리: 로그인으로 생긴 세션을 닫는다 ---
  for (const [label, who] of [
    ['A', a],
    ['B', b],
  ]) {
    if (!who) continue;
    const out = await call('POST', '/auth/logout', { cookie: who.cookie });
    check(
      `${label}: 로그아웃(세션 폐기)`,
      out.status === 204 || out.status === 200,
      `HTTP ${out.status}`,
    );
  }
}

try {
  await main();
} catch (err) {
  failed += 1;
  console.log(`ERROR ${err.message}`);
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
