import { mountIdgafCardEditor, normalizeIdgafCard } from './card.mjs';
const status = document.getElementById('connection');
let draft; try { const query = new URLSearchParams(location.hash.slice(1)); draft = query.has('card') ? normalizeIdgafCard(JSON.parse(query.get('card'))) : JSON.parse(sessionStorage.getItem('idgaf_draft') || 'null'); history.replaceState(null, '', location.pathname); } catch { draft = null; }
let me; try { const response = await fetch('/v1/me'); me = response.ok ? await response.json() : null; } catch { status.textContent = 'Bağlantı kurulamadı. Taslağın bu tarayıcıda kalır.'; }
status.textContent = me ? 'Discord kimliğin doğrulandı. Kartını yayınlamak için Kaydet düğmesine bas.' : 'Kartını yayınlamak için Discord ile giriş yap.';
document.getElementById('login').hidden = !!me; document.getElementById('logout').hidden = !me; document.getElementById('delete').hidden = !me?.card;
const editor = mountIdgafCardEditor(document.getElementById('editor'), { value: draft || me?.card || { name: me?.name || 'idgafcord' }, save: async card => {
  sessionStorage.setItem('idgaf_draft', JSON.stringify(card)); if (!me) { status.textContent = 'Taslağın saklandı. Yayınlamak için önce Discord ile giriş yap.'; throw Error('Sign in first'); }
  const response = await fetch('/v1/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
  if (!response.ok) throw Error('Could not publish'); status.textContent = 'Kartın yayınlandı. idgafcord kullanıcıları profilinde görebilir.'; document.getElementById('delete').hidden = false;
} });
document.getElementById('editor').addEventListener('input', () => sessionStorage.setItem('idgaf_draft', JSON.stringify(editor.value())));
sessionStorage.setItem('idgaf_draft', JSON.stringify(editor.value()));
document.getElementById('logout').onclick = async () => { const response = await fetch('/auth/logout', { method: 'POST' }); if (response.ok) location.reload(); };
document.getElementById('delete').onclick = async () => { const response = await fetch('/v1/me', { method: 'DELETE' }); if (response.ok) { status.textContent = 'Kartın yayından kaldırıldı.'; document.getElementById('delete').hidden = true; } else status.textContent = 'Kart kaldırılamadı. Tekrar dene.'; };
