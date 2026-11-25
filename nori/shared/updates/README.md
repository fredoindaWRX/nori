# NORI update manager

The update manager is deliberately small and edition-neutral. A release workflow must obtain the expected SHA-256 digest from signed NORI release metadata, call `verify()` before activation, and then call `stage()` to atomically replace the destination. A failed digest never reaches the active path. The manager does not download files or grant permissions; those remain policy-controlled responsibilities of the caller.
