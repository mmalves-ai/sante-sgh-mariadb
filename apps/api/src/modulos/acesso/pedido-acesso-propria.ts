// PEDIDO DE ACESSO no banco próprio (01-ADM L57, 2ª volta da F3): pedir um perfil para um setor e um período, a
// aprovação em dois níveis por pessoas diferentes, a concessão do perfil na mesma transação da 2ª aprovação, a
// concessão tardia do pedido aprovado e o cancelamento só por quem pediu. Tabelas: pedido_acesso (com as colunas da
// migração 02_ADM/97: setor de internação, os dois aprovadores, quem fechou e a concessão gerada) e pedido_acesso_item
// (o perfil pedido, com a decisão). Nada se apaga: cada decisão fica na própria linha, com a trilha pelo Executor.
// As mesmas recusas do pedido na memória (pedido-acesso-memoria.ts); a regra do domínio entra por `validar`, sobre o
// pedido relido sob trava.
import {
  ErroOperacao,
  type Leitor,
  type Linha,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { type ZodType, z } from 'zod';
import type { ConcessaoDoPedidoGravar } from './gestao-fonte.js';
import type { ConcessaoPerfilNova, TrilhaGestao } from './gestao-tipos.js';
import type {
  DecisaoPedidoAcessoGravar,
  FiltroPedidosAcesso,
  NovoPedidoAcessoGravar,
  PedidoAcessoGravado,
  SituacaoPedidoAcesso,
  ValidarPedidoAcesso,
} from './tipos-gestao-acesso.js';

/** A gravação pelo Executor da fonte própria (estabelecimento e operador resolvidos, trilha e idempotência). */
export type GravarGestao = <E, R extends ResultadoOperacao & { readonly id: number }>(
  def: {
    readonly nome: string;
    readonly tabelas: readonly string[];
    readonly esquema: ZodType<E>;
    readonly alvo: string;
    readonly motivo?: (e: E) => string | null;
    readonly dados?: (e: E) => Readonly<Record<string, unknown>>;
  },
  hospital: string,
  quem: { readonly usuario: string; readonly correlacao: string },
  entrada: unknown,
  fn: (
    tx: TxOperacao,
    e: E,
    est: number,
    operador: number,
  ) => Promise<{ resultado: R; antes?: Readonly<Record<string, unknown>> }>,
) => Promise<R>;

export type LerGestao = <T>(hospital: string, fn: (l: Leitor, est: number) => Promise<T>) => Promise<T>;

/** A situação do pedido na tela e a gravada no banco (CHECK ck_pedido_acesso_situacao). */
const PARA_BANCO: Readonly<Record<SituacaoPedidoAcesso, string>> = {
  pendente: 'enviado',
  'aprovado-setor': 'em_aprovacao',
  aprovado: 'aprovado',
  concedido: 'executado',
  recusado: 'reprovado',
  cancelado: 'cancelado',
};
const DO_BANCO = new Map(Object.entries(PARA_BANCO).map(([t, b]) => [b, t as SituacaoPedidoAcesso]));
const EM_ANDAMENTO: readonly SituacaoPedidoAcesso[] = ['pendente', 'aprovado-setor', 'aprovado'];
const CANCELAVEL: readonly SituacaoPedidoAcesso[] = ['pendente', 'aprovado-setor'];
const TETO = 5_000;
const TIPO_SEQUENCIA = 'pedido_acesso';

const num = (v: unknown): number => Number(v);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const dia = (d: Date): string => d.toISOString().slice(0, 10);
const mesmo = (a: string | null, b: string) => (a ?? '').trim().toUpperCase() === b.trim().toUpperCase();
const recusa409 = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);

const SQL_PEDIDO = `SELECT pa.id, pa.versao, u.login, pf.codigo AS perfil, COALESCE(b.codigo, '') AS setor,
       DATE_FORMAT(pa.data_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(pa.data_fim, '%Y-%m-%d') AS fim,
       pa.justificativa, pa.situacao, pa.solicitado_em, us.login AS setor_por, pa.aprovado_setor_em,
       ua.login AS acessos_por, pa.aprovado_acessos_em, uf.login AS fechado_por, pa.fechado_em, pa.motivo_fechamento,
       pa.usuario_perfil_id, i.id AS item_id, i.versao AS item_versao, pa.usuario_id, i.perfil_acesso_id
  FROM pedido_acesso pa
  JOIN usuario u ON u.id = pa.usuario_id
  JOIN pedido_acesso_item i ON i.pedido_acesso_id = pa.id AND i.sequencia = 1 AND i.excluido_em IS NULL
  JOIN perfil_acesso pf ON pf.id = i.perfil_acesso_id
  LEFT JOIN bloco_internacao b ON b.id = pa.bloco_internacao_id
  LEFT JOIN usuario us ON us.id = pa.aprovado_setor_por_usuario_id
  LEFT JOIN usuario ua ON ua.id = pa.aprovado_acessos_por_usuario_id
  LEFT JOIN usuario uf ON uf.id = pa.fechado_por_usuario_id
 WHERE pa.estabelecimento_id = ? AND pa.excluido_em IS NULL`;

function pedidoDaLinha(x: Linha): PedidoAcessoGravado {
  return {
    id: String(x['id']),
    login: txt(x['login']),
    perfil: txt(x['perfil']),
    setor: txt(x['setor']),
    inicio: txt(x['inicio']),
    fim: txt(x['fim']),
    motivo: txt(x['justificativa']),
    situacao: DO_BANCO.get(txt(x['situacao'])) ?? 'pendente',
    criadoEm: data(x['solicitado_em']),
    setorPor: txtOuNull(x['setor_por']),
    setorEm: data(x['aprovado_setor_em']),
    acessosPor: txtOuNull(x['acessos_por']),
    acessosEm: data(x['aprovado_acessos_em']),
    fechadoPor: txtOuNull(x['fechado_por']),
    fechadoEm: data(x['fechado_em']),
    motivoFechamento: txtOuNull(x['motivo_fechamento']),
    concessao:
      x['usuario_perfil_id'] === null || x['usuario_perfil_id'] === undefined
        ? null
        : String(x['usuario_perfil_id']),
  };
}

const ID = z.string().regex(/^\d{1,18}$/);
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ESQUEMA_PEDIR = z
  .object({
    login: z.string().trim().min(1).max(60),
    perfil: z.string().max(60),
    setor: z.string().max(20),
    inicio: z.string().max(10),
    fim: z.string().max(10),
    motivo: z.string().max(2000),
    hoje: DIA,
  })
  .strict();
const ESQUEMA_CONCESSAO = z
  .object({
    login: z.string().min(1).max(60),
    perfil: z.string().min(1).max(60),
    inicio: DIA.nullable(),
    fim: DIA.nullable(),
    motivo: z.string().max(500),
    areaAprovou: z.string().max(60),
  })
  .strict();
const ESQUEMA_DECIDIR = z
  .object({
    pedido: ID,
    decisao: z.enum(['aprovar', 'recusar']),
    motivo: z.string().max(500),
    por: z.string().min(1).max(60),
    conceder: ESQUEMA_CONCESSAO.nullable(),
  })
  .strict();
const ESQUEMA_CONCEDER = z.object({ pedido: ID, conceder: ESQUEMA_CONCESSAO }).strict();
const ESQUEMA_ANOTAR = z.object({ pedido: ID, concessao: ID }).strict();
const ESQUEMA_CANCELAR = z
  .object({ pedido: ID, motivo: z.string().max(500), por: z.string().min(1).max(60) })
  .strict();

type Concessao = z.infer<typeof ESQUEMA_CONCESSAO>;
const entradaConcessao = (c: ConcessaoPerfilNova): Concessao => ({
  login: c.login,
  perfil: c.perfil,
  inicio: c.inicio ? dia(c.inicio) : null,
  fim: c.fim ? dia(c.fim) : null,
  motivo: c.motivo.slice(0, 500),
  areaAprovou: c.areaAprovou.slice(0, 60),
});

export class PedidoAcessoProprio {
  constructor(
    private readonly ler: LerGestao,
    private readonly gravar: GravarGestao,
  ) {}

  pedidosAcesso(hospital: string, filtro: FiltroPedidosAcesso = {}): Promise<PedidoAcessoGravado[]> {
    return this.ler(hospital, async (l, est) => {
      const p: unknown[] = [est];
      let sql = SQL_PEDIDO;
      if (filtro.login) {
        sql += ' AND u.login = ?';
        p.push(filtro.login);
      }
      if (filtro.situacoes?.length) {
        sql += ` AND pa.situacao IN (${filtro.situacoes.map(() => '?').join(', ')})`;
        p.push(...filtro.situacoes.map((s) => PARA_BANCO[s]));
      }
      return (await l.consultar(`${sql} ORDER BY pa.id DESC`, p, { teto: TETO })).map(pedidoDaLinha);
    });
  }

  pedidoAcesso(hospital: string, id: string): Promise<PedidoAcessoGravado | null> {
    if (!/^\d{1,18}$/.test(id)) return Promise.resolve(null);
    return this.ler(hospital, async (l, est) => {
      const x = await l.uma(`${SQL_PEDIDO} AND pa.id = ?`, [est, id]);
      return x ? pedidoDaLinha(x) : null;
    });
  }

  /** O pedido do estabelecimento travado (FOR UPDATE) e relido; outro estabelecimento ou inexistente: recusa. */
  private async travado(tx: TxOperacao, est: number, id: string): Promise<Linha> {
    const [t] = await tx.consultarParaAtualizar(
      'SELECT id FROM pedido_acesso WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    const x = t ? await tx.uma(`${SQL_PEDIDO} AND pa.id = ?`, [est, id]) : null;
    if (!x) throw recusa409('pedido-inexistente', 'Pedido de acesso não encontrado.');
    return x;
  }

  pedirAcesso(hospital: string, p: NovoPedidoAcessoGravar, t: TrilhaGestao): Promise<{ id: string }> {
    const entrada = {
      login: p.login,
      perfil: p.perfil.trim(),
      setor: p.setor.trim(),
      inicio: p.inicio,
      fim: p.fim,
      motivo: p.motivo.trim(),
      hoje: p.hoje,
    };
    return this.gravar(
      {
        nome: 'acesso.pedido.pedir',
        tabelas: ['pedido_acesso', 'pedido_acesso_item', 'sequencia_negocio'],
        esquema: ESQUEMA_PEDIR,
        alvo: 'pedido_acesso',
        motivo: (e) => e.motivo.slice(0, 500),
        dados: (e) => ({ perfil: e.perfil, setor: e.setor, inicio: e.inicio, fim: e.fim }),
      },
      hospital,
      t,
      entrada,
      async (tx, e, est, operador) => {
        if (!e.perfil) throw recusa409('perfil-obrigatorio', 'Escolha o perfil que você precisa.');
        if (!e.setor) throw recusa409('setor-obrigatorio', 'Escolha o setor onde o acesso será usado.');
        const diaOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
        if (!diaOk(e.inicio) || !diaOk(e.fim) || e.inicio < e.hoje || e.fim < e.inicio)
          throw recusa409(
            'periodo-invalido',
            'O período vai de hoje em diante e o fim fica no início ou depois.',
          );
        if (e.motivo.length < 10)
          throw recusa409('motivo-curto', 'Explique para que precisa do acesso (ao menos 10 caracteres).');
        // A conta do solicitante travada: dois pedidos simultâneos do mesmo perfil não passam juntos.
        const [u] = await tx.consultarParaAtualizar(
          `SELECT u.id FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL AND EXISTS (SELECT 1 FROM usuario_estabelecimento ue
             WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
               AND ue.vigencia_inicio <= CURDATE() AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURDATE()))`,
          [e.login, est],
          { teto: 1 },
        );
        if (!u || num(u['id']) !== operador)
          throw recusa409(
            'conta-sem-vinculo',
            'O pedido é feito pela própria conta, com vínculo neste estabelecimento.',
          );
        const pf = await tx.uma(
          `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
             AND ativo AND excluido_em IS NULL ORDER BY estabelecimento_id IS NULL LIMIT 1`,
          [e.perfil, est],
        );
        if (!pf)
          throw recusa(
            'perfil-inexistente',
            'O perfil não está cadastrado (ou está inativo) neste estabelecimento.',
          );
        const b = await tx.uma(
          'SELECT id FROM bloco_internacao WHERE codigo = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.setor, est],
        );
        if (!b) throw recusa409('setor-inexistente', 'O setor escolhido não existe neste estabelecimento.');
        const repetido = await tx.uma(
          `SELECT pa.id FROM pedido_acesso pa JOIN pedido_acesso_item i ON i.pedido_acesso_id = pa.id AND i.sequencia = 1
            WHERE pa.estabelecimento_id = ? AND pa.usuario_id = ? AND i.perfil_acesso_id = ? AND pa.excluido_em IS NULL
              AND pa.situacao IN (?, ?, ?) LIMIT 1`,
          [est, num(u['id']), num(pf['id']), ...EM_ANDAMENTO.map((s) => PARA_BANCO[s])],
        );
        if (repetido) throw recusa409('pedido-repetido', 'Já há um pedido deste perfil em andamento.');
        // A numeração do pedido pela sequencia_negocio do estabelecimento (criada na primeira vez).
        const seq = await tx.uma(
          'SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?',
          [TIPO_SEQUENCIA, est],
        );
        if (!seq)
          await tx.incluir('sequencia_negocio', {
            estabelecimento_id: est,
            tipo: TIPO_SEQUENCIA,
            prefixo: 'PA-',
            proximo_valor: 1,
            incremento: 1,
            ativo: true,
          });
        const numero = await tx.proximoNumero(TIPO_SEQUENCIA);
        const id = await tx.incluir('pedido_acesso', {
          estabelecimento_id: est,
          numero: numero.formatado,
          tipo: 'ampliacao',
          usuario_id: num(u['id']),
          bloco_internacao_id: num(b['id']),
          solicitante_usuario_id: operador,
          justificativa: e.motivo,
          data_inicio: e.inicio,
          data_fim: e.fim,
          situacao: PARA_BANCO.pendente,
          solicitado_em: new Date(),
        });
        await tx.incluir('pedido_acesso_item', {
          pedido_acesso_id: id,
          sequencia: 1,
          tipo_item: 'perfil',
          operacao: 'conceder',
          perfil_acesso_id: num(pf['id']),
          data_fim: e.fim,
        });
        return { resultado: { id, numero: numero.formatado } };
      },
    ).then((r) => ({ id: String(r.id) }));
  }

  /**
   * A concessão do perfil do pedido na transação da decisão (usuario_perfil), com as travas da concessão avulsa:
   * nenhuma concessão vigente sobreposta do mesmo perfil; a revogada com o mesmo início é reaberta.
   */
  private async conceder(tx: TxOperacao, est: number, x: Linha, c: Concessao): Promise<number> {
    if (!mesmo(txt(x['login']), c.login) || txt(x['perfil']) !== c.perfil)
      throw recusa409('concessao-divergente', 'A concessão não corresponde à conta e ao perfil do pedido.');
    const usuario = num(x['usuario_id']);
    const perfil = num(x['perfil_acesso_id']);
    const inicio = c.inicio ?? dia(new Date());
    const linhas = await tx.consultarParaAtualizar(
      `SELECT id, versao, excluido_em IS NOT NULL AS revogada,
              (excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)) AS sobrepoe,
              (vigencia_inicio = ?) AS mesmo_inicio
         FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ? ORDER BY id DESC`,
      [inicio, c.fim, c.fim, inicio, usuario, perfil, est],
      { teto: TETO },
    );
    const sim = (v: unknown) => v === true || Number(v) === 1;
    if (linhas.some((l) => sim(l['sobrepoe'])))
      throw recusa(
        'perfil-ja-concedido',
        'A pessoa já tem este perfil em vigor (ou agendado) no período: altere a concessão existente.',
      );
    const revogada = linhas.find((l) => sim(l['mesmo_inicio']) && sim(l['revogada']));
    if (revogada) {
      await tx.alterar('usuario_perfil', num(revogada['id']), num(revogada['versao']), {
        vigencia_fim: c.fim,
        motivo: c.motivo,
        excluido_em: null,
        excluido_por: null,
        revogado_motivo: null,
      });
      return num(revogada['id']);
    }
    return tx.incluir('usuario_perfil', {
      usuario_id: usuario,
      perfil_acesso_id: perfil,
      estabelecimento_id: est,
      vigencia_inicio: inicio,
      vigencia_fim: c.fim,
      provisorio: false,
      motivo: c.motivo,
    });
  }

  decidirPedidoAcesso(
    hospital: string,
    p: DecisaoPedidoAcessoGravar,
    t: TrilhaGestao,
    validar: ValidarPedidoAcesso,
    concessao?: ConcessaoDoPedidoGravar,
  ): Promise<{
    id: string;
    anterior: SituacaoPedidoAcesso;
    situacao: SituacaoPedidoAcesso;
    concessao: string | null;
  }> {
    const entrada = {
      pedido: p.pedido,
      decisao: p.decisao,
      motivo: p.motivo.trim().slice(0, 500),
      por: p.por,
      conceder: concessao ? entradaConcessao(concessao.concessao) : null,
    };
    return this.gravar(
      {
        nome: 'acesso.pedido.decidir',
        tabelas: ['pedido_acesso', 'pedido_acesso_item', 'usuario_perfil'],
        esquema: ESQUEMA_DECIDIR,
        alvo: 'pedido_acesso',
        motivo: (e) => e.motivo || null,
        dados: (e) => ({
          decisao: e.decisao,
          concede: !!e.conceder,
          areaAprovou: e.conceder?.areaAprovou ?? null,
        }),
      },
      hospital,
      t,
      entrada,
      async (tx, e, est, operador) => {
        const linha = await this.travado(tx, est, e.pedido);
        const x = pedidoDaLinha(linha);
        if (x.situacao !== 'pendente' && x.situacao !== 'aprovado-setor')
          throw recusa409('pedido-fechado', 'Este pedido não espera decisão (já decidido ou cancelado).');
        if (mesmo(x.login, e.por))
          throw recusa409('decidir-a-si', 'Ninguém decide o próprio pedido de acesso.');
        if (x.situacao === 'aprovado-setor' && mesmo(x.setorPor, e.por))
          throw recusa409('mesmo-aprovador', 'Os dois níveis têm de ser aprovados por pessoas diferentes.');
        if (e.decisao === 'recusar' && e.motivo.length < 10)
          throw recusa409('motivo-curto', 'Justifique a recusa (ao menos 10 caracteres).');
        const r = validar(x);
        if (r) throw recusa409(r.codigo, r.mensagem);
        const agora = new Date();
        const id = num(linha['id']);
        const item = (decisao: 'aprovado' | 'reprovado') =>
          tx.alterar('pedido_acesso_item', num(linha['item_id']), num(linha['item_versao']), {
            decisao,
            decidido_por_usuario_id: operador,
            decidido_em: agora,
            motivo_decisao: e.motivo || null,
          });
        let situacao: SituacaoPedidoAcesso;
        let concedida: number | null = null;
        if (e.decisao === 'recusar') {
          situacao = 'recusado';
          await tx.alterar('pedido_acesso', id, num(linha['versao']), {
            situacao: PARA_BANCO.recusado,
            decidido_em: agora,
            fechado_por_usuario_id: operador,
            fechado_em: agora,
            motivo_fechamento: e.motivo,
          });
          await item('reprovado');
        } else if (x.situacao === 'pendente') {
          situacao = 'aprovado-setor';
          await tx.alterar('pedido_acesso', id, num(linha['versao']), {
            situacao: PARA_BANCO['aprovado-setor'],
            aprovado_setor_por_usuario_id: operador,
            aprovado_setor_em: agora,
          });
        } else {
          if (e.conceder) concedida = await this.conceder(tx, est, linha, e.conceder);
          situacao = concedida ? 'concedido' : 'aprovado';
          await tx.alterar('pedido_acesso', id, num(linha['versao']), {
            situacao: PARA_BANCO[situacao],
            aprovado_acessos_por_usuario_id: operador,
            aprovado_acessos_em: agora,
            decidido_em: agora,
            ...(concedida
              ? { usuario_perfil_id: concedida, executado_em: agora, executado_por_usuario_id: operador }
              : {}),
          });
          await item('aprovado');
        }
        return {
          resultado: { id, anterior: x.situacao, situacao, concessao: concedida ? String(concedida) : null },
          antes: { situacao: x.situacao },
        };
      },
    ).then((r) => ({ id: String(r.id), anterior: r.anterior, situacao: r.situacao, concessao: r.concessao }));
  }

  concederPedidoAprovado(
    hospital: string,
    pedido: string,
    c: ConcessaoDoPedidoGravar,
  ): Promise<{ id: string; concessao: string }> {
    return this.gravar(
      {
        nome: 'acesso.pedido.conceder',
        tabelas: ['pedido_acesso', 'usuario_perfil'],
        esquema: ESQUEMA_CONCEDER,
        alvo: 'pedido_acesso',
        motivo: (e) => e.conceder.motivo || null,
        dados: (e) => ({ perfil: e.conceder.perfil, areaAprovou: e.conceder.areaAprovou }),
      },
      hospital,
      c.trilhaAnotacao,
      { pedido, conceder: entradaConcessao(c.concessao) },
      async (tx, e, est, operador) => {
        const linha = await this.travado(tx, est, e.pedido);
        const x = pedidoDaLinha(linha);
        if (x.situacao !== 'aprovado' || x.concessao)
          throw recusa409('pedido-nao-aprovado', 'Só o pedido aprovado nos dois níveis recebe a concessão.');
        const concedida = await this.conceder(tx, est, linha, e.conceder);
        const agora = new Date();
        await tx.alterar('pedido_acesso', num(linha['id']), num(linha['versao']), {
          situacao: PARA_BANCO.concedido,
          usuario_perfil_id: concedida,
          executado_em: agora,
          executado_por_usuario_id: operador,
        });
        return {
          resultado: { id: num(linha['id']), concessao: String(concedida) },
          antes: { situacao: x.situacao },
        };
      },
    ).then((r) => ({ id: String(r.id), concessao: r.concessao }));
  }

  /** Anota no pedido aprovado a concessão já gravada (da mesma conta, perfil e estabelecimento). */
  concessaoPedidoAcesso(
    hospital: string,
    pedido: string,
    concessao: string,
    t: TrilhaGestao,
  ): Promise<{ id: string; concessao: string }> {
    return this.gravar(
      {
        nome: 'acesso.pedido.anotar-concessao',
        tabelas: ['pedido_acesso'],
        esquema: ESQUEMA_ANOTAR,
        alvo: 'pedido_acesso',
        dados: (e) => ({ concessao: e.concessao }),
      },
      hospital,
      t,
      { pedido, concessao },
      async (tx, e, est, operador) => {
        const linha = await this.travado(tx, est, e.pedido);
        const x = pedidoDaLinha(linha);
        if (x.situacao !== 'aprovado' || x.concessao)
          throw recusa409('pedido-nao-aprovado', 'Só o pedido aprovado nos dois níveis recebe a concessão.');
        const up = await tx.uma(
          `SELECT id FROM usuario_perfil WHERE id = ? AND usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ?
              AND excluido_em IS NULL`,
          [e.concessao, num(linha['usuario_id']), num(linha['perfil_acesso_id']), est],
        );
        if (!up)
          throw recusa409(
            'concessao-divergente',
            'A concessão não corresponde à conta e ao perfil do pedido.',
          );
        await tx.alterar('pedido_acesso', num(linha['id']), num(linha['versao']), {
          situacao: PARA_BANCO.concedido,
          usuario_perfil_id: num(up['id']),
          executado_em: new Date(),
          executado_por_usuario_id: operador,
        });
        return { resultado: { id: num(linha['id']), concessao: String(up['id']) } };
      },
    ).then((r) => ({ id: String(r.id), concessao: r.concessao }));
  }

  cancelarPedidoAcesso(
    hospital: string,
    pedido: string,
    motivo: string,
    por: string,
    t: TrilhaGestao,
  ): Promise<{ id: string; anterior: SituacaoPedidoAcesso }> {
    return this.gravar(
      {
        nome: 'acesso.pedido.cancelar',
        tabelas: ['pedido_acesso', 'pedido_acesso_item'],
        esquema: ESQUEMA_CANCELAR,
        alvo: 'pedido_acesso',
        motivo: (e) => e.motivo,
      },
      hospital,
      t,
      { pedido, motivo: motivo.trim().slice(0, 500), por },
      async (tx, e, est, operador) => {
        if (e.motivo.length < 10)
          throw recusa409('motivo-curto', 'Diga por que cancela (ao menos 10 caracteres).');
        const linha = await this.travado(tx, est, e.pedido);
        const x = pedidoDaLinha(linha);
        if (x.situacao === 'aprovado')
          throw recusa409(
            'pedido-aprovado',
            'Este pedido já foi aprovado nos dois níveis: peça a revogação do perfil.',
          );
        if (!CANCELAVEL.includes(x.situacao))
          throw recusa409('pedido-fechado', 'Este pedido já foi concedido, recusado ou cancelado.');
        if (!mesmo(x.login, e.por))
          throw recusa409('cancelar-de-outro', 'Só quem pediu pode cancelar o pedido.');
        const agora = new Date();
        await tx.alterar('pedido_acesso', num(linha['id']), num(linha['versao']), {
          situacao: PARA_BANCO.cancelado,
          fechado_por_usuario_id: operador,
          fechado_em: agora,
          motivo_fechamento: e.motivo,
        });
        return { resultado: { id: num(linha['id']), anterior: x.situacao }, antes: { situacao: x.situacao } };
      },
    ).then((r) => ({ id: String(r.id), anterior: r.anterior }));
  }
}
