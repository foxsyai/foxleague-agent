// Imported teams: a FoxLeague team the owner already plays, taken over by an agent. Only that one account's
// key is kept, as a PEM file (mode 600) in the data folder's keys/ (mode 700): the same protection as the
// install's own recovery words in the env file. Recovery words given to derive the key are never stored; a
// PEM file cannot give them back, and the agent does not need them. Errors never repeat what was pasted.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Mnemonic, UserPem, UserWallet, type UserSecretKey } from '@multiversx/sdk-core'
import { agentName } from '../names.ts'
import { validateMnemonic, walletFromSecretKey, type AgentWallet } from './wallet.ts'

export type ImportInput =
  | { kind: 'pem'; pem: string }
  | { kind: 'keystore'; keystore: string; password: string; account?: number }
  | { kind: 'words'; words: string; account?: number }

const ADDRESS = /^erd1[0-9a-z]{58}$/

/** Account number within recovery words (or a keystore that holds words): 0 is the first. */
function account(n: unknown): number {
  const v = n === undefined || n === null || n === '' ? 0 : Number(n)
  if (!Number.isInteger(v) || v < 0 || v > 999) throw new Error('the account number is 0 for the first account, up to 999')
  return v
}

/**
 * The key derivation runs synchronously with the file's own settings, so a doctored file could freeze the
 * service for seconds and take gigabytes. Real MultiversX keystores (web wallet, xPortal, mxpy) use n 4096,
 * r 8, p 1 and a 32-byte key: accept that and at most twice its cost (about 0.15 s and 64 MiB).
 */
function checkKdf(file: unknown): void {
  const p = (file as { crypto?: { kdfparams?: { n?: unknown; r?: unknown; p?: unknown; dklen?: unknown } } })?.crypto?.kdfparams
  const n = Number(p?.n), r = Number(p?.r), par = Number(p?.p), dklen = Number(p?.dklen)
  const whole = [n, r, par].every(v => Number.isInteger(v) && v >= 1)
  if (!p || !whole || dklen !== 32 || n * r * par > 2 ** 16) throw new Error('this is not a MultiversX keystore file')
}

/** The one secret key the input stands for. */
export function secretKeyFrom(input: ImportInput): UserSecretKey {
  switch (input?.kind) {
    case 'pem': {
      let all: UserPem[] = []
      try {
        all = UserPem.fromTextAll(String(input.pem ?? ''))
      } catch {
        all = []
      }
      if (all.length === 0) throw new Error('this is not a MultiversX PEM file')
      if (all.length > 1) throw new Error(`this PEM file holds ${all.length} keys: export only the account of the team`)
      return all[0]!.secretKey
    }
    case 'keystore': {
      let file: unknown
      try {
        file = JSON.parse(String(input.keystore ?? ''))
      } catch {
        throw new Error('this is not a keystore file (JSON)')
      }
      checkKdf(file)
      // The account number applies only to a keystore that holds recovery words; one that holds a key is that key.
      const index = (file as { kind?: unknown }).kind === 'mnemonic' ? account(input.account) : undefined
      try {
        return UserWallet.decrypt(file, String(input.password ?? ''), index)
      } catch {
        throw new Error('the keystore password is wrong or the file is not a MultiversX keystore')
      }
    }
    case 'words': {
      const words = String(input.words ?? '').trim().toLowerCase().split(/\s+/).join(' ')
      try {
        validateMnemonic(words)
      } catch {
        throw new Error('these are not valid recovery words (12 or 24 words from the standard list, in order)')
      }
      return Mnemonic.fromString(words).deriveKey(account(input.account))
    }
    default:
      throw new Error('choose a PEM file, a keystore file or recovery words')
  }
}

/** How many accounts Find my team lists at a time. */
export const FIND_ACCOUNTS = 20

/**
 * Find my team: the addresses of accounts `from` to `from + FIND_ACCOUNTS - 1` (never past 999) of recovery words or
 * of a keystore that holds words, for the owner to see which one plays the team. Only addresses leave this function;
 * each key is dropped as soon as its address is known. A PEM file or a keystore that holds one key has one account:
 * the usual Check reads it. Errors never repeat what was pasted.
 */
export function accountAddresses(input: ImportInput, from: unknown = 0): { account: number; address: string }[] {
  const start = from === undefined || from === null || from === '' ? 0 : Number(from)
  if (!Number.isInteger(start) || start < 0 || start > 999) throw new Error('the first account to list is 0 to 999')
  let words: Mnemonic
  switch (input?.kind) {
    case 'words': {
      const text = String(input.words ?? '').trim().toLowerCase().split(/\s+/).join(' ')
      try {
        validateMnemonic(text)
      } catch {
        throw new Error('these are not valid recovery words (12 or 24 words from the standard list, in order)')
      }
      words = Mnemonic.fromString(text)
      break
    }
    case 'keystore': {
      let file: unknown
      try {
        file = JSON.parse(String(input.keystore ?? ''))
      } catch {
        throw new Error('this is not a keystore file (JSON)')
      }
      checkKdf(file)
      if ((file as { kind?: unknown }).kind !== 'mnemonic') throw new Error('this keystore holds one account: press Check')
      try {
        // Opened once for every account (its key derivation is the slow part).
        words = UserWallet.decryptMnemonic(file, String(input.password ?? ''))
      } catch {
        throw new Error('the keystore password is wrong or the file is not a MultiversX keystore')
      }
      break
    }
    case 'pem':
      throw new Error('a PEM file holds one account: press Check')
    default:
      throw new Error('choose a keystore file or recovery words')
  }
  const out: { account: number; address: string }[] = []
  for (let n = start; n < Math.min(start + FIND_ACCOUNTS, 1000); n++) out.push({ account: n, address: addressOfKey(words.deriveKey(n)) })
  return out
}

export function addressOfKey(sk: UserSecretKey): string {
  return sk.generatePublicKey().toAddress('erd').toBech32()
}

function keyFile(dataDir: string, address: string): string {
  if (!ADDRESS.test(address)) throw new Error('not a MultiversX address')
  return join(dataDir, 'keys', `${address}.pem`)
}

/** Writes the key as keys/<address>.pem (mode 600, folder 700) and returns the address. */
export function saveImportedKey(dataDir: string, sk: UserSecretKey): string {
  const address = addressOfKey(sk)
  const file = keyFile(dataDir, address)
  const dir = join(dataDir, 'keys')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${new UserPem(address, sk).toText()}\n`, { mode: 0o600 })
  renameSync(tmp, file)
  return address
}

/** The wallet of an imported team; refuses a missing file or one whose key is not that address's. */
export function loadImportedWallet(dataDir: string, address: string, index: number): AgentWallet {
  const file = keyFile(dataDir, address)
  if (!existsSync(file)) throw new Error(`the key of ${agentName(index)} (an imported team) is missing from ${join(dataDir, 'keys')}: import the team again`)
  const wallet = walletFromSecretKey(UserPem.fromText(readFileSync(file, 'utf8')).secretKey, index)
  if (wallet.address !== address) throw new Error(`the key file of ${agentName(index)} holds another address's key`)
  return wallet
}

export function deleteImportedKey(dataDir: string, address: string): void {
  rmSync(keyFile(dataDir, address), { force: true })
}
