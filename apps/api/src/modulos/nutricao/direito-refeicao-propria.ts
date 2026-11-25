// Refeição do acompanhante pelo direito legal e pelas regras do convênio (F7, 04-HOT linha 133), no banco do cliente.
// Tabelas: `direito_refeicao_acompanhante` (+ `_refeicao`), `refeicao_acompanhante`, `preco_refeicao` (lida) e a conta
// pelo lançamento do faturamento (faturamento.lancarItem, na mesma transação). Contrato de efeito:
//   - regra: incluir (validada no domínio antes do banco; a do convênio pede a fonte pagadora), alterar com a versão
//     lida (+1; refeição retirada marcada excluída, nunca apagada; a que volta é restaurada) e tirar de uso/voltar
//     (`ativo` com a versão); nada é apagado;
//   - decisão (só leitura): para a internação, a data e a refeição, a regra que vale (domínio) com a idade do paciente
//     na data, a acomodação da internação, a fonte pagadora do atendimento e a base legal registrada na nutrição;
//   - lançar: grava a refeição com a regra aplicada e a cobertura: coberta (situação autorizada), a autorizar
//     (situação solicitada) ou cobrável (situação autorizada, cobrável, valor e conta): a cobrável lança o item do
//     preço da refeição na conta do atendimento pelo faturamento.lancarItem, com o preço da tabela da conta; a mesma
//     refeição do dia já lançada e não cancelada é recusada (409);
//   - autorizar: a fonte pagadora autoriza (coberta) ou nega (cobrável, com o lançamento na conta), com a versão;
//   - cancelar: a refeição ainda não lançada na conta vira cancelada com o motivo (nunca apagada); a já lançada é
//     recusada: o estorno é na conta.
import {
  decidirAutorizacao,
  decidirRefeicaoAcompanhante,
  type DecisaoRefeicao,
  FUNDAMENTOS_DIREITO_REFEICAO,
  idadeNaData,
  precoVigenteDaRefeicao,
  type RegraDireitoRefeicao,
  validarRegraDireitoRefeicao,
} from '@sgh/dominio-pep';
import { esquemaLancarItem } from '@sgh/contratos';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  type EstabelecimentoDaSessao,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import { lancarItem } from '../faturamento/operacoes.js';

export const PORTA_DIREITO_REFEICAO = Symbol('PORTA_DIREITO_REFEICAO');

const REGRA = 'direito_refeicao_acompanhante';
const REGRA_REFEICAO = 'direito_refeicao_acompanhante_refeicao';
const REFEICAO = 'refeicao_acompanhante';
const TABELAS = [REGRA, REGRA_REFEICAO, REFEICAO, ...lancarItem.tabelas];

type Linha = Record<string, unknown>;

export interface RegraLida extends RegraDireitoRefeicao {
  readonly fontePagadoraNome: string | null;
  readonly acomodacaoDescricao: string | null;
  readonly versao: number;
}

export interface RefeicaoLancada {
  readonly id: number;
  readonly data: string;
  readonly refeicao: number;
  readonly refeicaoDescricao: string | null;
  readonly quantidade: number;
  readonly situacao: string;
  readonly cobravel: boolean;
  readonly valor: number | null;
  readonly regra: number | null;
  readonly regraDescricao: string | null;
  readonly autorizadaPelaFonte: boolean;
  readonly conta: number | null;
  readonly observacao: string | null;
  readonly versao: number;
}

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaRegra = z
  .object({
    descricao: z.string().trim().min(1).max(150),
    fundamento: z.enum(FUNDAMENTOS_DIREITO_REFEICAO),
    fontePagadora: id.nullable(),
    acomodacao: id.nullable(),
    idadeMinima: z.number().int().min(0).max(150).nullable(),
    idadeMaxima: z.number().int().min(0).max(150).nullable(),
    cobertoPelaFonte: z.boolean(),
    exigeAutorizacao: z.boolean(),
    incluidoNaDiaria: z.boolean(),
    vigenciaInicio: data,
    vigenciaFim: data.nullable(),
    refeicoes: z.array(id).max(20),
  })
  .strict();
type EntradaRegra = z.infer<typeof esquemaRegra>;

const esquemaLancar = z
  .object({
    internacao: id,
    data,
    refeicao: id,
    quantidade: z.number().int().min(1).max(20),
    observacao: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** O grupo do lançamento do faturamento pelo tipo do item faturável. */
function grupoDoItem(tipo: string): 1 | 2 | 3 | 4 {
  if (tipo === 'honorario') return 2;
  if (tipo === 'procedimento' || tipo === 'servico') return 3;
  if (tipo === 'material' || tipo === 'medicamento' || tipo === 'opme') return 4;
  return 1;
}

/** "HH:MM" agora, no fuso do estabelecimento. */
function horaNoFuso(fuso: string): string {
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return f.format(new Date()).slice(0, 5);
}

const recusa = (status: number, codigo: string, titulo: string, detalhe: string, campos: string[] = []) =>
  new ErroOperacao(status, codigo, titulo, detalhe, { campos });

function regraDaLinha(x: Linha, refeicoes: readonly number[]): RegraLida {
  return {
    id: num(x['id']),
    descricao: String(x['descricao']),
    fundamento: String(x['fundamento']) as RegraDireitoRefeicao['fundamento'],
    fontePagadora: numOuNull(x['fonte_pagadora_id']),
    acomodacao: numOuNull(x['acomodacao_id']),
    idadeMinima: numOuNull(x['idade_paciente_minima']),
    idadeMaxima: numOuNull(x['idade_paciente_maxima']),
    cobertoPelaFonte: bool(x['coberto_pela_fonte']),
    exigeAutorizacao: bool(x['exige_autorizacao']),
    incluidoNaDiaria: bool(x['incluido_na_diaria']),
    vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(x['vigencia_fim']),
    ativo: bool(x['ativo']),
    refeicoes,
    fontePagadoraNome: txtOuNull(x['fonte_nome']),
    acomodacaoDescricao: txtOuNull(x['acomodacao_descricao']),
    versao: num(x['versao']),
  };
}

export class PortaDireitoRefeicaoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'nutricao.direito-refeicao');
  }

  private async regras(l: Leitor, est: number, so?: number): Promise<RegraLida[]> {
    const linhas = await l.consultar<Linha>(
      `SELECT d.id, d.descricao, d.fundamento, d.fonte_pagadora_id, d.acomodacao_id, d.idade_paciente_minima,
              d.idade_paciente_maxima, d.coberto_pela_fonte, d.exige_autorizacao, d.incluido_na_diaria,
              d.vigencia_inicio, d.vigencia_fim, d.ativo, d.versao, f.nome AS fonte_nome, a.nome AS acomodacao_descricao
         FROM direito_refeicao_acompanhante d
         LEFT JOIN fonte_pagadora f ON f.id = d.fonte_pagadora_id
         LEFT JOIN acomodacao a ON a.id = d.acomodacao_id
        WHERE d.estabelecimento_id = ?${so ? ' AND d.id = ?' : ''}
        ORDER BY d.ativo DESC, d.vigencia_inicio DESC, d.id DESC
        LIMIT 500`,
      so ? [est, so] : [est],
    );
    if (linhas.length === 0) return [];
    const ids = linhas.map((x) => num(x['id']));
    const refs = await l.consultar<Linha>(
      `SELECT direito_refeicao_acompanhante_id AS d, refeicao_do_dia_id AS r FROM direito_refeicao_acompanhante_refeicao
        WHERE excluido_em IS NULL AND direito_refeicao_acompanhante_id IN (${ids.map(() => '?').join(',')})
        ORDER BY sequencia`,
      ids,
    );
    const porRegra = new Map<number, number[]>();
    for (const x of refs) porRegra.set(num(x['d']), [...(porRegra.get(num(x['d'])) ?? []), num(x['r'])]);
    return linhas.map((x) => regraDaLinha(x, porRegra.get(num(x['id'])) ?? []));
  }

  listar(c: ContextoPortaPropria): Promise<RegraLida[]> {
    return this.ler(c, 'listar', (l, est) => this.regras(l, est.id));
  }

  /** As escolhas da tela por nome: fontes pagadoras, acomodações e refeições do dia. */
  apoio(c: ContextoPortaPropria) {
    return this.ler(c, 'apoio', async (l, est) => {
      const lista = async (sql: string, args: unknown[] = []) =>
        (await l.consultar<Linha>(sql, args)).map((x) => ({
          id: num(x['id']),
          descricao: String(x['descricao']),
        }));
      return {
        fontes: await lista(
          "SELECT id, nome AS descricao FROM fonte_pagadora WHERE situacao = 'ativa' ORDER BY nome LIMIT 500",
        ),
        acomodacoes: await lista(
          `SELECT id, CONCAT(codigo, ' - ', nome) AS descricao FROM acomodacao
            WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY codigo LIMIT 300`,
          [est.id],
        ),
        refeicoes: await lista(
          'SELECT id, descricao FROM refeicao_do_dia WHERE ativo ORDER BY ordem, id LIMIT 30',
        ),
      };
    });
  }

  private async conferirRegra(tx: Leitor, est: number, e: EntradaRegra): Promise<void> {
    const problemas = validarRegraDireitoRefeicao(e);
    if (problemas.length) throw recusaRegra('Regra do direito à refeição inválida', problemas);
    if (
      e.fontePagadora !== null &&
      !(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ?', [e.fontePagadora]))
    )
      throw naoEncontrado('Fonte pagadora');
    if (
      e.acomodacao !== null &&
      !(await tx.uma('SELECT id FROM acomodacao WHERE id = ? AND estabelecimento_id = ?', [
        e.acomodacao,
        est,
      ]))
    )
      throw naoEncontrado('Acomodação');
    for (const r of e.refeicoes)
      if (!(await tx.uma('SELECT id FROM refeicao_do_dia WHERE id = ?', [r])))
        throw naoEncontrado('Refeição do dia');
  }

  private colunas(e: EntradaRegra) {
    return {
      descricao: e.descricao,
      fundamento: e.fundamento,
      fonte_pagadora_id: e.fontePagadora,
      acomodacao_id: e.acomodacao,
      idade_paciente_minima: e.idadeMinima,
      idade_paciente_maxima: e.idadeMaxima,
      coberto_pela_fonte: e.cobertoPelaFonte,
      exige_autorizacao: e.exigeAutorizacao,
      incluido_na_diaria: e.incluidoNaDiaria,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    };
  }

  async incluir(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRegra, entrada);
    return this.gravar(c, 'nutricao.direito-refeicao.incluir', [REGRA, REGRA_REFEICAO], async (tx, est) => {
      await this.conferirRegra(tx, est.id, e);
      const novo = await tx.incluir(REGRA, { estabelecimento_id: est.id, ...this.colunas(e), ativo: true });
      for (const [k, r] of [...new Set(e.refeicoes)].entries())
        await tx.incluir(REGRA_REFEICAO, {
          direito_refeicao_acompanhante_id: novo,
          sequencia: k + 1,
          refeicao_do_dia_id: r,
        });
      return { tabela: REGRA, id: novo };
    });
  }

  private async daSessao(tx: Leitor, est: number, idRegra: number): Promise<void> {
    if (
      !(await tx.uma('SELECT id FROM direito_refeicao_acompanhante WHERE id = ? AND estabelecimento_id = ?', [
        idRegra,
        est,
      ]))
    )
      throw naoEncontrado('Regra do direito à refeição');
  }

  async alterar(c: ContextoPortaPropria, idRegra: number, entrada: unknown): Promise<{ id: number }> {
    const { versao, ...e } = entradaValida(esquemaRegra.extend({ versao: id }).strict(), entrada);
    return this.gravar(
      c,
      'nutricao.direito-refeicao.alterar',
      [REGRA, REGRA_REFEICAO],
      async (tx, est, u) => {
        await this.daSessao(tx, est.id, idRegra);
        await this.conferirRegra(tx, est.id, e);
        await tx.alterar(REGRA, idRegra, versao, this.colunas(e));
        const todas = await tx.consultar<Linha>(
          `SELECT id, sequencia, refeicao_do_dia_id, versao, excluido_em FROM direito_refeicao_acompanhante_refeicao
          WHERE direito_refeicao_acompanhante_id = ?`,
          [idRegra],
        );
        const quero = new Set(e.refeicoes);
        let proxima = todas.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0) + 1;
        for (const x of todas) {
          const vivo = x['excluido_em'] === null;
          const fica = quero.has(num(x['refeicao_do_dia_id']));
          if (vivo && !fica)
            await tx.alterar(REGRA_REFEICAO, num(x['id']), num(x['versao']), {
              excluido_em: new Date(),
              excluido_por: u,
            });
          if (!vivo && fica)
            await tx.alterar(REGRA_REFEICAO, num(x['id']), num(x['versao']), {
              excluido_em: null,
              excluido_por: null,
            });
          quero.delete(num(x['refeicao_do_dia_id']));
        }
        for (const r of quero)
          await tx.incluir(REGRA_REFEICAO, {
            direito_refeicao_acompanhante_id: idRegra,
            sequencia: proxima++,
            refeicao_do_dia_id: r,
          });
        return { tabela: REGRA, id: idRegra };
      },
    );
  }

  /** Tira de uso ou volta ao uso (nunca apaga). */
  async definirUso(c: ContextoPortaPropria, idRegra: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(z.object({ ativo: z.boolean(), versao: id }).strict(), entrada);
    return this.gravar(c, 'nutricao.direito-refeicao.uso', [REGRA], async (tx, est) => {
      await this.daSessao(tx, est.id, idRegra);
      await tx.alterar(REGRA, idRegra, x.versao, { ativo: x.ativo });
      return { tabela: REGRA, id: idRegra };
    });
  }

  /** A internação do estabelecimento com o que a decisão usa (atendimento, fonte, acomodação, idade, base legal). */
  private async situacao(l: Leitor, est: number, internacao: number, dia: string) {
    const i = await l.uma<Linha>(
      `SELECT i.id, i.atendimento_id, i.acomodacao_id, a.fonte_pagadora_id, pf.data_nascimento
         FROM internacao i
         JOIN atendimento a ON a.id = i.atendimento_id
         JOIN paciente p ON p.id = i.paciente_id
         JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
      [internacao, est],
    );
    if (!i) throw naoEncontrado('Internação');
    const legal = await l.uma<Linha>(
      `SELECT id, acompanhante_internacao_id, direito_legal FROM plano_refeicao_acompanhante
        WHERE internacao_id = ? AND estabelecimento_id = ? AND situacao = 'ativa' AND excluido_em IS NULL
          AND DATE(inicio_em) <= ? AND (fim_em IS NULL OR DATE(fim_em) >= ?)
        ORDER BY id DESC LIMIT 1`,
      [internacao, est, dia, dia],
    );
    return {
      atendimento: num(i['atendimento_id']),
      fontePagadora: numOuNull(i['fonte_pagadora_id']),
      acomodacao: numOuNull(i['acomodacao_id']),
      idade: idadeNaData(dataIso(i['data_nascimento']), dia),
      baseLegal: txtOuNull(legal?.['direito_legal']),
      acompanhante: numOuNull(legal?.['acompanhante_internacao_id']),
    };
  }

  private async decidirEm(l: Leitor, est: number, internacao: number, dia: string, refeicao: number) {
    const s = await this.situacao(l, est, internacao, dia);
    const regras = await this.regras(l, est);
    const decisao = decidirRefeicaoAcompanhante(regras, {
      data: dia,
      refeicao,
      fontePagadora: s.fontePagadora,
      acomodacao: s.acomodacao,
      idadePaciente: s.idade,
      direitoLegal: s.baseLegal !== null,
    });
    return { s, decisao };
  }

  /** A decisão para a tela, antes de lançar (só leitura). */
  decidir(c: ContextoPortaPropria, internacao: number, dia: string, refeicao: number) {
    return this.ler(c, 'decidir', async (l, est) => {
      const { s, decisao } = await this.decidirEm(l, est.id, internacao, dia, refeicao);
      const regra = decisao.regra ? ((await this.regras(l, est.id, decisao.regra))[0] ?? null) : null;
      return {
        ...decisao,
        regraDescricao: regra?.descricao ?? null,
        idadePaciente: s.idade,
        baseLegal: s.baseLegal,
      };
    });
  }

  /** As refeições lançadas do acompanhante da internação (todas, com as canceladas). */
  refeicoesDaInternacao(c: ContextoPortaPropria, internacao: number): Promise<RefeicaoLancada[]> {
    return this.ler(c, 'refeicoes', async (l, est) => {
      const i = await l.uma<Linha>(
        'SELECT atendimento_id FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [internacao, est.id],
      );
      if (!i) throw naoEncontrado('Internação');
      const linhas = await l.consultar<Linha>(
        `SELECT r.id, r.data_refeicao, r.refeicao_do_dia_id, rd.descricao AS refeicao_descricao, r.quantidade,
                r.situacao, r.cobravel, r.valor, r.direito_refeicao_acompanhante_id, d.descricao AS regra_descricao,
                r.autorizada_pela_fonte_pagadora, r.conta_hospitalar_id, r.observacao, r.versao
           FROM refeicao_acompanhante r
           LEFT JOIN refeicao_do_dia rd ON rd.id = r.refeicao_do_dia_id
           LEFT JOIN direito_refeicao_acompanhante d ON d.id = r.direito_refeicao_acompanhante_id
          WHERE r.atendimento_id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL
          ORDER BY r.data_refeicao DESC, rd.ordem DESC, r.id DESC LIMIT 300`,
        [num(i['atendimento_id']), est.id],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        data: dataIso(x['data_refeicao']) ?? '',
        refeicao: num(x['refeicao_do_dia_id']),
        refeicaoDescricao: txtOuNull(x['refeicao_descricao']),
        quantidade: num(x['quantidade']),
        situacao: String(x['situacao']),
        cobravel: bool(x['cobravel']),
        valor: x['valor'] === null ? null : Number(x['valor']),
        regra: numOuNull(x['direito_refeicao_acompanhante_id']),
        regraDescricao: txtOuNull(x['regra_descricao']),
        autorizadaPelaFonte: bool(x['autorizada_pela_fonte_pagadora']),
        conta: numOuNull(x['conta_hospitalar_id']),
        observacao: txtOuNull(x['observacao']),
        versao: num(x['versao']),
      }));
    });
  }

  /**
   * A cobrança na conta do atendimento: o item do preço vigente da refeição (o do convênio antes do geral), lançado
   * pelo faturamento.lancarItem com o preço da tabela da conta. Devolve a conta e o valor do item.
   */
  private async cobrar(
    tx: TxOperacao,
    est: EstabelecimentoDaSessao,
    atendimento: number,
    fonte: number | null,
    dia: string,
    refeicao: number,
    quantidade: number,
  ): Promise<{ conta: number; valor: number; preco: number }> {
    const vinculo = await tx.uma<Linha>(
      `SELECT c.id FROM conta_hospitalar c
        WHERE c.estabelecimento_id = ? AND c.situacao <> 'cancelada' AND c.excluido_em IS NULL
          AND (c.atendimento_id = ? OR c.id IN (SELECT ac.conta_hospitalar_id FROM atendimento_conta ac
                                                  WHERE ac.atendimento_id = ? AND ac.excluido_em IS NULL))
        ORDER BY c.id DESC LIMIT 1`,
      [est.id, atendimento, atendimento],
    );
    if (!vinculo)
      throw recusa(
        409,
        'atendimento-sem-conta',
        'Atendimento sem conta',
        'A refeição é cobrável e o atendimento não tem conta aberta: abra a conta antes de lançar.',
      );
    const conta = num(vinculo['id']);
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [conta], { teto: 1 });
    const precos = (
      await tx.consultar<Linha>(
        `SELECT id, fonte_pagadora_id, item_faturavel_id, valor, vigencia_inicio, vigencia_fim FROM preco_refeicao
          WHERE estabelecimento_id = ? AND refeicao_do_dia_id = ?`,
        [est.id, refeicao],
      )
    ).map((x) => ({
      id: num(x['id']),
      fontePagadora: numOuNull(x['fonte_pagadora_id']),
      itemFaturavel: numOuNull(x['item_faturavel_id']),
      valor: Number(x['valor']),
      vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
      vigenciaFim: dataIso(x['vigencia_fim']),
    }));
    const preco = precoVigenteDaRefeicao(precos, fonte, dia);
    if (!preco || preco.itemFaturavel === null)
      throw recusa(
        422,
        'refeicao-sem-preco',
        'Refeição sem preço',
        'A refeição é cobrável e não tem preço vigente com o item da conta: cadastre o preço da refeição.',
        ['refeicao'],
      );
    const item = await tx.uma<Linha>('SELECT codigo, tipo_item FROM item_faturavel WHERE id = ?', [
      preco.itemFaturavel,
    ]);
    if (!item) throw naoEncontrado('Item faturável do preço da refeição');
    // O lançamento na conta identifica o item pelo código numérico do grupo (esquemaLancarItem).
    const codigo = Number(item['codigo']);
    if (!Number.isSafeInteger(codigo) || codigo <= 0)
      throw recusa(
        422,
        'item-sem-codigo-de-conta',
        'Item sem código de lançamento',
        'O item faturável do preço da refeição não tem código numérico para a conta: corrija o preço da refeição.',
        ['refeicao'],
      );
    const r = await lancarItem.gravar(
      tx,
      esquemaLancarItem.parse({
        conta,
        tipo: grupoDoItem(String(item['tipo_item'])),
        codigo,
        quantidade,
        data: dia,
        hora: horaNoFuso(est.fuso),
        local: 0,
        ato: 0,
        executante: null,
      }),
      tx.contexto,
    );
    const lancado = await tx.uma<Linha>('SELECT valor_total FROM conta_hospitalar_item WHERE id = ?', [
      Number(r['id']),
    ]);
    return { conta, valor: Number(lancado?.['valor_total'] ?? 0), preco: preco.id };
  }

  async lancar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; cobertura: DecisaoRefeicao['cobertura']; motivo: string; valor: number | null }> {
    const e = entradaValida(esquemaLancar, entrada);
    return this.gravar(c, 'nutricao.refeicao-acompanhante.lancar', TABELAS, async (tx, est, u) => {
      if (!(await tx.uma('SELECT id FROM refeicao_do_dia WHERE id = ? AND ativo', [e.refeicao])))
        throw naoEncontrado('Refeição do dia');
      const { s, decisao } = await this.decidirEm(tx, est.id, e.internacao, e.data, e.refeicao);
      const repetida = await tx.consultarParaAtualizar(
        `SELECT id FROM refeicao_acompanhante
          WHERE atendimento_id = ? AND data_refeicao = ? AND refeicao_do_dia_id = ? AND situacao <> 'cancelada'
            AND excluido_em IS NULL`,
        [s.atendimento, e.data, e.refeicao],
      );
      if (repetida.length > 0)
        throw recusa(
          409,
          'refeicao-repetida',
          'Refeição já lançada',
          'Esta refeição do acompanhante já foi lançada no dia: cancele a anterior para lançar de novo.',
          ['refeicao'],
        );
      const cobranca =
        decisao.cobertura === 'cobravel'
          ? await this.cobrar(tx, est, s.atendimento, s.fontePagadora, e.data, e.refeicao, e.quantidade)
          : null;
      const novo = await tx.incluir(REFEICAO, {
        estabelecimento_id: est.id,
        atendimento_id: s.atendimento,
        acompanhante_internacao_id: s.acompanhante,
        data_refeicao: e.data,
        refeicao_do_dia_id: e.refeicao,
        quantidade: e.quantidade,
        direito_refeicao_acompanhante_id: decisao.regra,
        fonte_pagadora_id: s.fontePagadora,
        autorizada_pela_fonte_pagadora: false,
        autorizador_usuario_id: decisao.cobertura === 'a_autorizar' ? null : u,
        autorizada_em: decisao.cobertura === 'a_autorizar' ? null : new Date(),
        situacao: decisao.cobertura === 'a_autorizar' ? 'solicitada' : 'autorizada',
        cobravel: cobranca !== null,
        preco_refeicao_id: cobranca?.preco ?? null,
        valor: cobranca?.valor ?? null,
        conta_hospitalar_id: cobranca?.conta ?? null,
        observacao: e.observacao?.trim() || null,
      });
      return {
        tabela: REFEICAO,
        id: novo,
        cobertura: decisao.cobertura,
        motivo: decisao.motivo,
        valor: cobranca?.valor ?? null,
      };
    });
  }

  private async refeicaoDaSessao(tx: TxOperacao, est: number, idRefeicao: number) {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT r.id, r.atendimento_id, r.data_refeicao, r.refeicao_do_dia_id, r.quantidade, r.situacao, r.versao,
              r.conta_hospitalar_id, r.fonte_pagadora_id, r.observacao
         FROM refeicao_acompanhante r
        WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
      [idRefeicao, est],
    );
    if (!r) throw naoEncontrado('Refeição do acompanhante');
    return r;
  }

  /** A fonte pagadora autoriza (coberta) ou nega (cobrável: vai para a conta). */
  async autorizar(c: ContextoPortaPropria, idRefeicao: number, entrada: unknown) {
    const x = entradaValida(z.object({ autorizada: z.boolean(), versao: id }).strict(), entrada);
    return this.gravar(c, 'nutricao.refeicao-acompanhante.autorizar', TABELAS, async (tx, est, u) => {
      const r = await this.refeicaoDaSessao(tx, est.id, idRefeicao);
      if (String(r['situacao']) !== 'solicitada')
        throw recusa(
          409,
          'refeicao-ja-decidida',
          'Refeição já decidida',
          'A refeição não está à espera da autorização da fonte pagadora.',
        );
      const cobertura = decidirAutorizacao(x.autorizada);
      const cobranca =
        cobertura === 'cobravel'
          ? await this.cobrar(
              tx,
              est,
              num(r['atendimento_id']),
              numOuNull(r['fonte_pagadora_id']),
              dataIso(r['data_refeicao']) ?? '',
              num(r['refeicao_do_dia_id']),
              num(r['quantidade']),
            )
          : null;
      await tx.alterar(REFEICAO, idRefeicao, x.versao, {
        situacao: 'autorizada',
        autorizada_pela_fonte_pagadora: x.autorizada,
        autorizador_usuario_id: u,
        autorizada_em: new Date(),
        cobravel: cobranca !== null,
        preco_refeicao_id: cobranca?.preco ?? null,
        valor: cobranca?.valor ?? null,
        conta_hospitalar_id: cobranca?.conta ?? null,
      });
      return { tabela: REFEICAO, id: idRefeicao, cobertura, valor: cobranca?.valor ?? null };
    });
  }

  /** Cancela a refeição ainda não lançada na conta (nunca apaga). */
  async cancelar(c: ContextoPortaPropria, idRefeicao: number, entrada: unknown) {
    const x = entradaValida(
      z.object({ motivo: z.string().trim().min(3).max(400), versao: id }).strict(),
      entrada,
    );
    return this.gravar(c, 'nutricao.refeicao-acompanhante.cancelar', [REFEICAO], async (tx, est) => {
      const r = await this.refeicaoDaSessao(tx, est.id, idRefeicao);
      if (String(r['situacao']) === 'cancelada')
        throw recusa(409, 'refeicao-cancelada', 'Refeição já cancelada', 'A refeição já foi cancelada.');
      if (r['conta_hospitalar_id'] !== null)
        throw recusa(
          409,
          'refeicao-na-conta',
          'Refeição já na conta',
          'A refeição já foi lançada na conta: o estorno é feito na conta.',
        );
      await tx.alterar(REFEICAO, idRefeicao, x.versao, {
        situacao: 'cancelada',
        observacao: [txtOuNull(r['observacao']), `Cancelada: ${x.motivo}`]
          .filter(Boolean)
          .join(' | ')
          .slice(0, 500),
      });
      return { tabela: REFEICAO, id: idRefeicao };
    });
  }
}
