// Fonte própria da configuração por estabelecimento (M08) sobre o banco MariaDB do cliente, pelo @sgh/nucleo:
//   - parâmetros: parametro_definicao (catálogo tipado), parametro_valor (valor por nível e alvo, com vigência) e
//     parametro_valor_historico (quem, quando, valor anterior e motivo);
//   - liberação: liberacao_chave (chave de operação ou de recurso por escopo), liberacao_lote (o lote reversível, com
//     número de negócio) e recurso_prerequisito (pré-requisitos externos dos recursos, POL-3).
// Toda gravação passa pelo Executor (trilha, outbox e idempotência na mesma transação); a decisão é tomada sobre o
// estado relido com trava (SELECT ... FOR UPDATE) dentro da transação, nunca sobre o cache.
// Melhoria: a justificativa e a referência da autorização ficam no lote (uma vez), não repetidas em cada linha.
// Melhoria: o histórico do parâmetro guarda o valor anterior, o novo, a reautenticação e o motivo da retirada.
// Melhoria: a montagem confere as tabelas do modelo (conferirModelo) e não registra a fonte sem elas.
// Melhoria: o alvo do parâmetro é chave estrangeira (estabelecimento, unidade, perfil, usuário), conferida no banco.
import { randomUUID } from 'node:crypto';
import type { NivelParametro, ValorParametro } from '@sgh/contratos';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  FORMATO_CHAVE_IDEMPOTENCIA,
  garantirSequencia,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type {
  ChaveLiberacao,
  DefinicaoValorParametro,
  EstadoDoLote,
  FonteConfiguracao,
  PedidoLote,
  PedidoPrerequisito,
  PrerequisitoRecurso,
  RetiradaParametro,
  TrilhaConfig,
} from './configuracao-fonte.js';
import { ErroProblema } from '../../problema.filter.js';

/** O que a fonte usa do NucleoProprio (os testes trocam). */
export interface NucleoConfiguracao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** Teto da leitura das chaves de um estabelecimento. */
export const TETO_CHAVES = 5000;
const TETO_PARAMETROS = 2000;

const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);
const boolOuNull = (v: unknown): boolean | null =>
  v === null || v === undefined ? null : v === true || Number(v) === 1;
const dia = (v: unknown): string | null =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : txt(v);

// ── Leitura ───────────────────────────────────────────────────────────────────────────────────────

const COLUNAS_CHAVE = `c.id, c.tipo, c.chave, c.escopo, c.valor, c.ligada, c.ligada_antes, c.versao, l.numero AS lote,
  l.justificativa, COALESCE(ua.login, uc.login) AS alterado_por, COALESCE(c.alterado_em, c.criado_em) AS alterado_em
  FROM liberacao_chave c
  LEFT JOIN liberacao_lote l ON l.id = c.liberacao_lote_id
  LEFT JOIN usuario ua ON ua.id = c.alterado_por
  LEFT JOIN usuario uc ON uc.id = c.criado_por`;

function paraChave(r: Linha): ChaveLiberacao {
  return {
    id: String(r['id']),
    tipo: r['tipo'] === 'recurso' ? 'recurso' : 'operacao',
    chave: String(r['chave']),
    escopo: String(r['escopo']) as ChaveLiberacao['escopo'],
    valor: String(r['valor']),
    ligada: boolOuNull(r['ligada']),
    ligadaAntes: boolOuNull(r['ligada_antes']),
    lote: txt(r['lote']),
    justificativa: txt(r['justificativa']),
    alteradoPor: txt(r['alterado_por']) ?? '',
    alteradoEm: iso(r['alterado_em']) ?? '',
  };
}

const COLUNAS_PREREQUISITO = `p.recurso, p.tipo, p.situacao, p.validade, p.evidencia, p.versao,
  COALESCE(ua.login, uc.login) AS alterado_por, COALESCE(p.alterado_em, p.criado_em) AS alterado_em
  FROM recurso_prerequisito p
  LEFT JOIN usuario ua ON ua.id = p.alterado_por
  LEFT JOIN usuario uc ON uc.id = p.criado_por`;

function paraPrerequisito(r: Linha): PrerequisitoRecurso {
  return {
    recurso: String(r['recurso']),
    tipo: String(r['tipo']) as PrerequisitoRecurso['tipo'],
    situacao: String(r['situacao']) as PrerequisitoRecurso['situacao'],
    validade: dia(r['validade']),
    evidencia: txt(r['evidencia']),
    alteradoPor: txt(r['alterado_por']) ?? '',
    alteradoEm: iso(r['alterado_em']) ?? '',
  };
}

/** Alvo do nível como a tela o vê: código da rede, do estabelecimento, id da unidade, código do perfil ou login. */
function alvoDoValor(r: Linha, rede: string): string {
  switch (r['nivel']) {
    case 'rede':
      return rede;
    case 'estabelecimento':
      return txt(r['estabelecimento_codigo']) ?? '';
    case 'unidade':
      return txt(r['unidade_assistencial_id']) ?? '';
    case 'perfil':
      return txt(r['perfil_codigo']) ?? '';
    default:
      return txt(r['usuario_login']) ?? '';
  }
}

// ── Entradas das operações (o que vai ao hash de idempotência) ───────────────────────────────────────

const NIVEIS_DO_MODELO = ['rede', 'estabelecimento', 'unidade', 'perfil', 'usuario'] as const;
type NivelModelo = (typeof NIVEIS_DO_MODELO)[number];

const esquemaEscopoParametro = z.object({
  chave: z.string().min(1).max(100),
  nivel: z.enum(NIVEIS_DO_MODELO),
  alvo: z.string().max(120),
  fechar: z.array(z.string().regex(/^\d{1,20}$/)).max(100),
});
const esquemaDefinicao = esquemaEscopoParametro.extend({
  valor: z.string().max(65_000),
  justificativa: z.string().trim().min(1).max(500),
  reautenticado: z.boolean(),
});
const esquemaRetirada = esquemaEscopoParametro.extend({ motivo: z.string().trim().min(1).max(500) });
const esquemaLotes = z.object({
  pedidos: z
    .array(
      z.object({
        tipo: z.enum(['operacao', 'recurso']),
        chave: z.string().min(1).max(120),
        justificativa: z.string().trim().min(1).max(500),
        referenciaAutorizacao: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(10),
});
const esquemaPrerequisito = z.object({
  recurso: z.string().min(1).max(120),
  tipo: z.enum(['certificado', 'credenciamento', 'contrato', 'aprovacao']),
  situacao: z.enum(['pendente', 'cumprido', 'dispensado']),
  validade: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  evidencia: z.string().max(200).nullable(),
});

const MENSAGEM_CONCORRENCIA =
  'O parâmetro foi alterado por outra pessoa neste nível e alvo enquanto você editava. Releia e tente de novo.';

function nivelDoModelo(n: NivelParametro): NivelModelo {
  if ((NIVEIS_DO_MODELO as readonly string[]).includes(n)) return n as NivelModelo;
  throw new ErroProblema(
    'entrada-invalida',
    422,
    'Nível não aceito',
    'Este nível não existe no cadastro de parâmetros do produto.',
    { codigo: 'nivel-invalido' },
  );
}

interface Escopo {
  readonly estabelecimento: number | null;
  readonly unidade: number | null;
  readonly perfil: number | null;
  readonly usuario: number | null;
}

/** Mesma fórmula da coluna gerada parametro_valor.escopo_chave (apoio à unicidade do escopo). */
function escopoChave(nivel: NivelModelo, e: Escopo): string {
  return [nivel, e.estabelecimento ?? 0, e.unidade ?? 0, e.perfil ?? 0, e.usuario ?? 0].join(':');
}

/** Resolve o alvo do nível em ids, conferidos no banco e no estabelecimento da sessão. */
async function escopoDoAlvo(
  l: Leitor,
  nivel: NivelModelo,
  alvo: string,
  estabelecimento: number,
  hospital: string,
): Promise<Escopo> {
  const recusarAlvo = (): never => {
    throw recusa('alvo-inexistente', 'O alvo do nível não existe neste estabelecimento.');
  };
  switch (nivel) {
    case 'rede':
      // Vale para o cliente inteiro: a linha não tem estabelecimento (regra do CHECK do escopo).
      return { estabelecimento: null, unidade: null, perfil: null, usuario: null };
    case 'estabelecimento':
      if (alvo !== hospital) recusarAlvo();
      return { estabelecimento, unidade: null, perfil: null, usuario: null };
    case 'unidade': {
      const id = /^\d{1,18}$/.test(alvo) ? Number(alvo) : 0;
      const u = id
        ? await l.uma(
            'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [id, estabelecimento],
          )
        : null;
      if (!u) recusarAlvo();
      return { estabelecimento, unidade: id, perfil: null, usuario: null };
    }
    case 'perfil': {
      const p = await l.uma<{ id: number }>(
        `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
           AND excluido_em IS NULL ORDER BY estabelecimento_id IS NULL LIMIT 1`,
        [alvo, estabelecimento],
      );
      if (!p) recusarAlvo();
      return { estabelecimento, unidade: null, perfil: Number(p!.id), usuario: null };
    }
    default: {
      const u = await l.uma<{ id: number }>(
        'SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL',
        [alvo],
      );
      if (!u) recusarAlvo();
      return { estabelecimento, unidade: null, perfil: null, usuario: Number(u!.id) };
    }
  }
}

interface VigenteTravada {
  readonly id: number;
  readonly versao: number;
  readonly valor: string;
}

/** Trava as vigentes do nível e do alvo e confere que são exatamente as que o plano fecha. */
async function travarVigentes(
  tx: TxOperacao,
  definicao: number,
  chaveEscopo: string,
  fechar: readonly string[],
  exigirAlguma: boolean,
): Promise<VigenteTravada[]> {
  const vigentes = (
    await tx.consultarParaAtualizar(
      `SELECT id, versao, valor FROM parametro_valor
        WHERE parametro_definicao_id = ? AND escopo_chave = ? AND vigencia_fim IS NULL`,
      [definicao, chaveEscopo],
      { teto: 100 },
    )
  ).map((r) => ({ id: Number(r['id']), versao: Number(r['versao']), valor: String(r['valor'] ?? '') }));
  const esperadas = new Set(fechar);
  if (
    (exigirAlguma && fechar.length === 0) ||
    vigentes.length !== esperadas.size ||
    vigentes.some((v) => !esperadas.has(String(v.id)))
  )
    throw recusa('conflito-concorrente', MENSAGEM_CONCORRENCIA);
  return vigentes;
}

async function definicaoDoParametro(tx: TxOperacao, chave: string): Promise<number> {
  const d = await tx.uma<{ id: number }>(
    'SELECT id FROM parametro_definicao WHERE chave = ? AND ativo',
    [chave],
  );
  if (!d)
    throw recusa(
      'parametro-nao-carregado',
      'O parâmetro ainda não está no cadastro de parâmetros deste cliente. Carregue o catálogo e tente de novo.',
    );
  return Number(d.id);
}

async function agoraDoBanco(l: Leitor): Promise<Date> {
  const r = await l.uma<{ agora: Date }>('SELECT NOW(3) AS agora');
  const h = r?.agora;
  if (!(h instanceof Date)) throw new Error('Relógio do banco ilegível.');
  return h;
}

// ── A fonte ───────────────────────────────────────────────────────────────────────────────────────

/** As tabelas que a fonte lê e grava (a montagem confere com `FonteConfiguracaoPropria.conferirModelo`). */
export const TABELAS_DA_FONTE = [
  'parametro_definicao',
  'parametro_valor',
  'parametro_valor_historico',
  'liberacao_chave',
  'liberacao_lote',
  'recurso_prerequisito',
  'sequencia_negocio',
] as const;

export class FonteConfiguracaoPropria implements FonteConfiguracao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoConfiguracao,
    /** Código do cliente na plataforma (o banco é cliente_<codigo>). */
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  /**
   * Confere, na montagem do módulo, que o banco do cliente tem as tabelas que a fonte lê e grava. Sem elas a fonte
   * não pode ser registrada: as chaves de liberação falhariam a cada chamada (e a tela mostraria "só consulta"). Recusa
   * com a lista das tabelas que faltam (só nomes).
   */
  static async conferirModelo(nucleo: Pick<NucleoConfiguracao, 'lerSomente'>, cliente: string): Promise<void> {
    const presentes = await nucleo.lerSomente({ cliente, correlacao: 'config-modelo' }, (l) =>
      l.consultar<{ t: string }>(
        `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${TABELAS_DA_FONTE.map(() => '?').join(', ')})`,
        [...TABELAS_DA_FONTE],
      ),
    );
    const tem = new Set(presentes.map((x) => x.t));
    const faltam = TABELAS_DA_FONTE.filter((t) => !tem.has(t));
    if (faltam.length > 0)
      throw new Error(`configuração por estabelecimento sem as tabelas do modelo: ${faltam.join(', ')}`);
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>, correlacao = 'config-propria'): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao }, fn);
  }

  /** Id do estabelecimento ativo pelo código da sessão (404 quando não existe ou foi excluído). */
  private async estabelecimento(l: Leitor, hospital: string): Promise<number> {
    const e = await l.uma<{ id: number }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [hospital],
    );
    if (!e) throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento não encontrado');
    return Number(e.id);
  }

  /** Contexto da gravação: estabelecimento e usuário resolvidos no banco; idempotência da requisição. */
  private async contexto(hospital: string, t: TrilhaConfig): Promise<ContextoOperacao> {
    return this.ler(async (l) => {
      const estabelecimento = await this.estabelecimento(l, hospital);
      let usuario: number | null = null;
      if (t.usuarioId && /^\d{1,18}$/.test(t.usuarioId)) usuario = Number(t.usuarioId);
      else if (t.usuario) {
        const u = await l.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [t.usuario]);
        usuario = u ? Number(u.id) : null;
      }
      const chave =
        t.chaveIdempotencia && FORMATO_CHAVE_IDEMPOTENCIA.test(t.chaveIdempotencia)
          ? t.chaveIdempotencia
          : randomUUID();
      return {
        cliente: this.cliente,
        estabelecimento,
        usuario,
        correlacao: (t.correlacao || 'config').slice(0, 64),
        chaveIdempotencia: chave,
        ...(t.enderecoIp ? { enderecoIp: t.enderecoIp } : {}),
      };
    }, t.correlacao);
  }

  /** O relógio do banco (o mesmo para a rede e para o estabelecimento: um banco por cliente). */
  relogio(rede?: string, hospital?: string): Promise<Date> {
    void rede;
    void hospital;
    return this.ler((l) => agoraDoBanco(l));
  }

  /** Valores vigentes e fechados do estabelecimento (mais os de nível rede, que valem para o cliente inteiro). */
  valoresParametro(rede: string, hospital: string): Promise<ValorParametro[]> {
    return this.ler(async (l) => {
      const est = await this.estabelecimento(l, hospital);
      const linhas = await l.consultar(
        `SELECT pv.id, pd.chave, pv.nivel, e.codigo AS estabelecimento_codigo, pv.unidade_assistencial_id,
                pa.codigo AS perfil_codigo, u.login AS usuario_login, pv.valor, pv.vigencia_inicio, pv.vigencia_fim,
                pv.motivo, autor.login AS autor, h.motivo AS retirada_motivo, hu.login AS retirada_por
           FROM parametro_valor pv
           JOIN parametro_definicao pd ON pd.id = pv.parametro_definicao_id
           LEFT JOIN estabelecimento e ON e.id = pv.estabelecimento_id
           LEFT JOIN perfil_acesso pa ON pa.id = pv.perfil_acesso_id
           LEFT JOIN usuario u ON u.id = pv.usuario_id
           LEFT JOIN usuario autor ON autor.id = pv.criado_por
           LEFT JOIN parametro_valor_historico h ON h.parametro_valor_id = pv.id AND h.operacao = 'exclusao'
           LEFT JOIN usuario hu ON hu.id = h.usuario_id
          WHERE pv.nivel = 'rede' OR pv.estabelecimento_id = ?
          ORDER BY pv.id DESC LIMIT ${TETO_PARAMETROS}`,
        [est],
        { teto: TETO_PARAMETROS },
      );
      return linhas.map(
        (r): ValorParametro => ({
          id: String(r['id']),
          chave: String(r['chave']),
          nivel: String(r['nivel']) as NivelParametro,
          alvo: alvoDoValor(r, rede),
          valor: String(r['valor'] ?? ''),
          vigenteDesde: iso(r['vigencia_inicio']) ?? '',
          vigenteAte: iso(r['vigencia_fim']),
          justificativa: txt(r['motivo']) ?? '',
          autor: txt(r['autor']) ?? '',
          retiradaPor: txt(r['retirada_por']),
          retiradaMotivo: txt(r['retirada_motivo']),
        }),
      );
    });
  }

  async definirParametro(d: DefinicaoValorParametro, t: TrilhaConfig) {
    const ctx = await this.contexto(d.hospital, t);
    const hospital = d.hospital;
    const op = definirOperacao({
      nome: 'config.parametro.definir',
      tabelas: ['parametro_valor', 'parametro_valor_historico'],
      entrada: esquemaDefinicao,
      async gravar(tx, e, c) {
        const definicao = await definicaoDoParametro(tx, e.chave);
        const escopo = await escopoDoAlvo(tx, e.nivel, e.alvo, c.estabelecimento!, hospital);
        const vigentes = await travarVigentes(tx, definicao, escopoChave(e.nivel, escopo), e.fechar, false);
        const agora = await agoraDoBanco(tx);
        for (const v of vigentes) await tx.alterar('parametro_valor', v.id, v.versao, { vigencia_fim: agora });
        const id = await tx.incluir('parametro_valor', {
          parametro_definicao_id: definicao,
          nivel: e.nivel,
          estabelecimento_id: escopo.estabelecimento,
          unidade_assistencial_id: escopo.unidade,
          perfil_acesso_id: escopo.perfil,
          usuario_id: escopo.usuario,
          valor: e.valor,
          vigencia_inicio: agora,
          motivo: e.justificativa,
        });
        await tx.incluir('parametro_valor_historico', {
          parametro_valor_id: id,
          operacao: 'inclusao',
          valor_anterior: vigentes[0]?.valor ?? null,
          valor_novo: e.valor,
          motivo: e.justificativa,
          reautenticado: e.reautenticado,
          endereco_ip: c.enderecoIp ?? null,
          ocorrido_em: agora,
          usuario_id: c.usuario,
        });
        return { id: String(id) };
      },
      alvo: (_e, r) => ({ tabela: 'parametro_valor', id: Number(r.id) }),
      trilha: (e) => ({ motivo: e.justificativa, dados: { chave: e.chave, nivel: e.nivel } }),
    });
    const r = await this.executor.executar(op, this.cliente, {
      chave: d.nova.chave,
      nivel: nivelDoModelo(d.nova.nivel),
      alvo: d.nova.alvo,
      fechar: [...d.fechar],
      valor: d.nova.valor,
      justificativa: d.nova.justificativa,
      reautenticado: d.reautenticado === true,
    }, ctx);
    return { id: r.resultado.id };
  }

  async retirarParametro(d: RetiradaParametro, t: TrilhaConfig) {
    const ctx = await this.contexto(d.hospital, t);
    const hospital = d.hospital;
    const op = definirOperacao({
      nome: 'config.parametro.retirar',
      tabelas: ['parametro_valor', 'parametro_valor_historico'],
      entrada: esquemaRetirada,
      async gravar(tx, e, c) {
        const definicao = await definicaoDoParametro(tx, e.chave);
        const escopo = await escopoDoAlvo(tx, e.nivel, e.alvo, c.estabelecimento!, hospital);
        const vigentes = await travarVigentes(tx, definicao, escopoChave(e.nivel, escopo), e.fechar, true);
        const agora = await agoraDoBanco(tx);
        for (const v of vigentes) {
          await tx.alterar('parametro_valor', v.id, v.versao, { vigencia_fim: agora });
          await tx.incluir('parametro_valor_historico', {
            parametro_valor_id: v.id,
            operacao: 'exclusao',
            valor_anterior: v.valor,
            valor_novo: null,
            motivo: e.motivo,
            endereco_ip: c.enderecoIp ?? null,
            ocorrido_em: agora,
            usuario_id: c.usuario,
          });
        }
        return { fechadas: vigentes.map((v) => String(v.id)).join(',') };
      },
      alvo: (_e, r) => ({ tabela: 'parametro_valor', id: Number(r.fechadas.split(',')[0]) || null }),
      trilha: (e) => ({ acao: 'alteracao', motivo: e.motivo, dados: { chave: e.chave, nivel: e.nivel } }),
    });
    const r = await this.executor.executar(op, this.cliente, {
      chave: d.chave,
      nivel: nivelDoModelo(d.nivel),
      alvo: d.alvo,
      fechar: [...d.fechar],
      motivo: d.motivo,
    }, ctx);
    return { fechadas: r.resultado.fechadas.split(',').filter(Boolean) };
  }

  chaves(_rede: string, hospital: string): Promise<ChaveLiberacao[]> {
    return this.ler(async (l) => {
      const est = await this.estabelecimento(l, hospital);
      // A linha que herda (ligada nula) não decide em nível nenhum: fica fora da leitura (não ocupa o teto).
      const linhas = await l.consultar(
        `SELECT ${COLUNAS_CHAVE} WHERE c.estabelecimento_id = ? AND c.ligada IS NOT NULL
          ORDER BY c.chave, c.escopo, c.valor LIMIT ${TETO_CHAVES}`,
        [est],
        { teto: TETO_CHAVES },
      );
      return linhas.map(paraChave);
    });
  }

  lote(_rede: string, hospital: string, lote: string): Promise<ChaveLiberacao[]> {
    if (!/^\d{1,18}$/.test(lote)) return Promise.resolve([]);
    return this.ler(async (l) => {
      const est = await this.estabelecimento(l, hospital);
      const linhas = await l.consultar(
        `SELECT ${COLUNAS_CHAVE} WHERE c.estabelecimento_id = ? AND l.estabelecimento_id = ? AND l.numero = ?
          ORDER BY c.escopo, c.valor LIMIT 1000`,
        [est, est, Number(lote)],
        { teto: 1000 },
      );
      return linhas.map(paraChave);
    });
  }

  prerequisitos(_rede: string, hospital: string): Promise<PrerequisitoRecurso[]> {
    return this.ler(async (l) => {
      const est = await this.estabelecimento(l, hospital);
      const linhas = await l.consultar(
        `SELECT ${COLUNAS_PREREQUISITO} WHERE p.estabelecimento_id = ? ORDER BY p.recurso, p.tipo LIMIT 2000`,
        [est],
        { teto: 2000 },
      );
      return linhas.map(paraPrerequisito);
    });
  }

  aplicarLote(rede: string, p: PedidoLote, t: TrilhaConfig) {
    return this.aplicarLotes(rede, [p], t).then((r) => r[0] ?? { lote: '', alteradas: 0 });
  }

  async aplicarLotes(_rede: string, pedidos: readonly PedidoLote[], t: TrilhaConfig) {
    const hospital = pedidos[0]?.hospital ?? t.hospital;
    if (pedidos.some((p) => p.hospital !== hospital))
      throw new Error('Lotes de estabelecimentos diferentes na mesma transação.');
    const ctx = await this.contexto(hospital, t);
    // A recusa decidida pelo plano (ErroProblema da tela) volta como foi lançada, depois do ROLLBACK.
    let recusaDoPlano: unknown = null;
    const op = definirOperacao({
      nome: 'config.liberacao.aplicar',
      tabelas: ['liberacao_chave', 'liberacao_lote', 'sequencia_negocio'],
      entrada: esquemaLotes,
      async gravar(tx, e, c) {
        const est = c.estabelecimento!;
        const r: { lote: string; alteradas: number }[] = [];
        for (const [i, pe] of e.pedidos.entries()) {
          const pedido = pedidos[i]!;
          const todas = (
            await tx.consultarParaAtualizar(
              `SELECT ${COLUNAS_CHAVE} WHERE c.estabelecimento_id = ? AND c.chave = ?`,
              [est, pe.chave],
              { teto: 1000 },
            )
          ).map((x) => ({ chave: paraChave(x), versao: Number(x['versao']) }));
          if (todas.some((x) => x.chave.tipo !== pe.tipo))
            throw recusa(
              'chave-de-outro-tipo',
              'Já existe uma chave com este nome de outro tipo (operação × recurso). Use outro nome.',
            );
          const prerequisitos =
            pe.tipo === 'recurso'
              ? (
                  await tx.consultarParaAtualizar(
                    `SELECT ${COLUNAS_PREREQUISITO} WHERE p.estabelecimento_id = ? AND p.recurso = ?`,
                    [est, pe.chave],
                    { teto: 100 },
                  )
                ).map(paraPrerequisito)
              : [];
          const estado: EstadoDoLote = { chaves: todas.map((x) => x.chave), prerequisitos };
          let mudancas;
          try {
            mudancas = pedido.planejar(estado);
          } catch (erro) {
            recusaDoPlano = erro;
            throw recusa('lote-recusado', 'O lote foi recusado pelas conferências da liberação.');
          }
          if (mudancas.length === 0) {
            r.push({ lote: '', alteradas: 0 });
            continue;
          }
          await garantirSequencia(tx, { tipo: 'liberacao_lote', estabelecimento: est }, {
            usuario: c.usuario,
            agora: new Date(),
          });
          const numero = await tx.proximoNumero('liberacao_lote');
          const loteId = await tx.incluir('liberacao_lote', {
            estabelecimento_id: est,
            numero: numero.valor,
            tipo: pe.tipo,
            chave: pe.chave,
            justificativa: pe.justificativa,
            referencia_autorizacao: pe.referenciaAutorizacao,
            alteradas: mudancas.length,
          });
          for (const m of mudancas) {
            const atual = todas.find((x) => x.chave.escopo === m.escopo && x.chave.valor === m.valor);
            const valores = { ligada: m.ligada, ligada_antes: m.antes, liberacao_lote_id: loteId };
            if (atual) await tx.alterar('liberacao_chave', Number(atual.chave.id), atual.versao, valores);
            else
              await tx.incluir('liberacao_chave', {
                estabelecimento_id: est,
                tipo: pe.tipo,
                chave: pe.chave,
                escopo: m.escopo,
                valor: m.valor,
                ...valores,
              });
          }
          r.push({ lote: String(numero.valor), alteradas: mudancas.length });
        }
        // Resultado plano (idempotência): "lote:alteradas" por pedido, na ordem.
        return { lotes: r.map((x) => `${x.lote}:${x.alteradas}`).join(',') };
      },
      alvo: () => ({ tabela: 'liberacao_lote', id: null }),
      trilha: (e, res) => ({
        dados: {
          chaves: e.pedidos.map((p) => `${p.tipo}:${p.chave}`),
          lotes: res.lotes,
        },
        motivo: e.pedidos[0]?.justificativa ?? null,
      }),
    });
    try {
      const s = await this.executor.executar(op, this.cliente, {
        pedidos: pedidos.map((p) => ({
          tipo: p.tipo,
          chave: p.chave,
          justificativa: p.justificativa,
          referenciaAutorizacao: p.referenciaAutorizacao ?? null,
        })),
      }, ctx);
      return s.resultado.lotes.split(',').map((x) => {
        const [lote = '', alteradas = '0'] = x.split(':');
        return { lote, alteradas: Number(alteradas) };
      });
    } catch (erro) {
      if (recusaDoPlano && erro instanceof ErroOperacao) throw recusaDoPlano;
      throw erro;
    }
  }

  async gravarPrerequisito(_rede: string, p: PedidoPrerequisito, t: TrilhaConfig): Promise<void> {
    const ctx = await this.contexto(p.hospital, t);
    const op = definirOperacao({
      nome: 'config.liberacao.prerequisito',
      tabelas: ['recurso_prerequisito'],
      entrada: esquemaPrerequisito,
      async gravar(tx, e, c) {
        const atual = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ? AND tipo = ?',
          [c.estabelecimento, e.recurso, e.tipo],
          { teto: 1 },
        );
        const valores = { situacao: e.situacao, validade: e.validade, evidencia: e.evidencia };
        const linha = atual[0];
        const id = linha
          ? (await tx.alterar('recurso_prerequisito', Number(linha['id']), Number(linha['versao']), valores),
            Number(linha['id']))
          : await tx.incluir('recurso_prerequisito', {
              estabelecimento_id: c.estabelecimento,
              recurso: e.recurso,
              tipo: e.tipo,
              ...valores,
            });
        return { id };
      },
      alvo: (_e, r) => ({ tabela: 'recurso_prerequisito', id: r.id }),
      trilha: (e) => ({ dados: { recurso: e.recurso, tipo: e.tipo, situacao: e.situacao } }),
    });
    await this.executor.executar(op, this.cliente, {
      recurso: p.recurso,
      tipo: p.tipo,
      situacao: p.situacao,
      validade: p.validade,
      evidencia: p.evidencia,
    }, ctx);
  }
}
