(() => {
  'use strict';
  const canvas = document.getElementById('canvas');
  const shell = document.getElementById('canvasShell');
  const ctx = canvas.getContext('2d', { alpha: false });
  const imageCanvas = document.createElement('canvas');
  const imageCtx = imageCanvas.getContext('2d');
  const elements = Object.fromEntries([
    'onlineCount','coords','toast','palette','selectedHex','paintMode','panMode','cooldownText','cooldownRing',
    'playerName','saveName','dailyScore','totalScore','rankList','refreshRanks','proxyTitle','proxyDetail','checkProxy',
    'soundButton','zoomIn','zoomOut','fitCanvas','mobileRank',
  ].map((id) => [id, document.getElementById(id)]));
  const state = {
    width: 256, height: 256, empty: 255, palette: [], pixels: new Uint8Array(256 * 256),
    selected: 6, mode: 'paint', scale: 2, x: 0, y: 0, dragging: false, moved: false,
    pointerX: 0, pointerY: 0, cooldownUntil: 0, cooldownMs: 900, playerId: '',
    sound: localStorage.getItem('pixmap_sound') !== 'off',
  };
  const pointers = new Map();
  let toastTimer;
  let pinchDistance = 0;
  let pinchScale = 1;

  function beep(frequency = 540, duration = .035) {
    if (!state.sound) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audio = beep.audio || (beep.audio = new AudioContext());
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'square'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.025, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration);
      oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
    } catch {}
  }

  function toast(message, error = false) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `status-toast show${error ? ' error' : ''}`;
    toastTimer = setTimeout(() => { elements.toast.className = 'status-toast'; }, 2200);
  }

  async function api(url, options) {
    const response = await fetch(url, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options && options.headers) },
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'İşlem başarısız.'), { data, status: response.status });
    return data;
  }

  function decodePixels(encoded) {
    const raw = atob(encoded);
    const result = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) result[i] = raw.charCodeAt(i);
    return result;
  }

  function updateImage() {
    imageCanvas.width = state.width; imageCanvas.height = state.height;
    const image = imageCtx.createImageData(state.width, state.height);
    for (let index = 0; index < state.pixels.length; index += 1) {
      const colorIndex = state.pixels[index];
      const at = index * 4;
      if (colorIndex === state.empty) {
        const x = index % state.width; const y = Math.floor(index / state.width);
        const shade = ((x >> 3) + (y >> 3)) % 2 ? 18 : 22;
        image.data[at] = shade; image.data[at + 1] = shade + 5; image.data[at + 2] = shade + 12;
      } else {
        const hex = state.palette[colorIndex].slice(1);
        image.data[at] = parseInt(hex.slice(0, 2), 16);
        image.data[at + 1] = parseInt(hex.slice(2, 4), 16);
        image.data[at + 2] = parseInt(hex.slice(4, 6), 16);
      }
      image.data[at + 3] = 255;
    }
    imageCtx.putImageData(image, 0, 0);
    draw();
  }

  function resize() {
    const rect = shell.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const oldWidth = canvas.width; const oldHeight = canvas.height;
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    state.dpr = dpr;
    if (!oldWidth || !oldHeight) fit(); else draw();
  }

  function fit() {
    const rect = shell.getBoundingClientRect();
    state.scale = Math.min((rect.width - 20) / state.width, (rect.height - 20) / state.height);
    state.x = (rect.width - state.width * state.scale) / 2;
    state.y = (rect.height - state.height * state.scale) / 2;
    draw();
  }

  function draw() {
    if (!state.dpr) return;
    const w = canvas.width / state.dpr; const h = canvas.height / state.dpr;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.fillStyle = '#0b1019'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.save(); ctx.translate(state.x, state.y); ctx.scale(state.scale, state.scale);
    ctx.drawImage(imageCanvas, 0, 0);
    if (state.scale >= 10) {
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1 / state.scale;
      ctx.beginPath();
      for (let x = 0; x <= state.width; x += 1) { ctx.moveTo(x, 0); ctx.lineTo(x, state.height); }
      for (let y = 0; y <= state.height; y += 1) { ctx.moveTo(0, y); ctx.lineTo(state.width, y); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function zoom(factor, screenX, screenY) {
    const rect = shell.getBoundingClientRect();
    const sx = screenX ?? rect.width / 2; const sy = screenY ?? rect.height / 2;
    const beforeX = (sx - state.x) / state.scale; const beforeY = (sy - state.y) / state.scale;
    state.scale = Math.max(.8, Math.min(40, state.scale * factor));
    state.x = sx - beforeX * state.scale; state.y = sy - beforeY * state.scale;
    draw();
  }

  function coordsAt(clientX, clientY) {
    const rect = shell.getBoundingClientRect();
    return {
      x: Math.floor((clientX - rect.left - state.x) / state.scale),
      y: Math.floor((clientY - rect.top - state.y) / state.scale),
    };
  }

  function setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return;
    state.pixels[y * state.width + x] = color;
    imageCtx.fillStyle = state.palette[color]; imageCtx.fillRect(x, y, 1, 1); draw();
  }

  async function place(x, y) {
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return toast('Tuvalin dışına piksel basamazsın.', true);
    const remaining = state.cooldownUntil - Date.now();
    if (remaining > 0) return toast(`${Math.ceil(remaining / 100) / 10} sn bekle.`, true);
    state.cooldownUntil = Date.now() + state.cooldownMs;
    updateCooldown();
    try {
      const data = await api('/api/place', { method: 'POST', body: JSON.stringify({ x, y, color: state.selected, name: elements.playerName.value }) });
      setPixel(x, y, state.selected); updatePlayer(data.player); renderRanks(data.ranks); beep(700, .045);
    } catch (error) {
      if (error.data && error.data.retryAfter) state.cooldownUntil = Date.now() + error.data.retryAfter;
      else state.cooldownUntil = 0;
      toast(error.message, true); beep(180, .08);
    }
  }

  function updateCooldown() {
    const left = Math.max(0, state.cooldownUntil - Date.now());
    const box = elements.cooldownRing.parentElement;
    box.classList.toggle('running', left > 0);
    elements.cooldownText.textContent = left > 0 ? `${Math.ceil(left / 100) / 10} sn` : 'Hazır';
    if (left > 0) requestAnimationFrame(updateCooldown);
  }

  function updatePlayer(player) {
    if (!player) return;
    elements.dailyScore.textContent = Number(player.daily || 0).toLocaleString('tr-TR');
    elements.totalScore.textContent = Number(player.total || 0).toLocaleString('tr-TR');
  }

  function renderRanks(list) {
    if (!list || !list.length) { elements.rankList.innerHTML = '<div class="empty-state">İlk pikseli sen bırak.</div>'; return; }
    elements.rankList.textContent = '';
    list.forEach((player, index) => {
      const row = document.createElement('div'); row.className = `rank-row${player.id === state.playerId ? ' me' : ''}`;
      const position = document.createElement('span'); position.className = 'position'; position.textContent = `#${index + 1}`;
      const name = document.createElement('span'); name.className = 'rank-name'; name.textContent = player.name;
      const score = document.createElement('span'); score.className = 'rank-score';
      const strong = document.createElement('b'); strong.textContent = Number(player.daily).toLocaleString('tr-TR');
      const small = document.createElement('small'); small.textContent = `${Number(player.total).toLocaleString('tr-TR')} toplam`;
      score.append(strong, small); row.append(position, name, score); elements.rankList.append(row);
    });
  }

  function renderPalette() {
    elements.palette.textContent = '';
    state.palette.forEach((color, index) => {
      const button = document.createElement('button'); button.className = `swatch${index === state.selected ? ' active' : ''}`;
      button.style.setProperty('--color', color); button.type = 'button'; button.role = 'radio';
      button.setAttribute('aria-label', color); button.setAttribute('aria-checked', index === state.selected ? 'true' : 'false');
      button.addEventListener('click', () => {
        state.selected = index; elements.selectedHex.textContent = color.toUpperCase(); renderPalette(); beep(480 + index * 8);
      });
      elements.palette.append(button);
    });
  }

  function setMode(mode) {
    state.mode = mode; shell.classList.toggle('pan', mode === 'pan');
    elements.paintMode.classList.toggle('active', mode === 'paint'); elements.panMode.classList.toggle('active', mode === 'pan');
    document.querySelectorAll('[data-mobile-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mobileMode === mode));
    beep(420);
  }

  async function proxyCheck() {
    elements.proxyTitle.textContent = 'Kontrol ediliyor…'; elements.proxyDetail.textContent = 'Bağlantı analiz ediliyor';
    try {
      const data = await api('/api/proxy');
      const card = elements.proxyTitle.closest('.security-card'); card.classList.toggle('danger', data.blocked);
      elements.proxyTitle.textContent = data.checked ? (data.blocked ? 'Proxy/VPN algılandı' : 'Bağlantı temiz') : 'Kontrol servisi beklemede';
      elements.proxyDetail.textContent = data.checked ? `${data.source} • risk ${data.risk}%${data.blockingEnabled ? ' • engelleme açık' : ''}` : 'Piksel basma açık; kontrol sonra yenilenebilir';
    } catch { elements.proxyTitle.textContent = 'Kontrol yapılamadı'; elements.proxyDetail.textContent = 'Daha sonra tekrar deneyin'; }
  }

  function connectEvents() {
    const events = new EventSource('/api/events');
    events.addEventListener('pixel', (event) => { const data = JSON.parse(event.data); setPixel(data.x, data.y, data.color); });
    events.addEventListener('ranks', (event) => renderRanks(JSON.parse(event.data).ranks));
    events.addEventListener('online', (event) => { elements.onlineCount.textContent = JSON.parse(event.data).online; });
  }

  shell.addEventListener('pointerdown', (event) => {
    shell.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.dragging = true; state.moved = false; state.pointerX = event.clientX; state.pointerY = event.clientY;
    shell.classList.add('dragging');
    if (pointers.size === 2) {
      const values = [...pointers.values()]; pinchDistance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y); pinchScale = state.scale;
    }
  });
  shell.addEventListener('pointermove', (event) => {
    const point = coordsAt(event.clientX, event.clientY);
    elements.coords.textContent = `X: ${point.x}   Y: ${point.y}`;
    if (!state.dragging) return;
    const previous = pointers.get(event.pointerId) || { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const values = [...pointers.values()]; const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      const rect = shell.getBoundingClientRect(); const centerX = (values[0].x + values[1].x) / 2 - rect.left; const centerY = (values[0].y + values[1].y) / 2 - rect.top;
      const target = pinchScale * distance / Math.max(1, pinchDistance); zoom(target / state.scale, centerX, centerY); state.moved = true;
    } else if (state.mode === 'pan' || event.buttons === 2) {
      state.x += event.clientX - previous.x; state.y += event.clientY - previous.y; state.moved = true; draw();
    } else if (Math.hypot(event.clientX - state.pointerX, event.clientY - state.pointerY) > 8) state.moved = true;
  });
  shell.addEventListener('pointerup', (event) => {
    const shouldPlace = state.mode === 'paint' && !state.moved && pointers.size === 1;
    pointers.delete(event.pointerId); state.dragging = pointers.size > 0; shell.classList.toggle('dragging', state.dragging);
    if (shouldPlace) { const point = coordsAt(event.clientX, event.clientY); place(point.x, point.y); }
  });
  shell.addEventListener('pointercancel', (event) => { pointers.delete(event.pointerId); state.dragging = pointers.size > 0; shell.classList.remove('dragging'); });
  shell.addEventListener('contextmenu', (event) => event.preventDefault());
  shell.addEventListener('wheel', (event) => { event.preventDefault(); const rect = shell.getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });

  elements.paintMode.addEventListener('click', () => setMode('paint')); elements.panMode.addEventListener('click', () => setMode('pan'));
  document.querySelectorAll('[data-mobile-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mobileMode)));
  elements.zoomIn.addEventListener('click', () => zoom(1.35)); elements.zoomOut.addEventListener('click', () => zoom(1 / 1.35)); elements.fitCanvas.addEventListener('click', fit);
  elements.soundButton.addEventListener('click', () => { state.sound = !state.sound; localStorage.setItem('pixmap_sound', state.sound ? 'on' : 'off'); elements.soundButton.textContent = state.sound ? '♪' : '×'; beep(600); });
  elements.saveName.addEventListener('click', async () => {
    try { const data = await api('/api/player', { method: 'POST', body: JSON.stringify({ name: elements.playerName.value }) }); localStorage.setItem('pixmap_name', data.player.name); elements.playerName.value = data.player.name; toast('Oyuncu adı kaydedildi.'); beep(620); }
    catch (error) { toast(error.message, true); }
  });
  elements.playerName.addEventListener('keydown', (event) => { if (event.key === 'Enter') elements.saveName.click(); });
  elements.refreshRanks.addEventListener('click', async () => { const data = await api('/api/ranks'); renderRanks(data.ranks); beep(440); });
  elements.checkProxy.addEventListener('click', proxyCheck);
  elements.mobileRank.addEventListener('click', () => document.querySelector('.rank-card').scrollIntoView({ behavior: 'smooth' }));
  window.addEventListener('resize', resize);

  async function init() {
    state.pixels.fill(state.empty); elements.playerName.value = localStorage.getItem('pixmap_name') || '';
    const data = await api('/api/state');
    Object.assign(state, { width: data.width, height: data.height, empty: data.empty, palette: data.palette, pixels: decodePixels(data.pixels), cooldownMs: data.cooldownMs, playerId: data.selfId });
    imageCanvas.width = state.width; imageCanvas.height = state.height;
    updateImage(); renderPalette(); updatePlayer(data.player); renderRanks(data.ranks); elements.onlineCount.textContent = data.online + 1;
    elements.playerName.value = localStorage.getItem('pixmap_name') || data.player.name || '';
    resize(); connectEvents(); proxyCheck();
  }
  init().catch((error) => toast(`Başlatılamadı: ${error.message}`, true));
})();
