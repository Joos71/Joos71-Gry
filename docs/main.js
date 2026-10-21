(function () {
  'use strict';
  const source = window.JOOS71_CATALOG;
  const el = id => document.getElementById(id);
  const fmt = n => new Intl.NumberFormat('pl-PL').format(n);
  const compare = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });
  const time = m => m > 0 ? fmt(Math.floor(m / 60)) + ' godz.' + (m % 60 ? ' ' + m % 60 + ' min' : '') : '0 min';
  const sorterLabels = {
    'time-desc': 'CZAS GRY ↓ NAJWIĘCEJ',
    'time-asc': 'CZAS GRY ↑ NAJMNIEJ',
    'score-desc': 'OCENA ↓ NAJWYŻSZA',
    'name-asc': 'NAZWA A–Z',
    'name-desc': 'NAZWA Z–A',
    'year-desc': 'ROK ↓ NAJNOWSZE',
    'year-asc': 'ROK ↑ NAJSTARSZE'
  };
  const PAGE = 80;
  let shown = 0;
  let results = [];
  let listMode = false;
  let scrollObserver;

  function score(g) { return typeof g.score === 'number' ? g.score : -1; }
  function sortRecords(games, kind) {
    games.sort((a, b) => {
      if (kind === 'name-asc') return compare.compare(a.title, b.title);
      if (kind === 'name-desc') return compare.compare(b.title, a.title);
      if (kind === 'score-desc') return score(b) - score(a) || compare.compare(a.title, b.title);
      if (kind === 'year-desc') return (b.year || 0) - (a.year || 0) || compare.compare(a.title, b.title);
      if (kind === 'year-asc') return (a.year || 9999) - (b.year || 9999) || compare.compare(a.title, b.title);
      const delta = kind === 'time-asc' ? a.minutes - b.minutes : b.minutes - a.minutes;
      if (delta) return delta;
      // For zero playtime sort by score descending (also in time-asc).
      if (a.minutes === 0 && b.minutes === 0) {
        const difference = score(b) - score(a);
        if (difference) return difference;
      }
      return compare.compare(a.title, b.title);
    });
  }

  function optionList(id, attr) {
    const counts = new Map();
    for (const g of source.games) for (const value of g[attr] || []) {
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    const select = el(id);
    for (const [name, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || compare.compare(a[0], b[0]))) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name + ' (' + count + ')';
      select.appendChild(option);
    }
  }

  function card(game, index) {
    const item = document.createElement('button');
    item.className = 'tile';
    item.type = 'button';
    item.setAttribute('aria-label', game.title + ', ' + time(game.minutes));
    const imageBox = document.createElement('span');
    imageBox.className = 'poster';
    if (game.cover) {
      const image = document.createElement('img');
      image.src = game.cover;
      image.alt = '';
      image.loading = index < 9 ? 'eager' : 'lazy';
      imageBox.appendChild(image);
    } else {
      const none = document.createElement('span');
      none.className = 'no-cover';
      none.textContent = 'BRAK OKŁADKI';
      imageBox.appendChild(none);
    }
    const body = document.createElement('span');
    body.className = 'tile-info';
    const title = document.createElement('span');
    title.className = 'tile-title';
    title.textContent = game.title;
    title.title = game.title;
    const more = document.createElement('span');
    more.className = 'tile-details';
    const duration = document.createElement('span');
    duration.className = 'tile-time';
    duration.textContent = time(game.minutes);
    more.appendChild(duration);
    if (typeof game.score === 'number') {
      const rating = document.createElement('span');
      rating.className = 'tile-score';
      rating.textContent = '★ ' + game.score;
      more.appendChild(rating);
    }
    if (game.libraries?.length) {
      const library = document.createElement('span');
      library.className = 'tile-library';
      library.textContent = '· ' + game.libraries.slice(0, 2).join(', ');
      more.appendChild(library);
    }
    body.append(title, more);
    item.append(imageBox, body);
    item.addEventListener('click', () => showGame(game));
    return item;
  }

  function addNextPage() {
    const next = Math.min(results.length, shown + PAGE);
    if (next === shown) return;
    const fragment = document.createDocumentFragment();
    for (let i = shown; i < next; i++) fragment.appendChild(card(results[i], i));
    el('catalog').appendChild(fragment);
    shown = next;
    el('count').textContent = 'Wyświetlono ' + fmt(shown) + ' z ' + fmt(results.length) + ' pozycji';
    el('load-marker').hidden = shown >= results.length;
  }

  function currentStatus() {
    const parts = [sorterLabels[el('sort').value]];
    for (const [id, label] of [['library', 'BIBLIOTEKA'], ['genre', 'GATUNEK'], ['platform', 'PLATFORMA']]) {
      if (el(id).value) parts.push(label + ': ' + el(id).value.toLocaleUpperCase('pl'));
    }
    if (el('played').checked) parts.push('TYLKO OGRANE');
    if (el('search').value.trim()) parts.push('WYSZUKIWANIE: ' + el('search').value.trim());
    el('sort-status').textContent = parts.join('   •   ');
  }

  function applyFilters() {
    const search = el('search').value.trim().toLocaleLowerCase('pl');
    const library = el('library').value;
    const genre = el('genre').value;
    const platform = el('platform').value;
    const played = el('played').checked;
    results = source.games.filter(g =>
      (!search || g.title.toLocaleLowerCase('pl').includes(search)) &&
      (!library || g.libraries.includes(library)) &&
      (!genre || g.genres.includes(genre)) &&
      (!platform || g.platforms.includes(platform)) &&
      (!played || g.minutes > 0)
    );
    sortRecords(results, el('sort').value);
    currentStatus();
    el('catalog').replaceChildren();
    shown = 0;
    addNextPage();
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nie znaleziono gier pasujących do wybranych filtrów.';
      el('catalog').appendChild(empty);
      el('count').textContent = 'Brak pasujących pozycji';
    }
    // If a large monitor shows more than 80 cards at once, fill the viewport without clicking.
    requestAnimationFrame(fillViewport);
  }

  function fillViewport() {
    let rounds = 0;
    while (shown < results.length && el('load-marker').getBoundingClientRect().top < window.innerHeight + 400 && rounds++ < 10) addNextPage();
  }

  function showGame(game) {
    const host = el('game-body');
    host.replaceChildren();
    const row = document.createElement('div');
    row.className = 'popup-content';
    if (game.cover) {
      const img = document.createElement('img');
      img.src = game.cover;
      img.alt = '';
      img.className = 'popup-poster';
      row.appendChild(img);
    }
    const details = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = game.title;
    const duration = document.createElement('div');
    duration.className = 'popup-time';
    duration.textContent = time(game.minutes);
    const pairs = [
      ['Ocena', typeof game.score === 'number' ? game.score + '/100 (' + game.score_label + ')' : ''],
      ['Biblioteki', (game.libraries || []).join(', ')],
      ['Platformy', (game.platforms || []).join(', ')],
      ['Gatunki', (game.genres || []).join(', ')],
      ['Rok', game.year || ''],
      ['Status', game.status || ''],
      ['Wydania', game.count > 1 ? game.editions.join(' / ') : '']
    ];
    const list = document.createElement('dl');
    for (const [name, content] of pairs) {
      if (!String(content).trim()) continue;
      const dt = document.createElement('dt');
      dt.textContent = name;
      const dd = document.createElement('dd');
      dd.textContent = content;
      list.append(dt, dd);
    }
    details.append(title, duration, list);
    row.appendChild(details);
    host.appendChild(row);
    el('game-dialog').showModal();
  }

  function modal(dialogId, closeId) {
    const dialog = el(dialogId);
    el(closeId).addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  }

  function setup() {
    if (!source || !Array.isArray(source.games)) {
      el('count').textContent = 'Brak danych katalogu — uruchom generator.py';
      return;
    }
    el('stamp').textContent = 'Ostatni eksport: ' + source.exported;
    el('total-games').textContent = fmt(source.uniqueCount);
    el('total-hours').textContent = fmt(Math.floor(source.games.reduce((t, g) => t + g.minutes, 0) / 60)) + ' godz.';
    el('played-games').textContent = fmt(source.games.filter(g => g.minutes > 0).length);
    el('merged-games').textContent = fmt(source.mergedCount);
    optionList('library', 'libraries');
    optionList('genre', 'genres');
    optionList('platform', 'platforms');
    for (const id of ['search', 'sort', 'library', 'genre', 'platform', 'played']) {
      el(id).addEventListener(id === 'search' ? 'input' : 'change', applyFilters);
    }
    el('clear').addEventListener('click', () => {
      for (const id of ['search', 'library', 'genre', 'platform']) el(id).value = '';
      el('sort').value = 'time-desc';
      el('played').checked = false;
      applyFilters();
    });
    const toggleView = (list) => {
      listMode = list;
      el('catalog').classList.toggle('as-list', listMode);
      el('grid-mode').classList.toggle('is-active', !listMode);
      el('list-mode').classList.toggle('is-active', listMode);
      el('grid-mode').setAttribute('aria-pressed', String(!listMode));
      el('list-mode').setAttribute('aria-pressed', String(listMode));
      requestAnimationFrame(fillViewport);
    };
    el('grid-mode').addEventListener('click', () => toggleView(false));
    el('list-mode').addEventListener('click', () => toggleView(true));
    if ('IntersectionObserver' in window) {
      scrollObserver = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && shown < results.length) addNextPage();
      }, { rootMargin: '700px 0px' });
      scrollObserver.observe(el('load-marker'));
    } else {
      window.addEventListener('scroll', () => { if (el('load-marker').getBoundingClientRect().top < window.innerHeight + 500) addNextPage(); }, { passive: true });
    }
    const top = el('go-top');
    window.addEventListener('scroll', () => top.classList.toggle('visible', window.scrollY > 650), { passive: true });
    top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    el('avatar-open').addEventListener('click', () => el('avatar-dialog').showModal());
    modal('avatar-dialog', 'avatar-close');
    modal('game-dialog', 'game-close');
    applyFilters();
  }
  setup();
})();
