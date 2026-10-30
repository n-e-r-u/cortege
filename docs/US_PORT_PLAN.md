# Cortège US Port & Localization: Architecture & Implementation Plan

## Overview
Cortège US is a localization and US movement adaptation of [Cortège](https://github.com/n-e-r-u/cortege) by [@neru](https://www.instagram.com/neru/).
The app is a zero-dependency (Node >= 22.13), real-time, privacy-first collaborative protest map designed to work without accounts, advertising, or persistent identity tracking.

This document details the 8-part roadmap to complete the US English / Latino Spanish port, fix existing test failures, and adapt the legal and civic structures to the United States.

---

## Existing Assets & Progress in Repository
- `public/index.html`: Contains initial NLG (National Lawyers Guild) Mass Defense hotline (`1-888-NLG-ECOL` / `1-888-654-3265`) and ACLU-aligned "Know Your Rights" sections (right to remain silent, filming police, search consent).
- `README.md`: Updated with US port overview and feature descriptions.
- `i18n/`: 10 TSV files containing translation keys across French, English, Spanish, and Arabic.
- Commits `1d34425`, `689ec76`, and `faa4fe5` began cleaning up French-specific national references ("toute la France") and error strings.

---

## Part 1: Fix Core Server Logic & Green the Test Suite
### Audit of 5 Failing Tests (`node --test test/*.test.js`)
1. **`orga confirmée` (test line 421) ➔ HTTP 400 !== 201:**
   - Call: `asOrga(O.key, '/api/reports', { cat: 'medic', ...p, note: 'devant la gare' })`
   - Investigation needed: Verify note sanitization, category validation, or phone validation changes introduced in `faa4fe5`.
2. **`cortège : tête qui suit` (test line 681) ➔ downstream beacon issue:**
   - Affected by `/api/orga/beacon` changes.
3. **`position en direct` (test line 707) ➔ downstream beacon issue:**
   - Position tracking past 2 km threshold verification.
4. **`pages de contenu` (test line 762) ➔ assertion failure on `/droits`:**
   - Test expects `/Garde à vue/` (French detention term), but `/droits` route content was already updated to US constitutional terminology ("right to remain silent", "detention").
   - Fix: Update test assertion to match the US legal terminology or ensure multi-language route handling.
5. **`admin : nom affiché choisi` (test line 776) ➔ HTTP 400 !== 201:**
   - Call: `asOrgaAdmin('/api/orga/beacon', { role: 'contact', ...place(), note: '...' })`
   - In `server.js`, `role: 'contact'` was marked `beaconOnly: true`, but category lookup logic returned a 400 rejection.
   - Fix: Correct the `beaconOnly` validation in `server.js:3796` and `CAT[role]`.

### Acceptance Criteria
- Run `node --test test/server.test.js` and achieve 100% pass rate.

---

## Part 2: Client Localization Defaults (EN-US Priority + Latino Spanish)
### Tasks
1. **`public/i18n.js`:**
   - Change default fallback language from `'fr'` to `'en'`.
   - Update language detection order to prioritize `en` -> `es` -> `fr`.
   - Set default locale mapping: `{ en: 'en-US', es: 'es-US', fr: 'fr-FR', ar: 'ar-u-nu-latn' }`.
   - Add distance display formatting (miles / feet support when locale is `en-US` or via user preference toggle alongside km / meters).
2. **Language Switcher UI:**
   - Ensure English and Spanish (`Español`) are listed first in the modal/settings sheet.

---

## Part 3: Map & Geographic Defaults (US Nationwide & Regional Configuration)
### Tasks
1. **Coordinates & Extents (`server.js` & `public/app.js`):**
   - Change default `CENTER` from `[46.6, 2.4]` (France) to continental US geographic center (e.g. `[39.8283, -98.5795]`) with `ZOOM` default of `4` or `5`.
   - Ensure `CENTER` and `ZOOM` remain dynamically configurable via environment variables (`process.env.CENTER`, `process.env.ZOOM`).
2. **Region Checking:**
   - Generalize `inFrance(lat, lng)` to `inRegion(lat, lng)`:
     - Bounding boxes for Lower 48 states, Alaska, Hawaii, Puerto Rico, and US territories.
     - Provide a bypass switch (`process.env.STRICT_BOUNDS=0` or `TARGET_COUNTRY=US`).
3. **Data Exports (`/manif/.../donnees.csv`):**
   - Replace French administrative headers (*commune, code insee*) with generic/US civic headers (*city, county/state, lat, lng*).

---

## Part 4: US Protest Terminology & Taxonomy
### Mapping Table
| French Term | US Protest Term | Icon | Action / Role |
| :--- | :--- | :--- | :--- |
| **Nasse** | **Kettling / Kettle** | 🛑 | Police containment perimeter trapping crowd |
| **Lacrymo** | **Tear Gas / Chemical Agents** | 💨 | CS, OC gas, pepper spray deployment |
| **Charge** | **Police Charge / Line Advance** | ⚡ | Riot line rushing forward / baton strikes |
| **Tirs (LBD)** | **Less-Lethal Munitions** | 💥 | Rubber bullets, 40mm impact rounds, beanbags |
| **Canon à eau** | **Water Cannon / LRAD** | 🌊 | Water cannons or directional acoustic weapons |
| **Sommations** | **Dispersal Order** | 📢 | Declaration of unlawful assembly & order to leave |
| **Police / BAC / CRS**| **Police / Riot Police / Undercover** | 👮 | Uniformed patrol, tactical riot units, plainclothes |
| **Milice / groupe fasciste** | **Fascist / White Supremacist** | ☠️ | Proud Boys, armed vigilantes, counter-protesters |
| **Street medic** | **Street Medic** | ➕ | First aid, eyewash, trauma care volunteers |
| **Legal team** | **Legal Team / NLG Observers** | ⚖️ | NLG Green Hats, arrest hotlines, legal observers |
| **Tête de cortège** | **Front of March** | 🚩 | Lead banner, head of demonstration |
| **Queue de cortège** | **Back of March** | 🔚 | Rear guard, trailing safety marshals |
| **Zone calme** | **Calm Area / Safe Space** | 🕊️ | Decompression spot, medical station, exit path |

---

## Part 5: "Know Your Rights" US Constitutional Framework
### Scope
Ensure both the client sheet (`#sheetRights` in `public/index.html`) and the server-rendered no-JS page (`/droits` / `/rights` in `server.js`) provide consistent, authoritative advice:

1. **4th Amendment (Search & Seizure):**
   - Explicit declaration: *"I do not consent to any searches."*
   - Pat-downs: Police may only pat down outer clothing if they have reasonable suspicion of a weapon (*Terry v. Ohio*).
   - Phone Privacy: Under *Riley v. California*, police cannot search phone data without a warrant. Recommend disabling biometrics (FaceID/TouchID) before actions.
2. **5th Amendment (Right to Remain Silent):**
   - Must be invoked explicitly: *"I am going to remain silent. I want to speak to a lawyer."* (per *Salinas v. Texas*).
   - Once invoked, officers must cease interrogation.
3. **First Amendment Rights:**
   - Right to photograph/video police officers performing official duties in public spaces.
   - Right to assembly in traditional public forums (streets, sidewalks, public parks).
4. **Detention Clarification:**
   - Ask clearly: *"Am I free to go, or am I being detained?"*
   - If free to go, walk away calmly. If detained, exercise silence.
5. **NLG & Legal Defense Hotlines:**
   - Integrate national NLG Mass Defense hotline (`1-888-654-3265`).
   - Allow city/chapter override in config and emergency directory.

---

## Part 6: Emergency Alerts & Pre-Filled SMS Protocol
### Tasks
1. **One-Tap Emergency Alert:**
   - Direct button in rights / detention sheet to generate pre-filled SMS to trusted emergency contact.
   - Template:
     `"EMERGENCY: I am being detained/arrested at [Street / GPS]. Time: [Time]. NLG Hotline: 1-888-654-3265. Please contact my emergency contact and bail fund. Do not post on social media until confirmed."`
2. **Phone Number Formatting:**
   - Validate and auto-format US 10-digit telephone numbers (`(XXX) XXX-XXXX` or `+1XXXXXXXXXX`).

---

## Part 7: Public Content & SEO Pages Localization
### Tasks
1. **Static SSR Pages (`server.js`):**
   - Provide clean English routes:
     - `/rights` (with `/droits` alias redirect).
     - `/calendar` (with `/agenda` alias).
     - `/orders` or `/curfews` (with `/arretes` alias for curfews, sound curfews, emergency declarations).
     - `/cities` (with `/villes` alias).
     - `/legal-teams` (NLG chapter directory).
2. **Meta & OpenGraph Data:**
   - English page titles, meta descriptions, canonical URLs, and `sitemap.xml`.
   - Update structured data (`schema.org/Event`) with US formatting and timezone handling.

---

## Part 8: Translation Compilation, CI & Deployment Documentation
### Tasks
1. **TSV & JSON Verification:**
   - Update `i18n/*.tsv` files with complete US English and Spanish equivalents.
   - Run `node tools/i18n-build.js` to regenerate `public/lang/en.json`, `es.json`, `ar.json`.
   - Validate that all HTML tags and variables (`{variable}`) remain intact.
2. **CI Pipeline (`.github/workflows/tests.yml`):**
   - Run syntax check (`node --check`) and server tests across Node 22 and 24.
3. **Documentation:**
   - Update `README.md` and `docs/INSTALLATION.md` for US deployment:
     - Environment variables: `CENTER`, `ZOOM`, `ADMIN_LABEL`, `NLG_HOTLINE`, `STRICT_BOUNDS`.
     - Guide on acquiring / generating US city and state PMTiles vector map tiles.
