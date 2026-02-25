// @deno-types="npm:@freemius/sdk"
import { Freemius } from 'npm:@freemius/sdk@latest';
import { assert } from 'jsr:@std/assert@1';
import { load } from 'jsr:@std/dotenv@0.225.6';

Deno.test({
    name: 'processRedirect should return the correct redirect info',
    async fn() {
        await load({
            // Create an absolute path to the .env file in the current directory
            envPath: new URL('./.env', import.meta.url).pathname,
            // optional: also export to the process environment (so Deno.env can read it)
            export: true,
        });

        const productId = Deno.env.get('FREEMIUS_PRODUCT_ID');
        const apiKey = Deno.env.get('FREEMIUS_API_KEY');
        const secretKey = Deno.env.get('FREEMIUS_SECRET_KEY');
        const publicKey = Deno.env.get('FREEMIUS_PUBLIC_KEY');

        const freemius = new Freemius({
            productId: productId!,
            apiKey: apiKey!,
            secretKey: secretKey!,
            publicKey: publicKey!,
        });

        const LIVE_URL =
            'https://kqiqetpmyyfkdxyikzas.supabase.co/functions/v1/process-checkout';

        const currentUrl =
            'http://kqiqetpmyyfkdxyikzas.supabase.co/process-checkout?user_id=5723112&plan_id=40822&email=swas%40freemius.com&pricing_id=53801&currency=usd&action=purchase&subscription_id=756770&billing_cycle=12&amount=191.88&tax=0&license_id=1865045&expiration=2027-02-19+15%3A16%3A02&quota=1&signature=8d413e6c8ca64e96d6326aa5909afc5320bf12bca76556bb6ab0ba470a9bfdda';

        /**
         * The program (Deno) sees the current URL as `http://host/process-checkout?...` but the redirect URL is `https://host/functions/v1/process-checkout?...`.
         * To make sure the signature verification works correctly, we will just append all query params to the LIVE_URL from the currentURL
         */
        const url = new URL(currentUrl);
        const modifiedCurrentUrl = new URL(LIVE_URL);
        modifiedCurrentUrl.search = url.search;
        const modifiedCurrentUrlString = modifiedCurrentUrl.toString();

        const redirectInfo = await freemius.checkout.processRedirect(
            modifiedCurrentUrlString,
            LIVE_URL
        );

        assert(redirectInfo !== null, 'Redirect info should not be null');
    },
});
