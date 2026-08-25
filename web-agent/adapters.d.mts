export interface ProviderDefinition {
  name: string;
  url: string;
  host: string;
  composer: string[];
  send: string[];
  stop: string[];
  responseRoots?: string[];
  answers: string[];
  completion?: string[];
  copy?: string[];
  reasoning?: string[];
  latexUploadExtension?: string;
}

export function providerDefinition(
  provider: string,
  customProvider?: unknown,
): ProviderDefinition;
export function customProviderDefinition(value: unknown): ProviderDefinition;
export function selectorList(selectors: string[]): string;
export function firstResponseLocator(
  page: unknown,
  adapter: ProviderDefinition,
): Promise<unknown>;
