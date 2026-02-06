#!/bin/bash

# Simple MCP protocol test script
# This sends MCP protocol messages via stdin and reads responses from stdout

echo "Testing MCP Server..."
echo "===================="
echo ""

# Test 1: Initialize connection
echo "Test 1: Initialize connection"
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}' | node dist/index.js &
SERVER_PID=$!
sleep 1

# Test 2: List tools
echo ""
echo "Test 2: List tools"
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}' | node dist/index.js &
sleep 1

# Cleanup
kill $SERVER_PID 2>/dev/null

echo ""
echo "Note: For proper testing, use the test-client.ts script or connect to Claude Desktop"

