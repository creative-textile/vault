import { useEffect,useState } from 'react';
import Header from './Header';
import { statsApi } from '../../api/client';
const money=(n:any)=>`$${Number(n||0).toFixed(2)}`;
export default function ProjectStats(){
 const [stats,setStats]=useState<any>(null);const [error,setError]=useState('');
 useEffect(()=>{statsApi.summary().then(setStats).catch((e:any)=>setError(e.message))},[]);
 return <><Header title="📊 Статистика VAULT"/>
  {error&&<div className="card text-red">{error}</div>}
  {!stats&&!error&&<div className="text-center mt">Загрузка…</div>}
  {stats&&<>
   <div className="card card-hl text-center"><div className="balance-label">ПРОЕКТ РАБОТАЕТ</div><div style={{fontSize:40,fontWeight:900,color:'var(--gold)'}}>{stats.days_working}</div><div className="text-dim">дней · с {new Date(`${stats.project_start}T00:00:00`).toLocaleDateString('ru-RU')}</div></div>
   <div className="card"><div className="history-item"><span>👥 Участников</span><b>{stats.users_count}</b></div><div className="history-item"><span>📥 Пополнено</span><b className="text-green">{money(stats.total_deposited)}</b></div><div className="history-item"><span>📤 Выплачено</span><b>{money(stats.total_withdrawn)}</b></div></div>
   <div className="card text-center text-dim">Показатели рассчитаны по подтверждённым операциям VAULT и обновляются автоматически.</div>
  </>}
 </>;
}
