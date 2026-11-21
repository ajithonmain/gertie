const menu = document.querySelector('.menu-toggle');
menu.hidden = false;
menu.addEventListener('click', () => {
  menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') !== 'true'));
});
const nav = document.querySelector('#main-nav');
nav.addEventListener('click', event => {
  if (event.target.closest('a')) menu.setAttribute('aria-expanded', 'false');
});
menu.closest('header').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || menu.getAttribute('aria-expanded') !== 'true') return;
  menu.setAttribute('aria-expanded', 'false');
  menu.focus();
});

