// Web Audio API Telephony Sound Synthesizer & Speech Synthesis Engine
class TelephonyAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.soundEnabled = true;
    this.speechEnabled = true;
    this.activeTone = null;
    this.isRinging = false;
    this.ringInterval = null;
    this.voices = [];
    this.agentVoice = null;
    this.vendorVoice = null;
    this.initialized = false;
    this.isPlayingFullCall = false;
    this.fullCallTimer = null;

    // Load available speech synthesis voices
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.loadVoices();
      window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio not supported or blocked:', e);
    }
  }

  loadVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    this.voices = window.speechSynthesis.getVoices();
    
    // Pick suitable voices for Agent (VoxPact) vs Vendor
    const englishVoices = this.voices.filter(v => v.lang.startsWith('en'));
    if (englishVoices.length > 0) {
      // Find distinct voices
      this.agentVoice = englishVoices.find(v => v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('David') || v.name.includes('Guy')) || englishVoices[0];
      this.vendorVoice = englishVoices.find(v => v !== this.agentVoice && (v.name.includes('Zira') || v.name.includes('Jenny') || v.name.includes('Mark') || v.name.includes('UK'))) || englishVoices[1] || englishVoices[0];
    }
  }

  // Play realistic Dual-Tone Multi-Frequency (DTMF) dial tone
  playDTMF(key) {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.audioCtx) return;

    const dtmfFrequencies = {
      '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
      '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
      '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
      '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
    };

    const freqs = dtmfFrequencies[key] || [440, 350];
    const now = this.audioCtx.currentTime;
    const duration = 0.12;

    const osc1 = this.audioCtx.createOscillator();
    const osc2 = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc1.frequency.setValueAtTime(freqs[0], now);
    osc2.frequency.setValueAtTime(freqs[1], now);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
  }

  // Play North American / ITU standard ringback tone (440Hz + 480Hz modulated)
  startRingback() {
    if (!this.soundEnabled || this.isRinging) return;
    this.init();
    if (!this.audioCtx) return;

    this.isRinging = true;

    const playRingCycle = () => {
      if (!this.isRinging) return;
      const now = this.audioCtx.currentTime;
      const ringDuration = 1.6;

      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.setValueAtTime(0.05, now + ringDuration - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + ringDuration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + ringDuration);
      osc2.stop(now + ringDuration);
    };

    playRingCycle();
    this.ringInterval = setInterval(() => {
      if (this.isRinging) playRingCycle();
    }, 4000);
  }

  stopRingback() {
    this.isRinging = false;
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  // Telephony call connect tone / chime
  playConnectChime() {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  }

  // Tactic alert sound (e.g., when a concession or anchor is triggered)
  playTacticSound(type = 'concession') {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    if (type === 'concession') {
      // Upbeat success arpeggio
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
      osc.frequency.setValueAtTime(1046.50, now + 0.24); // C6
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (type === 'anchor') {
      // Resonant deep tone
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(146.83, now + 0.3);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'warning') {
      // Red flag / warning chime
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.setValueAtTime(280, now + 0.12);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  }

  // Synthesize realistic speech
  speak(text, speaker = 'agent', onEndCallback = null) {
    if (!this.speechEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onEndCallback) setTimeout(onEndCallback, 1200);
      return;
    }

    try {
      window.speechSynthesis.cancel(); // Stop current speech
      const utterance = new SpeechSynthesisUtterance(text);

      if (speaker === 'agent') {
        utterance.rate = 1.05;
        utterance.pitch = 0.95; // Confident, authoritative VoxPact tone
        if (this.agentVoice) utterance.voice = this.agentVoice;
      } else {
        utterance.rate = 1.0;
        utterance.pitch = 1.1; // Distinct vendor tone
        if (this.vendorVoice) utterance.voice = this.vendorVoice;
      }

      utterance.onend = () => {
        if (onEndCallback) onEndCallback();
      };

      utterance.onerror = (e) => {
        console.warn('Speech synthesis error:', e);
        if (onEndCallback) onEndCallback();
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis failed:', err);
      if (onEndCallback) setTimeout(onEndCallback, 1000);
    }
  }

  stopSpeech() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.stopRingback();
  }

  // Replay complete call sequence step by step for human review
  playFullCallSequence(transcript, onStepChange, onComplete) {
    this.stopFullCallPlayback();
    if (!transcript || transcript.length === 0) return;

    this.isPlayingFullCall = true;
    let stepIndex = 0;

    const playNextStep = () => {
      if (!this.isPlayingFullCall) return;
      if (stepIndex >= transcript.length) {
        this.isPlayingFullCall = false;
        if (onComplete) onComplete();
        return;
      }

      const item = transcript[stepIndex];
      if (onStepChange) onStepChange(stepIndex, item);

      // Play cue for concessions or anchors
      if (item.isKeyEvidence) this.playTacticSound('concession');
      else if (item.speaker === 'agent') this.playTacticSound('anchor');

      this.speak(item.text, item.speaker, () => {
        if (!this.isPlayingFullCall) return;
        stepIndex++;
        this.fullCallTimer = setTimeout(playNextStep, 1100);
      });
    };

    playNextStep();
  }

  stopFullCallPlayback() {
    this.isPlayingFullCall = false;
    if (this.fullCallTimer) {
      clearTimeout(this.fullCallTimer);
      this.fullCallTimer = null;
    }
    this.stopSpeech();
  }

  // Generate downloadable .wav audio file using Web Audio API buffer
  generateCallWavBlob(callRecord) {
    const sampleRate = 22050; // standard telephony sample rate
    const duration = 8; // 8 seconds of synthesized telecom verification audio
    const totalSamples = sampleRate * duration;
    
    // Create an offline buffer
    const buffer = new Float32Array(totalSamples);
    
    // Synthesize telecom DTMF + ring + carrier tone sequence into buffer
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
      
      if (t < 0.6) {
        // DTMF tones
        sample += 0.25 * Math.sin(2 * Math.PI * 697 * t) + 0.25 * Math.sin(2 * Math.PI * 1209 * t);
      } else if (t >= 0.8 && t < 2.4) {
        // North American Ringback
        sample += 0.2 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t));
      } else if (t >= 2.6 && t < 3.0) {
        // Connect chime
        sample += 0.3 * Math.sin(2 * Math.PI * 880 * t) * Math.exp(-3 * (t - 2.6));
      } else if (t >= 3.2) {
        // Telephony carrier hum & speech bandpass noise
        sample += 0.04 * (Math.random() * 2 - 1) + 0.08 * Math.sin(2 * Math.PI * 300 * t);
      }
      buffer[i] = Math.max(-1, Math.min(1, sample));
    }

    // Convert Float32Array buffer to WAV Blob
    return this.encodeWAV(buffer, sampleRate);
  }

  encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    // RIFF identifier
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    // format chunk identifier
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    // data chunk identifier
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Write PCM samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  }
}

export const telephonyAudio = new TelephonyAudioEngine();
