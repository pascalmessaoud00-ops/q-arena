// Q-Arena – Online-Duell ohne eigenen Server: WebRTC-Datenkanal, Verbindungsdaten werden als Code ausgetauscht.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

const b64u = bytes => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };

async function pack(obj) {
  const json = JSON.stringify(obj);
  if ('CompressionStream' in self) {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'QA1z' + b64u(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return 'QA1p' + b64u(new TextEncoder().encode(json));
}
async function unpack(code) {
  code = String(code).replace(/\s+/g, '');
  const kind = code.slice(0, 4), bytes = unb64u(code.slice(4));
  if (kind === 'QA1z') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
  }
  if (kind === 'QA1p') return JSON.parse(new TextDecoder().decode(bytes));
  throw new Error('Unbekanntes Codeformat');
}

export class Link {
  constructor(h) { this.h = h; this.pc = null; this.dc = null; }
  _pc() {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onconnectionstatechange = () => this.h.state && this.h.state(pc.connectionState);
    return pc;
  }
  _wire(dc) {
    this.dc = dc;
    dc.onopen = () => this.h.open && this.h.open();
    dc.onclose = () => this.h.close && this.h.close();
    dc.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.h.msg && this.h.msg(m); };
  }
  async _gather() {
    const pc = this.pc;
    if (pc.iceGatheringState === 'complete') return;
    await new Promise(res => {
      const t = setTimeout(res, 5000);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  // Gastgeber: erzeugt den Einladungscode
  async host() {
    this.pc = this._pc();
    this._wire(this.pc.createDataChannel('duel', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this._gather();
    return pack({ t: 'o', sdp: this.pc.localDescription.sdp });
  }
  // Gast: nimmt die Einladung an und erzeugt den Antwortcode
  async join(code) {
    const o = await unpack(code);
    if (o.t !== 'o') throw new Error('Das ist kein Einladungscode.');
    this.pc = this._pc();
    this.pc.ondatachannel = e => this._wire(e.channel);
    await this.pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this._gather();
    return pack({ t: 'a', sdp: this.pc.localDescription.sdp });
  }
  // Gastgeber: übernimmt den Antwortcode
  async finish(code) {
    const a = await unpack(code);
    if (a.t !== 'a') throw new Error('Das ist kein Antwortcode.');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
  }
  send(o) { if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(o)); }
  close() { try { this.dc && this.dc.close(); this.pc && this.pc.close(); } catch { /* bereits zu */ } this.dc = this.pc = null; }
}

export async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const nonce = () => [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, '0')).join('');
