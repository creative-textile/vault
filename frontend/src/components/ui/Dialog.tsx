/**
 * Кастомные диалоги вместо `window.confirm` / `window.prompt` / `alert`.
 *
 * Почему нативные окна неприемлемы:
 *  - в Telegram WebView нативный `confirm` часто вообще не показывается
 *    (WebView блокирует модальные окна страницы) — действие просто молча
 *    отменяется или выполняется;
 *  - окно Chrome выглядит чужеродно рядом с дизайн-системой «Neon Vault Luxury»
 *    и не читается на солнце;
 *  - `window.prompt` для пароля администратора показывает текст в открытом
 *    виде и не даёт управлять фокусом/подсказкой.
 *
 * API — обещания, поэтому вызывающий код почти не меняется:
 *   if (!(await dialog.confirm({ title: 'Вернуть вклад?' }))) return;
 *   const reason = await dialog.prompt({ title: 'Причина отклонения' });
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon, { type IconName } from './Icon';
import { sfx } from '../../audio';

export type DialogTone = 'neutral' | 'danger' | 'success' | 'gold';

export interface DialogOptions {
  title: string;
  /** Основной текст. Может содержать JSX (суммы, пояснения). */
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
  icon?: IconName;
  /** Поле ввода: если задано, диалог работает как prompt. */
  input?: {
    value?: string;
    placeholder?: string;
    /** `password` — для пароля администратора. */
    type?: 'text' | 'password';
    /** Пустой ответ недопустим: кнопка подтверждения останется выключенной. */
    required?: boolean;
  };
  /** Скрыть кнопку отмены (диалог-уведомление вместо alert). */
  alert?: boolean;
}

/** Результат: `true/false` для confirm, `string|null` для prompt, `true` для alert. */
export type DialogResult = boolean | string | null;

interface Pending extends DialogOptions {
  resolve: (value: DialogResult) => void;
}

let pushDialog: ((p: Pending) => void) | null = null;
let hostMounted = false;

/** Нативный запасной вариант, если диалог вызван до монтирования хоста. */
function fallback(o: DialogOptions): DialogResult {
  if (o.input) return window.prompt(o.title + (o.message ? `\n${String(o.message)}` : ''), o.input.value || '');
  if (o.alert) { window.alert(o.title + (o.message ? `\n${String(o.message)}` : '')); return true; }
  return window.confirm(o.title + (o.message ? `\n${String(o.message)}` : ''));
}

function open(o: DialogOptions): Promise<DialogResult> {
  if (!hostMounted || !pushDialog) return Promise.resolve(fallback(o));
  return new Promise<DialogResult>(resolve => pushDialog!({ ...o, resolve }));
}

export const dialog = {
  /** Да/нет. Резолвится `false` при отмене, закрытии и Escape. */
  confirm: (o: DialogOptions): Promise<boolean> =>
    open({ confirmText: 'Подтвердить', cancelText: 'Отмена', ...o }).then(v => v === true),
  /** Ввод строки. Резолвится `null` при отмене. */
  prompt: (o: DialogOptions): Promise<string | null> =>
    open({ confirmText: 'OK', cancelText: 'Отмена', input: { type: 'text', ...o.input }, ...o })
      .then(v => (typeof v === 'string' ? v : null)),
  /** Уведомление с одной кнопкой. */
  alert: (o: DialogOptions): Promise<void> =>
    open({ alert: true, confirmText: 'Закрыть', ...o }).then(() => undefined)
};

/** Хост монтируется один раз в <App> и держит очередь диалогов. */
export default function DialogHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const current = queue[0];

  useEffect(() => {
    hostMounted = true;
    pushDialog = (p: Pending) => setQueue(q => [...q, p]);
    return () => { hostMounted = false; pushDialog = null; };
  }, []);

  const finish = useCallback((value: DialogResult) => {
    setQueue(q => {
      const [head, ...rest] = q;
      head?.resolve(value);
      return rest;
    });
  }, []);

  // Фокус в поле ввода — сразу, чтобы на десктопе можно было печатать без клика
  useEffect(() => {
    if (current?.input) {
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(current.input ? null : false); }
      if (e.key === 'Enter' && !current.input) { e.preventDefault(); finish(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, finish]);

  if (!current) return null;

  const tone: DialogTone = current.tone || 'neutral';

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 5000 }}
      onClick={() => finish(current.input ? null : false)}
      role="presentation"
    >
      <DialogCard
        key={queue.length + current.title}
        options={current}
        tone={tone}
        inputRef={inputRef}
        onConfirm={(inputValue) => {
          sfx.confirm();
          finish(current.input ? (inputValue ?? '') : true);
        }}
        onCancel={() => {
          sfx.tapSoft();
          finish(current.input ? null : false);
        }}
      />
    </div>
  );
}

/** Карточка диалога — отдельный компонент, чтобы поле ввода имело свой state. */
function DialogCard({
  options, tone, inputRef, onConfirm, onCancel
}: {
  options: Pending;
  tone: DialogTone;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(options.input?.value ?? '');
  const required = !!options.input?.required;
  const canConfirm = !options.input || !required || text.trim().length > 0;

  const confirmClass =
    tone === 'danger' ? 'btn btn-danger'
      : tone === 'success' ? 'btn btn-green'
        : 'btn';

  return (
    <div
      className={`modal dialog dialog--${tone}`}
      onClick={e => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={options.title}
    >
      {options.icon && (
        <div className={`dialog__icon dialog__icon--${tone}`}>
          <Icon name={options.icon} size={26} strokeWidth={1.7} />
        </div>
      )}
      <div className="dialog__title">{options.title}</div>
      {options.message != null && <div className="dialog__message">{options.message}</div>}

      {options.input && (
        <input
          ref={inputRef}
          className="input input--left dialog__input"
          type={options.input.type || 'text'}
          value={text}
          placeholder={options.input.placeholder}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canConfirm) onConfirm(text); }}
          autoComplete="off"
        />
      )}

      <div className="dialog__actions">
        {!options.alert && (
          <button className="btn btn-secondary" onClick={onCancel}>
            {options.cancelText || 'Отмена'}
          </button>
        )}
        <button
          className={confirmClass}
          disabled={!canConfirm}
          onClick={() => onConfirm(options.input ? text : undefined)}
        >
          {options.confirmText || 'Подтвердить'}
        </button>
      </div>
    </div>
  );
}
