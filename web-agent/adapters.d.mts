export interface ProviderDefinition {
  name: string;
  url: string;
  host: string;
  composer: string[];
  send: string[];
  stop: string[];
  answers: string[];
  reasoning?: string[];
}

export function providerDefinition(
  provider: string,
  customProvider?: unknown,
): ProviderDefinition;
export function customProviderDefinition(value: unknown): ProviderDefinition;
export function selectorList(selectors: string[]): string;
