<div align="center">

# Shakaal

<img src="public/shakaal2.png" alt="Shakaal" width="100%">

</div>

---

Shakaal was born from a simple question: *can I access my CLI-based coding agents on the go, without keeping my laptop on?*

Plenty of tools exist that give you a custom UI for AI agents — but that wasn't the goal. The goal was the exact same CLI environment, the same workflow, the same muscle memory. No new interface to learn. No frills.

The core is dead simple: expose your terminal on the web and run your favourite CLI AI agent exactly the way you already do — just from anywhere. Built for developers who live in the terminal and don't want to leave it.

## Setup

**1. Clone and install**

```bash
git clone https://github.com/apuravchauhan/shakaal.git
cd shakaal
npm install
```

**2. Create your `.env`**

```bash
cp .env.example .env
```

Open `.env` and set your access key:

```env
PORTAL_KEY=your-secret-key-here
```

This key is required on every request — it keeps your terminal private.

Optionally override the port or shell:

```env
PORT=3001
LAUNCH_CMD=/bin/zsh
```

**3. Start**

```bash
npm start
```

Open `http://localhost:3001` (or your tunnel URL) in a browser, enter your `PORTAL_KEY`, and you're in.

---

## Troubleshooting

**`npm install` fails with node-pty build errors**

`node-pty` is a native addon and needs C++ build tools present on the machine.

- **macOS** — install Xcode Command Line Tools: `xcode-select --install`
- **Ubuntu/Debian** — `sudo apt install build-essential python3`
- **Windows** — install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload, then re-run `npm install`

**Port already in use**

Set a different port in `.env`: `PORT=3002`

**Shell not found / wrong shell**

Override the default shell in `.env`: `LAUNCH_CMD=/bin/bash`

If you're still stuck — just ask your AI agent to fix it.
