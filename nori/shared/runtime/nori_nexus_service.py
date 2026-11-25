"""Supervised NORI Nexus mutual-TLS node service.

The service is intentionally configuration-gated. Packaging it does not open a
listener: an operator or installer must provision a household, CA, certificate,
and protected private key first.
"""
from dataclasses import dataclass
import ipaddress
import os
from pathlib import Path
import re

from node_enrollment import EnrollmentStore
from node_model_bridge import LocalModelBridge
from node_transport import enrollment_server, tls_context


@dataclass(frozen=True)
class NexusConfig:
    role: str
    household: str
    principal: str
    bind: str
    port: int
    database: Path
    certificate: Path
    private_key: Path
    authority: Path
    model_port: int
    ready_file: Path


def _port(value, name):
    if not isinstance(value, str) or not value.isdigit():
        raise ValueError(f'{name} must be a decimal port')
    port = int(value)
    if not 1 <= port <= 65535:
        raise ValueError(f'{name} must be 1..65535')
    return port


def config_from_env(environment=None):
    env = os.environ if environment is None else environment
    role = env.get('NORI_NEXUS_ROLE', '')
    if role not in ('home', 'server', 'robotics'):
        raise ValueError('NORI_NEXUS_ROLE must be home, server, or robotics')
    household = env.get('NORI_HOUSEHOLD_ID', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', household):
        raise ValueError('NORI_HOUSEHOLD_ID is invalid')
    principal = env.get('NORI_OPERATOR_PRINCIPAL', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,63}', principal):
        raise ValueError('NORI_OPERATOR_PRINCIPAL is invalid')
    bind = env.get('NORI_NEXUS_BIND', '127.0.0.1')
    try:
        ipaddress.ip_address(bind)
    except ValueError as error:
        raise ValueError('NORI_NEXUS_BIND must be an IP address') from error
    paths = {
        'database': Path(env.get('NORI_NEXUS_DATABASE', '/var/lib/nori/nexus/peers.db')),
        'certificate': Path(env.get('NORI_NEXUS_CERTIFICATE', '/etc/nori/nexus/node.pem')),
        'private_key': Path(env.get('NORI_NEXUS_PRIVATE_KEY', '/etc/nori/nexus/node.key')),
        'authority': Path(env.get('NORI_NEXUS_AUTHORITY', '/etc/nori/nexus/household-ca.pem')),
        'ready_file': Path(env.get('NORI_NEXUS_READY_FILE', '/run/nori-nexus.ready')),
    }
    for name in ('certificate', 'private_key', 'authority'):
        path = paths[name]
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Nexus {name.replace("_", " ")} is missing or unsafe')
    if os.name == 'posix' and paths['private_key'].stat().st_mode & 0o077:
        raise PermissionError('Nexus private key must not be group/world accessible')
    return NexusConfig(role, household, principal, bind,
                       _port(env.get('NORI_NEXUS_PORT', '9443'), 'NORI_NEXUS_PORT'),
                       paths['database'], paths['certificate'], paths['private_key'],
                       paths['authority'],
                       _port(env.get('NORI_MODEL_PORT', '9391'), 'NORI_MODEL_PORT'),
                       paths['ready_file'])


def run(config):
    config.database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    store = EnrollmentStore(config.database, config.household, config.principal)
    context = tls_context(config.certificate, config.private_key, config.authority, server=True)
    server = enrollment_server((config.bind, config.port), context, store,
                               LocalModelBridge(config.model_port))
    config.ready_file.parent.mkdir(parents=True, exist_ok=True)
    config.ready_file.write_text(f'{config.role} {config.bind}:{config.port}\n', encoding='ascii')
    try:
        server.serve_forever()
    finally:
        config.ready_file.unlink(missing_ok=True)
        server.server_close()


if __name__ == '__main__':
    run(config_from_env())
