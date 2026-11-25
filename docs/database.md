# PhotoBox database model

This is the PostgreSQL design for the first Neon deployment. Production and Sandbox deployments use separate databases or branches. Local preview uses its own SQLite database.

```mermaid
erDiagram
    SHOP {
        text key PK
        text value
    }
    CASHIER_SESSIONS {
        text digest PK
        bigint expires_at
    }
    CASHIER_LOGIN_ATTEMPTS {
        bigint window_id PK
        integer attempts
    }
    VOUCHERS {
        text code PK
        text receipt UK
        integer cups
        integer discount
        bigint created_at
        smallint is_trial
    }
    PROMO_CODES {
        text code PK
        smallint active_slot UK
        bigint created_at
        bigint revoked_at
    }
    ORDERS {
        text id PK
        text reference UK
        text voucher FK
        text promo_code FK
        integer base_amount
        integer discount
        integer total
        text mode
        text status
        smallint is_trial
        bigint created_at
        bigint paid_at
        bigint completed_at
        bigint provider_checked_at
        text qr_url
    }
    VOUCHERS o|--o{ ORDERS : "legacy voucher"
    PROMO_CODES o|--o{ ORDERS : "reusable voucher"
```

| Relationship or rule | Database guarantee |
| --- | --- |
| Order to legacy voucher | `orders.voucher` references `vouchers.code`. A partial unique index allows at most one pending, paid, or completed order per legacy voucher. |
| Order to reusable promo | `orders.promo_code` references `promo_codes.code`. An order can reference one discount code. Deactivation retains the promo row and all order history. |
| Five active promos | An active promo occupies one unique slot numbered 1 through 5. A revoked promo frees its slot and retains its own code as its permanent PK. |
| Checkout amounts | Whole rupiah integers. A discount is either zero or Rp5,000 and `total = base_amount - discount`. An order stores the values quoted at creation. |
| Midtrans identity | The merchant reference is unique. Only a matching Midtrans settlement can move a new order to paid. Historical trial rows retain their original status for reporting. |
| Admin access | Credentials are backend environment values. PostgreSQL stores session digests, expiry, and the login attempt counter. These records have no user FK because no user credential table exists. |
| Photo delivery | Order data contains no image bytes or recipient address. Email attachment delivery can process image bytes in memory independently of this schema. |

The [PostgreSQL migration](../apps/api/postgres/0001_initial.sql) is the executable schema. Apply it to an isolated Neon branch first. Copying any historical D1 records is a separate data migration.
