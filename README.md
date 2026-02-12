# Schematic MCP Server

An [MCP](https://modelcontextprotocol.io/) server that connects AI assistants to [Schematic](https://schematichq.com) -- the platform for managing billing, plans, features, and entitlements.

Use this server to let Claude, Cursor, or any MCP-compatible client look up companies, manage plan entitlements, set overrides, create features, and more -- all through natural language.

## Quick Start

### Claude Desktop / Claude Code

Add to your Claude config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "schematic": {
      "command": "npx",
      "args": ["-y", "@schematichq/schematic-mcp"],
      "env": {
        "SCHEMATIC_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cursor

Add the same configuration to Cursor's MCP config:

- **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/mcp.json`
- **Linux**: `~/.config/Cursor/User/globalStorage/mcp.json`
- **Windows**: `%APPDATA%\Cursor\User\globalStorage\mcp.json`

## Configuration

The server needs a Schematic API key. It checks two sources in order:

1. **Environment variable** (recommended): `SCHEMATIC_API_KEY`
2. **Config file** (fallback): `~/.schematic-mcp/config.json`

```json
{
  "apiKey": "your-api-key-here"
}
```

You can find your API key in the [Schematic dashboard](https://app.schematichq.com).

## Tools

### Company Lookup

| Tool | Description |
|------|-------------|
| `get_company` | Look up a company by ID, name, Stripe customer ID, or [custom key](https://docs.schematichq.com/developer_resources/key_management). Returns details, plan, trial status, and links. |
| `get_company_plan` | Get the plan a company is currently on. |
| `get_company_trial_info` | Check if a company is on a trial and when it ends. |
| `count_companies_on_plan` | Count how many companies are on a specific plan. |
| `link_stripe_to_schematic` | Find the Schematic company for a Stripe customer ID, or vice versa. |

### Company Overrides

| Tool | Description |
|------|-------------|
| `list_company_overrides` | List overrides by company or by feature. |
| `set_company_override` | Set or update an override for a company on a specific feature. Supports boolean (`on`/`off`), numeric, and `unlimited` values. |
| `remove_company_override` | Remove an override so the company falls back to plan entitlements. |

### Plan Management

| Tool | Description |
|------|-------------|
| `list_plans` | List all plans. |
| `create_plan` | Create a new plan. |
| `add_entitlements_to_plan` | Add feature entitlements to a plan. Auto-detects feature type and sets appropriate value types. |

### Feature Management

| Tool | Description |
|------|-------------|
| `list_features` | List all features. |
| `create_feature` | Create a new feature flag. Supports boolean (on/off), event-based (metered), and trait-based types. Automatically creates an associated flag. |

## Example Prompts

Once configured, try asking your AI assistant:

- "What plan is Acme Corp on?"
- "List all my plans and their features"
- "Create a boolean feature called 'Advanced Analytics'"
- "Set an override for Acme Corp to have unlimited API calls"
- "How many companies are on the Pro plan?"
- "Find the Schematic company linked to Stripe customer cus_abc123"

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode (auto-recompile on changes)
npm run dev

# Run tests
npm test
```

## License

MIT
