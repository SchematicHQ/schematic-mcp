# Testing with Cursor IDE

Cursor supports MCP servers just like Claude Desktop. Here's how to configure it:

## Configuration

### 1. Find Cursor's MCP Configuration File

The location depends on your OS:

- **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/mcp.json`
- **Linux**: `~/.config/Cursor/User/globalStorage/mcp.json`
- **Windows**: `%APPDATA%\Cursor\User\globalStorage\mcp.json`

Alternatively, you can access it through Cursor:
1. Open Cursor Settings (Cmd/Ctrl + ,)
2. Search for "MCP" or "Model Context Protocol"
3. Look for MCP server configuration

### 2. Add Your Server Configuration

Add your Schematic MCP server to the configuration:

```json
{
  "mcpServers": {
    "schematic": {
      "command": "node",
      "args": ["/absolute/path/to/schematic-mcp/dist/index.js"],
      "env": {
        "SCHEMATIC_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Important**: Use the absolute path to `dist/index.js`, not a relative path.

### 3. Get the Absolute Path

On macOS/Linux:
```bash
cd /Users/ryanechternacht/github/developers/schematic-mcp
pwd
# Use this path + /dist/index.js
```

Or use this one-liner:
```bash
echo "$(pwd)/dist/index.js"
```

### 4. Restart Cursor

After adding the configuration, restart Cursor completely (not just reload the window).

### 5. Test in Cursor

Once configured, you can test by:

1. **Open the Cursor Chat/Composer**
2. **Ask about available tools:**
   - "What MCP tools do you have available?"
   - "What tools are available for Schematic?"

3. **Try using the tools:**
   - "List all my plans in Schematic"
   - "What plan is company X on?"
   - "Get information about company Y"

## Verification

To verify Cursor can see your server:

1. Check Cursor's developer console/logs for MCP connection messages
2. Try asking Cursor to list available tools
3. If tools appear, the server is connected correctly

## Refreshing After Code Changes

After making changes to your MCP server:

1. **Rebuild the server:**
   ```bash
   npm run build
   ```

2. **Try using the tool again:**
   - Cursor may automatically pick up the changes on the next tool call
   - The server process may be restarted automatically when needed

3. **If changes don't appear:**
   - Try reloading the Cursor window (`Cmd/Ctrl + R`)
   - Or fully restart Cursor if needed

**Note**: Cursor may handle MCP server reloads automatically. For most code changes, just rebuilding should be enough. Only configuration changes (like adding/removing tools) might require a full Cursor restart.

## Troubleshooting

### Server Not Found

- **Check the path**: Must be absolute, pointing to `dist/index.js`
- **Verify build**: Run `npm run build` to ensure `dist/index.js` exists
- **Check permissions**: Ensure the file is executable

### API Key Issues

- **Set in config**: Add `SCHEMATIC_API_KEY` in the `env` section
- **Or use config file**: Create `~/.schematic-mcp/config.json` as fallback

### Tools Not Appearing

- **Restart Cursor**: Full restart, not just reload
- **Check logs**: Look for MCP errors in Cursor's developer console
- **Verify server starts**: Test with `node dist/index.js` manually

### Changes Not Reflecting

- **Did you rebuild?** Run `npm run build` after code changes
- **Did you fully restart?** Cursor must be completely quit and reopened
- **Check the path**: Make sure Cursor is pointing to the updated `dist/index.js`

## Alternative: Cursor Settings UI

Some versions of Cursor may have a UI for MCP configuration:

1. Open Settings (Cmd/Ctrl + ,)
2. Search for "MCP" or "Model Context Protocol"
3. Look for "MCP Servers" section
4. Add your server through the UI if available

## Testing Checklist

- [ ] Server builds successfully (`npm run build`)
- [ ] Configuration file created/updated
- [ ] Absolute path to `dist/index.js` is correct
- [ ] `SCHEMATIC_API_KEY` is set in config
- [ ] Cursor restarted completely
- [ ] Tools appear when asking Cursor
- [ ] Tools can be called successfully

