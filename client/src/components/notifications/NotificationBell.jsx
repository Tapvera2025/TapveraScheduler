import { useState, useRef, useEffect } from 'react';
import { Bell, Check, X, Trash2 } from 'lucide-react';
import { useSocket } from '../../contexts/SocketContext';
import { formatDate as orgDate } from "../../lib/format";

export default function NotificationBell() {
  const { notifications, unreadCount, markAsRead, removeNotification, clearNotifications } = useSocket();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Prevent body scroll when dropdown is open on mobile
  useEffect(() => {
    if (showDropdown) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showDropdown]);

  const handleNotificationClick = (notification) => {
    if (!notification.read) {
      markAsRead(notification.id);
    }
  };

  const getNotificationIcon = (type) => {
    const iconClass = "w-4 h-4";
    switch (type) {
      case 'CLOCK_IN':
        return <span className="text-[hsl(var(--color-success))]">📍</span>;
      case 'CLOCK_OUT':
        return <span className="text-[hsl(var(--color-info))]">🏁</span>;
      case 'SHIFT_CREATED':
        return <span className="text-[hsl(var(--color-info))]">📅</span>;
      case 'SHIFT_UPDATED':
        return <span className="text-[hsl(var(--color-warning))]">✏️</span>;
      case 'SHIFT_DELETED':
        return <span className="text-[hsl(var(--color-error))]">🗑️</span>;
      case 'ROSTER_UPDATED':
        return <span className="text-[hsl(var(--color-info))]">📋</span>;
      default:
        return <Bell className={iconClass} />;
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return orgDate(date);
  };

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        {/* Notification Bell Button */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="relative p-2 rounded-lg hover:bg-[hsl(var(--color-surface-elevated))] transition-colors touch-manipulation"
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 sm:w-6 sm:h-6 text-[hsl(var(--color-foreground-secondary))]" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 sm:top-0 sm:right-0 min-w-[20px] h-5 bg-[hsl(var(--color-error))] text-[hsl(var(--color-error-foreground))] text-xs rounded-full flex items-center justify-center font-bold px-1">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Desktop Dropdown */}
        {showDropdown && (
          <div className="hidden md:block absolute right-0 mt-2 w-96 bg-[hsl(var(--color-card))] rounded-lg shadow-2xl border border-[hsl(var(--color-border))] z-50 max-h-[600px] flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-[hsl(var(--color-border))] flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-[hsl(var(--color-foreground))]">Notifications</h3>
                <p className="text-xs text-[hsl(var(--color-foreground-secondary))]">
                  {unreadCount} unread
                </p>
              </div>
              {notifications.length > 0 && (
                <button
                  onClick={clearNotifications}
                  className="text-xs text-[hsl(var(--color-info))] hover:text-[hsl(var(--color-info))] flex items-center gap-1"
                  title="Clear all"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear all
                </button>
              )}
            </div>

            {/* Notifications List */}
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="w-12 h-12 text-[hsl(var(--color-foreground-muted))] mx-auto mb-3" />
                  <p className="text-[hsl(var(--color-foreground-secondary))] text-sm">No notifications</p>
                  <p className="text-[hsl(var(--color-foreground-muted))] text-xs mt-1">
                    You're all caught up!
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[hsl(var(--color-border))]">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-[hsl(var(--color-card))] transition-colors cursor-pointer relative group ${
                        !notification.read ? 'bg-[hsl(var(--color-info-soft))]' : ''
                      }`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      {/* Unread indicator */}
                      {!notification.read && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[hsl(var(--color-primary))] rounded-r"></div>
                      )}

                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNotification(notification.id);
                        }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-[hsl(var(--color-surface-elevated))] rounded"
                        title="Remove"
                      >
                        <X className="w-3 h-3 text-[hsl(var(--color-foreground-secondary))]" />
                      </button>

                      <div className="flex gap-3">
                        {/* Icon */}
                        <div className="flex-shrink-0 mt-1">
                          {getNotificationIcon(notification.type)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[hsl(var(--color-foreground))] mb-1">
                            {notification.title}
                          </p>
                          <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mb-2">
                            {notification.message}
                          </p>

                          {/* Additional data */}
                          {notification.data && (
                            <div className="text-xs text-[hsl(var(--color-foreground-secondary))] space-y-1">
                              {notification.data.employeeName && (
                                <div>👤 {notification.data.employeeName}</div>
                              )}
                              {notification.data.siteName && (
                                <div>📍 {notification.data.siteName}</div>
                              )}
                              {notification.data.duration && (
                                <div>⏱️ Duration: {notification.data.duration} mins</div>
                              )}
                            </div>
                          )}

                          {/* Timestamp */}
                          <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-2">
                            {formatTime(notification.timestamp)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-3 border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
                <p className="text-xs text-center text-[hsl(var(--color-foreground-secondary))]">
                  Showing {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile Bottom Sheet */}
      {showDropdown && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => setShowDropdown(false)}
          ></div>

          {/* Bottom Sheet */}
          <div className="relative w-full bg-[hsl(var(--color-card))] rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col animate-slide-up">
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-12 h-1 bg-[hsl(var(--color-surface-elevated))] rounded-full"></div>
            </div>

            {/* Header */}
            <div className="px-4 py-3 border-b border-[hsl(var(--color-border))] flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-semibold text-[hsl(var(--color-foreground))] text-lg">Notifications</h3>
                <p className="text-sm text-[hsl(var(--color-foreground-secondary))]">
                  {unreadCount} unread
                </p>
              </div>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={clearNotifications}
                    className="text-sm text-[hsl(var(--color-info))] hover:text-[hsl(var(--color-info))] flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[hsl(var(--color-info-soft))]"
                    title="Clear all"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Clear</span>
                  </button>
                )}
                <button
                  onClick={() => setShowDropdown(false)}
                  className="p-2 hover:bg-[hsl(var(--color-surface-elevated))] rounded-lg"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-[hsl(var(--color-foreground-secondary))]" />
                </button>
              </div>
            </div>

            {/* Notifications List */}
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="w-16 h-16 text-[hsl(var(--color-foreground-muted))] mx-auto mb-4" />
                  <p className="text-[hsl(var(--color-foreground-secondary))] text-base">No notifications</p>
                  <p className="text-[hsl(var(--color-foreground-muted))] text-sm mt-2">
                    You're all caught up!
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[hsl(var(--color-border))]">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 active:bg-[hsl(var(--color-surface-elevated))] transition-colors touch-manipulation relative ${
                        !notification.read ? 'bg-[hsl(var(--color-info-soft))]' : ''
                      }`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      {/* Unread indicator */}
                      {!notification.read && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-12 bg-[hsl(var(--color-primary))] rounded-r"></div>
                      )}

                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNotification(notification.id);
                        }}
                        className="absolute top-3 right-3 p-2 bg-[hsl(var(--color-surface-elevated))] hover:bg-[hsl(var(--color-surface-elevated))] rounded-full touch-manipulation"
                        aria-label="Remove notification"
                      >
                        <X className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
                      </button>

                      <div className="flex gap-3 pr-10">
                        {/* Icon */}
                        <div className="flex-shrink-0 mt-1 text-xl">
                          {getNotificationIcon(notification.type)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-medium text-[hsl(var(--color-foreground))] mb-1.5">
                            {notification.title}
                          </p>
                          <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mb-2 leading-relaxed">
                            {notification.message}
                          </p>

                          {/* Additional data */}
                          {notification.data && (
                            <div className="text-sm text-[hsl(var(--color-foreground-secondary))] space-y-1.5 mb-2">
                              {notification.data.employeeName && (
                                <div className="flex items-center gap-2">
                                  <span>👤</span>
                                  <span>{notification.data.employeeName}</span>
                                </div>
                              )}
                              {notification.data.siteName && (
                                <div className="flex items-center gap-2">
                                  <span>📍</span>
                                  <span>{notification.data.siteName}</span>
                                </div>
                              )}
                              {notification.data.duration && (
                                <div className="flex items-center gap-2">
                                  <span>⏱️</span>
                                  <span>Duration: {notification.data.duration} mins</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Timestamp */}
                          <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-2">
                            {formatTime(notification.timestamp)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Safe area for iPhone notch */}
            <div className="h-safe-bottom bg-[hsl(var(--color-card))]"></div>
          </div>
        </div>
      )}
    </>
  );
}
