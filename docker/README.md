# Majordomo

A MajorMUD client served to your browser, for MajorMUD and its derivatives
(GreaterMUD, Paradigm). The game sockets, the realm database, your characters
and the automation run in the container; the browser draws the console and the
cards.

## Where Majordomo comes from

Majordomo owes its existence to two programs.

- **mudengine.** Majordomo is a fork of Raymond Bennett's
  [mudengine](https://github.com/rayzorben/mudengine), and the client itself
  is his work. The two have gone their own ways since the end of September
  2026; this image is not upstream's.
- **MegaMUD.** Every character is played by a port of MegaMUD's own engine
  (`megamud.exe`, rewritten function by function), with MegaMUD's settings.

Neither project made or endorses Majordomo.

Source, issues and releases: <https://github.com/fatavatar/mudengine>

## Run it

```
docker run -d --name majordomo -p 8080:8080 -v majordomo:/config ghcr.io/fatavatar/majordomo:latest
docker logs majordomo
```

Open `http://localhost:8080/` and sign in with the password the first start
printed. It is generated once, saved to `/config/.access-password` on the
volume, and never printed again; set `MUDENGINE_PASSWORD` to choose your own.

Or with Compose:

```yaml
services:
  majordomo:
    image: ghcr.io/fatavatar/majordomo:latest
    ports:
      - '8080:8080'
    volumes:
      - majordomo:/config
    restart: unless-stopped
volumes:
  majordomo:
```

## What to know

| | |
|---|---|
| `-v majordomo:/config` | **Keep this.** Your options file, realms, characters, logs and the access password live here. Without it they go with the container. |
| `-e MUDENGINE_PASSWORD=…` | Choose the sign-in password instead of having one generated. |
| `-e MUDENGINE_TRUST_PROXY=1` | Set only when a TLS proxy you control is in front; the client then believes its `X-Forwarded-Proto`. |

- **The connection is not encrypted.** The password and the session cookie
  travel in the clear on a plain `http://` hop. On anything but a machine you
  are sitting at, put a TLS-terminating proxy in front of the port.
- The image runs as uid 1000. A bind-mounted directory owned by anybody else
  cannot be written; the named volume above needs no arrangement.
- A realm database of your own goes under `/config` (`docker cp` it in); the
  client's picker browses the container's files, not your browser's.
- `docker stop` disconnects every character cleanly and flushes what the
  client keeps, the same way Ctrl-C does on the desktop.

Tags: `latest` and the version in the release's `package.json`, built from the
same commit as the desktop installers on the GitHub releases page.
