import { useTheme } from '../lib/theme';
import { MoonIcon, SunIcon } from './Icons';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === 'dark' ? 'Daylight' : 'Graveyard shift';
  return (
    <button className="btn btn-ghost btn-small" type="button" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next}`}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      <span className="theme-label">{theme === 'dark' ? 'Lights on' : 'Lights off'}</span>
    </button>
  );
}
