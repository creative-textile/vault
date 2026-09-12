-- Удаляем уведомления с невалидными duel_id в данных (NaN или null)
-- Это исправляет проблему с ошибкой "invalid input syntax for type integer: NaN"

-- Удаляем уведомления типа duel_result, у которых data->>'$.duel_id' это NULL или не число
DELETE FROM user_notifications 
WHERE type = 'duel_result' 
  AND (data->>'duel_id' IS NULL 
       OR data->>'duel_id' = 'NaN' 
       OR data->>'duel_id' ~ '^[^0-9]+$');

-- Также удаляем уведомления, у которых data это NULL или пустой объект
DELETE FROM user_notifications 
WHERE type = 'duel_result' 
  AND (data IS NULL OR data = '{}'::jsonb);
