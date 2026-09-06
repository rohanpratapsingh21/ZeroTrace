/**
 * Socket.IO Event Handler
 * Manages real-time room events, payload validation, and encrypted message relaying.
 * 
 * SECURITY DIRECTIVE:
 * The server MUST NEVER attempt to read, log, or decrypt the ciphertext or IV payload.
 */

const roomManager = require('./roomManager');
const { isValidRoomId, validateEncryptedPayload, generateRoomId } = require('./cryptoUtils');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    /**
     * Event: create-room
     * Client requests creation of a private room.
     */
    socket.on('create-room', (ackCallback) => {
      const roomId = generateRoomId();
      roomManager.createRoom(roomId);
      console.log(`[Socket] Room created: ${roomId}`);

      if (typeof ackCallback === 'function') {
        ackCallback({ success: true, roomId });
      } else {
        socket.emit('room-created', { roomId });
      }
    });

    /**
     * Event: join-room
     * Client requests to join a room by ID.
     */
    socket.on('join-room', (payload, ackCallback) => {
      const { roomId, username } = payload || {};

      if (!isValidRoomId(roomId)) {
        const errorRes = { success: false, reason: 'Invalid Room ID format.' };
        if (typeof ackCallback === 'function') return ackCallback(errorRes);
        return socket.emit('room-not-found', errorRes);
      }

      // Check if room exists; if not, return error (or auto-create if valid UUID, but here rooms are created explicitly)
      let room = roomManager.getRoom(roomId);
      if (!room) {
        // If room doesn't exist, create it if it's a valid ID (allows joining via direct link)
        room = roomManager.createRoom(roomId);
      }

      const joinResult = roomManager.joinRoom(roomId, socket.id, username);

      if (!joinResult.success) {
        console.log(`[Socket] Join failed for ${socket.id} in room ${roomId}: ${joinResult.reason}`);
        if (typeof ackCallback === 'function') return ackCallback(joinResult);

        if (joinResult.reason === 'Room is full.') {
          return socket.emit('room-full', joinResult);
        } else {
          return socket.emit('room-not-found', joinResult);
        }
      }

      // Socket joins Socket.IO room channel
      socket.join(roomId);

      const roomUsers = roomManager.getRoomUsers(roomId);

      // Notify the joining user
      const successPayload = {
        success: true,
        roomId,
        user: joinResult.user,
        users: roomUsers,
        isOwner: joinResult.isOwner,
        isHoldToRevealMode: room.isHoldToRevealMode
      };

      if (typeof ackCallback === 'function') {
        ackCallback(successPayload);
      } else {
        socket.emit('joined-success', successPayload);
      }

      // Broadcast to room that a new user joined
      socket.to(roomId).emit('user-joined', {
        user: joinResult.user,
        users: roomUsers,
        isHoldToRevealMode: room.isHoldToRevealMode,
        timestamp: Date.now()
      });

      console.log(`[Socket] Socket ${socket.id} (${joinResult.user.username}) joined room ${roomId}. Room member count: ${roomUsers.length}`);
    });

    /**
     * Event: encrypted-message
     * Relay encrypted payload (ciphertext + IV) to room members.
     */
    socket.on('encrypted-message', (payload) => {
      const validation = validateEncryptedPayload(payload);
      if (!validation.valid) {
        console.warn(`[Socket] Invalid encrypted payload from ${socket.id}: ${validation.reason}`);
        return socket.emit('error-message', { message: validation.reason });
      }

      const { roomId, messageId, ciphertext, iv, timestamp } = payload;

      // Verify client is in this room
      if (!socket.rooms.has(roomId)) {
        console.warn(`[Socket] Unauthorized message attempt by ${socket.id} to room ${roomId}`);
        return socket.emit('error-message', { message: 'You are not a member of this room.' });
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        return socket.emit('error-message', { message: 'Room no longer exists.' });
      }

      const sender = room.users.get(socket.id);
      const senderName = sender ? sender.username : 'Anonymous';

      // Relay opaque ciphertext to all members in the room (including sender or to others)
      io.to(roomId).emit('encrypted-message', {
        messageId,
        roomId,
        ciphertext,
        iv,
        timestamp: timestamp || Date.now(),
        senderSocketId: socket.id,
        senderUsername: senderName
      });
    });

    /**
     * Event: typing-start
     */
    socket.on('typing-start', ({ roomId }) => {
      if (isValidRoomId(roomId) && socket.rooms.has(roomId)) {
        const room = roomManager.getRoom(roomId);
        const user = room ? room.users.get(socket.id) : null;
        socket.to(roomId).emit('user-typing', {
          socketId: socket.id,
          username: user ? user.username : 'Someone'
        });
      }
    });

    /**
     * Event: typing-stop
     */
    socket.on('typing-stop', ({ roomId }) => {
      if (isValidRoomId(roomId) && socket.rooms.has(roomId)) {
        socket.to(roomId).emit('user-stop-typing', {
          socketId: socket.id
        });
      }
    });

    /**
     * Event: toggle-privacy-mode (Room Owner Only)
     */
    socket.on('toggle-privacy-mode', ({ roomId, mode }, ackCallback) => {
      const result = roomManager.setRoomPrivacyMode(roomId, socket.id, mode);
      if (result.success) {
        io.to(roomId).emit('privacy-mode-updated', {
          isHoldToRevealMode: result.isHoldToRevealMode,
          updatedBySocketId: socket.id
        });
        if (typeof ackCallback === 'function') ackCallback({ success: true, isHoldToRevealMode: result.isHoldToRevealMode });
      } else {
        if (typeof ackCallback === 'function') ackCallback({ success: false, reason: result.reason });
      }
    });

    /**
     * Event: update-username
     */
    socket.on('update-username', ({ newUsername }, ackCallback) => {
      const result = roomManager.updateUsername(socket.id, newUsername);
      if (result.success) {
        io.to(result.roomId).emit('username-updated', {
          socketId: socket.id,
          updatedUser: result.updatedUser,
          users: roomManager.getRoomUsers(result.roomId)
        });
        if (typeof ackCallback === 'function') ackCallback({ success: true, user: result.updatedUser });
      } else {
        if (typeof ackCallback === 'function') ackCallback({ success: false, reason: result.reason });
      }
    });

    /**
     * Event: disconnect / leave-room
     */
    const handleLeave = () => {
      const leaveResult = roomManager.leaveRoom(socket.id);
      if (leaveResult) {
        const { roomId, user, remainingUsers } = leaveResult;
        console.log(`[Socket] ${user.username} left room ${roomId}. Remaining: ${remainingUsers.length}`);

        socket.to(roomId).emit('user-left', {
          user,
          users: remainingUsers,
          timestamp: Date.now()
        });

        socket.leave(roomId);
      }
    };

    socket.on('leave-room', handleLeave);
    socket.on('disconnect', handleLeave);
  });
}

module.exports = registerSocketHandlers;
