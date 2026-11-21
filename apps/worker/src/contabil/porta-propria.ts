// Porta da contabilidade do `worker` sobre o banco do cliente (M54; lote F2.2 05-12), pelo @sgh/nucleo, somente
// leitura: os estabelecimentos do cliente, a liberação do recurso `contabil` (liberacao_chave e recurso_prerequisito do
// estabelecimento) e as contagens dos fatos por situação (fato_contabil). Toda leitura filtra o estabelecimento e os
// registros excluídos (fato_contabil); liberacao_chave e recurso_prerequisito não têm exclusão lógica.
// Melhoria: as fontes de fatos são os módulos que publicam fato_contabil na transação do próprio documento; o worker não
// varre mais tabelas de outro sistema por faixa de chave (a leitura incremental de convivência saiu, ADR 0003).
// Melhoria: a liberação é lida do estabelecimento (chave de escopo `hospital`, valor `*`, e pré-requisitos), e a regra é
// a do domínio para quem age sobre o estabelecimento inteiro (`recursoLigadoNoEstabelecimento`): chave de pessoa, grupo
// ou setor não liga nem desliga a contabilização automática (não há usuário de serviço fictício como sujeito).
// Melhoria: operação sem modelo responde a recusa `modelo-pendente` com o nome da operação, nunca lista vazia: com zero
// regras a contabilização marcaria todo fato como "sem regra" (o mesmo critério da porta da API, lote 04-01).
// Pendências registradas (saida/05-12.json): (1) as versões publicadas das regras de contabilização não têm tabela no
// modelo (pedido do lote 04-01): `ler` da contabilização recusa; (2) a gravação do lote (lançamento automático com as
// partidas e a situação do fato, com trilha) é a da porta da API (`apps/api/src/modulos/contabil/porta-propria.ts`,
// marcarSituacao e gravarLancamento); o pedido é movê-la a um pacote comum para o worker usar a mesma, sem cópia: até
// lá, `gravar` recusa. Com as duas recusas, a contabilização automática no worker fica indisponível.
import type { SituacaoFato } from '@sgh/contratos';
import { CHAVE_CONTABIL, recursoDesligado } from '@sgh/contratos';
import { recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
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
}

/** Recusa de operação sem tabela no modelo (o DDL está pedido). */
export const modeloPendente = (operacao: string): ErroOperacao =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Operação indisponível',
    `${operacao} aguarda a atualização do banco do cliente (pedido de modelo registrado).`,
  );

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

  /** Indisponível: as versões publicadas das regras de contabilização não têm tabela no modelo (pedido 04-01). */
  ler(): Promise<LeituraContabilizacao> {
    return Promise.reject(modeloPendente('A contabilização automática dos fatos (regras publicadas)'));
  }

  /** Indisponível: a gravação do lote é a da porta da API, a mover para um pacote comum (pedido 05-12). */
  gravar(): Promise<GravacaoContabilizacao> {
    return Promise.reject(modeloPendente('A gravação do lote da contabilização automática'));
  }
}
