#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.env.NEURAL_WORKBENCH_DIR || path.join(os.homedir(), 'Downloads', 'neural-workbench'));
const serverPath = path.join(root, 'server.ts');

if (!fs.existsSync(serverPath)) {
  console.error(`[A.R.V.I.S.] Workbench server.ts not found: ${serverPath}`);
  process.exit(1);
}

let source = fs.readFileSync(serverPath, 'utf8');

function replaceSection(startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    console.error(`[A.R.V.I.S.] Could not locate Workbench section: ${startMarker}`);
    process.exit(1);
  }
  source = source.slice(0, start) + replacement.trimEnd() + '\n\n' + source.slice(end);
}

const anomalySection = `// ==========================================
// 11. PROACTIVE ANOMALY DIAGNOSTIC ENGINE
// RTB OS hardened: no synthetic diagnosis is returned when Gemini is unavailable.
// ==========================================
app.post('/api/anomaly/diagnose', async (req, res) => {
  try {
    const { anomaly } = req.body || {};
    if (!anomaly) return res.status(400).json({ error: 'Anomaly payload is required' });

    const required = ['title', 'category', 'entity', 'currentValue', 'baselineValue', 'deviationPercent', 'severity'];
    const missing = required.filter((key) => anomaly[key] === undefined || anomaly[key] === null || anomaly[key] === '');
    if (missing.length) {
      return res.status(400).json({ error: 'Anomaly payload is incomplete', missing });
    }

    const ai = getGenAI();
    if (!ai) {
      return res.status(503).json({
        error: 'Gemini is unavailable. A.R.V.I.S. will not invent an anomaly diagnosis.',
        sourceTruth: 'RTB_OS_SUPABASE_BRIDGE',
        anomaly
      });
    }

    const prompt = \`Diagnose only from the supplied RTB operational anomaly. Do not invent attendance, cancellations, commission leakage, inventory, or client behavior that is not present in the payload.
Title: \${anomaly.title}
Category: \${anomaly.category}
Entity: \${anomaly.entity}
Current Value: \${anomaly.currentValue}
Baseline Value: \${anomaly.baselineValue}
Deviation: \${anomaly.deviationPercent}%
Severity: \${anomaly.severity}

Return a concise root-cause assessment that clearly labels unknown causes as unknown, a verification checklist, and a recommended approval action only when supported by the supplied data.\`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        systemInstruction: 'You are A.R.V.I.S. for RTB operations. Use only provided telemetry. Never fabricate operational facts, staff behavior, financial exposure, or client activity. State when evidence is insufficient.',
        temperature: 0.2
      }
    });

    return res.json({
      rootCause: response.text || 'No supported diagnosis was produced.',
      recommendedApprovalAction: null,
      sourceTruth: 'RTB_OS_SUPABASE_BRIDGE',
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Anomaly diagnostic error:', err);
    res.status(500).json({ error: err.message || 'Anomaly diagnostic failed' });
  }
});`;

const briefingSection = `// 21. AUTOMATED DAILY MORNING BRIEFING NOTE GENERATOR
// RTB OS hardened: live bridge data is mandatory; synthetic shop metrics are forbidden.
app.post('/api/briefing/generate', async (req, res) => {
  try {
    const { date, telemetryOverride } = req.body || {};
    const targetDate = date || new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date(targetDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

    const realOp = getOperationsData();
    const realStaff = getStaffData();
    const hasRtbBridge = realOp?.sourceTruth === 'RTB_OS_SUPABASE_BRIDGE';
    const hasOperationalData = realOp?.dataAvailable === true;

    if (!hasRtbBridge || !hasOperationalData) {
      return res.status(503).json({
        error: 'Live RTB OS operational telemetry is unavailable. Briefing generation is blocked to prevent synthetic metrics.',
        sourceTruth: realOp?.sourceTruth || 'UNVERIFIED',
        dataAvailable: Boolean(realOp?.dataAvailable),
        unavailableReason: realOp?.unavailableReason || 'No current RTB OS snapshot has been mirrored.'
      });
    }

    let rawSnapshot: any = null;
    try {
      rawSnapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rtb-os-snapshot.json'), 'utf-8'));
    } catch {
      rawSnapshot = null;
    }
    const snapshotPayload = rawSnapshot?.payload || {};

    const overrideRevenue = telemetryOverride?.revenue || {};
    const total = Number.isFinite(Number(overrideRevenue.total)) ? Number(overrideRevenue.total) : Number(realOp.totalTodayNet);
    const appointments = Number.isFinite(Number(overrideRevenue.appointments)) ? Number(overrideRevenue.appointments) : Number(realOp.totalTodayOrders);
    if (!Number.isFinite(total) || !Number.isFinite(appointments)) {
      return res.status(503).json({ error: 'Current RTB OS revenue/order totals are incomplete; briefing not generated.' });
    }

    const goal = Number.isFinite(Number(overrideRevenue.goal)) ? Number(overrideRevenue.goal) : null;
    const averageTicket = appointments > 0 ? Math.round((total / appointments) * 100) / 100 : null;
    const staffData = Array.isArray(telemetryOverride?.staff)
      ? telemetryOverride.staff
      : realStaff.map((s: any) => ({
          name: s.name || s.fullName || 'Unnamed staff',
          chair: s.chair || null,
          status: s.status || 'OFFLINE',
          appointments: Number.isFinite(Number(s.appointmentsToday)) ? Number(s.appointmentsToday) : null,
          revenue: Number.isFinite(Number(s.revenueGenerated)) ? Number(s.revenueGenerated) : null
        }));

    const topPerformer = [...staffData]
      .filter((s: any) => Number.isFinite(Number(s.revenue)))
      .sort((a: any, b: any) => Number(b.revenue) - Number(a.revenue))[0] || null;

    const warnings = Array.isArray(snapshotPayload.warnings) ? snapshotPayload.warnings : [];
    const payrollRuns = Array.isArray(snapshotPayload.payrollRuns) ? snapshotPayload.payrollRuns : [];
    const draftPayrollCount = payrollRuns.filter((run: any) => run?.status === 'draft').length;
    const squareConnected = snapshotPayload.squareStatus?.connected;

    const verifiedDirectives: string[] = [];
    if (squareConnected === false) verifiedDirectives.push('Review the RTB OS Square connection status before relying on POS-derived totals.');
    if (draftPayrollCount > 0) verifiedDirectives.push(\`Review \${draftPayrollCount} payroll run\${draftPayrollCount === 1 ? '' : 's'} still marked Draft in RTB OS.\`);
    for (const warning of warnings.slice(0, 4)) {
      const text = typeof warning === 'string' ? warning : (warning?.message || warning?.title || warning?.detail || '');
      if (text) verifiedDirectives.push(String(text));
    }

    const metrics = {
      totalRevenue: total,
      revenueGoal: goal,
      variancePercent: goal && goal !== 0 ? Math.round(((total - goal) / goal) * 1000) / 10 : null,
      completedAppointments: appointments,
      averageTicket,
      rtbLoungeNet: realOp.todayByBusiness?.['RTB Lounge']?.netSales ?? null,
      rtbBeautyNet: realOp.todayByBusiness?.['RTB Beauty Lounge']?.netSales ?? null
    };

    const baseBriefing = {
      id: \`briefing_\${Date.now()}\`,
      date: targetDate,
      dayOfWeek,
      generatedAt: new Date().toISOString(),
      previousDayMetrics: metrics,
      staffTelemetry: {
        totalStaff: realStaff.length,
        activeOnDuty: realStaff.filter((s: any) => ['ACTIVE', 'BOOKED'].includes(String(s.status || '').toUpperCase())).length,
        topPerformer: topPerformer ? {
          name: topPerformer.name,
          chair: topPerformer.chair,
          revenue: topPerformer.revenue,
          appointments: topPerformer.appointments
        } : null
      },
      todayOpeningDirectives: verifiedDirectives,
      keyRisksAndOpportunities: [],
      sourceTruth: 'RTB_OS_SUPABASE_BRIDGE'
    };

    const ai = getGenAI();
    if (!ai) {
      const performerText = topPerformer ? \` Top verified revenue performer: \${topPerformer.name} at $\${Number(topPerformer.revenue).toLocaleString()} CAD.\` : '';
      return res.json({
        ...baseBriefing,
        headline: \`RTB VERIFIED BRIEF // $\${total.toLocaleString()} CAD · \${appointments} APPOINTMENTS\`,
        executiveSummary: \`Verified RTB OS telemetry reports $\${total.toLocaleString()} CAD across \${appointments} appointments.\${performerText}\`,
        audioScript: \`RTB verified briefing. Revenue is $\${total.toLocaleString()} Canadian across \${appointments} appointments.\${topPerformer ? \` \${topPerformer.name} is the top verified revenue performer.\` : ''}\`,
        source: 'RTB_OS_DETERMINISTIC'
      });
    }

    const prompt = \`Generate an executive morning briefing using ONLY this verified RTB OS payload. Do not invent staffing counts, attendance, chair utilization, peak hours, services, clients, inventory, commissions, or financial values. If a field is null or absent, omit it.
\${JSON.stringify({ metrics, staffData, directives: verifiedDirectives }, null, 2)}\`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        systemInstruction: 'You are A.R.V.I.S., executive operations assistant for RTB. Use only the verified JSON supplied. Never add operational facts or numbers from prior examples or general knowledge. Return strict JSON with headline, executiveSummary, todayOpeningDirectives, keyRisksAndOpportunities, and audioScript.',
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    });

    let parsed: any = {};
    try { parsed = JSON.parse(response.text || '{}'); } catch { parsed = {}; }

    return res.json({
      ...baseBriefing,
      headline: parsed.headline || \`RTB VERIFIED BRIEF // $\${total.toLocaleString()} CAD · \${appointments} APPOINTMENTS\`,
      executiveSummary: parsed.executiveSummary || \`Verified RTB OS telemetry reports $\${total.toLocaleString()} CAD across \${appointments} appointments.\`,
      todayOpeningDirectives: Array.isArray(parsed.todayOpeningDirectives) ? parsed.todayOpeningDirectives : verifiedDirectives,
      keyRisksAndOpportunities: Array.isArray(parsed.keyRisksAndOpportunities) ? parsed.keyRisksAndOpportunities : [],
      audioScript: parsed.audioScript || \`RTB verified briefing. Revenue is $\${total.toLocaleString()} Canadian across \${appointments} appointments.\`,
      source: 'GEMINI_VERIFIED_RTB_OS'
    });
  } catch (err: any) {
    console.error('Briefing generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate briefing' });
  }
});`;

replaceSection(
  '// ==========================================\n// 11. PROACTIVE ANOMALY DIAGNOSTIC ENGINE',
  '// 21. AUTOMATED DAILY MORNING BRIEFING NOTE GENERATOR',
  anomalySection
);

replaceSection(
  '// 21. AUTOMATED DAILY MORNING BRIEFING NOTE GENERATOR',
  '// Setup Vite Dev Middleware or Static File Serving',
  briefingSection
);

fs.writeFileSync(serverPath, source, 'utf8');
console.log('[A.R.V.I.S.] Hardened anomaly diagnostics and morning briefing against synthetic operational telemetry.');
