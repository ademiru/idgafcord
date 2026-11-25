export const IDGAF_CARD_SKINS = ['aero-night', 'graphite', 'silver', 'amber'];
export function normalizeIdgafCard(value) {
  value = value && typeof value === 'object' ? value : {};
  const text = (key, size, fallback = '') => typeof value[key] === 'string' ? value[key].replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, size) : fallback;
  return {
    version: 1,
    name: text('name', 48, 'idgafcord'),
    headline: text('headline', 80),
    bio: text('bio', 320),
    skin: IDGAF_CARD_SKINS.includes(value.skin) ? value.skin : 'aero-night',
    accent: /^#[a-f\d]{6}$/i.test(value.accent) ? value.accent.toLowerCase() : '#68bfd5',
    font: ['segoe', 'tahoma', 'trebuchet', 'mono'].includes(value.font) ? value.font : 'segoe',
    radius: Number.isInteger(value.radius) ? Math.max(2, Math.min(18, value.radius)) : 8,
    client: ['idgafcord', 'Vencord', 'Vesktop', 'Equicord', 'other'].includes(value.client) ? value.client : 'idgafcord'
  };
}
export function renderIdgafCard(document, value, published = false, english = false) {
  const card = normalizeIdgafCard(value);
  const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  const root = node('article', 'idgaf-user-card'); root.dataset.skin = card.skin; root.dataset.font = card.font;
  root.style.setProperty('--card-accent', card.accent); root.style.setProperty('--card-radius', card.radius + 'px');
  const chrome = node('header', 'idgaf-card-chrome'); chrome.append(node('span', '', 'idgafcord'), node('span', '', english ? 'User card' : 'Kullanıcı kartı'));
  const main = node('div', 'idgaf-card-identity'); const avatar = node('div', 'idgaf-card-monogram', Array.from(card.name || 'i').slice(0, 2).join('').toLocaleUpperCase()); avatar.setAttribute('aria-hidden', 'true');
  const identity = node('div'); identity.append(node('h3', '', card.name || 'idgafcord'), node('p', 'idgaf-card-headline', card.headline)); main.append(avatar, identity);
  const bio = node('p', 'idgaf-card-bio', card.bio || (english ? 'Your own corner of idgafcord.' : 'idgafcord’da sana ait bir köşe.'));
  const footer = node('footer', 'idgaf-card-footer'); const client = node('span', 'idgaf-card-client', card.client === 'other' ? (english ? 'Other client' : 'Diğer istemci') : card.client);
  client.title = english ? 'Client selected by the profile owner. This does not detect their running app.' : 'Profil sahibinin seçtiği istemci. Çalışan uygulama otomatik algılanmaz.';
  footer.append(client, node('span', '', published ? (english ? 'Ecosystem profile' : 'Ekosistem profili') : (english ? 'Local draft' : 'Yerel taslak')));
  root.append(chrome, main, bio, footer); return root;
}
export function mountIdgafCardEditor(host, { value, save, english = false }) {
  const document = host.ownerDocument; let draft = normalizeIdgafCard(value);
  const text = (tr, en) => english ? en : tr;
  host.classList.add('idgaf-card-editor');
  const preview = document.createElement('div'); preview.className = 'idgaf-card-preview'; host.append(preview);
  const fields = document.createElement('div'); fields.className = 'idgaf-card-fields'; host.append(fields);
  const controls = {};
  function update() { for (const [key, input] of Object.entries(controls)) draft[key] = key === 'radius' ? Number(input.value) : input.value; draft = normalizeIdgafCard(draft); preview.replaceChildren(renderIdgafCard(document, draft, false, english)); }
  function field(key, title, type, items) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    if (type === 'select') items.forEach(([value, title]) => { const option = document.createElement('option'); option.value = value; option.textContent = title; input.append(option); });
    else if (type !== 'textarea') input.type = type;
    if (key === 'radius') { input.min = 2; input.max = 18; }
    if (['name', 'headline', 'bio'].includes(key)) input.maxLength = { name: 48, headline: 80, bio: 320 }[key];
    input.setAttribute('aria-label', title); input.value = draft[key]; input.addEventListener('input', update); label.append(input); fields.append(label); controls[key] = input;
  }
  field('skin', text('Kaplama', 'Skin'), 'select', [['aero-night', 'Aero Night'], ['graphite', 'Graphite'], ['silver', 'Silver'], ['amber', 'Amber LCD']]);
  field('name', text('Görünen ad', 'Display name'), 'text'); field('headline', text('Kısa açıklama', 'Headline'), 'text'); field('bio', text('Hakkımda', 'About me'), 'textarea');
  field('accent', text('Vurgu rengi', 'Accent color'), 'color');
  field('font', text('Yazı karakteri', 'Typeface'), 'select', [['segoe', 'Segoe UI'], ['tahoma', 'Tahoma'], ['trebuchet', 'Trebuchet MS'], ['mono', 'Consolas']]);
  field('radius', text('Köşe yumuşaklığı', 'Corner radius'), 'range');
  field('client', text('İstemcim · kendi beyanım', 'My client · self-reported'), 'select', ['idgafcord', 'Vencord', 'Vesktop', 'Equicord', 'other'].map(client => [client, client]));
  const footer = document.createElement('div'); footer.className = 'idgaf-card-actions';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = text('Kartı kaydet', 'Save card');
  const status = document.createElement('span'); status.setAttribute('role', 'status');
  button.onclick = async () => { button.disabled = true; try { await save(normalizeIdgafCard(draft)); status.textContent = text('Kaydedildi', 'Saved'); } catch { status.textContent = text('Kaydedilemedi', 'Could not save'); } finally { button.disabled = false; } };
  footer.append(button, status); host.append(footer); update();
  return { value: () => normalizeIdgafCard(draft), set(value) { draft = normalizeIdgafCard(value); Object.entries(controls).forEach(([key, input]) => { input.value = draft[key]; }); update(); } };
}
