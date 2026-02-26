Create a minimal application with the following requirements:

App name must be **AsciiMeme**.

## Authentication

- Implement login/registration using Lovable's built-in auth system
- All pages except login/register should require authentication
- Have the lovable cloud and authentication system enabled and properly
  configured

## Dashboard Page

After login, show a Dashboard with:

- A welcoming header: "Welcome back, {user.name}"
- A section in the Navigation bar showing "Account Status: Free" (this will be
  updated later to reflect subscription status)
- A simple panel containing:
  - One textbox for user input (e.g., "Type a topic (e.g., Monday mornings)")
  - One button labeled "Meme It"
  - One result area to display the generated ASCII art meme (inside a code block
    with monospace font and a copy button)

## Meme Generator Feature

- Use text-only terminology: call the generated output a "meme".
- Clicking "Meme It" should call a **Supabase backend function** (Supabase Edge
  Function).
- Create and invoke a Supabase function named `generate-meme`.
- Request payload: `{ "prompt": "user input text" }`
- The Supabase function should:
  - Verify the user is authenticated (return 401 if not).
  - Validate that `prompt` is a non-empty string (return 400 if invalid).
  - Generate a funny ASCII meme text block based on the input (simple mock logic
    is acceptable for now).
  - Return success response:
    `{ "success": true, "meme": "generated ASCII meme text block" }`
- On the frontend:
  - Disable button while loading and show "Generating..."
  - Show the returned meme text in the result area
  - Show friendly error messages for failure states

A good example of ouput meme text block could be:

```
┌───────────────┐
│  USER INPUT   │
└───────────────┘

        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||

  "When you think about user input
   and realize... it's complicated"
```

## UI/UX Considerations

- Use a clean, modern design with a consistent color scheme
- Add a simple navigation header with:
  - App logo/name (AsciiMeme)
  - User profile menu (with logout option)
- Make the "Account Status" section visually distinct (will be used later for
  subscription info)
- Make the generator panel visually prominent and easy to use
- Add a helpful textbox placeholder, e.g. "Type a topic (e.g., Monday mornings)"
- Keep the overall layout professional but minimal
- Auth Hook Rule: Never use async callbacks inside onAuthStateChange. Profile
  fetches and other DB queries triggered by auth events must be fire-and-forget
  (.then()) so they never block the loading state from resolving. Always ensure
  setLoading(false) is called synchronously within the callback, not after an
  await.
