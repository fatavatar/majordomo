#!/bin/sh
# Run the client as the owner of /config (2026-11-09).
#
# The image ran as `node` (uid 1000), which suits a named volume — the image
# hands /config to `node` and Docker copies that onto a fresh volume — and a
# bind-mounted folder owned by uid 1000. Under rootless Docker neither uid is
# the person: the container's root is the user who ran Docker and its uid 1000
# is one of that user's subordinate ids, so a folder of theirs bind-mounted at
# /config is root's in here and `node` could not write the first file it
# makes, `.lock`.
#
# So the container starts as root and steps down to whoever owns /config:
# `node` on a fresh volume, the folder's own uid on a bind mount. A /config
# owned by root is run as root only where root is somebody's own account,
# rootless Docker, read off the uid map; under rootful Docker that would be
# the machine's root, and the client stays `node` and says it cannot write.
# A `--user` given to `docker run` is not root here and is left as it is.
set -eu

if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

owner=$(stat -c %u /config)
group=$(stat -c %g /config)

if [ "$owner" != 0 ]; then
  exec setpriv --reuid="$owner" --regid="$group" --clear-groups -- "$@"
fi

# Rootful Docker maps every uid straight through: `0 0 4294967295`.
if ! awk 'NR == 1 && $1 == 0 && $2 == 0 { found = 1 } END { exit !found }' /proc/self/uid_map; then
  exec "$@"
fi

exec setpriv --reuid=node --regid=node --clear-groups -- "$@"
