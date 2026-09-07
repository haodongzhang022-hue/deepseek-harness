# @deepseek-ai/dsh-tool-trigger

Trigger tools for DeepSeek Harness.

## Overview

This package provides model-facing tools for managing triggers:

| Tool | Description |
|------|-------------|
| `trigger_create` | Create a new trigger with condition and action |
| `trigger_list` | List all triggers with optional filters |
| `trigger_delete` | Delete a trigger by ID |
| `trigger_arm` | Arm (enable) a trigger |
| `trigger_disarm` | Disarm (disable) a trigger |

## Usage

### Creating a Trigger

```
trigger_create({
  name: "config-reload",
  condition: {
    type: "file",
    config: {
      pattern: "config/*.yml",
      changeType: "modify"
    }
  },
  action: {
    type: "workflow",
    config: {
      script: "await reloadConfig()",
      meta: {
        name: "reload-config",
        description: "Reload configuration files"
      }
    }
  }
})
```

### Listing Triggers

```
trigger_list({
  state: "armed"
})
```

### Arming a Trigger

```
trigger_arm({
  id: "trg_1234567890_abc"
})
```

## Model Experience

These tools allow the model to create, manage, and monitor triggers. The model can set up automated responses to various conditions without manual intervention.
