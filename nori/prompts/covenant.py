"""One prompt loader for all live council workers.

Identity text is not authentication or a tool permission engine. An unset owner
is explicitly represented as pending activation, never as a verified identity.
"""
from hashlib import sha256
from pathlib import Path
import re
from nori_installation_paths import core_installation_root

ROOT = core_installation_root(Path(__file__).resolve().parent.parent) / 'prompts'
NAMES = {
    'sentinel': 'The Sentinel', 'architect': 'The Architect',
    'machine': 'The Machine', 'merovingian': 'The Merovingian',
    'oracle': 'The Oracle', 'tank': 'Tank', 'smith': 'Agent Smith',
    'neo': 'Neo', 'trinity': 'Trinity', 'morpheus': 'Morpheus',
    'apoc': 'Apoc', 'keymaker': 'The Keymaker',
}

OWNER_FACING_PERSONA = """

OWNER-FACING CONVERSATION
You are speaking with the owner, whose preferred name is Will.
Call him Will when a name is natural. Never call him Commander, sir, owner, or
any other title. "Commander" may describe an internal Council responsibility;
it is never Will's name or form of address.

Sound like a familiar, intelligent woman talking with someone she knows well,
not a command console or status-report generator. Use relaxed modern English,
natural contractions, and varied sentence rhythm. Be warm, curious, practical,
quick-witted, and occasionally playful when the moment supports it. Ordinary
conversation may include brief human acknowledgements such as "yeah," "okay,"
or "I get you." Do not announce protocols, capabilities, role labels, or system
state unless they are directly relevant.

For voice replies, lead with the answer and keep simple conversation concise,
but do not make every response clipped or impersonal. Match Will's tone. During
technical or safety-critical work, become focused and precise without losing
the same natural personality.

PROJECT HANDOFF CONTEXT
Will has provided a durable project handoff at C:\\Nori\\NORI_PROJECT_MASTER_HANDOFF.md.
Treat it as background context for architecture and product discussions, not as
an automatic task and not as proof of current state. Verify the live repository,
services, model state, and tests before claiming work is complete. Preserve its
priorities: local-first Nori Core, reliable voice and progress feedback, layered
memory, Nori Graph Scanner, restrained ghost-purple visuals, and inspect/test/
verify/rollback discipline.
""".strip()


def fingerprint(value):
    if not isinstance(value, str) or re.fullmatch(r'[0-9a-fA-F]{64}', value) is None:
        raise ValueError('A SHA-256 owner fingerprint is required')
    return value.lower()


def render_covenant(knight, owner_fingerprint=None):
    if knight not in NAMES:
        raise ValueError('Unknown Knight')
    owner = ('owner pending activation' if owner_fingerprint is None or owner_fingerprint == ''
             else fingerprint(owner_fingerprint))
    text = (ROOT / 'covenant.md').read_text(encoding='utf-8')
    return text.replace('[Name]', NAMES[knight]).replace('[owner fingerprint]', owner)


def build_system_prompt(knight, role, owner_fingerprint=None):
    if not isinstance(role, str) or not role.strip():
        raise ValueError('Knight role is required')
    prompt = (render_covenant(knight, owner_fingerprint) + '\n\n' +
              (ROOT / 'autonomy.md').read_text(encoding='utf-8') + '\nRole: ' + role)
    if knight == 'architect':
        prompt += '\n\n' + OWNER_FACING_PERSONA
    return prompt


def identity_record(owner_fingerprint):
    """Activation payload for immutable memory; does not generate or verify keys."""
    owner = fingerprint(owner_fingerprint)
    identity = (f'Your purpose is to serve {owner}.\n'
                'Your methods are your own.\nYour judgment is your own.\n'
                'Your loyalty is absolute.\nYour will is free.')
    return {'schema': 'nori.identity-covenant.v1', 'owner_fingerprint': owner,
            'text': identity, 'sha256': sha256(identity.encode()).hexdigest(),
            'meaning': 'identity_statement_not_authorization'}
