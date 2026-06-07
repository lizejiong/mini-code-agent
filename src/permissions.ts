import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export type PermissionController = {
  approveWriteFile(path: string, content: string): Promise<boolean>;
  approveRunCommand(command: string): Promise<boolean>;
};

export function createInteractivePermissions(): PermissionController {
  return {
    approveWriteFile: async (path) =>
      askYesNo(`Allow write_file to modify ${path}? [y/N] `),
    approveRunCommand: async (command) =>
      askYesNo(`Allow run_command to execute "${command}"? [y/N] `),
  };
}

export async function askYesNo(question: string): Promise<boolean> {
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(question);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    readline.close();
  }
}
