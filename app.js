// Page opérateur : reçoit les messages du serveur en direct (/flux) et tient l'affichage à jour.

const LIBELLES_ACTIONS = {
  expert_type: "Identification du type",
  expert_ocr: "Lecture de l'immatriculation",
  approche: "Approche",
  alerte_complete: "Alerte complète",
  alerte_partielle: "Alerte partielle",
};
const LIBELLES_MODES = { patrouille: "Patrouille", approche: "Approche" };
const TAILLE_JOURNAL = 200;

// Adresse du serveur de la station sol. Vide quand c'est lui qui sert cette page. Quand la page est
// hébergée ailleurs (GitHub Pages), c'est le serveur lancé sur cet ordinateur, ou celui donné par
// ?serveur=http://hote:port dans l'adresse.
const SERVEUR = (new URLSearchParams(location.search).get("serveur")
  ?? (location.protocol === "https:" ? "http://localhost:8000" : "")).replace(/\/$/, "");

let etat;
let alertesDejaVues = 0;
let renduPrevu = false;

function vider() {
  etat = { drone: null, navires: new Map(), alertes: [], journal: [], dernierT: null };
  alertesDejaVues = 0;
}

function navire(id) {
  if (!etat.navires.has(id)) {
    etat.navires.set(id, { id, action: null, raison: "", types: [], immatriculation: null, confiance: null, t: null });
  }
  return etat.navires.get(id);
}

function traiter(message) {
  etat.journal.push(message);
  if (etat.journal.length > TAILLE_JOURNAL) etat.journal.shift();
  etat.dernierT = message.t;

  if (message.genre === "etat") {
    etat.drone = message;
  } else {
    const n = navire(message.id_piste);
    n.t = message.t;
    if (message.genre === "decision") {
      n.action = message.action;
      n.raison = message.raison;
    } else if (message.genre === "alerte") {
      n.action = message.complete ? "alerte_complete" : "alerte_partielle";
      n.raison = message.raison;
      n.types = message.types;
      n.immatriculation = message.immatriculation;
      n.confiance = message.confiance_immatriculation;
      etat.alertes.push(message);
    }
  }
  prevoirRendu();
}

// Plusieurs messages peuvent arriver d'un coup (historique) : un seul rendu par image.
function prevoirRendu() {
  if (renduPrevu) return;
  renduPrevu = true;
  requestAnimationFrame(() => { renduPrevu = false; rendre(); });
}

// Petit utilitaire pour créer des éléments sans innerHTML (le texte vient du réseau).
function el(balise, classe, ...enfants) {
  const noeud = document.createElement(balise);
  if (classe) noeud.className = classe;
  for (const enfant of enfants) {
    if (enfant === null || enfant === undefined) continue;
    noeud.append(enfant instanceof Node ? enfant : String(enfant));
  }
  return noeud;
}

const $ = (id) => document.getElementById(id);
const pourcent = (x) => `${Math.round(x * 100)} %`;
const secondes = (t) => (t === null || t === undefined ? "—" : `${t.toFixed(1)} s`);
const types = (liste) => (liste.length ? liste.join(" ou ") : "inconnu");

function niveau(valeur, seuilAttention, seuilDanger, croissant) {
  if (croissant ? valeur >= seuilDanger : valeur <= seuilDanger) return "danger";
  if (croissant ? valeur >= seuilAttention : valeur <= seuilAttention) return "attention";
  return "";
}

function rendreDrone() {
  const d = etat.drone;
  $("mode").textContent = d ? LIBELLES_MODES[d.mode] ?? d.mode : "—";
  $("navires-suivis").textContent = d ? d.navires_suivis : "—";
  $("dernier-t").textContent = secondes(etat.dernierT);

  const batterie = $("batterie");
  const jauge = $("batterie-jauge");
  batterie.textContent = d ? pourcent(d.batterie) : "—";
  batterie.className = "valeur " + (d ? niveau(d.batterie, 0.3, 0.15, false) : "");
  jauge.style.width = d ? pourcent(d.batterie).replace(" ", "") : "0";
  jauge.className = d ? niveau(d.batterie, 0.3, 0.15, false) : "";

  const temperature = $("temperature");
  // temperature_pi vaut null quand la chaîne ne tourne pas sur le Pi.
  const mesuree = d && d.temperature_pi !== null;
  temperature.textContent = mesuree ? `${d.temperature_pi.toFixed(1)} °C` : "—";
  temperature.className = "valeur " + (mesuree ? niveau(d.temperature_pi, 70, 80, true) : "");
}

function rendreAlertes() {
  const liste = $("alertes");
  liste.replaceChildren(...etat.alertes.slice().reverse().map((a, i) => {
    const confiance = a.confiance_immatriculation === null ? "" : ` (confiance ${pourcent(a.confiance_immatriculation)})`;
    const nouvelle = i < etat.alertes.length - alertesDejaVues;
    return el("li", `alerte ${a.complete ? "complete" : ""} ${nouvelle ? "nouvelle" : ""}`,
      el("div", "alerte-tete",
        el("span", null, `Navire n° ${a.id_piste} · ${a.complete ? "alerte complète" : "alerte partielle"}`),
        el("span", "t", secondes(a.t))),
      el("p", null, "Type : ", types(a.types)),
      el("p", null, "Immatriculation : ",
        a.immatriculation ? el("span", "immat", a.immatriculation) : "non lue", confiance),
      a.textes_lus && a.textes_lus.length ? el("p", null, "Texte lu sur la coque : ", a.textes_lus.join(", ")) : null,
      el("p", "raison", a.raison));
  }));
  alertesDejaVues = etat.alertes.length;
  $("nb-alertes").textContent = etat.alertes.length;
  $("alertes-vide").hidden = etat.alertes.length > 0;
}

function rendreNavires() {
  const navires = [...etat.navires.values()].sort((a, b) => b.t - a.t);
  // data-titre : sur un écran étroit, chaque ligne devient une fiche et la cellule affiche son intitulé.
  const cellule = (titre, classe, ...enfants) => {
    const td = el("td", classe, ...enfants);
    td.dataset.titre = titre;
    return td;
  };
  $("navires").replaceChildren(...navires.map((n) => el("tr", null,
    cellule("Piste", "num", `n° ${n.id}`),
    cellule("Situation", null,
      n.action ? el("span", `badge ${n.action}`, LIBELLES_ACTIONS[n.action] ?? n.action) : "—",
      el("span", "raison", n.raison)),
    cellule("Type", null, types(n.types)),
    cellule("Immatriculation", null, n.immatriculation ? el("span", "immat", n.immatriculation) : "—",
      n.confiance === null ? null : el("span", "raison", `confiance ${pourcent(n.confiance)}`)),
    cellule("Vu à", "num", secondes(n.t)))));
  $("nb-navires").textContent = navires.length;
  $("navires-vide").hidden = navires.length > 0;
}

function rendreJournal() {
  $("journal").replaceChildren(...etat.journal.slice().reverse().map((m) => {
    const { genre, t, ...reste } = m;
    return el("li", null, `${secondes(t).padStart(8)}  `, el("span", `genre ${genre}`, genre.padEnd(9)),
      JSON.stringify(reste));
  }));
}

function rendre() {
  rendreDrone();
  rendreAlertes();
  rendreNavires();
  rendreJournal();
}

function connecter() {
  const flux = new EventSource(SERVEUR + "/flux");
  const connexion = $("connexion");
  flux.onopen = () => {
    connexion.className = "connexion en-ligne";
    $("connexion-texte").textContent = "connecté au serveur";
  };
  flux.onerror = () => {
    connexion.className = "connexion hors-ligne";
    $("connexion-texte").textContent = "serveur injoignable, nouvelle tentative…";
  };
  flux.addEventListener("reinit", () => { vider(); prevoirRendu(); });
  flux.addEventListener("message", (e) => traiter(JSON.parse(e.data)));
}

vider();
rendre();
connecter();
