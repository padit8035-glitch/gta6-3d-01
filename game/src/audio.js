// Vice Point 3D — sound, all synthesized with WebAudio: no audio files.
// The world calls these methods by name; before the first user gesture the
// context is locked, so every method simply does nothing until unlock().
export function createAudio() {
  const audio = {
    ctx: null,
    master: null,
    engineOsc: null,
    engineGain: null,
    sirenOsc: null,
    sirenGain: null,
    sirenTimer: null,
    muted: false,
  };

  function ensure() {
    if (audio.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.5;
      audio.master.connect(audio.ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ensure() || audio.muted) return;
    const t = audio.ctx.currentTime;
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol || 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(audio.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol, lowpass) {
    if (!ensure() || audio.muted) return;
    const t = audio.ctx.currentTime;
    const len = Math.max(1, Math.floor(audio.ctx.sampleRate * dur));
    const buffer = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const source = audio.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = audio.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass || 1200;
    const gain = audio.ctx.createGain();
    gain.gain.setValueAtTime(vol || 0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio.master);
    source.start(t);
  }

  return {
    unlock() {
      if (ensure() && audio.ctx.state === 'suspended') audio.ctx.resume();
    },
    setMuted(muted) {
      audio.muted = muted;
      if (audio.master) audio.master.gain.value = muted ? 0 : 0.5;
    },
    engine(level) {
      if (!ensure() || audio.muted) return;
      if (level <= 0.02) {
        if (audio.engineOsc) {
          audio.engineOsc.stop();
          audio.engineOsc = null;
          audio.engineGain = null;
        }
        return;
      }
      if (!audio.engineOsc) {
        audio.engineOsc = audio.ctx.createOscillator();
        audio.engineOsc.type = 'sawtooth';
        audio.engineGain = audio.ctx.createGain();
        audio.engineGain.gain.value = 0.04;
        const filter = audio.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        audio.engineOsc.connect(filter);
        filter.connect(audio.engineGain);
        audio.engineGain.connect(audio.master);
        audio.engineOsc.start();
      }
      const t = audio.ctx.currentTime;
      // setTargetAtTime smooths the pitch and volume toward the new speed
      // instead of jumping — a jump each frame would buzz.
      audio.engineOsc.frequency.setTargetAtTime(50 + level * 140, t, 0.08);
      audio.engineGain.gain.setTargetAtTime(0.02 + level * 0.05, t, 0.08);
    },
    siren(on) {
      if (!ensure()) return;
      if (!on) {
        if (audio.sirenOsc) {
          audio.sirenOsc.stop();
          audio.sirenOsc = null;
          audio.sirenGain = null;
        }
        if (audio.sirenTimer) {
          clearInterval(audio.sirenTimer);
          audio.sirenTimer = null;
        }
        return;
      }
      if (audio.sirenOsc) return;
      audio.sirenOsc = audio.ctx.createOscillator();
      audio.sirenOsc.type = 'sine';
      audio.sirenOsc.frequency.value = 700;
      audio.sirenGain = audio.ctx.createGain();
      audio.sirenGain.gain.value = 0.035;
      audio.sirenOsc.connect(audio.sirenGain);
      audio.sirenGain.connect(audio.master);
      audio.sirenOsc.start();
      // Two-tone siren: the oscillator alternates between 650 and 950 Hz
      // every 380 ms, which reads as the classic police wail.
      let sirenHigh = false;
      audio.sirenTimer = setInterval(() => {
        if (!audio.sirenOsc) return;
        sirenHigh = !sirenHigh;
        audio.sirenOsc.frequency.setTargetAtTime(sirenHigh ? 950 : 650, audio.ctx.currentTime, 0.05);
      }, 380);
    },
    shot() { noise(0.12, 0.35, 3200); tone(160, 0.08, 'square', 0.12, 60); },
    punch() { tone(120, 0.12, 'sine', 0.3, 55); noise(0.08, 0.18, 600); },
    pickup() { tone(880, 0.1, 'sine', 0.18); setTimeout(() => tone(1318, 0.14, 'sine', 0.18), 90); },
    mission() {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.2), i * 110));
    },
    steal() { tone(300, 0.15, 'square', 0.12, 180); },
    crash() { noise(0.25, 0.3, 900); tone(90, 0.2, 'sine', 0.25, 40); },
    thud() { tone(80, 0.18, 'sine', 0.3, 35); },
    explosion() { noise(0.7, 0.45, 500); tone(70, 0.6, 'sine', 0.35, 28); },
    busted() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.2), i * 180)); },
    wasted() { [330, 262, 196, 131].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.2), i * 200)); },
    click() { tone(700, 0.05, 'square', 0.1); },
  };
}
