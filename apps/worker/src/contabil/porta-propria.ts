// Porta da contabilidade do `worker` sobre o banco do cliente (M54; lote F2.2 05-12), pelo @sgh/nucleo: os
// estabelecimentos do cliente, a liberação do recurso `contabil` (liberacao_chave e recurso_prerequisito do
// estabelecimento), as contagens dos fatos por situação (fato_contabil) e a contabilização automática dos pendentes. Toda leitura filtra o estabelecimento e os
// registros excluídos (fato_contabil); liberacao_chave e recurso_prerequisito não têm exclusão lógica.
// Melhoria: as fontes de fatos são os módulos que publicam fato_contabil na transação do próprio documento; o worker não
// varre mais tabelas de outro sistema por faixa de chave (a leitura incremental de convivência saiu, ADR 0003).
// Melhoria: a liberação é lida do estabelecimento (chave de escopo `hospital`, valor `*`, e pré-requisitos), e a regra é
// a do domínio para quem age sobre o estabelecimento inteiro (`recursoLigadoNoEstabelecimento`): chave de pessoa, grupo
// ou setor não liga nem desliga a contabilização automática (não há usuário de serviço fictício como sujeito).
// Melhoria (F2.4): a leitura do lote (fatos candidatos, plano, de-para, regras publicadas em versao_regra_contabil e
// períodos) e a gravação (situação do fato, lançamento automático com as partidas, pelo Executor com a trilha) são as
// mesmas da API, do pacote comum @sgh/persistencia-contabil, sem cópia. O processo automático grava sem usuário.
import type { SituacaoFato } from '@sgh/contratos';
import { CHAVE_CONTABIL, recursoDesligado } from '@sgh/contratos';
import { recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import type { Executor, Leitor } from '@sgh/nucleo';
import {
  gravarContabilizacao,
  lerDePara,
  lerParaContabilizar,
  lerPeriodos,
  lerPlano,
  lerRegras,
} from '@sgh/persistencia-contabil';
import type { AcaoContabilizacao } from '@sgh/dominio-contabil';
import type { AcessoContabilizacao, GravacaoContabilizacao, LeituraContabilizacao } from './contabilizacao.js';

type ChaveLida = Parameters<typeof recursoLigadoNoEstabelecimento>[0][number];
type PrerequisitoLido = Parameters<typeof recursoLigadoNoEstabelecimento>[2][number];

export interface Estabelecimento {
  readonly id: number;
  readonly codigo: string;
}

export interface LiberacaoContabil {
  readonly chaves: readonly ChaveLida[];
  readonly prerequisitos: readonly PrerequisitoLido[];
}

/** Situações do fato no modelo (snake_case) → vocabulário do domínio. */
export const SITUACAO_DO_FATO: Readonly<Record<string, SituacaoFato>> = {
  pendente: 'pendente',
  contabilizado: 'contabilizado',
  sem_regra: 'semRegra',
  sem_conta: 'semConta',
  substituido: 'substituido',
  ignorado: 'ignorado',
};

export type ContagemFatos = Readonly<Record<SituacaoFato, number>>;

/** O que o worker da contabilidade usa do banco de um cliente. */
export interface PortaContabilWorker extends AcessoContabilizacao {
  estabelecimentos(): Promise<Estabelecimento[]>;
  liberacao(estabelecimento: number): Promise<LiberacaoContabil>;
  fatosPorSituacao(estabelecimento: number): Promise<ContagemFatos>;
}

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoContabilWorker {
  lerSomente<T>(contexto: { readonly cliente: string; readonly correlacao: string }, fn: (l: Leitor) => Promise<T>): Promise<T>;
  criarExecutor(): Pick<Executor, 'executar'>;
}

/** A chave `contabil` do estabelecimento inteiro ligada, com os pré-requisitos declarados cumpridos na hora. */
export function contabilLigadaPor(lib: LiberacaoContabil, agora: Date): boolean {
  const declarados = recursoDesligado(CHAVE_CONTABIL)?.prerequisitos ?? [];
  return recursoLigadoNoEstabelecimento(lib.chaves, declarados, lib.prerequisitos, agora);
}

const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export class PortaContabilWorkerPropria implements PortaContabilWorker {
  constructor(
    private readonly nucleo: NucleoContabilWorker,
    private readonly cliente: string,
  ) {}

  private executorCriado: Pick<Executor, 'executar'> | null = null;

  private lerBanco<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'contabil-worker' }, fn);
  }

  estabelecimentos(): Promise<Estabelecimento[]> {
    return this.lerBanco(async (l) =>
      (
        await l.consultar('SELECT id, codigo FROM estabelecimento WHERE excluido_em IS NULL ORDER BY codigo', [], {
          teto: 1000,
        })
      ).map((x) => ({ id: Number(x['id']), codigo: String(x['codigo']) })),
    );
  }

  liberacao(estabelecimento: number): Promise<LiberacaoContabil> {
    return this.lerBanco(async (l) => {
      const chaves = await l.consultar(
        `SELECT escopo, valor, ligada FROM liberacao_chave
          WHERE estabelecimento_id = ? AND tipo = 'recurso' AND chave = ? AND escopo = 'hospital' AND valor = '*'
            AND ligada IS NOT NULL ORDER BY id`,
        [estabelecimento, CHAVE_CONTABIL],
        { teto: 1000 },
      );
      const pre = await l.consultar(
        `SELECT recurso, tipo, situacao, validade, evidencia, COALESCE(alterado_em, criado_em) AS alterado_em
           FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ? ORDER BY id`,
        [estabelecimento, CHAVE_CONTABIL],
        { teto: 100 },
      );
      return {
        chaves: chaves.map((x) => ({
          escopo: String(x['escopo']) as ChaveLida['escopo'],
          valor: String(x['valor']),
          ligada: x['ligada'] === true || Number(x['ligada']) === 1,
        })),
        prerequisitos: pre.map(
          (x) =>
            ({
              recurso: String(x['recurso']),
              tipo: String(x['tipo']),
              situacao: String(x['situacao']),
              validade: dia(x['validade']),
              evidencia: txt(x['evidencia']),
              alteradoPor: '',
              alteradoEm: x['alterado_em'] instanceof Date ? x['alterado_em'].toISOString() : String(x['alterado_em'] ?? ''),
            }) as unknown as PrerequisitoLido,
        ),
      };
    });
  }

  fatosPorSituacao(estabelecimento: number): Promise<ContagemFatos> {
    return this.lerBanco(async (l) => {
      const r: Record<SituacaoFato, number> = {
        pendente: 0,
        contabilizado: 0,
        semRegra: 0,
        semConta: 0,
        substituido: 0,
        ignorado: 0,
      };
      const linhas = await l.consultar(
        `SELECT situacao, COUNT(*) AS n FROM fato_contabil
          WHERE estabelecimento_id = ? AND excluido_em IS NULL GROUP BY situacao`,
        [estabelecimento],
        { teto: 20 },
      );
      for (const x of linhas) {
        const s = SITUACAO_DO_FATO[String(x['situacao'])];
        if (s) r[s] += Number(x['n']);
      }
      return r;
    });
  }

  /** Um lote de candidatos com o plano, o de-para, as regras publicadas e os períodos, numa leitura só. */
  ler(
    estabelecimento: number,
    situacoes: readonly SituacaoFato[],
    competencia: string | null,
    lote: number,
  ): Promise<LeituraContabilizacao> {
    return this.lerBanco(async (l) => {
      const lido = await lerParaContabilizar(l, estabelecimento, situacoes, competencia, lote);
      const [plano, dePara, publicadas, periodos] = [
        await lerPlano(l, estabelecimento),
        await lerDePara(l, estabelecimento),
        await lerRegras(l, estabelecimento, {}),
        await lerPeriodos(l, estabelecimento),
      ];
      return {
        candidatos: lido.candidatos,
        registrados: lido.registrados,
        lancamentos: lido.lancamentos,
        restam: lido.restam,
        plano: plano.map((c) => ({
          empresa: c.empresa,
          codigo: c.codigo,
          nome: c.nome,
          grupo: c.grupo,
          tipo: c.tipo,
          natureza: c.natureza,
          referencialTipo: c.referencialTipo,
          referencialConta: c.referencialConta,
          contaExportacao: c.contaExportacao,
          exigeCentroCusto: c.exigeCentroCusto,
          ativa: c.ativa,
        })),
        dePara,
        publicadas: publicadas.map((p) => ({ id: p.id, regra: p.regra })),
        periodos: periodos.map((p) => ({ empresa: p.empresa, competencia: p.competencia, situacao: p.situacao })),
      };
    });
  }

  /** O lote numa transação do Executor, com a trilha das contagens (processo automático, sem usuário). */
  gravar(
    estabelecimento: number,
    _competencia: string | null,
    acoes: readonly AcaoContabilizacao[],
    diferenca: string,
  ): Promise<GravacaoContabilizacao> {
    this.executorCriado ??= this.nucleo.criarExecutor();
    return gravarContabilizacao(
      this.executorCriado,
      { cliente: this.cliente, estabelecimento, usuario: null, correlacao: 'contabil-worker' },
      acoes,
      diferenca,
    );
  }
}
