// Real server.js with TRUST_PROXY=1, as on the live host behind Cloudflare: each player is told apart by the
// CF-Connecting-IP header Cloudflare sets, not by a client-supplied X-Forwarded-For.
const { spawn } = require('child_process');
const ROOT = require('path').join(__dirname, '..') + '/';
const PORT = 3919, BASE = `http://localhost:${PORT}`;
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const create = (headers) => fetch(`${BASE}/api/rooms`, { method: 'POST', headers });
const hostStream = require('./host_stream');

(async () => {
  const server = spawn('node', [ROOT + 'server.js', String(PORT)], { cwd: ROOT, env: { ...process.env, TRUST_PROXY: '1' } });
  await new Promise((r) => server.stdout.on('data', (d) => d.toString().includes('http://localhost') && r()));
  try {
    // Two players behind the same proxy each get their own open-room allowance (3).
    const streams = [];
    const open = async (headers) => { const r = await create(headers); if (r.ok) { const b = await r.json(); streams.push(await hostStream(BASE, b.code, b.token)); } return r.status; };
    const a = [], b = [];
    for (let i = 0; i < 4; i++) a.push(await open({ 'CF-Connecting-IP': '203.0.113.1' }));
    for (let i = 0; i < 3; i++) b.push(await open({ 'CF-Connecting-IP': '203.0.113.2' }));
    check('a 4th room from the same player is refused', a.join() === '200,200,200,429', a.join());
    check('...but another player behind the same proxy still gets theirs', b.join() === '200,200,200', b.join());
    // A client can't dodge the limit by sending its own X-Forwarded-For: Cloudflare's header wins.
    const spoof = await open({ 'CF-Connecting-IP': '203.0.113.1', 'X-Forwarded-For': '198.51.100.9' });
    check('a spoofed X-Forwarded-For is ignored when CF-Connecting-IP is there', spoof === 429, String(spoof));
    // Without Cloudflare in front, X-Forwarded-For is still used (another proxy, e.g. nginx).
    check('falls back to X-Forwarded-For with no CF header', (await open({ 'X-Forwarded-For': '198.51.100.7' })) === 200);
    streams.forEach((s) => s.close());
  } finally { server.kill(); }
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
