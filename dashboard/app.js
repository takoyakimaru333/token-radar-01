// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchlistOnly: false, compare: [] };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // The base multiple is the row's category multiple at its category's typical size, calibrated
  // from this snapshot (see the calibration panel below); the size multiplier moves it to this
  // row's own TVL along the fitted size slope; growth and maturity follow the stated constants.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * (row.size_multiplier || 1) * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('payment') >= 0) return 'Fund $' + capital + ' and make one real payment through ' + name + "'s app.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function alsoOn(p) { return p.chains && p.chains.length > 1 ? ' (it also runs on ' + p.chains.slice(1, 3).join(' and ') + ')' : ''; }
  function weeklyFor(p, capital) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return "Once a week, borrow a small amount against the supplied collateral on " + name + " and repay it within the day, so both sides of the market carry your wallet's history.";
    if (c.indexOf('dex') >= 0) return 'Once a week, add or rebalance about $' + small + ' in the same pool on ' + name + ', so the position is a working one and not a single forgotten deposit.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Once a week, check the vault's allocation on " + name + " and move a small part of the deposit to a second vault of the same curator if one is open, so the curator's records show an active allocator.";
    if (c.indexOf('rwa') >= 0) return 'Once a week, mint or redeem a small amount (about $' + small + ') on ' + name + ', so both directions of the asset are on record for your wallet.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Once a week, claim the staking rewards on ' + name + ' and restake them, so the position compounds and the wallet shows continuing activity.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Once a week, open and close one small hedge on ' + name + ' and check the funding rate first: skip the week when funding costs more than the position earns.';
    if (c.indexOf('stable') >= 0) return "Once a week, mint or redeem a small amount on " + name + " so the wallet's history shows use of the stable asset, not only a deposit.";
    if (c.indexOf('insurance') >= 0) return 'Once a week, check the cover on ' + name + ' is still active and extend it before it lapses if the position is still open.';
    if (c.indexOf('payment') >= 0) return "Once a week, make one real payment through " + name + "'s app, the activity a payments protocol counts.";
    return 'Make one qualifying action each week on ' + name + ', such as a deposit, a swap or a vote, so the wallet\u2019s history is continuous.';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Know the liquidation line before you supply: if the collateral behind your position on ' + name + ' falls to its liquidation threshold, the position is sold automatically and at a penalty, so keep the loan-to-value low enough to survive a bad week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged') >= 0) return 'Price both sides of the pool before you add liquidity on ' + name + ': when the pair moves apart, the pool hands you more of the falling asset (impermanent loss), and a week of fees may not repay a hard move.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0) return 'Size the hedge so a liquidation cannot take the whole deposit: on ' + name + ' a leveraged position is closed automatically at its maintenance margin, and funding can charge you every hour you hold it.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Read the unbonding period and the slashing terms on ' + name + ' before you stake: the receipt asset can trade below the staked asset, and a validator\u2019s fault can be charged to everyone who delegated to it.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Check what the vault on ' + name + ' actually holds before you deposit: a curator allocates other people\u2019s money into markets it chooses, and losses in those markets are shared by the vault\u2019s depositors.';
    if (c.indexOf('rwa') >= 0) return 'Check the redemption terms on ' + name + ' before you mint: real-world assets often redeem on a schedule, sometimes with identity checks, so the position may not be sellable the week you want out.';
    if (c.indexOf('prediction') >= 0) return 'Treat the stake on ' + name + ' as money that can go to zero: a prediction position pays only if the outcome lands your way, and most markets settle at nothing for the losing side.';
    if (c.indexOf('stable') >= 0) return 'Hold only what you can afford to see depeg: the stable asset behind ' + name + ' is a promise backed by reserves you cannot audit from the app, and stablecoins have broken their peg before.';
    if (c.indexOf('bridge') >= 0) return 'Move a test amount across ' + name + ' first and wait for it to arrive: bridges hold the original asset in a contract while the copy travels, and that contract is the part that gets attacked.';
    if (c.indexOf('insurance') >= 0) return 'Read what the cover on ' + name + ' actually pays for before you rely on it: most policies name specific failures, and a loss outside the wording is not compensated.';
    return 'Keep the position on ' + name + ' small enough that a contract failure is survivable: an unaudited or freshly upgraded contract is the standing risk of every pre-token protocol, whatever its category.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var action = actionFor(p, capital, chain).replace(/\.$/, '') + alsoOn(p) + '.';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p, capital), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: riskFor(p), cost: 'nothing to check, and it sizes every other step', time: '10 minutes, before the first deposit' },
      { text: 'Never sign a claim, an airdrop check or an approval from a search result, an ad or a direct message: a protocol with no token yet is the easiest to impersonate, so reach ' + p.name + ' only through its own app.', cost: 'nothing, and it protects the whole position', time: 'every time, before signing' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Each implied value uses a multiple measured from the ' + DATA.calibration.peer_count + ' protocols in this snapshot that already trade. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var only = el('button', { type: 'button', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; render(); } });
    var csv = el('button', { class: 'button', type: 'button', text: 'Export CSV', onclick: exportCsv });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search ( / )' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('div', { class: 'tabs' }, only)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Take it with you' }), csv),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  // The board on screen as a file: the rows the filters leave, in the order the sort leaves
  // them, so a farmer can work the list in a spreadsheet without scraping the page.
  function exportCsv() {
    function cell(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = ['rank,protocol,category,tvl_usd,change_7d_pct,implied_value_usd,multiple,peers,watchlist'];
    sortedRows(rows()).forEach(function (r) {
      lines.push([r.rank, r.name, r.category || '', Math.round(r.tvl_usd), r.change_7d === null ? '' : r.change_7d.toFixed(2), r.implied_value_usd, r.category_multiple, r.peer_count, r.watchlist ? 'yes' : 'no'].map(cell).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'token-radar-board.csv' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }, r.watchlist ? el('span', { class: 'tag', text: 'watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          el('button', {
            class: 'cmp-btn', type: 'button',
            text: state.compare.indexOf(r.slug) >= 0 ? 'In compare list' : 'Add to compare',
            onclick: function (e) { e.stopPropagation(); toggleCompare(r.slug); },
          })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var val = DATA.validation;
    var cats = cal.categories.slice().sort(function (a, b) { return b.peers - a.peers; }).slice(0, 12);
    var tbody = el('tbody');
    cats.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { text: c.category || 'Uncategorised' }),
        el('td', { class: 'num', text: String(c.peers) }),
        el('td', { class: 'num', text: c.median_ratio.toFixed(3) }),
        el('td', { class: 'num', text: c.multiple.toFixed(3) })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'The multiple is not asserted; it is measured from this snapshot. ' + cal.peer_count + ' protocols in the snapshot already trade, so each one prices a dollar of TVL in its category (market cap / TVL). Ratios are winsorised at their 95th percentile (' + cal.ratio_cap.toFixed(2) + '), because a few peers print ratios in the tens or hundreds on a sliver of recorded TVL and one such print must not set a category\u2019s price. The centre is taken in log space (the geometric median), because ratios span orders of magnitude, and shrunk toward the global median of ' + cal.global_median.toFixed(3) + ' with weight ' + cal.shrink_k + ', so a category with three peers borrows the market centre instead of swinging on three prints. A category with no trading peers uses the global median.' }),
      el('p', { class: 'sub', text: 'Size is priced too: across this snapshot\u2019s peers, the market pays less per TVL dollar the larger a protocol is. The model fits that slope within categories (beta ' + cal.beta.toFixed(2) + ' of log ratio per log of TVL, clamped so it never rewards size) and moves each category\u2019s multiple from its typical size to the protocol\u2019s own size. A protocol ten times its category\u2019s typical size is priced at a lower multiple than a typical one, because that is what the snapshot\u2019s trading protocols show.' }),
      el('div', { class: 'formula' },
        'log multiple = (peers x (category median log + beta x (log TVL - category median log TVL)) + ' + m.shrink_k + ' x (global median log + beta x (log TVL - global median log TVL))) / (peers + ' + m.shrink_k + '), beta = ' + cal.beta.toFixed(2) + ';  implied = round( tvl_usd x 10^log-multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'Checked against itself: before this board was priced, the model priced each of the ' + val.peers + ' trading protocols in this snapshot blind \u2014 left out of its own calibration \u2014 and compared the price with its actual market cap. The typical miss was a factor of x' + val.median_factor.toFixed(2) + ' (median); ' + val.within_2x_pct + '% of the blind prices landed within 2x of the truth and ' + val.within_3x_pct + '% within 3x. The range on every row is that measured factor, not a round number: half of the blind prices landed inside it. A model that hides its own error is asking to be trusted; this one publishes it.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Calibration from this snapshot: the best-measured categories. The median is geometric (in log space) and the multiple is stated at each category\u2019s typical size, before the size slope moves it to a row\u2019s own TVL. Every other category is calibrated the same way; the detail view of any row shows its own multiple, size factor and peer count.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Trading peers' }),
            el('th', { scope: 'col', text: 'Median mcap / TVL' }),
            el('th', { scope: 'col', text: 'Multiple at typical size' })
          )),
          tbody
        )
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar adds pre-token protocols below the watchlist floor by TVL, leaving out exchanges, versioned pools and bridge wrappers, whose TVL is another asset in transit. Live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: row.category_multiple.toFixed(3) })),
        el('div', null, el('span', { text: 'Size multiplier' }), el('b', { class: 'num', text: 'x' + (row.size_multiplier || 1).toFixed(3) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Measured range, low' }), el('b', { class: 'num', text: fmtUsd(row.implied_low_usd) })),
        el('div', null, el('span', { text: 'Measured range, high' }), el('b', { class: 'num', text: fmtUsd(row.implied_high_usd) }))
      ),
      el('p', { class: 'sub', text: row.peer_count > 0
        ? 'The multiple is calibrated on ' + row.peer_count + ' trading peer' + (row.peer_count === 1 ? '' : 's') + ' in ' + (row.category || 'this category') + ' (geometric median mcap / TVL ' + (row.peer_median === null ? 'n/a' : row.peer_median.toFixed(3)) + '), shrunk toward the global median ' + DATA.calibration.global_median.toFixed(3) + ', then moved by the size factor for this protocol\u2019s TVL. The range is the model\u2019s measured holdout error on this snapshot: half of the trading protocols it priced blind landed within x' + DATA.validation.median_factor.toFixed(2) + ' of their actual market cap.'
        : 'No protocol in ' + (row.category || 'this category') + ' trades in this snapshot, so the multiple is the global median ' + DATA.calibration.global_median.toFixed(3) + ' measured across ' + DATA.calibration.peer_count + ' trading protocols, moved by the size factor for this protocol\u2019s TVL. The range is the model\u2019s measured holdout error on this snapshot: half of the trading protocols it priced blind landed within x' + DATA.validation.median_factor.toFixed(2) + ' of their actual market cap.' }),
      el('p', { class: 'why', text: row.why }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // A shortlist tray: up to three protocols side by side on the figures a farmer actually
  // chooses between — what it is, what it holds, what the model pays for it, and what the
  // farm plan would commit. Three is a decision, not a catalogue.
  function toggleCompare(slug) {
    var at = state.compare.indexOf(slug);
    if (at >= 0) state.compare.splice(at, 1);
    else {
      if (state.compare.length >= 3) state.compare.shift();
      state.compare.push(slug);
    }
    render();
  }

  function comparePanel() {
    if (state.compare.length === 0) return null;
    var picked = state.compare.map(function (slug) {
      return DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    }).filter(Boolean);
    if (picked.length === 0) return null;
    function metric(label, read) {
      return el('tr', null,
        el('th', { scope: 'row', text: label }),
        picked.map(function (r) { return el('td', { class: 'num', text: read(r) }); })
      );
    }
    return el('section', { class: 'panel compare', 'aria-label': 'Compare shortlist' },
      el('div', { class: 'compare-head' },
        el('h2', { text: 'Compare (' + picked.length + ' of 3)' }),
        el('button', { class: 'button', type: 'button', text: 'Clear', onclick: function () { state.compare = []; render(); } })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Figure' }),
            picked.map(function (r) { return el('th', { scope: 'col', text: r.name }); })
          )),
          el('tbody', null,
            metric('Category', function (r) { return r.category || 'Other'; }),
            metric('TVL', function (r) { return fmtUsd(r.tvl_usd); }),
            metric('Seven-day move', function (r) { return fmtPct(r.change_7d); }),
            metric('Age with no token', function (r) { return fmtAge(r.age_days); }),
            metric('Category multiple', function (r) { return 'x' + r.category_multiple.toFixed(3); }),
            metric('Size multiplier', function (r) { return 'x' + (r.size_multiplier || 1).toFixed(3); }),
            metric('Trading peers behind it', function (r) { return String(r.peer_count); }),
            metric('Implied value', function (r) { return fmtUsd(r.implied_value_usd); }),
            metric('Implied range (measured holdout band)', function (r) { return fmtUsd(r.implied_low_usd) + ' - ' + fmtUsd(r.implied_high_usd); }),
            metric('Farm capital', function (r) { return '$' + capitalFor(r); }),
            metric('Farm hold', function (r) { return holdDaysFor(r.age_days) + ' days'; })
          )
        )
      )
    );
  }

  // The week's extremes, both directions: growth feeds the model's growth multiplier, so the
  // names moving hardest are the names whose implied values are most sensitive to one week's
  // weather. Each entry opens the same detail drawer as its board row.
  function movers() {
    var withMove = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d !== undefined; });
    function column(title, list) {
      return el('div', { class: 'movers-col' },
        el('h3', { text: title }),
        list.map(function (r) {
          return el('button', { class: 'mover', type: 'button', onclick: function () { openDetail(r.slug); } },
            el('span', { class: 'mover-name', text: r.name }),
            el('span', { class: 'sub', text: r.category || 'Other' }),
            el('span', { class: 'num ' + (r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })
          );
        })
      );
    }
    var up = withMove.slice().sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 5);
    var down = withMove.slice().sort(function (a, b) { return a.change_7d - b.change_7d; }).slice(0, 5);
    return el('section', { class: 'panel movers', 'aria-label': 'Biggest seven-day movers' },
      column('Moving up this week', up),
      column('Moving down this week', down)
    );
  }

  // A first-reader's guide, kept on the page because the board's numbers invite two classic
  // misreadings: that an implied value is a forecast, and that a high rank is an instruction.
  // Four short answers, in the order a new reader asks them.
  function guidePanel() {
    var body = el('div', { class: 'guide-body' },
      el('p', null,
        el('b', { text: 'What is an implied value? ' }),
        'Not a price target. It is the market cap a protocol would carry if the market paid it the same multiple of TVL it pays its trading peers today, adjusted for its size the way the snapshot\u2019s peers say size is priced. A protocol far above its peers\u2019 multiple is not predicted to fall, and one far below is not promised to rise; the number says where the model\u2019s centre is, and the detail view shows the range the model\u2019s own blind test measured: half of the trading protocols it priced without seeing them landed inside that band.'
      ),
      el('p', null,
        el('b', { text: 'Why does the watchlist matter? ' }),
        'The watchlist is the floor the bounty sets: the largest pre-token protocols, every one covered. The early radar below it is where smaller, younger protocols sit. TVL is not safety — a young protocol with $40M can fail more easily than an old one with $400M — so each row carries its age beside its size, and the farm plan sizes its hold by that age.'
      ),
      el('p', null,
        el('b', { text: 'How do I use a farm plan? ' }),
        'As a checklist, not a tip. Each plan names the wallet hygiene, the one qualifying action for its category, the weekly habit that keeps the position real, how long to hold, and the risk that belongs to that category. The capital figures are the smallest amounts that make the activity genuine; nothing here is sized to a reader\u2019s portfolio, and no step requires leverage.'
      ),
      el('p', null,
        el('b', { text: 'What can this board not tell me? ' }),
        'Whether a token will launch at all, when, or on what terms. Most pre-token protocols never issue one, and those that do choose the date themselves. The board ranks the size of the opportunity if one comes; the probability is not in the snapshot, and any tool that prints one is inventing it.'
      )
    );
    var details = el('details', { class: 'panel guide' },
      el('summary', { text: 'How to read this board' }),
      body
    );
    return details;
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(guidePanel());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(movers());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      var tray = comparePanel();
      if (tray) shell.appendChild(tray);
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
    // "/" jumps to the search box from anywhere that is not already typing: the board is a
    // working list, and a farmer scanning 200 rows should not have to reach for the mouse.
    if (e.key === '/' && !dialog.open) {
      var target = e.target;
      var typing = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
      if (!typing) {
        var box = document.getElementById('q');
        if (box) {
          e.preventDefault();
          box.focus();
          box.select();
        }
      }
    }
  });
})();
