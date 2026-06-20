'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const audience = require('../src/audience');

// --- audienceOf ----------------------------------------------------------
test('audienceOf : public / member / admin', () => {
  assert.equal(audience.audienceOf({}), 'public');
  assert.equal(audience.audienceOf({ member: { role: 'member' } }), 'member');
  assert.equal(audience.audienceOf({ member: { role: 'admin' } }), 'admin');
  // membre sans role explicite => member
  assert.equal(audience.audienceOf({ member: {} }), 'member');
});

test('audienceOf : ADMIN_TOKEN via header', () => {
  const prev = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'secret-xyz';
  const req = { get: (h) => (h.toLowerCase() === 'x-admin-token' ? 'secret-xyz' : null) };
  assert.equal(audience.audienceOf(req), 'admin');
  process.env.ADMIN_TOKEN = prev;
});

// --- visibilite enregistrement ------------------------------------------
test('visibleStories : public ne voit que public+approved', () => {
  const stories = [
    { id: 'a', visibility: 'public', status: 'approved' },
    { id: 'b', visibility: 'members', status: 'approved' },
    { id: 'c', visibility: 'public', status: 'pending' },
  ];
  assert.deepEqual(audience.visibleStories(stories, 'public').map(s => s.id), ['a']);
  assert.deepEqual(audience.visibleStories(stories, 'member').map(s => s.id), ['a', 'b']);
  assert.deepEqual(audience.visibleStories(stories, 'admin').map(s => s.id), ['a', 'b']);
});

// --- redactions ----------------------------------------------------------
const BODY = 'Jean Dupont habite ici depuis 1950.';
//            0123456789...   "Jean Dupont" = [0,11)
const REDS = [
  { id: 'r1', start: 0, end: 11, mode: 'anonymize', hideBelow: 'member', replacement: 'un habitant' },
];

test('applyRedactions : public voit redige, member/admin voient original', () => {
  assert.equal(audience.applyRedactions(BODY, REDS, 'public'), 'un habitant habite ici depuis 1950.');
  assert.equal(audience.applyRedactions(BODY, REDS, 'member'), BODY);
  assert.equal(audience.applyRedactions(BODY, REDS, 'admin'), BODY);
});

test('applyRedactions : hideBelow admin masque aussi pour les membres', () => {
  const reds = [{ start: 0, end: 11, mode: 'censor', hideBelow: 'admin' }];
  assert.equal(audience.applyRedactions(BODY, reds, 'public'), '[passage masqué] habite ici depuis 1950.');
  assert.equal(audience.applyRedactions(BODY, reds, 'member'), '[passage masqué] habite ici depuis 1950.');
  assert.equal(audience.applyRedactions(BODY, reds, 'admin'), BODY);
});

test('applyRedactions : plusieurs spans, ordre preserve', () => {
  const body = 'AAA BBB CCC';
  const reds = [
    { start: 0, end: 3, mode: 'censor', hideBelow: 'member' },
    { start: 8, end: 11, mode: 'anonymize', hideBelow: 'member', replacement: 'xxx' },
  ];
  assert.equal(audience.applyRedactions(body, reds, 'public'), '[passage masqué] BBB xxx');
});

test('applyRedactions : spans hors bornes ou vides ignores', () => {
  const reds = [
    { start: 0, end: 999, mode: 'censor', hideBelow: 'member' }, // end > length
    { start: 5, end: 5, mode: 'censor', hideBelow: 'member' },   // vide
  ];
  assert.equal(audience.applyRedactions(BODY, reds, 'public'), BODY);
});

test('applyRedactions : chevauchement, garde le span le plus a gauche', () => {
  const body = 'ABCDEFGH';
  const reds = [
    { start: 0, end: 4, mode: 'censor', hideBelow: 'member' },
    { start: 2, end: 6, mode: 'censor', hideBelow: 'member' },
  ];
  assert.equal(audience.applyRedactions(body, reds, 'public'), '[passage masqué]EFGH');
});

test('applyRedactions : pas de redactions => texte intact', () => {
  assert.equal(audience.applyRedactions(BODY, [], 'public'), BODY);
  assert.equal(audience.applyRedactions(BODY, undefined, 'public'), BODY);
});
