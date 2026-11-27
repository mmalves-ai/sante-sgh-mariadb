// Restrições próprias do hospital no apoio à decisão da prescrição, no banco próprio (03-PEP L108): o ajuste de dose
// por faixa de função renal, hepática ou diálise (ajuste_dose_renal), a restrição de posologia por paciente e setor
// (restricao_posologia) e a configuração do alerta por estabelecimento e setor (configuracao_alerta_prescricao).
//   - lerRestricoesAlertas: o que o motor de alertas recebe na verificação da prescrição, já resolvido para os produtos
//     dela (o item ou os itens do princípio ativo), com a idade, o sexo e o setor do paciente;
//   - CadastroRestricoesPrescricaoPropria: a leitura do cadastro e as gravações pelo executor (trilha na mesma
//     transação, versão lida). Nada é apagado: desligar é gravar com ativo = false. A regra é do domínio
//     (problemasFaixaRenal, problemasRestricao); aqui só a coerência com o banco.
import {
  AJUSTES_RENAIS,
  COMPORTAMENTOS_CONFIGURACAO,
  COMPORTAMENTOS_RESTRICAO,
  type ContextoRestricoes,
  CRITERIOS_AJUSTE_RENAL,
  problemasFaixaRenal,
  problemasRestricao,
  TIPOS_RESTRICAO_POSOLOGIA,
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
import type {
  ContextoCadastroCatalogo,
  ContextoGravacaoCatalogo,
  Gravado,
  NucleoCadastroCatalogo,
} from './prescricao-propria-cadastro.js';

export const CADASTRO_RESTRICOES_PRESCRICAO = Symbol('CADASTRO_RESTRICOES_PRESCRICAO');

const TABELAS = ['ajuste_dose_renal', 'restricao_posologia', 'configuracao_alerta_prescricao'] as const;

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (Buffer.isBuffer(v) && v[0] === 1);
const boolOuNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : bool(v));
const lista = (n: readonly unknown[]) => n.map(() => '?').join(',');
const id = z.number().int().positive();
const nulo = <T extends z.ZodTypeAny>(t: T) => t.nullable().default(null);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimal = z.number().min(0).max(99_999_999_999);

const alvo = {
  item: nulo(id),
  principio: nulo(id),
};

export const esquemaAjuste = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    ...alvo,
    criterio: z.enum(CRITERIOS_AJUSTE_RENAL),
    faixaMinima: nulo(decimal),
    faixaMaxima: nulo(decimal),
    classeHepatica: nulo(z.enum(['A', 'B', 'C'])),
    modalidadeDialise: nulo(z.enum(['hemodialise', 'dialise_peritoneal', 'terapia_continua'])),
    ajuste: z.enum(AJUSTES_RENAIS),
    percentualDose: nulo(z.number().positive().max(100)),
    doseMaxima: nulo(decimal),
    unidade: nulo(id),
    intervaloHoras: nulo(z.number().int().min(1).max(720)),
    comportamento: z.enum(COMPORTAMENTOS_RESTRICAO).default('avisar'),
    orientacao: nulo(z.string().trim().max(1000)),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaRestricao = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    ...alvo,
    todosEstabelecimentos: z.boolean().default(false),
    setor: nulo(id),
    via: nulo(id),
    forma: nulo(id),
    sexo: nulo(id),
    idadeMinimaDias: nulo(z.number().int().min(0).max(54_750)),
    idadeMaximaDias: nulo(z.number().int().min(0).max(54_750)),
    pesoMinimoKg: nulo(z.number().min(0).max(9999)),
    pesoMaximoKg: nulo(z.number().min(0).max(9999)),
    gestante: nulo(z.boolean()),
    lactante: nulo(z.boolean()),
    tipo: z.enum(TIPOS_RESTRICAO_POSOLOGIA),
    doseMaxima: nulo(decimal),
    doseMaximaDiaria: nulo(decimal),
    unidade: nulo(id),
    acao: z.enum(COMPORTAMENTOS_RESTRICAO).default('avisar'),
    mensagem: z.string().trim().max(500),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaConfiguracao = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    regra: id,
    todosEstabelecimentos: z.boolean().default(false),
    setor: nulo(id),
    gatilhoItem: nulo(id),
    comportamento: z.enum(COMPORTAMENTOS_CONFIGURACAO).default('aviso'),
    vigenciaInicio: nulo(data),
    vigenciaFim: nulo(data),
    ativo: z.boolean().default(true),
  })
  .strict();

export type EntradaAjusteRenal = z.infer<typeof esquemaAjuste>;
export type EntradaRestricaoPosologia = z.infer<typeof esquemaRestricao>;
export type EntradaConfiguracaoAlerta = z.infer<typeof esquemaConfiguracao>;

export const recusar = (status: number, codigo: string, detalhe: string, campo?: string): never => {
  throw new ErroOperacao(
    status,
    codigo,
    'Cadastro recusado',
    detalhe,
    campo ? { campos: [campo] } : undefined,
  );
};

export const MENSAGENS: Record<string, string> = {
  'faixa-invertida': 'A faixa mínima passa da máxima.',
  'classe-hepatica-obrigatoria': 'Informe a classe de Child-Pugh.',
  'modalidade-dialise-obrigatoria': 'Informe a modalidade de diálise.',
  'faixa-obrigatoria': 'Informe ao menos um limite da faixa de função renal.',
  'percentual-invalido': 'O percentual da dose vai de 0 a 100.',
  'reducao-sem-limite': 'Redução de dose pede a dose máxima ou o percentual da dose usual.',
  'intervalo-obrigatorio': 'Aumentar o intervalo pede o intervalo mínimo em horas.',
  'mensagem-obrigatoria': 'Escreva a mensagem que o prescritor verá.',
  'dose-obrigatoria': 'Limite de dose pede a dose máxima por dose ou no dia.',
  'via-obrigatoria': 'Via proibida pede a via.',
  'idade-invertida': 'A idade mínima passa da máxima.',
  'peso-invertido': 'O peso mínimo passa do máximo.',
};
export const recusarProblemas = (ps: readonly string[]) => {
  if (ps.length) recusar(422, ps[0]!, ps.map((p) => MENSAGENS[p] ?? p).join(' '));
};

/** Produto da prescrição com os princípios ativos (o motor já os leu do cadastro). */
export interface ProdutoComPrincipios {
  readonly produto: number;
  readonly principios: readonly number[];
}

/** Produtos da prescrição a que a linha vale: o próprio item, ou os itens que têm o princípio ativo. */
function produtosDaLinha(
  linha: Record<string, unknown>,
  produtos: readonly ProdutoComPrincipios[],
): number[] {
  const item = numOuNull(linha['item_prescritivel_id']);
  const princ = numOuNull(linha['principio_ativo_id']);
  return produtos
    .filter((p) => (item !== null ? p.produto === item : princ !== null && p.principios.includes(princ)))
    .map((p) => p.produto);
}

/**
 * O que o motor de alertas recebe: as faixas de ajuste, as restrições e as configurações por setor que valem para os
 * produtos da prescrição no estabelecimento, com a idade (em dias), o sexo e o setor do paciente.
 */
export async function lerRestricoesAlertas(
  l: Leitor,
  estabelecimento: number,
  paciente: number,
  unidadeAssistencial: number | null,
  produtos: readonly ProdutoComPrincipios[],
): Promise<ContextoRestricoes> {
  const pf = await l.uma(
    `SELECT DATEDIFF(CURRENT_DATE, f.data_nascimento) AS dias, f.sexo_id
       FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE p.id = ?`,
    [paciente],
  );
  const st = unidadeAssistencial
    ? await l.uma(
        `SELECT setor_funcional_id FROM unidade_internacao
          WHERE unidade_assistencial_id = ? AND setor_funcional_id IS NOT NULL ORDER BY id LIMIT 1`,
        [unidadeAssistencial],
      )
    : null;
  const base: ContextoRestricoes = {
    estabelecimento,
    setor: st ? numOuNull(st['setor_funcional_id']) : null,
    paciente: {
      idadeDias: pf ? numOuNull(pf['dias']) : null,
      sexo: pf ? numOuNull(pf['sexo_id']) : null,
      gestante: null,
      lactante: null,
      classeHepatica: null,
      dialise: null,
    },
    ajustesRenais: [],
    posologia: [],
    configuracoes: [],
  };
  const itens = [...new Set(produtos.map((p) => p.produto))];
  const princ = [...new Set(produtos.flatMap((p) => p.principios))];
  if (itens.length === 0) return base;
  const filtroAlvo = `(item_prescritivel_id IN (${lista(itens)})${princ.length ? ` OR principio_ativo_id IN (${lista(princ)})` : ''})`;
  const pAlvo = [...itens, ...princ];
  const aj = await l.consultar(
    `SELECT id, item_prescritivel_id, principio_ativo_id, criterio, faixa_minima, faixa_maxima, classe_hepatica,
            modalidade_dialise, ajuste, percentual_dose, dose_maxima, intervalo_horas, comportamento, orientacao
       FROM ajuste_dose_renal WHERE ativo AND ${filtroAlvo} ORDER BY id`,
    pAlvo,
    { teto: 5000 },
  );
  const rp = await l.consultar(
    `SELECT r.id, r.item_prescritivel_id, r.principio_ativo_id, r.setor_funcional_id, COALESCE(v.sigla, v.descricao) AS via,
            r.sexo_id, r.idade_minima_dias, r.idade_maxima_dias, r.peso_minimo_kg, r.peso_maximo_kg, r.gestante,
            r.lactante, r.tipo_restricao, r.dose_maxima, r.dose_maxima_diaria, r.acao, r.mensagem
       FROM restricao_posologia r LEFT JOIN via_de_uso v ON v.id = r.via_de_uso_id
      WHERE r.ativo AND (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?)
        AND (r.item_prescritivel_id IN (${lista(itens)})${princ.length ? ` OR r.principio_ativo_id IN (${lista(princ)})` : ''})
      ORDER BY r.id`,
    [estabelecimento, ...pAlvo],
    { teto: 5000 },
  );
  const cf = await l.consultar(
    `SELECT c.id, ca.codigo AS tipo, c.estabelecimento_id, c.setor_funcional_id, c.gatilho_item_prescritivel_id,
            c.comportamento, DATE_FORMAT(c.vigencia_inicio, '%Y-%m-%d') AS ini,
            DATE_FORMAT(c.vigencia_fim, '%Y-%m-%d') AS fim, c.ativo
       FROM configuracao_alerta_prescricao c
       JOIN regra_alerta r ON r.id = c.regra_alerta_id
       JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id
      WHERE c.estabelecimento_id IS NULL OR c.estabelecimento_id = ?
      ORDER BY c.id`,
    [estabelecimento],
    { teto: 5000 },
  );
  return {
    ...base,
    ajustesRenais: aj
      .map((x) => ({
        id: num(x['id']),
        produtos: produtosDaLinha(x, produtos),
        criterio: String(x['criterio']) as ContextoRestricoes['ajustesRenais'][number]['criterio'],
        faixaMinima: numOuNull(x['faixa_minima']),
        faixaMaxima: numOuNull(x['faixa_maxima']),
        classeHepatica: txt(x['classe_hepatica']) as 'A' | 'B' | 'C' | null,
        modalidadeDialise: txt(x['modalidade_dialise']),
        ajuste: String(x['ajuste']) as ContextoRestricoes['ajustesRenais'][number]['ajuste'],
        percentualDose: numOuNull(x['percentual_dose']),
        doseMaxima: numOuNull(x['dose_maxima']),
        intervaloHoras: numOuNull(x['intervalo_horas']),
        comportamento: String(
          x['comportamento'],
        ) as ContextoRestricoes['ajustesRenais'][number]['comportamento'],
        orientacao: txt(x['orientacao']),
      }))
      .filter((x) => x.produtos.length > 0),
    posologia: rp
      .map((x) => ({
        id: num(x['id']),
        produtos: produtosDaLinha(x, produtos),
        setor: numOuNull(x['setor_funcional_id']),
        via: txt(x['via']),
        sexo: numOuNull(x['sexo_id']),
        idadeMinimaDias: numOuNull(x['idade_minima_dias']),
        idadeMaximaDias: numOuNull(x['idade_maxima_dias']),
        pesoMinimoKg: numOuNull(x['peso_minimo_kg']),
        pesoMaximoKg: numOuNull(x['peso_maximo_kg']),
        gestante: boolOuNull(x['gestante']),
        lactante: boolOuNull(x['lactante']),
        tipo: String(x['tipo_restricao']) as ContextoRestricoes['posologia'][number]['tipo'],
        doseMaxima: numOuNull(x['dose_maxima']),
        doseMaximaDiaria: numOuNull(x['dose_maxima_diaria']),
        acao: String(x['acao']) as ContextoRestricoes['posologia'][number]['acao'],
        mensagem: String(x['mensagem']),
      }))
      .filter((x) => x.produtos.length > 0),
    configuracoes: cf.map((x) => ({
      id: num(x['id']),
      tipo: String(x['tipo']),
      estabelecimento: numOuNull(x['estabelecimento_id']),
      setor: numOuNull(x['setor_funcional_id']),
      gatilhoProduto: numOuNull(x['gatilho_item_prescritivel_id']),
      comportamento: String(
        x['comportamento'],
      ) as ContextoRestricoes['configuracoes'][number]['comportamento'],
      vigenciaInicio: txt(x['ini']),
      vigenciaFim: txt(x['fim']),
      ativo: bool(x['ativo']),
    })),
  };
}

/** O que as rotas usam: a porta própria (banco) e a em memória (fonte sintética) seguem o mesmo contrato. */
export type PortaRestricoesPrescricao = Pick<
  CadastroRestricoesPrescricaoPropria,
  'cadastro' | 'gravarAjusteRenal' | 'gravarRestricao' | 'gravarConfiguracao'
>;

export class CadastroRestricoesPrescricaoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  constructor(
    private readonly nucleo: NucleoCadastroCatalogo,
    private readonly cliente: string,
  ) {}

  private ler<T>(
    c: ContextoCadastroCatalogo,
    fn: (l: Leitor, est: number, usuario: number | null) => Promise<T>,
  ) {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.restricoes.cadastro' },
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
        const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
        return fn(l, num(e['id']), u ? num(u['id']) : null);
      },
    );
  }

  /** O cadastro inteiro do estabelecimento, com os nomes para a tela e as listas de apoio. */
  cadastro(c: ContextoCadastroCatalogo) {
    return this.ler(c, async (l, est) => {
      const op = (sql: string, p: unknown[] = []) =>
        l
          .consultar(sql, p, { teto: 5000 })
          .then((ls) => ls.map((x) => ({ id: num(x['id']), nome: String(x['nome']) })));
      const [ajustes, restricoes, configuracoes, regras, setores, vias, sexos, unidades] = await Promise.all([
        l.consultar(
          `SELECT a.*, ip.descricao AS item_nome, pa.descricao AS principio_nome
             FROM ajuste_dose_renal a
             LEFT JOIN item_prescritivel ip ON ip.id = a.item_prescritivel_id
             LEFT JOIN principio_ativo pa ON pa.id = a.principio_ativo_id
            ORDER BY a.ativo DESC, COALESCE(pa.descricao, ip.descricao), a.faixa_minima, a.id`,
          [],
          { teto: 20_000 },
        ),
        l.consultar(
          `SELECT r.*, ip.descricao AS item_nome, pa.descricao AS principio_nome
             FROM restricao_posologia r
             LEFT JOIN item_prescritivel ip ON ip.id = r.item_prescritivel_id
             LEFT JOIN principio_ativo pa ON pa.id = r.principio_ativo_id
            WHERE r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?
            ORDER BY r.ativo DESC, COALESCE(pa.descricao, ip.descricao), r.id`,
          [est],
          { teto: 20_000 },
        ),
        l.consultar(
          `SELECT c.*, DATE_FORMAT(c.vigencia_inicio, '%Y-%m-%d') AS ini, DATE_FORMAT(c.vigencia_fim, '%Y-%m-%d') AS fim,
                  r.codigo AS regra_codigo, ca.codigo AS tipo
             FROM configuracao_alerta_prescricao c
             JOIN regra_alerta r ON r.id = c.regra_alerta_id
             JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id
            WHERE c.estabelecimento_id IS NULL OR c.estabelecimento_id = ?
            ORDER BY c.ativo DESC, r.codigo, c.id`,
          [est],
          { teto: 5000 },
        ),
        op(
          `SELECT r.id, CONCAT(r.codigo, ' (', ca.codigo, ')') AS nome FROM regra_alerta r
             JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id
            WHERE r.estabelecimento_id IS NULL OR r.estabelecimento_id = ? ORDER BY r.codigo`,
          [est],
        ),
        op(
          'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome, id',
          [est],
        ),
        op(
          'SELECT id, COALESCE(sigla, descricao) AS nome FROM via_de_uso WHERE ativo ORDER BY descricao, id',
        ),
        op('SELECT id, descricao AS nome FROM sexo ORDER BY id'),
        op('SELECT id, sigla AS nome FROM unidade_medida ORDER BY sigla, id'),
      ]);
      const alvoDe = (x: Record<string, unknown>) => ({
        item: numOuNull(x['item_prescritivel_id']),
        principio: numOuNull(x['principio_ativo_id']),
        alvoNome: txt(x['principio_nome']) ?? txt(x['item_nome']) ?? '',
      });
      return {
        ajustes: ajustes.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          ...alvoDe(x),
          criterio: String(x['criterio']),
          faixaMinima: numOuNull(x['faixa_minima']),
          faixaMaxima: numOuNull(x['faixa_maxima']),
          classeHepatica: txt(x['classe_hepatica']),
          modalidadeDialise: txt(x['modalidade_dialise']),
          ajuste: String(x['ajuste']),
          percentualDose: numOuNull(x['percentual_dose']),
          doseMaxima: numOuNull(x['dose_maxima']),
          unidade: numOuNull(x['unidade_medida_id']),
          intervaloHoras: numOuNull(x['intervalo_horas']),
          comportamento: String(x['comportamento']),
          orientacao: txt(x['orientacao']),
          ativo: bool(x['ativo']),
        })),
        restricoes: restricoes.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          ...alvoDe(x),
          todosEstabelecimentos: x['estabelecimento_id'] === null,
          setor: numOuNull(x['setor_funcional_id']),
          via: numOuNull(x['via_de_uso_id']),
          forma: numOuNull(x['forma_apresentacao_medicamento_id']),
          sexo: numOuNull(x['sexo_id']),
          idadeMinimaDias: numOuNull(x['idade_minima_dias']),
          idadeMaximaDias: numOuNull(x['idade_maxima_dias']),
          pesoMinimoKg: numOuNull(x['peso_minimo_kg']),
          pesoMaximoKg: numOuNull(x['peso_maximo_kg']),
          gestante: boolOuNull(x['gestante']),
          lactante: boolOuNull(x['lactante']),
          tipo: String(x['tipo_restricao']),
          doseMaxima: numOuNull(x['dose_maxima']),
          doseMaximaDiaria: numOuNull(x['dose_maxima_diaria']),
          unidade: numOuNull(x['unidade_medida_id']),
          acao: String(x['acao']),
          mensagem: String(x['mensagem']),
          ativo: bool(x['ativo']),
        })),
        configuracoes: configuracoes.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          regra: num(x['regra_alerta_id']),
          regraCodigo: String(x['regra_codigo']),
          tipo: String(x['tipo']),
          todosEstabelecimentos: x['estabelecimento_id'] === null,
          setor: numOuNull(x['setor_funcional_id']),
          gatilhoItem: numOuNull(x['gatilho_item_prescritivel_id']),
          comportamento: String(x['comportamento']),
          vigenciaInicio: txt(x['ini']),
          vigenciaFim: txt(x['fim']),
          ativo: bool(x['ativo']),
        })),
        apoio: { regras, setores, vias, sexos, unidades },
      };
    });
  }

  // ── gravação ──────────────────────────────────────────────────────────────────────────────────

  private async contexto(c: ContextoGravacaoCatalogo): Promise<ContextoOperacao> {
    const q = await this.ler(c, async (_l, est, usuario) => ({ est, usuario }));
    if (q.usuario === null) recusar(422, 'usuario-sem-conta', 'A gravação exige uma conta do cliente.');
    return {
      cliente: this.cliente,
      estabelecimento: q.est,
      usuario: q.usuario!,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  private async executar<E>(
    c: ContextoGravacaoCatalogo,
    nome: string,
    tabela: (typeof TABELAS)[number],
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

  /** Inclui, ou altera com a versão lida (a linha de outro estabelecimento não se altera daqui). */
  private static async gravarLinha(
    tx: TxOperacao,
    tabela: (typeof TABELAS)[number],
    e: { id?: number | undefined; versao?: number | undefined },
    valores: Record<string, unknown>,
    est: number,
  ): Promise<Gravado> {
    if (!e.id) return { id: await tx.incluir(tabela, valores), versao: 1 };
    if (!e.versao) recusar(400, 'versao-obrigatoria', 'Informe a versão lida.', 'versao');
    const sql =
      tabela === 'ajuste_dose_renal'
        ? 'SELECT id FROM ajuste_dose_renal WHERE id = ?'
        : tabela === 'restricao_posologia'
          ? 'SELECT id FROM restricao_posologia WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)'
          : 'SELECT id FROM configuracao_alerta_prescricao WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)';
    if (!(await tx.uma(sql, tabela === 'ajuste_dose_renal' ? [e.id] : [e.id, est])))
      recusar(404, 'registro-inexistente', 'O registro não existe neste cliente.');
    return { id: e.id, versao: await tx.alterar(tabela, e.id, e.versao!, valores) };
  }

  private static async conferirAlvo(tx: TxOperacao, item: number | null, principio: number | null) {
    if (item === null && principio === null)
      recusar(422, 'alvo-obrigatorio', 'Escolha o item ou o princípio ativo.', 'item');
    if (item !== null && !(await tx.uma('SELECT id FROM item_prescritivel WHERE id = ?', [item])))
      recusar(404, 'registro-inexistente', 'O item não existe neste cliente.', 'item');
    if (principio !== null && !(await tx.uma('SELECT id FROM principio_ativo WHERE id = ?', [principio])))
      recusar(404, 'registro-inexistente', 'O princípio ativo não existe neste cliente.', 'principio');
  }

  gravarAjusteRenal(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.restricoes.ajuste_dose_renal',
      'ajuste_dose_renal',
      esquemaAjuste as unknown as z.ZodType<EntradaAjusteRenal>,
      entrada,
      async (tx, e, est) => {
        recusarProblemas(problemasFaixaRenal(e));
        await CadastroRestricoesPrescricaoPropria.conferirAlvo(tx, e.item, e.principio);
        if (e.doseMaxima !== null && e.unidade === null)
          recusar(422, 'unidade-obrigatoria', 'A dose máxima pede a unidade.', 'unidade');
        return CadastroRestricoesPrescricaoPropria.gravarLinha(
          tx,
          'ajuste_dose_renal',
          e,
          {
            item_prescritivel_id: e.item,
            principio_ativo_id: e.principio,
            criterio: e.criterio,
            faixa_minima: e.faixaMinima,
            faixa_maxima: e.faixaMaxima,
            classe_hepatica: e.classeHepatica,
            modalidade_dialise: e.modalidadeDialise,
            ajuste: e.ajuste,
            percentual_dose: e.percentualDose,
            dose_maxima: e.doseMaxima,
            unidade_medida_id: e.unidade,
            intervalo_horas: e.intervaloHoras,
            comportamento: e.comportamento,
            orientacao: e.orientacao,
            ativo: e.ativo,
          },
          est,
        );
      },
    );
  }

  gravarRestricao(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.restricoes.restricao_posologia',
      'restricao_posologia',
      esquemaRestricao as unknown as z.ZodType<EntradaRestricaoPosologia>,
      entrada,
      async (tx, e, est) => {
        recusarProblemas(
          problemasRestricao({ ...e, via: e.via === null ? null : String(e.via), setor: e.setor }),
        );
        await CadastroRestricoesPrescricaoPropria.conferirAlvo(tx, e.item, e.principio);
        if (e.tipo === 'forma_proibida' && (e.forma === null || e.item === null))
          recusar(422, 'forma-exige-item', 'Forma proibida pede o item e a forma.', 'forma');
        if (e.tipo === 'dose_maxima' && e.unidade === null)
          recusar(422, 'unidade-obrigatoria', 'O limite de dose pede a unidade.', 'unidade');
        if (
          e.setor !== null &&
          !(await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
            e.setor,
            est,
          ]))
        )
          recusar(404, 'registro-inexistente', 'O setor não existe neste estabelecimento.', 'setor');
        return CadastroRestricoesPrescricaoPropria.gravarLinha(
          tx,
          'restricao_posologia',
          e,
          {
            estabelecimento_id: e.todosEstabelecimentos ? null : est,
            item_prescritivel_id: e.item,
            principio_ativo_id: e.principio,
            setor_funcional_id: e.setor,
            via_de_uso_id: e.via,
            forma_apresentacao_medicamento_id: e.forma,
            sexo_id: e.sexo,
            idade_minima_dias: e.idadeMinimaDias,
            idade_maxima_dias: e.idadeMaximaDias,
            peso_minimo_kg: e.pesoMinimoKg,
            peso_maximo_kg: e.pesoMaximoKg,
            gestante: e.gestante,
            lactante: e.lactante,
            tipo_restricao: e.tipo,
            dose_maxima: e.doseMaxima,
            dose_maxima_diaria: e.doseMaximaDiaria,
            unidade_medida_id: e.unidade,
            acao: e.acao,
            mensagem: e.mensagem,
            ativo: e.ativo,
          },
          est,
        );
      },
    );
  }

  gravarConfiguracao(c: ContextoGravacaoCatalogo, entrada: unknown): Promise<Gravado> {
    return this.executar(
      c,
      'pep.restricoes.configuracao_alerta',
      'configuracao_alerta_prescricao',
      esquemaConfiguracao as unknown as z.ZodType<EntradaConfiguracaoAlerta>,
      entrada,
      async (tx, e, est) => {
        if (e.vigenciaInicio && e.vigenciaFim && e.vigenciaFim < e.vigenciaInicio)
          recusar(422, 'vigencia-invertida', 'O fim da vigência vem antes do início.', 'vigenciaFim');
        if (
          !(await tx.uma(
            'SELECT id FROM regra_alerta WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)',
            [e.regra, est],
          ))
        )
          recusar(
            404,
            'registro-inexistente',
            'A regra de alerta não existe neste estabelecimento.',
            'regra',
          );
        if (
          e.setor !== null &&
          !(await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
            e.setor,
            est,
          ]))
        )
          recusar(404, 'registro-inexistente', 'O setor não existe neste estabelecimento.', 'setor');
        const estab = e.todosEstabelecimentos ? null : est;
        const igual = await tx.uma(
          `SELECT id FROM configuracao_alerta_prescricao WHERE regra_alerta_id = ? AND estabelecimento_id <=> ?
              AND setor_funcional_id <=> ? AND gatilho_item_prescritivel_id <=> ? AND id <> ?`,
          [e.regra, estab, e.setor, e.gatilhoItem, e.id ?? 0],
        );
        if (igual)
          recusar(
            409,
            'configuracao-repetida',
            'Já há configuração desta regra neste escopo: altere a existente.',
          );
        return CadastroRestricoesPrescricaoPropria.gravarLinha(
          tx,
          'configuracao_alerta_prescricao',
          e,
          {
            regra_alerta_id: e.regra,
            estabelecimento_id: estab,
            setor_funcional_id: e.setor,
            gatilho_item_prescritivel_id: e.gatilhoItem,
            comportamento: e.comportamento,
            vigencia_inicio: e.vigenciaInicio,
            vigencia_fim: e.vigenciaFim,
            ativo: e.ativo,
          },
          est,
        );
      },
    );
  }
}
