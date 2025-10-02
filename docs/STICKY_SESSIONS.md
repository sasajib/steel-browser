# Sticky Sessions

Steel Browser supports sticky sessions, which allow you to maintain consistent browser fingerprints and session data across multiple browsing sessions for the same user.

## Overview

Sticky sessions persist the following data per user UUID:
- **Browser fingerprint** - Maintains consistent fingerprint across sessions
- **Cookies** - All cookies from the browsing session
- **LocalStorage** - All localStorage data by domain
- **SessionStorage** - All sessionStorage data by domain
- **User Agent** - The user agent string used in the session

This data is stored in Redis and automatically loaded when you create a new session with the same user UUID.

## Configuration

To enable sticky sessions, you need to configure Redis connection in your environment:

### Environment Variables

```bash
# Enable session persistence
ENABLE_SESSION_PERSISTENCE=true

# Redis connection (option 1: single URL)
REDIS_URL=redis://localhost:6379/0

# Redis connection (option 2: individual parameters)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=your_password  # optional
```

### Docker Compose

If you're using Docker Compose, you can add Redis to your `docker-compose.yml`:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

  steel-api:
    # ... your existing config
    environment:
      ENABLE_SESSION_PERSISTENCE: "true"
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - redis

volumes:
  redis-data:
```

## Usage

### Creating a Session with User ID

When creating a session, pass a `userId` parameter to enable sticky session functionality:

#### Using the Node SDK

```typescript
import Steel from 'steel-sdk';

const client = new Steel({
  baseURL: "http://localhost:3000",
});

// Create a session for user with UUID
const session = await client.sessions.create({
  userId: "550e8400-e29b-41d4-a716-446655440000",
  blockAds: true,
  dimensions: { width: 1280, height: 800 },
});

console.log("Session created:", session.id);
```

#### Using the Python SDK

```python
from steel import Steel

client = Steel(base_url="http://localhost:3000")

# Create a session for user with UUID
session = client.sessions.create(
    user_id="550e8400-e29b-41d4-a716-446655440000",
    block_ads=True,
    dimensions={"width": 1280, "height": 800}
)

print(f"Session created: {session.id}")
```

#### Using cURL

```bash
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "blockAds": true,
    "dimensions": { "width": 1280, "height": 800 }
  }'
```

### How It Works

1. **First Session**: When you create a session with a `userId` for the first time:
   - A new browser session is created with a fresh fingerprint
   - Session data (cookies, localStorage, etc.) is empty
   - When the session ends, all data is saved to Redis with a 30-day TTL

2. **Subsequent Sessions**: When you create another session with the same `userId`:
   - The persisted data is automatically loaded from Redis
   - The same fingerprint characteristics are maintained
   - Cookies and storage data are restored
   - The session continues as if it never ended

3. **Data Persistence**:
   - Session data is automatically saved when you call the release session endpoint
   - Data is stored with a 30-day TTL (Time To Live)
   - The TTL is refreshed each time the session is accessed

### Complete Example Workflow

```typescript
import Steel from 'steel-sdk';
import puppeteer from 'puppeteer-core';

const client = new Steel({ baseURL: "http://localhost:3000" });
const userId = "550e8400-e29b-41d4-a716-446655440000";

// Session 1: First time browsing
const session1 = await client.sessions.create({ userId });

// Connect with Puppeteer
const browser1 = await puppeteer.connect({
  browserWSEndpoint: session1.websocketUrl,
});

const page1 = await browser1.newPage();
await page1.goto('https://example.com');
await page1.evaluate(() => {
  localStorage.setItem('user_preference', 'dark_mode');
});

await browser1.close();

// Release the session (this saves data to Redis)
await client.sessions.release(session1.id);

// Wait some time...

// Session 2: Resume browsing with same user
const session2 = await client.sessions.create({ userId });

const browser2 = await puppeteer.connect({
  browserWSEndpoint: session2.websocketUrl,
});

const page2 = await browser2.newPage();
await page2.goto('https://example.com');

// The localStorage data is restored!
const preference = await page2.evaluate(() => {
  return localStorage.getItem('user_preference');
});

console.log(preference); // Output: "dark_mode"

await browser2.close();
await client.sessions.release(session2.id);
```

## Data Storage Details

### Redis Key Structure

Session data is stored in Redis with the following key pattern:
```
steel:session:{userId}
```

### Data Structure

Each session entry contains:
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "sessionData": {
    "cookies": [...],
    "localStorage": {
      "https://example.com": {
        "key1": "value1",
        "key2": "value2"
      }
    },
    "sessionStorage": {...}
  },
  "userAgent": "Mozilla/5.0...",
  "fingerprint": {...},
  "lastAccessed": "2025-10-02T19:00:00Z",
  "createdAt": "2025-10-01T10:00:00Z"
}
```

### TTL (Time To Live)

- Default TTL: 30 days
- TTL is refreshed each time a session is accessed
- After 30 days of inactivity, the data is automatically deleted

## Use Cases

### 1. E-commerce Testing
Test multi-step checkout flows while maintaining shopping cart and user preferences:
```typescript
// Day 1: Add items to cart
const session1 = await client.sessions.create({
  userId: "user-123",
});
// ... add items to cart ...
await client.sessions.release(session1.id);

// Day 2: Complete checkout with saved cart
const session2 = await client.sessions.create({
  userId: "user-123",
});
// Cart items are still there!
```

### 2. Social Media Automation
Maintain logged-in state across automation runs:
```typescript
// First run: Login
const session1 = await client.sessions.create({ userId: "bot-001" });
// ... perform login ...
await client.sessions.release(session1.id);

// Later runs: Already logged in
const session2 = await client.sessions.create({ userId: "bot-001" });
// Cookies are restored, no need to login again!
```

### 3. Multi-User Scenarios
Manage separate sessions for different users:
```typescript
// User A's session
const sessionA = await client.sessions.create({ userId: "user-a" });
// ... browse as user A ...

// User B's session
const sessionB = await client.sessions.create({ userId: "user-b" });
// ... browse as user B ...

// Each user maintains their own separate state
```

## Best Practices

1. **Use Consistent User IDs**: Always use the same UUID for the same logical user
2. **Clean Up Sessions**: Always release sessions when done to persist data
3. **Handle Missing Data**: The first session for a user will have no persisted data
4. **Monitor Redis**: Keep an eye on Redis memory usage in production
5. **Secure User IDs**: Treat user IDs as sensitive data

## Troubleshooting

### Session data not persisting

Check that:
- `ENABLE_SESSION_PERSISTENCE=true` is set
- Redis is running and accessible
- Connection parameters are correct
- You're calling the release session endpoint

### Redis connection errors

If Redis is unavailable:
- The service will continue to work without persistence
- Warning logs will be generated
- No errors will be thrown to the client

### Data not loading

Verify:
- You're using the exact same `userId`
- Less than 30 days have passed since last access
- The session was properly released to save data

## API Reference

### Create Session with User ID

**Endpoint**: `POST /v1/sessions`

**Body**:
```json
{
  "userId": "string (optional)",
  "sessionId": "string (optional)",
  "proxyUrl": "string (optional)",
  "userAgent": "string (optional)",
  "blockAds": "boolean (optional)",
  "dimensions": {
    "width": "number",
    "height": "number"
  }
}
```

**Response**: Session details object

### Release Session

**Endpoint**: `POST /v1/sessions/release`

Releases the current session and persists data to Redis if `userId` was provided.

## Security Considerations

1. **User ID Privacy**: User IDs are stored in Redis - ensure Redis is secured
2. **Data Encryption**: Consider encrypting Redis data at rest in production
3. **Access Control**: Implement authentication to prevent unauthorized access to user sessions
4. **Compliance**: Ensure compliance with data privacy regulations (GDPR, CCPA, etc.)

## Limitations

1. Session data is limited by Redis memory
2. Very large localStorage/cookies may impact performance
3. IndexedDB is not currently persisted (may be added in future)
4. Data is only persisted on session release, not real-time
