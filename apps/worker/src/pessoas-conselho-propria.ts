// Porta própria do retrato diário da validade do conselho (M52.1; lote F2.2 05-16) sobre o banco do cliente, pelo
// @sgh/nucleo. Leitura: inscricao_conselho, colaborador e validade_conselho (somente leitura); o parâmetro
// `pessoas.alertaConselhoDias` no nível do cliente. Gravação: o retrato do dia pelo Executor (trilha na mesma transação).
// Dado do cliente inteiro (sem estabelecimento_id): colaborador, inscricao_conselho e validade_conselho são do cliente; o
// retrato também. A operação roda no contexto do estabelecimento sede (o primeiro cadastrado), que o Executor exige.
// Pendência registrada: a tabela do retrato (`retrato_validade_conselho`) não existe no modelo; o DDL está pedido no
// saida/05-16.json. Sem ela, gravarRetrato devolve false (o serviço loga "calculado sem gravar"), nunca finge gravar.
// Melhoria: a validade vale pela inscrição (chave estrangeira) e segue a regra única de validade-conselho.ts (último
// evento por ocorrido em e id; exclusão derruba a conferência; registro suspenso ou cancelado não conta); o SQL só lê
// as linhas, a decisão é da regra (a mesma que a API deve usar: pedido no saida/05-16.json).
import { randomUUID } from 'node:crypto';
import { definirOperacao, type Executor, type Leitor, recusa, type ResultadoOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { idDaSede, valorDoParametro } from './clientes-worker.js';
import {
  type ConferenciaConselho,
  type OperacaoConferencia,
  type SituacaoRegistroConselho,
  validadeVigente,
} from './validade-conselho.js';

export interface RegistroConselho {
  readonly registro: number;
  readonly profissional: number;
  readonly ativo: boolean | null;
  /** AAAA-MM-DD; null: sem validade conferida. */
  readonly validade: string | null;
}

export interface RetratoConselho {
  readonly cliente: string;
  readonly dia: string;
  readonly janelaDias: number;
  readonly registros: number;
  readonly vencidos: number;
  readonly aVencer: number;
  readonly semValidade: number;
}

export interface PortaConselho {
  registrosAtivos(): Promise<RegistroConselho[]>;
  janelaDias(agora: Date): Promise<number | null>;
  /** true: gravado (ou refeito no dia); false: tabela do retrato ausente. */
  gravarRetrato(r: RetratoConselho): Promise<boolean>;
}

export interface NucleoConselhoProprio {
  lerSomente<T>(contexto: { readonly cliente: string; readonly correlacao: string }, fn: (l: Leitor) => Promise<T>): Promise<T>;
  criarExecutor(): Executor;
}

export const TABELA_RETRATO_CONSELHO = 'retrato_validade_conselho';

const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Instante ISO comparável (a ordem das conferências). */
const instante = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

/** A falha é a da tabela ausente (o DDL do retrato ainda não aplicado)? */
export function tabelaAusente(e: unknown): boolean {
  const partes: string[] = [];
  let x: unknown = e;
  for (let i = 0; i < 4 && x; i++) {
    const o = x as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
    partes.push(String(o.code ?? ''), String(o.errno ?? ''), String(o.message ?? ''));
    x = o.cause;
  }
  return /ER_NO_SUCH_TABLE|\b1146\b|doesn't exist/i.test(partes.join(' '));
}

const ENTRADA = z.object({
  estabelecimento: z.number().int().positive(),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  janelaDias: z.number().int().positive().max(3650),
  registros: z.number().int().nonnegative(),
  vencidos: z.number().int().nonnegative(),
  aVencer: z.number().int().nonnegative(),
  semValidade: z.number().int().nonnegative(),
});

export class PortaConselhoPropria implements PortaConselho {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoConselhoProprio,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pessoas-conselho' }, fn);
  }

  async registrosAtivos(): Promise<RegistroConselho[]> {
    // Dado do cliente inteiro (colaborador, inscrição e conferência não têm estabelecimento).
    const { inscricoes, conferencias } = await this.ler(async (l) => ({
      inscricoes: await l.consultar(
        `SELECT ic.id, ic.profissional_id, ic.situacao, ic.validade
           FROM inscricao_conselho ic
           JOIN colaborador c ON c.profissional_id = ic.profissional_id AND c.ativo AND c.excluido_em IS NULL
          WHERE ic.excluido_em IS NULL
          ORDER BY ic.id`,
        [],
        { teto: 200_000 },
      ),
      conferencias: await l.consultar(
        `SELECT vc.id, vc.inscricao_conselho_id, vc.ocorrido_em, vc.operacao, vc.data_validade, vc.situacao_registro
           FROM validade_conselho vc
           JOIN inscricao_conselho ic ON ic.id = vc.inscricao_conselho_id AND ic.excluido_em IS NULL
           JOIN colaborador c ON c.profissional_id = ic.profissional_id AND c.ativo AND c.excluido_em IS NULL`,
        [],
        { teto: 1_000_000 },
      ),
    }));
    const porInscricao = new Map<number, ConferenciaConselho[]>();
    for (const v of conferencias) {
      const chave = Number(v['inscricao_conselho_id']);
      const lista = porInscricao.get(chave) ?? [];
      lista.push({
        id: Number(v['id']),
        ocorridoEm: instante(v['ocorrido_em']),
        operacao: String(v['operacao']) as OperacaoConferencia,
        dataValidade: dia(v['data_validade']),
        situacaoRegistro: String(v['situacao_registro']) as SituacaoRegistroConselho,
      });
      porInscricao.set(chave, lista);
    }
    return inscricoes.map((x) => {
      const registro = Number(x['id']);
      const vigente = validadeVigente(
        { ativa: ['ativa', 'provisoria'].includes(String(x['situacao'])), validade: dia(x['validade']) },
        porInscricao.get(registro) ?? [],
      );
      return { registro, profissional: Number(x['profissional_id']), ativo: vigente.ativo, validade: vigente.validade };
    });
  }

  async janelaDias(agora: Date): Promise<number | null> {
    const v = await this.ler((l) =>
      valorDoParametro(l, 'pessoas.alertaConselhoDias', { cliente: this.cliente, estabelecimento: null }, agora),
    );
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  async gravarRetrato(r: RetratoConselho): Promise<boolean> {
    // Sem a tabela do retrato (DDL pedido), não grava e diz que não gravou.
    const existe = await this.ler((l) =>
      l.uma('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [
        TABELA_RETRATO_CONSELHO,
      ]),
    );
    if (!existe || Number(existe['n']) === 0) return false;
    const sede = await this.ler(idDaSede);
    if (sede === null) throw recusa('cliente-sem-estabelecimento', 'O cliente não tem estabelecimento cadastrado.');
    const op = definirOperacao<z.infer<typeof ENTRADA>, ResultadoOperacao>({
      nome: 'pessoas.registrar_retrato_conselho',
      tabelas: [TABELA_RETRATO_CONSELHO],
      entrada: ENTRADA,
      gravar: async (tx, e) => {
        const agora = new Date();
        await tx.executar(
          `INSERT INTO retrato_validade_conselho
             (dia, janela_dias, registros, vencidos, a_vencer, sem_validade, criado_em, versao)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE janela_dias = VALUES(janela_dias), registros = VALUES(registros),
             vencidos = VALUES(vencidos), a_vencer = VALUES(a_vencer), sem_validade = VALUES(sem_validade),
             alterado_em = VALUES(criado_em), versao = versao + 1`,
          [e.dia, e.janelaDias, e.registros, e.vencidos, e.aVencer, e.semValidade, agora],
        );
        return {};
      },
      alvo: () => ({ tabela: TABELA_RETRATO_CONSELHO, id: null }),
    });
    try {
      await this.executor.executar(
        op,
        this.cliente,
        {
          estabelecimento: sede,
          dia: r.dia,
          janelaDias: r.janelaDias,
          registros: r.registros,
          vencidos: r.vencidos,
          aVencer: r.aVencer,
          semValidade: r.semValidade,
        },
        {
          cliente: this.cliente,
          estabelecimento: sede,
          usuario: null,
          correlacao: `pessoas-conselho-${r.dia}`,
          chaveIdempotencia: `worker.conselho.${r.dia}.${randomUUID()}`,
        },
      );
      return true;
    } catch (e) {
      if (tabelaAusente(e)) return false;
      throw e;
    }
  }
}
