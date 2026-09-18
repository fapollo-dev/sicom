import { z } from 'zod';

/** booleano vindo de query string: 'true'/'1'/'S'/'sim' → true; 'false'/'0'/'N'/'nao' → false (o `z.coerce.boolean()` faria 'false' virar true). */
export const boolQuery = (def: boolean) => z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 's', 'sim', 'yes'].includes(s)) return true;
  if (['false', '0', 'n', 'nao', 'não', 'no'].includes(s)) return false;
  return v;
}, z.boolean());
