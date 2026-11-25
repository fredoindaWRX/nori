"""Conservative command grammar, not a shell sandbox."""
import shlex
import re

ALLOWED={'pwd','whoami','date','uname','echo','printf'}

def filter_command(command):
    if not isinstance(command,str) or not command.strip() or len(command)>2000:
        raise ValueError('Invalid command')
    if re.search(r'[;&|<>`$\n\r\x00]',command):raise PermissionError('Shell chaining, expansion and redirection are disabled')
    args=shlex.split(command,posix=True)
    if not args or args[0] not in ALLOWED:raise PermissionError('Command is not in the executor allowlist')
    return args
