/**
 * PrivateQR Chat - Web Crypto API (AES-256-GCM) Client Module
 * 
 * Provides end-to-end symmetric encryption directly in the browser.
 * The server never receives, sees, or handles the encryption keys or plaintext.
 */

class WebCryptoManager {
  constructor() {
    if (!window.crypto || !window.crypto.subtle) {
      console.error('Web Crypto API is not supported in this browser environment.');
    }
  }

  /**
   * Convert ArrayBuffer to Base64URL string.
   * @param {ArrayBuffer} buffer 
   * @returns {string}
   */
  bufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Convert Base64URL string to Uint8Array/ArrayBuffer.
   * @param {string} base64url 
   * @returns {ArrayBuffer}
   */
  base64UrlToBuffer(base64url) {
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Generate a cryptographically secure 256-bit AES-GCM symmetric key.
   * @returns {Promise<CryptoKey>}
   */
  async generateEncryptionKey() {
    try {
      return await window.crypto.subtle.generateKey(
        {
          name: 'AES-GCM',
          length: 256
        },
        true, // extractable (so we can export to URL fragment)
        ['encrypt', 'decrypt']
      );
    } catch (err) {
      console.error('Failed to generate AES-GCM key:', err);
      throw new Error('Cryptographic key generation failed.');
    }
  }

  /**
   * Export CryptoKey to raw base64url string for inclusion in URL hash fragment (#KEY).
   * @param {CryptoKey} key 
   * @returns {Promise<string>}
   */
  async exportKey(key) {
    try {
      const exportedRaw = await window.crypto.subtle.exportKey('raw', key);
      return this.bufferToBase64Url(exportedRaw);
    } catch (err) {
      console.error('Failed to export key:', err);
      throw new Error('Key export failed.');
    }
  }

  /**
   * Import raw base64url string back into a CryptoKey object.
   * @param {string} keyString Base64URL encoded key
   * @returns {Promise<CryptoKey>}
   */
  async importKey(keyString) {
    try {
      const rawBuffer = this.base64UrlToBuffer(keyString);
      return await window.crypto.subtle.importKey(
        'raw',
        rawBuffer,
        {
          name: 'AES-GCM',
          length: 256
        },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (err) {
      console.error('Failed to import key:', err);
      throw new Error('Invalid or corrupted encryption key.');
    }
  }

  /**
   * Encrypt a plaintext message using AES-256-GCM.
   * Uses a unique 96-bit (12-byte) random Initialization Vector (IV) per message.
   * 
   * @param {string} plaintext 
   * @param {CryptoKey} key 
   * @returns {Promise<{ ciphertext: string, iv: string }>}
   */
  async encryptMessage(plaintext, key) {
    try {
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(plaintext);

      // Generate a fresh 96-bit (12 bytes) IV for every message
      const iv = window.crypto.getRandomValues(new Uint8Array(12));

      const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        key,
        encodedData
      );

      return {
        ciphertext: this.bufferToBase64Url(encryptedBuffer),
        iv: this.bufferToBase64Url(iv.buffer)
      };
    } catch (err) {
      console.error('Encryption failed:', err);
      throw new Error('Failed to encrypt message.');
    }
  }

  /**
   * Decrypt AES-256-GCM ciphertext using IV and key.
   * Handles authentication tag check and decryption errors gracefully.
   * 
   * @param {string} ciphertextBase64Url 
   * @param {string} ivBase64Url 
   * @param {CryptoKey} key 
   * @returns {Promise<{ success: boolean, plaintext?: string, error?: string }>}
   */
  async decryptMessage(ciphertextBase64Url, ivBase64Url, key) {
    try {
      const ciphertextBuffer = this.base64UrlToBuffer(ciphertextBase64Url);
      const ivBuffer = this.base64UrlToBuffer(ivBase64Url);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(ivBuffer)
        },
        key,
        ciphertextBuffer
      );

      const decoder = new TextDecoder();
      const plaintext = decoder.decode(decryptedBuffer);

      return { success: true, plaintext };
    } catch (err) {
      // Return user-friendly failure without exposing low-level stack trace
      console.warn('Decryption failed (tampered data or wrong key):', err);
      return { success: false, error: 'Unable to decrypt message.' };
    }
  }
}

// Export singleton instance for browser consumption
window.CryptoManager = new WebCryptoManager();
