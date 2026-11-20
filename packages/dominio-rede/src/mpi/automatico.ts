// Destino de um par de cadastros (M57, regras 2, 3 e 5; cap-07 §7.7.3; ref 01 §2.2):
//   - mesmo estabelecimento: NÃO é do MPI da Rede; vai para a fila de duplicidades do cadastro (regra 5);
//   - cadastro inativo ou absorvido por unificação: inelegível (o sobrevivente representa a pessoa);
//   - par já decidido "outra pessoa" por alguém: nunca volta pelo automático (a decisão humana prevalece);
//   - par reaberto por uma pessoa (vínculo desfeito e devolvido à fila): fica na fila até uma pessoa decidir;
//   - vínculo automático só com CPF ou CNS iguais e nenhum dado divergente (nascimento e sexo iguais quando os dois
//     existem, nome com pelo menos as pontas foneticamente iguais, nenhum CPF válido diferente) — regra 2;
//   - senão, a fila de revisão humana a partir de LIMIAR_FILA_REDE; abaixo, o par é descartado sem gravar.
// O CPF placeholder ('00000000000') nunca pareia: já vira ausente em comparavel() (cadastro.ts).
import {
  type CriterioPareamentoRede,
  type DivergenciaPareamentoRede,
  LIMIAR_FILA_REDE,
  type SituacaoParAnteriorRede,
} from '@sgh/contratos';
import type { CadastroComparavelRede } from './cadastro.js';
import { pontuarPar } from './pontuacao.js';

export type DestinoPar =
  'vincular_automatico' | 'fila' | 'descartar' | 'fila_duplicidade_local' | 'inelegivel' | 'ja_decidido';

export interface DecisaoPar {
  readonly destino: DestinoPar;
  readonly pontuacao: number;
  readonly criterios: readonly CriterioPareamentoRede[];
  readonly divergencias: readonly DivergenciaPareamentoRede[];
  /** Por que o par não foi vinculado automaticamente (texto técnico para o registro, sem dado pessoal). */
  readonly motivo: string;
}

const VAZIO = { pontuacao: 0, criterios: [], divergencias: [] } as const;

/** Os dados que precisam bater para o vínculo automático (além de CPF ou CNS iguais). */
export function coerenteParaAutomatico(
  criterios: readonly CriterioPareamentoRede[],
  divergencias: readonly DivergenciaPareamentoRede[],
): boolean {
  if (divergencias.length > 0) return false;
  const temDocumento = criterios.includes('cpf') || criterios.includes('cns');
  const temNome = criterios.includes('nome') || criterios.includes('nome_fonetico');
  return temDocumento && temNome && criterios.includes('nascimento');
}

/**
 * Decide o destino do par. `situacaoAnterior` é a do candidato já gravado no índice (null quando o par é novo): par
 * vinculado ou descartado por uma pessoa não é refeito; par aberto continua na fila ou sobe a automático; par
 * reaberto por uma pessoa (desfez o vínculo e o devolveu à fila) fica na fila, qualquer que seja a pontuação.
 */
export function decidirPar(
  a: CadastroComparavelRede,
  b: CadastroComparavelRede,
  situacaoAnterior: SituacaoParAnteriorRede | null = null,
): DecisaoPar {
  if (a.estabelecimento === b.estabelecimento)
    return { destino: 'fila_duplicidade_local', ...VAZIO, motivo: 'mesmo estabelecimento' };
  if (!a.elegivel || !b.elegivel)
    return { destino: 'inelegivel', ...VAZIO, motivo: 'cadastro inativo ou unificado' };
  const p = pontuarPar(a, b);
  if (situacaoAnterior === 'outra_pessoa' || situacaoAnterior === 'vinculado')
    return { destino: 'ja_decidido', ...p, motivo: `par já ${situacaoAnterior}` };
  if (situacaoAnterior === 'reaberto')
    return { destino: 'fila', ...p, motivo: 'par reaberto por uma pessoa: só uma pessoa decide' };
  if (coerenteParaAutomatico(p.criterios, p.divergencias))
    return { destino: 'vincular_automatico', ...p, motivo: 'documento igual e dados coerentes' };
  if (p.pontuacao >= LIMIAR_FILA_REDE || p.criterios.includes('cpf') || p.criterios.includes('cns'))
    return {
      destino: 'fila',
      ...p,
      motivo:
        p.divergencias.length > 0
          ? `divergência: ${p.divergencias.join(', ')}`
          : 'pontuação sem documento igual',
    };
  return { destino: 'descartar', ...p, motivo: 'pontuação abaixo do limiar' };
}
