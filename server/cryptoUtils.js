/**
 * Cryptographic & Validation Utilities for Server-Side Operations
 * 
 * IMPORTANT: The server ONLY generates room IDs and validates network inputs.
 * It NEVER performs chat encryption/decryption or handles encryption keys.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * Generate a cryptographically secure random Room ID.
 * Returns a standard UUID v4 or random hex string.
 * @returns {string}
 */
function generateRoomId() {
  // Use UUID v4 for unique room IDs
  return uuidv4();
}

/**
 * Validate room ID format to prevent path traversal or injection attacks.
 * @param {string} roomId 
 * @returns {boolean}
 */
function isValidRoomId(roomId) {
  if (typeof roomId !== 'string') return false;
  // Room IDs should be alphanumeric with hyphens, 10 to 64 chars
  const roomIdRegex = /^[a-zA-Z0-9-]{10,64}$/;
  return roomIdRegex.test(roomId);
}

/**
 * Sanitize and validate user display name.
 * @param {string} username 
 * @returns {string}
 */
function sanitizeUsername(username) {
  if (typeof username !== 'string' || !username.trim()) {
    return `Anonymous-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  // Trim and limit to 32 characters, strip HTML tags/script tags
  const sanitized = username.trim().replace(/<[^>]*>?/gm, '').substring(0, 32);
  return sanitized.length > 0 ? sanitized : `Anonymous-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Validate encrypted message payload structure and size bounds.
 * @param {object} payload 
 * @returns {{valid: boolean, reason?: string}}
 */
function validateEncryptedPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'Invalid payload format' };
  }

  const { roomId, ciphertext, iv, messageId } = payload;

  if (!isValidRoomId(roomId)) {
    return { valid: false, reason: 'Invalid room ID' };
  }

  if (typeof ciphertext !== 'string' || !ciphertext) {
    return { valid: false, reason: 'Missing or invalid ciphertext' };
  }

  // Prevent giant payloads (e.g. limit ciphertext to 64KB)
  if (ciphertext.length > 65536) {
    return { valid: false, reason: 'Payload size exceeds limit' };
  }

  if (typeof iv !== 'string' || !iv) {
    return { valid: false, reason: 'Missing or invalid IV' };
  }

  if (typeof messageId !== 'string' || !messageId) {
    return { valid: false, reason: 'Missing message ID' };
  }

  return { valid: true };
}

module.exports = {
  generateRoomId,
  isValidRoomId,
  sanitizeUsername,
  validateEncryptedPayload
};
