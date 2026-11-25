"""Local administrative boundary for NORI Nexus invitations and revocation."""
import argparse
import os
from pathlib import Path

from node_enrollment import EnrollmentStore


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', default='/var/lib/nori/nexus/peers.db')
    parser.add_argument('--household', required=True)
    parser.add_argument('--principal', required=True)
    commands = parser.add_subparsers(dest='command', required=True)
    issue = commands.add_parser('invite')
    issue.add_argument('--node', required=True)
    issue.add_argument('--fingerprint', required=True)
    issue.add_argument('--ttl', type=int, default=300)
    revoke = commands.add_parser('revoke')
    revoke.add_argument('--node', required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    store = EnrollmentStore(Path(args.database), args.household, args.principal)
    if args.command == 'invite':
        print(store.issue(args.node, args.fingerprint, args.ttl))
    else:
        store.revoke(args.node)
        print(f'revoked {args.node}')


if __name__ == '__main__':
    main()
