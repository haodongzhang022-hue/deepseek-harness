# @deepseek-ai/dsh-trigger-mcp-bridge

MCP Bridge for external trigger signals.

## Overview

This package provides an HTTP server that accepts external trigger signals and forwards them to the trigger engine. It allows external systems to trigger actions in DeepSeek Harness via HTTP requests.

## Endpoints

### POST /trigger/:triggerId/:source

Send a trigger signal.

**Request Body:**
```json
{
  "key": "value"
}
```

**Response:**
```json
{
  "status": "ok",
  "message": "Signal processed",
  "triggerId": "trg_1234567890_abc",
  "source": "http"
}
```

### GET /trigger/status

Get status of all triggers.

**Response:**
```json
{
  "status": "ok",
  "triggerCount": 5,
  "triggers": [
    {
      "id": "trg_1234567890_abc",
      "name": "config-reload",
      "state": "armed",
      "triggerCount": 3
    }
  ]
}
```

### POST /trigger/test

Test a trigger manually.

**Request Body:**
```json
{
  "triggerId": "trg_1234567890_abc",
  "data": {}
}
```

## Configuration

```typescript
interface Config {
  /** HTTP server port. */
  port?: number  // default: 8030
  /** Server host. */
  host?: string  // default: '127.0.0.1'
  /** API key for authentication (optional). */
  apiKey?: string
  /** Enable CORS. */
  enableCors?: boolean  // default: true
  /** Request timeout in milliseconds. */
  timeoutMs?: number  // default: 30000
}
```

## Usage

### External System Integration

```bash
# Send a trigger signal
curl -X POST http://localhost:8030/trigger/my-trigger/http \
  -H "Content-Type: application/json" \
  -d '{"environment": "production"}'

# Get trigger status
curl http://localhost:8030/trigger/status

# Test a trigger
curl -X POST http://localhost:8030/trigger/test \
  -H "Content-Type: application/json" \
  -d '{"triggerId": "trg_1234567890_abc"}'
```

### With Authentication

```bash
curl -X POST http://localhost:8030/trigger/my-trigger/http \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"key": "value"}'
```

## Security

- Enable `apiKey` for production deployments
- Use `host: '127.0.0.1'` to restrict to local access
- Consider using a reverse proxy for TLS termination

## Model Experience

This package enables external systems to trigger automated actions in DeepSeek Harness. It does not directly interact with the model.
