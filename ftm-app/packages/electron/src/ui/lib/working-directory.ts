import { writable } from 'svelte/store';

export const workingDirectory = writable<string | null>(null);

export function setWorkingDirectory(path: string | null): void {
  workingDirectory.set(path);
}
