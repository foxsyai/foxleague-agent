// The maintainers' release keys (Ed25519, public halves). An installed agent takes an update only when its manifest
// is signed by one of them. The private halves stay on the maintainers' own machines, never on GitHub.
//
// To rotate: add the new key here in a release signed with an old one, then drop the old key in a later release.
// An empty list means this build cannot check a signature: it then refuses every in-app update (fail closed).
export const RELEASE_KEYS: readonly string[] = [
  // The owner's release key, made with `release.ts keygen` on 2026-11-20.
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADc22mViWO+hEqnA7Tt7Ct6JwBPBtWVjVGeRBl7RcmRA=
-----END PUBLIC KEY-----
`,
]
