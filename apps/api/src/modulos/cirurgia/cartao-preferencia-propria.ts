// Cartão de preferência do cirurgião (F8, 04-CC linha 105), no banco do cliente (`cartao_preferencia_cirurgiao` e
// `cartao_preferencia_cirurgiao_item`). Contrato de efeito:
//   - incluir: o cartão do estabelecimento da sessão, por cirurgião e procedimento (nulo = geral), com os itens em
//     sequência 1..n; cartão repetido para o mesmo cirurgião e procedimento (mesmo fora de uso) é recusado (409);
//   - alterar: o cartão com a versão lida (+1); item que continua é atualizado no lugar, item novo entra no fim da
//     sequência e item retirado é marcado excluído (excluido_em/excluido_por), nunca apagado; tudo na trilha;
//   - tirar de uso / voltar ao uso: `ativo` com a versão; nada é apagado;
//   - aplicável: o cartão que vale para o cirurgião e o procedimento (regra do domínio), a sugestão para o mapa
//     (sala, tempo, posição) e os produtos para o gasto de sala, somados; só leitura;
//   - dono: o cartão é mantido pelo próprio cirurgião (usuário ligado ao profissional) ou por quem administra o bloco.
import {
  type CartaoPreferencia,
  cartaoAplicavel,
  chaveItemCartao,
  type ItemCartaoPreferencia,
  itensParaGasto,
  NATUREZAS_ITEM_CARTAO,
  sugestaoParaMapa,
  validarCartaoPreferencia,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
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
import { semIndefinidos } from '../../entrada-exata.js';

export const PORTA_CARTAO_PREFERENCIA = Symbol('PORTA_CARTAO_PREFERENCIA');

const CARTAO = 'cartao_preferencia_cirurgiao';
const ITEM = 'cartao_preferencia_cirurgiao_item';

export interface QuemGravaCartao {
  readonly gestor: boolean;
}

export interface ItemCartaoLido extends ItemCartaoPreferencia {
  readonly id: number;
  readonly sequencia: number;
  readonly nome: string | null;
}

export interface CartaoLido extends CartaoPreferencia {
  readonly cirurgiao: number;
  readonly procedimento: number | null;
  readonly cirurgiaoNome: string | null;
  readonly procedimentoDescricao: string | null;
  readonly posicaoDescricao: string | null;
  readonly salaDescricao: string | null;
  readonly versao: number;
  readonly itens: ItemCartaoLido[];
}

const id = z.number().int().positive();
const esquemaItem = z
  .object({
    natureza: z.enum(NATUREZAS_ITEM_CARTAO),
    insumo: id.nullable().optional(),
    caixaInstrumental: id.nullable().optional(),
    equipamento: id.nullable().optional(),
    descricao: z.string().max(150).nullable().optional(),
    quantidade: z.number().positive().max(99999),
    observacao: z.string().max(300).nullable().optional(),
  })
  .strict();
const esquemaCartao = z
  .object({
    cirurgiao: id,
    procedimento: id.nullable(),
    posicao: id.nullable().optional(),
    sala: id.nullable().optional(),
    tempoMinutos: z.number().int().nullable().optional(),
    tamanhoLuva: z.string().max(10).nullable().optional(),
    preparoPele: z.string().max(300).nullable().optional(),
    fiosSutura: z.string().max(500).nullable().optional(),
    observacao: z.string().max(4000).nullable().optional(),
    itens: z.array(esquemaItem).max(200),
  })
  .strict();
type Entrada = z.infer<typeof esquemaCartao>;

const SQL = `
  SELECT c.id, c.cirurgiao_profissional_id, c.procedimento_cirurgico_id, c.posicao_cirurgica_id, c.sala_cirurgica_id,
         c.tempo_realizacao_minutos, c.tamanho_luva, c.preparo_pele, c.fios_sutura, c.observacao, c.ativo, c.versao,
         pf.nome AS cirurgiao_nome, pc.descricao AS procedimento_descricao, po.descricao AS posicao_descricao,
         sc.descricao AS sala_descricao
    FROM cartao_preferencia_cirurgiao c
    LEFT JOIN profissional p ON p.id = c.cirurgiao_profissional_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN procedimento_cirurgico pc ON pc.id = c.procedimento_cirurgico_id
    LEFT JOIN posicao_cirurgica po ON po.id = c.posicao_cirurgica_id
    LEFT JOIN sala_cirurgica sc ON sc.id = c.sala_cirurgica_id`;

const SQL_ITENS = `
  SELECT i.id, i.cartao_preferencia_cirurgiao_id, i.sequencia, i.natureza, i.insumo_id, i.caixa_instrumental_id,
         i.equipamento_saude_id, i.descricao, i.quantidade, i.observacao, i.versao,
         COALESCE(ins.nome, cx.descricao, eq.nome, i.descricao) AS nome
    FROM cartao_preferencia_cirurgiao_item i
    LEFT JOIN insumo ins ON ins.id = i.insumo_id
    LEFT JOIN caixa_instrumental cx ON cx.id = i.caixa_instrumental_id
    LEFT JOIN equipamento_saude eq ON eq.id = i.equipamento_saude_id`;

type Linha = Record<string, unknown>;

function itemLido(x: Linha): ItemCartaoLido & { versao: number } {
  return {
    id: num(x['id']),
    sequencia: num(x['sequencia']),
    natureza: String(x['natureza']) as ItemCartaoPreferencia['natureza'],
    insumo: numOuNull(x['insumo_id']),
    caixaInstrumental: numOuNull(x['caixa_instrumental_id']),
    equipamento: numOuNull(x['equipamento_saude_id']),
    descricao: txtOuNull(x['descricao']),
    quantidade: num(x['quantidade']),
    observacao: txtOuNull(x['observacao']),
    nome: txtOuNull(x['nome']),
    versao: num(x['versao']),
  };
}

function cartaoLido(x: Linha, itens: ItemCartaoLido[]): CartaoLido {
  return {
    id: num(x['id']),
    cirurgiao: num(x['cirurgiao_profissional_id']),
    procedimento: numOuNull(x['procedimento_cirurgico_id']),
    posicao: numOuNull(x['posicao_cirurgica_id']),
    sala: numOuNull(x['sala_cirurgica_id']),
    tempoMinutos: numOuNull(x['tempo_realizacao_minutos']),
    tamanhoLuva: txtOuNull(x['tamanho_luva']),
    preparoPele: txtOuNull(x['preparo_pele']),
    fiosSutura: txtOuNull(x['fios_sutura']),
    observacao: txtOuNull(x['observacao']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
    cirurgiaoNome: txtOuNull(x['cirurgiao_nome']),
    procedimentoDescricao: txtOuNull(x['procedimento_descricao']),
    posicaoDescricao: txtOuNull(x['posicao_descricao']),
    salaDescricao: txtOuNull(x['sala_descricao']),
    itens,
  };
}

const textoOuNulo = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export class PortaCartaoPreferenciaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [CARTAO, ITEM], 'cirurgia.cartao-preferencia');
  }

  private async carregar(l: Leitor, est: number, filtro: { cirurgiao?: number | null; id?: number }) {
    const onde = ['c.estabelecimento_id = ?', 'c.excluido_em IS NULL'];
    const args: unknown[] = [est];
    if (filtro.cirurgiao) {
      onde.push('c.cirurgiao_profissional_id = ?');
      args.push(filtro.cirurgiao);
    }
    if (filtro.id) {
      onde.push('c.id = ?');
      args.push(filtro.id);
    }
    const cs = await l.consultar<Linha>(
      `${SQL} WHERE ${onde.join(' AND ')} ORDER BY pf.nome, c.procedimento_cirurgico_id IS NOT NULL, pc.descricao, c.id
        LIMIT 2000`,
      args,
    );
    if (!cs.length) return [];
    const ids = cs.map((c) => num(c['id']));
    const its = await l.consultar<Linha>(
      `${SQL_ITENS} WHERE i.cartao_preferencia_cirurgiao_id IN (${ids.map(() => '?').join(', ')})
          AND i.excluido_em IS NULL ORDER BY i.cartao_preferencia_cirurgiao_id, i.sequencia`,
      ids,
    );
    const porCartao = new Map<number, ItemCartaoLido[]>();
    for (const i of its) {
      const k = num(i['cartao_preferencia_cirurgiao_id']);
      const item: ItemCartaoLido & { versao?: number } = itemLido(i);
      delete item.versao;
      porCartao.set(k, [...(porCartao.get(k) ?? []), item]);
    }
    return cs.map((c) => cartaoLido(c, porCartao.get(num(c['id'])) ?? []));
  }

  /** Os cartões do estabelecimento (com os fora de uso), ou só os do cirurgião. */
  listar(c: ContextoPortaPropria, filtro: { cirurgiao?: number | null }): Promise<CartaoLido[]> {
    return this.ler(c, 'listar', (l, est) => this.carregar(l, est.id, filtro));
  }

  /** Apoio da tela: posições cirúrgicas ativas e salas do estabelecimento. */
  apoio(c: ContextoPortaPropria) {
    return this.ler(c, 'apoio', async (l, est) => {
      const posicoes = await l.consultar<Linha>(
        'SELECT id, descricao FROM posicao_cirurgica WHERE ativo ORDER BY descricao LIMIT 500',
      );
      const salas = await l.consultar<Linha>(
        `SELECT id, descricao FROM sala_cirurgica WHERE estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY descricao LIMIT 500`,
        [est.id],
      );
      const op = (x: Linha) => ({ id: num(x['id']), descricao: String(x['descricao'] ?? '') });
      return { posicoes: posicoes.map(op), salas: salas.map(op) };
    });
  }

  /** O cartão que vale para o cirurgião e o procedimento, com a sugestão para o mapa e os produtos do gasto. */
  aplicavel(c: ContextoPortaPropria, cirurgiao: number, procedimento: number | null) {
    return this.ler(c, 'aplicavel', async (l, est) => {
      const cartao = cartaoAplicavel(await this.carregar(l, est.id, { cirurgiao }), cirurgiao, procedimento);
      if (!cartao) return { cartao: null, mapa: null, gasto: [] };
      const nome = new Map(cartao.itens.map((i) => [i.insumo ?? 0, i.nome ?? '']));
      return {
        cartao,
        mapa: sugestaoParaMapa(cartao),
        gasto: itensParaGasto(cartao.itens).map((g) => ({ ...g, insumoNome: nome.get(g.insumo) ?? '' })),
      };
    });
  }

  private async conferirDono(tx: Leitor, usuario: number, quem: QuemGravaCartao, cirurgiao: number) {
    if (quem.gestor) return;
    const meu = await tx.uma(
      'SELECT profissional_id FROM usuario_profissional WHERE usuario_vigente_id = ?',
      [usuario],
    );
    if (numOuNull(meu?.['profissional_id']) !== cirurgiao)
      throw new ErroOperacao(
        403,
        'cartao-de-outro-cirurgiao',
        'Cartão de outro cirurgião',
        'O cartão de preferência só é mantido pelo próprio cirurgião ou por quem administra o bloco cirúrgico.',
      );
  }

  /** Domínio, cadastros ligados (no estabelecimento quando são dele) e cartão repetido. */
  private async conferir(tx: Leitor, est: number, e: Entrada, idAtual: number | null) {
    const p = validarCartaoPreferencia(semIndefinidos(e));
    if (p.length) throw recusaRegra('Cartão de preferência recusado', p);
    const existe = async (sql: string, args: unknown[], o: string) => {
      if (!(await tx.uma(sql, args))) throw naoEncontrado(o);
    };
    await existe(
      'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL',
      [e.cirurgiao],
      'Cirurgião',
    );
    if (e.procedimento)
      await existe('SELECT id FROM procedimento_cirurgico WHERE id = ?', [e.procedimento], 'Procedimento');
    if (e.posicao)
      await existe(
        'SELECT id FROM posicao_cirurgica WHERE id = ? AND ativo',
        [e.posicao],
        'Posição cirúrgica',
      );
    if (e.sala)
      await existe(
        'SELECT id FROM sala_cirurgica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.sala, est],
        'Sala cirúrgica',
      );
    for (const [k, i] of e.itens.entries()) {
      if (i.insumo)
        await existe(
          'SELECT id FROM insumo WHERE id = ? AND excluido_em IS NULL',
          [i.insumo],
          `Produto do item ${k + 1}`,
        );
      if (i.caixaInstrumental)
        await existe(
          'SELECT id FROM caixa_instrumental WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [i.caixaInstrumental, est],
          `Caixa de instrumental do item ${k + 1}`,
        );
      if (i.equipamento)
        await existe(
          'SELECT id FROM equipamento_saude WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [i.equipamento, est],
          `Equipamento do item ${k + 1}`,
        );
    }
    const dup = await tx.uma<Linha>(
      `SELECT id, ativo FROM cartao_preferencia_cirurgiao
        WHERE estabelecimento_id = ? AND cirurgiao_profissional_id = ? AND procedimento_cirurgico_id <=> ? AND id <> ?
          AND excluido_em IS NULL`,
      [est, e.cirurgiao, e.procedimento, idAtual ?? 0],
    );
    if (dup)
      throw new ErroOperacao(
        409,
        'cartao-repetido',
        'Cartão repetido',
        bool(dup['ativo'])
          ? 'Este cirurgião já tem cartão para este procedimento: altere o existente.'
          : 'Este cirurgião já tem cartão para este procedimento, fora de uso: volte-o ao uso e altere.',
      );
  }

  private colunas(e: Entrada) {
    return {
      cirurgiao_profissional_id: e.cirurgiao,
      procedimento_cirurgico_id: e.procedimento,
      posicao_cirurgica_id: e.posicao ?? null,
      sala_cirurgica_id: e.sala ?? null,
      tempo_realizacao_minutos: e.tempoMinutos ?? null,
      tamanho_luva: textoOuNulo(e.tamanhoLuva)?.replace('.', ',') ?? null,
      preparo_pele: textoOuNulo(e.preparoPele),
      fios_sutura: textoOuNulo(e.fiosSutura),
      observacao: textoOuNulo(e.observacao),
    };
  }

  private colunasItem(i: Entrada['itens'][number]) {
    return {
      natureza: i.natureza,
      insumo_id: i.insumo ?? null,
      caixa_instrumental_id: i.caixaInstrumental ?? null,
      equipamento_saude_id: i.equipamento ?? null,
      descricao: textoOuNulo(i.descricao),
      quantidade: i.quantidade,
      observacao: textoOuNulo(i.observacao),
    };
  }

  async incluir(c: ContextoPortaPropria, entrada: unknown, quem: QuemGravaCartao): Promise<{ id: number }> {
    const e = entradaValida(esquemaCartao, entrada);
    return this.gravar(
      c,
      'cirurgia.cartao-preferencia.incluir',
      [CARTAO, ITEM],
      async (tx: TxOperacao, est, u) => {
        await this.conferirDono(tx, u, quem, e.cirurgiao);
        await this.conferir(tx, est.id, e, null);
        const novo = await tx.incluir(CARTAO, {
          estabelecimento_id: est.id,
          ...this.colunas(e),
          ativo: true,
        });
        for (const [k, i] of e.itens.entries())
          await tx.incluir(ITEM, {
            cartao_preferencia_cirurgiao_id: novo,
            sequencia: k + 1,
            ...this.colunasItem(i),
          });
        return { tabela: CARTAO, id: novo };
      },
    );
  }

  private async atual(tx: Leitor, est: number, idCartao: number) {
    const a = await tx.uma<Linha>(
      `SELECT id, cirurgiao_profissional_id FROM cartao_preferencia_cirurgiao
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [idCartao, est],
    );
    if (!a) throw naoEncontrado('Cartão de preferência');
    return num(a['cirurgiao_profissional_id']);
  }

  async alterar(c: ContextoPortaPropria, idCartao: number, entrada: unknown, quem: QuemGravaCartao) {
    const { versao, ...e } = entradaValida(esquemaCartao.extend({ versao: id }).strict(), entrada);
    return this.gravar(
      c,
      'cirurgia.cartao-preferencia.alterar',
      [CARTAO, ITEM],
      async (tx: TxOperacao, est, u) => {
        await this.conferirDono(tx, u, quem, await this.atual(tx, est.id, idCartao));
        await this.conferirDono(tx, u, quem, e.cirurgiao);
        await this.conferir(tx, est.id, e, idCartao);
        await tx.alterar(CARTAO, idCartao, versao, this.colunas(e));
        // Itens: o que continua (mesma chave) é atualizado no lugar; o retirado é marcado excluído; o novo vai ao fim.
        const todos = await tx.consultar<Linha>(
          'SELECT id, sequencia, natureza, insumo_id, caixa_instrumental_id, equipamento_saude_id, descricao, quantidade, observacao, versao, excluido_em FROM cartao_preferencia_cirurgiao_item WHERE cartao_preferencia_cirurgiao_id = ?',
          [idCartao],
        );
        let proxima = todos.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0) + 1;
        const vivos = new Map(
          todos
            .filter((x) => x['excluido_em'] === null)
            .map((x) => {
              const it = itemLido(x);
              return [chaveItemCartao(it), it] as const;
            }),
        );
        for (const i of e.itens) {
          const v = vivos.get(chaveItemCartao(i));
          const cols = this.colunasItem(i);
          if (!v) {
            await tx.incluir(ITEM, {
              cartao_preferencia_cirurgiao_id: idCartao,
              sequencia: proxima++,
              ...cols,
            });
            continue;
          }
          vivos.delete(chaveItemCartao(i));
          if (
            v.natureza !== cols.natureza ||
            v.quantidade !== cols.quantidade ||
            (v.observacao ?? null) !== cols.observacao ||
            (v.descricao ?? null) !== cols.descricao
          )
            await tx.alterar(ITEM, v.id, v.versao, cols);
        }
        for (const v of vivos.values())
          await tx.alterar(ITEM, v.id, v.versao, { excluido_em: new Date(), excluido_por: u });
        return { tabela: CARTAO, id: idCartao };
      },
    );
  }

  /** Tira de uso ou volta ao uso (nunca apaga). */
  async definirUso(c: ContextoPortaPropria, idCartao: number, entrada: unknown, quem: QuemGravaCartao) {
    const x = entradaValida(z.object({ ativo: z.boolean(), versao: id }).strict(), entrada);
    return this.gravar(c, 'cirurgia.cartao-preferencia.uso', [CARTAO], async (tx, est, u) => {
      await this.conferirDono(tx, u, quem, await this.atual(tx, est.id, idCartao));
      await tx.alterar(CARTAO, idCartao, x.versao, { ativo: x.ativo });
      return { tabela: CARTAO, id: idCartao };
    });
  }
}
