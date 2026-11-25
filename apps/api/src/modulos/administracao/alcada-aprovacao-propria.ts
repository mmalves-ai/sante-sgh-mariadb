// Alçadas de aprovação no banco próprio (01-ADM L59, escopo do usuário), pelo Executor (trilha e idempotência na
// mesma transação). Regras no domínio (@sgh/dominio-organizacao, alcada-aprovacao.ts); aqui ficam leitura e gravação.
//
// - organizacao.alcada_gravar: cria ou altera a regra (alcada_aprovacao) com os níveis (alcada_aprovacao_nivel). O
//   número de níveis sai das linhas. A vigência nova sobre a regra aberta do mesmo documento encerra a anterior na
//   véspera (na mesma transação); a linha de nível que sai fica com exclusão lógica (nunca apagada) e a que entra
//   recebe sequência nova. Regra já usada em pedido de aprovação não troca os níveis (abre-se vigência nova).
// - organizacao.alcada_encerrar: fecha a vigência (a regra que ainda não começou é desativada).
// - painel: tipos de documento, perfis e contas que podem aprovar, as regras do estabelecimento com os níveis e, com
//   `usuario`, a visão da conta: em quais regras e níveis ela aprova (direto ou pelo perfil vigente).
import {
  conferirTrocaNiveis,
  encerrarAlcada,
  type LinhaNivelAlcada,
  MENSAGEM_ALCADA,
  niveisIguais,
  planejarVigencia,
  quantidadeNiveis,
  type RecusaAlcada,
  validarAlcada,
} from '@sgh/dominio-organizacao';
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

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const recusar = (r: RecusaAlcada) => recusa(r, MENSAGEM_ALCADA[r]);
const TETO = 5000;

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const valor = z.number().finite().min(0).max(9_999_999_999_999);

export const esquemaNivelAlcada = z
  .object({
    nivel: z.number().int().min(1).max(20),
    perfil: z.string().trim().min(1).max(30).nullable().optional(),
    usuario: z.string().trim().min(1).max(60).nullable().optional(),
    valorMinimo: valor.default(0),
    valorMaximo: valor.nullable().optional(),
    valorAcumuladoMaximo: valor.nullable().optional(),
    periodoAcumulado: z.enum(['dia', 'semana', 'mes', 'ano']).nullable().optional(),
    obrigatorio: z.boolean().default(true),
    prazoHoras: z.number().int().positive().max(8760).nullable().optional(),
  })
  .strict();

export const esquemaAlcada = z
  .object({
    id: z.number().int().positive().optional(),
    versao: z.number().int().positive().optional(),
    documento: z.string().trim().min(1).max(30),
    descricao: z.string().trim().max(150),
    modo: z.enum(['serie', 'paralelo']).default('serie'),
    prazoHoras: z.number().int().positive().max(8760).nullable().optional(),
    acaoPrazoVencido: z.enum(['alertar', 'escalar', 'recusar']).default('alertar'),
    permiteAutoaprovacao: z.boolean().default(false),
    exigeJustificativaRecusa: z.boolean().default(true),
    vigenciaInicio: dataIso,
    vigenciaFim: dataIso.nullable().optional(),
    niveis: z.array(esquemaNivelAlcada).max(200),
  })
  .strict();
export type EntradaAlcada = z.infer<typeof esquemaAlcada>;

export const esquemaEncerrarAlcada = z
  .object({
    id: z.number().int().positive(),
    versao: z.number().int().positive(),
    fim: dataIso.nullable().optional(),
  })
  .strict();
export type EntradaEncerrarAlcada = z.infer<typeof esquemaEncerrarAlcada>;

export interface NucleoAlcada {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoAlcada {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoAlcada = ContextoAlcada & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface NivelAlcadaLido extends LinhaNivelAlcada {
  readonly obrigatorio: boolean;
  readonly prazoHoras: number | null;
}
export interface AlcadaLida {
  readonly id: number;
  readonly versao: number;
  readonly documento: string;
  readonly documentoDescricao: string;
  readonly descricao: string;
  readonly modo: string;
  readonly quantidadeNiveis: number;
  readonly prazoHoras: number | null;
  readonly acaoPrazoVencido: string;
  readonly permiteAutoaprovacao: boolean;
  readonly exigeJustificativaRecusa: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  /** Vigente hoje (ativa e dentro da vigência). */
  readonly vigente: boolean;
  /** Pedidos de aprovação que já usaram a regra (com eles, os níveis não mudam). */
  readonly pedidos: number;
  readonly niveis: NivelAlcadaLido[];
}
export interface AlcadaDoUsuario {
  readonly alcada: number;
  readonly documento: string;
  readonly descricao: string;
  readonly nivel: number;
  readonly via: 'conta' | 'perfil';
  readonly perfil: string | null;
  readonly valorMinimo: number;
  readonly valorMaximo: number | null;
}
export interface PainelAlcadas {
  readonly documentos: { codigo: string; descricao: string }[];
  readonly perfis: { codigo: string; nome: string }[];
  readonly alcadas: AlcadaLida[];
  readonly doUsuario?: AlcadaDoUsuario[];
}

const SQL_ALCADA = `SELECT a.id, a.versao, t.codigo AS documento, t.descricao AS documento_descricao, a.descricao,
       a.modo_aprovacao, a.quantidade_niveis, a.prazo_horas, a.acao_prazo_vencido, a.permite_autoaprovacao,
       a.exige_justificativa_recusa, a.vigencia_inicio, a.vigencia_fim, a.ativo,
       (a.ativo AND a.vigencia_inicio <= CURDATE() AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= CURDATE())) AS vigente,
       (SELECT COUNT(*) FROM pedido_aprovacao pa WHERE pa.alcada_aprovacao_id = a.id) AS pedidos
  FROM alcada_aprovacao a JOIN tipo_documento_aprovacao t ON t.id = a.tipo_documento_aprovacao_id`;

const SQL_NIVEL = `SELECT n.alcada_aprovacao_id, n.nivel, p.codigo AS perfil, u.login AS usuario, n.valor_unitario_minimo,
       n.valor_unitario_maximo, n.valor_acumulado_maximo, n.periodo_acumulado, n.obrigatorio, n.prazo_horas
  FROM alcada_aprovacao_nivel n
  LEFT JOIN perfil_acesso p ON p.id = n.perfil_acesso_id
  LEFT JOIN usuario u ON u.id = n.aprovador_usuario_id`;

function nivelDaLinha(x: Linha): NivelAlcadaLido {
  return {
    nivel: num(x['nivel']),
    perfil: txt(x['perfil']),
    usuario: txt(x['usuario']),
    valorMinimo: num(x['valor_unitario_minimo']),
    valorMaximo: numOuNull(x['valor_unitario_maximo']),
    valorAcumuladoMaximo: numOuNull(x['valor_acumulado_maximo']),
    periodoAcumulado: txt(x['periodo_acumulado']),
    obrigatorio: bool(x['obrigatorio']),
    prazoHoras: numOuNull(x['prazo_horas']),
  };
}

const linhaDominio = (n: z.infer<typeof esquemaNivelAlcada>): LinhaNivelAlcada => ({
  nivel: n.nivel,
  perfil: n.perfil ?? null,
  usuario: n.usuario ?? null,
  valorMinimo: n.valorMinimo,
  valorMaximo: n.valorMaximo ?? null,
  valorAcumuladoMaximo: n.valorAcumuladoMaximo ?? null,
  periodoAcumulado: n.periodoAcumulado ?? null,
});

export class AlcadaAprovacaoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opGravar = definirOperacao<EntradaAlcada, { alcada: number; encerrada: number | null }>({
    nome: 'organizacao.alcada_gravar',
    tabelas: ['alcada_aprovacao', 'alcada_aprovacao_nivel'],
    entrada: esquemaAlcada as unknown as z.ZodType<EntradaAlcada>,
    gravar: (tx, e, ctx) => this.gravar(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'alcada_aprovacao', id: r.alcada }),
  });

  private readonly opEncerrar = definirOperacao<EntradaEncerrarAlcada, { alcada: number; acao: string }>({
    nome: 'organizacao.alcada_encerrar',
    tabelas: ['alcada_aprovacao'],
    entrada: esquemaEncerrarAlcada,
    gravar: (tx, e, ctx) => this.encerrar(tx, e, ctx),
    alvo: (e) => ({ tabela: 'alcada_aprovacao', id: e.id }),
  });

  constructor(
    private readonly nucleo: NucleoAlcada,
    private readonly cliente: string,
    private readonly hoje: () => string = () => dia(new Date()) as string,
  ) {}

  private async quem(l: Leitor, c: ContextoAlcada) {
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
    const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
    return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
  }

  private async exec<S>(
    op: Parameters<Executor['executar']>[0],
    c: ContextoGravacaoAlcada,
    entrada: unknown,
  ) {
    const q = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.alcada' },
      (l) => this.quem(l, c),
    );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { resultado: r.resultado as unknown as S, repetida: r.repetida };
  }

  // ── Leitura ─────────────────────────────────────────────────────────────────────────────────────

  painel(c: ContextoAlcada, usuario?: string): Promise<PainelAlcadas> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'administracao.alcada' },
      async (l) => {
        const { estabelecimento: est } = await this.quem(l, c);
        const documentos = await l.consultar(
          'SELECT codigo, descricao FROM tipo_documento_aprovacao WHERE ativo ORDER BY descricao, codigo',
          [],
          { teto: TETO },
        );
        const perfis = await l.consultar(
          `SELECT codigo, nome FROM perfil_acesso
          WHERE ativo AND excluido_em IS NULL AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
          ORDER BY nome, codigo`,
          [est],
          { teto: TETO },
        );
        const as = await l.consultar(
          `${SQL_ALCADA} WHERE a.estabelecimento_id = ? ORDER BY t.descricao, a.vigencia_inicio DESC, a.id`,
          [est],
          { teto: TETO },
        );
        const ns = as.length
          ? await l.consultar(
              `${SQL_NIVEL} WHERE n.alcada_aprovacao_id IN (${as.map(() => '?').join(', ')}) AND n.excluido_em IS NULL
              ORDER BY n.alcada_aprovacao_id, n.nivel, n.sequencia`,
              as.map((x) => num(x['id'])),
              { teto: TETO },
            )
          : [];
        const alcadas: AlcadaLida[] = as.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          documento: String(x['documento']),
          documentoDescricao: String(x['documento_descricao']),
          descricao: String(x['descricao']),
          modo: String(x['modo_aprovacao']),
          quantidadeNiveis: num(x['quantidade_niveis']),
          prazoHoras: numOuNull(x['prazo_horas']),
          acaoPrazoVencido: String(x['acao_prazo_vencido']),
          permiteAutoaprovacao: bool(x['permite_autoaprovacao']),
          exigeJustificativaRecusa: bool(x['exige_justificativa_recusa']),
          vigenciaInicio: dia(x['vigencia_inicio']) as string,
          vigenciaFim: dia(x['vigencia_fim']),
          ativo: bool(x['ativo']),
          vigente: bool(x['vigente']),
          pedidos: num(x['pedidos']),
          niveis: ns.filter((n) => num(n['alcada_aprovacao_id']) === num(x['id'])).map(nivelDaLinha),
        }));
        const base: PainelAlcadas = {
          documentos: documentos.map((d) => ({
            codigo: String(d['codigo']),
            descricao: String(d['descricao']),
          })),
          perfis: perfis.map((p) => ({ codigo: String(p['codigo']), nome: String(p['nome']) })),
          alcadas,
        };
        if (!usuario) return base;
        // A visão da conta: níveis das regras vigentes em que ela aprova, direto ou por um perfil vigente.
        const doUsuario = await l.consultar(
          `SELECT a.id AS alcada, t.codigo AS documento, a.descricao, n.nivel, n.valor_unitario_minimo,
                n.valor_unitario_maximo, p.codigo AS perfil, (n.aprovador_usuario_id IS NOT NULL) AS direto
           FROM alcada_aprovacao a
           JOIN tipo_documento_aprovacao t ON t.id = a.tipo_documento_aprovacao_id
           JOIN alcada_aprovacao_nivel n ON n.alcada_aprovacao_id = a.id AND n.excluido_em IS NULL
           JOIN usuario u ON u.login = ? AND u.excluido_em IS NULL
           LEFT JOIN perfil_acesso p ON p.id = n.perfil_acesso_id
          WHERE a.estabelecimento_id = ? AND a.ativo
            AND a.vigencia_inicio <= CURDATE() AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= CURDATE())
            AND (n.aprovador_usuario_id = u.id OR EXISTS (
                  SELECT 1 FROM usuario_perfil up
                   WHERE up.usuario_id = u.id AND up.perfil_acesso_id = n.perfil_acesso_id AND up.excluido_em IS NULL
                     AND (up.estabelecimento_id IS NULL OR up.estabelecimento_id = a.estabelecimento_id)
                     AND up.vigencia_inicio <= CURDATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURDATE())))
          ORDER BY t.codigo, n.nivel`,
          [usuario, est],
          { teto: TETO },
        );
        return {
          ...base,
          doUsuario: doUsuario.map((x) => ({
            alcada: num(x['alcada']),
            documento: String(x['documento']),
            descricao: String(x['descricao']),
            nivel: num(x['nivel']),
            via: bool(x['direto']) ? ('conta' as const) : ('perfil' as const),
            perfil: txt(x['perfil']),
            valorMinimo: num(x['valor_unitario_minimo']),
            valorMaximo: numOuNull(x['valor_unitario_maximo']),
          })),
        };
      },
    );
  }

  // ── Gravações ───────────────────────────────────────────────────────────────────────────────────

  gravarAlcada(c: ContextoGravacaoAlcada, entrada: unknown) {
    return this.exec<{ alcada: number; encerrada: number | null }>(this.opGravar as never, c, entrada);
  }
  encerrarAlcada(c: ContextoGravacaoAlcada, entrada: unknown) {
    return this.exec<{ alcada: number; acao: string }>(this.opEncerrar as never, c, entrada);
  }

  private async aprovadores(tx: TxOperacao, est: number, e: EntradaAlcada) {
    const ids = new Map<string, number>();
    for (const n of e.niveis) {
      if (n.perfil && !ids.has(`p:${n.perfil}`)) {
        const p = await tx.uma(
          `SELECT id FROM perfil_acesso WHERE codigo = ? AND ativo AND excluido_em IS NULL
              AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY estabelecimento_id IS NULL LIMIT 1`,
          [n.perfil, est],
        );
        if (!p) throw recusa('perfil-inexistente', `Perfil de acesso não encontrado: ${n.perfil}.`);
        ids.set(`p:${n.perfil}`, num(p['id']));
      }
      if (n.usuario && !ids.has(`u:${n.usuario}`)) {
        // Só aprova quem tem acesso vigente a este estabelecimento e conta ativa.
        const u = await tx.uma(
          `SELECT u.id FROM usuario u
             JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
              AND ue.vigencia_inicio <= CURDATE() AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURDATE())
            WHERE u.login = ? AND u.excluido_em IS NULL AND u.situacao NOT IN ('bloqueado', 'inativo') LIMIT 1`,
          [est, n.usuario],
        );
        if (!u)
          throw recusa(
            'aprovador-sem-acesso',
            `A conta ${n.usuario} não existe, está bloqueada ou não tem acesso a este estabelecimento.`,
          );
        ids.set(`u:${n.usuario}`, num(u['id']));
      }
    }
    return ids;
  }

  private async gravar(tx: TxOperacao, e: EntradaAlcada, ctx: ContextoOperacao) {
    const est = ctx.estabelecimento as number;
    const niveis = e.niveis.map(linhaDominio);
    const v = validarAlcada({
      descricao: e.descricao,
      vigenciaInicio: e.vigenciaInicio,
      vigenciaFim: e.vigenciaFim ?? null,
      niveis,
    });
    if (v) throw recusar(v);
    const tipo = await tx.uma('SELECT id FROM tipo_documento_aprovacao WHERE codigo = ? AND ativo', [
      e.documento,
    ]);
    if (!tipo)
      throw recusa('documento-inexistente', 'Tipo de documento de aprovação inexistente ou inativo.');
    const tipoId = num(tipo['id']);
    const ids = await this.aprovadores(tx, est, e);

    let atual: Linha | null = null;
    if (e.id) {
      if (!e.versao) throw recusa('versao-obrigatoria', 'Informe a versão lida da regra de alçada.');
      atual = await this.travar(
        tx,
        'SELECT id, tipo_documento_aprovacao_id FROM alcada_aprovacao WHERE id = ? AND estabelecimento_id = ?',
        [e.id, est],
      );
      if (!atual) throw recusa('alcada-inexistente', 'Regra de alçada não encontrada neste estabelecimento.');
      if (num(atual['tipo_documento_aprovacao_id']) !== tipoId)
        throw recusa(
          'documento-imutavel',
          'O documento da regra não muda: crie outra regra para outro documento.',
        );
    }
    const outras = await tx.consultarParaAtualizar(
      `SELECT id, vigencia_inicio, vigencia_fim FROM alcada_aprovacao
        WHERE estabelecimento_id = ? AND tipo_documento_aprovacao_id = ? AND ativo AND id <> ?`,
      [est, tipoId, e.id ?? 0],
    );
    const plano = planejarVigencia(
      { inicio: e.vigenciaInicio, fim: e.vigenciaFim ?? null },
      outras.map((o) => ({
        id: num(o['id']),
        inicio: dia(o['vigencia_inicio']) as string,
        fim: dia(o['vigencia_fim']),
      })),
    );
    if (plano.recusa) throw recusar(plano.recusa);
    if (plano.encerrar) {
      const o = await tx.uma('SELECT versao FROM alcada_aprovacao WHERE id = ?', [plano.encerrar.id]);
      await tx.alterar('alcada_aprovacao', plano.encerrar.id, num(o?.['versao']), {
        vigencia_fim: plano.encerrar.fim,
      });
    }

    const valores = {
      descricao: e.descricao,
      quantidade_niveis: quantidadeNiveis(niveis),
      modo_aprovacao: e.modo,
      prazo_horas: e.prazoHoras ?? null,
      acao_prazo_vencido: e.acaoPrazoVencido,
      permite_autoaprovacao: e.permiteAutoaprovacao,
      exige_justificativa_recusa: e.exigeJustificativaRecusa,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim ?? null,
    };
    let alcada: number;
    if (atual && e.id && e.versao) {
      alcada = e.id;
      const lidos = await tx.consultar(
        `${SQL_NIVEL} WHERE n.alcada_aprovacao_id = ? AND n.excluido_em IS NULL`,
        [alcada],
      );
      const mudou = !niveisIguais(lidos.map(nivelDaLinha), niveis);
      const usados = await tx.uma(
        'SELECT COUNT(*) AS q FROM pedido_aprovacao WHERE alcada_aprovacao_id = ?',
        [alcada],
      );
      const t = conferirTrocaNiveis(num(usados?.['q']), mudou);
      if (t) throw recusar(t);
      await tx.alterar('alcada_aprovacao', alcada, e.versao, valores);
      if (!mudou) return { alcada, encerrada: plano.encerrar?.id ?? null };
      // A linha que sai fica com exclusão lógica (nunca apagada).
      await tx.executar(
        `UPDATE alcada_aprovacao_nivel SET excluido_em = NOW(3), excluido_por = ?, alterado_em = NOW(3),
                alterado_por = ?, versao = versao + 1
          WHERE alcada_aprovacao_id = ? AND excluido_em IS NULL`,
        [ctx.usuario, ctx.usuario, alcada],
      );
    } else {
      alcada = await tx.incluir('alcada_aprovacao', {
        ...valores,
        estabelecimento_id: est,
        tipo_documento_aprovacao_id: tipoId,
      });
    }
    // Sequência nova depois de todas as já usadas (a unicidade inclui as linhas excluídas).
    const s = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM alcada_aprovacao_nivel WHERE alcada_aprovacao_id = ?',
      [alcada],
    );
    let seq = num(s?.['s']);
    for (const n of [...e.niveis].sort((a, b) => a.nivel - b.nivel)) {
      seq++;
      await tx.incluir('alcada_aprovacao_nivel', {
        alcada_aprovacao_id: alcada,
        sequencia: seq,
        nivel: n.nivel,
        perfil_acesso_id: n.perfil ? (ids.get(`p:${n.perfil}`) ?? null) : null,
        aprovador_usuario_id: n.usuario ? (ids.get(`u:${n.usuario}`) ?? null) : null,
        valor_unitario_minimo: n.valorMinimo,
        valor_unitario_maximo: n.valorMaximo ?? null,
        valor_acumulado_maximo: n.valorAcumuladoMaximo ?? null,
        periodo_acumulado: n.periodoAcumulado ?? null,
        obrigatorio: n.obrigatorio,
        prazo_horas: n.prazoHoras ?? null,
      });
    }
    return { alcada, encerrada: plano.encerrar?.id ?? null };
  }

  private async travar(tx: TxOperacao, sql: string, p: unknown[]): Promise<Linha | null> {
    const [l] = await tx.consultarParaAtualizar(sql, p, { teto: 1 });
    return l ?? null;
  }

  private async encerrar(tx: TxOperacao, e: EntradaEncerrarAlcada, ctx: ContextoOperacao) {
    const a = await this.travar(
      tx,
      'SELECT id, vigencia_inicio, vigencia_fim, ativo FROM alcada_aprovacao WHERE id = ? AND estabelecimento_id = ?',
      [e.id, ctx.estabelecimento],
    );
    if (!a || !bool(a['ativo']))
      throw recusa('alcada-inexistente', 'Regra de alçada não encontrada ou já desativada.');
    const d = encerrarAlcada(
      { inicio: dia(a['vigencia_inicio']) as string, fim: dia(a['vigencia_fim']) },
      this.hoje(),
      e.fim ?? null,
    );
    if (d.recusa) throw recusar(d.recusa);
    if (d.acao === 'desativar') await tx.alterar('alcada_aprovacao', e.id, e.versao, { ativo: false });
    else await tx.alterar('alcada_aprovacao', e.id, e.versao, { vigencia_fim: d.fim });
    return { alcada: e.id, acao: d.acao };
  }
}
