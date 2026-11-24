/**
 * Web Audio API two-tone alternating emergency siren mirroring SirenController.kt
 * (960 Hz / 720 Hz alternating every 400ms, full vs quiet volume).
 */

export type SirenMode = 'off' | 'full' | 'quiet' | 'paused';

class WebSirenEngine {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private toggleInterval: number | null = null;
  private highTone = true;
  private audioEnabled = false;
  private currentMode: SirenMode = 'off';

  setAudioEnabled(enabled: boolean) {
    this.audioEnabled = enabled;
    if (!enabled) {
      this.teardownAudio();
    } else if (this.currentMode === 'full' || this.currentMode === 'quiet') {
      this.applyAudio(this.currentMode);
    }
  }

  setMode(mode: SirenMode) {
    this.currentMode = mode;
    if (!this.audioEnabled) {
      this.teardownAudio();
      return;
    }
    if (mode === 'off' || mode === 'paused') {
      this.teardownAudio();
      return;
    }
    this.applyAudio(mode);
  }

  private applyAudio(mode: 'full' | 'quiet') {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const targetGain = mode === 'full' ? 0.16 : 0.04;

    if (!this.osc || !this.gain) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(960, this.ctx.currentTime);
      gain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      this.osc = osc;
      this.gain = gain;
      this.highTone = true;

      this.toggleInterval = window.setInterval(() => {
        if (!this.osc || !this.ctx) return;
        this.highTone = !this.highTone;
        this.osc.frequency.setValueAtTime(
          this.highTone ? 960 : 720,
          this.ctx.currentTime,
        );
      }, 400);
    } else {
      this.gain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.04);
    }
  }

  private teardownAudio() {
    if (this.toggleInterval !== null) {
      window.clearInterval(this.toggleInterval);
      this.toggleInterval = null;
    }
    if (this.osc) {
      try {
        this.osc.stop();
        this.osc.disconnect();
      } catch {
        // Ignore already stopped oscillator
      }
      this.osc = null;
    }
    if (this.gain) {
      try {
        this.gain.disconnect();
      } catch {
        // Ignore
      }
      this.gain = null;
    }
  }
}

export const webSiren = new WebSirenEngine();
