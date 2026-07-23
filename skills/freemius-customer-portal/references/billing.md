# Billing information

`data.billing` carries the user's billing details plus a signed `updateUrl`.
Render it read-only with an "Update" affordance that reveals an edit form.

## PortalBilling shape

```ts
data.billing = {
  business_name?: string | null,
  tax_id?: string | null,
  address_street?: string | null,
  address_city?: string | null,
  address_country_code?: string | null,
  address_zip?: string | null,
  updateUrl: string, // signed POST target
} | null; // null → no billing record yet
```

If `billing` is `null`, render an **empty state** ("No billing information yet")
rather than hiding the section — the user should still see where billing details
will live.

## Update form

```tsx
function BillingSection({ billing, fetcher, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    business_name: billing?.business_name ?? '',
    tax_id: billing?.tax_id ?? '',
    address_street: billing?.address_street ?? '',
    address_city: billing?.address_city ?? '',
    address_country_code: billing?.address_country_code ?? '',
    address_zip: billing?.address_zip ?? '',
  });
  if (!billing) return null;

  const save = async () => {
    await fetcher(billing.updateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setEditing(false);
    onUpdated(); // re-fetch portal_data
  };
  // …read-only summary when !editing, field inputs + Save/Cancel when editing
}
```

## Notes

- POST the whole form to the signed `updateUrl`; the headless processor verifies
  the token and forwards to Freemius.
- Field names match Freemius's billing fields (`business_name`, `tax_id`,
  `address_*`). Don't rename them client-side.
- `address_country_code` is an ISO country code (e.g. `DE`, `US`).
- After saving, re-fetch `?action=portal_data` so the read-only summary updates.
