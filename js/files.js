/**
 * Synapse Room - On-Demand P2P Ephemeral File Streaming Engine
 * Supports large files (5GB+) without cloud storage.
 * The file remains on the sender's disk; when a recipient requests download,
 * the file is sliced on-demand into 256KB packages and reconstructed in the recipient's browser.
 */

class SynapseFileManager {
  constructor(dropzoneEl, fileListEl, fileInputEl, syncEngine) {
    this.dropzone = dropzoneEl;
    this.fileList = fileListEl;
    this.fileInput = fileInputEl;
    this.sync = syncEngine;

    // Local DOM File handles (retains native OS file pointers without loading into RAM)
    this.localFileHandles = new Map(); // fileId -> File object

    // Advertised files in this room session
    this.sessionFiles = new Map(); // fileId -> { id, name, size, type, sender, timestamp, isLocal }

    // Active incoming stream transfers: requestId -> { fileId, chunks: [], totalChunks, receivedBytes, startTime, ... }
    this.incomingTransfers = new Map();

    // Active outgoing stream transfers: requestId -> { cancelled: false }
    this.outgoingTransfers = new Map();

    this.CHUNK_SIZE = 256 * 1024; // 256 KB per slice

    this.bindEvents();
    this.bindSyncEvents();
  }

  bindEvents() {
    this.dropzone.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', (e) => {
      const selected = Array.from(e.target.files);
      selected.forEach(file => this.registerAndBroadcastFile(file));
      this.fileInput.value = '';
    });

    // Drag-and-drop
    ['dragenter', 'dragover'].forEach(name => {
      this.dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropzone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      this.dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropzone.classList.remove('drag-over');
      });
    });

    this.dropzone.addEventListener('drop', (e) => {
      const dropped = Array.from(e.dataTransfer.files);
      dropped.forEach(file => this.registerAndBroadcastFile(file));
    });
  }

  /**
   * Registers a file dropped by the local user.
   * Keeps native File handle on disk and broadcasts only the lightweight metadata.
   */
  registerAndBroadcastFile(file) {
    const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    // Save native pointer to local map (Zero memory bloat, handles 5GB+ easily)
    this.localFileHandles.set(fileId, file);

    const metadata = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      sender: this.sync.user,
      timestamp: Date.now(),
      isLocal: true
    };

    this.sessionFiles.set(fileId, metadata);
    this.renderFileCard(metadata);
    this.updateFileCountBadge();

    // Broadcast file presence to all room peers
    this.sync.broadcast('file:advertised', { file: metadata });
    window.synapseApp?.showToast(`📤 File staged for P2P streaming: ${file.name}`);
  }

  renderFileCard(file) {
    let existingCard = document.getElementById(file.id);
    if (existingCard) return;

    const card = document.createElement('div');
    card.className = 'file-card';
    card.id = file.id;

    const isImage = file.type.startsWith('image/');
    const formattedSize = this.formatFileSize(file.size);
    const uploader = file.sender?.name || 'Collaborator';
    const isOwner = file.sender?.id === this.sync.user?.id;

    card.innerHTML = `
      <div class="file-thumbnail-box">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      </div>
      <div class="file-meta-box">
        <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
        <div class="file-submeta">
          <span>${formattedSize}</span>
          <span>•</span>
          <span>${escapeHtml(uploader)}</span>
          ${isOwner ? '<span class="owner-pill">Source Host</span>' : '<span class="p2p-pill">P2P Stream</span>'}
        </div>
        <!-- Progress bar container for live streaming -->
        <div class="file-progress-container" id="prog_cont_${file.id}" style="display: none;">
          <div class="file-progress-bar" id="prog_bar_${file.id}"></div>
          <div class="file-progress-metrics" id="prog_metrics_${file.id}">0% • 0 MB/s</div>
        </div>
      </div>
      <div class="file-actions-box">
        <button class="file-download-btn" id="btn_dl_${file.id}" title="${isOwner ? 'Save Local Copy' : 'Request P2P Stream'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
      </div>
    `;

    // Download / Request stream listener
    card.querySelector(`#btn_dl_${file.id}`).addEventListener('click', () => {
      this.handleDownloadClick(file);
    });

    this.fileList.prepend(card);
  }

  handleDownloadClick(file) {
    // If we are the original uploader, we already have the native File handle
    if (this.localFileHandles.has(file.id)) {
      const localFile = this.localFileHandles.get(file.id);
      const url = URL.createObjectURL(localFile);
      this.triggerBrowserDownload(url, file.name);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    }

    // Otherwise, initiate on-demand P2P stream request from sender
    const requestId = 'req_' + Math.random().toString(36).substring(2, 9);
    const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);

    this.incomingTransfers.set(requestId, {
      fileId: file.id,
      fileName: file.name,
      fileType: file.type,
      totalSize: file.size,
      totalChunks,
      receivedChunks: [],
      receivedBytes: 0,
      startTime: Date.now(),
      lastUpdate: Date.now()
    });

    // Show progress bar
    const progCont = document.getElementById(`prog_cont_${file.id}`);
    if (progCont) progCont.style.display = 'block';

    const dlBtn = document.getElementById(`btn_dl_${file.id}`);
    if (dlBtn) dlBtn.disabled = true;

    window.synapseApp?.showToast(`📡 Requesting P2P stream for "${file.name}"...`);

    // Broadcast stream request to the room (the peer with the local file will answer)
    this.sync.broadcast('file:stream_request', {
      requestId,
      fileId: file.id,
      requesterId: this.sync.user?.id
    });
  }

  /**
   * Sender responds to stream request by slicing file into 256KB packages
   */
  async handleIncomingStreamRequest(data) {
    const { requestId, fileId, requesterId } = data;
    const file = this.localFileHandles.get(fileId);
    if (!file) return; // We do not hold the file handle

    window.synapseApp?.showToast(`📤 Streaming "${file.name}" to peer...`);

    const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);
    const transferTracker = { cancelled: false };
    this.outgoingTransfers.set(requestId, transferTracker);

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      if (transferTracker.cancelled) break;

      const start = chunkIdx * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);

      const buffer = await slice.arrayBuffer();
      const base64Data = this.arrayBufferToBase64(buffer);

      this.sync.broadcast('file:chunk_data', {
        requestId,
        fileId,
        chunkIdx,
        totalChunks,
        chunkData: base64Data,
        targetRequesterId: requesterId
      });

      // Small tick delay every 8 chunks to allow browser event loop breathing
      if (chunkIdx % 8 === 0) {
        await new Promise(r => setTimeout(r, 8));
      }
    }
  }

  /**
   * Recipient receives a chunk, updates metrics, and stitches file when complete
   */
  handleIncomingChunk(payload) {
    const { requestId, fileId, chunkIdx, totalChunks, chunkData, targetRequesterId } = payload;
    if (targetRequesterId && targetRequesterId !== this.sync.user?.id) return;

    const transfer = this.incomingTransfers.get(requestId);
    if (!transfer) return;

    // Convert chunk back from Base64 to ArrayBuffer
    const chunkBuffer = this.base64ToArrayBuffer(chunkData);
    transfer.receivedChunks[chunkIdx] = chunkBuffer;
    transfer.receivedBytes += chunkBuffer.byteLength;

    // Update Progress UI
    const percent = Math.min(100, Math.round((transfer.receivedBytes / transfer.totalSize) * 100));
    const now = Date.now();
    const elapsedSec = (now - transfer.startTime) / 1000;
    const speedMBs = elapsedSec > 0 ? (transfer.receivedBytes / (1024 * 1024) / elapsedSec).toFixed(1) : '0';

    const progBar = document.getElementById(`prog_bar_${fileId}`);
    const progMetrics = document.getElementById(`prog_metrics_${fileId}`);

    if (progBar) progBar.style.width = `${percent}%`;
    if (progMetrics) {
      progMetrics.textContent = `${percent}% • ${this.formatFileSize(transfer.receivedBytes)} / ${this.formatFileSize(transfer.totalSize)} • ${speedMBs} MB/s`;
    }

    // Check completion
    if (transfer.receivedChunks.filter(Boolean).length === totalChunks) {
      this.finalizeDownloadedFile(transfer);
      this.incomingTransfers.delete(requestId);

      setTimeout(() => {
        const progCont = document.getElementById(`prog_cont_${fileId}`);
        if (progCont) progCont.style.display = 'none';
        const dlBtn = document.getElementById(`btn_dl_${fileId}`);
        if (dlBtn) dlBtn.disabled = false;
      }, 2000);
    }
  }

  finalizeDownloadedFile(transfer) {
    window.synapseApp?.showToast(`✅ "${transfer.fileName}" stream complete! Saving...`);

    const blob = new Blob(transfer.receivedChunks, { type: transfer.fileType });
    const url = URL.createObjectURL(blob);
    this.triggerBrowserDownload(url, transfer.fileName);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  triggerBrowserDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  updateFileCountBadge() {
    const badge = document.getElementById('files-count-badge');
    if (badge) {
      const count = this.sessionFiles.size;
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  }

  // Base64 helper routines
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  bindSyncEvents() {
    // A remote peer advertised a new file in the room
    this.sync.on('file:advertised', (payload) => {
      if (payload.file && !this.sessionFiles.has(payload.file.id)) {
        payload.file.isLocal = false;
        this.sessionFiles.set(payload.file.id, payload.file);
        this.renderFileCard(payload.file);
        this.updateFileCountBadge();
        window.synapseApp?.showToast(`📁 New file available for stream: ${payload.file.name}`);
      }
    });

    // Remote peer requests a file we are hosting
    this.sync.on('file:stream_request', (data) => {
      this.handleIncomingStreamRequest(data);
    });

    // Remote chunk received
    this.sync.on('file:chunk_data', (payload) => {
      this.handleIncomingChunk(payload);
    });

    // When a new peer enters, advertise all files we host
    this.sync.on('peer:join', () => {
      for (const [fileId, file] of this.sessionFiles.entries()) {
        if (this.localFileHandles.has(fileId)) {
          this.sync.broadcast('file:advertised', { file });
        }
      }
    });
  }
}

window.SynapseFileManager = SynapseFileManager;
