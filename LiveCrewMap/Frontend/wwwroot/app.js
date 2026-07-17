// Frontend/wwwroot/app.js

let map = null;
const markers = {};
let socket = null;

let currentUserId = null;
let currentUserName = null;
let isOverridden = false;
let currentStatus = 'Available';
let currentDestination = null;
const polylines = {};

const statusIcons = {
  'Available': '🟢',
  'Busy': '🔴',
  'On Route': '🔵'
};

export function updateStatus(status) {
  currentStatus = status;
  if (currentUserId && socket && socket.readyState === WebSocket.OPEN && markers[currentUserId]) {
    const latlng = markers[currentUserId].getLatLng();
    const payload = { type: 'update', userId: currentUserId, lat: latlng.lat, lng: latlng.lng, name: currentUserName, status: currentStatus, destination: currentDestination };
    sendLocation(payload);
    updateMarker(currentUserId, latlng.lat, latlng.lng, currentUserName, currentStatus, currentDestination);
  }
}

export function initMap() {
  if (map) return;
  // Use CartoDB Dark Matter tiles for a premium look
  map = L.map('map', { zoomControl: false }).setView([39.8283, -98.5795], 4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(map);

  // Allow user to click the map to override their location
  map.on('click', (e) => {
    if (socket && socket.readyState === WebSocket.OPEN && currentUserId) {
      isOverridden = true;
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      const payload = { type: 'update', userId: currentUserId, lat, lng, name: currentUserName, status: currentStatus, destination: currentDestination };
      sendLocation(payload);
      updateMarker(currentUserId, lat, lng, currentUserName, currentStatus, currentDestination);
    }
  });

  // Allow user to right-click to set destination
  map.on('contextmenu', (e) => {
    if (socket && socket.readyState === WebSocket.OPEN && currentUserId) {
      currentDestination = { lat: e.latlng.lat, lng: e.latlng.lng };
      const marker = markers[currentUserId];
      if (marker) {
        const lat = marker.getLatLng().lat;
        const lng = marker.getLatLng().lng;
        const payload = { type: 'update', userId: currentUserId, lat, lng, name: currentUserName, status: currentStatus, destination: currentDestination };
        sendLocation(payload);
        updateMarker(currentUserId, lat, lng, currentUserName, currentStatus, currentDestination);
      }
    }
  });
}

export function updateMarker(userId, lat, lng, name, status, destination) {
  const displayStatus = status || 'Available';
  const icon = statusIcons[displayStatus] || '🟢';
  const tooltipText = `${icon} ${name || userId}`;

  if (markers[userId]) {
    markers[userId].setLatLng([lat, lng]);
    // update tooltip text
    markers[userId].setTooltipContent(tooltipText);
  } else {
    // Permanent tooltip for name
    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindTooltip(tooltipText, { permanent: true, direction: 'top', offset: [0, -20], className: 'custom-tooltip' });
    markers[userId] = marker;
  }

  // Handle polyline for destination
  if (destination && destination.lat !== undefined && destination.lng !== undefined) {
    if (polylines[userId]) {
      polylines[userId].setLatLngs([[lat, lng], [destination.lat, destination.lng]]);
    } else {
      polylines[userId] = L.polyline([[lat, lng], [destination.lat, destination.lng]], { dashArray: '5, 5', color: '#3388ff', weight: 3 }).addTo(map);
    }
  } else {
    if (polylines[userId]) {
      map.removeLayer(polylines[userId]);
      delete polylines[userId];
    }
  }
}

export function removeMarker(userId) {
  if (markers[userId]) {
    map.removeLayer(markers[userId]);
    delete markers[userId];
  }
  if (polylines[userId]) {
    map.removeLayer(polylines[userId]);
    delete polylines[userId];
  }
}

export function startWebSocket(url, dotnetRef) {
  if (socket) return;
  socket = new WebSocket(url);
  socket.addEventListener('open', () => console.log('WebSocket opened'));
  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'sync') {
        // data.state is an array of [userId, {lat, lng, name, status, destination}]
        data.state.forEach(([uid, state]) => {
          if (uid !== currentUserId) {
            updateMarker(uid, state.lat, state.lng, state.name, state.status, state.destination);
          }
        });
      } else if (data.type === 'update') {
        if (data.userId !== currentUserId) {
          updateMarker(data.userId, data.lat, data.lng, data.name, data.status, data.destination);
        }
      } else if (data.type === 'disconnect') {
        removeMarker(data.userId);
      } else if (data.type === 'chat') {
        if (dotnetRef) {
          dotnetRef.invokeMethodAsync('ReceiveChatMessage', data.userId, data.name, data.message);
        }
      }
    } catch (e) {
      console.error('Error parsing message', e);
    }
  });
  socket.addEventListener('close', () => console.log('WebSocket closed'));
}

export function sendLocation(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

let watchId = null;

export function startTracking(userId, userName, dotnetRef) {
  currentUserId = userId;
  currentUserName = userName;
  if (!navigator.geolocation) {
    console.error('Geolocation not supported');
    if (dotnetRef) dotnetRef.invokeMethodAsync('OnGeolocationError', 'Geolocation not supported');
    return;
  }
  watchId = navigator.geolocation.watchPosition((pos) => {
    if (isOverridden) return; // Stop snapping back if they clicked the map!
    
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const payload = { type: 'update', userId, lat, lng, name: userName, status: currentStatus, destination: currentDestination };
    sendLocation(payload);
    updateMarker(userId, lat, lng, userName, currentStatus, currentDestination);
    map.setView([lat, lng], 15);
  }, (err) => {
    console.error('Geolocation error', err);
    if (dotnetRef) dotnetRef.invokeMethodAsync('OnGeolocationError', err.message);
  }, { enableHighAccuracy: true, maximumAge: 1000 });
}

export function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  if (currentUserId) {
    removeMarker(currentUserId);
    currentUserId = null;
  }
  currentUserName = null;
  isOverridden = false;
  currentStatus = 'Available';
  currentDestination = null;
}

export function sendChatMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN && currentUserId) {
    socket.send(JSON.stringify({ type: 'chat', userId: currentUserId, name: currentUserName, message }));
  }
}
