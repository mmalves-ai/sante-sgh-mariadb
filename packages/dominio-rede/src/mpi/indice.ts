// O índice da Rede como plano de escritas (M57, regras 1 e 4; ficha, seção 6, "Onde mora o índice"): as tabelas SGH_REDE_*
// existem em CADA banco dos estabelecimentos da rede; cada banco guarda os vínculos dos seus próprios cadastros e as
// pessoas da Rede a que eles apontam, com o mesmo identificador de pessoa em todos. Vincular, desfazer e decidir "outra
// pessoa" viram um plano com as escritas de cada banco SEPARADAS: quem executa (a API, pelo repositório do grupo `rede`)
// abre uma transação por banco, na ordem do plano, e nenhuma transação cruza os bancos. Toda escrita é idempotente
// (gravar o estado, nunca somar), com a mesma chave em todos os bancos: repetir o plano depois de uma queda não muda o
// que já foi gravado, e o relatório diário (divergencia.ts) acha e repara o banco que ficou para trás.
import {
  type OrigemVinculoRede,
  type SituacaoCandidatoRede,
  type SituacaoVinculoRede,
  TABELAS_INDICE_REDE,
  type TabelaIndiceRede,
} from '@sgh/contratos';

/** Uma linha de SGH_REDE_VINCULO, no banco do lado local. */
export interface VinculoIndice {
  /** Banco onde a linha mora (o estabelecimento do cadastro local). */
  readonly estabelecimento: string;
  readonly chave: string;
  readonly pessoa: string;
  readonly idLocal: number;
  readonly prontuarioLocal: number;
  readonly estabelecimentoRemoto: string;
  readonly idRemoto: number;
  readonly prontuarioRemoto: number;
  readonly origem: OrigemVinculoRede;
  readonly situacao: SituacaoVinculoRede;
  readonly criadoPor: string;
  /** ISO 8601 (UTC). */
  readonly criadoEm: string;
  readonly desfeitoPor: string | null;
  readonly desfeitoEm: string | null;
  readonly justificativa: string | null;
}

export type EscritaIndice =
  | {
      readonly tabela: 'SGH_REDE_PESSOA';
      readonly acao: 'inserir_se_ausente';
      readonly pessoa: string;
      readonly em: string;
    }
  | {
      /** Grava a linha no estado dado (insere ou atualiza pela chave): idempotente. */
      readonly tabela: 'SGH_REDE_VINCULO';
      readonly acao: 'gravar';
      readonly linha: VinculoIndice;
    }
  | {
      readonly tabela: 'SGH_REDE_CANDIDATO';
      readonly acao: 'mudar_situacao';
      readonly chave: string;
      readonly situacao: SituacaoCandidatoRede;
      /** Quem decidiu o par: o pareamento automático ou uma pessoa (ausente: uma pessoa, ou nulo ao reabrir). */
      readonly origem?: OrigemVinculoRede;
      readonly por: string;
      readonly em: string;
      readonly justificativa: string | null;
    };

export interface PlanoBanco {
  readonly estabelecimento: string;
  readonly escritas: readonly EscritaIndice[];
}

export interface PlanoIndice {
  readonly operacao: 'vincular' | 'desfazer' | 'outra_pessoa' | 'reparo';
  readonly chave: string;
  readonly pessoa: string | null;
  /** Um item por banco, em ordem de estabelecimento: cada um numa transação própria. */
  readonly bancos: readonly PlanoBanco[];
}

export class ErroIndiceRede extends Error {
  override readonly name = 'ErroIndiceRede';
}

/**
 * Regra 1: o plano só escreve nas tabelas do índice. Quem executa chama antes de abrir a transação; uma escrita em
 * cadastro de paciente (ou em qualquer tabela que não seja SGH_REDE_*) recusa o plano inteiro.
 */
export function garantirSomenteIndice(plano: PlanoIndice): void {
  const permitidas = new Set<string>(TABELAS_INDICE_REDE);
  for (const b of plano.bancos)
    for (const e of b.escritas)
      if (!permitidas.has((e as { tabela: string }).tabela))
        throw new ErroIndiceRede(
          `O MPI da Rede só grava no índice (${TABELAS_INDICE_REDE.join(', ')}); recusado: ${(e as { tabela: string }).tabela}.`,
        );
}

/** As tabelas que um plano toca (para a trilha e para o teste de assinatura "somente leitura" do legado). */
export function tabelasDoPlano(plano: PlanoIndice): TabelaIndiceRede[] {
  const s = new Set<TabelaIndiceRede>();
  for (const b of plano.bancos) for (const e of b.escritas) s.add(e.tabela);
  return [...s].sort();
}

/** A linha do mesmo vínculo vista do outro banco (local e remoto trocados). */
export function espelho(l: VinculoIndice): VinculoIndice {
  return {
    ...l,
    estabelecimento: l.estabelecimentoRemoto,
    idLocal: l.idRemoto,
    prontuarioLocal: l.prontuarioRemoto,
    estabelecimentoRemoto: l.estabelecimento,
    idRemoto: l.idLocal,
    prontuarioRemoto: l.prontuarioLocal,
  };
}

/** Instante da última mudança da linha (a mais recente prevalece no reparo). */
export function ultimaMudanca(l: VinculoIndice): string {
  return l.desfeitoEm && l.desfeitoEm > l.criadoEm ? l.desfeitoEm : l.criadoEm;
}
