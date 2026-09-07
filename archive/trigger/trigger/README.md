# @deepseek-ai/dsh-trigger

Condition-trigger framework for DeepSeek Harness.

## Overview

The trigger framework provides a lightweight, event-driven system for responding to external and internal conditions. It supports:

- **Event conditions**: Listen for DSH internal events
- **File conditions**: Watch for file system changes
- **HTTP conditions**: Listen for HTTP requests
- **Schedule conditions**: Time-based triggers (cron or interval)
- **Composite conditions**: Combine multiple conditions with AND/OR/NOT

## Architecture

The framework follows the DSH capability seam pattern:

- **Service Definition**: `@deepseek-ai/dsh-trigger` (this package)
- **Service Provider**: `@deepseek-ai/dsh-trigger-local` (local implementation)
- **Consumer**: `@deepseek-ai/dsh-tool-trigger` (model-facing tools)

## Usage

### Creating a Trigger

```typescript
import { TriggerEngine } from '@deepseek-ai/dsh-trigger'

// Create a trigger that fires when a file changes
const trigger = await engine.create({
  name: 'config-reload',
  condition: {
    type: 'file',
    config: {
      pattern: 'config/*.yml',
      changeType: 'modify'
    }
  },
  action: {
    type: 'workflow',
    config: {
      script: 'await reloadConfig()',
      meta: {
        name: 'reload-config',
        description: 'Reload configuration files'
      }
    }
  }
})
```

### External Signal Integration

The framework supports external signals via the MCP bridge:

```bash
# Send a trigger signal via HTTP
curl -X POST http://localhost:8030/trigger/my-trigger/http \
  -H "Content-Type: application/json" \
  -d '{"environment": "production"}'
```

## Configuration

```typescript
interface Config {
  /** Enable debug logging. */
  debug?: boolean
  /** Maximum number of triggers per session. */
  maxTriggers?: number
  /** Default cooldown period in seconds. */
  defaultCooldownSeconds?: number
}
```

## Known Limitations

- Triggers are session-scoped and do not persist across process restarts
- File watching uses polling on some platforms (performance may vary)
- HTTP server runs in the same process as the harness

## Model Experience

This package provides the trigger engine service. Model-facing tools are provided by `@deepseek-ai/dsh-tool-trigger`.
