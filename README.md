# Niimbot Web Client

A Niimbot client for web browsers written in TypeScript.

## Installation

```bash
yarn add niimbot
# or
npm install niimbot
```

## Usage

Import:

```typescript
import { Niimbot } from 'niimbot';
```

Check if Niimbot is available at the current browser:

```typescript
const isAvailable = Niimbot.available();
```

Create a Niimbot instance:

```typescript
const niimbot = new Niimbot();
```

Add events listeners:

```typescript
niimbot.addEventListener('connect', handleConnect);
niimbot.addEventListener('disconnect', handleDisconnect);
niimbot.addEventListener('printStart', handlePrintStart);
niimbot.addEventListener('printEnd', handlePrintEnd);
```

Connect to the printer:

```typescript
const port = await niimbot.requestPort();
if (port) {
  await niimbot.connect(port);
}
```

Print a sticker drawed on a canvas:

```typescript
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (ctx) {
  await niimbot.printImage(ctx, canvas.width, canvas.height);
}
```

Check `src/demo.tsx` for a complete example.

## Development

```bash
yarn install
yarn dev
```

## Contacts

Jaroslav Khorishchenko

- [jaro@husky-dev.me](mailto:jaro@husky-dev.me)
