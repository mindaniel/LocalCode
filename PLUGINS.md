# LocalCode Plugin System

Plugins live in `~/.localcode/plugins/<name>/` and extend the agent with custom tools (callable by the LLM) and slash commands (callable by the user).

---

## Plugin structure

```
~/.localcode/plugins/my-plugin/
├── localcode.plugin.json   ← manifest (required)
└── index.js                ← CommonJS module (required)
```

### `localcode.plugin.json`

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Short description",
  "author": "username",
  "tools": ["my_tool"],
  "commands": ["/mytool"]
}
```

| Field | Required | Description |
|---|---|---|
| `name` | ✓ | kebab-case, unique identifier |
| `version` | ✓ | semver (e.g. `1.0.0`) |
| `description` | ✓ | one-line summary |
| `author` | ✓ | your username |
| `tools` | ✓ | list of tool names your plugin registers |
| `commands` | optional | list of slash commands your plugin registers |

### `index.js` (CommonJS)

```js
module.exports = {
  register(registry) {
    // ── Agent tool (callable by LLM) ────────────────────────────────────────
    registry.addTool({
      name: 'my_tool',
      description: 'What this tool does — injected into the agent system prompt',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' }
        },
        required: ['path']
      },
      execute: async ({ path }) => {
        // Must return a string — sent back to the LLM as the tool result
        return `processed: ${path}`
      }
    })

    // ── User slash command (callable with /mytool) ───────────────────────────
    registry.addCommand({
      cmd: '/mytool',             // exact command; add trailing space if it takes args
      description: 'Run my tool manually',
      handler: async (args, ctx) => {
        // args: everything after the command name (string)
        // ctx.cwd: current working directory
        return { type: 'done', content: `Result: ${args} in ${ctx.cwd}` }
      }
    })
  }
}
```

**Handler return types:**

| `type` | Effect |
|---|---|
| `done` | Green success message |
| `text` | Plain text output |
| `error` | Red error message |
| `command` | Rich command output (uses `title`) |

---

## Installation

### From GitHub

```
/plugin install user/repo
/plugin install https://github.com/user/repo
```

Downloads the tarball, validates the manifest, and loads immediately — no restart needed.

### From local path

```
/plugin install ./path/to/my-plugin
/plugin install /absolute/path/to/plugin
```

Copies the directory to `~/.localcode/plugins/<name>/` and loads it.

---

## Management commands

| Command | Description |
|---|---|
| `/plugin` or `/plugin list` | Show all installed plugins with load status |
| `/plugin install <source>` | Install from GitHub (`user/repo`) or local path |
| `/plugin remove <name>` | Remove a plugin and unregister its tools/commands |
| `/plugin reload` | Reload all plugins (picks up changes without restart) |

---

## Architecture

```
src/
  types/plugin.ts       — shared interfaces: ToolDefinition, PluginCommand, PluginManifest, PluginLoadResult
  plugins/
    registry.ts         — ToolRegistry + CommandRegistry + singletons (globalRegistry, globalCommandRegistry)
    validator.ts        — validateManifest(json) → { valid, errors }
    loader.ts           — loadPlugins(registry, commandRegistry), reloadPlugin(name, ...)
    installer.ts        — installPlugin(source, ...), removePlugin(name, ...), listInstalledPlugins(registry)
```

- **Startup**: `localcode.tsx` calls `loadPlugins(globalRegistry, globalCommandRegistry)` before the TUI renders.
- **Tool dispatch**: `agent/tools/index.ts` checks `globalRegistry` for any unknown tool name.
- **System prompt**: `AgentRuntime.ts` appends all registered tools to the LLM system prompt.
- **Slash commands**: `app.tsx` uses `globalCommandRegistry.getCommand(input)` to route `/` inputs.

---

## Error handling

- Invalid manifest → plugin skipped, warning printed to console
- `index.js` fails to load → plugin skipped, warning printed
- `register()` throws → plugin skipped, warning printed
- Tool `execute()` throws → error string returned to LLM (agent continues)
- Two plugins register the same tool/command name → second wins, warning printed
