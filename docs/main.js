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
    'community-desc': 'OCENA GRACZY ↓',
    'critic-desc': 'OCENA KRYTYKÓW ↓',
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
      if (kind === 'community-desc') return (b.communityScore ?? -1) - (a.communityScore ?? -1) || compare.compare(a.title,b.title);
      if (kind === 'critic-desc') return (b.criticScore ?? -1) - (a.criticScore ?? -1) || compare.compare(a.title,b.title);
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
    // Pełny tytuł jest w aria-label kafelka i w szczegółach. Bez natywnego białego dymka.
    const more = document.createElement('span');
    more.className = 'tile-details';
    const duration = document.createElement('span');
    duration.className = 'tile-time';
    duration.textContent = time(game.minutes);
    more.appendChild(duration);
    for (const [key, icon, label, css] of [['communityScore','★','Gracze','score-community'],['criticScore','★','Krytycy','score-critic']]) {
      if (typeof game[key] !== 'number') continue;
      const rating = document.createElement('span');
      rating.className = 'tile-score ' + css;
      rating.textContent = icon + ' ' + game[key];
      rating.setAttribute('aria-label', label + ': ' + game[key] + '/100');
      more.appendChild(rating);
    }
    if (game.links?.nexus) {
      const mark = document.createElement('span');
      mark.className = 'tile-mod-mark';
      mark.textContent = '◆ MODY';
      mark.setAttribute('aria-label', 'Strona gry w Nexus Mods');
      more.appendChild(mark);
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
    if (el('nexus-only').checked) parts.push('Z NEXUS MODS');
    if (el('search').value.trim()) parts.push('WYSZUKIWANIE: ' + el('search').value.trim());
    el('sort-status').textContent = parts.join('   •   ');
  }

  function applyFilters() {
    const search = el('search').value.trim().toLocaleLowerCase('pl');
    const library = el('library').value;
    const genre = el('genre').value;
    const platform = el('platform').value;
    const played = el('played').checked;
    const nexusOnly = el('nexus-only').checked;
    results = source.games.filter(g =>
      (!search || g.title.toLocaleLowerCase('pl').includes(search)) &&
      (!library || g.libraries.includes(library)) &&
      (!genre || g.genres.includes(genre)) &&
      (!platform || g.platforms.includes(platform)) &&
      (!played || g.minutes > 0) &&
      (!nexusOnly || !!g.links?.nexus)
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
      ['★ Ocena graczy', typeof game.communityScore === 'number' ? game.communityScore + '/100' : 'Brak oceny'],
      ['★ Ocena krytyków', typeof game.criticScore === 'number' ? game.criticScore + '/100' : 'Brak oceny'],
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
    const mods = document.createElement('section');
    mods.className = 'mods-links';
    const heading = document.createElement('h4');
    heading.textContent = 'Modyfikacje, spolszczenia i oferty';
    mods.appendChild(heading);
    const nexus = game.links?.nexus || '';
    const gg = game.links?.ggdeals || '';
    function addLink(label, url, verified = false) {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = label + ' ↗';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (verified) a.className = 'direct-link';
      mods.appendChild(a);
    }
    if (nexus) {
      const caption = document.createElement('p');
      caption.className = 'mods-confirmed';
      caption.textContent = 'Nexus Mods — potwierdzona strona gry';
      mods.appendChild(caption);
      // Adres pochodzi z Playnite lub z wcześniej zapisanego linku tego samego wpisu.
      const parts = new URL(nexus).pathname.split('/').filter(Boolean);
      const slug = parts[parts.length - 1];
      addLink('Nexus Mods — strona gry', nexus, true);
      if (slug && /^[a-zA-Z0-9_-]+$/.test(slug)) {
        addLink('Wszystkie mody', 'https://www.nexusmods.com/games/' + slug + '/mods', true);
        addLink('Kategorie modów', 'https://www.nexusmods.com/' + slug + '/mods/categories', true);
        addLink('Popularne mody', 'https://www.nexusmods.com/' + slug + '/mods/top', true);
      }
    } else {
      const missing = document.createElement('p');
      missing.className = 'mods-muted';
      missing.textContent = 'Brak bezpośredniego odnośnika Nexus Mods w metadanych.';
      mods.appendChild(missing);
      addLink('Nexus Mods — wyszukaj grę',
        'https://www.google.com/search?q=' + encodeURIComponent('site:nexusmods.com/games/ "' + game.title + '"'));
    }
    if (gg) {
      const caption = document.createElement('p');
      caption.className = 'mods-confirmed';
      caption.textContent = 'GG.deals — bezpośredni link z Playnite';
      mods.appendChild(caption);
      addLink('GG.deals — porównaj oferty', gg, true);
    }
    const searches = document.createElement('p');
    searches.className = 'mods-muted';
    searches.textContent = 'Pozostałe opcje są wyszukiwaniem, nie potwierdzeniem dostępności.';
    mods.appendChild(searches);
    const q = encodeURIComponent(game.title);
    addLink('Steam Workshop — wyszukaj', 'https://steamcommunity.com/workshop/browse/?searchtext=' + q);
    addLink('ModDB — wyszukaj', 'https://www.google.com/search?q=' + encodeURIComponent('site:moddb.com/games/ ' + game.title));
    addLink('Spolszczenia — wyszukaj', 'https://www.google.com/search?q=' + encodeURIComponent(game.title + ' spolszczenie fanowskie'));
    details.appendChild(mods);
    row.appendChild(details);
    host.appendChild(row);
    openDialogKeepingPlace(el('game-dialog'));
  }

  // Zachowaj dokładne miejsce w katalogu podczas otwierania szczegółów.
  // Samo <dialog>.showModal() może przesunąć widok przy przenoszeniu fokusu.
  let lockedPagePosition = null;
  function restoreDialogScroll() {
    if (!lockedPagePosition) return;
    const {x, y, focused, scrollBehavior} = lockedPagePosition;
    lockedPagePosition = null;
    // W CSS html ma scroll-behavior:smooth, więc na moment wyłączamy animację
    // podczas przywracania pozycji po zamknięciu okna.
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.classList.remove('dialog-scroll-locked');
    document.body.style.removeProperty('--dialog-scroll-offset');
    document.body.style.removeProperty('--dialog-scrollbar-width');
    window.scrollTo(x, y);
    if (focused && focused.isConnected && typeof focused.focus === 'function') {
      focused.focus({preventScroll: true});
    }
    document.documentElement.style.scrollBehavior = scrollBehavior;
  }

  function openDialogKeepingPlace(dialog) {
    if (dialog.open || lockedPagePosition) return;
    lockedPagePosition = {
      x: window.scrollX,
      y: window.scrollY,
      focused: document.activeElement,
      scrollBehavior: document.documentElement.style.scrollBehavior
    };
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.setProperty('--dialog-scroll-offset', -lockedPagePosition.y + 'px');
    document.body.style.setProperty('--dialog-scrollbar-width', scrollbarWidth + 'px');
    document.body.classList.add('dialog-scroll-locked');
    try {
      dialog.showModal();
    } catch (error) {
      restoreDialogScroll();
      throw error;
    }
  }

  function modal(dialogId, closeId) {
    const dialog = el(dialogId);
    el(closeId).addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    // Zadziała również po naciśnięciu Esc; nie jest potrzebna osobna obsługa Escape.
    dialog.addEventListener('close', restoreDialogScroll);
  }

  const genrePalette = ['#47a6ea','#f8b84d','#89cb70','#ed7596','#ae8fee','#56c5bd','#ed9766','#7aa9ff','#d3c36f','#b382c5','#ea7474','#54ad77','#77d0df','#dca2ef','#b5b9df','#fbcb8a','#8fc5a4','#b69469','#e58cc7','#a7d76a'];
  function setupGenres() {
    const stats = new Map();
    for (const game of source.games) for (const genre of game.genres || []) {
      if (!genre) continue;
      const value = stats.get(genre) || {name:genre,count:0,minutes:0};
      value.count++; value.minutes += Number(game.minutes || 0); stats.set(genre,value);
    }
    const names = [...stats.keys()].sort(compare.compare);
    const colors = new Map(names.map((name,i)=>[name,genrePalette[i%genrePalette.length]]));
    const frame=el('genre-chart'), tooltip=el('genre-tooltip');
    const svgNode=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
    function openGenre(name){ el('genre').value=name;el('search').value='';applyFilters();el('biblioteka').scrollIntoView({behavior:'smooth'}); }
    function render() {
      const measure=el('genre-measure').value, mode=el('genre-chart-type').value;
      let list=[...stats.values()].sort((a,b)=>(measure==='count'?b.count-a.count:b.minutes-a.minutes)||compare.compare(a.name,b.name));
      const limit=el('genre-limit').value;if(limit!=='all')list=list.slice(0,+limit);
      frame.replaceChildren();tooltip.hidden=true;
      if(!list.length){frame.textContent='Brak danych o gatunkach.';return;}
      const sum=list.reduce((s,x)=>s+(measure==='count'?x.count:x.minutes),0);
      const val=x=>measure==='count'?x.count:x.minutes/60;
      const label=x=>`${x.name}\nGier: ${fmt(x.count)}\nCzas gry: ${time(x.minutes)}\nUdział w wybranym zestawieniu: ${sum ? ((measure==='count'?x.count:x.minutes)/sum*100).toFixed(1):'0'}%`;
      const show=(event,x)=>{tooltip.textContent=label(x);tooltip.hidden=false;tooltip.style.left=Math.min(event.clientX-frame.getBoundingClientRect().left+16, Math.max(0,frame.clientWidth-235))+'px';tooltip.style.top=Math.max(0,event.clientY-frame.getBoundingClientRect().top-15)+'px';};
      if(mode==='bar'){
        const max=Math.max(...list.map(val),1);
        const svg=svgNode('svg',{viewBox:`0 0 960 ${list.length*37+35}`,role:'img','aria-label':'Rozkład gatunków — wykres słupkowy'});
        list.forEach((x,i)=>{
          const y=15+i*37, color=colors.get(x.name), amount=val(x);
          const row=svgNode('g',{class:'genre-svg-item',tabindex:'0',role:'button','aria-label':label(x)});
          const text=svgNode('text',{x:5,y:y+18,fill:'#dedce6','font-size':14});text.textContent=x.name.length>24?x.name.slice(0,23)+'…':x.name;
          const bg=svgNode('rect',{x:218,y:y+2,width:630,height:23,rx:6,fill:'#192538'});
          const bar=svgNode('rect',{x:218,y:y+2,width:630*amount/max,height:23,rx:6,fill:color});
          const score=svgNode('text',{x:860,y:y+19,fill:'#f6f5f8','font-size':14});score.textContent=measure==='count'?fmt(x.count):fmt(Math.round(x.minutes/60))+' h';
          // Nie dodajemy elementu SVG <title>: przeglądarka pokazywałaby drugi, biały dymek.
          row.append(text,bg,bar,score);
          row.addEventListener('mousemove',e=>show(e,x));row.addEventListener('mouseleave',()=>tooltip.hidden=true);row.addEventListener('click',()=>openGenre(x.name));row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openGenre(x.name);}});svg.appendChild(row);
        });frame.appendChild(svg);
      } else {
        const svg=svgNode('svg',{viewBox:'0 0 960 480',role:'img','aria-label':'Rozkład gatunków — wykres kołowy'});
        let start=-Math.PI/2;const cx=285,cy=230,r=190;
        list.forEach(x=>{
          const portion=(measure==='count'?x.count:x.minutes)/(sum||1);const next=start+portion*2*Math.PI;
          const polar=a=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];const [x1,y1]=polar(start),[x2,y2]=polar(next);
          const path=svgNode('path',{d:`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${portion>0.5?1:0} 1 ${x2} ${y2} Z`,fill:colors.get(x.name),class:'genre-svg-item',tabindex:'0',role:'button','aria-label':label(x)});
          // Tylko własna ciemna podpowiedź; natywny <title> SVG powodował nakładanie się dymków.
          path.addEventListener('mousemove',e=>show(e,x));path.addEventListener('mouseleave',()=>tooltip.hidden=true);path.addEventListener('click',()=>openGenre(x.name));path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openGenre(x.name);}});svg.appendChild(path);start=next;
        });
        const legend= document.createElement('div');legend.className='genre-legend';list.forEach(x=>{const button=document.createElement('button');const swatch=document.createElement('i');swatch.style.background=colors.get(x.name);button.append(swatch,document.createTextNode(x.name+' — '+(measure==='count'?fmt(x.count):fmt(Math.round(x.minutes/60))+' h')));button.setAttribute('aria-label',label(x));button.addEventListener('mousemove',e=>show(e,x));button.addEventListener('mouseleave',()=>tooltip.hidden=true);button.addEventListener('click',()=>openGenre(x.name));legend.appendChild(button);});frame.append(svg,legend);
      }
    }
    for(const id of ['genre-measure','genre-chart-type','genre-limit'])el(id).addEventListener('change',render);
    render();
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
    for (const id of ['search', 'sort', 'library', 'genre', 'platform', 'played', 'nexus-only']) {
      el(id).addEventListener(id === 'search' ? 'input' : 'change', applyFilters);
    }
    el('clear').addEventListener('click', () => {
      for (const id of ['search', 'library', 'genre', 'platform']) el(id).value = '';
      el('sort').value = 'time-desc';
      el('played').checked = false;
      el('nexus-only').checked = false;
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
    el('avatar-open').addEventListener('click', () => openDialogKeepingPlace(el('avatar-dialog')));
    modal('avatar-dialog', 'avatar-close');
    modal('game-dialog', 'game-close');
    applyFilters();
    setupGenres();
  }
  setup();
})();
