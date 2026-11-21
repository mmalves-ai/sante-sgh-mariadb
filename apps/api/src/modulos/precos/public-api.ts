// Módulo de preços e convênios (M12). Outros módulos falam com este só por aqui. A agenda (M17) e a recepção
// perguntam `convenioAceitaAtendimento` (convênio suspenso não aceita novo atendimento no sistema novo; regra 11).
export { ConveniosController } from './convenios.controller.js';
export { PrecosController } from './precos.controller.js';
export { ImportacoesController } from './importacoes.controller.js';
export { MotorController } from './motor.controller.js';
export {
  FONTE_PRECOS,
  type FontePrecos,
  type CtxPrecos,
  type ContextoGravacaoPreco,
  fontePrecosIndisponivel,
} from './fonte.js';
export { FontePrecosPropria, type NucleoPrecos } from './fonte-propria.js';
export { modulo, moduloPrecos, type OpcoesModuloPrecos } from './modulo.js';
export type * from './tipos.js';
export { FontePrecosMemoria } from './fonte-memoria.js';
export { ServicoPrecos } from './servico.js';
export { SERVICO_PRECOS } from './simbolos.js';

import { convenioAceitaAtendimento as regra } from '@sgh/dominio-preco';
import type { CtxPrecos, FontePrecos } from './fonte.js';

/** public-api `cadastro.convenioAceitaAtendimento` (consumida a partir do M17). */
export async function convenioAceitaAtendimento(fonte: FontePrecos, ctx: CtxPrecos, convenio: number) {
  const c = await fonte.convenio(ctx, convenio);
  return regra(c ? { codigo: c.codigo, situacao: c.situacao } : null);
}
