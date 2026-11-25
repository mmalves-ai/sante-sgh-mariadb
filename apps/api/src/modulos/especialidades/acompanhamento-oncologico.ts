// Acompanhamento oncológico e reações do tratamento (03-PEP linha 111), no MariaDB do cliente pelo Executor do núcleo
// (trilha na mesma transação, versão conferida, Idempotency-Key honrada). As regras são do domínio (`@sgh/dominio-pep`,
// acompanhamento-oncologico); aqui ficam a leitura e a gravação:
//   - acompanhamento_oncologico: um acompanhamento ativo por tumor do paciente (classificação na linha de cuidado,
//     situação do tumor, resposta, recidiva, óbito); toda mudança grava um acompanhamento_oncologico_evento com o
//     retrato depois da mudança e o tipo (classificação, resposta, recidiva, óbito, observação). Nada é apagado;
//   - reacao_tratamento_oncologico: a toxicidade (categoria, grau CTCAE, evolução, conduta), ligada ao acompanhamento
//     e, quando houver, ao tratamento e ao ciclo de quimioterapia do mesmo paciente.
// Sem banco: 503 em tudo (falha fechada).
import {
  type AcompanhamentoAtual,
  type ClassificacaoPacienteOnco,
  conferirAcompanhamentoOnco,
  conferirReacao,
  type ErroCampoOnco,
  type RespostaTratamento,
  type SituacaoTumor,
  tipoEventoAcompanhamento,
} from '@sgh/dominio-pep';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import * as onco from './oncologia-propria.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { Autor } from './registro-oncologico.js';

export const PORTA_ACOMPANHAMENTO_ONCOLOGICO = Symbol('PORTA_ACOMPANHAMENTO_ONCOLOGICO');
export const OPERACOES_ACOMPANHAMENTO_ONCOLOGICO = {
  acompanhamento: 'pep.oncologia.acompanhamento.registrar',
  reacao: 'pep.oncologia.reacao.registrar',
} as const;
const TETO = 200;

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dataHora = z.string().regex(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/);
export const esquemaAcompanhamento = z
  .object({
    acompanhamento: z.number().int().positive().nullable().default(null),
    versao: z.number().int().positive().nullable().default(null),
    tumor: z.number().int().positive().nullable().default(null),
    classificacao: z.string().trim().min(1).max(30),
    situacaoTumor: z.string().trim().max(30).nullable().default(null),
    resposta: z.string().trim().max(30).nullable().default(null),
    primeiroTratamentoEm: data.nullable().default(null),
    recidivaEm: data.nullable().default(null),
    obitoEm: dataHora.nullable().default(null),
    observacao: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();
export const esquemaReacao = z
  .object({
    acompanhamento: z.number().int().positive(),
    tratamento: z.number().int().positive().nullable().default(null),
    ciclo: z.number().int().positive().nullable().default(null),
    categoria: z.string().trim().min(1).max(30),
    descricao: z.string().trim().max(500),
    grau: z.number().int(),
    evolucao: z.string().trim().max(20).default('nova'),
    avaliadoEm: dataHora,
    conduta: z.string().trim().max(4000).nullable().default(null),
    doseAjustada: z.boolean().default(false),
    tratamentoSuspenso: z.boolean().default(false),
  })
  .strict();
export type NovoAcompanhamento = z.infer<typeof esquemaAcompanhamento>;
export type NovaReacao = z.infer<typeof esquemaReacao>;

export interface EventoAcompanhamentoLido {
  readonly tipo: string | null;
  readonly operacao: string;
  readonly ocorridoEm: string;
  readonly observacao: string | null;
}
export interface ReacaoLida {
  readonly id: number;
  readonly acompanhamento: number;
  readonly tratamento: number | null;
  readonly ciclo: number | null;
  readonly avaliadoEm: string;
  readonly categoria: string;
  readonly descricao: string;
  readonly grau: number;
  readonly evolucao: string;
  readonly conduta: string | null;
  readonly doseAjustada: boolean;
  readonly tratamentoSuspenso: boolean;
}
export interface AcompanhamentoLido {
  readonly id: number;
  readonly versao: number;
  readonly tumor: number | null;
  readonly classificacao: ClassificacaoPacienteOnco;
  readonly classificadoEm: string | null;
  readonly situacaoTumor: SituacaoTumor | null;
  readonly resposta: RespostaTratamento | null;
  readonly primeiroTratamentoEm: string | null;
  readonly recidivaEm: string | null;
  readonly obitoEm: string | null;
  readonly eventos: EventoAcompanhamentoLido[];
}
export interface AcompanhamentoPaciente {
  readonly acompanhamentos: AcompanhamentoLido[];
  readonly reacoes: ReacaoLida[];
}
type Res = { id: number; versao?: number; tipo?: string };

export interface PortaAcompanhamentoOncologico {
  readonly destino: 'banco' | 'indisponivel';
  doPaciente(c: ContextoPortaM18, paciente: number): Promise<AcompanhamentoPaciente>;
  registrarAcompanhamento(c: ContextoPortaM18, a: Autor, e: NovoAcompanhamento, chave: string): Promise<Res>;
  registrarReacao(c: ContextoPortaM18, a: Autor, e: NovaReacao, chave: string): Promise<Res>;
}

const n = (v: unknown) => Number(v);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown) => (v === null || v === undefined ? null : String(v));
const dia = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 10));

function recusarErros(erros: readonly ErroCampoOnco[], codigo: string): void {
  if (erros.length)
    throw recusa(codigo, erros.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(erros.map((x) => x.campo))],
    });
}
const naoEncontrado = (o: string) =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrado`, `${o} não existe para este paciente.`);

async function hojeDe(l: Pick<Leitor, 'uma'>): Promise<string> {
  const r = await l.uma<Linha>("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS hoje", []);
  return String(r?.['hoje']);
}

const SQL_ACOMP = `SELECT id, versao, diagnostico_oncologico_id, classificacao_paciente,
  DATE_FORMAT(classificado_em, '%Y-%m-%d') AS classificado_em, situacao_tumor, resposta_tratamento,
  DATE_FORMAT(primeiro_tratamento_em, '%Y-%m-%d') AS primeiro_tratamento_em,
  DATE_FORMAT(recidiva_em, '%Y-%m-%d') AS recidiva_em, DATE_FORMAT(obito_em, '%Y-%m-%dT%H:%i') AS obito_em
  FROM acompanhamento_oncologico`;

function atualDe(r: Linha): AcompanhamentoAtual {
  return {
    classificacao: String(r['classificacao_paciente']) as ClassificacaoPacienteOnco,
    situacaoTumor: tx_(r['situacao_tumor']) as SituacaoTumor | null,
    resposta: tx_(r['resposta_tratamento']) as RespostaTratamento | null,
    recidivaEm: dia(r['recidiva_em']),
    obitoEm: tx_(r['obito_em']),
  };
}

/**
 * A reação que suspende o tratamento suspende, na mesma transação, todos os ciclos ativos do tratamento (previstos ou
 * liberados) pela mesma mudança de andamento da oncologia, com o evento 'ciclo suspenso' (categoria toxicidade) em cada
 * um: o ciclo sai da validação e da administração até ser retomado. Devolve os ciclos suspensos.
 */
async function suspenderCiclosAtivos(
  tx: TxOperacao,
  est: number,
  tratamento: number,
  motivo: string,
  vinculo: number,
): Promise<number[]> {
  const ativos = await tx.consultar<Linha>(
    `SELECT q.id, t.protocolo_quimioterapia_id FROM ciclo_quimioterapia q
       JOIN tratamento_oncologico t ON t.id = q.tratamento_oncologico_id
      WHERE q.tratamento_oncologico_id = ? AND t.estabelecimento_id = ? AND q.excluido_em IS NULL
        AND q.situacao IN ('previsto', 'liberado')
      ORDER BY q.id`,
    [tratamento, est],
  );
  const ids: number[] = [];
  for (const c of ativos) {
    const id = n(c['id']);
    await onco.mudarAndamentoCiclo(tx, est, { id, de: ['ativo'], para: 'suspenso' });
    await onco.registrarEventoOnco(tx, est, {
      evento: 'ciclo-suspenso',
      codigoProtocolo: '',
      protocolo: nn(c['protocolo_quimioterapia_id']),
      ciclo: id,
      prescricao: null,
      categoria: 'toxicidade',
      ciclosAfetados: null,
      antes: null,
      motivo,
      vinculo,
      usuario: String(tx.contexto.usuario ?? ''),
    });
    ids.push(id);
  }
  return ids;
}

export class PortaAcompanhamentoOncologicoPropria implements PortaAcompanhamentoOncologico {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'acompanhamento-oncologico',
    };
  }

  private async executar<R extends Res>(
    c: ContextoPortaM18,
    nome: string,
    tabelas: readonly string[],
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const alvo = tabelas[0]!;
    const op = definirOperacao({
      nome,
      tabelas,
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento),
      alvo: (_e, r: R) => ({ tabela: alvo, id: r.id }),
      trilha: () => ({ dados: entrada, motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  doPaciente(c: ContextoPortaM18, paciente: number): Promise<AcompanhamentoPaciente> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const as = await l.consultar<Linha>(
        `${SQL_ACOMP} WHERE estabelecimento_id = ? AND paciente_id = ? AND ativo AND excluido_em IS NULL
         ORDER BY id DESC LIMIT ${TETO}`,
        [ctx.estabelecimento, paciente],
      );
      const ids = as.map((r) => n(r['id']));
      const evs = ids.length
        ? await l.consultar<Linha>(
            `SELECT acompanhamento_oncologico_id AS a, tipo_evento, operacao, observacao,
                    DATE_FORMAT(ocorrido_em, '%Y-%m-%dT%H:%i') AS ocorrido_em
               FROM acompanhamento_oncologico_evento WHERE acompanhamento_oncologico_id IN (${ids.map(() => '?').join(',')})
              ORDER BY ocorrido_em DESC, id DESC LIMIT ${TETO * 5}`,
            ids,
          )
        : [];
      const rs = await l.consultar<Linha>(
        `SELECT id, acompanhamento_oncologico_id, tratamento_oncologico_id, ciclo_quimioterapia_id,
                DATE_FORMAT(avaliado_em, '%Y-%m-%dT%H:%i') AS avaliado_em, categoria, descricao, grau, evolucao,
                conduta, dose_ajustada, tratamento_suspenso
           FROM reacao_tratamento_oncologico
          WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL
          ORDER BY avaliado_em DESC, id DESC LIMIT ${TETO}`,
        [ctx.estabelecimento, paciente],
      );
      return {
        acompanhamentos: as.map((r) => ({
          id: n(r['id']),
          versao: n(r['versao']),
          tumor: nn(r['diagnostico_oncologico_id']),
          ...atualDe(r),
          classificadoEm: tx_(r['classificado_em']),
          primeiroTratamentoEm: tx_(r['primeiro_tratamento_em']),
          eventos: evs
            .filter((x) => n(x['a']) === n(r['id']))
            .map((x) => ({
              tipo: tx_(x['tipo_evento']),
              operacao: String(x['operacao']),
              ocorridoEm: String(x['ocorrido_em']),
              observacao: tx_(x['observacao']),
            })),
        })),
        reacoes: rs.map((r) => ({
          id: n(r['id']),
          acompanhamento: n(r['acompanhamento_oncologico_id']),
          tratamento: nn(r['tratamento_oncologico_id']),
          ciclo: nn(r['ciclo_quimioterapia_id']),
          avaliadoEm: String(r['avaliado_em']),
          categoria: String(r['categoria']),
          descricao: String(r['descricao']),
          grau: n(r['grau']),
          evolucao: String(r['evolucao']),
          conduta: tx_(r['conduta']),
          doseAjustada: Boolean(n(r['dose_ajustada'])),
          tratamentoSuspenso: Boolean(n(r['tratamento_suspenso'])),
        })),
      };
    });
  }

  registrarAcompanhamento(c: ContextoPortaM18, a: Autor, e: NovoAcompanhamento, chave: string): Promise<Res> {
    return this.executar(
      c,
      OPERACOES_ACOMPANHAMENTO_ONCOLOGICO.acompanhamento,
      ['acompanhamento_oncologico', 'acompanhamento_oncologico_evento'],
      { ...a, ...e },
      chave,
      async (tx, est) => {
        const hoje = await hojeDe(tx);
        let diagnosticadoEm: string | null = null;
        if (e.tumor !== null) {
          const d = await tx.uma<Linha>(
            `SELECT DATE_FORMAT(diagnosticado_em, '%Y-%m-%d') AS d FROM diagnostico_oncologico
              WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
            [e.tumor, a.paciente, est],
          );
          if (!d) throw naoEncontrado('Tumor');
          diagnosticadoEm = tx_(d['d']);
        }
        let linha: Linha | null = null;
        if (e.acompanhamento !== null) {
          linha = await tx.uma<Linha>(
            `${SQL_ACOMP} WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
            [e.acompanhamento, a.paciente, est],
          );
          if (!linha) throw naoEncontrado('Acompanhamento');
          if (nn(linha['diagnostico_oncologico_id']) !== e.tumor)
            throw recusa('tumor-diferente', 'O acompanhamento é de outro tumor.', { campos: ['tumor'] });
        } else {
          const ja = await tx.uma<Linha>(
            `SELECT id FROM acompanhamento_oncologico WHERE paciente_id = ? AND estabelecimento_id = ? AND ativo
                AND excluido_em IS NULL AND diagnostico_oncologico_id <=> ?`,
            [a.paciente, est, e.tumor],
          );
          if (ja)
            throw recusa(
              'acompanhamento-existente',
              'Este tumor já tem acompanhamento: atualize o existente (o histórico fica na linha do tempo).',
              { campos: ['tumor'] },
            );
        }
        const atual = linha ? atualDe(linha) : null;
        recusarErros(conferirAcompanhamentoOnco(e, atual, hoje, diagnosticadoEm), 'acompanhamento-invalido');
        const tipo = tipoEventoAcompanhamento(e, atual);
        const valores = {
          classificacao_paciente: e.classificacao,
          classificado_em:
            !atual || atual.classificacao !== e.classificacao ? hoje : dia(linha?.['classificado_em']),
          situacao_tumor: e.situacaoTumor,
          resposta_tratamento: e.resposta,
          primeiro_tratamento_em: e.primeiroTratamentoEm,
          recidiva_em: e.recidivaEm,
          obito_em: e.obitoEm ? e.obitoEm.replace('T', ' ') : null,
        };
        let id: number;
        let versao: number;
        if (linha) {
          if (e.versao === null)
            throw recusa('sem-versao', 'Informe a versão lida do acompanhamento.', { campos: ['versao'] });
          id = n(linha['id']);
          versao = await tx.alterar('acompanhamento_oncologico', id, e.versao, valores);
        } else {
          id = await tx.incluir('acompanhamento_oncologico', {
            estabelecimento_id: est,
            paciente_id: a.paciente,
            diagnostico_oncologico_id: e.tumor,
            responsavel_profissional_id: a.profissional,
            cadastrado_em: new Date(),
            ativo: true,
            ...valores,
          });
          versao = 1;
        }
        await tx.incluir('acompanhamento_oncologico_evento', {
          acompanhamento_oncologico_id: id,
          operacao: linha ? 'alteracao' : 'inclusao',
          dados: JSON.stringify(valores),
          ocorrido_em: new Date(),
          usuario_id: tx.contexto.usuario,
          tipo_evento: tipo,
          profissional_id: a.profissional,
          observacao: e.observacao,
        });
        return { id, versao, tipo };
      },
    );
  }

  registrarReacao(c: ContextoPortaM18, a: Autor, e: NovaReacao, chave: string): Promise<Res> {
    return this.executar(
      c,
      OPERACOES_ACOMPANHAMENTO_ONCOLOGICO.reacao,
      ['reacao_tratamento_oncologico', 'ciclo_quimioterapia', 'evento_tratamento_oncologico'],
      { ...a, ...e },
      chave,
      async (tx, est) => {
        const ac = await tx.uma<Linha>(
          `SELECT classificacao_paciente FROM acompanhamento_oncologico
            WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [e.acompanhamento, a.paciente, est],
        );
        if (!ac) throw naoEncontrado('Acompanhamento');
        let tratamento = e.tratamento;
        if (e.ciclo !== null) {
          const ci = await tx.uma<Linha>(
            `SELECT q.tratamento_oncologico_id AS t FROM ciclo_quimioterapia q
               JOIN tratamento_oncologico t ON t.id = q.tratamento_oncologico_id
              WHERE q.id = ? AND t.paciente_id = ? AND t.estabelecimento_id = ? AND q.excluido_em IS NULL`,
            [e.ciclo, a.paciente, est],
          );
          if (!ci) throw naoEncontrado('Ciclo');
          if (tratamento !== null && tratamento !== n(ci['t']))
            throw recusa('ciclo-de-outro-tratamento', 'O ciclo é de outro tratamento.', {
              campos: ['ciclo'],
            });
          tratamento = n(ci['t']);
        } else if (tratamento !== null) {
          const t = await tx.uma<Linha>(
            `SELECT id FROM tratamento_oncologico WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?
                AND excluido_em IS NULL`,
            [tratamento, a.paciente, est],
          );
          if (!t) throw naoEncontrado('Tratamento');
        }
        recusarErros(
          conferirReacao({ ...e, comTratamento: tratamento !== null }, await hojeDe(tx)),
          'reacao-invalida',
        );
        const id = await tx.incluir('reacao_tratamento_oncologico', {
          estabelecimento_id: est,
          paciente_id: a.paciente,
          acompanhamento_oncologico_id: e.acompanhamento,
          tratamento_oncologico_id: tratamento,
          ciclo_quimioterapia_id: e.ciclo,
          profissional_id: a.profissional,
          avaliado_em: e.avaliadoEm.replace('T', ' '),
          categoria: e.categoria,
          descricao: e.descricao,
          grau: e.grau,
          evolucao: e.evolucao,
          conduta: e.conduta,
          dose_ajustada: e.doseAjustada,
          tratamento_suspenso: e.tratamentoSuspenso,
        });
        if (e.tratamentoSuspenso && tratamento !== null)
          await suspenderCiclosAtivos(
            tx,
            est,
            tratamento,
            `Reação grau ${e.grau}: ${e.descricao}`,
            a.profissional,
          );
        return { id };
      },
    );
  }
}

const indisponivel = (): Promise<never> =>
  Promise.reject(
    new ErroProblema(
      'indisponivel',
      503,
      'Serviço indisponível',
      'O acompanhamento oncológico precisa do banco do cliente.',
    ),
  );
export function portaAcompanhamentoOncologicoIndisponivel(): PortaAcompanhamentoOncologico {
  return {
    destino: 'indisponivel',
    doPaciente: indisponivel,
    registrarAcompanhamento: indisponivel,
    registrarReacao: indisponivel,
  };
}
