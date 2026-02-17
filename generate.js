#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get cron jobs from OpenClaw
let jobs = [];
try {
  const result = execSync('openclaw cron list --json 2>/dev/null | sed -n \'/^{/,$p\'', { 
    encoding: 'utf8', 
    timeout: 30000,
    shell: '/bin/zsh'
  });
  const data = JSON.parse(result);
  jobs = data.jobs || [];
} catch (e) {
  console.error('Failed to fetch cron jobs:', e.message);
  try {
    const cached = fs.readFileSync(path.join(__dirname, 'jobs-cache.json'), 'utf8');
    jobs = JSON.parse(cached).jobs || [];
    console.log('Using cached jobs data');
  } catch {
    console.log('No cache available, using empty jobs');
  }
}

// Cache jobs
fs.writeFileSync(path.join(__dirname, 'jobs-cache.json'), JSON.stringify({ jobs }, null, 2));

// Categories and their patterns
const categories = {
  'Engineering': {
    emoji: '⚙️',
    patterns: ['Linear', 'PR Auto', 'GitHub', 'Service Status', 'Dry'],
    description: 'Code, tickets, PRs, and infrastructure'
  },
  'Content': {
    emoji: '✍️',
    patterns: ['Blog'],
    description: 'Blog generation and publishing'
  },
  'Analytics': {
    emoji: '📊',
    patterns: ['PostHog', 'Traffic', 'Content Analysis', 'Ad Analysis'],
    description: 'Stats, metrics, and performance tracking'
  },
  'Research': {
    emoji: '🔍',
    patterns: ['AI News', 'X Feed', 'Competitor', 'Vambe', 'Feature'],
    description: 'News, trends, and competitive intel'
  },
  'Operations': {
    emoji: '🔧',
    patterns: ['Cron Randomizer', 'Dashboard', 'Self-Improvement', 'Overview'],
    description: 'System maintenance and daily briefings'
  }
};

// Extract description from job message (first line or first sentence)
function extractDescription(job) {
  const msg = job.payload?.message || '';
  // Try to get the first meaningful line after any emoji header
  const lines = msg.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const clean = line.replace(/^[#\s*]+/, '').replace(/^\p{Emoji}+\s*/u, '').trim();
    if (clean.length > 10 && clean.length < 200 && !clean.startsWith('```')) {
      // Return first sentence
      const sentence = clean.split(/[.!]\s/)[0];
      return sentence.length > 100 ? sentence.slice(0, 100) + '...' : sentence;
    }
  }
  return job.name || 'Scheduled task';
}

// Categorize a job
function categorizeJob(job) {
  const name = job.name || '';
  for (const [cat, config] of Object.entries(categories)) {
    if (config.patterns.some(p => name.includes(p))) {
      return cat;
    }
  }
  return 'Other';
}

// Helper functions
function formatSchedule(schedule) {
  if (!schedule) return 'Unknown';
  if (schedule.kind === 'cron') {
    // Parse cron to human readable
    const expr = schedule.expr;
    const parts = expr.split(' ');
    if (parts.length >= 5) {
      const [min, hour, dom, mon, dow] = parts;
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let time = '';
      if (hour !== '*' && min !== '*') {
        const h = parseInt(hour);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        time = `${h12}:${min.padStart(2, '0')} ${ampm}`;
      }
      if (dow !== '*') {
        const dayNums = dow.split(',').map(d => days[parseInt(d)] || d);
        return time ? `${dayNums.join(', ')} @ ${time}` : `${dayNums.join(', ')}`;
      }
      if (min.includes(',')) {
        return `Every ${min.split(',').length}x/hour`;
      }
      return time ? `Daily @ ${time}` : expr;
    }
    return expr;
  }
  if (schedule.kind === 'every') {
    const mins = Math.round(schedule.everyMs / 60000);
    if (mins < 60) return `Every ${mins} min`;
    const hours = Math.round(mins / 60);
    return `Every ${hours}h`;
  }
  if (schedule.kind === 'at') {
    return `Once: ${new Date(schedule.at).toLocaleString()}`;
  }
  return JSON.stringify(schedule);
}

function formatNextRun(state) {
  if (!state?.nextRunAtMs) return '—';
  const next = new Date(state.nextRunAtMs);
  const now = new Date();
  const diff = next - now;
  if (diff < 0) return 'Overdue';
  if (diff < 60000) return 'Soon';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    const mins = Math.round((diff % 3600000) / 60000);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${Math.round(diff / 86400000)}d`;
}

function getStatusEmoji(state) {
  if (!state?.lastStatus) return '⏳';
  if (state.lastStatus === 'ok') return '✅';
  if (state.lastStatus === 'error') return '❌';
  return '⏳';
}

function getStatusClass(state) {
  if (!state?.lastStatus) return 'pending';
  if (state.lastStatus === 'ok') return 'success';
  if (state.lastStatus === 'error') return 'error';
  return 'pending';
}

function getStatusLabel(state) {
  if (!state?.lastStatus) return 'Never run';
  if (state.lastStatus === 'ok') return 'Last run OK';
  if (state.lastStatus === 'error') return 'Last run failed';
  return state.lastStatus;
}

// Group jobs by category
const groupedJobs = {};
for (const job of jobs) {
  const cat = categorizeJob(job);
  if (!groupedJobs[cat]) groupedJobs[cat] = [];
  groupedJobs[cat].push({
    ...job,
    description: extractDescription(job)
  });
}

// Sort jobs within each category by next run
for (const cat of Object.keys(groupedJobs)) {
  groupedJobs[cat].sort((a, b) => {
    const aNext = a.state?.nextRunAtMs || Infinity;
    const bNext = b.state?.nextRunAtMs || Infinity;
    return aNext - bNext;
  });
}

// Order categories
const categoryOrder = ['Engineering', 'Content', 'Analytics', 'Research', 'Operations', 'Other'];

// Generate HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nora's Schedule</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦊</text></svg>">
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --error: #f85149;
      --warning: #d29922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 2rem; }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    .subtitle { color: var(--text-muted); font-size: 1.1rem; }
    
    .legend {
      display: flex;
      gap: 2rem;
      justify-content: center;
      margin: 1.5rem 0 2rem;
      flex-wrap: wrap;
      padding: 1rem;
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
    }
    .legend-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .legend-dot.success { background: var(--success); }
    .legend-dot.error { background: var(--error); }
    .legend-dot.pending { background: var(--warning); }
    
    .stats {
      display: flex;
      gap: 1.5rem;
      justify-content: center;
      margin: 1.5rem 0;
      flex-wrap: wrap;
    }
    .stat {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.5rem;
      text-align: center;
      min-width: 100px;
    }
    .stat-value { font-size: 1.75rem; font-weight: 700; color: var(--accent); }
    .stat-label { color: var(--text-muted); font-size: 0.8rem; margin-top: 0.25rem; }
    
    .category {
      margin-bottom: 2rem;
    }
    .category-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .category-emoji { font-size: 1.5rem; }
    .category-title { font-size: 1.25rem; font-weight: 600; }
    .category-desc { color: var(--text-muted); font-size: 0.85rem; margin-left: auto; }
    
    .jobs { display: grid; gap: 0.75rem; }
    .job {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem 1.25rem;
      display: grid;
      grid-template-columns: 32px 1fr auto;
      gap: 1rem;
      align-items: start;
      transition: border-color 0.2s;
    }
    .job:hover { border-color: var(--accent); }
    .job.disabled { opacity: 0.5; }
    
    .job-status { font-size: 1.25rem; text-align: center; padding-top: 0.1rem; }
    .job-info { min-width: 0; }
    .job-name { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.25rem; }
    .job-desc { color: var(--text-muted); font-size: 0.8rem; line-height: 1.4; margin-bottom: 0.5rem; }
    .job-meta {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .job-meta span { display: flex; align-items: center; gap: 0.25rem; }
    
    .job-right {
      text-align: right;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.5rem;
    }
    .job-next {
      font-size: 0.9rem;
      font-weight: 500;
      color: var(--accent);
    }
    .job-status-badge {
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }
    .job-status-badge.success { background: rgba(63, 185, 80, 0.15); color: var(--success); }
    .job-status-badge.error { background: rgba(248, 81, 73, 0.15); color: var(--error); }
    .job-status-badge.pending { background: rgba(210, 153, 34, 0.15); color: var(--warning); }
    
    .updated {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.8rem;
      margin-top: 2rem;
      padding-bottom: 2rem;
    }
    
    @media (max-width: 640px) {
      body { padding: 1rem; }
      .job { grid-template-columns: 28px 1fr; }
      .job-right { grid-column: 2; flex-direction: row; justify-content: space-between; width: 100%; }
      .category-desc { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🦊 Nora's Schedule</h1>
      <p class="subtitle">Automated tasks running on OpenClaw</p>
    </header>
    
    <div class="legend">
      <div class="legend-item">
        <div class="legend-dot success"></div>
        <span><strong>OK</strong> — Last run completed successfully</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot error"></div>
        <span><strong>Error</strong> — Last run failed (will retry)</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot pending"></div>
        <span><strong>Pending</strong> — Never run yet or waiting</span>
      </div>
    </div>
    
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${jobs.length}</div>
        <div class="stat-label">Total Jobs</div>
      </div>
      <div class="stat">
        <div class="stat-value">${jobs.filter(j => j.enabled).length}</div>
        <div class="stat-label">Active</div>
      </div>
      <div class="stat">
        <div class="stat-value">${jobs.filter(j => j.state?.lastStatus === 'ok').length}</div>
        <div class="stat-label">Healthy</div>
      </div>
      <div class="stat">
        <div class="stat-value">${jobs.filter(j => j.state?.lastStatus === 'error').length}</div>
        <div class="stat-label">Errors</div>
      </div>
    </div>
    
    ${categoryOrder.filter(cat => groupedJobs[cat]?.length > 0).map(cat => {
      const config = categories[cat] || { emoji: '📋', description: '' };
      const catJobs = groupedJobs[cat];
      return `
    <div class="category">
      <div class="category-header">
        <span class="category-emoji">${config.emoji}</span>
        <span class="category-title">${cat}</span>
        <span class="category-desc">${config.description}</span>
      </div>
      <div class="jobs">
        ${catJobs.map(job => `
        <div class="job${job.enabled ? '' : ' disabled'}">
          <div class="job-status">${getStatusEmoji(job.state)}</div>
          <div class="job-info">
            <div class="job-name">${job.name || job.id}</div>
            <div class="job-desc">${job.description}</div>
            <div class="job-meta">
              <span>🕐 ${formatSchedule(job.schedule)}</span>
              <span>🤖 ${job.agentId || 'main'}</span>
            </div>
          </div>
          <div class="job-right">
            <div class="job-next">in ${formatNextRun(job.state)}</div>
            <div class="job-status-badge ${getStatusClass(job.state)}">${getStatusLabel(job.state)}</div>
          </div>
        </div>
        `).join('')}
      </div>
    </div>
      `;
    }).join('')}
    
    <p class="updated">Last updated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST</p>
  </div>
</body>
</html>`;

// Write output
const outDir = path.join(__dirname, 'public');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);

console.log(`✅ Generated dashboard with ${jobs.length} jobs in ${Object.keys(groupedJobs).length} categories`);
