
// ==================== Firebase Config ====================
const firebaseConfig = {
  apiKey: "AIzaSyBUfT7u7tthl3Nm-ePsY7XWrdLK7YNoLVQ",
  authDomain: "cooperscodeart.firebaseapp.com",
  projectId: "cooperscodeart",
  storageBucket: "cooperscodeart.firebasestorage.app",
  messagingSenderId: "632469567217",
  appId: "1:632469567217:web:14278c59ad762e67eedb50",
  measurementId: "G-NXS0EPJR61"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==================== Storage Helper ====================
function setStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('localStorage not available, data will not persist');
    return false;
  }
}

function getStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

// ==================== User Management ====================
let userName = null;
let userSessionId = null;
let presenceRef = null;
let usersRef = null;

function generateSessionId() {
  return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getUserName() {
  if (userName) return userName;
  
  const savedName = getStorage('userName');
  if (savedName) {
    userName = savedName;
    return userName;
  }
  
  userName = 'Anonymous';
  setStorage('userName', userName);
  return userName;
}

function changeUserName() {
  const newName = prompt('Enter your name:', userName || 'Anonymous');
  if (newName && newName.trim()) {
    userName = newName.trim();
    setStorage('userName', userName);
    
    if (presenceRef && currentRoomId !== 'public') {
      presenceRef.update({ name: userName });
    }
  }
}

function setupPresence(roomId) {
  if (!roomId || roomId === 'public') return;
  
  if (presenceRef) {
    presenceRef.remove();
    presenceRef = null;
  }
  
  if (usersRef) {
    usersRef.off();
    usersRef = null;
  }
  
  userSessionId = generateSessionId();
  
  presenceRef = db.ref(`rooms/${roomId}/users/${userSessionId}`);
  usersRef = db.ref(`rooms/${roomId}/users`);
  
  presenceRef.set({
    name: userName,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
  
  presenceRef.onDisconnect().remove();
  
  usersRef.on('value', snapshot => {
    updateActiveUsers(snapshot);
  });
}

function updateActiveUsers(snapshot) {
  const usersContainer = document.getElementById('activeUsersList');
  const userCount = document.getElementById('activeUserCount');
  
  if (!snapshot.exists()) {
    if (usersContainer) {
      usersContainer.innerHTML = '<p style="color: hsl(217, 10%, 70%); font-size: 13px; padding: 8px;">No users online</p>';
    }
    if (userCount) {
      userCount.textContent = '0';
    }
    return;
  }
  
  const users = snapshot.val();
  const userList = Object.entries(users).map(([id, data]) => ({
    id,
    name: data.name || 'Anonymous',
    timestamp: data.timestamp || 0
  }));
  
  userList.sort((a, b) => a.timestamp - b.timestamp);
  
  if (usersContainer) {
    usersContainer.innerHTML = '';
    
    userList.forEach(user => {
      const userItem = document.createElement('div');
      userItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        margin-bottom: 6px;
        background: hsl(217, 20%, 20%);
        border: 1px solid hsl(217, 20%, 25%);
        border-radius: 6px;
      `;
      
      const statusDot = document.createElement('div');
      statusDot.style.cssText = `
        width: 8px;
        height: 8px;
        background: hsl(142, 76%, 55%);
        border-radius: 50%;
        flex-shrink: 0;
      `;
      
      const nameText = document.createElement('div');
      nameText.textContent = user.name;
      nameText.style.cssText = `
        color: hsl(217, 10%, 92%);
        font-size: 14px;
        font-weight: 500;
      `;
      
      if (user.id === userSessionId) {
        nameText.textContent += ' (you)';
        nameText.style.color = 'hsl(220, 90%, 56%)';
      }
      
      userItem.appendChild(statusDot);
      userItem.appendChild(nameText);
      usersContainer.appendChild(userItem);
    });
  }
  
  if (userCount) {
    userCount.textContent = userList.length.toString();
  }
}

// ==================== Chat System ====================
let chatMessagesRef = null;
let chatCache = [];

// ==================== Camera System ====================
let localStream = null;
let cameraEnabled = false;
let cameraStatusRef = null;
let allCamerasRef = null;
let peerConnections = new Map();
let signalingRefs = new Map();

// WebRTC Configuration with public STUN servers
const rtcConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

async function setupCameraForRoom(roomId) {
  if (roomId === 'public') {
    const cameraContainer = document.getElementById('cameraContainer');
    if (cameraContainer) cameraContainer.style.display = 'none';
    
    cleanupCamera();
    return;
  }
  
  const cameraContainer = document.getElementById('cameraContainer');
  if (cameraContainer) cameraContainer.style.display = 'flex';
  
  cleanupCamera();
  
  cameraStatusRef = db.ref(`rooms/${roomId}/cameraStatus/${userSessionId}`);
  allCamerasRef = db.ref(`rooms/${roomId}/cameraStatus`);
  
  cameraStatusRef.set({
    name: userName,
    enabled: false,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
  
  cameraStatusRef.onDisconnect().remove();
  
  allCamerasRef.on('child_added', async snapshot => {
    const sessionId = snapshot.key;
    const data = snapshot.val();
    
    if (sessionId !== userSessionId && data.enabled && cameraEnabled) {
      await createPeerConnection(sessionId, true);
    }
    
    updateCameraDisplay();
  });
  
  allCamerasRef.on('child_changed', async snapshot => {
    const sessionId = snapshot.key;
    const data = snapshot.val();
    
    if (sessionId !== userSessionId) {
      if (data.enabled && cameraEnabled) {
        if (!peerConnections.has(sessionId)) {
          await createPeerConnection(sessionId, true);
        }
      } else {
        closePeerConnection(sessionId);
      }
    }
    
    updateCameraDisplay();
  });
  
  allCamerasRef.on('child_removed', snapshot => {
    const sessionId = snapshot.key;
    closePeerConnection(sessionId);
    updateCameraDisplay();
  });
}

function cleanupCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (cameraStatusRef) {
    cameraStatusRef.off();
    cameraStatusRef = null;
  }
  
  if (allCamerasRef) {
    allCamerasRef.off();
    allCamerasRef = null;
  }
  
  peerConnections.forEach((pc, sessionId) => {
    closePeerConnection(sessionId);
  });
  peerConnections.clear();
  
  signalingRefs.forEach((ref, sessionId) => {
    ref.off();
    db.ref(`rooms/${currentRoomId}/signaling/${userSessionId}_${sessionId}`).remove();
    db.ref(`rooms/${currentRoomId}/signaling/${sessionId}_${userSessionId}`).remove();
  });
  signalingRefs.clear();
  
  cameraEnabled = false;
  updateCameraButton();
}

async function createPeerConnection(remoteSessionId, isInitiator) {
  if (peerConnections.has(remoteSessionId)) {
    return peerConnections.get(remoteSessionId);
  }
  
  const peerConnection = new RTCPeerConnection(rtcConfiguration);
  peerConnections.set(remoteSessionId, peerConnection);
  
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }
  
  peerConnection.ontrack = (event) => {
    const remoteStream = event.streams[0];
    displayRemoteVideo(remoteSessionId, remoteStream);
  };
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      const signalingPath = `rooms/${currentRoomId}/signaling/${userSessionId}_${remoteSessionId}`;
      db.ref(signalingPath).push({
        type: 'candidate',
        candidate: event.candidate.toJSON(),
        from: userSessionId
      });
    }
  };
  
  const incomingSignalingPath = `rooms/${currentRoomId}/signaling/${remoteSessionId}_${userSessionId}`;
  const signalingRef = db.ref(incomingSignalingPath);
  signalingRefs.set(remoteSessionId, signalingRef);
  
  signalingRef.on('child_added', async snapshot => {
    const message = snapshot.val();
    
    if (message.type === 'offer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      db.ref(`rooms/${currentRoomId}/signaling/${userSessionId}_${remoteSessionId}`).push({
        type: 'answer',
        answer: peerConnection.localDescription.toJSON(),
        from: userSessionId
      });
    } else if (message.type === 'answer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
    } else if (message.type === 'candidate') {
      await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
    
    snapshot.ref.remove();
  });
  
  if (isInitiator) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    db.ref(`rooms/${currentRoomId}/signaling/${userSessionId}_${remoteSessionId}`).push({
      type: 'offer',
      offer: peerConnection.localDescription.toJSON(),
      from: userSessionId
    });
  }
  
  return peerConnection;
}

function closePeerConnection(remoteSessionId) {
  const pc = peerConnections.get(remoteSessionId);
  if (pc) {
    pc.close();
    peerConnections.delete(remoteSessionId);
  }
  
  const signalingRef = signalingRefs.get(remoteSessionId);
  if (signalingRef) {
    signalingRef.off();
    signalingRefs.delete(remoteSessionId);
  }
  
  if (currentRoomId) {
    db.ref(`rooms/${currentRoomId}/signaling/${userSessionId}_${remoteSessionId}`).remove();
    db.ref(`rooms/${currentRoomId}/signaling/${remoteSessionId}_${userSessionId}`).remove();
  }
}

function displayRemoteVideo(remoteSessionId, remoteStream) {
  const videoElement = document.getElementById(`video-${remoteSessionId}`);
  if (videoElement) {
    videoElement.srcObject = remoteStream;
  }
}

async function toggleCamera() {
  if (!currentRoomId || currentRoomId === 'public') return;
  
  cameraEnabled = !cameraEnabled;
  
  if (cameraEnabled) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 }, 
        audio: false 
      });
      
      await cameraStatusRef.update({ 
        enabled: true,
        name: userName
      });
      
      const snapshot = await allCamerasRef.once('value');
      if (snapshot.exists()) {
        const cameras = snapshot.val();
        for (const [sessionId, data] of Object.entries(cameras)) {
          if (sessionId !== userSessionId && data.enabled) {
            await createPeerConnection(sessionId, false);
          }
        }
      }
      
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Could not access camera. Please check permissions.');
      cameraEnabled = false;
    }
  } else {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    peerConnections.forEach((pc, sessionId) => {
      closePeerConnection(sessionId);
    });
    
    await cameraStatusRef.update({ 
      enabled: false,
      name: userName
    });
  }
  
  updateCameraButton();
  updateCameraDisplay();
}

function updateCameraButton() {
  const btn = document.getElementById('toggleCameraBtn');
  if (!btn) return;
  
  if (cameraEnabled) {
    btn.textContent = 'Disable Camera';
    btn.classList.add('disabled');
  } else {
    btn.textContent = 'Enable Camera';
    btn.classList.remove('disabled');
  }
}

async function updateCameraDisplay() {
  const videosContainer = document.getElementById('cameraVideos');
  if (!videosContainer) return;
  
  const snapshot = await allCamerasRef.once('value');
  
  videosContainer.innerHTML = '';
  
  if (!snapshot.exists()) {
    videosContainer.innerHTML = '<p style="color: hsl(217, 10%, 70%); font-size: 13px; padding: 8px; text-align: center;">No cameras active</p>';
    return;
  }
  
  const cameras = snapshot.val();
  
  Object.entries(cameras).forEach(([sessionId, data]) => {
    const videoItem = document.createElement('div');
    videoItem.className = 'camera-video-item';
    
    const isCurrentUser = sessionId === userSessionId;
    const displayName = isCurrentUser ? `${data.name} (You)` : data.name;
    
    if (data.enabled) {
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = isCurrentUser;
      video.id = `video-${sessionId}`;
      
      if (isCurrentUser && localStream) {
        video.srcObject = localStream;
      }
      
      videoItem.appendChild(video);
      
      const label = document.createElement('div');
      label.className = 'camera-video-label';
      label.textContent = displayName;
      videoItem.appendChild(label);
    } else {
      videoItem.classList.add('disabled');
      const nameDisplay = document.createElement('div');
      nameDisplay.className = 'user-name-display';
      nameDisplay.textContent = displayName;
      videoItem.appendChild(nameDisplay);
    }
    
    videosContainer.appendChild(videoItem);
  });
}

function toggleCameraPanel() {
  const cameraPanel = document.getElementById('cameraPanel');
  const cameraBtn = document.getElementById('cameraMenuBtn');
  
  if (!cameraPanel) return;
  
  const isVisible = cameraPanel.style.display === 'flex';
  cameraPanel.style.display = isVisible ? 'none' : 'flex';
  
  if (cameraBtn) {
    cameraBtn.style.background = isVisible ? 'hsl(217, 25%, 16%)' : 'hsl(220, 90%, 56%)';
  }
  
  if (!isVisible) {
    updateCameraDisplay();
  }
}

function setupChatForRoom(roomId) {
  if (roomId === 'public') {
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer) chatContainer.style.display = 'none';
    
    if (chatMessagesRef) {
      chatMessagesRef.off();
      chatMessagesRef = null;
    }
    chatCache = [];
    return;
  }
  
  const chatContainer = document.getElementById('chatContainer');
  if (chatContainer) chatContainer.style.display = 'flex';
  
  if (chatMessagesRef) {
    chatMessagesRef.off();
  }
  
  chatMessagesRef = db.ref(`rooms/${roomId}/chat`);
  chatCache = [];
  
  const messagesContainer = document.getElementById('chatMessages');
  if (messagesContainer) messagesContainer.innerHTML = '';
  
  chatMessagesRef.on('child_added', snapshot => {
    const msg = snapshot.val();
    displayChatMessage(msg);
    chatCache.push(msg);
  });
}

function displayChatMessage(msg) {
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  
  const isCurrentUser = msg.name === userName;
  
  messageDiv.style.cssText = `
    margin: 8px 0;
    padding: 10px 14px;
    border-radius: 12px;
    max-width: 75%;
    font-size: 14px;
    line-height: 1.4;
    word-wrap: break-word;
    ${isCurrentUser ? 'align-self: flex-end; background-color: hsl(220, 90%, 56%); color: white; border-bottom-right-radius: 4px;' : 'align-self: flex-start; background-color: hsl(217, 20%, 20%); color: hsl(217, 10%, 92%); border-bottom-left-radius: 4px;'}
  `;
  
  const nameSpan = document.createElement('div');
  nameSpan.style.cssText = `
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 4px;
    ${isCurrentUser ? 'color: hsla(220, 90%, 98%, 0.9);' : 'color: hsl(220, 90%, 56%);'}
  `;
  nameSpan.textContent = isCurrentUser ? 'You' : msg.name;
  
  const textSpan = document.createElement('div');
  textSpan.textContent = msg.text;
  
  messageDiv.appendChild(nameSpan);
  messageDiv.appendChild(textSpan);
  messagesContainer.appendChild(messageDiv);
  
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  if (!input || !currentRoomId || currentRoomId === 'public') return;
  
  const text = input.value.trim();
  if (!text) return;
  
  chatMessagesRef.push({
    name: userName,
    text: text,
    timestamp: Date.now()
  });
  
  input.value = '';
}

function toggleChatPanel() {
  const chatPanel = document.getElementById('chatPanel');
  const chatBtn = document.getElementById('chatMenuBtn');
  
  if (!chatPanel) return;
  
  const isVisible = chatPanel.style.display === 'flex';
  chatPanel.style.display = isVisible ? 'none' : 'flex';
  
  if (chatBtn) {
    chatBtn.style.background = isVisible ? 'hsl(217, 25%, 16%)' : 'hsl(220, 90%, 56%)';
  }
  
  if (!isVisible) {
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }
}

// ==================== Room History Management ====================
function saveRoomToHistory(roomId) {
  if (roomId === 'public') return;
  
  try {
    const savedHistory = getStorage('roomHistory');
    let history = savedHistory ? JSON.parse(savedHistory) : [];
    
    history = history.filter(item => item.roomId !== roomId);
    
    history.unshift({
      roomId: roomId,
      timestamp: Date.now()
    });
    
    history = history.slice(0, 10);
    
    setStorage('roomHistory', JSON.stringify(history));
  } catch (err) {
    console.error('Error saving room to history:', err);
  }
}

function removeRoomFromHistory(roomId) {
  try {
    const savedHistory = getStorage('roomHistory');
    let history = savedHistory ? JSON.parse(savedHistory) : [];
    history = history.filter(item => item.roomId !== roomId);
    setStorage('roomHistory', JSON.stringify(history));
  } catch (err) {
    console.error('Error removing room from history:', err);
  }
}

async function loadRoomHistory() {
  const historyContainer = document.getElementById('roomHistoryList');
  if (!historyContainer) return;
  
  try {
    const savedHistory = getStorage('roomHistory');
    const history = savedHistory ? JSON.parse(savedHistory) : [];
    
    if (history.length === 0) {
      historyContainer.innerHTML = '<p style="color: hsl(217, 10%, 70%); font-size: 13px; padding: 8px;">No recent rooms</p>';
      return;
    }
    
    historyContainer.innerHTML = '';
    
    for (const item of history) {
      const roomId = item.roomId;
      
      const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
      const roomData = roomSnapshot.val();
      const isDeleted = !roomData || roomData.deleted === true;
      
      const roomItem = document.createElement('div');
      roomItem.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px;
        margin-bottom: 8px;
        background: hsl(217, 20%, 20%);
        border: 1px solid hsl(217, 20%, 25%);
        border-radius: 8px;
        ${isDeleted ? 'opacity: 0.5;' : ''}
      `;
      
      const roomInfo = document.createElement('div');
      roomInfo.style.cssText = 'flex: 1;';
      
      const roomIdText = document.createElement('div');
      roomIdText.textContent = roomId;
      roomIdText.style.cssText = `
        color: ${isDeleted ? 'hsl(0, 60%, 50%)' : 'hsl(220, 90%, 56%)'};
        font-weight: 600;
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px;
        margin-bottom: 4px;
      `;
      
      const statusText = document.createElement('div');
      statusText.style.cssText = 'color: hsl(217, 10%, 70%); font-size: 12px;';
      
      if (isDeleted) {
        statusText.textContent = '🔒 Room Deleted';
      } else {
        const timeAgo = getTimeAgo(item.timestamp);
        statusText.textContent = `Last visited ${timeAgo}`;
      }
      
      roomInfo.appendChild(roomIdText);
      roomInfo.appendChild(statusText);
      
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display: flex; gap: 6px;';
      
      if (isDeleted) {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.style.cssText = `
          padding: 6px 14px;
          background: hsl(0, 84%, 48%);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        `;
        removeBtn.onclick = () => {
          removeRoomFromHistory(roomId);
          loadRoomHistory();
        };
        btnContainer.appendChild(removeBtn);
      } else {
        const joinBtn = document.createElement('button');
        joinBtn.textContent = 'Join';
        joinBtn.style.cssText = `
          padding: 6px 14px;
          background: hsl(220, 90%, 56%);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        `;
        joinBtn.onclick = () => {
          joinRoom(roomId);
          roomDropdown.classList.remove('show');
        };
        btnContainer.appendChild(joinBtn);
      }
      
      roomItem.appendChild(roomInfo);
      roomItem.appendChild(btnContainer);
      historyContainer.appendChild(roomItem);
    }
    
  } catch (err) {
    console.error('Error loading room history:', err);
    historyContainer.innerHTML = '<p style="color: hsl(0, 60%, 50%); font-size: 13px; padding: 8px;">Error loading history</p>';
  }
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

// ==================== Room Management ====================
let currentRoomId = null;
let currentPageId = 'page1';
let linesRef = null;
let textsRef = null;
let mediaRef = null;
let roomDeletedRef = null;
let roomClearedRef = null;
let isJoiningRoom = false;

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function joinRoom(roomId, password = null) {
  if (roomId !== 'public') {
    const roomRef = db.ref(`rooms/${roomId}`);
    const roomSnapshot = await roomRef.once('value');
    
    const roomData = roomSnapshot.val();
    
    if (!roomData || roomData.deleted === true) {
      alert('Room does not exist');
      joinRoom('public');
      return;
    }
    
    const hasLines = roomData && roomData.lines;
    const hasTexts = roomData && roomData.texts;
    const hasPassword = roomData && roomData.password;
    
    const roomExists = hasPassword || hasLines || hasTexts;
    
    if (!roomExists && roomData === null) {
      alert('Room does not exist');
      joinRoom('public');
      return;
    }
    
    const passwordRef = db.ref(`rooms/${roomId}/password`);
    const passwordSnapshot = await passwordRef.once('value');
    const storedPassword = passwordSnapshot.val();

    if (storedPassword) {
      if (password === null) {
        const inputPassword = prompt('This room is password protected. Enter the passkey:');
        if (!inputPassword) {
          joinRoom('public');
          return;
        }
        password = inputPassword;
      }

      if (password !== storedPassword) {
        alert('Incorrect Passkey');
        joinRoom('public');
        return;
      }
    }
  }

  if (linesRef) linesRef.off();
  if (textsRef) textsRef.off();
  if (mediaRef) mediaRef.off();
  if (roomDeletedRef) roomDeletedRef.off();
  if (roomClearedRef) roomClearedRef.off();

  currentRoomId = roomId;
  currentPageId = 'page1';
  linesRef = db.ref(`rooms/${roomId}/pages/${currentPageId}/lines`);
  textsRef = db.ref(`rooms/${roomId}/pages/${currentPageId}/texts`);
  mediaRef = db.ref(`rooms/${roomId}/pages/${currentPageId}/media`);

  isJoiningRoom = true;
  linesCache.length = 0;
  textsCache.clear();
  mediaCache.clear();
  drawAll();

  setupFirebaseListeners();
  setupRoomDeletionListener();
  setupRoomClearedListener();
  updateRoomIndicator();
  updatePageIndicator();
  
  setupPresence(roomId);
  setupChatForRoom(roomId);
  setupCameraForRoom(roomId);

  window.location.hash = roomId;
  
  saveRoomToHistory(roomId);
  
  setTimeout(() => { isJoiningRoom = false; }, 1000);
}

function setupRoomDeletionListener() {
  if (currentRoomId === 'public') return;
  
  roomDeletedRef = db.ref(`rooms/${currentRoomId}/deleted`);
  roomDeletedRef.on('value', snapshot => {
    if (snapshot.val() === true) {
      alert('Sorry, this room has been deleted by the owner.');
      joinRoom('public');
    }
  });
}

function setupRoomClearedListener() {
  roomClearedRef = db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/cleared`);
  roomClearedRef.on('value', snapshot => {
    if (!isJoiningRoom && snapshot.exists()) {
      linesCache.length = 0;
      textsCache.clear();
      mediaCache.clear();
      drawAll();
    }
  });
}

async function updatePageIndicator() {
  const indicator = document.getElementById('pageIndicator');
  if (indicator && currentRoomId) {
    try {
      const pageSnapshot = await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/name`).once('value');
      const customName = pageSnapshot.val();
      
      if (customName) {
        indicator.textContent = customName;
      } else {
        const pageNum = currentPageId.replace('page', '');
        indicator.textContent = `Page ${pageNum}`;
      }
    } catch (err) {
      const pageNum = currentPageId.replace('page', '');
      indicator.textContent = `Page ${pageNum}`;
    }
  }
}

async function switchPage(pageId) {
  if (pageId === currentPageId) return;
  
  if (linesRef) linesRef.off();
  if (textsRef) textsRef.off();
  if (mediaRef) mediaRef.off();
  if (roomClearedRef) roomClearedRef.off();
  
  currentPageId = pageId;
  linesRef = db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/lines`);
  textsRef = db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/texts`);
  mediaRef = db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/media`);
  
  isJoiningRoom = true;
  linesCache.length = 0;
  textsCache.clear();
  mediaCache.clear();
  drawAll();
  
  setupFirebaseListeners();
  setupRoomClearedListener();
  updatePageIndicator();
  
  setTimeout(() => { isJoiningRoom = false; }, 1000);
}

function updateRoomIndicator() {
  const indicator = document.getElementById('roomIndicator');
  const menuBtn = document.getElementById('roomMenuBtn');
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const deleteBtn = document.getElementById('deleteRoomBtn');
  const copyBtn = document.getElementById('copyRoomBtn');
  const pageMenuBtn = document.getElementById('pageMenuBtn');
  const activeUsersSection = document.getElementById('activeUsersSection');
  const activeUsersDivider = document.getElementById('activeUsersDivider');

  if (indicator && currentRoomId) {
    if (currentRoomId === 'public') {
      indicator.textContent = 'Public Canvas';
      menuBtn?.classList.add('public');
      if (roomCodeDisplay) {
        roomCodeDisplay.textContent = 'You are on the public canvas';
        roomCodeDisplay.style.fontFamily = 'Inter, system-ui, sans-serif';
      }
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (copyBtn) copyBtn.style.display = 'none';
      if (pageMenuBtn) pageMenuBtn.style.display = 'none';
      if (activeUsersSection) activeUsersSection.style.display = 'none';
      if (activeUsersDivider) activeUsersDivider.style.display = 'none';
    } else {
      indicator.textContent = currentRoomId;
      menuBtn?.classList.remove('public');
      if (roomCodeDisplay) {
        roomCodeDisplay.textContent = currentRoomId;
        roomCodeDisplay.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
      }
      if (deleteBtn) deleteBtn.style.display = 'block';
      if (copyBtn) copyBtn.style.display = 'block';
      if (pageMenuBtn) pageMenuBtn.style.display = 'block';
      if (activeUsersSection) activeUsersSection.style.display = 'block';
      if (activeUsersDivider) activeUsersDivider.style.display = 'block';
    }
  }
}

function setupFirebaseListeners() {
  const lineKeys = new Map();
  
  linesRef.on('child_added', snapshot => {
    const line = snapshot.val();
    const key = snapshot.key;
    const index = linesCache.length;
    linesCache.push(line);
    lineKeys.set(key, index);
    
    line.points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, line.width / 2, 0, Math.PI * 2);
      if (line.erase) { 
        ctx.globalCompositeOperation = 'destination-out'; 
        ctx.fillStyle = 'rgba(0,0,0,1)'; 
      } else { 
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.fillStyle = line.color; 
      }
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  });

  linesRef.on('value', snapshot => {
    if (!isJoiningRoom && !snapshot.exists() && linesCache.length > 0) {
      linesCache.length = 0;
      lineKeys.clear();
      drawAll();
    }
  });

  textsRef.on('child_added', snapshot => {
    const key = snapshot.key;
    const val = snapshot.val();
    textsCache.set(key, val);
    drawAll();
  });

  textsRef.on('child_changed', snapshot => {
    const key = snapshot.key;
    const val = snapshot.val();
    textsCache.set(key, val);
    drawAll();
  });

  textsRef.on('child_removed', snapshot => {
    const key = snapshot.key;
    textsCache.delete(key);
    drawAll();
  });

  textsRef.on('value', snapshot => {
    if (!isJoiningRoom && !snapshot.exists() && textsCache.size > 0) {
      textsCache.clear();
      drawAll();
    }
  });

  // Media listeners
  mediaRef.on('child_added', snapshot => {
    const key = snapshot.key;
    const val = snapshot.val();
    loadMediaElement(key, val);
  });

  mediaRef.on('child_changed', snapshot => {
    const key = snapshot.key;
    const val = snapshot.val();
    const existing = mediaCache.get(key);
    if (existing) {
      existing.x = val.x;
      existing.y = val.y;
      existing.width = val.width;
      existing.height = val.height;
      drawAll();
    }
  });

  mediaRef.on('child_removed', snapshot => {
    const key = snapshot.key;
    mediaCache.delete(key);
    drawAll();
  });

  mediaRef.on('value', snapshot => {
    if (!isJoiningRoom && !snapshot.exists() && mediaCache.size > 0) {
      mediaCache.clear();
      drawAll();
    }
  });
}

// ==================== Canvas Setup ====================
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const linesCache = [];
const textsCache = new Map();
const mediaCache = new Map();

function drawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw lines
  linesCache.forEach(line => {
    const { points, color, width, erase } = line;
    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, width/2, 0, Math.PI*2);
      if (erase) { 
        ctx.globalCompositeOperation = 'destination-out'; 
        ctx.fillStyle = 'rgba(0,0,0,1)'; 
      } else { 
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.fillStyle = color; 
      }
      ctx.fill();
    });
  });
  ctx.globalCompositeOperation = 'source-over';
  
  // Draw media (images and videos)
  mediaCache.forEach(obj => {
    if (obj.type === 'image' && obj.element && obj.element.complete) {
      const width = obj.width || 200;
      const height = obj.height || 200;
      ctx.drawImage(obj.element, obj.x, obj.y, width, height);
      
      // Draw border
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(obj.x, obj.y, width, height);
      
      // Draw resize handle
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(obj.x + width - 10, obj.y + height - 10, 10, 10);
      
    } else if (obj.type === 'video' && obj.element) {
      const width = obj.width || 320;
      const height = obj.height || 240;
      
      // Draw video frame
      if (obj.element.readyState >= 2) {
        ctx.drawImage(obj.element, obj.x, obj.y, width, height);
      } else {
        // Placeholder while loading
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(obj.x, obj.y, width, height);
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Loading video...', obj.x + width/2, obj.y + height/2);
        ctx.textAlign = 'left';
      }
      
      // Draw border
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(obj.x, obj.y, width, height);
      
      // Draw resize handle
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(obj.x + width - 10, obj.y + height - 10, 10, 10);
      
      // Play/pause indicator
      if (obj.element.paused) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.arc(obj.x + width/2, obj.y + height/2, 30, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.moveTo(obj.x + width/2 - 10, obj.y + height/2 - 15);
        ctx.lineTo(obj.x + width/2 - 10, obj.y + height/2 + 15);
        ctx.lineTo(obj.x + width/2 + 15, obj.y + height/2);
        ctx.closePath();
        ctx.fill();
      }
    }
  });
  
  // Draw text
  ctx.textBaseline = 'top';
  textsCache.forEach(obj => {
    const size = obj.size || 40;
    const color = obj.color || '#000';
    const font = obj.font || 'sans-serif';
    const content = obj.text || '';
    if (!content) return;
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(content, obj.x, obj.y);
  });
}

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  drawAll();
});

// ==================== Drawing State ====================
let brushColor = "#000000";
let brushSize = 4;
let drawing = false;
let current = { x: 0, y: 0 };
let eraserActive = false;
let eyedropperActive = false;

function drawLineSmooth(x0, y0, x1, y1, color = brushColor, width = brushSize, erase = false) {
  const points = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.sqrt(dx*dx + dy*dy);
  const steps = Math.ceil(distance / 2);

  for (let i = 0; i <= steps; i++) {
    const xi = x0 + (dx * i) / steps;
    const yi = y0 + (dy * i) / steps;
    points.push({ x: xi, y: yi });
    ctx.beginPath();
    ctx.arc(xi, yi, width / 2, 0, Math.PI * 2);
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return points;
}

// ==================== Media Management ====================
function loadMediaElement(key, data) {
  if (data.type === 'image') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      mediaCache.set(key, {
        ...data,
        element: img
      });
      drawAll();
    };
    img.onerror = () => {
      console.error('Failed to load image:', data.dataUrl?.substring(0, 50));
    };
    img.src = data.dataUrl;
    
  } else if (data.type === 'video') {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    
    video.addEventListener('loadeddata', () => {
      mediaCache.set(key, {
        ...data,
        element: video
      });
      drawAll();
      
      // Start animation loop for video
      const animate = () => {
        if (mediaCache.has(key)) {
          drawAll();
          requestAnimationFrame(animate);
        }
      };
      animate();
    });
    
    video.addEventListener('error', (e) => {
      console.error('Failed to load video:', e);
    });
    
    video.src = data.dataUrl;
    video.load();
  }
}

function mediaAtPoint(x, y) {
  let found = null;
  mediaCache.forEach((m, key) => {
    const width = m.width || (m.type === 'image' ? 200 : 320);
    const height = m.height || (m.type === 'image' ? 200 : 240);
    
    if (x >= m.x && x <= m.x + width && y >= m.y && y <= m.y + height) {
      // Check if clicking resize handle
      const resizeHandle = {
        x: m.x + width - 10,
        y: m.y + height - 10,
        width: 10,
        height: 10
      };
      
      const isResizeHandle = x >= resizeHandle.x && x <= resizeHandle.x + resizeHandle.width &&
                            y >= resizeHandle.y && y <= resizeHandle.y + resizeHandle.height;
      
      found = { key, m, isResizeHandle };
    }
  });
  return found;
}

async function uploadMedia() {
  const input = document.getElementById('mediaUpload');
  const files = input.files;
  
  if (!files || files.length === 0 || !currentRoomId) return;
  
  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      alert(`File ${file.name} is not a supported image or video format.`);
      continue;
    }
    
    // Check file size (limit to 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert(`File ${file.name} is too large. Maximum size is 10MB.`);
      continue;
    }
    
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      
      if (isImage) {
        // Get image dimensions
        const img = new Image();
        img.onload = () => {
          const maxWidth = 400;
          const maxHeight = 400;
          let width = img.width;
          let height = img.height;
          
          // Scale down if too large
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;
          }
          
          const { x, y } = findEmptySpace(width, height);
          
          mediaRef.push({
            type: 'image',
            dataUrl: dataUrl,
            x: x,
            y: y,
            width: width,
            height: height,
            timestamp: Date.now()
          });
        };
        img.src = dataUrl;
        
      } else if (isVideo) {
        const width = 320;
        const height = 240;
        const { x, y } = findEmptySpace(width, height);
        
        mediaRef.push({
          type: 'video',
          dataUrl: dataUrl,
          x: x,
          y: y,
          width: width,
          height: height,
          timestamp: Date.now()
        });
      }
    };
    
    reader.onerror = () => {
      alert(`Failed to read file ${file.name}`);
    };
    
    reader.readAsDataURL(file);
  }
  
  // Reset input
  input.value = '';
}

// ==================== Pointer Handling & Dragging ====================
function startDrawing(x, y) { drawing = true; current.x = x; current.y = y; }
function stopDrawing() { drawing = false; }

function getColorAtPoint(x, y) {
  const pixelData = ctx.getImageData(x, y, 1, 1).data;
  const r = pixelData[0];
  const g = pixelData[1];
  const b = pixelData[2];
  const a = pixelData[3];
  
  if (a === 0) {
    return '#ffffff';
  }
  
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function textAtPoint(x, y) {
  let found = null;
  textsCache.forEach((t, key) => {
    const size = t.size || 40;
    const font = t.font || 'sans-serif';
    const content = t.text || '';
    if (!content) return;
    ctx.font = `${size}px ${font}`;
    ctx.textBaseline = 'top';
    const w = ctx.measureText(content).width;
    const h = size;
    if (x >= t.x && x <= t.x + w && y >= t.y && y <= t.y + h) {
      found = { key, t };
    }
  });
  return found;
}

let draggingTextKey = null;
let draggingMediaKey = null;
let resizingMediaKey = null;
let dragOffset = { x: 0, y: 0 };
let dragRAFQueued = false;
let latestDragPos = null;
let resizeStartSize = { width: 0, height: 0 };
let resizeStartPos = { x: 0, y: 0 };

function scheduleDragUpdate() {
  if (dragRAFQueued) return;
  dragRAFQueued = true;
  requestAnimationFrame(() => {
    dragRAFQueued = false;
    
    if (draggingTextKey && latestDragPos) {
      const { x, y } = latestDragPos;
      const local = textsCache.get(draggingTextKey);
      if (local) { local.x = x; local.y = y; }
      drawAll();
      textsRef.child(draggingTextKey).update({ x, y });
    }
    
    if (draggingMediaKey && latestDragPos) {
      const { x, y } = latestDragPos;
      const local = mediaCache.get(draggingMediaKey);
      if (local) { local.x = x; local.y = y; }
      drawAll();
      mediaRef.child(draggingMediaKey).update({ x, y });
    }
    
    if (resizingMediaKey && latestDragPos) {
      const { x, y } = latestDragPos;
      const local = mediaCache.get(resizingMediaKey);
      if (local) {
        const deltaX = x - resizeStartPos.x;
        const deltaY = y - resizeStartPos.y;
        const delta = Math.max(deltaX, deltaY);
        
        const newWidth = Math.max(50, resizeStartSize.width + delta);
        const newHeight = Math.max(50, resizeStartSize.height + delta);
        
        local.width = newWidth;
        local.height = newHeight;
        drawAll();
        mediaRef.child(resizingMediaKey).update({ width: newWidth, height: newHeight });
      }
    }
  });
}

function handlePointerDown(x, y) {
  // Handle eyedropper mode
  if (eyedropperActive) {
    const pickedColor = getColorAtPoint(x, y);
    brushColor = pickedColor;
    colorPicker.value = pickedColor;
    eyedropperActive = false;
    canvas.classList.remove('eyedropper-mode');
    
    const eyedropperBtn = document.getElementById('eyedropperBtn');
    if (eyedropperBtn) {
      eyedropperBtn.style.backgroundColor = '';
    }
    return;
  }
  
  // Check for media interaction
  const mediaHit = mediaAtPoint(x, y);
  if (mediaHit) {
    if (mediaHit.isResizeHandle) {
      resizingMediaKey = mediaHit.key;
      resizeStartSize = { 
        width: mediaHit.m.width || (mediaHit.m.type === 'image' ? 200 : 320), 
        height: mediaHit.m.height || (mediaHit.m.type === 'image' ? 200 : 240) 
      };
      resizeStartPos = { x, y };
      canvas.classList.add('resize-mode');
    } else {
      // Check if clicking on video to play/pause
      if (mediaHit.m.type === 'video' && mediaHit.m.element) {
        const video = mediaHit.m.element;
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
        drawAll();
      } else {
        // Drag media
        draggingMediaKey = mediaHit.key;
        dragOffset.x = x - mediaHit.m.x;
        dragOffset.y = y - mediaHit.m.y;
      }
    }
    return;
  }
  
  // Check for text interaction
  const textHit = textAtPoint(x, y);
  if (textHit) {
    draggingTextKey = textHit.key;
    dragOffset.x = x - textHit.t.x;
    dragOffset.y = y - textHit.t.y;
    return;
  }
  
  startDrawing(x, y);
}

function drawMove(x, y) {
  if (eyedropperActive) {
    return;
  }
  
  if (draggingTextKey || draggingMediaKey || resizingMediaKey) {
    latestDragPos = resizingMediaKey ? { x, y } : { x: x - dragOffset.x, y: y - dragOffset.y };
    scheduleDragUpdate();
    return;
  }
  
  if (!drawing) return;
  
  const points = drawLineSmooth(current.x, current.y, x, y, brushColor, brushSize, eraserActive);
  
  if (eraserActive && points && points.length) {
    const removed = new Set();
    
    // Check for text deletion
    points.forEach(p => {
      const hit = textAtPoint(p.x, p.y);
      if (hit && !removed.has(hit.key)) {
        removed.add(hit.key);
        textsRef.child(hit.key).remove();
      }
    });
    
    // Check for media deletion
    points.forEach(p => {
      const hit = mediaAtPoint(p.x, p.y);
      if (hit && !removed.has(hit.key)) {
        removed.add(hit.key);
        mediaRef.child(hit.key).remove();
      }
    });
  }
  
  linesRef.push({ points, color: brushColor, width: brushSize, erase: eraserActive, timestamp: Date.now() });
  current.x = x;
  current.y = y;
}

function handlePointerUp() {
  drawing = false;
  draggingTextKey = null;
  draggingMediaKey = null;
  resizingMediaKey = null;
  latestDragPos = null;
  dragRAFQueued = false;
  canvas.classList.remove('resize-mode');
}

canvas.addEventListener('mousedown', e => handlePointerDown(e.clientX, e.clientY));
canvas.addEventListener('mouseup', () => handlePointerUp());
canvas.addEventListener('mouseout', () => handlePointerUp());
canvas.addEventListener('mousemove', e => drawMove(e.clientX, e.clientY));

canvas.addEventListener('touchstart', e => { 
  e.preventDefault(); 
  const t = e.touches[0]; 
  handlePointerDown(t.clientX, t.clientY); 
});
canvas.addEventListener('touchend', e => { 
  e.preventDefault(); 
  handlePointerUp(); 
});
canvas.addEventListener('touchmove', e => { 
  e.preventDefault(); 
  const t = e.touches[0]; 
  drawMove(t.clientX, t.clientY); 
});

// ==================== UI Controls ====================
const colorPicker = document.getElementById('colorPicker');
const eyedropperBtn = document.getElementById('eyedropperBtn');
const sizePicker = document.getElementById('sizePicker');
if (sizePicker) {
  sizePicker.max = '200';
  sizePicker.setAttribute('max', '200');
}
const eraserBtn = document.getElementById('eraserBtn');
const clearBtn = document.getElementById('clearBtn');
const freeTextInput = document.getElementById('freeTextInput');
const mediaUploadBtn = document.getElementById('mediaUploadBtn');
const mediaUploadInput = document.getElementById('mediaUpload');

let textSizePicker = document.getElementById('textSizePicker');
let textFontPicker = document.getElementById('textFontPicker');
if (!textFontPicker) {
  const toolbarEl = document.getElementById('toolbar') || document.body;
  textFontPicker = document.createElement('select');
  textFontPicker.id = 'textFontPicker';
  textFontPicker.title = 'Text font';
  textFontPicker.style.padding = '8px 12px';
  textFontPicker.style.background = 'hsl(217, 20%, 20%)';
  textFontPicker.style.border = '1px solid hsl(217, 20%, 35%)';
  textFontPicker.style.borderRadius = '8px';
  textFontPicker.style.color = 'hsl(217, 10%, 92%)';
  textFontPicker.style.fontSize = '16px';
  textFontPicker.style.cursor = 'pointer';
  textFontPicker.style.minWidth = '140px';
  
  const fonts = [
    { name: 'Sans Serif', value: 'sans-serif' },
    { name: 'Serif', value: 'serif' },
    { name: 'Monospace', value: 'monospace' },
    { name: 'Arial', value: 'Arial, sans-serif' },
    { name: 'Times New Roman', value: '"Times New Roman", serif' },
    { name: 'Courier New', value: '"Courier New", monospace' },
    { name: 'Brush Script', value: '"Brush Script MT", cursive' }
  ];
  
  fonts.forEach(font => {
    const option = document.createElement('option');
    option.value = font.value;
    option.textContent = font.name;
    option.style.fontFamily = font.value;
    option.style.fontSize = '16px';
    textFontPicker.appendChild(option);
  });
  
  if (toolbarEl && freeTextInput && freeTextInput.parentElement === toolbarEl) {
    toolbarEl.insertBefore(textFontPicker, freeTextInput);
  } else if (toolbarEl) {
    toolbarEl.appendChild(textFontPicker);
  } else {
    document.body.appendChild(textFontPicker);
  }
}

const getTextSize = () => {
  const n = parseInt(textSizePicker.value, 10);
  if (Number.isNaN(n)) return 40;
  return Math.max(10, Math.min(200, n));
};

const getTextFont = () => {
  return textFontPicker.value || 'sans-serif';
};

colorPicker.addEventListener('change', e => {
  brushColor = e.target.value;
  eraserActive = false;
  eraserBtn.style.backgroundColor = '';
  eyedropperActive = false;
  canvas.classList.remove('eyedropper-mode');
  if (eyedropperBtn) {
    eyedropperBtn.style.backgroundColor = '';
  }
});

eyedropperBtn?.addEventListener('click', () => {
  eyedropperActive = !eyedropperActive;
  
  if (eyedropperActive) {
    eraserActive = false;
    eraserBtn.style.backgroundColor = '';
    
    eyedropperBtn.style.backgroundColor = 'hsl(220, 90%, 56%)';
    canvas.classList.add('eyedropper-mode');
  } else {
    eyedropperBtn.style.backgroundColor = '';
    canvas.classList.remove('eyedropper-mode');
  }
});

const updateBrushSize = (raw) => {
  const val = parseInt(raw, 10);
  if (!Number.isNaN(val)) {
    brushSize = Math.max(1, Math.min(200, val));
  }
};
sizePicker.addEventListener('input', e => updateBrushSize(e.target.value));
sizePicker.addEventListener('change', e => updateBrushSize(e.target.value));

eraserBtn.addEventListener('click', () => {
  eraserActive = !eraserActive;
  eraserBtn.style.backgroundColor = eraserActive ? 'orange' : '';
  
  if (eraserActive && eyedropperActive) {
    eyedropperActive = false;
    canvas.classList.remove('eyedropper-mode');
    if (eyedropperBtn) {
      eyedropperBtn.style.backgroundColor = '';
    }
  }
});

mediaUploadBtn?.addEventListener('click', () => {
  mediaUploadInput.click();
});

mediaUploadInput?.addEventListener('change', () => {
  uploadMedia();
});

function findEmptySpace(itemWidth, itemHeight) {
  const padding = 20;
  const step = 50;
  const maxAttempts = 100;
  
  const toolbar = document.getElementById('toolbar');
  const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;
  const toolbarPadding = 20;
  
  function overlapsWithToolbar(x, y, w, h) {
    if (!toolbarRect) return false;
    
    return !(x > toolbarRect.right + toolbarPadding || 
             x + w < toolbarRect.left - toolbarPadding || 
             y > toolbarRect.bottom + toolbarPadding || 
             y + h < toolbarRect.top - toolbarPadding);
  }
  
  function overlapsWithText(x, y, w, h) {
    let hasOverlap = false;
    textsCache.forEach(t => {
      const tSize = t.size || 40;
      const tFont = t.font || 'sans-serif';
      const tContent = t.text || '';
      if (!tContent) return;
      
      ctx.font = `${tSize}px ${tFont}`;
      const tWidth = ctx.measureText(tContent).width;
      const tHeight = tSize;
      
      if (!(x + w + padding < t.x || 
            x > t.x + tWidth + padding || 
            y + h + padding < t.y || 
            y > t.y + tHeight + padding)) {
        hasOverlap = true;
      }
    });
    return hasOverlap;
  }
  
  function overlapsWithMedia(x, y, w, h) {
    let hasOverlap = false;
    mediaCache.forEach(m => {
      const mWidth = m.width || (m.type === 'image' ? 200 : 320);
      const mHeight = m.height || (m.type === 'image' ? 200 : 240);
      
      if (!(x + w + padding < m.x || 
            x > m.x + mWidth + padding || 
            y + h + padding < m.y || 
            y > m.y + mHeight + padding)) {
        hasOverlap = true;
      }
    });
    return hasOverlap;
  }
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const gridX = (attempt % 10) * step + 50;
    const gridY = Math.floor(attempt / 10) * step + 50;
    
    if (gridX + itemWidth + padding > canvas.width || 
        gridY + itemHeight + padding > canvas.height) {
      continue;
    }
    
    if (!overlapsWithToolbar(gridX, gridY, itemWidth, itemHeight) &&
        !overlapsWithText(gridX, gridY, itemWidth, itemHeight) &&
        !overlapsWithMedia(gridX, gridY, itemWidth, itemHeight)) {
      return { x: gridX, y: gridY };
    }
  }
  
  let randomX, randomY;
  for (let i = 0; i < 20; i++) {
    randomX = Math.random() * (canvas.width - itemWidth - 100) + 50;
    randomY = Math.random() * (canvas.height - itemHeight - 100) + 50;
    
    if (!overlapsWithToolbar(randomX, randomY, itemWidth, itemHeight)) {
      return { x: randomX, y: randomY };
    }
  }
  
  return {
    x: canvas.width - itemWidth - 100,
    y: canvas.height / 2
  };
}

function addTextToCanvas() {
  const content = (freeTextInput.value || '').trim();
  if (!content || !currentRoomId) return;
  const size = getTextSize();
  const font = getTextFont();
  
  ctx.font = `${size}px ${font}`;
  const textWidth = ctx.measureText(content).width;
  const textHeight = size;
  
  const margin = 50;
  const maxWidth = canvas.width - (margin * 2);
  const maxHeight = canvas.height - (margin * 2);
  
  if (textWidth > maxWidth || textHeight > maxHeight) {
    let maxFontSize = size;
    
    if (textWidth > maxWidth) {
      maxFontSize = Math.floor((maxWidth / textWidth) * size);
    }
    
    if (textHeight > maxHeight && maxFontSize > maxHeight) {
      maxFontSize = Math.min(maxFontSize, maxHeight);
    }
    
    alert(`Error: Text is too large to fit on the canvas!\n\nCurrent font size: ${size}px\nMaximum font size that would fit: ${maxFontSize}px\n\nPlease reduce the text size and try again.`);
    return;
  }
  
  const { x, y } = findEmptySpace(textWidth, textHeight);
  
  if (x + textWidth > canvas.width || y + textHeight > canvas.height) {
    alert(`Error: Cannot find space on canvas for text of this size.\n\nCurrent font size: ${size}px\nTry reducing the text size or clearing some existing text.`);
    return;
  }
  
  textsRef.push({ x, y, text: content, size, color: brushColor, font, timestamp: Date.now() });
  freeTextInput.value = '';
}

freeTextInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTextToCanvas();
  }
});

// ==================== Room UI ====================
const roomDropdown = document.getElementById('roomDropdown');
const roomMenuBtn = document.getElementById('roomMenuBtn');

roomMenuBtn?.addEventListener('click', () => {
  roomDropdown.classList.toggle('show');
  if (roomDropdown.classList.contains('show')) {
    loadRoomHistory();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.room-menu-container')) {
    roomDropdown?.classList.remove('show');
  }
});

document.getElementById('createRoomBtn')?.addEventListener('click', async () => {
  const roomId = generateRoomCode();
  const password = prompt('Set a passkey for this room (optional - leave blank for no password):');

  if (password && password.trim()) {
    await db.ref(`rooms/${roomId}/password`).set(password.trim());
  } else {
    await db.ref(`rooms/${roomId}/created`).set(true);
  }

  joinRoom(roomId);
  roomDropdown.classList.remove('show');
});

document.getElementById('joinRoomBtn')?.addEventListener('click', () => {
  const roomId = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (roomId) {
    joinRoom(roomId);
    roomDropdown.classList.remove('show');
  }
});

document.getElementById('goPublicBtn')?.addEventListener('click', () => {
  joinRoom('public');
  roomDropdown.classList.remove('show');
});

document.getElementById('copyRoomBtn')?.addEventListener('click', () => {
  if (currentRoomId && currentRoomId !== 'public') {
    navigator.clipboard.writeText(currentRoomId);
    const btn = document.getElementById('copyRoomBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = originalText, 1500);
  }
});

document.getElementById('deleteRoomBtn')?.addEventListener('click', async () => {
  if (currentRoomId && currentRoomId !== 'public') {
    const confirmDelete = confirm(`Are you sure you want to delete room ${currentRoomId}? This will kick all users from the room.`);
    if (confirmDelete) {
      if (roomDeletedRef) roomDeletedRef.off();
      
      await db.ref(`rooms/${currentRoomId}/deleted`).set(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      await db.ref(`rooms/${currentRoomId}`).remove();
      
      joinRoom('public');
      roomDropdown.classList.remove('show');
    }
  }
});

// ==================== Page Management ====================
const pageDropdown = document.getElementById('pageDropdown');
const pageMenuBtn = document.getElementById('pageMenuBtn');

pageMenuBtn?.addEventListener('click', () => {
  if (currentRoomId === 'public') {
    return;
  }
  pageDropdown.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.page-menu-container')) {
    pageDropdown?.classList.remove('show');
  }
});

async function loadPagesList() {
  const pageListEl = document.getElementById('pagesList');
  if (!pageListEl || !currentRoomId) return;
  
  try {
    const pagesSnapshot = await db.ref(`rooms/${currentRoomId}/pages`).once('value');
    const pages = pagesSnapshot.val();
    
    pageListEl.innerHTML = '';
    
    if (!pages) {
      const pageBtn = createPageButton('page1', 1, 'Page 1', true);
      pageListEl.appendChild(pageBtn);
      return;
    }
    
    const pageIds = Object.keys(pages).sort((a, b) => {
      const numA = parseInt(a.replace('page', ''));
      const numB = parseInt(b.replace('page', ''));
      return numA - numB;
    });
    
    pageIds.forEach(pageId => {
      const pageNum = parseInt(pageId.replace('page', ''));
      const isActive = pageId === currentPageId;
      const pageName = pages[pageId].name || `Page ${pageNum}`;
      const pageBtn = createPageButton(pageId, pageNum, pageName, isActive);
      pageListEl.appendChild(pageBtn);
    });
    
  } catch (err) {
    console.error('Error loading pages:', err);
  }
}

function createPageButton(pageId, pageNum, pageName, isActive) {
  const container = document.createElement('div');
  container.style.cssText = `
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
    position: relative;
  `;
  
  const buttonGroup = document.createElement('div');
  buttonGroup.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
  `;
  
  const renameBtn = document.createElement('button');
  renameBtn.textContent = '✏️';
  renameBtn.title = 'Rename page';
  renameBtn.style.cssText = `
    padding: 4px;
    background: hsl(220, 90%, 56%);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  renameBtn.onclick = async (e) => {
    e.stopPropagation();
    const newName = prompt(`Enter new name for this page:`, pageName);
    if (newName && newName.trim()) {
      try {
        await db.ref(`rooms/${currentRoomId}/pages/${pageId}/name`).set(newName.trim());
        loadPagesList();
        if (pageId === currentPageId) {
          updatePageIndicator();
        }
      } catch (err) {
        console.error('Error renaming page:', err);
        alert('Failed to rename page. Please try again.');
      }
    }
  };
  
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Delete page';
  deleteBtn.style.cssText = `
    padding: 4px;
    background: hsl(0, 84%, 48%);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  deleteBtn.onclick = async (e) => {
    e.stopPropagation();
    
    try {
      const pagesSnapshot = await db.ref(`rooms/${currentRoomId}/pages`).once('value');
      const pages = pagesSnapshot.val();
      const pageCount = pages ? Object.keys(pages).length : 0;
      
      if (pageCount <= 1) {
        alert('Sorry, you must have at least one page.');
        return;
      }
    } catch (err) {
      console.error('Error checking page count:', err);
    }
    
    if (confirm(`Are you sure you want to delete "${pageName}"? This will remove all content on this page.`)) {
      try {
        if (pageId === currentPageId) {
          await switchPage('page1');
        }
        
        await db.ref(`rooms/${currentRoomId}/pages/${pageId}`).remove();
        loadPagesList();
      } catch (err) {
        console.error('Error deleting page:', err);
        alert('Failed to delete page. Please try again.');
      }
    }
  };
  
  buttonGroup.appendChild(renameBtn);
  buttonGroup.appendChild(deleteBtn);
  
  const btn = document.createElement('button');
  btn.textContent = pageName;
  btn.className = isActive ? 'page-btn active' : 'page-btn';
  btn.style.flex = '1';
  btn.onclick = () => {
    switchPage(pageId);
    pageDropdown.classList.remove('show');
    loadPagesList();
  };
  
  container.appendChild(buttonGroup);
  container.appendChild(btn);
  
  return container;
}

document.getElementById('createPageBtn')?.addEventListener('click', async () => {
  try {
    const pagesSnapshot = await db.ref(`rooms/${currentRoomId}/pages`).once('value');
    const pages = pagesSnapshot.val();
    
    let maxPageNum = 1;
    if (pages) {
      Object.keys(pages).forEach(pageId => {
        const num = parseInt(pageId.replace('page', ''));
        if (num > maxPageNum) maxPageNum = num;
      });
    }
    
    const newPageNum = maxPageNum + 1;
    const newPageId = `page${newPageNum}`;
    
    await db.ref(`rooms/${currentRoomId}/pages/${newPageId}/created`).set(true);
    
    switchPage(newPageId);
    pageDropdown.classList.remove('show');
    loadPagesList();
    
  } catch (err) {
    console.error('Error creating page:', err);
    alert('Failed to create new page. Please try again.');
  }
});

pageMenuBtn?.addEventListener('click', () => {
  if (currentRoomId !== 'public' && pageDropdown.classList.contains('show')) {
    loadPagesList();
  }
});

// ==================== Admin ====================
(function setupAdmin() {
  const adminKey = "cooper";
  const isAdmin = prompt("Enter admin key to see admin tools (or cancel):") === adminKey;
  if (isAdmin) {
    clearBtn.style.display = 'inline-block';
    clearBtn.addEventListener('click', async () => {
      if (!currentRoomId) return;
      if (!confirm('Clear entire canvas? This will remove all drawings, text, and media for everyone.')) return;
      try {
        await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/cleared`).set(Date.now());
        
        await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/lines`).remove();
        await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/texts`).remove();
        await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/media`).remove();
        
        linesCache.length = 0;
        textsCache.clear();
        mediaCache.clear();
        drawAll();
      } catch (err) {
        console.error('Failed to clear canvas data:', err);
        alert('Failed to clear canvas. Please try again.');
      }
    });
    
    const adminRoomBtn = document.createElement('button');
    adminRoomBtn.textContent = 'Manage Rooms';
    adminRoomBtn.className = 'secondary';
    adminRoomBtn.style.display = 'inline-block';
    document.getElementById('toolbar').appendChild(adminRoomBtn);
    
    const adminPanel = document.createElement('div');
    adminPanel.id = 'adminPanel';
    adminPanel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: hsl(217, 25%, 16%);
      border: 1px solid hsl(217, 22%, 20%);
      border-radius: 12px;
      padding: 20px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0px 30px 60px -12px hsl(0 0% 0% / 0.60);
      z-index: 2000;
      display: none;
    `;
    
    const panelTitle = document.createElement('h2');
    panelTitle.textContent = 'Admin: Room Management';
    panelTitle.style.cssText = 'margin-bottom: 16px; color: hsl(217, 10%, 92%); font-size: 18px;';
    adminPanel.appendChild(panelTitle);
    
    const roomList = document.createElement('div');
    roomList.id = 'adminRoomList';
    adminPanel.appendChild(roomList);
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      margin-top: 16px;
      padding: 8px 16px;
      background: hsl(217, 20%, 24%);
      color: hsl(217, 10%, 88%);
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      width: 100%;
    `;
    closeBtn.onclick = () => { adminPanel.style.display = 'none'; };
    adminPanel.appendChild(closeBtn);
    
    document.body.appendChild(adminPanel);
    
    adminRoomBtn.addEventListener('click', async () => {
      adminPanel.style.display = 'block';
      roomList.innerHTML = '<p style="color: hsl(217, 10%, 80%);">Loading rooms...</p>';
      
      try {
        const roomsSnapshot = await db.ref('rooms').once('value');
        const rooms = roomsSnapshot.val();
        
        if (!rooms) {
          roomList.innerHTML = '<p style="color: hsl(217, 10%, 80%);">No private rooms found.</p>';
          return;
        }
        
        roomList.innerHTML = '';
        
        Object.keys(rooms).forEach(roomId => {
          if (roomId === 'public') return;
          
          const roomData = rooms[roomId];
          const password = roomData.password || 'None';
          
          let lastActivity = 'Unknown';
          let lastTimestamp = 0;
          
          if (roomData.pages) {
            Object.values(roomData.pages).forEach(page => {
              if (page.lines) {
                Object.values(page.lines).forEach(line => {
                  if (line.timestamp && line.timestamp > lastTimestamp) {
                    lastTimestamp = line.timestamp;
                  }
                });
              }
              if (page.texts) {
                Object.values(page.texts).forEach(text => {
                  if (text.timestamp && text.timestamp > lastTimestamp) {
                    lastTimestamp = text.timestamp;
                  }
                });
              }
              if (page.media) {
                Object.values(page.media).forEach(media => {
                  if (media.timestamp && media.timestamp > lastTimestamp) {
                    lastTimestamp = media.timestamp;
                  }
                });
              }
            });
          }
          
          if (roomData.lines) {
            Object.values(roomData.lines).forEach(line => {
              if (line.timestamp && line.timestamp > lastTimestamp) {
                lastTimestamp = line.timestamp;
              }
            });
          }
          if (roomData.texts) {
            Object.values(roomData.texts).forEach(text => {
              if (text.timestamp && text.timestamp > lastTimestamp) {
                lastTimestamp = text.timestamp;
              }
            });
          }
          
          if (lastTimestamp > 0) {
            const date = new Date(lastTimestamp);
            lastActivity = date.toLocaleString();
          }
          
          let activeUserCount = 0;
          if (roomData.users) {
            activeUserCount = Object.keys(roomData.users).length;
          }
          
          const roomCard = document.createElement('div');
          roomCard.style.cssText = `
            background: hsl(217, 20%, 20%);
            border: 1px solid hsl(217, 20%, 25%);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 12px;
          `;
          
          roomCard.innerHTML = `
            <div style="color: hsl(220, 90%, 56%); font-weight: 600; font-family: 'JetBrains Mono', monospace; margin-bottom: 8px;">
              ${roomId}
            </div>
            <div style="color: hsl(217, 10%, 80%); font-size: 13px; margin-bottom: 8px;">
              <div>Password: ${password}</div>
              <div>Active Users: ${activeUserCount}</div>
              <div>Last Activity: ${lastActivity}</div>
            </div>
          `;
          
          const btnContainer = document.createElement('div');
          btnContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';
          
          const previewBtn = document.createElement('button');
          previewBtn.textContent = 'Preview';
          previewBtn.style.cssText = `
            padding: 6px 12px;
            background: hsl(220, 90%, 56%);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            flex: 1;
          `;
          previewBtn.onclick = () => {
            window.open(`#${roomId}`, '_blank');
          };
          
          const deleteBtn = document.createElement('button');
          deleteBtn.textContent = 'Delete';
          deleteBtn.style.cssText = `
            padding: 6px 12px;
            background: hsl(0, 84%, 48%);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            flex: 1;
          `;
          deleteBtn.onclick = async () => {
            if (confirm(`Delete room ${roomId}? This will kick all users.`)) {
              await db.ref(`rooms/${roomId}/deleted`).set(true);
              await new Promise(resolve => setTimeout(resolve, 500));
              await db.ref(`rooms/${roomId}`).remove();
              adminRoomBtn.click();
            }
          };
          
          btnContainer.appendChild(previewBtn);
          btnContainer.appendChild(deleteBtn);
          roomCard.appendChild(btnContainer);
          roomList.appendChild(roomCard);
        });
        
      } catch (err) {
        console.error('Error loading rooms:', err);
        roomList.innerHTML = '<p style="color: hsl(0, 84%, 48%);">Error loading rooms.</p>';
      }
    });
  }
})();

// ==================== Initialize ====================
window.addEventListener('load', () => {
  const isMobilePhone = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) && !(/iPad|Android(?!.*Mobile)/i.test(navigator.userAgent));
  
  if (isMobilePhone) {
    alert('Sorry, this website is not compatible with mobile phones. Please use a tablet, laptop, or desktop computer.');
    window.location.href = 'about:blank';
    return;
  }
  
  getUserName();
  
  // Chat event listeners
  const chatMenuBtn = document.getElementById('chatMenuBtn');
  const closeChatBtn = document.getElementById('closeChatBtn');
  const sendChatBtn = document.getElementById('sendChatBtn');
  const chatInput = document.getElementById('chatInput');

  if (chatMenuBtn) {
    chatMenuBtn.addEventListener('click', toggleChatPanel);
  }

  if (closeChatBtn) {
    closeChatBtn.addEventListener('click', toggleChatPanel);
  }

  if (sendChatBtn) {
    sendChatBtn.addEventListener('click', sendChatMessage);
  }

  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }
  
  // Camera event listeners
  const cameraMenuBtn = document.getElementById('cameraMenuBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');
  const toggleCameraBtn = document.getElementById('toggleCameraBtn');

  if (cameraMenuBtn) {
    cameraMenuBtn.addEventListener('click', toggleCameraPanel);
  }

  if (closeCameraBtn) {
    closeCameraBtn.addEventListener('click', toggleCameraPanel);
  }

  if (toggleCameraBtn) {
    toggleCameraBtn.addEventListener('click', toggleCamera);
  }
  
  const hashRoom = window.location.hash.substring(1);
  if (hashRoom) {
    joinRoom(hashRoom);
  } else {
    joinRoom('public');
  }
});
