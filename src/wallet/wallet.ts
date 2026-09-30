// Agent wallets: one set of recovery words per install, the agent at index N = account N on the MultiversX
// path m/44'/508'/0'/0'/N' (sdk-core Mnemonic.deriveKey). Adding an agent takes the next index. An imported
// team brings its own key instead (wallet/imported.ts). A secret key never leaves the wallet except to
// sign, and the strategist never sees it.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  Address,
  AddressComputer,
  Message,
  MessageComputer,
  Mnemonic,
  Transaction,
  TransactionComputer,
  UserPem,
  type UserSecretKey,
} from '@multiversx/sdk-core'

export interface AgentWallet {
  index: number
  address: string
  /** Hex of the 32-byte public key (contract views take addresses this way). */
  pubkeyHex: string
  shard: number
  signTransaction(tx: Transaction): void
  /** MultiversX signed message (v1 prefix "\x17Elrond Signed Message:\n"), 64-byte signature hex. */
  signMessage(text: string): string
}

const addressComputer = new AddressComputer()
const txComputer = new TransactionComputer()
const messageComputer = new MessageComputer()

export function validateMnemonic(words: string): void {
  // Mnemonic.fromString checks the BIP39 word list and checksum.
  Mnemonic.fromString(words)
  const n = words.trim().split(/\s+/).length
  if (n !== 24 && n !== 12) throw new Error(`a mnemonic has 12 or 24 words, got ${n}`)
}

export function deriveWallet(mnemonic: string, index: number): AgentWallet {
  if (!Number.isInteger(index) || index < 0 || index > 999) throw new Error(`agent index out of range: ${index}`)
  return walletFromSecretKey(Mnemonic.fromString(mnemonic).deriveKey(index), index)
}

/** The wallet of one secret key (derived from the recovery words or imported), for the agent at `index`. */
export function walletFromSecretKey(sk: UserSecretKey, index: number): AgentWallet {
  const pk = sk.generatePublicKey()
  const addr = pk.toAddress('erd')
  return {
    index,
    address: addr.toBech32(),
    pubkeyHex: addr.toHex(),
    shard: addressComputer.getShardOfAddress(addr),
    signTransaction(tx: Transaction) {
      if (tx.sender.toBech32() !== addr.toBech32()) throw new Error('refusing to sign: sender is not this agent')
      tx.signature = sk.sign(txComputer.computeBytesForSigning(tx))
    },
    signMessage(text: string) {
      const msg = new Message({ data: Buffer.from(text, 'utf8'), address: addr })
      return Buffer.from(sk.sign(messageComputer.computeBytesForSigning(msg))).toString('hex')
    },
  }
}

export function addressOf(mnemonic: string, index: number): string {
  return deriveWallet(mnemonic, index).address
}

export function shardOf(bech32: string): number {
  return addressComputer.getShardOfAddress(Address.newFromBech32(bech32))
}

/**
 * Writes a new 24-word mnemonic into the env file as AGENT_MNEMONIC (mode 600). Refuses when one
 * is already there: replacing it would orphan every funded agent wallet.
 */
export function generateMnemonicInto(envFile: string): { created: boolean } {
  const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
  if (/^\s*AGENT_MNEMONIC\s*=\s*\S/m.test(existing)) return { created: false }
  const words = Mnemonic.generate().getWords().join(' ')
  validateMnemonic(words)
  const line = `AGENT_MNEMONIC="${words}"\n`
  const next = existing && !existing.endsWith('\n') ? `${existing}\n${line}` : existing + line
  writeFileSync(envFile, next, { mode: 0o600 })
  chmodSync(envFile, 0o600)
  return { created: true }
}

/**
 * Local-only PEM export so the owner can log into the FoxLeague web app with an agent's wallet and
 * watch it. Refused on the server, refused inside the repository (so it never lands in git), and
 * written with mode 600.
 */
export function exportPem(mnemonic: string, index: number, outPath: string, opts: { isServer: boolean; repoRoot: string }): string {
  if (opts.isServer) throw new Error('PEM export is local-only: refused on the server (AGENT_IS_SERVER is set)')
  const out = resolve(outPath)
  const rel = relative(resolve(opts.repoRoot), out)
  // Inside the repository only the pem/ folder, which git ignores and deploy.sh never ships.
  const inRepo = !rel.startsWith('..') && !isAbsolute(rel)
  if (inRepo && rel.split(sep)[0] !== 'pem') throw new Error(`refusing to write a PEM inside the repository (${out}); use pem/ or a path outside it`)
  if (existsSync(out)) throw new Error(`${out} exists; not overwriting`)
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 })
  const sk = Mnemonic.fromString(mnemonic).deriveKey(index)
  const address = sk.generatePublicKey().toAddress('erd').toBech32()
  writeFileSync(out, new UserPem(address, sk).toText() + '\n', { mode: 0o600 })
  chmodSync(out, 0o600)
  return out
}
