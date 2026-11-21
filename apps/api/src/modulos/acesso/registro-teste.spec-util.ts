// Registro de teste do módulo `acesso` com a parte deste lote (comunicação, contas dormentes e conselho) sobre a fonte
// da gestão em memória, para os specs pela HTTP enquanto o integrador não junta a parte em acesso/modulo.ts.
import type { DynamicModule } from '@nestjs/common';
import type { CarregadorModulo, ContextoModulo } from '../registro.js';
import { fonteGestaoMemoria } from './gestao-fonte.js';
import { moduloAcesso } from './modulo.js';

export const REGISTRO_TESTE_ACESSO: Readonly<Record<string, CarregadorModulo>> = {
  acesso: async () => ({
    modulo: (ctx: ContextoModulo): Promise<DynamicModule> => moduloAcesso(ctx, { fonteGestao: fonteGestaoMemoria(ctx.trilha) }),
  }),
};
