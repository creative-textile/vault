import { useEffect, useState } from 'react';
import Header from '../layout/Header';
import { adminApi } from '../../api/client';
import { useAuth } from '../../stores/auth';

function fmt(n: number) { return (Number(n) || 0).toFixed(2); }

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

type Tab = 'overview' | 'cashboxes' | 'settings' | 'users' | 'tx';

export default function AdminPanel() {
  const { showToast } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<any>(null);
  const [settings, setSettings] = useState<any>({});
  const [settingsLabels, setSettingsLabels] = useState<Record<string,string>>({});
  const [rangeFrom, setRangeFrom] = useState(todayISO(-6));
  const [rangeTo, setRangeTo] = useState(todayISO(0));
  const [bankrollAmt, setBankrollAmt] = useState('');
  const [poolAmt, setPoolAmt] = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');
  const [seedAmt, setSeedAmt] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [banReason, setBanReason] = useState('');
  const [txFilter, setTxFilter] = useState<any>({ type: '', from: '', to: '', userId: '' });
  const [txs, setTxs] = useState<any[]>([]);

  const loadStats = async () => {
    try {
      const s = await adminApi.stats(rangeFrom, rangeTo);
      setStats(s);
    } catch (e: any) {
      showToast('Нет доступа: ' + e.message);
    }
  };

  const loadSettings = async () => {
    try {
      const s = await adminApi.getSettings();
      setSettings(s.values);
      setSettingsLabels(s.labels);
    } catch (e: any) {
      showToast('Нет доступа: ' + e.message);
    }
  };

  const loadUsers = async () => {
    const u = await adminApi.users(userSearch, 100);
    setUsers(u);
  };

  const loadTxs = async () => {
    const t = await adminApi.transactions({ ...txFilter, page: 0 });
    setTxs(t.items);
  };

  useEffect(() => { loadStats(); /* eslint-disable-next-line */ }, [rangeFrom, rangeTo]);
  useEffect(() => { loadSettings(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadUsers(); /* eslint-disable-next-line */ }, [userSearch]);
  useEffect(() => { loadTxs(); /* eslint-disable-next-line */ }, [txFilter.type, txFilter.from, txFilter.to]);

  if (!stats) return <><Header title="🔧 Админ" /><div className="text-center mt">Загрузка / проверка доступа...</div></>;

  const rev = stats.revenue_by_source || {};
  const totalRev = Number(stats.total_revenue) || 0;

  const tabs: {id: Tab; label: string; icon: string}[] = [
    {id:'overview', label:'Обзор', icon:'📊'},
    {id:'cashboxes', label:'Кассы', icon:'💰'},
    {id:'users', label:'Пользователи', icon:'👥'},
    {id:'tx', label:'Операции', icon:'📋'},
    {id:'settings', label:'Настройки', icon:'⚙️'}
  ];

  return (
    <>
      <Header title="🔧 АДМИН-ПАНЕЛЬ" />

      <div style={{
        display:'flex', gap:6, marginBottom:12, padding:'4px 2px 8px',
        overflowX:'auto', WebkitOverflowScrolling:'touch',
        scrollbarWidth:'thin', position:'sticky', top:0,
        background:'linear-gradient(180deg, #0a0a1a 80%, transparent)',
        zIndex:10
      }}>
        {tabs.map(t => (
          <button key={t.id}
            className="btn btn-small"
            onClick={() => setTab(t.id)}
            style={{
              flex:'0 0 auto', padding:'8px 12px', fontSize:13, width:'auto',
              background: tab === t.id ? '#ffd700' : '#1a1a3a',
              color: tab === t.id ? '#000' : '#fff'
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="card">
            <div className="card-title">📅 Период: {rangeFrom} — {rangeTo}</div>
            <div style={{display:'flex', gap:8, marginTop:8}}>
              <input type="date" className="input" style={{fontSize:14, padding:'10px'}} value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} />
              <input type="date" className="input" style={{fontSize:14, padding:'10px'}} value={rangeTo} onChange={e => setRangeTo(e.target.value)} />
            </div>
            <div className="btn-row" style={{marginTop:8}}>
              <button className="btn btn-small btn-secondary" onClick={() => { setRangeFrom(todayISO(0)); setRangeTo(todayISO(0)); }}>Сегодня</button>
              <button className="btn btn-small btn-secondary" onClick={() => { setRangeFrom(todayISO(-6)); setRangeTo(todayISO(0)); }}>7 дней</button>
              <button className="btn btn-small btn-secondary" onClick={() => { setRangeFrom(todayISO(-29)); setRangeTo(todayISO(0)); }}>30 дней</button>
            </div>
          </div>

          <div className="card">
            <h3 style={{color:'#ffd700', margin:'0 0 8px'}}>📊 СТАТИСТИКА</h3>
            <div className="history-item"><span>Всего пользователей:</span><b>{stats.users_count}</b></div>
            <div className="history-item"><span>🆕 Новых за период:</span><span className="text-green">+{stats.new_users_range}</span></div>
            <div className="history-item"><span>Активных за период:</span><span>{stats.active_range}</span></div>
            <div className="history-item"><span>🎰 Оборот (ставки):</span><span>${fmt(stats.total_turnover)}</span></div>
          </div>

          <div className="card">
            <h3 style={{color:'#22c55e', margin:'0 0 8px'}}>💵 ПОПОЛНЕНИЯ / ВЫВОДЫ</h3>
            <div className="history-item"><span>📥 Пополнений:</span><span>{stats.deposits_count} на ${fmt(stats.deposits_total)}</span></div>
            <div className="history-item"><span>📤 Выводов:</span><span>{stats.withdraws_count} на ${fmt(stats.withdraws_total)}</span></div>
          </div>

          <div className="card">
            <h3 style={{color:'#ffd700', margin:'0 0 8px'}}>💸 ДОХОД ПРОЕКТА: ${fmt(totalRev)}</h3>
            <div className="history-item"><span>🚀 Ракета:</span><span className="text-green">+${fmt(rev.rocket || 0)}</span></div>
            <div className="history-item"><span>⚔️ Дуэли:</span><span className="text-green">+${fmt(rev.duel || 0)}</span></div>
            <div className="history-item"><span>🔒 Сейф (всего):</span><span className="text-green">+${fmt((rev.safe||0)+(rev.safe_remainder||0))}</span></div>
            <div className="history-item"><span>📤 Комиссия выводов:</span><span className="text-green">+${fmt(rev.withdrawal || 0)}</span></div>
            {Object.entries(rev).filter(([k]) => !['rocket','duel','safe','safe_remainder','withdrawal'].includes(k)).map(([k,v]) => (
              <div key={k} className="history-item"><span>• {k}:</span><span className="text-green">+${fmt(Number(v))}</span></div>
            ))}
          </div>

          <div className="card">
            <h3 style={{color:'#a855f7', margin:'0 0 8px'}}>💎 ПУЛ ВКЛАДА</h3>
            <div className="history-item"><span>К распределению завтра:</span><b>${fmt(stats.vault_pool_total)}</b></div>
            <div className="history-item"><span>Заблокировано во вкладах:</span><span>${fmt(stats.vault?.total_locked)}</span></div>
            <div className="history-item"><span>Активных вкладчиков:</span><span>{stats.vault?.depositors}</span></div>
            {stats.vault?.today && (
              <>
                <div className="history-item"><span>База на сегодня:</span><span>{fmt(stats.vault.today.base_rate)}%</span></div>
                <div className="history-item"><span>Пул сегодня:</span><span>${fmt(stats.vault.today.total_pool)}</span></div>
              </>
            )}
          </div>

          <div className="card">
            <h3 style={{color:'#ffd700', margin:'0 0 8px'}}>🔒 УПРАВЛЕНИЕ ВЗЛОМОМ СЕЙФА</h3>
            <div className="text-dim" style={{fontSize:12, marginBottom:10}}>
              Взлом стартует сам в настроенное время МСК (вкладка «Настройки») и длится
              «Окно взлома сейфа (минуты)» + 10 секунд запаса. Итоги подводятся автоматически
              по окончании окна. Кнопки ниже — для ручной проверки сценария.
            </div>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <button className="btn btn-small" onClick={async () => {
                try {
                  const r = await adminApi.startCracking();
                  showToast(r.message || 'Взлом запущен');
                  if (r.window_ms) showToast(`Окно взлома: ${Math.round(r.window_ms / 1000)} с`);
                } catch (e: any) { showToast(e.message); }
              }}>🔓 ЗАПУСТИТЬ ВЗЛОМ</button>
              <button className="btn btn-small btn-secondary" onClick={async () => {
                try {
                  const r = await adminApi.finalizeCracking();
                  showToast(`Итоги подведены (сейф #${r.safe_id})`);
                  loadStats();
                } catch (e: any) { showToast(e.message); }
              }}>🏁 ПОДВЕСТИ ИТОГИ</button>
            </div>
          </div>

          {stats.recent_transactions?.length > 0 && (
            <div className="card">
              <h3 style={{margin:'0 0 8px'}}>🕒 ПОСЛЕДНИЕ ОПЕРАЦИИ</h3>
              <div className="scroll-list" style={{maxHeight:280, overflowY:'auto'}}>
                {stats.recent_transactions.map((t: any) => (
                  <div key={t.id} className="history-item" style={{fontSize:12}}>
                    <div>
                      <div style={{fontWeight:700}}>{t.username}</div>
                      <div className="text-dim">{t.type} · {t.description || t.game_type || ''}</div>
                      <div className="text-dim" style={{fontSize:10}}>{new Date(t.created_at).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'})}</div>
                    </div>
                    <div className={t.amount > 0 ? 'text-green' : 'text-red'} style={{fontWeight:700}}>
                      {t.amount > 0 ? '+' : ''}${fmt(t.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'cashboxes' && (
        <>
          <div className="card card-hl">
            <div className="card-title" style={{color:'#ffd700', fontSize:22}}>🏦 ГЛАВНАЯ КАССА</div>
            <div style={{fontSize:32, fontWeight:900, color:'#ffd700', textAlign:'center', margin:'8px 0'}}>
              ${fmt(stats.platform_cashbox)}
            </div>
            <div className="text-dim text-center" style={{fontSize:12}}>Сюда поступают все комиссии. Отсюда можно выводить из проекта.</div>
            <div style={{display:'flex', gap:8, marginTop:12}}>
              <input className="input" style={{fontSize:14, flex:1}} type="number" placeholder="Сумма" value={seedAmt} onChange={e=>setSeedAmt(e.target.value)} />
              <button className="btn btn-small btn-green" onClick={async () => {
                await adminApi.seedPlatform(parseFloat(seedAmt)); setSeedAmt(''); loadStats(); showToast('Касса пополнена');
              }}>🧪 ТЕСТ +</button>
            </div>
            <div style={{display:'flex', gap:8, marginTop:8}}>
              <input className="input" style={{fontSize:14, flex:1}} type="number" placeholder="Сумма" value={withdrawAmt} onChange={e=>setWithdrawAmt(e.target.value)} />
              <input className="input" style={{fontSize:12, width:120}} placeholder="Коммент" value={withdrawNote} onChange={e=>setWithdrawNote(e.target.value)} />
              <button className="btn btn-small btn-danger" onClick={async () => {
                await adminApi.withdrawPlatform(parseFloat(withdrawAmt), withdrawNote); setWithdrawAmt(''); setWithdrawNote(''); loadStats(); showToast('Выведено');
              }}>➡️ ВЫВЕСТИ</button>
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{color:'#3b82f6'}}>🚀 КАССА РАКЕТЫ</div>
            <div style={{fontSize:28, fontWeight:900, color:'#3b82f6', textAlign:'center', margin:'8px 0'}}>
              ${fmt(stats.rocket_bankroll)}
            </div>
            <div className="text-dim text-center" style={{fontSize:12}}>Сюда идут 90% ставок, отсюда выплачиваются выигрыши. Пополняется из Главной кассы.</div>
            <div style={{display:'flex', gap:8, marginTop:12}}>
              <input className="input" style={{fontSize:14, flex:1}} type="number" placeholder="Сумма" value={bankrollAmt} onChange={e=>setBankrollAmt(e.target.value)} />
              <button className="btn btn-small btn-green" onClick={async () => {
                await adminApi.rocketBankroll(parseFloat(bankrollAmt)); setBankrollAmt(''); loadStats(); showToast('Пополнено из Главной кассы');
              }}>← ИЗ ГЛАВНОЙ</button>
              <button className="btn btn-small btn-danger" onClick={async () => {
                await adminApi.rocketBankroll(undefined, parseFloat(bankrollAmt)); setBankrollAmt(''); loadStats(); showToast('Изъято в Главную');
              }}>В ГЛАВНУЮ →</button>
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{color:'#a855f7'}}>💎 ПУЛ ВКЛАДА</div>
            <div style={{fontSize:28, fontWeight:900, color:'#a855f7', textAlign:'center', margin:'8px 0'}}>
              ${fmt(stats.vault_pool_total)}
            </div>
            <div className="text-dim text-center" style={{fontSize:12}}>15% от суточного дохода + ручные добавки. Выплачивается активным вкладам в полночь. НЕЛЬЗЯ выводить из проекта.</div>
            <div style={{display:'flex', gap:8, marginTop:12}}>
              <input className="input" style={{fontSize:14, flex:1}} type="number" placeholder="Сумма" value={poolAmt} onChange={e=>setPoolAmt(e.target.value)} />
              <button className="btn btn-small" style={{background:'#a855f7', color:'#fff'}} onClick={async () => {
                await adminApi.addPool(parseFloat(poolAmt)); setPoolAmt(''); loadStats(); showToast('Добавлено в ПУЛ');
              }}>← ИЗ ГЛАВНОЙ</button>
            </div>
          </div>

          {stats.transfers?.length > 0 && (
            <div className="card">
              <div className="card-title">📋 История переводов между кассами</div>
              <div className="scroll-list" style={{maxHeight:300, overflowY:'auto'}}>
                {stats.transfers.map((t: any) => (
                  <div key={t.id} className="history-item" style={{fontSize:12}}>
                    <span>{t.from} → {t.to}</span>
                    <span>
                      <b style={{color: t.from === 'external' || t.to === 'external' ? '#ef4444' : '#ffd700'}}>
                        {t.from === 'external' || t.from === 'seed' ? '+' : '-'}${fmt(t.amount)}
                      </b>
                      <div className="text-dim" style={{fontSize:10}}>{t.note} · {new Date(t.created_at).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'})}</div>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'settings' && (
        <div className="card">
          <div className="card-title">⚙️ НАСТРОЙКИ</div>
          {Object.entries(settings).map(([k, v]) => (
            <div key={k} className="history-item">
              <label style={{fontSize:13, flex:1}}>{settingsLabels[k] || k}</label>
              <input
                style={{
                  width: 120, background: '#1a1a3a', border: '1px solid #333',
                  borderRadius: 6, padding: '8px 10px', color: '#fff', textAlign: 'right', fontWeight:700
                }}
                value={v as string}
                onChange={e => setSettings({...settings, [k]: e.target.value})}
              />
            </div>
          ))}
          <button className="btn mt" onClick={async () => { await adminApi.setSettings(settings); showToast('Сохранено'); }}>💾 СОХРАНИТЬ</button>
        </div>
      )}

      {tab === 'users' && (
        <>
          <div className="card">
            <div className="card-title">👥 Пользователи</div>
            <input className="input" style={{fontSize:14}} placeholder="Поиск по @username, ID, TG ID" value={userSearch} onChange={e=>setUserSearch(e.target.value)} />
            <div className="scroll-list" style={{maxHeight:400, overflowY:'auto', marginTop:10}}>
              {users.map((u: any) => (
                <div key={u.id} className="history-item" style={{cursor:'pointer'}} onClick={() => adminApi.userDetail(u.id).then(setSelectedUser)}>
                  <div>
                    <div style={{fontWeight:700}}>{u.banned ? '🚫 ' : ''}{u.username} <span className="text-dim" style={{fontSize:11}}>#{u.id} · TG:{u.telegram_id}</span></div>
                    <div className="text-dim" style={{fontSize:11}}>Рак:{u.rocket_games} · Дuel:{u.duel_games} · ${fmt(u.rocket_bet_sum)} ставок · деп ${fmt(u.deposits_sum)}</div>
                  </div>
                  <div style={{fontWeight:900, color:'#ffd700'}}>${fmt(u.balance)}</div>
                </div>
              ))}
            </div>
          </div>

          {selectedUser && (
            <div className="card" style={{border:'2px solid #ffd700'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div className="card-title" style={{margin:0}}>
                  {selectedUser.user.banned ? '🚫 ' : ''}{selectedUser.user.username}
                </div>
                <button className="btn btn-small btn-secondary" onClick={() => setSelectedUser(null)}>✖</button>
              </div>
              <div className="text-dim" style={{fontSize:12, marginBottom:8}}>
                ID: {selectedUser.user.id} · TG: {selectedUser.user.telegram_id} · рег. {new Date(selectedUser.user.created_at).toLocaleDateString('ru-RU', {timeZone:'Europe/Moscow'})}
              </div>
              <div className="history-item"><span>Баланс:</span><b style={{color:'#ffd700'}}>${fmt(selectedUser.user.balance)}</b></div>
              <div className="history-item"><span>Заморожено:</span><span>${fmt(selectedUser.user.frozen_balance)}</span></div>
              <div className="history-item"><span>Автосейф:</span><span>{selectedUser.user.auto_safe_percent}%</span></div>
              <div className="history-item"><span>Рефовод:</span><span>{selectedUser.user.referred_by || '—'}</span></div>

              <div style={{display:'flex', gap:6, margin:'10px 0'}}>
                <input className="input" style={{fontSize:13, flex:1}} placeholder="+/- сумма корректировки" value={adjustDelta} onChange={e=>setAdjustDelta(e.target.value)} />
                <button className="btn btn-small" onClick={async () => {
                  await adminApi.adjustUser(selectedUser.user.id, parseFloat(adjustDelta));
                  setAdjustDelta('');
                  const fresh = await adminApi.userDetail(selectedUser.user.id);
                  setSelectedUser(fresh);
                  loadStats();
                  showToast('Баланс скорректирован');
                }}>КОРРЕКТИРОВАТЬ</button>
              </div>
              <div style={{display:'flex', gap:6}}>
                {selectedUser.user.banned ? (
                  <button className="btn btn-small btn-green" onClick={async () => {
                    await adminApi.unbanUser(selectedUser.user.id);
                    const fresh = await adminApi.userDetail(selectedUser.user.id); setSelectedUser(fresh); loadUsers(); showToast('Разбанен');
                  }}>✅ РАЗБАНИТЬ</button>
                ) : (
                  <>
                    <input className="input" style={{fontSize:13, flex:1}} placeholder="Причина бана" value={banReason} onChange={e=>setBanReason(e.target.value)} />
                    <button className="btn btn-small btn-danger" onClick={async () => {
                      await adminApi.banUser(selectedUser.user.id, banReason);
                      setBanReason('');
                      const fresh = await adminApi.userDetail(selectedUser.user.id); setSelectedUser(fresh); loadUsers(); showToast('Забанен');
                    }}>🚫 БАН</button>
                  </>
                )}
              </div>

              <div className="mt" style={{fontSize:14, fontWeight:700}}>Последние транзакции:</div>
              <div className="scroll-list" style={{maxHeight:200, overflowY:'auto'}}>
                {selectedUser.transactions.slice(0,30).map((t: any) => (
                  <div key={t.id} className="history-item" style={{fontSize:11}}>
                    <span>{t.type} {t.description ? `· ${t.description}` : ''}</span>
                    <span className={t.amount > 0 ? 'text-green' : 'text-red'} style={{fontWeight:700}}>
                      {t.amount > 0 ? '+' : ''}${fmt(t.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'tx' && (
        <div className="card">
          <div className="card-title">📋 Все операции</div>
          <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:8}}>
            <select className="input" style={{width:'auto', fontSize:13, padding:'8px'}} value={txFilter.type} onChange={e=>setTxFilter({...txFilter, type:e.target.value})}>
              <option value="">Все типы</option>
              <option value="bet">Ставки</option>
              <option value="win">Выигрыши</option>
              <option value="deposit">Пополнения</option>
              <option value="demo_deposit">Демо-пополнения</option>
              <option value="withdraw">Выводы</option>
              <option value="safe_deposit">Сейф</option>
              <option value="referral">Рефералы</option>
              <option value="vault_lock/vault_payout">Вклады</option>
              <option value="admin_adjust">Корректировки</option>
            </select>
            <input type="date" className="input" style={{width:'auto', fontSize:13, padding:'8px'}} value={txFilter.from} onChange={e=>setTxFilter({...txFilter, from:e.target.value})} />
            <input type="date" className="input" style={{width:'auto', fontSize:13, padding:'8px'}} value={txFilter.to} onChange={e=>setTxFilter({...txFilter, to:e.target.value})} />
            <button className="btn btn-small btn-secondary" onClick={() => setTxFilter({type:'', from:'', to:'', userId:''})}>Сброс</button>
          </div>
          <div className="scroll-list" style={{maxHeight:500, overflowY:'auto'}}>
            {txs.map((t: any) => (
              <div key={t.id} className="history-item" style={{fontSize:12}}>
                <div>
                  <div style={{fontWeight:700}}>#{t.id} · {t.username}</div>
                  <div className="text-dim" style={{fontSize:11}}>{t.type} · {t.description || t.game_type || ''}</div>
                  <div className="text-dim" style={{fontSize:10}}>{new Date(t.created_at).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'})}</div>
                </div>
                <div className={t.amount > 0 ? 'text-green' : 'text-red'} style={{fontWeight:900}}>
                  {t.amount > 0 ? '+' : ''}${fmt(t.amount)}
                </div>
              </div>
            ))}
            {txs.length === 0 && <div className="text-dim text-center" style={{padding:20}}>Нет операций</div>}
          </div>
        </div>
      )}
    </>
  );
}
