const { z } = require('zod');

/**
 * Knowledge Governance (M10)
 *
 * Manages knowledge lifecycle:
 * Candidate -> Reviewed -> Verified -> Stale/Deprecated
 */

const KnowledgeStateSchema = z.enum([
  'CANDIDATE',
  'REVIEWED',
  'VERIFIED',
  'STALE',
  'DEPRECATED'
]);

const KnowledgeItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  state: KnowledgeStateSchema.default('CANDIDATE'),
  author: z.string(),
  version: z.string().default('1.0.0'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

class KnowledgeGovernance {
  static promote(item, targetState, approver) {
    const validTransitions = {
      CANDIDATE: ['REVIEWED', 'DEPRECATED'],
      REVIEWED: ['VERIFIED', 'STALE', 'DEPRECATED'],
      VERIFIED: ['STALE', 'DEPRECATED'],
      STALE: ['VERIFIED', 'DEPRECATED'],
      DEPRECATED: []
    };

    if (!validTransitions[item.state]?.includes(targetState)) {
      return { success: false, error: `Invalid transition from ${item.state} to ${targetState}` };
    }

    return {
      success: true,
      item: {
        ...item,
        state: targetState,
        updatedAt: new Date().toISOString()
      }
    };
  }
}

module.exports = {
  KnowledgeStateSchema,
  KnowledgeItemSchema,
  KnowledgeGovernance
};
