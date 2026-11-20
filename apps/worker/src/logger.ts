import { redigir, redigirArgumentoLog } from '@sgh/contratos';
import { pino } from 'pino';

// Mesma redação de dado pessoal da API (M09, regra 12; packages/contratos/src/redacao.ts).
export const logger = pino({
  level: process.env['LOG_NIVEL'] ?? 'info',
  base: { app: 'worker' },
  redact: { paths: ['*.senha', '*.SENHA', '*.segredo'], censor: '[oculto]' },
  formatters: { log: (objeto) => redigir(objeto) },
  hooks: {
    logMethod(args, metodo) {
      metodo.apply(this, args.map(redigirArgumentoLog) as Parameters<typeof metodo>);
    },
  },
});
