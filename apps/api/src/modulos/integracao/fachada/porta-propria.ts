// M58-F4: a porta da fachada sobre o banco do cliente (MariaDB pelo @sgh/nucleo). Leituras somente leitura do
// cadastro da fonte pagadora vinculada ao estabelecimento; a gravação da situação pelo Executor (trava pela versão,
// conferência da situação de origem, trilha e idempotência pela chave da proposta, na mesma transação), assinada pelo
// usuário de integração e confirmada pela proposta no lugar da reautenticação (D-REAUT-F4-58).
// A forma das respostas é a do contrato da API original servida à Hal-AI: a situação sai como "A" (ativa) ou "I"
// (suspensa) e os campos que o modelo próprio não tem (classificação, tabelas de honorários, diária) saem nulos.
// Melhoria: o convênio é a fonte pagadora com vínculo ao estabelecimento (outro estabelecimento não vê nem altera):
// a suspensão pedida pelo canal de um estabelecimento grava a situação do VÍNCULO (fonte_pagadora_estabelecimento),
// nunca a do cadastro do cliente inteiro; a situação lida é a do vínculo, com a do cadastro como teto.
// Melhoria: sem a trava escondida em gatilho (a diária de acompanhante): a regra é do domínio e o banco só guarda.
// Melhoria: a mudança de situação confere a situação de origem e a versão na mesma transação (compare-and-swap) e
// deixa a trilha com a justificativa; a repetição da mesma proposta não grava duas vezes (idempotência do Executor).
import { CODIGOS_ERRO_FACHADA as E, USUARIO_INTEGRACAO_FACHADA } from '@sgh/contratos';
import {
  type DiariaAcompanhante,
  erroFachada,
  type ImpactoConvenio,
  type LinhaConvenioFachada,
  recusaDoBancoSituacao,
  type RetratoConvenio,
} from '@sgh/dominio-integracao';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  problemaDaOperacao,
  recusa,
} from '@sgh/nucleo';
import { z } from 'zod';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoFachada,
  type GravacaoSituacaoFachada,
  METODOS_PORTA_FACHADA,
  type PortaFachada,
  type SaudeBancoFachada,
} from './porta.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoFachada {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** As operações de gravação que esta porta serve (as outras ficam fora do catálogo da fachada). */
const OPERACOES_SERVIDAS: Readonly<Record<string, string>> = { 'convenio.alterarSituacao': 'verde' };

const MUDOU = new Set(['conflito-versao', 'situacao-mudou', 'sem-efeito', 'situacao-desconhecida']);
const NAO_LIBERADA = new Set(['operacao-nao-liberada', 'operacao-bloqueada', 'reautenticacao-necessaria']);
const EM_EDICAO = new Set(['registro-em-edicao', 'requisicao-em-andamento', 'idempotencia-divergente']);

/** A recusa do Executor no contrato de erro da fachada (nunca o texto do banco). */
export function falhaDoExecutor(e: unknown, cod: number, nome: string): Error {
  const p = problemaDaOperacao(e);
  const codigo = String((p as { codigo?: unknown }).codigo ?? '');
  if (MUDOU.has(codigo))
    return erroFachada(
      409,
      'O cadastro do convênio mudou entre a proposta e a gravação. Nada foi escrito. Refaça a proposta para ver o estado atual.',
      E.propostaDesatualizada,
    );
  if (NAO_LIBERADA.has(codigo) || codigo === 'estabelecimento-desconhecido')
    return erroFachada(
      409,
      'A gravação equivalente não está liberada neste estabelecimento. Nada foi escrito.',
      E.acaoSemEfeito,
      { motivo: 'gravacao_nao_liberada', convenio: cod },
    );
  if (EM_EDICAO.has(codigo))
    return erroFachada(
      409,
      'O convênio está sendo alterado agora por outra pessoa ou processo. Nada foi escrito. Tente de novo em instantes.',
      E.acaoSemEfeito,
      { motivo: 'registro_em_edicao', convenio: cod },
    );
  if (p.status === 409 || p.status === 422) return recusaDoBancoSituacao(cod, nome);
  return e instanceof Error ? e : new Error('falha na gravação');
}

/**
 * A situação que vale no estabelecimento: a do cadastro do cliente é o teto (suspensa ou inativa ali vale para todos);
 * com o cadastro ativo, a do vínculo ao estabelecimento.
 */
export function situacaoNoEstabelecimento(cadastro: unknown, vinculo: unknown): unknown {
  return cadastro === 'ativa' ? vinculo : cadastro;
}

/** Situação da fonte pagadora → a do contrato da API original ("A" ativa, "I" suspensa; a encerrada fica como está). */
export function situacaoDoContrato(s: unknown): string | null {
  if (s === 'ativa') return 'A';
  if (s === 'suspensa') return 'I';
  return s === null || s === undefined ? null : String(s);
}

const SQL_CONVENIO = `
  SELECT fp.id, fp.nome, fp.situacao, fpe.id AS vinculo_id, fpe.versao AS vinculo_versao, fpe.situacao AS situacao_vinculo
    FROM fonte_pagadora fp
    JOIN fonte_pagadora_estabelecimento fpe ON fpe.fonte_pagadora_id = fp.id AND fpe.estabelecimento_id = ?
         AND fpe.excluido_em IS NULL
   WHERE fp.excluido_em IS NULL`;

const linhaConvenio = (x: Linha): LinhaConvenioFachada => ({
  cod: Number(x['id']),
  nome: x['nome'] === null ? null : String(x['nome']),
  situacao: situacaoDoContrato(situacaoNoEstabelecimento(x['situacao'], x['situacao_vinculo'])),
  permiteAtend: situacaoNoEstabelecimento(x['situacao'], x['situacao_vinculo']) === 'ativa' ? 1 : 0,
});

const esquemaSituacao = z.object({
  convenio: z.number().int().positive(),
  operacao: z.enum(['suspender', 'reativar']),
  justificativa: z.string().trim().min(1).max(500),
});
type EntradaSituacao = z.infer<typeof esquemaSituacao>;

export class PortaFachadaPropria implements PortaFachada {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoFachada,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoFachada, fn: (l: Leitor, est: number | null) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'fachada' }, async (l) => {
      const r = await l.uma<{ id: unknown }>(
        'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [c.hospital],
      );
      return fn(l, r ? Number(r.id) : null);
    });
  }

  estado(operacao: string): string | null {
    return OPERACOES_SERVIDAS[operacao] ?? null;
  }

  convenios(c: ContextoFachada): Promise<LinhaConvenioFachada[]> {
    return this.ler(c, async (l, est) =>
      est === null
        ? []
        : (await l.consultar(`${SQL_CONVENIO} ORDER BY fp.nome, fp.id`, [est], { teto: 2_000 })).map(linhaConvenio),
    );
  }

  convenio(c: ContextoFachada, cod: number): Promise<LinhaConvenioFachada | null> {
    return this.ler(c, async (l, est) => {
      if (est === null) return null;
      const x = await l.uma(`${SQL_CONVENIO} AND fp.id = ?`, [est, cod]);
      return x ? linhaConvenio(x) : null;
    });
  }

  saudeBanco(c: ContextoFachada): Promise<SaudeBancoFachada> {
    return this.ler(c, async (l) => {
      const x = await l.uma<{ v: unknown; cs: unknown }>('SELECT VERSION() AS v, @@character_set_database AS cs');
      return {
        banco: x?.v === undefined || x.v === null ? null : `MariaDB ${String(x.v).split('-')[0]}`,
        colunaObs: null,
        efetivo: String(x?.cs ?? 'utf8mb4').toUpperCase(),
      };
    });
  }

  retratoConvenio(c: ContextoFachada, cod: number): Promise<RetratoConvenio> {
    return this.ler(c, async (l, est) => {
      const x = est === null ? null : await l.uma(`${SQL_CONVENIO} AND fp.id = ?`, [est, cod]);
      if (!x || est === null) return { existe: false, cod };
      const a = await l.uma(
        `SELECT
           (SELECT COUNT(DISTINCT af.agenda_servico_id) FROM agenda_fonte_pagadora af
              JOIN agenda_servico ag ON ag.id = af.agenda_servico_id AND ag.estabelecimento_id = ?
             WHERE af.fonte_pagadora_id = ? AND af.excluido_em IS NULL
               AND NOT EXISTS (SELECT 1 FROM agenda_servico_exame ae WHERE ae.agenda_servico_id = af.agenda_servico_id
                                  AND ae.excluido_em IS NULL)) AS consulta,
           (SELECT COUNT(DISTINCT ae.agenda_servico_id) FROM agenda_servico_exame ae
              JOIN agenda_servico ag ON ag.id = ae.agenda_servico_id AND ag.estabelecimento_id = ?
             WHERE ae.fonte_pagadora_id = ? AND ae.excluido_em IS NULL) AS exame`,
        [est, cod, est, cod],
      );
      const l1 = linhaConvenio(x);
      return {
        existe: true,
        cod,
        situacao: l1.situacao,
        nome: l1.nome,
        permiteAtend: Number(l1.permiteAtend),
        classifC: null,
        thm: null,
        thmE: null,
        idDth: null,
        agendasConsulta: Number(a?.['consulta'] ?? 0),
        agendasExame: Number(a?.['exame'] ?? 0),
      };
    });
  }

  /** Sem diária de acompanhante presa ao cadastro do convênio: nada a conferir antes da troca de situação. */
  async diariaConvenio(): Promise<DiariaAcompanhante> {
    return null;
  }

  impactoConvenio(c: ContextoFachada, cod: number): Promise<ImpactoConvenio> {
    return this.ler(c, async (l, est) => {
      if (est === null) return { consulta: 0, exame: 0, contasAbertas: 0, carteira: 0, profissionais: 0 };
      const x = await l.uma(
        `SELECT
           (SELECT COUNT(*) FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
             WHERE m.estabelecimento_id = ? AND m.fonte_pagadora_id = ? AND m.excluido_em IS NULL
               AND m.atendido_em IS NULL AND m.falta_registrada_em IS NULL AND h.inicio_em >= CURRENT_TIMESTAMP(3)
               AND m.especialidade_medica_id IS NOT NULL) AS consulta,
           (SELECT COUNT(*) FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
             WHERE m.estabelecimento_id = ? AND m.fonte_pagadora_id = ? AND m.excluido_em IS NULL
               AND m.atendido_em IS NULL AND m.falta_registrada_em IS NULL AND h.inicio_em >= CURRENT_TIMESTAMP(3)
               AND m.especialidade_medica_id IS NULL) AS exame,
           (SELECT COUNT(*) FROM conta_hospitalar ch WHERE ch.estabelecimento_id = ? AND ch.fonte_pagadora_id = ?
               AND ch.situacao = 'aberta' AND ch.excluido_em IS NULL) AS contas,
           (SELECT COUNT(*) FROM cobertura_paciente cp WHERE cp.fonte_pagadora_id = ? AND cp.excluido_em IS NULL
               AND (cp.vigencia_fim IS NULL OR cp.vigencia_fim >= CURRENT_DATE)) AS carteira,
           (SELECT COUNT(DISTINCT pf.profissional_id) FROM profissional_fonte_pagadora pf
             WHERE pf.fonte_pagadora_id = ? AND (pf.estabelecimento_id IS NULL OR pf.estabelecimento_id = ?)
               AND pf.excluido_em IS NULL AND (pf.vigencia_fim IS NULL OR pf.vigencia_fim >= CURRENT_DATE))
             AS profissionais`,
        [est, cod, est, cod, est, cod, cod, cod, est],
      );
      return {
        consulta: Number(x?.['consulta'] ?? 0),
        exame: Number(x?.['exame'] ?? 0),
        contasAbertas: Number(x?.['contas'] ?? 0),
        carteira: Number(x?.['carteira'] ?? 0),
        profissionais: Number(x?.['profissionais'] ?? 0),
      };
    });
  }

  async gravarSituacaoConvenio(c: ContextoFachada, g: GravacaoSituacaoFachada): Promise<string | null> {
    const quem = await this.ler(c, async (l, est) => {
      const u = await l.uma<{ id: unknown }>(
        'SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL',
        [USUARIO_INTEGRACAO_FACHADA],
      );
      return { est, usuario: u ? Number(u.id) : null };
    });
    const operacao = definirOperacao<EntradaSituacao, { convenio: number; vinculo: number; situacao: string }>({
      nome: 'integracao.fachada.convenio-situacao',
      tabelas: ['fonte_pagadora_estabelecimento'],
      entrada: esquemaSituacao,
      acao: 'alteracao',
      gravar: async (tx, e) => {
        const est = tx.contexto.estabelecimento;
        const x = (await tx.consultarParaAtualizar(`${SQL_CONVENIO} AND fp.id = ?`, [est, e.convenio]))[0];
        if (!x) throw recusa('situacao-desconhecida', 'O convênio não está vinculado a este estabelecimento.');
        const origem = e.operacao === 'suspender' ? 'ativa' : 'suspensa';
        const alvo = e.operacao === 'suspender' ? 'suspensa' : 'ativa';
        if (x['situacao_vinculo'] !== origem)
          throw recusa('situacao-mudou', 'A situação do convênio mudou desde a proposta.');
        // O cadastro suspenso ou inativo para o cliente inteiro é o teto: reativar só o vínculo não libera o convênio.
        if (alvo === 'ativa' && x['situacao'] !== 'ativa')
          throw recusa('situacao-mudou', 'O convênio está suspenso no cadastro de todos os estabelecimentos.');
        const vinculo = Number(x['vinculo_id']);
        await tx.alterar('fonte_pagadora_estabelecimento', vinculo, Number(x['vinculo_versao']), { situacao: alvo });
        return { convenio: e.convenio, vinculo, situacao: alvo };
      },
      alvo: (_e, s) => ({ tabela: 'fonte_pagadora_estabelecimento', id: s.vinculo }),
      trilha: (e) => ({ motivo: e.justificativa, dados: { operacao: e.operacao, convenio: e.convenio, canal: 'fachada-hal-ai' } }),
    });
    try {
      if (quem.est === null) throw recusa('estabelecimento-desconhecido', 'Estabelecimento desconhecido.');
      const ctx: ContextoOperacao = {
        cliente: this.cliente,
        estabelecimento: quem.est,
        usuario: quem.usuario,
        correlacao: `fachada-${g.chave}`.slice(0, 64),
        chaveIdempotencia: g.chave,
        // A confirmação da proposta, com o token da superfície, é o segundo tempo da decisão (D-REAUT-F4-58).
        reautenticadoEm: Date.now(),
      };
      await this.executor.executar(
        operacao,
        this.cliente,
        { convenio: g.cod, operacao: g.operacao, justificativa: g.justificativa },
        ctx,
      );
    } catch (e) {
      throw falhaDoExecutor(e, g.cod, `convênio ${g.cod}`);
    }
    return (await this.convenio(c, g.cod))?.situacao ?? null;
  }
}

export function portaFachadaIndisponivel(): PortaFachada {
  const p = portaIndisponivel<PortaFachada>(METODOS_PORTA_FACHADA);
  return {
    destino: 'banco',
    // O estado é síncrono: sem banco, nenhuma operação equivalente conta como provada.
    estado: () => null,
    convenios: (c) => p.convenios(c),
    convenio: (c, cod) => p.convenio(c, cod),
    saudeBanco: (c) => p.saudeBanco(c),
    retratoConvenio: (c, cod) => p.retratoConvenio(c, cod),
    diariaConvenio: (c, cod) => p.diariaConvenio(c, cod),
    impactoConvenio: (c, cod) => p.impactoConvenio(c, cod),
    gravarSituacaoConvenio: (c, g) => p.gravarSituacaoConvenio(c, g),
  };
}
