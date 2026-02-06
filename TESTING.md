# Testing the Schematic MCP Server

This guide explains how to test your MCP server to ensure it works correctly with MCP clients.

## Prerequisites

1. Build the server:
   ```bash
   npm run build
   ```

2. Set your API key:
   ```bash
   export SCHEMATIC_API_KEY="your-api-key-here"
   ```

## Testing Methods

### 1. Automated Test Script (Recommended)

Run the included test client:

```bash
npm test
# or
npm run test
```

This will:
- ✅ Connect to the MCP server
- ✅ List all available tools
- ✅ Validate tool schemas
- ✅ Test a tool call (if API key is valid)

### 2. Manual Protocol Testing

You can test the MCP protocol directly using JSON-RPC messages:

```bash
# Start the server
node dist/index.js

# In another terminal, send MCP messages via stdin
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/index.js
```

### 3. Cursor IDE Integration (Alternative to Claude Desktop)

Cursor also supports MCP servers! See [CURSOR_SETUP.md](./CURSOR_SETUP.md) for detailed instructions.

**Quick setup:**
1. Add to Cursor's MCP config (usually at `~/Library/Application Support/Cursor/User/globalStorage/mcp.json` on macOS)
2. Use the same configuration format as Claude Desktop
3. Restart Cursor and test

### 4. Claude Desktop Integration (Real-World Testing)

This is the **most important test** - it validates your server works with actual MCP clients.

#### macOS Configuration

1. Open or create the config file:
   ```bash
   open ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

2. Add your server configuration:
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

3. Restart Claude Desktop

4. In Claude Desktop, you should see your tools available. Try asking:
   - "What tools do you have for Schematic?"
   - "List all my plans"
   - "What plan is company X on?"

#### Linux/Windows Configuration

- **Linux**: `~/.config/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### 5. Using MCP Inspector Tools

You can use web-based MCP testing tools:

1. **MCPcat** (https://mcpcat.io) - Web-based MCP server inspector
2. **MCP Playground** - If available in the MCP ecosystem

## Validating MCP Protocol Compliance

Your server should:

1. ✅ **Respond to `initialize`** - Handled by the SDK automatically
2. ✅ **Respond to `tools/list`** - Returns all available tools
3. ✅ **Respond to `tools/call`** - Executes tools and returns results
4. ✅ **Use correct JSON-RPC format** - The SDK handles this
5. ✅ **Handle errors properly** - Using `McpError` from the SDK
6. ✅ **Use stdio transport** - Correct for MCP servers

## Common Issues and Solutions

### Issue: "Server not found" in Claude Desktop

**Solution**: 
- Use absolute paths in the config file
- Ensure the path points to `dist/index.js` (not `src/index.ts`)
- Check that `npm run build` completed successfully

### Issue: "API key not found"

**Solution**:
- Set `SCHEMATIC_API_KEY` in the `env` section of Claude Desktop config
- Or use the config file at `~/.schematic-mcp/config.json`

### Issue: "Tool not available"

**Solution**:
- Check that the server started successfully (look for "Schematic MCP server running on stdio" in logs)
- Verify the tool name matches exactly (case-sensitive)
- Check Claude Desktop logs for errors

### Issue: "Invalid tool arguments"

**Solution**:
- Verify the tool's `inputSchema` matches what you're sending
- Check that required fields are provided
- Ensure data types match (string vs number, etc.)

## Testing Checklist

Before deploying, verify:

- [ ] Server builds without errors (`npm run build`)
- [ ] Test script passes (`npm test`)
- [ ] All tools appear in `tools/list` response
- [ ] Tool schemas are valid JSON Schema
- [ ] Server connects to Claude Desktop
- [ ] Tools can be called from Claude Desktop
- [ ] Error handling works (test with invalid inputs)
- [ ] API key authentication works

## Debugging

### Enable Verbose Logging

The server logs to `stderr` (which is correct for MCP). To see logs:

1. **In Claude Desktop**: Check the application logs
2. **Manual testing**: Redirect stderr to see output:
   ```bash
   node dist/index.js 2>&1
   ```

### Test Individual Tools

You can test individual tools by calling them directly:

```typescript
// In test-client.ts, add:
const result = await client.callTool({
  name: "get_company",
  arguments: {
    companyName: "Test Company"
  }
});
console.log(result);
```

## Next Steps

Once testing passes:

1. ✅ Document any tool-specific requirements
2. ✅ Add error handling for edge cases
3. ✅ Consider adding more tools based on feedback
4. ✅ Publish to npm (if making it public)

