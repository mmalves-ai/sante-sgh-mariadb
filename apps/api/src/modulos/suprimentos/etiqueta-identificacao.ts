// Etiqueta de identificação do estoque e leitura do código (F3.6, 05-SUP linha 14), sobre o MariaDB do cliente pelo
// Executor do núcleo (trilha na mesma transação, versão conferida, Idempotency-Key). A regra pura mora em
// `@sgh/contratos/regras-suprimentos` (identificacao-estoque) e o desenho ZPL em `@sgh/dominio-documento`
// (zpl/estoque). Aqui ficam:
//   - a emissão: o sequencial por estabelecimento (o identificador com dígito de conferência), o conteúdo do DataMatrix
//     GS1 e do Code 128, a gravação em `etiqueta_identificacao` com a primeira impressão (`impressoes` = 1; a
//     reimpressão passa pela impressão padrão, que já conhece a tabela) e o ZPL pronto para a impressora;
//   - a leitura: os padrões ativos (`padrao_leitura_codigo`, os de fabricante antes dos gerais), a leitura GS1 de
//     reserva e a resolução contra a etiqueta do hospital e o código de barras do item (`insumo_codigo_barras` e o GTIN
//     principal do item), com o lote do estabelecimento e os alertas de validade;
//   - a baixa: a etiqueta ativa vira consumida na saída (ou devolvida, descartada, cancelada); nada é apagado.
import { zplEtiquetaEstoque } from '@sgh/dominio-documento';
import {
  type BaixaEtiqueta,
  type CodigoBarrasConhecido,
  conferirEmissaoEtiquetas,
  type EtiquetaConhecida,
  gtin14,
  identificadorEtiqueta,
  identificadorValido,
  lerCodigo,
  montarEtiqueta,
  type PadraoLeitura,
  proximaSituacaoEtiqueta,
  type RecusaSuprimentos,
  resolverLeitura,
  sequencialDoIdentificador,
  type TipoEtiquetaEstoque,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  type ResultadoOperacao,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';

export const PORTA_ETIQUETA_IDENTIFICACAO = Symbol('PORTA_ETIQUETA_IDENTIFICACAO');
export const TABELAS_ETIQUETA_IDENTIFICACAO = ['etiqueta_identificacao'] as const;

export interface EmissaoEtiquetasEntrada {
  readonly insumo: number;
  readonly lote: number | null;
  readonly local: number | null;
  readonly quantidade: number;
  readonly etiquetas: number;
  readonly tipo: TipoEtiquetaEstoque;
  readonly notaEntradaItem: number | null;
}
export interface EtiquetaEmitida {
  readonly id: number;
  readonly identificador: string;
  readonly datamatrix: string;
  readonly barras: string;
  readonly legivel: string;
}
export interface ResultadoEmissao {
  readonly id: number;
  readonly etiquetas: readonly EtiquetaEmitida[];
  /** O ZPL de todas as etiquetas, uma após a outra. */
  readonly zpl: string;
}
export interface FichaEtiqueta extends EtiquetaEmitida {
  readonly insumo: number;
  readonly item: string;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly quantidade: number;
  readonly tipo: string;
  readonly situacao: string;
  readonly impressoes: number;
  readonly permiteReimpressao: boolean;
  readonly zpl: string;
}
export interface ItemLido {
  readonly codigo: number;
  readonly nome: string;
  readonly unidade: string;
  readonly rastreavel: boolean;
  readonly controlado: boolean;
  readonly antimicrobiano: boolean;
  readonly consignado: boolean;
  readonly ativo: boolean;
}
export interface LeituraCodigo {
  readonly item: ItemLido;
  readonly quantidade: number;
  readonly lote: string | null;
  /** O lote cadastrado no estabelecimento (nulo: lote novo, como na entrada da nota). */
  readonly loteId: number | null;
  readonly validade: string | null;
  readonly identificador: string | null;
  readonly origem: 'etiqueta' | 'codigo-item';
  readonly padrao: number | null;
  /** vencido, vence-30-dias, lote-bloqueado, validade-divergente (a lida difere da cadastrada). */
  readonly alertas: readonly string[];
}
export interface BaixaEtiquetasEntrada {
  readonly identificadores: readonly string[];
  readonly situacao: BaixaEtiqueta | 'reativar';
  /** O movimento de estoque que levou a etiqueta (a saída gravada), quando há. */
  readonly movimento: number | null;
}

export interface PortaEtiquetaIdentificacao {
  readonly destino: 'banco' | 'indisponivel';
  emitir(c: ContextoPortaM18, e: EmissaoEtiquetasEntrada, chave: string): Promise<ResultadoEmissao>;
  ficha(c: ContextoPortaM18, id: number): Promise<FichaEtiqueta | null>;
  ler(c: ContextoPortaM18, codigo: string): Promise<LeituraCodigo>;
  baixar(
    c: ContextoPortaM18,
    e: BaixaEtiquetasEntrada,
    chave: string,
  ): Promise<{ id: number; baixadas: number }>;
}

export function portaEtiquetaIdentificacaoIndisponivel(): PortaEtiquetaIdentificacao {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A etiqueta de identificação exige o banco próprio.');
  };
  return { destino: 'indisponivel', emitir: falha, ficha: falha, ler: falha, baixar: falha };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const b = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const dataBr = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null;
const qtde = (x: number) => String(Math.round(x * 10_000) / 10_000).replace('.', ',');

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

function zplDe(
  m: EtiquetaEmitida,
  item: string,
  lote: string | null,
  validade: string | null,
  q: string,
): string {
  return zplEtiquetaEstoque({
    identificador: m.identificador,
    datamatrix: m.datamatrix,
    legivel: m.legivel,
    item,
    lote,
    validade: dataBr(validade),
    quantidade: q,
  });
}

/** O GTIN do item: o principal do cadastro ou o primeiro código GTIN da embalagem. */
async function gtinDoItem(
  l: Leitor | TxOperacao,
  insumo: number,
  principal: string | null,
): Promise<string | null> {
  if (principal && gtin14(principal)) return principal;
  const r = await l.uma<Linha>(
    `SELECT codigo_barras FROM insumo_codigo_barras WHERE insumo_id = ? AND padrao = 'gtin' AND excluido_em IS NULL
      ORDER BY principal DESC, sequencia LIMIT 1`,
    [insumo],
  );
  const g = tn(r?.['codigo_barras']);
  return g && gtin14(g) ? g : null;
}

function padraoDe(r: Linha): PadraoLeitura {
  const campo = (k: string) => ({
    prefixo: tn(r[`prefixo_${k}`]),
    ordem: nn(r[`ordem_${k}`]),
    tamanho: tn(r[`tamanho_${k}`]),
  });
  return {
    id: n(r['id']),
    ativo: b(r['ativo']),
    expressao: tn(r['expressao_regular']),
    campos: {
      produto: campo('produto'),
      validade: campo('validade'),
      lote: campo('lote'),
      serie: campo('serie'),
    },
    formatoData: tn(r['formato_data']),
    zerosEsquerda: b(r['zeros_esquerda']),
  };
}

export class PortaEtiquetaIdentificacaoPropria implements PortaEtiquetaIdentificacao {
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
      correlacao: c.correlacao || 'etiqueta-estoque',
    };
  }

  private async executar<R extends { id: number } & Record<string, unknown>>(
    c: ContextoPortaM18,
    nome: string,
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome: `suprimentos.etiqueta.${nome}`,
      tabelas: [...TABELAS_ETIQUETA_IDENTIFICACAO],
      entrada: z.unknown(),
      gravar: async (tx: TxOperacao) =>
        (await gravar(tx, ctxN.estabelecimento)) as unknown as ResultadoOperacao,
      alvo: (_e, r: ResultadoOperacao) => ({ tabela: 'etiqueta_identificacao', id: n(r['id']) }),
      trilha: () => ({ dados: entrada, motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  emitir(c: ContextoPortaM18, e: EmissaoEtiquetasEntrada, chave: string): Promise<ResultadoEmissao> {
    return this.executar(c, 'emitir', { ...e }, chave, async (tx, est) => {
      const item = await tx.uma<Linha>(
        `SELECT i.id, i.nome, i.situacao, i.controla_lote, i.codigo_gtin, i.estoque_unidade_medida_id, um.sigla
           FROM insumo i JOIN unidade_medida um ON um.id = i.estoque_unidade_medida_id
          WHERE i.id = ? AND i.excluido_em IS NULL`,
        [e.insumo],
      );
      if (!item) throw recusa('item-inexistente', 'Item não encontrado.', { campos: ['insumo'] });
      const lote =
        e.lote === null
          ? null
          : await tx.uma<Linha>(
              `SELECT id, numero_lote, validade, situacao, fabricante_id FROM lote_insumo
                WHERE id = ? AND insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
              [e.lote, e.insumo, est],
            );
      if (e.lote !== null && !lote)
        throw recusa('lote-inexistente', 'O lote não é deste item neste estabelecimento.', {
          campos: ['lote'],
        });
      if (e.local !== null) {
        const lc = await tx.uma<Linha>(
          'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.local, est],
        );
        if (!lc)
          throw recusa('local-inexistente', 'O local não é deste estabelecimento.', { campos: ['local'] });
      }
      const hoje = dataIso(new Date()) as string;
      const validade = lote ? dataIso(lote['validade']) : null;
      recusarTodas(
        conferirEmissaoEtiquetas({
          controlaLote: b(item['controla_lote']),
          itemAtivo: t(item['situacao']) === 'ativo',
          lote: lote ? { validade: validade as string, situacao: t(lote['situacao']) } : null,
          quantidadePorEtiqueta: e.quantidade,
          etiquetas: e.etiquetas,
          hoje,
        }),
      );
      const gtin = await gtinDoItem(tx, e.insumo, tn(item['codigo_gtin']));
      // O sequencial por estabelecimento: a última etiqueta do próprio hospital, travada (a chave única por
      // estabelecimento e identificador barra a corrida que sobrar).
      const ultimas = await tx.consultarParaAtualizar<Linha>(
        `SELECT identificador FROM etiqueta_identificacao WHERE estabelecimento_id = ? AND origem = 'sistema'
          ORDER BY id DESC LIMIT 20`,
        [est],
      );
      let seq = Math.max(0, ...ultimas.map((r) => sequencialDoIdentificador(t(r['identificador'])) ?? 0));
      const numeroLote = lote ? t(lote['numero_lote']) : null;
      const emitidas: EtiquetaEmitida[] = [];
      const zpls: string[] = [];
      const q = `${qtde(e.quantidade)} ${t(item['sigla'])}`.trim();
      for (let i = 0; i < e.etiquetas; i++) {
        let identificador = identificadorEtiqueta(++seq);
        // Etiqueta migrada ou de outra origem com o mesmo identificador: pula para o próximo livre.
        while (
          await tx.uma<Linha>(
            'SELECT id FROM etiqueta_identificacao WHERE estabelecimento_id = ? AND identificador = ?',
            [est, identificador],
          )
        )
          identificador = identificadorEtiqueta(++seq);
        const m = montarEtiqueta({ identificador, gtin, lote: numeroLote, validade });
        const id = await tx.incluir('etiqueta_identificacao', {
          estabelecimento_id: est,
          identificador,
          insumo_id: e.insumo,
          lote_insumo_id: lote ? n(lote['id']) : null,
          unidade_medida_id: n(item['estoque_unidade_medida_id']),
          quantidade: e.quantidade,
          local_estoque_id: e.local,
          fabricante_id: lote ? nn(lote['fabricante_id']) : null,
          nota_entrada_item_id: e.notaEntradaItem,
          tipo: e.tipo,
          data_validade: validade,
          impressoes: 1,
          situacao: 'ativa',
          origem: 'sistema',
        });
        const em = { id, identificador, ...m };
        emitidas.push(em);
        zpls.push(zplDe(em, t(item['nome']), numeroLote, validade, q));
      }
      return { id: (emitidas[0] as EtiquetaEmitida).id, etiquetas: emitidas, zpl: zpls.join('') };
    });
  }

  ficha(c: ContextoPortaM18, id: number): Promise<FichaEtiqueta | null> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const r = await l.uma<Linha>(
        `SELECT e.id, e.identificador, e.insumo_id, e.quantidade, e.tipo, e.situacao, e.impressoes, e.permite_reimpressao,
                e.data_validade, li.numero_lote, i.nome, i.codigo_gtin, um.sigla
           FROM etiqueta_identificacao e JOIN insumo i ON i.id = e.insumo_id
           JOIN unidade_medida um ON um.id = e.unidade_medida_id
           LEFT JOIN lote_insumo li ON li.id = e.lote_insumo_id
          WHERE e.id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL`,
        [id, ctx.estabelecimento],
      );
      if (!r) return null;
      const identificador = t(r['identificador']);
      const lote = tn(r['numero_lote']);
      const validade = dataIso(r['data_validade']);
      const gtin = await gtinDoItem(l, n(r['insumo_id']), tn(r['codigo_gtin']));
      const m = identificadorValido(identificador)
        ? montarEtiqueta({ identificador, gtin, lote, validade })
        : { datamatrix: identificador, barras: identificador, legivel: identificador };
      const em = { id, identificador, ...m };
      const quantidade = n(r['quantidade']);
      return {
        ...em,
        insumo: n(r['insumo_id']),
        item: t(r['nome']),
        lote,
        validade,
        quantidade,
        tipo: t(r['tipo']),
        situacao: t(r['situacao']),
        impressoes: n(r['impressoes']),
        permiteReimpressao: b(r['permite_reimpressao']),
        zpl: zplDe(em, t(r['nome']), lote, validade, `${qtde(quantidade)} ${t(r['sigla'])}`.trim()),
      };
    });
  }

  ler(c: ContextoPortaM18, codigo: string): Promise<LeituraCodigo> {
    const ctx = this.contexto(c);
    const texto = codigo.slice(0, 200);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const padroes = (
        await l.consultar<Linha>(
          `SELECT * FROM padrao_leitura_codigo WHERE ativo = TRUE ORDER BY fabricante_id IS NULL, id`,
          [],
        )
      ).map(padraoDe);
      const lido = lerCodigo(texto, padroes);
      // As consultas que a resolução pode pedir, feitas antes (a resolução é pura e síncrona).
      const etiquetas = new Map<string, EtiquetaConhecida & { lote: string | null }>();
      for (const cand of [lido.serie, lido.produto]) {
        if (!cand || !identificadorValido(cand)) continue;
        const id = cand.trim().toUpperCase();
        const e = await l.uma<Linha>(
          `SELECT e.identificador, e.insumo_id, e.quantidade, e.situacao, e.data_validade, li.numero_lote
             FROM etiqueta_identificacao e LEFT JOIN lote_insumo li ON li.id = e.lote_insumo_id
            WHERE e.estabelecimento_id = ? AND e.identificador = ? AND e.excluido_em IS NULL`,
          [ctx.estabelecimento, id],
        );
        if (e)
          etiquetas.set(id, {
            identificador: id,
            insumoId: n(e['insumo_id']),
            lote: tn(e['numero_lote']),
            validade: dataIso(e['data_validade']),
            quantidade: n(e['quantidade']),
            situacao: t(e['situacao']) as EtiquetaConhecida['situacao'],
          });
      }
      const codigos = new Map<string, CodigoBarrasConhecido>();
      if (lido.produto) {
        const g = gtin14(lido.produto);
        const cands = [
          ...new Set([g, lido.produto, g?.replace(/^0+(?=.)/, '')].filter((x): x is string => !!x)),
        ];
        const marcas = cands.map(() => '?').join(', ');
        const porCodigo = await l.consultar<Linha>(
          `SELECT b.codigo_barras, b.insumo_id, b.quantidade_representada FROM insumo_codigo_barras b
             JOIN insumo i ON i.id = b.insumo_id AND i.excluido_em IS NULL
            WHERE b.excluido_em IS NULL AND b.codigo_barras IN (${marcas})`,
          cands,
        );
        for (const r of porCodigo)
          codigos.set(t(r['codigo_barras']), {
            codigo: t(r['codigo_barras']),
            insumoId: n(r['insumo_id']),
            quantidadeRepresentada: n(r['quantidade_representada']) || 1,
          });
        const porGtin = await l.consultar<Linha>(
          `SELECT id, codigo_gtin FROM insumo WHERE excluido_em IS NULL AND codigo_gtin IN (${marcas})`,
          cands,
        );
        for (const r of porGtin)
          if (!codigos.has(t(r['codigo_gtin'])))
            codigos.set(t(r['codigo_gtin']), {
              codigo: t(r['codigo_gtin']),
              insumoId: n(r['id']),
              quantidadeRepresentada: 1,
            });
      }
      const res = resolverLeitura(lido, {
        etiqueta: (id) => etiquetas.get(id),
        codigoItem: (cod) => codigos.get(cod),
      });
      if (!res.ok)
        throw recusa(res.recusa.codigo, res.recusa.mensagem, { campos: [...(res.recusa.campos ?? [])] });
      const item = await l.uma<Linha>(
        `SELECT i.id, i.nome, um.sigla, i.controla_lote, i.controlado, i.antimicrobiano, i.consignado, i.situacao
           FROM insumo i JOIN unidade_medida um ON um.id = i.estoque_unidade_medida_id WHERE i.id = ?`,
        [res.insumoId],
      );
      if (!item) throw recusa('codigo-desconhecido', 'Código sem item cadastrado.', { campos: ['codigo'] });
      const lote = res.lote
        ? await l.uma<Linha>(
            `SELECT id, validade, situacao FROM lote_insumo
              WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND excluido_em IS NULL
              ORDER BY validade = ? DESC, id DESC LIMIT 1`,
            [ctx.estabelecimento, res.insumoId, res.lote, res.validade],
          )
        : null;
      const validadeLote = lote ? dataIso(lote['validade']) : null;
      const validade = res.validade ?? validadeLote;
      const hoje = dataIso(new Date()) as string;
      const em30 = dataIso(new Date(Date.now() + 30 * 86_400_000)) as string;
      const alertas: string[] = [];
      if (validade && validade < hoje) alertas.push('vencido');
      else if (validade && validade <= em30) alertas.push('vence-30-dias');
      if (lote && t(lote['situacao']) !== 'liberado') alertas.push('lote-bloqueado');
      if (res.validade && validadeLote && res.validade !== validadeLote) alertas.push('validade-divergente');
      return {
        item: {
          codigo: n(item['id']),
          nome: t(item['nome']),
          unidade: t(item['sigla']),
          rastreavel: b(item['controla_lote']),
          controlado: b(item['controlado']),
          antimicrobiano: b(item['antimicrobiano']),
          consignado: b(item['consignado']),
          ativo: t(item['situacao']) === 'ativo',
        },
        quantidade: res.quantidade,
        lote: res.lote,
        loteId: lote ? n(lote['id']) : null,
        validade,
        identificador: res.identificador,
        origem: res.origem,
        padrao: lido.padraoId,
        alertas,
      };
    });
  }

  baixar(
    c: ContextoPortaM18,
    e: BaixaEtiquetasEntrada,
    chave: string,
  ): Promise<{ id: number; baixadas: number }> {
    return this.executar(c, 'baixar', { ...e }, chave, async (tx, est) => {
      // O movimento (a saída gravada) fica na trilha da baixa; a coluna do movimento na etiqueta é o que a gerou.
      let primeiro = 0;
      for (const bruto of [...new Set(e.identificadores.map((x) => x.trim().toUpperCase()))]) {
        const r = (
          await tx.consultarParaAtualizar<Linha>(
            `SELECT id, versao, situacao FROM etiqueta_identificacao
              WHERE estabelecimento_id = ? AND identificador = ? AND excluido_em IS NULL`,
            [est, bruto],
          )
        )[0];
        if (!r)
          throw recusa('etiqueta-desconhecida', `Etiqueta ${bruto} não encontrada neste estabelecimento.`, {
            campos: ['identificadores'],
          });
        const p = proximaSituacaoEtiqueta(t(r['situacao']) as EtiquetaConhecida['situacao'], e.situacao);
        if (!p.ok)
          throw recusa(p.recusa.codigo, `${bruto}: ${p.recusa.mensagem}`, { campos: ['identificadores'] });
        await tx.alterar('etiqueta_identificacao', n(r['id']), n(r['versao']), { situacao: p.situacao });
        primeiro ||= n(r['id']);
      }
      return { id: primeiro, baixadas: new Set(e.identificadores.map((x) => x.trim().toUpperCase())).size };
    });
  }
}
