import { Router } from 'express';
import { getReplay, ReplayGame } from '../../services/replay';
const router=Router();
router.get('/:game/:id',async(req,res)=>{
  try {
    if(!['rocket','duel','safe'].includes(req.params.game)) return res.status(400).json({error:'Неизвестная игра'});
    const id=Number(req.params.id); if(!Number.isInteger(id)||id<1) return res.status(400).json({error:'Некорректный ID'});
    const replay=await getReplay(req.params.game as ReplayGame,id);
    if(!replay) return res.status(404).json({error:'Реплей не найден или раунд не завершён'});
    res.set('Cache-Control','public, max-age=60, immutable').json(replay);
  } catch(e:any) { res.status(400).json({error:e.message}); }
});
export default router;
