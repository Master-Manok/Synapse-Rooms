/**
 * Synapse Room - Dual-Timer Engine
 * 1. Count-Up Call Duration Timer (tracks active time in room like WhatsApp/Google Meet)
 * 2. Synchronized Sprint / Pomodoro Countdown Timer with Web Audio chime
 */

class SynapseTimer {
  constructor(syncEngine) {
    this.sync = syncEngine;

    // --- 1. Call Duration Count-Up Timer ---
    this.callStartTime = Date.now();
    this.callTimerInterval = null;
    this.callDisplayEl = document.getElementById('call-duration-display');

    // --- 2. Sprint / Pomodoro Countdown Timer ---
    this.durationMinutes = 25;
    this.totalSeconds = 25 * 60;
    this.remainingSeconds = 25 * 60;
    this.isRunning = false;
    this.countdownInterval = null;

    // DOM Elements
    this.sprintDisplayEl = document.getElementById('timer-display');
    this.toggleBtn = document.getElementById('timer-toggle-btn');
    this.resetBtn = document.getElementById('timer-reset-btn');
    this.progressCircle = document.getElementById('timer-progress-ring');

    this.audioCtx = null;
    this.circumference = 2 * Math.PI * 9; // radius = 9 in SVG

    if (this.progressCircle) {
      this.progressCircle.style.strokeDasharray = `${this.circumference} ${this.circumference}`;
      this.progressCircle.style.strokeDashoffset = '0';
    }

    this.startCallDurationTimer();
    this.bindEvents();
    this.bindSyncEvents();
    this.updateSprintDisplay();
  }

  // --- Call Duration Timer Logic ---
  startCallDurationTimer() {
    if (this.callTimerInterval) clearInterval(this.callTimerInterval);
    this.callTimerInterval = setInterval(() => {
      this.updateCallDisplay();
    }, 1000);
    this.updateCallDisplay();
  }

  updateCallDisplay() {
    if (!this.callDisplayEl) return;
    const elapsedSeconds = Math.floor((Date.now() - this.callStartTime) / 1000);
    const hrs = Math.floor(elapsedSeconds / 3600);
    const mins = Math.floor((elapsedSeconds % 3600) / 60);
    const secs = elapsedSeconds % 60;

    if (hrs > 0) {
      this.callDisplayEl.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
      this.callDisplayEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }

  // --- Sprint Countdown Timer Logic ---
  bindEvents() {
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => {
        if (this.isRunning) {
          this.pause(true);
        } else {
          this.start(true);
        }
      });
    }

    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => {
        this.reset(true);
      });
    }

    // Modal presets
    document.querySelectorAll('.timer-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.mins, 10);
        this.setDuration(mins, true);
        document.getElementById('timer-modal')?.classList.add('hidden');
      });
    });

    const setCustomBtn = document.getElementById('timer-custom-set-btn');
    const customInput = document.getElementById('timer-custom-input');
    if (setCustomBtn && customInput) {
      setCustomBtn.addEventListener('click', () => {
        const val = parseInt(customInput.value, 10);
        if (val && val > 0 && val <= 180) {
          this.setDuration(val, true);
          document.getElementById('timer-modal')?.classList.add('hidden');
        }
      });
    }
  }

  setDuration(minutes, broadcast = false) {
    this.durationMinutes = minutes;
    this.totalSeconds = minutes * 60;
    this.remainingSeconds = this.totalSeconds;
    this.pause(false);
    this.updateSprintDisplay();

    if (broadcast) {
      this.sync.broadcast('timer:sync', {
        action: 'set_duration',
        minutes: this.durationMinutes
      });
      window.synapseApp?.showToast(`⏱️ Sprint timer set to ${minutes} mins`);
    }
  }

  start(broadcast = false) {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.toggleBtn) {
      this.toggleBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      `;
      this.toggleBtn.classList.add('active');
    }

    this.countdownInterval = setInterval(() => {
      if (this.remainingSeconds > 0) {
        this.remainingSeconds--;
        this.updateSprintDisplay();

        if (this.remainingSeconds === 0) {
          this.onTimerComplete();
        }
      }
    }, 1000);

    if (broadcast) {
      this.sync.broadcast('timer:sync', {
        action: 'start',
        remainingSeconds: this.remainingSeconds,
        totalSeconds: this.totalSeconds
      });
    }
  }

  pause(broadcast = false) {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.countdownInterval) clearInterval(this.countdownInterval);

    if (this.toggleBtn) {
      this.toggleBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      `;
      this.toggleBtn.classList.remove('active');
    }

    if (broadcast) {
      this.sync.broadcast('timer:sync', {
        action: 'pause',
        remainingSeconds: this.remainingSeconds
      });
    }
  }

  reset(broadcast = false) {
    this.pause(false);
    this.remainingSeconds = this.totalSeconds;
    this.updateSprintDisplay();

    if (broadcast) {
      this.sync.broadcast('timer:sync', {
        action: 'reset',
        totalSeconds: this.totalSeconds
      });
    }
  }

  updateSprintDisplay() {
    const mins = Math.floor(this.remainingSeconds / 60);
    const secs = this.remainingSeconds % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (this.sprintDisplayEl) {
      this.sprintDisplayEl.textContent = formatted;
    }

    if (this.progressCircle && this.totalSeconds > 0) {
      const fraction = 1 - (this.remainingSeconds / this.totalSeconds);
      const offset = this.circumference * (1 - fraction);
      this.progressCircle.style.strokeDashoffset = offset;
    }
  }

  onTimerComplete() {
    this.pause(false);
    this.playChime();
    window.synapseApp?.showToast('🔔 Sprint timer reached zero!');
  }

  playChime() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime + idx * 0.18);

        gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime + idx * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + idx * 0.18 + 0.9);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(this.audioCtx.currentTime + idx * 0.18);
        osc.stop(this.audioCtx.currentTime + idx * 0.18 + 0.9);
      });
    } catch (e) {}
  }

  bindSyncEvents() {
    this.sync.on('timer:sync', (data) => {
      if (data.action === 'start') {
        this.totalSeconds = data.totalSeconds || this.totalSeconds;
        this.remainingSeconds = data.remainingSeconds || this.remainingSeconds;
        this.updateSprintDisplay();
        this.start(false);
      } else if (data.action === 'pause') {
        if (data.remainingSeconds !== undefined) this.remainingSeconds = data.remainingSeconds;
        this.updateSprintDisplay();
        this.pause(false);
      } else if (data.action === 'reset') {
        this.totalSeconds = data.totalSeconds || this.totalSeconds;
        this.remainingSeconds = this.totalSeconds;
        this.updateSprintDisplay();
        this.pause(false);
      } else if (data.action === 'set_duration') {
        this.setDuration(data.minutes, false);
      } else if (data.action === 'sync_call_start') {
        if (data.callStartTime && data.callStartTime < this.callStartTime) {
          this.callStartTime = data.callStartTime;
          this.updateCallDisplay();
        }
      }
    });

    this.sync.on('peer:join', () => {
      // Sync room call start time so newly connected peers see identical call duration
      this.sync.broadcast('timer:sync', {
        action: 'sync_call_start',
        callStartTime: this.callStartTime
      });

      if (this.isRunning) {
        this.sync.broadcast('timer:sync', {
          action: 'start',
          remainingSeconds: this.remainingSeconds,
          totalSeconds: this.totalSeconds
        });
      }
    });
  }
}

window.SynapseTimer = SynapseTimer;
