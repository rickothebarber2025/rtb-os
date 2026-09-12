#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoDir = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '../..'));
const workbenchDir = path.resolve(process.argv[2] || process.env.NEURAL_WORKBENCH_DIR || path.join(os.homedir(), 'Downloads', 'neural-workbench'));

const overrides = [
  {
    source: path.join(repoDir, 'integrations', 'arvis', 'workbench-overrides', 'ProcessViews.tsx'),
    target: path.join(workbenchDir, 'src', 'components', 'ProcessViews.tsx'),
  },
  {
    source: path.join(repoDir, 'integrations', 'arvis', 'workbench-overrides', 'RevenueMatrixWidget.tsx'),
    target: path.join(workbenchDir, 'src', 'components', 'RevenueMatrixWidget.tsx'),
  },
  {
    source: path.join(repoDir, 'integrations', 'arvis', 'workbench-overrides', 'AgenticScreenVision.tsx'),
    target: path.join(workbenchDir, 'src', 'components', 'AgenticScreenVision.tsx'),
  },
];

for (const { source, target } of overrides) {
  if (!fs.existsSync(source)) {
    console.error(`[A.R.V.I.S.] Workbench override source missing: ${source}`);
    process.exit(1);
  }

  if (!fs.existsSync(target)) {
    console.error(`[A.R.V.I.S.] Workbench override target missing: ${target}`);
    process.exit(1);
  }

  const backup = `${target}.rtb-original`;
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(target, backup);
  }

  fs.copyFileSync(source, target);
  console.log(`[A.R.V.I.S.] Applied RTB Workbench override to ${target}`);
}
