const { z } = require('zod');

/**
 * Maestro State Contract
 *
 * Defines the deterministic state schema for the Maestro orchestrator.
 * Adheres to Agent_Academy_Execution_Architecture_v1.1.
 */

const TaskCategorySchema = z.enum([
  'RESEARCH',
  'DEVELOPMENT',
  'QA',
  'SECURITY',
  'AUDIT',
  'UX',
  'PERFORMANCE',
  'PRODUCT',
  'CONTENT'
]);

const TaskStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'NOT_STARTED'
]);

const EvidenceTypeSchema = z.enum([
  'TEST_RESULT',
  'LINT_RESULT',
  'BUILD_RESULT',
  'SECURITY_SCAN',
  'AUDIT_LOG',
  'MANUAL_VERIFICATION'
]);

const EvidenceSchema = z.object({
  id: z.string().uuid(),
  type: EvidenceTypeSchema,
  source: z.string(), // Agent or tool that produced it
  content: z.any(),
  timestamp: z.string().datetime(),
  verified: z.boolean().default(false),
  verificationMethod: z.string().optional()
});

const GovernanceStateSchema = z.enum([
  'CANDIDATE',
  'REVIEWED',
  'VERIFIED',
  'STALE',
  'DEPRECATED'
]);

const ApprovalGateSchema = z.object({
  required: z.boolean().default(false),
  approved: z.boolean().default(false),
  approver: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  evidenceId: z.string().uuid().optional()
});

const MaestroStateSchema = z.object({
  // Task Identification
  taskId: z.string().uuid(),
  category: TaskCategorySchema,
  description: z.string(),

  // Execution State
  status: TaskStatusSchema.default('PENDING'),
  currentRole: z.string().optional(),

  // Evidence & Verification (M2)
  evidence: z.array(EvidenceSchema).default([]),
  verdict: z.enum(['PASS', 'FAIL', 'BLOCKED', 'NOT_VERIFIED']).default('NOT_VERIFIED'),

  // Governance Gates (M4, M5, M10, M11)
  gates: z.object({
    security: ApprovalGateSchema,
    qa: ApprovalGateSchema,
    auditor: ApprovalGateSchema,
    owner: ApprovalGateSchema
  }).default({
    security: { required: true, approved: false },
    qa: { required: true, approved: false },
    auditor: { required: true, approved: false },
    owner: { required: false, approved: false }
  }),

  // Governance Metadata
  governance: z.object({
    state: GovernanceStateSchema,
    version: z.string(),
    lastReviewed: z.string().datetime().optional()
  }).default({
    state: 'CANDIDATE',
    version: '1.0.0'
  }),

  // Logs & History
  history: z.array(z.object({
    timestamp: z.string().datetime(),
    role: z.string(),
    action: z.string(),
    message: z.string()
  })).default([])
});

module.exports = {
  MaestroStateSchema,
  TaskCategorySchema,
  TaskStatusSchema,
  EvidenceTypeSchema,
  EvidenceSchema,
  GovernanceStateSchema
};
