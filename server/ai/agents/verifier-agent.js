'use strict';

const { result } = require('../agent-result');

/**
 * Verifier Agent - Phase 1
 * Implements a fail-closed verification process based on an Evidence Contract.
 */
module.exports = Object.freeze({
  name: 'verifier',
  async run({ task, input }) {
    const issues = [];

    try {
      const evidence = input && input.evidence;

      if (!evidence) {
        issues.push('Evidence contract missing');
      } else {
        // 1. Execution Failure Signal
        if (evidence.executionFailed === true) {
          issues.push('Execution failure signaled');
        }

        // 2. Execution SHA Validation
        if (!evidence.executionSha) {
          issues.push('Execution SHA missing');
        } else if (task && task.targetSha && evidence.executionSha !== task.targetSha) {
          issues.push(`Execution SHA mismatch: expected ${task.targetSha}, got ${evidence.executionSha}`);
        }

        // 3. Test Results Validation
        if (!evidence.testResults || !Array.isArray(evidence.testResults) || evidence.testResults.length === 0) {
          issues.push('Test results missing or empty');
        } else {
          const failures = evidence.testResults.filter(t => t.status !== 'PASS');
          if (failures.length > 0) {
            issues.push(`Test failures detected: ${failures.map(f => f.name).join(', ')}`);
          }
        }

        // 4. Security Signoff
        if (evidence.securitySignoff !== true) {
          issues.push('Security signoff missing or invalid');
        }

        // 5. Approvals Validation
        if (!evidence.approvals || !Array.isArray(evidence.approvals) || evidence.approvals.length === 0) {
          issues.push('Required approvals missing');
        } else {
          const invalidApprovals = evidence.approvals.filter(a => !a.id);
          if (invalidApprovals.length > 0) {
            issues.push('Invalid approval records detected');
          }
        }
      }

      if (issues.length > 0) {
        return result('verifier', 'FAIL', { verified: false }, issues);
      }

      return result('verifier', 'PASS', { verified: true, sha: evidence.executionSha });
    } catch (error) {
      return result('verifier', 'FAIL', { verified: false, error: true }, [
        `Verifier exception: ${error.message}`
      ]);
    }
  }
});
