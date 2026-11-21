const grid = document.querySelector('.gallery-grid');
const cards = [...grid.querySelectorAll('.gallery-card')];
const tools = document.querySelector('.gallery-tools');
const filters = [...tools.querySelectorAll('[data-format]')];
const search = tools.querySelector('input');
const motion = tools.querySelector('.gallery-motion');
const empty = document.querySelector('.gallery-empty');
const status = document.querySelector('#gallery-status');
const dialog = document.querySelector('.gallery-dialog');
const artwork = dialog.querySelector('.gallery-detail-art');
const image = artwork.querySelector('img');
const player = artwork.querySelector('iframe');
const title = dialog.querySelector('h2');
const prompt = dialog.querySelector('.gallery-prompt');
const copy = dialog.querySelector('[data-copy]');
const primary = dialog.querySelector('[data-primary]');
const feedback = dialog.querySelector('#preview-status');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let selected;
let detailRequest = 0;
let format = 'all';
let paused = reduceMotion.matches;
const visibleCards = new Set();
const playingCards = new Map();

function syncCardMotion() {
  const enabled = !paused && !document.hidden && !dialog.open;
  for (const [card, { poster, frame }] of playingCards) {
    if (enabled && visibleCards.has(card) && !card.parentElement.hidden) continue;
    card.querySelector('img').src = poster;
    frame?.remove();
    playingCards.delete(card);
  }
  if (!enabled) return;
  for (const card of visibleCards) {
    if (card.parentElement.hidden || playingCards.has(card)) continue;
    const art = card.querySelector('.gallery-card-art');
    const preview = art.querySelector('img');
    const state = { poster: preview.src };
    playingCards.set(card, state);
    if (card.dataset.format === 'three') {
      const frame = document.createElement('iframe');
      state.frame = frame;
      frame.title = 'Decorative 3D animation';
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      frame.src = card.href;
      frame.hidden = true;
      frame.addEventListener('load', () => {
        if (playingCards.get(card) === state && frame.contentWindow.location.href !== 'about:blank') frame.hidden = false;
      });
      art.append(frame);
    } else {
      const animation = new Image();
      animation.fetchPriority = 'low';
      animation.src = card.href;
      animation.decode().then(() => {
        if (playingCards.get(card) === state) preview.src = animation.src;
      }).catch(() => {});
    }
  }
}

function syncMotionToggle() {
  motion.textContent = paused ? 'Play animations' : 'Pause animations';
  motion.setAttribute('aria-pressed', String(paused));
  syncCardMotion();
  updatePreview();
}

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) visibleCards.add(target);
      else visibleCards.delete(target);
    }
    syncCardMotion();
  }, { threshold: 0.15 });
  cards.forEach(card => observer.observe(card));
} else {
  motion.hidden = true;
}
motion.addEventListener('click', () => { paused = !paused; syncMotionToggle(); });
document.addEventListener('visibilitychange', syncCardMotion);

function filterGallery() {
  const term = search.value.trim().toLowerCase();
  let count = 0;
  for (const card of cards) {
    const matches = (format === 'all' || card.dataset.format === format) &&
      card.textContent.trim().toLowerCase().includes(term);
    card.parentElement.hidden = !matches;
    if (matches) count++;
  }
  for (const filter of filters) filter.setAttribute('aria-pressed', String(filter.dataset.format === format));
  empty.hidden = count !== 0;
  syncCardMotion();
  status.textContent = `${count} ${count === 1 ? 'animation' : 'animations'}`;
}

for (const filter of filters) filter.addEventListener('click', () => {
  format = filter.dataset.format;
  filterGallery();
});
search.addEventListener('input', filterGallery);
tools.hidden = false;
syncMotionToggle();

function updatePreview() {
  if (!selected) return;
  const request = ++detailRequest;
  const three = selected.dataset.format === 'three';
  const poster = selected.querySelector('img').src;
  artwork.style.setProperty('--card-bg', selected.style.getPropertyValue('--card-bg'));
  if (image.src !== poster) image.src = poster;
  if (!three && !paused) {
    const animation = new Image();
    animation.src = selected.href;
    animation.decode().then(() => {
      if (dialog.open && request === detailRequest) image.src = animation.src;
    }).catch(() => {});
  }
  if (three && !paused) {
    player.title = `${title.textContent} 3D preview`;
    if (player.src !== selected.href) player.src = selected.href;
  } else {
    player.hidden = true;
    player.removeAttribute('src');
  }
}

player.addEventListener('load', () => {
  if (dialog.open && player.hasAttribute('src') && player.contentWindow.location.href !== 'about:blank') {
    player.hidden = false;
  }
});
reduceMotion.addEventListener('change', event => { paused = event.matches; syncMotionToggle(); });

grid.addEventListener('click', event => {
  const card = event.target.closest('.gallery-card');
  if (!card || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  selected = card;
  title.textContent = card.querySelector('.gallery-card-name').textContent;
  prompt.textContent = card.dataset.prompt ?? '';
  prompt.hidden = copy.hidden = !prompt.textContent;
  copy.textContent = 'Copy prompt';
  feedback.textContent = '';
  const three = card.dataset.format === 'three';
  primary.href = card.href;
  primary.textContent = three ? 'Open player' : 'Download SVG';
  primary.toggleAttribute('download', !three);
  for (const link of dialog.querySelectorAll('[data-source], [data-lottie]')) {
    const url = card.dataset[link.hasAttribute('data-source') ? 'source' : 'lottie'];
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute('href');
  }
  dialog.showModal();
  syncCardMotion();
  updatePreview();
});

dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  detailRequest++;
  image.removeAttribute('src');
  player.hidden = true;
  player.removeAttribute('src');
  selected?.focus({ preventScroll: true });
  selected = undefined;
  syncCardMotion();
});

copy.addEventListener('click', async () => {
  const card = selected;
  try {
    await navigator.clipboard.writeText(prompt.textContent);
    if (selected === card) {
      copy.textContent = 'Copied';
      feedback.textContent = 'Prompt copied.';
    }
  } catch {
    if (selected !== card) return;
    const range = document.createRange();
    range.selectNodeContents(prompt);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    feedback.textContent = 'Select and copy the highlighted prompt.';
  }
});
