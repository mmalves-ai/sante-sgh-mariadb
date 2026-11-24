// Gravações da prescrição no banco PRÓPRIO, família "pep-resto2" (modulos-proprios-3): as duas que ainda recusavam
// com 501 (gravarRegra e registrarFicha). O integrador as liga em prescricao-porta-propria.ts (no lugar dos `pendente`).
// A especificação é a porta de memória (prescricao-porta-memoria.ts) e o controller da prescrição (esquemaRegra e
// esquemaFicha), que já validaram a entrada.
//   - gravarRegra: nova versão da regra de alerta pelo código (regra_alerta + regra_alerta_versao, com a justificativa
//     como motivo da alteração); código novo cria a regra no estabelecimento da sessão (versão 1). O cenário é o tipo de
//     alerta (cenario_alerta.codigo). Regra do produto (editavel = falso) só liga, desliga ou muda a vigência; a regra
//     do cliente (estabelecimento_id nulo, vale para todos os estabelecimentos) e a de outro estabelecimento recusam 409
//     (o código é único no cliente, e um estabelecimento não altera o que vale para os outros);
//   - registrarFicha: ficha_antimicrobiano do item prescrito (o item informado ou, sem ele, o último item do produto na
//     prescrição ou no atendimento), com o antimicrobiano pelo princípio ativo do produto, a finalidade pelo tipo
//     (empírico, dirigido, profilático), o sítio de infecção do catálogo e a duração (a informada ou a sugerida).
// Trilha, versão e idempotência pelo executor, na mesma transação. Nada é apagado: a regra muda por nova versão.
import { createHash, randomUUID } from 'node:crypto';
import { type ContextoOperacao, definirOperacao, ErroOperacao, type Executor, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPrescricao } from './prescricao-porta.js';
import {
  impressaoDoPedido,
  instanteLocal,
  type NucleoGravacaoPrescricao,
  nomeOperacao,
  profissionalDaSessao,
  resultadoRepetido,
} from './prescricao-propria-gravacao.js';
import { fusoValido } from './registro-porta-propria.js';
import type { FichaAvulsa, NovaVersaoRegra } from './tipos-pep.js';

export const TABELAS_REGRAS_2 = [
  'regra_alerta',
  'regra_alerta_versao',
  'ficha_antimicrobiano',
] as const;

/** Tipo da ficha (tela) → código da finalidade terapêutica do catálogo. */
export const FINALIDADE_DO_TIPO: Readonly<Record<FichaAvulsa['tipo'], string>> = {
  empirico: 'empirica',
  dirigido: 'terapeutica',
  profilatico: 'profilatica',
};

/** Nível da regra (tela) → colunas de regra_alerta. */
export function colunasDoNivel(nivel: NovaVersaoRegra['nivel']): {
  bloqueante: boolean;
  exige_justificativa: boolean;
  gravidade: 'informativo' | 'atencao' | 'critico';
} {
  if (nivel === 'bloqueio') return { bloqueante: true, exige_justificativa: true, gravidade: 'critico' };
  if (nivel === 'justificar') return { bloqueante: false, exige_justificativa: true, gravidade: 'atencao' };
  return { bloqueante: false, exige_justificativa: false, gravidade: 'informativo' };
}

/** Data civil (AAAA-MM-DD) somada de dias, sem fuso. */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Hoje no fuso do estabelecimento (AAAA-MM-DD). */
export function hojeLocal(fuso: string, agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    agora,
  );
}

/** Início e fim previstos da ficha: o dia de tratamento informado conta a partir de hoje (dia 1 = hoje). */
export function periodoDaFicha(hoje: string, diaTratamento: number, dias: number): { inicio: string; fim: string } {
  const inicio = somarDias(hoje, -(diaTratamento - 1));
  return { inicio, fim: somarDias(inicio, dias - 1) };
}

/**
 * Chave de idempotência da gravação: derivada da chave da requisição quando o contexto a traz (a repetição da mesma
 * requisição devolve o que já foi gravado, sem nova versão nem nova ficha); sem ela, uma chave única da chamada.
 */
export function chaveDaGravacao(operacao: string, chaveRequisicao: unknown): string {
  if (typeof chaveRequisicao === 'string' && chaveRequisicao.trim().length >= 8)
    return `${operacao}:${createHash('sha256').update(chaveRequisicao).digest('hex').slice(0, 48)}`.slice(0, 80);
  return `${operacao}:${randomUUID()}`.slice(0, 80);
}

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const verdadeiro = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (Buffer.isBuffer(v) && v[0] === 1);
const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

export class RegrasPrescricaoPropria2 {
  private executorCriado: Executor | null;

  constructor(
    private readonly nucleo: NucleoGravacaoPrescricao,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executorCriado = executor ?? null;
  }

  private get executor(): Executor {
    this.executorCriado ??= this.nucleo.criarExecutor();
    return this.executorCriado;
  }

  /** Nova versão da regra de alerta pelo código (ou a regra nova, versão 1). */
  gravarRegra(c: ContextoPrescricao, autor: string, r: NovaVersaoRegra): Promise<{ id: number; versao: number }> {
    return this.gravar(c, autor, 'pep.gravarRegra', false, r, async (tx, est) => {
      const cen = await tx.uma('SELECT id FROM cenario_alerta WHERE codigo = ? AND ativo = TRUE', [r.tipo]);
      if (!cen)
        throw recusar(409, 'cenario-sem-cadastro', `O cliente não tem o cenário de alerta "${r.tipo}" ativo.`);
      const nivel = colunasDoNivel(r.nivel);
      const agora = new Date();
      const vigente = instanteLocal(`${r.vigenteDesde}T00:00`, est.fuso);
      const [atual] = await tx.consultarParaAtualizar(
        `SELECT id, estabelecimento_id, cenario_alerta_id, descricao, bloqueante, exige_justificativa, editavel,
                numero_versao_vigente, versao
           FROM regra_alerta WHERE codigo = ?`,
        [r.codigo],
      );
      let id: number;
      let versao: number;
      if (!atual) {
        versao = 1;
        id = await tx.incluir('regra_alerta', {
          estabelecimento_id: est.id,
          codigo: r.codigo,
          nome: r.descricao.slice(0, 150),
          cenario_alerta_id: num(cen['id']),
          descricao: r.descricao,
          mensagem: r.descricao,
          ...nivel,
          numero_versao_vigente: versao,
          vigencia_inicio: r.vigenteDesde,
          ativo: r.ativa,
        });
      } else {
        id = num(atual['id']);
        const dono = numOuNull(atual['estabelecimento_id']);
        if (dono === null)
          throw recusar(
            409,
            'regra-do-cliente',
            'A regra vale para todos os estabelecimentos do cliente; um estabelecimento não a altera sozinho.',
          );
        if (dono !== est.id)
          throw recusar(409, 'regra-de-outro-estabelecimento', 'O código já é de uma regra de outro estabelecimento.');
        const muda =
          num(atual['cenario_alerta_id']) !== num(cen['id']) ||
          String(atual['descricao'] ?? '') !== r.descricao ||
          verdadeiro(atual['bloqueante']) !== nivel.bloqueante ||
          verdadeiro(atual['exige_justificativa']) !== nivel.exige_justificativa;
        if (!verdadeiro(atual['editavel']) && muda)
          throw recusar(
            409,
            'regra-do-produto',
            'A regra do produto só é ligada, desligada ou muda de vigência; o conteúdo não se altera.',
          );
        versao = num(atual['numero_versao_vigente']) + 1;
        await tx.alterar('regra_alerta', id, num(atual['versao']), {
          cenario_alerta_id: num(cen['id']),
          descricao: r.descricao,
          mensagem: r.descricao,
          ...nivel,
          numero_versao_vigente: versao,
          ativo: r.ativa,
        });
      }
      await tx.incluir('regra_alerta_versao', {
        regra_alerta_id: id,
        operacao: atual ? 'alteracao' : 'inclusao',
        dados: JSON.stringify({ codigo: r.codigo, tipo: r.tipo, nivel: r.nivel, ativa: r.ativa, descricao: r.descricao }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
        numero_versao: versao,
        vigente_desde: vigente,
        motivo_alteracao: r.justificativa,
      });
      return { tabela: 'regra_alerta', id, resultado: { id, versao } };
    });
  }

  /** Ficha de antimicrobiano do item prescrito (só o profissional da sessão). */
  registrarFicha(c: ContextoPrescricao, usuario: string, f: FichaAvulsa): Promise<number> {
    return this.gravar(c, usuario, 'pep.registrarFicha', true, f, async (tx, est, prof) => {
      const at = await tx.uma(
        'SELECT paciente_id, fonte_pagadora_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [f.atendimento, est.id],
      );
      if (!at || num(at['paciente_id']) !== f.paciente)
        throw recusar(404, 'registro-inexistente', 'O atendimento do paciente não foi encontrado.');
      const item = await tx.uma(
        `SELECT i.id, i.item_prescritivel_id FROM prescricao_item i
           JOIN prescricao p ON p.id = i.prescricao_id AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
          WHERE i.excluido_em IS NULL AND p.atendimento_id = ? AND p.paciente_id = ?
            AND ${f.item !== null ? 'i.id = ?' : 'i.item_prescritivel_id = ?'}
            ${f.prescricao !== null ? 'AND p.id = ?' : ''}
          ORDER BY p.prescrito_em DESC, i.id DESC LIMIT 1`,
        [
          est.id,
          f.atendimento,
          f.paciente,
          f.item ?? f.produto,
          ...(f.prescricao !== null ? [f.prescricao] : []),
        ],
      );
      if (!item) {
        if (f.item !== null)
          throw recusar(404, 'registro-inexistente', 'O item não é de uma prescrição deste atendimento.');
        throw recusar(422, 'ficha-sem-item', 'A ficha justifica um item prescrito: o produto não está prescrito.');
      }
      if (num(item['item_prescritivel_id']) !== f.produto)
        throw recusar(422, 'produto-diferente-do-item', 'O produto da ficha não é o do item prescrito.');
      const am = await tx.uma(
        `SELECT a.id, a.dias_liberados FROM antimicrobiano a
           JOIN item_prescritivel ip ON ip.principio_ativo_id = a.principio_ativo_id
          WHERE ip.id = ? AND a.ativo = TRUE ORDER BY a.id LIMIT 1`,
        [f.produto],
      );
      if (!am) throw recusar(422, 'produto-nao-antimicrobiano', 'O produto não é um antimicrobiano do cadastro.');
      const fin = await tx.uma(
        'SELECT id, dias_maximo_sugerido FROM finalidade_terapeutica WHERE codigo = ? AND ativo = TRUE',
        [FINALIDADE_DO_TIPO[f.tipo]],
      );
      if (!fin)
        throw recusar(409, 'finalidade-sem-cadastro', `O cliente não tem a finalidade terapêutica do tipo "${f.tipo}".`);
      const sitio = await tx.uma(
        `SELECT id FROM sitio_infeccao WHERE ativo = TRUE
            AND (LOWER(codigo) = LOWER(?) OR LOWER(sigla) = LOWER(?) OR LOWER(descricao) = LOWER(?))
          ORDER BY id LIMIT 1`,
        [f.sitio, f.sitio, f.sitio],
      );
      if (!sitio) throw recusar(422, 'sitio-sem-cadastro', 'O sítio de infecção não está no catálogo do cliente.');
      const dias = f.duracaoDias ?? numOuNull(fin['dias_maximo_sugerido']) ?? numOuNull(am['dias_liberados']);
      if (dias === null || dias < 1)
        throw recusar(422, 'duracao-obrigatoria', 'Informe a duração prevista do tratamento (dias).');
      const { inicio, fim } = periodoDaFicha(hojeLocal(est.fuso), f.diaTratamento, Math.min(dias, 365));
      const id = await tx.incluir('ficha_antimicrobiano', {
        estabelecimento_id: est.id,
        paciente_id: f.paciente,
        atendimento_id: f.atendimento,
        prescricao_item_id: num(item['id']),
        antimicrobiano_id: num(am['id']),
        prescritor_profissional_id: prof,
        fonte_pagadora_id: numOuNull(at['fonte_pagadora_id']),
        finalidade_terapeutica_id: num(fin['id']),
        origem_infeccao: f.tipo === 'profilatico' ? 'profilaxia_clinica' : 'indeterminada',
        sitio_infeccao_id: num(sitio['id']),
        cultura_coletada: f.culturaColhida,
        justificativa: f.indicacao,
        data_inicio: inicio,
        dias_previstos: Math.min(dias, 365),
        data_fim_prevista: fim,
        avaliacao_situacao: 'pendente',
        origem: 'sistema',
      });
      return { tabela: 'ficha_antimicrobiano', id, resultado: id };
    });
  }

  // ── Executor ────────────────────────────────────────────────────────────────────────────────────

  private async gravar<T>(
    c: ContextoPrescricao,
    login: string,
    operacao: string,
    exigeProfissional: boolean,
    pedido: unknown,
    fn: (tx: TxOperacao, est: Estabelecimento, profissional: number) => Promise<{ tabela: string; id: number; resultado: T }>,
  ): Promise<T> {
    const cliente = c.cliente || this.cliente;
    const ident = await this.nucleo.lerSomente(
      { cliente, correlacao: `pep.prescricao.${operacao}` },
      async (l: Leitor) => {
        const e = await l.uma('SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
          c.hospital,
        ]);
        if (!e)
          throw new ErroOperacao(
            404,
            'estabelecimento-inexistente',
            'Estabelecimento não encontrado',
            'O estabelecimento da sessão não existe neste cliente.',
          );
        const est = { id: num(e['id']), fuso: fusoValido(e['fuso_horario']) };
        if (exigeProfissional) {
          const p = await profissionalDaSessao(l, { usuario: null, login }, null);
          return { est, usuario: p?.usuario ?? null, profissional: p?.profissional ?? null };
        }
        const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
        return { est, usuario: u ? num(u['id']) : null, profissional: 0 };
      },
    );
    if (ident.usuario === null || ident.profissional === null)
      throw recusar(
        409,
        'profissional-sem-cbo',
        exigeProfissional ? 'Só o profissional da sessão registra a ficha.' : 'O usuário da sessão não existe neste cliente.',
      );
    const profissional = ident.profissional;
    let feito: { r: T } | null = null;
    const op = definirOperacao({
      nome: nomeOperacao(operacao),
      tabelas: TABELAS_REGRAS_2,
      entrada: z.object({ pedido: z.string() }).strict(),
      gravar: async (tx: TxOperacao) => {
        const g = await fn(tx, ident.est, profissional);
        feito = { r: g.resultado };
        return { tabela: g.tabela, id: g.id, resultado: JSON.stringify(g.resultado ?? null) };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: Number(s['id']) }),
    });
    const ctx: ContextoOperacao = {
      cliente,
      estabelecimento: ident.est.id,
      usuario: ident.usuario,
      correlacao: (c.correlacao || operacao).slice(0, 64),
      chaveIdempotencia: chaveDaGravacao(operacao, (c as Partial<Record<'chaveIdempotencia', unknown>>).chaveIdempotencia),
    };
    const r = await this.executor.executar(op, cliente, { pedido: impressaoDoPedido(pedido) }, ctx);
    if (!feito) {
      if (r.repetida) return resultadoRepetido<T>(r.resultado);
      throw new Error(`A operação ${operacao} terminou sem resultado.`);
    }
    return (feito as { r: T }).r;
  }
}
