import type { ValidationResult } from '../../lib/utils/validation';
import type { ScenarioKey } from '../../types/scenario';

export interface FieldMessages {
  error: (field: ScenarioKey) => string | undefined;
  warning: (field: ScenarioKey) => string | undefined;
}

export function fieldMessages(v: ValidationResult): FieldMessages {
  const find = (level: 'error' | 'warning') => (field: ScenarioKey) =>
    v.issues.find((i) => i.field === field && i.level === level)?.message;
  return { error: find('error'), warning: find('warning') };
}
