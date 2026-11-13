# Geidea UAE Test Shop — Phase 1 (Geidea PGW route)

A test merchant for the Geidea payment gateway (UAE: Test, Staging, Production). Modelled on BESO Shop, plus a **request inspector** with **key insights** on every API call.

## What's in Phase 1
| Area | What it does |
|---|---|
| Login | `demo` runs transactions; `admin` also manages credentials. Production is admin-only unless an admin allows demo users. |
| Shop + settings | Environment, checkout mode (modal / drop-in / redirect), HPP style, language, wallet buttons, Sale or Pre-auth, 3DS or MOTO, save card (CIT / MIT / CIT+MIT, Unscheduled / Recurring), currency, pay with token (CIT), HPP appearance. |
| Checkout | Create Session (v2; v1 for drop-in) signed server-side, then the Geidea checkout SDK or a redirect. Custom amount for decline testing. |
| Return page | Fetches the order from Geidea and shows key insights. |
| Orders | Capture, void, refund (partial or full), fetch order. Request inspector with masked request, raw response and key insights per call. |
| Saved cards | Stand-alone save card, tokens captured at payment, "use at checkout (CIT)", MIT charge (session + pay/token). |
| Callbacks | Receiver answers 200 straight away, stores each distinct payload once, counts repeats, keeps orders in sync. |
| Admin | Credentials per environment (password encrypted, never shown again), endpoints, MOTO switch and extra JSON, currencies, merchant name, public base URL, demo/admin passwords. |

## Key insights (lib/insights.js)
Outcome · decline reason in plain words with retry advice (DE 39, Geidea codes, Merchant Advice Codes) · 3DS result (transStatus, ECI, version) · fraud liability by brand and ECI · processed as card / Geidea token / network token / wallet · CIT/MIT/MOTO and agreement · card details · processor (CYBS / MPGS) with RRN, auth code, NTID · Visa CAVV result and ACI when present · amounts · known oddities. Rules come from the Geidea notes (3DS & liability, decline codes, HPP session lifecycle, order model). Run `npm run test:insights` after changing them.

## One-time setup
1. **GitHub**: create a private repo (e.g. `geidea-uae-test-shop`). On the repo page choose *Add file → Upload files*, drag in **everything inside this folder** (not the folder itself), commit.
2. **Vercel**: *Add New → Project*, import the repo (framework: Next.js). Before deploying add these environment variables:
   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://yyjuhrtglygwuwcmdjck.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → project *geidea-test-shop* → Project Settings → API Keys → `service_role` (secret) |
   | `APP_SECRET` | any long random string (32+ characters). Encrypts API passwords. **Changing it later makes saved passwords unreadable.** |
   | `ADMIN_INITIAL_PASSWORD` | first admin password; change it in Admin → Users after first sign-in |
3. Deploy, sign in as `admin`, then Admin → Credentials: add the merchant public key + API password for Test (and Staging / Production when ready). Save.
4. Sign in as `demo` / `demo` to use the shop.

Database tables already exist in Supabase (`supabase/schema.sql` is the copy). `vercel.json` pins functions to Mumbai (`bom1`), next to the Supabase project.

## To confirm with PGW engineering
- Staging SDK and HPP hosts (`payments.staging.geidea.ae` is a guess; edit in Admin → Endpoints).
- Signature timestamp zone: the shop sends UTC in `MM/DD/YYYY hh:mm:ss AM/PM`. If Create Session rejects the signature, this is the first thing to check.
- Stand-alone save card path: the Postman collection uses v1 (`/payment-intent/api/v1/direct/session/saveCard`); BESO shows v2.

## Next phases
2. MPGS direct (REST v80, Hosted Session so the PAN never touches this server). 3. CYBS direct (REST HTTP Signature, Microform, TMS). 4. Extras: network token / Click to Pay scenarios, Apple / Google / Samsung Pay via HPP, fee program indicator. Non-card methods are out of scope for now.
