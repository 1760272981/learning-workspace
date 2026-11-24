// 沙箱部署后真实验收：只打印安全结果与请求 ID，不打印令牌/cookie/密码明文。
const ORIGIN = 'https://learning-workspace-multi-v5d3qx7uw3a.qoder.zone';
const BASE = `${ORIGIN}/functions/v1/app`;
const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
const userA = `accept_a_${suffix}`;
const userB = `accept_b_${suffix}`;
const password = 'accept-pass-2026';
// 公开演示凭据（将随论坛帖公布），非私人密钥。
const demoUser = 'demo';
const demoPassword = 'demo-2026';

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`PASS ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

async function req(method, path, { body, cookie, bearer, origin = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (origin) headers.Origin = ORIGIN;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  let json = null;
  try { json = await response.json(); } catch {}
  const setCookie = response.headers.get('set-cookie') || '';
  const jar = setCookie.split(';')[0];
  return { status: response.status, json, jar, setCookie, requestId: response.headers.get('x-request-id') || '' };
}

function candidate(outputRef) {
  return {
    project: 'sandbox-accept',
    title: '沙箱验收：发布后读回',
    kind: 'concept',
    branch: '验收',
    output_ref: outputRef,
    judging: '判断发布后的云端写入与读回是否一致',
    evidence: '部署后真实 HTTP 请求与读回比对',
    consequence: '不一致则验收失败并停止交付',
    verify_action: '重跑本脚本核对状态码与读回内容',
    sources: [{ title: 'Qoder Sites 文档', url: 'https://docs.qoder.com/qoder/sites.md' }],
  };
}

const health = await req('GET', '/api/health');
check('匿名 health 200', health.status === 200, health.requestId);

const anonStore = await req('GET', '/api/store');
check('未登录 store 401', anonStore.status === 401 && anonStore.json?.error === 'login_required', anonStore.requestId);

const anonWrite = await req('POST', '/api/submit', { body: candidate('anon-v1') });
check('未登录 submit 401', anonWrite.status === 401, anonWrite.requestId);

const noOrigin = await req('POST', '/api/login', { body: { username: userA, password }, origin: false });
check('缺 Origin 的 POST 403（网关或函数层）', noOrigin.status === 403 && (noOrigin.json?.error === 'origin_forbidden' || noOrigin.json?.code === 'sites_gateway_origin_forbidden'), noOrigin.requestId);

const regA = await req('POST', '/api/register', { body: { username: userA, password } });
check('注册 A 201 带会话 Cookie', regA.status === 201 && regA.jar.startsWith('__Host-lw_session='), regA.requestId);
const cookieA = regA.jar;

const badLogin = await req('POST', '/api/login', { body: { username: userA, password: 'wrong-pass-2026' } });
check('错密码 401 固定码', badLogin.status === 401 && badLogin.json?.error === 'invalid_credentials', badLogin.requestId);

const dupReg = await req('POST', '/api/register', { body: { username: userA, password } });
check('重复注册 409', dupReg.status === 409 && dupReg.json?.error === 'username_taken', dupReg.requestId);

const subA = await req('POST', '/api/submit', { body: candidate('accept-v1'), cookie: cookieA });
check('A 提交 accepted', subA.status === 200 && subA.json?.status === 'accepted', subA.requestId);
const conceptId = subA.json?.node_id;

const storeA = await req('GET', '/api/store', { cookie: cookieA });
const projA = storeA.json?.projects?.['sandbox-accept'];
check('A 读回含概念与产出计数', storeA.status === 200 && projA?.concepts?.length === 1 && projA?.outputs?.['accept-v1'] === 1, storeA.requestId);

const regB = await req('POST', '/api/register', { body: { username: userB, password } });
check('注册 B 201', regB.status === 201, regB.requestId);
const cookieB = regB.jar;

const storeB = await req('GET', '/api/store', { cookie: cookieB });
check('B 读不到 A 的项目', storeB.status === 200 && !storeB.json?.projects?.['sandbox-accept'], storeB.requestId);

const markB = await req('POST', '/api/mark', { body: { project: 'sandbox-accept', concept_id: conceptId, status: 'understood' }, cookie: cookieB });
check('B 标记 A 概念 404', markB.status === 404 && markB.json?.error === 'concept_not_found', markB.requestId);

const delB = await req('POST', '/api/delete', { body: { project: 'sandbox-accept', concept_id: conceptId }, cookie: cookieB });
check('B 删除 A 概念 404', delB.status === 404 && delB.json?.error === 'concept_not_found', delB.requestId);

const tokA = await req('POST', '/api/tokens', { body: { label: 'accept-token' }, cookie: cookieA });
check('A 创建个人令牌 201', tokA.status === 201 && typeof tokA.json?.token === 'string', tokA.requestId);
const tokenA = tokA.json?.token;

const bearerSub = await req('POST', '?action=submit', { body: candidate('accept-v2'), bearer: tokenA });
check('Bearer 提交 linked（MCP 同契约）', bearerSub.status === 200 && bearerSub.json?.status === 'linked', bearerSub.requestId);

const bearerMe = await req('GET', '/api/me', { bearer: tokenA });
check('Bearer me 200 且为 A', bearerMe.status === 200 && bearerMe.json?.user?.username === userA, bearerMe.requestId);

const listA = await req('GET', '/api/tokens', { cookie: cookieA });
const tokenId = listA.json?.tokens?.[0]?.id;
check('令牌列表不含明文', listA.status === 200 && listA.json?.tokens?.every((t) => !t.token) && !!tokenId, listA.requestId);

const revoke = await req('DELETE', `/api/tokens/${tokenId}`, { cookie: cookieA });
check('吊销令牌 200', revoke.status === 200, revoke.requestId);

const revokedMe = await req('GET', '/api/me', { bearer: tokenA });
check('吊销后 Bearer 401', revokedMe.status === 401 && revokedMe.json?.error === 'token_revoked', revokedMe.requestId);

const storeA2 = await req('GET', '/api/store', { cookie: cookieA });
check('A 读回两条产出计数', storeA2.json?.projects?.['sandbox-accept']?.outputs?.['accept-v2'] === 1, storeA2.requestId);

const logout = await req('POST', '/api/logout', { cookie: cookieA });
check('登出 200 清 Cookie', logout.status === 200 && logout.setCookie.includes('Max-Age=0'), logout.requestId);

const oldCookie = await req('GET', '/api/store', { cookie: cookieA });
check('登出后旧 Cookie 401', oldCookie.status === 401, oldCookie.requestId);

const big = await req('POST', '/api/submit', { body: { ...candidate('big-v1'), evidence: 'x'.repeat(40 * 1024) }, cookie: cookieB });
check('超 32KB 413', big.status === 413 && big.json?.error === 'payload_too_large', big.requestId);

const demo = await req('POST', '/api/register', { body: { username: demoUser, password: demoPassword } });
check('演示账号注册 201（或已存在 409）', demo.status === 201 || demo.status === 409, demo.requestId);

const demoLogin = await req('POST', '/api/login', { body: { username: demoUser, password: demoPassword } });
check('演示账号登录 200', demoLogin.status === 200, demoLogin.requestId);

console.log(`\nSANDBOX ACCEPT ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);