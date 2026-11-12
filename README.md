# Synapse Room ⚡
### Zero-Setup, Zero-Cloud Ephemeral Collaborative Workspace
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Hosting: GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-success.svg)](https://pages.github.com/)
[![WebSockets: WSS Public Mesh](https://img.shields.io/badge/Signaling-MQTT%20WSS-purple.svg)](https://www.emqx.com/)
[![Zero Cloud Storage](https://img.shields.io/badge/Storage-100%25%20Ephemeral%20RAM-orange.svg)](#privacy--zero-cloud-storage)
[![Responsive: Mobile & Desktop](https://img.shields.io/badge/Responsive-Mobile%20%7C%20Tablet%20%7C%20Desktop-green.svg)](#adaptive-responsive-uiux)

> **Live Demo:** Deploy instantly on your own GitHub Pages with 0 configuration, or open `index.html` locally in any browser!

**Synapse Room** is a lightning-fast, privacy-first web application designed for students, remote study groups, agile engineering standups, and casual brainstorming. It combines a **Figma-grade infinite whiteboard**, a **WhatsApp-style real-time chat**, **5GB+ on-demand peer-to-peer file streaming**, and **collaborator perspective spotlighting** into a single, zero-footprint web app.

Everything lives strictly in your browser session. **No accounts. No signups. No cloud databases. When the session ends, all data disappears.**

---

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🟢 SYNAPSE ROOM  [ROOM-7429] 🔗 Invite      📞 00:14:23   ⏱️ 24:15 [▶] [↺]    👥 3 Online │
├──────────────────────────────────────────────────────────────┬─────────────────────────┤
│                                                              │  [ Chat ] [Files] [Users]
│    Alex River (You)                  Swift Fox (Spotlight)   ├─────────────────────────┤
│    ┌──────────────┐                  ┌──────────────┐        │ 💬 Alex: Hey everyone!  │
│    │ Sticky Note  │                  │  Rectangle   │        │ 💬 Fox: Reviewing spec  │
│    │  Sprint Goal │                  │  Wireframe   │        │                         │
│    └──────────────┘                  └──────────────┘        │ 📁 Final_Build.iso      │
│                                                              │    4.8 GB • [Download]  │
│                   [ 🎯 Following Swift Fox ]                 │    [████████░░] 82%     │
│                                                              ├─────────────────────────┤
│   Toolbar: [✏️] [🖍️] [▢] [◯] [⟶] [📝] [🔤] [🔗] [⌫] [🎨]      │ [Type a message...] [➤] │
└──────────────────────────────────────────────────────────────┴─────────────────────────┘
```

---

## ✨ Key Features at a Glance

### 1. 🎨 Figma / FigJam-Inspired Collaborative Whiteboard
- **Multiplayer Live Cursors**: See your collaborators glide across the canvas with their real-time nametag and distinct signature color.
- **Creative Suite**:
  - Smooth ink brush with quadratic bezier curve smoothing.
  - Translucent highlighter for document and diagram reviews.
  - Vector geometric shapes: Rectangles, Ellipses/Circles, Lines, and Directional Arrows.
  - **FigJam Sticky Notes**: Vibrant pastel notes that can be dragged, edited in real time, and auto-grouped by author.
  - **Canvas Text Box (`T`)**: Click anywhere on the whiteboard to place scalable, editable text blocks.
  - **Interactive Hyperlinks (`L`)**: Embed clickable link cards to external documentation (`https://...`) or jump directly to shared session files (`#file:file_id`).
- **Canvas Physics**: Infinite feel with smooth hand pan (`H` or hold Spacebar) and mouse wheel zoom from 15% to 400%.
- **Mobile Multi-Touch**: Native two-finger pinch-to-zoom and two-finger pan on touchscreens and mobile devices.

### 2. 📁 5GB+ On-Demand P2P File Streaming (Zero Cloud Storage)
- **Zero Cloud Footprint**: The shared file stays securely on the sender's local disk via native browser `File` handles. No cloud hosting or database storage bills.
- **Lightweight Staging**: As soon as a file is dropped, only its lightweight metadata is broadcast to participants.
- **On-Demand Package Slicing**: When a peer clicks **Download**, the sender's browser slices the file dynamically into **256KB binary packages** via `File.slice()`, streaming them through peer channels.
- **Live Transfer Metrics**: Real-time progress bar, percentage (`%`), bytes transferred (`MB/GB`), and live throughput speed (`MB/s`).

### 3. 🎯 Spotlight / Follow User Perspective
- **Lost on a giant whiteboard?** Open the **Users** tab in the sidebar (or click any avatar in the top bar) and click **Follow**.
- Your canvas view automatically pans and centers on that collaborator's view in real time.
- Watch them draw, navigate, or explain diagrams live until you pan, zoom, or click **Stop Following**.

### 4. 💬 WhatsApp / Instagram-Inspired Chat
- **Familiar Chat Experience**: Clean message bubbles (emerald green outgoing with `✓✓` read receipts; slate incoming with colored sender tags).
- **Floating Emoji Reactions**: Hover or tap on any message to react (❤️, 👍, 🔥, 😂, 🚀).
- **Real-Time Typing Indicators**: 3-dot animated pulse when a peer is typing.
- **Synthesized Audio Pops**: Delightful notification and reaction sounds generated via the native Web Audio API — **100% offline with zero external audio asset downloads**.

### 5. ⏱️ Dual-Timer Engine
- **Call Elapsed Duration Counter (`00:14:23`)**: Tracks active room time with an animated green pulse indicator (identical to Google Meet, Zoom, or WhatsApp calls).
- **Sprint / Pomodoro Countdown Timer (`25:00`)**: Keeps teams focused with 15m, 25m, 45m, and 60m presets, custom minute inputs, circular progress ring, and a harmonic bell chime.

### 6. 📦 Pro Multi-Format Export Suite
- **Scaled PNG**: 1x (Standard), 2x (Retina HD), and 3x (Print Ultra) with an optional transparent background toggle.
- **Resolution-Independent SVG**: Vector markup export of all strokes, shapes, and text.
- **Board Backup & Restore (`.json` / `.synapse`)**: 1-click backup of your entire whiteboard to a portable JSON file, ready to be restored in any session.
- **Meeting Notes & Transcript (`.md`)**: Automatically compiles room metadata, participant roster, sticky notes grouped by author, and the full chat log into a clean Markdown summary.

---

## 🔒 Privacy & Zero-Cloud Architecture

| Traditional Platforms | Synapse Room |
| :--- | :--- |
| Requires account, email, and password | **Zero signups** — pick a display name and collaborate |
| Stores chats and files in cloud databases indefinitely | **Zero cloud storage** — all data purged upon tab close |
| File size limits capped at 25MB - 100MB | **5GB+ files** streamed directly P2P from sender disk |
| Server-side message tracking | **Ephemeral RAM only** via WSS / WebSockets |

---

## 📱 Adaptive & Responsive UI/UX

Synapse Room automatically adapts to your hardware:
- **Desktops & Laptops**: Spacious layout with top dual timers, bottom floating toolbar, and side-by-side drawer.
- **Tablets & iPads**: Touch-first drawing, multi-touch gestures, and adaptive navigation.
- **Mobile Phones**:
  - Top bar compresses into thumb-friendly badges.
  - Floating bottom toolbar scrolls horizontally with smooth momentum (`overflow-x: auto`).
  - Sidebar transforms into an **86vw slide-over drawer** with a frosted backdrop.
  - **Floating Action Button (FAB)** in the bottom right enables 1-tap thumb access to Chat, Files, and Users.

---

## 🚀 How to Try it Online (Zero Installation)

### Option A: 1-Click Deploy on GitHub Pages (Free Forever)
1. Fork or clone this repository to your GitHub account:
   ```bash
   git clone https://github.com/<your-username>/synapse-room.git
   cd synapse-room
   ```
2. In your GitHub repository settings, go to **Settings > Pages**.
3. Under **Build and deployment > Source**, select **Deploy from a branch**.
4. Set branch to `main` (or `master`) and folder to `/ (root)`, then click **Save**.
5. Your live room is ready at: `https://<your-username>.github.io/synapse-room/`!

### Option B: Deploy on Vercel
1. Import your repository into [Vercel](https://vercel.com).
2. Framework Preset: **Other** (no build steps required).
3. Click **Deploy**.

---

## 💻 Local Testing & Multi-User Verification

Because Synapse Room includes a **Universal Hybrid Sync Engine**, it works both offline across browser tabs and worldwide across different devices:

1. **Launch Local Server:**
   ```powershell
   python -m http.server 3000
   ```
2. **Open Window 1:** Navigate to `http://localhost:3000` and click **Create New Room**.
3. **Open Window 2:** Copy the invite link from the top bar (`http://localhost:3000#ROOM-CODE`) and open it in a second window or mobile phone on the same Wi-Fi.
4. **Experience Real-Time Collaboration:**
   - Draw on Window 1 -> Stroke and multiplayer cursor appear instantly on Window 2.
   - Drop a large file on Window 1 -> Click Download on Window 2 to observe live chunk streaming.
   - Click "Follow" in the Users tab to lock your perspective to another collaborator.

---

## 🛠️ Technology Stack

- **Frontend Core:** Vanilla HTML5, Modern CSS Variables, Modular ES6+ JavaScript.
- **Graphics Engine:** HTML5 Canvas 2D with High-DPI (`devicePixelRatio`) scaling and DOM interactive overlay.
- **Audio Engine:** Web Audio API (real-time harmonic frequency synthesis, 0 audio file dependencies).
- **Global Real-Time Signaling:** MQTT over Secure WebSockets (`wss://`) across public TLS brokers with zero-config failover.
- **Local Fallback:** HTML5 `BroadcastChannel` with duplicate ring buffer filtering.
- **Audit Compliance:** Validated via deterministic offline invariant analysis (`audit_invariants.py`, `delivery_gate.py`).

---

## 📄 License

Distributed under the **MIT License**. Free for students, educators, developers, and commercial teams.
