// Sign-up form checks, kept free of Firebase imports so they can be unit
// tested without a browser, network, or database (Lab 10). The registration
// page and registerUser.js both use this.

export const MIN_PASSWORD_LENGTH = 8;

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Check the sign-up form.
 *
 * input: { displayName, email, password, confirm, city, sports }
 * options.needsCredentials: false when the person is already signed in and is
 *   only finishing their profile, so email and password aren't asked for.
 *
 * Returns { valid, errors, value }. `errors` lists messages in the order the
 * form shows them (the page shows the first). `value` is the cleaned-up
 * profile: trimmed text and a list of sports. It never includes the password.
 */
export function validateRegistration(input = {}, { needsCredentials = true } = {}) {
  const displayName = String(input.displayName ?? "").trim();
  const email = String(input.email ?? "").trim();
  const password = String(input.password ?? "");
  const confirm = String(input.confirm ?? "");
  const city = String(input.city ?? "").trim();
  const sports = Array.isArray(input.sports) ? input.sports.map(String) : [];

  const errors = [];
  if (!displayName) errors.push("Enter a display name.");
  if (needsCredentials) {
    if (!email) errors.push("Enter your email.");
    else if (!isValidEmail(email)) errors.push("Please enter a valid email address.");

    if (!password) errors.push("Enter a password.");
    else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    } else if (password !== confirm) errors.push("Passwords don't match.");
  }

  return { valid: errors.length === 0, errors, value: { displayName, email, city, sports } };
}
