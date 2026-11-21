// Every animation that is in view plays. Anything off screen, hidden or paused shows its still.
const toggle = document.querySelector('.motion-toggle');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const heroImage = document.querySelector('.hero-art .animated-art');
const rails = document.querySelector('.rails');
const workflowImages = document.querySelectorAll('.how-visual img');
const visibleWorkflow = new Set();
const candidates = [...document.querySelectorAll('.animated-art')];
let paused = reduce.matches;
let scheduled = false;
let heroReady = false;

// Let the poster paint before starting the heavier SVG request.
heroImage.decode().catch(() => {}).then(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    heroReady = true;
    scheduleMotion();
  }));
});

const pendingImages = new WeakMap();
function showAnimation(image, source) {
  if (image.getAttribute('src') === source || pendingImages.get(image)?.source === source) return;
  const preview = new Image();
  preview.fetchPriority = 'low';
  const request = { source, preview };
  pendingImages.set(image, request);
  preview.src = source;
  preview.decode().then(() => {
    if (pendingImages.get(image) === request) image.src = source;
  }).catch(() => {});
}

function showPoster(image, source) {
  pendingImages.delete(image);
  if (image.getAttribute('src') !== source) image.src = source;
}

function scheduleMotion() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    updateMotion();
  });
}

function updateMotion() {
  const drawerOpen = !drawer.hidden;
  const galleryRect = rails.getBoundingClientRect();
  const motionEnabled = !paused && !document.hidden;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const inView = rect.width > 0 && rect.bottom > -80 && rect.top < innerHeight + 80 && !el.closest('[hidden]');
    const active = motionEnabled && !drawerOpen && inView && (el !== heroImage || heroReady);
    if (active) showAnimation(el, el.dataset.animation);
    else showPoster(el, el.dataset.still);
  }
  for (const image of workflowImages) {
    if (motionEnabled && !drawerOpen && visibleWorkflow.has(image)) showAnimation(image, image.dataset.animation);
    else showPoster(image, image.dataset.still);
  }
  if (drawerOpen && lastTile) {
    const { player, src, still } = lastTile.dataset;
    const play3D = Boolean(player && motionEnabled);
    if (play3D) {
      if (drawerPlayer.getAttribute('src') !== player) drawerPlayer.src = player;
    } else {
      resetDrawerPlayer();
    }
    if (motionEnabled && !player) showAnimation(drawerImg, src);
    else showPoster(drawerImg, still);
  }
  updateGalleryMotion(motionEnabled);
  document.documentElement.classList.toggle('motion-paused', paused);
  rails.classList.toggle('is-in-view', !document.hidden && galleryRect.bottom > 0 && galleryRect.top < innerHeight);
  toggle.querySelector('.ico').className = 'ico ' + (paused ? 'i-play' : 'i-pause');
  toggle.setAttribute('aria-label', paused ? 'Play all animations' : 'Pause all animations');
  toggle.setAttribute('aria-pressed', String(paused));
}
document.addEventListener('visibilitychange', updateMotion);
toggle.hidden = false;
toggle.addEventListener('click', () => { paused = !paused; updateMotion(); });
reduce.addEventListener('change', event => { paused = event.matches; updateMotion(); });
for (const event of ['scroll', 'resize', 'load']) addEventListener(event, scheduleMotion, { passive: true });

// Copy buttons
document.querySelectorAll('.copy').forEach(button => {
  button.hidden = false;
  const idle = button.getAttribute('aria-label');
  const icon = button.querySelector('.ico');
  let reset;
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.target);
    const status = document.querySelector('#copy-status');
    const label = button.querySelector('.copy-label');
    try {
      await navigator.clipboard.writeText(code.textContent);
      label.textContent = 'Copied';
      icon.classList.replace('i-copy', 'i-check');
      button.setAttribute('aria-label', 'Command copied');
      status.textContent = 'Command copied to clipboard.';
      clearTimeout(reset);
      reset = setTimeout(() => {
        label.textContent = 'Copy';
        icon.classList.replace('i-check', 'i-copy');
        button.setAttribute('aria-label', idle);
      }, 2200);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges(); selection.addRange(range);
      status.textContent = 'Select and copy the highlighted command.';
    }
  });
});

// Gallery drawer: a tile opens a bottom sheet with the full animation and the prompt that made it.
const drawer = document.querySelector('#drawer');
const sheet = drawer.querySelector('.drawer-sheet');
const drawerImg = document.querySelector('#drawer-img');
const drawerPlayer = document.querySelector('#drawer-player');
let lastTile = null;
function resetDrawerPlayer() {
  drawerPlayer.classList.remove('is-loaded');
  drawerPlayer.hidden = true;
  drawerPlayer.removeAttribute('src');
}
drawerPlayer.addEventListener('load', () => {
  if (!drawerPlayer.hasAttribute('src') || drawerPlayer.contentWindow.location.href === 'about:blank') return;
  drawerPlayer.hidden = false;
  requestAnimationFrame(() => {
    if (!drawerPlayer.hidden) drawerPlayer.classList.add('is-loaded');
  });
});
function openDrawer(tile) {
  lastTile = tile.closest('.rail-copy')
    ? [...tile.closest('.rail-track').children].find(item => item.dataset.src === tile.dataset.src)
    : tile;
  const { title, prompt, src, still, player } = tile.dataset;
  showPoster(drawerImg, still);
  drawerImg.alt = title + ' animation';
  drawerPlayer.title = title + ' animation';
  document.querySelector('#drawer-title').textContent = title;
  document.querySelector('#drawer-prompt').textContent = prompt;
  document.querySelector('#drawer-copy-label').textContent = 'Copy prompt';
  const action = document.querySelector('#drawer-download');
  action.href = player ?? src;
  action.textContent = player ? 'Play 3D' : 'Download SVG';
  action.toggleAttribute('download', !player);
  drawer.hidden = false;
  updateMotion();
  document.body.classList.add('drawer-open');
  for (const section of document.querySelectorAll('body > header, body > main, body > footer')) section.inert = true;
  requestAnimationFrame(() => { drawer.classList.add('open'); sheet.focus({ preventScroll: true }); });
}
function closeDrawer() {
  if (drawer.hidden) return;
  drawer.classList.remove('open');
  document.body.classList.remove('drawer-open');
  const done = () => {
    drawer.hidden = true;
    pendingImages.delete(drawerImg);
    drawerImg.removeAttribute('src');
    resetDrawerPlayer();
    for (const section of document.querySelectorAll('body > header, body > main, body > footer')) section.inert = false;
    lastTile?.focus({ preventScroll: true });
    updateMotion();
  };
  if (reduce.matches) done(); else setTimeout(done, 200);
}
const railTracks = [...rails.querySelectorAll('.rail-track')];
for (const track of railTracks) {
  const copy = document.createElement('div');
  copy.className = 'rail-copy';
  copy.setAttribute('aria-hidden', 'true');
  for (const tile of track.children) {
    const clone = tile.cloneNode(true);
    clone.tabIndex = -1;
    copy.append(clone);
  }
  track.append(copy);
  track.addEventListener('click', event => {
    const tile = event.target.closest('.gtile');
    if (tile) openDrawer(tile);
  });
}
rails.classList.add('is-ready');
if ('ResizeObserver' in window) {
  const railSpeed = 14.6; // CSS pixels per second in either direction.
  const trackSize = new ResizeObserver(entries => {
    for (const { target: track } of entries) {
      const first = track.firstElementChild;
      const firstCopy = track.querySelector('.rail-copy .gtile');
      if (!firstCopy.getClientRects().length) continue;
      const distance = firstCopy.getBoundingClientRect().left - first.getBoundingClientRect().left;
      track.style.setProperty('--rail-duration', `${distance / railSpeed}s`);
    }
  });
  railTracks.forEach(track => trackSize.observe(track));
}
const galleryTiles = [...rails.querySelectorAll('.gtile')];
const visibleTiles = new Set();
let playingTiles = new Set();

function updateGalleryMotion(active) {
  const next = active ? visibleTiles : new Set();
  for (const tile of playingTiles) {
    if (!next.has(tile)) showPoster(tile.querySelector('.rail-poster'), tile.dataset.still);
  }
  for (const tile of visibleTiles) {
    const image = tile.querySelector('.rail-poster');
    if (!image.hasAttribute('src')) showPoster(image, tile.dataset.still);
    if (active && !playingTiles.has(tile)) showAnimation(image, tile.dataset.src);
  }
  playingTiles = new Set(next);
}

if ('IntersectionObserver' in window) {
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const tile = entry.target;
      if (entry.isIntersecting) visibleTiles.add(tile);
      else visibleTiles.delete(tile);
    }
    scheduleMotion();
  });
  const nearby = new IntersectionObserver(entries => {
    for (const { target: tile, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      nearby.unobserve(tile);
      const image = tile.querySelector('.rail-poster');
      if (!image.hasAttribute('src')) showPoster(image, tile.dataset.still);
    }
  }, { rootMargin: '240px 0px' });
  galleryTiles.forEach(tile => {
    nearby.observe(tile);
    visibility.observe(tile);
  });
} else {
  galleryTiles.forEach(tile => visibleTiles.add(tile));
}
drawer.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDrawer(); });
document.addEventListener('keydown', e => {
  if (drawer.hidden) return;
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Tab') {
    const items = [...sheet.querySelectorAll('button, a[href], iframe:not([hidden])')];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
document.querySelector('#drawer-copy').addEventListener('click', async () => {
  const label = document.querySelector('#drawer-copy-label');
  const text = document.querySelector('#drawer-prompt').textContent;
  try { await navigator.clipboard.writeText(text); label.textContent = 'Copied'; document.querySelector('#drawer-status').textContent = 'Prompt copied to clipboard.'; }
  catch { const range = document.createRange(); range.selectNodeContents(document.querySelector('#drawer-prompt')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); label.textContent = 'Select and copy'; }
  setTimeout(() => { label.textContent = 'Copy prompt'; }, 2200);
});

// Promote workflow posters to animated SVGs only while their cards are in view.
if ('IntersectionObserver' in window) {
  const workflowMotion = new IntersectionObserver(entries => {
    for (const { target, intersectionRatio } of entries) {
      if (intersectionRatio >= 0.25) visibleWorkflow.add(target);
      else visibleWorkflow.delete(target);
    }
    scheduleMotion();
  }, { threshold: 0.25 });
  workflowImages.forEach(image => workflowMotion.observe(image));
}

// Keep the final figures in the HTML and animate only the visual copies.
if ('IntersectionObserver' in window) {
  const proofObserver = new IntersectionObserver(entries => {
    for (const { target: card, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      proofObserver.unobserve(card);
      if (paused || reduce.matches) continue;
      card.classList.add('is-revealed');
      const count = card.querySelector('[data-proof-count]');
      if (!count) continue;
      const final = count.textContent;
      const decimals = final.split('.')[1]?.length ?? 0;
      const start = performance.now();
      function tick(now) {
        const progress = Math.min(1, (now - start) / 800);
        if (progress === 1 || paused || reduce.matches) {
          count.textContent = final;
          return;
        }
        count.textContent = (Number(final) * (1 - (1 - progress) ** 3)).toFixed(decimals);
        requestAnimationFrame(tick);
      }
      count.textContent = '0';
      requestAnimationFrame(tick);
    }
  });
  document.querySelectorAll('[data-proof-reveal]').forEach(card => proofObserver.observe(card));
}

document.querySelectorAll('[data-pills]').forEach(group => {
  const tablist = group.querySelector('[role=tablist]');
  const tabs = [...tablist.querySelectorAll('[role=tab]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  function select(index, focus) {
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[i].hidden = !active;
      panels[i].inert = !active;
      panels[i].tabIndex = active ? 0 : -1;
    });
    if (focus) {
      const tab = tabs[index];
      tab.focus({ preventScroll: true });
      tablist.scrollLeft += tab.getBoundingClientRect().left - tablist.getBoundingClientRect().left - 8;
    }
    scheduleMotion();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', event => {
      const targets = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: tabs.length - 1 };
      if (!Object.hasOwn(targets, event.key)) return;
      event.preventDefault();
      select((targets[event.key] + tabs.length) % tabs.length, true);
    });
  });
  select(0);
  tablist.hidden = false;
  group.classList.add('tabs-ready');
});

// Hero play: the art leans toward the pointer, wiggles on hover, and hops with a burst of flowers and leaves on click.
(() => {
  const stage = document.querySelector('.hero-stage');
  const art = stage && stage.querySelector('.animated-art');
  const burst = stage && stage.querySelector('.hero-burst');
  if (!stage || !art || !burst) return;
  let bursting = false;
  const calm = () => paused || reduce.matches;
  stage.addEventListener('pointermove', event => {
    if (calm() || event.pointerType === 'touch') return;
    const rect = stage.getBoundingClientRect();
    const dx = (event.clientX - rect.left) / rect.width - 0.5;
    const dy = (event.clientY - rect.top) / rect.height - 0.5;
    stage.style.setProperty('--tx', `${(dx * 14).toFixed(1)}px`);
    stage.style.setProperty('--ty', `${(dy * 8).toFixed(1)}px`);
    stage.style.setProperty('--tr', `${(dx * 1.2).toFixed(2)}deg`);
  });
  stage.addEventListener('pointerleave', () => {
    for (const name of ['--tx', '--ty', '--tr']) stage.style.removeProperty(name);
  });
  stage.addEventListener('pointerenter', event => {
    if (calm() || event.pointerType === 'touch' || art.classList.contains('is-hopping')) return;
    art.classList.add('is-wiggling');
  });
  art.addEventListener('animationend', () => art.classList.remove('is-wiggling', 'is-hopping'));
  stage.addEventListener('click', () => {
    if (calm() || bursting) return;
    bursting = true;
    art.classList.remove('is-wiggling', 'is-hopping');
    void art.offsetWidth;
    art.classList.add('is-hopping');
    burst.src = `${burst.dataset.burst}?t=${Date.now()}`;
    burst.hidden = false;
    setTimeout(() => {
      burst.hidden = true;
      burst.removeAttribute('src');
      bursting = false;
    }, 1400);
  });
})();

updateMotion();
