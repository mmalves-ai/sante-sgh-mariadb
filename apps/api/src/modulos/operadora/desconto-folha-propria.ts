// Desconto em folha da mensalidade (08-SGO L97, C3-028), porta própria sobre o banco do cliente:
//   - leituras: contratantes que descontam em folha (busca remota), remessas, a remessa com os itens, a prévia da
//     remessa da competência (nada é gravado) e o arquivo da remessa;
//   - gravação pelo Executor (trilha na mesma transação, Idempotency-Key do pedido): gerar, enviar, ler o retorno
//     (conciliação e baixa das cobranças descontadas), conferir e cancelar.
// A regra (o que entra, a alocação do retorno, as recusas, o ciclo) é do domínio (dominio-operadora/desconto-folha).
// Contrato de efeito: remessa_desconto_folha e remessa_desconto_folha_item (com a cobrança, fatura_plano_id), a baixa
// em fatura_plano (paga ou paga_parcial, valor_pago somado, data do crédito) e a trilha; detalhe no .int.spec.
import {
  arquivoRemessaFolha,
  type CobrancaParaFolha,
  conciliarRetornoFolha,
  inicioCompetenciaFolha,
  type ItemRemessaFolha,
  lerRetornoFolha,
  type MontagemRemessaFolha,
  montarRemessaFolha,
  podePassarRemessaFolha,
  type ProblemaRetornoFolha,
  type SituacaoRemessaFolha,
  type TipoRemessaFolha,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Escritor,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inteiro,
  instanteIso,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
  trechoLike,
} from './apoio-banco.js';

export const PORTA_DESCONTO_FOLHA = Symbol('PORTA_DESCONTO_FOLHA_OPERADORA');

export const TABELAS_DESCONTO_FOLHA = [
  'remessa_desconto_folha',
  'remessa_desconto_folha_item',
  'fatura_plano',
  // A numeração da remessa (garantirSequencia na primeira gravação do estabelecimento).
  'sequencia_negocio',
] as const;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;
type Contexto = ContextoPorta & { readonly chaveIdempotencia?: string };

export interface EntradaRemessaFolha {
  readonly operadora: number;
  readonly contratante: number;
  /** AAAA-MM */
  readonly competencia: string;
  readonly tipo: TipoRemessaFolha;
  readonly observacao: string | null;
}

export interface RemessaFolhaResumo {
  readonly id: number;
  readonly versao: number;
  readonly numero: string;
  readonly operadora: number;
  readonly contratante: number;
  readonly contratanteNome: string;
  readonly competencia: string;
  readonly tipo: TipoRemessaFolha;
  readonly situacao: SituacaoRemessaFolha;
  readonly geradaEm: string | null;
  readonly enviadaEm: string | null;
  readonly retornoLidoEm: string | null;
  readonly valorEnviado: number;
  readonly valorDescontado: number;
  readonly itens: number;
}

export interface ItemRemessaFolhaLido {
  readonly sequencia: number;
  readonly fatura: number;
  readonly cobranca: string;
  readonly beneficiario: number;
  readonly matriculaFuncional: string;
  readonly competencia: string;
  readonly valorEnviado: number;
  readonly valorAtrasado: number;
  readonly valorDescontado: number | null;
  readonly situacao: string;
}

const naoEncontrado = (o: string) =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    `${o} não existe ou é de outro estabelecimento.`,
  );
const situacaoRecusada = (detalhe: string) => recusa('situacao-invalida', detalhe, { campos: ['situacao'] });
const centavos = (v: number) => Math.round(v * 100) / 100;
const ultimoDia = (inicio: string) => {
  const [a, m] = inicio.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

const SELECT_REMESSA = `
  SELECT r.id, r.versao, r.numero, r.operadora_saude_id, r.contratante_plano_id, r.competencia, r.tipo_remessa,
         r.situacao, r.gerada_em, r.enviada_em, r.retorno_lido_em, r.valor_enviado, r.valor_descontado,
         COALESCE(pj.razao_social, pf.nome, ct.codigo) AS contratante_nome,
         (SELECT COUNT(*) FROM remessa_desconto_folha_item i
           WHERE i.remessa_desconto_folha_id = r.id AND i.excluido_em IS NULL) AS itens
    FROM remessa_desconto_folha r
    JOIN contratante_plano ct ON ct.id = r.contratante_plano_id
    LEFT JOIN pessoa_juridica pj ON pj.id = ct.pessoa_juridica_id
    LEFT JOIN pessoa_fisica pf ON pf.id = ct.pessoa_fisica_id`;

function resumo(r: Record<string, unknown>): RemessaFolhaResumo {
  return {
    id: Number(r['id']),
    versao: Number(r['versao']),
    numero: textoObrigatorio(r['numero']),
    operadora: Number(r['operadora_saude_id']),
    contratante: Number(r['contratante_plano_id']),
    contratanteNome: textoObrigatorio(r['contratante_nome']),
    competencia: (dataIso(r['competencia']) ?? '').slice(0, 7),
    tipo: textoObrigatorio(r['tipo_remessa']) as TipoRemessaFolha,
    situacao: textoObrigatorio(r['situacao']) as SituacaoRemessaFolha,
    geradaEm: instanteIso(r['gerada_em']),
    enviadaEm: instanteIso(r['enviada_em']),
    retornoLidoEm: instanteIso(r['retorno_lido_em']),
    valorEnviado: numero(r['valor_enviado']) ?? 0,
    valorDescontado: numero(r['valor_descontado']) ?? 0,
    itens: Number(r['itens'] ?? 0),
  };
}

export class PortaDescontoFolhaPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-desconto-folha' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar(
    c: Contexto,
    nome: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<Gravado>,
  ): Promise<Gravado> {
    if (!c.chaveIdempotencia)
      throw new ErroOperacao(
        400,
        'entrada-invalida',
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido de gravação.',
      );
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_DESCONTO_FOLHA,
      entrada: z.record(z.string(), z.unknown()),
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela: 'remessa_desconto_folha', id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      {},
      { ...contextoDireto(this.cliente, est, c, null), chaveIdempotencia: c.chaveIdempotencia },
    );
    return r.resultado;
  }

  private static async operadoraDoEst(l: Leitor | Escritor, est: number, op: number): Promise<void> {
    const x = await l.uma(
      `SELECT 1 AS ok FROM operadora_saude_estabelecimento
        WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [op, est],
    );
    if (!x) throw naoEncontrado('A operadora');
  }

  /** As cobranças com saldo dos contratos da contratante que cobram por desconto em folha, até a competência. */
  private static async cobrancas(
    l: Leitor | Escritor,
    est: number,
    op: number,
    contratante: number,
    competencia: string,
  ): Promise<CobrancaParaFolha[]> {
    const inicio = inicioCompetenciaFolha(competencia);
    const linhas = await l.consultar<Record<string, unknown>>(
      `SELECT f.id, f.numero, f.competencia, f.data_vencimento, f.valor_total, f.valor_pago,
              f.responsavel_beneficiario_plano_id AS beneficiario, b.matricula_empresa, b.percentual_desconto_folha,
              EXISTS (SELECT 1 FROM remessa_desconto_folha_item i
                        JOIN remessa_desconto_folha r ON r.id = i.remessa_desconto_folha_id
                       WHERE i.fatura_plano_id = f.id AND i.excluido_em IS NULL AND r.excluido_em IS NULL
                         AND r.situacao IN ('gerada','enviada')) AS em_outra
         FROM fatura_plano f
         JOIN contrato_plano k ON k.id = f.contrato_plano_id
         LEFT JOIN beneficiario_plano b ON b.id = f.responsavel_beneficiario_plano_id
        WHERE f.estabelecimento_id = ? AND k.operadora_saude_id = ? AND k.contratante_plano_id = ?
          AND f.excluido_em IS NULL AND f.situacao IN ('aberta','emitida','paga_parcial') AND f.competencia <= ?
          AND EXISTS (SELECT 1 FROM contrato_forma_cobranca cf
                        JOIN forma_cobranca_plano fc ON fc.id = cf.forma_cobranca_plano_id
                       WHERE cf.contrato_plano_id = k.id AND cf.ativo = TRUE AND fc.meio = 'desconto_folha'
                         AND (cf.beneficiario_plano_id IS NULL OR cf.beneficiario_plano_id = f.responsavel_beneficiario_plano_id)
                         AND cf.vigencia_inicio <= ? AND (cf.vigencia_fim IS NULL OR cf.vigencia_fim >= ?))
        ORDER BY f.competencia, f.id LIMIT 5001`,
      [est, op, contratante, inicio, ultimoDia(inicio), inicio],
    );
    if (linhas.length > 5000)
      throw recusa(
        'remessa-grande-demais',
        'A remessa passa de 5.000 cobranças: gere por contratante menor.',
      );
    return linhas.map((f) => ({
      fatura: Number(f['id']),
      numero: textoObrigatorio(f['numero']),
      beneficiario: inteiro(f['beneficiario']),
      matriculaFuncional: texto(f['matricula_empresa']),
      percentualFolha: numero(f['percentual_desconto_folha']),
      competencia: dataIso(f['competencia']) ?? '',
      vencimento: dataIso(f['data_vencimento']) ?? '',
      saldo: centavos((numero(f['valor_total']) ?? 0) - (numero(f['valor_pago']) ?? 0)),
      emOutraRemessa: Number(f['em_outra']) === 1,
    }));
  }

  private static async remessaDoEst(l: Leitor | TxOperacao, est: number, id: number, travar = false) {
    const sql = `${SELECT_REMESSA} WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`;
    const [r] =
      travar && 'consultarParaAtualizar' in l
        ? await l.consultarParaAtualizar<Record<string, unknown>>(sql, [id, est])
        : await l.consultar<Record<string, unknown>>(sql, [id, est]);
    if (!r) throw naoEncontrado('A remessa de desconto em folha');
    return resumo(r);
  }

  private static async itensDe(l: Leitor | Escritor, remessa: number): Promise<ItemRemessaFolhaLido[]> {
    const linhas = await l.consultar<Record<string, unknown>>(
      `SELECT i.sequencia, i.fatura_plano_id, f.numero, i.beneficiario_plano_id, i.matricula_funcional, f.competencia,
              i.valor_enviado, i.valor_atrasado, i.valor_descontado, i.situacao_retorno
         FROM remessa_desconto_folha_item i JOIN fatura_plano f ON f.id = i.fatura_plano_id
        WHERE i.remessa_desconto_folha_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
      [remessa],
    );
    return linhas.map((i) => ({
      sequencia: Number(i['sequencia']),
      fatura: Number(i['fatura_plano_id']),
      cobranca: textoObrigatorio(i['numero']),
      beneficiario: Number(i['beneficiario_plano_id']),
      matriculaFuncional: textoObrigatorio(i['matricula_funcional']),
      competencia: dataIso(i['competencia']) ?? '',
      valorEnviado: numero(i['valor_enviado']) ?? 0,
      valorAtrasado: numero(i['valor_atrasado']) ?? 0,
      valorDescontado: numero(i['valor_descontado']),
      situacao: textoObrigatorio(i['situacao_retorno']),
    }));
  }

  // ── leituras ──

  /** Contratantes da operadora com contrato que cobra por desconto em folha (busca remota por nome ou código). */
  contratantes(c: ContextoPorta, op: number, termo: string) {
    return this.ler(c, async (l, est) => {
      await PortaDescontoFolhaPropria.operadoraDoEst(l, est, op);
      const t = trechoLike(termo.trim());
      const linhas = await l.consultar<Record<string, unknown>>(
        `SELECT DISTINCT ct.id, ct.codigo, COALESCE(pj.razao_social, pf.nome, ct.codigo) AS nome
           FROM contratante_plano ct
           JOIN contrato_plano k ON k.contratante_plano_id = ct.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
           JOIN contrato_forma_cobranca cf ON cf.contrato_plano_id = k.id AND cf.ativo = TRUE
           JOIN forma_cobranca_plano fc ON fc.id = cf.forma_cobranca_plano_id AND fc.meio = 'desconto_folha'
           LEFT JOIN pessoa_juridica pj ON pj.id = ct.pessoa_juridica_id
           LEFT JOIN pessoa_fisica pf ON pf.id = ct.pessoa_fisica_id
          WHERE k.operadora_saude_id = ? AND (ct.codigo LIKE ? OR pj.razao_social LIKE ? OR pf.nome LIKE ?)
          ORDER BY nome, ct.id LIMIT 30`,
        [est, op, t, t, t],
      );
      return linhas.map((r) => ({
        id: Number(r['id']),
        codigo: textoObrigatorio(r['codigo']),
        nome: textoObrigatorio(r['nome']),
      }));
    });
  }

  remessas(c: ContextoPorta, op: number | null): Promise<RemessaFolhaResumo[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<Record<string, unknown>>(
        `${SELECT_REMESSA} WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL${op ? ' AND r.operadora_saude_id = ?' : ''}
          ORDER BY r.competencia DESC, r.id DESC LIMIT 200`,
        op ? [est, op] : [est],
      );
      return linhas.map(resumo);
    });
  }

  remessa(c: ContextoPorta, id: number) {
    return this.ler(c, async (l, est) => ({
      ...(await PortaDescontoFolhaPropria.remessaDoEst(l, est, id)),
      detalhe: await PortaDescontoFolhaPropria.itensDe(l, id),
    }));
  }

  /** A prévia da remessa da competência: os itens e as críticas, sem gravar nada. */
  previa(
    c: ContextoPorta,
    e: Pick<EntradaRemessaFolha, 'operadora' | 'contratante' | 'competencia'>,
  ): Promise<MontagemRemessaFolha> {
    return this.ler(c, async (l, est) => {
      await PortaDescontoFolhaPropria.operadoraDoEst(l, est, e.operadora);
      const cob = await PortaDescontoFolhaPropria.cobrancas(
        l,
        est,
        e.operadora,
        e.contratante,
        e.competencia,
      );
      return montarRemessaFolha(cob, e.competencia);
    });
  }

  /** O arquivo da remessa para a contratante (CSV do leiaute padrão). */
  arquivo(c: ContextoPorta, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await PortaDescontoFolhaPropria.remessaDoEst(l, est, id);
      if (r.situacao === 'cancelada') throw situacaoRecusada('A remessa cancelada não tem arquivo.');
      const itens = await PortaDescontoFolhaPropria.itensDe(l, id);
      const conteudo = arquivoRemessaFolha(
        r.competencia,
        itens.map<ItemRemessaFolha>((i) => ({ ...i, numero: i.cobranca, percentualFolha: null })),
      );
      return { nome: `desconto-folha-${r.numero}.csv`, tipoMime: 'text/csv', conteudo };
    });
  }

  // ── gravações ──

  gerar(c: Contexto, e: EntradaRemessaFolha, trilha: Trilha): Promise<Gravado> {
    return this.gravar(c, 'operadora.desconto-folha.gerar', trilha, async (tx, est) => {
      await PortaDescontoFolhaPropria.operadoraDoEst(tx, est, e.operadora);
      const competencia = inicioCompetenciaFolha(e.competencia);
      const [ja] = await tx.consultarParaAtualizar(
        `SELECT id FROM remessa_desconto_folha
          WHERE estabelecimento_id = ? AND contratante_plano_id = ? AND competencia = ? AND tipo_remessa = ?
            AND situacao <> 'cancelada' AND excluido_em IS NULL`,
        [est, e.contratante, competencia, e.tipo],
      );
      if (ja)
        throw recusa(
          'remessa-ja-gerada',
          'Já existe remessa desta contratante na competência: cancele-a antes.',
          {
            campos: ['competencia'],
          },
        );
      const m = montarRemessaFolha(
        await PortaDescontoFolhaPropria.cobrancas(tx, est, e.operadora, e.contratante, e.competencia),
        e.competencia,
      );
      if (!m.itens.length)
        throw recusa(
          'remessa-sem-itens',
          'Nenhuma cobrança da contratante entra no desconto em folha da competência.',
        );
      const agora = new Date();
      await garantirSequencia(
        tx,
        { tipo: 'remessa_desconto_folha', estabelecimento: est, prefixo: 'DF-' },
        { usuario: tx.contexto.usuario ?? null, agora },
      );
      const numeroRemessa = (await tx.proximoNumero('remessa_desconto_folha')).formatado;
      const id = await tx.incluir('remessa_desconto_folha', {
        estabelecimento_id: est,
        operadora_saude_id: e.operadora,
        contratante_plano_id: e.contratante,
        numero: numeroRemessa,
        competencia,
        tipo_remessa: e.tipo,
        situacao: 'gerada',
        gerada_em: agora,
        valor_enviado: m.valorTotal,
        valor_descontado: 0,
        observacao: e.observacao?.trim().slice(0, 1000) || null,
      });
      for (const i of m.itens)
        await tx.incluir('remessa_desconto_folha_item', {
          remessa_desconto_folha_id: id,
          sequencia: i.sequencia,
          beneficiario_plano_id: i.beneficiario,
          fatura_plano_id: i.fatura,
          matricula_funcional: i.matriculaFuncional,
          tipo_movimento: e.tipo === 'decimo_terceiro' ? 'decimo_terceiro' : 'desconto',
          percentual_folha: i.percentualFolha,
          valor_enviado: i.valorEnviado,
          valor_atrasado: i.valorAtrasado,
          situacao_retorno: 'pendente',
        });
      return { id, versao: 1 };
    });
  }

  private passar(
    c: Contexto,
    id: number,
    versao: number,
    para: SituacaoRemessaFolha,
    trilha: Trilha,
    extra: (r: RemessaFolhaResumo, tx: TxOperacao) => Promise<Record<string, unknown>>,
  ): Promise<Gravado> {
    return this.gravar(c, `operadora.desconto-folha.${para}`, trilha, async (tx, est) => {
      const r = await PortaDescontoFolhaPropria.remessaDoEst(tx, est, id, true);
      if (!podePassarRemessaFolha(r.situacao, para))
        throw situacaoRecusada(
          `A remessa ${r.situacao.replace('_', ' ')} não passa para ${para.replace('_', ' ')}.`,
        );
      const v = await tx.alterar('remessa_desconto_folha', id, versao, {
        situacao: para,
        ...(await extra(r, tx)),
      });
      return { id, versao: v };
    });
  }

  enviar(c: Contexto, id: number, versao: number, trilha: Trilha): Promise<Gravado> {
    return this.passar(c, id, versao, 'enviada', trilha, async () => ({ enviada_em: new Date() }));
  }

  conferir(c: Contexto, id: number, versao: number, trilha: Trilha): Promise<Gravado> {
    return this.passar(c, id, versao, 'conferida', trilha, async () => ({
      atrasos_validados_em: new Date(),
    }));
  }

  cancelar(c: Contexto, id: number, e: { versao: number; motivo: string }, trilha: Trilha): Promise<Gravado> {
    if (e.motivo.trim().length < 5)
      throw recusa('motivo-obrigatorio', 'Diga o motivo do cancelamento.', { campos: ['motivo'] });
    return this.passar(c, id, e.versao, 'cancelada', trilha, async () => ({
      observacao: `Cancelada: ${e.motivo.trim()}`.slice(0, 1000),
    }));
  }

  /**
   * Lê o retorno da contratante: concilia pelo domínio (recusa o retorno inteiro com os problemas, sem gravar nada),
   * grava o descontado em cada item e baixa as cobranças (paga quando quita, paga_parcial com o saldo em aberto), com
   * a data do crédito do repasse. O não descontado fica em aberto para a cobrança comum.
   */
  lerRetorno(
    c: Contexto,
    id: number,
    e: { versao: number; texto: string; creditoEm: string },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.passar(c, id, e.versao, 'retorno_recebido', trilha, async (r, tx) => {
      const lido = lerRetornoFolha(e.texto);
      const itens = await PortaDescontoFolhaPropria.itensDe(tx, id);
      const conc = conciliarRetornoFolha(itens, lido.linhas);
      const problemas: ProblemaRetornoFolha[] = [...lido.problemas, ...conc.problemas];
      if (problemas.length)
        throw recusa('retorno-com-problemas', problemas.map((p) => p.mensagem).join(' '), {
          campos: ['texto'],
          problemas,
        } as never);
      const ids = await tx.consultar<Record<string, unknown>>(
        'SELECT id, versao, sequencia FROM remessa_desconto_folha_item WHERE remessa_desconto_folha_id = ? AND excluido_em IS NULL',
        [id],
      );
      const porSeq = new Map(ids.map((x) => [Number(x['sequencia']), x]));
      for (const i of conc.itens) {
        const it = porSeq.get(i.sequencia)!;
        await tx.alterar('remessa_desconto_folha_item', Number(it['id']), Number(it['versao']), {
          valor_descontado: i.valorDescontado,
          situacao_retorno: i.situacao,
        });
        if (i.valorDescontado <= 0) continue;
        const [f] = await tx.consultarParaAtualizar(
          'SELECT id, versao, situacao, valor_total, valor_pago, observacao FROM fatura_plano WHERE id = ? AND excluido_em IS NULL',
          [i.fatura],
        );
        if (!f || !['aberta', 'emitida', 'paga_parcial'].includes(textoObrigatorio(f['situacao'])))
          throw recusa(
            'cobranca-nao-aberta',
            'Uma cobrança da remessa foi baixada ou cancelada por outro caminho.',
          );
        const pago = centavos((numero(f['valor_pago']) ?? 0) + i.valorDescontado);
        const nota = `Desconto em folha: remessa ${r.numero}, ${i.valorDescontado.toFixed(2)}`;
        await tx.alterar('fatura_plano', i.fatura, Number(f['versao']), {
          situacao: pago >= (numero(f['valor_total']) ?? 0) - 0.004 ? 'paga' : 'paga_parcial',
          valor_pago: pago,
          data_pagamento: e.creditoEm,
          observacao: [texto(f['observacao']), nota].filter(Boolean).join('\n').slice(-2000),
        });
      }
      return {
        retorno_lido_em: new Date(),
        retorno_linhas: lido.linhas.length,
        valor_descontado: conc.valorDescontado,
      };
    });
  }
}

export const METODOS_DESCONTO_FOLHA: ReadonlySet<string> = new Set([
  'contratantes',
  'remessas',
  'remessa',
  'previa',
  'arquivo',
  'gerar',
  'enviar',
  'conferir',
  'cancelar',
  'lerRetorno',
]);
