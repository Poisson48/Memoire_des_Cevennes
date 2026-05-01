// Compteur de visites — léger, pas de tracking individuel.
//
// Persistance : data/visits.json ne stocke qu'un compte par jour calendaire
//   { days: { "YYYY-MM-DD": <visites uniques>, ... }, updatedAt }
//
// Mémoire : Map<sessionId, { lastSeen, lastDay }> pour
//   1) dédupliquer (un même sessionId ne compte qu'une fois par jour)
//   2) calculer "en ligne maintenant" (sessions vues dans les 5 dernières min).
//
// Le sessionId est fourni par le client (UUID stocké en localStorage). S'il
// est absent ou invalide, on en génère un nouveau côté serveur et on le
// renvoie.

'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'visits.json');

const ONLINE_WINDOW_MS = 5 * 60 * 1000;       // 5 min : "en ligne maintenant"
const SESSION_TTL_MS   = 24 * 60 * 60 * 1000; // 24 h : oubli en mémoire
const KEEP_DAYS        = 90;                   // rétention sur disque
const SAVE_DEBOUNCE_MS = 5_000;

const sessions = new Map(); // sessionId → { lastSeen, lastDay }
let db = { days: {}, updatedAt: null };
let saveTimer = null;

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.days && typeof parsed.days === 'object') {
      db = { days: parsed.days, updatedAt: parsed.updatedAt || null };
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('visits: lecture échouée', e.message);
  }
}

function saveToDisk() {
  try {
    db.updatedAt = new Date().toISOString();
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.warn('visits: écriture échouée', e.message);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToDisk();
  }, SAVE_DEBOUNCE_MS);
  if (saveTimer.unref) saveTimer.unref();
}

function todayKey(now = new Date()) {
  // YYYY-MM-DD au fuseau local (Europe/Paris en pratique sur la machine).
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pruneOldDays() {
  const keep = new Set();
  const now = new Date();
  for (let i = 0; i < KEEP_DAYS; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keep.add(todayKey(d));
  }
  let changed = false;
  for (const k of Object.keys(db.days)) {
    if (!keep.has(k)) {
      delete db.days[k];
      changed = true;
    }
  }
  return changed;
}

function pruneOldSessions(now = Date.now()) {
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > SESSION_TTL_MS) sessions.delete(id);
  }
}

function isValidSessionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

// Enregistre un battement de cœur. Retourne { sessionId, isNewToday }.
function heartbeat(rawSessionId) {
  const now = Date.now();
  const today = todayKey();

  let sessionId = isValidSessionId(rawSessionId) ? rawSessionId : null;
  if (!sessionId) sessionId = randomUUID().replace(/-/g, '').slice(0, 24);

  const prev = sessions.get(sessionId);
  let isNewToday = false;

  if (!prev || prev.lastDay !== today) {
    db.days[today] = (db.days[today] || 0) + 1;
    isNewToday = true;
    pruneOldDays();
    scheduleSave();
  }

  sessions.set(sessionId, { lastSeen: now, lastDay: today });

  // Nettoyage opportuniste (1 fois sur ~50).
  if (Math.random() < 0.02) pruneOldSessions(now);

  return { sessionId, isNewToday };
}

// Stats publiques : { today, week, online, days: [{date, count}, ...] }
function stats() {
  const now = Date.now();
  pruneOldSessions(now);

  const today = todayKey();
  const todayCount = db.days[today] || 0;

  let weekCount = 0;
  const weekDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = todayKey(d);
    const c = db.days[k] || 0;
    weekCount += c;
    weekDays.push({ date: k, count: c });
  }

  let online = 0;
  for (const s of sessions.values()) {
    if (now - s.lastSeen <= ONLINE_WINDOW_MS) online++;
  }

  return { today: todayCount, week: weekCount, online, days: weekDays };
}

loadFromDisk();

module.exports = { heartbeat, stats, _todayKey: todayKey };
