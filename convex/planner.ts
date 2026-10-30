import { internalQuery } from './_generated/server'
import { v } from 'convex/values'

// Read-only summary for the UNG Fleet Planner.
// Counts parcels created in the last N days, grouped by the sort lane their
// destination code matches. Changes no data.
export const plannerDemand = internalQuery({
  args: { days: v.optional(v.number()), facilityCode: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const days = Math.min(Math.max(args.days ?? 28, 1), 90)
    const facility = args.facilityCode ?? 'KLA-01'
    const since = Date.now() - days * 86400000
    const lanes = await ctx.db
      .query('lanes')
      .withIndex('by_facility', (q) => q.eq('facilityCode', facility))
      .take(100)
    const counts: Record<string, number> = {}
    for (const l of lanes) counts[l.code] = 0
    let parcels = 0
    let unmatched = 0
    let firstAt: number | null = null
    let lastAt: number | null = null
    const activeDays = new Set<string>()
    for await (const p of ctx.db.query('packages').order('desc')) {
      if (p._creationTime < since) break
      if (parcels + unmatched >= 15000) break
      const lane = lanes.find((l) => p.destinationCode.startsWith(l.destinationPrefix))
      if (lane) {
        counts[lane.code]++
        parcels++
      } else unmatched++
      if (lastAt === null) lastAt = p._creationTime
      firstAt = p._creationTime
      activeDays.add(new Date(p._creationTime).toISOString().slice(0, 10))
    }
    return {
      facility,
      windowDays: days,
      parcels,
      unmatched,
      activeDays: activeDays.size,
      firstAt,
      lastAt,
      lanes: lanes.map((l) => ({ code: l.code, name: l.name, prefix: l.destinationPrefix, parcels: counts[l.code] })),
    }
  },
})
