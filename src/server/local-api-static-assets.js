import { join } from 'node:path';

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');

export const LOCAL_API_STATIC_FILE_OPTIONS = Object.freeze({
  dotfiles: 'allow',
});

export const LOCAL_API_STATIC_ASSET_REGISTRY = Object.freeze({
  studio_html: join(PUBLIC_DIR, 'studio.html'),
  studio_css: join(PUBLIC_DIR, 'css', 'studio.css'),
  studio_shell_js: join(PUBLIC_DIR, 'js', 'studio-shell.js'),
  app_js_dir: join(PUBLIC_DIR, 'js', 'app'),
  i18n_js_dir: join(PUBLIC_DIR, 'js', 'i18n'),
  studio_js_dir: join(PUBLIC_DIR, 'js', 'studio'),
});
