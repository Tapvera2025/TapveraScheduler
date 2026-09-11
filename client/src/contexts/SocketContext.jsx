import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);

  // Read token from the reactive auth store so the socket is (re)created
  // whenever the user logs in or out — localStorage reads are not reactive.
  const token = useAuthStore((state) => state.token);

  const handleNotification = useCallback((notification) => {
    console.log('📬 Notification received:', notification);

    setNotifications((prev) => [
      { id: Date.now(), ...notification, read: false },
      ...prev,
    ]);

    const toastOptions = { duration: 4000, position: 'top-right' };

    switch (notification.type) {
      case 'CLOCK_IN':
        toast.success(notification.message, toastOptions);
        break;
      case 'CLOCK_OUT':
        toast.success(notification.message, toastOptions);
        break;
      case 'SHIFT_CREATED':
        toast.info(notification.message, toastOptions);
        break;
      case 'SHIFT_UPDATED':
        toast(notification.message, toastOptions);
        break;
      case 'SHIFT_DELETED':
        toast.error(notification.message, toastOptions);
        break;
      case 'ROSTER_UPDATED':
        toast.info(notification.message, toastOptions);
        break;
      case 'BREAK_STARTED':
        toast(notification.message, { ...toastOptions, icon: '☕' });
        break;
      case 'BREAK_ENDED':
        toast.success(notification.message, toastOptions);
        break;
      default:
        toast(notification.message, toastOptions);
    }
  }, []);

  // Initialize (or tear down) the socket whenever auth token changes.
  // This handles: fresh login after mount, token expiry, and logout.
  useEffect(() => {
    if (!token) {
      setSocket(null);
      setConnected(false);
      return;
    }

    console.log('Initializing socket connection to:', SOCKET_URL);

    const socketInstance = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socketInstance.on('connect', () => {
      console.log('✓ Socket connected:', socketInstance.id);
      setConnected(true);
    });

    socketInstance.on('connected', (data) => {
      console.log('✓ Socket authenticated:', data);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('✗ Socket disconnected:', reason);
      setConnected(false);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('✗ Socket connection error:', error.message);
      setConnected(false);
    });

    socketInstance.on('notification', handleNotification);
    socketInstance.on('clock-in', handleNotification);
    socketInstance.on('clock-out', handleNotification);
    socketInstance.on('shift-created', handleNotification);
    socketInstance.on('shift-updated', handleNotification);
    socketInstance.on('shift-deleted', handleNotification);
    socketInstance.on('roster-updated', handleNotification);
    socketInstance.on('break-start', handleNotification);
    socketInstance.on('break-end', handleNotification);

    setSocket(socketInstance);

    return () => {
      console.log('Disconnecting socket');
      socketInstance.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token, handleNotification]);

  const markAsRead = useCallback((id) => {
    setNotifications((prev) =>
      prev.map((notif) => (notif.id === id ? { ...notif, read: true } : notif))
    );
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id));
  }, []);

  const value = {
    socket,
    connected,
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    markAsRead,
    clearNotifications,
    removeNotification,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

export function useSocketEvent(eventName, handler) {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;

    socket.on(eventName, handler);

    return () => {
      socket.off(eventName, handler);
    };
  }, [socket, eventName, handler]);
}
