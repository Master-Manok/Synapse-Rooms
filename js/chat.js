/**
 * Synapse Room - Real-Time Chat Column (WhatsApp / Instagram Inspired)
 * Bubble styling, emoji reactions, typing indicators, read receipts, and synthesized audio.
 */

class SynapseChat {
  constructor(containerElement, inputField, sendBtn, syncEngine) {
    this.container = containerElement;
    this.input = inputField;
    this.sendBtn = sendBtn;
    this.sync = syncEngine;

    this.messages = [];
    this.typingTimeout = null;
    this.typingPeers = new Map(); // peerId -> timeout
    this.unreadCount = 0;
    this.isChatActive = true;

    this.audioCtx = null;

    this.bindEvents();
    this.bindSyncEvents();
  }

  bindEvents() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.input.addEventListener('input', () => {
      this.handleTyping();
    });
  }

  handleTyping() {
    if (!this.sync.user) return;
    this.sync.broadcast('chat:typing', {
      user: this.sync.user
    });
  }

  sendMessage() {
    const text = this.input.value.trim();
    if (!text) return;

    const message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      text,
      sender: this.sync.user,
      timestamp: Date.now(),
      reactions: {} // emoji -> [userNames]
    };

    this.messages.push(message);
    this.renderMessage(message, true);
    this.sync.broadcast('chat:message', { message });

    this.input.value = '';
    this.scrollToBottom();
    this.playAudioPop('outgoing');
  }

  renderMessage(msg, isOutgoing) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`;
    bubble.id = msg.id;

    const formattedTime = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderColor = msg.sender.color || '#6366f1';

    bubble.innerHTML = `
      ${!isOutgoing ? `<div class="chat-sender-name" style="color: ${senderColor}">${escapeHtml(msg.sender.name)}</div>` : ''}
      <div class="chat-message-text">${escapeHtml(msg.text)}</div>
      <div class="chat-message-meta">
        <span>${formattedTime}</span>
        ${isOutgoing ? '<span style="color: #53bdeb;">✓✓</span>' : ''}
      </div>
      <div class="reaction-btn-floating">
        <button class="quick-react-btn" data-emoji="❤️">❤️</button>
        <button class="quick-react-btn" data-emoji="👍">👍</button>
        <button class="quick-react-btn" data-emoji="🔥">🔥</button>
        <button class="quick-react-btn" data-emoji="😂">😂</button>
        <button class="quick-react-btn" data-emoji="🚀">🚀</button>
      </div>
      <div class="message-reaction-list" id="reactions_${msg.id}" style="display: none;"></div>
    `;

    // Bind reaction clicks
    bubble.querySelectorAll('.quick-react-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const emoji = btn.dataset.emoji;
        this.addReaction(msg.id, emoji, this.sync.user?.name || 'Me');
      });
    });

    this.container.appendChild(bubble);
    this.updateReactionDisplay(msg);
  }

  addReaction(msgId, emoji, userName, broadcast = true) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;

    if (!msg.reactions[emoji]) {
      msg.reactions[emoji] = [];
    }

    const idx = msg.reactions[emoji].indexOf(userName);
    if (idx > -1) {
      msg.reactions[emoji].splice(idx, 1);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji].push(userName);
    }

    this.updateReactionDisplay(msg);

    if (broadcast) {
      this.sync.broadcast('chat:reaction', {
        msgId,
        emoji,
        userName
      });
      this.playAudioPop('reaction');
    }
  }

  updateReactionDisplay(msg) {
    const container = document.getElementById(`reactions_${msg.id}`);
    if (!container) return;

    const emojis = Object.keys(msg.reactions || {});
    if (emojis.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = emojis.map(e => `
      <span title="${msg.reactions[e].join(', ')}">${e} ${msg.reactions[e].length > 1 ? msg.reactions[e].length : ''}</span>
    `).join(' ');
  }

  renderSystemNotice(text) {
    const notice = document.createElement('div');
    notice.style.alignSelf = 'center';
    notice.style.fontSize = '0.72rem';
    notice.style.background = 'var(--bg-tertiary)';
    notice.style.color = 'var(--text-muted)';
    notice.style.padding = '3px 10px';
    notice.style.borderRadius = 'var(--radius-pill)';
    notice.style.border = '1px solid var(--border-subtle)';
    notice.textContent = text;
    this.container.appendChild(notice);
    this.scrollToBottom();
  }

  showTyping(userName) {
    const typingBar = document.getElementById('typing-indicator-bar');
    if (!typingBar) return;

    typingBar.innerHTML = `
      <span>${escapeHtml(userName)} is typing</span>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    typingBar.style.visibility = 'visible';

    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      typingBar.style.visibility = 'hidden';
      typingBar.innerHTML = '';
    }, 2500);
  }

  scrollToBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Sound synthesis using Web Audio API (Offline, Zero network download)
   */
  playAudioPop(type = 'incoming') {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      const now = this.audioCtx.currentTime;

      if (type === 'incoming') {
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'outgoing') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'reaction') {
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.setValueAtTime(950, now + 0.06);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      }
    } catch(err) {
      // Audio context might be restricted before user gesture
    }
  }

  bindSyncEvents() {
    this.sync.on('chat:message', (payload) => {
      if (payload.message) {
        this.messages.push(payload.message);
        this.renderMessage(payload.message, false);
        this.scrollToBottom();
        this.playAudioPop('incoming');

        const sidebar = document.getElementById('sidebar-drawer');
        const isCollapsed = sidebar && sidebar.classList.contains('collapsed');
        if (!this.isChatActive || isCollapsed) {
          this.unreadCount++;
          const badge = document.getElementById('chat-unread-badge');
          if (badge) {
            badge.style.display = 'inline-block';
            badge.textContent = this.unreadCount;
          }
          const fabBadge = document.getElementById('fab-unread-badge');
          if (fabBadge && isCollapsed) {
            fabBadge.style.display = 'inline-block';
            fabBadge.textContent = this.unreadCount;
          }
        }
      }
    });

    this.sync.on('chat:reaction', (payload) => {
      this.addReaction(payload.msgId, payload.emoji, payload.userName, false);
    });

    this.sync.on('chat:typing', (payload) => {
      if (payload.user && payload.user.name) {
        this.showTyping(payload.user.name);
      }
    });

    this.sync.on('peer:join', (payload) => {
      if (payload.user && payload.user.name) {
        this.renderSystemNotice(`${payload.user.name} joined the room`);
      }
      // Share recent ephemeral messages (up to 20) with newly joined peer
      if (this.messages.length > 0) {
        this.sync.broadcast('chat:history_sync', {
          messages: this.messages.slice(-20)
        });
      }
    });

    this.sync.on('chat:history_sync', (payload) => {
      if (payload.messages && this.messages.length === 0) {
        payload.messages.forEach(msg => {
          if (!this.messages.some(m => m.id === msg.id)) {
            this.messages.push(msg);
            this.renderMessage(msg, msg.sender?.id === this.sync.user?.id);
          }
        });
        this.scrollToBottom();
      }
    });

    this.sync.on('peer:leave', (payload) => {
      if (payload.user && payload.user.name) {
        this.renderSystemNotice(`${payload.user.name} left the room`);
      }
    });
  }
}

window.SynapseChat = SynapseChat;
