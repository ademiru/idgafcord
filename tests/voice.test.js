import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const modulePath = new URL('../src-tauri/src/client/voice.js', import.meta.url);
const source = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') :
  rust.slice(rust.indexOf('  function textOf('), rust.indexOf('  // Kendine ait, tasarımlı'));

function harness(settings = {}) {
  let now = 100000, nextId = 1;
  const timers = new Map(), recognizers = [], nodes = [], messages = [], native = [];
  function timer(fn, delay, repeat = false) {
    const id = nextId++;
    timers.set(id, { fn, at: now + delay, delay, repeat });
    return id;
  }
  function tick(ms) {
    const end = now + ms;
    for (let guard = 0; guard < 10000; guard++) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) { now = end; return; }
      const [id, t] = due;
      now = t.at;
      if (t.repeat) t.at += t.delay; else timers.delete(id);
      t.fn();
    }
    throw new Error('Timer loop');
  }
  class Recognition {
    constructor() { this.starts = 0; this.aborts = 0; recognizers.push(this); }
    start() { this.starts++; }
    abort() { this.aborts++; }
    stop() { this.aborts++; }
    emit(name, event = {}) { this['on' + name]?.(event); }
    result(text, final = true, alternatives = [], index = 0) {
      const result = [{ transcript: text, confidence: 0.95 }, ...alternatives.map(transcript => ({ transcript, confidence: 0.1 }))];
      result.isFinal = final;
      const results = Array(index).fill(Object.assign([{ transcript: '' }], { isFinal: true }));
      results.push(result);
      this.emit('result', { resultIndex: index, results });
    }
  }
  const context = vm.createContext({
    window: { SpeechRecognition: Recognition, addEventListener() {} },
    document: {
      contains: el => nodes.includes(el), querySelectorAll: () => nodes,
      querySelector: () => null, addEventListener() {}, removeEventListener() {}, hidden: false,
    },
    innerHeight: 800, innerWidth: 1280,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => timer(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => timer(fn, delay, true), clearInterval: id => timers.delete(id),
    get: (key, fallback) => settings[key] ?? fallback,
    ison: (key, fallback) => (settings[key] ?? fallback) === '1',
    nativeCmd: (...args) => native.push(args), lang: 'tr', C: { warn: 'yellow' }, tr: s => s, say: msg => messages.push(msg), micBadge: null,
  });
  vm.runInContext(source, context);
  vm.runInContext(`ensureVoiceHud=function(){};voiceHudState=function(){};voiceHudFlash=function(msg){say(msg);};`, context);
  function button(label, attrs = {}, onClick) {
    const el = {
      tagName: 'BUTTON', textContent: '', clicks: 0, disabled: false, isConnected: true,
      getAttribute: key => attrs[key] ?? (key === 'aria-label' ? label : null),
      querySelector: () => null, closest: selector => selector.includes('ldc') ? null : el,
      getBoundingClientRect: () => ({ width: 32, height: 32, left: 200, top: 740, right: 232, bottom: 772 }),
      click() { this.clicks++; onClick?.(el, attrs); },
    };
    nodes.push(el);
    return el;
  }
  return { context, tick, recognizers, button, messages, settings, nodes, native, event: (phase, action, session = context.voiceSession) => context.window.__LDC_voiceEvent({ session, phase, action }) };
}

test('unmute is idempotent when the button already says Mute', () => {
  const h = harness(); const b = h.button('Mute');
  h.context.setMic('unmute'); h.tick(500); h.context.setMic('unmute');
  assert.equal(b.clicks, 0);
});

test('explicit pressed state overrides a static microphone label', () => {
  const h = harness(); const b = h.button('Mute', { 'aria-pressed': 'true' });
  h.context.setMic('mute');
  assert.equal(b.clicks, 0);
  assert.equal(h.context.micMuteState(b), 'muted');
});

test('an unrelated button at bottom left is never used as a microphone', () => {
  const h = harness(); const b = h.button('User settings');
  assert.equal(h.context.setMic('mute'), false);
  assert.equal(b.clicks, 0);
});

test('unknown microphone state cannot be guessed and clicked', () => {
  const h = harness(); const b = h.button('Microphone');
  assert.equal(h.context.setMic('unmute'), false);
  assert.equal(b.clicks, 0);
});

test('voice uses only the native offline bridge, never browser recognition', () => {
  const h = harness({ voiceMute: '1' });
  h.context.startVoice();
  assert.equal(h.recognizers.length, 0);
  assert.equal(h.native.at(-1)[0], 'voice_start');
  assert.equal(JSON.parse(h.native.at(-1)[2]).language, 'tr');
  assert.equal(h.context.voiceStatusText(), 'Başlatılıyor…');
  h.event('listening');
  assert.equal(h.context.voiceStatusText(), 'Yerel dinleme');
  const requests = h.native.length;
  h.context.startVoice(); h.tick(65000);
  assert.equal(h.native.length, requests);
});

test('startup times out and asks the native worker to release the microphone', () => {
  const h = harness({ voiceMute: '1' });
  h.context.startVoice(); h.event('starting'); h.tick(16000);
  assert.equal(h.native.at(-1)[0], 'voice_stop');
  assert.match(h.context.voiceStatusText(), /Durdu/);
});

test('manual restart invalidates stale native callbacks', () => {
  const h = harness({ voiceMute: '1' });
  h.context.startVoice(); const old = h.context.voiceSession;
  h.context.restartVoice(); h.event('listening', undefined, old);
  assert.equal(h.context.voiceStatusText(), 'Başlatılıyor…');
  assert.notEqual(h.context.voiceSession, old);
});

test('stopping cannot be undone by a late native command', () => {
  const h = harness({ voiceMute: '1' }); const b = h.button('Mute');
  h.context.startVoice(); const old = h.context.voiceSession;
  h.context.stopVoice(); h.event('listening', 'mute', old); h.tick(60000);
  assert.equal(b.clicks, 0);
  assert.equal(h.context.voiceStatusText(), 'Kapalı');
});

test('native errors and missing packs remain stopped without retry loops', () => {
  for (const phase of ['error', 'missing']) {
    const h = harness({ voiceMute: '1' });
    h.context.startVoice(); h.event(phase); const requests = h.native.length; h.tick(60000);
    assert.equal(h.native.length, requests);
    assert.notEqual(h.context.voiceStatusText(), 'Yerel dinleme');
  }
});

test('a mic command reports success only after Discord confirms its state', () => {
  const h = harness({ voiceMute: '1' });
  const attrs = { 'aria-pressed': 'false' };
  const b = h.button('Mute', attrs, () => { h.context.setTimeout(() => attrs['aria-pressed'] = 'true', 240); });
  h.context.startVoice(); h.event('listening', 'mute');
  assert.equal(b.clicks, 1);
  assert.ok(!h.messages.includes('Mikrofon kapatıldı'));
  h.tick(300); assert.ok(h.messages.includes('Mikrofon kapatıldı'));
});

test('failed or delayed Discord state changes are never learned as success', () => {
  const h = harness({ voiceMute: '1' }); const b = h.button('Mute');
  h.context.startVoice(); h.event('listening', 'mute'); h.tick(1300);
  assert.equal(b.clicks, 1);
  assert.ok(!h.messages.includes('Mikrofon kapatıldı'));
  assert.ok(h.messages.includes('Mikrofon değişikliği doğrulanamadı.'));
  assert.equal(h.context.micMuteState(b), 'live');
});

test('duplicate native commands cannot click during an unconfirmed transition', () => {
  const h = harness({ voiceMute: '1' }); const b = h.button('Mute');
  h.context.startVoice(); h.event('listening', 'mute'); h.event('listening', 'mute');
  assert.equal(b.clicks, 1);
});

test('ambiguous microphone candidates are not clicked', () => {
  const h = harness(); const a = h.button('Mute'), b = h.button('Mute');
  assert.equal(h.context.setMic('mute'), false);
  assert.equal(a.clicks + b.clicks, 0);
});
test('leave voice confirms disappearance and repeated commands click only once',()=>{
  const h=harness({voiceMute:'1'});const leave=h.button('Disconnect',{},button=>{h.context.setTimeout(()=>{h.nodes.splice(h.nodes.indexOf(button),1);button.isConnected=false;},100);});
  h.context.startVoice();h.event('listening','leave');h.event('listening','leave');assert.equal(leave.clicks,1);assert.ok(!h.messages.includes('Ses kanalından ayrıldın'));h.tick(400);assert.ok(h.messages.includes('Ses kanalından ayrıldın'));
});
test('audio commands are idempotent and unknown or ambiguous controls are untouched',()=>{
  const h=harness({voiceMute:'1'});const attrs={'aria-pressed':'false'},audio=h.button('Deafen',attrs,()=>{attrs['aria-pressed']='true';});h.context.startVoice();h.event('listening','undeafen');assert.equal(audio.clicks,0);h.event('listening','deafen');h.tick(200);assert.equal(audio.clicks,1);h.event('listening','deafen');assert.equal(audio.clicks,1);
  const ambiguous=harness({voiceMute:'1'});const first=ambiguous.button('Disconnect'),second=ambiguous.button('Disconnect');ambiguous.context.startVoice();ambiguous.event('listening','leave');assert.equal(first.clicks+second.clicks,0);
});
