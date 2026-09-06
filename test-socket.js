/**
 * PrivateQR Chat - End-to-End Socket & Room Integration Test Script
 */

const { io } = require('socket.io-client');

const SERVER_URL = 'http://127.0.0.1:3000';

async function runIntegrationTest() {
  console.log('🧪 Starting Socket.IO & Room Capacity Integration Test...\n');

  // 1. Client A connects & creates room
  const socketA = io(SERVER_URL);
  
  await new Promise((resolve) => socketA.on('connect', resolve));
  console.log('✓ Socket A connected:', socketA.id);

  const roomId = await new Promise((resolve) => {
    socketA.emit('create-room', (res) => resolve(res.roomId));
  });
  console.log('✓ Room created via Socket A:', roomId);

  // Join Room A
  const joinA = await new Promise((resolve) => {
    socketA.emit('join-room', { roomId, username: 'Alice' }, (res) => resolve(res));
  });
  console.log('✓ Alice joined room A:', joinA.success, 'Member count:', joinA.users.length);

  // 2. Client B connects & joins room
  const socketB = io(SERVER_URL);
  await new Promise((resolve) => socketB.on('connect', resolve));
  console.log('✓ Socket B connected:', socketB.id);

  const joinB = await new Promise((resolve) => {
    socketB.emit('join-room', { roomId, username: 'Bob' }, (res) => resolve(res));
  });
  console.log('✓ Bob joined room A:', joinB.success, 'Member count:', joinB.users.length);

  // 3. Client C attempts to join room A (should be rejected with "Room is full.")
  const socketC = io(SERVER_URL);
  await new Promise((resolve) => socketC.on('connect', resolve));
  console.log('✓ Socket C connected:', socketC.id);

  const joinC = await new Promise((resolve) => {
    socketC.emit('join-room', { roomId, username: 'Charlie' }, (res) => resolve(res));
  });
  console.log('✓ Charlie join result (expected fail):', joinC.success, 'Reason:', joinC.reason);

  if (joinC.success || joinC.reason !== 'Room is full.') {
    console.error('❌ FAIL: Room capacity limit not enforced!');
    process.exit(1);
  } else {
    console.log('✓ PASS: Room capacity limit (max 2) successfully enforced!');
  }

  // 4. Test encrypted message payload relay
  const sampleEncryptedPayload = {
    roomId,
    messageId: 'msg-test-101',
    ciphertext: 'QUVTLTI1Ni1HQ00tQ2lwaGVydGV4dC1UZXN0',
    iv: 'MTIzNDU2Nzg5MDEy',
    timestamp: Date.now()
  };

  const receivedMessagePromise = new Promise((resolve) => {
    socketB.on('encrypted-message', (data) => resolve(data));
  });

  socketA.emit('encrypted-message', sampleEncryptedPayload);

  const receivedData = await receivedMessagePromise;
  console.log('\n✓ Received encrypted message on Socket B:');
  console.log('  Sender:', receivedData.senderUsername);
  console.log('  Ciphertext (Opaque):', receivedData.ciphertext);
  console.log('  IV:', receivedData.iv);

  if (receivedData.ciphertext === sampleEncryptedPayload.ciphertext && receivedData.iv === sampleEncryptedPayload.iv) {
    console.log('✓ PASS: Ciphertext relay verified intact!\n');
  } else {
    console.error('❌ FAIL: Mismatched payload relay!');
    process.exit(1);
  }

  // Clean up sockets
  socketA.disconnect();
  socketB.disconnect();
  socketC.disconnect();

  console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runIntegrationTest().catch((err) => {
  console.error('❌ Test script error:', err);
  process.exit(1);
});
