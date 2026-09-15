import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNotifications, Notification } from '../../stores/notifications';
import { useAuth } from '../../stores/auth';
import { duelApi } from '../../api/client';
import { setDuelAccepting } from '../../utils/duelTransition';
import Icon from '../ui/Icon';

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

  // Периодическая страховка централизована в DuelResultModal; новые события
  // обычно приходят по Socket.io. Второй параллельный poller здесь создавал
  // лишние запросы и мог исчерпать общий rate limit.

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

  const handleRematch = async (notification:Notification,accept:boolean) => {
    const duelId=Number(notification.data?.duel_id); if(!duelId)return;
    setIsLoading(true); if(accept)setDuelAccepting(true);
    try {
      if(accept) { const result=await duelApi.accept(duelId); await markAsRead(notification.id); setIsOpen(false); nav(`/duel/${duelId}`,{state:{result:{...result,id:duelId}}}); setDuelAccepting(false); }
      else { await duelApi.decline(duelId); await markAsRead(notification.id); showToast('Реванш отклонён'); }
      await fetchNotifications();
    } catch(e:any){showToast(e.message||'Не удалось обработать реванш')}
    finally{setDuelAccepting(false);setIsLoading(false)}
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
            background: 'var(--gold)',
            color: 'var(--bg)',
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
            background: 'var(--bg-3)',
            color: 'var(--text)',
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
            background: 'var(--bg-2)',
            borderRadius: 16,
            padding: 24,
            maxWidth: 400,
            width: '100%',
            maxHeight: '80vh',
            overflowY: 'auto',
            border: '2px solid var(--gold)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16
            }}>
              <h2 className="notif-title"><Icon name="bell" size={18} strokeWidth={2} /> Уведомления</h2>
              <button 
                onClick={handleClose}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  fontSize: 24,
                  cursor: 'pointer'
                }}
              >
                <Icon name="close" size={20} strokeWidth={2.4} />
              </button>
            </div>

            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <div className="text-dim">Загрузка...</div>
              </div>
            ) : (
              <>
                {duelNotifications.length === 0 && otherNotifications.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)' }}>
                    Нет новых уведомлений
                  </div>
                ) : (
                  <>
                    {duelNotifications.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <h3 style={{ color: 'var(--text)', fontSize: 16, marginBottom: 8 }}>
                          <Icon name="dice" size={14} strokeWidth={2} /> Результаты дуэлей
                        </h3>
                        {duelNotifications.map((notification: Notification) => (
                          <div 
                            key={notification.id}
                            style={{
                              background: 'var(--bg-3)',
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
                                <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>
                                  {notification.title}
                                </div>
                                <div style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 4 }}>
                                  {notification.message}
                                </div>
                                {notification.data?.prize && (
                                  // Нейтрально и без цвета победы: это банк за
                                  // вычетом комиссии, а не выигрыш игрока —
                                  // исход он узнаёт на экране дуэли
                                  <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>
                                    Приз победителю: ${notification.data.prize.toFixed(2)}
                                  </div>
                                )}
                              </div>
                              <div style={{ color: 'var(--gold)', fontSize: 12 }}>
                                ▶
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {otherNotifications.length > 0 && (
                      <div>
                        <h3 style={{ color: 'var(--text)', fontSize: 16, marginBottom: 8 }}>
                          <Icon name="megaphone" size={14} strokeWidth={2} /> Другие уведомления
                        </h3>
                        {otherNotifications.map((notification: Notification) => (
                          <div 
                            key={notification.id}
                            style={{
                              background: 'var(--bg-3)',
                              borderRadius: 8,
                              padding: 12,
                              marginBottom: 8
                            }}
                          >
                            <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>
                              {notification.title}
                            </div>
                            <div style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 4 }}>
                              {notification.message}
                            </div>
                            {notification.type==='duel_rematch' && <div style={{display:'flex',gap:8,marginTop:10}}>
                              <button className="btn btn-small btn-green" onClick={()=>handleRematch(notification,true)}><Icon name="swords" size={13} strokeWidth={2.2} /> Принять</button>
                              <button className="btn btn-small btn-danger" onClick={()=>handleRematch(notification,false)}><Icon name="close" size={13} strokeWidth={2.4} /> Отклонить</button>
                            </div>}
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
