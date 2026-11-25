// Porta PRÓPRIA da fila com o sistema de gestão corporativo (ERP) do hospital (F8, 08-INTG L136), sobre o banco do
// cliente. As regras são do @sgh/dominio-integracao (fila-erp.ts); aqui ficam as leituras e as gravações:
//   - GERAR o lote de um tipo (contas a pagar, contas a receber, estoque, compras, faturamento) a partir do que já
//     existe no financeiro (titulo_pagar, titulo_receber), em suprimentos (movimento_estoque, pedido_compra) e no
//     faturamento (fatura_fonte_pagadora), no layout canônico; o registro já posto num lote vivo do mesmo ERP não vai
//     de novo (o rejeitado pode ir num lote novo); o número do lote sai da sequência de negócio;
//   - ENVIAR o lote ao ERP pelo adaptador (fora de produção, o simulador: nada sai para fora) e aplicar o retorno;
//   - IMPORTAR o retorno do ERP item a item, idempotente (o mesmo retorno duas vezes não muda nada);
//   - CONCILIAR (todo item resolvido e, se o ERP informou o total aceito, o valor confere) e CANCELAR antes do envio
//     com o motivo. Nada é apagado: o item do lote cancelado fica como ignorado.
import {
  aplicarRetornoErp,
  conferirConciliacaoErp,
  conferirGeracaoLoteErp,
  ENTIDADE_FILA_ERP,
  type ItemAtualErp,
  montarLoteErp,
  podeTransitarLoteErp,
  type RegistroOrigemErp,
  type RetornoItemErp,
  simularRetornoErp,
  type SituacaoItemErp,
  type SituacaoLoteErp,
  TIPO_LOTE_ERP,
  TIPOS_FILA_ERP,
  type TipoFilaErp,
} from '@sgh/dominio-integracao';
import { envioExternoPermitido, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  BaseComunicacaoPropria,
  bool,
  conflito,
  type ContextoComunicacao,
  dataOuNull,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  recusa,
  txtOuNull,
} from './comunicacao-base-propria.js';

export const PORTA_FILA_ERP = Symbol('PORTA_FILA_ERP');

const T_LOTE = 'exportacao_erp';
const T_ITEM = 'exportacao_erp_item';
const T_SEQ = 'sequencia_negocio';
export const TABELAS_FILA_ERP = [T_LOTE, T_ITEM, T_SEQ] as const;
const TIPO_SEQUENCIA = 'exportacao_erp';

export const OPERACOES_FILA_ERP = {
  gerar: 'integracao.fila_erp.gerar',
  enviar: 'integracao.fila_erp.enviar',
  retorno: 'integracao.fila_erp.retorno',
  conciliar: 'integracao.fila_erp.conciliar',
  cancelar: 'integracao.fila_erp.cancelar',
} as const;

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const esquemaGerarLoteErp = z
  .object({ tipo: z.enum(TIPOS_FILA_ERP), sistema: z.string().min(1).max(40), inicio: DATA, fim: DATA })
  .strict();
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();
export const esquemaRetornoErp = z
  .object({
    itens: z
      .array(
        z
          .object({
            sequencia: z.number().int().positive(),
            aceito: z.boolean(),
            chaveExterna: z.string().max(100).nullable(),
            mensagem: z.string().max(1000).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
  })
  .strict();
export const esquemaConciliarErp = z
  .object({
    versao: z.number().int().positive(),
    valorInformado: z.number().nonnegative().nullable(),
    observacao: z.string().max(1000).nullable(),
  })
  .strict();
export const esquemaCancelarErp = z
  .object({ versao: z.number().int().positive(), motivo: z.string().trim().min(10).max(1000) })
  .strict();

/** O adaptador de um ERP: recebe o lote canônico e devolve o retorno item a item. */
export interface AdaptadorErp {
  enviar(lote: {
    numero: string;
    tipo: TipoFilaErp;
    itens: readonly { sequencia: number; cpfCnpj: string | null; valor: number | null; conteudo: unknown }[];
  }): Promise<{ protocolo: string; itens: RetornoItemErp[] }>;
}

/** O simulador do ERP (fora de produção): nada sai para fora. */
export const adaptadorErpSimulado: AdaptadorErp = {
  enviar: async (l) => ({
    protocolo: `SIM-${l.numero}`,
    itens: simularRetornoErp(l.numero, l.tipo, l.itens),
  }),
};

// Os registros de origem de cada tipo, no período (o SQL é literal: o gerador de privilégios lê as tabelas).
const SQL_ORIGEM: Readonly<Record<TipoFilaErp, string>> = {
  pagar: `SELECT t.id, t.numero, t.numero_documento AS documento, t.data_emissao AS data, t.valor_liquido AS valor,
            COALESCE(f.cnpj, f.cpf) AS cpf_cnpj, f.razao_social AS contraparte, t.situacao, NULL AS conta_contabil_id,
            t.centro_custo_id
          FROM titulo_pagar t LEFT JOIN empresa_fornecedora f ON f.id = t.empresa_fornecedora_id
          WHERE t.estabelecimento_id = ? AND t.data_emissao BETWEEN ? AND ? AND t.excluido_em IS NULL
            AND t.situacao <> 'cancelado' ORDER BY t.data_emissao, t.id LIMIT 20000`,
  receber: `SELECT t.id, t.numero, t.numero_documento AS documento, t.data_emissao AS data, t.valor_liquido AS valor,
            COALESCE(pj.cnpj, pf.cpf) AS cpf_cnpj, fp.nome AS contraparte, t.situacao, NULL AS conta_contabil_id,
            t.centro_custo_id
          FROM titulo_receber t
            LEFT JOIN fonte_pagadora fp ON fp.id = t.fonte_pagadora_id
            LEFT JOIN pessoa_juridica pj ON pj.id = fp.pessoa_juridica_id
            LEFT JOIN paciente p ON p.id = t.paciente_id
            LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE t.estabelecimento_id = ? AND t.data_emissao BETWEEN ? AND ? AND t.excluido_em IS NULL
            AND t.situacao <> 'cancelado' ORDER BY t.data_emissao, t.id LIMIT 20000`,
  estoque: `SELECT m.id, CONCAT('MOV-', m.id) AS numero, NULL AS documento, DATE(m.ocorrido_em) AS data,
            m.valor_total AS valor, NULL AS cpf_cnpj, NULL AS contraparte, m.natureza AS situacao,
            NULL AS conta_contabil_id, m.centro_custo_id
          FROM movimento_estoque m
          WHERE m.estabelecimento_id = ? AND m.ocorrido_em >= ? AND m.ocorrido_em < DATE_ADD(?, INTERVAL 1 DAY)
            AND m.excluido_em IS NULL ORDER BY m.ocorrido_em, m.id LIMIT 20000`,
  compras: `SELECT pc.id, CONCAT(pc.ano, '/', pc.numero) AS numero, pc.numero_pedido_portal AS documento,
            pc.data_pedido AS data, pc.valor_total AS valor, COALESCE(f.cnpj, f.cpf) AS cpf_cnpj,
            f.razao_social AS contraparte, pc.situacao, pc.conta_contabil_id, pc.centro_custo_id
          FROM pedido_compra pc JOIN empresa_fornecedora f ON f.id = pc.empresa_fornecedora_id
          WHERE pc.estabelecimento_id = ? AND pc.data_pedido BETWEEN ? AND ? AND pc.excluido_em IS NULL
            AND pc.situacao IN ('aprovado','enviado','parcialmente_recebido','recebido')
          ORDER BY pc.data_pedido, pc.id LIMIT 20000`,
  faturamento: `SELECT fa.id, fa.numero, fa.numero_remessa_fonte_pagadora AS documento, fa.data_abertura AS data,
            fa.valor_apresentado + fa.valor_acrescimo - fa.valor_desconto AS valor, pj.cnpj AS cpf_cnpj,
            fp.nome AS contraparte, fa.situacao, NULL AS conta_contabil_id, NULL AS centro_custo_id
          FROM fatura_fonte_pagadora fa
            JOIN fonte_pagadora fp ON fp.id = fa.fonte_pagadora_id
            LEFT JOIN pessoa_juridica pj ON pj.id = fp.pessoa_juridica_id
          WHERE fa.estabelecimento_id = ? AND fa.data_abertura BETWEEN ? AND ? AND fa.excluido_em IS NULL
            AND fa.situacao NOT IN ('aberta','cancelada') ORDER BY fa.data_abertura, fa.id LIMIT 20000`,
};

const SQL_JA_EXPORTADOS = `SELECT DISTINCT i.entidade_id FROM exportacao_erp_item i
  JOIN exportacao_erp e ON e.id = i.exportacao_erp_id
  WHERE e.estabelecimento_id = ? AND e.sistema_externo_id = ? AND e.tipo = ? AND e.situacao <> 'cancelado'
    AND e.excluido_em IS NULL AND i.excluido_em IS NULL AND i.entidade = ? AND i.situacao IN ('pendente','exportado')`;

const SQL_LOTE = `SELECT e.id, e.numero, e.tipo, e.direcao, e.situacao, e.periodo_inicio, e.periodo_fim,
    e.quantidade_registros, e.quantidade_erros, e.valor_total, e.protocolo_externo, e.gerado_em, e.enviado_em,
    e.processado_em, e.conciliado_em, e.observacao, e.versao, s.codigo AS sistema, s.nome AS sistema_nome
  FROM exportacao_erp e JOIN sistema_externo s ON s.id = e.sistema_externo_id
  WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL`;

const SQL_ITENS = `SELECT id, sequencia, entidade, entidade_id, numero_documento, data_documento, valor, situacao,
    chave_externa, mensagem_retorno, cpf_cnpj, conteudo, versao
  FROM exportacao_erp_item WHERE exportacao_erp_id = ? AND excluido_em IS NULL ORDER BY sequencia`;

const TIPO_DO_LOTE = Object.fromEntries(Object.entries(TIPO_LOTE_ERP).map(([k, v]) => [v, k])) as Record<
  string,
  TipoFilaErp
>;

export interface SistemaErp {
  readonly codigo: string;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface LoteErpLido {
  readonly id: number;
  readonly numero: string;
  readonly tipo: TipoFilaErp | null;
  readonly situacao: SituacaoLoteErp;
  readonly sistema: string;
  readonly sistemaNome: string;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly quantidade: number;
  readonly erros: number;
  readonly valorTotal: number | null;
  readonly protocolo: string | null;
  readonly geradoEm: string | null;
  readonly enviadoEm: string | null;
  readonly processadoEm: string | null;
  readonly conciliadoEm: string | null;
  readonly observacao: string | null;
  readonly versao: number;
}

export interface ItemErpLido {
  readonly id: number;
  readonly sequencia: number;
  readonly entidade: string;
  readonly entidadeId: number | null;
  readonly documento: string | null;
  readonly data: string | null;
  readonly valor: number | null;
  readonly situacao: SituacaoItemErp;
  readonly chaveExterna: string | null;
  readonly mensagem: string | null;
}

const dia = (v: unknown): string | null =>
  v === null || v === undefined ? null : dataOuNull(v)!.slice(0, 10);

function lote(r: Record<string, unknown>): LoteErpLido {
  return {
    id: num(r['id']),
    numero: String(r['numero']),
    tipo: TIPO_DO_LOTE[String(r['tipo'])] ?? null,
    situacao: String(r['situacao']) as SituacaoLoteErp,
    sistema: String(r['sistema']),
    sistemaNome: String(r['sistema_nome']),
    inicio: dia(r['periodo_inicio']),
    fim: dia(r['periodo_fim']),
    quantidade: num(r['quantidade_registros']),
    erros: num(r['quantidade_erros']),
    valorTotal: numOuNull(r['valor_total']),
    protocolo: txtOuNull(r['protocolo_externo']),
    geradoEm: dataOuNull(r['gerado_em']),
    enviadoEm: dataOuNull(r['enviado_em']),
    processadoEm: dataOuNull(r['processado_em']),
    conciliadoEm: dataOuNull(r['conciliado_em']),
    observacao: txtOuNull(r['observacao']),
    versao: num(r['versao']),
  };
}

const item = (r: Record<string, unknown>): ItemErpLido => ({
  id: num(r['id']),
  sequencia: num(r['sequencia']),
  entidade: String(r['entidade']),
  entidadeId: numOuNull(r['entidade_id']),
  documento: txtOuNull(r['numero_documento']),
  data: dia(r['data_documento']),
  valor: numOuNull(r['valor']),
  situacao: String(r['situacao']) as SituacaoItemErp,
  chaveExterna: txtOuNull(r['chave_externa']),
  mensagem: txtOuNull(r['mensagem_retorno']),
});

const atual = (r: Record<string, unknown>): ItemAtualErp => ({
  sequencia: num(r['sequencia']),
  situacao: String(r['situacao']) as SituacaoItemErp,
  chaveExterna: txtOuNull(r['chave_externa']),
  valor: numOuNull(r['valor']),
});

const transicaoRecusada = (de: string, para: string) =>
  recusa([
    { campo: 'situacao', codigo: 'transicao-invalida', mensagem: `O lote ${de} não pode ir a ${para}.` },
  ]);

export interface ResultadoRetornoGravado {
  readonly id: number;
  readonly situacao: SituacaoLoteErp;
  readonly alterados: number;
  readonly repetidos: number;
  readonly desconhecidos: readonly number[];
  readonly conflitos: readonly number[];
}

export class PortaFilaErpPropria extends BaseComunicacaoPropria {
  /**
   * Fora de produção (AMBIENTE diferente de producao, regra 6), sempre o simulador; em produção, o adaptador configurado
   * (sem ele, o envio é recusado). NODE_ENV não decide.
   */
  adaptador: AdaptadorErp | null = envioExternoPermitido(process.env) ? null : adaptadorErpSimulado;

  sistemas(c: ContextoComunicacao): Promise<SistemaErp[]> {
    return this.ler(c, 'filaErp.sistemas', async (l) =>
      (
        await l.consultar(
          "SELECT codigo, nome, ativo FROM sistema_externo WHERE categoria = 'erp' AND excluido_em IS NULL ORDER BY nome LIMIT 100",
          [],
          { teto: 100 },
        )
      ).map((r) => ({ codigo: String(r['codigo']), nome: String(r['nome']), ativo: bool(r['ativo']) })),
    );
  }

  lotes(
    c: ContextoComunicacao,
    filtro: { tipo: TipoFilaErp | null; situacao: string | null },
  ): Promise<LoteErpLido[]> {
    return this.ler(c, 'filaErp.lotes', async (l, est) =>
      (
        await l.consultar(
          `${SQL_LOTE} AND (? IS NULL OR e.tipo = ?) AND (? IS NULL OR e.situacao = ?) ORDER BY e.id DESC LIMIT 200`,
          [
            est,
            filtro.tipo ? TIPO_LOTE_ERP[filtro.tipo] : null,
            filtro.tipo ? TIPO_LOTE_ERP[filtro.tipo] : null,
            filtro.situacao,
            filtro.situacao,
          ],
          { teto: 200 },
        )
      ).map(lote),
    );
  }

  detalhe(c: ContextoComunicacao, id: number): Promise<{ lote: LoteErpLido; itens: ItemErpLido[] }> {
    return this.ler(c, 'filaErp.lote', async (l, est) => {
      const r = await l.uma(`${SQL_LOTE} AND e.id = ?`, [est, id]);
      if (!r) throw naoEncontrado('Lote');
      return { lote: lote(r), itens: (await l.consultar(SQL_ITENS, [id], { teto: 5000 })).map(item) };
    });
  }

  /** Gera o lote do tipo no período, com o que ainda não foi a um lote vivo do mesmo ERP. */
  async gerar(
    c: ContextoComunicacao,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; numero: string; quantidade: number; valorTotal: number; jaExportados: number }> {
    const e = entradaValida(esquemaGerarLoteErp, entrada);
    return this.gravar(c, OPERACOES_FILA_ERP.gerar, TABELAS_FILA_ERP, async (tx, est) => {
      const s = await tx.uma(
        'SELECT id, categoria, ativo FROM sistema_externo WHERE codigo = ? AND excluido_em IS NULL',
        [e.sistema],
      );
      const erros = conferirGeracaoLoteErp(
        e,
        s ? { ativo: bool(s['ativo']), categoria: String(s['categoria']) } : null,
      );
      if (erros.length > 0 || !s) throw recusa(erros, 'Lote recusado');
      const sid = num(s['id']);
      const tipoLote = TIPO_LOTE_ERP[e.tipo];
      const origem = (await tx.consultar(SQL_ORIGEM[e.tipo], [est, e.inicio, e.fim], { teto: 20000 })).map(
        (r): RegistroOrigemErp => ({
          id: num(r['id']),
          numero: String(r['numero']),
          documento: txtOuNull(r['documento']),
          data: dia(r['data']) ?? e.inicio,
          valor: Number(r['valor'] ?? 0),
          cpfCnpj: txtOuNull(r['cpf_cnpj']),
          contraparte: txtOuNull(r['contraparte']),
          situacao: String(r['situacao']),
          contaContabil: numOuNull(r['conta_contabil_id']),
          centroCusto: numOuNull(r['centro_custo_id']),
        }),
      );
      const ja = new Set(
        (
          await tx.consultar(SQL_JA_EXPORTADOS, [est, sid, tipoLote, ENTIDADE_FILA_ERP[e.tipo]], {
            teto: 100000,
          })
        ).map((r) => num(r['entidade_id'])),
      );
      const l = montarLoteErp(e.tipo, origem, ja);
      if (l.quantidade === 0)
        throw recusa(
          [
            {
              campo: 'inicio',
              codigo: 'sem-registros',
              mensagem: 'Nada a exportar neste período: tudo já foi a um lote vivo ou não há registros.',
            },
          ],
          'Lote vazio',
        );
      const numero = await this.numeroDoLote(tx, est);
      const id = await tx.incluir(T_LOTE, {
        estabelecimento_id: est,
        sistema_externo_id: sid,
        numero,
        direcao: 'exportacao',
        tipo: tipoLote,
        periodo_inicio: e.inicio,
        periodo_fim: e.fim,
        situacao: 'gerado',
        quantidade_registros: l.quantidade,
        quantidade_erros: 0,
        valor_total: l.valorTotal,
        gerado_em: agora,
      });
      for (const i of l.itens)
        await tx.incluir(T_ITEM, {
          exportacao_erp_id: id,
          sequencia: i.sequencia,
          conta_contabil_id: i.contaContabil,
          centro_custo_id: i.centroCusto,
          entidade: i.entidade,
          entidade_id: i.entidadeId,
          numero_documento: i.numeroDocumento,
          cpf_cnpj: i.cpfCnpj,
          data_documento: i.data,
          valor: i.valor,
          situacao: 'pendente',
          conteudo: JSON.stringify(i.conteudo),
        });
      return { id, numero, quantidade: l.quantidade, valorTotal: l.valorTotal, jaExportados: l.jaExportados };
    });
  }

  /** Envia o lote gerado ao ERP pelo adaptador e aplica o retorno (o simulador responde na hora). */
  async enviar(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<ResultadoRetornoGravado> {
    const e = entradaValida(esquemaVersao, entrada);
    const adaptador = this.adaptador;
    if (!adaptador)
      throw recusa([
        {
          campo: 'sistema',
          codigo: 'erp-sem-adaptador',
          mensagem: 'Nenhum adaptador de ERP configurado neste ambiente.',
        },
      ]);
    return this.gravar(c, OPERACOES_FILA_ERP.enviar, TABELAS_FILA_ERP, async (tx, est) => {
      const r = await this.travarLote(tx, est, id);
      if (num(r['versao']) !== e.versao) throw conflito();
      if (
        !podeTransitarLoteErp(String(r['situacao']) as SituacaoLoteErp, 'enviado') ||
        String(r['situacao']) !== 'gerado'
      )
        throw transicaoRecusada(String(r['situacao']), 'enviado');
      const tipo = TIPO_DO_LOTE[String(r['tipo'])];
      if (!tipo) throw transicaoRecusada(String(r['tipo']), 'enviado');
      const itens = await tx.consultar(SQL_ITENS, [id], { teto: 5000 });
      const resposta = await adaptador.enviar({
        numero: String(r['numero']),
        tipo,
        itens: itens.map((i) => ({
          sequencia: num(i['sequencia']),
          cpfCnpj: txtOuNull(i['cpf_cnpj']),
          valor: numOuNull(i['valor']),
          conteudo: typeof i['conteudo'] === 'string' ? JSON.parse(i['conteudo']) : i['conteudo'],
        })),
      });
      const versao = await tx.alterar(T_LOTE, id, e.versao, {
        situacao: 'enviado',
        enviado_em: agora,
        protocolo_externo: resposta.protocolo.slice(0, 100),
      });
      return this.aplicar(tx, id, 'enviado', versao, itens, resposta.itens, agora);
    });
  }

  /** Importa o retorno do ERP item a item (idempotente: repetir não muda nada). */
  async importarRetorno(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<ResultadoRetornoGravado> {
    const e = entradaValida(esquemaRetornoErp, entrada);
    return this.gravar(c, OPERACOES_FILA_ERP.retorno, TABELAS_FILA_ERP, async (tx, est) => {
      const r = await this.travarLote(tx, est, id);
      const situacao = String(r['situacao']) as SituacaoLoteErp;
      if (!['enviado', 'processado', 'processado_com_erro'].includes(situacao))
        throw transicaoRecusada(situacao, 'processado');
      const itens = await tx.consultar(SQL_ITENS, [id], { teto: 5000 });
      return this.aplicar(tx, id, situacao, num(r['versao']), itens, e.itens, agora);
    });
  }

  async conciliar(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; exportados: number; rejeitados: number; valorExportado: number }> {
    const e = entradaValida(esquemaConciliarErp, entrada);
    return this.gravar(c, OPERACOES_FILA_ERP.conciliar, TABELAS_FILA_ERP, async (tx, est, usuario) => {
      const r = await this.travarLote(tx, est, id);
      if (num(r['versao']) !== e.versao) throw conflito();
      const itens = (await tx.consultar(SQL_ITENS, [id], { teto: 5000 })).map(atual);
      const { erros, resumo } = conferirConciliacaoErp(
        String(r['situacao']) as SituacaoLoteErp,
        itens,
        e.valorInformado,
      );
      if (erros.length > 0) throw recusa(erros, 'Conciliação recusada');
      await tx.alterar(T_LOTE, id, e.versao, {
        situacao: 'conciliado',
        conciliado_em: agora,
        conciliado_por_usuario_id: usuario,
        observacao: e.observacao?.trim() || txtOuNull(r['observacao']),
      });
      return { id, ...resumo };
    });
  }

  /** Cancela o lote ainda não enviado (motivo obrigatório); os itens ficam como ignorados, nada é apagado. */
  async cancelar(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; ignorados: number }> {
    const e = entradaValida(esquemaCancelarErp, entrada);
    return this.gravar(c, OPERACOES_FILA_ERP.cancelar, TABELAS_FILA_ERP, async (tx, est) => {
      const r = await this.travarLote(tx, est, id);
      if (num(r['versao']) !== e.versao) throw conflito();
      const de = String(r['situacao']) as SituacaoLoteErp;
      if (!podeTransitarLoteErp(de, 'cancelado')) throw transicaoRecusada(de, 'cancelado');
      const itens = await tx.consultar(SQL_ITENS, [id], { teto: 5000 });
      let ignorados = 0;
      for (const i of itens)
        if (String(i['situacao']) === 'pendente') {
          await tx.alterar(T_ITEM, num(i['id']), num(i['versao']), { situacao: 'ignorado' });
          ignorados++;
        }
      await tx.alterar(T_LOTE, id, e.versao, { situacao: 'cancelado', observacao: e.motivo.trim() });
      return { id, ignorados };
    });
  }

  private async travarLote(tx: TxOperacao, est: number, id: number): Promise<Record<string, unknown>> {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, numero, tipo, situacao, observacao, versao FROM exportacao_erp WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!r) throw naoEncontrado('Lote');
    return r;
  }

  private async aplicar(
    tx: TxOperacao,
    id: number,
    situacao: SituacaoLoteErp,
    versaoLote: number,
    linhas: readonly Record<string, unknown>[],
    retorno: readonly RetornoItemErp[],
    agora: Date,
  ): Promise<ResultadoRetornoGravado> {
    const res = aplicarRetornoErp(situacao, linhas.map(atual), retorno);
    const porSeq = new Map(linhas.map((l) => [num(l['sequencia']), l]));
    for (const m of res.mudancas) {
      const l = porSeq.get(m.sequencia)!;
      await tx.alterar(T_ITEM, num(l['id']), num(l['versao']), {
        situacao: m.situacao,
        chave_externa: m.chaveExterna,
        mensagem_retorno: m.mensagem,
      });
    }
    if (res.mudancas.length > 0 || res.situacaoLote !== situacao)
      await tx.alterar(T_LOTE, id, versaoLote, {
        situacao: res.situacaoLote,
        quantidade_erros: res.quantidadeErros,
        processado_em: res.situacaoLote === 'enviado' ? null : agora,
      });
    return {
      id,
      situacao: res.situacaoLote,
      alterados: res.mudancas.length,
      repetidos: res.repetidos,
      desconhecidos: res.desconhecidos,
      conflitos: res.conflitos,
    };
  }

  /** O número do lote pela sequência de negócio do estabelecimento (criada na primeira vez, prefixo ERP-). */
  private async numeroDoLote(tx: TxOperacao, est: number): Promise<string> {
    const s = await tx.uma('SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id <=> ?', [
      TIPO_SEQUENCIA,
      est,
    ]);
    if (!s)
      await tx.incluir(T_SEQ, {
        estabelecimento_id: est,
        tipo: TIPO_SEQUENCIA,
        prefixo: 'ERP-',
        proximo_valor: 1,
        incremento: 1,
        ativo: true,
      });
    return (await tx.proximoNumero(TIPO_SEQUENCIA)).formatado;
  }
}
