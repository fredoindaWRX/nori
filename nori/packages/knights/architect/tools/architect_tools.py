"""Orchestration-only tools; no shell, filesystem mutation or Sentinel lifecycle control."""
from copy import deepcopy

class ArchitectTools:
    def __init__(self,agent,owner,supervisor=None):self.agent,self.owner,self.supervisor=agent,deepcopy(owner),supervisor
    def _check(self,action):
        if not self.agent._authorized(self.owner,action):raise PermissionError('Sentinel denied orchestration action')
    def task_create(self,goal):
        self._check('plan')
        return self.agent.decomposer.decompose(goal,self.agent.router.contracts())
    def crew_dispatch(self,goal):return self.agent.run(goal,self.owner)
    def task_status(self,run_id,task_id):
        self._check('status');return self.agent.tracker.task_status(run_id,task_id)
    def progress_track(self,run_id):
        self._check('status');return self.agent.progress(run_id)
    def agent_status(self):
        self._check('status')
        if self.supervisor:return self.supervisor.status()
        return {'registered':sorted({r.knight for routes in self.agent.router.routes.values() for r in routes}),'live_status':'supervisor_unconfigured'}
    def _lifecycle(self,action,knight):
        if not isinstance(knight,str):raise ValueError('Knight required')
        normalized=knight.strip().casefold().replace('the ','')
        if normalized in {'sentinel','architect'}:raise PermissionError('Protected lifecycle target')
        registered={r.knight for routes in self.agent.router.routes.values() for r in routes}
        if knight not in registered:raise ValueError('Unregistered Knight')
        self._check(action+':'+knight)
        if not self.supervisor:raise RuntimeError('Host supervisor required')
        return getattr(self.supervisor,action)(knight)
    def agent_spawn(self,knight):return self._lifecycle('spawn',knight)
    def agent_terminate(self,knight):return self._lifecycle('terminate',knight)
