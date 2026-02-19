Now we will install the Freemius SDK and create an instance of it in our application. This instance will be used to interact with the Freemius API for managing checkouts and entitlements.

---

We will install the Freemius JS SDK for backend. This is strictly meant for backend and should not be exposed in the frontend. Use the following command to install it:

```bash
npm install @freemius/sdk @freemius/checkout zod
```

Now create a file called `freemius.ts` for backend/supabase and put the following code in it:

```ts
import { Freemius } from "@freemius/sdk";

export const freemius = new Freemius({
  productId: process.env.FREEMIUS_PRODUCT_ID!,
  apiKey: process.env.FREEMIUS_API_KEY!,
  secretKey: process.env.FREEMIUS_SECRET_KEY!,
  publicKey: process.env.FREEMIUS_PUBLIC_KEY!,
});
```

Replace the `process.env` values with the appropriate environment variable access method if your platform uses a different approach for managing environment variables. We had already added the credentials in the previous step, so make sure to use the same variable names.

The file can be created under `supabase/functions/_shared` or any other shared location that can be imported in our API routes.

---

It might ask you to enter the credentials again, please enter them in their UI.
