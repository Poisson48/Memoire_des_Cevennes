// Mémoire des Cévennes — admin / boot
// Bascule des onglets + ping initial. Chargé EN DERNIER pour que toutes
// les fonctions refreshXxx() soient déjà définies dans le scope global.

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab || 'queue';
    if (btn.dataset.filter) currentFilter = btn.dataset.filter;
    queueSection.hidden    = currentTab !== 'queue';
    if (aliasesSection)  aliasesSection.hidden  = currentTab !== 'aliases';
    membersSection.hidden  = currentTab !== 'members';
    if (resetsSection)  resetsSection.hidden  = currentTab !== 'resets';
    activitySection.hidden = currentTab !== 'activity';
    if (backupsSection) backupsSection.hidden = currentTab !== 'backups';
    if (welcomeSection) welcomeSection.hidden = currentTab !== 'welcome';
    if (settingsSection) settingsSection.hidden = currentTab !== 'settings';
    if (cadastreSection) cadastreSection.hidden = currentTab !== 'cadastre';
    if (helpSection)    helpSection.hidden    = currentTab !== 'help';
    if (currentTab === 'queue')    renderQueue(lastQueue);
    if (currentTab === 'aliases')  refreshAliases();
    if (currentTab === 'members')  refreshMembers();
    if (currentTab === 'resets')   refreshResets();
    if (currentTab === 'activity') refreshActivity();
    if (currentTab === 'backups')  refreshBackups();
    if (currentTab === 'welcome')  refreshWelcome();
    if (currentTab === 'settings') refreshSettings();
    if (currentTab === 'cadastre' && window.cadastreCalibrationActivate) {
      window.cadastreCalibrationActivate();
    }
  });
});

// Tentative de session existante : soit le token partagé en localStorage,
// soit le cookie admin_jwt (httpOnly, transmis automatiquement). On
// pingue /queue avec authFetchOpts(), si ça passe → dashboard.
fetchJson('/api/admin/queue', authFetchOpts())
  .then(showDashboard)
  .catch(() => showLogin());
