/**
 * Synapse Room - Universal Hybrid Real-Time Synchronization Engine
 * Combines:
 * 1. Global Public Secure WebSocket Broker (MQTT over WSS) for seamless cross-device,
 *    cross-machine synchronization worldwide on GitHub Pages / Vercel (Zero-Config, Free).
 * 2. Local HTML5 BroadcastChannel for instant zero-latency multi-tab sync on the same device.
 */

class SynapseSyncEngine {
  constructor() {
    this.roomId = null;
    this.user = null;
    this.localChannel = null;
    this.mqttClient = null;
    this.listeners = new Map(); // eventName -> Array<callback>
    this.peers = new Map();     // peerId -> { id, name, color, lastSeen }
    this.heartbeatTimer = null;
    this.seenMessageIds = new Set(); // Prevent loopback/duplicate handling

    // List of public high-availability TLS MQTT brokers (Port 8084 / 8884 WSS)
    this.brokerList = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt',
      'wss://test.mosquitto.org:8081'
    ];
    this.currentBrokerIdx = 0;
    this.isConnectedToCloud = false;
  }

  /**
   * Initialize sync engine for a given room and user profile
   */
  init(roomId, user) {
    this.roomId = roomId;
    this.user = user;

    // 1. Setup Local BroadcastChannel (Same-machine tabs)
    if (this.localChannel) {
      try { this.localChannel.close(); } catch(e) {}
    }
    const channelName = `synapse_room_${this.roomId}`;
    this.localChannel = new BroadcastChannel(channelName);
    this.localChannel.onmessage = (event) => {
      this.processEnvelope(event.data, 'local');
    };

    // 2. Setup Global Cloud WSS Broker (Cross-device, cross-network)
    this.connectCloudBroker();

    // 3. Start Heartbeat
    this.startHeartbeat();

    // 4. Broadcast join
    this.broadcast('peer:join', { user: this.user });
  }

  /**
   * Connect to global public TLS WebSocket broker using MQTT
   */
  connectCloudBroker() {
    if (typeof mqtt === 'undefined') {
      console.warn('[Sync] MQTT library not loaded, falling back to local BroadcastChannel.');
      return;
    }

    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch(e) {}
    }

    const brokerUrl = this.brokerList[this.currentBrokerIdx];
    const clientId = `synapse_${this.user.id}_${Math.random().toString(36).substring(2, 6)}`;
    const topic = `synapse/v2/rooms/${this.roomId}`;

    try {
      this.mqttClient = mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 7000,
        reconnectPeriod: 4000
      });

      this.mqttClient.on('connect', () => {
        this.isConnectedToCloud = true;
        this.updateSyncBadge(true);
        this.mqttClient.subscribe(topic, { qos: 0 }, (err) => {
          if (!err) {
            // Announce join to global peers
            this.broadcast('peer:join', { user: this.user });
          }
        });
      });

      this.mqttClient.on('message', (receivedTopic, messageBuffer) => {
        try {
          const envelope = JSON.parse(messageBuffer.toString());
          this.processEnvelope(envelope, 'cloud');
        } catch (err) {
          // Ignore malformed payloads
        }
      });

      this.mqttClient.on('error', (err) => {
        console.warn(`[Sync] Broker error on ${brokerUrl}:`, err.message);
        this.tryNextBroker();
      });

      this.mqttClient.on('offline', () => {
        this.isConnectedToCloud = false;
        this.updateSyncBadge(false);
      });
    } catch (err) {
      this.tryNextBroker();
    }
  }

  tryNextBroker() {
    if (this.brokerList.length > 1) {
      this.currentBrokerIdx = (this.currentBrokerIdx + 1) % this.brokerList.length;
      setTimeout(() => this.connectCloudBroker(), 2000);
    }
  }

  updateSyncBadge(isCloudActive) {
    const badge = document.getElementById('connection-status-dot');
    if (badge) {
      badge.style.backgroundColor = isCloudActive ? '#25d366' : '#f59e0b';
      badge.title = isCloudActive ? 'Connected globally across internet (WSS Cloud Active)' : 'Local channel active (Connecting to cloud broker...)';
    }
  }

  /**
   * Broadcast an event to all peers (Both local and cross-device)
   */
  broadcast(type, payload) {
    const msgId = `${this.user?.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const envelope = {
      msgId,
      type,
      payload,
      senderId: this.user?.id,
      timestamp: Date.now()
    };

    // Mark as seen locally to prevent processing own broadcast
    this.seenMessageIds.add(msgId);
    if (this.seenMessageIds.size > 2000) {
      const iter = this.seenMessageIds.values();
      for (let i = 0; i < 500; i++) this.seenMessageIds.delete(iter.next().value);
    }

    // 1. Post to local BroadcastChannel
    if (this.localChannel) {
      try {
        this.localChannel.postMessage(envelope);
      } catch (err) {}
    }

    // 2. Publish to Cloud WSS Broker
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        const topic = `synapse/v2/rooms/${this.roomId}`;
        this.mqttClient.publish(topic, JSON.stringify(envelope), { qos: 0 });
      } catch (err) {}
    }
  }

  /**
   * Process incoming envelope from either Local or Cloud channels
   */
  processEnvelope(envelope, source) {
    if (!envelope || !envelope.type || !envelope.msgId) return;

    // Ignore self-messages
    if (envelope.senderId === this.user?.id) return;

    // Deduplicate: if already processed via local channel or vice versa, skip!
    if (this.seenMessageIds.has(envelope.msgId)) return;
    this.seenMessageIds.add(envelope.msgId);

    this.handleIncoming(envelope.type, envelope.payload, envelope.senderId);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  handleIncoming(type, payload, senderId) {
    if (type === 'peer:join' || type === 'peer:heartbeat') {
      const remoteUser = payload.user;
      if (remoteUser && remoteUser.id) {
        this.peers.set(remoteUser.id, {
          ...remoteUser,
          lastSeen: Date.now()
        });
        this.emit('peers:updated', Array.from(this.peers.values()));

        if (type === 'peer:join') {
          // Immediately respond with our heartbeat so the new peer registers us
          this.broadcast('peer:heartbeat', { user: this.user });
        }
      }
    } else if (type === 'peer:leave') {
      this.peers.delete(senderId);
      this.emit('peers:updated', Array.from(this.peers.values()));
    }

    this.emit(type, payload, senderId);
  }

  emit(type, ...args) {
    const handlers = this.listeners.get(type);
    if (handlers) {
      handlers.forEach(fn => {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[Sync] Error in listener for ${type}:`, err);
        }
      });
    }
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      if (!this.user || !this.roomId) return;

      this.broadcast('peer:heartbeat', { user: this.user });

      // Clean up stale peers not seen in 14 seconds
      const now = Date.now();
      let changed = false;
      for (const [peerId, peer] of this.peers.entries()) {
        if (now - peer.lastSeen > 14000) {
          this.peers.delete(peerId);
          changed = true;
        }
      }

      if (changed) {
        this.emit('peers:updated', Array.from(this.peers.values()));
      }
    }, 4000);
  }

  leave() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.broadcast('peer:leave', { user: this.user });
    if (this.localChannel) this.localChannel.close();
    if (this.mqttClient) this.mqttClient.end(true);
  }
}

window.synapseSync = new SynapseSyncEngine();
