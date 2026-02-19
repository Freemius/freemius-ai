We want to integrate Freemius Checkout and Licensing system with our app.

We need to create a table called `user_fs_entitlement` with the following columns:

- id - The primary key.
- userId - A foreign key referencing the user table. Value must match with the ID of the user in the lovable auth system (text/string).
- fsLicenseId - A unique identifier for the Freemius license (text/string).
- fsPlanId - The Freemius plan ID (text/string).
- fsPricingId - The Freemius pricing ID (text/string).
- fsUserId - The Freemius user ID (text/string).
- type - The entitlement type (e.g., subscription, lifetime, etc.). It could be an enum with value `subscription` or `lifetime`.
- expiration - The license expiration timestamp (nullable).
- isCanceled - A boolean flag indicating if the license is canceled.
- createdAt - Timestamp when the record was created.

Here is a SQL equivalent, please adapt it for the lovable platform (supabase)

```sql
-- First create the enum type
CREATE TYPE fs_entitlement_type AS ENUM ('subscription', 'lifetime');

-- Then create the table
CREATE TABLE user_fs_entitlement (
    id            TEXT PRIMARY KEY,
    "userId"      TEXT NOT NULL,
    "fsLicenseId" TEXT NOT NULL UNIQUE,
    "fsPlanId"    TEXT NOT NULL,
    "fsPricingId" TEXT NOT NULL,
    "fsUserId"    TEXT NOT NULL,
    type          fs_entitlement_type NOT NULL,
    expiration    TIMESTAMP(3) WITHOUT TIME ZONE,
    "isCanceled"  BOOLEAN NOT NULL,
    "createdAt"   TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT    fk_user FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
);

-- Index on type for faster filtering
CREATE INDEX idx_user_fs_entitlement_type ON user_fs_entitlement (type);
```

This table will hold purchase information coming from Freemius. Enable RLS and make sure to setup appropriate policies.

1. Users can only READ their own entitlements
2. Users cannot CREATE, UPDATE or DELETE any entitlements (only the server can do that)
