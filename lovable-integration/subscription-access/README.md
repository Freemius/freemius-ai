High-level process:

1. Create a basic dummy app for demonstration purposes
2. Store the Freemius Credentials
3. Create Entitlement table
4. Install and create Freemius JS SDK instance
5. Create an API route to get the current user's entitlements and checkout session link
6. Create a backend route to handle Checkout completion redirect
7. If in the front-end no active entitlement, show the checkout button and call the API route to create a checkout session and redirect to the Freemius checkout page
8. Provide basic customer information and link to Freemius Hosted Customer Portal.
9. Webhook Integration
