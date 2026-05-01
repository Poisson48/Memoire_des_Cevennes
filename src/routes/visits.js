// Routes /api/visits — compteur public, anonyme.
//   POST /api/visits/heartbeat { sessionId? } → { sessionId, online }
//   GET  /api/visits/stats                    → { today, week, online, days }
'use strict';

const express = require('express');
const visits = require('../visits');

const router = express.Router();

router.post('/heartbeat', (req, res) => {
  const { sessionId } = req.body || {};
  const out = visits.heartbeat(sessionId);
  const s = visits.stats();
  res.json({ sessionId: out.sessionId, online: s.online });
});

router.get('/stats', (_req, res) => {
  res.json(visits.stats());
});

module.exports = router;
