# OpenCode Command: tokeneye

Launch the TokenEye model usage analytics dashboard.

## Usage

```
/tokeneye [start|status|dashboard]
```

- `/tokeneye start` — Start proxy + dashboard servers
- `/tokeneye status` — Check proxy health and metrics count
- `/tokeneye dashboard` — Open dashboard in browser (starts server if needed)

## Setup

1. Install tokeneye: `cd /path/to/tokeneye && bun link`
2. Add your OpenCode Zen API keys: `tokeneye keys add pro sk-xxx`
3. Point OpenCode at the proxy in `~/.config/opencode/opencode.json`:
   ```json
   {
     "provider": {
       "opencode-go": {
         "options": {
           "baseURL": "http://127.0.0.1:8787/zen/go/v1",
           "apiKey": "managed-by-tokeneye"
         }
       }
     }
   }
   ```
4. Run: `/tokeneye start`

The dashboard will be available at http://localhost:8788
