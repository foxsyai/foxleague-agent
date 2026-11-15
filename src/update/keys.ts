// The maintainers' release keys (Ed25519, public halves). An installed agent takes an update only when its manifest
// is signed by one of them. The private halves stay on the maintainers' own machines, never on GitHub.
//
// To rotate: add the new key here in a release signed with an old one, then drop the old key in a later release.
// An empty list means this build cannot check a signature: it then refuses every in-app update (fail closed).
export const RELEASE_KEYS: readonly string[] = []
