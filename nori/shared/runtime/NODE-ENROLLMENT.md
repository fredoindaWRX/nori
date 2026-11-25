# NORI Home / Server enrollment

`node_enrollment.py` provides a shared SQLite enrollment store for native Home,
Server and Robotics services. A store is permanently scoped to one household
and one validated operator principal. The founding profile uses
`owner.vanguard.001`; other owners receive distinct principal IDs.

The node protocol carries that principal on enrollment, identity, and chat
requests. A correct household and certificate with the wrong principal is
rejected. The callsign remains display metadata and cannot substitute for the
principal or certificate.
An owner-issued invitation binds one node ID to one SHA-256 certificate
fingerprint. Invitations expire within ten minutes, are single use, and are
stored only as hashes. Reissuing invalidates older invitations for that node.
Enrollment, invitation consumption and audit events commit together. Revocation
invalidates both the trusted peer and its pending invitations.

Integration requirements: the issuer must authenticate the owner; a transport
must verify possession of the peer certificate before passing its fingerprint.
A fingerprint supplied in request JSON is not authentication. No network
listener is opened by this module. Do not expose the legacy loopback mesh as a
LAN pairing service. The existing registry remains untouched during development.

Remaining: certificate creation and protected key storage, authenticated TLS
transport, owner-facing pairing UI, shared service packaging, job dispatch,
rotation and actual Home-to-Server VM integration. This is an enrollment
component, not a finished pairing product.

Verification: `python NORI/shared/runtime/test_node_enrollment.py` exercises
household/node/certificate mismatch, restart, replay, expiry, replacement,
revocation, concurrent redemption and certificate reuse across different nodes.

## Mutual TLS transport integration

`node_transport.py` now accepts enrollment and identity checks over mutual TLS.
It obtains the client certificate from the verified TLS connection and rejects
JSON fingerprint substitutions. The client context verifies the server trust
chain and hostname. No invitation-issuing or revocation endpoint is exposed;
those operations remain local authenticated-owner integration responsibilities.

Seven enrollment/transport tests passed in NoriBuild Linux, using actual local
TLS sockets and disposable OpenSSL-generated fixture certificates. Coverage
includes missing client certificates, wrong peer certificates, wrong server
hostname/untrusted authority, token reuse, and revocation on the next request.
Certificates in these tests are fixtures, not deployed owner credentials.

The Linux runtime staging path now installs the enrollment store, mutual-TLS
transport, local model bridge, supervised Nexus service, local invitation and
revocation command, and a configuration example. The init service starts no
listener unless `/etc/nori/nexus.env` has been created by a future
owner-authenticated provisioner. It rejects missing/unsafe certificates,
group/world-readable private keys, browser-originated requests and non-JSON
requests before node work begins.

Still needed: production certificate provisioning and protected keys, owner
identity integration, pairing UI, rebuilt Home/Server images and two-VM task
dispatch. No LAN service was enabled by these tests; the fixture server shuts
down and the staged OS service is disabled by default.
## TLS test fixture prerequisite

`test_node_transport.py` creates disposable certificate authorities and peer certificates with OpenSSL. It resolves the executable from `NORI_OPENSSL` first and then from `PATH`. On Windows installations where OpenSSL is supplied by Git for Windows, set `NORI_OPENSSL` to that executable for the test run; production NORI nodes do not depend on that test-fixture setting.

