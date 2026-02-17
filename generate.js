#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get cron jobs from OpenClaw
let jobs = [];
try {
  // openclaw outputs doctor warnings before JSON, so we need to extract just the JSON
  const result = execSync('openclaw cron list --json 2>/dev/null | sed -n \'/^{/,$p\'', { 
    encoding: 'utf8', 
    timeout: 30000,
    shell: '/bin/zsh'
  });
  const data = JSON.parse(result);
  jobs = data.jobs || [];
} catch (e) {
  console.error('Failed to fetch cron jobs:', e.message);
  // Try reading from cached file
  try {
    const cached = fs.readFileSync(path.join(__dirname, 'jobs-cache.json'), 'utf8');
    jobs = JSON.parse(cached).jobs || [];
    console.log('Using cached jobs data');
  } catch {
    console.log('No cache available, using empty jobs');
  }
}

// Cache jobs for next time
fs.writeFileSync(path.join(__dirname, 'jobs-cache.json'), JSON.stringify({ jobs }, null, 2));

// Helper functions
function formatSchedule(schedule) {
  if (!schedule) return 'Unknown';
  if (schedule.kind === 'cron') {
    return `cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`;
  }
  if (schedule.kind === 'every') {
    const mins = Math.round(schedule.everyMs / 60000);
    if (mins < 60) return `Every ${mins} min`;
    const hours = Math.round(mins / 60);
    return `Every ${hours}h`;
  }
  if (schedule.kind === 'at') {
    return `At: ${new Date(schedule.at).toLocaleString()}`;
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
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  return next.toLocaleDateString();
}

function getStatusEmoji(state) {
  if (!state) return '⏳';
  if (state.lastStatus === 'ok') return '✅';
  if (state.lastStatus === 'error') return '❌';
  return '⏳';
}

function getStatusClass(state) {
  if (!state) return 'pending';
  if (state.lastStatus === 'ok') return 'success';
  if (state.lastStatus === 'error') return 'error';
  return 'pending';
}

// Sort jobs by next run
jobs.sort((a, b) => {
  const aNext = a.state?.nextRunAtMs || Infinity;
  const bNext = b.state?.nextRunAtMs || Infinity;
  return aNext - bNext;
});

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
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      text-align: center;
      margin-bottom: 3rem;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
    }
    .stats {
      display: flex;
      gap: 2rem;
      justify-content: center;
      margin: 2rem 0;
      flex-wrap: wrap;
    }
    .stat {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem 2rem;
      text-align: center;
      min-width: 140px;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--accent);
    }
    .stat-label {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }
    .jobs {
      display: grid;
      gap: 1rem;
    }
    .job {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      display: grid;
      grid-template-columns: auto 1fr auto auto auto;
      gap: 1rem;
      align-items: center;
      transition: border-color 0.2s;
    }
    .job:hover {
      border-color: var(--accent);
    }
    .job.disabled {
      opacity: 0.5;
    }
    .job-status {
      font-size: 1.5rem;
      width: 40px;
      text-align: center;
    }
    .job-info {
      min-width: 0;
    }
    .job-name {
      font-weight: 600;
      font-size: 1.05rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .job-schedule {
      color: var(--text-muted);
      font-size: 0.85rem;
      font-family: 'SF Mono', Monaco, monospace;
      margin-top: 0.25rem;
    }
    .job-agent {
      background: var(--border);
      color: var(--text-muted);
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.8rem;
      white-space: nowrap;
    }
    .job-next {
      color: var(--text-muted);
      font-size: 0.9rem;
      text-align: right;
      min-width: 60px;
    }
    .job-last {
      font-size: 0.8rem;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      text-align: center;
      min-width: 70px;
    }
    .job-last.success { background: rgba(63, 185, 80, 0.15); color: var(--success); }
    .job-last.error { background: rgba(248, 81, 73, 0.15); color: var(--error); }
    .job-last.pending { background: rgba(210, 153, 34, 0.15); color: var(--warning); }
    
    .updated {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 3rem;
      padding-bottom: 2rem;
    }
    
    @media (max-width: 768px) {
      body { padding: 1rem; }
      .job {
        grid-template-columns: auto 1fr;
        grid-template-rows: auto auto;
      }
      .job-agent, .job-next, .job-last {
        grid-column: 2;
        justify-self: start;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🦊 Nora's Schedule</h1>
      <p class="subtitle">OpenClaw cron jobs dashboard</p>
    </header>
    
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
    
    <div class="jobs">
      ${jobs.map(job => `
      <div class="job${job.enabled ? '' : ' disabled'}">
        <div class="job-status">${getStatusEmoji(job.state)}</div>
        <div class="job-info">
          <div class="job-name">${job.name || job.id}</div>
          <div class="job-schedule">${formatSchedule(job.schedule)}</div>
        </div>
        <div class="job-agent">${job.agentId || 'main'}</div>
        <div class="job-next">in ${formatNextRun(job.state)}</div>
        <div class="job-last ${getStatusClass(job.state)}">${job.state?.lastStatus || 'pending'}</div>
      </div>
      `).join('')}
    </div>
    
    <p class="updated">Last updated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST</p>
  </div>
</body>
</html>`;

// Write output
const outDir = path.join(__dirname, 'public');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);

console.log(`✅ Generated dashboard with ${jobs.length} jobs`);
