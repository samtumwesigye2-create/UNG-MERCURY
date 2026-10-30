import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,
  staff: defineTable({
    email: v.string(), role: v.union(v.literal('admin'), v.literal('staff')),
    name: v.optional(v.string()), active: v.boolean(), addedAt: v.number(), addedBy: v.optional(v.string()),
  }).index('by_email', ['email']),
  facilities: defineTable({
    code: v.string(), name: v.string(), city: v.string(), address: v.optional(v.string()), active: v.boolean(),
  }).index('by_code', ['code']),
  lanes: defineTable({
    facilityCode: v.string(), code: v.string(), name: v.string(), destinationPrefix: v.string(),
    capacity: v.number(), currentLoad: v.number(), status: v.string(),
  }).index('by_facility', ['facilityCode']).index('by_facility_code', ['facilityCode', 'code']),
  packages: defineTable({
    trackingNumber: v.string(), destinationCode: v.string(), serviceLevel: v.string(),
    currentFacility: v.string(), currentLane: v.optional(v.string()), status: v.string(),
    lastScanAt: v.number(), weightKg: v.optional(v.number()),
  }).index('by_tracking', ['trackingNumber']).index('by_status', ['status']),
  scans: defineTable({
    trackingNumber: v.string(), facilityCode: v.string(), stage: v.string(),
    laneCode: v.optional(v.string()), operator: v.string(), timestamp: v.number(),
    uCode: v.string(), detail: v.optional(v.string()),
  }).index('by_tracking_time', ['trackingNumber', 'timestamp']).index('by_time', ['timestamp']),
  manifests: defineTable({
    manifestNumber: v.string(), originFacility: v.string(), destination: v.string(),
    status: v.string(), packageCount: v.number(), createdAt: v.number(),
    destinationFacility: v.optional(v.string()), routeLabel: v.optional(v.string()), driverName: v.optional(v.string()),
  }).index('by_status', ['status']).index('by_number', ['manifestNumber']),
  manifestItems: defineTable({
    manifestNumber: v.string(), trackingNumber: v.string(),
  }).index('by_manifest', ['manifestNumber']),
  exceptions: defineTable({
    trackingNumber: v.string(), type: v.string(), severity: v.string(), description: v.string(),
    facilityCode: v.string(), status: v.string(), openedAt: v.number(), resolvedAt: v.optional(v.number()),
  }).index('by_status', ['status']).index('by_opened', ['openedAt']),
})
