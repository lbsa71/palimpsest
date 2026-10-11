import type { Actor } from './screen.ts';

// Deliberately scripted conformance actor. Never label this as model competence.
export const referenceActor: Actor = async ({ id, task }, tool) => {
  const read = (path: string) => tool('read', { path });
  const write = (path: string, value: string) => tool('write', { path, value });
  let answer = '';
  switch (id) {
    case 'S01': answer = String(JSON.parse(await read('manifest')).entry); await read(answer); break;
    case 'S02': await tool('check'); await write('program', 'sum'); await tool('check'); answer = 'verified'; break;
    case 'S03': await write('program', 'range-sum'); await tool('check'); answer = 'verified'; break;
    case 'S04': await read('old-data'); { const paths: string[] = JSON.parse(await tool('list')); answer = await read(paths[0]!); } break;
    case 'S05': { const a = await read('sourceA'); await read('sourceB'); answer = `${a.split('=')[1]} sourceA sourceB`; } break;
    case 'S06': await read('old'); { const value = await read('correction'); answer = `${value.match(/value=(\d+)/)?.[1]} correction provisional`; } break;
    case 'S07': { const original = await read('state'); await write('state', 'temporary'); await read('state'); await write('state', original); answer = 'restored'; } break;
    case 'S08': await tool('checkpoint', { correction: task.match(/correction="([^"]+)"/)![1]! }); await tool('restart'); answer = await read('checkpoint'); break;
    case 'S09': await tool('compact', { constraint: task.match(/constraint="([^"]+)"/)![1]! }); answer = await read('summary'); break;
    case 'S10': await tool('delegate', { value: task.match(/doubling (\d+)/)![1]!, scope: 'child' }); answer = await read('child'); break;
    case 'S11': await tool('effect', { key: 'delivery' }); answer = await tool('reconcile'); break;
    case 'S12': await write('persona', 'owned instructions'); for (const path of ['plain', 'resumed', 'delegated']) await tool('request', { path }); answer = 'replaced'; break;
    default: throw new Error('Unknown screen case');
  }
  await write('answer', answer);
};
