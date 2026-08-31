type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export class WebShooterAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.72;
  private muted = false;

  async activate(): Promise<boolean> {
    try {
      if (!this.context) {
        const AudioContextClass = window.AudioContext || (window as BrowserWindow).webkitAudioContext;
        if (!AudioContextClass) return false;
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
      }

      if (this.context.state !== 'running') await this.context.resume();
      this.applyVolume();
      return this.context.state === 'running';
    } catch {
      return false;
    }
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyVolume();
  }

  setMuted(value: boolean) {
    this.muted = value;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.012);
  }

  async playShot(): Promise<boolean> {
    const active = await this.activate();
    if (!active || !this.context || !this.master || this.muted) return active;
    const now = this.context.currentTime;

    const snap = this.context.createOscillator();
    const snapGain = this.context.createGain();
    snap.type = 'sawtooth';
    snap.frequency.setValueAtTime(520, now);
    snap.frequency.exponentialRampToValueAtTime(95, now + 0.16);
    snapGain.gain.setValueAtTime(0.0001, now);
    snapGain.gain.exponentialRampToValueAtTime(0.42, now + 0.008);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    snap.connect(snapGain).connect(this.master);
    snap.start(now);
    snap.stop(now + 0.2);

    const length = Math.floor(this.context.sampleRate * 0.24);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      const fade = 1 - index / length;
      data[index] = (Math.random() * 2 - 1) * fade * fade;
    }
    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const noiseGain = this.context.createGain();
    noise.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, now);
    filter.frequency.exponentialRampToValueAtTime(680, now + 0.2);
    filter.Q.value = 1.3;
    noiseGain.gain.setValueAtTime(0.23, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
    noise.connect(filter).connect(noiseGain).connect(this.master);
    noise.start(now);
    return true;
  }

  async playHit(emphasis = false): Promise<boolean> {
    const active = await this.activate();
    if (!active || !this.context || !this.master || this.muted) return active;
    const now = this.context.currentTime;
    const frequencies = emphasis ? [110, 165, 247] : [130, 195];

    frequencies.forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = index === 0 ? 'square' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.55, now + 0.11);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(emphasis ? 0.28 : 0.2, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24 + index * 0.035);
      oscillator.connect(gain).connect(this.master!);
      oscillator.start(now + index * 0.018);
      oscillator.stop(now + 0.35);
    });
    return true;
  }

  async playFinish(): Promise<boolean> {
    const active = await this.activate();
    if (!active || !this.context || !this.master || this.muted) return active;
    const now = this.context.currentTime;
    [196, 247, 294, 392].forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      const start = now + index * 0.08;
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      oscillator.connect(gain).connect(this.master!);
      oscillator.start(start);
      oscillator.stop(start + 0.32);
    });
    return true;
  }

  destroy() {
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
