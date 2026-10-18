# Ayu

A phone-first personal health log: build your own baseline, log measurements and the context around them, and export a readable report for a clinician. Phone sensors are treated as experiments until they earn trust against a reference device.

> Ayu is an experimental personal tracking prototype. It does not diagnose, treat, or rule out any condition, and its phone-based measurements may be inaccurate. Do not use it for medical decisions or delay care based on a reading. If you have urgent or concerning symptoms, seek appropriate medical care.

**Deployed:** _TBD — add the HTTPS URL here_

Built during DubHacks '26 (Sat 12:30 PM – Sun 10:00 AM).

## Run locally

Requires Node 20+.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # wording check + Vitest
npm run build      # type-check + production build to dist/
```

Camera and mic only work over HTTPS (or `localhost`). Test sensors on the deployed URL on the demo iPhone, not a LAN IP.

## Layout

```
src/app/          routes, app shell, disclaimer footer
src/components/   shared UI
src/features/*    checkin, timeline, report, pulse, breathing, vision, blink, lab
src/data/         IndexedDB repository + schemas (the only code that touches IndexedDB)
src/lib/          dates, device info, copy.ts (all measurement copy)
tests/            Vitest
analysis/         bench notebook; research CSVs are gitignored
scripts/          check-wording.mjs (banned-claims check, runs in npm test)
```

Hidden research route: `/lab/probe` reports what the browser allows for camera, torch, frame timing and mic constraints.

## Privacy

No accounts, servers or analytics. Records are stored in IndexedDB on the device and leave it only when the user exports them.
