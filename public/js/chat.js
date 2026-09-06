/**
 * PrivateQR Chat - Real-Time Encrypted Chat Controller
 * 
 * Handles Socket.IO connection, client-side Web Crypto AES-256-GCM encryption/decryption,
 * typing indicators, presence, and UI state.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const roomTitleEl = document.getElementById('room-title');
  const roomIdDisplayEl = document.getElementById('room-id-display');
  const statusDotEl = document.getElementById('status-dot');
  const statusTextEl = document.getElementById('status-text');
  const userCountDisplayEl = document.getElementById('user-count-display');
  const usernameInputEl = document.getElementById('username-input');
  const messagesContainer = document.getElementById('messages-container');
  const typingIndicatorEl = document.getElementById('typing-indicator');
  const typingTextEl = document.getElementById('typing-text');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const showQrBtn = document.getElementById('show-qr-btn');

  // QR Modal elements
  const qrModalOverlay = document.getElementById('qr-modal-overlay');
  const closeQrModal = document.getElementById('close-qr-modal');
  const chatQrCanvas = document.getElementById('chat-qr-canvas');
  const chatInviteInput = document.getElementById('chat-invite-input');
  const chatCopyLinkBtn = document.getElementById('chat-copy-link-btn');

  // Parse Room ID from path and Key from URL fragment hash
  const pathParts = window.location.pathname.split('/');
  const roomId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
  const keyHash = window.location.hash.replace('#', '');

  let roomCryptoKey = null;
  let currentSocketId = null;
  let localUsername = localStorage.getItem('pqr_username') || `Anonymous-${Math.floor(1000 + Math.random() * 9000)}`;
  let typingTimeout = null;
  let isTyping = false;

  usernameInputEl.value = localUsername;
  roomIdDisplayEl.innerText = `Room: ${roomId}`;
  roomTitleEl.innerText = `🛡️ ZeroTrace Private Room`;

  // --------------------------------------------------------------------------
  // 1. CRYPTO KEY INITIALIZATION
  // --------------------------------------------------------------------------
  if (!keyHash) {
    appendSystemMessage('⚠️ WARNING: Encryption key missing in URL fragment (#KEY). You cannot send or decrypt messages.', true);
    messageInput.disabled = true;
    sendBtn.disabled = true;
  } else {
    try {
      roomCryptoKey = await window.CryptoManager.importKey(keyHash);
      console.log('✓ Client AES-256-GCM encryption key imported successfully.');
    } catch (err) {
      appendSystemMessage('❌ ERROR: Invalid encryption key in URL. Decryption unavailable.', true);
      messageInput.disabled = true;
      sendBtn.disabled = true;
    }
  }

  // --------------------------------------------------------------------------
  // 2. SOCKET.IO CONNECTION & ROOM JOIN
  // --------------------------------------------------------------------------
  const socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    currentSocketId = socket.id;
    updateStatus('connected', 'Connected');
    
    // Request to join room
    socket.emit('join-room', { roomId, username: localUsername }, (response) => {
      if (!response || !response.success) {
        handleJoinFailure(response ? response.reason : 'Join failed.');
      } else {
        handleJoinedSuccess(response);
      }
    });
  });

  socket.on('disconnect', (reason) => {
    updateStatus('disconnected', `Disconnected (${reason})`);
  });

  socket.on('reconnect', () => {
    updateStatus('connected', 'Reconnected');
    socket.emit('join-room', { roomId, username: localUsername }, (response) => {
      if (response && response.success) {
        handleJoinedSuccess(response);
      }
    });
  });

  socket.on('room-not-found', (data) => {
    handleJoinFailure(data.reason || 'Room not found or expired.');
  });

  socket.on('room-full', (data) => {
    handleJoinFailure('Room is full. Maximum 2 members allowed.');
  });

  socket.on('joined-success', (data) => {
    handleJoinedSuccess(data);
  });

  socket.on('user-joined', (data) => {
    updateUserCount(data.users ? data.users.length : 2);
    appendSystemMessage(`🟢 ${data.user.username} joined the chat.`);
  });

  socket.on('user-left', (data) => {
    updateUserCount(data.users ? data.users.length : 1);
    appendSystemMessage(`🔴 ${data.user.username} left the chat.`);
  });

  socket.on('username-updated', (data) => {
    updateUserCount(data.users ? data.users.length : 1);
    if (data.socketId !== currentSocketId) {
      appendSystemMessage(`ℹ️ User updated name to "${data.updatedUser.username}".`);
    }
  });

  // --------------------------------------------------------------------------
  // 3. ENCRYPTED MESSAGING RELAY
  // --------------------------------------------------------------------------

  // Listen for incoming encrypted messages
  socket.on('encrypted-message', async (data) => {
    const { messageId, ciphertext, iv, timestamp, senderSocketId, senderUsername } = data;
    const isSentByMe = senderSocketId === currentSocketId;

    if (!roomCryptoKey) {
      renderMessageBubble({
        sender: senderUsername,
        text: 'Unable to decrypt message (missing key).',
        timestamp,
        isSentByMe,
        isError: true
      });
      return;
    }

    // Decrypt message in browser using Web Crypto API
    const decryptResult = await window.CryptoManager.decryptMessage(ciphertext, iv, roomCryptoKey);

    if (decryptResult.success) {
      renderMessageBubble({
        sender: senderUsername,
        text: decryptResult.plaintext,
        timestamp,
        isSentByMe,
        isError: false
      });
    } else {
      renderMessageBubble({
        sender: senderUsername,
        text: 'Unable to decrypt message.',
        timestamp,
        isSentByMe,
        isError: true
      });
    }
  });

  // Handle message sending
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const plaintext = messageInput.value.trim();
    if (!plaintext || !roomCryptoKey) return;

    try {
      sendBtn.disabled = true;

      // Encrypt message using AES-256-GCM BEFORE transmitting to server
      const { ciphertext, iv } = await window.CryptoManager.encryptMessage(plaintext, roomCryptoKey);

      const messageId = generateMessageId();
      const payload = {
        roomId,
        messageId,
        ciphertext,
        iv,
        timestamp: Date.now()
      };

      // Emit encrypted payload over Socket.IO
      socket.emit('encrypted-message', payload);

      // Stop typing status
      emitTypingStop();

      // Clear input area
      messageInput.value = '';
      messageInput.style.height = 'auto';

    } catch (err) {
      console.error('Failed to send encrypted message:', err);
      appendSystemMessage('❌ Failed to encrypt message.', true);
    } finally {
      sendBtn.disabled = false;
      messageInput.focus();
    }
  });

  // --------------------------------------------------------------------------
  // 4. TYPING INDICATOR
  // --------------------------------------------------------------------------
  messageInput.addEventListener('input', () => {
    // Auto grow textarea
    messageInput.style.height = 'auto';
    messageInput.style.height = (messageInput.scrollHeight) + 'px';

    if (!isTyping) {
      isTyping = true;
      socket.emit('typing-start', { roomId });
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      emitTypingStop();
    }, 2000);
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  function emitTypingStop() {
    if (isTyping) {
      isTyping = false;
      socket.emit('typing-stop', { roomId });
    }
  }

  socket.on('user-typing', (data) => {
    if (data.socketId !== currentSocketId) {
      typingTextEl.innerText = `${data.username} is typing...`;
      typingIndicatorEl.style.display = 'flex';
      scrollToBottom();
    }
  });

  socket.on('user-stop-typing', (data) => {
    if (data.socketId !== currentSocketId) {
      typingIndicatorEl.style.display = 'none';
    }
  });

  // --------------------------------------------------------------------------
  // 5. DISPLAY NAME EDITING
  // --------------------------------------------------------------------------
  usernameInputEl.addEventListener('change', () => {
    const newName = usernameInputEl.value.trim();
    if (!newName) return;

    localUsername = newName;
    localStorage.setItem('pqr_username', localUsername);

    socket.emit('update-username', { newUsername: localUsername }, (res) => {
      if (res && res.success) {
        appendSystemMessage(`You updated your display name to "${res.user.username}".`);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. UI HELPER FUNCTIONS
  // --------------------------------------------------------------------------
  function updateStatus(state, text) {
    statusTextEl.innerText = text;
    statusDotEl.className = `status-dot ${state}`;
  }

  function updateUserCount(count) {
    userCountDisplayEl.innerText = `Users: ${count}/2`;
  }

  function handleJoinFailure(reason) {
    appendSystemMessage(`❌ ${reason}`, true);
    messageInput.disabled = true;
    sendBtn.disabled = true;
    updateStatus('disconnected', 'Join Failed');
  }

  function appendSystemMessage(text, isError = false) {
    const div = document.createElement('div');
    div.className = 'system-message';
    if (isError) div.style.color = '#FCA5A5';
    div.innerText = text;
    messagesContainer.appendChild(div);
    scrollToBottom();
  }

  let isRoomOwner = false;
  let isHoldToRevealMode = true; // Enabled by default
  const privacyToggleBtn = document.getElementById('privacy-toggle-btn');

  function handleJoinedSuccess(data) {
    updateUserCount(data.users ? data.users.length : 1);
    isRoomOwner = Boolean(data.isOwner);
    if (typeof data.isHoldToRevealMode === 'boolean') {
      isHoldToRevealMode = data.isHoldToRevealMode;
    }

    updatePrivacyToggleUI();
    const ownerTag = isRoomOwner ? ' (Room Owner 👑)' : '';
    appendSystemMessage(`You joined the room as "${data.user.username}"${ownerTag}.`);
  }

  socket.on('joined-success', (data) => {
    handleJoinedSuccess(data);
  });

  socket.on('privacy-mode-updated', (data) => {
    isHoldToRevealMode = Boolean(data.isHoldToRevealMode);
    updatePrivacyToggleUI();
    appendSystemMessage(`ℹ️ Room owner set Hold-to-Reveal privacy mode to ${isHoldToRevealMode ? 'ON' : 'OFF'}.`);
  });

  if (privacyToggleBtn) {
    privacyToggleBtn.addEventListener('click', () => {
      if (!isRoomOwner) {
        alert('Notice: Only the Room Owner can toggle the privacy mode.');
        return;
      }

      const newMode = !isHoldToRevealMode;
      socket.emit('toggle-privacy-mode', { roomId, mode: newMode }, (res) => {
        if (res && !res.success) {
          alert(res.reason || 'Failed to update privacy mode.');
        }
      });
    });
  }

  function updatePrivacyToggleUI() {
    if (isHoldToRevealMode) {
      messagesContainer.classList.add('hold-to-reveal-mode');
    } else {
      messagesContainer.classList.remove('hold-to-reveal-mode');
    }

    if (privacyToggleBtn) {
      if (isRoomOwner) {
        if (isHoldToRevealMode) {
          privacyToggleBtn.classList.add('active');
          privacyToggleBtn.innerHTML = '<span>🛡️</span> <span>Privacy: Hold-to-Reveal ON 👑</span>';
        } else {
          privacyToggleBtn.classList.remove('active');
          privacyToggleBtn.innerHTML = '<span>🔓</span> <span>Privacy: Hold-to-Reveal OFF 👑</span>';
        }
      } else {
        privacyToggleBtn.classList.remove('active');
        privacyToggleBtn.style.cursor = 'default';
        if (isHoldToRevealMode) {
          privacyToggleBtn.innerHTML = '<span>🛡️</span> <span>Privacy: Hold-to-Reveal ON (Owner Enforced)</span>';
        } else {
          privacyToggleBtn.innerHTML = '<span>🔓</span> <span>Privacy: Hold-to-Reveal OFF (Owner Enforced)</span>';
        }
      }
    }
  }

  function renderMessageBubble({ sender, text, timestamp, isSentByMe, isError }) {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isSentByMe ? 'sent' : 'received'} ${isError ? 'decryption-error' : ''}`;

    const senderDiv = document.createElement('div');
    senderDiv.className = 'message-sender';
    senderDiv.innerText = isSentByMe ? 'You' : sender;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const textSpan = document.createElement('div');
    textSpan.className = 'message-content-text';
    textSpan.innerText = text;

    const shieldDiv = document.createElement('div');
    shieldDiv.className = 'message-content-shield';
    shieldDiv.innerHTML = '<span>🔒 Hold to Reveal</span>';

    const metaDiv = document.createElement('div');
    metaDiv.className = 'message-meta';
    metaDiv.innerHTML = `<span>🔒 Encrypted</span> • <span>${formatTime(timestamp)}</span>`;

    contentDiv.appendChild(textSpan);
    contentDiv.appendChild(shieldDiv);
    contentDiv.appendChild(metaDiv);
    bubble.appendChild(senderDiv);
    bubble.appendChild(contentDiv);

    // Touch & Hold to Reveal Handlers (Mobile + Desktop)
    const revealMessage = (e) => {
      contentDiv.classList.add('revealed');
    };

    const hideMessage = (e) => {
      contentDiv.classList.remove('revealed');
    };

    // Mobile Touch Events
    contentDiv.addEventListener('touchstart', revealMessage, { passive: true });
    contentDiv.addEventListener('touchend', hideMessage);
    contentDiv.addEventListener('touchcancel', hideMessage);

    // Desktop Mouse Hold Events
    contentDiv.addEventListener('mousedown', revealMessage);
    contentDiv.addEventListener('mouseup', hideMessage);
    contentDiv.addEventListener('mouseleave', hideMessage);

    messagesContainer.appendChild(bubble);
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function formatTime(ts) {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function generateMessageId() {
    return 'msg-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
  }

  // --------------------------------------------------------------------------
  // 7. QR RESHARE MODAL
  // --------------------------------------------------------------------------
  if (showQrBtn) {
    showQrBtn.addEventListener('click', () => {
      const fullUrl = window.location.href;
      chatInviteInput.value = fullUrl;
      if (window.QRCode && window.QRCode.toCanvas) {
        window.QRCode.toCanvas(chatQrCanvas, fullUrl, { width: 180, margin: 2 });
      }
      qrModalOverlay.style.display = 'flex';
    });
  }

  if (closeQrModal) {
    closeQrModal.addEventListener('click', () => {
      qrModalOverlay.style.display = 'none';
    });
  }

  if (chatCopyLinkBtn) {
    chatCopyLinkBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        chatCopyLinkBtn.innerText = 'Copied!';
        setTimeout(() => { chatCopyLinkBtn.innerText = 'Copy'; }, 2000);
      } catch (err) {
        chatInviteInput.select();
        document.execCommand('copy');
      }
    });
  }

  // --------------------------------------------------------------------------
  // 8. SCREENSHOT & PRIVACY PROTECTION SYSTEM
  // --------------------------------------------------------------------------
  const privacyOverlay = document.getElementById('privacy-overlay');
  const mainWrapper = document.querySelector('.chat-wrapper');

  function triggerPrivacyBlur(showWarning = true) {
    if (mainWrapper) mainWrapper.classList.add('privacy-blurred');
    if (privacyOverlay && showWarning) privacyOverlay.style.display = 'flex';
  }

  function removePrivacyBlur() {
    if (mainWrapper) mainWrapper.classList.remove('privacy-blurred');
    if (privacyOverlay) privacyOverlay.style.display = 'none';
  }

  // 1. Prevent Right-Click Context Menu
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // 2. Prevent Copy & Cut Actions
  document.addEventListener('copy', (e) => {
    e.preventDefault();
  });
  document.addEventListener('cut', (e) => {
    e.preventDefault();
  });

  // 3. Intercept & Block Screenshot Keyboard Shortcuts
  window.addEventListener('keyup', (e) => {
    // PrintScreen Key
    if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
      e.preventDefault();
      triggerPrivacyBlur(true);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(''); // Clear clipboard immediately
      }
      setTimeout(removePrivacyBlur, 3000);
    }
  });

  window.addEventListener('keydown', (e) => {
    // Mac Screenshots (Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5)
    // Windows Screenshots (Win+Shift+S, PrintScreen, Ctrl+P, Ctrl+S, Ctrl+Shift+I)
    const isMacCmdShift = (e.metaKey || e.ctrlKey) && e.shiftKey;
    const isPrintKey = e.key === 'PrintScreen' || e.code === 'PrintScreen';
    const isSaveOrPrint = (e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P' || e.key === 's' || e.key === 'S');
    const isDevTools = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I' || e.key === 'c' || e.key === 'C');

    if (isPrintKey || isSaveOrPrint || isDevTools || (isMacCmdShift && (e.key === '3' || e.key === '4' || e.key === '5'))) {
      e.preventDefault();
      triggerPrivacyBlur(true);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText('');
      }
      setTimeout(removePrivacyBlur, 3000);
    }
  });

  // 4. Auto-Blur Chat on Focus Loss, App Switch, or Screen Recorder Overlay
  window.addEventListener('blur', () => {
    triggerPrivacyBlur(true);
  });

  window.addEventListener('focus', () => {
    removePrivacyBlur();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      triggerPrivacyBlur(true);
    } else {
      removePrivacyBlur();
    }
  });
});
