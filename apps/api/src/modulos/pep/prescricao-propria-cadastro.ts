// Cadastro editável do catálogo da prescrição no banco próprio (03-PEP L106, C1-115): frequências de administração
// (com a lista de setores onde valem: frequencia_administracao_setor), condições "se necessário", itens não
// padronizados (item_prescritivel com padronizado = false e as vias) e os complementos de qualquer item:
// frequências aceitas (item_prescritivel_frequencia), regras por setor (item_prescritivel_setor), sinônimos de busca
// (item_prescritivel_sinonimo) e pares conflitantes (item_prescritivel_conflito). A regra é do domínio
// (cadastro-catalogo.ts); aqui só a leitura e a gravação pelo executor (trilha na mesma transação). Nada é apagado:
// tirar de uso marca ativo = false ou excluido_em/excluido_por, e o histórico das prescrições continua ligado.
import {
  codigoNaoPadronizado,
  DIAS_SEMANA_FREQUENCIA,
  ESCOPOS_SETOR_FREQUENCIA,
  GRAVIDADES_CONFLITO,
  MENSAGENS_CADASTRO_CATALOGO,
  normalizarCodigoCatalogo,
  normalizarTermo,
  ORIGENS_SINONIMO,
  type ProblemaCadastro,
  problemasDaCondicao,
  problemasDaFrequencia,
  problemasDaRegraSetor,
  problemasDoConflito,
  problemasDoNaoPadronizado,
  problemasDoSinonimo,
  proximaSequenciaSinonimo,
  TIPOS_FREQUENCIA,
  USOS_FREQUENCIA,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

export const CADASTRO_CATALOGO_PRESCRICAO = Symbol('CADASTRO_CATALOGO_PRESCRICAO');

const TABELAS = [
  'frequencia_administracao',
  'frequencia_administracao_setor',
  'condicao_se_necessario',
  'item_prescritivel',
  'item_prescritivel_via',
  'item_prescritivel_frequencia',
  'item_prescritivel_setor',
  'item_prescritivel_sinonimo',
  'item_prescritivel_conflito',
] as const;

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Boolean(Number(v));
const id = z.number().int().positive();
const versao = z.number().int().positive();
const nulo = <T extends z.ZodTypeAny>(t: T) => t.nullable().default(null);

const esquemaFrequencia = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    descricaoResumida: nulo(z.string().trim().max(15)),
    tipo: z.enum(TIPOS_FREQUENCIA),
    intervaloMinutos: nulo(z.number().int().positive()),
    dosesPorDia: nulo(z.number().int().positive()),
    limiteHoras: nulo(z.number().int().positive().max(9999)),
    horarioFixo: z.boolean().default(false),
    uso: z.enum(USOS_FREQUENCIA).default('todos'),
    dias: z.array(z.enum(DIAS_SEMANA_FREQUENCIA)).max(7).default([]),
    escopoSetor: z.enum(ESCOPOS_SETOR_FREQUENCIA).default('todos'),
    setores: z.array(id).max(200).default([]),
    ativo: z.boolean().default(true),
  })
  .strict();
const esquemaCondicao = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    parametroVital: nulo(id),
    limiar: nulo(z.number()),
    ativo: z.boolean().default(true),
  })
  .strict();
const esquemaNaoPadronizado = z
  .object({
    descricao: z.string().trim().min(1).max(200),
    tipoItem: id,
    unidade: nulo(id),
    principioAtivo: nulo(id),
    vias: z.array(id).max(20),
    justificativa: z.string().trim().max(1000),
  })
  .strict();
const esquemaSituacaoItem = z.object({ versao, ativo: z.boolean() }).strict();
const esquemaComplemento = z.discriminatedUnion('tipo', [
  z
    .object({ tipo: z.literal('frequencia'), frequencia: id, usoFrequente: z.boolean().default(false) })
    .strict(),
  z
    .object({
      tipo: z.literal('setor'),
      setor: nulo(id),
      local: nulo(id),
      padronizado: z.boolean().default(true),
      usoRestrito: z.boolean().default(false),
      bloqueado: z.boolean().default(false),
      motivoBloqueio: nulo(z.string().trim().max(200)),
      via: nulo(id),
      frequencia: nulo(id),
      quantidadePadrao: nulo(z.number()),
      dosePadrao: nulo(z.number()),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('sinonimo'),
      termo: z.string().max(200),
      origemTermo: z.enum(ORIGENS_SINONIMO).default('apelido'),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('conflito'),
      conflitante: id,
      gravidade: z.enum(GRAVIDADES_CONFLITO).default('impeditivo'),
      motivo: nulo(z.string().trim().max(300)),
    })
    .strict(),
]);
const esquemaRetirada = z
  .object({ tipo: z.enum(['frequencia', 'setor', 'sinonimo', 'conflito']), id, versao })
  .strict();

export type EntradaFrequenciaApi = z.infer<typeof esquemaFrequencia>;
export type EntradaCondicaoApi = z.infer<typeof esquemaCondicao>;
export type EntradaNaoPadronizadoApi = z.infer<typeof esquemaNaoPadronizado>;
export type EntradaComplementoApi = z.infer<typeof esquemaComplemento>;
export const ESQUEMAS_CADASTRO_CATALOGO = {
  frequencia: esquemaFrequencia,
  condicao: esquemaCondicao,
  naoPadronizado: esquemaNaoPadronizado,
  situacaoItem: esquemaSituacaoItem,
  complemento: esquemaComplemento,
  retirada: esquemaRetirada,
} as const;

/** A tabela de cada complemento e se ele se retira por excluido_em (os outros por ativo = false). */
const TABELA_DO_COMPLEMENTO = {
  frequencia: 'item_prescritivel_frequencia',
  setor: 'item_prescritivel_setor',
  sinonimo: 'item_prescritivel_sinonimo',
  conflito: 'item_prescritivel_conflito',
} as const;

export interface ContextoCadastroCatalogo {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoCatalogo = ContextoCadastroCatalogo & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};
export type Gravado = { readonly id: number; readonly versao: number };

export interface NucleoCadastroCatalogo {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const recusar = (ps: readonly ProblemaCadastro[], status = 422): never => {
  const p = ps[0]!;
  throw new ErroOperacao(
    status,
    p.codigo,
    'Cadastro recusado',
    ps.map((x) => MENSAGENS_CADASTRO_CATALOGO[x.codigo] ?? x.codigo).join(' '),
    { campos: [p.campo] },
  );
};
const inexistente = (o: string): ErroOperacao =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrado`, `${o} não existe neste cliente.`);

export class CadastroCatalogoPrescricaoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  constructor(
    private readonly nucleo: NucleoCadastroCatalogo,
    private readonly cliente: string,
  ) {}

  // ── leitura ───────────────────────────────────────────────────────────────────────────────────

  private ler<T>(c: ContextoCadastroCatalogo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.catalogo.cadastro' },
      async (l) => {
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
        return fn(l, num(e['id']));
      },
    );
  }

  /** As opções dos combos do cadastro: setores do estabelecimento, vias, unidades, tipos, parâmetros vitais, frequências. */
  apoio(c: ContextoCadastroCatalogo) {
    return this.ler(c, async (l, est) => {
      const op = (sql: string, p: unknown[] = []) =>
        l
          .consultar(sql, p, { teto: 5000 })
          .then((ls) => ls.map((x) => ({ id: num(x['id']), nome: String(x['nome']) })));
      const [setores, vias, unidades, tipos, parametros, frequencias] = await Promise.all([
        op(
          `SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome, id`,
          [est],
        ),
        op('SELECT id, descricao AS nome FROM via_de_uso WHERE ativo ORDER BY descricao, id'),
        op(
          `SELECT id, CONCAT(sigla, ' · ', descricao) AS nome FROM unidade_prescricao
            WHERE ativo AND permite_prescricao ORDER BY sigla, id`,
        ),
        op('SELECT id, descricao AS nome FROM tipo_item_prescricao WHERE ativo ORDER BY descricao, id'),
        op('SELECT id, descricao AS nome FROM parametro_vital WHERE ativo ORDER BY descricao, id'),
        op(
          'SELECT id, descricao AS nome FROM frequencia_administracao WHERE ativo ORDER BY ordem, descricao, id',
        ),
      ]);
      return { setores, vias, unidades, tipos, parametros, frequencias };
    });
  }

  frequencias(c: ContextoCadastroCatalogo) {
    return this.ler(c, async (l) => {
      const fs = await l.consultar(
        `SELECT id, versao, codigo, descricao, descricao_resumida, tipo, intervalo_minutos, doses_por_dia,
                limite_horas, horario_fixo, uso_prescricao, escopo_setor, ativo,
                domingo, segunda, terca, quarta, quinta, sexta, sabado
           FROM frequencia_administracao ORDER BY ativo DESC, ordem, descricao, id`,
        [],
        { teto: 5000 },
      );
      const ss = await l.consultar(
        `SELECT frequencia_administracao_id AS f, setor_funcional_id AS s FROM frequencia_administracao_setor
          WHERE excluido_em IS NULL ORDER BY id`,
        [],
        { teto: 100_000 },
      );
      return fs.map((x) => ({
        id: num(x['id']),
        versao: num(x['versao']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        descricaoResumida: txt(x['descricao_resumida']),
        tipo: String(x['tipo']),
        intervaloMinutos: numOuNull(x['intervalo_minutos']),
        dosesPorDia: numOuNull(x['doses_por_dia']),
        limiteHoras: numOuNull(x['limite_horas']),
        horarioFixo: bool(x['horario_fixo']),
        uso: String(x['uso_prescricao']),
        escopoSetor: String(x['escopo_setor']),
        ativo: bool(x['ativo']),
        dias: DIAS_SEMANA_FREQUENCIA.filter((d) => bool(x[d])),
        setores: ss.filter((s) => num(s['f']) === num(x['id'])).map((s) => num(s['s'])),
      }));
    });
  }

  condicoes(c: ContextoCadastroCatalogo) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT c.id, c.versao, c.codigo, c.descricao, c.ativo, c.parametro_vital_id, c.limiar,
                  pv.descricao AS parametro
             FROM condicao_se_necessario c LEFT JOIN parametro_vital pv ON pv.id = c.parametro_vital_id
            ORDER BY c.ativo DESC, c.descricao, c.id`,
          [],
          { teto: 5000 },
        )
      ).map((x) => ({
        id: num(x['id']),
        versao: num(x['versao']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        ativo: bool(x['ativo']),
        parametroVital: numOuNull(x['parametro_vital_id']),
        parametro: txt(x['parametro']),
        limiar: numOuNull(x['limiar']),
      })),
    );
  }

  /** Os complementos de um item (os retirados não aparecem; a trilha guarda quando e por quem saíram). */
  complementos(c: ContextoCadastroCatalogo, item: number) {
    return this.ler(c, async (l, est) => {
      const i = await l.uma(
        'SELECT id, versao, descricao, padronizado, ativo FROM item_prescritivel WHERE id = ? AND excluido_em IS NULL',
        [item],
      );
      if (!i) throw inexistente('O item');
      const [frequencias, setores, sinonimos, conflitos] = await Promise.all([
        l.consultar(
          `SELECT x.id, x.versao, x.frequencia_administracao_id AS frequencia, f.descricao AS nome, x.uso_frequente
             FROM item_prescritivel_frequencia x JOIN frequencia_administracao f ON f.id = x.frequencia_administracao_id
            WHERE x.item_prescritivel_id = ? AND x.excluido_em IS NULL ORDER BY f.descricao, x.id`,
          [item],
        ),
        l.consultar(
          `SELECT x.id, x.versao, x.setor_funcional_id AS setor, s.nome, x.padronizado, x.uso_restrito, x.bloqueado,
                  x.motivo_bloqueio, x.via_de_uso_id AS via, x.frequencia_administracao_id AS frequencia,
                  x.quantidade_padrao, x.dose_padrao
             FROM item_prescritivel_setor x LEFT JOIN setor_funcional s ON s.id = x.setor_funcional_id
            WHERE x.item_prescritivel_id = ? AND x.estabelecimento_id = ? AND x.ativo ORDER BY s.nome, x.id`,
          [item, est],
        ),
        l.consultar(
          `SELECT id, versao, sequencia, termo, origem_termo FROM item_prescritivel_sinonimo
            WHERE item_prescritivel_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
          [item],
        ),
        l.consultar(
          `SELECT x.id, x.versao, x.item_prescritivel_id AS a, x.conflitante_item_prescritivel_id AS b, x.gravidade,
                  x.motivo, ia.descricao AS nome_a, ib.descricao AS nome_b
             FROM item_prescritivel_conflito x
             JOIN item_prescritivel ia ON ia.id = x.item_prescritivel_id
             JOIN item_prescritivel ib ON ib.id = x.conflitante_item_prescritivel_id
            WHERE (x.item_prescritivel_id = ? OR x.conflitante_item_prescritivel_id = ?) AND x.excluido_em IS NULL
            ORDER BY x.id`,
          [item, item],
        ),
      ]);
      return {
        item: {
          id: num(i['id']),
          versao: num(i['versao']),
          descricao: String(i['descricao']),
          padronizado: bool(i['padronizado']),
          ativo: bool(i['ativo']),
        },
        frequencias: frequencias.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          frequencia: num(x['frequencia']),
          nome: String(x['nome']),
          usoFrequente: bool(x['uso_frequente']),
        })),
        setores: setores.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          setor: numOuNull(x['setor']),
          nome: txt(x['nome']),
          padronizado: bool(x['padronizado']),
          usoRestrito: bool(x['uso_restrito']),
          bloqueado: bool(x['bloqueado']),
          motivoBloqueio: txt(x['motivo_bloqueio']),
          via: numOuNull(x['via']),
          frequencia: numOuNull(x['frequencia']),
          quantidadePadrao: numOuNull(x['quantidade_padrao']),
          dosePadrao: numOuNull(x['dose_padrao']),
        })),
        sinonimos: sinonimos.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          sequencia: num(x['sequencia']),
          termo: String(x['termo']),
          origemTermo: String(x['origem_termo']),
        })),
        conflitos: conflitos.map((x) => {
          const outroEhB = num(x['a']) === item;
          return {
            id: num(x['id']),
            versao: num(x['versao']),
            conflitante: num(outroEhB ? x['b'] : x['a']),
            nome: String(outroEhB ? x['nome_b'] : x['nome_a']),
            gravidade: String(x['gravidade']),
            motivo: txt(x['motivo']),
          };
        }),
      };
    });
  }

  // ── gravação ──────────────────────────────────────────────────────────────────────────────────

  private async contexto(c: ContextoGravacaoCatalogo): Promise<ContextoOperacao> {
    const q = await this.ler(c, async (l, est) => {
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { est, usuario: u ? num(u['id']) : null };
    });
    if (q.usuario === null)
      throw new ErroOperacao(
        422,
        'usuario-sem-conta',
        'Cadastro recusado',
        'A gravação exige uma conta do cliente.',
      );
    return {
      cliente: this.cliente,
      estabelecimento: q.est,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  private async executar<E>(
    c: ContextoGravacaoCatalogo,
    nome: string,
    tabela: string,
    esquema: z.ZodType<E>,
    entrada: unknown,
    fn: (tx: TxOperacao, e: E, est: number) => Promise<Gravado>,
  ): Promise<Gravado> {
    const ctx = await this.contexto(c);
    const op = definirOperacao<E, Gravado>({
      nome,
      tabelas: TABELAS,
      entrada: esquema,
      gravar: (tx, e) => fn(tx, e, Number(ctx.estabelecimento)),
      alvo: (_e, r) => ({ tabela, id: r.id }),
    });
    return (await this.executor.executar(op, this.cliente, entrada, ctx)).resultado;
  }

  /** Marca a linha como excluída (autor e hora), sem apagar. */
  private static async retirar(tx: TxOperacao, tabela: string, linha: number, v: number): Promise<Gravado> {
    return {
      id: linha,
      versao: await tx.alterar(tabela, linha, v, {
        excluido_em: new Date(),
        excluido_por: tx.contexto.usuario,
      }),
    };
  }

  /** Inclui ou altera a frequência (com a versão lida) e acerta a lista de setores (sai marcando excluído). */
  gravarFrequencia(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.catalogo.frequencia',
      'frequencia_administracao',
      esquemaFrequencia as unknown as z.ZodType<EntradaFrequenciaApi>,
      entrada,
      async (tx, e) => {
        const ps = problemasDaFrequencia(e);
        if (ps.length) recusar(ps);
        const codigo = normalizarCodigoCatalogo(e.codigo);
        const mesmo = await tx.uma('SELECT id FROM frequencia_administracao WHERE codigo = ? AND id <> ?', [
          codigo,
          e.id ?? 0,
        ]);
        if (mesmo) recusar([{ codigo: 'codigo-repetido', campo: 'codigo' }], 409);
        if (e.setores.length) {
          const ok = await tx.consultar(
            `SELECT COUNT(*) AS n FROM setor_funcional WHERE id IN (${e.setores.map(() => '?').join(',')})
                AND excluido_em IS NULL`,
            [...e.setores],
          );
          if (num(ok[0]?.['n']) !== e.setores.length) throw inexistente('O setor');
        }
        const valores = {
          codigo,
          descricao: e.descricao,
          descricao_resumida: e.descricaoResumida,
          tipo: e.tipo,
          intervalo_minutos: e.intervaloMinutos,
          doses_por_dia: e.dosesPorDia,
          limite_horas: e.limiteHoras,
          horario_fixo: e.horarioFixo,
          uso_prescricao: e.uso,
          escopo_setor: e.escopoSetor,
          ativo: e.ativo,
          ...Object.fromEntries(
            DIAS_SEMANA_FREQUENCIA.map((d) => [d, e.tipo === 'dias_semana' ? e.dias.includes(d) : true]),
          ),
        };
        let r: Gravado;
        if (e.id) {
          if (!e.versao) recusar([{ codigo: 'versao-obrigatoria', campo: 'versao' }], 400);
          const f = await tx.uma('SELECT id FROM frequencia_administracao WHERE id = ?', [e.id]);
          if (!f) throw inexistente('A frequência');
          r = { id: e.id, versao: await tx.alterar('frequencia_administracao', e.id, e.versao!, valores) };
        } else r = { id: await tx.incluir('frequencia_administracao', valores), versao: 1 };
        const atuais = await tx.consultarParaAtualizar(
          `SELECT id, versao, setor_funcional_id AS s, excluido_em FROM frequencia_administracao_setor
            WHERE frequencia_administracao_id = ?`,
          [r.id],
        );
        for (const a of atuais) {
          const quer = e.setores.includes(num(a['s']));
          if (!quer && a['excluido_em'] === null)
            await CadastroCatalogoPrescricaoPropria.retirar(
              tx,
              'frequencia_administracao_setor',
              num(a['id']),
              num(a['versao']),
            );
          if (quer && a['excluido_em'] !== null)
            await tx.alterar('frequencia_administracao_setor', num(a['id']), num(a['versao']), {
              excluido_em: null,
              excluido_por: null,
            });
        }
        for (const s of e.setores.filter((s) => !atuais.some((a) => num(a['s']) === s)))
          await tx.incluir('frequencia_administracao_setor', {
            frequencia_administracao_id: r.id,
            setor_funcional_id: s,
          });
        return r;
      },
    );
  }

  gravarCondicao(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.catalogo.condicao_se_necessario',
      'condicao_se_necessario',
      esquemaCondicao as unknown as z.ZodType<EntradaCondicaoApi>,
      entrada,
      async (tx, e) => {
        const ps = problemasDaCondicao(e);
        if (ps.length) recusar(ps);
        const codigo = normalizarCodigoCatalogo(e.codigo);
        if (
          await tx.uma('SELECT id FROM condicao_se_necessario WHERE codigo = ? AND id <> ?', [
            codigo,
            e.id ?? 0,
          ])
        )
          recusar([{ codigo: 'codigo-repetido', campo: 'codigo' }], 409);
        if (
          e.parametroVital &&
          !(await tx.uma('SELECT id FROM parametro_vital WHERE id = ?', [e.parametroVital]))
        )
          throw inexistente('O parâmetro vital');
        const valores = {
          codigo,
          descricao: e.descricao,
          parametro_vital_id: e.parametroVital,
          limiar: e.limiar,
          ativo: e.ativo,
        };
        if (!e.id) return { id: await tx.incluir('condicao_se_necessario', valores), versao: 1 };
        if (!e.versao) recusar([{ codigo: 'versao-obrigatoria', campo: 'versao' }], 400);
        if (!(await tx.uma('SELECT id FROM condicao_se_necessario WHERE id = ?', [e.id])))
          throw inexistente('A condição');
        return { id: e.id, versao: await tx.alterar('condicao_se_necessario', e.id, e.versao!, valores) };
      },
    );
  }

  /** Inclui o item não padronizado (código NP sequencial do cliente), com as vias e a justificativa. */
  incluirNaoPadronizado(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.catalogo.item_nao_padronizado',
      'item_prescritivel',
      esquemaNaoPadronizado as unknown as z.ZodType<EntradaNaoPadronizadoApi>,
      entrada,
      async (tx, e) => {
        const ps = problemasDoNaoPadronizado(e);
        if (ps.length) recusar(ps);
        if (!(await tx.uma('SELECT id FROM tipo_item_prescricao WHERE id = ? AND ativo', [e.tipoItem])))
          throw inexistente('O tipo de item');
        if (!(await tx.uma('SELECT id FROM unidade_prescricao WHERE id = ? AND ativo', [e.unidade])))
          throw inexistente('A unidade');
        const vs = await tx.consultar(
          `SELECT COUNT(*) AS n FROM via_de_uso WHERE ativo AND id IN (${e.vias.map(() => '?').join(',')})`,
          [...e.vias],
        );
        if (num(vs[0]?.['n']) !== e.vias.length) throw inexistente('A via');
        const m = await tx.consultarParaAtualizar(
          `SELECT MAX(CAST(SUBSTRING(codigo, 4) AS UNSIGNED)) AS n FROM item_prescritivel
            WHERE codigo LIKE 'NP-%' AND SUBSTRING(codigo, 4) REGEXP '^[0-9]+$'`,
          [],
        );
        const novo = await tx.incluir('item_prescritivel', {
          codigo: codigoNaoPadronizado(num(m[0]?.['n'] ?? 0) + 1),
          descricao: e.descricao.trim(),
          tipo_item_prescricao_id: e.tipoItem,
          unidade_prescricao_id: e.unidade,
          principio_ativo_id: e.principioAtivo,
          via_de_uso_id: e.vias[0],
          padronizado: false,
          observacao: e.justificativa.trim(),
          ativo: true,
        });
        for (const v of e.vias)
          await tx.incluir('item_prescritivel_via', { item_prescritivel_id: novo, via_de_uso_id: v });
        return { id: novo, versao: 1 };
      },
    );
  }

  /** Tira de uso ou volta o item não padronizado (ativo; nunca apaga: as prescrições feitas seguem ligadas). */
  situacaoNaoPadronizado(c: ContextoGravacaoCatalogo, item: number, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.catalogo.item_nao_padronizado.situacao',
      'item_prescritivel',
      esquemaSituacaoItem,
      entrada,
      async (tx, e) => {
        const i = await tx.uma(
          'SELECT padronizado FROM item_prescritivel WHERE id = ? AND excluido_em IS NULL',
          [item],
        );
        if (!i || bool(i['padronizado'])) throw inexistente('O item não padronizado');
        return {
          id: item,
          versao: await tx.alterar('item_prescritivel', item, e.versao, { ativo: e.ativo }),
        };
      },
    );
  }

  /** Inclui um complemento do item (frequência aceita, regra no setor, sinônimo ou par conflitante). */
  incluirComplemento(c: ContextoGravacaoCatalogo, item: number, entrada: unknown): Promise<Gravado> {
    const tipo = (entrada as { tipo?: keyof typeof TABELA_DO_COMPLEMENTO } | null)?.tipo;
    const tabela = (tipo && TABELA_DO_COMPLEMENTO[tipo]) || 'item_prescritivel';
    return this.executar(
      c,
      'pep.catalogo.item_complemento',
      tabela,
      esquemaComplemento as unknown as z.ZodType<EntradaComplementoApi>,
      entrada,
      async (tx, e, est) => {
        const i = await tx.uma(
          'SELECT id, descricao FROM item_prescritivel WHERE id = ? AND excluido_em IS NULL',
          [item],
        );
        if (!i) throw inexistente('O item');
        if (e.tipo === 'frequencia') {
          if (
            !(await tx.uma('SELECT id FROM frequencia_administracao WHERE id = ? AND ativo', [e.frequencia]))
          )
            throw inexistente('A frequência');
          const [x] = await tx.consultarParaAtualizar(
            `SELECT id, versao, excluido_em FROM item_prescritivel_frequencia
              WHERE item_prescritivel_id = ? AND frequencia_administracao_id = ?`,
            [item, e.frequencia],
          );
          if (x && x['excluido_em'] === null)
            recusar([{ codigo: 'frequencia-repetida', campo: 'frequencia' }], 409);
          if (x)
            return {
              id: num(x['id']),
              versao: await tx.alterar('item_prescritivel_frequencia', num(x['id']), num(x['versao']), {
                excluido_em: null,
                excluido_por: null,
                uso_frequente: e.usoFrequente,
              }),
            };
          const novo = await tx.incluir('item_prescritivel_frequencia', {
            item_prescritivel_id: item,
            frequencia_administracao_id: e.frequencia,
            uso_frequente: e.usoFrequente,
          });
          return { id: novo, versao: 1 };
        }
        if (e.tipo === 'setor') {
          const ps = problemasDaRegraSetor(e);
          if (ps.length) recusar(ps);
          if (
            e.setor &&
            !(await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
              e.setor,
              est,
            ]))
          )
            throw inexistente('O setor');
          const [x] = await tx.consultarParaAtualizar(
            `SELECT id, versao, ativo FROM item_prescritivel_setor
              WHERE estabelecimento_id = ? AND item_prescritivel_id = ? AND setor_funcional_id <=> ?
                AND local_atendimento_id <=> ?`,
            [est, item, e.setor, e.local],
          );
          if (x && bool(x['ativo'])) recusar([{ codigo: 'regra-repetida', campo: 'setor' }], 409);
          const valores = {
            padronizado: e.padronizado,
            uso_restrito: e.usoRestrito,
            bloqueado: e.bloqueado,
            motivo_bloqueio: e.bloqueado ? e.motivoBloqueio : null,
            via_de_uso_id: e.via,
            frequencia_administracao_id: e.frequencia,
            quantidade_padrao: e.quantidadePadrao,
            dose_padrao: e.dosePadrao,
            ativo: true,
          };
          if (x)
            return {
              id: num(x['id']),
              versao: await tx.alterar('item_prescritivel_setor', num(x['id']), num(x['versao']), valores),
            };
          const novo = await tx.incluir('item_prescritivel_setor', {
            estabelecimento_id: est,
            item_prescritivel_id: item,
            setor_funcional_id: e.setor,
            local_atendimento_id: e.local,
            ...valores,
          });
          return { id: novo, versao: 1 };
        }
        if (e.tipo === 'sinonimo') {
          const todos = await tx.consultarParaAtualizar(
            'SELECT id, versao, sequencia, termo, excluido_em FROM item_prescritivel_sinonimo WHERE item_prescritivel_id = ?',
            [item],
          );
          const ativos = todos.filter((x) => x['excluido_em'] === null).map((x) => String(x['termo']));
          const ps = problemasDoSinonimo(e.termo, String(i['descricao']), ativos);
          if (ps.length) recusar(ps, ps[0]!.codigo === 'termo-repetido' ? 409 : 422);
          const termo = normalizarTermo(e.termo);
          const antigo = todos.find((x) => String(x['termo']) === termo);
          if (antigo)
            return {
              id: num(antigo['id']),
              versao: await tx.alterar(
                'item_prescritivel_sinonimo',
                num(antigo['id']),
                num(antigo['versao']),
                {
                  excluido_em: null,
                  excluido_por: null,
                  origem_termo: e.origemTermo,
                },
              ),
            };
          const novo = await tx.incluir('item_prescritivel_sinonimo', {
            item_prescritivel_id: item,
            sequencia: proximaSequenciaSinonimo(todos.map((x) => num(x['sequencia']))),
            termo,
            origem_termo: e.origemTermo,
          });
          return { id: novo, versao: 1 };
        }
        if (
          !(await tx.uma('SELECT id FROM item_prescritivel WHERE id = ? AND excluido_em IS NULL', [
            e.conflitante,
          ]))
        )
          throw inexistente('O item conflitante');
        const pares = await tx.consultarParaAtualizar(
          `SELECT id, versao, item_prescritivel_id AS a, conflitante_item_prescritivel_id AS b, excluido_em
             FROM item_prescritivel_conflito
            WHERE item_prescritivel_id IN (?, ?) AND conflitante_item_prescritivel_id IN (?, ?)`,
          [item, e.conflitante, item, e.conflitante],
        );
        const ps = problemasDoConflito(
          item,
          e.conflitante,
          e.gravidade,
          e.motivo,
          pares.filter((x) => x['excluido_em'] === null).map((x) => [num(x['a']), num(x['b'])] as const),
        );
        if (ps.length) recusar(ps, ps[0]!.codigo === 'conflito-repetido' ? 409 : 422);
        const antigo = pares.find((x) => num(x['a']) === item);
        const valores = { gravidade: e.gravidade, motivo: e.motivo };
        if (antigo)
          return {
            id: num(antigo['id']),
            versao: await tx.alterar('item_prescritivel_conflito', num(antigo['id']), num(antigo['versao']), {
              ...valores,
              excluido_em: null,
              excluido_por: null,
            }),
          };
        const novo = await tx.incluir('item_prescritivel_conflito', {
          item_prescritivel_id: item,
          conflitante_item_prescritivel_id: e.conflitante,
          ...valores,
        });
        return { id: novo, versao: 1 };
      },
    );
  }

  /** Retira um complemento do item (regra do setor: ativo = false; os outros: excluido_em e excluido_por). */
  retirarComplemento(c: ContextoGravacaoCatalogo, item: number, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.catalogo.item_complemento.retirada',
      'item_prescritivel',
      esquemaRetirada,
      entrada,
      async (tx, e, est) => {
        const tabela = TABELA_DO_COMPLEMENTO[e.tipo];
        const dono =
          e.tipo === 'conflito'
            ? '(item_prescritivel_id = ? OR conflitante_item_prescritivel_id = ?)'
            : 'item_prescritivel_id = ? AND ? > 0';
        const escopo = e.tipo === 'setor' ? ' AND estabelecimento_id = ?' : ' AND ? > 0';
        const x = await tx.uma(`SELECT id FROM ${tabela} WHERE id = ? AND ${dono}${escopo}`, [
          e.id,
          item,
          item,
          est,
        ]);
        if (!x) throw inexistente('O complemento do item');
        if (e.tipo === 'setor')
          return {
            id: e.id,
            versao: await tx.alterar('item_prescritivel_setor', e.id, e.versao, { ativo: false }),
          };
        return CadastroCatalogoPrescricaoPropria.retirar(tx, tabela, e.id, e.versao);
      },
    );
  }
}
