/**
 * Generic Sandbox Provider Contract (M8 Runtime Boundary)
 *
 * Defines the contract for secure, policy-bound sandbox execution environments.
 * Runtime output is treated as UNTRUSTED and verified by Maestro Verifier.
 */

class SandboxProviderContract {
  async createSandbox(config = {}) {
    throw new Error('Not implemented: createSandbox');
  }

  async attachWorkspace(sandboxId, workspacePath) {
    throw new Error('Not implemented: attachWorkspace');
  }

  async execute(sandboxId, command, policy = {}) {
    throw new Error('Not implemented: execute');
  }

  async cancel(sandboxId, executionId) {
    throw new Error('Not implemented: cancel');
  }

  async getStatus(sandboxId) {
    throw new Error('Not implemented: getStatus');
  }

  async *streamEvents(sandboxId, executionId) {
    throw new Error('Not implemented: streamEvents');
  }

  async destroy(sandboxId) {
    throw new Error('Not implemented: destroy');
  }
}

/**
 * Mock Sandbox Provider implementing the contract for testing and offline development.
 * Policy fields include: workspace boundaries, command allowlist, timeout/cancellation,
 * network policy, secret boundary, and resource limits.
 */
class MockSandboxProvider extends SandboxProviderContract {
  constructor() {
    super();
    this.sandboxes = new Map();
  }

  async createSandbox(config = {}) {
    const sandboxId = `sandbox-${Date.now()}`;
    const sandbox = {
      id: sandboxId,
      workspacePath: config.workspacePath || '/tmp/sandbox',
      policy: {
        workspaceBoundaries: config.workspaceBoundaries || ['/tmp'],
        commandAllowlist: config.commandAllowlist || ['npm test', 'node'],
        timeoutMs: config.timeoutMs || 30000,
        networkPolicy: config.networkPolicy || 'DENY',
        secretBoundary: config.secretBoundary || 'MASK_ALL',
        resourceLimits: config.resourceLimits || { memoryMb: 512, cpuCores: 1 }
      },
      status: 'READY'
    };
    this.sandboxes.set(sandboxId, sandbox);
    return sandboxId;
  }

  async execute(sandboxId, command, executionPolicy = {}) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxId}`);

    // Enforce command allowlist policy
    const isAllowed = sandbox.policy.commandAllowlist.some(allowed => command.startsWith(allowed));
    if (!isAllowed) {
      return {
        success: false,
        error: `Policy Violation: Command '${command}' not allowed by sandbox policy command allowlist.`,
        output: '',
        untrusted: true
      };
    }

    return {
      success: true,
      output: `[MockSandbox execution success for: ${command}]`,
      untrusted: true // Runtime output is untrusted until verified by Maestro EvidenceVerifier
    };
  }

  async destroy(sandboxId) {
    return this.sandboxes.delete(sandboxId);
  }
}

module.exports = {
  SandboxProviderContract,
  MockSandboxProvider
};
