// Notification System - Handles real-time notifications

class NotificationManager {
    static notifications = [];
    static socket = null;

    // Initialize socket.io connection for notifications
    static async initializeSocket() {
        if (this.socket) return; // Already initialized

        const socketClient = await loadSocketIoClient();
        if (typeof socketClient !== 'function') {
            console.warn('[NOTIFICATIONS] Socket.IO client is unavailable right now.');
            return;
        }

        // Connect to Socket.io server (uses SOCKET_SERVER_URL from api-config.js)
        const socketUrl = SOCKET_SERVER_URL;

        this.socket = socketClient(socketUrl, {
            auth: {
                token: apiClient.getToken()
            }
        });

        // Listen for notifications
        this.socket.on('notification', (notification) => {
            console.log('Notification received:', notification);
            this.handleNotification(notification);
        });

        // Listen for new messages
        this.socket.on('new-message', (data) => {
            console.log('New message received:', data);
            this.handleNewMessage(data);
        });

        // Listen for ride status updates
        this.socket.on('ride-status-update', (data) => {
            console.log('Ride status updated:', data);
            this.handleRideStatusUpdate(data);
        });

        // Listen for new rider requests (driver side)
        this.socket.on('new-rider-request', (data) => {
            console.log('New rider request received:', data);
            this.handleNewRiderRequest(data);
        });

        // Listen for driver location updates (real-time)
        this.socket.on('driver-location-update', (data) => {
            console.log('[LOCATION] Driver location update received via NotificationManager socket:', data);
            // Store in global window object for map updates
            if (!window.driverLocations) {
                window.driverLocations = {};
            }
            window.driverLocations[data.tripId] = {
                lat: data.lat,
                lng: data.lng,
                timestamp: data.timestamp,
                driverId: data.driverId
            };
            console.log('[LOCATION] Stored in window.driverLocations:', window.driverLocations[data.tripId]);
        });

        // Listen for ETA updates (rider arrival times)
        this.socket.on('eta-update', (data) => {
            console.log('[ETA] NotificationManager received eta-update:', data);
            if (typeof updateRiderEtaDisplay === 'function' && data && data.tripId) {
                updateRiderEtaDisplay(data.tripId, data.pickupSeconds, data.tripSeconds);
            }
        });

        // Handle connection events
        this.socket.on('connect', () => {
            console.log('✓ Connected to notification server');
        });

        this.socket.on('disconnect', () => {
            console.log('✗ Disconnected from notification server');
        });
    }

    // Handle incoming notification
    static handleNotification(notification) {
        this.showNotification(notification);
        this.addToHistory(notification);
    }

    // Handle new message notification
    static handleNewMessage(data) {
        const notification = {
            type: 'new-message',
            tripId: data.tripId,
            senderId: data.sender?.id,
            senderName: `${data.sender?.firstName} ${data.sender?.lastName}`,
            message: `New message from ${data.sender?.firstName}`,
            timestamp: new Date()
        };
        this.showNotification(notification);
        this.addToHistory(notification);
    }

    // Handle ride status updates
    static handleRideStatusUpdate(data) {
        const notification = {
            type: 'ride-status',
            tripId: data.tripId,
            status: data.status,
            message: `Ride ${data.status}: ${data.driverName}`,
            timestamp: new Date()
        };
        this.showNotification(notification);
        this.addToHistory(notification);

        if (data.status === 'accepted') {
            if (typeof loadAcceptedRides === 'function') {
                loadAcceptedRides();
            }
            if (typeof switchTab === 'function') {
                switchTab('mytrips');
            }
        }
    }

    // Handle new rider request (driver side)
    static handleNewRiderRequest(data) {
        console.log('Handling new rider request:', data);
        // Call the driver page function to reload rider requests
        if (typeof loadActiveTrip === 'function') {
            loadActiveTrip();
        }

        const notification = {
            type: 'new-rider-request',
            tripId: data.tripId,
            riderId: data.riderId,
            riderName: data.riderName,
            fare: data.fare,
            message: `📨 ${data.riderName} joined your trip! (₹${data.fare})`,
            timestamp: new Date()
        };
        this.showNotification(notification);
        this.addToHistory(notification);
    }

    // Show notification on screen
    static showNotification(notification) {
        const container = document.getElementById('notificationContainer') || this.createNotificationContainer();

        const notificationEl = document.createElement('div');
        notificationEl.className = 'notification-toast';

        let bgColor = 'bg-blue-500';
        let icon = 'fas fa-info-circle';

        switch(notification.type) {
            case 'ride-accepted':
                bgColor = 'bg-green-500';
                icon = 'fas fa-check-circle';
                break;
            case 'ride-rejected':
                bgColor = 'bg-red-500';
                icon = 'fas fa-times-circle';
                break;
            case 'new-message':
                bgColor = 'bg-blue-500';
                icon = 'fas fa-envelope';
                break;
            case 'ride-status':
                bgColor = 'bg-purple-500';
                icon = 'fas fa-car';
                break;
            case 'new-rider-request':
                bgColor = 'bg-orange-500';
                icon = 'fas fa-user-plus';
                break;
        }

        notificationEl.innerHTML = `
            <div class="fixed top-4 right-4 ${bgColor} text-white px-6 py-4 rounded-lg shadow-lg flex items-start gap-3 z-40 max-w-sm animate-slide-in">
                <i class="fas ${icon.split(' ')[1]} text-lg mt-1"></i>
                <div class="flex-1">
                    <p class="font-bold">${notification.message || 'New notification'}</p>
                    ${notification.tripId ? `<p class="text-sm opacity-90">Trip: ${notification.tripId.substring(0, 8)}...</p>` : ''}
                </div>
                <button onclick="this.parentElement.remove()" class="text-white hover:text-gray-200">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        container.appendChild(notificationEl.firstElementChild);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            const el = container.querySelector('.notification-toast:first-child');
            if (el) el.remove();
        }, 5000);
    }

    // Create notification container
    static createNotificationContainer() {
        const container = document.createElement('div');
        container.id = 'notificationContainer';
        container.className = 'fixed top-0 right-0 z-50';
        document.body.appendChild(container);
        return container;
    }

    // Add notification to history
    static addToHistory(notification) {
        this.notifications.push({
            ...notification,
            id: Date.now(),
            read: false
        });

        // Keep only last 50 notifications
        if (this.notifications.length > 50) {
            this.notifications = this.notifications.slice(-50);
        }
    }

    // Get unread notifications
    static getUnreadNotifications() {
        return this.notifications.filter(n => !n.read);
    }

    // Mark notification as read
    static markAsRead(notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        if (notification) {
            notification.read = true;
        }
    }

    // Join user room for notifications
    static joinUserRoom(userId) {
        if (this.socket) {
            this.socket.emit('join-user-room', { userId });
        }
    }

    // Join trip room for trip-specific notifications
    static joinTripRoom(tripId) {
        if (this.socket) {
            this.socket.emit('join-trip-room', { tripId });
        }
    }

    // Leave user room
    static leaveUserRoom(userId) {
        if (this.socket) {
            this.socket.emit('leave-user-room', { userId });
        }
    }
}

window.NotificationManager = NotificationManager;

// Add CSS for notification animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    .animate-slide-in {
        animation: slideIn 0.3s ease-out;
    }

    .notification-toast {
        animation: slideIn 0.3s ease-out;
    }
`;
document.head.appendChild(style);
