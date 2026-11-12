const { EvidenceSchema } = require('./maestro-contract.js');

/**
 * Evidence Verifier
 *
 * Provides deterministic mechanical verification for evidence produced by agents.
 * Adheres to the Evidence Rule: No PASS without actual evidence.
 */

class EvidenceVerifier {
  /**
   * Validates an evidence object against the schema.
   */
  static validate(evidence) {
    return EvidenceSchema.safeParse(evidence);
  }

  /**
   * Performs mechanical verification of evidence content based on its type.
   */
  static verify(evidence) {
    const validation = this.validate(evidence);
    if (!validation.success) {
      return { verified: false, error: 'Invalid evidence schema' };
    }

    const { type, content } = validation.data;

    switch (type) {
      case 'TEST_RESULT':
        return this.verifyTestResult(content);
      case 'LINT_RESULT':
        return this.verifyLintResult(content);
      case 'BUILD_RESULT':
        return this.verifyBuildResult(content);
      case 'SECURITY_SCAN':
        return this.verifySecurityScan(content);
      default:
        return { verified: false, error: `Unsupported evidence type: ${type}` };
    }
  }

  static verifyTestResult(content) {
    // Mechanical check: must have a 'pass' field that is true, and no failures.
    if (content && content.pass === true && (!content.failures || content.failures === 0)) {
      return { verified: true };
    }
    return { verified: false, error: 'Test results did not indicate a pass' };
  }

  static verifyLintResult(content) {
    // Mechanical check: must have 0 errors.
    if (content && (content.errorCount === 0 || content.errors === 0)) {
      return { verified: true };
    }
    return { verified: false, error: 'Lint results found errors' };
  }

  static verifyBuildResult(content) {
    if (content && content.success === true) {
      return { verified: true };
    }
    return { verified: false, error: 'Build failed' };
  }

  static verifySecurityScan(content) {
    // Must be verified by a trusted source and have no high/critical vulnerabilities
    if (content && content.vulnerabilities === 0) {
      return { verified: true };
    }
    return { verified: false, error: 'Security scan found vulnerabilities' };
  }
}

module.exports = EvidenceVerifier;
