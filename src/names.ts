// People count agents from 1 (Agent 1, pem/agent1.pem, `agentctl.sh log 1`, "agent 1" on Telegram); the code, the
// database and the wallet derivation count from 0. These helpers are the only conversions between the two.

/** "agent 1" for index 0. */
export function agentName(index: number): string {
  return `agent ${index + 1}`
}

/** "agent 2", or "agents 1, 3". */
export function whichAgents(list: number[]): string {
  return list.length === 1 ? agentName(list[0]!) : `agents ${list.map(i => i + 1).join(', ')}`
}

/** The index behind a number people type (1 or more); undefined when it is not one. */
export function numberToIndex(arg: string | number | undefined): number | undefined {
  if (arg === undefined || arg === '') return undefined
  const n = Number(arg)
  return Number.isInteger(n) && n >= 1 ? n - 1 : undefined
}

/** The PEM file people log into the FoxLeague app with: agent1.pem for index 0. */
export function pemName(index: number): string {
  return `agent${index + 1}.pem`
}
