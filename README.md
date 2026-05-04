# Engineering 10X - GitHub Analytics Dashboard

Real-time GitHub analytics dashboard powered by live data from the LangChain repository.

## Features

- 📊 **Real-time KPIs**: Stars, active contributors, weekly commits, PR turnaround time
- 👥 **Contributor Analytics**: Detailed stats for top contributors with Claude usage metrics
- 🤖 **AI Detection**: Identify AI-assisted commits and code patterns
- 📈 **Historical Trends**: MongoDB-backed data persistence and trend analysis
- 🔄 **Delta Sync**: Efficient incremental updates with minimal data transfer

## Dashboard Files

- `Engineering10X-Dashboard.html` - Main dashboard (recommended)
- `Engineering10X-Dashboard-Pro.html` - Professional version
- `Engineering10X-MongoDB.html` - MongoDB visualization
- `Engineering10X.html` - Classic version

## Backend

**Repository**: LangChain (langchain-ai/langchain)
- Total Stars: 135,740+
- Active Contributors: 20+
- Weekly Commits: 30+

### Tech Stack

- **Frontend**: HTML5, CSS, JavaScript
- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **API**: GitHub REST API v3

### Running Locally

```bash
# Install dependencies
npm install

# Start backend (runs on localhost:3003)
node github-analytics.js

# Open dashboard in browser
open Engineering10X-Dashboard.html
```

## API Endpoints

- `/api/analytics` - Complete analytics snapshot
- `/api/kpis` - Key performance indicators
- `/api/contributors` - Contributor data
- `/api/ai-stats` - AI detection statistics
- `/health` - Health check

## License

MIT

---

**MotoX Organization** - Engineering 10X Dashboard
