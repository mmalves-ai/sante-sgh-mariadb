// Endereçamento do armazém e reserva para a separação (F8, 05-SUP linha 4), sobre o MariaDB do cliente pelo Executor
// do núcleo (trilha na mesma transação, versão conferida, Idempotency-Key). A regra pura mora em
// `@sgh/contratos/regras-suprimentos` (enderecamento); aqui ficam a leitura da árvore de endereços do local, a manutenção
// do endereço e do vínculo do item (um preferencial por local), a reserva do saldo livre por lote na requisição a
// atender (reserva_estoque + quantidade_reservada no saldo do lote e do local + reserva do endereço preferencial) e a
// baixa da reserva no atendimento (`baixarReservasDoItem`, chamada pela saída da requisição). Nada é apagado: o vínculo
// retirado leva excluido_em, a reserva vira atendida, liberada ou cancelada.
import {
  baixaDasReservas,
  codigoCompletoEndereco,
  conferirEnderecoArmazem,
  conferirInativacaoEndereco,
  conferirRequisicaoSeparavel,
  conferirVinculoEndereco,
  type EnderecoEntrada,
  type EnderecoSuperior,
  type LoteLivre,
  nivelDoEndereco,
  normalizarCodigoNivel,
  planejarReservaSeparacao,
  type RecusaSuprimentos,
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

export const PORTA_ENDERECAMENTO = Symbol('PORTA_ENDERECAMENTO');
export const TABELAS_ENDERECAMENTO = [
  'endereco_armazem',
  'insumo_endereco',
  'reserva_estoque',
  'reserva_endereco',
  'saldo_lote',
  'saldo_estoque',
] as const;
/** As tabelas que a baixa da reserva grava dentro da saída da requisição. */
export const TABELAS_BAIXA_RESERVA = [
  'reserva_estoque',
  'reserva_endereco',
  'saldo_lote',
  'saldo_estoque',
] as const;

export interface ItemNoEndereco {
  readonly vinculo: number;
  readonly versao: number;
  readonly insumo: number;
  readonly codigo: string;
  readonly nome: string;
  readonly preferencial: boolean;
  readonly quantidadeMaxima: number | null;
}
export interface EnderecoArmazem {
  readonly id: number;
  readonly versao: number;
  readonly superior: number | null;
  readonly nivel: number;
  readonly tipoNivel: string;
  readonly codigo: string;
  readonly codigoCompleto: string;
  readonly descricao: string | null;
  readonly capacidade: number | null;
  readonly bloqueado: boolean;
  readonly ativo: boolean;
  readonly itens: readonly ItemNoEndereco[];
}
export interface FichaEnderecamento {
  readonly local: { readonly id: number; readonly codigo: string; readonly nome: string };
  /** Em ordem do endereço completo (a ordem do caminho no armazém). */
  readonly enderecos: readonly EnderecoArmazem[];
}
export interface OpcaoSimples {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
}
export interface AlteracaoEndereco {
  readonly versao: number;
  readonly descricao: string | null;
  readonly capacidade: number | null;
  readonly bloqueado: boolean;
  readonly ativo: boolean;
}
export interface VinculoItemEntrada {
  readonly insumo: number;
  readonly preferencial: boolean;
  readonly quantidadeMaxima: number | null;
}
export interface ReservaDaRequisicao {
  readonly id: number;
  readonly itemRequisicao: number;
  readonly insumo: number;
  readonly nome: string;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly endereco: string | null;
  readonly reservada: number;
  readonly atendida: number;
  readonly liberada: number;
  readonly situacao: string;
}
export interface ResultadoReserva {
  readonly id: number;
  readonly reservas: number;
  readonly faltas: readonly {
    readonly itemRequisicao: number;
    readonly insumo: number;
    readonly falta: number;
  }[];
}

export interface PortaEnderecamento {
  readonly destino: 'banco' | 'indisponivel';
  locais(c: ContextoPortaM18): Promise<OpcaoSimples[]>;
  itens(c: ContextoPortaM18, termo: string): Promise<OpcaoSimples[]>;
  ficha(c: ContextoPortaM18, local: number): Promise<FichaEnderecamento | null>;
  criarEndereco(c: ContextoPortaM18, e: EnderecoEntrada, chave: string): Promise<{ id: number }>;
  alterarEndereco(
    c: ContextoPortaM18,
    id: number,
    e: AlteracaoEndereco,
    chave: string,
  ): Promise<{ id: number }>;
  vincularItem(
    c: ContextoPortaM18,
    endereco: number,
    e: VinculoItemEntrada,
    chave: string,
  ): Promise<{ id: number }>;
  tornarPreferencial(c: ContextoPortaM18, vinculo: number, chave: string): Promise<{ id: number }>;
  retirarVinculo(c: ContextoPortaM18, vinculo: number, chave: string): Promise<{ id: number }>;
  reservas(c: ContextoPortaM18, requisicao: number): Promise<ReservaDaRequisicao[]>;
  reservar(c: ContextoPortaM18, requisicao: number, chave: string): Promise<ResultadoReserva>;
  liberar(c: ContextoPortaM18, requisicao: number, chave: string): Promise<{ id: number; liberadas: number }>;
}

export function portaEnderecamentoIndisponivel(): PortaEnderecamento {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'O endereçamento do armazém exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    locais: falha,
    itens: falha,
    ficha: falha,
    criarEndereco: falha,
    alterarEndereco: falha,
    vincularItem: falha,
    tornarPreferencial: falha,
    retirarVinculo: falha,
    reservas: falha,
    reservar: falha,
    liberar: falha,
  };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const b = (v: unknown) => v === true || v === 1 || v === '1';
const q4 = (x: number) => Math.round(x * 10_000) / 10_000;
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';

function recusarTodas(rs: readonly (RecusaSuprimentos | null)[]): void {
  const xs = rs.filter((x): x is RecusaSuprimentos => x !== null);
  const [r] = xs;
  if (r)
    throw recusa(r.codigo, xs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(xs.flatMap((x) => x.campos ?? []))],
    });
}

/** Ajusta a quantidade reservada do saldo do lote e do local (travados e pela versão). Nunca fica negativa. */
async function ajustarReservado(
  tx: TxOperacao,
  local: number,
  insumo: number,
  lote: number | null,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  if (lote !== null) {
    const sl = (
      await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, quantidade_reservada FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ? AND excluido_em IS NULL',
        [local, lote],
      )
    )[0];
    if (sl)
      await tx.alterar('saldo_lote', n(sl['id']), n(sl['versao']), {
        quantidade_reservada: Math.max(0, q4(n(sl['quantidade_reservada']) + delta)),
      });
  }
  const se = (
    await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, quantidade_reservada FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ? AND excluido_em IS NULL',
      [local, insumo],
    )
  )[0];
  if (se)
    await tx.alterar('saldo_estoque', n(se['id']), n(se['versao']), {
      quantidade_reservada: Math.max(0, q4(n(se['quantidade_reservada']) + delta)),
    });
}

/** Fecha a reserva do endereço do item na requisição (concluída no atendimento, cancelada na liberação). */
async function fecharReservaEndereco(
  tx: TxOperacao,
  requisicao: number,
  insumo: number | null,
  situacao: 'concluida' | 'cancelada',
): Promise<number> {
  const rs = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao FROM reserva_endereco WHERE requisicao_material_id = ? AND finalidade = 'separacao'
        AND situacao = 'ativa' AND excluido_em IS NULL AND (? IS NULL OR insumo_id = ?)`,
    [requisicao, insumo, insumo],
  );
  for (const r of rs) await tx.alterar('reserva_endereco', n(r['id']), n(r['versao']), { situacao });
  return rs.length;
}

/**
 * Baixa as reservas do item da requisição no atendimento (dentro da transação da saída): consome a reserva pela
 * quantidade atendida, devolve o resto ao livre quando o item fecha e tira o atendido da quantidade reservada do saldo.
 * Item sem reserva: nada a fazer.
 */
export async function baixarReservasDoItem(
  tx: TxOperacao,
  itemRequisicao: number,
  atendidaAgora: number,
  itemCompleto: boolean,
  enderecoComo: 'concluida' | 'cancelada' = 'concluida',
): Promise<void> {
  const rs = await tx.consultarParaAtualizar<Linha>(
    `SELECT r.id, r.versao, r.local_estoque_id, r.insumo_id, r.lote_insumo_id, r.quantidade_reservada,
            r.quantidade_atendida, r.quantidade_liberada, ri.requisicao_material_id
       FROM reserva_estoque r JOIN requisicao_material_item ri ON ri.id = r.requisicao_material_item_id
      WHERE r.requisicao_material_item_id = ? AND r.situacao = 'ativa' AND r.excluido_em IS NULL ORDER BY r.id`,
    [itemRequisicao],
  );
  if (rs.length === 0) return;
  const baixas = baixaDasReservas(
    rs.map((r) => ({
      id: n(r['id']),
      reservada: n(r['quantidade_reservada']),
      atendida: n(r['quantidade_atendida']),
      liberada: n(r['quantidade_liberada']),
    })),
    atendidaAgora,
    itemCompleto,
  );
  for (const x of baixas) {
    const r = rs.find((y) => n(y['id']) === x.id) as Linha;
    await tx.alterar('reserva_estoque', x.id, n(r['versao']), {
      quantidade_atendida: q4(n(r['quantidade_atendida']) + x.atender),
      quantidade_liberada: q4(n(r['quantidade_liberada']) + x.liberar),
      situacao: x.situacao,
    });
    await ajustarReservado(
      tx,
      n(r['local_estoque_id']),
      n(r['insumo_id']),
      nn(r['lote_insumo_id']),
      -(x.atender + x.liberar),
    );
  }
  if (itemCompleto)
    await fecharReservaEndereco(
      tx,
      n(rs[0]!['requisicao_material_id']),
      n(rs[0]!['insumo_id']),
      enderecoComo,
    );
}

/**
 * O que ainda está reservado para o item da requisição no local (reserva ativa: reservado menos atendido e liberado),
 * por lote (0 para o item sem lote). A saída da própria requisição soma isso ao livre e usa primeiro esses lotes; as
 * outras saídas só enxergam o saldo livre (quantidade menos a reservada).
 */
export async function reservasDoItemNoLocal(
  tx: TxOperacao,
  itemRequisicao: number,
  local: number,
  insumo: number,
): Promise<Map<number, number>> {
  const rs = await tx.consultarParaAtualizar<Linha>(
    `SELECT lote_insumo_id, quantidade_reservada - quantidade_atendida - quantidade_liberada AS resto
       FROM reserva_estoque
      WHERE requisicao_material_item_id = ? AND local_estoque_id = ? AND insumo_id = ? AND situacao = 'ativa'
        AND excluido_em IS NULL`,
    [itemRequisicao, local, insumo],
  );
  const m = new Map<number, number>();
  for (const r of rs) {
    const lote = nn(r['lote_insumo_id']) ?? 0;
    const resto = Math.max(0, n(r['resto']));
    if (resto > 0) m.set(lote, q4((m.get(lote) ?? 0) + resto));
  }
  return m;
}

export class PortaEnderecamentoPropria implements PortaEnderecamento {
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
      correlacao: c.correlacao || 'enderecamento',
    };
  }

  private async executar<R extends { id: number } & Record<string, unknown>>(
    c: ContextoPortaM18,
    nome: string,
    entrada: Record<string, unknown>,
    chave: string,
    alvo: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome: `suprimentos.enderecamento.${nome}`,
      tabelas: [...TABELAS_ENDERECAMENTO],
      entrada: z.unknown(),
      // O resultado guardado pela idempotência é JSON (a lista de faltas da reserva volta inteira na repetição).
      gravar: async (tx: TxOperacao) =>
        (await gravar(tx, ctxN.estabelecimento)) as unknown as ResultadoOperacao,
      alvo: (_e, r: ResultadoOperacao) => ({ tabela: alvo, id: n(r['id']) }),
      trilha: () => ({ dados: entrada, motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  locais(c: ContextoPortaM18): Promise<OpcaoSimples[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT id, codigo, nome FROM local_estoque WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo = TRUE
            ORDER BY nome`,
          [ctx.estabelecimento],
        )
      ).map((r) => ({ id: n(r['id']), codigo: t(r['codigo']), nome: t(r['nome']) })),
    );
  }

  itens(c: ContextoPortaM18, termo: string): Promise<OpcaoSimples[]> {
    const busca = termo.trim().slice(0, 60);
    if (busca.length < 2) return Promise.resolve([]);
    const esc = busca.replace(/[%_\\]/g, '\\$&');
    return this.nucleo.lerSomente(this.contexto(c), async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT id, codigo, nome FROM insumo WHERE excluido_em IS NULL AND situacao = 'ativo'
              AND (codigo LIKE ? OR nome LIKE ?) ORDER BY codigo = ? DESC, nome LIMIT 20`,
          [`${esc}%`, `%${esc}%`, busca],
        )
      ).map((r) => ({ id: n(r['id']), codigo: t(r['codigo']), nome: t(r['nome']) })),
    );
  }

  ficha(c: ContextoPortaM18, local: number): Promise<FichaEnderecamento | null> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const lc = await l.uma<Linha>(
        'SELECT id, codigo, nome FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [local, ctx.estabelecimento],
      );
      if (!lc) return null;
      const ends = await l.consultar<Linha>(
        `SELECT id, versao, superior_endereco_armazem_id, nivel, tipo_nivel, codigo, codigo_completo, descricao, capacidade,
                bloqueado, ativo FROM endereco_armazem WHERE local_estoque_id = ? AND excluido_em IS NULL
          ORDER BY codigo_completo`,
        [local],
      );
      const itens = await l.consultar<Linha>(
        `SELECT ie.id, ie.versao, ie.endereco_armazem_id, ie.insumo_id, ie.preferencial, ie.quantidade_maxima, i.codigo, i.nome
           FROM insumo_endereco ie JOIN endereco_armazem ea ON ea.id = ie.endereco_armazem_id JOIN insumo i ON i.id = ie.insumo_id
          WHERE ea.local_estoque_id = ? AND ea.excluido_em IS NULL AND ie.excluido_em IS NULL ORDER BY i.nome`,
        [local],
      );
      return {
        local: { id: local, codigo: t(lc['codigo']), nome: t(lc['nome']) },
        enderecos: ends.map((e) => ({
          id: n(e['id']),
          versao: n(e['versao']),
          superior: nn(e['superior_endereco_armazem_id']),
          nivel: n(e['nivel']),
          tipoNivel: t(e['tipo_nivel']),
          codigo: t(e['codigo']),
          codigoCompleto: t(e['codigo_completo']),
          descricao: tn(e['descricao']),
          capacidade: nn(e['capacidade']),
          bloqueado: b(e['bloqueado']),
          ativo: b(e['ativo']),
          itens: itens
            .filter((i) => n(i['endereco_armazem_id']) === n(e['id']))
            .map((i) => ({
              vinculo: n(i['id']),
              versao: n(i['versao']),
              insumo: n(i['insumo_id']),
              codigo: t(i['codigo']),
              nome: t(i['nome']),
              preferencial: b(i['preferencial']),
              quantidadeMaxima: nn(i['quantidade_maxima']),
            })),
        })),
      };
    });
  }

  criarEndereco(c: ContextoPortaM18, e: EnderecoEntrada, chave: string): Promise<{ id: number }> {
    return this.executar(c, 'criar-endereco', { ...e }, chave, 'endereco_armazem', async (tx, est) => {
      const lc = await tx.uma<Linha>(
        'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.local, est],
      );
      if (!lc)
        throw recusa('local-inexistente', 'O local não é deste estabelecimento.', { campos: ['local'] });
      const s = e.superior
        ? await tx.uma<Linha>(
            'SELECT id, local_estoque_id, nivel, codigo_completo, ativo FROM endereco_armazem WHERE id = ? AND excluido_em IS NULL',
            [e.superior],
          )
        : null;
      const superior: EnderecoSuperior | null = s
        ? {
            id: n(s['id']),
            local: n(s['local_estoque_id']),
            nivel: n(s['nivel']),
            codigoCompleto: t(s['codigo_completo']),
            ativo: b(s['ativo']),
          }
        : null;
      const completo = codigoCompletoEndereco(superior, e.codigo);
      const existe = await tx.consultarParaAtualizar<Linha>(
        'SELECT codigo_completo FROM endereco_armazem WHERE local_estoque_id = ? AND codigo_completo = ?',
        [e.local, completo],
      );
      recusarTodas(conferirEnderecoArmazem(e, superior, new Set(existe.map((x) => t(x['codigo_completo'])))));
      const id = await tx.incluir('endereco_armazem', {
        local_estoque_id: e.local,
        superior_endereco_armazem_id: superior?.id ?? null,
        nivel: nivelDoEndereco(superior),
        tipo_nivel: e.tipoNivel,
        codigo: normalizarCodigoNivel(e.codigo),
        codigo_completo: completo,
        descricao: e.descricao?.trim() || null,
        capacidade: e.capacidade ?? null,
      });
      return { id };
    });
  }

  alterarEndereco(
    c: ContextoPortaM18,
    id: number,
    e: AlteracaoEndereco,
    chave: string,
  ): Promise<{ id: number }> {
    return this.executar(c, 'alterar-endereco', { id, ...e }, chave, 'endereco_armazem', async (tx, est) => {
      const r = (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT ea.id, ea.versao, ea.ativo FROM endereco_armazem ea JOIN local_estoque le ON le.id = ea.local_estoque_id
            WHERE ea.id = ? AND le.estabelecimento_id = ? AND ea.excluido_em IS NULL`,
          [id, est],
        )
      )[0];
      if (!r) throw recusa('endereco-inexistente', 'O endereço não existe.', { campos: ['endereco'] });
      if (b(r['ativo']) && !e.ativo) {
        const f = await tx.uma<Linha>(
          `SELECT (SELECT COUNT(*) FROM endereco_armazem WHERE superior_endereco_armazem_id = ? AND ativo = TRUE AND excluido_em IS NULL) AS filhos,
                  (SELECT COUNT(*) FROM insumo_endereco WHERE endereco_armazem_id = ? AND excluido_em IS NULL) AS itens`,
          [id, id],
        );
        recusarTodas(conferirInativacaoEndereco(n(f?.['filhos']), n(f?.['itens'])));
      }
      if (e.capacidade !== null && !(e.capacidade > 0))
        throw recusa('endereco-capacidade-invalida', 'A capacidade, quando informada, é maior que zero.', {
          campos: ['capacidade'],
        });
      await tx.alterar('endereco_armazem', id, e.versao, {
        descricao: e.descricao?.trim() || null,
        capacidade: e.capacidade,
        bloqueado: e.bloqueado,
        ativo: e.ativo,
      });
      return { id };
    });
  }

  /** Desmarca o preferencial dos outros endereços do item no mesmo local. */
  private async desmarcarPreferencial(tx: TxOperacao, insumo: number, local: number, exceto: number) {
    const outros = await tx.consultarParaAtualizar<Linha>(
      `SELECT ie.id, ie.versao FROM insumo_endereco ie JOIN endereco_armazem ea ON ea.id = ie.endereco_armazem_id
        WHERE ie.insumo_id = ? AND ea.local_estoque_id = ? AND ie.preferencial = TRUE AND ie.excluido_em IS NULL AND ie.id <> ?`,
      [insumo, local, exceto],
    );
    for (const o of outros)
      await tx.alterar('insumo_endereco', n(o['id']), n(o['versao']), { preferencial: false });
  }

  vincularItem(
    c: ContextoPortaM18,
    endereco: number,
    e: VinculoItemEntrada,
    chave: string,
  ): Promise<{ id: number }> {
    return this.executar(
      c,
      'vincular-item',
      { endereco, ...e },
      chave,
      'insumo_endereco',
      async (tx, est) => {
        const ea = await tx.uma<Linha>(
          `SELECT ea.id, ea.local_estoque_id, ea.ativo, ea.bloqueado FROM endereco_armazem ea
           JOIN local_estoque le ON le.id = ea.local_estoque_id
          WHERE ea.id = ? AND le.estabelecimento_id = ? AND ea.excluido_em IS NULL`,
          [endereco, est],
        );
        const it = await tx.uma<Linha>('SELECT situacao FROM insumo WHERE id = ? AND excluido_em IS NULL', [
          e.insumo,
        ]);
        recusarTodas(
          conferirVinculoEndereco(
            ea ? { ativo: b(ea['ativo']), bloqueado: b(ea['bloqueado']) } : null,
            it ? t(it['situacao']) === 'ativo' : null,
            e.quantidadeMaxima,
          ),
        );
        const local = n(ea!['local_estoque_id']);
        const ja = (
          await tx.consultarParaAtualizar<Linha>(
            'SELECT id, versao, excluido_em FROM insumo_endereco WHERE insumo_id = ? AND endereco_armazem_id = ?',
            [e.insumo, endereco],
          )
        )[0];
        if (ja && ja['excluido_em'] === null)
          throw recusa('item-ja-no-endereco', 'O item já está neste endereço.', { campos: ['insumo'] });
        // O vínculo retirado antes volta (a chave do par é única): a linha é reaproveitada, sem apagar a história.
        let id: number;
        if (ja) {
          id = n(ja['id']);
          await tx.alterar('insumo_endereco', id, n(ja['versao']), {
            excluido_em: null,
            excluido_por: null,
            preferencial: e.preferencial,
            quantidade_maxima: e.quantidadeMaxima,
          });
        } else
          id = await tx.incluir('insumo_endereco', {
            insumo_id: e.insumo,
            endereco_armazem_id: endereco,
            preferencial: e.preferencial,
            quantidade_maxima: e.quantidadeMaxima,
          });
        if (e.preferencial) await this.desmarcarPreferencial(tx, e.insumo, local, id);
        return { id };
      },
    );
  }

  private async vinculoTravado(tx: TxOperacao, vinculo: number, est: number) {
    const v = (
      await tx.consultarParaAtualizar<Linha>(
        `SELECT ie.id, ie.versao, ie.insumo_id, ea.local_estoque_id FROM insumo_endereco ie
           JOIN endereco_armazem ea ON ea.id = ie.endereco_armazem_id JOIN local_estoque le ON le.id = ea.local_estoque_id
          WHERE ie.id = ? AND le.estabelecimento_id = ? AND ie.excluido_em IS NULL`,
        [vinculo, est],
      )
    )[0];
    if (!v)
      throw recusa('vinculo-inexistente', 'O item não está ligado a este endereço.', { campos: ['vinculo'] });
    return v;
  }

  tornarPreferencial(c: ContextoPortaM18, vinculo: number, chave: string): Promise<{ id: number }> {
    return this.executar(c, 'tornar-preferencial', { vinculo }, chave, 'insumo_endereco', async (tx, est) => {
      const v = await this.vinculoTravado(tx, vinculo, est);
      await tx.alterar('insumo_endereco', vinculo, n(v['versao']), { preferencial: true });
      await this.desmarcarPreferencial(tx, n(v['insumo_id']), n(v['local_estoque_id']), vinculo);
      return { id: vinculo };
    });
  }

  retirarVinculo(c: ContextoPortaM18, vinculo: number, chave: string): Promise<{ id: number }> {
    return this.executar(c, 'retirar-vinculo', { vinculo }, chave, 'insumo_endereco', async (tx, est) => {
      const v = await this.vinculoTravado(tx, vinculo, est);
      await tx.alterar('insumo_endereco', vinculo, n(v['versao']), {
        preferencial: false,
        excluido_em: new Date(),
        excluido_por: c.usuario,
      });
      return { id: vinculo };
    });
  }

  reservas(c: ContextoPortaM18, requisicao: number): Promise<ReservaDaRequisicao[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l: Leitor) =>
      (
        await l.consultar<Linha>(
          `SELECT r.id, r.requisicao_material_item_id, r.insumo_id, i.nome, li.numero_lote, li.validade, r.quantidade_reservada,
                  r.quantidade_atendida, r.quantidade_liberada, r.situacao,
                  (SELECT ea.codigo_completo FROM reserva_endereco re JOIN endereco_armazem ea ON ea.id = re.endereco_armazem_id
                    WHERE re.requisicao_material_id = rq.id AND re.insumo_id = r.insumo_id AND re.excluido_em IS NULL
                    ORDER BY re.id DESC LIMIT 1) AS endereco
             FROM reserva_estoque r JOIN requisicao_material_item ri ON ri.id = r.requisicao_material_item_id
             JOIN requisicao_material rq ON rq.id = ri.requisicao_material_id JOIN insumo i ON i.id = r.insumo_id
             LEFT JOIN lote_insumo li ON li.id = r.lote_insumo_id
            WHERE rq.id = ? AND rq.estabelecimento_id = ? AND r.excluido_em IS NULL ORDER BY endereco IS NULL, endereco, i.nome, r.id`,
          [requisicao, ctx.estabelecimento],
        )
      ).map((r) => ({
        id: n(r['id']),
        itemRequisicao: n(r['requisicao_material_item_id']),
        insumo: n(r['insumo_id']),
        nome: t(r['nome']),
        lote: tn(r['numero_lote']),
        validade: r['validade'] ? dataIso(r['validade']) : null,
        endereco: tn(r['endereco']),
        reservada: n(r['quantidade_reservada']),
        atendida: n(r['quantidade_atendida']),
        liberada: n(r['quantidade_liberada']),
        situacao: t(r['situacao']),
      })),
    );
  }

  private async requisicaoTravada(tx: TxOperacao, requisicao: number, est: number) {
    const rq = (
      await tx.consultarParaAtualizar<Linha>(
        `SELECT id, situacao, atendente_local_estoque_id FROM requisicao_material
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [requisicao, est],
      )
    )[0];
    if (!rq) throw recusa('requisicao-inexistente', 'A requisição não existe.', { campos: ['requisicao'] });
    return rq;
  }

  reservar(c: ContextoPortaM18, requisicao: number, chave: string): Promise<ResultadoReserva> {
    return this.executar(
      c,
      'reservar-separacao',
      { requisicao },
      chave,
      'requisicao_material',
      async (tx, est) => {
        const rq = await this.requisicaoTravada(tx, requisicao, est);
        recusarTodas([conferirRequisicaoSeparavel(t(rq['situacao']))]);
        const local = n(rq['atendente_local_estoque_id']);
        const itens = await tx.consultar<Linha>(
          `SELECT ri.id, ri.insumo_id, ri.unidade_medida_id, ri.quantidade_solicitada, ri.quantidade_atendida,
                  ri.quantidade_cancelada, i.controla_lote,
                  (SELECT COALESCE(SUM(r.quantidade_reservada - r.quantidade_atendida - r.quantidade_liberada), 0)
                     FROM reserva_estoque r WHERE r.requisicao_material_item_id = ri.id AND r.situacao = 'ativa'
                      AND r.excluido_em IS NULL) AS ja
             FROM requisicao_material_item ri JOIN insumo i ON i.id = ri.insumo_id
            WHERE ri.requisicao_material_id = ? AND ri.excluido_em IS NULL AND ri.situacao IN ('pendente','atendido_parcial')
            ORDER BY ri.sequencia`,
          [requisicao],
        );
        const ids = [...new Set(itens.map((x) => n(x['insumo_id'])))];
        const lotes = new Map<number, LoteLivre[]>();
        const livres = new Map<number, number>();
        const hoje = dataIso((await tx.uma<Linha>('SELECT CURRENT_DATE() AS d', []))?.['d']);
        if (ids.length) {
          const ph = ids.map(() => '?').join(', ');
          for (const r of await tx.consultarParaAtualizar<Linha>(
            `SELECT sl.id, sl.lote_insumo_id, li.insumo_id, li.validade, sl.quantidade - sl.quantidade_reservada AS livre
               FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL AND li.situacao = 'liberado'
              WHERE sl.local_estoque_id = ? AND sl.excluido_em IS NULL AND sl.bloqueado = FALSE
                AND sl.quantidade - sl.quantidade_reservada > 0 AND li.insumo_id IN (${ph})`,
            [local, ...ids],
          ))
            lotes.set(n(r['insumo_id']), [
              ...(lotes.get(n(r['insumo_id'])) ?? []),
              {
                lote: n(r['lote_insumo_id']),
                saldoLote: n(r['id']),
                validade: dataIso(r['validade']),
                livre: n(r['livre']),
              },
            ]);
          for (const r of await tx.consultarParaAtualizar<Linha>(
            `SELECT insumo_id, quantidade - quantidade_reservada AS livre FROM saldo_estoque
              WHERE local_estoque_id = ? AND excluido_em IS NULL AND insumo_id IN (${ph})`,
            [local, ...ids],
          ))
            livres.set(n(r['insumo_id']), n(r['livre']));
        }
        const plano = planejarReservaSeparacao(
          itens.map((x) => ({
            itemRequisicao: n(x['id']),
            insumo: n(x['insumo_id']),
            unidade: n(x['unidade_medida_id']),
            aSeparar: q4(
              n(x['quantidade_solicitada']) - n(x['quantidade_atendida']) - n(x['quantidade_cancelada']),
            ),
            jaReservado: n(x['ja']),
            controlaLote: b(x['controla_lote']),
          })),
          lotes,
          livres,
          hoje,
        );
        const agora = new Date();
        for (const r of plano.reservas) {
          await tx.incluir('reserva_estoque', {
            estabelecimento_id: est,
            local_estoque_id: local,
            insumo_id: r.insumo,
            lote_insumo_id: r.lote,
            unidade_medida_id: r.unidade,
            finalidade: 'requisicao',
            requisicao_material_item_id: r.itemRequisicao,
            quantidade_reservada: r.quantidade,
            reservado_em: agora,
          });
          await ajustarReservado(tx, local, r.insumo, r.lote, r.quantidade);
        }
        // A reserva do endereço preferencial do item (o separador vai direto a ele), uma por item, com o total reservado.
        const porInsumo = new Map<number, { quantidade: number; unidade: number }>();
        for (const r of plano.reservas)
          porInsumo.set(r.insumo, {
            quantidade: q4((porInsumo.get(r.insumo)?.quantidade ?? 0) + r.quantidade),
            unidade: r.unidade,
          });
        for (const [insumo, x] of porInsumo) {
          const pref = await tx.uma<Linha>(
            `SELECT ea.id FROM insumo_endereco ie JOIN endereco_armazem ea ON ea.id = ie.endereco_armazem_id
              WHERE ie.insumo_id = ? AND ea.local_estoque_id = ? AND ie.excluido_em IS NULL AND ea.excluido_em IS NULL
                AND ea.ativo = TRUE ORDER BY ie.preferencial DESC, ea.codigo_completo LIMIT 1`,
            [insumo, local],
          );
          if (!pref) continue;
          const ativa = (
            await tx.consultarParaAtualizar<Linha>(
              `SELECT id, versao, quantidade FROM reserva_endereco WHERE requisicao_material_id = ? AND insumo_id = ?
                 AND finalidade = 'separacao' AND situacao = 'ativa' AND excluido_em IS NULL LIMIT 1`,
              [requisicao, insumo],
            )
          )[0];
          if (ativa)
            await tx.alterar('reserva_endereco', n(ativa['id']), n(ativa['versao']), {
              quantidade: q4(n(ativa['quantidade']) + x.quantidade),
            });
          else
            await tx.incluir('reserva_endereco', {
              estabelecimento_id: est,
              endereco_armazem_id: n(pref['id']),
              local_estoque_id: local,
              finalidade: 'separacao',
              insumo_id: insumo,
              unidade_medida_id: x.unidade,
              quantidade: x.quantidade,
              requisicao_material_id: requisicao,
              responsavel_usuario_id: c.usuario,
            });
        }
        return { id: requisicao, reservas: plano.reservas.length, faltas: plano.faltas };
      },
    );
  }

  liberar(
    c: ContextoPortaM18,
    requisicao: number,
    chave: string,
  ): Promise<{ id: number; liberadas: number }> {
    return this.executar(
      c,
      'liberar-reserva-separacao',
      { requisicao },
      chave,
      'requisicao_material',
      async (tx, est) => {
        await this.requisicaoTravada(tx, requisicao, est);
        const itens = await tx.consultar<Linha>(
          `SELECT DISTINCT r.requisicao_material_item_id AS id FROM reserva_estoque r
             JOIN requisicao_material_item ri ON ri.id = r.requisicao_material_item_id
            WHERE ri.requisicao_material_id = ? AND r.situacao = 'ativa' AND r.excluido_em IS NULL`,
          [requisicao],
        );
        if (itens.length === 0)
          throw recusa('sem-reserva', 'A requisição não tem reserva ativa.', { campos: ['requisicao'] });
        for (const i of itens) await baixarReservasDoItem(tx, n(i['id']), 0, true, 'cancelada');
        await fecharReservaEndereco(tx, requisicao, null, 'cancelada');
        return { id: requisicao, liberadas: itens.length };
      },
    );
  }
}
