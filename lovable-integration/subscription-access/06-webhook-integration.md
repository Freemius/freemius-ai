# Step 6: Webhook Integration

Now we will setup webhook for Freemius to synchronize license and subscription
changes to the `user_fs_entitlement` table in our database.

1. Create a new API route `functions/v1/webhook` that will be used as the
   webhook URL for Freemius. This route will receive POST requests from Freemius
   whenever there is a change in the license or subscription status.
2. To process the webhook, we will use the Freemius SDK. (Documentation:
   https://freemius.com/help/documentation/saas-sdk/js-sdk/integration/#handling-license-updates-via-webhooks)

    ```typescript
    import { freemius, processPurchase } from '../_shared/freemius'; // Correct the path
    import {
        WebhookAuthenticationMethod,
        WebhookEventType,
    } from 'npm:@freemius/sdk';

    const listener = freemius.webhook.createListener({
        authenticationMethod: WebhookAuthenticationMethod.Api,
    });

    // Freemius events to listen to
    const licenseEvents: WebhookEventType[] = [
        'license.created',
        'license.extended',
        'license.shortened',
        'license.updated',
        'license.cancelled',
        'license.expired',
        'license.plan.changed',
    ];

    listener.on(licenseEvents, async ({ objects: { license } }) => {
        if (license && license.id) {
            await processPurchase(license.id);
        }
    });

    // Get the raw body from the request
    const rawBody = await request.text();

    // Now process it with the Freemius SDK, but intentionally don't await it to make sure we pass a 2xx response to Freemius as soon as possible and avoid retries. We will handle the processing asynchronously and add detailed logs to make sure we can debug any issues that might come up in the process.
    let result = listener
        .process({
            headers: req.headers,
            rawBody: rawBody,
        })
        .catch((error) => {
            console.error('Error processing Freemius webhook:', error);
        });

    // Pass a 2xx response to Freemius.
    ```

3. Adjust the code to the platform specifics and add console logs for easier
   debugging.
4. Share the URL for me to add it in the Freemius Developer Dashboard.
