// Itens agendáveis (02-AGE linha 45) sobre item_agendavel e as regras filhas (composição do pacote, conflito,
// pré-requisito, recurso exigido e orientação por fonte pagadora), e o lançamento dos itens na marcação com a crítica
// (pré-requisito, conflito, repetição mínima, equipamento livre) e o preparo entregue ao paciente
// (marcacao_horario_item.orientacao_preparo) e o equipamento reservado (marcacao_equipamento). As regras são do
// domínio (`validarItemAgendavel`, `criticarItensDaMarcacao`, `montarPreparo` em @sgh/dominio-agenda); aqui ficam a
// leitura, as gravações pelo executor (trilha na mesma transação) e a montagem do que o domínio decide. Nada se apaga:
// regra retirada fica com exclusão lógica (ou "ativo = falso" nas tabelas sem exclusão) e a trilha guarda o histórico.
import {
  combinarPreparo,
  type ComponenteItem,
  type ConflitoItem,
  criticarItensDaMarcacao,
  desdobrarItens,
  formaCicloDeRequisito,
  type ItemAgendavelEntrada,
  montarPreparo,
  type OcupacaoRecurso,
  type PreparoDoItem,
  type RecursoItem,
  type RegrasDoItem,
  type RequisitoItem,
  validarItemAgendavel,
} from '@sgh/dominio-agenda';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { localDe, type NucleoAgenda } from './porta-propria.js';

const num = (v: unknown): number => Number(v);
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const instante = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const marc = (n: number) => Array.from({ length: n }, () => '?').join(', ');
type Le = Pick<Leitor, 'consultar' | 'uma'>;

const id = z.number().int().positive();
export const esquemaSalvarItem = z
  .object({
    id: id.optional(),
    /** Versão que a tela leu (obrigatória na alteração): diferente da do banco, 409 conflito-versao. */
    versao: z.number().int().positive().optional(),
    codigo: z.string().max(30),
    descricao: z.string().max(150),
    tipoItem: z.string().max(30),
    duracaoMinutos: z.number().int(),
    diasPreparo: z.number().int().nullable().default(null),
    orientacaoPreparo: z.string().max(4000).nullable().default(null),
    intervaloRepeticaoMinutos: z.number().int().nullable().default(null),
    exigeAutorizacao: z.boolean().default(false),
    exigeIndicacaoClinica: z.boolean().default(false),
    teleatendimento: z.boolean().default(false),
    ativo: z.boolean().default(true),
    composicao: z
      .array(z.object({ componente: id, quantidade: z.number().positive() }))
      .max(100)
      .default([]),
    conflitos: z
      .array(
        z.object({
          item: id,
          intervaloMinimoHoras: z.number().positive().max(9_999_999),
          direcao: z.enum(['antes', 'depois', 'ambos']),
        }),
      )
      .max(100)
      .default([]),
    requisitos: z
      .array(
        z.object({
          tipo: z.enum(['item_realizado', 'item_marcado', 'autorizacao', 'documento', 'condicao']),
          item: id.nullable(),
          descricao: z.string().max(500).nullable(),
          prazoMaximoDias: z.number().int().nullable(),
          bloqueia: z.boolean(),
        }),
      )
      .max(50)
      .default([]),
    recursos: z
      .array(
        z.object({ recurso: id, papel: z.enum(['realiza', 'exigido']), quantidade: z.number().positive() }),
      )
      .max(50)
      .default([]),
    orientacoes: z
      .array(z.object({ fontePagadora: id, orientacao: z.string().max(4000) }))
      .max(200)
      .default([]),
  })
  .refine((e) => !e.id || e.versao !== undefined, {
    message: 'A alteração leva a versão lida.',
    path: ['versao'],
  });
export type EntradaSalvarItem = z.infer<typeof esquemaSalvarItem>;

export const esquemaLancarItens = z.object({
  marcacao: id,
  itens: z.array(id).min(1).max(20),
});
export type EntradaLancarItens = z.infer<typeof esquemaLancarItens>;

export interface ItemResumo {
  id: number;
  codigo: string;
  descricao: string;
  tipoItem: string;
  duracaoMinutos: number;
  ativo: boolean;
  versao: number;
  regras: {
    composicao: number;
    conflitos: number;
    requisitos: number;
    recursos: number;
    orientacoes: number;
  };
}
export interface ItemLido extends EntradaSalvarItem {
  id: number;
  versao: number;
  nomes: Record<string, string>;
}
export interface OpcoesItem {
  itens: { id: number; nome: string; tipo: string }[];
  recursos: { id: number; nome: string }[];
  fontes: { id: number; nome: string }[];
}
export interface ResultadoCriticaLida {
  itens: { id: number; descricao: string; preparo: string | null; inicioPreparo: string | null }[];
  bloqueios: { codigo: string; item: number; mensagem: string }[];
  alertas: { codigo: string; item: number; mensagem: string }[];
}
export interface ItensDaMarcacao {
  marcacao: number;
  itens: {
    sequencia: number;
    item: number | null;
    descricao: string;
    situacao: string;
    preparo: string | null;
  }[];
  equipamentos: { equipamento: number; nome: string; quantidade: number }[];
}

export interface ContextoItens {
  readonly hospital: string;
  readonly login: string;
}
type ContextoGravacaoItens = ContextoItens & {
  correlacao: string;
  chaveIdempotencia: string;
  enderecoIp?: string;
};

const SEL_COMPOSICAO =
  'SELECT id, versao, componente_item_agendavel_id, quantidade, sequencia, excluido_em FROM item_agendavel_composicao WHERE item_agendavel_id = ?';
const SEL_CONFLITO =
  'SELECT id, versao, conflito_item_agendavel_id, intervalo_minimo_horas, direcao, ativo FROM item_agendavel_conflito WHERE item_agendavel_id = ?';
const SEL_REQUISITO =
  'SELECT id, versao, tipo_requisito, requisito_item_agendavel_id, descricao_condicao, prazo_maximo_dias, bloqueia_marcacao, ativo FROM item_agendavel_pre_requisito WHERE item_agendavel_id = ?';
const SEL_RECURSO =
  'SELECT id, versao, recurso_agendavel_id, papel, quantidade, excluido_em FROM item_agendavel_recurso WHERE item_agendavel_id = ?';
/** Os recursos do item na unidade: o item é da rede, o recurso é de um estabelecimento; os das outras ficam intactos. */
const DA_UNIDADE =
  ' AND recurso_agendavel_id IN (SELECT ra.id FROM recurso_agendavel ra WHERE ra.estabelecimento_id = ?)';
const SEL_ORIENTACAO =
  'SELECT id, versao, fonte_pagadora_id, orientacao, ativo, excluido_em FROM item_agendavel_orientacao_fonte_pagadora WHERE item_agendavel_id = ?';

/** Valor normalizado para comparar o que veio da tela com a linha (DECIMAL em texto, booleano em 0/1). */
const norm = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const s = String(v);
  return s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : s;
};

type Valores = Record<string, unknown>;

/**
 * Sincroniza as linhas filhas com a lista da tela: o que saiu é retirado (sem apagar), o que voltou é reativado, o que
 * mudou é alterado pela versão e o que é novo é incluído. Devolve quantas ficaram ativas.
 */
async function sincronizar(
  tx: TxOperacao,
  tabela: string,
  linhas: Linha[],
  chave: (x: Linha) => string,
  ativa: (x: Linha) => boolean,
  novos: Map<string, Valores>,
  retirar: Valores,
  reativar: Valores,
  incluir: (v: Valores) => Valores,
): Promise<number> {
  const vistas = new Set<string>();
  for (const x of linhas) {
    const k = chave(x);
    const n = novos.get(k);
    if (!n || vistas.has(k)) {
      if (ativa(x)) await tx.alterar(tabela, num(x['id']), num(x['versao']), retirar);
      continue;
    }
    vistas.add(k);
    const muda = Object.entries(n).some(([c, v]) => norm(x[c]) !== norm(v));
    if (!ativa(x) || muda) await tx.alterar(tabela, num(x['id']), num(x['versao']), { ...reativar, ...n });
  }
  for (const [k, n] of novos) if (!vistas.has(k)) await tx.incluir(tabela, incluir(n));
  return novos.size;
}

export class ItensAgendaveisPropria {
  private readonly executor: Executor;
  private readonly salvarOp = definirOperacao<EntradaSalvarItem, { item: number; regras: number }>({
    nome: 'agenda.item_agendavel_salvar',
    tabelas: [
      'item_agendavel',
      'item_agendavel_composicao',
      'item_agendavel_conflito',
      'item_agendavel_pre_requisito',
      'item_agendavel_recurso',
      'item_agendavel_orientacao_fonte_pagadora',
    ],
    entrada: esquemaSalvarItem as unknown as z.ZodType<EntradaSalvarItem>,
    gravar: (tx, e, ctx) => this.gravarItem(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'item_agendavel', id: r.item }),
  });
  private readonly lancarOp = definirOperacao<
    EntradaLancarItens,
    { marcacao: number; itens: number; equipamentos: number; alertas: string }
  >({
    nome: 'agenda.marcacao_itens_lancar',
    tabelas: ['marcacao_horario_item', 'marcacao_horario', 'marcacao_equipamento'],
    entrada: esquemaLancarItens as unknown as z.ZodType<EntradaLancarItens>,
    gravar: (tx, e, ctx) => this.gravarLancamento(tx, e, ctx),
    alvo: (e) => ({ tabela: 'marcacao_horario', id: e.marcacao }),
  });

  constructor(
    private readonly nucleo: NucleoAgenda,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private async quem(
    c: ContextoItens,
  ): Promise<{ estabelecimento: number; usuario: number | null; fuso: string }> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'item-agendavel' }, async (l) => {
      const e = await l.uma(
        'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [c.hospital],
      );
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return {
        estabelecimento: num(e['id']),
        usuario: u ? num(u['id']) : null,
        fuso: String(e['fuso_horario'] || 'America/Sao_Paulo'),
      };
    });
  }

  private ler<T>(estabelecimento: number, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'item-agendavel', estabelecimento },
      fn,
    );
  }

  // ── Leitura ────────────────────────────────────────────────────────────────────────────────────────

  async listar(c: ContextoItens, busca: string | null): Promise<ItemResumo[]> {
    const q = await this.quem(c);
    const termo = busca?.trim() ? `%${busca.trim()}%` : null;
    return this.ler(q.estabelecimento, async (l) => {
      const xs = await l.consultar(
        `SELECT i.id, i.codigo, i.descricao, i.tipo_item, i.duracao_minutos, i.ativo, i.versao,
            (SELECT COUNT(*) FROM item_agendavel_composicao x WHERE x.item_agendavel_id = i.id AND x.excluido_em IS NULL) AS n_comp,
            (SELECT COUNT(*) FROM item_agendavel_conflito x WHERE x.item_agendavel_id = i.id AND x.ativo) AS n_conf,
            (SELECT COUNT(*) FROM item_agendavel_pre_requisito x WHERE x.item_agendavel_id = i.id AND x.ativo) AS n_req,
            (SELECT COUNT(*) FROM item_agendavel_recurso x JOIN recurso_agendavel ra ON ra.id = x.recurso_agendavel_id
              WHERE x.item_agendavel_id = i.id AND x.excluido_em IS NULL AND ra.estabelecimento_id = ?) AS n_rec,
            (SELECT COUNT(*) FROM item_agendavel_orientacao_fonte_pagadora x WHERE x.item_agendavel_id = i.id AND x.excluido_em IS NULL) AS n_ori
           FROM item_agendavel i
          WHERE i.excluido_em IS NULL AND (? IS NULL OR i.codigo LIKE ? OR i.descricao LIKE ?)
          ORDER BY i.ativo DESC, i.descricao LIMIT 300`,
        [q.estabelecimento, termo, termo, termo],
      );
      return xs.map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        tipoItem: String(x['tipo_item']),
        duracaoMinutos: num(x['duracao_minutos']),
        ativo: bool(x['ativo']),
        versao: num(x['versao']),
        regras: {
          composicao: num(x['n_comp']),
          conflitos: num(x['n_conf']),
          requisitos: num(x['n_req']),
          recursos: num(x['n_rec']),
          orientacoes: num(x['n_ori']),
        },
      }));
    });
  }

  async opcoes(c: ContextoItens): Promise<OpcoesItem> {
    const q = await this.quem(c);
    return this.ler(q.estabelecimento, async (l) => ({
      itens: (
        await l.consultar(
          'SELECT id, codigo, descricao, tipo_item FROM item_agendavel WHERE excluido_em IS NULL AND ativo ORDER BY descricao LIMIT 2000',
        )
      ).map((x) => ({
        id: num(x['id']),
        nome: `${x['codigo']} — ${x['descricao']}`,
        tipo: String(x['tipo_item']),
      })),
      recursos: (
        await l.consultar(
          'SELECT id, descricao FROM recurso_agendavel WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo ORDER BY descricao LIMIT 500',
          [q.estabelecimento],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['descricao']) })),
      fontes: (
        await l.consultar(
          'SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome LIMIT 500',
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) })),
    }));
  }

  async lerItem(c: ContextoItens, item: number): Promise<ItemLido> {
    const q = await this.quem(c);
    return this.ler(q.estabelecimento, async (l) => {
      const i = await l.uma('SELECT * FROM item_agendavel WHERE id = ? AND excluido_em IS NULL', [item]);
      if (!i)
        throw new ErroOperacao(404, 'registro-inexistente', 'Item não encontrado', 'O item não existe.');
      const comp = await l.consultar(`${SEL_COMPOSICAO} AND excluido_em IS NULL ORDER BY sequencia`, [item]);
      const conf = await l.consultar(`${SEL_CONFLITO} AND ativo`, [item]);
      const req = await l.consultar(`${SEL_REQUISITO} AND ativo`, [item]);
      const rec = await l.consultar(`${SEL_RECURSO} AND excluido_em IS NULL${DA_UNIDADE}`, [
        item,
        q.estabelecimento,
      ]);
      const ori = await l.consultar(`${SEL_ORIENTACAO} AND excluido_em IS NULL`, [item]);
      const nomes: Record<string, string> = {};
      const refs = [
        ...comp.map((x) => num(x['componente_item_agendavel_id'])),
        ...conf.map((x) => num(x['conflito_item_agendavel_id'])),
        ...req
          .filter((x) => x['requisito_item_agendavel_id'] != null)
          .map((x) => num(x['requisito_item_agendavel_id'])),
      ];
      if (refs.length > 0)
        for (const x of await l.consultar(
          `SELECT id, codigo, descricao FROM item_agendavel WHERE id IN (${marc(refs.length)})`,
          refs,
        ))
          nomes[`item:${x['id']}`] = `${x['codigo']} — ${x['descricao']}`;
      const recs = rec.map((x) => num(x['recurso_agendavel_id']));
      if (recs.length > 0)
        for (const x of await l.consultar(
          `SELECT id, descricao FROM recurso_agendavel WHERE id IN (${marc(recs.length)})`,
          recs,
        ))
          nomes[`recurso:${x['id']}`] = String(x['descricao']);
      const fps = ori.map((x) => num(x['fonte_pagadora_id']));
      if (fps.length > 0)
        for (const x of await l.consultar(
          `SELECT id, nome FROM fonte_pagadora WHERE id IN (${marc(fps.length)})`,
          fps,
        ))
          nomes[`fonte:${x['id']}`] = String(x['nome']);
      return {
        id: num(i['id']),
        versao: num(i['versao']),
        codigo: String(i['codigo']),
        descricao: String(i['descricao']),
        tipoItem: String(i['tipo_item']),
        duracaoMinutos: num(i['duracao_minutos']),
        diasPreparo: numN(i['dias_preparo']),
        orientacaoPreparo: i['orientacao_preparo'] == null ? null : String(i['orientacao_preparo']),
        intervaloRepeticaoMinutos: numN(i['intervalo_repeticao_minutos']),
        exigeAutorizacao: bool(i['exige_autorizacao']),
        exigeIndicacaoClinica: bool(i['exige_indicacao_clinica']),
        teleatendimento: bool(i['teleatendimento']),
        ativo: bool(i['ativo']),
        composicao: comp.map((x) => ({
          componente: num(x['componente_item_agendavel_id']),
          quantidade: num(x['quantidade']),
        })),
        conflitos: conf.map((x) => ({
          item: num(x['conflito_item_agendavel_id']),
          intervaloMinimoHoras: num(x['intervalo_minimo_horas']),
          direcao: x['direcao'] as 'antes' | 'depois' | 'ambos',
        })),
        requisitos: req.map((x) => ({
          tipo: x['tipo_requisito'] as RequisitoItem['tipo'],
          item: numN(x['requisito_item_agendavel_id']),
          descricao: x['descricao_condicao'] == null ? null : String(x['descricao_condicao']),
          prazoMaximoDias: numN(x['prazo_maximo_dias']),
          bloqueia: bool(x['bloqueia_marcacao']),
        })),
        recursos: rec.map((x) => ({
          recurso: num(x['recurso_agendavel_id']),
          papel: x['papel'] as 'realiza' | 'exigido',
          quantidade: num(x['quantidade']),
        })),
        orientacoes: ori.map((x) => ({
          fontePagadora: num(x['fonte_pagadora_id']),
          orientacao: String(x['orientacao']),
        })),
        nomes,
      };
    });
  }

  /** A crítica sem gravar: o que a tela mostra antes de lançar (bloqueios, alertas e o preparo de cada item). */
  async criticar(c: ContextoItens, marcacao: number, itens: number[]): Promise<ResultadoCriticaLida> {
    const q = await this.quem(c);
    return this.ler(q.estabelecimento, async (l) => {
      const r = await this.montarCritica(l, q.estabelecimento, q.fuso, marcacao, itens);
      return {
        itens: r.itens.map((i) => ({
          id: i.id,
          descricao: i.descricao,
          preparo: i.preparo.texto,
          inicioPreparo: i.preparo.inicioPreparo,
        })),
        bloqueios: [...r.bloqueios],
        alertas: [...r.alertas],
      };
    });
  }

  /** Itens lançados na marcação, com o preparo entregue, e os equipamentos reservados. */
  async itensDaMarcacao(c: ContextoItens, marcacao: number): Promise<ItensDaMarcacao> {
    const q = await this.quem(c);
    return this.ler(q.estabelecimento, async (l) => {
      const m = await l.uma(
        'SELECT id FROM marcacao_horario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [marcacao, q.estabelecimento],
      );
      if (!m)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Marcação não encontrada',
          'A marcação não existe.',
        );
      const xs = await l.consultar(
        `SELECT mi.sequencia, mi.item_agendavel_id, mi.situacao, mi.orientacao_preparo, i.descricao
           FROM marcacao_horario_item mi LEFT JOIN item_agendavel i ON i.id = mi.item_agendavel_id
          WHERE mi.marcacao_horario_id = ? AND mi.excluido_em IS NULL ORDER BY mi.sequencia`,
        [marcacao],
      );
      const eq = await l.consultar(
        `SELECT me.equipamento_saude_id, me.quantidade, e.nome AS descricao
           FROM marcacao_equipamento me JOIN equipamento_saude e ON e.id = me.equipamento_saude_id
          WHERE me.marcacao_horario_id = ? AND me.excluido_em IS NULL ORDER BY e.nome`,
        [marcacao],
      );
      return {
        marcacao,
        itens: xs.map((x) => ({
          sequencia: num(x['sequencia']),
          item: numN(x['item_agendavel_id']),
          descricao: String(x['descricao'] ?? ''),
          situacao: String(x['situacao']),
          preparo: x['orientacao_preparo'] == null ? null : String(x['orientacao_preparo']),
        })),
        equipamentos: eq.map((x) => ({
          equipamento: num(x['equipamento_saude_id']),
          nome: String(x['descricao']),
          quantidade: num(x['quantidade']),
        })),
      };
    });
  }

  // ── Gravação ───────────────────────────────────────────────────────────────────────────────────────

  private async contexto(c: ContextoGravacaoItens): Promise<ContextoOperacao> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        'Gravar exige uma conta de usuário do cliente (o responsável fica no registro).',
      );
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  async salvar(
    c: ContextoGravacaoItens,
    entrada: unknown,
  ): Promise<{ resultado: { item: number; regras: number }; repetida: boolean }> {
    const r = await this.executor.executar(this.salvarOp, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  async lancar(
    c: ContextoGravacaoItens,
    entrada: unknown,
  ): Promise<{
    resultado: { marcacao: number; itens: number; equipamentos: number; alertas: string };
    repetida: boolean;
  }> {
    const r = await this.executor.executar(this.lancarOp, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async gravarItem(
    tx: TxOperacao,
    e: EntradaSalvarItem,
    ctx: ContextoOperacao,
  ): Promise<{ item: number; regras: number }> {
    const proprio = e.id ?? null;
    const rv = validarItemAgendavel(e as ItemAgendavelEntrada, proprio);
    if (rv) throw recusa(rv.codigo, rv.mensagem, rv.campo ? { campos: [rv.campo] } : undefined);
    const codigo = e.codigo.trim().toUpperCase();
    const dono = await tx.uma('SELECT id FROM item_agendavel WHERE codigo = ?', [codigo]);
    if (dono && num(dono['id']) !== proprio)
      throw recusa('codigo-repetido', 'Já existe um item agendável com este código.', { campos: ['codigo'] });
    // Os itens citados existem; o componente do pacote não é outro pacote (um nível só).
    const citados = [
      ...new Set([
        ...e.composicao.map((x) => x.componente),
        ...e.conflitos.map((x) => x.item),
        ...e.requisitos.filter((x) => x.item !== null).map((x) => x.item as number),
      ]),
    ];
    if (citados.length > 0) {
      const xs = await tx.consultar(
        `SELECT id, tipo_item FROM item_agendavel WHERE excluido_em IS NULL AND id IN (${marc(citados.length)})`,
        citados,
      );
      if (xs.length !== citados.length)
        throw recusa('item-citado-inexistente', 'Um item citado nas regras não existe.', {
          campos: ['regras'],
        });
      const pacotes = new Set(xs.filter((x) => x['tipo_item'] === 'composto').map((x) => num(x['id'])));
      if (e.composicao.some((x) => pacotes.has(x.componente)))
        throw recusa('pacote-dentro-de-pacote', 'Um pacote não entra na composição de outro pacote.', {
          campos: ['composicao'],
        });
    }
    if (e.recursos.length > 0) {
      const ids = e.recursos.map((x) => x.recurso);
      const xs = await tx.consultar(
        `SELECT id FROM recurso_agendavel WHERE excluido_em IS NULL AND estabelecimento_id = ? AND id IN (${marc(ids.length)})`,
        [ctx.estabelecimento, ...ids],
      );
      if (xs.length !== ids.length)
        throw recusa('recurso-inexistente', 'Um recurso não existe ou não é desta unidade.', {
          campos: ['recursos'],
        });
    }
    if (e.orientacoes.length > 0) {
      const ids = e.orientacoes.map((x) => x.fontePagadora);
      const xs = await tx.consultar(
        `SELECT id FROM fonte_pagadora WHERE excluido_em IS NULL AND id IN (${marc(ids.length)})`,
        ids,
      );
      if (xs.length !== ids.length)
        throw recusa('convenio-inexistente', 'Um convênio das orientações não existe.', {
          campos: ['orientacoes'],
        });
    }
    const exigidos = e.requisitos.filter((x) => x.item !== null).map((x) => x.item as number);
    if (proprio !== null && exigidos.length > 0) {
      const arestas = (
        await tx.consultar(
          'SELECT item_agendavel_id, requisito_item_agendavel_id FROM item_agendavel_pre_requisito WHERE ativo AND requisito_item_agendavel_id IS NOT NULL',
          [],
          { teto: 100_000 },
        )
      ).map((x) => ({ item: num(x['item_agendavel_id']), exigido: num(x['requisito_item_agendavel_id']) }));
      if (formaCicloDeRequisito(proprio, exigidos, arestas))
        throw recusa(
          'requisito-circular',
          'Os pré-requisitos ficariam em círculo (um item exige o outro de volta): a marcação ficaria impossível.',
          { campos: ['requisitos'] },
        );
    }
    const valores = {
      codigo,
      descricao: e.descricao.trim(),
      tipo_item: e.tipoItem,
      duracao_minutos: e.duracaoMinutos,
      dias_preparo: e.diasPreparo,
      orientacao_preparo: e.orientacaoPreparo?.trim() || null,
      intervalo_repeticao_minutos: e.intervaloRepeticaoMinutos,
      exige_autorizacao: e.exigeAutorizacao,
      exige_indicacao_clinica: e.exigeIndicacaoClinica,
      teleatendimento: e.teleatendimento,
      ativo: e.ativo,
    };
    let item: number;
    if (proprio !== null) {
      const [x] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM item_agendavel WHERE id = ? AND excluido_em IS NULL',
        [proprio],
        { teto: 1 },
      );
      if (!x)
        throw new ErroOperacao(404, 'registro-inexistente', 'Item não encontrado', 'O item não existe mais.');
      item = proprio;
      await tx.alterar('item_agendavel', item, e.versao!, valores);
    } else {
      item = await tx.incluir('item_agendavel', valores);
    }
    const agora = this.agora();
    const logico = { excluido_em: agora, excluido_por: ctx.usuario };
    const volta = { excluido_em: null, excluido_por: null };
    const porExclusao = (x: Linha) => x['excluido_em'] === null;
    const porAtivo = (x: Linha) => bool(x['ativo']);
    let n = 0;
    // Composição: a sequência nova continua depois da maior já usada (a chave única inclui as retiradas).
    const comp = await tx.consultarParaAtualizar(SEL_COMPOSICAO, [item]);
    let seq = comp.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0);
    n += await sincronizar(
      tx,
      'item_agendavel_composicao',
      comp,
      (x) => String(num(x['componente_item_agendavel_id'])),
      porExclusao,
      new Map(
        e.composicao.map((x) => [
          String(x.componente),
          { componente_item_agendavel_id: x.componente, quantidade: x.quantidade },
        ]),
      ),
      logico,
      volta,
      (v) => ({ item_agendavel_id: item, sequencia: ++seq, ...v }),
    );
    n += await sincronizar(
      tx,
      'item_agendavel_conflito',
      await tx.consultarParaAtualizar(SEL_CONFLITO, [item]),
      (x) => String(num(x['conflito_item_agendavel_id'])),
      porAtivo,
      new Map(
        e.conflitos.map((x) => [
          String(x.item),
          {
            conflito_item_agendavel_id: x.item,
            intervalo_minimo_horas: x.intervaloMinimoHoras,
            direcao: x.direcao,
          },
        ]),
      ),
      { ativo: false },
      { ativo: true },
      (v) => ({ item_agendavel_id: item, ...v }),
    );
    const chaveReq = (item: number | null, tipo: string, descricao: string | null) =>
      item !== null ? `i:${item}` : `c:${tipo}:${(descricao ?? '').trim()}`;
    n += await sincronizar(
      tx,
      'item_agendavel_pre_requisito',
      await tx.consultarParaAtualizar(SEL_REQUISITO, [item]),
      (x) =>
        chaveReq(
          numN(x['requisito_item_agendavel_id']),
          String(x['tipo_requisito']),
          x['descricao_condicao'] == null ? null : String(x['descricao_condicao']),
        ),
      porAtivo,
      new Map(
        e.requisitos.map((x) => [
          chaveReq(x.item, x.tipo, x.descricao),
          {
            tipo_requisito: x.tipo,
            requisito_item_agendavel_id: x.item,
            descricao_condicao: x.descricao?.trim() || null,
            prazo_maximo_dias: x.prazoMaximoDias,
            bloqueia_marcacao: x.bloqueia,
          },
        ]),
      ),
      { ativo: false },
      { ativo: true },
      (v) => ({ item_agendavel_id: item, ...v }),
    );
    n += await sincronizar(
      tx,
      'item_agendavel_recurso',
      await tx.consultarParaAtualizar(`${SEL_RECURSO}${DA_UNIDADE}`, [item, ctx.estabelecimento]),
      (x) => String(num(x['recurso_agendavel_id'])),
      porExclusao,
      new Map(
        e.recursos.map((x) => [
          String(x.recurso),
          { recurso_agendavel_id: x.recurso, papel: x.papel, quantidade: x.quantidade },
        ]),
      ),
      logico,
      volta,
      (v) => ({ item_agendavel_id: item, ...v }),
    );
    n += await sincronizar(
      tx,
      'item_agendavel_orientacao_fonte_pagadora',
      await tx.consultarParaAtualizar(SEL_ORIENTACAO, [item]),
      (x) => String(num(x['fonte_pagadora_id'])),
      porExclusao,
      new Map(
        e.orientacoes.map((x) => [
          String(x.fontePagadora),
          { fonte_pagadora_id: x.fontePagadora, orientacao: x.orientacao.trim() },
        ]),
      ),
      logico,
      { ...volta, ativo: true },
      (v) => ({ item_agendavel_id: item, ...v }),
    );
    return { item, regras: n };
  }

  /**
   * Lê o que a crítica precisa (a marcação, os itens desdobrados com as regras ativas, o histórico do paciente, a
   * ocupação dos recursos no intervalo e as orientações do convênio) e entrega ao domínio. Serve à leitura e à gravação
   * (na gravação, dentro da transação, com a marcação travada).
   */
  private async montarCritica(
    l: Le,
    est: number,
    fuso: string,
    marcacao: number,
    pedidos: number[],
    trava?: TxOperacao,
  ) {
    const m = await l.uma(
      `SELECT mh.id, mh.versao, mh.paciente_id, mh.pre_cadastro_id, mh.fonte_pagadora_id, mh.item_agendavel_id,
              mh.duracao_minutos, ha.inicio_em, s.significado
         FROM marcacao_horario mh
         JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id
         JOIN situacao_marcacao s ON s.id = mh.situacao_marcacao_id
        WHERE mh.id = ? AND mh.estabelecimento_id = ? AND mh.excluido_em IS NULL`,
      [marcacao, est],
    );
    if (!m)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Marcação não encontrada',
        'A marcação não existe.',
      );
    if (m['significado'] === 'cancelada' || m['significado'] === 'falta')
      throw recusa('marcacao-encerrada', 'A marcação está cancelada ou com falta: não recebe itens.');
    const inicio = instante(m['inicio_em']);
    const fim = new Date(inicio.getTime() + num(m['duracao_minutos']) * 60_000);
    const unicos = [...new Set(pedidos)];
    const comp = new Map<number, ComponenteItem[]>();
    for (const x of await l.consultar(
      `SELECT item_agendavel_id, componente_item_agendavel_id, quantidade FROM item_agendavel_composicao
        WHERE excluido_em IS NULL AND item_agendavel_id IN (${marc(unicos.length)}) ORDER BY sequencia`,
      unicos,
    ))
      comp.set(num(x['item_agendavel_id']), [
        ...(comp.get(num(x['item_agendavel_id'])) ?? []),
        { componente: num(x['componente_item_agendavel_id']), quantidade: num(x['quantidade']) },
      ]);
    // O pacote vira os componentes (com a quantidade da composição); as regras e o preparo do próprio pacote também
    // entram na crítica (o pacote não é lançado: são os componentes que se realizam e se faturam).
    const desdobrados = desdobrarItens(unicos, comp);
    const ids = desdobrados.map((d) => d.item);
    const pacotes = unicos.filter((x) => comp.has(x) && !ids.includes(x));
    const todos = [...ids, ...pacotes];
    const linhas = await l.consultar(
      `SELECT id, descricao, ativo, tipo_item, duracao_minutos, intervalo_repeticao_minutos, dias_preparo,
              orientacao_preparo, item_faturavel_id, exame_id
         FROM item_agendavel WHERE excluido_em IS NULL AND id IN (${marc(todos.length)})`,
      todos,
    );
    if (linhas.length !== todos.length)
      throw recusa('item-inexistente', 'Um dos itens escolhidos não existe.', { campos: ['itens'] });
    const req = await l.consultar(
      `SELECT item_agendavel_id, tipo_requisito, requisito_item_agendavel_id, descricao_condicao, prazo_maximo_dias, bloqueia_marcacao
         FROM item_agendavel_pre_requisito WHERE ativo AND item_agendavel_id IN (${marc(todos.length)})`,
      todos,
    );
    const conf = await l.consultar(
      `SELECT item_agendavel_id, conflito_item_agendavel_id, intervalo_minimo_horas, direcao FROM item_agendavel_conflito
        WHERE ativo AND (item_agendavel_id IN (${marc(todos.length)}) OR conflito_item_agendavel_id IN (${marc(todos.length)}))`,
      [...todos, ...todos],
    );
    // Só os recursos da unidade da marcação: o item é da rede, o recurso é de um estabelecimento.
    const rec = await l.consultar(
      `SELECT x.item_agendavel_id, x.recurso_agendavel_id, x.papel, x.quantidade
         FROM item_agendavel_recurso x JOIN recurso_agendavel ra ON ra.id = x.recurso_agendavel_id
        WHERE x.excluido_em IS NULL AND ra.estabelecimento_id = ? AND x.item_agendavel_id IN (${marc(todos.length)})`,
      [est, ...todos],
    );
    const inverso = { antes: 'depois', depois: 'antes', ambos: 'ambos' } as const;
    const conflitosDe = (it: number): ConflitoItem[] => {
      const saida: ConflitoItem[] = [];
      for (const x of conf) {
        const a = num(x['item_agendavel_id']);
        const b = num(x['conflito_item_agendavel_id']);
        const h = num(x['intervalo_minimo_horas']);
        const d = x['direcao'] as ConflitoItem['direcao'];
        if (a === it) saida.push({ item: b, intervaloMinimoHoras: h, direcao: d });
        else if (b === it && !todos.includes(a))
          saida.push({ item: a, intervaloMinimoHoras: h, direcao: inverso[d] });
      }
      return saida;
    };
    const qtd = new Map(desdobrados.map((d) => [d.item, d.quantidade]));
    const regras: RegrasDoItem[] = todos.map((it) => {
      const x = linhas.find((y) => num(y['id']) === it)!;
      return {
        id: it,
        quantidade: qtd.get(it) ?? 1,
        descricao: String(x['descricao']),
        ativo: bool(x['ativo']),
        duracaoMinutos: num(x['duracao_minutos']),
        intervaloRepeticaoMinutos: numN(x['intervalo_repeticao_minutos']),
        requisitos: req
          .filter((r) => num(r['item_agendavel_id']) === it)
          .map((r) => ({
            tipo: r['tipo_requisito'] as RequisitoItem['tipo'],
            item: numN(r['requisito_item_agendavel_id']),
            descricao: r['descricao_condicao'] == null ? null : String(r['descricao_condicao']),
            prazoMaximoDias: numN(r['prazo_maximo_dias']),
            bloqueia: bool(r['bloqueia_marcacao']),
          })),
        conflitos: conflitosDe(it),
        recursos: rec
          .filter((r) => num(r['item_agendavel_id']) === it)
          .map((r): RecursoItem => ({
            recurso: num(r['recurso_agendavel_id']),
            papel: r['papel'] as RecursoItem['papel'],
            quantidade: num(r['quantidade']),
          })),
      };
    });
    // Histórico do paciente (ou do pré-cadastro) nos itens que as regras citam: marcados e realizados, sem cancelados.
    // Itens já lançados nesta marcação (pedido anterior): contam no conflito como da mesma marcação.
    const jaNaMarcacao = new Set(
      (
        await l.consultar(
          `SELECT item_agendavel_id FROM marcacao_horario_item
            WHERE marcacao_horario_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado' AND item_agendavel_id IS NOT NULL`,
          [marcacao],
        )
      ).map((x) => num(x['item_agendavel_id'])),
    );
    const citados = [
      ...new Set([
        ...todos,
        ...jaNaMarcacao,
        ...regras.flatMap((r) => r.requisitos.filter((q) => q.item !== null).map((q) => q.item as number)),
        ...regras.flatMap((r) => r.conflitos.map((q) => q.item)),
      ]),
    ];
    const pac = m['paciente_id'] ?? null;
    const pre = m['pre_cadastro_id'] ?? null;
    const hist = await l.consultar(
      `SELECT mi.marcacao_horario_id, mi.item_agendavel_id, mi.situacao, ha.inicio_em
         FROM marcacao_horario_item mi
         JOIN marcacao_horario mh ON mh.id = mi.marcacao_horario_id
         JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id
         JOIN situacao_marcacao s ON s.id = mh.situacao_marcacao_id
        WHERE (mh.paciente_id = ? OR (? IS NULL AND mh.pre_cadastro_id = ?))
          AND mh.excluido_em IS NULL AND mi.excluido_em IS NULL AND mi.situacao <> 'cancelado'
          AND s.significado <> 'cancelada' AND mi.item_agendavel_id IN (${marc(citados.length)})`,
      [pac, pac, pre, ...citados],
      { teto: 10_000 },
    );
    // Ocupação de cada recurso no intervalo da marcação pelas outras marcações vivas. Na gravação, as linhas dos
    // recursos são travadas antes (em ordem de id: dois lançamentos no mesmo recurso esperam um pelo outro) e a
    // ocupação é lida com trava (leitura do que já foi gravado, não da fotografia da transação).
    const recursos = [...new Set(rec.map((r) => num(r['recurso_agendavel_id'])))].sort((a, b) => a - b);
    const ocup =
      recursos.length === 0
        ? []
        : trava
          ? await trava.consultarParaAtualizar(
              `SELECT id, descricao, ativo, capacidade, equipamento_saude_id FROM recurso_agendavel
                WHERE excluido_em IS NULL AND estabelecimento_id = ? AND id IN (${marc(recursos.length)}) ORDER BY id`,
              [est, ...recursos],
            )
          : await l.consultar(
              `SELECT id, descricao, ativo, capacidade, equipamento_saude_id FROM recurso_agendavel
                WHERE excluido_em IS NULL AND estabelecimento_id = ? AND id IN (${marc(recursos.length)}) ORDER BY id`,
              [est, ...recursos],
            );
    const SEL_OCUPACAO = `SELECT x.recurso_agendavel_id, x.quantidade AS por_item, mi.quantidade AS vezes
         FROM item_agendavel_recurso x
         JOIN marcacao_horario_item mi ON mi.item_agendavel_id = x.item_agendavel_id
              AND mi.excluido_em IS NULL AND mi.situacao = 'marcado'
         JOIN marcacao_horario mh ON mh.id = mi.marcacao_horario_id AND mh.excluido_em IS NULL AND mh.id <> ?
              AND mh.estabelecimento_id = ?
         JOIN situacao_marcacao s ON s.id = mh.situacao_marcacao_id AND s.significado NOT IN ('cancelada', 'falta')
         JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id
        WHERE x.excluido_em IS NULL AND x.recurso_agendavel_id IN (${marc(Math.max(recursos.length, 1))})
          AND ha.inicio_em < ? AND DATE_ADD(ha.inicio_em, INTERVAL mh.duracao_minutos MINUTE) > ?`;
    // Só as marcações da mesma unidade: o item usa, em cada unidade, os recursos dela.
    const pOcup = [marcacao, est, ...recursos, fim, inicio];
    const usos =
      recursos.length === 0
        ? []
        : trava
          ? await trava.consultarParaAtualizar(SEL_OCUPACAO, pOcup, { teto: 10_000 })
          : await l.consultar(SEL_OCUPACAO, pOcup, { teto: 10_000 });
    const ocupado = new Map<number, number>();
    for (const u of usos) {
      const r = num(u['recurso_agendavel_id']);
      ocupado.set(r, (ocupado.get(r) ?? 0) + num(u['por_item']) * num(u['vezes'] ?? 1));
    }
    const ocupacao: OcupacaoRecurso[] = ocup.map((x) => ({
      recurso: num(x['id']),
      descricao: String(x['descricao']),
      ativo: bool(x['ativo']),
      capacidade: num(x['capacidade']),
      ocupado: ocupado.get(num(x['id'])) ?? 0,
    }));
    const nomes = new Map<number, string>();
    for (const x of await l.consultar(
      `SELECT id, descricao FROM item_agendavel WHERE id IN (${marc(citados.length)})`,
      citados,
    ))
      nomes.set(num(x['id']), String(x['descricao']));
    const r = criticarItensDaMarcacao({
      marcacao,
      inicio: inicio.getTime(),
      itens: regras,
      nomes,
      historico: hist.map((h) => ({
        item: num(h['item_agendavel_id']),
        inicio: instante(h['inicio_em']).getTime(),
        realizado: h['situacao'] === 'realizado',
        marcacao: num(h['marcacao_horario_id']),
      })),
      recursos: ocupacao,
      jaLancados: [...jaNaMarcacao],
    });
    const bloqueios = [...r.bloqueios];
    for (const it of ids)
      if (jaNaMarcacao.has(it))
        bloqueios.push({
          codigo: 'item-ja-lancado',
          item: it,
          mensagem: `${nomes.get(it) ?? it}: o item já está nesta marcação.`,
        });
    // Preparo: orientação padrão e a do convênio da marcação.
    const ori = new Map<number, string>();
    for (const x of await l.consultar(
      `SELECT item_agendavel_id, orientacao FROM item_agendavel_orientacao_fonte_pagadora
        WHERE excluido_em IS NULL AND ativo AND fonte_pagadora_id = ? AND item_agendavel_id IN (${marc(todos.length)})`,
      [m['fonte_pagadora_id'], ...todos],
    ))
      ori.set(num(x['item_agendavel_id']), String(x['orientacao']));
    const data = localDe(fuso, inicio).data;
    const hoje = localDe(fuso, this.agora()).data;
    const alertas = [...r.alertas];
    const preparoDe = (it: number): PreparoDoItem => {
      const x = linhas.find((y) => num(y['id']) === it)!;
      return montarPreparo({
        item: it,
        data,
        hoje,
        diasPreparo: numN(x['dias_preparo']),
        orientacaoPadrao: x['orientacao_preparo'] == null ? null : String(x['orientacao_preparo']),
        orientacaoFonte: ori.get(it) ?? null,
      });
    };
    const itens = desdobrados.map((d) => {
      const it = d.item;
      const x = linhas.find((y) => num(y['id']) === it)!;
      const preparo = combinarPreparo(d.pacote === null ? null : preparoDe(d.pacote), preparoDe(it));
      if (preparo.tempoInsuficiente)
        alertas.push({
          codigo: 'preparo-sem-tempo',
          item: it,
          mensagem: `${String(x['descricao'])}: o preparo deveria ter começado antes de hoje; confirme com o paciente.`,
        });
      return {
        id: it,
        descricao: String(x['descricao']),
        itemFaturavel: numN(x['item_faturavel_id']),
        exame: numN(x['exame_id']),
        quantidade: d.quantidade,
        preparo,
      };
    });
    return { m, itens, regras, ocup, bloqueios, alertas, principal: unicos[0]! };
  }

  private async gravarLancamento(
    tx: TxOperacao,
    e: EntradaLancarItens,
    ctx: ContextoOperacao,
  ): Promise<{ marcacao: number; itens: number; equipamentos: number; alertas: string }> {
    const est = Number(ctx.estabelecimento);
    // Primeiro os recursos da unidade que os itens pedidos (ou os componentes do pacote) usam, em ordem de id: dois
    // lançamentos no mesmo recurso esperam um pelo outro antes de qualquer outra trava (sem impasse entre eles).
    const unicos = [...new Set(e.itens)];
    await tx.consultarParaAtualizar(
      `SELECT ra.id FROM recurso_agendavel ra
         JOIN item_agendavel_recurso x ON x.recurso_agendavel_id = ra.id AND x.excluido_em IS NULL
        WHERE ra.estabelecimento_id = ? AND ra.excluido_em IS NULL
          AND (x.item_agendavel_id IN (${marc(unicos.length)})
               OR x.item_agendavel_id IN (SELECT c.componente_item_agendavel_id FROM item_agendavel_composicao c
                                           WHERE c.excluido_em IS NULL AND c.item_agendavel_id IN (${marc(unicos.length)})))
        ORDER BY ra.id`,
      [est, ...unicos, ...unicos],
      { teto: 1_000 },
    );
    const [trava] = await tx.consultarParaAtualizar(
      'SELECT id, versao, item_agendavel_id FROM marcacao_horario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.marcacao, est],
      { teto: 1 },
    );
    if (!trava)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Marcação não encontrada',
        'A marcação não existe.',
      );
    const f = await tx.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    const c = await this.montarCritica(
      tx as unknown as Le,
      est,
      String(f?.['fuso_horario'] || 'America/Sao_Paulo'),
      e.marcacao,
      e.itens,
      tx,
    );
    if (c.bloqueios.length > 0)
      throw recusa('critica-da-marcacao', c.bloqueios.map((b) => b.mensagem).join(' '), {
        campos: ['itens'],
      });
    const [s] = await tx.consultar(
      'SELECT COALESCE(MAX(sequencia), 0) AS n FROM marcacao_horario_item WHERE marcacao_horario_id = ?',
      [e.marcacao],
    );
    let seq = num(s?.['n'] ?? 0);
    for (const it of c.itens)
      await tx.incluir('marcacao_horario_item', {
        marcacao_horario_id: e.marcacao,
        sequencia: ++seq,
        item_agendavel_id: it.id,
        item_faturavel_id: it.itemFaturavel,
        exame_id: it.exame,
        quantidade: it.quantidade,
        orientacao_preparo: it.preparo.texto,
        situacao: 'marcado',
      });
    // Equipamento reservado: o recurso que corresponde a um equipamento de saúde fica na marcação.
    const porEquip = new Map<number, { quantidade: number; item: number }>();
    for (const r of c.regras)
      for (const x of r.recursos) {
        const o = c.ocup.find((y) => num(y['id']) === x.recurso);
        if (!o || o['equipamento_saude_id'] == null) continue;
        const k = num(o['equipamento_saude_id']);
        const a = porEquip.get(k);
        const q = x.quantidade * (r.quantidade ?? 1);
        porEquip.set(k, { quantidade: (a?.quantidade ?? 0) + q, item: a?.item ?? r.id });
      }
    for (const [equip, v] of porEquip) {
      const ja = await tx.uma(
        'SELECT id, versao, quantidade, excluido_em FROM marcacao_equipamento WHERE marcacao_horario_id = ? AND equipamento_saude_id = ?',
        [e.marcacao, equip],
      );
      if (!ja)
        await tx.incluir('marcacao_equipamento', {
          marcacao_horario_id: e.marcacao,
          equipamento_saude_id: equip,
          item_agendavel_id: v.item,
          quantidade: v.quantidade,
        });
      else
        await tx.alterar('marcacao_equipamento', num(ja['id']), num(ja['versao']), {
          quantidade: (ja['excluido_em'] === null ? num(ja['quantidade']) : 0) + v.quantidade,
          excluido_em: null,
          excluido_por: null,
        });
    }
    if (trava['item_agendavel_id'] == null)
      await tx.alterar('marcacao_horario', e.marcacao, num(trava['versao']), {
        item_agendavel_id: c.principal,
      });
    return {
      marcacao: e.marcacao,
      itens: c.itens.length,
      equipamentos: porEquip.size,
      alertas: c.alertas.map((a) => a.mensagem).join('\n'),
    };
  }
}
