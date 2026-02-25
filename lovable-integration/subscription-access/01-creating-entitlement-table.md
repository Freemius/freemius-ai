# Step 1: Create Entitlement Table

We need to create a table called `user_fs_entitlement` with the following
columns:

- id - The primary key.
- user_id - A foreign key referencing the user table. Value must match with the
  ID of the user in the lovable auth system (text/string).
- fs_license_id - A unique identifier for the Freemius license (text/string).
- fs_plan_id - The Freemius plan ID (text/string).
- fs_pricing_id - The Freemius pricing ID (text/string).
- fs_user_id - The Freemius user ID (text/string).
- type - The entitlement type (e.g., subscription, lifetime, etc.). It could be
  an enum with value `subscription` or `lifetime`.
- expiration - The license expiration timestamp (nullable).
- is_canceled - A boolean flag indicating if the license is canceled.
- created_at - Timestamp when the record was created.

Here is a SQL equivalent, please adapt it for the lovable platform (supabase)

```sql
-- First create the enum type
CREATE TYPE fs_entitlement_type AS ENUM ('subscription', 'lifetime');

-- Then create the table
CREATE TABLE user_fs_entitlement (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    fs_license_id TEXT NOT NULL UNIQUE,
    fs_plan_id    TEXT NOT NULL,
    fs_pricing_id TEXT NOT NULL,
    fs_user_id    TEXT NOT NULL,
    type          fs_entitlement_type NOT NULL,
    expiration    TIMESTAMP(3) WITHOUT TIME ZONE,
    is_canceled   BOOLEAN NOT NULL,
    created_at    TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT    fk_user FOREIGN KEY (user_id) REFERENCES "User"(id) ON DELETE CASCADE
);

-- Index on type for faster filtering
CREATE INDEX idx_user_fs_entitlement_type ON user_fs_entitlement (type);
```

This table will hold purchase information coming from Freemius.

- Enable RLS and make sure to setup appropriate policies.
- Users can only READ their own entitlements
- Users cannot CREATE, UPDATE or DELETE any entitlements (only the server can do
  that)
