import { app } from './core/app.js';

/** Presentation only: never touches document state or storage. */
export function applyTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return false;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const background = theme === 'light' ? '#f3f3f6' : '#0f0f13';
  document.documentElement.style.backgroundColor = background;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
  app.emit('theme-change');
  for (const canvas of document.querySelectorAll('canvas')) canvas.dispatchEvent(new Event('theme-change'));
  app.requestRender();
  return true;
}
