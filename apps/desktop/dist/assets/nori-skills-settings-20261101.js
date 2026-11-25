(function (scope) {
  'use strict';
  const actions = Object.freeze([
    ['Import skill ZIP', 'openInstaller'],
    ['Add writing skills', 'openBundled'],
    ['View installed skills', 'showInstalled']
  ]);
  function mount(host, api, doc) {
    if (!host || host.dataset.noriSkillsMounted === 'true') return null;
    host.dataset.noriSkillsMounted = 'true';
    const section = doc.createElement('section');
    section.className = 'settings-row nori-skills-settings';
    section.setAttribute('aria-label', 'Skills');
    const title = doc.createElement('strong'); title.textContent = 'Skills';
    const note = doc.createElement('p'); note.className = 'nori-skills-note';
    note.textContent = 'Add instruction skills or review what Nori has installed.';
    const status = doc.createElement('p'); status.className = 'nori-skills-status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    section.appendChild(title); section.appendChild(note);
    let busy = false;
    const buttons = [];
    const available = actions.every(([, method]) => typeof api?.[method] === 'function');
    for (const [label, method] of actions) {
      const button = doc.createElement('button');
      button.type = 'button'; button.className = 'rail-btn nori-skills-action';
      button.textContent = label; button.disabled = !available;
      button.addEventListener('click', async () => {
        if (busy || !available) return;
        busy = true; buttons.forEach(item => { item.disabled = true; });
        section.setAttribute('aria-busy', 'true');
        status.textContent = method === 'showInstalled' ? 'Opening installed skills…' : 'Opening skill review…';
        try {
          const result = await api[method]();
          if (method === 'showInstalled') {
            status.textContent = result?.shown === true && result.verified === true &&
              Number.isSafeInteger(result.count) && result.count >= 0 && result.count <= 100000
              ? `Verified catalog opened · ${result.count} installed skill${result.count === 1 ? '' : 's'}.`
              : 'The installed catalog could not be verified.';
          } else if (result?.outcome === 'cancelled' && result.installed === false) {
            status.textContent = 'Canceled. No skill installation confirmed.';
          } else if (result?.outcome === 'installed' && result.installed === true && result.verified === true) {
            status.textContent = 'Skill files installed and verified. This does not verify a live tool capability.';
          } else {
            status.textContent = 'Skill installation could not be verified. No success is confirmed.';
          }
        } catch {
          status.textContent = 'The skill action could not be completed. Try again from Settings.';
        } finally {
          busy = false; buttons.forEach(item => { item.disabled = !available; });
          section.setAttribute('aria-busy', 'false');
        }
      });
      buttons.push(button); section.appendChild(button);
    }
    if (!available) status.textContent = 'Skill management is available in the updated Nori desktop app.';
    section.appendChild(status); host.appendChild(section);
    return {section, buttons, status};
  }
  function install(win) {
    const doc = win.document;
    if (!doc || win.__noriSkillsSettingsInstalled) return;
    win.__noriSkillsSettingsInstalled = true;
    const style = doc.createElement('style');
    style.textContent = '.nori-skills-settings{border-top:1px solid #9ce4ca25;margin-top:8px;padding-top:12px;gap:7px}.nori-skills-settings>strong{font:600 13px Segoe UI,system-ui,sans-serif;color:#d9efea}.nori-skills-settings .nori-skills-note,.nori-skills-settings .nori-skills-status{margin:0;font:11px/1.5 Segoe UI,system-ui,sans-serif;letter-spacing:normal;color:#9cabb4}.nori-skills-settings .nori-skills-action{width:100%;text-align:left;letter-spacing:normal;text-transform:none;font:12px Segoe UI,system-ui,sans-serif;padding:9px 10px}.nori-skills-settings button:disabled{opacity:.5;cursor:default}.nori-skills-status:empty{display:none}';
    doc.head.appendChild(style);
    const scan = () => { for (const host of doc.querySelectorAll('#nori-skills-settings-host')) mount(host, win.noriSkills, doc); };
    scan();
    const observer = new win.MutationObserver(scan);
    observer.observe(doc.documentElement, {subtree:true,childList:true});
    win.addEventListener('pagehide', () => observer.disconnect(), {once:true});
  }
  if (typeof module === 'object' && module.exports) module.exports = {mount, install};
  else install(scope);
})(typeof window === 'object' ? window : globalThis);
