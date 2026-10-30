# Cortège US Port

[![Tests](https://github.com/JadePrice/cortege/actions/workflows/tests.yml/badge.svg)](https://github.com/JadePrice/cortege/actions/workflows/tests.yml)

**The live protest map, made by those who are there.**

Cortège is a free and open-source web app: during a protest, anyone can report what they see (kettling, tear gas, charges, street medics, legal team, safe zones, etc.) and everyone sees it on the map within seconds. No account, no ads, no tracking.

## What it does

- 📍 **Report in two taps**: aim, pick a type, send. Others can confirm ("Still there") or say it's gone ("Gone"), and each point fades away on its own after a few minutes.
- 📳 **Live Warnings**: different vibrations for different nearby dangers, and notifications even when the app is closed (urgent announcements, dangers in your area).
- ⚖️ **Know your rights**: US-focused rights info (ACLU-aligned), National Lawyers Guild Mass Defense hotline, guidance for police encounters and arrests, and a pre-filled SMS alert for a trusted contact.
- 📅 **Calendar**: protests, blockades, gatherings, and general assemblies, with routes shown on the map.
- 🏛 **Landmarks**: police stations, courts, hospitals, pharmacies, and water points.
- 📶 **Works when networks are overloaded**: lightweight mode, reports queued until connection returns, last known situation shown offline, map cached on your phone.
- 📣 **For organizers and legal teams**: location-based announcements, verification and removal of false reports, access via QR code with no password.

## Privacy

- Your location never leaves your phone: only reports are sent, rounded to about 10 meters.
- No account, no cookies, no trackers. Reports are deleted when they expire.
- The map can be served by the server itself (no requests to third-party tile providers), and the app is accessible over Tor.
- The code is public: anyone can verify that the online app matches this repository.

Details: [what the server knows and doesn't know](docs/FONCTIONNEMENT.md#what-the-server-knows-and-doesnt-know) and [SECURITY.md](SECURITY.md).

## Host your own map

Cortège runs on a small server (Node 22.13+, no dependencies to install) or on shared hosting with cPanel:

```bash
node server.js   # then open http://localhost:8080
```

- [Installation and configuration](docs/INSTALLATION.md): environment variables, VPS, cPanel, Docker, backups, self-hosted maps, .onion address.
- [How it works](docs/FONCTIONNEMENT.md): reports, anti-abuse, administration, digest.
- [Changelog](CHANGELOG.md).

## Contribute

Bug, idea, or translation: open an [issue](../../issues) or read [CONTRIBUTING.md](CONTRIBUTING.md). To report a security vulnerability: see [SECURITY.md](SECURITY.md), do not publish it publicly.

## License and credits

License [AGPL-3.0](LICENSE): any modified version made available online must publish its source code.

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). City names and locations for the digest: [GeoNames](https://www.geonames.org/) (CC BY 4.0), file `places.json`.  
Story fonts: Inter and JetBrains Mono (SIL Open Font License), in `public/vendor/fonts/`. Vector map rendering: [protomaps-leaflet](https://github.com/protomaps/protomaps-leaflet) (BSD-3-Clause). Story map background: Natural Earth via world-atlas (public domain).
