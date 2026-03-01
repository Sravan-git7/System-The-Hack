import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/* ===============================
   GROQ CLIENT
================================*/

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

if (!process.env.GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY missing");
  process.exit(1);
}

/* ===============================
   CONSTANTS
================================*/

const MAX_TURNS = 10;

const METRIC_KEYS = [
  'employment',
  'economy',
  'publicHappiness',
  'inequality',
  'governmentBudget'
];

const WIN_CONDITION = {
  employment: 80,
  economy: 80,
  publicHappiness: 80,
  inequality: 30,
  governmentBudget: 60
};

/* ===============================
   WEIGHTED CAUSAL MATRIX
   (source affects target by weight)
================================*/

const CAUSAL_MATRIX = {
  employment: { economy: 0.4, publicHappiness: 0.25, governmentBudget: 0.15 },
  economy: { employment: 0.35, governmentBudget: 0.5, publicHappiness: 0.2 },
  publicHappiness: { economy: 0.15, employment: 0.1, inequality: -0.2 },
  inequality: { publicHappiness: -0.6, economy: -0.25, employment: -0.15 },
  governmentBudget: { economy: 0.3, employment: 0.2, publicHappiness: 0.1 }
};

/* ===============================
   STOCHASTIC EVENTS (random shocks)
================================*/

const STOCHASTIC_EVENTS = [
  { name: "Market correction", impacts: { economy: -8, governmentBudget: -3 }, prob: 0.12 },
  { name: "Consumer confidence boost", impacts: { economy: 6, publicHappiness: 4 }, prob: 0.15 },
  { name: "Tech sector hiring wave", impacts: { employment: 5, economy: 4 }, prob: 0.12 },
  { name: "Fiscal windfall", impacts: { governmentBudget: 6, economy: 2 }, prob: 0.1 },
  { name: "Social unrest", impacts: { publicHappiness: -6, inequality: 5 }, prob: 0.1 },
  { name: "Labor strike", impacts: { employment: -5, economy: -4 }, prob: 0.08 },
  { name: "Policy uncertainty", impacts: { economy: -4, publicHappiness: -3 }, prob: 0.12 },
  { name: "Green investment surge", impacts: { employment: 3, economy: 3, publicHappiness: 2 }, prob: 0.1 },
  { name: "Wealth concentration spike", impacts: { inequality: 8, publicHappiness: -5 }, prob: 0.08 },
  { name: "Budget austerity pressure", impacts: { governmentBudget: -5, publicHappiness: -4 }, prob: 0.08 },
  { name: "Skills mismatch", impacts: { employment: -4, inequality: 3 }, prob: 0.08 },
  { name: "Export boom", impacts: { economy: 5, employment: 3 }, prob: 0.1 }
];

function rollStochasticEvent(turn) {
  const roll = Math.random();
  let cumulative = 0;
  for (const ev of STOCHASTIC_EVENTS) {
    cumulative += ev.prob;
    if (roll < cumulative) {
      const impacts = {};
      METRIC_KEYS.forEach(k => {
        impacts[k] = clampImpact(ev.impacts[k] ?? 0);
      });
      return { name: ev.name, impacts };
    }
  }
  return null;
}

/* ===============================
   HELPERS
================================*/

function slugify(title) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') ||
    'policy_' + Date.now()
  );
}

function clampImpact(v) {
  return Math.max(-30, Math.min(30, Math.round(v || 0)));
}

function normalizeImpacts(impacts) {
  let total = 0;

  Object.values(impacts).forEach(v => {
    total += Math.abs(v);
  });

  if (total > 60) {
    Object.keys(impacts).forEach(k => {
      impacts[k] = Math.round(impacts[k] * 0.6);
    });
  }

  return impacts;
}

/**
 * Apply policy impacts with weighted causal propagation.
 * Direct impacts → propagate through CAUSAL_MATRIX → add stochastic shock.
 */
function applyPolicyWithCausalMatrix(metrics, rawImpacts, turn) {
  const m = { ...metrics };
  METRIC_KEYS.forEach(k => {
    m[k] = Math.max(0, Math.min(100, (m[k] ?? 50) + (rawImpacts[k] ?? 0)));
  });

  // Propagate through causal matrix (one pass of secondary effects)
  const deltas = {};
  METRIC_KEYS.forEach(src => {
    const change = (rawImpacts[src] ?? 0);
    if (Math.abs(change) < 0.5) return;
    const targets = CAUSAL_MATRIX[src];
    if (!targets) return;
    for (const [tgt, weight] of Object.entries(targets)) {
      deltas[tgt] = (deltas[tgt] ?? 0) + change * weight;
    }
  });
  METRIC_KEYS.forEach(k => {
    const d = Math.round(deltas[k] ?? 0);
    if (d !== 0) m[k] = Math.max(0, Math.min(100, m[k] + d));
  });

  // Stochastic event (random shock)
  const event = turn > 0 ? rollStochasticEvent(turn) : null;
  if (event) {
    METRIC_KEYS.forEach(k => {
      m[k] = Math.max(0, Math.min(100, m[k] + (event.impacts[k] ?? 0)));
    });
  }

  // Small entropy (1–2 pt noise)
  METRIC_KEYS.forEach(k => {
    m[k] = Math.max(0, Math.min(100, m[k] + (Math.floor(Math.random() * 3) - 1)));
  });

  return { metrics: m, stochasticEvent: event };
}

/* ===============================
   PROGRESS + DIFFICULTY
================================*/

function getProgress(metrics) {
  return `
Employment gap: ${WIN_CONDITION.employment - metrics.employment}
Economy gap: ${WIN_CONDITION.economy - metrics.economy}
Happiness gap: ${WIN_CONDITION.publicHappiness - metrics.publicHappiness}
Inequality excess: ${metrics.inequality - WIN_CONDITION.inequality}
Budget gap: ${WIN_CONDITION.governmentBudget - metrics.governmentBudget}
`;
}

function difficultyRule(turn) {
  if (turn <= 4)
    return `Generate 2 positive and 2 risky interventions.`;
  if (turn <= 7)
    return `Generate 3 positive and 1 risky intervention.`;
  return `Generate stabilization-focused interventions helping achieve victory. Avoid systemic shocks.`;
}

/* ===============================
   FEEDBACK LEARNING FROM PAST TURNS
================================*/

function buildFeedbackContext(decisionHistory) {
  if (!decisionHistory?.length) return "";

  const entries = decisionHistory.slice(-5).map((d, i) => {
    const before = d.metricsBefore || {};
    const after = d.metricsAfter || {};
    const deltas = {};
    METRIC_KEYS.forEach(k => {
      const b = before[k] ?? 0;
      const a = after[k] ?? 0;
      if (b !== a) deltas[k] = a - b;
    });
    const deltaStr = Object.entries(deltas)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k}: ${v > 0 ? "+" : ""}${v}`)
      .join(", ");
    return `  ${i + 1}. "${d.title}" (risk: ${d.riskLevel}) → ${deltaStr || "no change"}`;
  });

  return `
FEEDBACK FROM PAST TURNS (learn from these outcomes):
${entries.join("\n")}

Use this feedback to improve realism: favor interventions that historically moved metrics toward victory, avoid patterns that worsened inequality or happiness. Weight causal chains: employment→economy (+0.4), inequality→happiness (-0.6), etc.
`;
}

/* ===============================
   FINAL SIMULATION ANALYSIS
================================*/

function evaluateSimulation(metrics) {

  const stabilized =
    metrics.employment >= WIN_CONDITION.employment &&
    metrics.economy >= WIN_CONDITION.economy &&
    metrics.publicHappiness >= WIN_CONDITION.publicHappiness &&
    metrics.inequality <= WIN_CONDITION.inequality &&
    metrics.governmentBudget >= WIN_CONDITION.governmentBudget;

  const score =
    metrics.employment +
    metrics.economy +
    metrics.publicHappiness +
    metrics.governmentBudget -
    metrics.inequality;

  if (stabilized) {
    return {
      result: "WIN",
      title: "Society Stabilized",
      message:
        "Your governance achieved long-term systemic stability."
    };
  }

  if (score > 300) {
    return {
      result: "PARTIAL_SUCCESS",
      title: "Recovering System",
      message:
        "You prevented collapse but structural risks remain."
    };
  }

  return {
    result: "FAILURE",
    title: "System Collapse",
    message:
      "Economic and social imbalance destabilized society."
  };
}

function generatePerformance(metrics, history) {
  return {
    economicHealth:
      (metrics.economy +
        metrics.governmentBudget) / 2,

    socialStability:
      metrics.publicHappiness -
      metrics.inequality,

    employmentStrength:
      metrics.employment,

    decisionsTaken: history.length
  };
}

/* ===============================
   API ROUTE
================================*/

app.post('/api/generate-interventions', async (req, res) => {

  try {

    const {
      chosenPolicy,
      metrics,
      turn = 1,
      decisionHistory = []
    } = req.body;

    if (!metrics)
      return res.status(400)
        .json({ error: "Missing metrics" });

    /* ======================================
       ✅ HARD STOP AFTER TURN 10
    ====================================== */

    if (turn >= MAX_TURNS) {

      const analysis =
        evaluateSimulation(metrics);

      return res.json({
        simulationEnded: true,
        analysis,
        performance:
          generatePerformance(
            metrics,
            decisionHistory
          )
      });
    }

    /* Prevent token explosion */
    const recentHistory =
      decisionHistory.slice(-3);

    const historyText =
      recentHistory.length
        ? recentHistory
            .map(
              (d, i) =>
                `${i + 1}. ${d.title} (Turn ${d.turn})`
            )
            .join('\n')
        : "None";

    const progressText =
      getProgress(metrics);

    const prompt = `
You are an AI GOVERNANCE SIMULATION ENGINE.

Victory Conditions:
Employment ≥80
Economy ≥80
Public Happiness ≥80
Inequality ≤30
Government Budget ≥60

Chosen Policy:
${chosenPolicy?.title}
${chosenPolicy?.description}

Recent Decisions:
${historyText}

Turn ${turn}/10

Metrics:
Employment ${metrics.employment}
Economy ${metrics.economy}
Happiness ${metrics.publicHappiness}
Inequality ${metrics.inequality}
Budget ${metrics.governmentBudget}

${progressText}

${difficultyRule(turn)}

Return EXACTLY 4 interventions as a JSON array.
Each intervention MUST have:
- title: A short, descriptive name (e.g. "Universal Basic Income Expansion", "AI Corporate Tax Levy")
- description: 1-2 sentences explaining the intervention's context, rationale, and expected effects
- impacts: object with keys employment, economy, publicHappiness, inequality, governmentBudget (values -30 to +30)
- riskLevel: "Low", "Medium", or "High"

Use ONLY allowed metrics. Impact range -30 to +30.
Return ONLY a JSON array, no other text.
`;

    const explanationPrompt = chosenPolicy?.title
      ? `
You are a Predictive Engine analyzing governance decisions. The user just selected this intervention:

"${chosenPolicy.title}"
${chosenPolicy.description ? `\n${chosenPolicy.description}` : ""}

Current state: Employment ${metrics.employment}, Economy ${metrics.economy}, Happiness ${metrics.publicHappiness}, Inequality ${metrics.inequality}, Budget ${metrics.governmentBudget}.
Turn ${turn}/10

Recent decisions: ${historyText || "None"}

Provide a brief 1-2 sentence explanation of what this decision implies: the strategic rationale, trade-offs, and what it signals about the user's governance approach. Be analytical and concise.
`
      : null;

    const [completion, explanationCompletion] = await Promise.all([
      groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        temperature: 0.65,
        messages: [
          {
            role: "system",
            content:
              "Return valid JSON array only. Each object must have title, description, impacts, riskLevel."
          },
          { role: "user", content: prompt }
        ]
      }),
      explanationPrompt
        ? groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            temperature: 0.5,
            messages: [
              {
                role: "system",
                content: "Provide a brief analytical explanation."
              },
              { role: "user", content: explanationPrompt }
            ]
          })
        : Promise.resolve(null)
    ]);

    let raw =
      completion.choices?.[0]?.message
        ?.content || "[]";

    raw = raw
      .replace(/^```json?|```$/g, '')
      .trim();

    let parsed = [];

    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("⚠ Invalid JSON fallback");
    }

    const interventions =
      parsed.slice(0, 4).map((p, i) => {

        let impacts = {};

        METRIC_KEYS.forEach(k => {
          impacts[k] =
            clampImpact(
              p?.impacts?.[k]
            );
        });

        impacts =
          normalizeImpacts(impacts);

        const title = (p?.title || "").trim() || `Intervention ${i + 1}`;
        const description = (p?.description || "").trim() || `Context-aware policy option based on current turn ${turn} state.`;

        return {
          id:
            slugify(title)
            +
            "_" +
            Date.now() +
            "_" + i,

          title,

          description,

          impacts,

          riskLevel:
            ["Low","Medium","High"]
              .includes(p.riskLevel)
              ? p.riskLevel
              : "Medium"
        };
      });

    const decisionExplanation =
      explanationCompletion?.choices?.[0]?.message?.content?.trim() || null;

    res.json({ interventions, decisionExplanation });

  } catch (err) {

    console.error("❌ API ERROR:", err);

    res.status(500).json({
      error: err.message,
      fallback: true
    });
  }
});

/* ===============================
   SERVER START
================================*/

app.listen(PORT, () => {
  console.log(
    `✅ Scenario API running at http://localhost:${PORT}`
  );
});