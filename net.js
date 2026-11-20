// A minimal peer-to-peer link over WebRTC, with NO server: the two players swap a connection
// code by hand (copy/paste, chat, whatever). That swap is called "signaling" and is the only
// thing WebRTC doesn't do for you. Step 4 in the README replaces it with a room-code server.
//
//   Host:  const link = createLink();  const offer = await link.host();   // send `offer` to the guest
//          await link.accept(answerFromGuest);
//   Guest: const link = createLink();  const answer = await link.join(offerFromHost); // send `answer` back
//   Both:  link.onopen = ...; link.onmessage = (obj) => ...; link.send(obj);

// STUN lets each browser learn its public address so two players behind home routers can connect directly.
// When no direct route works (corporate firewalls, hidden .local addresses, VPNs) a TURN server relays the traffic.
// The room server hands out TURN credentials per connection (fetchIce, server.js /api/ice); without it, STUN only.
const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
async function fetchIce(url, headers) {
  try {
    const c = await (await fetch(url, { headers })).json();
    if (Array.isArray(c?.iceServers)) return c;
  } catch { /* no server, or it said no: direct connections still work */ }
  return STUN;
}

// Wait until the browser has found all its network candidates, so the code we hand out is complete.
// (The alternative, "trickle ICE", sends candidates one by one and needs a live signaling channel.)
// Capped at 2s: where a firewall eats STUN, Chrome/Safari keep retrying for ~40s (longer than a join waits), while the
// candidates that matter arrive in well under a second. The description holds whatever was gathered so far.
function waitForIce(pc) {
  return new Promise((resolve) => {
    setTimeout(resolve, 2000);
    if (pc.iceGatheringState === 'complete') resolve();
    else pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve());
  });
}

const encode = (desc) => btoa(JSON.stringify(desc)); // description -> one pasteable line
const decode = (code) => JSON.parse(atob(code.trim()));

function createLink(ice = STUN) {
  const pc = new RTCPeerConnection(ice);
  // Two channels over the one connection:
  //   channel      reliable + ordered   (TCP-like)  inputs, level, "rematch": must arrive, in order
  //   stateChannel unreliable+unordered (UDP-like)  game snapshots: a lost one is useless once a newer
  //                                                  one exists, and waiting to retry it would only add lag
  const link = {
    pc, channel: null, stateChannel: null,
    onopen: null, onclose: null, onmessage: null,
    send(obj) { if (link.channel?.readyState === 'open') link.channel.send(JSON.stringify(obj)); },
    // Skip the send if the browser still has 64KB queued: dropping a snapshot beats lagging behind.
    sendState(obj) {
      const c = link.stateChannel;
      if (c?.readyState === 'open' && c.bufferedAmount < 65536) c.send(JSON.stringify(obj));
    },
  };

  function wire(channel) {
    const isState = channel.label === 'state';
    if (isState) link.stateChannel = channel;
    else link.channel = channel;
    channel.onopen = () => { if (!isState) link.onopen?.(); }; // "open" = the reliable channel is up
    channel.onclose = () => { if (!isState) link.onclose?.(); };
    channel.onmessage = (e) => link.onmessage?.(JSON.parse(e.data));
  }
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') link.onclose?.(); };

  link.host = async () => {
    wire(pc.createDataChannel('game'));
    wire(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    return encode(pc.localDescription);
  };
  link.accept = (answerCode) => pc.setRemoteDescription(decode(answerCode));

  link.join = async (offerCode) => {
    pc.ondatachannel = (e) => wire(e.channel);
    await pc.setRemoteDescription(decode(offerCode));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);
    return encode(pc.localDescription);
  };
  return link;
}
