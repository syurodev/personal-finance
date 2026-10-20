export function isEmailAllowed(email: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(email.trim().toLowerCase());
}
