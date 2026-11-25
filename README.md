<p align="center">
  <img src="apps/kiosk/icon-192.png" width="104" height="104" alt="Simpang Samping Obor emblem">
</p>

<h1 align="center">Simpang Samping Obor Photobox</h1>

<p align="center">A self-service iPad photobooth with QRIS checkout, a three-pose print editor, and a separate operator panel.</p>

## Run locally

Install Node.js 24 with npm. From the repository root, run:

```sh
npm ci
npm run dev
```

Open [the kiosk](http://localhost:4173/) or [the admin panel](http://localhost:4173/kasir). The kiosk starts in Midtrans Sandbox mode. Add `MIDTRANS_SANDBOX_SERVER_KEY` to the backend environment before starting checkout. Select **Press to Start**, optionally enter a voucher, and select **Tampilkan QRIS**. Settle the test payment with the [official Midtrans simulator](https://docs.midtrans.com/docs/testing-payment-on-sandbox). **Coba dengan foto ilustrasi** previews the editor without creating a payment.

To enable the local admin on Windows:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

Fill in `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 16 characters in that file, then restart the local server. Keep all credentials in the backend environment. The local preview uses an in-memory database and photo store that reset when it restarts.

## Guest and operator flow

| Guest | Operator |
| --- | --- |
| A session costs Rp35,000. An active voucher reduces it to Rp30,000. | Create up to five active, reusable Rp5,000 vouchers. Disable a code before issuing a replacement if all slots are filled. |
| After QRIS confirmation, take three poses on the iPad. Retake the session from the editor. | Review confirmed production transaction counts by day, calendar week, month, or all time. Reporting uses Tabalong time (WITA). |
| Pick a frame, apply one of eight filters, or adjust crop and zoom per pose. Print one large frame or two smaller copies on a 100 × 148 mm sheet. | Switch between Midtrans Sandbox and production when the matching keys are configured on the backend. |
| Save the JPG locally or create a temporary download QR when photo storage is configured. | See recent sessions and refresh a pending Midtrans status. |

## Repository map

| Path | Responsibility |
| --- | --- |
| [apps/kiosk](apps/kiosk) | Payment-to-capture flow, iPad editor, print canvas, and PWA |
| [apps/admin](apps/admin) | Operator login, voucher controls, and transaction reporting |
| [apps/api](apps/api) | Server-side pricing, order settlement, admin sessions, photo links, and SQL migrations |
| [packages/browser](packages/browser) | Shared browser code and styles |
| [tests](tests) | Local checkout, provider simulation, and model tests |
| [DESIGN.md](DESIGN.md) | Brand, editor layout, and tablet interaction rules |

## Sandbox, PWA, and hosting

Set `MIDTRANS_SANDBOX_SERVER_KEY` in `apps/api/.env` to connect the Sandbox account. Use the Midtrans simulator for this environment. The API verifies Midtrans order ID, payment type, IDR amount, and status before unlocking the camera. Local automated checks use a simulated provider.

The kiosk is designed for portrait iPad use and ships an app manifest and service worker. Use HTTPS on iPad, then open Safari's share menu and choose **Add to Home Screen**. Checkout and photo delivery require an internet connection. Test the printer from the target iPad using 100 × 148 mm paper.

For cross-device photo delivery, deploy the kiosk to a publicly reachable HTTPS origin with private object storage. The download token expires within 24 hours of payment. Set object lifecycle deletion on the storage side as well. Local preview links are intended for the browser running the preview.

For the GitHub-backed Vercel deployment, import this repository at its root and keep the build and routes in [vercel.json](vercel.json). The build emits the kiosk and admin as static assets and the payment API runs in a Node.js function on the same origin.

Use a separate Neon branch and database connection URL for Sandbox. The [database design and ERD](docs/database.md) specify all PostgreSQL keys and relationships. Apply the schema to a fresh branch by running `node apps/api/postgres/migrate.mjs` with that branch's `DATABASE_URL` in the backend environment. If the branch already has the initial schema, run `node apps/api/postgres/migrate.mjs 0002_remove_legacy_vouchers.sql` to apply only the cleanup migration. Add `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `MIDTRANS_SANDBOX_SERVER_KEY` to the Vercel Preview environment. Use a commercial Vercel plan for the paid booth.

The current Vercel function has no photo storage binding. JPG download and printing work locally in the browser. Photo delivery by email requires a sender integration.

## Checks

```sh
npm test
```

The build packages the applications and the tests verify local behavior. A working Sandbox transaction, iPad camera, and physical print each need their own device or provider check.
