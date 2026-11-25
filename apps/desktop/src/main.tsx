import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Workspace } from './workspace/Workspace'
import { useStore } from './store'

// The explicit main-process acceptance session creates only synthetic panels.
// It denies sensors and uses disposable state; normal desktop boot is unchanged.
if (window.noriConnection?.workspaceProbe) {
  useStore.getState().setPhase('dormant')
  useStore.getState().setMuted(true)
  useStore.getState().setSettingsOpen(true)
  for (const [index,title] of ['Workspace test panel A','Workspace test panel B'].entries()) {
    useStore.getState().pushBlade({id:`workspace-fixture-${index}`,kind:'markup',title,
      html:'<p>Synthetic workspace fixture. Drag this panel between displays.</p>',size:'wide',hold:'sticky'})
  }
}

// Deliberately no StrictMode: its double-invoked effects would open the
// microphone and arm the wake-word engine twice, and the second subscription
// steals the audio stream from the first.
createRoot(document.getElementById('root')!).render(<><App /><Workspace /></>)
