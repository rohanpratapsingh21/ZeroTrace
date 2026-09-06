/**
 * In-Memory Room Manager
 * Handles private room lifecycle, user capacity enforcement, and room cleanup.
 */

const { sanitizeUsername } = require('./cryptoUtils');

class RoomManager {
  constructor() {
    // Map<roomId, RoomObject>
    this.rooms = new Map();
    // Map<socketId, roomId> for fast lookup on socket disconnect
    this.socketToRoom = new Map();

    // Default configuration
    this.maxRoomUsers = parseInt(process.env.MAX_ROOM_USERS || '2', 10);
    this.roomExpiryMs = (parseInt(process.env.ROOM_EXPIRY_MINUTES || '30', 10)) * 60 * 1000;

    // Periodically clean up expired rooms (every 5 minutes)
    setInterval(() => this.cleanupExpiredRooms(), 5 * 60 * 1000);
  }

  /**
   * Create a new room with a given roomId.
   * @param {string} roomId 
   * @returns {object} room
   */
  createRoom(roomId) {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId);
    }

    const room = {
      roomId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      maxUsers: this.maxRoomUsers,
      ownerSocketId: null,
      isHoldToRevealMode: true,
      users: new Map() // Map<socketId, { socketId, username, joinedAt }>
    };

    this.rooms.set(roomId, room);
    return room;
  }

  /**
   * Fetch a room by ID.
   * @param {string} roomId 
   * @returns {object|null}
   */
  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Add a user to a room.
   * Enforces max capacity (2 users).
   * @param {string} roomId 
   * @param {string} socketId 
   * @param {string} rawUsername 
   * @returns {{ success: boolean, reason?: string, room?: object, user?: object }}
   */
  joinRoom(roomId, socketId, rawUsername) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return { success: false, reason: 'Room not found or expired.' };
    }

    if (room.users.has(socketId)) {
      return { success: true, room, user: room.users.get(socketId) };
    }

    if (room.users.size >= room.maxUsers) {
      return { success: false, reason: 'Room is full.' };
    }

    // Set owner if first user joining
    if (room.users.size === 0 || !room.ownerSocketId) {
      room.ownerSocketId = socketId;
    }

    const username = sanitizeUsername(rawUsername);
    const user = {
      socketId,
      username,
      joinedAt: Date.now()
    };

    room.users.set(socketId, user);
    room.lastActivity = Date.now();
    this.socketToRoom.set(socketId, roomId);

    return { success: true, room, user, isOwner: room.ownerSocketId === socketId };
  }

  /**
   * Update Privacy Mode for a room (Owner only).
   * @param {string} roomId 
   * @param {string} socketId 
   * @param {boolean} mode 
   */
  setRoomPrivacyMode(roomId, socketId, mode) {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, reason: 'Room not found.' };
    if (room.ownerSocketId !== socketId) {
      return { success: false, reason: 'Only the room owner can change privacy settings.' };
    }
    room.isHoldToRevealMode = Boolean(mode);
    return { success: true, isHoldToRevealMode: room.isHoldToRevealMode };
  }

  /**
   * Remove user by socket ID.
   * @param {string} socketId 
   * @returns {{ roomId: string, user: object, remainingUsers: Array } | null}
   */
  leaveRoom(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;

    this.socketToRoom.delete(socketId);
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const user = room.users.get(socketId);
    room.users.delete(socketId);
    room.lastActivity = Date.now();

    const remainingUsers = Array.from(room.users.values());

    // If room is now empty, delete room immediately
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
    }

    return {
      roomId,
      user,
      remainingUsers
    };
  }

  /**
   * Update username for a connected user.
   * @param {string} socketId 
   * @param {string} newUsername 
   * @returns {{ success: boolean, roomId?: string, updatedUser?: object }}
   */
  updateUsername(socketId, newUsername) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return { success: false, reason: 'User not in a room.' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, reason: 'Room not found.' };

    const user = room.users.get(socketId);
    if (!user) return { success: false, reason: 'User not found in room.' };

    user.username = sanitizeUsername(newUsername);
    return { success: true, roomId, updatedUser: user };
  }

  /**
   * Get all active users in a room.
   * @param {string} roomId 
   * @returns {Array}
   */
  getRoomUsers(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.users.values());
  }

  /**
   * Cleanup expired or inactive rooms.
   */
  cleanupExpiredRooms() {
    const now = Date.now();
    for (const [roomId, room] of this.rooms.entries()) {
      const isExpired = (now - room.lastActivity) > this.roomExpiryMs;
      const isEmpty = room.users.size === 0;

      if (isExpired || isEmpty) {
        // Clean up socket mapping for any lingering sockets
        for (const socketId of room.users.keys()) {
          this.socketToRoom.delete(socketId);
        }
        this.rooms.delete(roomId);
        console.log(`[RoomManager] Cleaned up expired/empty room: ${roomId}`);
      }
    }
  }
}

module.exports = new RoomManager();
