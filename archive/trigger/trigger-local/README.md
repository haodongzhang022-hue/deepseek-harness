# @deepseek-ai/dsh-trigger-local

Local trigger engine provider for DeepSeek Harness.

## Overview

This package implements the TriggerEngine interface using local resources:

- **File watching**: Uses Node.js fs.watch for file changes
- **HTTP server**: Runs a lightweight HTTP server for external signals
- **Schedule timers**: Uses setInterval for time-based triggers
- **Event listening**: Integrates with Cordis event system

## Configuration

```typescript
interface Config {
  /** Enable debug logging. */
  debug?: boolean
  /** Maximum number of triggers per session. */
  maxTriggers?: number
  /** Default cooldown period in seconds. */
  defaultCooldownSeconds?: number
  /** HTTP server port for external signals. */
  httpPort?: number
  /** Enable file watching. */
  enableFileWatching?: boolean
}
```

## Usage

This package is typically loaded as part of a bundle:

```yaml
# cordis.yml
plugins:
  - name: trigger-local
    config:
      debug: true
      httpPort: 8030
```

## Model Experience

This package provides the trigger engine service implementation. It does not directly interact with the model.
