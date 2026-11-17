// practice.jsx: a 60-second speaking practice recorder for drill and lesson cards.
//
// Modelled on RiseGuide's speech analyzer: record up to 60 seconds, get a 0 to
// 100 score on pace, filler words, pauses and vocal variety, each marked Good
// or Improve with a tip, then try again. Everything is measured in the browser:
// the Web Speech API gives the transcript (where the browser supports it) and
// a Web Audio analyser gives loudness over time. Nothing is uploaded except the
// numbers and transcript, saved on the card as a "session" so the growth feed
// and the speech-coach routine can adapt to them.

const { useState: pUseState, useRef: pUseRef, useEffect: pUseEffect } = React;

const PRACTICE_MAX_S = 60;
const PRACTICE_FILLERS = ['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'like', 'you know', 'basically', 'actually', 'literally', 'i mean', 'kind of', 'sort of', 'right'];
const PRACTICE_TIPS = {
  pace: { slow: 'A little slow. Speed up through the setup and save the slow, deliberate pace for the one line that matters.', fast: 'Too fast to follow. Slow down on the key sentence and add a pause before it.', ok: 'Comfortable pace for listeners.' },
  fillers: { bad: 'Filler words are standing in for pauses. When you feel one coming, close your mouth and pause instead.', ok: 'Clean: very few filler words.' },
  pauses: { few: 'Hardly any pauses. Pause for a beat before your key point so it lands.', long: 'Some long gaps. Plan your three points before you start so you don\'t lose the thread.', ok: 'Good use of pauses.' },
  variety: { flat: 'Your volume stayed flat. Get louder for energy and softer to pull people in.', ok: 'Good vocal variety.' },
};

function practiceCompute({ seconds, transcript, rms, canTranscribe }) {
  const text = String(transcript || '').trim();
  const lower = ' ' + text.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const found = [];
  for (const f of PRACTICE_FILLERS) {
    const n = lower.split(` ${f} `).length - 1;
    for (let i = 0; i < n; i++) found.push(f);
  }
  // Pauses from loudness: the noise floor is the quiet end of the take, voice
  // is anything well above it. A run of quiet frames (100 ms each) between
  // voiced frames is a pause; leading and trailing silence don't count.
  const sorted = [...rms].sort((a, b) => a - b);
  const pct = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
  const floor = pct(0.15), loud = pct(0.9);
  const thr = floor + 0.22 * Math.max(0.0005, loud - floor);
  const voiced = rms.map(v => v > thr);
  const first = voiced.indexOf(true), last = voiced.lastIndexOf(true);
  let pauses = 0, longPauses = 0, run = 0;
  for (let i = Math.max(0, first); i <= last; i++) {
    if (!voiced[i]) run++;
    else { if (run >= 5) pauses++; if (run >= 25) longPauses++; run = 0; }
  }
  const v = rms.filter((x, i) => voiced[i]);
  const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length));
  const variety = mean > 0 ? Math.min(100, Math.round((sd / mean) * 100)) : 0;
  const mins = Math.max(0.1, seconds / 60);
  const wpm = canTranscribe && words ? Math.round(words / mins) : null;

  const rows = [];
  if (wpm != null) {
    const sc = wpm >= 130 && wpm <= 170 ? 100 : Math.max(30, 100 - 1.5 * (wpm < 130 ? 130 - wpm : wpm - 170));
    rows.push({ key: 'pace', label: 'Pace', value: `${wpm} wpm`, score: sc, tip: wpm < 130 ? PRACTICE_TIPS.pace.slow : wpm > 170 ? PRACTICE_TIPS.pace.fast : PRACTICE_TIPS.pace.ok });
    const perMin = found.length / mins;
    const fs = Math.max(20, Math.round(100 - perMin * 12));
    rows.push({ key: 'fillers', label: 'Filler words', value: `${found.length}`, score: fs, tip: fs >= 75 ? PRACTICE_TIPS.fillers.ok : PRACTICE_TIPS.fillers.bad });
  }
  const pPerMin = pauses / mins;
  const ps = Math.max(30, (pPerMin >= 4 ? 100 : 60 + pPerMin * 10) - longPauses * 15);
  rows.push({ key: 'pauses', label: 'Pauses', value: `${pauses}${longPauses ? ` (${longPauses} long)` : ''}`, score: Math.round(ps), tip: longPauses ? PRACTICE_TIPS.pauses.long : pPerMin < 4 ? PRACTICE_TIPS.pauses.few : PRACTICE_TIPS.pauses.ok });
  const vs = variety >= 25 ? 100 : variety >= 15 ? 75 : 50;
  rows.push({ key: 'variety', label: 'Vocal variety', value: `${variety}`, score: vs, tip: vs >= 75 ? PRACTICE_TIPS.variety.ok : PRACTICE_TIPS.variety.flat });
  const score = Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length);
  return { seconds: Math.round(seconds), words, wpm, fillers: wpm != null ? found.length : null, filler_words: found, pauses, long_pauses: longPauses, volume_variety: variety, score, transcript: text, rows };
}

function FeedPractice({ p, onSaved, onCoach, color = '#047857' }) {
  const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const canRecord = typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  const [phase, setPhase] = pUseState('idle');          // idle | recording | done | error
  const [elapsed, setElapsed] = pUseState(0);
  const [live, setLive] = pUseState('');
  const [result, setResult] = pUseState(null);
  const [err, setErr] = pUseState('');
  const [showText, setShowText] = pUseState(false);
  const rec = pUseRef(null);

  const takes = (p.reactions.sessions || []);
  const lastTake = takes[takes.length - 1];

  const cleanup = () => {
    const r = rec.current; if (!r) return;
    clearInterval(r.tick); clearInterval(r.sampler);
    try { r.sr && r.sr.stop(); } catch {}
    try { r.stream.getTracks().forEach(t => t.stop()); } catch {}
    try { r.ctx.close(); } catch {}
  };
  pUseEffect(() => () => { if (rec.current) { rec.current.stopping = true; cleanup(); } }, []);

  const finish = async () => {
    const r = rec.current; if (!r || r.stopping) return;
    r.stopping = true;
    const seconds = (performance.now() - r.t0) / 1000;
    cleanup();
    // Give the recogniser a moment to deliver its last words.
    await new Promise(res => setTimeout(res, 600));
    const m = practiceCompute({ seconds, transcript: (r.finalText + ' ' + r.interim).trim(), rms: r.rms, canTranscribe: !!r.sr });
    setResult(m); setPhase('done');
    const { rows, ...take } = m;
    onSaved && onSaved(take);
  };

  const start = async () => {
    setErr(''); setResult(null); setLive(''); setElapsed(0); setShowText(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const r = { stream, ctx, an, rms: [], finalText: '', interim: '', t0: performance.now(), stopping: false, sr: null };
      r.sampler = setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; r.rms.push(Math.sqrt(s / buf.length)); }, 100);
      r.tick = setInterval(() => { const e = (performance.now() - r.t0) / 1000; setElapsed(e); if (e >= PRACTICE_MAX_S) finish(); }, 250);
      if (SR) {
        const sr = new SR(); sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || 'en-AU';
        sr.onresult = (ev) => {
          let interim = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const t = ev.results[i][0].transcript;
            if (ev.results[i].isFinal) r.finalText += ' ' + t; else interim += t;
          }
          r.interim = interim; setLive((r.finalText + ' ' + interim).trim().split(/\s+/).slice(-14).join(' '));
        };
        // Some browsers stop listening after a silence: keep it going until the take ends.
        sr.onend = () => { if (!r.stopping) { try { sr.start(); } catch {} } };
        sr.onerror = () => {};
        try { sr.start(); r.sr = sr; } catch {}
      }
      rec.current = r; setPhase('recording');
    } catch (e) {
      setErr(e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it for this site and try again.' : 'Could not start the microphone on this device.');
      setPhase('error');
    }
  };

  const left = Math.max(0, PRACTICE_MAX_S - elapsed);
  const ring = (score) => {
    const c = score >= 75 ? '#16a34a' : score >= 55 ? '#d97706' : '#dc2626', R = 26, L = 2 * Math.PI * R;
    return (
      <svg width="70" height="70" viewBox="0 0 70 70" aria-label={`Speech score ${score} out of 100`}>
        <circle cx="35" cy="35" r={R} fill="none" stroke={withAlpha(c, 0.15)} strokeWidth="7" />
        <circle cx="35" cy="35" r={R} fill="none" stroke={c} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(score / 100) * L} ${L}`} transform="rotate(-90 35 35)" />
        <text x="35" y="41" textAnchor="middle" fontSize="18" fontWeight="800" fill={T.text} fontFamily={T.fontBody}>{score}</text>
      </svg>
    );
  };
  const btn = (primary) => ({ fontFamily: T.fontBody, fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', border: primary ? 'none' : `1px solid ${withAlpha(color, 0.45)}`, background: primary ? color : T.surface, color: primary ? '#fff' : color });

  return (
    <div style={{ margin: '4px 0 14px', padding: 12, borderRadius: 16, background: withAlpha(color, 0.06), border: `1px solid ${withAlpha(color, 0.28)}` }}>
      {phase === 'recording' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#dc2626', animation: 'feedPulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
          <span style={{ fontFamily: T.fontDisplay, fontSize: 26, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', minWidth: 56 }}>0:{String(Math.ceil(left)).padStart(2, '0')}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{live || (SR ? 'Listening…' : 'Recording (this browser can\'t transcribe; pauses and variety only)')}</span>
          <button onClick={finish} style={btn(true)}>■ Stop</button>
        </div>
      ) : phase === 'done' && result ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            {ring(result.score)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Speech score</div>
              <div style={{ fontSize: 12.5, color: T.textMuted }}>{result.seconds}s{result.words ? ` · ${result.words} words` : ''}{lastTake && takes.length > 1 ? ` · take ${takes.length}` : ''}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {result.rows.map(r => (
              <div key={r.key} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1 }}>{r.label} <span style={{ fontWeight: 500, color: T.textMuted }}>· {r.value}</span></span>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: r.score >= 75 ? '#16a34a' : '#d97706', background: withAlpha(r.score >= 75 ? '#16a34a' : '#d97706', 0.1), borderRadius: 999, padding: '2px 8px' }}>{r.score >= 75 ? 'GOOD' : 'IMPROVE'}</span>
                </div>
                {r.score < 75 && <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 3, lineHeight: 1.45 }}>{r.tip}</div>}
              </div>
            ))}
          </div>
          {result.filler_words && result.filler_words.length > 0 && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>Fillers heard: {[...new Set(result.filler_words)].map(f => `"${f}" ×${result.filler_words.filter(x => x === f).length}`).join(', ')}. Browsers often miss "um" and "uh", so the real count may be higher.</div>}
          {result.transcript && <button onClick={() => setShowText(!showText)} style={{ background: 'none', border: 'none', padding: 0, marginTop: 6, color: T.textMuted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', fontFamily: T.fontBody }}>{showText ? 'Hide' : 'Show'} what you said</button>}
          {showText && <div style={{ fontSize: 13, color: T.text, background: T.surface, borderRadius: 10, padding: '8px 10px', marginTop: 4, lineHeight: 1.5 }}>{result.transcript}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button onClick={start} style={btn(true)}>🎙 Try again</button>
            {onCoach && <button onClick={onCoach} style={btn(false)}>🧑‍🏫 Coach me on this take</button>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {canRecord && <button onClick={start} style={btn(true)}>🎙 Record 60 seconds</button>}
          <button onClick={() => onSaved && onSaved(null)} style={btn(false)}>✓ Did it without recording</button>
          {lastTake && <span style={{ fontSize: 12, color: T.textMuted }}>Last take: {lastTake.score}/100{lastTake.wpm ? ` · ${lastTake.wpm} wpm` : ''}{lastTake.fillers != null ? ` · ${lastTake.fillers} fillers` : ''}</span>}
          {err && <div style={{ width: '100%', fontSize: 12.5, color: T.overdue }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
