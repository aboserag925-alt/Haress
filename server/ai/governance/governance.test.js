const test = require('node:test');
const assert = require('node:assert');
const { KnowledgeGovernance } = require('./knowledge.js');
const { AcademyGovernance } = require('./academy.js');

test('KnowledgeGovernance promotes items correctly', () => {
  const item = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Test Knowledge',
    content: 'Some info',
    state: 'CANDIDATE',
    author: 'CEO',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const result = KnowledgeGovernance.promote(item, 'REVIEWED', 'COO');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.item.state, 'REVIEWED');
});

test('KnowledgeGovernance rejects invalid transitions', () => {
  const item = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Test Knowledge',
    content: 'Some info',
    state: 'CANDIDATE',
    author: 'CEO',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const result = KnowledgeGovernance.promote(item, 'VERIFIED', 'Owner');
  assert.strictEqual(result.success, false);
});

// --- M11 ACADEMY GOVERNANCE TESTS ---

test('AcademyGovernance rejects CANDIDATE -> PROMOTED (skipping stages)', () => {
  const skill = { name: 'Test Skill', state: 'CANDIDATE', author: 'dev-1' };
  const res = AcademyGovernance.transitionSkill(skill, 'PROMOTED', { id: 'owner-1', role: 'owner' }, { approved: true, approvalId: 'app-1' });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /Invalid state transition/);
});

test('AcademyGovernance rejects SANDBOX -> PROMOTED', () => {
  const skill = { name: 'Test Skill', state: 'SANDBOX', author: 'dev-1' };
  const res = AcademyGovernance.transitionSkill(skill, 'PROMOTED', { id: 'owner-1', role: 'owner' }, { approved: true, approvalId: 'app-1' });
  assert.strictEqual(res.success, false);
});

test('AcademyGovernance rejects EVAL -> APPROVED skipping Review/Security', () => {
  const skill = { name: 'Test Skill', state: 'EVAL', author: 'dev-1' };
  const res = AcademyGovernance.transitionSkill(skill, 'APPROVED', { id: 'owner-1', role: 'owner' });
  assert.strictEqual(res.success, false);
});

test('AcademyGovernance prevents self-approval (author approving own skill)', () => {
  const skill = { name: 'Test Skill', state: 'SECURITY_CHECK', author: 'dev-1' };
  const res = AcademyGovernance.transitionSkill(skill, 'APPROVED', { id: 'dev-1', role: 'agent' });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /Separation of duties breach/);
});

test('AcademyGovernance rejects promotion without required owner approval', () => {
  const skill = { name: 'Test Skill', state: 'APPROVED', author: 'dev-1' };
  const res = AcademyGovernance.transitionSkill(skill, 'PROMOTED', { id: 'agent-1', role: 'agent' }, { approved: false });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /requires recorded Owner HITL approval/);
});

test('AcademyGovernance allows valid full progression with auditable metadata', () => {
  let skill = { name: 'Full Skill', state: 'CANDIDATE', author: 'dev-1' };

  const t1 = AcademyGovernance.transitionSkill(skill, 'SANDBOX', { id: 'dev-1', role: 'agent' });
  assert.strictEqual(t1.success, true);
  skill = t1.skill;

  const t2 = AcademyGovernance.transitionSkill(skill, 'EVAL', { id: 'dev-1', role: 'agent' });
  assert.strictEqual(t2.success, true);
  skill = t2.skill;

  const t3 = AcademyGovernance.transitionSkill(skill, 'REVIEW', { id: 'dev-1', role: 'agent' });
  assert.strictEqual(t3.success, true);
  skill = t3.skill;

  const t4 = AcademyGovernance.transitionSkill(skill, 'SECURITY_CHECK', { id: 'dev-1', role: 'agent' });
  assert.strictEqual(t4.success, true);
  skill = t4.skill;

  // Security check approved by different actor (security agent)
  const t5 = AcademyGovernance.transitionSkill(skill, 'APPROVED', { id: 'sec-agent', role: 'agent' });
  assert.strictEqual(t5.success, true);
  skill = t5.skill;

  // Promoted by owner with approval ID
  const t6 = AcademyGovernance.transitionSkill(skill, 'PROMOTED', { id: 'owner-1', role: 'owner' }, { approved: true, approvalId: 'approval-uuid-999' });
  assert.strictEqual(t6.success, true);
  assert.strictEqual(t6.skill.state, 'PROMOTED');
  assert.strictEqual(t6.skill.auditTrail.length, 6);
  assert.strictEqual(t6.skill.auditTrail[5].approvalId, 'approval-uuid-999');
});

test('AcademyGovernance allows policy-compliant rollback', () => {
  const skill = { name: 'Rollback Skill', state: 'MONITORING', author: 'dev-1', auditTrail: [] };
  const res = AcademyGovernance.transitionSkill(skill, 'ROLLED_BACK', { id: 'owner-1', role: 'owner' }, { approved: true, approvalId: 'rollback-uuid-123' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.skill.state, 'ROLLED_BACK');
  assert.strictEqual(res.skill.auditTrail[0].to, 'ROLLED_BACK');
});
