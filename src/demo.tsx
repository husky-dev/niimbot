/* eslint-disable @typescript-eslint/consistent-type-assertions */
import React, { FC, MouseEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Niimbot, NiimbotInfoCode } from './index';

const niimbot = new Niimbot();

const log = {
  // eslint-disable-next-line no-console
  info: console.log,
  // eslint-disable-next-line no-console
  err: console.error,
};

const App: FC = () => {
  useEffect(() => {
    niimbot.addEventListener('connect', handleConnect);
    niimbot.addEventListener('disconnect', handleDisconnect);
    niimbot.addEventListener('printStart', handlePrintStart);
    niimbot.addEventListener('printEnd', handlePrintEnd);
    checkAutoconnect();
    draw();
    return () => {
      niimbot.removeEventListener('connect', handleConnect);
      niimbot.removeEventListener('disconnect', handleDisconnect);
      niimbot.removeEventListener('printStart', handlePrintStart);
      niimbot.removeEventListener('printEnd', handlePrintEnd);
    };
  }, []);

  const [connected, setConnected] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('Waiting for the device...');

  const checkAutoconnect = async () => {
    if (!Niimbot.available()) {
      return;
    }
    try {
      const ports = await Niimbot.getPorts();
      if (!ports.length) return;
      const port = ports[0];
      niimbot.connect(port);
    } catch (err: unknown) {
      log.err('getPorts error', err);
    }
  };

  const draw = () => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 400; // 50mm * 8px/mm
    canvas.height = 240; // 30mm * 8px/mm

    // Fill the background with white
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const xOffset = 10;
    const yOffset = 16;
    const lineOffset = 10;
    const fontSize = 28;

    // Draw the text
    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillText('Hello world!', xOffset, yOffset + fontSize);
    ctx.fillText('My name is Niimbot', xOffset, yOffset + fontSize * 2 + lineOffset);
    ctx.fillText('And I like to print', xOffset, yOffset + fontSize * 3 + lineOffset * 2);
  };

  const handleConnect = async () => {
    log.info('connected');
    setConnected(true);
  };

  const handleDisconnect = () => {
    log.info('disconnected');
    setConnected(false);
  };

  const handlePrintStart = () => {
    setStatus('Printing...');
  };

  const handlePrintEnd = () => {
    setStatus('Done');
  };

  const handleConnectClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      const port = await niimbot.requestPort();
      if (!port) return;
      await niimbot.connect(port);
      niimbot.getInfo(NiimbotInfoCode.DENSITY);
    } catch (err: unknown) {
      log.err('connect error', err);
    }
  };

  const handlePrintClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await niimbot.printImage(ctx, canvas.width, canvas.height);
    } catch (err: unknown) {
      log.err('print error', err);
    }
  };

  return (
    <div className="w-full px-4 py-16 flex flex-col items-center">
      <div className="flex flex-col items-center space-y-4">
        <h1 className="text-2xl font-semibold">Niimbot Web Client</h1>
        <div style={{ width: 200, height: 120 }} className="relative overflow-hidden">
          <canvas id="canvas" className="rounded-lg scale-50" style={{ position: 'absolute', left: -100, top: -60 }} />
        </div>
        {!!status && <div className="text-base font-semibold">{status}</div>}
        {!connected ? (
          <button onClick={handleConnectClick} className="btn btn-primary">
            Connect
          </button>
        ) : (
          <button onClick={handlePrintClick} className="btn btn-primary">
            Print
          </button>
        )}
      </div>
    </div>
  );
};

const appContainer = document.getElementById('app');
if (appContainer) {
  createRoot(appContainer).render(<App />);
}
