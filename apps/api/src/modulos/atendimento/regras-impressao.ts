// Regras de impressão da recepção no banco próprio — 02-REC linha 35. As regras são do domínio
// (@sgh/dominio-atendimento: fichasPelasRegras, validarRegraImpressao, validarModeloFicha, classificarEmissao); aqui
// ficam:
//   - a leitura da configuração (modelos de ficha, regras por fonte pagadora, especialidade, grupo de faturamento,
//     unidade assistencial e tipo de atendimento) e das opções de cada dimensão;
//   - a gravação do modelo e da regra pelo executor (trilha na mesma transação). Nada é apagado: modelo e regra saem
//     de uso pela inativação e voltam pela mesma linha;
//   - as fichas que a configuração manda imprimir para um atendimento (o que a tela de impressos mostra);
//   - o registro de cada emissão (atendimento_impresso_emitido), numerada por impresso do atendimento: a segunda em
//     diante é reimpressão, com quem e quando.
import {
  classificarEmissao,
  type FichaPelaRegra,
  fichasPelasRegras,
  type ModeloFichaImpressa,
  type RegraImpressaoFicha,
  validarModeloFicha,
  validarRegraImpressao,
} from '@sgh/dominio-atendimento';
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
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => Boolean(Number(v));

export const TIPOS_DOCUMENTO_FICHA = [
  'ficha_ambulatorial',
  'ficha_pronto_atendimento',
  'guia_consulta',
  'guia_sadt',
  'comprovante',
  'etiqueta',
  'outro',
] as const;

const id = z.number().int().positive();
const idOuNulo = id.nullable();

export const esquemaManterRegraImpressao = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('modelo'),
      /** Ausente: modelo novo. */
      id: id.optional(),
      versao: z.number().int().positive().optional(),
      codigo: z.string().trim().min(1).max(30),
      titulo: z.string().trim().min(1).max(150),
      tipoDocumento: z.enum(TIPOS_DOCUMENTO_FICHA),
      /** O texto que o modelo imprime abaixo da identificação do atendimento. */
      conteudo: z.string().trim().min(1).max(20_000),
      copias: z.number().int(),
      ordem: z.number().int().min(0).max(9999).nullable(),
      somenteRetorno: z.boolean(),
      idadeMinima: z.number().int().nullable(),
      idadeMaxima: z.number().int().nullable(),
      ativo: z.boolean(),
    })
    .strict(),
  z
    .object({
      acao: z.literal('regra'),
      /** Ausente: regra nova. */
      id: id.optional(),
      versao: z.number().int().positive().optional(),
      modelo: id,
      /** Verdadeiro: a regra vale para todas as unidades hospitalares do cliente; falso: só para a da sessão. */
      todasUnidades: z.boolean(),
      categoria: idOuNulo,
      fontePagadora: idOuNulo,
      especialidade: idOuNulo,
      grupo: idOuNulo,
      unidade: idOuNulo,
      copias: z.number().int().nullable(),
      selecionada: z.boolean(),
      ativo: z.boolean(),
    })
    .strict(),
]);
export type EntradaManterRegraImpressao = z.infer<typeof esquemaManterRegraImpressao>;

export interface ModeloFichaVisao extends ModeloFichaImpressa {
  readonly versao: number;
  readonly codigo: string;
  readonly tipoDocumento: string;
  /** Nulo quando o modelo usa um leiaute do módulo de relatórios. */
  readonly conteudo: string | null;
  /** Regras ativas que usam o modelo. */
  readonly regrasAtivas: number;
}
export interface RegraImpressaoVisao extends RegraImpressaoFicha {
  readonly versao: number;
}
interface Opcao {
  readonly id: number;
  readonly nome: string;
}
export interface ConfiguracaoImpressao {
  readonly estabelecimento: number;
  readonly modelos: readonly ModeloFichaVisao[];
  readonly regras: readonly RegraImpressaoVisao[];
  readonly opcoes: {
    readonly categorias: readonly Opcao[];
    readonly fontes: readonly Opcao[];
    readonly especialidades: readonly Opcao[];
    readonly grupos: readonly Opcao[];
    readonly unidades: readonly Opcao[];
  };
}

/** A ficha configurada do atendimento, com as vezes em que já saiu. */
export interface FichaDoAtendimento extends FichaPelaRegra {
  readonly emitidas: number;
}

export interface EmissaoImpresso {
  readonly id: number;
  readonly impresso: string;
  readonly modelo: number | null;
  /** O título do modelo configurado (nulo no impresso padrão). */
  readonly titulo: string | null;
  readonly formato: string;
  readonly copias: number;
  readonly sequencia: number;
  readonly reimpressao: boolean;
  /** Instante UTC (ISO). */
  readonly emitidoEm: string;
  readonly emitidoPor: string | null;
}

const COLUNAS_MODELO = `m.id, m.versao, m.codigo, m.titulo, m.tipo_documento, m.conteudo, m.copias, m.ordem,
  m.somente_retorno, m.idade_minima, m.idade_maxima, m.ativo`;
const COLUNAS_REGRA = `r.id, r.versao, r.modelo_ficha_impressa_id AS modelo, r.estabelecimento_id AS estabelecimento,
  r.categoria_atendimento_id AS categoria, r.fonte_pagadora_id AS fonte, r.especialidade_medica_id AS especialidade,
  r.grupo_faturamento_id AS grupo, r.unidade_assistencial_id AS unidade, r.clinica_assistencial_id AS clinica,
  r.copias, r.selecionada_padrao AS selecionada, r.ativo`;

const modeloDaLinha = (x: Linha): ModeloFichaImpressa => ({
  id: num(x['id']),
  titulo: String(x['titulo']),
  copias: num(x['copias']),
  ordem: numOuNulo(x['ordem']),
  somenteRetorno: bool(x['somente_retorno']),
  idadeMinima: numOuNulo(x['idade_minima']),
  idadeMaxima: numOuNulo(x['idade_maxima']),
  ativo: bool(x['ativo']),
});
const regraDaLinha = (x: Linha): RegraImpressaoVisao => ({
  id: num(x['id']),
  versao: num(x['versao']),
  modelo: num(x['modelo']),
  estabelecimento: numOuNulo(x['estabelecimento']),
  categoria: numOuNulo(x['categoria']),
  fontePagadora: numOuNulo(x['fonte']),
  especialidade: numOuNulo(x['especialidade']),
  grupo: numOuNulo(x['grupo']),
  unidade: numOuNulo(x['unidade']),
  clinica: numOuNulo(x['clinica']),
  copias: numOuNulo(x['copias']),
  selecionada: bool(x['selecionada']),
  ativo: bool(x['ativo']),
});

/** As regras que alcançam o estabelecimento: as dele e as de todas as unidades. */
const lerRegras = async (l: Leitor, estabelecimento: number): Promise<RegraImpressaoVisao[]> =>
  (
    await l.consultar(
      `SELECT ${COLUNAS_REGRA} FROM regra_impressao_ficha r
        WHERE r.estabelecimento_id IS NULL OR r.estabelecimento_id = ? ORDER BY r.id`,
      [estabelecimento],
      { teto: 5000 },
    )
  ).map(regraDaLinha);

/**
 * As fichas que a configuração manda imprimir para o atendimento (null: o atendimento não é do estabelecimento).
 * Sem regra que valha, a lista vem vazia e a recepção segue com a ficha padrão.
 */
export async function lerFichasDoAtendimento(
  l: Leitor,
  estabelecimento: number,
  atendimento: number,
): Promise<FichaDoAtendimento[] | null> {
  const a = await l.uma(
    `SELECT a.categoria_atendimento_id AS categoria, a.fonte_pagadora_id AS fonte,
            a.especialidade_medica_id AS especialidade, a.unidade_assistencial_id AS unidade,
            a.clinica_assistencial_id AS clinica, a.retorno,
            TIMESTAMPDIFF(YEAR, pf.data_nascimento, a.entrada_em) AS idade
       FROM atendimento a
       JOIN paciente p ON p.id = a.paciente_id
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
    [atendimento, estabelecimento],
  );
  if (!a) return null;
  const regras = await lerRegras(l, estabelecimento);
  if (!regras.some((r) => r.ativo)) return [];
  const grupos = await l.consultar(
    `SELECT DISTINCT i.grupo_faturamento_id AS g
       FROM atendimento_procedimento ap JOIN item_faturavel i ON i.id = ap.item_faturavel_id
      WHERE ap.atendimento_id = ? AND ap.excluido_em IS NULL`,
    [atendimento],
    { teto: 500 },
  );
  const modelos = (
    await l.consultar(
      `SELECT ${COLUNAS_MODELO} FROM modelo_ficha_impressa m WHERE m.ativo ORDER BY m.id`,
      [],
      {
        teto: 2000,
      },
    )
  ).map(modeloDaLinha);
  const idade = numOuNulo(a['idade']);
  const fichas = fichasPelasRegras(modelos, regras, {
    estabelecimento,
    categoria: numOuNulo(a['categoria']),
    fontePagadora: numOuNulo(a['fonte']),
    especialidade: numOuNulo(a['especialidade']),
    unidade: numOuNulo(a['unidade']),
    clinica: numOuNulo(a['clinica']),
    grupos: grupos.map((g) => num(g['g'])),
    retorno: bool(a['retorno']),
    idade: idade !== null && idade >= 0 ? idade : null,
  });
  if (fichas.length === 0) return [];
  const emitidas = await l.consultar(
    `SELECT modelo_ficha_impressa_id AS m, COUNT(*) AS n FROM atendimento_impresso_emitido
      WHERE atendimento_id = ? AND modelo_ficha_impressa_id IS NOT NULL GROUP BY modelo_ficha_impressa_id`,
    [atendimento],
    { teto: 2000 },
  );
  const vezes = new Map(emitidas.map((e) => [num(e['m']), num(e['n'])]));
  return fichas.map((f) => ({ ...f, emitidas: vezes.get(f.modelo) ?? 0 }));
}

/**
 * Grava a emissão do impresso na transação da gravação direta do atendimento. O atendimento é travado para a
 * numeração (duas emissões simultâneas não recebem a mesma sequência). `impresso` é o código do impresso padrão ou
 * "ficha-<id do modelo>" na ficha configurada.
 */
export async function gravarImpressoEmitido(
  tx: TxOperacao,
  estabelecimento: number,
  r: { reg: number; impresso: string; formato: string; copias: number; resumo: string },
): Promise<number> {
  const [a] = await tx.consultarParaAtualizar(
    'SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [r.reg, estabelecimento],
    { teto: 1 },
  );
  if (!a) throw recusa('atendimento-desconhecido', 'O atendimento não existe mais.');
  const doModelo = /^ficha-(\d+)$/.exec(r.impresso);
  const modelo = doModelo ? Number(doModelo[1]) : null;
  const impresso = modelo !== null ? 'ficha' : r.impresso;
  if (modelo !== null && !(await tx.uma('SELECT id FROM modelo_ficha_impressa WHERE id = ?', [modelo])))
    throw recusa('ficha-nao-configurada', 'O modelo de ficha não existe mais.');
  const antes = await tx.uma(
    `SELECT COUNT(*) AS n FROM atendimento_impresso_emitido
      WHERE atendimento_id = ? AND impresso = ? AND modelo_ficha_impressa_id <=> ?`,
    [r.reg, impresso, modelo],
  );
  return tx.incluir('atendimento_impresso_emitido', {
    estabelecimento_id: estabelecimento,
    atendimento_id: r.reg,
    impresso,
    modelo_ficha_impressa_id: modelo,
    formato: r.formato,
    copias: r.copias,
    sequencia: classificarEmissao(num(antes?.['n'] ?? 0)).sequencia,
    resumo_conteudo: r.resumo,
  });
}

/** O que a manutenção usa do NucleoProprio (os testes trocam). */
export interface NucleoRegrasImpressao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoRegrasImpressao {
  /** Código do estabelecimento da sessão. */
  readonly hospital: string;
  readonly login: string;
}

type ResultadoManter = { alvo: string; id: number; versao: number; novo: boolean };

export class RegrasImpressaoPropria {
  private readonly executor: Executor;
  private readonly operacao = definirOperacao<EntradaManterRegraImpressao, ResultadoManter>({
    nome: 'atendimento.manter_regra_impressao',
    tabelas: ['modelo_ficha_impressa', 'regra_impressao_ficha'],
    entrada: esquemaManterRegraImpressao as unknown as z.ZodType<EntradaManterRegraImpressao>,
    gravar: (tx, e, ctx) => (e.acao === 'modelo' ? this.gravarModelo(tx, e) : this.gravarRegra(tx, e, ctx)),
    alvo: (_e, r) => ({ tabela: r.alvo, id: r.id }),
  });

  constructor(
    private readonly nucleo: NucleoRegrasImpressao,
    private readonly cliente: string,
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'regras-impressao' }, fn);
  }

  private async quem(
    l: Leitor,
    c: ContextoRegrasImpressao,
  ): Promise<{ estabelecimento: number; usuario: number | null }> {
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

  /** A configuração inteira do estabelecimento: modelos, regras e as opções de cada dimensão. */
  configuracao(c: ContextoRegrasImpressao): Promise<ConfiguracaoImpressao> {
    return this.ler(async (l) => {
      const { estabelecimento } = await this.quem(l, c);
      const regras = await lerRegras(l, estabelecimento);
      const emUso = new Map<number, number>();
      for (const r of regras) if (r.ativo) emUso.set(r.modelo, (emUso.get(r.modelo) ?? 0) + 1);
      const modelos = (
        await l.consultar(
          `SELECT ${COLUNAS_MODELO} FROM modelo_ficha_impressa m ORDER BY m.ordem IS NULL, m.ordem, m.titulo`,
          [],
          { teto: 2000 },
        )
      ).map((x): ModeloFichaVisao => ({
        ...modeloDaLinha(x),
        versao: num(x['versao']),
        codigo: String(x['codigo']),
        tipoDocumento: String(x['tipo_documento']),
        conteudo: x['conteudo'] === null || x['conteudo'] === undefined ? null : String(x['conteudo']),
        regrasAtivas: emUso.get(num(x['id'])) ?? 0,
      }));
      const opcoes = async (sql: string, p: unknown[] = []): Promise<Opcao[]> =>
        (await l.consultar(sql, p, { teto: 5000 })).map((x) => ({
          id: num(x['id']),
          nome: String(x['nome']),
        }));
      return {
        estabelecimento,
        modelos,
        regras,
        opcoes: {
          categorias: await opcoes(
            'SELECT id, descricao AS nome FROM categoria_atendimento WHERE ativo ORDER BY descricao',
          ),
          fontes: await opcoes(
            "SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL AND situacao = 'ativa' ORDER BY nome",
          ),
          especialidades: await opcoes(
            'SELECT id, descricao AS nome FROM especialidade_medica WHERE ativo ORDER BY descricao',
          ),
          grupos: await opcoes(
            'SELECT id, descricao AS nome FROM grupo_faturamento WHERE ativo ORDER BY descricao',
          ),
          unidades: await opcoes(
            `SELECT id, nome FROM unidade_assistencial
              WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo ORDER BY nome`,
            [estabelecimento],
          ),
        },
      };
    });
  }

  /** As emissões do atendimento, da mais recente para a mais antiga (a reimpressão aparece com quem e quando). */
  emissoes(c: ContextoRegrasImpressao, atendimento: number): Promise<EmissaoImpresso[]> {
    return this.ler(async (l) => {
      const { estabelecimento } = await this.quem(l, c);
      const linhas = await l.consultar(
        `SELECT e.id, e.impresso, e.modelo_ficha_impressa_id AS modelo, m.titulo, e.formato, e.copias, e.sequencia,
                e.criado_em, u.nome AS por
           FROM atendimento_impresso_emitido e
           LEFT JOIN modelo_ficha_impressa m ON m.id = e.modelo_ficha_impressa_id
           LEFT JOIN usuario u ON u.id = e.criado_por
          WHERE e.atendimento_id = ? AND e.estabelecimento_id = ? ORDER BY e.id DESC`,
        [atendimento, estabelecimento],
        { teto: 500 },
      );
      return linhas.map((x) => {
        const quando = x['criado_em'];
        const instante = quando instanceof Date ? quando : new Date(`${String(quando).replace(' ', 'T')}Z`);
        return {
          id: num(x['id']),
          impresso: String(x['impresso']),
          modelo: numOuNulo(x['modelo']),
          titulo: x['titulo'] === null || x['titulo'] === undefined ? null : String(x['titulo']),
          formato: String(x['formato']),
          copias: num(x['copias']),
          sequencia: num(x['sequencia']),
          reimpressao: num(x['sequencia']) > 1,
          emitidoEm: instante.toISOString(),
          emitidoPor: x['por'] === null || x['por'] === undefined ? null : String(x['por']),
        };
      });
    });
  }

  async manter(
    c: ContextoRegrasImpressao & { correlacao: string; chaveIdempotencia: string; enderecoIp?: string },
    entrada: unknown,
  ): Promise<{ resultado: ResultadoManter; repetida: boolean }> {
    const q = await this.ler((l) => this.quem(l, c));
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        'Manter a regra de impressão exige uma conta de usuário do cliente (o responsável fica no registro).',
      );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.operacao, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async gravarModelo(
    tx: TxOperacao,
    e: Extract<EntradaManterRegraImpressao, { acao: 'modelo' }>,
  ): Promise<ResultadoManter> {
    const x = validarModeloFicha(e);
    if (x) throw recusa(x.codigo, x.mensagem);
    const repetido = await tx.uma('SELECT id FROM modelo_ficha_impressa WHERE codigo = ? AND id <> ?', [
      e.codigo,
      e.id ?? 0,
    ]);
    if (repetido)
      throw recusa('modelo-ficha-codigo-repetido', 'Já existe um modelo com este código.', {
        campos: ['codigo'],
      });
    const valores = {
      codigo: e.codigo,
      titulo: e.titulo,
      tipo_documento: e.tipoDocumento,
      conteudo: e.conteudo,
      copias: e.copias,
      ordem: e.ordem,
      somente_retorno: e.somenteRetorno,
      idade_minima: e.idadeMinima,
      idade_maxima: e.idadeMaxima,
      ativo: e.ativo,
    };
    if (e.id === undefined) {
      const novo = await tx.incluir('modelo_ficha_impressa', valores);
      return { alvo: 'modelo_ficha_impressa', id: novo, versao: 1, novo: true };
    }
    const atual = await tx.uma('SELECT versao FROM modelo_ficha_impressa WHERE id = ?', [e.id]);
    if (!atual) throw recusa('modelo-ficha-desconhecido', 'O modelo de ficha não existe mais.');
    const versao = await tx.alterar('modelo_ficha_impressa', e.id, e.versao ?? num(atual['versao']), valores);
    return { alvo: 'modelo_ficha_impressa', id: e.id, versao, novo: false };
  }

  private async gravarRegra(
    tx: TxOperacao,
    e: Extract<EntradaManterRegraImpressao, { acao: 'regra' }>,
    ctx: ContextoOperacao,
  ): Promise<ResultadoManter> {
    const est = ctx.estabelecimento;
    if (est === null || est === undefined)
      throw recusa('estabelecimento-desconhecido', 'A regra de impressão exige o estabelecimento da sessão.');
    const atual =
      e.id === undefined
        ? null
        : await tx.uma(`SELECT ${COLUNAS_REGRA} FROM regra_impressao_ficha r WHERE r.id = ?`, [e.id]);
    if (e.id !== undefined && !atual)
      throw recusa('regra-impressao-desconhecida', 'A regra de impressão não existe mais.');
    const antes = atual ? regraDaLinha(atual) : null;
    if (antes && antes.estabelecimento !== null && antes.estabelecimento !== est)
      throw recusa(
        'regra-impressao-de-outra-unidade',
        'Esta regra é de outra unidade hospitalar: altere-a na sessão daquela unidade.',
      );
    const existe = async (sql: string, p: unknown[], codigo: string, mensagem: string, campo: string) => {
      if (!(await tx.uma(sql, p))) throw recusa(codigo, mensagem, { campos: [campo] });
    };
    await existe(
      'SELECT id FROM modelo_ficha_impressa WHERE id = ?',
      [e.modelo],
      'modelo-ficha-desconhecido',
      'O modelo de ficha não existe mais.',
      'modelo',
    );
    if (e.unidade !== null)
      await existe(
        'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.unidade, est],
        'regra-impressao-unidade',
        'A unidade assistencial não é desta unidade hospitalar.',
        'unidade',
      );
    if (e.unidade !== null && e.todasUnidades)
      throw recusa(
        'regra-impressao-unidade',
        'A regra de todas as unidades hospitalares não pode citar a unidade assistencial de uma delas.',
        { campos: ['unidade'] },
      );
    for (const [valor, tabela, campo, nome] of [
      [e.categoria, 'categoria_atendimento', 'categoria', 'O tipo de atendimento'],
      [e.fontePagadora, 'fonte_pagadora', 'fontePagadora', 'A fonte pagadora'],
      [e.especialidade, 'especialidade_medica', 'especialidade', 'A especialidade'],
      [e.grupo, 'grupo_faturamento', 'grupo', 'O grupo de faturamento'],
    ] as const)
      if (valor !== null)
        await existe(
          `SELECT id FROM ${tabela} WHERE id = ?`,
          [valor],
          'regra-impressao-referencia',
          `${nome} não existe mais.`,
          campo,
        );
    const alcance = {
      estabelecimento: e.todasUnidades ? null : est,
      categoria: e.categoria,
      fontePagadora: e.fontePagadora,
      especialidade: e.especialidade,
      grupo: e.grupo,
      unidade: e.unidade,
      // A clínica assistencial não é editada por esta tela: a que a regra já tinha é mantida.
      clinica: antes?.clinica ?? null,
    };
    const outras = (
      await tx.consultarParaAtualizar(
        `SELECT ${COLUNAS_REGRA} FROM regra_impressao_ficha r WHERE r.modelo_ficha_impressa_id = ?`,
        [e.modelo],
        { teto: 5000 },
      )
    ).map(regraDaLinha);
    const x = validarRegraImpressao(
      { ...alcance, id: e.id ?? null, modelo: e.modelo, copias: e.copias, ativo: e.ativo },
      outras,
    );
    if (x) throw recusa(x.codigo, x.mensagem);
    const valores = {
      modelo_ficha_impressa_id: e.modelo,
      estabelecimento_id: alcance.estabelecimento,
      categoria_atendimento_id: e.categoria,
      fonte_pagadora_id: e.fontePagadora,
      especialidade_medica_id: e.especialidade,
      grupo_faturamento_id: e.grupo,
      unidade_assistencial_id: e.unidade,
      copias: e.copias,
      selecionada_padrao: e.selecionada,
      ativo: e.ativo,
    };
    if (!antes) {
      const novo = await tx.incluir('regra_impressao_ficha', valores);
      return { alvo: 'regra_impressao_ficha', id: novo, versao: 1, novo: true };
    }
    const versao = await tx.alterar('regra_impressao_ficha', antes.id, e.versao ?? antes.versao, valores);
    return { alvo: 'regra_impressao_ficha', id: antes.id, versao, novo: false };
  }
}
