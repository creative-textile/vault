import { useEffect,useState } from 'react';
import { Link,useParams } from 'react-router-dom';
import { replayApi } from '../../api/client';
import DuelScene from '../../three/duel/DuelScene';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import RocketScene from '../../three/rocket/RocketScene';

export default function Replay(){
 const {game,id}=useParams(); const [r,setR]=useState<any>(); const [err,setErr]=useState(''); const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{let live=true; if(!['rocket','duel','safe'].includes(game||'')){setErr('Неизвестный реплей');return;}
  replayApi.get(game as any,Number(id)).then(x=>live&&setR(x)).catch(e=>live&&setErr(e.message)); return()=>{live=false};},[game,id]);
 useEffect(()=>{if(!r)return; const start=performance.now(); let frame=0; const tick=(now:number)=>{setElapsed(Math.min(r.duration_ms,now-start)); if(now-start<r.duration_ms)frame=requestAnimationFrame(tick)}; frame=requestAnimationFrame(tick); return()=>cancelAnimationFrame(frame)},[r]);
 if(err)return <div className="card text-center">{err}<br/><Link to="/">На главную</Link></div>;
 if(!r)return <div className="text-center mt">Загрузка реплея…</div>;
 const done=elapsed>=r.duration_ms, mult=r.game==='rocket'?Math.min(r.outcome.crash_at,Math.exp(r.animation.curve*elapsed/1000)):1;
 const share=async()=>{const url=location.href; if(navigator.share)await navigator.share({title:`VAULT ${r.game} replay`,url}); else {await navigator.clipboard.writeText(url);}};
 return <>
  <div className="card text-center"><b>📼 {r.game.toUpperCase()} #{r.id}</b><div className="text-dim">Публичный детерминированный повтор</div></div>
  {r.game==='rocket'&&<RocketScene phase={done?'crashed':'flying'} multiplier={mult} seed={r.animation.seed}/>} 
  {r.game==='duel'&&<DuelScene phase={done?'result':'flipping'} result={r.outcome.result} trajectory={r.animation.trajectory}/>} 
  {r.game==='safe'&&<SafeCrackScene phase={done?'result':'spinning'} code={r.animation.code} drumSpeeds={r.animation.drum_speeds}/>} 
  <div className="card"><div>Участники: {r.participants.map((p:any)=>p.name).join(', ')}</div>
   {r.game==='rocket'&&<div>x{mult.toFixed(2)} · взрыв x{r.outcome.crash_at.toFixed(2)}</div>}
   {r.game==='duel'&&done&&<div>{r.outcome.result==='heads'?'Орёл':'Решка'}</div>}
   {r.game==='safe'&&done&&<div>Победителей: {r.outcome.winners_count}</div>}
  </div>
  <button className="btn" onClick={share}>📤 Поделиться реплеем</button><Link className="btn btn-secondary mt" to="/">🏠 На главную</Link>
 </>;
}
