# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities by emailing the maintainers directly or by using [GitHub's private vulnerability reporting](https://github.com/alegerber/stockfish-lc0-mcp/security/advisories/new).

When reporting, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fix (if applicable)

## Response Timeline

- **Acknowledgement**: We will acknowledge receipt of your report within 72 hours.
- **Assessment**: We aim to assess and validate the vulnerability within 7 days.
- **Fix**: Critical vulnerabilities will be prioritized and patched as soon as possible.

## Security Considerations

### Engine Process Execution

This server spawns Stockfish and optionally Lc0 as child processes. The binary paths are controlled via environment variables (`STOCKFISH_PATH`, `LC0_PATH`). Ensure these point to trusted binaries.

### Input Validation

All tool inputs (FEN strings, PGN, move lists) are validated using Zod schemas before being passed to the chess engines. However, as with any server that accepts external input, keep the server up to date and review configurations regularly.

### Docker Deployment

When running via Docker, the server operates in an isolated container. This is the recommended deployment method for production use. Avoid mounting unnecessary host directories into the container.

### Environment Variables

Environment variables are used for configuration only (engine paths, thread counts, hash sizes). No secrets or credentials are required. Avoid exposing the container's environment to untrusted users.
