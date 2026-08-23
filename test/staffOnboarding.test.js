import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPermissionsFromTemplate } from '../src/lib/roleTemplates.js';
import { MODULE_IDS, hasModulePermission } from '../src/lib/permissions.js';
import {
  ONBOARDING_STAGE_IDS,
  buildOnboardingChecklist,
  isOnboardingRestrictedProfile,
} from '../src/utils/onboarding.js';

test('Onboarding Restricted template grants only Staff Hub view access', () => {
  const permissions = buildPermissionsFromTemplate('onboarding_restricted');
  const profile = { active: true, permissions, role: 'staff' };

  assert.equal(permissions.role_template, 'onboarding_restricted');
  assert.equal(permissions.role_title, 'Onboarding — Restricted');
  assert.equal(hasModulePermission(profile, 'staff_hub', 'view'), true);

  MODULE_IDS.filter((moduleId) => moduleId !== 'staff_hub').forEach((moduleId) => {
    assert.equal(
      permissions.modules[moduleId],
      'none',
      `${moduleId} must stay locked during onboarding`,
    );
  });

  assert.equal(isOnboardingRestrictedProfile(profile), true);
});

test('Onboarding checklist requires stages, passing quizzes, and current policy signatures', () => {
  const policyDocuments = [
    { active: true, id: 'policy-1', requires_acknowledgement: true, version: '1.0' },
    { active: true, id: 'policy-2', requires_acknowledgement: true, version: '2.0' },
  ];

  const incomplete = buildOnboardingChecklist({
    policyDocuments,
    quizAttempts: [{ passed: true, section_id: 'rtb_standards' }],
    signatures: [{ policy_id: 'policy-1', policy_version: '1.0' }],
    stageProgress: ONBOARDING_STAGE_IDS.slice(0, 5).map((stage_id) => ({ stage_id, status: 'completed' })),
  });

  assert.equal(incomplete.readyForSubmission, false);

  const complete = buildOnboardingChecklist({
    policyDocuments,
    quizAttempts: [
      { passed: true, section_id: 'rtb_standards' },
      { passed: true, section_id: 'operational_training' },
      { passed: true, section_id: 'cash_payments' },
      { passed: true, section_id: 'conduct_confidentiality' },
    ],
    signatures: [
      { policy_id: 'policy-1', policy_version: '1.0' },
      { policy_id: 'policy-2', policy_version: '2.0' },
    ],
    stageProgress: ONBOARDING_STAGE_IDS.map((stage_id) => ({ stage_id, status: 'completed' })),
  });

  assert.equal(complete.readyForSubmission, true);
});
