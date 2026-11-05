// Test helper (not a test): open a host's event stream on the real server and collect the join requests it pushes.
//   const s = await hostStream(BASE, code, token);  s.status, s.joins (grows as events arrive), s.close()
module.exports = async function hostStream(base, code, token) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/rooms/${code}/events`, { headers: token ? { 'X-Host-Token': token } : {}, signal: ctl.signal });
  const s = { status: res.status, joins: [], ended: false, close: () => ctl.abort() };
  if (!res.ok) return s;
  (async () => {
    const dec = new TextDecoder();
    try {
      for await (const chunk of res.body) for (const m of dec.decode(chunk).matchAll(/^data: (.*)$/gm)) s.joins.push(JSON.parse(m[1]));
    } catch { /* closed by us */ }
    s.ended = true;
  })();
  return s;
};
