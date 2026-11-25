import { readFileSync } from 'node:fs';
export function bootstrap() {
  const base = new URL('../src-tauri/src/', import.meta.url);
  const read = path => readFileSync(new URL(path, base), 'utf8');
  let script = read('lib.rs').match(/const BOOTSTRAP_TEMPLATE: &str = r####"([\s\S]*?)"####;/)[1];
  for (const key of ['VOICE', 'PRIVACY', 'AERO', 'SPLASH', 'STARTUP', 'SETTINGS_ENTRY', 'SCREENSHARE', 'WORKSPACE', 'PHOTO_TOOLS', 'CINEMA', 'ECOSYSTEM']) {
    script = script.replace(`__LDC_${key}_MODULE__`, read(`client/${key.toLowerCase().replaceAll('_','-')}.js`));
  }
  script=script.replace('__LDC_CARD_SCHEMA__',read('../../shared/card.mjs').replaceAll('export ',''))
    .replace('__LDC_CARD_CSS__',JSON.stringify(read('../../shared/card.css'))).replace('__LDC_CINEMA_CSS__',JSON.stringify(read('client/cinema.css')));
  return script.replace('__LDC_APP_VERSION__', read('../Cargo.toml').match(/^version = "([^"]+)"/m)[1]).replace('__LDC_AERO_CSS__', JSON.stringify(read('client/aero.css'))).replace('__LDC_NIGHT_CITY_URI__',read('client/night-city.jpg.b64').trim())
    .replace('__LDC_SETTINGS_CSS__', JSON.stringify(read('client/settings.css'))).replace('__LDC_SPLASH_CSS__', JSON.stringify(read('client/splash.css')))
    .replace('__LDC_LOGO_DATA_URI__', 'data:image/png;base64,' + read('logo-256.png.b64').trim());
}
