# Agent Smith — typed executor

AgentSmith.run(request, session) authenticates through the host callback and executes
explicit tool requests. Tools: bash, python_exec, file_ops, api_call and cron. There is
no model-generated shell planning. Phi-4 is the declared model but is not called by the
deterministic executor; live Phi-4 execution interpretation is deliberately not included.

Python scripts must exist in the workspace and match a SHA-256 supplied in approved_scripts
by the host. Smith executes the checked snapshot with a timeout and output limit. This
is approval of trusted code, NOT a Python sandbox. Scripts can access host resources.
Bash requires an explicit compatible executable path. The built-in allowlist supports
pwd, whoami, date, uname, echo, printf; chaining, redirection, expansion and other commands
are rejected. This is narrower than a general-purpose unrestricted terminal.

file_ops supports bounded text read, non-overwriting copy, and single-file deletion within
the workspace. No recursive deletion, raw-disk writing or general code-generation tool.
api_call supports GET/POST to host-approved origins, denies redirects, and limits body,
response size and timeout. The host must authorize side effects in the request.

Pass Sentinel's kill_switch.active as killed. Running child processes are polled every
50ms and termination uses a process group on POSIX or taskkill /T on Windows. Escaped or
reparented descendants require a stronger OS supervisor. File operations are guarded before
execution; API calls are guarded before/after. In-flight remote effects cannot be undone
or guaranteed to stop immediately. This is not a universal hard real-time kill guarantee.

cron is a persistent interval scheduler, not system crontab syntax. A host scheduler calls
run_due; there is no background timer automatically installed. Only Python/Bash jobs are
accepted; execution rechecks script hashes/filters and the kill switch. Crashed jobs remain
running for supervisor recovery to avoid automatic duplicate side effects. Schedule creation
is authenticated, but the scheduler must also stop jobs when the originating session is revoked.

Twelve tests passed, including actual script execution, live process cancellation, scheduled
execution, changed-script rejection, command filtering and file/API scope checks. Bash and
remote API execution were not live-tested. Existing shared Smith HTTP worker remains unchanged.
