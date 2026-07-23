# Payments & invoices

`data.payments` is the user's payment history; each entry carries a signed
`invoiceUrl` that streams the invoice PDF.

## PortalPayment shape (fields you render)

```ts
data.payments = [
  {
    id?: string,
    gross?: number,
    currency?: string,
    planTitle: string,
    createdAt: string,   // ISO date
    invoiceUrl: string,  // signed GET → PDF stream
  },
  // …
] | null; // null → no payments yet
```

## Table + invoice download

The signed `invoiceUrl` returns a PDF (not JSON). Fetch it through the
auth-aware `fetcher`, turn the response into a blob, and open it:

```tsx
function PaymentsSection({ payments, fetcher }) {
  const downloadInvoice = async (payment) => {
    const res = await fetcher(payment.invoiceUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (!payments?.length) return <p>No payments yet.</p>;
  return (
    <table className="payments">
      <thead>
        <tr>
          <th>Date</th>
          <th>Plan</th>
          <th>Amount</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {payments.map((p, i) => (
          <tr key={p.id ?? i}>
            <td>{new Date(p.createdAt).toLocaleDateString()}</td>
            <td>{p.planTitle}</td>
            <td>
              {p.currency?.toUpperCase()} {p.gross ?? 0}
            </td>
            <td>
              <button onClick={() => downloadInvoice(p)}>Invoice</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Notes

- **Invoices are binary.** Use `res.blob()` + `URL.createObjectURL`, not
  `res.json()`. Revoke the object URL after opening to avoid leaks.
- The `invoiceUrl` is signed and short-lived — fetch it on demand (when the user
  clicks), don't pre-fetch all PDFs.
- Always go through the auth-aware `fetcher` so the request carries the user's
  session header; the headless processor verifies both session and token.
- Amounts/currency come straight from Freemius; render, don't recompute.
