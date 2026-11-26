// Plano de cuidado e estratificação de risco do paciente (03-PEP L142), no banco próprio do cliente. Regras no domínio
// (@sgh/dominio-pep, plano-cuidado.ts); aqui ficam a leitura por paciente e a gravação pelo executor (trilha na mesma
// transação). plano_cuidado guarda o paciente, o estabelecimento, o profissional responsável, o risco, as metas e a
// situação; plano_cuidado_acao guarda os itens (problema, objetivo, intervenção, educação, monitoramento) em ordem,
// com o superior, o prazo, a situação e a justificativa do desvio. Nada é apagado.
import {
  ACOES_PLANO,
  DESCRICAO_ITEM_MAXIMA,
  type FalhaRegra,
  itemEmAberto,
  JUSTIFICATIVA_MAXIMA_PLANO,
  METAS_MAXIMO,
  NIVEIS_RISCO_PLANO,
  objetivoValido,
  PASSOS_ITEM_PLANO,
  passoItem,
  passoPlano,
  TIPOS_ITEM_PLANO,
  validarNaoCriacao,
  validarNovoItem,
  validarNovoPlano,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const dia = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const id = z.number().int().positive();
const diaTela = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = z.number().int().positive();

export const esquemaPlano = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('criar'),
      paciente: id,
      atendimento: id.nullable().optional(),
      risco: z.enum(NIVEIS_RISCO_PLANO).nullable().optional(),
      inicio: diaTela,
      fimPrevisto: diaTela.nullable().optional(),
      metas: z
        .string()
        .max(METAS_MAXIMO + 100)
        .nullable()
        .optional(),
      observacao: z.string().max(METAS_MAXIMO).nullable().optional(),
    })
    .strict(),
  z
    .object({
      acao: z.literal('nao_criar'),
      paciente: id,
      atendimento: id.nullable().optional(),
      justificativa: z.string().max(JUSTIFICATIVA_MAXIMA_PLANO + 100),
    })
    .strict(),
  ...ACOES_PLANO.map((a) =>
    z
      .object({
        acao: z.literal(a),
        plano: id,
        versao,
        risco: z.enum(NIVEIS_RISCO_PLANO).nullable().optional(),
        motivo: z.string().max(JUSTIFICATIVA_MAXIMA_PLANO).nullable().optional(),
      })
      .strict(),
  ),
  z
    .object({
      acao: z.literal('incluir_item'),
      plano: id,
      tipo: z.enum(TIPOS_ITEM_PLANO),
      descricao: z.string().max(DESCRICAO_ITEM_MAXIMA + 100),
      superior: id.nullable().optional(),
      prazo: diaTela.nullable().optional(),
    })
    .strict(),
  z
    .object({
      acao: z.literal('passo_item'),
      item: id,
      versao,
      passo: z.enum(PASSOS_ITEM_PLANO),
      justificativa: z.string().max(JUSTIFICATIVA_MAXIMA_PLANO).nullable().optional(),
    })
    .strict(),
] as unknown as [z.ZodDiscriminatedUnionOption<'acao'>, ...z.ZodDiscriminatedUnionOption<'acao'>[]]);

type Id = number;
export type EntradaPlano =
  | {
      acao: 'criar';
      paciente: Id;
      atendimento?: Id | null;
      risco?: (typeof NIVEIS_RISCO_PLANO)[number] | null;
      inicio: string;
      fimPrevisto?: string | null;
      metas?: string | null;
      observacao?: string | null;
    }
  | { acao: 'nao_criar'; paciente: Id; atendimento?: Id | null; justificativa: string }
  | {
      acao: (typeof ACOES_PLANO)[number];
      plano: Id;
      versao: number;
      risco?: (typeof NIVEIS_RISCO_PLANO)[number] | null;
      motivo?: string | null;
    }
  | {
      acao: 'incluir_item';
      plano: Id;
      tipo: (typeof TIPOS_ITEM_PLANO)[number];
      descricao: string;
      superior?: Id | null;
      prazo?: string | null;
    }
  | {
      acao: 'passo_item';
      item: Id;
      versao: number;
      passo: (typeof PASSOS_ITEM_PLANO)[number];
      justificativa?: string | null;
    };

export interface NucleoPlanoCuidado {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoPlano {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoPlano = ContextoPlano & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface ItemPlanoLido {
  readonly id: number;
  readonly versao: number;
  readonly sequencia: number;
  readonly superior: number | null;
  readonly tipo: string;
  readonly descricao: string;
  readonly prazo: string | null;
  readonly situacao: string;
  readonly concluidaEm: string | null;
  readonly justificativaDesvio: string | null;
}

export interface PlanoLido {
  readonly id: number;
  readonly versao: number;
  readonly situacao: string;
  readonly risco: string | null;
  readonly inicio: string | null;
  readonly fimPrevisto: string | null;
  readonly metas: string | null;
  readonly observacao: string | null;
  readonly justificativaNaoCriacao: string | null;
  readonly responsavel: string | null;
  readonly estabelecimentoId: number;
  readonly atendimentoId: number | null;
  readonly ativadoEm: string | null;
  readonly fechadoEm: string | null;
  readonly criadoEm: string | null;
  readonly itens: readonly ItemPlanoLido[];
}

export interface PlanosDoPaciente {
  readonly planos: readonly PlanoLido[];
  readonly podeEscrever: boolean;
}

export interface ResultadoPlano {
  readonly plano: number;
  readonly situacao: string;
  readonly item?: number;
  readonly risco?: string | null;
  /** O risco subiu para alto ou muito alto: a tela avisa a equipe. */
  readonly avisar?: boolean;
}

const recusar = (f: readonly FalhaRegra[]): never => {
  throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '));
};
const inexistente = (o: string): ErroOperacao =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrado`, `${o} não existe neste cliente.`);
const conflito = (): ErroOperacao =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Plano alterado por outra pessoa',
    'Recarregue o plano antes de seguir.',
  );

async function profDe(tx: Pick<TxOperacao, 'uma' | 'contexto'>): Promise<number | null> {
  const p = await tx.uma(
    'SELECT profissional_id FROM usuario_profissional WHERE usuario_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
    [tx.contexto.usuario],
  );
  return p ? num(p['profissional_id']) : null;
}

export class PlanoCuidadoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opPlano = definirOperacao<EntradaPlano, ResultadoPlano>({
    nome: 'pep.plano_cuidado',
    tabelas: ['plano_cuidado', 'plano_cuidado_acao'],
    entrada: esquemaPlano as unknown as z.ZodType<EntradaPlano>,
    gravar: (tx, e, ctx) => this.gravar(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'plano_cuidado', id: r.plano }),
  });

  constructor(
    private readonly nucleo: NucleoPlanoCuidado,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private ler<T>(fn: (l: Leitor) => Promise<T>, estabelecimento?: number): Promise<T> {
    return this.nucleo.lerSomente(
      {
        cliente: this.cliente,
        correlacao: 'pep.plano-cuidado',
        ...(estabelecimento ? { estabelecimento } : {}),
      },
      fn,
    );
  }

  private quem(c: ContextoPlano) {
    return this.ler(async (l) => {
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma(
        `SELECT u.id, (SELECT up.profissional_id FROM usuario_profissional up
                      WHERE up.usuario_id = u.id AND up.excluido_em IS NULL ORDER BY up.id LIMIT 1) AS profissional
         FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL`,
        [c.login],
      );
      return {
        estabelecimento: num(e['id']),
        usuario: u ? num(u['id']) : null,
        profissional: u ? numOuNull(u['profissional']) : null,
      };
    });
  }

  pacienteExiste(paciente: number): Promise<boolean> {
    return this.ler(async (l) =>
      Boolean(await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente])),
    );
  }

  /** O paciente dono do plano ou do item (o vínculo assistencial é conferido antes de gravar); null quando não existe. */
  pacienteDe(alvo: { plano: number } | { item: number }): Promise<number | null> {
    return this.ler(async (l) => {
      const x =
        'plano' in alvo
          ? await l.uma('SELECT paciente_id FROM plano_cuidado WHERE id = ? AND excluido_em IS NULL', [
              alvo.plano,
            ])
          : await l.uma(
              `SELECT p.paciente_id FROM plano_cuidado_acao a JOIN plano_cuidado p ON p.id = a.plano_cuidado_id
                WHERE a.id = ? AND a.excluido_em IS NULL AND p.excluido_em IS NULL`,
              [alvo.item],
            );
      return x ? num(x['paciente_id']) : null;
    });
  }

  /** Os planos do paciente (rede inteira: o plano acompanha o paciente na linha de cuidado), do mais novo ao mais velho. */
  async doPaciente(c: ContextoPlano, paciente: number): Promise<PlanosDoPaciente> {
    const q = await this.quem(c);
    return this.ler(async (l) => {
      const planos = await l.consultar(
        `SELECT p.id, p.versao, p.situacao, p.risco, p.inicio, p.fim_previsto, p.metas, p.observacao,
                p.justificativa_nao_criacao, pf.nome AS responsavel, p.estabelecimento_id, p.atendimento_id,
                p.ativado_em, p.fechado_em, p.criado_em
           FROM plano_cuidado p
           LEFT JOIN profissional pr ON pr.id = p.responsavel_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE p.paciente_id = ? AND p.excluido_em IS NULL
          ORDER BY p.criado_em DESC, p.id DESC LIMIT 100`,
        [paciente],
      );
      const ids = planos.map((p) => num(p['id']));
      const itens = ids.length
        ? await l.consultar(
            `SELECT id, versao, plano_cuidado_id, sequencia, superior_plano_cuidado_acao_id, tipo, descricao, prazo,
                    situacao, concluida_em, justificativa_desvio
               FROM plano_cuidado_acao
              WHERE plano_cuidado_id IN (${ids.map(() => '?').join(',')}) AND excluido_em IS NULL
              ORDER BY plano_cuidado_id, sequencia`,
            ids,
          )
        : [];
      return {
        planos: planos.map((p) => ({
          id: num(p['id']),
          versao: num(p['versao']),
          situacao: String(p['situacao']),
          risco: txt(p['risco']),
          inicio: dia(p['inicio']),
          fimPrevisto: dia(p['fim_previsto']),
          metas: txt(p['metas']),
          observacao: txt(p['observacao']),
          justificativaNaoCriacao: txt(p['justificativa_nao_criacao']),
          responsavel: txt(p['responsavel']),
          estabelecimentoId: num(p['estabelecimento_id']),
          atendimentoId: numOuNull(p['atendimento_id']),
          ativadoEm: iso(p['ativado_em']),
          fechadoEm: iso(p['fechado_em']),
          criadoEm: iso(p['criado_em']),
          itens: itens
            .filter((i) => num(i['plano_cuidado_id']) === num(p['id']))
            .map((i) => ({
              id: num(i['id']),
              versao: num(i['versao']),
              sequencia: num(i['sequencia']),
              superior: numOuNull(i['superior_plano_cuidado_acao_id']),
              tipo: String(i['tipo']),
              descricao: String(i['descricao']),
              prazo: dia(i['prazo']),
              situacao: String(i['situacao']),
              concluidaEm: iso(i['concluida_em']),
              justificativaDesvio: txt(i['justificativa_desvio']),
            })),
        })),
        podeEscrever: q.profissional !== null,
      };
    }, q.estabelecimento);
  }

  async gravarPlano(c: ContextoGravacaoPlano, entrada: unknown) {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.opPlano, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async conferirPaciente(tx: TxOperacao, paciente: number, atendimento: number | null | undefined) {
    const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente]);
    if (!p) throw inexistente('O paciente');
    if (atendimento) {
      const a = await tx.uma('SELECT paciente_id FROM atendimento WHERE id = ? AND excluido_em IS NULL', [
        atendimento,
      ]);
      if (!a || num(a['paciente_id']) !== paciente)
        throw recusa('atendimento-de-outro-paciente', 'O atendimento não é deste paciente.');
    }
  }

  private async planoTravado(tx: TxOperacao, plano: number) {
    const [p] = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao, risco, inicio, observacao FROM plano_cuidado WHERE id = ? AND excluido_em IS NULL',
      [plano],
      { teto: 1 },
    );
    if (!p) throw inexistente('O plano de cuidado');
    return p;
  }

  private async gravar(tx: TxOperacao, e: EntradaPlano, ctx: ContextoOperacao): Promise<ResultadoPlano> {
    const agora = this.agora();
    const prof = await profDe(tx);
    const estabelecimento = Number(ctx.estabelecimento);
    if (e.acao === 'criar') {
      await this.conferirPaciente(tx, e.paciente, e.atendimento);
      const falhas = validarNovoPlano({
        inicio: e.inicio,
        fimPrevisto: e.fimPrevisto ?? null,
        risco: e.risco ?? null,
        metas: e.metas ?? null,
        responsavel: prof,
      });
      if (falhas.length) recusar(falhas);
      const plano = await tx.incluir('plano_cuidado', {
        estabelecimento_id: estabelecimento,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento ?? null,
        risco: e.risco ?? null,
        situacao: 'rascunho',
        responsavel_profissional_id: prof,
        inicio: e.inicio,
        fim_previsto: e.fimPrevisto ?? null,
        metas: e.metas?.trim() || null,
        observacao: e.observacao?.trim() || null,
        origem: 'sistema',
      });
      return { plano, situacao: 'rascunho', risco: e.risco ?? null };
    }
    if (e.acao === 'nao_criar') {
      await this.conferirPaciente(tx, e.paciente, e.atendimento);
      const falhas = validarNaoCriacao(e.justificativa, prof);
      if (falhas.length) recusar(falhas);
      const plano = await tx.incluir('plano_cuidado', {
        estabelecimento_id: estabelecimento,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento ?? null,
        situacao: 'nao_criado',
        justificativa_nao_criacao: e.justificativa.trim(),
        responsavel_profissional_id: prof,
        inicio: agora.toISOString().slice(0, 10),
        origem: 'sistema',
      });
      return { plano, situacao: 'nao_criado' };
    }
    if (e.acao === 'incluir_item') {
      const p = await this.planoTravado(tx, e.plano);
      const superior = e.superior
        ? await tx.uma(
            'SELECT tipo FROM plano_cuidado_acao WHERE id = ? AND plano_cuidado_id = ? AND excluido_em IS NULL',
            [e.superior, e.plano],
          )
        : null;
      const falhas = validarNovoItem({
        tipo: e.tipo,
        descricao: e.descricao,
        situacaoPlano: String(p['situacao']),
        tipoSuperior: e.superior ? (superior ? String(superior['tipo']) : undefined) : null,
        prazo: e.prazo ?? null,
        inicioPlano: dia(p['inicio']) ?? '',
      });
      if (falhas.length) recusar(falhas);
      const s = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) AS n FROM plano_cuidado_acao WHERE plano_cuidado_id = ?',
        [e.plano],
      );
      const item = await tx.incluir('plano_cuidado_acao', {
        plano_cuidado_id: e.plano,
        sequencia: num(s?.['n'] ?? 0) + 1,
        superior_plano_cuidado_acao_id: e.superior ?? null,
        tipo: e.tipo,
        descricao: e.descricao.trim(),
        responsavel_profissional_id: prof,
        prazo: e.prazo ?? null,
        situacao: 'pendente',
        origem: 'sistema',
      });
      return { plano: e.plano, situacao: String(p['situacao']), item };
    }
    if (e.acao === 'passo_item') {
      const [i] = await tx.consultarParaAtualizar(
        `SELECT a.id, a.versao, a.situacao, a.plano_cuidado_id, p.situacao AS situacao_plano
           FROM plano_cuidado_acao a JOIN plano_cuidado p ON p.id = a.plano_cuidado_id
          WHERE a.id = ? AND a.excluido_em IS NULL`,
        [e.item],
        { teto: 1 },
      );
      if (!i) throw inexistente('O item do plano');
      if (num(i['versao']) !== e.versao) throw conflito();
      const r = passoItem({
        passo: e.passo,
        situacao: String(i['situacao']),
        situacaoPlano: String(i['situacao_plano']),
        justificativa: e.justificativa ?? null,
      });
      if (r.falhas.length) recusar(r.falhas);
      await tx.alterar('plano_cuidado_acao', e.item, e.versao, {
        situacao: r.situacaoNova,
        ...(r.situacaoNova === 'concluida' ? { concluida_em: agora } : {}),
        ...(r.situacaoNova === 'cancelada' || r.situacaoNova === 'nao_realizada'
          ? { justificativa_desvio: e.justificativa!.trim() }
          : {}),
      } as never);
      return { plano: num(i['plano_cuidado_id']), situacao: String(i['situacao_plano']), item: e.item };
    }
    const p = await this.planoTravado(tx, e.plano);
    if (num(p['versao']) !== e.versao) throw conflito();
    const itens = await tx.consultar(
      'SELECT tipo, situacao FROM plano_cuidado_acao WHERE plano_cuidado_id = ? AND excluido_em IS NULL',
      [e.plano],
    );
    const r = passoPlano({
      acao: e.acao,
      situacao: String(p['situacao']),
      risco: txt(p['risco']),
      riscoNovo: e.risco ?? null,
      motivo: e.motivo ?? null,
      objetivos: itens.filter((x) => objetivoValido(String(x['tipo']), String(x['situacao']))).length,
      itensEmAberto: itens.filter((x) => itemEmAberto(String(x['situacao']))).length,
    });
    if (r.falhas.length) recusar(r.falhas);
    const campos: Record<string, unknown> = {};
    if (e.acao === 'ativar') Object.assign(campos, { situacao: 'ativo', ativado_em: agora });
    else if (e.acao === 'estratificar') campos['risco'] = r.riscoNovo;
    else if (e.acao === 'fechar')
      Object.assign(campos, { situacao: 'fechado', fechado_em: agora, fechamento_usuario_id: ctx.usuario });
    else {
      const anterior = txt(p['observacao']);
      const nota = `Cancelado em ${agora.toISOString().slice(0, 10)}: ${e.motivo!.trim()}`;
      Object.assign(campos, { situacao: 'cancelado', observacao: anterior ? `${anterior}\n${nota}` : nota });
    }
    await tx.alterar('plano_cuidado', e.plano, e.versao, campos as never);
    return { plano: e.plano, situacao: r.situacaoNova!, risco: r.riscoNovo, avisar: r.avisar };
  }
}
