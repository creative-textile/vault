import { useCallback, useEffect, useState } from 'react';
import { audio } from './engine';
import type { AudioSettings } from './engine';

/**
 * Настройки звука для UI (переключатель в профиле/шапке).
 * Держим локальный state, потому что `audio.settings` — не реактивный объект:
 * без копии переключатель не перерисовывался бы после клика.
 */
export function useAudioSettings() {
  const [settings, setSettings] = useState<AudioSettings>({ ...audio.settings });

  // Другая вкладка изменила настройки — синхронизируем переключатель
  useEffect(() => {
    const sync = () => setSettings({ ...audio.settings });
    window.addEventListener('vault:audio-settings', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('vault:audio-settings', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const announce = useCallback(() => {
    setSettings({ ...audio.settings });
    window.dispatchEvent(new CustomEvent('vault:audio-settings'));
  }, []);

  const toggleMuted = useCallback(() => {
    audio.setMuted(!audio.settings.muted);
    // Даем услышать результат включения (при выключении звук, очевидно, молчит)
    if (audio.settings.muted === false) audio.confirm();
    announce();
  }, [announce]);

  const setVolume = useCallback((v: number) => {
    audio.setVolume(v);
    if (!audio.settings.muted) audio.tap();
    announce();
  }, [announce]);

  const toggleHaptics = useCallback(() => {
    audio.setHaptics(!audio.settings.haptics);
    if (audio.settings.haptics === false) audio.haptic('medium');
    announce();
  }, [announce]);

  return { settings, toggleMuted, setVolume, toggleHaptics };
}
