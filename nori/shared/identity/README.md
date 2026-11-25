# NORI operator identity

The founding operator profile is:

**Ghost · Founding Operator · Owner 001**

`operator-profile.json` provides the name displayed by Home, Server, Robotics,
Drive and audit surfaces. `principal_id` provides a stable correlation key.
This file does not grant access. A node must separately prove its Nexus
certificate identity and satisfy the current permission policy. Changing the
callsign cannot impersonate the owner or bypass revocation.

The internal principal remains `owner.vanguard.001` as a stable identifier for
existing certificates and audit records. It is not the public callsign.

During enrollment, a trusted installer associates the profile's principal ID
with an owner-controlled certificate. Other people receive their own principal
IDs and roles rather than sharing Owner 001.
