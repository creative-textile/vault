import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNotifications, Notification } from '../../stores/notifications';
import { useAuth } from '../../stores/auth';

export default function NotificationsModal() {
  const { notifications, unreadCount, fetchNotifications, markAsRead, markAllAsRead } = useNotifications();
  const { showToast } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // На этих экранах бейдж не показываем: /rocket (игра) и /safe/crack (мини-игра взлома)
  const isExcludedRoute = useMemo(
    () => location.pathname.startsWith('/rocket') || location.pathname.startsWith('/safe/crack'),
    [location.pathname]
  );

  // Загружаем уведомления при монтировании
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Проверяем уведомления периодически
  useEffect(() => {
    const interval = setInterval(() => {
      fetchNotifications();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const handleOpen = async () => {
    setIsOpen(true);
    setIsLoading(true);
    try {
      await fetchNotifications();
    } catch (error) {
      showToast('Ошибка загрузки уведомлений');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleViewDuel = (notification: Notification) => {
    if (notification.data && notification.data.duel_id && !isNaN(notification.data.duel_id)) {
      markAsRead(notification.id);
      handleClose();
      nav(`/duel/${notification.data.duel_id}`, { 
        state: { 
          result: notification.data,
          fromNotification: true 
        } 
      });
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllAsRead();
      showToast('Все уведомления отмечены как прочитанные');
    } catch (error) {
      showToast('Ошибка при отметке уведомлений');
    }
  };

  // Группируем уведомления по типу
  const duelNotifications = notifications.filter((n: Notification) => 
    n.type === 'duel_result' && !n.is_read && n.data?.duel_id && !isNaN(n.data.duel_id)
  );
  const otherNotifications = notifications.filter((n: Notification) => n.type !== 'duel_result' && !n.is_read);

  if (!isOpen) {
    // Показываем индикатор непрочитанных уведомлений
    if (unreadCount > 0 && !isExcludedRoute) {
      return (
        <div 
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 1000,
            cursor: 'pointer'
          }}
          onClick={handleOpen}
        >
          <div style={{
            background: '#ffd700',
            color: '#000',
            borderRadius: '50%',
            width: 50,
            height: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: 18,
            boxShadow: '0 4px 12px rgba(255, 215, 0, 0.4)'
          }}>
            {unreadCount}
          </div>
          <div style={{
            position: 'absolute',
            top: -10,
            right: 55,
            background: '#1a1a3a',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 12,
            whiteSpace: 'nowrap'
          }}>
            Уведомления
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <>
      {/* Модальное окно */}
      {isOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.85)',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div style={{
            background: '#12122a',
            borderRadius: 16,
            padding: 24,
            maxWidth: 400,
            width: '100%',
            maxHeight: '80vh',
            overflowY: 'auto',
            border: '2px solid #ffd700'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16
            }}>
              <h2 style={{ color: '#ffd700', margin: 0, fontSize: 20 }}>⚔️ Уведомления</h2>
              <button 
                onClick={handleClose}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  fontSize: 24,
                  cursor: 'pointer'
                }}
              >
                ✖
              </button>
            </div>

            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <div className="text-dim">Загрузка...</div>
              </div>
            ) : (
              <>
                {duelNotifications.length === 0 && otherNotifications.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 20, color: '#888' }}>
                    Нет новых уведомлений
                  </div>
                ) : (
                  <>
                    {duelNotifications.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <h3 style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>
                          🎲 Результаты дуэлей
                        </h3>
                        {duelNotifications.map((notification: Notification) => (
                          <div 
                            key={notification.id}
                            style={{
                              background: '#1a1a3a',
                              borderRadius: 8,
                              padding: 12,
                              marginBottom: 8,
                              cursor: 'pointer',
                              transition: 'background 0.2s'
                            }}
                            onClick={() => handleViewDuel(notification)}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontWeight: 'bold', color: '#fff' }}>
                                  {notification.title}
                                </div>
                                <div style={{ color: '#ccc', fontSize: 14, marginTop: 4 }}>
                                  {notification.message}
                                </div>
                                {notification.data?.prize && (
                                  // Нейтрально и без цвета победы: это банк за
                                  // вычетом комиссии, а не выигрыш игрока —
                                  // исход он узнаёт на экране дуэли
                                  <div style={{ color: '#8888aa', fontSize: 12, marginTop: 4 }}>
                                    Приз победителю: ${notification.data.prize.toFixed(2)}
                                  </div>
                                )}
                              </div>
                              <div style={{ color: '#ffd700', fontSize: 12 }}>
                                ▶
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {otherNotifications.length > 0 && (
                      <div>
                        <h3 style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>
                          📢 Другие уведомления
                        </h3>
                        {otherNotifications.map((notification: Notification) => (
                          <div 
                            key={notification.id}
                            style={{
                              background: '#1a1a3a',
                              borderRadius: 8,
                              padding: 12,
                              marginBottom: 8
                            }}
                          >
                            <div style={{ fontWeight: 'bold', color: '#fff' }}>
                              {notification.title}
                            </div>
                            <div style={{ color: '#ccc', fontSize: 14, marginTop: 4 }}>
                              {notification.message}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{
                      display: 'flex',
                      gap: 8,
                      marginTop: 16,
                      justifyContent: 'flex-end'
                    }}>
                      <button 
                        className="btn btn-secondary"
                        onClick={handleMarkAllAsRead}
                        style={{ fontSize: 14, padding: '8px 16px' }}
                      >
                        Отметить все прочитанными
                      </button>
                      <button 
                        className="btn"
                        onClick={handleClose}
                        style={{ fontSize: 14, padding: '8px 16px' }}
                      >
                        Закрыть
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
