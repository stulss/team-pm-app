import { Router } from 'express';
import { unauthorized } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { inProcessRequest } from '../../utils/inProcessRequest.js';
import { tokenLimiter } from '../../middleware/rateLimit.js';
import { loadApiToken } from '../apiTokens/guard.js';
import { TOOLS, ToolError, toolDescriptors } from './tools.js';

// MCP(Model Context Protocol) 서버. 요청 하나에 응답 하나인 상태 없는 JSON-RPC 2.0 over HTTP 만 지원한다
// (서버리스에서는 세션·SSE 스트림을 붙들 수 없다).
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_RESULT_CHARS = 60_000;

const INSTRUCTIONS =
  '팀 프로젝트 관리 앱입니다. list_projects 로 프로젝트 id 를 확인한 뒤 작업을 조회·생성·수정하세요. ' +
  '작업은 TPM-12 같은 작업 키로 지정할 수 있습니다. 토큰 권한 안에서, 토큰 주인이 볼 수 있는 데이터만 다룹니다.';

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// 같은 프로세스에서 /api/v1 라우터를 그대로 호출한다. 토큰을 그대로 실어 보내므로 범위·권한 검사도 그대로 거친다.
function makeApi(req) {
  return async (method, path, { query, body } = {}) => {
    const qs = query
      ? new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
      : '';
    const res = await inProcessRequest(req.app, {
      method,
      path: `/api/v1${path}${qs ? `?${qs}` : ''}`,
      headers: { authorization: req.headers.authorization, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      ip: req.ip,
    });
    let json = null;
    if (res.body) {
      try {
        json = JSON.parse(res.body);
      } catch {
        json = null;
      }
    }
    if (res.status >= 400) {
      throw new ToolError(json?.error?.message ?? `요청이 실패했습니다. (HTTP ${res.status})`);
    }
    return json;
  };
}

async function callTool(req, params) {
  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) return { error: fail(null, -32602, `알 수 없는 도구입니다: ${params?.name}`).error };
  const parsed = tool.input.safeParse(params.arguments ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return text(
      `인자가 올바르지 않습니다: ${issue.path.join('.') || '(root)'} ${issue.message}`,
      true,
    );
  }
  try {
    const result = await tool.run(parsed.data, makeApi(req));
    const out = JSON.stringify(result ?? { ok: true });
    return text(
      out.length > MAX_RESULT_CHARS
        ? `${out.slice(0, MAX_RESULT_CHARS)}\n…(결과가 길어 잘렸습니다. 조건을 좁혀 다시 조회하세요)`
        : out,
      false,
    );
  } catch (err) {
    if (err instanceof ToolError) return text(err.message, true);
    logger.error({ err: err.message, tool: tool.name }, 'mcp tool failed');
    return text('도구를 실행하지 못했습니다.', true);
  }
}

const text = (message, isError) => ({
  result: { content: [{ type: 'text', text: message }], isError },
});

export const mcpRouter = Router();

mcpRouter.use(async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const token = await loadApiToken(req);
    if (!token) {
      res.set('WWW-Authenticate', 'Bearer realm="team-pm-app"');
      throw unauthorized('API 토큰(tpm_…)이 필요합니다.');
    }
    req.apiToken = token;
    next();
  } catch (err) {
    next(err);
  }
});
mcpRouter.use(tokenLimiter);

mcpRouter.get('/', (req, res) => {
  res
    .set('Allow', 'POST')
    .status(405)
    .json(fail(null, -32600, 'POST 로 요청해 주세요.'));
});

mcpRouter.post('/', async (req, res) => {
  const msg = req.body;
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return res
      .status(400)
      .json(fail(msg?.id ?? null, -32600, '단건 JSON-RPC 2.0 요청이 아닙니다.'));
  }
  if (msg.id === undefined || msg.id === null) return res.status(202).end(); // 알림은 응답이 없다

  const { id, method, params } = msg;
  switch (method) {
    case 'initialize': {
      const wanted = params?.protocolVersion;
      return res.json(
        ok(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(wanted) ? wanted : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'team-pm-app', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        }),
      );
    }
    case 'ping':
      return res.json(ok(id, {}));
    case 'tools/list':
      return res.json(ok(id, { tools: toolDescriptors(req.apiToken.scope) }));
    case 'tools/call': {
      const { result, error } = await callTool(req, params);
      return res.json(error ? { jsonrpc: '2.0', id, error } : ok(id, result));
    }
    default:
      return res.json(fail(id, -32601, `지원하지 않는 메서드입니다: ${method}`));
  }
});
