import { readFileSync } from 'node:fs';
import { documentsFromText, formatUsd, planCostUsd } from '../src/mapping.ts';

const planPath = process.env.PLAN_JSON;
if (!planPath) {
  console.error('PLAN_JSON is required');
  process.exit(1);
}

const budget = Number(process.env.COST_BUDGET_USD ?? '50');
if (!Number.isFinite(budget)) {
  console.error('COST_BUDGET_USD is not a number');
  process.exit(1);
}

const docs = documentsFromText(readFileSync(planPath, 'utf8'));
const planUsd = planCostUsd(docs);
const over = planUsd > budget;
const bypass = process.env.COST_GATE_BYPASS === '1';

console.log(`budget-usd=${budget}`);
console.log(`plan-usd=${formatUsd(planUsd)}`);
console.log(`gate=${over ? 'fail' : 'pass'}`);
if (over && !bypass) process.exit(1);
