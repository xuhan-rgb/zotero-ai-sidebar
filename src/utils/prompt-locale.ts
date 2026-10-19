import { getUiLocale } from './ui-locale';

/** Select built-in model instructions without translating user or source content. */
export function promptText(chinese: string, english: string): string {
  return getUiLocale() === 'zh-CN' ? chinese : english;
}
