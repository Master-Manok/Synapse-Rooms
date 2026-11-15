/**
 * Synapse Room - Advanced Whiteboard Engine (Figma/Miro/Canva Inspired)
 * Includes: Smooth Ink, Vector Shapes, Sticky Notes, Canvas Text Blocks,
 * Interactive Hyperlinks, Follow User Perspective (Spotlight), and Pro Multi-Format Exporter.
 */

class SynapseWhiteboard {
  constructor(canvasElement, overlayElement, syncEngine) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.overlay = overlayElement;
    this.sync = syncEngine;

    // Viewport Transformation State (Pan & Zoom)
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.minScale = 0.15;
    this.maxScale = 4.0;

    // Active Tool State
    // 'brush' | 'highlighter' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'sticky' | 'text' | 'hyperlink' | 'eraser' | 'pan'
    this.tool = 'brush';
    this.strokeColor = '#6366f1';
    this.strokeWidth = 3;

    // Interaction Flags
    this.isDrawing = false;
    this.isPanning = false;
    this.startPan = { x: 0, y: 0 };
    this.currentShape = null;

    // Follow User / Spotlight State (Figma Style)
    this.followingPeerId = null;
    this.followingPeerName = null;

    // Canvas Data Models
    this.elements = [];                 // Completed vector strokes & shapes
    this.remoteLiveStrokes = new Map(); // Live in-progress strokes from peers
    this.remoteShapePreviews = new Map(); // Live in-progress shapes from peers (Circle, Rect, etc.)
    this.stickyNotes = new Map();       // id -> sticky note data
    this.textBlocks = new Map();        // id -> text block data
    this.hyperlinks = new Map();        // id -> hyperlink card data
    this.remoteCursors = new Map();     // peerId -> { el, x, y, user }

    this.undoStack = [];
    this.redoStack = [];

    // Live Streaming & Micro-Task Throttling
    this.streamLastSentIndex = 0;
    this.lastStrokeBroadcastTime = 0;
    this.lastShapeBroadcastTime = 0;
    this.lastCursorBroadcastTime = 0;

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.bindEvents();
    this.bindSyncEvents();
  }

  resizeCanvas() {
    const stage = this.canvas.parentElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.width = rect.width;
    this.height = rect.height;

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.redraw();
    this.updateAllOverlayPositions();
  }

  screenToCanvas(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (screenX - rect.left - this.panX) / this.scale;
    const y = (screenY - rect.top - this.panY) / this.scale;
    return { x, y };
  }

  canvasToScreen(canvasX, canvasY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = canvasX * this.scale + this.panX + rect.left;
    const y = canvasY * this.scale + this.panY + rect.top;
    return { x, y };
  }

  setTool(newTool) {
    this.tool = newTool;
    const stage = this.canvas.parentElement;
    if (newTool === 'pan') {
      stage.classList.add('pan-mode');
    } else {
      stage.classList.remove('pan-mode');
    }
  }

  setColor(color) {
    this.strokeColor = color;
  }

  setStrokeWidth(width) {
    this.strokeWidth = parseInt(width, 10);
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Multi-touch gestures: Pinch-to-zoom & two-finger pan for mobile / tablet
    this.initialPinchDist = null;
    this.initialPinchScale = 1;
    this.lastTouchCenter = null;

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this.isDrawing = false;
        this.currentShape = null;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        this.initialPinchScale = this.scale;
        this.lastTouchCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && this.initialPinchDist) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const currentCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };

        const dx = currentCenter.x - this.lastTouchCenter.x;
        const dy = currentCenter.y - this.lastTouchCenter.y;
        this.panX += dx;
        this.panY += dy;
        this.lastTouchCenter = currentCenter;

        const zoomFactor = currentDist / this.initialPinchDist;
        const targetScale = Math.min(Math.max(this.initialPinchScale * zoomFactor, this.minScale), this.maxScale);

        const mouseX = currentCenter.x - this.canvas.getBoundingClientRect().left;
        const mouseY = currentCenter.y - this.canvas.getBoundingClientRect().top;
        this.panX = mouseX - (mouseX - this.panX) * (targetScale / this.scale);
        this.panY = mouseY - (mouseY - this.panY) * (targetScale / this.scale);
        this.scale = targetScale;

        this.redraw();
        this.updateAllOverlayPositions();
        this.updateZoomDisplay();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        this.initialPinchDist = null;
        this.lastTouchCenter = null;
      }
    });

    // Keyboard shortcuts: Spacebar, Undo (Ctrl+Z), Redo (Ctrl+Y)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        this.prevTool = this.tool;
        this.setTool('pan');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) this.redo(); else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        this.redo();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.prevTool) {
        this.setTool(this.prevTool);
        this.prevTool = null;
      }
    });
  }

  onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;

    // If following someone, manual interaction breaks the lock
    if (this.followingPeerId && (e.button === 1 || this.tool === 'pan')) {
      this.stopFollowing();
    }

    if (e.button === 1 || this.tool === 'pan') {
      this.isPanning = true;
      this.startPan = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      return;
    }

    const { x, y } = this.screenToCanvas(e.clientX, e.clientY);
    this.isDrawing = true;

    if (this.tool === 'brush' || this.tool === 'highlighter') {
      const initialPt = { x, y };
      this.currentShape = {
        id: 'elem_' + Math.random().toString(36).substring(2, 9),
        type: this.tool,
        points: [initialPt],
        color: this.strokeColor,
        width: this.tool === 'highlighter' ? this.strokeWidth * 3.5 : this.strokeWidth,
        alpha: this.tool === 'highlighter' ? 0.35 : 1.0
      };
      this.streamLastSentIndex = 0;
      this.lastStrokeBroadcastTime = Date.now();
      this.flushStrokeChunk(true);
    } else if (['rectangle', 'ellipse', 'line', 'arrow'].includes(this.tool)) {
      this.currentShape = {
        id: 'elem_' + Math.random().toString(36).substring(2, 9),
        type: this.tool,
        startX: x,
        startY: y,
        endX: x,
        endY: y,
        color: this.strokeColor,
        width: this.strokeWidth
      };
    } else if (this.tool === 'sticky') {
      const pastelColors = ['#fef08a', '#bbf7d0', '#fed7aa', '#fbcfe8', '#bae6fd', '#e9d5ff'];
      const stickyColor = pastelColors[Math.floor(Math.random() * pastelColors.length)];
      this.addStickyNote(x, y, '', stickyColor);
      this.isDrawing = false;
    } else if (this.tool === 'text') {
      this.addTextBlock(x, y, 'Double-click to edit text', this.strokeColor);
      this.isDrawing = false;
    } else if (this.tool === 'hyperlink') {
      this.promptAddHyperlink(x, y);
      this.isDrawing = false;
    } else if (this.tool === 'eraser') {
      this.eraseAt(x, y);
    }
  }

  onPointerMove(e) {
    const now = Date.now();

    // 1. Throttled multiplayer cursor broadcast (at most every 50ms = 20fps)
    if (!this.lastCursorBroadcastTime || now - this.lastCursorBroadcastTime >= 50) {
      this.broadcastCursor(e.clientX, e.clientY);
      this.lastCursorBroadcastTime = now;
    }

    if (this.isPanning) {
      this.panX = e.clientX - this.startPan.x;
      this.panY = e.clientY - this.startPan.y;
      this.redraw();
      this.updateAllOverlayPositions();
      return;
    }

    if (!this.isDrawing || !this.currentShape) return;

    const { x, y } = this.screenToCanvas(e.clientX, e.clientY);

    if (this.tool === 'brush' || this.tool === 'highlighter') {
      const pts = this.currentShape.points;
      const lastPt = pts[pts.length - 1];
      // Sample points with 1.5px distance threshold for organic, continuous spline curves
      if (!lastPt || Math.hypot(x - lastPt.x, y - lastPt.y) >= 1.5) {
        pts.push({ x, y });
        this.redraw();

        // Throttled stream chunk broadcast (~28 fps, 35ms interval)
        if (now - this.lastStrokeBroadcastTime >= 35) {
          this.flushStrokeChunk(false);
          this.lastStrokeBroadcastTime = now;
        }
      }
    } else if (['rectangle', 'ellipse', 'line', 'arrow'].includes(this.tool)) {
      this.currentShape.endX = x;
      this.currentShape.endY = y;
      this.redraw();

      // Throttled live shape broadcast (~25 fps, 40ms interval)
      if (!this.lastShapeBroadcastTime || now - this.lastShapeBroadcastTime >= 40) {
        this.sync.broadcast('whiteboard:shape_preview', {
          shape: this.currentShape
        });
        this.lastShapeBroadcastTime = now;
      }
    } else if (this.tool === 'eraser') {
      this.eraseAt(x, y);
    }
  }

  onPointerUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentShape) {
      // Flush any remaining buffered points before finalizing
      this.flushStrokeChunk(false);

      // QuickShape Recognition: Automatically snap rough hand-drawn circles into perfect geometric circles
      if (this.currentShape.type === 'brush' && this.currentShape.points.length >= 10) {
        const pts = this.currentShape.points;
        const start = pts[0];
        const end = pts[pts.length - 1];
        const distStartEnd = Math.hypot(start.x - end.x, start.y - end.y);

        let sumX = 0, sumY = 0;
        pts.forEach(p => { sumX += p.x; sumY += p.y; });
        const cx = sumX / pts.length;
        const cy = sumY / pts.length;

        let sumR = 0;
        const dists = pts.map(p => {
          const r = Math.hypot(p.x - cx, p.y - cy);
          sumR += r;
          return r;
        });
        const meanR = sumR / pts.length;

        let varR = 0;
        dists.forEach(r => { varR += (r - meanR) ** 2; });
        const stdR = Math.sqrt(varR / pts.length);
        const coeffVar = stdR / meanR;

        // If closed loop and low radial variance, snap into geometric ellipse
        if (distStartEnd < meanR * 0.8 && coeffVar < 0.24 && meanR > 14) {
          let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
          pts.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          });
          this.currentShape = {
            id: this.currentShape.id,
            type: 'ellipse',
            startX: minX,
            startY: minY,
            endX: maxX,
            endY: maxY,
            color: this.currentShape.color,
            width: this.currentShape.width
          };
          window.synapseApp?.showToast('✨ Snapped to geometric circle');
        }
      }

      this.elements.push(this.currentShape);
      this.undoStack.push({ type: 'add', element: this.currentShape });
      this.redoStack = [];

      // Broadcast finalized element to all peers with guaranteed delivery
      this.sync.broadcast('whiteboard:element_added', { element: this.currentShape });
      this.currentShape = null;
      this.redraw();
    }
  }

  flushStrokeChunk(isFirst = false) {
    if (!this.currentShape || !this.currentShape.points) return;
    const allPts = this.currentShape.points;
    if (allPts.length === 0) return;

    if (this.streamLastSentIndex >= allPts.length && !isFirst) return;

    const slice = allPts.slice(this.streamLastSentIndex);
    if (slice.length === 0 && !isFirst) return;

    this.sync.broadcast('whiteboard:stroke_chunk', {
      id: this.currentShape.id,
      type: this.currentShape.type,
      points: slice,
      color: this.currentShape.color,
      width: this.currentShape.width,
      alpha: this.currentShape.alpha,
      isFirst: isFirst || this.streamLastSentIndex === 0
    });
    this.streamLastSentIndex = allPts.length;
  }

  onWheel(e) {
    e.preventDefault();
    if (this.followingPeerId) this.stopFollowing();

    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoomAtPoint(e.clientX, e.clientY, zoomFactor);
    } else {
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;
      this.redraw();
      this.updateAllOverlayPositions();
    }
  }

  zoomAtPoint(screenX, screenY, factor) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = screenX - rect.left;
    const mouseY = screenY - rect.top;

    const newScale = Math.min(Math.max(this.scale * factor, this.minScale), this.maxScale);
    if (newScale === this.scale) return;

    this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
    this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
    this.scale = newScale;

    this.redraw();
    this.updateAllOverlayPositions();
    this.updateZoomDisplay();
  }

  resetZoom() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.redraw();
    this.updateAllOverlayPositions();
    this.updateZoomDisplay();
  }

  /**
   * Fit all drawings and canvas elements to the current device's screen size
   * Ensures mobile/tablet/desktop users see the complete sketch automatically.
   */
  fitToScreen(padding = 50) {
    if (this.elements.length === 0 && this.stickyNotes.size === 0 && this.textBlocks.size === 0 && this.hyperlinks.size === 0) {
      this.resetZoom();
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    // Measure vector elements
    for (const el of this.elements) {
      if (el.points && el.points.length > 0) {
        for (const p of el.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      } else if (el.startX !== undefined) {
        const x1 = Math.min(el.startX, el.endX);
        const x2 = Math.max(el.startX, el.endX);
        const y1 = Math.min(el.startY, el.endY);
        const y2 = Math.max(el.startY, el.endY);
        if (x1 < minX) minX = x1;
        if (x2 > maxX) maxX = x2;
        if (y1 < minY) minY = y1;
        if (y2 > maxY) maxY = y2;
      }
    }

    // Measure overlays
    for (const note of this.stickyNotes.values()) {
      if (note.x < minX) minX = note.x;
      if (note.x + 200 > maxX) maxX = note.x + 200;
      if (note.y < minY) minY = note.y;
      if (note.y + 180 > maxY) maxY = note.y + 180;
    }
    for (const text of this.textBlocks.values()) {
      if (text.x < minX) minX = text.x;
      if (text.x + 250 > maxX) maxX = text.x + 250;
      if (text.y < minY) minY = text.y;
      if (text.y + 100 > maxY) maxY = text.y + 100;
    }
    for (const link of this.hyperlinks.values()) {
      if (link.x < minX) minX = link.x;
      if (link.x + 260 > maxX) maxX = link.x + 260;
      if (link.y < minY) minY = link.y;
      if (link.y + 80 > maxY) maxY = link.y + 80;
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      this.resetZoom();
      return;
    }

    const contentWidth = Math.max(maxX - minX, 40);
    const contentHeight = Math.max(maxY - minY, 40);

    const availableWidth = Math.max(this.width - padding * 2, 100);
    const availableHeight = Math.max(this.height - padding * 2, 100);

    let targetScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
    targetScale = Math.min(Math.max(targetScale, this.minScale), 1.25);

    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;

    this.scale = targetScale;
    this.panX = (this.width / 2) - contentCenterX * targetScale;
    this.panY = (this.height / 2) - contentCenterY * targetScale;

    this.redraw();
    this.updateAllOverlayPositions();
    this.updateZoomDisplay();
    window.synapseApp?.showToast(`🔍 View adapted to screen (${Math.round(this.scale * 100)}%)`);
  }

  updateZoomDisplay() {
    const zoomText = document.getElementById('zoom-percentage');
    if (zoomText) zoomText.textContent = `${Math.round(this.scale * 100)}%`;
  }

  // --- Follow User / Spotlight Mode (Figma Style) ---
  followUser(peerId, peerName) {
    this.followingPeerId = peerId;
    this.followingPeerName = peerName || 'User';

    const cursor = this.remoteCursors.get(peerId);
    if (cursor) {
      this.centerOnPoint(cursor.x, cursor.y);
    }

    // Show floating Spotlight indicator
    let badge = document.getElementById('spotlight-indicator');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'spotlight-indicator';
      badge.className = 'spotlight-banner';
      this.canvas.parentElement.appendChild(badge);
    }
    badge.innerHTML = `
      <span>🎯 Following <strong>${escapeHtml(this.followingPeerName)}</strong></span>
      <button id="btn-stop-follow" class="spotlight-stop-btn">Stop</button>
    `;
    badge.style.display = 'flex';
    document.getElementById('btn-stop-follow')?.addEventListener('click', () => this.stopFollowing());

    window.synapseApp?.showToast(`🎯 Now following ${this.followingPeerName}'s view`);
  }

  stopFollowing() {
    if (!this.followingPeerId) return;
    this.followingPeerId = null;
    this.followingPeerName = null;
    const badge = document.getElementById('spotlight-indicator');
    if (badge) badge.style.display = 'none';
    window.synapseApp?.showToast('Stopped following');
  }

  centerOnPoint(canvasX, canvasY) {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    this.panX = centerX - canvasX * this.scale;
    this.panY = centerY - canvasY * this.scale;
    this.redraw();
    this.updateAllOverlayPositions();
  }

  // --- Canvas Text Blocks ---
  addTextBlock(canvasX, canvasY, text = 'Click to edit', color = '#f8fafc', id = null) {
    const textId = id || 'text_' + Math.random().toString(36).substring(2, 9);
    const data = { id: textId, x: canvasX, y: canvasY, text, color };
    this.textBlocks.set(textId, data);

    const el = document.createElement('div');
    el.className = 'canvas-text-element';
    el.id = textId;
    el.innerHTML = `
      <div class="text-content" contenteditable="true" style="color: ${color};">${escapeHtml(text)}</div>
      <button class="text-delete-btn" title="Delete text">&times;</button>
    `;

    el.querySelector('.text-delete-btn').addEventListener('click', () => {
      this.deleteTextBlock(textId, true);
    });

    const contentDiv = el.querySelector('.text-content');
    contentDiv.addEventListener('input', () => {
      data.text = contentDiv.innerText;
      this.sync.broadcast('whiteboard:text_update', data);
    });

    this.makeDraggableOverlay(el, data, 'whiteboard:text_update');
    this.overlay.appendChild(el);
    this.updateSingleOverlayPosition(el, data);

    if (!id) this.sync.broadcast('whiteboard:text_add', data);
  }

  deleteTextBlock(id, broadcast = true) {
    const el = document.getElementById(id);
    if (el) el.remove();
    this.textBlocks.delete(id);
    if (broadcast) this.sync.broadcast('whiteboard:text_delete', { id });
  }

  // --- Interactive Hyperlinks & Shared File Pointers ---
  promptAddHyperlink(canvasX, canvasY) {
    // Show quick in-app prompt modal for URL / File
    const label = prompt('Enter link label (e.g. "GitHub Repo" or "Project Spec"):', 'Documentation Link');
    if (!label) return;

    const url = prompt('Enter URL (https://...) OR enter file name from shared files:', 'https://github.com');
    if (!url) return;

    this.addHyperlink(canvasX, canvasY, label, url);
  }

  addHyperlink(canvasX, canvasY, label, targetUrl, id = null) {
    const linkId = id || 'link_' + Math.random().toString(36).substring(2, 9);
    const isFileLink = targetUrl.startsWith('#file:') || !targetUrl.startsWith('http');
    const data = { id: linkId, x: canvasX, y: canvasY, label, targetUrl, isFileLink };
    this.hyperlinks.set(linkId, data);

    const el = document.createElement('div');
    el.className = 'canvas-hyperlink-card';
    el.id = linkId;

    el.innerHTML = `
      <div class="link-icon-box">
        ${isFileLink ? '📁' : '🔗'}
      </div>
      <div class="link-info-box">
        <div class="link-label">${escapeHtml(label)}</div>
        <div class="link-url-preview">${escapeHtml(targetUrl)}</div>
      </div>
      <button class="link-delete-btn" title="Remove link">&times;</button>
    `;

    // Click handler: opens external URL or focuses shared file
    el.addEventListener('click', (e) => {
      if (e.target.matches('.link-delete-btn')) return;
      if (isFileLink) {
        document.getElementById('tab-files-btn')?.click();
        window.synapseApp?.showToast(`📁 Opening file reference: ${label}`);
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    });

    el.querySelector('.link-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteHyperlink(linkId, true);
    });

    this.makeDraggableOverlay(el, data, 'whiteboard:link_update');
    this.overlay.appendChild(el);
    this.updateSingleOverlayPosition(el, data);

    if (!id) this.sync.broadcast('whiteboard:link_add', data);
  }

  deleteHyperlink(id, broadcast = true) {
    const el = document.getElementById(id);
    if (el) el.remove();
    this.hyperlinks.delete(id);
    if (broadcast) this.sync.broadcast('whiteboard:link_delete', { id });
  }

  // --- Sticky Notes (FigJam Inspired) ---
  addStickyNote(canvasX, canvasY, text = '', color = '#fef08a', id = null, author = null) {
    const noteId = id || 'sticky_' + Math.random().toString(36).substring(2, 9);
    const noteAuthor = author || this.sync.user?.name || 'Collaborator';
    const stickyData = { id: noteId, x: canvasX, y: canvasY, text, color, author: noteAuthor };
    this.stickyNotes.set(noteId, stickyData);

    const el = document.createElement('div');
    el.className = 'sticky-note-element';
    el.id = noteId;
    el.style.backgroundColor = color;

    el.innerHTML = `
      <div class="sticky-note-header">
        <span>${escapeHtml(noteAuthor)}</span>
        <button class="sticky-delete-btn" title="Delete note">&times;</button>
      </div>
      <textarea class="sticky-note-textarea" placeholder="Type a note...">${escapeHtml(text)}</textarea>
    `;

    el.querySelector('.sticky-delete-btn').addEventListener('click', () => {
      this.deleteStickyNote(noteId, true);
    });

    const textarea = el.querySelector('.sticky-note-textarea');
    textarea.addEventListener('input', (e) => {
      stickyData.text = e.target.value;
      this.sync.broadcast('whiteboard:sticky_update', stickyData);
    });

    this.makeDraggableOverlay(el, stickyData, 'whiteboard:sticky_update');
    this.overlay.appendChild(el);
    this.updateSingleOverlayPosition(el, stickyData);

    if (!id) this.sync.broadcast('whiteboard:sticky_add', stickyData);
  }

  deleteStickyNote(noteId, broadcast = true) {
    const el = document.getElementById(noteId);
    if (el) el.remove();
    this.stickyNotes.delete(noteId);
    if (broadcast) this.sync.broadcast('whiteboard:sticky_delete', { id: noteId });
  }

  makeDraggableOverlay(el, dataObj, broadcastEvent) {
    let startX = 0, startY = 0, initX = 0, initY = 0;
    let dragging = false;

    el.addEventListener('pointerdown', (e) => {
      if (e.target.matches('textarea, input, [contenteditable="true"], button')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initX = dataObj.x;
      initY = dataObj.y;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - startX) / this.scale;
      const dy = (e.clientY - startY) / this.scale;
      dataObj.x = initX + dx;
      dataObj.y = initY + dy;
      this.updateSingleOverlayPosition(el, dataObj);
      this.sync.broadcast(broadcastEvent, dataObj);
    });

    el.addEventListener('pointerup', (e) => {
      if (dragging) {
        dragging = false;
        try { el.releasePointerCapture(e.pointerId); } catch(err) {}
      }
    });
  }

  updateAllOverlayPositions() {
    for (const [id, data] of this.stickyNotes.entries()) {
      const el = document.getElementById(id);
      if (el) this.updateSingleOverlayPosition(el, data);
    }
    for (const [id, data] of this.textBlocks.entries()) {
      const el = document.getElementById(id);
      if (el) this.updateSingleOverlayPosition(el, data);
    }
    for (const [id, data] of this.hyperlinks.entries()) {
      const el = document.getElementById(id);
      if (el) this.updateSingleOverlayPosition(el, data);
    }
  }

  updateSingleOverlayPosition(el, data) {
    const screen = this.canvasToScreen(data.x, data.y);
    el.style.transform = `translate(${screen.x}px, ${screen.y}px) scale(${this.scale})`;
    el.style.transformOrigin = 'top left';
  }

  // --- Multiplayer Cursors ---
  broadcastCursor(clientX, clientY) {
    if (!this.sync.user) return;
    const { x, y } = this.screenToCanvas(clientX, clientY);
    this.sync.broadcast('cursor:move', { x, y, user: this.sync.user });
  }

  updateRemoteCursor(peerId, data) {
    let cursorObj = this.remoteCursors.get(peerId);

    if (!cursorObj) {
      const el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML = `
        <svg class="cursor-pointer-svg" viewBox="0 0 24 24" fill="${data.user.color || '#6366f1'}">
          <path d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z" stroke="white" stroke-width="1.5"/>
        </svg>
        <span class="cursor-nametag" style="background-color: ${data.user.color || '#6366f1'}">${escapeHtml(data.user.name || 'Peer')}</span>
      `;
      this.overlay.appendChild(el);
      cursorObj = { el, x: data.x, y: data.y, user: data.user };
      this.remoteCursors.set(peerId, cursorObj);
    }

    cursorObj.x = data.x;
    cursorObj.y = data.y;
    const screen = this.canvasToScreen(data.x, data.y);
    cursorObj.el.style.transform = `translate(${screen.x}px, ${screen.y}px)`;

    // If we are actively following this peer, track their movement!
    if (this.followingPeerId === peerId) {
      this.centerOnPoint(data.x, data.y);
    }
  }

  removeRemoteCursor(peerId) {
    const obj = this.remoteCursors.get(peerId);
    if (obj) {
      obj.el.remove();
      this.remoteCursors.delete(peerId);
    }
    if (this.followingPeerId === peerId) this.stopFollowing();
  }

  // --- Rendering Loop ---
  redraw() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    // 1. Reset transform to device physical pixels and clear entire buffer
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // 2. Apply viewport Pan and Zoom
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    for (const elem of this.elements) this.renderElement(ctx, elem);
    for (const remoteElem of this.remoteLiveStrokes.values()) this.renderElement(ctx, remoteElem);
    for (const remoteShape of this.remoteShapePreviews.values()) this.renderElement(ctx, remoteShape);
    if (this.currentShape) this.renderElement(ctx, this.currentShape);

    ctx.restore();
  }

  renderElement(ctx, elem) {
    ctx.save();
    ctx.strokeStyle = elem.color;
    ctx.fillStyle = elem.color;
    ctx.lineWidth = elem.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (elem.alpha !== undefined) ctx.globalAlpha = elem.alpha;

    if (elem.type === 'brush' || elem.type === 'highlighter') {
      const points = elem.points;
      if (!points || points.length === 0) return;
      if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, elem.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (points.length === 2) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
      } else {
        // Catmull-Rom Spline to Cubic Bezier curve interpolation
        // Eliminates discrete point jitter and preserves continuous, organic curves
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        const tension = 0.55;

        for (let i = 0; i < points.length - 1; i++) {
          const p0 = i > 0 ? points[i - 1] : points[i];
          const p1 = points[i];
          const p2 = points[i + 1];
          const p3 = i < points.length - 2 ? points[i + 2] : p2;

          const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension;
          const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension;
          const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension;
          const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension;

          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
        ctx.stroke();
      }
    } else if (elem.type === 'rectangle') {
      const x = Math.min(elem.startX, elem.endX);
      const y = Math.min(elem.startY, elem.endY);
      const w = Math.abs(elem.endX - elem.startX);
      const h = Math.abs(elem.endY - elem.startY);
      ctx.strokeRect(x, y, w, h);
    } else if (elem.type === 'ellipse') {
      const cx = (elem.startX + elem.endX) / 2;
      const cy = (elem.startY + elem.endY) / 2;
      const rx = Math.abs(elem.endX - elem.startX) / 2;
      const ry = Math.abs(elem.endY - elem.startY) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (elem.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(elem.startX, elem.startY);
      ctx.lineTo(elem.endX, elem.endY);
      ctx.stroke();
    } else if (elem.type === 'arrow') {
      this.renderArrow(ctx, elem.startX, elem.startY, elem.endX, elem.endY, elem.width);
    }

    ctx.restore();
  }

  renderArrow(ctx, fromX, fromY, toX, toY, width) {
    const headlen = 14 + width;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  eraseAt(canvasX, canvasY) {
    const radius = 18 / this.scale;
    const lenBefore = this.elements.length;
    this.elements = this.elements.filter(elem => {
      if (elem.points) {
        return !elem.points.some(p => Math.hypot(p.x - canvasX, p.y - canvasY) < radius);
      }
      if (elem.startX !== undefined) {
        const minX = Math.min(elem.startX, elem.endX) - radius;
        const maxX = Math.max(elem.startX, elem.endX) + radius;
        const minY = Math.min(elem.startY, elem.endY) - radius;
        const maxY = Math.max(elem.startY, elem.endY) + radius;
        return !(canvasX >= minX && canvasX <= maxX && canvasY >= minY && canvasY <= maxY);
      }
      return true;
    });

    if (this.elements.length !== lenBefore) {
      this.redraw();
      this.sync.broadcast('whiteboard:state_sync', { elements: this.elements });
    }
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const action = this.undoStack.pop();
    this.redoStack.push(action);
    if (action.type === 'add') {
      const idx = this.elements.findIndex(e => e.id === action.element.id);
      if (idx !== -1) this.elements.splice(idx, 1);
    }
    this.redraw();
    this.sync.broadcast('whiteboard:state_sync', { elements: this.elements });
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const action = this.redoStack.pop();
    this.undoStack.push(action);
    if (action.type === 'add') this.elements.push(action.element);
    this.redraw();
    this.sync.broadcast('whiteboard:state_sync', { elements: this.elements });
  }

  clearCanvas(broadcast = true) {
    this.elements = [];
    this.undoStack = [];
    this.redoStack = [];
    this.redraw();

    for (const id of this.stickyNotes.keys()) document.getElementById(id)?.remove();
    this.stickyNotes.clear();

    for (const id of this.textBlocks.keys()) document.getElementById(id)?.remove();
    this.textBlocks.clear();

    for (const id of this.hyperlinks.keys()) document.getElementById(id)?.remove();
    this.hyperlinks.clear();

    if (broadcast) this.sync.broadcast('whiteboard:clear', {});
  }

  // ==========================================================================
  // PRO MULTI-FORMAT EXPORT ENGINE (Figma / Miro / Canva Grade)
  // ==========================================================================

  /**
   * 1. Export as High-Resolution PNG (1x, 2x Retina, 3x Print)
   */
  exportScaledPNG(scaleMultiplier = 2, transparentBg = false) {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = this.width * scaleMultiplier;
    offCanvas.height = this.height * scaleMultiplier;
    const offCtx = offCanvas.getContext('2d');

    if (!transparentBg) {
      offCtx.fillStyle = '#141721';
      offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
    }

    offCtx.scale(scaleMultiplier * this.scale, scaleMultiplier * this.scale);
    offCtx.translate(this.panX / this.scale, this.panY / this.scale);

    for (const elem of this.elements) {
      this.renderElement(offCtx, elem);
    }

    const a = document.createElement('a');
    a.download = `synapse-board-${scaleMultiplier}x-${Date.now()}.png`;
    a.href = offCanvas.toDataURL('image/png');
    a.click();
    window.synapseApp?.showToast(`📸 Exported ${scaleMultiplier}x PNG`);
  }

  /**
   * 2. Export Crisp Resolution-Independent SVG Vector Graphic
   */
  exportSVG() {
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">\n`;
    svgContent += `  <rect width="100%" height="100%" fill="#141721" />\n`;
    svgContent += `  <g transform="translate(${this.panX}, ${this.panY}) scale(${this.scale})">\n`;

    for (const elem of this.elements) {
      if (elem.type === 'brush' || elem.type === 'highlighter') {
        const points = elem.points;
        if (!points || points.length < 2) continue;
        let d = `M ${points[0].x} ${points[0].y} `;
        for (let i = 1; i < points.length; i++) {
          d += `L ${points[i].x} ${points[i].y} `;
        }
        const opacity = elem.alpha !== undefined ? elem.alpha : 1;
        svgContent += `    <path d="${d.trim()}" stroke="${elem.color}" stroke-width="${elem.width}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />\n`;
      } else if (elem.type === 'rectangle') {
        const x = Math.min(elem.startX, elem.endX);
        const y = Math.min(elem.startY, elem.endY);
        const w = Math.abs(elem.endX - elem.startX);
        const h = Math.abs(elem.endY - elem.startY);
        svgContent += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${elem.color}" stroke-width="${elem.width}" fill="none" rx="4" />\n`;
      } else if (elem.type === 'ellipse') {
        const cx = (elem.startX + elem.endX) / 2;
        const cy = (elem.startY + elem.endY) / 2;
        const rx = Math.abs(elem.endX - elem.startX) / 2;
        const ry = Math.abs(elem.endY - elem.startY) / 2;
        svgContent += `    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${elem.color}" stroke-width="${elem.width}" fill="none" />\n`;
      } else if (elem.type === 'line' || elem.type === 'arrow') {
        svgContent += `    <line x1="${elem.startX}" y1="${elem.startY}" x2="${elem.endX}" y2="${elem.endY}" stroke="${elem.color}" stroke-width="${elem.width}" stroke-linecap="round" />\n`;
      }
    }

    // Include text blocks in SVG
    for (const text of this.textBlocks.values()) {
      svgContent += `    <text x="${text.x}" y="${text.y}" fill="${text.color || '#fff'}" font-family="Inter, sans-serif" font-size="16">${escapeHtml(text.text)}</text>\n`;
    }

    svgContent += `  </g>\n</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synapse-vector-${Date.now()}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    window.synapseApp?.showToast('📐 Exported SVG Vector');
  }

  /**
   * 3. Export Board State Backup (.json / .synapse)
   */
  exportBoardJSON() {
    const state = {
      version: 1,
      timestamp: Date.now(),
      roomId: this.sync.roomId,
      elements: this.elements,
      stickyNotes: Array.from(this.stickyNotes.values()),
      textBlocks: Array.from(this.textBlocks.values()),
      hyperlinks: Array.from(this.hyperlinks.values())
    };

    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synapse-board-${this.sync.roomId}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    window.synapseApp?.showToast('💾 Exported Board State Backup');
  }

  /**
   * 4. Restore Board State from JSON
   */
  importBoardJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const state = JSON.parse(e.target.result);
        if (state.elements) this.elements = state.elements;

        // Clear existing overlays
        for (const id of this.stickyNotes.keys()) document.getElementById(id)?.remove();
        this.stickyNotes.clear();
        for (const id of this.textBlocks.keys()) document.getElementById(id)?.remove();
        this.textBlocks.clear();
        for (const id of this.hyperlinks.keys()) document.getElementById(id)?.remove();
        this.hyperlinks.clear();

        // Populate new overlays
        if (state.stickyNotes) {
          state.stickyNotes.forEach(s => this.addStickyNote(s.x, s.y, s.text, s.color, s.id, s.author));
        }
        if (state.textBlocks) {
          state.textBlocks.forEach(t => this.addTextBlock(t.x, t.y, t.text, t.color, t.id));
        }
        if (state.hyperlinks) {
          state.hyperlinks.forEach(l => this.addHyperlink(l.x, l.y, l.label, l.targetUrl, l.id));
        }

        this.redraw();
        // Broadcast new state to peers
        this.sync.broadcast('whiteboard:state_sync', { elements: this.elements });
        window.synapseApp?.showToast('✨ Board state restored successfully!');
      } catch (err) {
        alert('Invalid board state JSON file.');
      }
    };
    reader.readAsText(file);
  }

  /**
   * 5. Export Structured Meeting Summary & Transcript (.md)
   */
  exportMeetingSummaryMD() {
    const now = new Date().toLocaleString();
    let md = `# Synapse Room — Session & Meeting Summary\n`;
    md += `**Room Code:** ${this.sync.roomId}  \n`;
    md += `**Generated At:** ${now}  \n`;
    md += `**Total Participants:** ${this.sync.peers.size + 1}  \n\n`;

    md += `## 👥 Collaborators\n`;
    md += `- **${this.sync.user?.name || 'Host'}** (You)\n`;
    for (const peer of this.sync.peers.values()) {
      md += `- **${peer.name}**\n`;
    }
    md += `\n`;

    md += `## 📝 Sticky Notes & Ideas\n`;
    if (this.stickyNotes.size === 0) {
      md += `*No sticky notes recorded.*\n\n`;
    } else {
      for (const note of this.stickyNotes.values()) {
        md += `### ${note.author}\n> ${note.text.replace(/\n/g, '\n> ')}\n\n`;
      }
    }

    md += `## 💬 Chat Transcript\n`;
    const chatMsgs = window.synapseApp?.chat?.messages || [];
    if (chatMsgs.length === 0) {
      md += `*No chat messages in this session.*\n\n`;
    } else {
      for (const msg of chatMsgs) {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        md += `- **[${time}] ${msg.sender?.name || 'User'}:** ${msg.text}\n`;
      }
      md += `\n`;
    }

    md += `## 📁 Shared Files Staged\n`;
    const files = window.synapseApp?.files?.sessionFiles || new Map();
    if (files.size === 0) {
      md += `*No files shared in this session.*\n\n`;
    } else {
      for (const f of files.values()) {
        md += `- **${f.name}** (${window.synapseApp?.files?.formatFileSize(f.size)}) — Shared by ${f.sender?.name || 'User'}\n`;
      }
      md += `\n`;
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `synapse-meeting-notes-${this.sync.roomId}-${Date.now()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    window.synapseApp?.showToast('📄 Exported Meeting Summary (.md)');
  }

  // --- Sync Listeners ---
  bindSyncEvents() {
    // 1. High-performance streaming stroke chunk
    this.sync.on('whiteboard:stroke_chunk', (data) => {
      if (!data || !data.id || !Array.isArray(data.points)) return;
      let stroke = this.remoteLiveStrokes.get(data.id);
      if (!stroke || data.isFirst) {
        stroke = {
          id: data.id,
          type: data.type,
          points: [...data.points],
          color: data.color,
          width: data.width,
          alpha: data.alpha,
          updatedAt: Date.now()
        };
        this.remoteLiveStrokes.set(data.id, stroke);
      } else {
        stroke.points.push(...data.points);
        stroke.updatedAt = Date.now();
      }
      this.redraw();
    });

    // 2. Fallback single-point stroke handler
    this.sync.on('whiteboard:stroke_live', (data) => {
      if (!data || !data.id || !data.point) return;
      let stroke = this.remoteLiveStrokes.get(data.id);
      if (!stroke) {
        stroke = {
          id: data.id,
          type: data.type,
          points: [data.point],
          color: data.color,
          width: data.width,
          alpha: data.alpha,
          updatedAt: Date.now()
        };
        this.remoteLiveStrokes.set(data.id, stroke);
      } else {
        stroke.points.push(data.point);
        stroke.updatedAt = Date.now();
      }
      this.redraw();
    });

    // 3. Remote peer live shape dragging (Rect, Circle, Arrow, Line)
    this.sync.on('whiteboard:shape_preview', (payload, senderId) => {
      if (payload && payload.shape) {
        payload.shape.updatedAt = Date.now();
        this.remoteShapePreviews.set(senderId, payload.shape);
        this.redraw();
      }
    });

    // 4. Finalized element completed
    this.sync.on('whiteboard:element_added', (payload, senderId) => {
      if (payload && payload.element) {
        const el = payload.element;
        this.remoteLiveStrokes.delete(el.id);
        if (senderId) this.remoteShapePreviews.delete(senderId);
        for (const [sId, s] of this.remoteShapePreviews.entries()) {
          if (s.id === el.id) this.remoteShapePreviews.delete(sId);
        }
        const existingIdx = this.elements.findIndex(e => e.id === el.id);
        if (existingIdx >= 0) {
          this.elements[existingIdx] = el;
        } else {
          this.elements.push(el);
        }
        this.redraw();
      }
    });

    // 5. Explicit sync request from joining peer
    this.sync.on('whiteboard:request_sync', () => {
      if (this.elements.length > 0) {
        this.sync.broadcast('whiteboard:state_sync', { elements: this.elements });
      }
      for (const sticky of this.stickyNotes.values()) this.sync.broadcast('whiteboard:sticky_add', sticky);
      for (const text of this.textBlocks.values()) this.sync.broadcast('whiteboard:text_add', text);
      for (const link of this.hyperlinks.values()) this.sync.broadcast('whiteboard:link_add', link);
    });

    // 6. Board state sync (CRDT-style ID union, never overwrite local strokes!)
    this.sync.on('whiteboard:state_sync', (payload) => {
      if (Array.isArray(payload.elements)) {
        const existingIds = new Set(this.elements.map(e => e.id));
        let changed = false;
        for (const el of payload.elements) {
          if (!existingIds.has(el.id)) {
            this.elements.push(el);
            existingIds.add(el.id);
            changed = true;
          }
        }
        if (changed) this.redraw();
      }
    });

    // Periodic GC for any orphaned live strokes if peer unexpectedly disconnected
    setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, stroke] of this.remoteLiveStrokes.entries()) {
        if (now - (stroke.updatedAt || now) > 10000) {
          this.remoteLiveStrokes.delete(id);
          changed = true;
        }
      }
      for (const [sId, shape] of this.remoteShapePreviews.entries()) {
        if (now - (shape.updatedAt || now) > 10000) {
          this.remoteShapePreviews.delete(sId);
          changed = true;
        }
      }
      if (changed) this.redraw();
    }, 4000);

    this.sync.on('whiteboard:clear', () => this.clearCanvas(false));

    // Sticky Notes Sync
    this.sync.on('whiteboard:sticky_add', (data) => {
      if (!this.stickyNotes.has(data.id)) {
        this.addStickyNote(data.x, data.y, data.text, data.color, data.id, data.author);
      }
    });

    this.sync.on('whiteboard:sticky_update', (data) => {
      const note = this.stickyNotes.get(data.id);
      if (note) {
        note.x = data.x;
        note.y = data.y;
        note.text = data.text;
        const el = document.getElementById(data.id);
        if (el) {
          const textarea = el.querySelector('.sticky-note-textarea');
          if (textarea && textarea.value !== data.text) textarea.value = data.text;
          this.updateSingleOverlayPosition(el, note);
        }
      } else {
        this.addStickyNote(data.x, data.y, data.text, data.color, data.id, data.author);
      }
    });

    this.sync.on('whiteboard:sticky_delete', (data) => this.deleteStickyNote(data.id, false));

    // Text Blocks Sync
    this.sync.on('whiteboard:text_add', (data) => {
      if (!this.textBlocks.has(data.id)) this.addTextBlock(data.x, data.y, data.text, data.color, data.id);
    });

    this.sync.on('whiteboard:text_update', (data) => {
      const block = this.textBlocks.get(data.id);
      if (block) {
        block.x = data.x;
        block.y = data.y;
        block.text = data.text;
        const el = document.getElementById(data.id);
        if (el) {
          const div = el.querySelector('.text-content');
          if (div && div.innerText !== data.text) div.innerText = data.text;
          this.updateSingleOverlayPosition(el, block);
        }
      } else {
        this.addTextBlock(data.x, data.y, data.text, data.color, data.id);
      }
    });

    this.sync.on('whiteboard:text_delete', (data) => this.deleteTextBlock(data.id, false));

    // Hyperlinks Sync
    this.sync.on('whiteboard:link_add', (data) => {
      if (!this.hyperlinks.has(data.id)) this.addHyperlink(data.x, data.y, data.label, data.targetUrl, data.id);
    });

    this.sync.on('whiteboard:link_update', (data) => {
      const link = this.hyperlinks.get(data.id);
      if (link) {
        link.x = data.x;
        link.y = data.y;
        const el = document.getElementById(data.id);
        if (el) this.updateSingleOverlayPosition(el, link);
      }
    });

    this.sync.on('whiteboard:link_delete', (data) => this.deleteHyperlink(data.id, false));

    // Cursors & Peer Lifecycle
    this.sync.on('cursor:move', (data, senderId) => this.updateRemoteCursor(senderId, data));
    this.sync.on('peer:leave', (payload, senderId) => this.removeRemoteCursor(senderId));

    // Peer Join Hydration
    this.sync.on('peer:join', () => {
      if (this.elements.length > 0) this.sync.broadcast('whiteboard:state_sync', { elements: this.elements });
      for (const sticky of this.stickyNotes.values()) this.sync.broadcast('whiteboard:sticky_add', sticky);
      for (const text of this.textBlocks.values()) this.sync.broadcast('whiteboard:text_add', text);
      for (const link of this.hyperlinks.values()) this.sync.broadcast('whiteboard:link_add', link);
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

window.SynapseWhiteboard = SynapseWhiteboard;
