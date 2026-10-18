// Progress cues during a capture, for when the screen is under your hand: a haptic tap plus a short beep.
// iPhone Safari does not implement navigator.vibrate, so on iOS 18+ we toggle a hidden native switch control,
// which produces a system haptic. That is best effort; the beep is the reliable cue (silent mode mutes it).
// Must be created inside a tap handler so iOS lets the AudioContext play.

export interface Cues {
  tick: () => void;
  done: () => void;
  dispose: () => void;
}

export function createCues(): Cues {
  let ctx: AudioContext | null = null;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
    void ctx.resume();
  } catch {
    ctx = null;
  }

  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.appendChild(input);
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(label);

  const haptic = () => {
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(150);
      else label.click();
    } catch {
      /* no haptics available */
    }
  };

  const beep = (freq: number, durS: number, delayS = 0) => {
    if (!ctx) return;
    try {
      const t = ctx.currentTime + delayS;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + durS);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + durS + 0.02);
    } catch {
      /* audio unavailable */
    }
  };

  return {
    tick() {
      haptic();
      beep(880, 0.12);
    },
    done() {
      haptic();
      setTimeout(haptic, 250);
      beep(660, 0.15);
      beep(990, 0.2, 0.2);
    },
    dispose() {
      label.remove();
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
