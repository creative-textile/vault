import { useCallback, useEffect, useState } from 'react';
import Header from '../layout/Header';
import Icon, { type IconName } from '../ui/Icon';
import { dialog } from '../ui/Dialog';
import { adminApi } from '../../api/client';
import { useAuth } from '../../stores/auth';

function fmt(n: number) { return (Number(n) || 0).toFixed(2); }

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

type Tab = 'overview' | 'cashboxes' | 'settings' | 'users' | 'tx' | 'payouts' | 'antifraud';

export default function AdminPanel() {
  const { showToast } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<any>(null);
  const [settings, setSettings] = useState<any>({});
  const [settingsLabels, setSettingsLabels] = useState<Record<string,string>>({});
  // Группы настроек приходят с сервера — в админке поля разложены по разделам
  const [settingsGroups, setSettingsGroups] = useState<{title:string, keys:string[]}[]>([]);
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
  const [fraud, setFraud] = useState<any[]>([]);
  // Заявки на вывод: в реальном режиме сервер не отправляет TON сам — он
  // списывает деньги и создаёт заявку pending, а оператор вносит tx_hash.
  const [payouts, setPayouts] = useState<any[]>([]);
  const [payoutFilter, setPayoutFilter] = useState<'pending' | 'paid' | 'rejected' | ''>('pending');
  const [reconciliation, setReconciliation] = useState<any>(null);

  const loadStats = async () => {
    try {
      const s = await adminApi.stats(rangeFrom, rangeTo);
      setStats(s);
      adminApi.reconciliation().then(setReconciliation).catch(()=>{});
    } catch (e: any) {
      showToast('Нет доступа: ' + e.message);
    }
  };

  const loadSettings = async () => {
    try {
      const s = await adminApi.getSettings();
      setSettings(s.values);
      setSettingsLabels(s.labels);
      setSettingsGroups(Array.isArray(s.groups) ? s.groups : []);
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
  useEffect(() => { adminApi.antifraud().then(setFraud).catch(()=>{}); }, []);

  const loadPayouts = useCallback(async () => {
    try { setPayouts(await adminApi.withdrawals(payoutFilter || undefined)); }
    catch (e: any) { showToast(e.message); }
  }, [payoutFilter, showToast]);
  useEffect(() => { loadPayouts(); }, [loadPayouts]);
  useEffect(() => { loadTxs(); /* eslint-disable-next-line */ }, [txFilter.type, txFilter.from, txFilter.to]);

  if (!stats) return <><Header title="Админ" icon="wrench" /><div className="text-center mt">Загрузка / проверка доступа...</div></>;

  const rev = stats.revenue_by_source || {};
  const totalRev = Number(stats.total_revenue) || 0;

  const tabs: {id: Tab; label: string; icon: IconName}[] = [
    {id:'overview', label:'Обзор', icon:'chart'},
    {id:'cashboxes', label:'Кассы', icon:'coins'},
    {id:'users', label:'Пользователи', icon:'users'},
    {id:'tx', label:'Операции', icon:'list'},
    {id:'payouts', label:'Выплаты', icon:'withdraw'},
    {id:'antifraud', label:'Антифрод', icon:'shield'},
    {id:'settings', label:'Настройки', icon:'sliders'}
  ];

  return (
    <>
      <Header title="АДМИН-ПАНЕЛЬ" icon="wrench" />

      {/* Лента разделов. Активный раздел — золотая клавиша с тёмным текстом,
          неактивные — стеклянные: раньше цвет задавался инлайном, и эмодзи-иконки
          рисовались системным шрифтом вразнобой с текстом. */}
      <div className="admin-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            className={`admin-tab${tab === t.id ? ' admin-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={15} strokeWidth={2} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {reconciliation && <div className="card" style={{border:`1px solid ${reconciliation.ok?'var(--green)':'var(--red)'}`}}>
            <div className="card-title"><Icon name={reconciliation.ok?'check':'alert'} size={16} /> Финансовая сверка</div>
            <div className="text-dim">{reconciliation.ok?'Все инварианты соблюдены':'Обнаружены расхождения'}</div>
            <div style={{fontSize:12,marginTop:6}}>Пользователи ${fmt(reconciliation.user_accounts?.balance)} · Сейф ${fmt(reconciliation.obligations?.safe)} · Vault ${fmt(reconciliation.obligations?.vault_principal)}</div>
            <div style={{fontSize:12,marginTop:6}}>Нарушения: баланс {reconciliation.violations?.negative_or_over_reserved||0} · резервы дуэлей {reconciliation.violations?.duel_reserve_mismatch||0} · журнал {reconciliation.violations?.transaction_tail_mismatch||0}</div>
            <div className="text-dim" style={{fontSize:11,marginTop:6}}>Проверено {new Date(reconciliation.checked_at).toLocaleString('ru-RU')}</div>
            <button className="btn btn-small btn-secondary mt" onClick={()=>adminApi.reconciliation().then(setReconciliation).catch((e:any)=>showToast(e.message))}><Icon name="refresh" size={13} strokeWidth={2.2} /> Проверить снова</button>
          </div>}
          <div className="card">
            <div className="card-title"><Icon name="calendar" size={16} /> Период: {rangeFrom} — {rangeTo}</div>
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
            <h3 className="admin-h admin-h--gold"><Icon name="chart" size={15} /> Статистика</h3>
            <div className="history-item"><span>Всего пользователей:</span><b>{stats.users_count}</b></div>
            <div className="history-item"><span className="row-label"><Icon name="sparkles" size={14} /> Новых за период:</span><span className="text-green">+{stats.new_users_range}</span></div>
            <div className="history-item"><span>Активных за период:</span><span>{stats.active_range}</span></div>
            <div className="history-item"><span className="row-label"><Icon name="dice" size={14} /> Оборот (ставки)</span><span>${fmt(stats.total_turnover)}</span></div>
          </div>

          <div className="card">
            <h3 className="admin-h admin-h--green"><Icon name="coins" size={15} /> Пополнения и выводы</h3>
            <div className="history-item"><span className="row-label"><Icon name="deposit" size={14} /> Пополнений</span><span>{stats.deposits_count} на ${fmt(stats.deposits_total)}</span></div>
            <div className="history-item"><span className="row-label"><Icon name="withdraw" size={14} /> Выводов</span><span>{stats.withdraws_count} на ${fmt(stats.withdraws_total)}</span></div>
          </div>

          <div className="card">
            <h3 className="admin-h admin-h--gold"><Icon name="trendUp" size={15} /> Доход проекта: ${fmt(totalRev)}</h3>
            <div className="history-item"><span className="row-label"><Icon name="rocket" size={14} /> Ракета</span><span className="text-green">+${fmt(rev.rocket || 0)}</span></div>
            <div className="history-item"><span className="row-label"><Icon name="swords" size={14} /> Дуэли</span><span className="text-green">+${fmt(rev.duel || 0)}</span></div>
            <div className="history-item"><span className="row-label"><Icon name="lock" size={14} /> Сейф (всего)</span><span className="text-green">+${fmt((rev.safe||0)+(rev.safe_remainder||0))}</span></div>
            <div className="history-item"><span className="row-label"><Icon name="percent" size={14} /> Комиссия выводов</span><span className="text-green">+${fmt(rev.withdrawal || 0)}</span></div>
            {Object.entries(rev).filter(([k]) => !['rocket','duel','safe','safe_remainder','withdrawal'].includes(k)).map(([k,v]) => (
              <div key={k} className="history-item"><span>• {k}:</span><span className="text-green">+${fmt(Number(v))}</span></div>
            ))}
          </div>

          <div className="card">
            <h3 className="admin-h admin-h--violet"><Icon name="gem" size={15} /> Пул вклада</h3>
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

          {stats.recent_transactions?.length > 0 && (
            <div className="card">
              <h3 className="admin-h"><Icon name="clock" size={15} /> Последние операции</h3>
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
            <div className="card-title admin-cash"><Icon name="vault" size={20} /> Главная касса</div>
            <div style={{fontSize:32, fontWeight:900, color:'var(--gold)', textAlign:'center', margin:'8px 0'}}>
              ${fmt(stats.platform_cashbox)}
            </div>
            <div className="text-dim text-center" style={{fontSize:12}}>Сюда поступают все комиссии. Отсюда можно выводить из проекта.</div>
            <div style={{display:'flex', gap:8, marginTop:12}}>
              <input className="input" style={{fontSize:14, flex:1}} type="number" placeholder="Сумма" value={seedAmt} onChange={e=>setSeedAmt(e.target.value)} />
              <button className="btn btn-small btn-green" onClick={async () => {
                await adminApi.seedPlatform(parseFloat(seedAmt)); setSeedAmt(''); loadStats(); showToast('Касса пополнена');
              }}><Icon name="flask" size={13} strokeWidth={2.2} /> Тест +</button>
            </div>
            <div style={{display:'flex', gap:8, marginTop:8}}>
              <input className="input" style={{fontSize:14, flex:1}} type="number" placeholder="Сумма" value={withdrawAmt} onChange={e=>setWithdrawAmt(e.target.value)} />
              <input className="input" style={{fontSize:12, width:120}} placeholder="Коммент" value={withdrawNote} onChange={e=>setWithdrawNote(e.target.value)} />
              <button className="btn btn-small btn-danger" onClick={async () => {
                await adminApi.withdrawPlatform(parseFloat(withdrawAmt), withdrawNote); setWithdrawAmt(''); setWithdrawNote(''); loadStats(); showToast('Выведено');
              }}><Icon name="withdraw" size={13} strokeWidth={2.2} /> Вывести</button>
            </div>
          </div>

          <div className="card">
            <div className="card-title admin-cash admin-cash--blue"><Icon name="rocket" size={17} /> Касса Ракеты</div>
            <div style={{fontSize:28, fontWeight:900, color:'var(--blue)', textAlign:'center', margin:'8px 0'}}>
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
            <div className="card-title admin-cash admin-cash--violet"><Icon name="gem" size={17} /> Пул вклада</div>
            <div style={{fontSize:28, fontWeight:900, color:'var(--violet)', textAlign:'center', margin:'8px 0'}}>
              ${fmt(stats.vault_pool_total)}
            </div>
            <div className="text-dim text-center" style={{fontSize:12}}>15% от суточного дохода + ручные добавки. Выплачивается активным вкладам в полночь. НЕЛЬЗЯ выводить из проекта.</div>
            <div style={{display:'flex', gap:8, marginTop:12}}>
              <input className="input" style={{fontSize:14, flex:1}} type="number" placeholder="Сумма" value={poolAmt} onChange={e=>setPoolAmt(e.target.value)} />
              <button className="btn btn-small" style={{background:'var(--violet)', color:'var(--text)'}} onClick={async () => {
                await adminApi.addPool(parseFloat(poolAmt)); setPoolAmt(''); loadStats(); showToast('Добавлено в ПУЛ');
              }}>← ИЗ ГЛАВНОЙ</button>
            </div>
          </div>

          {stats.transfers?.length > 0 && (
            <div className="card">
              <div className="card-title"><Icon name="list" size={16} /> История переводов между кассами</div>
              <div className="scroll-list" style={{maxHeight:300, overflowY:'auto'}}>
                {stats.transfers.map((t: any) => (
                  <div key={t.id} className="history-item" style={{fontSize:12}}>
                    <span>{t.from} → {t.to}</span>
                    <span>
                      <b style={{color: t.from === 'external' || t.to === 'external' ? 'var(--red)' : 'var(--gold)'}}>
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
        <>
          {(settingsGroups.length ? settingsGroups : [{ title: 'НАСТРОЙКИ', keys: Object.keys(settings) }]).map((g, gi) => {
            const keys = g.keys.filter(k => k in settings);
            if (!keys.length) return null;
            return (
              <div className="card" key={gi}>
                <div className="card-title">{g.title}</div>
                {keys.map(k => (
                  <div key={k} className="history-item">
                    <label style={{fontSize:13, flex:1}}>{settingsLabels[k] || k}</label>
                    <input
                      style={{
                        width: 130, background: 'var(--bg-3)', border: '1px solid var(--glass-border)',
                        borderRadius: 6, padding: '8px 10px', color: 'var(--text)', textAlign: 'right', fontWeight:700
                      }}
                      value={settings[k] as string}
                      onChange={e => setSettings({...settings, [k]: e.target.value})}
                    />
                  </div>
                ))}
              </div>
            );
          })}

          {/* Настройки, не попавшие ни в одну группу */}
          {(() => {
            const grouped = new Set(settingsGroups.flatMap(g => g.keys));
            const rest = Object.keys(settings).filter(k => !grouped.has(k));
            if (!rest.length) return null;
            return (
              <div className="card">
                <div className="card-title"><Icon name="sliders" size={16} /> Прочее</div>
                {rest.map(k => (
                  <div key={k} className="history-item">
                    <label style={{fontSize:13, flex:1}}>{settingsLabels[k] || k}</label>
                    <input
                      style={{
                        width: 130, background: 'var(--bg-3)', border: '1px solid var(--glass-border)',
                        borderRadius: 6, padding: '8px 10px', color: 'var(--text)', textAlign: 'right', fontWeight:700
                      }}
                      value={settings[k] as string}
                      onChange={e => setSettings({...settings, [k]: e.target.value})}
                    />
                  </div>
                ))}
              </div>
            );
          })()}

          <button className="btn mt" onClick={async () => { await adminApi.setSettings(settings); showToast('Сохранено'); }}>
            <Icon name="check" size={16} strokeWidth={2.4} /> Сохранить все настройки
          </button>
        </>
      )}

      {tab === 'users' && (
        <>
          <div className="card">
            <div className="card-title"><Icon name="users" size={16} /> Пользователи</div>
            <input className="input" style={{fontSize:14}} placeholder="Поиск по @username, ID, TG ID" value={userSearch} onChange={e=>setUserSearch(e.target.value)} />
            <div className="scroll-list" style={{maxHeight:400, overflowY:'auto', marginTop:10}}>
              {users.map((u: any) => (
                <div key={u.id} className="history-item" style={{cursor:'pointer'}} onClick={() => adminApi.userDetail(u.id).then(setSelectedUser)}>
                  <div>
                    <div style={{fontWeight:700}}>{u.banned && <Icon name="ban" size={13} className="text-red" />}{u.username} <span className="text-dim" style={{fontSize:11}}>#{u.id} · TG:{u.telegram_id}</span></div>
                    <div className="text-dim" style={{fontSize:11}}>Рак:{u.rocket_games} · Дuel:{u.duel_games} · ${fmt(u.rocket_bet_sum)} ставок · деп ${fmt(u.deposits_sum)}</div>
                  </div>
                  <div style={{fontWeight:900, color:'var(--gold)'}}>${fmt(u.balance)}</div>
                </div>
              ))}
            </div>
          </div>

          {selectedUser && (
            <div className="card" style={{border:'2px solid var(--gold)'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div className="card-title" style={{margin:0}}>
                  {selectedUser.user.banned && <Icon name="ban" size={15} className="text-red" />} {selectedUser.user.username}
                </div>
                <button className="btn btn-small btn-secondary" onClick={() => setSelectedUser(null)} aria-label="Закрыть">
                  <Icon name="close" size={14} strokeWidth={2.4} />
                </button>
              </div>
              <div className="text-dim" style={{fontSize:12, marginBottom:8}}>
                ID: {selectedUser.user.id} · TG: {selectedUser.user.telegram_id} · рег. {new Date(selectedUser.user.created_at).toLocaleDateString('ru-RU', {timeZone:'Europe/Moscow'})}
              </div>
              <div className="history-item"><span>Баланс:</span><b style={{color:'var(--gold)'}}>${fmt(selectedUser.user.balance)}</b></div>
              {/* «Заморожено» не объясняло, откуда взялась сумма: это резерв
                  ставок в дуэлях, поэтому подписываем прямо «Дуэли» */}
              <div className="history-item"><span>Дуэли (резерв):</span><span>${fmt(selectedUser.user.frozen_balance)}</span></div>
              {/* Где ещё деньги игрока: вклад в сейф и тело вклада VAULT */}
              <div className="history-item"><span>В сейфе:</span><span>${fmt(selectedUser.user.safe_locked || 0)}</span></div>
              <div className="history-item"><span>Во вкладе VAULT:</span><span>${fmt(selectedUser.user.vault_locked || 0)}</span></div>
              <div className="history-item"><span>Всего средств:</span><b>${fmt(
                (selectedUser.user.balance || 0)
                + (selectedUser.user.safe_locked || 0)
                + (selectedUser.user.vault_locked || 0)
              )}</b></div>
              <div className="history-item"><span>Автосейф:</span><span>{selectedUser.user.auto_safe_percent}%</span></div>
              <div className="history-item">
                <span>Пригласил:</span>
                <span>
                  {selectedUser.referrals?.invited_by
                    ? `@${selectedUser.referrals.invited_by.username} (#${selectedUser.referrals.invited_by.id})`
                    : (selectedUser.user.referred_by ? `ID ${selectedUser.user.referred_by}` : '— пришёл сам')}
                </span>
              </div>

              {/* ── Подробная статистика: в плюсе игрок или в минусе ─────────
                  Считается сервером по журналу операций (см. buildUserStats),
                  поэтому сюда попадают и игры, и дивиденды вклада, и реферальные,
                  и ручные корректировки. Депозиты/выводы в итог не входят — это
                  движение денег, а не результат. */}
              {selectedUser.stats && (
                <div className="admin-stats">
                  <div className="admin-stats__title">Результат игрока</div>
                  <div className={`admin-verdict ${selectedUser.stats.total_net > 0 ? 'admin-verdict--plus' : selectedUser.stats.total_net < 0 ? 'admin-verdict--minus' : ''}`}>
                    <span>{selectedUser.stats.total_net > 0 ? 'в плюсе' : selectedUser.stats.total_net < 0 ? 'в минусе' : 'в нуле'}</span>
                    <b>{selectedUser.stats.total_net > 0 ? '+' : selectedUser.stats.total_net < 0 ? '−' : ''}${fmt(Math.abs(selectedUser.stats.total_net))}</b>
                  </div>
                  <div className="admin-stats__grid">
                    <div><span>Ставки</span><b>${fmt(selectedUser.stats.bets)}</b></div>
                    <div><span>Выигрыши</span><b className="text-green">${fmt(selectedUser.stats.wins)}</b></div>
                    <div><span>Итог по играм</span><b className={selectedUser.stats.games_net >= 0 ? 'text-green' : 'text-red'}>{selectedUser.stats.games_net >= 0 ? '+' : '−'}${fmt(Math.abs(selectedUser.stats.games_net))}</b></div>
                    <div><span>Дивиденды вклада</span><b>${fmt(selectedUser.stats.dividends)}</b></div>
                    <div><span>Реферальные</span><b>${fmt(selectedUser.stats.referral)}</b></div>
                    <div><span>Корректировки</span><b>${fmt(selectedUser.stats.adjustments)}</b></div>
                    <div><span>Пополнил</span><b>${fmt(selectedUser.stats.deposited)}</b></div>
                    <div><span>Вывел</span><b>${fmt(selectedUser.stats.withdrawn)}</b></div>
                  </div>
                  <div className="admin-stats__title" style={{marginTop:10}}>По играм</div>
                  <div className="admin-games">
                    {([
                      ['rocket','Ракета'], ['duel','Дуэль'], ['safe','Сейф'], ['vault','Вклад']
                    ] as const).map(([key, label]) => {
                      const g = selectedUser.stats.games?.[key];
                      if (!g) return null;
                      return (
                        <div className="admin-game" key={key}>
                          <div className="admin-game__name">{label}</div>
                          <div className="admin-game__rows">
                            <span>раундов <b>{g.rounds}</b></span>
                            <span>ставки <b>${fmt(g.bets)}</b></span>
                            <span>выигрыши <b>${fmt(g.wins)}</b></span>
                          </div>
                          <div className={`admin-game__net ${g.net >= 0 ? 'text-green' : 'text-red'}`}>
                            {g.net >= 0 ? '+' : '−'}${fmt(Math.abs(g.net))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Рефералы игрока: по именам, с оборотом каждого ────────── */}
              {selectedUser.referrals && (
                <div className="admin-refs">
                  <div className="admin-stats__title">
                    Рефералы: {selectedUser.referrals.count}
                    {selectedUser.referrals.earned_total > 0 && (
                      <span className="admin-refs__earned">
                        начислено ${fmt(selectedUser.referrals.earned_total)} ({selectedUser.referrals.referral_percent}% с оборота)
                      </span>
                    )}
                  </div>
                  {selectedUser.referrals.count === 0 && (
                    <div className="text-dim" style={{fontSize:12}}>Никого не пригласил</div>
                  )}
                  {selectedUser.referrals.list?.map((r: any) => (
                    <div className="history-item" key={r.id} style={{fontSize:12}}>
                      <div>
                        <div style={{fontWeight:700}}>
                          {r.banned && <Icon name="ban" size={12} className="text-red" />}@{r.username || 'без имени'}
                          <span className="text-dim" style={{fontSize:11}}> #{r.id}</span>
                        </div>
                        <div className="text-dim" style={{fontSize:11}}>
                          {r.bets_count} ставок · оборот ${fmt(r.total_bets)} · с него ${fmt(r.earned_from)}
                        </div>
                      </div>
                      <button className="btn btn-small btn-secondary" onClick={() => adminApi.userDetail(r.id).then(setSelectedUser)}>
                        Открыть
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:'flex', gap:6, margin:'10px 0'}}>
                <input className="input" style={{fontSize:13, flex:1}} placeholder="+/- сумма корректировки" value={adjustDelta} onChange={e=>setAdjustDelta(e.target.value)} />
                <button className="btn btn-small" onClick={async () => {
                  await adminApi.adjustUser(selectedUser.user.id, parseFloat(adjustDelta));
                  setAdjustDelta('');
                  const fresh = await adminApi.userDetail(selectedUser.user.id);
                  setSelectedUser(fresh);
                  loadStats();
                  showToast('Баланс скорректирован');
                }}><Icon name="edit" size={13} strokeWidth={2.2} /> Корректировать</button>
              </div>
              <div style={{display:'flex', gap:6}}>
                {selectedUser.user.banned ? (
                  <button className="btn btn-small btn-green" onClick={async () => {
                    await adminApi.unbanUser(selectedUser.user.id);
                    const fresh = await adminApi.userDetail(selectedUser.user.id); setSelectedUser(fresh); loadUsers(); showToast('Разбанен');
                  }}><Icon name="check" size={13} strokeWidth={2.4} /> Разбанить</button>
                ) : (
                  <>
                    <input className="input" style={{fontSize:13, flex:1}} placeholder="Причина бана" value={banReason} onChange={e=>setBanReason(e.target.value)} />
                    <button className="btn btn-small btn-danger" onClick={async () => {
                      await adminApi.banUser(selectedUser.user.id, banReason);
                      setBanReason('');
                      const fresh = await adminApi.userDetail(selectedUser.user.id); setSelectedUser(fresh); loadUsers(); showToast('Забанен');
                    }}><Icon name="ban" size={13} strokeWidth={2.2} /> Бан</button>
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

      {tab === 'antifraud' && (
        <div className="card"><div className="card-title"><Icon name="shield" size={16} /> Антифрод</div>
          {fraud.map((f:any)=><div className="history-item" key={f.id}><div><b>@{f.username||f.telegram_id}</b><div className="text-dim">{f.kind} · риск {f.risk_score}</div></div><div style={{display:'flex',gap:4}}><button className="btn btn-small" onClick={async()=>{await adminApi.reviewFraud(f.id,'confirmed');setFraud(fraud.filter(x=>x.id!==f.id));}}>Подтвердить</button><button className="btn btn-small btn-secondary" onClick={async()=>{await adminApi.reviewFraud(f.id,'resolved');setFraud(fraud.filter(x=>x.id!==f.id));}}>Закрыть</button></div></div>)}
          {!fraud.length&&<div className="text-dim text-center">Открытых флагов нет</div>}
        </div>
      )}

      {tab === 'tx' && (
        <div className="card">
          <div className="card-title"><Icon name="list" size={16} /> Все операции</div>
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

      {tab === 'payouts' && (
        <div className="card">
          <div className="card-title"><Icon name="withdraw" size={16} /> Заявки на вывод</div>
          <div className="text-dim" style={{fontSize:12, marginBottom:8}}>
            Деньги списаны с баланса в момент создания заявки. В реальном режиме заявка ждёт
            ручной отправки USDT: внесите tx_hash из блокчейна и нажмите «Выплачено».
            Отклонение возвращает сумму на баланс игрока.
          </div>
          <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:8}}>
            {([['pending','Ожидают'],['paid','Выплачены'],['rejected','Отклонённые'],['','Все']] as const).map(([v,label]) => (
              <button key={v || 'all'} className="btn btn-small"
                style={{background: payoutFilter === v ? 'var(--gold)' : 'var(--bg-3)', color: payoutFilter === v ? 'var(--bg)' : 'var(--text)'}}
                onClick={() => setPayoutFilter(v as any)}>{label}</button>
            ))}
            <button className="btn btn-small btn-secondary" onClick={loadPayouts}><Icon name="refresh" size={13} strokeWidth={2.2} /> Обновить</button>
          </div>
          <div className="scroll-list" style={{maxHeight:520, overflowY:'auto'}}>
            {payouts.map((w: any) => (
              <div key={w.id} className="history-item" style={{fontSize:12, display:'block'}}>
                <div style={{display:'flex', justifyContent:'space-between', gap:8}}>
                  <div>
                    <div style={{fontWeight:700}}>#{w.id} · {w.username ? '@' + w.username : 'user ' + w.user_id} <span className="text-dim">(tg {w.telegram_id})</span></div>
                    <div className="text-dim" style={{fontSize:11, wordBreak:'break-all'}}>{w.address}</div>
                    <div className="text-dim" style={{fontSize:10}}>
                      {new Date(w.created_at).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'})}
                      {w.paid_at ? ` · выплачено ${new Date(w.paid_at).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'})}` : ''}
                    </div>
                    {w.tx_hash && <div className="text-dim" style={{fontSize:10, wordBreak:'break-all'}}>tx: {w.tx_hash}</div>}
                    {w.reject_reason && <div className="text-red" style={{fontSize:10}}>причина: {w.reject_reason}</div>}
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:900}}>${fmt(w.amount)}</div>
                    <div className="text-dim" style={{fontSize:11}}>комиссия ${fmt(w.fee)}</div>
                    <div className="text-green" style={{fontSize:12, fontWeight:700}}>к выплате ${fmt(w.payout)}</div>
                    <div style={{fontSize:11, marginTop:2}}>
                      {w.status === 'pending' && <span className="text-accent">ожидает</span>}
                      {w.status === 'paid' && <span className="text-green">выплачено</span>}
                      {w.status === 'rejected' && <span className="text-red">отклонено</span>}
                    </div>
                  </div>
                </div>
                {w.status === 'pending' && (
                  <div style={{display:'flex', gap:6, marginTop:8, flexWrap:'wrap'}}>
                    <input className="input" style={{flex:1, minWidth:180, fontSize:12, padding:'6px'}}
                      placeholder="tx_hash из блокчейна"
                      onChange={e => (w.__tx = e.target.value)} />
                    <button className="btn btn-small btn-green" onClick={async () => {
                      const tx = String(w.__tx || '').trim();
                      if (!tx) return showToast('Введите tx_hash');
                      try { await adminApi.payWithdrawal(w.id, tx); showToast(`Заявка #${w.id} выплачена`); loadPayouts(); loadStats(); }
                      catch (e: any) { showToast(e.message); }
                    }}><Icon name="check" size={13} strokeWidth={2.4} /> Выплачено</button>
                    <button className="btn btn-small btn-danger" onClick={async () => {
                      // Кастомное окно вместо `window.prompt`: в Telegram WebView
                      // нативный prompt часто не показывается, и заявка
                      // отклонялась без причины (или действие молча не выполнялось)
                      const reason = await dialog.prompt({
                        title: `Отклонить заявку #${w.id}?`,
                        message: (
                          <>
                            К выплате <b>${fmt(w.payout)}</b> вернутся на баланс игрока.
                            Причина попадёт в историю выплат и в уведомление игроку.
                          </>
                        ),
                        input: { placeholder: 'Например: неверный адрес кошелька' },
                        confirmText: 'Отклонить',
                        cancelText: 'Не отклонять',
                        tone: 'danger',
                        icon: 'alert'
                      });
                      // null — окно закрыли/отменили: ничего не делаем
                      if (reason === null) return;
                      try { await adminApi.rejectWithdrawal(w.id, reason.trim() || undefined); showToast(`Заявка #${w.id} отклонена, деньги возвращены`); loadPayouts(); loadStats(); }
                      catch (e: any) { showToast(e.message); }
                    }}><Icon name="refresh" size={13} strokeWidth={2.2} /> Отклонить</button>
                  </div>
                )}
              </div>
            ))}
            {payouts.length === 0 && <div className="text-dim text-center" style={{padding:20}}>Заявок нет</div>}
          </div>
        </div>
      )}
    </>
  );
}
