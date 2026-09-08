ASLingo Forgot Password

REPLACE:
- main.jsx

ADD:
- auth-recovery-enhancer.js

What it does:
- Adds "Forgot password?" underneath the normal sign-in form.
- User enters their email.
- ASLingo requests a Neon Auth password-reset email.
- The email returns the user to ASLingo with a secure reset token.
- ASLingo shows New Password + Confirm Password.
- Requires at least 8 characters.
- After success, returns to normal sign-in.
- Uses a generic "if that email belongs to an account" success message to avoid exposing account existence.
- Supports current Better Auth requestPasswordReset plus compatibility fallbacks for older Neon naming.

No database migration is required. Passwords remain handled entirely by Neon Auth and are never stored by ASLingo.
