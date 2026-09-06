# 🛡️ ZeroTrace

> **Zero-Knowledge Private Real-Time Encrypted Messaging**

🌐 **Live Application Link**: [https://zerotrace-chat.onrender.com](https://zerotrace-chat.onrender.com)

**ZeroTrace** is a production-quality, zero-knowledge, real-time private messaging application. It allows two users to establish ephemeral, end-to-end encrypted chat rooms via QR codes or invite links without server access to plaintext messages or encryption keys.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture & Data Flow](#architecture--data-flow)
- [Project Folder Structure](#project-folder-structure)
- [Installation & Quick Start](#installation--quick-start)
- [Environment Variables](#environment-variables)
- [How Encryption Works (Web Crypto API)](#how-encryption-works-web-crypto-api)
- [Why the Encryption Key is in the URL Fragment (`#KEY`)](#why-the-encryption-key-is-in-the-url-fragment-key)
- [QR Code Generation & Invite Flow](#qr-code-generation--invite-flow)
- [Socket.IO & Room Management](#socketio--room-management)
- [Security Disclosures & Considerations](#security-disclosures--considerations)
- [Development & Production Deployment](#development--production-deployment)
- [Known Limitations](#known-limitations)
- [Future Improvements](#future-improvements)

---

## 🌟 Overview

The primary goal of **PrivateQR Chat** is privacy, simplicity, and a modern user experience. Each chat room is protected by a 256-bit symmetric AES-GCM key generated locally inside the browser. The server acts purely as an opaque relay for encrypted ciphertext and never sees plaintext content or key material.

---

## ✨ Key Features

- **Zero-Knowledge Server Architecture**: Messages are encrypted BEFORE transmission. The backend cannot read chat messages.
- **Client-Side Web Crypto API**: Uses standard native `crypto.subtle` for `AES-256-GCM` encryption/decryption with 96-bit random IVs per message.
- **QR Code & Link Sharing**: Generates QR codes directly in the browser containing the full invite link with the encryption key in the hash fragment.
- **Strict Capacity & Expiry**: Maximum of 2 users per room (configurable). Rooms auto-expire upon inactivity or when empty.
- **Real-Time Features**: Socket.IO messaging, typing indicators, presence events ("User joined", "User left"), display name customization, and auto-scrolling.
- **Modern Dark UI**: Signal / WhatsApp / Discord inspired aesthetics with responsive glassmorphic cards and crisp visual indicators.

---

## 🏗️ Architecture & Data Flow

```
+-------------------+                 +-------------------+
|  USER A BROWSER   |                 |  USER B BROWSER   |
+-------------------+                 +-------------------+
| Plaintext Message |                 | Decrypted Message |
|        |          |                 |        ^          |
| AES-256-GCM Encrypt                 | AES-256-GCM Decrypt
|        v          |                 |        |          |
|    Ciphertext     |                 |    Ciphertext     |
+--------|----------+                 +--------|----------+
         |                                     ^
         | Socket.IO payload                   | Socket.IO payload
         | (Ciphertext + IV)                   | (Ciphertext + IV)
         v                                     |
+---------------------------------------------------------+
|                  PRIVATEQR CHAT SERVER                  |
|                 (Node.js + Express + Socket.IO)         |
|                                                         |
|  * Opaque Relay Only                                    |
|  * NO Decryption Capability                             |
|  * NO Key Access                                        |
+---------------------------------------------------------+
```

---

## 📁 Project Folder Structure

```
privateqr-chat/
│
├── server/
│   ├── server.js          # Express app, Helmet, CORS, Rate Limiting, Socket.IO server
│   ├── roomManager.js     # In-memory Map room management, capacity & cleanup logic
│   ├── socketHandler.js   # Socket.IO connection handling & payload relay
│   └── cryptoUtils.js     # Secure Room ID generation & payload sanitization
│
├── public/
│   ├── index.html         # Room creation page & QR code display
│   ├── chat.html          # Real-time encrypted chat UI
│   ├── css/
│   │   └── style.css      # Dark mode design system (Signal/Discord aesthetic)
│   └── js/
│       ├── index.js       # Room creation & QR invite controller
│       ├── chat.js        # Chat page logic, socket events, E2E crypto integration
│       ├── crypto.js      # Web Crypto API wrapper (AES-256-GCM, IV, import/export)
│       └── lib/
│           └── qrcode.min.js # Client-side QR code generator library
│
├── test-socket.js         # Automated end-to-end socket integration test script
├── .env.example           # Environment variables template
├── .gitignore             # Git ignore file
├── package.json           # Project metadata & npm dependencies
└── README.md              # Documentation & Security Disclosure
```

---

## 🚀 Installation & Quick Start

### Prerequisites
- Node.js (v18 or higher recommended)
- npm

### Step-by-Step Setup

1. **Clone repository & navigate into directory:**
   ```bash
   cd privateqr-chat
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```

4. **Start the server:**
   - **Production mode:**
     ```bash
     npm start
     ```
   - **Development mode (with auto-reload):**
     ```bash
     npm run dev
     ```

5. **Open Application in Browser:**
   Navigate to `http://localhost:3000` (or `http://127.0.0.1:3000`).

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` to customize runtime settings:

```ini
PORT=3000
HOST=127.0.0.1
NODE_ENV=development
CLIENT_URL=http://localhost:3000
ROOM_EXPIRY_MINUTES=30
MAX_ROOM_USERS=2
```

---

## 🔐 How Encryption Works (Web Crypto API)

Every room created uses native browser cryptographic primitives provided by `window.crypto.subtle`:

1. **Key Generation**: Browser A generates a 256-bit symmetric AES-GCM key (`crypto.subtle.generateKey`).
2. **Key Export**: The key is exported as raw bytes, converted to Base64URL, and appended to the invite URL fragment: `https://domain/join/ROOM_ID#BASE64_KEY`.
3. **Key Import**: Browser B opens the link, extracts `#BASE64_KEY` from `window.location.hash`, and imports it via `crypto.subtle.importKey`.
4. **Message Encryption**:
   - For every message, a fresh 96-bit (12-byte) random Initialization Vector (IV) is generated via `crypto.getRandomValues()`.
   - Message text is encoded to bytes (`TextEncoder`) and encrypted with `crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)`.
   - Output includes ciphertext and authentication tag.
5. **Message Decryption**:
   - Receiving browser passes ciphertext and IV to `crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)`.
   - If key or ciphertext is tampered with, decryption fails gracefully with "Unable to decrypt message."

---

## 🔗 Why the Encryption Key is in the URL Fragment (`#KEY`)

According to RFC 3986, **URL hash fragments (`#KEY`) are processed exclusively by the browser and are NEVER transmitted in HTTP request headers sent to the web server**.

For example, when navigating to:
`https://localhost:3000/join/abc123#base64-encryption-key`

The HTTP server receives ONLY:
`GET /join/abc123`

The `#base64-encryption-key` remains strictly inside `window.location.hash` in client browser memory. This guarantees zero-knowledge confidentiality from the server.

---

## 📱 QR Code Generation & Invite Flow

1. Clicking "Create Private Room" calls `/api/rooms` to reserve a Room ID.
2. The browser generates the AES-256-GCM key and constructs `https://domain/join/ROOM_ID#KEY`.
3. The client-side JavaScript QR code library (`public/js/lib/qrcode.min.js`) renders the QR code onto a HTML5 `<canvas>`.
4. The QR code image contains the complete invite URL including the fragment key.
5. Scanning the QR code on a smartphone opens the invite link directly with the key pre-loaded into the browser hash fragment.

---

## 📡 Socket.IO & Room Management

- **Room Boundaries**: Socket connections join named Socket.IO rooms matching `roomId`.
- **Relay Payload Structure**:
  ```json
  {
    "roomId": "ca546aba-ba5f-43df-817a-2a83eea18a25",
    "messageId": "msg-9f2a-1724680000",
    "ciphertext": "QUVTLTI1Ni1HQ00tQ2lwaGVydGV4dA==",
    "iv": "MTIzNDU2Nzg5MDEy",
    "timestamp": 1724680000000
  }
  ```
- **Capacity Limit**: Enforces `MAX_ROOM_USERS=2`. A 3rd user attempting to join receives `"Room is full."`.
- **Auto-Clean**: Idle rooms without members or exceeding `ROOM_EXPIRY_MINUTES` are purged from the server `Map` memory automatically.

---

## 🛡️ Security Disclosures & Considerations

> [!IMPORTANT]
> **DISCLAIMER**: This application is an educational, privacy-focused open-source tool. Do not falsely assume it provides absolute anonymity or military-grade security.

### Security Guarantees:
- **Message Confidentiality**: The server cannot read plaintext message content.
- **Key Privacy**: Encryption keys never hit server logs or socket events.
- **Forward Secrecy (Per Room)**: Each room possesses an independent symmetric key.

### Important Operational Constraints:
- **HTTPS Required in Production**: In production, HTTPS (TLS) is mandatory to prevent network eavesdroppers from altering frontend scripts.
- **Server Metadata**: The server operator can observe metadata including client IP addresses, socket connection timing, room IDs, and ciphertext payload sizes.
- **Invite URL Confidentiality**: Complete invite URLs (and QR codes) containing `#KEY` must be treated like passwords. Anyone with access to the link can join the room.
- **Client Endpoint Security**: Encryption takes place in the browser. If a user's device or browser extension is compromised by malware, message privacy may be breached on the client side.

---

## 🛠️ Development Setup & Automated Testing

Run the built-in end-to-end integration test suite:

```bash
node test-socket.js
```

The test script validates:
1. Room creation API and socket handler
2. Capacity enforcement (max 2 members, 3rd blocked)
3. Ciphertext payload relay integrity

---

## 🚢 Production Deployment

1. **Deploy behind a Reverse Proxy (Nginx / Caddy / Cloudflare):**
   Configure SSL/TLS termination so all traffic is served over `https://`.
2. **Environment Configuration:**
   Set `NODE_ENV=production` and specify `CLIENT_URL=https://yourdomain.com`.
3. **Process Management:**
   Use PM2 or Docker:
   ```bash
   npx pm2 start server/server.js --name privateqr-chat
   ```

---

## ⚠️ Known Limitations

- **Volatile Storage**: Rooms and message history exist only in memory during an active session. Refreshing the browser clears history.
- **Symmetric Key Sharing**: If an invite link is leaked publicly, anyone can join before the 2nd user connects.

---

## 🔮 Future Improvements

- Option for manual password protection on top of room keys.
- Diffie-Hellman / ECDH key exchange for dynamic per-pair key negotiation.
- Disappearing/self-destructing timed messages.
- WebRTC peer-to-peer data channels for direct browser-to-browser transmission.
