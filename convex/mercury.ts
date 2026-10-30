import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { requireStaff } from './staff'

const packageValidator = v.object({
  _id: v.id('packages'), _creationTime: v.number(), trackingNumber: v.string(),
  destinationCode: v.string(), serviceLevel: v.string(), currentFacility: v.string(),
  currentLane: v.optional(v.string()), status: v.string(), lastScanAt: v.number(),
  weightKg: v.optional(v.number()),
})

export const dashboard = query({
  args: {},
  returns: v.object({
    facilities: v.array(v.any()), lanes: v.array(v.any()), packages: v.array(packageValidator),
    scans: v.array(v.any()), manifests: v.array(v.any()), exceptions: v.array(v.any()),
  }),
  handler: async (ctx) => {
    await requireStaff(ctx)
    return {
    facilities: await ctx.db.query('facilities').take(20),
    lanes: await ctx.db.query('lanes').take(50),
    packages: await ctx.db.query('packages').order('desc').take(50),
    scans: await ctx.db.query('scans').withIndex('by_time').order('desc').take(30),
    manifests: await ctx.db.query('manifests').order('desc').take(20),
    exceptions: await ctx.db.query('exceptions').withIndex('by_opened').order('desc').take(20),
  }},
})

export const seed = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    await requireStaff(ctx, true)
    const existing = await ctx.db.query('facilities').withIndex('by_code', q => q.eq('code', 'KLA-01')).unique()
    if (!existing) {
      await ctx.db.insert('facilities', { code: 'KLA-01', name: 'Kingsford Central Processing Hub', city: 'Kingsford', active: true })
      for (const lane of [
        ['A01', 'Kingsford Metro', '10', 500],
        ['B12', 'Victoria & New Nile', '20', 400],
        ['C07', 'Western Corridor', '30', 350],
        ['D04', 'Northern Corridor', '80', 350],
      ] as const) {
        await ctx.db.insert('lanes', { facilityCode: 'KLA-01', code: lane[0], name: lane[1], destinationPrefix: lane[2], capacity: lane[3], currentLoad: 0, status: 'open' })
      }
    }
    return null
  },
})

export const processScan = mutation({
  args: {
    trackingNumber: v.string(), destinationCode: v.optional(v.string()),
    stage: v.union(v.literal('intake'), v.literal('sort'), v.literal('dispatch')),
    facilityCode: v.string(), operator: v.string(), weightKg: v.optional(v.number()),
  },
  returns: v.object({ trackingNumber: v.string(), stage: v.string(), laneCode: v.optional(v.string()), status: v.string(), uCode: v.string() }),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const trackingNumber = args.trackingNumber.trim().toUpperCase()
    if (!trackingNumber) throw new Error('Tracking number is required')
    const now = Date.now()
    let pkg = await ctx.db.query('packages').withIndex('by_tracking', q => q.eq('trackingNumber', trackingNumber)).unique()
    const destinationCode = (args.destinationCode ?? pkg?.destinationCode ?? '').trim()
    if (!pkg && !destinationCode) throw new Error('Destination code is required for a new package')

    let laneCode: string | undefined
    let status = args.stage === 'intake' ? 'received' : args.stage === 'sort' ? 'sorted' : 'dispatched'
    const uCode = args.stage === 'intake' ? 'U-2300' : args.stage === 'sort' ? 'U-2310' : 'U-2320'

    if (args.stage === 'sort') {
      const lanes = await ctx.db.query('lanes').withIndex('by_facility', q => q.eq('facilityCode', args.facilityCode)).take(100)
      const lane = lanes.find(item => destinationCode.startsWith(item.destinationPrefix) && item.status === 'open')
      if (!lane) throw new Error('No active sort lane matches this destination')
      if (lane.currentLoad >= lane.capacity) throw new Error(`Lane ${lane.code} is at capacity`)
      laneCode = lane.code
      await ctx.db.patch(lane._id, { currentLoad: lane.currentLoad + 1 })
    }

    if (pkg) {
      await ctx.db.patch(pkg._id, { destinationCode, currentFacility: args.facilityCode, currentLane: laneCode ?? pkg.currentLane, status, lastScanAt: now, weightKg: args.weightKg ?? pkg.weightKg })
    } else {
      await ctx.db.insert('packages', { trackingNumber, destinationCode, serviceLevel: 'standard', currentFacility: args.facilityCode, currentLane: laneCode, status, lastScanAt: now, weightKg: args.weightKg })
    }
    await ctx.db.insert('scans', { trackingNumber, facilityCode: args.facilityCode, stage: args.stage, laneCode, operator: staff.email, timestamp: now, uCode, detail: `station ${args.operator.trim() || 'unknown'}` })
    return { trackingNumber, stage: args.stage, laneCode, status, uCode }
  },
})

export const createManifest = mutation({
  args: { originFacility: v.string(), destination: v.optional(v.string()), destinationFacility: v.optional(v.string()), routeLabel: v.optional(v.string()), driverName: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const manifestNumber = `MRC-${Date.now().toString(36).toUpperCase()}`
    const destination = (args.destinationFacility ?? args.destination ?? args.routeLabel ?? '').trim()
    if (!destination) throw new Error('Destination facility or route is required')
    await ctx.db.insert('manifests', { manifestNumber, originFacility: args.originFacility, destination, destinationFacility: args.destinationFacility, routeLabel: args.routeLabel, driverName: args.driverName, status: 'open', packageCount: 0, createdAt: Date.now() })
    return manifestNumber
  },
})

export const updateManifest = mutation({
  args: { manifestNumber: v.string(), action: v.union(v.literal('close'), v.literal('depart'), v.literal('receive')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const manifest = await ctx.db.query('manifests').withIndex('by_number', q => q.eq('manifestNumber', args.manifestNumber)).unique()
    if (!manifest) throw new Error('Manifest not found')
    const status = args.action === 'close' ? 'closed' : args.action === 'depart' ? 'in_transit' : 'received'
    await ctx.db.patch(manifest._id, { status })
    return null
  },
})

export const reportException = mutation({
  args: { trackingNumber: v.string(), type: v.string(), severity: v.string(), description: v.string(), facilityCode: v.string() },
  returns: v.id('exceptions'),
  handler: async (ctx, args) => { await requireStaff(ctx); return ctx.db.insert('exceptions', { ...args, status: 'open', openedAt: Date.now() }) },
})

export const resolveException = mutation({
  args: { id: v.id('exceptions') }, returns: v.null(),
  handler: async (ctx, args) => { await requireStaff(ctx, true); await ctx.db.patch(args.id, { status: 'resolved', resolvedAt: Date.now() }); return null },
})

export const packageHistory = query({
  args: { trackingNumber: v.string() }, returns: v.array(v.any()),
  handler: async (ctx, args) => { await requireStaff(ctx); return ctx.db.query('scans').withIndex('by_tracking_time', q => q.eq('trackingNumber', args.trackingNumber.trim().toUpperCase())).order('desc').take(100) },
})


export const createFacility = mutation({
  args: { code: v.string(), name: v.string(), city: v.string(), address: v.optional(v.string()) },
  returns: v.id('facilities'),
  handler: async (ctx, args) => {
    await requireStaff(ctx, true)
    const code = args.code.trim().toUpperCase()
    if (!code || !args.name.trim()) throw new Error('Facility code and name are required')
    const existing = await ctx.db.query('facilities').withIndex('by_code', q => q.eq('code', code)).unique()
    if (existing) throw new Error('Facility code already exists')
    return ctx.db.insert('facilities', { code, name: args.name.trim(), city: args.city.trim() || 'Unassigned', address: args.address?.trim(), active: true })
  },
})

export const createLane = mutation({
  args: { facilityCode: v.string(), code: v.string(), name: v.string(), destinationPrefix: v.string(), capacity: v.number() },
  returns: v.id('lanes'),
  handler: async (ctx, args) => {
    await requireStaff(ctx, true)
    const code = args.code.trim().toUpperCase()
    if (!code || !args.destinationPrefix.trim() || args.capacity < 1) throw new Error('Lane, destination prefix and capacity are required')
    const existing = await ctx.db.query('lanes').withIndex('by_facility_code', q => q.eq('facilityCode', args.facilityCode).eq('code', code)).unique()
    if (existing) throw new Error('Lane already exists at this facility')
    return ctx.db.insert('lanes', { facilityCode: args.facilityCode, code, name: args.name.trim() || code, destinationPrefix: args.destinationPrefix.trim(), capacity: args.capacity, currentLoad: 0, status: 'open' })
  },
})

export const setLaneStatus = mutation({
  args: { id: v.id('lanes'), status: v.union(v.literal('open'), v.literal('paused')) },
  returns: v.null(),
  handler: async (ctx, args) => { await requireStaff(ctx, true); await ctx.db.patch(args.id, { status: args.status }); return null },
})
