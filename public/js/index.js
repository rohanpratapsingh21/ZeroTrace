/**
 * PrivateQR Chat - Index Page Controller
 * Manages room creation, Web Crypto key generation, client QR code rendering, and link sharing.
 */

document.addEventListener('DOMContentLoaded', () => {
  const createRoomBtn = document.getElementById('create-room-btn');
  const actionPanel = document.getElementById('action-panel');
  const qrModal = document.getElementById('qr-modal');
  const qrCanvas = document.getElementById('qr-canvas');
  const inviteLinkInput = document.getElementById('invite-link-input');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const shareLinkBtn = document.getElementById('share-link-btn');
  const enterRoomBtn = document.getElementById('enter-room-btn');
  const joinForm = document.getElementById('join-form');
  const joinInput = document.getElementById('join-input');

  let currentInviteUrl = '';

  /**
   * Render QR Code using client-side QRCode library canvas renderer.
   * Encodes full invite URL including `#KEY` fragment.
   * @param {string} text 
   */
  function renderQRCode(text) {
    if (window.QRCode && window.QRCode.toCanvas) {
      window.QRCode.toCanvas(
        qrCanvas,
        text,
        {
          width: 200,
          margin: 2,
          color: {
            dark: '#0B0F19',
            light: '#FFFFFF'
          }
        },
        (err) => {
          if (err) console.error('QR code rendering failed:', err);
        }
      );
    } else {
      console.warn('QRCode library not loaded yet.');
    }
  }

  /**
   * Handle "Create Private Room" click
   */
  if (createRoomBtn) {
    createRoomBtn.addEventListener('click', async () => {
      try {
        createRoomBtn.disabled = true;
        createRoomBtn.innerHTML = '<span>⏳</span> Generating Room & Key...';

        // 1. Fetch new Room ID from server API
        const res = await fetch('/api/rooms', { method: 'POST' });
        const data = await res.json();

        if (!data.success || !data.roomId) {
          throw new Error(data.error || 'Failed to create room.');
        }

        const roomId = data.roomId;

        // 2. Generate client-side AES-256-GCM encryption key
        const cryptoKey = await window.CryptoManager.generateEncryptionKey();
        const keyString = await window.CryptoManager.exportKey(cryptoKey);

        // 3. Construct full invite URL with key in hash fragment
        // Format: https://domain/join/ROOM_ID#ENCRYPTION_KEY
        currentInviteUrl = `${window.location.origin}/join/${roomId}#${keyString}`;

        // 4. Render QR code on canvas
        renderQRCode(currentInviteUrl);

        // 5. Update UI display
        inviteLinkInput.value = currentInviteUrl;
        qrModal.style.display = 'flex';

        // Scroll modal into view smoothly
        qrModal.scrollIntoView({ behavior: 'smooth' });

      } catch (err) {
        alert(`Error: ${err.message}`);
        console.error(err);
      } finally {
        createRoomBtn.disabled = false;
        createRoomBtn.innerHTML = '<span>➕</span> Create Private Room';
      }
    });
  }

  /**
   * Copy Invite Link to Clipboard
   */
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async () => {
      if (!currentInviteUrl) return;
      try {
        await navigator.clipboard.writeText(currentInviteUrl);
        const origText = copyLinkBtn.innerText;
        copyLinkBtn.innerText = 'Copied! ✓';
        copyLinkBtn.style.background = 'var(--success)';
        copyLinkBtn.style.color = '#fff';
        setTimeout(() => {
          copyLinkBtn.innerText = origText;
          copyLinkBtn.style.background = '';
          copyLinkBtn.style.color = '';
        }, 2000);
      } catch (err) {
        console.error('Clipboard copy failed:', err);
        inviteLinkInput.select();
        document.execCommand('copy');
      }
    });
  }

  /**
   * Web Share API for Mobile Devices
   */
  if (shareLinkBtn) {
    shareLinkBtn.addEventListener('click', async () => {
      if (!currentInviteUrl) return;
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'ZeroTrace Private Invite',
            text: 'Join my zero-knowledge encrypted chat room on ZeroTrace:',
            url: currentInviteUrl
          });
        } catch (err) {
          if (err.name !== 'AbortError') console.error('Share failed:', err);
        }
      } else {
        alert('Web Share is not supported on this browser. Use Copy Link instead.');
      }
    });
  }

  /**
   * Enter Room Directly
   */
  if (enterRoomBtn) {
    enterRoomBtn.addEventListener('click', () => {
      if (currentInviteUrl) {
        window.location.href = currentInviteUrl;
      }
    });
  }

  /**
   * Join Form Submission
   */
  if (joinForm) {
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = joinInput.value.trim();
      if (!val) return;

      // If user pasted full URL, navigate directly
      if (val.startsWith('http://') || val.startsWith('https://')) {
        window.location.href = val;
      } else if (val.includes('#')) {
        // If passed ROOM_ID#KEY format
        window.location.href = `${window.location.origin}/join/${val}`;
      } else {
        // If passed room ID only, ask user or alert that key is missing in URL hash
        alert('Notice: Private links require an encryption key (#KEY). Ensure your link includes the hash fragment.');
        window.location.href = `${window.location.origin}/join/${val}`;
      }
    });
  }
});
