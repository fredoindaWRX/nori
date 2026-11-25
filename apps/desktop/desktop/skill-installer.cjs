// Native, owner-reviewed instruction installation. Package scripts never run.
const { execFile } = require('node:child_process')
const { existsSync, lstatSync, realpathSync, readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { resolve, join, extname, relative, isAbsolute } = require('node:path')

function physicalFile(file) {
  const expected = resolve(file)
  if (!existsSync(expected) || !lstatSync(expected).isFile() || lstatSync(expected).isSymbolicLink()
      || realpathSync(expected).toLowerCase() !== expected.toLowerCase()) throw new Error('A physical local file is required.')
  return expected
}

function physicalFileUnder(directory, file) {
  const expectedRoot = resolve(directory)
  const root = realpathSync(expectedRoot)
  if (root.toLowerCase() !== expectedRoot.toLowerCase()) throw new Error('Nori skill quarantine cannot use redirected paths.')
  const candidate = physicalFile(file)
  const actual = realpathSync(candidate)
  const rel = relative(root, actual)
  if (!rel || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error('GitHub intake files must stay inside Nori skill quarantine.')
  }
  return candidate
}

function isPublicGithubSkillUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    const url = new URL(value)
    const parts = url.pathname.split('/').filter(Boolean)
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com'
      && !url.username && !url.password && !url.search && !url.hash
      && parts.length >= 5 && /^[A-Za-z0-9_.-]{1,100}$/.test(parts[0])
      && /^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) && ['tree', 'blob'].includes(parts[2])
  } catch { return false }
}

function createSkillInstaller({ suiteRoot, dataRoot, dialog, getWindow = () => null, runFile = execFile }) {
  const root = resolve(suiteRoot), store = join(resolve(dataRoot), 'skills')
  const python = join(root, 'python', 'Python311', 'python.exe')
  const script = join(root, 'nori', 'local_skill_installer.py')
  const githubScript = join(root, 'nori', 'github_skill_intake.py')
  let busy = false
  const modal = (method, options) => {
    const window = getWindow()
    return window ? dialog[method](window, options) : dialog[method](options)
  }
  const runWorker = (scriptPath, command, args = [], timeoutMs = 30000) => new Promise((done, fail) => {
    let executable, entry
    try { executable = physicalFile(python); entry = physicalFile(scriptPath) } catch (error) { fail(error); return }
    runFile(executable, ['-I', entry, command, ...args], {
      cwd: root, shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' },
    }, (error, stdout) => {
      let value
      try { value = JSON.parse(String(stdout)) } catch { fail(new Error('The local skill worker returned no valid receipt.')); return }
      if (error || value.error) fail(new Error(String(value.error || 'The local skill worker failed.').slice(0, 500)))
      else done(value)
    })
  })
  const run = (command, args = []) => runWorker(script, command, args)
  const runGithub = (command, args = []) => runWorker(githubScript, command, args, 60000)
  const sha256 = data => createHash('sha256').update(data).digest('hex')

  // direct: the owner named this package in their own chat message, and chose (2026-11-15) to skip
  // the review window for that case. Validation, the instruction-only rule and the reload check stay.
  async function installGithub(url, { direct = false } = {}) {
    if (!isPublicGithubSkillUrl(url)) throw new Error('Use one direct HTTPS GitHub skill-folder or SKILL.md link.')
    const prepared = await runGithub('prepare', ['--url', url, '--data-root', resolve(dataRoot)])
    if (prepared.schema !== 'nori.github-skill-preview.v1' || prepared.status !== 'quarantined'
        || prepared.activation_authorized !== false || prepared.code_executed !== false
        || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(prepared.revision)
        || !/^[a-f0-9]{64}$/.test(prepared.archive_sha256)
        || !/^[a-f0-9]{64}$/.test(prepared.skill_sha256)
        || !/^[a-f0-9]{64}$/.test(prepared.license_sha256)) {
      throw new Error('GitHub intake did not return a complete, pinned, text-only review receipt.')
    }
    const quarantineRoot = join(store, 'quarantine')
    const archive = physicalFileUnder(quarantineRoot, prepared.package_zip)
    const sourceMetadata = physicalFileUnder(quarantineRoot, prepared.source_metadata)
    if (sha256(readFileSync(archive)) !== prepared.package_zip_sha256
        || sha256(readFileSync(sourceMetadata)) !== prepared.source_metadata_sha256) {
      throw new Error('GitHub quarantine content changed before review.')
    }
    const plan = await run('inspect', ['--archive', archive, '--source-metadata', sourceMetadata])
    if (sha256(readFileSync(archive)) !== prepared.package_zip_sha256
        || sha256(readFileSync(sourceMetadata)) !== prepared.source_metadata_sha256) {
      throw new Error('GitHub quarantine content changed during preview inspection.')
    }
    const provenance = plan.source_provenance
    if (plan.schema !== 'nori.local-skill-plan.v1' || plan.source_kind !== 'github'
        || !/^[a-f0-9]{64}$/.test(plan.plan_sha256) || !Array.isArray(plan.skills) || plan.skills.length !== 1
        || plan.skills[0].name !== prepared.skill_name || plan.skills[0].code_execution_enabled !== false
        || !provenance || provenance.repository !== prepared.repository || provenance.revision !== prepared.revision
        || provenance.archive_sha256 !== prepared.archive_sha256 || provenance.skill_sha256 !== prepared.skill_sha256
        || provenance.license_sha256 !== prepared.license_sha256) {
      throw new Error('GitHub preview did not match the pinned skill, license, and source receipt.')
    }
    const skillPreview = String(prepared.skill_markdown_preview || '')
      + (prepared.skill_markdown_truncated ? '\n[Preview truncated; the exact reviewed source remains in quarantine.]' : '')
    const licensePreview = String(prepared.license_preview || '')
      + (prepared.license_truncated ? '\n[License preview truncated; the exact license remains in quarantine.]' : '')
    const detail = [
      `Repository: ${prepared.repository}`,
      `Skill folder: ${prepared.skill_path}`,
      `Resolved immutable commit: ${prepared.revision}`,
      `Repository archive SHA-256: ${prepared.archive_sha256}`,
      `SKILL.md SHA-256: ${prepared.skill_sha256}`,
      `License: ${prepared.license_path} (SHA-256 ${prepared.license_sha256})`,
      `Skill: ${prepared.skill_name}`,
      `Description: ${prepared.description}`,
      `Quarantined source: ${prepared.quarantine_dir}`,
      '', '--- SKILL.md preview ---', skillPreview,
      '', '--- License preview ---', licensePreview,
      '', 'Only UTF-8 text/reference files are accepted. Scripts, binaries, dependency hooks, and downloaded-code execution are refused. Nori permissions are unchanged.',
    ].join('\n')
    const review = direct ? { response: 1 } : await modal('showMessageBox', {
      type: 'question', title: 'Review GitHub skill for Nori',
      message: `Install “${prepared.skill_name}” from ${prepared.repository}?`,
      detail, buttons: ['Cancel', 'Install instructions'], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (review.response !== 1) return { outcome: 'cancelled', installed: false, source_kind: 'github',
      quarantined: true, quarantine_path: prepared.quarantine_dir, code_executed: false }
    const receipt = await run('install', ['--archive', archive, '--store', store,
      '--reviewed-plan-sha256', plan.plan_sha256, '--source-metadata', sourceMetadata])
    if (receipt.installed !== true || receipt.code_executed !== false || receipt.source_kind !== 'github'
        || !Array.isArray(receipt.skills) || receipt.skills.length !== 1
        || receipt.skills[0] !== prepared.skill_name || receipt.source_provenance?.repository !== prepared.repository
        || receipt.source_provenance?.revision !== prepared.revision
        || receipt.source_provenance?.archive_sha256 !== prepared.archive_sha256) {
      throw new Error('The installer did not confirm the reviewed GitHub source and skill.')
    }
    const catalog = await run('list', ['--store', store])
    const installed = Array.isArray(catalog.skills) && catalog.skills.find(skill => skill.name === prepared.skill_name)
    if (catalog.schema !== 'nori.instruction-skill-catalog.v1' || catalog.verified !== true
        || !installed || installed.mode !== 'instruction_reference' || installed.code_execution_enabled !== false
        || installed.source_kind !== 'github' || installed.source_provenance?.repository !== prepared.repository
        || installed.source_provenance?.revision !== prepared.revision
        || installed.source_provenance?.archive_sha256 !== prepared.archive_sha256) {
      throw new Error('GitHub skill was installed, but its content or source provenance did not reload and verify.')
    }
    if (!direct) await modal('showMessageBox', { type: 'info', title: 'Nori GitHub skill installed and verified',
      message: `${prepared.skill_name} installed and verified`,
      detail: `Source: ${prepared.repository}@${prepared.revision}\nLicense: ${prepared.license_path}\n\nThe text-only skill and provenance were reloaded and verified. No package code was executed or permissions changed.`,
      buttons: ['OK'] })
    return { ...receipt, outcome: 'installed', readiness: 'instruction-files-verified',
      post_install_verified: true, live_task_tested: false, review: direct ? 'skipped_owner_request' : 'owner_approved' }
  }

  async function install(archivePath, { direct = false } = {}) {
    if (busy) throw new Error('Finish the current skill review first.')
    busy = true
    try {
      if (direct && !archivePath) throw new Error('A direct install needs one ZIP path or GitHub link.')
      if (!archivePath) {
        const selected = await modal('showOpenDialog', { title: 'Install Nori instruction skills',
          properties: ['openFile'], filters: [{ name: 'Skill packages', extensions: ['zip'] }] })
        if (selected.canceled || selected.filePaths.length !== 1) return { outcome: 'cancelled', installed: false }
        archivePath = selected.filePaths[0]
      }
      if (typeof archivePath === 'string' && /^https?:\/\//i.test(archivePath)) {
        return await installGithub(archivePath, { direct })
      }
      if (typeof archivePath !== 'string' || !isAbsolute(archivePath) || extname(archivePath).toLowerCase() !== '.zip'
          || archivePath.startsWith('\\\\')) throw new Error('Choose one local ZIP skill package.')
      const archive = physicalFile(archivePath)
      const plan = await run('inspect', ['--archive', archive])
      if (plan.schema !== 'nori.local-skill-plan.v1' || !/^[a-f0-9]{64}$/.test(plan.plan_sha256)
          || !Array.isArray(plan.skills) || plan.skills.length < 1 || plan.skills.length > 32
          || plan.skills.some(s => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.name) || s.code_execution_enabled !== false)) {
        throw new Error('The skill preview is incomplete; nothing was installed.')
      }
      const names = plan.skills.map(s => s.name)
      const review = direct ? { response: 1 } : await modal('showMessageBox', {
        type: 'question', title: 'Review Nori skill installation',
        message: `Install ${names.length} instruction skill${names.length === 1 ? '' : 's'}?`,
        detail: `Source: ${archive}\n\n${plan.skills.map(s => `${s.name}\n${String(s.description).slice(0, 240)}`).join('\n\n')}\n\nThese are instruction references. Bundled scripts are copied but never run by installation. Existing tool permissions stay in force.`,
        buttons: ['Cancel', 'Install instructions'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (review.response !== 1) return { outcome: 'cancelled', installed: false }
      const receipt = await run('install', ['--archive', archive, '--store', store, '--reviewed-plan-sha256', plan.plan_sha256])
      if (receipt.installed !== true || receipt.code_executed !== false || !Array.isArray(receipt.skills)
          || JSON.stringify([...receipt.skills].sort()) !== JSON.stringify([...names].sort())) {
        throw new Error('The worker did not confirm the reviewed skill set.')
      }
      let catalog
      try { catalog = await run('list', ['--store', store]) } catch (error) {
        throw new Error(`Skills were installed, but post-install verification failed: ${error.message}`)
      }
      if (catalog.schema !== 'nori.instruction-skill-catalog.v1' || catalog.verified !== true
          || !Array.isArray(catalog.skills) || names.some(name => !catalog.skills.some(skill =>
            skill.name === name && skill.mode === 'instruction_reference' && skill.code_execution_enabled === false))) {
        throw new Error('Skills were installed, but the reviewed skills could not be reloaded and verified.')
      }
      if (!direct) await modal('showMessageBox', { type: 'info', title: 'Nori skills installed and verified',
        message: `${names.length} instruction skills installed and verified`,
        detail: `${names.join('\n')}\n\nInstalled files were reloaded and verified. No package scripts were run. A live assistant task has not been tested.`, buttons: ['OK'] })
      return { ...receipt, outcome: 'installed', readiness: 'instruction-files-verified',
        post_install_verified: true, live_task_tested: false, review: direct ? 'skipped_owner_request' : 'owner_approved' }
    } finally { busy = false }
  }
  async function showInstalled() {
    const result = await run('list', ['--store', store])
    if (result.schema !== 'nori.instruction-skill-catalog.v1' || result.verified !== true || !Array.isArray(result.skills)) {
      throw new Error('Nori could not verify her installed skill library.')
    }
    await modal('showMessageBox', { type: 'info', title: 'Nori instruction skills',
      message: `${result.skills.length} verified instruction skills`,
      detail: result.skills.map(s => {
        const source = s.source_kind === 'github'
          ? `GitHub: ${s.source_provenance?.repository}@${s.source_provenance?.revision}` : 'Local ZIP'
        return `${s.name}\n${s.description}\nSource: ${source}`
      }).join('\n\n') || 'No instruction skills installed yet.', buttons: ['OK'] })
    return result
  }
  return { install, showInstalled, store }
}

module.exports = { createSkillInstaller }
