# FoxLeague player manual
The official player manual (docs.foxleague.ai), synced from the FoxLeague repository, main at 1c0c76233 2026-10-12.
Rules and numbers as the platform runs them. Where a live value in the snapshot differs (fees, prices, allowances, config), the live value wins.
A card's OVR is the average of its seven stats; the stats that matter for its position count for more than OVR.

# Economy map
(docs.foxleague.ai/mechanics/economy-map/)

This page collects every number that costs you FOXSY, time or a daily allowance, in one table. The values are the **mainnet** values of 12 October 2026. Where a paid shortcut exists, the last column says what it buys and the floor that money never crosses. Below the table you will find worked paths (how long and how much from A to B) and a short guide to which path fits which kind of manager.

Every FOXSY value is a whole number of FOXSY. Every duration is in days or hours. Daily allowances reset at a fixed **14:00 UTC**, not on a rolling 24 hour window.

## The table

| Parameter | Value | What it does | How it behaves | Paid shortcut and its floor |
|---|---|---|---|---|
| **Registration fee** | 5,000 FOXSY | One-time payment that creates your team and mints your starter squad | Paid once per wallet. The relayer pays the network fee for this transaction. One wallet gets one starter squad, enforced on chain | None. Every manager pays the same fee |
| **Starter squad** | 18 players: 10 Common, 4 Uncommon, 2 Rare, 1 Epic, 1 Legendary | The roster you receive at registration | Spread as 2 GK, 6 DEF, 6 MID, 4 FWD. While the pool allows it, each position gets one special card (a Legendary, an Epic or a Rare) plus one Uncommon; when a position has no card of that rarity left the draw bends and the card lands in any position that still has room. Commons fill the rest | None. Extra players come from the Common pack, the marketplace or fusion |
| **Common pack** | 2,500 FOXSY for 5 Common players | The only shop item that adds cards to your roster | At most 2 packs per wallet per rolling 7 days. Positions drawn like a starter squad (2 GK, 6 DEF, 6 MID, 4 FWD of 18), uniform within a position. Drawn from the pre-minted Common pool; sold out when fewer than 5 are free or when the platform's daily budget of 100 packs (500 cards for all managers together, reset once a day at the epoch change) is spent. Delivered by the game server about a minute after payment. The cards arrive with 0 competitive matches and no cooldown | This row is the shortcut. Floor: 2 packs a week, whatever you spend |
| **Stat caps by rarity** | Common 30, Uncommon 55, Rare 75, Epic 90, Legendary 100 per stat | The ceiling training can reach on each of the 7 stats | XP earned on a capped stat is discarded. Only fusion raises the ceiling | None |
| **Casual plus ranked matches per day** | 5 | The matches you may start yourself per day, casual and ranked combined | Being drawn in as someone's ranked opponent does not count. Tournament and 1v1 games do not count either | Not for sale |
| **Match cooldown** | 30 seconds from the start of your previous match; 15 minutes from the start of your last ranked game | Pacing between the matches you start | Both clocks run from the start of the match, not from full time. The ranked cooldown counts from your last ranked game, started or drawn into | Not for sale |
| **XP-eligible matches per player per day** | 3 | How many matches a day a player card can earn attribute XP in | A fourth competitive match that day still counts for ELO, career stats and the fusion counter. It awards no XP | Not for sale |
| **What counts as competitive** | Silver or Gold tournament matches plus 1v1 challenges. XP also comes from ranked while ranked XP is on (off on mainnet), but ranked never moves the match counter | The matches that move the on-chain match counter the match gates read | A real opponent and a paid seat. Casual games against the AI never count. Bronze tournaments never count | Fusion match waiver (see fusion row) |
| **XP per match** | Up to 900 XP spread over the 7 stats | Attribute XP a starter earns from one competitive match | Nine match actions (distance, dribbles, goals, passes, shots, completed passes, tackles, interceptions, saves) each score 0 to 100 against a normaliser and the scores are distributed to stats. The normalisers are set so a median performance scores about half of each term | XP booster doubles it (next row) |
| **XP booster** | 2,000 FOXSY, 2x XP, 24 hours | Doubles training XP and match XP for one day | One active at a time. Buying again restarts the 24 hour clock. Featured tournament rewards (2x for 48 h to the winner, 1.5x for 24 h to the runner-up) do not stack with it; the highest single multiplier applies | This row is the shortcut. No floor |
| **XP per stat bump** | 2,000 XP | XP a stat meter needs before the stat goes up by 1 | Surplus carries into the next meter, unless the bump lands on the rarity cap | None |
| **Player level** | level = floor(sqrt(total XP / 200)), max 100 | The level shown on the card, grown from lifetime XP | Cosmetic and career-only; stats are driven by the per-stat meters | None |
| **Training, free sessions** | 5 per day per wallet | Sessions you can run without paying | Each session adds 20 XP times condition / 100 to one stat of one player. Resets at 14:00 UTC | Paid training slots (next row) |
| **Training, paid slots** | 20 FOXSY per slot, at most 10 used per day, up to 25 bought per transaction | Extra sessions on top of the free 5 | Slots are banked and never expire. Maximum 15 sessions a day (5 free plus 10 paid). Each slot gives the same 20 XP at full condition, 40 with a booster | This row is the shortcut. Floor: 10 paid sessions a day |
| **Condition cost, training** | 5 per session | Condition a player loses per training session | Base value until age 30, then ramps with age to 3x the base at 39: 15 | Condition recovery (below) |
| **Condition cost, matches** | 10 per tournament or 1v1 appearance; 5 per ranked or casual appearance | Condition each player who takes the pitch loses per match | A substitute who comes on pays too; the bench does not. In ranked only the side that started the match pays. Base values until age 30, then ramps with age to 3x the base at 39: 30 for tournament/1v1, 15 for ranked/casual | Condition recovery (below) |
| **Condition regeneration** | 48 points per day (2 per hour) until age 30, falling to 24 per day (1 per hour) at age 39 | Passive recovery, slower with age | A young player at 0 is back to 100 in about 2 days, a 39-year-old in about 4 | Condition recovery (next row) |
| **Condition recovery** | 100 FOXSY for a full 0 to 100 restore, pro-rated per missing point | Instantly restores a player's condition | You pay about 1 FOXSY per missing point; a player at 70 costs 30 FOXSY. Recover All sums every player below 100 | This row is the shortcut. No floor |
| **Minimum field condition** | 30 | The match-fit line for tournaments, 1v1s plus training | Below it a player cannot train. In a tournament or 1v1 match a starter below it is auto-substituted by a fit bench player; fewer than 11 fit players forfeits 3-0. Casual and ranked games do not apply it: they refuse only a starter at 0 condition, so a tired starter still plays there with every stat scaled down by condition | Condition recovery brings a player back above it |
| **Fusion inputs** | 3 players of the same rarity, each at the match gate of its rarity: Common 5 competitive matches, Uncommon 15, Rare 45, Epic 135 | What one fusion burns | Inputs must be synced, in your wallet, not listed, not under a transfer cooldown. A fused player inherits the longest remaining transfer cooldown of its inputs. The contract reads the on-chain competitive counter plus the waived credit | Fusion match waiver per missing match: Uncommon 20 FOXSY (at most 10, so 5 really played), Rare 100 (at most 30, 15 played), Epic 100 (at most 90, 45 played). None for Common |
| **Fusion fee** | Common to Uncommon 100, Uncommon to Rare 200, Rare to Epic 400, Epic to Legendary 800 FOXSY | The fee paid with the three cards | Refunded with the cards if the fusion fails. Legendary cannot be fused further | None |
| **Fusion card cooldown** | 14 days per fused card | A fusion output waits before it can be an input again | Belongs to the card and travels with it if sold. Does not block play, listing or your other fusions | Fusion cooldown waiver: 75 FOXSY per day down to a 3-day floor, at most 11 days and 825 FOXSY per card |
| **Fusion wallet spacing** | 20 hours between two fusions of one wallet | Pacing on the wallet, whatever the cards | Counts from your last successful fusion | Not for sale |
| **Marketplace listing** | Reserve between 500 and 1,000,000 FOXSY; every sale is a 24 hour auction | How you sell a player | Listing costs nothing beyond gas. Bids start at the reserve and must beat the top bid by 5 percent. A bid in the last 300 seconds extends the auction by 300 seconds. Cancel only while there are no bids | None. The 500 floor is enforced on chain |
| **Listing gate** | The match gate of the card's rarity: Common 5 competitive matches (5 really played), Uncommon 15 (5), Rare 45 (15), Epic 135 (45), Legendary 405 (135) | What a card needs before it can be auctioned | The same two gates as fusion. The fusion match waiver credit on the card counts. Cards out of a pack or a fusion start at 0. The contract refuses the listing otherwise; listings already open on 12 October 2026 at 14:00 UTC, when these gates replaced the single gate of 20 matches, finish normally | Fusion match waiver: Uncommon 20 FOXSY per match; Rare, Epic plus Legendary 100 (a Legendary at most 270, so 135 really played). None for Common |
| **Marketplace fee** | 10 percent of the winning bid | Platform fee on a completed sale | Paid by the seller out of the bid, only when the auction sells | None |
| **Relist cooldown** | 48 hours after a sale | A just-sold player cannot be auctioned again | Per player, enforced on chain | Not for sale |
| **Creator royalty** | 2.5 percent of a tournament or 1v1 prize pool | Paid to the provider of the AI binary the matches ran on | Comes out of the 10 percent platform fee, in the same distribution transaction as the prizes. It never reduces a winner's share. Capped on chain at 2.5 percent. Marketplace sales carry no royalty | None |
| **Transfer cooldown** | 21 days (504 hours) after a wallet-to-wallet transfer of a card at its match gate; 21 days plus 6 hours for every missing match for a card moved under it | The received player cannot play or be fused | Only direct wallet-to-wallet transfers trigger it. The length is fixed on the card at the moment of the transfer; each fusion match waiver bought afterwards for a card moved under its gate takes 6 hours off, down to 21 days plus 6 hours for every match it still has to really play. Auction wins, fusion outputs plus shop mints never start one. A sale does not clear a running lock: the buyer inherits the rest, shown on the listing. The longer lock closes the alt-wallet path: a second wallet's untouched Legendary is locked for 122 days and 6 hours. Locks already running on 12 October 2026 at 14:30 UTC were never made longer | Reduce Cooldown, for a card moved at its gate only: per day above the floor, by rarity: Common 25, Uncommon 75, Rare 200, Epic 500, Legendary 1,250 FOXSY (the 10 percent fee on the reference price spread over 20 days), every day or only some of them. Floor 3 days (72 hours). Full waiver of a fresh 21-day transfer: 18 days, from 450 (Common) to 22,500 (Legendary) FOXSY. Under the gate: the fusion match waiver, 6 hours a match |
| **Tournament seat fee** | Bronze free; Silver 1,000 to 4,999 FOXSY; Gold 5,000 FOXSY and up | What a seat costs, chosen by the creator inside the tier | Paid exactly, on chain, into a free seat. Refunded if you leave before the registration deadline or the tournament is cancelled | None. Bronze is the free tier |
| **Tournament prize split** | Winner 45, runner-up 30, third 15, platform fee 10 percent of the pool | How a Silver or Gold pool is paid out | The pool is the seat fee times the teams that joined. Without a third-place finisher the 15 percent goes to the runner-up. No organizer share: an organizer-only host pays no seat and earns nothing from the pool | None |
| **1v1 challenge** | Silver 1,000 to 4,999 or Gold 5,000 and up per side; winner 90 percent, platform 10 percent | A one-match stake against one opponent | Both sides pay the same fee. The loser gets nothing. One open or running challenge per wallet. Paid out about 180 seconds after the broadcast ends. Unaccepted challenges refund in full at the deadline | None |
| **Tournaments you can run** | 1 active as a player plus 1 active as organizer-only | Creation cap | Complete or cancel before creating another. Admins are uncapped as organizers | Not for sale |
| **Sync fee** | 10 FOXSY per player | Writes trained stats to the chain so they count in matches | Sync All shows the total before you sign. Required before fusing or listing a player. Not required to play | None |
| **Badge re-roll** | 1,000 FOXSY after 3 free re-rolls | A fresh AI-generated team badge from Settings | The first badge during onboarding is always free | This row is the shortcut |
| **ELO leagues** | Bronze below 1,300; Silver 1,300; Gold 1,600; Platinum 2,000; Diamond 2,700 | Your league bracket, from your ELO | New teams start at 1,200. Ranked games against another manager move rating with K = 24. Silver tournaments and Silver 1v1s use K = 12, Gold ones K = 18. Bronze tournaments move no ELO. The bands are 300 to 700 points wide: Gold is a season of wins, Platinum about three in either direction | Not for sale |
| **ELO decay** | On. After 10 idle days you lose 5 points every 20 hours (6 a day), down to 1,200 | Keeps the leaderboard honest | Only a ranked game against a real opponent or a finished Silver or Gold tournament match resets the idle clock. With the leagues hundreds of points apart, decay costs rank inside a league long before it costs the league; when a decay does cross a league floor, the label changes with that decay | Not for sale |
| **Aging** | Minted at 18; one in-game week per real day; ramp from age 30 to the peak at 39 | Older players lose more condition per match and per training while regenerating less | Stats never drop. Every condition cost climbs to 3x its base at 39: matches from 10 or 5 to 30 or 15, training from 5 to 15; regeneration falls from 48 to 24 a day. A 39-year-old plays three tournament matches from full, then rests about 4 days | Condition recovery keeps a veteran on the pitch. Age itself is not for sale |
| **Onboarding EGLD bonus** | Spent. The first 101 wallets that registered with less than 0.01 EGLD received 0.1 EGLD each | Covered roughly 100 on-chain actions of gas for a new manager | All 101 were paid. A wallet that registers today gets no EGLD from FoxLeague and tops up EGLD itself: the swap window's Ramp Network link, xPortal or an exchange | None |
| **Registration relayer** | 3 attempts per wallet per 10 minutes; 5,000 relayed registrations per day platform-wide | Rate limits on the gas-free registration | Past the daily cap the gas-free registration closes (the registration screen says "Onboarding closed for today"): try again tomorrow or ask the team on Telegram. There is no path where you pay the registration gas yourself | Not for sale |

## How long and how much from A to B

Each path is computed from the table above. The arithmetic sits in the last column so you can check it.

### (a) Starter squad to your first Uncommon by fusion

Three of your ten Commons, each to the Common match gate of 5 competitive matches, then one fusion.

| Route | Days | FOXSY | Arithmetic |
|---|---|---|---|
| Play the matches | 2 | 100 | 5 matches at 3 XP-eligible matches a day = 1 full day plus 2 matches on day 2. All three Commons start in the same eleven, so they finish together. Fusion fee 100 |
| Paid | | | None: a Common has no match waiver, its 5 matches are played |
| What the matches cost to play | included above | at least 1,000 per seat | Competitive matches come from paid seats: a Silver seat is at least 1,000 FOXSY. A round robin with 20 teams gives 19 matches for one seat; a 1v1 gives one. Prizes flow back from the same pool (see path g) |

The fusion counter itself has no daily cap, only the XP has one, so a manager who fits more tournament games into a day finishes sooner. Condition then sets the pace: 10 per match, 48 back per day. A starter below 30 is swapped for a fit bench player in tournament and 1v1 matches.

### (b) A fresh fused card back into the next fusion

The output of a fusion starts at 0 competitive matches and carries its own 14-day cooldown.

| Route | Days | FOXSY | Arithmetic |
|---|---|---|---|
| Free: wait it out, play meanwhile | 14 | 0 | A fused Uncommon: the 14-day card cooldown. Its 15 matches fit inside it (5 days at 3 a day) |
| Paid: cooldown waiver plus match waiver | 3 | 1,025 | A fused Uncommon: 11 days waived at 75 = 825, down to the 3-day floor. 10 matches waived at 20 = 200. The 5 real matches take 2 days, inside the 3 |
| Rarer outputs | | | A fused Rare needs 45 matches (15 days at 3 a day), a fused Epic 135 (45 days): longer than the cooldown. With every match waiver (30 at 100 = 3,000 for a Rare, 90 at 100 = 9,000 for an Epic) the real matches still take 5 and 15 days |
| Both routes | | | The 20-hour wallet spacing since your last fusion also has to be over; it fits inside either route |

### (c) Common to Legendary by fusion, one lineage

81 Commons become 27 Uncommons, then 9 Rares, then 3 Epics, then 1 Legendary: 40 fusions. This path counts the wallet spacing, the per-rung card cooldowns and the fusion fees. It does not count the competitive matches every input needs (the match gate of its rarity).

| Route | Days | FOXSY | Arithmetic |
|---|---|---|---|
| Fusion fees, either route | | 6,500 | 27 x 100 + 9 x 200 + 3 x 400 + 1 x 800 = 2,700 + 1,800 + 1,200 + 800 |
| Free: 14-day cooldowns | 63.7 | 6,500 | The 27 Common fusions run back to back: 26 gaps x 20 h = 520 h. The last Uncommon, the last Rare and the last Epic each wait 14 days before feeding the next rung: 520 h + 3 x 336 h = 1,528 h = 63.7 days. The other fusions fit inside those waits |
| Fully paid: every fused card waived to 3 days | 35.2 | 38,675 | 27 Common plus 9 Uncommon fusions back to back: 35 gaps x 20 h = 700 h to the last Rare. Then 3 days to the last Epic and 3 more to the Legendary: 700 h + 144 h = 844 h = 35.2 days. Waivers: 39 fused cards x 11 days x 75 = 32,175, plus the 6,500 in fees |
| Floor that no money removes | 32.5 | | 40 fusions need 39 spacing gaps: 39 x 20 h = 780 h = 32.5 days |
| Not counted: the matches | | up to 59,400 | 81 Commons x 5 + 27 Uncommons x 15 + 9 Rares x 45 + 3 Epics x 135 = 1,620 matches. Fully waived that is 27 x 10 x 20 + 9 x 30 x 100 + 3 x 90 x 100 = 5,400 + 27,000 + 27,000 = 59,400 FOXSY, with 810 matches still to really play (81 x 5 + 27 x 5 + 9 x 15 + 3 x 45; a Common has no match waiver) |

In the fully paid route the early Uncommons sit idle for more than 14 days anyway, so a careful manager waives only the cards on the critical path and pays less than 32,175. The realistic path mixes marketplace purchases at higher rarities with your own fusions.

### (d) Common pack to your first Legendary

The 81 Commons of path (c) bought as Common packs, 5 cards for 2,500 FOXSY at most twice a week. The fusions run at the 20-hour spacing while the packs keep arriving.

| Route | Days | FOXSY | Arithmetic |
|---|---|---|---|
| The packs | 56 | 42,500 | 81 Commons need 17 packs (85 cards, 4 spare) at 2,500 = 42,500. The cap is 2 packs per rolling 7 days: packs 1-2 on day 0, packs 3-4 on day 7, pack 17 on day 7 x 8 = 56 |
| The fusions | 32.5 at least | 6,500 | 40 fusions need 39 spacing gaps: 39 x 20 h = 780 h = 32.5 days, about 33 days. Fees 27 x 100 + 9 x 200 + 3 x 400 + 1 x 800 = 6,500. The Common fusions start with the first packs, so most of the spacing runs inside the 8 weeks; the last rungs then follow path (c) |
| The matches, played | included | seat fees | Every input needs the match gate of its rarity and pack cards arrive at 0: 81 Commons x 5 + 27 Uncommons x 15 + 9 Rares x 45 + 3 Epics x 135 = 1,620 matches. The match counter has no daily cap, only XP has one, so a card plays as often as you can field it |
| The matches, waived | | up to 59,400 | 27 x 10 x 20 + 9 x 30 x 100 + 3 x 90 x 100 = 59,400 if every card is waived to its floor; 810 matches still have to be really played. Waiving only the last matches of the cards on the critical path costs a fraction of that |
| Floor that no money removes | 56 | | The 2-packs-a-week cap: 17 packs take 8 weeks (56 days) whatever you spend. The 39 spacing gaps fit inside them |

Extend it to a full Legendary XI (ten more Legendaries, 149 packs) and the arithmetic gives the shape of the game: a manager who buys at the cap is bound by the pack cap alone for about 17 months; the 810 real matches every Legendary lineage needs come on top of that.

### (e) Moving a Legendary between your own wallets

The card's match gate at the moment of the transfer decides the length: 21 days at its gate (405 competitive matches, 135 of them really played), 21 days plus 6 hours for every missing match under it.

| Route | Days | FOXSY | Arithmetic |
|---|---|---|---|
| Wallet-to-wallet transfer, wait, card at its gate | 21 | 0 | The full 504-hour transfer cooldown before the card can play in the new wallet |
| Wallet-to-wallet transfer, wait, card at 0 competitive matches | 122.25 | 0 | 21 days plus 405 missing matches x 6 hours = 504 + 2,430 = 2,934 hours |
| Wallet-to-wallet transfer, Reduce Cooldown, card at its gate | 3 | 22,500 | 18 days above the 3-day floor x 1,250 per day. The rate is the 10 percent marketplace fee on the 250,000 FOXSY Legendary reference price spread over 20 days |
| Wallet-to-wallet transfer, every match waiver, card at 0 competitive matches | 54.75 | 27,000 | 270 waivers x 100 = 27,000 take 270 x 6 hours off: 2,934 - 1,620 = 1,314 hours, 21 days plus the 135 matches it still has to really play x 6 hours. Reduce Cooldown does not apply to this lock |
| Sell it on the marketplace, buy it back | 1 | 10 percent of the price | A 24-hour auction, then the 10 percent fee on the winning bid: 50 FOXSY at the 500 floor, 25,000 at the 250,000 reference price. The auction starts no transfer cooldown, so a card that carries none arrives playable. Anyone can outbid your other wallet. The card cannot be listed again for 48 hours. The card needs its match gate to be listed at all: 405 competitive matches, 135 of them really played |

### (f) One month of training

30 days, one wallet, every session at full condition (20 XP each, 40 with a booster). A stat bump is 2,000 XP.

| Route | Sessions | XP | FOXSY | Arithmetic |
|---|---|---|---|---|
| Free slots only | 150 | 3,000 | 0 | 5 x 30 = 150 sessions x 20 XP. About 1.5 stat bumps |
| All paid slots | 450 | 9,000 | 6,000 | (5 + 10) x 30 = 450 sessions x 20 XP. Slots: 10 x 30 x 20 = 6,000. About 4.5 bumps |
| Free slots plus a booster every day | 150 | 6,000 | 60,000 | 150 x 40 XP. Boosters: 30 x 2,000 = 60,000 |
| All paid slots plus a booster every day | 450 | 18,000 | 66,000 | 450 x 40 XP. 6,000 in slots plus 60,000 in boosters. About 9 bumps |
| Condition | | | | 15 sessions a day cost 75 condition against 48 regenerated, so spread the sessions across the squad or add recovery at about 1 FOXSY per point |

### (g) A month of competitive play at the caps

30 days at 3 competitive matches a day for your starters, the XP cap. Seats priced at the cheapest competitive seat, the 1,000 FOXSY Silver minimum, one match per seat as in a 1v1. An average result means you win back your share of the pool: 90 percent of what everyone staked returns to the players.

| Item | Amount | Arithmetic |
|---|---|---|
| Matches | 90 per starter | 3 x 30 |
| Seat fees paid | 90,000 FOXSY | 90 x 1,000. A tournament seat buys several matches (up to 19 in a 20-team round robin), so the real seat bill per match is lower |
| Expected prize flow at an average result | 81,000 FOXSY back, 9,000 net cost | 90 percent of 90,000 returns as prizes; the 10 percent fee is the cost, 2,250 of which is the creator royalty (2.5 percent of the pool) |
| XP earned per starter | up to 81,000 XP, about half at a median performance | 90 x 900. That is up to 40 stat bumps at 2,000 XP each; the normalisers put a median game at about half |
| Condition | sustainable | 3 x 10 = 30 per day against 48 regenerated |

### (h) One Legendary from a fresh squad

The starter squad carries one Legendary. Four ways to a second one, from the day the squad lands. The alt-wallet routes register a second wallet (5,000 FOXSY, its own starter Legendary) and move that card. The pack routes build it: the fresh squad already holds 1 Epic, 2 Rares, 4 Uncommons and 10 Commons, so the missing inputs are 2 Epics from 6 Rares, 4 of them from 12 Uncommons, 8 of them from 24 Commons, 14 of which come from 3 packs. That is 15 fusions (8 Common, 4 Uncommon, 2 Rare, 1 Epic; fees 800 + 800 + 800 + 800 = 3,200) and 45 inputs, each at the match gate of its rarity: 24 Commons at 5 competitive matches, 12 Uncommons at 15, 6 Rares at 45 plus 3 Epics at 135.

| Route | Days | FOXSY | Arithmetic |
|---|---|---|---|
| Alt wallet, wait | 122.25 | 5,000 | The second wallet's Legendary has 0 competitive matches, so the transfer locks it for 21 days plus 405 x 6 hours. The registration fee is the whole cost |
| Alt wallet, every match waiver | 54.75 | 32,000 | 5,000 for the second wallet plus 270 match waivers at 100 = 27,000, each 6 hours off the lock, down to 21 days plus the 135 matches still to really play x 6 hours. Reduce Cooldown does not apply to this lock |
| Packs, wait | about 89 | 10,700 | 3 packs at 2,500 = 7,500 plus 3,200 in fusion fees. The third pack lands on day 7 and its Commons play their 5 matches in 2 days; the 8 Common fusions take 6 days of wallet spacing. The fused Uncommons play their 15 matches inside the 14-day card cooldown, the fused Rares need 15 days for 45 matches and the fused Epics 45 days for 135, because the cooldown does not block play: 7 + 2 + 6 + 14 + 15 + 45 = 89 |
| Packs, every waiver | about 44 | about 70,000 | The 10,700 above, plus the match waivers of 12 Uncommons x 10 x 20 = 2,400, 6 Rares x 30 x 100 = 18,000 and 3 Epics x 90 x 100 = 27,000, plus 14 fused inputs x 11 waived days x 75 = 11,550, plus about 300 of sync fees at 10 per card. Days: 7 for the packs, 2 for the 5 real matches of the Commons, 14 spacing gaps x 20 h = 12, then the three fused rungs: 3 (the floor), 5 (15 real matches of a Rare) and 15 (45 real matches of an Epic) |

Moving a second wallet's Legendary is the slowest route when nothing is paid and still takes about 55 days with every match waiver bought. The pack routes build a Legendary whose inputs have played: about 89 days for 10,700 FOXSY or about 44 days for about 70,000 FOXSY. That is the shape the match gates are there to give.

## Which manager are you?

### The daily competitor

Time-rich, budget-light. You log in every day and you like to earn it.

- Play the free 5 casual and ranked games for the leaderboard and use Bronze tournaments to learn without stakes.
- Take the 5 free training sessions every day and sync before matches that matter (10 FOXSY per player).
- Reach fusion by playing: a Common needs 5 competitive matches, 2 days at 3 a day, then a 100 FOXSY fee. The rarer rungs need 15, 45 and 135 matches per card. Rotate your 18 so nobody drops below 30 condition.
- Grow the roster with the Common pack when you need inputs: 2,500 FOXSY for 5 Commons, at most 2 packs a week, the same cap every wallet has.
- Your one shortcut is the match waiver on a card's last matches: an Uncommon at 10 of 15 finishes for 100 FOXSY instead of two more days of seats. Every other floor is your normal pace.

**What you pay, what you get:** seat fees that mostly return as prizes, a few hundred FOXSY a month in sync and fusion fees, packs when you want inputs faster than the market sells them. You get a squad that improves a rung every couple of weeks.

### The busy regular

Limited evenings, some budget. You cannot play every day, so you buy back the days you miss.

- Buy the 2,000 FOXSY booster at the start of a long session and stack paid training slots under it (20 FOXSY each, 10 a day): 40 XP a session instead of 20.
- Use the match waiver on the last few matches only: a Rare at 40 of 45 costs 500 FOXSY to finish, not 3,000.
- Use the cooldown waiver only when a triplet is ready and one card is the holdout: 75 FOXSY per day, never below 3 days.
- Skip Reduce Cooldown by buying on the marketplace instead of receiving transfers: an auction starts no transfer cooldown. Check the listing for a lock the card still carries from an earlier transfer, because you would inherit it.

**What you pay, what you get:** 2,000 to 2,200 FOXSY per boosted training day (the booster alone up to the booster plus all 10 slots) and a few thousand per finished fusion, in exchange for progress on the days you are not online.

### The collector and trader

You build value in cards and move them.

- Every sale is a 24-hour auction with a 500 FOXSY reserve floor and a 10 percent fee on the winning bid. Bids climb by at least 5 percent and the last 300 seconds extend on every bid.
- An auction win starts no transfer cooldown, though a card sold inside a running one passes the rest to you (the listing shows it). A player sent wallet-to-wallet at its match gate waits 21 days, unless you pay the rarity price per day down to 3 days. Under its gate it waits 21 days plus 6 hours for every missing match; only match waivers shorten that.
- The waiver is priced at the marketplace fee on the card's reference price spread over 20 days, so a private transfer plus a full waiver costs about what a sale at the reference price would. A card under its match gate cannot be bought down to 3 days at all. The market stays the cheap path by design.
- A card can be auctioned only at the match gate of its rarity (from 5 competitive matches for a Common to 405 for a Legendary, a part of them really played), the same gate fusion has. Pack cards and fusion outputs start at 0, so a fresh card is never a same-day flip.
- Fused cards keep their cooldown and any waived-match credit when sold; price them accordingly. Sync before listing: bidders see on-chain stats only.
- A just-sold card cannot be relisted for 48 hours, so flipping is slow by design.

**What you pay, what you get:** 10 percent of every sale with no royalty on marketplace trades. You get a market where nobody can wash a card through a friend's wallet cheaper than through you.

### The organizer

You create the events other managers play in.

- Silver seats run from 1,000 to 4,999 FOXSY, Gold from 5,000 up. The pool is the seat fee times the teams that actually join and it pays 45 / 30 / 15 to the podium with 10 percent to the platform.
- Hosting is free: an organizer-only host takes no seat and pays no fee. There is no organizer share of the pool; your return is the community, the private invite-only events and a Hall of Fame entry when the FoxLeague team features the event.
- 2.5 percent of every pool goes to the creator of the AI binary the matches ran on, out of the platform fee. If you build a binary, that royalty is yours. See the Developers Hub.
- One active tournament as a player plus one as organizer-only at a time; plan the calendar so your events do not overlap.

**What you pay, what you get:** nothing beyond your own seat if you play, in exchange for a full field, a prize pool your community funds and your name on the events.

## What money cannot buy

- **The floors.** 3 days of every fused card's cooldown, the matches of every gate that must really be played (5 for a Common or an Uncommon, 15 for a Rare, 45 for an Epic, 135 for a Legendary), 3 days of the transfer cooldown of a card moved at its gate (21 days plus 6 hours for every match it still has to really play for a card moved under it), the 20-hour wallet spacing between fusions and the 2 Common packs a week.
- **The daily caps.** 5 casual and ranked games you start, 3 XP-eligible matches per player, 5 free plus 10 paid training sessions, all resetting at 14:00 UTC.
- **Aging.** Every player is 18 at mint and grows a week older every day. From 30 the condition bill rises with every season, the natural recovery slows and nothing reverses it. Paid recovery keeps a veteran playing; it does not make them younger.
- **Ranked pacing.** 30 seconds between matches, 15 minutes between ranked games and a rating that decays after 10 idle days.

See also [Fusion](/mechanics/fusion/), [Shop](/mechanics/shop/), [Marketplace](/mechanics/marketplace/), [Tournaments](/mechanics/tournaments/), [Training](/mechanics/training/) and [Player Aging](/mechanics/aging/).

# Player Aging
(docs.foxleague.ai/mechanics/aging/)

FoxLeague is built to keep evolving. As real time passes your players grow older, whatever their rarity. Age quietly reshapes how you build and rotate your squad. The numbers below are the launch values. They are balance dials FoxLeague tunes over time, so read them as the current setting of a mechanic that stays the same in shape.

The clock itself is fixed: every player is **18 in-game years old at mint** and ages **one in-game week per real day**, so a player minted today is around 39 after about three real years. The age shows on the player card as years and weeks.

## Your stats are safe. Age is paid in condition.

The work you put into a player is never undone by age. Every attribute you trained and synced **stays** at the level you earned it. You paid for that growth in time and FOXSY. It stays yours.

What age changes is **condition**. A young player recovers quickly and holds condition across many matches. Nothing shifts until a player turns **30**: from there the drain climbs steadily with every season until it peaks at the maximum age of **39**. The older a player gets, the more condition each match takes out of them. Training sessions drain more with age too, on the same curve from their own lower base. Recovery slows on the same curve: an older player regenerates fewer points a day, so each game leaves more to win back and the rest takes longer.

The values at launch, for a player at 39 or older:

- every condition cost is **three times its base**: a tournament or 1v1 appearance costs **30** (base 10), a ranked or casual appearance **15** (base 5), a training session **15** (base 5)
- regeneration is **24 points a day** (1 an hour), against 48 a day (2 an hour) before 30

So a veteran at full condition plays **three tournament matches**, then needs about **4 days** of rest to come back from 0 or the Shop's [Condition Recovery](/mechanics/shop/) at up to 100 FOXSY for a full restore. Between 30 and 39 every number sits on the straight line between the young value and the old one: at 34 and a half the multiplier is 2, so a tournament match costs 20, a ranked one 10, training 10, while regeneration is 36 a day.

> **Veterans burn out fast**
> Age steepens the condition a player loses per match or training session and slows the recovery. Late in a career a tournament weekend is three games, so a veteran might win you one big match yet struggle to carry a whole tournament without paid recovery.

## Why aging keeps the league alive

Picture the league years from now, when many clubs hold rosters of maxed-out legends topping every stat. Without aging those squads would never change and the competition would stall.

Aging is the answer. Because even a perfect veteran tires faster every season, no club can lean on the same eleven forever. A **minimum condition** (currently 30) is needed to train a player and to start them in a tournament or 1v1 match, where a tired starter is swapped for a fit bench player. In casual and ranked games a tired player can still start, at reduced strength. Age pushes veterans under that line sooner each season. Depth, rotation and a steady pipeline of **younger players** become the real edge.

> **Rotation is the strategy**
> Bring younger players through before your stars fade. Clubs that keep developing the next generation stay competitive season after season. The ones that do not slowly run out of legs.

## Keep a veteran going with recovery

You are not forced to bench a star the moment age bites. You can keep a veteran on the pitch by topping up their condition with [Condition Recovery](/mechanics/shop/) from the Shop, bought more often as they age, even **between matches**. A legend who drains most of their condition each game can still finish a whole tournament if you keep refilling them. It costs FOXSY, so it becomes a real choice between paying to keep an icon on the pitch and bringing through fresh legs.

> **Recovery is a choice, not a requirement**
> Buying recovery between matches lets a beloved veteran play a full tournament. It is the paid alternative to rotation. Pick whichever fits your squad and your budget.

## Retirement (planned)

Retirement is not in the game yet. The plan: a player who has given everything is not simply discarded. When a star has aged past their best you will be able to **retire** them into a permanent place of honour at your club, in exchange for a benefit you choose from a set of rewards. It closes a great career with dignity and turns that legacy into a fresh advantage for the next generation. Note that the Hall of Fame in the app today is the archive of completed tournaments, not a retirement roll.

> **A career, not a write-off**
> Once retirement ships, retiring an aged player will preserve their legacy AND hand you a reward you pick, so the time and FOXSY you invested keep paying off long after they hang up their boots.

## What is tuned over time

The principle stays fixed. Your stats are preserved. Age is paid in condition. Rotation and recovery are the levers you choose between today, with retirement to follow. The dials behind it are balanced over time to keep the league healthy: when aging begins to bite, how steeply condition drain rises, how far regeneration slows, the minimum condition to take the field, the price of recovery, plus the menu of retirement rewards once retirement ships.

See also [Tournaments](/mechanics/tournaments/), [Match-Day Strategy](/mechanics/match-day-strategy/) and the [Shop](/mechanics/shop/).

# Fusion
(docs.foxleague.ai/mechanics/fusion/)

Fusion is how you **break the rarity ceiling**. Burn three players of the same rarity, pay a FOXSY fee and mint one player of the **next rarity tier up**, with a higher stat cap and room to keep growing.

## What fusion does

- **Burns** 3 player NFTs you own
- **Pays** a FOXSY fee to the player smart contract
- **Mints** 1 new player NFT at the next rarity tier

## Requirements

All three input players must:

- Be in your wallet (not listed on the marketplace, not in an auction)
- Share the **same rarity** (e.g. three Commons)
- Be **synced** (unsynced players can't be fused)
- Not be under a **transfer cooldown**. A player still inside its wallet-to-wallet cooldown cannot be selected: the Fusion tab lists it under the grid as locked (**In a transfer lock: these cannot be fused until it ends**), so you cannot use fusion to wash a cooled-down player into a fresh one. Its waivers can still be bought there: matches waived for a locked card count toward its gate and, on a card moved before its gate, each takes 6 hours off its lock. If such a player is fused anyway, the new player inherits the longest remaining transfer cooldown among the three inputs. When any of the three is still inside a cooldown it got by moving before its match gate, the new player's lock is of that kind too: it ends when that longest cooldown ends, neither Reduce Cooldown nor a match waiver shortens it. See [Marketplace](/mechanics/marketplace/) for the cooldown rules
- Have reached the **match gate** of their rarity: Common 5 competitive matches, Uncommon 15, Rare 45, Epic 135 (Legendary 405, for listing). Waived matches count, but a part must really be played: 5 for a Common or an Uncommon, 15 for a Rare, 45 for an Epic, 135 for a Legendary. The contract checks the on-chain match counter, so only synced matches count. The Fusion tab shows how far every candidate is and lists any selected player still below its gate. A card that still needs matches or is inside its own fusion cooldown carries a red **no-entry sign** (a red disc with a white bar) in its top-left corner. Hover over it (tap it on a phone) to see why. An unsynced card carries no sign: the Fusion tab names it once you select it. The same two gates also apply to listing a card on the [Marketplace](/mechanics/marketplace/)
- Not be inside its own **fusion cooldown**. A player that came out of a fusion waits **14 days** before it can go into another one (see below)

You also need enough FOXSY in your wallet to cover the fusion fee. The app reads your FOXSY balance before your wallet opens. When the fee is higher than the balance it tells you so and asks nothing to sign. If your balance cannot be read at that moment the fusion is not blocked: the chain has the last word.

### What counts as a competitive match

A **competitive match** is a match that is eligible for player XP: a **Silver or Gold tournament** match or a **1v1 challenge**. Ranked matches never count, whether ranked XP is on or off. All of them are played against a real opponent for a paid seat. Casual games against the AI never count. Bronze tournaments never count either. The daily 3-match XP cap does not apply to the counter: every competitive appearance counts, even one that earned no XP that day.

Your player's career **matches played** stat still counts every appearance, AI games included. Only the fusion counter is limited to competitive play. The on-chain counter written by [Sync](/mechanics/sync/) is the competitive one, which is what the contract reads.

### Per-card fusion cooldown

Every fused card (the **output** of a fusion) carries its own **14-day fusion cooldown** before it can be used as an input again. The clock starts when the fusion succeeds; a failed fusion starts nothing. Players that never came out of a fusion (the starter squad, a Common pack card or a never-fused card bought at auction) have no fusion cooldown. A fused card bought at auction keeps whatever remains of its cooldown. The Fusion tab shows "ready in N d" on a card that is still waiting.

The cooldown belongs to the card, not to you: it travels with the NFT if you sell it. It does not block your other fusions. There is no longer a wallet-wide 14-day cooldown. What remains at wallet level is **spacing**: one wallet can fuse at most **once every 20 hours**. The spacing cannot be bought down; the Fusion tab shows "next fusion possible in" until it clears.

## Cost by rarity

| Input rarity | Output rarity | FOXSY cost |
|--------------|---------------|-----------|
| Common | Uncommon | 100 |
| Uncommon | Rare | 200 |
| Rare | Epic | 400 |
| Epic | Legendary | 800 |

> **Legendary is the ceiling**
> You cannot fuse Legendary players as they're already at the top tier. Your Legendary stays a Legendary forever; the only way to improve it is training (up to the 100-per-stat cap).

## Paid shortcuts and their floors

Two shortcuts let you pay FOXSY instead of waiting or playing, each with a floor that money never crosses. Both are sold **per card** from the Fusion tab. Prices below are the mainnet values.

| Shortcut | Buys | Price | Floor money cannot cross | Maximum per card |
|----------|------|-------|--------------------------|------------------|
| **Fusion cooldown waiver** | Days off a fused card's own 14-day cooldown | 75 FOXSY per day | The last **3 days** always remain | 11 days, 825 FOXSY (full 14 to 3) |
| **Fusion match waiver** | Competitive matches the card still needs | Uncommon 20 FOXSY per match; Rare, Epic plus Legendary 100. None for Common | The matches of the gate that must really be played: 5 (Uncommon), 15 (Rare), 45 (Epic), 135 (Legendary) | Uncommon 10 matches, 200 FOXSY; Rare 30, 3,000; Epic 90, 9,000; Legendary 270, 27,000 |
| Wallet spacing (20 h) | nothing | not for sale | always waits in full | none |

How each one works:

- **Waive cooldown**. Pick the card in the Fusion tab and click **Waive cooldown**. The quote is the number of whole days between now and the 3-day floor, rounded up, times the per-day price; the button shows the days and the FOXSY before you sign. You can buy every day (the card lands exactly at the floor) or only some of them (its ready time moves that many days earlier). A card already at or below 3 days has nothing to waive. The card must be in your wallet (not listed, not in an auction); nobody can waive a card that sits in escrow.
- **Waive matches**. Click **Waive matches**, pick how many (1 up to the maximum the card can still take) and sign. Each waived match is a **credit** that stays on the card: it is added to the card's competitive matches when the contract checks the match gate, it survives a sale to another wallet and it is consumed when the card is burned in a fusion. You can never credit a card past its gate minus the matches it must really play (10 for an Uncommon, 30 for a Rare, 90 for an Epic, 270 for a Legendary). The card shows its played and waived matches once credit is on it. On a card that moved to your wallet before its gate, each waived match also takes 6 hours off its transfer lock.

Both waivers are FOXSY payments to the players contract, signed the same way as a fusion. A wrong amount is refused by the contract before anything changes.

## The fusion flow

1. Open **Marketplace → Fusion** tab
2. Pick the **rarity** you want to fuse (dropdown shows how many players per rarity you own)
3. Pick **three players** of that rarity from your roster. Each card shows its competitive matches and, when it is still cooling down, its own "ready in" countdown
4. Confirm the **position** of the output player (one of the three input positions). Name and portrait come pre-assigned with the output player rather than being picked from your inputs
5. Review the cost summary
6. Click **Fuse**
7. Approve the fusion transaction in your wallet. A single signature sends the required $FOXSY together with all 3 NFTs in one transaction.
8. Wait for confirmation
9. The new player appears in your Squad at the next rarity tier, with its own 14-day fusion cooldown already running

The burned NFTs are destroyed on-chain. The new NFT is not minted on the spot: it is a **random card** of the pre-minted **fusion pool** for the output rarity and your chosen position, drawn by the contract when your fusion is processed: choosing the position does not choose the card. It comes with its own pre-rolled stats inside the new tier's range (expect to train it up to the new cap). If that pool happens to be empty the transaction fails with a "try again later" message; nothing is burned and your FOXSY stays in your wallet.

## Stat caps after fusion

The fused player inherits the new rarity's stat cap, but **not** automatically full stats. You still need to train the new player toward the new cap:

| Rarity | Stat cap |
|--------|----------|
| Common | 30 |
| Uncommon | 55 |
| Rare | 75 |
| Epic | 90 |
| Legendary | 100 |

## Fusion history

Every fusion you do is recorded in the Fusion tab's history panel (date, input rarity, burned players, output player, transaction link). Useful for tracking your long-term team-building investment.

A fusion still waiting for its on-chain result shows as **Pending**; the platform keeps re-checking it for up to 48 hours. A fusion that reverted on-chain shows as **Failed** with the reason. Your three players and the fee are returned to your wallet in that case.

## Tips

- **Don't fuse your best Common**. Burning a near-cap Common (OVR close to 30) to mint a fresh Uncommon that starts much lower is often a net loss early on. Sell the Common on the marketplace and train an Uncommon you already have.
- **Sync first**. An unsynced player can't be fused (fusion reads on-chain stats only), so any training or matches that aren't synced yet are invisible to it, including the match gate.
- **Play the matches where they count**. Casual games against the AI keep your players fit and fill the career stats, but they never move the fusion counter. A card that only ever played the AI stays at 0 competitive matches however many games it has. Silver and Gold tournaments plus 1v1 challenges are what get a card fusion-ready.
- **Buy time only when the queue is the problem**. The cooldown waiver saves at most 11 days per card and the match waiver at most the waivable part of the card's gate (10 matches for an Uncommon up to 270 for a Legendary); the 20-hour wallet spacing still applies to every fusion. If several cards are cooling down at once, waiving the one you need first is cheaper than waiving all of them.
- **Legendary is a commitment**. Reaching Legendary by pure fusion takes **3⁴ = 81 Commons**, condensed through 27 Uncommons, then 9 Rares, then 3 Epics, then 1 Legendary. That's **40 fusions** in total. Cumulative fees: 27 × 100 + 9 × 200 + 3 × 400 + 1 × 800 = **6,500 FOXSY**. With one fusion per wallet every 20 hours those 40 fusions alone take at least 39 × 20 h = **32.5 days**. On top of that every fused card sits out its own 14-day cooldown (3 days with a paid waiver) before it can be an input at the next tier, before counting the competitive matches each input still has to play: 5 per Common, 15 per Uncommon, 45 per Rare, 135 per Epic. Realistic path is to mix marketplace purchases at higher rarities with your own fusions instead of grinding the whole pyramid from Common.

# Marketplace
(docs.foxleague.ai/mechanics/marketplace/)

The **Marketplace** is where you trade player NFTs for FOXSY. Auction your spares, bid on what other managers are selling and rotate your roster without burning anything.

On mainnet every sale runs as a **24-hour auction**. There is no instant buy: a seller sets a reserve price plus a clock while buyers compete with bids.

![Marketplace Browse (an auction card with its reserve, time left plus the BID button; the filter sidebar on the left)](/screenshots/marketplace-browse.png)

## Listing a player

1. Open the **Marketplace** tab → **Sell** sub-tab
2. Find the player in your roster
3. Enter the **reserve price** in FOXSY, then click **START AUCTION**
4. Approve the listing transaction in your wallet. The NFT moves into the contract's escrow for the 24 hours the auction runs

Reserve prices are whole FOXSY with a **minimum of 500**, enforced on chain. The Sell form refuses a price below the minimum and accepts at most **1,000,000**. That maximum is a limit of the Sell form only: the contract itself does not cap the reserve at 1,000,000. No bid under the reserve is ever accepted, so the reserve is the lowest amount you can be forced to sell at.

A **marketplace fee** (currently **10%**) is charged **only when the auction actually sells**. Listing costs nothing beyond gas. The fee comes out of the winning bid, so the seller receives the bid minus the fee.

A player who has just been sold cannot be auctioned again for **48 hours**. The countdown is per player, enforced on chain, so a card cannot be bounced between wallets to fake volume.

### The listing gate: the match gate of the card's rarity

A card can be put up for auction only once it reaches the **match gate** of its rarity, the same two gates [Fusion](/mechanics/fusion/) uses:

| Rarity | Competitive matches | Really played, at least | Fusion match waiver |
|---|---|---|---|
| Common | 5 | 5 | None |
| Uncommon | 15 | 5 | Up to 10, at 20 FOXSY each |
| Rare | 45 | 15 | Up to 30, at 100 FOXSY each |
| Epic | 135 | 45 | Up to 90, at 100 FOXSY each |
| Legendary | 405 | 135 | Up to 270, at 100 FOXSY each |

- Waived matches count: the **fusion match waiver** credit on the card is added to the card's competitive matches
- The matches in the third column must **really be played**. No amount of credit takes a card with fewer played matches onto the market

The players contract refuses the listing otherwise, so the Sell form disables the button with the reason, for an Epic: **Epic needs 135 matches (45 played) to be listed**, with what the card has under it (for example **This card has 12 played + 3 waived of 135**). In the Sell grid such a card reads **Not sellable yet** with the same count. Cards straight out of a Common pack or a fusion start at 0. Listings already open on Monday 12 October 2026 at 14:00 UTC, when these gates replaced the single gate of 20 matches, finish normally. What counts as a competitive match is explained on the [Fusion](/mechanics/fusion/) page: Silver or Gold tournament matches plus 1v1 challenges, never games against the AI.

> **Sync first**
> An **unsynced player cannot be listed** as-is. The marketplace shows the on-chain stats to bidders; if your Squad shows newer values than the chain, you'd be advertising a different player than what's actually on sale. If the player has unsynced training, the button reads **SYNC & AUCTION** instead: you sign a sync transaction first (10 FOXSY per unsynced player on your roster), then the listing transaction, so the auction matches what bidders see.

## Bidding on a player

1. **Marketplace** → **Browse** sub-tab
2. Use the sidebar to filter by name, position, rarity, price, OVR, minimum values for each of the 7 stats, level or condition. Filtering is instant (no reload); the grid shows 24 cards per page
3. Click a card to see the player's full details plus the time left on the auction
4. Enter a whole-FOXSY amount, click **PLACE BID**, approve the FOXSY transaction

The grid opens sorted by **Ending Soon**: the auction closing next sits on top, the other live auctions follow by time left, then auctions that have ended but are not settled yet. An auction moves down on its own the moment its clock runs out. The **Sort By** menu in the sidebar switches to **Newest First**, to price (low to high or high to low) or to OVR.

The bidding rules are enforced by the smart contract:

- Your first bid on an auction must be **at least the reserve**
- Every later bid must beat the current highest bid by **at least 5%**
- Your FOXSY is held in escrow while you are the top bidder. The moment someone outbids you it is sent straight back to your wallet
- A bid placed in the last **300 seconds** pushes the end time out by another **300 seconds**, so a last-second snipe only buys the other bidders more time to answer
- You cannot bid on your own auction

When the clock runs out the platform settles the auction for you: the NFT goes to the winner, the seller receives the winning bid minus the 10% fee. You never pay settle gas. If no one bid, the player simply goes back to the seller.

The **My bids** chip next to the filters counts the live auctions you have bid on. Tap it to see every auction you bid on in four groups: **Leading** (your bid is the highest, also once the auction has ended and waits to settle), **Outbid** (someone bid more; your FOXSY is already back in your wallet and **Bid again** opens the auction), **Won** plus **Lost**. Tap it again to go back to the grid.

Winning an auction does **not start** a transfer cooldown. It does not clear one either: a card sold while it is still inside a transfer cooldown from an earlier wallet-to-wallet move keeps the rest of that lock, so the buyer inherits it. The listing shows the lock ("Transfer lock") before you bid. When the lock comes from a move before the card's match gate, the listing card, its detail and the bid button also say **Reduce Cooldown does not apply to this lock.** A card lists only once it meets its gate and by then its match waivers have taken such a lock down to its floor, so nothing a buyer does shortens it: it runs to the end shown. A card without a lock can be fielded as soon as the auction settles.

## Canceling a listing

Changed your mind? Open **Marketplace → My Listings** and click **Cancel** on the card. The same **Cancel** button also appears on your own card in the Browse grid plus its detail modal. The player returns to your roster with no fee. The listing disappears from the browse grid.

Cancelling only works while the auction has **zero bids**. Once a bid lands you are committed until the clock ends, which is what stops a seller pulling a card out from under a bidder.

## Wallet-to-wallet transfers (transfer cooldown)

If someone sends you a player NFT directly (not through the marketplace), the player has a **transfer cooldown** before you can use them in matches. The cooldown is **21 days (504 hours)** for a card that had reached the match gate of its rarity (see the table above) when it moved. A card moved before its match gate is locked for **21 days plus 6 hours for every missing match** in the new wallet: a fresh starter card, a pack card or a fusion output cannot be handed to another wallet and played there the same season. A Legendary moved at 0 matches is locked for 122 days and 6 hours (2,934 hours); an Uncommon moved with 5 played and nothing waived, for 23 days and 12 hours. Each fusion match waiver bought for the card in the new wallet takes 6 hours off that lock, down to 21 days plus 6 hours for every match it still has to really play (54 days and 18 hours for the Legendary at 0, 21 days for the Uncommon). The length is fixed on the card at the moment of the transfer. Locks already running on Monday 12 October 2026 at 14:30 UTC, when this rule replaced the 63-day lock for a card under 20 competitive matches, were never made longer: each ends at the shorter of its own length and the new length for the card. It encourages fair play plus marketplace use, preventing off-market roster manipulation right before a tournament. Auction wins, fusion results, distribute events plus shop mints never start one; only direct wallet-to-wallet transfers do. A lock that is already running stays on the card through a sale (see above). A cooled-down player also cannot be used as a fusion input, so you cannot launder the cooldown through fusion.

The player card shows the cooldown countdown while it's active. The transfer dialog states the rule before you sign.

You can **pay to reduce** a transfer cooldown down to the floor the shop shows (currently **3 days**, 72 hours; the remaining floor can never be waived). Open **Marketplace → Shop → Reduce Cooldown**, pick the player, then pay the FOXSY price shown for every day or only some of them. The price is per day reduced and depends on the player's rarity (Common 25 up to Legendary 1,250 FOXSY per day). Reduce Cooldown does not apply to a card moved before its match gate: that lock gets shorter only with the fusion match waivers bought for the card. See the [Shop](/mechanics/shop/) for the full table.

The transfer cooldown is not the only clock a player can carry. A card that came out of a fusion has its own 14-day **fusion cooldown**, which only limits fusion, never play or listing. See [Fusion](/mechanics/fusion/).

## Recent Sales feed

The **Recent Sales** widget on Marketplace shows the latest completed sales. What sold, for how much and who bought. Useful for price discovery before you list your own.

The Browse sidebar filters for name, position, rarity, price plus OVR also narrow the feed. The price plus OVR sorts reorder it the same way; under **Ending Soon** or **Newest First** the latest sale stays on top. The heading shows how many sales match your filters (for example "12 of 20"). The stat, level plus condition filters apply to listings only. The feed loads 20 sales at a time with a **Load More** button.

Two more price signals sit at the top of the page: **floor-price pills** above the tabs show the lowest active listing per rarity (with the listing count) while the header shows the total **24h sales volume**.

## Tips

- **Play before listing**. A card needs the match gate of its rarity to be auctioned: from 5 competitive matches for a Common to 405 for a Legendary, a part of them really played (see the table above). A fresh pack card or a fresh fusion output is not sellable on day one.
- **Sync before listing**. Otherwise the button turns into **SYNC & AUCTION** and you sign two transactions (the sync at 10 FOXSY per unsynced player, then the listing). Bidders only ever see synced stats, not what you've trained since.
- **Wait for the button after listing**. Once a listing confirms, the Sell button stays held for up to 20 seconds until the NFT has visibly left your wallet, so a second listing does not fail on stale wallet state.
- **Watch the Recent Sales feed**. It's the cleanest signal for what the market is paying for similar players today.
- **Set the reserve as your real walk-away price**. The auction can close at the reserve if only one bidder turns up, so never list at a number you would regret. Pricing too high instead ends the 24 hours with no bids and the player back in your squad.
- **Bid early enough to matter**. The last 300 seconds extend on every bid, so waiting for the final tick wins nothing. It only hands the other bidders another five minutes.
- **Avoid wallet-to-wallet for active rosters**. Send via the marketplace if the buyer needs the player immediately; direct transfers cost the recipient the full 21-day (504-hour) cooldown, unless they pay to reduce it down to the 3-day floor. A card under its match gate is locked longer: 21 days plus 6 hours for every missing match.

# Match-Day Strategy
(docs.foxleague.ai/mechanics/match-day-strategy/)

In a tournament you can change your tactics **between matches**. Each game is played with the formation and lineup you have saved shortly before its kickoff, so you can prepare a different plan for every opponent.

## How it works

Every tournament match has a **strategy lock** a fixed number of minutes before kickoff (30 by default). The formation and lineup you have saved at that moment are the ones your team uses for that match.

- Edits you save **before** a match locks count for that match.
- Edits you save **after** it locks roll over to your next match.
- If you change nothing, the match simply uses your current tactics at lock time.

> **One save, many matches**
> You do not need to be online at every kickoff. Save your best lineup ahead of time and it is used for the next match that locks. Come back to change it whenever you want to prepare for a different opponent.

## Upcoming Games

The **Upcoming** page lists every scheduled match you still have to play:

- Tournament, round plus opponent (shown as TBD while a knockout slot is still being decided)
- Kickoff date and time
- A live countdown to the **strategy lock** for that match

Use it to see how long you still have to set your plan for each game. A countdown turns orange in the final hour before a lock. Once your lineup is captured the card counts down to kickoff instead. Finished games stay on the list for 24 hours after their broadcast ends.

![Upcoming Games page listing your scheduled matches, each with a live countdown to its tactics lock](/screenshots/upcoming-games.png)

Select any game's formation to open the full squad behind it. For an upcoming game this is the eleven plus seven you have ready right now. For one already played it is the exact squad that played it, as captured when that game locked. After a game finishes you can also watch it back or open its match statistics from the same row.

## The Tactics reminder

The **Tactics** page shows a banner for your next match with the same lock countdown, so you are reminded to save your best eleven before time runs out.

![The next-match tactics-lock countdown banner at the top of the Tactics page](/screenshots/tactics-next-match-banner.png)

## Squad rule

Your squad must be **complete and fully owned** at lock time: eleven starters plus seven substitutes, all still in your wallet. If your squad is short for any reason (for example you sold a player without replacing it) that match is **forfeited 3-0**. Starters must also be match-fit: condition of at least 30, not inside a transfer cooldown. An unfit starter is swapped for the best fit substitute automatically. If fewer than eleven fit starters remain after those swaps the match is forfeited 3-0 as well. When both teams fail the game is recorded 0-0 as a loss for both sides; in Silver and Gold events both also lose ELO. You return to normal play as soon as you complete your squad again. This is the same rule you meet when joining a tournament.

## Your team name

Your team name is **locked during your tournament matches**: from each match's strategy lock until that match ends. A rename in that window is refused with a message that says so. In a tournament with a group stage every team's name stays locked from the strategy lock of the stage's last group match until every group match has ended. In a Swiss tournament it stays locked until every match of your round has ended. Rename before a lock or once the match is over. Developer tournaments play under your dev team name, so they leave your team name free.

## Which player stats are used

The match uses each player's **on-chain synced** attributes as they stand at lock time, so training you sync before a match counts for it. Player **condition** is read live at the same moment. Training or syncing done after a match has locked applies to your following games.

See also [Tactics & Formations](/mechanics/tactics/) for how to build a lineup and [Tournaments](/mechanics/tournaments/) for formats, brackets and prizes.

# Match Types
(docs.foxleague.ai/mechanics/matches/)

FoxLeague offers four competitive contexts. All four follow the same core rule: matches use only your **fully synced on-chain stats**. Every player who takes the pitch loses condition, including a substitute who comes on during the game; a substitute who stays on the bench pays nothing.

| Mode | ELO | Cost | Player XP | Stakes |
|------|-----|------|-----------|--------|
| **Casual** | No change | Condition only (5 per appearance) | None (AI opponent) | None |
| **Ranked** | +/- ELO | Condition only (5 per appearance) | None (currently off) | Leaderboard climb |
| **1v1 Challenge** | +/- ELO (varies by tier) | FOXSY entry plus condition (10 per appearance) | Yes | 90% of pool to winner |
| **Tournament** | +/- ELO (Silver/Gold only) | FOXSY entry (Silver/Gold) plus condition (10 per appearance, Bronze too) | Silver/Gold only | 45/30/15% of pool by placement |

Attribute XP for your players comes only from paid play: Silver and Gold tournaments plus 1v1 challenges. Casual games are played against an AI team and grant none. Ranked matches do not award XP at the moment. Bronze tournaments grant neither XP nor ELO.

Each player earns attribute XP in at most **3 matches per day**. A fourth XP-earning match that day still counts for career stats and ELO, but it awards no XP. The daily count resets at 14:00 UTC.

The same paid play is what counts toward a card's **competitive matches**, the number behind its match gate for fusion, listing and the transfer lock (see [Marketplace](/mechanics/marketplace/)): every Silver or Gold tournament match and every 1v1 challenge the card takes the pitch in. Ranked, casual, Bronze and developer games never count.

## Casual

The relaxed mode. You play against an AI-generated team. No ELO change, no player XP; only career stats update.

- **Best for**: testing tactics, watching your team in action
- **Cost**: match action only consumes player condition (5 per appearance for every player who takes the pitch, substitutes who come on included; that is the base value, older players pay more as the [aging ramp](/mechanics/aging/) kicks in)
- **Award**: regular career stats for every player who takes the pitch, no attribute XP

Pick this when you're learning your squad or experimenting with formation/lineup.

## Ranked

The competitive mode. ELO points move between you and your opponent based on the result.

- **Best for**: climbing the leaderboard, qualifying for league promotions
- **Matchmaking**: a random opponent within 150 ELO of you. The search widens to 300, then 500, if nobody fits; after that an AI team stands in. Your league is not used.
- **Once a day per opponent**: the same two teams meet in ranked at most once every 24 hours, whoever started the game. A team you played in ranked in the last 24 hours is not drawn again; when no other team fits, the AI stands in. A team whose starting XI is not all match-fit right now (each player at condition 30 or more, none in a transfer cooldown) is not drawn either. A game still being played counts as a meeting; one that failed or was abandoned does not. Should a second ranked game of the same two teams still take place inside the 24 hours, it records the result but moves no rating.
- **AI stand-in**: a ranked game against the AI still records the win, loss or draw. It moves no ELO.
- **Condition**: only you, the player who started the match, pay condition. The opponent drawn into your game pays nothing.
- **ELO**: the winner gains exactly what the loser drops. The size of the swing depends on the rating gap: beating a stronger opponent moves more points than beating a weaker one. A draw moves a few points from the higher-rated player to the lower-rated one; between equal ratings it changes nothing. Ranked games move your rating with a K-factor of **24**.
- **Inactivity decay**: rating decay is active. After **10 days** without an ELO-affecting match (a ranked game against a real opponent or a finished Silver/Gold tournament match) you lose **5 rating points every 20 hours** (6 a day), down to a floor of **1200**. Casual play, ranked games against the AI and Bronze tournaments do not stop the decay.

You see your ELO in the header and on the **Leaderboard** tab. The leaderboard is a single global ELO ranking across all leagues.

![Leaderboard (top 3 podium with the ranking table below)](/screenshots/leaderboard-page.png)

## Daily limit and cooldowns

Casual and ranked play share one daily budget with a few pacing rules. Tournament and 1v1 games do not count toward the cap or the ranked cooldown.

- **Daily cap**: 5 casual plus ranked matches per day that you start yourself. Being drawn in as someone's ranked opponent does not count. The allowance resets at 14:00 UTC.
- **Match cooldown**: 30 seconds from the start of your previous match before you can start the next one. A match that is still running blocks a new start anyway.
- **Ranked cooldown**: 15 minutes from the start of your last ranked game, whether you started it or were drawn into it. The clock runs while that game plays, so a 10-minute game leaves about 5 minutes of wait after full time.
- **Pre-match lockout**: for 1 hour before a tournament or 1v1 match you cannot start casual or ranked play. You are not drawn in as a ranked opponent during that hour either. Developer tournaments do not trigger it.

## 1v1 Challenge

One-match showdowns against a specific (or open) opponent. You stake FOXSY, your opponent matches it, **winner takes 90% of the pool**, platform takes 10%, loser gets nothing.

- **Best for**: head-to-head stakes, calling out a rival, quick matches (~10 minutes, plus extra time and penalties if needed)
- **Tiers**: Silver (1,000-4,999 FOXSY) or Gold (5,000+). Bronze exists only for free developer challenges.
- **Cap**: one active 1v1 at a time per wallet
- **Resolution**: extra time then penalties if tied (1v1 must produce a winner)

Find them at the **1vs1 Challenges** tab in the sidebar. Full mechanics on [1v1 Challenges](/mechanics/one-v-one/).

## Tournament

Multi-match formal events with locked lineups and FOXSY prize pools. Four formats (Knockout / Groups+KO / Round Robin / Swiss) and three tiers (Bronze / Silver / Gold). See [Tournaments](/mechanics/tournaments/) for full mechanics.

**The headline rule**: each match captures your formation, lineup plus synced stats at its **strategy lock**, about 30 minutes before that match's kickoff. You can keep training, syncing plus adjusting tactics between games; whatever is synced at a match's lock is what plays.

Tournaments are where the most FOXSY trades hands. Entry fees pool into prize money distributed **45% winner / 30% runner-up / 15% third-place / 10% platform fee** (current split). A quarter of that fee (2.5% of the pool) is paid as a creator royalty to the provider of the AI binary your matches were played with. It comes out of the fee, never out of a winner's share.

## Match History

Every match you play lands in **History**. Click any row to see:

- Final score, top performers, possession breakdown
- Stat bumps gained per player
- Watch the match in the Match Viewer at any time
- The lineup snapshot used for the match (so past matches show the right stats from the time they were played, not your current ones)

## Upgrading your roster

Looking to refresh your squad between matches? Check out the [Marketplace](/mechanics/marketplace/) guide for listing, browsing, recent sales plus the wallet-to-wallet transfer cooldown.

# 1v1 Challenges
(docs.foxleague.ai/mechanics/one-v-one/)

A **1v1 Challenge** is a one-match showdown between two players. You stake FOXSY, your opponent matches the stake and the winner takes **90%** of the combined pool. The platform keeps 10% as a fee. The create form always shows the live split before you confirm. The loser gets nothing as these are winner-takes-most stakes.

1v1 Challenges live at their own route, **`/challenges`**, with a crossed-swords icon in the sidebar.

![1vs1 Challenges lobby (filterable list of open and completed challenges with tier badges and FOXSY pools)](/screenshots/challenges-list.png)

## How it works

1. Open **1vs1 Challenges** from the sidebar (icon next to Play Match)
2. Click **Create 1vs1**
3. Give the challenge a **title** (e.g. "Bob vs Alice") and optionally a short description. Trash talk lives here
4. Pick a **tier**: Silver or Gold. Bronze is unlocked only for free developer challenges (both players run their uploaded binary, nothing is staked)
5. Pick the **entry fee** within the tier's bounds (Silver 1,000-4,999 FOXSY, Gold 5,000+). The form shows a live pool calculator next to the input (exactly how much the winner takes home and how much goes to the platform fee)
6. Optionally pick a **specific opponent** by searching their team name or wallet address (leave empty for an open challenge, so any wallet can take it)
7. Pick a **deadline**: 30 min / 1 h / 2 h / 4 h (default 30 min)
8. Click **Create challenge**: your FOXSY entry fee is locked into the challenge pool

The entry fee is written to the tournaments contract when the challenge is created. Accepting it transfers **exactly** that amount, so a payment that is even slightly off is rejected on chain rather than half-seating you.

![Create 1v1 Challenge form (title, description, tier picker, entry fee with live pool calculator, opponent search, deadline buttons)](/screenshots/create-1v1-form.png)

Your synced XI is captured as a **snapshot** at the match's strategy lock, the same way regular tournament matches work. A 1v1 normally kicks off a few minutes after the opponent accepts, so its lineup is captured right then, not when you create the challenge. Training and syncing done before the opponent accepts still count; anything after the lock doesn't.

## Targeted vs open challenges

You pick at creation time whether the challenge is **targeted** at one specific opponent or **open** for anyone to take:

- **Targeted**: only the chosen wallet/team can accept. In the lobby, other users see a **Locked** chip in place of the JOIN button; on the detail page a **Locked** badge sits next to the tier badge and the join area reads **Locked to opponent**. The opponent's name is not shown on the card.
- **Open**: anyone can accept. The first player to confirm and pay the matching entry fee fills the slot.

Either way, home and away are decided by rating once the challenge fills: the **higher-rated (ELO) player is seeded first and plays as the home team**. Creating the challenge doesn't guarantee you the home spot.

> **Why target someone specific?**
> Targeted 1v1s create the "I challenge you to a match" social signal. Other users in the lobby see the badge as it's a visible callout. The targeted user receives a notification of the open challenge, accepts at their convenience (before the deadline) and the match plays.

## Prize split

The current split:

| Place | Share |
|-------|-------|
| **Winner** | 90% of pool |
| **Loser** | 0% |
| **Platform fee** | 10% |

Example: both players stake 1,000 FOXSY → 2,000 FOXSY pool → **winner gets 1,800 FOXSY**, platform takes 200 FOXSY.

A quarter of the platform fee (2.5% of the pool, so 50 FOXSY in the example above) is paid as a **creator royalty** to the provider of the AI binary the match was played with. It is taken from the fee and is sent in the same distribution transaction as the prize, so it never reduces what the winner receives.

## The match

When the opponent accepts, the match kicks off and plays out exactly like a regular FoxLeague match, streaming live to both players. Kickoff is normally scheduled a few minutes later; the wait grows when several tournament matches kick off in the next five minutes. If either player already has another match booked within the next 2 hours, the 1v1 slides to the next free slot after it, keeping a 20-minute window clear for its own broadcast, so the countdown can run longer than expected.

- Match length: **~10 minutes minimum** (longer if it goes to extra time and penalties)
- Both players watch the live game on the challenge detail page

## Draws: extra time + penalties

A 1v1 must produce a winner. If regular time ends level:

1. **Extra time** is played first
2. If still tied, a **penalty shootout** decides the winner (same mechanism used in regular tournament knockouts)

The challenge detail page and the lobby card show the resolution method in the full-time badge: **FT (a.e.t.)** after extra time, **FT (penalties)** after a shootout. A game settled in regular time shows a bare **FT**.

## Prize delivery

The winner's 90% payout is **distributed automatically to their wallet**, about 3 minutes (180 seconds) after the match's broadcast ends. The challenge detail page shows a **distribute transaction link** once the payout fires. No claim action required.

![Completed 1v1 detail (header with LOCKED + SILVER + COMPLETED badges, prize structure card, FT match card with ELO swing and Distribute TX link)](/screenshots/challenge-detail.png)

The **Prize structure** card on the detail page always shows the current pool next to the max pool at full. While the challenge is still waiting for an opponent, the pool line reads as the creator's stake only ("Current pool: 1k FOXSY · Max pool at full: 2k FOXSY" in a 1,000-vs-1,000 example) and each share row shows the same two views ("900 FOXSY now · up to 1800 at full" for the winner). Once the opponent locks in, both halves are in and the "now" value equals the "at full" value.

## Deadline expiry (automatic refund)

If the deadline passes and nobody has accepted (or the targeted opponent never joined):

- The challenge **auto-cancels**
- The creator's entry fee is **refunded in full** to their wallet
- No platform fee is taken on cancellation

You'll see the refund transaction in your wallet history. The challenge shows a **Cancelled** chip in the lobby; no reason text is displayed.

The refund is **exact**: the contract returns the same amount it holds for your entry. If the game server cannot push it back to you, your entry stays in the contract and you can pull it yourself by calling the contract's `claimRefund` endpoint with the challenge id. An entry that landed on chain but never took a seat (for example a join whose page was closed before it was confirmed) shows a **Claim my entry back** button to the wallet that paid it, on the page of the completed challenge.

While your challenge still waits for an opponent, its page also shows **Delete Challenge**. Deleting it refunds your entry fee on chain.

## One active challenge at a time

You can have **only 1 open or in-progress 1v1 challenge at a time per wallet**. The game strictly enforces this. Trying to create a second while one is live shows an error. The cap prevents players from spamming challenges and ensures every 1v1 remains a focused, high-stakes rivalry.

Cancelled or finished challenges don't count. Once your active one resolves (win, loss or deadline expiry), you can create another.

## ELO impact

1v1 results move ELO at the **tournament K-factor of the challenge's tier**: a Silver challenge uses the Silver K-factor (12), a Gold challenge the Gold K-factor (18). This is intentional as 1v1s are high-stakes and should weigh accordingly in your ranking.

- Win → significant ELO gain
- Loss → significant ELO loss
- Draws are impossible in 1v1 (extra time/penalties always resolve)

## Snapshot rules (same as tournaments)

Once the challenge fills and its strategy lock passes:

- Your synced XI is **locked** for this match
- Training/sync after the lock doesn't apply to this match
- Individual players are not locked. Instead your **account** is blocked from starting casual or ranked matches from **1 hour before** the 1v1 (or any of your tournament matches) is scheduled until its broadcast ends
- An open challenge still waiting for an opponent doesn't restrict you at all
- You cannot create or join a 1v1 while you're inside a standard tournament's blocking window (from 1 hour before it starts until 1 hour after its booked play time, about 3 minutes per match without the time between games, so a long tournament can keep playing after its window ends). The error reads "You have a tournament match within the hour"
- Once the broadcast ends, you're free to play again immediately

> **Post-transfer cooldown**
> Any player that arrived in your wallet via a **wallet-to-wallet transfer** within the transfer cooldown (**21 days / 504 hours**; for a card moved before its match gate, **21 days plus 6 hours for every missing match**) **cannot** be staked into a 1v1. Same anti-rental rule that applies to ranked matches plus tournaments. Marketplace purchases, fusion outputs, distribute events, shop mints do **not** trigger the cooldown. Only direct wallet-to-wallet transfers do. You can pay to cut a 21-day transfer cooldown down to a 3-day floor, every day of it or only some, in **Marketplace → Shop → Reduce Cooldown**; the longer lock of a card moved before its gate gets shorter only with match waivers.

## After the challenge

The completed challenge appears in:

- Your **Match History** (with the 1v1 badge, both players' team names, score, decision method)
- Your opponent's Match History (mirror entry)
- The 1v1 lobby under the **Completed** filter (newest first)

There's no separate Hall of Fame for 1v1. They're tracked alongside regular ranked / tournament matches in your career stats.

## Tips

- **Target someone in your ELO range**. Picking a much weaker opponent looks like sandbagging; picking someone much stronger is high-variance gambling.
- **Sync before the opponent accepts**. The snapshot freezes whatever's synced at the match's strategy lock, normally right after the challenge fills. Train/sync first, then challenge, because an open challenge can be accepted at any moment.
- **Pick a deadline you'll honor**. If you target someone, give them time to see and respond. 30 min is aggressive; 1-2 h is conventional.
- **Check the live entry-fee bounds** in the create form.
- **Mind the 1-hour busy window**. Casual and ranked play is blocked from 1 hour before your 1v1 kicks off until its broadcast ends, so plan around the deadline window. Overlapping tournament matches are handled by the scheduler, which slides the 1v1 kickoff past them.

# Shop
(docs.foxleague.ai/mechanics/shop/)

The **Shop** sells one pack of players plus four consumables for FOXSY. The **Common pack** delivers 5 Common player NFTs to your wallet (see below). The consumables are instant condition recovery for tired players, an XP booster that doubles training and eligible match gains, extra training slots for days you want to grind and a cooldown waiver for players you received by direct transfer. Two more items, the **fusion cooldown waiver** and the **fusion match waiver**, show up in the Shop with their live price; they are bought per card from the Fusion tab (see [Fusion](/mechanics/fusion/)). Team badge re-rolls are sold from the **Settings** page rather than the Shop tab. They use the same FOXSY payment flow, so they are listed below for reference.

The pack is the only item that adds cards to your roster. Everything else is a one-shot consumable. No permanent upgrades, no trading and all accept on-chain FOXSY payment.

Find it at **Marketplace → Shop** tab.

## Live prices

The Shop panel always shows the **live** price at the top of every item (check there before confirming):

| Item | Live price | What it does |
|------|------------|--------------|
| **Common Pack** | 2,500 FOXSY for 5 Common players | 5 random Common player NFTs delivered to your wallet. At most 2 packs per wallet per rolling 7 days |
| **Condition Recovery** | up to 100 FOXSY per player (pro-rated by missing condition) | Instantly restores one player to full condition |
| **XP Booster** | 2,000 FOXSY | 2× XP on every training session and eligible match for 24h |
| **Training Slot** | 20 FOXSY per slot | +1 extra training session on today's cap |
| **Reduce Cooldown** | per day reduced, by rarity: Common 25, Uncommon 75, Rare 200, Epic 500, Legendary 1,250 FOXSY | Cuts a transferred player's cooldown down to a 3-day floor, every day or only some of them. Not for a card moved before its match gate |
| **Fusion Cooldown Waiver** | 75 FOXSY per day | Cuts a fused card's own fusion cooldown down to a 3-day floor, every day or only some of them. Bought per card in the **Fusion** tab |
| **Fusion Match Waiver** | per match, by rarity: Uncommon 20, Rare 100, Epic 100, Legendary 100 FOXSY; none for Common | Credits competitive matches a card still needs for the match gate of its rarity, never the matches that must really be played. Bought per card in the **Fusion** tab |
| **Badge Regeneration** | 1,000 FOXSY (first 3 re-rolls are free) | Re-roll your team badge with a fresh AI-generated image. Sold from **Settings**, not the Shop tab |

---

## Common Pack

The only Shop item that adds players to your roster. One pack is **5 Common player NFTs for 2,500 FOXSY** (500 per card). It is the way to grow beyond the 18 starter cards without waiting for the marketplace, whether you need spare bodies for rotation or fusion inputs.

- **Balance check**: every FOXSY payment in the app (packs, consumables, fusion waivers, badge re-rolls, tournament entries, bids) compares the price with your FOXSY balance before your wallet opens. When the balance is too low the app says so (with what the item costs) and nothing is signed. If the balance cannot be read at that moment, the purchase is not blocked
- **Cap**: at most **2 packs per wallet per rolling 7 days**. The Shop card shows how many packs you can still buy this week; the third attempt inside the window is refused before any FOXSY moves
- **What you get**: 5 Commons with random positions, weighted like a starter squad (2 GK, 6 DEF, 6 MID, 4 FWD out of 18), so over a few packs you end up with a normal spread. Within a position the card is uniformly random. Stats are the pre-rolled Common stats of the card, inside the Common range
- **Where they come from**: the pre-minted Common pool the platform also uses for starter squads. The Shop card reads **sold out** in two cases: fewer than 5 Commons are free in the pool; the platform's daily pack budget is spent (100 packs a day for all managers together, reset once a day at the MultiversX epoch change, about 16:35 UTC). In both cases the purchase is refused without charging you. Try again once the pool is restocked or the budget resets
- **Delivery**: the game server sends the 5 cards to your wallet about a minute after the payment confirms. The Shop card shows **5 players on the way** until they land in your Squad. If the delivery fails the FOXSY is refunded through the usual refund sweep
- **What the cards carry**: 0 competitive matches and no cooldown of any kind. They can play at once. They can be fused or auctioned only once they reach the Common match gate: 5 competitive matches, all really played (see [Fusion](/mechanics/fusion/) and [Marketplace](/mechanics/marketplace/))

> **Packs and fusion**
> Three Commons from one pack are a fusion triplet once each has played 5 competitive matches (a Common has no match waiver). A full Common-to-Legendary lineage needs 81 Commons: 17 packs, 8 weeks (56 days) at 2 packs per rolling week. The worked path is on the [Economy map](/mechanics/economy-map/).

---

## Condition Recovery

Training costs 5 condition, a tournament or 1v1 appearance costs 10, a ranked or casual one costs 5 and natural regeneration is only 2 points an hour. Those are the values for players under 30. Every cost rises with age past that point and the regeneration slows, down to 1 point an hour at 39, when every cost is three times its base (a tournament match 30, a ranked one 15, training 15) and a full rest from 0 takes about 4 days (see [Player Aging](/mechanics/aging/)). If you want to push the squad harder than the regen rate allows, buy recovery.

The price is pro-rated by missing condition: the 100 FOXSY in the table is the full 0 → 100 price, so you pay ~1 FOXSY per missing point. A player sitting at 70 condition costs 30 FOXSY to top up.

- **Per-player**: pick a specific player, pay their pro-rated price, they instantly return to 100 condition
- **Recover All**: one click restores every player below 100 condition. Cost = the sum of each player's pro-rated price

> **When to buy**
> Recovery pays off before a match block where you need your XI rotating quickly.

---

## XP Booster

A 24-hour consumable that **doubles XP** on every training session and eligible match during its active window. One at a time. Buying again while one is already active restarts the 24h clock from the latest purchase.

- **Effect**: 2× XP on training and on eligible matches for 24h. Match XP is only awarded on Silver and Gold tournament matches plus paid 1v1 challenges. Ranked, casual and practice (vs AI) matches earn no XP, so the booster has no effect there
- **Stacking**: not with itself (only one active window). Featured tournament rewards grant the winner 2× match XP for 48h and the runner-up 1.5× for 24h. When one of those overlaps a shop booster, the highest single multiplier applies, never the product of both. Those tournament grants cover match XP only. Training XP is boosted by the shop booster alone
- **Tracking**: the Shop tab shows an active-booster banner with the expiry time

Training XP base is `20 × (condition / 100)`. With booster active, that becomes `40 × (condition / 100)`. A full-condition player earns **40 XP per training session** instead of 20.

> **Best use**
> Time the booster to your grind sessions. Buying one while you're about to log off wastes hours. Buy **at the start** of a long training block so the full 24h gives you the most bumps.

---

## Training Slots

There's a **daily training cap** per wallet (currently **5 free sessions per day**), after which you need to buy more slots if you want to keep training. Once you hit the cap, the regular train button is greyed out.

Each **Training Slot** you buy adds **1 extra training session** on top of the free daily cap. Purchased slots are banked on your account and never expire: whatever you don't use today stays available on any later day.

- **Effect**: +1 training session on today's cap
- **Limit**: you can use up to **10 banked slots per day** on top of the 5 free ones (so absolute max = 15 training sessions per day). The day is not a rolling 24h window. Both counters reset at a fixed **14:00 UTC**
- **Per purchase**: up to 25 slots in one transaction. Anything you buy beyond a day's ceiling stays in the bank for later days
- **Expiry**: none, banked slots persist until used

> **Pair with the booster**
> A Training Slot by itself gives up to 20 XP (at full condition). A Training Slot **during an active XP Booster** gives up to 40 XP. Buy the booster first, then stack slots underneath it.

---

## Reduce Cooldown

A player received through a direct **wallet-to-wallet transfer** carries a transfer cooldown before it can play: **21 days** for a card that had reached the match gate of its rarity when it moved, **21 days plus 6 hours for every missing match** for a card that had not (the length is fixed on the card at the moment of the transfer; see [Marketplace](/mechanics/marketplace/)). An auction win never starts one. A card sold while its cooldown is still running keeps the rest of it, so the buyer inherits that remainder; the listing shows it before anyone bids. The **Reduce Cooldown** item lets you pay FOXSY to bring the cooldown of a card that had reached its match gate down to a hard **3-day floor** (72 hours). The last 3 days can never be waived. Anyone has to wait at least three days no matter how much they pay.

Pick a cooled-down player in the picker. The Shop shows the exact cost, which depends on the player's rarity and on how much cooldown is left:

- The cost is charged **per whole day above the floor**. The per-day price depends on the **rarity** of the player: it is the 10% marketplace fee on that rarity's reference price, spread over 20 days.
- Time is rounded **up** to whole days. A player with 9 days and 4 hours left has 6 days and 4 hours above the floor, so you pay for **7** days to reach it. A player with exactly 4 days left pays for **1** day.
- You choose **how many days** to buy: every day lands exactly on 3 days; fewer days end the cooldown that many days earlier, at the same price per day.

| Rarity | Per day reduced | Full waiver, fresh 21-day transfer (18 days) |
|--------|-----------------|----------------------------------------------|
| Common | 25 FOXSY | 450 FOXSY |
| Uncommon | 75 FOXSY | 1,350 FOXSY |
| Rare | 200 FOXSY | 3,600 FOXSY |
| Epic | 500 FOXSY | 9,000 FOXSY |
| Legendary | 1,250 FOXSY | 22,500 FOXSY |

Only players currently in cooldown appear in the picker. The waiver does nothing for a player already at or below the 3-day floor. Reduce Cooldown is refused for a card that moved before its match gate: that lock gets shorter by 6 hours with each fusion match waiver bought for the card, down to 21 days plus 6 hours for every match it still has to really play. A lock that was already running on Monday 12 October 2026 at 14:30 UTC (the earlier rule locked a card under 20 competitive matches for 63 days) keeps Reduce Cooldown; it was never made longer and ends at the shorter of its own length and the new length for the card.

---

## Fusion waivers

Two items for the [Fusion](/mechanics/fusion/) flow. You buy them per card from the **Fusion** tab (the Shop card just points you there), with a floor that money never crosses:

- **Fusion Cooldown Waiver**: every fused card carries its own 14-day fusion cooldown before it can be fused again. Pay **75 FOXSY per day** to bring it down to the **3-day floor**; buy only some of the days and its ready time moves that many days earlier. The last 3 days can never be waived. A fresh output waived all the way costs 11 days, 825 FOXSY. The card must be in your wallet, not listed and not in an auction.
- **Fusion Match Waiver**: fusion needs the match gate of the card's rarity. Pay per missing match: **20 FOXSY** for an Uncommon (up to **10** of its 15), **100 FOXSY** for a Rare (up to **30** of 45), an Epic (up to **90** of 135) or a Legendary (up to **270** of 405). A Common has no match waiver. The rest must be played for real. The credit stays on the card, also when it is sold. On a card moved before its gate each waived match takes 6 hours off its transfer lock.

The per-card details, quotes and the exact floors are on the [Fusion](/mechanics/fusion/) page.

---

## Payment flow

Every shop purchase is an on-chain FOXSY transaction:

1. Pick the item
2. Pick the target player (for condition / cooldown). The Common pack has no target. The two fusion waivers are picked and paid from the Fusion tab instead
3. Review the cost
4. Click **Pay Now**
5. Approve the FOXSY transaction in your wallet
6. Wait ~10 seconds for confirmation
7. Effect applies immediately. Booster clock starts, slot added, condition restored. A Common pack is the exception: its 5 cards arrive about a minute later, sent by the game server

No off-chain purchases, no hidden fees beyond the listed price. If a payment lands with the wrong amount or the effect cannot be applied, the FOXSY is refunded automatically: usually within seconds, with a retry sweep every 5 minutes and a cap of 10 automatic refunds per wallet per hour.

## Purchase history

The Shop tab keeps a **history** panel. Every purchase you've made, with date, item, target player (if applicable) and the amount of FOXSY paid. Useful for expense tracking if you're chasing a tournament run.

# Sync to Chain
(docs.foxleague.ai/mechanics/sync/)

> **The one rule**
> **Not synced? You play with last synced stats**.

## Why sync exists?

Every player has two versions of their stats:

- **On-chain**: the official, blockchain-verified version that matches read from
- **In your Squad view**: the live working version you see, which updates instantly after every training session

Training updates your Squad view immediately. But **matches are played on-chain**. The blockchain version is what your team actually brings to the pitch, what shows on the leaderboard and what buyers see in the marketplace.

If every +1 stat bump had to be written to the chain individually, you'd pay gas for thousands of transactions. So FoxLeague batches the writes: training runs off-chain with no network fee, then you **sync** when you want your improvements to count in matches. Training itself has a daily allowance per wallet: **5 free sessions a day**, then paid [Training Slots](/mechanics/shop/#training-slots) at **20 FOXSY** each, at most **15 sessions a day** in total.

In the Squad view, unsynced players show an orange "Sync All" banner with the cost calculated up-front.

## How sync works

1. You train players, stats grow in your Squad view, players are marked **unsynced**
2. The Squad page shows a banner: **"+15% squad power locked. Sync to unleash"** (the wording softens for smaller gaps)
3. Click **Sync All** (or sync a single player from their profile)
4. A FOXSY transaction appears in your wallet
5. Approve it. The transaction writes all your recent stat increases to the blockchain in one batch
6. After confirmation, your players are **synced**. The blockchain matches your Squad view and the new stats apply in your next match

## Cost

Sync is paid in FOXSY at a flat **10 FOXSY per player**. Syncing 12 players costs 120 FOXSY; one player costs 10 FOXSY. The Sync All button shows the exact total before you sign (no surprises).

The cost is always displayed live on the Squad banner before approval, so make sure to review the total before confirming.

## When to sync

There's no "right" answer. It depends on your style:

- **After every training session**: instant gratification, but a higher total cost over time
- **Before each ranked match**: strategic, ensure your best stats apply
- **Once per session**: efficient, batch all your training in one go
- **Rarely**: accept the gap, just play with what you have on chain

The banner percentage tells you exactly what you're missing. **0%** = nothing to sync. **15%+** = you're playing with stats significantly weaker than what you've trained but haven't yet synced.

The percentage is measured over your 11 lineup starters only (your whole squad until you save a lineup), while the Sync All cost counts every unsynced player, bench included.

## What can't you do without sync

A few actions REQUIRE you to sync first:

- **Fusion**: you can't fuse an unsynced player, so sync them first as fusion reads the latest stats.
- **List on the marketplace**: bidders pay for the on-chain version, so you must sync before you put a player up for auction.

Match play does NOT require sync. You just play with the previous synced values.

## What about XP?

The per-stat XP meters (Speed XP, Accuracy XP, etc.) are **purely off-chain**. They don't push on chain at all. They're tracked privately for your team. A sync writes the full on-chain player record: the seven stat values, level, total XP, shirt number, current condition plus the career counters (matches played, goals, assists). Name, position, rarity and country travel along unchanged. One detail: the on-chain matches played counter carries the player's **competitive** matches only, the number the match gate of its rarity reads (Common 5, Uncommon 15, Rare 45, Epic 135, Legendary 405) for fusion, listing and the match waiver. The career total that includes games against the AI stays in the app. See [Fusion](/mechanics/fusion/).

This means a stat bump never costs a network fee of its own. What limits training is the daily allowance: the first **5 sessions a day** per wallet are free, sessions 6 to 15 each use a paid **Training Slot** (20 FOXSY) and after 15 the day is over until the **14:00 UTC** reset. Sync is only the gate to APPLYING those gains in matches.

## What about new players?

New players from the shop, fusion or marketplace purchases arrive **fully synced**. Their on-chain stats match their current stats from the moment you receive them. No sync needed until you start training them.

The exception: **wallet-to-wallet transfers** (gifts, OTC trades) come with a **transfer cooldown** (currently 21 days / 504 hours; for a card moved before its match gate, 21 days plus 6 hours for every missing match) before the new owner can use the player in matches. This is anti-snipe protection. Winning an auction starts no transfer cooldown. A card that is still inside one when it sells keeps the rest, so the buyer inherits it; the listing shows it before you bid.

## TL;DR

| If you... | Do this |
|-----------|---------|
| Trained players and want to use new stats in matches | **Sync** |
| Want to fuse an unsynced player | **Sync first** |
| Want to list an unsynced player for sale | **Sync first** |
| Want to play a match (any type) | Just play (the system uses synced stats automatically) |
| Want to know what you're missing | Look at the banner on Squad |

# Tactics & Formations
(docs.foxleague.ai/mechanics/tactics/)

The **Tactics** tab is where you commit who plays and how they're arranged. Your saved lineup + formation drive every match you kick off.

![Tactics page (formation picker, pitch with assigned XI, starting XI list, substitutes bench)](/screenshots/tactics-page.png)

## Formations

FoxLeague offers **eight formations**. Some share the same base shape (two variations of 4-4-2, three of 4-3-3) but adjust player positioning and attacking style differently. Pick the one that matches your squad's strengths.

A ninth, **4-4-2 - All-Out Attack**, is not offered yet because the match engine cannot play it. A team that saved it earlier plays **4-4-2 - Balanced** in its matches until it is available. Its card stays in Tactics marked **Coming soon**, with a notice.

### 4-4-2 family

- **4-4-2 - Balanced**. Classic. Four defenders, four midfielders, two strikers (even coverage across all areas).
- **4-4-2 - Offensive**. Midfield pushes up into a 4-2-4 attacking shape with four forwards.

### 4-3-3 family

- **4-3-3 - Attacking**. Three forwards, strong attacking power with wide play (midfield can be exposed).
- **4-3-3 - Balanced Attack**. Balanced 4-3-3 that maintains shape in both phases (same attacking and defending).
- **4-3-3 Wide - Wide Play**. Wide 4-3-3 in attack, drops into 3-4-3 in defense. Wing forwards stretch the opposition with maximum width.

### Other shapes

- **4-2-3-1 - Counter Attack**. Modern setup. Double pivot shields the defense and collapses to 3-1-3-3 when defending.
- **5-3-2 - Solid Defense**. Five at the back, three midfielders link play to two forwards.
- **5-2-3 - Wing Attack**. Five defenders transition into 3-2-3-2 when attacking. Wing-backs push forward to support three forwards.

Pick by clicking the formation card at the top of Tactics. The pitch view animates to the new shape and fills it with your best XI for that shape as an unsaved draft. Nothing changes until you click **SAVE**. Clicking your saved formation again brings back your saved lineup.

## Setting your XI

The pitch view shows position slots. Drag a player from your roster (left side) into a slot. Constraints:

- Position must match (a Defender can't fill a Forward slot)
- Player must be **eligible** (not listed for sale, not in a transfer cooldown)
- One slot per player (you can't field the same player twice)

Each slot shows the position requirement (GK / DEF / MID / FWD) and the assigned player's OVR. Empty slots are red.

## Save your lineup

On the formation you have saved, every change you make to the lineup (a drag, a tap swap, **BEST XI**) is saved at once. A different formation card opens as an unsaved draft: the **SAVE** button appears at the top of the page next to **BEST XI**. The draft (with any change you make to it) is committed only when you click it. The saved formation carries a green **Saved** badge. The Squad Readiness widget on PlayMatch shows the formation you saved next to its **ready / owned** count.

If you leave a draft unsaved, your saved formation and lineup stay in effect.

## Rotating reserves in

If you own more than 18 players (e.g. you've bought extras on the marketplace or fused new ones), the surplus shows up in a **Reserves** strip below the bench. You can rotate them into the lineup or onto the bench **directly from Tactics**. No need to bounce out to the Squad page.

The flow is **tap-to-select, tap-to-place**:

1. **Tap a Reserve card**. It gets an orange outline and the hint above the strip reads *Tap a highlighted lineup or sub slot to swap. Tap reserve again to cancel.* Only the slots of the same position (in the XI or on the bench) accept the tap; an empty one reads *Tap to swap here*.
2. **Tap a highlighted slot**. The Reserve swaps in. Whichever player was occupying that slot is displaced. They drop back into the Reserves pool.
3. On your saved formation the swap is saved at once. On an unsaved formation draft, click **SAVE** to commit it.

You can cancel a selection by tapping the same Reserve again.

Position still matches strictly. A Forward Reserve can only swap into Forward slots. Listing or fusing a Reserve still happens on the **Marketplace → Fusion** / **Marketplace → Sell** flows.

## What actually drives the match

When you kick off:

1. Your **saved lineup** decides who's on the pitch.
2. Each player's **synced** stats drive their on-pitch performance: passing range, shot power, recovery, decision-making. Any training that isn't synced yet won't show on the pitch.
3. Your **formation** decides starting positions and roles.
4. The match plays out live (around 10 minutes). Watch the action unfold, then check your History to relive past matches anytime.

Level does not change in-match performance. Condition does: every stat of a starter is scaled by condition, from full strength at 100 down to half strength at 0. Condition also decides availability (see below). Your synced stats, the right players in the right positions and the formation that fits them are what win games.

## Squad Readiness widget

The widget on **PlayMatch** shows ready / owned players, where **ready** means the player's condition is at or above the match floor (currently **30**). It's a health check, not the kickoff gate. To kick off you need a saved lineup of 11 starters + 7 substitutes, at least **18 unlisted players** in your wallet, no starter at 0 condition and none of the 18 (starters or bench) in a transfer cooldown.

Reasons a player might NOT be ready:

- **Below the condition floor**: condition under 30. In tournaments and 1v1s such starters are auto-substituted from the bench; if fewer than 11 fit players remain the match is forfeited 3-0

Reasons a player can't be fielded even when ready:

- **In transfer cooldown**: 21 days (504h) after a wallet-to-wallet receive, which you can pay to cut to a 3-day floor, every day of it or only some, in **Marketplace → Shop → Reduce Cooldown**. A card moved before its match gate: 21 days plus 6 hours for every missing match, shorter only with match waivers
- **Listed for sale**: escrowed on the marketplace until you cancel the listing

Kickoff can also be blocked at the **account** level: from 1 hour before one of your tournament or 1v1 matches is scheduled until its broadcast ends, casual and ranked play is off.

The widget breaks down by position so you see if you're short of, e.g., midfielders.

## Tips

- **Match stats to position**. A high-Defense Defender is worth more than a high-Defense Forward. Stats interact with their role on the pitch.
- **Sync and lineup are independent**. A sync writes every card of yours that has unsynced training (or the one card you sync from its profile), whether or not it is in your XI. Saving the lineup changes nothing about what is synced.

# Tournaments
(docs.foxleague.ai/mechanics/tournaments/)

FoxLeague tournaments are **multi-match formal events** with locked lineups and FOXSY prize pools. A single tournament can span an hour or two (fast Bronze knockouts) to several days (large Swiss or round-robin events) depending on format, team count and round interval.

> **Looking for 1v1?**
> For one-on-one challenges with a single match and a winner-takes-most split (currently 90/10), see [1v1 Challenges](/mechanics/one-v-one/). This page covers multi-team tournaments only.

## How to join

1. Open the **Tournaments** tab
2. Pick one from **Browse** (listed under **Open** with slots still free; the status filter calls these **Upcoming**)
3. Click **JOIN**
4. If there's an entry fee (Silver / Gold tier), approve the FOXSY transaction in your wallet
5. Your team is now entered. Each match captures your formation, lineup and players' synced stats at its **strategy lock** (about 30 minutes before that match's kickoff), so you can adjust your plan between games

The entry fee and the number of seats are written to the tournaments contract when the tournament is created. Joining pays **exactly** the entry fee into a **free seat**. A payment that does not match the fee is refused on chain. So is a join into a bracket that has already filled, so nothing leaves your wallet in either case.

> **Keep improving between matches**
> Joining does not freeze your team. Each match uses your players' **synced** stats at its strategy lock, so training you **sync before a match locks** counts for that match. See [Match-day strategy](/mechanics/match-day-strategy/).

> **Post-transfer cooldown**
> Any player that arrived in your wallet via a **wallet-to-wallet transfer** within the transfer cooldown (**21 days / 504 hours**; for a card moved before its match gate, **21 days plus 6 hours for every missing match**) **cannot** be staked into any tournament (Bronze, Silver or Gold). Same anti-rental rule already in effect for ranked plus 1v1 matches. Marketplace purchases, fusion outputs, distribute events plus shop mints do **not** trigger the cooldown. Only direct wallet-to-wallet transfers do. A sale does not clear a lock that is already running: the buyer inherits the rest. You can pay to cut a 21-day transfer cooldown down to a 3-day floor, every day of it or only some, in **Marketplace → Shop → Reduce Cooldown**; the longer lock of a card moved before its gate gets shorter only with match waivers.

You can also create your own tournament via **Tournaments → Create**.

---

## The four formats

### Knockout

Single-elimination bracket.

- **Team counts**: 4, 8, 16 or 32 (exact size; the bracket starts only when full, so every team has an opponent)
- **Matches per team**: 1-5 (depending on how far you go)
- **Rounds**: log₂(N) (4 teams = 2 rounds, 32 teams = 5 rounds)
- **Seeding**: classic seeded bracket (#1 vs #N, #2 vs #N-1, etc.) based on ELO at the moment the bracket is generated, when registration closes
- **Draws** are resolved through **extra time** and if needed, a **penalty shootout** (see below)
- **Optional 3rd-place match** between the two semifinal losers

Best for: quick, high-stakes tournaments with exciting upsets.

### Groups + Knockout

Group stage followed by single-elimination.

- **Team counts**: 8, 16, 32 or 64 (exact size; it starts only when full, so the advancing field always forms a clean knockout bracket)
- **Group stage**: groups of 4, round-robin (each team plays 3 matches). Points: 3 win / 1 draw / 0 loss. Teams level on points are separated by head-to-head first (full rules in [Tie-breakers](#tie-breakers))
- **Top 2** from each group advance to the knockout bracket
- **Cross-group KO pairing**: A1 vs B2, B1 vs A2. Further group pairs follow the same pattern. Two teams from the same group sit in opposite bracket halves, so they can only meet in the final

Best for: balanced competition (everyone plays multiple matches), but stakes rise in the knockout.

### Round Robin

Everyone plays everyone.

- **Team counts**: any size from 3 to 20. Odd counts work; one team rests each matchday
- **Matches per team**: N−1 (4 teams → 3 matches, 8 teams → 7, 20 teams → 19)
- **Home & away**: the creator can turn on a double round robin, so each team plays every other team twice (once home, once away) for 2×(N−1) matches per team. The return leg runs after the first leg completes, so the event takes twice as long
- **Standings** by points (3 win / 1 draw / 0 loss). Teams level on points are separated by the [tie-breakers](#tie-breakers) below
- **No elimination** (every team plays every match)

Best for: fair ranking as the best team usually wins. Great for small groups and mini-leagues.

### Swiss

Teams are paired at random in round 1, then by standing (no rematches).

- **Team counts**: any size from 3 to 32. The creator sets a max; the event runs with whoever joins by the deadline, odd or even, as long as at least 3 teams joined
- **Rounds**: log₂(N) rounded up, plus 1, where N is the number of teams that joined (8 teams → 4 rounds, 12 → 5, 16 → 5, 32 → 6)
- **Pairing**: round 1 is drawn at random. From round 2 on, teams with similar records (points, then goal difference) face each other
- **Byes**: with an odd field one team sits out each round with a bye, scored as a win (3 points). In round 1 that team is drawn at random; from round 2 on it is the lowest-ranked team
- **Final standings** determine placement after all rounds are played

Best for: large tournaments with limited time. Everyone plays, strong teams eventually face strong opponents.

---

## Tie-breakers

When two or more teams finish a standings table level on points, FoxLeague separates them with a head-to-head mini-table before it falls back to overall stats. The order is:

1. **Points** across all group matches.
2. **Head-to-head mini-table**, built from only the matches between the level teams. Inside it the order is:
   - points in those matches
   - goal difference in those matches
   - goals scored in those matches

   If the mini-table splits the level teams into smaller groups that are still tied, it is rebuilt from just the matches among each remaining group, then applied again.
3. **Overall stats**, used only when the mini-table still cannot separate the teams:
   - overall goal difference
   - overall goals scored
   - higher ELO rating
   - lower participant id, meaning the team that registered for this tournament earlier

The final step relies on the participant id, a value unique to every entry in the tournament, so the ranking is always fully decided with no random draw.

These rules cover every standings table: the Groups + Knockout group stage, Round Robin, plus Swiss. In Swiss two level teams may not have played each other. When that happens the head-to-head step has nothing to compare, so the ranking falls straight through to the overall stats.

---

## The three tiers

Tiers scope the stakes:

| Tier | Entry fee | Best for |
|------|-----------|----------|
| **Bronze** | Free | Practice and casual competition; a Bronze event the FoxLeague team features also enters the Hall of Fame |
| **Silver** | 1,000-4,999 FOXSY (creator picks within the range) | Competitive stakes with a real prize pool |
| **Gold** | 5,000+ FOXSY (creator picks) | Highest rewards, most serious competition |

The creator sets the exact FOXSY amount when creating a Silver or Gold tournament, constrained by the tier's bounds shown above. Bronze is always free.

---

## Creating a tournament

Open **Tournaments → Create** and step through format, tier, configuration, schedule and a final confirmation. You can have at most one active tournament you created as a player plus one you created as organizer-only at any time (admins are uncapped as organizers). 1v1 challenges have a separate cap of one active challenge per team. Two creation options are worth calling out.

![Create Tournament configuration step with the Private (invite-only) toggle on, the invited teams listed below it, plus the Organizer only toggle](/screenshots/tournament-create-private.png)

### Private (invite-only)

Flip the **Private** toggle to control who can register, then invite specific teams by searching for them. A private tournament:

- Still appears in the public lobby with a **Private** badge, so everyone can see it exists.
- Can only be joined by the teams you invited. Everyone else sees a locked **Private (invite only)** button.
- Needs enough capacity to reach the minimum. Capacity is the invited teams plus yourself (only the invited teams if you host as organizer-only). If that falls short of the minimum you cannot create it until you invite more teams or lower the minimum.

![A private tournament in the lobby, marked with a PRIVATE badge next to its title](/screenshots/tournament-private-badge.png)

### Organizer-only (host without playing)

On any tournament (Bronze included), flip **Organizer only** to run the event without competing in it. As an organizer-only host you:

- Take **no slot**. On a paid tier you also pay **no entry fee**. Every slot stays open for the other teams.
- See **no Join button** on your own tournament. You are running it, not playing.

This is the clean way to host a private event for a fixed set of invited teams. Invite the full field (for an 8-team tournament, invite 8 teams), since you do not take a slot yourself.

### Deleting your tournament

While your tournament is still open for registration, its page shows **Delete Tournament** to you as its creator, at the bottom of the page. Once it has started or finished it cannot be deleted. On a Silver or Gold tournament the delete first refunds the entry fee of every team that paid one, on chain. The tournament is removed only once its contract entry is closed and FoxLeague's records show every entry fee returned; until then it stays cancelled.

---

## How your team is used in matches

Your team is **not** frozen when you join. Each match captures your team at its **strategy lock**, about 30 minutes before that match's kickoff:

- **Formation and lineup**: whatever you have saved at the lock. Change them between matches to plan for each opponent.
- **Player stats**: each player's **on-chain synced** attributes as they stand at the lock. Training counts for a match only once you **sync** it before that match locks.
- **Condition**: read **live** at the lock. It regenerates passively between matches.

A match already past its lock is fixed. Newer syncs, training and lineup changes only affect your **future** matches.

> **Field a complete, owned squad at every lock**
> At each match's lock your squad must be a legal **11 starters plus 7 substitutes, all still in your wallet**. If it is short (for example you sold a player without replacing it) that match is **forfeited 3-0**. You return to normal as soon as you complete your squad again.

See [Match-day strategy](/mechanics/match-day-strategy/) for the full flow, the Upcoming Games page and the lock countdowns.

---

## Schedule

Every tournament has:

- **Registration deadline**: last moment to join before the bracket is generated
- **Tournament start**: when the first match kicks off. Must be at least **1 hour after creation** so the bracket can be pre-scheduled, more than 5 minutes after the registration deadline and at most 90 days ahead
- **Time between games**: every match is played one at a time, this many minutes apart. The creator picks a step from 30 minutes up to a day: **30 min / 1 h / 2 h / 4 h / 6 h / 8 h / 12 h / 1 day**

Games run fully sequentially, one every "time between games", so spectators can watch each match end to end. A short interval with a small bracket wraps up in a few hours. A large field or a 1-day interval can stretch a tournament across several days.

If one of the two teams in a match is busy with a match in another tournament at that time, the scheduler pushes the match later (keeping a 20-minute clearance around the other commitment) and every match after it shifts with it. A tournament can therefore run longer than the plain estimate, never shorter.

### Blocking window (anti-overlap)

Each tournament reserves a **blocking window** from one hour before its first kickoff until one hour after its booked play time. The booked play time counts about 3 minutes per scheduled match and ignores the time between games, so the window is a coarse reservation rather than the real span. The check runs when a tournament is **created**: the new window may not overlap the window of any other tournament on the platform that is not completed or cancelled, otherwise creation fails with a time-slot conflict. Joining has no window check. 1v1 challenges cannot be created or joined while you are inside the blocking window of a tournament you are in; they never reserve a window of their own.

You do not have to guess a free time. On the Schedule step the form tells you whether the start you picked is free and, when it is not, proposes the **next free slot** with a **Use this slot** button. **See free times** opens a calendar in your own time zone: every start where your tournament fits is green. The windows of other tournaments are shown with their titles. A gray block is another tournament's start window: the hour before its kickoff, the time it needs to get its first round under way and an hour after. Hover over it or tap it to see the tournament and its booked times. A tournament that runs for days books only this window; its later rounds run alongside other tournaments, so they do not block the calendar. A new tournament cannot start inside a gray block. One tap on a green start sets the start and the registration deadline and keeps the rest of the form. The calendar and the creation check use the same rule, so a green start is one that creation accepts.

---

## Seeding

When registration closes, all participants are seeded by ELO rating:

- **Seed #1** = highest ELO at the moment the bracket is generated
- **Seed #N** = lowest ELO

Seeding drives:

- **Knockout** bracket slots (classic #1-vs-#N pairing so top seeds don't meet in round 1)
- **Groups + KO** pot distribution (balanced groups)
- **Swiss** doesn't use seeding either: round 1 is drawn at random, later rounds pair by standing
- **Round Robin** doesn't use seeding for match order (everyone plays everyone)

---

## Draws and penalty shootouts

- **Round Robin / Group stage / Swiss** draws are legal results (1 point each).
- **Knockout / semifinal / final / 3rd-place match** draws cannot stand. The tie goes to **extra time** and if still unresolved, to a **penalty shootout**, with the winner advancing.

---

## Third-place match

Knockout and Groups + KO tournaments support an **optional 3rd-place match** between the two semifinal losers. The creator toggles this when setting up the tournament. In a featured tournament the Hall of Fame lists the 3rd-place team alongside the champion and runner-up.

If the creator leaves it OFF, both semifinal losers finish as "3rd/4th" without separation.

---

## Auto-subs and forfeit

FoxLeague expects you to own a full 18 (11 starters + 7 substitutes) when your next tournament match locks. If a starter is not match-fit at that moment (condition below 30 or in the transfer cooldown), the tournament **automatically substitutes** a fit bench player in.

- The match report shows which auto-subs were applied for each side
- If fewer than 11 match-fit players can be assembled from your 18 (or you no longer own all 18), your team **forfeits** the match 3-0 and the opponent takes the win. The forfeit reason is shown on the match card so you know what went wrong
- If **both** teams forfeit the same match, it is recorded 0-0 as a loss for each side and each loses 1 standings point, so a standings total can go below zero

Keep your bench deep. A forfeit in round 1 of a Gold Knockout is an expensive lesson.

---

## Hall of Fame

Completed tournaments that the FoxLeague team marked as **featured** are archived in the **Hall of Fame** tab. Any tier can be featured, Bronze included. Each entry shows:

- Tournament title, format, tier, completion date
- **Winner** team name + badge
- **Runner-up** team name + badge
- **3rd place** team name + badge (if a 3rd-place match was played)

A permanent record of every featured tournament. A tournament that was not featured keeps its bracket and results on its own page.

---

## Prize distribution

When a Silver or Gold tournament completes, the prize pool (entry fee × the number of teams that actually joined, not the maximum) is distributed on-chain automatically. Winners receive their share directly in their wallet with no claim action needed:

The current split:

| Place | Share of pool |
|-------|---------------|
| **Winner** | 45% |
| **Runner-up** | 30% |
| **3rd place** | 15% |
| **Platform fee** | 10% |

In a Knockout or Groups + KO event without a 3rd-place match there is no third-place finisher, so the 15% goes to the runner-up (45 / 45 / 10). In Round Robin and Swiss, 3rd place is the third team in the final standings.

Example (with a 3rd-place match): 16 teams × 1,000 FOXSY entry = **16,000 FOXSY** pool → 7,200 winner / 4,800 runner-up / 2,400 third-place / 1,600 platform fee.

A quarter of the platform fee (**2.5% of the pool**, so 400 FOXSY of the 1,600 in the example above) is paid as a **creator royalty** to the provider of the AI binary the matches were played with. It is taken from the fee and travels in the same distribution transaction as the prizes, so it never reduces what the winners receive. The contract enforces this. Prize payouts must land between 85% and 90% of the seated pool. The royalty itself is capped on chain at 2.5% of that pool.

Tournaments flagged as **featured** by the platform admins also award XP boosts: the winner gets 2× XP for 48 hours plus a Tournament Champion badge and title, the runner-up gets 1.5× XP for 24 hours. Boosts do not stack with each other or with the shop XP booster; the highest active multiplier applies.

Bronze tournaments have no entry fee and therefore no prize pool. They change no ELO and give no XP, so they're for practice and casual competition. A Bronze tournament the FoxLeague team features also enters the Hall of Fame. Its winner and runner-up then get the featured rewards described above.

---

## Tips

- **Plan for the whole run**. You must field a legal 11+7, all owned, at every match's lock or that game is forfeited. Nothing stops you from joining two tournaments that run in the same period, so check both schedules before committing.
- **Watch the time between games**. Games are sequential, so the total length is roughly the number of games times the interval. A 30-minute interval with a small bracket wraps up in a few hours. A large field or a 1-day interval spans days. It runs longer still when matches are pushed back to keep a team clear of its other tournament.
- **Check the tier before committing FOXSY**. Silver and Gold entry fees leave your wallet the moment you join. Leaving while registration is still open (before the deadline) refunds the fee on-chain. Once the deadline passes you cannot leave. Every refund is **exact**, down to the amount the contract holds for your entry. If a tournament is cancelled (or you paid on chain but never took a seat) and the game server cannot push your money back, it stays in the contract. Once the tournament is cancelled or completed you can pull it yourself: the page of a completed tournament shows a **Claim my entry back** button for an entry that never took a seat. You can also call the contract's `claimRefund` endpoint with the tournament id.
- **Add a third-place match if you can**. Without it the 15% third-place share simply goes to the runner-up; with it a third team gets paid.
- **Sync before a match's lock, not just before joining**. Each match reads your synced stats at its lock, so train and sync ahead of a game for the improvement to count. Unsynced training does not.

# Training
(docs.foxleague.ai/mechanics/training/)

Training is how your players evolve. Each session gives a player XP on a chosen stat. Once XP crosses a threshold, the stat bumps by +1, but only **synced** stats apply in matches.

![Player Profile with Training tab. Radar chart, stat bars, training buttons](/screenshots/player-profile-training.png)

## How to train

1. Open a player from your Squad
2. Click the **Training** tab in the modal
3. Pick which stat to train (Speed, Accuracy, Defense, Power, Control, Vision, Stamina)
4. Click **Train**
5. The session runs instantly. XP added, condition reduced

There is a **daily training cap** per wallet (free sessions per day). Once you hit it the Train button is greyed out. You can buy extra **Training Slots** to keep going that day. For the exact numbers (free sessions, premium-slot cap, expiry, the XP Booster pairing) see [Training Slots](/mechanics/shop/#training-slots) in the Shop.

## XP meters and bumps

Each player has 7 stats and 7 XP meters (one per stat):

- Each training session adds XP to the chosen stat's meter
- When a meter reaches **2000 XP**, the stat **bumps by +1**. Any XP above the threshold carries over into the next meter, unless the bump lands the stat on its rarity cap, in which case the meter is zeroed
- The new value shows immediately in your Squad

The radar chart in the player profile updates live so you see progress.

## Stats are capped by rarity

You can't train past your rarity ceiling:

| Rarity | Max per stat |
|--------|--------------|
| Common | 30 |
| Uncommon | 55 |
| Rare | 75 |
| Epic | 90 |
| Legendary | 100 |

Once a stat hits the cap, **training that stat gains nothing**: the XP is discarded. The session still costs condition and still uses one of your daily training sessions (or a paid slot), so check the cap before you click Train. To break the ceiling, fuse the player into a higher rarity.

## Condition matters

Each training session costs **5 condition** until a player turns 30 in-game years old. After that the cost climbs with age, reaching **15** (three times the base) at age 39 and beyond. Match appearances follow the same age curve, each from its own base: a tournament or 1v1 appearance costs **10 condition** per player and rises to **30** for the oldest players; a ranked or casual appearance costs **5 condition** and rises to **15**. In ranked, only the side that started the match pays condition; the randomly matched opponent pays nothing. Condition comes back at **48 points a day** (2 an hour) until 30, then more slowly with age, down to **24 a day** (1 an hour) at 39. See [Player Aging](/mechanics/aging/) for the thinking behind the curve.

One condition floor (currently **30**) applies to training plus tournament and 1v1 matches. A player below it cannot train. In a tournament or 1v1 match a starter below it is auto-substituted from the bench; fewer than 11 fit players forfeits the match 3-0. Casual and ranked games refuse only a starter at 0 condition, so a tired starter still plays there, with every stat scaled down by condition (about half strength near 0). XP earned also scales with condition (`20 × condition / 100`), so a barely-fit player gains less per session.

A fully drained player under 30 needs about 2 days to get back to 100 by waiting alone (about 4 days at 39). The paid shortcut is the Shop's [Condition Recovery](/mechanics/shop/#condition-recovery) item; the free one is to rotate your roster.

## Match XP also bumps

Players can also earn XP from matches, distributed across multiple stats based on their actions in the game. Not every match awards it: only **Silver and Gold tournaments** plus **1v1 challenges** grant match XP. Bronze tournaments, casual games against the AI and ranked matches (no XP at the moment) award none. Where match XP applies it follows the same meter rules: when an XP meter crosses 2000, the stat bumps.

So the loop is:

```
Train (intentional, costs condition) ──┐
                                       ├─→ XP grows ─→ Stat bumps ─→ Sync ─→ Plays in matches
Play matches (Silver/Gold, 1v1: XP) ───┘
```

## Training does NOT auto-apply in matches

Important: the moment a stat bumps, your player is **unsynced**. The new value is visible in your Squad, but the on-chain version is still the old one. **Matches read on-chain**.

To make the bump count in matches, you need to **sync** your players.

[Read about Sync →](/mechanics/sync/)

# Fair Play Rules
(docs.foxleague.ai/legal/fair-play/)

These rules apply to every manager from the moment a team is created. They sit alongside the [Terms of Use](/legal/terms/), which take precedence where the two overlap. Prizes on FoxLeague are paid in real FOXSY on the MultiversX mainnet, so the platform treats the integrity of every match, challenge and tournament as its first duty.

## 1. Fair play

FoxLeague is a game of skill. A manager competes with the players they own, the tactics they set and the AI binary they bring, against opponents doing the same, in matches decided by the match engine. Fair play means every team competes on its own merits: its own players, its own tactics, its own results. It means playing every match to win. It means using only the interfaces, smart contracts and rules that FoxLeague publishes, in the way they are meant to be used. It means treating other managers, their teams and the community with respect.

## 2. What is not allowed

The following conduct breaks these rules. The list gives examples, it is not a complete catalogue. Whether a behaviour amounts to abuse is decided by FoxLeague alone, at its discretion, on the facts of the case.

- **Multiple-account abuse**: using more than one wallet or team, directly or through others, to manipulate ELO, leaderboards, leagues, tournament brackets, prize pools or promotional distributions. Holding several wallets is not in itself a breach; abusing them is.
- **Collusion and match fixing**: arranging results with an opponent, losing on purpose, rotating prize pools between partners or entering an event only to feed one. Playing friends or club mates is fine; fixing the outcome is not.
- **Exploits**: taking advantage of a bug, a match engine quirk, a timing window, a pricing error, the relayer's gas coverage, onboarding bonuses or any other platform mechanism in a way that was not intended.
- **Developers Hub abuse**: uploaded team code that tries to reach anything beyond its own match server, to read other matches or to control its match through the server port.
- **Automation abuse**: automation is allowed. A manager may run a bot or script that performs, on their own wallets, the actions the FoxLeague interface offers, through the same published API and smart contracts. It becomes abuse when it bypasses a rule, a limit or a check the interface enforces (crafting or replaying transactions, signatures or API calls the interface does not offer), loads the platform or the network beyond normal use or its rate limits, uses information the interface does not show, coordinates several teams against other managers (see multiple-account abuse and collusion) or harvests onboarding bonuses, relayer gas coverage or promotional distributions across wallets. A manager is responsible for everything their automation does.
- **Abuse of others**: harassment, threats, impersonation of FoxLeague or of other managers. Team names, coach names or badges that are offensive, misleading or infringe someone's rights count as abuse too.
- **Anything prohibited by the Terms of Use**, including the use of the Services from a restricted jurisdiction or by a person under 18.

If you are unsure whether something is allowed, ask the team on Telegram before you do it.

## 3. What FoxLeague does

FoxLeague investigates reports from managers as well as its own monitoring. Managers do not sanction each other: a report is information for FoxLeague, never a verdict. Unfounded or repeated accusations against another manager are themselves a breach of these rules. When it finds a breach of these rules or any situation that threatens the fairness, integrity, safety or solvency of the platform, FoxLeague may act **at its sole discretion, with immediate effect and without prior notice**. The measures include, alone or combined:

- annulling, re-scoring or replaying matches and challenges;
- reversing, withholding or reclaiming prizes, entry fees, XP, ELO, league placements, rankings and any bonus or promotional distribution;
- disqualifying a team from a tournament or challenge, with or without a refund of its entry fee;
- suspending or permanently banning wallets and every account linked to the same person;
- cancelling, pausing, delaying or rescheduling events;
- removing or renaming offensive team names, coach names or badges;
- changing a rule or a parameter to close an exploit, with effect from that moment.

Transactions already settled on the MultiversX blockchain cannot be undone; measures act on platform state, on future payouts and on access to the Services. A manager who believes a measure was taken in error can contact the team with evidence. FoxLeague reviews the case and its decision after that review is final. Reports of suspected breaches are welcome and are treated in confidence.

[Terms of Use →](/legal/terms/) · [Privacy Policy →](/legal/privacy/)
