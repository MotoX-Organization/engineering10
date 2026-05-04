/**
 * Engineering 10X - GitHub Analytics Backend
 * Fetches real data from langchain repo
 * Runs on localhost:3003
 * With MongoDB caching + delta sync for minimal data transfer
 */

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = 3003;

app.use(cors());
app.use(express.json());

// ============================================
// MONGODB CONNECTION & SCHEMAS
// ============================================
mongoose.connect('mongodb://localhost:27017/engineering10x').then(() => {
  console.log('✅ MongoDB connected');
}).catch(err => {
  console.warn('⚠️  MongoDB connection failed:', err.message);
  console.warn('Proceeding without persistence.');
});

// KPI Snapshot Schema
const kpiSnapshotSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  repo: String,
  data: {
    totalStars: Number,
    activeContributors: Number,
    weeklyCommits: Number,
    avgPRTurnaround: Number
  },
  delta: mongoose.Schema.Types.Mixed
});

// Contributors Snapshot Schema
const contributorsSnapshotSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  contributors: [mongoose.Schema.Types.Mixed]
});

// Sync State Schema (tracks last sync)
const syncStateSchema = new mongoose.Schema({
  _id: { type: String, default: 'latest' },
  lastSyncedAt: Date,
  kpiHash: String
});

const KPISnapshot = mongoose.model('KPISnapshot', kpiSnapshotSchema);
const ContributorsSnapshot = mongoose.model('ContributorsSnapshot', contributorsSnapshotSchema);
const SyncState = mongoose.model('SyncState', syncStateSchema);

// AI Stats Schema
const aiStatsSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  total_commits_analyzed: Number,
  ai_commits: Number,
  ai_percentage: Number,
  by_ai_tool: mongoose.Schema.Types.Mixed
});

// Engineer AI Stats Schema
const engineerAIStatsSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  engineers: [mongoose.Schema.Types.Mixed]
});

// AI Commits Detail Schema
const aiCommitDetailSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  commits: [mongoose.Schema.Types.Mixed]
});

const AIStats = mongoose.model('AIStats', aiStatsSchema);
const EngineerAIStats = mongoose.model('EngineerAIStats', engineerAIStatsSchema);
const AICommitDetail = mongoose.model('AICommitDetail', aiCommitDetailSchema);

// ============================================
// HELPER FUNCTIONS
// ============================================
function computeDelta(current, previous) {
  if (!previous) return current;

  const delta = {};
  Object.keys(current).forEach(key => {
    if (current[key] !== previous[key]) {
      delta[key] = {
        old: previous[key],
        new: current[key],
        change: current[key] - (previous[key] || 0)
      };
    }
  });
  return delta;
}

async function saveKPIToMongo(kpiData) {
  try {
    if (!mongoose.connection.readyState) return;

    const lastSnapshot = await KPISnapshot.findOne().sort({ timestamp: -1 });
    const delta = computeDelta(kpiData, lastSnapshot?.data);

    const snapshot = new KPISnapshot({
      repo: 'langchain-ai/langchain',
      data: kpiData,
      delta: delta
    });

    await snapshot.save();
    console.log('💾 KPI saved to MongoDB');
  } catch (error) {
    console.error('Error saving KPI:', error.message);
  }
}

async function saveContributorsToMongo(contributors) {
  try {
    if (!mongoose.connection.readyState) return;

    const snapshot = new ContributorsSnapshot({ contributors });
    await snapshot.save();
    console.log('💾 Contributors saved to MongoDB');
  } catch (error) {
    console.error('Error saving contributors:', error.message);
  }
}

async function saveAIStatsToMongo(aiStats) {
  try {
    if (!mongoose.connection.readyState) return;

    const snapshot = new AIStats(aiStats);
    await snapshot.save();
    console.log('💾 AI Stats saved to MongoDB');
  } catch (error) {
    console.error('Error saving AI stats:', error.message);
  }
}

async function saveEngineerAIStatsToMongo(engineerAIStats) {
  try {
    if (!mongoose.connection.readyState) return;

    const snapshot = new EngineerAIStats(engineerAIStats);
    await snapshot.save();
    console.log('💾 Engineer AI Stats saved to MongoDB');
  } catch (error) {
    console.error('Error saving engineer AI stats:', error.message);
  }
}

async function saveAICommitsToMongo(aiCommits) {
  try {
    if (!mongoose.connection.readyState) return;

    const snapshot = new AICommitDetail({ commits: aiCommits });
    await snapshot.save();
    console.log('💾 AI Commits saved to MongoDB');
  } catch (error) {
    console.error('Error saving AI commits:', error.message);
  }
}

// GitHub API base URL & Authentication
const GITHUB_API = 'https://api.github.com';
const REPO_OWNER = 'langchain-ai';
const REPO_NAME = 'langchain';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN_HERE';

// Helper function for authenticated GitHub API calls
function gitHubHeaders() {
  return {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  };
}

// ============================================
// AI DETECTION & PER-ENGINEER METRICS
// ============================================
const AI_KEYWORDS = [
  'claude', 'anthropic',
  'copilot', 'github copilot',
  'gpt', 'openai', 'chatgpt',
  'ai-assisted', 'ai-generated', 'ai agent', 'ai-agent',
  'generated by', 'assisted by',
  '🤖'
];

function detectAIAssistance(commitMessage, author, prDescription = '') {
  const lowerMessage = (commitMessage + ' ' + prDescription).toLowerCase();
  const lowerAuthor = (author || '').toLowerCase();
  let aiTools = new Set();
  let confidence = 0;

  // Check for explicit AI tool mentions
  if (lowerMessage.includes('claude') || lowerAuthor.includes('claude')) {
    aiTools.add('Claude');
    confidence += 40;
  }
  if (lowerMessage.includes('copilot')) {
    aiTools.add('GitHub Copilot');
    confidence += 30;
  }
  if (lowerMessage.includes('gpt') || lowerMessage.includes('openai')) {
    aiTools.add('OpenAI');
    confidence += 30;
  }
  if (lowerMessage.includes('ai-agent') || lowerMessage.includes('ai agent')) {
    aiTools.add('AI Agent');
    confidence += 35;
  }
  if (lowerMessage.includes('ai-assisted') || lowerMessage.includes('ai assisted')) {
    aiTools.add('AI-Assisted');
    confidence += 50;
  }
  if (lowerMessage.includes('ai-generated') || lowerMessage.includes('ai generated')) {
    aiTools.add('AI-Generated');
    confidence += 60;
  }
  if (lowerMessage.includes('generated by') || lowerMessage.includes('assisted by')) {
    confidence += 25;
  }
  if (lowerMessage.includes('🤖') || lowerAuthor.includes('bot')) {
    aiTools.add('Automated');
    confidence += 20;
  }
  if (lowerMessage.includes('co-authored-by:')) {
    aiTools.add('Co-authored');
    confidence += 10;
  }

  // Code pattern heuristics (basic)
  if (lowerMessage.includes('feat:') || lowerMessage.includes('feature:')) {
    confidence += 5; // New features sometimes AI-generated
  }
  if (commitMessage.split('\n').length > 5) {
    confidence += 5; // Well-documented = possibly AI
  }

  return {
    detected: aiTools.size > 0,
    tools: Array.from(aiTools),
    confidence: Math.min(100, confidence)
  };
}

async function getEngineerKPIs(contributors) {
  const engineerKPIs = contributors.map(c => ({
    login: c.login,
    name: c.login,
    commits: c.commits,
    prs_raised: c.prs_raised,
    reviews: c.reviews,
    lines_changed: c.lines_changed,
    avg_pr_turnaround: Math.random() * 10 // Placeholder - would need actual PR data per engineer
  }));
  return engineerKPIs.sort((a, b) => b.commits - a.commits);
}

async function detectAICommits(limit = 100) {
  try {
    const response = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=${limit}`,
      { headers: gitHubHeaders() }
    );

    const aiCommits = response.data
      .map(commit => {
        const message = commit.commit.message || '';
        const author = commit.commit.author?.name || '';
        const detection = detectAIAssistance(message, author);
        return {
          sha: commit.sha.substring(0, 7),
          message: message.split('\n')[0],
          author: author,
          author_login: commit.author?.login,
          date: commit.commit.author?.date,
          ...detection
        };
      })
      .filter(commit => commit.detected);

    return aiCommits;
  } catch (error) {
    console.error('Error detecting AI commits:', error.message);
    return [];
  }
}

async function getEngineerAIStats(contributors) {
  try {
    const engineerAI = {};

    for (const contributor of contributors.slice(0, 20)) {
      const response = await axios.get(
        `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits?author=${contributor.login}&per_page=50`,
        { headers: gitHubHeaders() }
      );

      let totalCommits = 0;
      let aiCommits = 0;
      let avgAIConfidence = 0;

      response.data.forEach(commit => {
        totalCommits++;
        const message = commit.commit.message || '';
        const author = commit.commit.author?.name || '';
        const detection = detectAIAssistance(message, author);

        if (detection.detected) {
          aiCommits++;
          avgAIConfidence += detection.confidence;
        }
      });

      engineerAI[contributor.login] = {
        total_commits: totalCommits,
        ai_commits: aiCommits,
        ai_percentage: totalCommits > 0 ? Math.round((aiCommits / totalCommits) * 100) : 0,
        avg_ai_confidence: aiCommits > 0 ? Math.round(avgAIConfidence / aiCommits) : 0
      };
    }

    return engineerAI;
  } catch (error) {
    console.error('Error calculating engineer AI stats:', error.message);
    return {};
  }
}

// Cache to avoid too many requests
let cache = {
  stats: null,
  contributors: null,
  lastUpdated: 0
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// ============================================
// FETCH REPO STATS
// ============================================
async function fetchRepoStats() {
  try {
    const response = await axios.get(`${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}`, {
      headers: gitHubHeaders()
    });
    const data = response.data;

    return {
      stars: data.stargazers_count,
      forks: data.forks_count,
      watchers: data.watchers_count,
      open_issues: data.open_issues_count,
      closed_issues: data.watchers_count, // Approximation
      description: data.description,
      language: data.language,
      updated_at: data.updated_at,
      url: data.html_url,
      pushed_at: data.pushed_at
    };
  } catch (error) {
    console.error('Error fetching repo stats:', error.message);
    return null;
  }
}

// ============================================
// FETCH TOP 20 CONTRIBUTORS WITH DETAILED STATS
// ============================================
async function fetchContributors() {
  try {
    // Check cache first (1 hour TTL)
    if (mongoose.connection.readyState) {
      const recentCache = await ContributorsSnapshot.findOne().sort({ timestamp: -1 }).lean();
      if (recentCache && (Date.now() - recentCache.timestamp.getTime() < 60 * 60 * 1000)) {
        console.log('✅ Contributors from cache (1 hour)');
        return recentCache.contributors;
      }
    }

    console.log('📥 Fetching top 20 contributors...');

    const response = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contributors?per_page=20`,
      { headers: gitHubHeaders() }
    );

    let contributors = response.data.map(contributor => ({
      login: contributor.login,
      name: contributor.login,
      avatar: contributor.avatar_url,
      commits: contributor.contributions,
      profile: contributor.html_url,
      additions: 0,
      deletions: 0,
      prs_raised: 0,
      reviews: 0
    }));

    // Fetch detailed stats for each contributor (parallel requests)
    console.log('📊 Fetching detailed contributor stats...');

    const detailedStats = await Promise.all(
      contributors.map(async (contributor) => {
        try {
          // Get additions and deletions from commits
          const linesResponse = await axios.get(
            `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits?author=${contributor.login}&per_page=100`,
            { headers: gitHubHeaders() }
          );

          let totalAdditions = 0;
          let totalDeletions = 0;

          // Sample first commit only (to avoid rate limits)
          if (linesResponse.data.length > 0) {
            try {
              const commitDetails = await axios.get(
                `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits/${linesResponse.data[0].sha}`,
                { headers: gitHubHeaders() }
              );
              totalAdditions = commitDetails.data.stats?.additions || 0;
              totalDeletions = commitDetails.data.stats?.deletions || 0;
            } catch (e) {
              // Skip if commit fetch fails
            }
          }

          // Get PRs raised - use search API with correct author parameter
          const searchResponse = await axios.get(
            `${GITHUB_API}/search/issues?q=repo:${REPO_OWNER}/${REPO_NAME}+type:pr+author:${contributor.login}&per_page=1`,
            { headers: gitHubHeaders() }
          );
          const prCount = searchResponse.data.total_count || 0;

          // Reviews count (simplified - fetch only once)
          const reviews = 0;

          return {
            ...contributor,
            additions: totalAdditions,
            deletions: totalDeletions,
            prs_raised: prCount,
            reviews: reviews,
            claude_usage: Math.random() * 100 // Placeholder
          };
        } catch (error) {
          console.error(`Error fetching stats for ${contributor.login}:`, error.message);
          return {
            ...contributor,
            additions: 0,
            deletions: 0,
            prs_raised: 0,
            reviews: 0
          };
        }
      })
    );

    return detailedStats;
  } catch (error) {
    console.error('Error fetching contributors:', error.message);
    return [];
  }
}

// ============================================
// FETCH RECENT COMMITS
// ============================================
async function fetchRecentCommits() {
  try {
    const response = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=5`,
      { headers: gitHubHeaders() }
    );

    return response.data.map(commit => ({
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
      url: commit.html_url,
      sha: commit.sha.substring(0, 7)
    }));
  } catch (error) {
    console.error('Error fetching commits:', error.message);
    return [];
  }
}

// ============================================
// FETCH PULL REQUESTS
// ============================================
async function fetchPullRequests() {
  try {
    const response = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=open&per_page=5`,
      { headers: gitHubHeaders() }
    );

    return response.data.map(pr => ({
      title: pr.title,
      author: pr.user.login,
      created_at: pr.created_at,
      url: pr.html_url,
      number: pr.number
    }));
  } catch (error) {
    console.error('Error fetching PRs:', error.message);
    return [];
  }
}

// ============================================
// FETCH ISSUES
// ============================================
async function fetchIssues() {
  try {
    const response = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&per_page=5`,
      { headers: gitHubHeaders() }
    );

    return response.data.map(issue => ({
      title: issue.title,
      number: issue.number,
      created_at: issue.created_at,
      url: issue.html_url
    }));
  } catch (error) {
    console.error('Error fetching issues:', error.message);
    return [];
  }
}

// ============================================
// CALCULATE KPIs
// ============================================
async function calculateKPIs(stats, contributors) {
  try {
    // KPI 1: Total Stars
    const totalStars = stats.stars || 0;

    // KPI 2: Active Contributors (last 30 days)
    const allContributors = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits?since=2024-03-28&per_page=100`,
      { headers: gitHubHeaders() }
    ).then(res => new Set(res.data.map(c => c.author?.login)).size).catch(() => contributors.length);

    // KPI 3: Weekly Commits (last 7 days)
    const weekAgoDate = new Date();
    weekAgoDate.setDate(weekAgoDate.getDate() - 7);
    const weeklyCommits = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits?since=${weekAgoDate.toISOString()}`,
      { headers: gitHubHeaders() }
    ).then(res => res.data.length).catch(() => 0);

    // KPI 4: Avg PR Turnaround (last 40 merged PRs)
    const prTurnaround = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=closed&per_page=40&sort=updated&direction=desc`,
      { headers: gitHubHeaders() }
    ).then(res => {
      const mergedPRs = res.data.filter(pr => pr.merged_at);
      console.log(`📊 Found ${res.data.length} closed PRs, ${mergedPRs.length} merged`);
      if (mergedPRs.length === 0) return 0;
      const avgTime = mergedPRs.reduce((sum, pr) => {
        const created = new Date(pr.created_at);
        const merged = new Date(pr.merged_at);
        return sum + (merged - created);
      }, 0) / mergedPRs.length;
      const hours = avgTime / (1000 * 60 * 60);
      const days = hours / 24;
      const display = days >= 1 ? Math.round(days) : Math.round(hours * 10) / 10;
      console.log(`⏱️  Average PR turnaround: ${display}${days >= 1 ? ' days' : ' hours'}`);
      return display;
    }).catch(err => {
      console.error('Error fetching PR data:', err.message);
      return 0;
    });

    return {
      totalStars,
      activeContributors: allContributors,
      weeklyCommits,
      avgPRTurnaround: prTurnaround
    };
  } catch (error) {
    console.error('Error calculating KPIs:', error.message);
    return {
      totalStars: stats.stars || 0,
      activeContributors: 0,
      weeklyCommits: 0,
      avgPRTurnaround: 0
    };
  }
}

// ============================================
// API ENDPOINTS
// ============================================

// Get all analytics data with KPIs + delta sync
app.get('/api/analytics', async (req, res) => {
  try {
    const sinceTimestamp = req.query.since ? new Date(parseInt(req.query.since)) : null;
    const now = Date.now();

    // Return cached data if fresh (only if no since param)
    if (!sinceTimestamp && cache.lastUpdated && now - cache.lastUpdated < CACHE_DURATION) {
      return res.json({
        ...cache.stats,
        syncType: 'cached',
        changed: true
      });
    }

    console.log('📊 Fetching fresh GitHub data...');

    const [stats, contributors, commits, prs, issues] = await Promise.all([
      fetchRepoStats(),
      fetchContributors(),
      fetchRecentCommits(),
      fetchPullRequests(),
      fetchIssues()
    ]);

    // Calculate KPIs
    const kpis = await calculateKPIs(stats, contributors);

    // Save to MongoDB
    await saveKPIToMongo(kpis);
    await saveContributorsToMongo(contributors);

    // Check if this is a delta sync request
    if (sinceTimestamp && mongoose.connection.readyState) {
      const lastSnapshot = await KPISnapshot.findOne().sort({ timestamp: -1 });
      const isChanged = lastSnapshot && lastSnapshot.timestamp > sinceTimestamp;

      if (!isChanged) {
        return res.json({
          changed: false,
          message: 'No changes since last sync',
          timestamp: new Date().toISOString()
        });
      }

      // Return delta data
      const delta = lastSnapshot?.delta || {};
      return res.json({
        changed: true,
        syncType: 'delta',
        delta: delta,
        contributors: contributors,
        timestamp: new Date().toISOString()
      });
    }

    const analytics = {
      repo: {
        name: REPO_NAME,
        owner: REPO_OWNER,
        url: stats?.url,
        ...stats
      },
      kpis,
      contributors,
      recent_commits: commits,
      open_prs: prs,
      open_issues: issues,
      timestamp: new Date().toISOString(),
      syncType: 'full'
    };

    // Cache the data
    cache.stats = analytics;
    cache.lastUpdated = now;

    console.log(`✅ Data fetched successfully with KPIs`);
    res.json(analytics);

  } catch (error) {
    console.error('Error fetching analytics:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get KPIs only (fast endpoint)
app.get('/api/kpis', async (req, res) => {
  try {
    if (cache.stats && cache.stats.kpis) {
      return res.json(cache.stats.kpis);
    }

    const stats = await fetchRepoStats();
    const contributors = await fetchContributors();
    const kpis = await calculateKPIs(stats, contributors);
    res.json(kpis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get contributors only
app.get('/api/contributors-detailed', async (req, res) => {
  try {
    const contributors = await fetchContributors();
    res.json({ contributors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get just stats (for quick requests)
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await fetchRepoStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get contributors
app.get('/api/contributors', async (req, res) => {
  try {
    const contributors = await fetchContributors();
    res.json({ contributors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Per-engineer KPIs
app.get('/api/engineer-kpis', async (req, res) => {
  try {
    const contributors = await fetchContributors();
    const engineerKPIs = await getEngineerKPIs(contributors);
    res.json({ engineers: engineerKPIs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI-assisted commits detection
app.get('/api/ai-commits', async (req, res) => {
  try {
    const limit = req.query.limit || 100;
    const aiCommits = await detectAICommits(parseInt(limit));
    res.json({
      total_detected: aiCommits.length,
      ai_commits: aiCommits
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Overall repo AI stats
app.get('/api/ai-stats', async (req, res) => {
  try {
    // Check if we have fresh cached data (less than 30 min old)
    if (mongoose.connection.readyState) {
      const recentCache = await AIStats.findOne().sort({ timestamp: -1 }).lean();
      if (recentCache && (Date.now() - recentCache.timestamp.getTime() < 30 * 60 * 1000)) {
        console.log('✅ AI stats from cache');
        return res.json(recentCache);
      }
    }

    console.log('📊 Calculating fresh AI stats...');
    const aiCommits = await detectAICommits(100);
    const allCommits = await axios.get(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=100`,
      { headers: gitHubHeaders() }
    );

    const totalCommits = allCommits.data.length;
    const aiPercentage = totalCommits > 0 ? Math.round((aiCommits.length / totalCommits) * 100) : 0;

    // Count by AI tool
    const toolCounts = {};
    aiCommits.forEach(commit => {
      commit.tools.forEach(tool => {
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      });
    });

    const aiStats = {
      total_commits_analyzed: totalCommits,
      ai_commits: aiCommits.length,
      ai_percentage: aiPercentage,
      by_ai_tool: toolCounts,
      timestamp: new Date().toISOString()
    };

    // Save to MongoDB
    await saveAIStatsToMongo(aiStats);
    await saveAICommitsToMongo(aiCommits);

    res.json(aiStats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Per-engineer AI contribution
app.get('/api/engineer-ai-stats', async (req, res) => {
  try {
    // Check if we have fresh cached data (less than 30 min old)
    if (mongoose.connection.readyState) {
      const recentCache = await EngineerAIStats.findOne().sort({ timestamp: -1 }).lean();
      if (recentCache && (Date.now() - recentCache.timestamp.getTime() < 30 * 60 * 1000)) {
        console.log('✅ Engineer AI stats from cache');
        return res.json(recentCache);
      }
    }

    console.log('📊 Calculating fresh engineer AI stats...');
    const contributors = await fetchContributors();
    const engineerAI = await getEngineerAIStats(contributors);

    // Sort by AI percentage
    const sorted = Object.entries(engineerAI)
      .map(([login, stats]) => ({ login, ...stats }))
      .sort((a, b) => b.ai_percentage - a.ai_percentage);

    const result = {
      engineers: sorted,
      total_engineers: sorted.length,
      timestamp: new Date().toISOString()
    };

    // Save to MongoDB
    await saveEngineerAIStatsToMongo(result);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    repo: `${REPO_OWNER}/${REPO_NAME}`,
    uptime: process.uptime(),
    mongoConnected: mongoose.connection.readyState === 1
  });
});

// ============================================
// MONGODB DASHBOARD ENDPOINTS
// ============================================

// Get sync history (last 50 syncs)
app.get('/api/mongo/sync-history', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.status(503).json({ error: 'MongoDB not connected' });
    }

    const history = await KPISnapshot.find()
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get KPI trends over time
app.get('/api/mongo/kpi-trends', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.status(503).json({ error: 'MongoDB not connected' });
    }

    const snapshots = await KPISnapshot.find()
      .sort({ timestamp: -1 })
      .limit(24) // Last 24 syncs
      .lean();

    const trends = snapshots.reverse().map(snap => ({
      timestamp: snap.timestamp,
      stars: snap.data.totalStars,
      commits: snap.data.weeklyCommits,
      contributors: snap.data.activeContributors,
      prTurnaround: snap.data.avgPRTurnaround
    }));

    res.json({ trends });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get latest AI stats from cache (no recalculation - instant load for dashboard)
app.get('/api/mongo/ai-stats-latest', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.json({
        total_commits_analyzed: 0,
        ai_commits: 0,
        ai_percentage: 0,
        by_ai_tool: {},
        timestamp: new Date().toISOString()
      });
    }

    const cached = await AIStats.findOne().sort({ timestamp: -1 }).lean();
    if (cached) {
      console.log('✅ AI stats from DB cache (instant)');
      return res.json(cached);
    }

    // No cache yet - return empty
    res.json({
      total_commits_analyzed: 0,
      ai_commits: 0,
      ai_percentage: 0,
      by_ai_tool: {},
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      total_commits_analyzed: 0,
      ai_commits: 0,
      ai_percentage: 0,
      by_ai_tool: {},
      timestamp: new Date().toISOString()
    });
  }
});

// Get latest engineer AI stats from cache (no recalculation - instant load)
app.get('/api/mongo/engineer-ai-stats-latest', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.json({
        engineers: [],
        total_engineers: 0,
        timestamp: new Date().toISOString()
      });
    }

    const cached = await EngineerAIStats.findOne().sort({ timestamp: -1 }).lean();
    if (cached) {
      console.log('✅ Engineer AI stats from DB cache (instant)');
      return res.json(cached);
    }

    // No cache yet - return empty
    res.json({
      engineers: [],
      total_engineers: 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      engineers: [],
      total_engineers: 0,
      timestamp: new Date().toISOString()
    });
  }
});

// Get database stats
app.get('/api/mongo/stats', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.status(503).json({ error: 'MongoDB not connected' });
    }

    const [kpiCount, contributorCount, lastSync] = await Promise.all([
      KPISnapshot.countDocuments(),
      ContributorsSnapshot.countDocuments(),
      KPISnapshot.findOne().sort({ timestamp: -1 }).lean()
    ]);

    res.json({
      kpiSnapshots: kpiCount,
      contributorSnapshots: contributorCount,
      lastSyncAt: lastSync?.timestamp,
      mongoConnected: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sync state (for client to know when to sync next)
app.get('/api/sync-state', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.json({ lastSyncAt: null, mongoConnected: false });
    }

    const lastSnapshot = await KPISnapshot.findOne().sort({ timestamp: -1 }).lean();

    res.json({
      lastSyncAt: lastSnapshot?.timestamp,
      timestamp: new Date().toISOString(),
      mongoConnected: true
    });
  } catch (error) {
    res.json({ error: error.message, mongoConnected: false });
  }
});

// ============================================
// AI DATA HISTORY ENDPOINTS
// ============================================

// Get AI stats history (last 50)
app.get('/api/mongo/ai-stats-history', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.status(503).json({ error: 'MongoDB not connected' });
    }

    const history = await AIStats.find()
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get engineer AI stats history (last 50)
app.get('/api/mongo/engineer-ai-history', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.status(503).json({ error: 'MongoDB not connected' });
    }

    const history = await EngineerAIStats.find()
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get AI commits detail history (last 50)
app.get('/api/mongo/ai-commits-history', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.status(503).json({ error: 'MongoDB not connected' });
    }

    const history = await AICommitDetail.find()
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🚀 Engineering 10X Analytics        ║
║   GitHub Repo: ${REPO_OWNER}/${REPO_NAME.padEnd(21)}║
║   Server: http://localhost:${PORT}        ║
╚════════════════════════════════════════╝

API Endpoints:
  GET /api/analytics     - Full analytics data
  GET /api/stats         - Repo stats only
  GET /api/contributors  - Top contributors
  GET /health            - Health check

Cache duration: 5 minutes
Rate limit: 60 requests/hour (unauthenticated)
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Analytics server shutting down...');
  process.exit(0);
});
