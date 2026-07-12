# draw-and-guess (你画我猜)

Multiplayer real-time drawing and guessing party game. One player draws, others guess the word.

## Tech Stack
- **Server:** Node.js, Express, Socket.IO
- **Client:** HTML5 Canvas, Vanilla JS
- **Features:** Real-time drawing sync, timer, scoring, multiple rounds

## Getting Started
```bash
npm install
npm start
```
Open `http://localhost:3000` in browser.

## Gameplay
1. Create/join a room (2-8 players)
2. Each round, one player draws a word while others guess
3. Score points for correct guesses (faster = more points)
4. Most points after all rounds wins

## Scripts
- `npm start` — Start server
- `npm run dev` — Start development server
- `make test` — Run tests
- `make lint` — Lint check

## Project Structure
```
├── server.js           # Game server + Socket.IO logic
├── public/
│   └── index.html      # Client (inline CSS + JS)
├── package.json
├── Makefile
└── AGENTS.md
```
