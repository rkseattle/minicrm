/**
 * NotificationBell component. (MINCRM-469)
 * Minimal in-app notification bell — unread badge, click-to-open dropdown
 * feed, mark-as-read on click, mark-all-as-read action. Self-contained, no
 * feature flag — generic infrastructure any feature can write notifications to.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getNotificationFeed,
  markNotificationRead,
  markAllNotificationsRead,
  NOTIFICATION_FEED_QUERY_KEY,
} from '@/api/notifications.js';

export default function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const { data } = useQuery({
    queryKey: NOTIFICATION_FEED_QUERY_KEY,
    queryFn: getNotificationFeed,
    // Poll every 60s so the unread badge stays reasonably fresh without hammering the server.
    refetchInterval: 60_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: async (result) => {
      // Cancel any in-flight 60s poll before seeding the cache — otherwise a poll
      // response that resolves after this mutation can silently overwrite the
      // just-applied read state back to unread.
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_FEED_QUERY_KEY });
      queryClient.setQueryData(NOTIFICATION_FEED_QUERY_KEY, result);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async (result) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_FEED_QUERY_KEY });
      queryClient.setQueryData(NOTIFICATION_FEED_QUERY_KEY, result);
    },
  });

  const unreadCount = data?.unread_count ?? 0;
  const notifications = data?.notifications ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="notification-bell-button"
        aria-label={t('notifications.bellLabel', { count: unreadCount })}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex items-center justify-center w-9 h-9 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -top-0.5 -end-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-medium"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          data-testid="notification-dropdown"
          className="absolute end-0 z-20 mt-2 w-80 rounded-md border border-gray-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-900">
              {t('notifications.heading')}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                data-testid="notification-mark-all-read"
                className="text-xs text-primary-600 hover:underline"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p
              className="px-4 py-6 text-sm text-gray-500 text-center"
              data-testid="notification-empty"
            >
              {t('notifications.empty')}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-gray-100">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    data-testid={`notification-item-${notification.id}`}
                    className={`w-full text-start px-4 py-3 hover:bg-gray-50 ${
                      notification.read_at ? '' : 'bg-primary-50/40'
                    }`}
                    onClick={() => {
                      if (!notification.read_at) markReadMutation.mutate(notification.id);
                      setIsOpen(false);
                      if (notification.link_path) navigate(notification.link_path);
                    }}
                  >
                    <p className="text-sm font-medium text-gray-900">{notification.title}</p>
                    {notification.body && (
                      <p className="text-xs text-gray-500 mt-0.5">{notification.body}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
