/* AutoGarage Pro — Pilotage de la caisse (direction) : écarts par caissier, délais de validation,
   rejets, trésorerie et flux journaliers. Lecture seule, calculé à partir des données locales. */
(function () {
  'use strict';
  var F = window.FIN; if (!F) return;
  var esc = F.esc, fmt = F.fmt;
  var PERIOD = 30;

  function sessions() { return typeof DB_SESSIONS_CAISSE !== 'undefined' ? DB_SESSIONS_CAISSE : []; }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function since(days) { var d = new Date(); d.setDate(d.getDate() - days + 1); return iso(d); }
  function signed(n) { n = Math.round(Number(n) || 0); return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)) + ' F'; }
  function hours(a, b) { var x = new Date(a), y = new Date(b); return isNaN(x) || isNaN(y) ? null : Math.max(0, (y - x) / 36e5); }
  function dur(h) { if (h == null) return '—'; if (h < 1) return Math.round(h * 60) + ' min'; if (h < 48) return (Math.round(h * 10) / 10) + ' h'; return (Math.round(h / 24 * 10) / 10) + ' j'; }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function isIn(t) { return t.transaction_type === 'encaissement'; }
  function login(s) { return s.operateur_login || s.operateur || '—'; }

  function compute(days) {
    var from = since(days), today = F.today(), tol = F.hab().ecartTolere, H = F.hab();
    var ss = sessions().filter(function (s) { return s.statut === 'cloturee' && (s.dateCloture || s.dateOuverture) >= from; });
    var bons = F.coll.bons.filter(function (b) { return b.date >= from; });
    var trx = (DB.transactions || []).filter(function (t) { return t.date >= from; });
    var deps = (typeof DB_DEPENSES !== 'undefined' ? DB_DEPENSES : []).filter(function (d) { return d.date >= from && d.vstatut !== 'attente' && d.vstatut !== 'rejete'; });

    /* écarts */
    var par = {};
    function P(k, nom) { return par[k] || (par[k] = { nom: nom || k, sessions: 0, net: 0, abs: 0, max: 0, horsTol: 0, bons: 0, rejetes: 0 }); }
    ss.forEach(function (s) { var p = P(login(s), s.operateur), e = Number(s.ecartTotal) || 0; p.sessions++; p.net += e; p.abs += Math.abs(e); p.max = Math.max(p.max, Math.abs(e)); if (Math.abs(e) > tol) p.horsTol++; });
    bons.forEach(function (b) { var p = P(b.demandeur_login || '—', b.demandeur_nom); p.bons++; if (b.statut === 'rejete') p.rejetes++; });
    var ecartNet = ss.reduce(function (n, s) { return n + (Number(s.ecartTotal) || 0); }, 0);
    var horsTol = ss.filter(function (s) { return Math.abs(Number(s.ecartTotal) || 0) > tol; }).length;

    /* validation */
    var decides = bons.filter(function (b) { return (b.statut === 'valide' || b.statut === 'rejete') && b.dateDecision && b.cree; });
    var delais = decides.map(function (b) { return hours(b.cree, b.dateDecision); }).filter(function (x) { return x != null; });
    var rejetes = bons.filter(function (b) { return b.statut === 'rejete' && !/^Retiré/.test(b.motifRejet || ''); });
    var motifs = {}; rejetes.forEach(function (b) { var m = (b.motifRejet || 'Sans motif').trim(); motifs[m] = (motifs[m] || 0) + 1; });
    var topMotifs = Object.keys(motifs).map(function (k) { return [k, motifs[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
    var decideurs = {}; decides.forEach(function (b) { var k = b.decideur_nom || b.decideur_login || '—'; decideurs[k] = (decideurs[k] || 0) + 1; });
    var now = Date.now();
    var attente = F.coll.bons.filter(function (b) { return b.statut === 'attente'; }).map(function (b) { return { b: b, age: (now - new Date(b.cree).getTime()) / 36e5 }; }).sort(function (a, b) { return b.age - a.age; });
    var seuilH = Number(H.delaiClotureH) || 24;
    var agedCount = attente.filter(function (x) { return x.age > seuilH; }).length;

    /* trésorerie */
    var solde = null;
    try { if (typeof _caisseSessionActive === 'function' && _caisseSessionActive()) solde = _caisseSoldeSession(); } catch (x) {}
    var remisesNonConf = F.coll.bons.filter(function (b) { return F.caisse && F.caisse.TYPES[b.type] && F.caisse.TYPES[b.type].remise && b.statut === 'valide' && !(b.remise && b.remise.statut === 'confirmee'); });
    var remisesAtt = F.coll.bons.filter(function (b) { return F.caisse && F.caisse.TYPES[b.type] && F.caisse.TYPES[b.type].remise && b.statut === 'attente'; });
    var enc = 0, dec = 0; trx.forEach(function (t) { var m = Math.abs(Number(t.montant) || 0); if (isIn(t)) enc += m; else dec += m; });
    var depDirect = deps.filter(function (d) { return !trx.some(function (t) { return t.ref === d.id || t.dep === d.id; }); }).reduce(function (n, d) { return n + (Number(d.montant) || 0); }, 0);

    /* flux journaliers */
    var flux = {}; for (var i = 0; i < Math.min(days, 30); i++) { var d = new Date(); d.setDate(d.getDate() - i); flux[iso(d)] = { e: 0, s: 0 }; }
    trx.forEach(function (t) { var f = flux[t.date]; if (!f) return; var m = Math.abs(Number(t.montant) || 0); if (isIn(t)) f.e += m; else f.s += m; });

    return { days: days, from: from, today: today, tol: tol, ss: ss, par: par, ecartNet: ecartNet, horsTol: horsTol, decides: decides.length, delaiMoy: avg(delais), delaiMed: median(delais), delaiMax: delais.length ? Math.max.apply(null, delais) : null,
      tauxRejet: bons.length ? Math.round(rejetes.length / bons.length * 100) : 0, nbBons: bons.length, nbRejetes: rejetes.length, topMotifs: topMotifs, decideurs: decideurs, attente: attente, agedCount: agedCount, seuilH: seuilH,
      solde: solde, remisesNonConf: remisesNonConf, remisesAtt: remisesAtt, enc: enc, dec: dec, depDirect: depDirect, flux: flux };
  }

  function kpi(label, val, color, sub) { return '<div><span>' + label + '</span><b' + (color ? ' style="color:' + color + '"' : '') + '>' + val + '</b>' + (sub ? '<small style="display:block;color:var(--text-dim);font-size:10.5px">' + sub + '</small>' : '') + '</div>'; }

  function csv(m) {
    var rows = [['Caissier', 'Sessions clôturées', 'Écart net (F)', 'Écart absolu (F)', 'Plus grand écart (F)', 'Sessions hors tolérance', 'Bons demandés', 'Bons rejetés']];
    Object.keys(m.par).forEach(function (k) { var p = m.par[k]; rows.push([p.nom, p.sessions, Math.round(p.net), Math.round(p.abs), Math.round(p.max), p.horsTol, p.bons, p.rejetes]); });
    var text = rows.map(function (r) { return r.map(function (c) { c = String(c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(';'); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = 'pilotage-caisse-' + F.today() + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function render() {
    var root = document.getElementById('pilotage-root'); if (!root) return;
    var m = compute(PERIOD), G = 'var(--green)', R = 'var(--red)', Y = 'var(--yellow)';
    var bars = Object.keys(m.flux).sort(), maxV = Math.max(1, Math.max.apply(null, bars.map(function (k) { return Math.max(m.flux[k].e, m.flux[k].s); })));
    var chart = '<div class="pil-chart" role="img" aria-label="Encaissements et décaissements par jour">' + bars.map(function (k) {
      var f = m.flux[k];
      return '<div class="pil-day" title="' + k + ' — entrées ' + fmt(f.e) + ' F, sorties ' + fmt(f.s) + ' F"><div class="pil-bars"><i class="pil-in" style="height:' + Math.round(f.e / maxV * 100) + '%"></i><i class="pil-out" style="height:' + Math.round(f.s / maxV * 100) + '%"></i></div><span>' + k.slice(8) + '</span></div>';
    }).join('') + '</div><div class="fin-note"><span class="pil-key pil-in"></span> Entrées &nbsp; <span class="pil-key pil-out"></span> Sorties (30 derniers jours au plus)</div>';
    var cais = Object.keys(m.par).map(function (k) { return m.par[k]; }).sort(function (a, b) { return b.abs - a.abs; });
    var tabC = cais.length ? '<div class="table-wrap"><table><thead><tr><th>Caissier</th><th>Sessions</th><th>Écart net</th><th>Écart absolu</th><th>Plus grand écart</th><th>Hors tolérance</th><th>Bons</th><th>Rejetés</th></tr></thead><tbody>' + cais.map(function (p) {
      return '<tr><td><b>' + esc(p.nom) + '</b></td><td>' + p.sessions + '</td><td style="color:' + (p.net === 0 ? G : R) + '">' + signed(p.net) + '</td><td>' + fmt(Math.round(p.abs)) + ' F</td><td>' + fmt(Math.round(p.max)) + ' F</td><td style="color:' + (p.horsTol ? R : G) + '">' + p.horsTol + '</td><td>' + p.bons + '</td><td>' + (p.rejetes ? '<span style="color:' + R + '">' + p.rejetes + '</span>' : 0) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="fin-note">Aucune session clôturée ni bon sur la période.</p>';
    var tabA = m.attente.length ? '<div class="table-wrap"><table><thead><tr><th>Bon</th><th>Type</th><th>Demandeur</th><th>Montant</th><th>Attend depuis</th></tr></thead><tbody>' + m.attente.slice(0, 8).map(function (x) {
      return '<tr><td style="font-family:var(--font-mono);font-size:11px">' + esc(x.b.id) + '</td><td>' + esc((F.caisse.TYPES[x.b.type] || {}).label || x.b.type) + '</td><td>' + esc(x.b.demandeur_nom || '') + '</td><td>' + fmt(x.b.montant) + ' F</td><td style="color:' + (x.age > m.seuilH ? R : 'inherit') + '">' + dur(x.age) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="fin-note">Aucune demande en attente. 👍</p>';
    var mot = m.topMotifs.length ? '<ul class="pil-list">' + m.topMotifs.map(function (x) { return '<li><span>' + esc(x[0]) + '</span><b>' + x[1] + '</b></li>'; }).join('') + '</ul>' : '<p class="fin-note">Aucun rejet motivé sur la période.</p>';
    var dec = Object.keys(m.decideurs).length ? '<ul class="pil-list">' + Object.keys(m.decideurs).map(function (k) { return '<li><span>' + esc(k) + '</span><b>' + m.decideurs[k] + '</b></li>'; }).join('') + '</ul>' : '<p class="fin-note">Aucune décision sur la période.</p>';
    var sol = m.solde ? 'Espèces ' + fmt(Math.round(m.solde.Especes)) + ' F · Mobile Money ' + fmt(Math.round(m.solde.MobileMoney)) + ' F · Carte ' + fmt(Math.round(m.solde.Carte)) + ' F' : 'Caisse fermée';
    var nonConf = m.remisesNonConf.reduce(function (n, b) { return n + b.montant; }, 0), att = m.remisesAtt.reduce(function (n, b) { return n + b.montant; }, 0);

    root.innerHTML = '<div class="fin-bar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><label class="form-label" style="margin:0">Période</label>' +
      [[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '12 mois']].map(function (p) { return '<button class="btn ' + (PERIOD === p[0] ? 'btn-primary' : 'btn-secondary') + ' btn-sm" data-pil-p="' + p[0] + '">' + p[1] + '</button>'; }).join('') +
      '<span style="flex:1"></span><button class="btn btn-secondary btn-sm" data-pil-csv="1">⬇️ Export CSV</button></div>' +
      '<div class="card"><div class="card-title">⚖️ Écarts de caisse</div><div class="fin-kpis">' +
      kpi('Sessions clôturées', m.ss.length) + kpi('Écart net', signed(m.ecartNet), m.ecartNet === 0 ? G : R) + kpi('Hors tolérance (' + fmt(m.tol) + ' F)', m.horsTol, m.horsTol ? R : G) + '</div>' + tabC + '</div>' +
      '<div class="card"><div class="card-title">✅ Circuit de validation</div><div class="fin-kpis">' +
      kpi('Délai moyen', dur(m.delaiMoy), null, 'médian ' + dur(m.delaiMed)) + kpi('Plus long', dur(m.delaiMax)) + kpi('Taux de rejet', m.tauxRejet + ' %', m.tauxRejet > 20 ? Y : G, m.nbRejetes + ' sur ' + m.nbBons + ' bons') +
      kpi('En attente', m.attente.length, m.agedCount ? R : G, m.agedCount ? m.agedCount + ' depuis plus de ' + m.seuilH + ' h' : '') + '</div>' +
      '<div class="pil-cols"><div><h4>Demandes en attente</h4>' + tabA + '</div><div><h4>Motifs de rejet</h4>' + mot + '<h4 style="margin-top:12px">Décisions par validateur</h4>' + dec + '</div></div></div>' +
      '<div class="card"><div class="card-title">💰 Trésorerie</div><div class="fin-kpis">' +
      kpi('En caisse', m.solde ? fmt(Math.round(m.solde.Especes + m.solde.MobileMoney + m.solde.Carte)) + ' F' : '—', null, sol) +
      kpi('Remises en transit', fmt(nonConf) + ' F', nonConf ? Y : G, m.remisesNonConf.length + ' à confirmer') + kpi('Remises à valider', fmt(att) + ' F', null, m.remisesAtt.length + ' demande(s)') +
      kpi('Encaissé (' + PERIOD + ' j)', fmt(Math.round(m.enc)) + ' F', G) + kpi('Décaissé', fmt(Math.round(m.dec)) + ' F', null, 'caisse validée') + kpi('Solde de période', signed(m.enc - m.dec), m.enc - m.dec >= 0 ? G : R) + '</div>' + chart + '</div>';
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-pil-p],[data-pil-csv]'); if (!t || !t.closest('#pilotage-root')) return;
    if (t.hasAttribute('data-pil-p')) { PERIOD = Number(t.getAttribute('data-pil-p')) || 30; return render(); }
    csv(compute(PERIOD));
  });
  window.addEventListener('fin-data-changed', function () { var pg = document.getElementById('page-pilotage'); if (pg && pg.classList.contains('active')) { try { render(); } catch (x) {} } });
  F.onPage('pilotage', function () { var pg = document.getElementById('page-pilotage'); if (pg && !document.getElementById('pilotage-root')) { var d = document.createElement('div'); d.id = 'pilotage-root'; pg.appendChild(d); } render(); });
  F.pilotage = { compute: compute, render: render };
})();
