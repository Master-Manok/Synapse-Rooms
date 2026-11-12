/**
 * Synapse Room - Master Controller & Application State
 * Coordinates Whiteboard, Chat, P2P Ephemeral File Streaming, Dual-Timers,
 * Follow User Perspective (Spotlight), and Pro Multi-Format Exporting.
 */

class SynapseApp {
  constructor() {
    this.user = this.loadOrGenerateUser();
    this.roomId = null;
    this.whiteboard = null;
    this.chat = null;
    this.files = null;
    this.timer = null;

    this.initUI();
    this.checkInitialRoomRoute();
  }

  loadOrGenerateUser() {
    const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];
    const animals = ['Falcon', 'Fox', 'Otter', 'Panda', 'Lynx', 'Phoenix', 'Dolphin', 'Badger'];
    const adjectives = ['Swift', 'Bright', 'Cosmic', 'Solar', 'Lunar', 'Nimble', 'Clever', 'Astral'];

    const storedUser = sessionStorage.getItem('synapse_local_user');
    if (storedUser) {
      try { return JSON.parse(storedUser); } catch(e) {}
    }

    const randomName = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]}`;
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const newUser = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      name: randomName,
      color: randomColor,
      avatarInitials: randomName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
    };

    sessionStorage.setItem('synapse_local_user', JSON.stringify(newUser));
    return newUser;
  }

  checkInitialRoomRoute() {
    let urlRoom = null;
    if (window.location.hash) {
      urlRoom = window.location.hash.replace('#', '').trim();
    } else {
      const params = new URLSearchParams(window.location.search);
      urlRoom = params.get('room');
    }

    if (urlRoom) {
      this.joinRoom(urlRoom);
    } else {
      this.showJoinModal();
    }
  }

  joinRoom(roomId) {
    this.roomId = roomId.toUpperCase();
    window.location.hash = this.roomId;

    const roomText = document.getElementById('current-room-id');
    if (roomText) roomText.textContent = this.roomId;

    window.synapseSync.init(this.roomId, this.user);

    const canvas = document.getElementById('whiteboard-canvas');
    const overlay = document.getElementById('canvas-overlay');
    this.whiteboard = new SynapseWhiteboard(canvas, overlay, window.synapseSync);

    const chatContainer = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input-text');
    const chatSendBtn = document.getElementById('send-message-btn');
    this.chat = new SynapseChat(chatContainer, chatInput, chatSendBtn, window.synapseSync);

    const dropzone = document.getElementById('file-dropzone');
    const fileList = document.getElementById('shared-file-list');
    const fileInput = document.getElementById('hidden-file-input');
    this.files = new SynapseFileManager(dropzone, fileList, fileInput, window.synapseSync);

    this.timer = new SynapseTimer(window.synapseSync);

    document.getElementById('join-modal')?.classList.add('hidden');
    this.showToast(`✨ Connected to room: ${this.roomId}`);
  }

  initUI() {
    // Top Bar Invite Link Button
    document.getElementById('copy-room-link-btn')?.addEventListener('click', () => {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        this.showToast('🔗 Invite link copied to clipboard!');
      }).catch(() => {
        prompt('Copy room link:', url);
      });
    });

    // Theme Toggle
    const themeBtn = document.getElementById('toggle-theme-btn');
    themeBtn?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('synapse_theme', next);
    });

    const savedTheme = localStorage.getItem('synapse_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Right Sidebar & Mobile Drawer Toggles
    const sidebar = document.getElementById('sidebar-drawer');
    const backdrop = document.getElementById('sidebar-backdrop');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const closeSidebarMobileBtn = document.getElementById('close-sidebar-mobile-btn');
    const mobileChatFab = document.getElementById('mobile-chat-fab');

    const openSidebar = () => {
      sidebar?.classList.remove('collapsed');
      toggleSidebarBtn?.classList.add('active');
      backdrop?.classList.remove('hidden');
      const fabBadge = document.getElementById('fab-unread-badge');
      if (fabBadge) fabBadge.style.display = 'none';
    };

    const closeSidebar = () => {
      sidebar?.classList.add('collapsed');
      toggleSidebarBtn?.classList.remove('active');
      backdrop?.classList.add('hidden');
    };

    // On mobile screens, start with sidebar collapsed so canvas gets full viewport
    if (window.innerWidth <= 768) {
      closeSidebar();
    }

    toggleSidebarBtn?.addEventListener('click', () => {
      if (sidebar?.classList.contains('collapsed')) {
        openSidebar();
      } else {
        closeSidebar();
      }
    });

    closeSidebarMobileBtn?.addEventListener('click', closeSidebar);
    backdrop?.addEventListener('click', closeSidebar);
    mobileChatFab?.addEventListener('click', () => {
      openSidebar();
      chatTabBtn?.click();
    });

    // Sidebar 3-Tab Switching (Chat vs Files vs Collaborators)
    const chatTabBtn = document.getElementById('tab-chat-btn');
    const filesTabBtn = document.getElementById('tab-files-btn');
    const usersTabBtn = document.getElementById('tab-users-btn');

    const chatPane = document.getElementById('chat-pane');
    const filesPane = document.getElementById('files-pane');
    const usersPane = document.getElementById('users-pane');

    const activateTab = (activeBtn, activePane) => {
      [chatTabBtn, filesTabBtn, usersTabBtn].forEach(b => b?.classList.remove('active'));
      [chatPane, filesPane, usersPane].forEach(p => p?.classList.add('hidden'));

      activeBtn?.classList.add('active');
      activePane?.classList.remove('hidden');
    };

    chatTabBtn?.addEventListener('click', () => {
      activateTab(chatTabBtn, chatPane);
      if (this.chat) {
        this.chat.isChatActive = true;
        this.chat.unreadCount = 0;
        const badge = document.getElementById('chat-unread-badge');
        if (badge) badge.style.display = 'none';
      }
    });

    filesTabBtn?.addEventListener('click', () => {
      activateTab(filesTabBtn, filesPane);
      if (this.chat) this.chat.isChatActive = false;
    });

    usersTabBtn?.addEventListener('click', () => {
      activateTab(usersTabBtn, usersPane);
      if (this.chat) this.chat.isChatActive = false;
    });

    // Timer Settings Modal
    document.getElementById('timer-settings-btn')?.addEventListener('click', () => {
      document.getElementById('timer-modal')?.classList.remove('hidden');
    });

    // Pro Export Modal Trigger
    document.getElementById('canvas-export-btn')?.addEventListener('click', () => {
      document.getElementById('export-modal')?.classList.remove('hidden');
    });

    this.bindWhiteboardToolbar();
    this.bindExportModalActions();

    // Peer Avatar & Collaborators List Updates
    window.synapseSync.on('peers:updated', (peerList) => {
      this.updateAvatarStack(peerList);
      this.updateCollaboratorsList(peerList);
    });

    // Modal Close Triggers
    document.querySelectorAll('.modal-close-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-backdrop');
        if (modal) modal.classList.add('hidden');
      });
    });

    this.bindModalForms();
  }

  bindWhiteboardToolbar() {
    const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tool = btn.dataset.tool;
        if (this.whiteboard) this.whiteboard.setTool(tool);
      });
    });

    // Color Swatch Popover
    const colorBtn = document.getElementById('active-color-btn');
    const palettePopover = document.getElementById('color-palette-popover');

    colorBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      palettePopover?.classList.toggle('hidden');
    });

    window.addEventListener('click', (e) => {
      if (!palettePopover?.contains(e.target) && e.target !== colorBtn) {
        palettePopover?.classList.add('hidden');
      }
    });

    document.querySelectorAll('.swatch-item').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const color = swatch.dataset.color;
        if (colorBtn) colorBtn.style.backgroundColor = color;
        document.querySelectorAll('.swatch-item').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        if (this.whiteboard) this.whiteboard.setColor(color);
      });
    });

    // Stroke Width Selectors
    document.querySelectorAll('.stroke-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.stroke-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
        if (this.whiteboard) this.whiteboard.setStrokeWidth(pill.dataset.width);
      });
    });

    // Canvas HUD Actions
    document.getElementById('canvas-undo-btn')?.addEventListener('click', () => this.whiteboard?.undo());
    document.getElementById('canvas-redo-btn')?.addEventListener('click', () => this.whiteboard?.redo());
    document.getElementById('canvas-clear-btn')?.addEventListener('click', () => {
      if (confirm('Clear entire collaborative whiteboard?')) {
        this.whiteboard?.clearCanvas(true);
      }
    });
    document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.whiteboard?.zoomAtPoint(window.innerWidth / 2, window.innerHeight / 2, 1.2));
    document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.whiteboard?.zoomAtPoint(window.innerWidth / 2, window.innerHeight / 2, 0.8));
    document.getElementById('zoom-percentage')?.addEventListener('click', () => this.whiteboard?.resetZoom());
  }

  bindExportModalActions() {
    // PNG Export Buttons
    document.getElementById('export-png-1x')?.addEventListener('click', () => {
      const transparent = document.getElementById('export-transparent-bg')?.checked || false;
      this.whiteboard?.exportScaledPNG(1, transparent);
    });

    document.getElementById('export-png-2x')?.addEventListener('click', () => {
      const transparent = document.getElementById('export-transparent-bg')?.checked || false;
      this.whiteboard?.exportScaledPNG(2, transparent);
    });

    document.getElementById('export-png-3x')?.addEventListener('click', () => {
      const transparent = document.getElementById('export-transparent-bg')?.checked || false;
      this.whiteboard?.exportScaledPNG(3, transparent);
    });

    // SVG Export
    document.getElementById('export-svg-btn')?.addEventListener('click', () => {
      this.whiteboard?.exportSVG();
    });

    // JSON Board State Backup
    document.getElementById('export-board-json-btn')?.addEventListener('click', () => {
      this.whiteboard?.exportBoardJSON();
    });

    // JSON Board State Restore
    const importInput = document.getElementById('import-board-file-input');
    document.getElementById('import-board-json-btn')?.addEventListener('click', () => {
      importInput?.click();
    });
    importInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.whiteboard?.importBoardJSON(file);
      importInput.value = '';
    });

    // Markdown Meeting Notes Summary
    document.getElementById('export-summary-md-btn')?.addEventListener('click', () => {
      this.whiteboard?.exportMeetingSummaryMD();
    });
  }

  bindModalForms() {
    const createRoomBtn = document.getElementById('modal-create-room-btn');
    const joinRoomBtn = document.getElementById('modal-join-room-btn');
    const userNameInput = document.getElementById('modal-username-input');
    const roomCodeInput = document.getElementById('modal-roomcode-input');

    if (userNameInput) userNameInput.value = this.user.name;

    createRoomBtn?.addEventListener('click', () => {
      const customName = userNameInput.value.trim() || this.user.name;
      this.user.name = customName;
      this.user.avatarInitials = customName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      sessionStorage.setItem('synapse_local_user', JSON.stringify(this.user));

      const newId = 'ROOM-' + Math.floor(1000 + Math.random() * 9000);
      this.joinRoom(newId);
    });

    joinRoomBtn?.addEventListener('click', () => {
      const code = roomCodeInput.value.trim();
      if (!code) {
        alert('Please enter a valid room code.');
        return;
      }
      const customName = userNameInput.value.trim() || this.user.name;
      this.user.name = customName;
      this.user.avatarInitials = customName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      sessionStorage.setItem('synapse_local_user', JSON.stringify(this.user));

      this.joinRoom(code);
    });
  }

  showJoinModal() {
    document.getElementById('join-modal')?.classList.remove('hidden');
  }

  updateAvatarStack(peerList) {
    const stack = document.getElementById('avatar-stack-container');
    if (!stack) return;

    const allUsers = [this.user, ...peerList.filter(p => p.id !== this.user.id)];
    stack.innerHTML = '';

    allUsers.slice(0, 6).forEach(u => {
      const chip = document.createElement('div');
      chip.className = 'avatar-chip';
      chip.style.backgroundColor = u.color || '#6366f1';
      chip.title = `${u.name} ${u.id === this.user.id ? '(You)' : '(Click to jump to perspective)'}`;
      chip.textContent = u.avatarInitials || u.name.substring(0, 2).toUpperCase();

      // Clicking an avatar in top stack allows jumping to their viewpoint
      if (u.id !== this.user.id) {
        chip.style.cursor = 'pointer';
        chip.addEventListener('click', () => {
          this.whiteboard?.followUser(u.id, u.name);
        });
      }

      stack.appendChild(chip);
    });

    const counter = document.getElementById('active-peers-count');
    if (counter) counter.textContent = `${allUsers.length} online`;
  }

  /**
   * Collaborators Tab in Sidebar: lists everyone with 1-click jump/follow perspective
   */
  updateCollaboratorsList(peerList) {
    const listEl = document.getElementById('collaborators-list');
    const badgeEl = document.getElementById('users-count-badge');
    if (!listEl) return;

    const allUsers = [this.user, ...peerList.filter(p => p.id !== this.user.id)];
    if (badgeEl) badgeEl.textContent = allUsers.length;

    listEl.innerHTML = '';

    allUsers.forEach(u => {
      const isSelf = u.id === this.user.id;
      const card = document.createElement('div');
      card.className = `collaborator-item-card ${isSelf ? 'self-card' : ''}`;

      card.innerHTML = `
        <div class="collab-avatar" style="background-color: ${u.color || '#6366f1'};">
          ${escapeHtml(u.avatarInitials || u.name.substring(0, 2).toUpperCase())}
        </div>
        <div class="collab-meta">
          <div class="collab-name">${escapeHtml(u.name)} ${isSelf ? '<span class="you-badge">(You)</span>' : ''}</div>
          <div class="collab-status">${isSelf ? 'Active Host' : 'Click to jump to perspective'}</div>
        </div>
        ${!isSelf ? `
          <button class="collab-focus-btn" title="Follow ${escapeHtml(u.name)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Follow</span>
          </button>
        ` : ''}
      `;

      if (!isSelf) {
        card.querySelector('.collab-focus-btn')?.addEventListener('click', () => {
          this.whiteboard?.followUser(u.id, u.name);
        });
      }

      listEl.appendChild(card);
    });
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.synapseApp = new SynapseApp();
});
