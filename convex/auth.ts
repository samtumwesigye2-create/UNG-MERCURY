import { convexAuth } from "@convex-dev/auth/server"
import { Password } from "@convex-dev/auth/providers/Password"
import { ResendOTP } from "./ResendOTP"

// Staff passwords. Nobody can sign up on their own: a password is only created
// by a signed-in staff member (after proving their email with a code), see convex/password.ts.
const StaffPassword = Password({
  profile(params) {
    if (params.flow === "signUp") throw new Error("Accounts are created by MERCURY administrators")
    return { email: String(params.email ?? "").trim().toLowerCase() }
  },
})

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP, StaffPassword],
})
