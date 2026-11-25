// Projeto como centro de resultado (C2-107, 07-FIN linha 128, F8) no banco do cliente. As regras são as puras de
// @sgh/dominio-financeiro (projeto-resultado.ts). Contrato de efeito:
//   - projeto: `projeto` (código único no estabelecimento, verba em valor_orcado, prazo, centro de resultado, situação)
//     com as etapas em `etapa_projeto` (pela sequência: altera a gravada, inclui a nova; a etapa nunca sai, cancela-se),
//     os centros participantes em `projeto_centro_custo` (o que sai é marcado como excluído; o que volta é reativado) e
//     os produtos ou serviços previstos em `projeto_produto` (o que sai fica inativo; o que volta é reativado);
//   - apropriação: `apropriacao_projeto` com a origem (título a pagar ou a receber, lançamento contábil, consumo de
//     estoque ou contrato), a natureza, a etapa, o percentual do documento e o valor; o valor realizado da etapa
//     (`etapa_projeto.valor_realizado`) é recalculado pelas despesas apropriadas a ela;
//   - estorno: marca a apropriação como excluída (excluido_em/excluido_por, com o motivo na observação) e recalcula a
//     etapa; nada se apaga;
//   - resultado: orçado × realizado, receita − despesa, etapas e centros, calculado na leitura pelo domínio.
// Cada gravação confere a versão lida e grava a trilha pelo executor.
import {
  conferirApropriacao,
  conferirProjeto,
  type NaturezaApropriacao,
  ORIGENS_APROPRIACAO,
  type OrigemApropriacao,
  resultadoDoProjeto,
  SITUACOES_ETAPA,
  SITUACOES_PROJETO,
  type SituacaoEtapa,
  type SituacaoProjeto,
  TIPOS_PROJETO,
} from '@sgh/dominio-financeiro';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_PROJETO_RESULTADO = Symbol('PORTA_PROJETO_RESULTADO');

const T_PROJETO = 'projeto';
const T_ETAPA = 'etapa_projeto';
const T_CENTRO = 'projeto_centro_custo';
const T_PRODUTO = 'projeto_produto';
const T_APROPRIACAO = 'apropriacao_projeto';
const TABELAS = [T_PROJETO, T_ETAPA, T_CENTRO, T_PRODUTO, T_APROPRIACAO];

const dataTxt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const dinheiro = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const valorNum = z.number().finite();

const esquemaProjeto = z
  .object({
    codigo: z.string().trim().min(1).max(20),
    descricao: z.string().trim().min(1).max(150),
    tipo: z.enum(TIPOS_PROJETO),
    verba: valorNum,
    inicioPrevisto: data.nullable().default(null),
    fimPrevisto: data.nullable().default(null),
    centroResultado: id.nullable().default(null),
    convenio: z.string().trim().max(30).nullable().default(null),
    situacao: z.enum(SITUACOES_PROJETO).default('planejado'),
    etapas: z
      .array(
        z
          .object({
            sequencia: z.number().int(),
            descricao: z.string().trim().max(150),
            centroCusto: id.nullable().default(null),
            inicioPrevisto: data.nullable().default(null),
            fimPrevisto: data.nullable().default(null),
            valorPrevisto: valorNum.default(0),
            percentualConcluido: valorNum.default(0),
            situacao: z.enum(SITUACOES_ETAPA).default('planejada'),
          })
          .strict(),
      )
      .max(200)
      .default([]),
    centros: z
      .array(z.object({ centroCusto: id, percentual: valorNum.nullable().default(null) }).strict())
      .max(100)
      .default([]),
    produtos: z
      .array(
        z
          .object({
            insumo: id.nullable().default(null),
            servico: z.string().trim().max(150).nullable().default(null),
            quantidade: valorNum.default(1),
            valorPrevisto: valorNum.nullable().default(null),
          })
          .strict(),
      )
      .max(300)
      .default([]),
    versao: z.number().int().positive().optional(),
  })
  .strict();

const esquemaApropriacao = z
  .object({
    origem: z.enum(ORIGENS_APROPRIACAO),
    documento: id,
    natureza: z.enum(['receita', 'despesa']).nullable().default(null),
    etapa: id.nullable().default(null),
    percentual: valorNum.nullable().default(null),
    valor: valorNum.nullable().default(null),
    data,
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

const esquemaEstorno = z
  .object({ versao: z.number().int().positive(), motivo: z.string().trim().min(3).max(400) })
  .strict();

/** A coluna da origem na apropriação. */
const COLUNA_ORIGEM: Readonly<Record<OrigemApropriacao, string>> = {
  titulo: 'titulo_pagar_id',
  titulo_receber: 'titulo_receber_id',
  lancamento: 'lancamento_contabil_id',
  consumo: 'movimento_estoque_id',
  contrato: 'contrato_fornecedor_id',
};

/** O documento de origem: valor, número, data e se está cancelado ou estornado (no estabelecimento). */
const SQL_DOCUMENTO: Readonly<Record<OrigemApropriacao, string>> = {
  titulo: `SELECT d.id, d.numero, d.data_emissao AS data, d.valor_bruto - d.valor_desconto + d.valor_acrescimo AS valor,
                  d.situacao = 'cancelado' AS cancelado, COALESCE(d.referente, d.numero_documento) AS descricao
             FROM titulo_pagar d WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
  titulo_receber: `SELECT d.id, d.numero, d.data_emissao AS data, d.valor_bruto - d.valor_desconto + d.valor_acrescimo AS valor,
                  d.situacao = 'cancelado' AS cancelado, COALESCE(d.referente, d.numero_documento) AS descricao
             FROM titulo_receber d WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
  lancamento: `SELECT d.id, d.numero, d.data_lancamento AS data, d.valor_total AS valor,
                  (d.situacao = 'estornado' OR d.estornado_lancamento_contabil_id IS NOT NULL) AS cancelado,
                  d.historico AS descricao
             FROM lancamento_contabil d WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
  consumo: `SELECT d.id, d.id AS numero, d.competencia AS data, d.valor_total AS valor,
                  (d.natureza <> 'saida' OR d.estorno_movimento_estoque_id IS NOT NULL
                   OR EXISTS (SELECT 1 FROM movimento_estoque e WHERE e.estorno_movimento_estoque_id = d.id)) AS cancelado,
                  i.nome AS descricao
             FROM movimento_estoque d LEFT JOIN insumo i ON i.id = d.insumo_id
            WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
  contrato: `SELECT d.id, d.numero, d.data_emissao AS data, COALESCE(d.valor_global, d.valor_estimado, 0) AS valor,
                  d.situacao IN ('cancelado', 'rascunho') AS cancelado, d.objeto AS descricao
             FROM contrato_fornecedor d WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
};

const documentoLido = (x: Record<string, unknown>) => ({
  id: num(x['id']),
  numero: String(x['numero'] ?? ''),
  data: dataTxt(x['data']),
  valor: dinheiro(x['valor']),
  cancelado: bool(x['cancelado']),
  descricao: txtOuNull(x['descricao']),
});

async function exigir(l: Leitor, sql: string, p: unknown[], oQue: string): Promise<Record<string, unknown>> {
  const r = await l.uma(sql, p);
  if (!r) throw naoEncontrado(oQue);
  return r;
}
const recusa = (titulo: string, problemas: readonly { campo: string; mensagem: string }[]) => {
  if (problemas.length) throw recusaRegra(titulo, problemas);
};

/** O que o documento já tem apropriado a projetos (todos), sem os estornos. */
async function jaApropriado(
  l: Pick<Leitor, 'uma'>,
  origem: OrigemApropriacao,
  documento: number,
): Promise<number> {
  const coluna = COLUNA_ORIGEM[origem];
  const r = await l.uma(
    `SELECT COALESCE(SUM(valor), 0) AS v FROM apropriacao_projeto WHERE ${coluna} = ? AND excluido_em IS NULL`,
    [documento],
  );
  return dinheiro(r?.['v']);
}

/** Recalcula o valor realizado da etapa pelas despesas apropriadas a ela. */
async function recalcularEtapa(tx: TxOperacao, etapa: number | null): Promise<void> {
  if (etapa === null) return;
  const e = await tx.uma(
    `SELECT e.id, e.versao, e.valor_realizado,
            (SELECT COALESCE(SUM(a.valor), 0) FROM apropriacao_projeto a
              WHERE a.etapa_projeto_id = e.id AND a.excluido_em IS NULL AND a.natureza = 'despesa') AS soma
       FROM etapa_projeto e WHERE e.id = ?`,
    [etapa],
  );
  if (!e || dinheiro(e['soma']) === dinheiro(e['valor_realizado'])) return;
  await tx.alterar(T_ETAPA, etapa, num(e['versao']), { valor_realizado: dinheiro(e['soma']) });
}

export class PortaProjetoResultadoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'financeiro.projeto');
  }

  /** Os projetos do estabelecimento com o resumo (verba, despesa, receita) e as escolhas da tela. */
  projetos(c: ContextoPortaPropria) {
    return this.ler(c, 'projetos', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT p.id, p.versao, p.codigo, p.descricao, p.tipo, p.situacao, p.valor_orcado,
                p.data_inicio_prevista, p.data_fim_prevista,
                (SELECT COALESCE(SUM(a.valor), 0) FROM apropriacao_projeto a
                  WHERE a.projeto_id = p.id AND a.excluido_em IS NULL AND a.natureza = 'despesa') AS despesa,
                (SELECT COALESCE(SUM(a.valor), 0) FROM apropriacao_projeto a
                  WHERE a.projeto_id = p.id AND a.excluido_em IS NULL AND a.natureza = 'receita') AS receita
           FROM projeto p
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY FIELD(p.situacao, 'em_andamento', 'planejado', 'suspenso', 'concluido', 'cancelado'), p.codigo
          LIMIT 500`,
        [est.id],
      );
      const centros = await l.consultar(
        `SELECT id, CONCAT(codigo, ' · ', nome) AS nome FROM centro_custo
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo = TRUE ORDER BY codigo LIMIT 1000`,
        [est.id],
      );
      const insumos = await l.consultar(
        `SELECT id, CONCAT(codigo, ' · ', nome) AS nome FROM insumo
          WHERE excluido_em IS NULL ORDER BY nome LIMIT 1000`,
      );
      const opcao = (x: Record<string, unknown>) => ({ id: num(x['id']), nome: String(x['nome']) });
      return {
        projetos: linhas.map((p) => {
          const verba = dinheiro(p['valor_orcado']);
          const despesa = dinheiro(p['despesa']);
          return {
            id: num(p['id']),
            versao: num(p['versao']),
            codigo: String(p['codigo']),
            descricao: String(p['descricao']),
            tipo: String(p['tipo']),
            situacao: String(p['situacao']) as SituacaoProjeto,
            verba,
            inicioPrevisto: dataTxt(p['data_inicio_prevista']),
            fimPrevisto: dataTxt(p['data_fim_prevista']),
            despesa,
            receita: dinheiro(p['receita']),
            estourado: despesa > verba,
          };
        }),
        centros: centros.map(opcao),
        insumos: insumos.map(opcao),
      };
    });
  }

  /** O projeto com etapas, centros, produtos, apropriações e o resultado (orçado × realizado). */
  projeto(c: ContextoPortaPropria, alvo: number) {
    return this.ler(c, 'projeto', async (l, est) => {
      const p = await exigir(
        l,
        `SELECT * FROM projeto WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [alvo, est.id],
        'Projeto',
      );
      const etapas = (
        await l.consultar(
          `SELECT e.*, cc.nome AS centro_nome FROM etapa_projeto e LEFT JOIN centro_custo cc ON cc.id = e.centro_custo_id
            WHERE e.projeto_id = ? AND e.excluido_em IS NULL ORDER BY e.sequencia`,
          [alvo],
        )
      ).map((e) => ({
        id: num(e['id']),
        sequencia: num(e['sequencia']),
        descricao: String(e['descricao']),
        centroCusto: numOuNull(e['centro_custo_id']),
        centroNome: txtOuNull(e['centro_nome']),
        inicioPrevisto: dataTxt(e['data_inicio_prevista']),
        fimPrevisto: dataTxt(e['data_fim_prevista']),
        valorPrevisto: dinheiro(e['valor_previsto']),
        valorRealizado: dinheiro(e['valor_realizado']),
        percentualConcluido: Number(e['percentual_concluido'] ?? 0),
        situacao: String(e['situacao']) as SituacaoEtapa,
      }));
      const centros = (
        await l.consultar(
          `SELECT x.centro_custo_id, x.percentual_participacao, cc.nome FROM projeto_centro_custo x
             LEFT JOIN centro_custo cc ON cc.id = x.centro_custo_id
            WHERE x.projeto_id = ? AND x.excluido_em IS NULL ORDER BY x.id`,
          [alvo],
        )
      ).map((x) => ({
        centroCusto: num(x['centro_custo_id']),
        nome: txtOuNull(x['nome']),
        percentual: x['percentual_participacao'] === null ? null : Number(x['percentual_participacao']),
      }));
      const produtos = (
        await l.consultar(
          `SELECT x.insumo_id, x.descricao_servico, x.quantidade_prevista, x.valor_previsto, i.nome
             FROM projeto_produto x LEFT JOIN insumo i ON i.id = x.insumo_id
            WHERE x.projeto_id = ? AND x.ativo = TRUE AND x.excluido_em IS NULL ORDER BY x.id`,
          [alvo],
        )
      ).map((x) => ({
        insumo: numOuNull(x['insumo_id']),
        servico: txtOuNull(x['descricao_servico']),
        nome: txtOuNull(x['nome']) ?? txtOuNull(x['descricao_servico']),
        quantidade: Number(x['quantidade_prevista']),
        valorPrevisto: x['valor_previsto'] === null ? null : dinheiro(x['valor_previsto']),
      }));
      const apropriacoes = (
        await l.consultar(
          `SELECT a.*, e.sequencia AS etapa_sequencia FROM apropriacao_projeto a
             LEFT JOIN etapa_projeto e ON e.id = a.etapa_projeto_id
            WHERE a.projeto_id = ? ORDER BY a.data_apropriacao DESC, a.id DESC LIMIT 1000`,
          [alvo],
        )
      ).map((a) => {
        const origem = String(a['tipo_origem']) as OrigemApropriacao;
        return {
          id: num(a['id']),
          versao: num(a['versao']),
          origem,
          documento: num(a[COLUNA_ORIGEM[origem]]),
          natureza: String(a['natureza']) as NaturezaApropriacao,
          etapa: numOuNull(a['etapa_sequencia']),
          percentual: a['percentual_rateio'] === null ? null : Number(a['percentual_rateio']),
          valor: dinheiro(a['valor']),
          data: String(dataTxt(a['data_apropriacao'])),
          observacao: txtOuNull(a['observacao']),
          estornada: a['excluido_em'] !== null,
        };
      });
      const ativas = apropriacoes.filter((a) => !a.estornada);
      const verba = dinheiro(p['valor_orcado']);
      return {
        id: num(p['id']),
        versao: num(p['versao']),
        codigo: String(p['codigo']),
        descricao: String(p['descricao']),
        tipo: String(p['tipo']),
        situacao: String(p['situacao']) as SituacaoProjeto,
        verba,
        inicioPrevisto: dataTxt(p['data_inicio_prevista']),
        fimPrevisto: dataTxt(p['data_fim_prevista']),
        inicioEfetivo: dataTxt(p['data_inicio_efetiva']),
        fimEfetivo: dataTxt(p['data_fim_efetiva']),
        centroResultado: numOuNull(p['centro_custo_id']),
        convenio: txtOuNull(p['codigo_convenio']),
        etapas,
        centros,
        produtos,
        apropriacoes,
        resultado: resultadoDoProjeto(
          verba,
          ativas.map((a) => ({ natureza: a.natureza, valor: a.valor, etapa: a.etapa })),
          etapas,
          centros,
        ),
      };
    });
  }

  /** Os documentos da origem que podem ser apropriados (busca pelo número), com o valor livre de cada um. */
  documentos(c: ContextoPortaPropria, origem: OrigemApropriacao, busca: string) {
    return this.ler(c, 'documentos', async (l, est) => {
      const termo = busca.trim();
      const coluna = COLUNA_ORIGEM[origem];
      const filtro = termo ? ` AND CAST(d.numero AS CHAR) LIKE ?` : '';
      const base = SQL_DOCUMENTO[origem];
      const linhas = await l.consultar(`${base}${filtro} ORDER BY d.id DESC LIMIT 50`, [
        est.id,
        ...(termo ? [`%${termo}%`] : []),
      ]);
      const ids = linhas.map((x) => num(x['id']));
      const marcas = ids.map(() => '?').join(',') || 'NULL';
      const usados = ids.length
        ? await l.consultar(
            `SELECT ${coluna} AS doc, SUM(valor) AS v FROM apropriacao_projeto
              WHERE excluido_em IS NULL AND ${coluna} IN (${marcas}) GROUP BY ${coluna}`,
            ids,
          )
        : [];
      const mapa = new Map(usados.map((u) => [num(u['doc']), dinheiro(u['v'])]));
      return linhas
        .map(documentoLido)
        .filter((d) => !d.cancelado)
        .map((d) => ({ ...d, livre: dinheiro(d.valor - (mapa.get(d.id) ?? 0)) }));
    });
  }

  async salvarProjeto(c: ContextoPortaPropria, alvo: number | null, entrada: unknown) {
    const e = entradaValida(esquemaProjeto, entrada);
    const nome = alvo === null ? 'financeiro.projeto.criar' : 'financeiro.projeto.alterar';
    return this.gravar(c, nome, TABELAS, async (tx, est, usuario) => {
      const codigo = e.codigo.trim().toUpperCase();
      let anterior: Record<string, unknown> | null = null;
      if (alvo !== null) {
        [anterior = null] = await tx.consultarParaAtualizar(
          'SELECT * FROM projeto WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [alvo, est.id],
          { teto: 1 },
        );
        if (!anterior) throw naoEncontrado('Projeto');
      }
      const etapasGravadas =
        alvo === null
          ? []
          : await tx.consultar(
              'SELECT id, versao, sequencia FROM etapa_projeto WHERE projeto_id = ? AND excluido_em IS NULL',
              [alvo],
            );
      const comApropriacao =
        alvo === null
          ? []
          : await tx.consultar(
              `SELECT DISTINCT e.sequencia FROM apropriacao_projeto a JOIN etapa_projeto e ON e.id = a.etapa_projeto_id
                WHERE a.projeto_id = ? AND a.excluido_em IS NULL`,
              [alvo],
            );
      const problemas = conferirProjeto({
        codigo,
        descricao: e.descricao,
        tipo: e.tipo,
        verba: e.verba,
        inicioPrevisto: e.inicioPrevisto,
        fimPrevisto: e.fimPrevisto,
        situacao: e.situacao,
        situacaoAnterior: anterior ? (String(anterior['situacao']) as SituacaoProjeto) : null,
        etapas: e.etapas,
        centros: e.centros,
        produtos: e.produtos,
        etapasGravadas: etapasGravadas.map((x) => num(x['sequencia'])),
        etapasComApropriacao: comApropriacao.map((x) => num(x['sequencia'])),
      });
      if (
        await tx.uma('SELECT id FROM projeto WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?', [
          est.id,
          codigo,
          alvo ?? 0,
        ])
      )
        problemas.push({ campo: 'codigo', mensagem: `Já existe o projeto ${codigo} neste estabelecimento.` });
      const centrosUsados = [
        ...new Set(
          [
            e.centroResultado,
            ...e.etapas.map((x) => x.centroCusto),
            ...e.centros.map((x) => x.centroCusto),
          ].filter((x): x is number => x !== null),
        ),
      ];
      if (centrosUsados.length) {
        const achados = await tx.consultar(
          `SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL
              AND id IN (${centrosUsados.map(() => '?').join(',')})`,
          [est.id, ...centrosUsados],
        );
        if (achados.length !== centrosUsados.length)
          problemas.push({ campo: 'centros', mensagem: 'Centro de custo que não é deste estabelecimento.' });
      }
      const insumos = [...new Set(e.produtos.map((x) => x.insumo).filter((x): x is number => x !== null))];
      if (insumos.length) {
        const achados = await tx.consultar(
          `SELECT id FROM insumo WHERE excluido_em IS NULL AND id IN (${insumos.map(() => '?').join(',')})`,
          insumos,
        );
        if (achados.length !== insumos.length)
          problemas.push({ campo: 'produtos', mensagem: 'Produto de estoque inexistente.' });
      }
      recusa('Projeto recusado', problemas);
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: est.fuso }).format(new Date());
      const campos: Record<string, unknown> = {
        codigo,
        descricao: e.descricao,
        tipo: e.tipo,
        valor_orcado: e.verba,
        data_inicio_prevista: e.inicioPrevisto,
        data_fim_prevista: e.fimPrevisto,
        centro_custo_id: e.centroResultado,
        codigo_convenio: e.convenio || null,
        situacao: e.situacao,
      };
      // A data efetiva acompanha a situação: começa ao entrar em andamento, termina ao concluir ou cancelar.
      if (e.situacao === 'em_andamento' && !anterior?.['data_inicio_efetiva'])
        campos['data_inicio_efetiva'] = hoje;
      if (['concluido', 'cancelado'].includes(e.situacao) && !anterior?.['data_fim_efetiva']) {
        campos['data_fim_efetiva'] = hoje;
        if (!anterior?.['data_inicio_efetiva']) campos['data_inicio_efetiva'] = hoje;
      }
      let projetoId: number;
      if (alvo === null) {
        projetoId = await tx.incluir(T_PROJETO, { estabelecimento_id: est.id, ...campos, origem: 'sistema' });
      } else {
        if (e.versao === undefined)
          recusa('Projeto recusado', [{ campo: 'versao', mensagem: 'Informe a versão lida.' }]);
        await tx.alterar(T_PROJETO, alvo, e.versao!, campos);
        projetoId = alvo;
      }
      // Etapas pela sequência: altera a gravada, inclui a nova (a que não vem já foi recusada pelo domínio).
      const porSeq = new Map(etapasGravadas.map((x) => [num(x['sequencia']), x]));
      for (const et of e.etapas) {
        const v = {
          descricao: et.descricao,
          centro_custo_id: et.centroCusto,
          data_inicio_prevista: et.inicioPrevisto,
          data_fim_prevista: et.fimPrevisto,
          valor_previsto: et.valorPrevisto,
          percentual_concluido: et.percentualConcluido,
          situacao: et.situacao,
        };
        const g = porSeq.get(et.sequencia);
        if (g) await tx.alterar(T_ETAPA, num(g['id']), num(g['versao']), v);
        else
          await tx.incluir(T_ETAPA, {
            projeto_id: projetoId,
            sequencia: et.sequencia,
            ...v,
            origem: 'sistema',
          });
      }
      // Centros: o que sai fica excluído; o que volta é reativado (chave única por projeto e centro).
      const centrosGravados = await tx.consultar(
        'SELECT id, versao, centro_custo_id, excluido_em FROM projeto_centro_custo WHERE projeto_id = ?',
        [projetoId],
      );
      const agora = new Date();
      for (const g of centrosGravados) {
        const novo = e.centros.find((x) => x.centroCusto === num(g['centro_custo_id']));
        if (!novo && g['excluido_em'] === null)
          await tx.alterar(T_CENTRO, num(g['id']), num(g['versao']), {
            excluido_em: agora,
            excluido_por: usuario,
          });
        else if (novo)
          await tx.alterar(T_CENTRO, num(g['id']), num(g['versao']), {
            percentual_participacao: novo.percentual,
            excluido_em: null,
            excluido_por: null,
          });
      }
      for (const x of e.centros)
        if (!centrosGravados.some((g) => num(g['centro_custo_id']) === x.centroCusto))
          await tx.incluir(T_CENTRO, {
            projeto_id: projetoId,
            estabelecimento_id: est.id,
            centro_custo_id: x.centroCusto,
            percentual_participacao: x.percentual,
          });
      // Produtos: o que sai fica inativo; o que volta é reativado.
      const produtosGravados = await tx.consultar(
        'SELECT id, versao, insumo_id, descricao_servico, ativo FROM projeto_produto WHERE projeto_id = ? AND excluido_em IS NULL',
        [projetoId],
      );
      const chave = (insumo: unknown, servico: unknown) =>
        insumo !== null && insumo !== undefined
          ? `i${String(insumo)}`
          : `s${String(servico ?? '').toLowerCase()}`;
      const novos = new Map(e.produtos.map((x) => [chave(x.insumo, x.servico?.trim() || null), x]));
      for (const g of produtosGravados) {
        const k = chave(g['insumo_id'], g['descricao_servico']);
        const novo = novos.get(k);
        novos.delete(k);
        if (!novo && bool(g['ativo']))
          await tx.alterar(T_PRODUTO, num(g['id']), num(g['versao']), { ativo: false });
        else if (novo)
          await tx.alterar(T_PRODUTO, num(g['id']), num(g['versao']), {
            quantidade_prevista: novo.quantidade,
            valor_previsto: novo.valorPrevisto,
            ativo: true,
          });
      }
      for (const x of novos.values())
        await tx.incluir(T_PRODUTO, {
          projeto_id: projetoId,
          insumo_id: x.insumo,
          descricao_servico: x.insumo === null ? x.servico?.trim() || null : null,
          quantidade_prevista: x.quantidade,
          valor_previsto: x.valorPrevisto,
          ativo: true,
        });
      return { tabela: T_PROJETO, id: projetoId };
    });
  }

  /** Apropria o documento ao projeto (rateio pelo percentual ou valor direto) e recalcula a etapa. */
  async apropriar(c: ContextoPortaPropria, projetoId: number, entrada: unknown) {
    const e = entradaValida(esquemaApropriacao, entrada);
    return this.gravar(c, 'financeiro.projeto.apropriar', TABELAS, async (tx, est) => {
      const [p] = await tx.consultarParaAtualizar(
        'SELECT id, situacao FROM projeto WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [projetoId, est.id],
        { teto: 1 },
      );
      if (!p) throw naoEncontrado('Projeto');
      const base = SQL_DOCUMENTO[e.origem];
      const linha = await tx.uma(`${base} AND d.id = ?`, [est.id, e.documento]);
      if (!linha) throw naoEncontrado('Documento de origem');
      const doc = documentoLido(linha);
      let etapa: SituacaoEtapa | 'inexistente' | null = null;
      if (e.etapa !== null) {
        const et = await tx.uma(
          'SELECT situacao FROM etapa_projeto WHERE id = ? AND projeto_id = ? AND excluido_em IS NULL',
          [e.etapa, projetoId],
        );
        etapa = et ? (String(et['situacao']) as SituacaoEtapa) : 'inexistente';
      }
      const coluna = COLUNA_ORIGEM[e.origem];
      const mesmo = await tx.uma(
        `SELECT id, versao, excluido_em FROM apropriacao_projeto WHERE projeto_id = ? AND ${coluna} = ?`,
        [projetoId, e.documento],
      );
      const r = conferirApropriacao({
        origem: e.origem,
        natureza: e.natureza,
        situacaoProjeto: String(p['situacao']) as SituacaoProjeto,
        valorOrigem: doc.valor,
        jaApropriado: await jaApropriado(tx, e.origem, e.documento),
        percentual: e.percentual,
        valor: e.valor,
        data: e.data,
        etapa,
        origemCancelada: doc.cancelado,
      });
      const problemas = [...r.problemas];
      if (mesmo && mesmo['excluido_em'] === null)
        problemas.unshift({
          campo: 'documento',
          mensagem: 'O documento já está apropriado a este projeto; estorne antes de apropriar de novo.',
        });
      recusa('Apropriação recusada', problemas);
      const a = r.aprovada!;
      const campos = {
        etapa_projeto_id: e.etapa,
        natureza: a.natureza,
        percentual_rateio: a.percentual,
        valor: a.valor,
        data_apropriacao: e.data,
        observacao: e.observacao || null,
      };
      let aid: number;
      if (mesmo) {
        // A apropriação estornada volta (chave única por projeto e documento), com os valores novos.
        aid = num(mesmo['id']);
        await tx.alterar(T_APROPRIACAO, aid, num(mesmo['versao']), {
          ...campos,
          excluido_em: null,
          excluido_por: null,
        });
      } else {
        aid = await tx.incluir(T_APROPRIACAO, {
          projeto_id: projetoId,
          tipo_origem: e.origem,
          [coluna]: e.documento,
          ...campos,
        });
      }
      await recalcularEtapa(tx, e.etapa);
      return { tabela: T_APROPRIACAO, id: aid, valor: a.valor, natureza: a.natureza };
    });
  }

  /** Estorna a apropriação: fica marcada como excluída, com o motivo; a etapa é recalculada. */
  async estornar(c: ContextoPortaPropria, apropriacaoId: number, entrada: unknown) {
    const e = entradaValida(esquemaEstorno, entrada);
    return this.gravar(c, 'financeiro.projeto.estornar_apropriacao', TABELAS, async (tx, est, usuario) => {
      const [a] = await tx.consultarParaAtualizar(
        `SELECT a.id, a.etapa_projeto_id, a.observacao, a.excluido_em, p.situacao FROM apropriacao_projeto a
           JOIN projeto p ON p.id = a.projeto_id WHERE a.id = ? AND p.estabelecimento_id = ?`,
        [apropriacaoId, est.id],
        { teto: 1 },
      );
      if (!a) throw naoEncontrado('Apropriação');
      const problemas: { campo: string; mensagem: string }[] = [];
      if (a['excluido_em'] !== null)
        problemas.push({ campo: 'id', mensagem: 'A apropriação já está estornada.' });
      if (['concluido', 'cancelado'].includes(String(a['situacao'])))
        problemas.push({ campo: 'projeto', mensagem: 'O projeto encerrado não tem apropriação estornada.' });
      recusa('Estorno recusado', problemas);
      const obs = [txtOuNull(a['observacao']), `Estorno: ${e.motivo}`]
        .filter(Boolean)
        .join(' | ')
        .slice(0, 500);
      await tx.alterar(T_APROPRIACAO, apropriacaoId, e.versao, {
        observacao: obs,
        excluido_em: new Date(),
        excluido_por: usuario,
      });
      await recalcularEtapa(tx, numOuNull(a['etapa_projeto_id']));
      return { tabela: T_APROPRIACAO, id: apropriacaoId };
    });
  }
}
