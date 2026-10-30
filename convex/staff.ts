import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

// Staff allowlist: signing in proves who you are; this list decides what you may do.
export async function currentStaff(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) return null
  const user = await ctx.db.get(userId)
  const email = user?.email?.trim().toLowerCase()
  // Only emails proven with a code count; stops anyone claiming a staff email.
  if (!email || !user?.emailVerificationTime) return null
  const staff = await ctx.db.query('staff').withIndex('by_email', (q) => q.eq('email', email)).unique()
  return staff && staff.active ? staff : null
}

export async function requireStaff(ctx: QueryCtx | MutationCtx, adminOnly = false) {
  const staff = await currentStaff(ctx)
  if (!staff) throw new Error('Sign in with an authorised MERCURY staff account')
  if (adminOnly && staff.role !== 'admin') throw new Error('Only MERCURY administrators can do this')
  return staff
}

export const me = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    const staff = await currentStaff(ctx)
    const pw = await ctx.db.query('authAccounts').withIndex('userIdAndProvider', (q) => q.eq('userId', userId).eq('provider', 'password')).first()
    return { email: user?.email ?? null, hasPassword: !!pw, staff: staff ? { email: staff.email, role: staff.role, name: staff.name ?? null } : null }
  },
})

export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireStaff(ctx, true)
    return ctx.db.query('staff').take(500)
  },
})

export const add = mutation({
  args: { email: v.string(), role: v.union(v.literal('admin'), v.literal('staff')), name: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireStaff(ctx, true)
    const email = args.email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address')
    const existing = await ctx.db.query('staff').withIndex('by_email', (q) => q.eq('email', email)).unique()
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role, active: true, name: args.name?.trim() || existing.name })
    } else {
      await ctx.db.insert('staff', { email, role: args.role, name: args.name?.trim() || undefined, active: true, addedAt: Date.now(), addedBy: admin.email })
    }
    return null
  },
})

export const setActive = mutation({
  args: { id: v.id('staff'), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireStaff(ctx, true)
    if (admin._id === args.id && !args.active) throw new Error('You cannot remove your own access')
    await ctx.db.patch(args.id, { active: args.active })
    return null
  },
})

// Run from the command line only, to create the first administrator.
export const bootstrapAdmin = internalMutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase()
    const existing = await ctx.db.query('staff').withIndex('by_email', (q) => q.eq('email', email)).unique()
    if (existing) await ctx.db.patch(existing._id, { role: 'admin', active: true })
    else await ctx.db.insert('staff', { email, role: 'admin', name: args.name, active: true, addedAt: Date.now(), addedBy: 'bootstrap' })
    return null
  },
})
