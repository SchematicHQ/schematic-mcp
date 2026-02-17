# Contributing to Schematic MCP

Thanks for your interest in contributing! We welcome bug reports, feature requests, and pull requests.

## Getting Started

1. Fork the repository
2. Clone your fork and install dependencies:
   ```bash
   git clone https://github.com/<your-username>/schematic-mcp.git
   cd schematic-mcp
   yarn install
   ```
3. Create a branch for your changes:
   ```bash
   git checkout -b my-feature
   ```

## Development

Build the project:

```bash
yarn build
```

You can test locally using the included test client:

```bash
node test-client.js
```

## Submitting a Pull Request

1. Make sure `yarn build` passes with no errors
2. Keep your changes focused — one feature or fix per PR
3. Write a clear description of what your PR does and why
4. Push your branch and open a PR against `main`

## Reporting Issues

Open an issue on GitHub with a clear description of the problem, including steps to reproduce if applicable.

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
