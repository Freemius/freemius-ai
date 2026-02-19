Create a minimal application with the following requirements:

## Authentication

- Implement login/registration using Lovable's built-in auth system
- All pages except login/register should require authentication
- Have the lovable cloud and authentication system enabled and properly configured

## Dashboard Page

- After login, show a Dashboard with:
  - A welcoming header: "Welcome back, {user.name}"
  - A section in the Navigation bar showing "Account Status: Free" (this will be updated later to reflect subscription status)
  - A "Premium Action" button (nice, prominent design)

## Premium Action Feature

- Clicking the "Premium Action" button triggers a server API call to `/api/premium-action`
- The API endpoint should:
  - Verify the user is authenticated (return 401 if not)
  - Return success response: `{ success: true, message: "Premium action completed!" }`
- Display the result message to the user in the UI (success state)

## UI/UX Considerations

- Use a clean, modern design with a consistent color scheme
- Add a simple navigation header with:
  - App logo/name
  - User profile menu (with logout option)
- Make the "Account Status" section visually distinct (will be used later for subscription info)
- Keep the overall layout professional but minimal
