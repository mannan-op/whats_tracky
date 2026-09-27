import 'dotenv/config';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { handleMessage } from './handleMessage.js';

async function replyTo(userId: string, line: string): Promise<string> {
  return handleMessage(userId, line);
}

async function runStdin(userId: string, banner: string): Promise<void> {
  process.stdout.write(`${banner}\n\n`);
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    const reply = await replyTo(userId, text);
    process.stdout.write(`you> ${text}\n${reply}\n\n`);
  }
}

function runInteractive(userId: string, banner: string): void {
  process.stdout.write(`${banner}\n\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'you> ',
  });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    chain = chain.then(async () => {
      const text = line.trim();
      if (!text) {
        rl.prompt();
        return;
      }
      const reply = await replyTo(userId, text);
      process.stdout.write(`${reply}\n\n`);
      rl.prompt();
    });
  });
  rl.on('close', () => {
    process.stdout.write('\n');
  });
  rl.prompt();
}

export function startCli(): void {
  const config = loadConfig();
  const banner = `Budget bot · ${config.currency} · ${config.tz}\nType a message. Ctrl-D exits.`;
  if (process.stdin.isTTY) runInteractive(config.cliUser, banner);
  else void runStdin(config.cliUser, banner);
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) startCli();
