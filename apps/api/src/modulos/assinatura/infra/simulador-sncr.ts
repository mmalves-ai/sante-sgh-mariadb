// Simulador da numeração SNCR (M49, etapa 2; regra 10; DP-47.2): só em dev/ci, com a chave `receita.sncr` ligada na
// sessão de teste. Devolve um número de 16 dígitos SINTÉTICO (prefixo 99, nunca de receita real) ou, quando posto
// "fora do ar", o erro técnico (a solicitação fica pendente e é tentada de novo). A API pública da Anvisa entra por
// adaptador próprio quando o credenciamento chegar (risco R5; POL-3).
import { randomInt } from 'node:crypto';
import type { ClienteSncr } from '../aplicacao/documentos.js';

export class SimuladorSncr implements ClienteSncr {
  foraDoAr = false;
  async numerar(): Promise<{ tipo: 'numero'; numero: string } | { tipo: 'erro' }> {
    if (this.foraDoAr) return { tipo: 'erro' };
    let n = '99';
    while (n.length < 16) n += String(randomInt(0, 10));
    return { tipo: 'numero', numero: n };
  }
}
