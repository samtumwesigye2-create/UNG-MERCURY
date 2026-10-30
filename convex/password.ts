import { action, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { createAccount, getAuthUserId, modifyAccountCredentials } from '@convex-dev/auth/server'
import { v } from 'convex/values'

export const info = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    const email = user?.email?.trim().toLowerCase()
    if (!email || !user?.emailVerificationTime) return null
    const staff = await ctx.db.query('staff').withIndex('by_email', (q) => q.eq('email', email)).unique()
    if (!staff || !staff.active) return null
    const acct = await ctx.db.query('authAccounts').withIndex('userIdAndProvider', (q) => q.eq('userId', userId).eq('provider', 'password')).first()
    return { email, hasPassword: !!acct }
  },
})

// Create or change the signed-in staff member's password.
export const setPassword = action({
  args: { password: v.string() },
  returns: v.null(),
  handler: async (ctx, { password }) => {
    const me = await ctx.runQuery(internal.password.info, {})
    if (!me) throw new Error('Sign in with an authorised MERCURY staff account first')
    if (password.length < 10) throw new Error('Use at least 10 characters')
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error('Use at least one letter and one number')
    if (password.toLowerCase().includes(me.email.split('@')[0])) throw new Error("Don't use your email name in your password")
    const account = { id: me.email, secret: password }
    if (me.hasPassword) await modifyAccountCredentials(ctx, { provider: 'password', account })
    else await createAccount(ctx, { provider: 'password', account, profile: { email: me.email } as any, shouldLinkViaEmail: true })
    return null
  },
})
