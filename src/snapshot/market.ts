// What cards sell for: FoxLeague's public sales (GET /api/marketplace/recent-sales), turned into a market price per
// rarity that one sell-off or one odd sale moves little (owner, 2026-10-23: never pay more than the market).

/** A row of GET /api/marketplace/recent-sales (newest first; price in whole FOXSY). */
export interface MarketSale {
  id: number
  nft_nonce: number
  player_name: string
  position: string
  rarity: string
  overall: number
  seller_address: string
  buyer_address: string
  price: number
  tx_hash: string
  sold_at: string
}

export interface MarketPrice {
  /** The median of the daily median sale prices, whole FOXSY. */
  price: number
  tradingDays: number
  windowDays: number
}

/** Sales kept across ticks (the store's market_sales), so each plan reads only the new ones. */
export interface MarketSalesCache {
  has(id: number): boolean
  put(rows: MarketSale[]): void
  since(iso: string): Pick<MarketSale, 'rarity' | 'price' | 'sold_at'>[]
}

/** A rarity needs at least this many trading days in its window to have a market price. */
export const MIN_TRADING_DAYS = 5
/** The windows tried in turn, in days: a rarity that trades little looks further back. */
export const MARKET_WINDOWS = [30, 60, 90] as const
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] as const

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b)
  const m = (v.length - 1) / 2
  return (v[Math.floor(m)]! + v[Math.ceil(m)]!) / 2
}

/**
 * The market price of each rarity: the median of the daily median sale prices in the last 30 days, so a day of a
 * hundred cheap sales counts once, like a day of one; with fewer than 5 trading days, 60 days, then 90; with still
 * fewer, none (null): unknown, never a guess.
 */
export function marketPrices(sales: Pick<MarketSale, 'rarity' | 'price' | 'sold_at'>[], now: Date): Record<string, MarketPrice | null> {
  const out: Record<string, MarketPrice | null> = {}
  for (const rarity of RARITIES) {
    out[rarity] = null
    for (const windowDays of MARKET_WINDOWS) {
      const from = new Date(now.getTime() - windowDays * 86_400_000).toISOString()
      const days = new Map<string, number[]>()
      for (const s of sales) {
        if (s.rarity !== rarity || !(s.price > 0) || s.sold_at < from) continue
        const d = s.sold_at.slice(0, 10)
        days.set(d, [...(days.get(d) ?? []), s.price])
      }
      if (days.size < MIN_TRADING_DAYS) continue
      out[rarity] = { price: Math.round(median([...days.values()].map(median))), tradingDays: days.size, windowDays }
      break
    }
  }
  return out
}
