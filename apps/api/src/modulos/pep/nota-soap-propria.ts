// Nota clínica em quatro partes (subjetivo, objetivo, avaliação e plano) codificada (03-PEP L98), no banco próprio do
// cliente. Regras no domínio (@sgh/dominio-pep, nota-soap.ts); aqui ficam a leitura (configuração aplicável, busca de
// CID-10 e CIAP-2, correspondência CIAP-2 → CID-10 e as notas do paciente) e a gravação pelo executor (trilha na mesma
// transação): rascunho (nota_soap + nota_soap_codigo), alteração do rascunho só pelo autor (os códigos trocados ficam
// excluídos logicamente, a numeração segue), assinatura (valida as partes obrigatórias e o CID-10 da avaliação; o código
// marcado para a lista de problemas cria o problema do paciente, ou liga ao problema ativo com o mesmo código) e sem
// efeito (com justificativa quando assinada). Nada é apagado. Configuração por estabelecimento e especialidade em
// configuracao_nota_soap (usa_ciap e exige_cid_avaliacao pela migração 06_PEP/99_nota_soap_ciap).
import {
  acaoNotaSoap,
  atendimentoAceitaNota,
  CODIGOS_NOTA_SOAP_MAXIMO,
  type CodigoNotaSoap,
  type ConfiguracaoNotaSoap,
  configuracaoNotaAplicavel,
  type CorrespondenciaCiapCid,
  CRITICIDADES_NOTA_SOAP,
  EDEMAS_NOTA_SOAP,
  type FalhaRegra,
  NOTA_CODIGO_MAXIMA,
  type NotaSoapEntrada,
  PARTES_SOAP,
  type SituacaoNotaSoap,
  type TermoCodigoNota,
  TEXTO_PARTE_SOAP_MAXIMO,
  TIPOS_NOTA_SOAP,
  validarConfiguracaoNota,
  validarNotaSoap,
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
const bool = (v: unknown): boolean => Boolean(Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const dataTxt = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const id = z.number().int().positive();
const texto = z.string().max(TEXTO_PARTE_SOAP_MAXIMO).nullable().default(null);

const esquemaCodigo = z
  .object({
    parte: z.enum(PARTES_SOAP),
    ciap: id.nullable().default(null),
    cid: id.nullable().default(null),
    nota: z.string().max(NOTA_CODIGO_MAXIMA).nullable().default(null),
    incluirListaProblemas: z.boolean().default(false),
  })
  .strict();
const camposNota = {
  tipo: z.enum(TIPOS_NOTA_SOAP).default('consulta'),
  subjetivo: texto,
  objetivo: texto,
  avaliacao: texto,
  plano: texto,
  criticidade: z.enum(CRITICIDADES_NOTA_SOAP).nullable().default(null),
  dataUltimaMenstruacao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  edema: z.enum(EDEMAS_NOTA_SOAP).nullable().default(null),
  codigos: z.array(esquemaCodigo).max(CODIGOS_NOTA_SOAP_MAXIMO).default([]),
};
export const esquemaNotaSoap = z.object({ atendimento: id, ...camposNota }).strict();
export const esquemaAlterarNotaSoap = z.object({ nota: id, versao: id, ...camposNota }).strict();
export const esquemaAssinarNotaSoap = z.object({ nota: id, versao: id }).strict();
export const esquemaSemEfeitoNotaSoap = z
  .object({ nota: id, versao: id, justificativa: z.string().max(1000).nullable().default(null) })
  .strict();
export const esquemaConfiguracaoNotaSoap = z
  .object({
    id: id.nullable().default(null),
    versao: id.nullable().default(null),
    estabelecimento: id.nullable().default(null),
    especialidade: id.nullable().default(null),
    descricao: z.string().min(1).max(150),
    exigeSubjetivo: z.boolean().default(false),
    exigeObjetivo: z.boolean().default(false),
    exigeAvaliacao: z.boolean().default(true),
    exigePlano: z.boolean().default(true),
    usaCiap: z.boolean().default(false),
    exigeCidAvaliacao: z.boolean().default(true),
    ativo: z.boolean().default(true),
  })
  .strict();
export type EntradaNotaSoap = z.infer<typeof esquemaNotaSoap>;
export type EntradaAlterarNotaSoap = z.infer<typeof esquemaAlterarNotaSoap>;
export type EntradaAssinarNotaSoap = z.infer<typeof esquemaAssinarNotaSoap>;
export type EntradaSemEfeitoNotaSoap = z.infer<typeof esquemaSemEfeitoNotaSoap>;
export type EntradaConfiguracaoNotaSoap = z.infer<typeof esquemaConfiguracaoNotaSoap>;

export interface NucleoNotaSoap {
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
export interface ContextoNotaSoap {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoNotaSoap = ContextoNotaSoap & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface TermoLido {
  readonly id: number;
  readonly sistema: 'ciap2' | 'cid10';
  readonly codigo: string;
  readonly descricao: string;
}
export interface ConfiguracaoLida extends ConfiguracaoNotaSoap {
  readonly descricao: string;
  readonly versao: number;
}
export interface NotaLida {
  readonly id: number;
  readonly versao: number;
  readonly atendimento: number;
  readonly tipo: string;
  readonly situacao: SituacaoNotaSoap;
  readonly registradaEm: string | null;
  readonly assinadaEm: string | null;
  readonly autor: string | null;
  readonly podeEditar: boolean;
  readonly subjetivo: string | null;
  readonly objetivo: string | null;
  readonly avaliacao: string | null;
  readonly plano: string | null;
  readonly criticidade: string | null;
  readonly dataUltimaMenstruacao: string | null;
  readonly dataProvavelParto: string | null;
  readonly idadeGestacionalDias: number | null;
  readonly edema: string | null;
  readonly codigos: readonly {
    sequencia: number;
    parte: string;
    ciap: TermoLido | null;
    cid: TermoLido | null;
    nota: string | null;
    incluirListaProblemas: boolean;
    problema: number | null;
  }[];
}
export interface NotasDoPaciente {
  readonly atendimentos: readonly {
    id: number;
    numero: string;
    entradaEm: string | null;
    situacao: string;
    configuracao: ConfiguracaoNotaSoap;
  }[];
  readonly notas: readonly NotaLida[];
}
type ResultadoNota = {
  readonly nota: number;
  readonly versao: number;
  readonly situacao: SituacaoNotaSoap;
  /** Avisos da validação, separados por ' | ' (vazio: nenhum). */
  readonly avisos: string;
  /** Problemas do paciente criados ou ligados na assinatura, separados por vírgula. */
  readonly problemas: string;
};

const recusar = (f: readonly FalhaRegra[]): never => {
  throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '));
};
const naoEncontrada = () =>
  new ErroOperacao(
    404,
    'nota-inexistente',
    'Nota não encontrada',
    'A nota não existe neste estabelecimento.',
  );
const CORR = 'pep.notaSoap';
const COLS_CONFIG = `id, estabelecimento_id, especialidade_medica_id, descricao, exige_subjetivo, exige_objetivo,
  exige_avaliacao, exige_plano, usa_ciap, exige_cid_avaliacao, ativo, versao`;
const configDe = (r: Record<string, unknown>): ConfiguracaoLida => ({
  id: num(r['id']),
  estabelecimentoId: numOuNull(r['estabelecimento_id']),
  especialidadeId: numOuNull(r['especialidade_medica_id']),
  descricao: String(r['descricao']),
  exigeSubjetivo: bool(r['exige_subjetivo']),
  exigeObjetivo: bool(r['exige_objetivo']),
  exigeAvaliacao: bool(r['exige_avaliacao']),
  exigePlano: bool(r['exige_plano']),
  usaCiap: bool(r['usa_ciap']),
  exigeCidAvaliacao: bool(r['exige_cid_avaliacao']),
  ativo: bool(r['ativo']),
  versao: num(r['versao']),
});
const SQL_TERMOS = `SELECT tt.id, t.codigo AS sistema, tt.codigo_termo, tt.descricao, tt.ativo
  FROM termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id`;
const termoDe = (r: Record<string, unknown>): TermoLido => ({
  id: num(r['id']),
  sistema: String(r['sistema']) as 'ciap2' | 'cid10',
  codigo: String(r['codigo_termo']),
  descricao: String(r['descricao']),
});
const entradaDominio = (e: Omit<EntradaNotaSoap, 'atendimento'>): NotaSoapEntrada => ({
  tipo: e.tipo,
  subjetivo: e.subjetivo,
  objetivo: e.objetivo,
  avaliacao: e.avaliacao,
  plano: e.plano,
  criticidade: e.criticidade,
  dataUltimaMenstruacao: e.dataUltimaMenstruacao,
  edema: e.edema,
  codigos: e.codigos.map((c): CodigoNotaSoap => ({
    parte: c.parte,
    ciapId: c.ciap,
    cidId: c.cid,
    nota: c.nota,
    incluirListaProblemas: c.incluirListaProblemas,
  })),
});

export class NotaSoapPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opCriar = definirOperacao<EntradaNotaSoap, ResultadoNota>({
    nome: 'pep.nota_soap.criar',
    tabelas: ['nota_soap', 'nota_soap_codigo'],
    entrada: esquemaNotaSoap as unknown as z.ZodType<EntradaNotaSoap>,
    gravar: (tx, e) => this.criar(tx, e),
    alvo: (_e, r) => ({ tabela: 'nota_soap', id: r.nota }),
    trilha: (_e, r) => ({ dados: { situacao: r.situacao } }),
  });
  private readonly opAlterar = definirOperacao<EntradaAlterarNotaSoap, ResultadoNota>({
    nome: 'pep.nota_soap.alterar',
    tabelas: ['nota_soap', 'nota_soap_codigo'],
    entrada: esquemaAlterarNotaSoap as unknown as z.ZodType<EntradaAlterarNotaSoap>,
    gravar: (tx, e) => this.alterar(tx, e),
    alvo: (_e, r) => ({ tabela: 'nota_soap', id: r.nota }),
  });
  private readonly opAssinar = definirOperacao<EntradaAssinarNotaSoap, ResultadoNota>({
    nome: 'pep.nota_soap.assinar',
    tabelas: ['nota_soap', 'nota_soap_codigo', 'problema_paciente'],
    entrada: esquemaAssinarNotaSoap as unknown as z.ZodType<EntradaAssinarNotaSoap>,
    gravar: (tx, e) => this.assinar(tx, e),
    alvo: (_e, r) => ({ tabela: 'nota_soap', id: r.nota }),
    trilha: (_e, r) => ({ dados: { situacao: r.situacao, problemas: r.problemas } }),
  });
  private readonly opSemEfeito = definirOperacao<EntradaSemEfeitoNotaSoap, ResultadoNota>({
    nome: 'pep.nota_soap.sem_efeito',
    tabelas: ['nota_soap'],
    entrada: esquemaSemEfeitoNotaSoap as unknown as z.ZodType<EntradaSemEfeitoNotaSoap>,
    gravar: (tx, e) => this.semEfeito(tx, e),
    alvo: (_e, r) => ({ tabela: 'nota_soap', id: r.nota }),
    trilha: (e) => ({ dados: { justificativa: e.justificativa } }),
  });
  private readonly opConfigurar = definirOperacao<
    EntradaConfiguracaoNotaSoap,
    { id: number; versao: number }
  >({
    nome: 'pep.nota_soap.configurar',
    tabelas: ['configuracao_nota_soap'],
    entrada: esquemaConfiguracaoNotaSoap as unknown as z.ZodType<EntradaConfiguracaoNotaSoap>,
    gravar: (tx, e) => this.configurar(tx, e),
    alvo: (_e, r) => ({ tabela: 'configuracao_nota_soap', id: r.id }),
  });

  constructor(
    private readonly nucleo: NucleoNotaSoap,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: CORR }, fn);
  }

  private quem(c: ContextoNotaSoap) {
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
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
    });
  }

  pacienteExiste(paciente: number): Promise<boolean> {
    return this.ler(async (l) =>
      Boolean(await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente])),
    );
  }

  /** O paciente do atendimento ou da nota (o vínculo assistencial é conferido antes de gravar); null se não existe. */
  pacienteDe(alvo: { atendimento: number } | { nota: number }): Promise<number | null> {
    return this.ler(async (l) => {
      const x =
        'atendimento' in alvo
          ? await l.uma('SELECT paciente_id FROM atendimento WHERE id = ? AND excluido_em IS NULL', [
              alvo.atendimento,
            ])
          : await l.uma('SELECT paciente_id FROM nota_soap WHERE id = ? AND excluido_em IS NULL', [
              alvo.nota,
            ]);
      return x ? num(x['paciente_id']) : null;
    });
  }

  /** CID-10 (categoria e subcategoria) ou CIAP-2 (código) ativos pelo código ou pela descrição; até 30. */
  termos(sistema: 'cid10' | 'ciap2', busca: string): Promise<TermoLido[]> {
    const q = busca.trim().slice(0, 60);
    if (q.length < 2) return Promise.resolve([]);
    const nivel = sistema === 'cid10' ? 3 : 2;
    return this.ler(async (l) =>
      (
        await l.consultar(
          `${SQL_TERMOS} WHERE t.codigo = ? AND tt.ativo = TRUE AND tt.nivel >= ?
             AND (tt.codigo_termo LIKE ? OR tt.codigo_termo LIKE ? OR tt.descricao LIKE ?)
           ORDER BY tt.codigo_termo LIKE ? DESC, tt.codigo_termo LIMIT 30`,
          [
            sistema,
            nivel,
            `${q.toUpperCase()}%`,
            `${q.toUpperCase().replace('.', '')}%`,
            `%${q}%`,
            `${q.toUpperCase()}%`,
          ],
        )
      ).map(termoDe),
    );
  }

  /** CID-10 correspondentes ao código da CIAP-2 (o preferencial primeiro). */
  correspondencia(ciap: number): Promise<TermoLido[]> {
    return this.ler(async (l) =>
      (
        await l.consultar(
          `${SQL_TERMOS} JOIN correspondencia_ciap_cid c ON c.cid_termo_terminologia_id = tt.id
            WHERE c.ciap_termo_terminologia_id = ? AND c.excluido_em IS NULL AND tt.ativo = TRUE
            ORDER BY c.preferencial DESC, tt.codigo_termo`,
          [ciap],
        )
      ).map(termoDe),
    );
  }

  configuracoes(): Promise<ConfiguracaoLida[]> {
    return this.ler(async (l) =>
      (
        await l.consultar(
          `SELECT ${COLS_CONFIG} FROM configuracao_nota_soap ORDER BY estabelecimento_id IS NULL, estabelecimento_id,
             especialidade_medica_id IS NULL, especialidade_medica_id, id`,
        )
      ).map(configDe),
    );
  }

  /** Atendimentos do paciente (os mais novos; com a configuração que vale para cada um) e as notas dele. */
  async doPaciente(c: ContextoNotaSoap, paciente: number): Promise<NotasDoPaciente> {
    const q = await this.quem(c);
    const configs = await this.configuracoes();
    return this.ler(async (l) => {
      const atends = await l.consultar(
        `SELECT id, numero, entrada_em, situacao, estabelecimento_id, especialidade_medica_id FROM atendimento
          WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'
          ORDER BY entrada_em DESC, id DESC LIMIT 20`,
        [paciente, q.estabelecimento],
      );
      const notas = await l.consultar(
        `SELECT n.*, u.nome AS autor_nome FROM nota_soap n LEFT JOIN usuario u ON u.id = n.criado_por
          WHERE n.paciente_id = ? AND n.excluido_em IS NULL ORDER BY n.registrada_em DESC, n.id DESC LIMIT 50`,
        [paciente],
      );
      const ids = notas.map((n) => num(n['id']));
      const marcasNotas = ids.map(() => '?').join(',');
      const cods = ids.length
        ? await l.consultar(
            `SELECT nota_soap_id, sequencia, parte, ciap_termo_terminologia_id, cid_termo_terminologia_id, nota,
                    incluir_lista_problemas, problema_paciente_id
               FROM nota_soap_codigo WHERE nota_soap_id IN (${marcasNotas}) AND excluido_em IS NULL
              ORDER BY nota_soap_id, sequencia`,
            ids,
          )
        : [];
      const tIds = [
        ...new Set(
          cods.flatMap((x) => [
            numOuNull(x['ciap_termo_terminologia_id']),
            numOuNull(x['cid_termo_terminologia_id']),
          ]),
        ),
      ].filter((x): x is number => x !== null);
      const marcasTermos = tIds.map(() => '?').join(',');
      const termos = new Map(
        (tIds.length ? await l.consultar(`${SQL_TERMOS} WHERE tt.id IN (${marcasTermos})`, tIds) : []).map(
          (r) => [num(r['id']), termoDe(r)],
        ),
      );
      const termo = (v: unknown) => (numOuNull(v) === null ? null : (termos.get(num(v)) ?? null));
      return {
        atendimentos: atends.map((a) => ({
          id: num(a['id']),
          numero: String(a['numero']),
          entradaEm: iso(a['entrada_em']),
          situacao: String(a['situacao']),
          configuracao: configuracaoNotaAplicavel(
            configs,
            num(a['estabelecimento_id']),
            numOuNull(a['especialidade_medica_id']),
          ),
        })),
        notas: notas.map((n) => ({
          id: num(n['id']),
          versao: num(n['versao']),
          atendimento: num(n['atendimento_id']),
          tipo: String(n['tipo']),
          situacao: String(n['situacao']) as SituacaoNotaSoap,
          registradaEm: iso(n['registrada_em']),
          assinadaEm: iso(n['assinada_em']),
          autor: txt(n['autor_nome']),
          podeEditar: String(n['situacao']) === 'rascunho' && numOuNull(n['criado_por']) === q.usuario,
          subjetivo: txt(n['subjetivo']),
          objetivo: txt(n['objetivo']),
          avaliacao: txt(n['avaliacao']),
          plano: txt(n['plano']),
          criticidade: txt(n['criticidade']),
          dataUltimaMenstruacao: dataTxt(n['data_ultima_menstruacao']),
          dataProvavelParto: dataTxt(n['data_provavel_parto']),
          idadeGestacionalDias: numOuNull(n['idade_gestacional_dias']),
          edema: txt(n['edema']),
          codigos: cods
            .filter((x) => num(x['nota_soap_id']) === num(n['id']))
            .map((x) => ({
              sequencia: num(x['sequencia']),
              parte: String(x['parte']),
              ciap: termo(x['ciap_termo_terminologia_id']),
              cid: termo(x['cid_termo_terminologia_id']),
              nota: txt(x['nota']),
              incluirListaProblemas: bool(x['incluir_lista_problemas']),
              problema: numOuNull(x['problema_paciente_id']),
            })),
        })),
      };
    });
  }

  private async executar<E, S extends { nota?: number; id?: number; versao: number }>(
    c: ContextoGravacaoNotaSoap,
    op: Parameters<Executor['executar']>[0],
    entrada: unknown,
  ) {
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
    const r = await this.executor.executar(op as never, this.cliente, entrada as E, ctx);
    return { resultado: r.resultado as unknown as S, repetida: r.repetida };
  }

  criarNota(c: ContextoGravacaoNotaSoap, entrada: unknown) {
    return this.executar<EntradaNotaSoap, ResultadoNota>(c, this.opCriar as never, entrada);
  }
  alterarNota(c: ContextoGravacaoNotaSoap, entrada: unknown) {
    return this.executar<EntradaAlterarNotaSoap, ResultadoNota>(c, this.opAlterar as never, entrada);
  }
  assinarNota(c: ContextoGravacaoNotaSoap, entrada: unknown) {
    return this.executar<EntradaAssinarNotaSoap, ResultadoNota>(c, this.opAssinar as never, entrada);
  }
  semEfeitoNota(c: ContextoGravacaoNotaSoap, entrada: unknown) {
    return this.executar<EntradaSemEfeitoNotaSoap, ResultadoNota>(c, this.opSemEfeito as never, entrada);
  }
  gravarConfiguracao(c: ContextoGravacaoNotaSoap, entrada: unknown) {
    return this.executar<EntradaConfiguracaoNotaSoap, { id: number; versao: number }>(
      c,
      this.opConfigurar as never,
      entrada,
    );
  }

  // ------------------------------------------------------------------ gravação (dentro da transação do executor)
  private async configPara(tx: TxOperacao, estabelecimento: number, especialidade: number | null) {
    const linhas = await tx.consultar(`SELECT ${COLS_CONFIG} FROM configuracao_nota_soap WHERE ativo = TRUE`);
    return configuracaoNotaAplicavel(linhas.map(configDe), estabelecimento, especialidade);
  }

  private async termosDe(tx: TxOperacao, n: NotaSoapEntrada) {
    const ids = [...new Set(n.codigos.flatMap((c) => [c.ciapId, c.cidId]))].filter(
      (x): x is number => x !== null,
    );
    const termos = new Map<number, TermoCodigoNota>();
    const corr: CorrespondenciaCiapCid[] = [];
    if (!ids.length) return { termos, corr };
    const marcas = ids.map(() => '?').join(',');
    for (const r of await tx.consultar(`${SQL_TERMOS} WHERE tt.id IN (${marcas})`, ids))
      termos.set(num(r['id']), {
        id: num(r['id']),
        sistema: String(r['sistema']) === 'ciap2' ? 'ciap2' : 'cid10',
        codigo: String(r['codigo_termo']),
        ativo: bool(r['ativo']) && ['ciap2', 'cid10'].includes(String(r['sistema'])),
      });
    for (const r of await tx.consultar(
      `SELECT ciap_termo_terminologia_id, cid_termo_terminologia_id, preferencial FROM correspondencia_ciap_cid
        WHERE ciap_termo_terminologia_id IN (${marcas}) AND excluido_em IS NULL`,
      ids,
    ))
      corr.push({
        ciapId: num(r['ciap_termo_terminologia_id']),
        cidId: num(r['cid_termo_terminologia_id']),
        preferencial: bool(r['preferencial']),
      });
    return { termos, corr };
  }

  private async profissional(tx: TxOperacao): Promise<number> {
    const p = await tx.uma(
      `SELECT profissional_id FROM usuario_profissional WHERE usuario_id = ? AND excluido_em IS NULL
          AND vigencia_inicio <= UTC_DATE() AND (vigencia_fim IS NULL OR vigencia_fim >= UTC_DATE())
        ORDER BY vigencia_inicio DESC, id DESC LIMIT 1`,
      [tx.contexto.usuario],
    );
    if (!p)
      throw recusa(
        'sem-profissional',
        'A nota clínica é escrita por profissional: a conta não tem profissional vigente.',
      );
    return num(p['profissional_id']);
  }

  private async validar(
    tx: TxOperacao,
    n: NotaSoapEntrada,
    estabelecimento: number,
    especialidade: number | null,
    momento: 'rascunho' | 'assinatura',
    registradaEm: Date,
  ) {
    const config = await this.configPara(tx, estabelecimento, especialidade);
    const { termos, corr } = await this.termosDe(tx, n);
    const v = validarNotaSoap(n, config, termos, momento, registradaEm, corr);
    if (v.falhas.length) recusar(v.falhas);
    return v;
  }

  private async gravarCodigos(tx: TxOperacao, nota: number, codigos: readonly CodigoNotaSoap[]) {
    const ultima = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS n FROM nota_soap_codigo WHERE nota_soap_id = ?',
      [nota],
    );
    let seq = num(ultima?.['n'] ?? 0);
    for (const c of codigos) {
      seq += 1;
      await tx.incluir('nota_soap_codigo', {
        nota_soap_id: nota,
        sequencia: seq,
        parte: c.parte,
        ciap_termo_terminologia_id: c.ciapId,
        cid_termo_terminologia_id: c.cidId,
        nota: c.nota ?? null,
        incluir_lista_problemas: c.incluirListaProblemas,
        origem: 'sistema',
      });
    }
  }

  private async criar(tx: TxOperacao, e: EntradaNotaSoap): Promise<ResultadoNota> {
    const a = await tx.uma(
      `SELECT id, paciente_id, situacao, especialidade_medica_id FROM atendimento
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.atendimento, tx.contexto.estabelecimento],
    );
    if (!a)
      throw new ErroOperacao(
        404,
        'atendimento-inexistente',
        'Atendimento não encontrado',
        'O atendimento não existe neste estabelecimento.',
      );
    const fa = atendimentoAceitaNota(String(a['situacao']));
    if (fa.length) recusar(fa);
    const n = entradaDominio(e);
    const agora = this.agora();
    const v = await this.validar(
      tx,
      n,
      Number(tx.contexto.estabelecimento),
      numOuNull(a['especialidade_medica_id']),
      'rascunho',
      agora,
    );
    const nota = await tx.incluir('nota_soap', {
      estabelecimento_id: tx.contexto.estabelecimento,
      atendimento_id: e.atendimento,
      paciente_id: num(a['paciente_id']),
      profissional_id: await this.profissional(tx),
      tipo: e.tipo,
      registrada_em: agora,
      subjetivo: e.subjetivo,
      objetivo: e.objetivo,
      avaliacao: e.avaliacao,
      plano: e.plano,
      criticidade: e.criticidade,
      data_ultima_menstruacao: e.dataUltimaMenstruacao,
      data_provavel_parto: v.gestacao?.dataProvavelParto ?? null,
      idade_gestacional_dias: v.gestacao?.idadeGestacionalDias ?? null,
      edema: e.edema,
      situacao: 'rascunho',
      origem: 'sistema',
    });
    await this.gravarCodigos(tx, nota, n.codigos);
    return { nota, versao: 1, situacao: 'rascunho', avisos: v.avisos.join(' | '), problemas: '' };
  }

  private async notaDaUnidade(tx: TxOperacao, nota: number) {
    const n = await tx.uma(
      `SELECT n.*, a.especialidade_medica_id FROM nota_soap n JOIN atendimento a ON a.id = n.atendimento_id
        WHERE n.id = ? AND n.estabelecimento_id = ? AND n.excluido_em IS NULL`,
      [nota, tx.contexto.estabelecimento],
    );
    if (!n) throw naoEncontrada();
    return n;
  }

  private async alterar(tx: TxOperacao, e: EntradaAlterarNotaSoap): Promise<ResultadoNota> {
    const atual = await this.notaDaUnidade(tx, e.nota);
    const fc = acaoNotaSoap(
      {
        situacao: String(atual['situacao']) as SituacaoNotaSoap,
        autorUsuarioId: numOuNull(atual['criado_por']),
      },
      Number(tx.contexto.usuario ?? 0),
      'editar',
    );
    if (fc.length) recusar(fc);
    const n = entradaDominio(e);
    const registradaEm = new Date(String(iso(atual['registrada_em'])));
    const v = await this.validar(
      tx,
      n,
      num(atual['estabelecimento_id']),
      numOuNull(atual['especialidade_medica_id']),
      'rascunho',
      registradaEm,
    );
    const versao = await tx.alterar('nota_soap', e.nota, e.versao, {
      tipo: e.tipo,
      subjetivo: e.subjetivo,
      objetivo: e.objetivo,
      avaliacao: e.avaliacao,
      plano: e.plano,
      criticidade: e.criticidade,
      data_ultima_menstruacao: e.dataUltimaMenstruacao,
      data_provavel_parto: v.gestacao?.dataProvavelParto ?? null,
      idade_gestacional_dias: v.gestacao?.idadeGestacionalDias ?? null,
      edema: e.edema,
    });
    // Os códigos do rascunho são trocados: os anteriores ficam excluídos logicamente (a linha fica); a numeração continua.
    for (const x of await tx.consultar(
      'SELECT id, versao FROM nota_soap_codigo WHERE nota_soap_id = ? AND excluido_em IS NULL',
      [e.nota],
    ))
      await tx.alterar('nota_soap_codigo', num(x['id']), num(x['versao']), {
        excluido_em: this.agora(),
        excluido_por: tx.contexto.usuario ?? null,
      });
    await this.gravarCodigos(tx, e.nota, n.codigos);
    return { nota: e.nota, versao, situacao: 'rascunho', avisos: v.avisos.join(' | '), problemas: '' };
  }

  private async assinar(tx: TxOperacao, e: EntradaAssinarNotaSoap): Promise<ResultadoNota> {
    const atual = await this.notaDaUnidade(tx, e.nota);
    const fc = acaoNotaSoap(
      {
        situacao: String(atual['situacao']) as SituacaoNotaSoap,
        autorUsuarioId: numOuNull(atual['criado_por']),
      },
      Number(tx.contexto.usuario ?? 0),
      'assinar',
    );
    if (fc.length) recusar(fc);
    const cods = await tx.consultar(
      `SELECT id, versao, parte, ciap_termo_terminologia_id, cid_termo_terminologia_id, nota, incluir_lista_problemas
         FROM nota_soap_codigo WHERE nota_soap_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [e.nota],
    );
    const n: NotaSoapEntrada = {
      tipo: String(atual['tipo']) as NotaSoapEntrada['tipo'],
      subjetivo: txt(atual['subjetivo']),
      objetivo: txt(atual['objetivo']),
      avaliacao: txt(atual['avaliacao']),
      plano: txt(atual['plano']),
      criticidade: txt(atual['criticidade']),
      dataUltimaMenstruacao: dataTxt(atual['data_ultima_menstruacao']),
      edema: txt(atual['edema']),
      codigos: cods.map((x) => ({
        parte: String(x['parte']) as CodigoNotaSoap['parte'],
        ciapId: numOuNull(x['ciap_termo_terminologia_id']),
        cidId: numOuNull(x['cid_termo_terminologia_id']),
        nota: txt(x['nota']),
        incluirListaProblemas: bool(x['incluir_lista_problemas']),
      })),
    };
    await this.validar(
      tx,
      n,
      num(atual['estabelecimento_id']),
      numOuNull(atual['especialidade_medica_id']),
      'assinatura',
      new Date(String(iso(atual['registrada_em']))),
    );
    const agora = this.agora();
    const versao = await tx.alterar('nota_soap', e.nota, e.versao, {
      situacao: 'assinada',
      assinada_em: agora,
    });
    // Lista de problemas: liga ao problema ativo do paciente com o mesmo código ou cria o problema.
    const problemas: number[] = [];
    for (const x of cods.filter((c) => bool(c['incluir_lista_problemas']))) {
      const cid = numOuNull(x['cid_termo_terminologia_id']);
      const ciap = numOuNull(x['ciap_termo_terminologia_id']);
      const existente = await tx.uma(
        `SELECT id FROM problema_paciente WHERE paciente_id = ? AND excluido_em IS NULL
            AND situacao IN ('ativo','controlado') AND (cid_termo_terminologia_id = ? OR (? IS NULL AND ciap_termo_terminologia_id = ?))
          ORDER BY id LIMIT 1`,
        [num(atual['paciente_id']), cid, cid, ciap],
      );
      let problema = existente ? num(existente['id']) : 0;
      if (!problema) {
        const d = await tx.uma('SELECT codigo_termo, descricao FROM termo_terminologia WHERE id = ?', [
          cid ?? ciap,
        ]);
        problema = await tx.incluir('problema_paciente', {
          estabelecimento_id: atual['estabelecimento_id'],
          paciente_id: atual['paciente_id'],
          atendimento_id: atual['atendimento_id'],
          tipo: 'diagnostico',
          descricao: `${String(d?.['codigo_termo'] ?? '')} ${String(d?.['descricao'] ?? '')}`
            .trim()
            .slice(0, 500),
          cid_termo_terminologia_id: cid,
          ciap_termo_terminologia_id: ciap,
          situacao: 'ativo',
          comentario: txt(x['nota']),
          registrado_em: agora,
          registrado_por_profissional_id: atual['profissional_id'],
          origem: 'sistema',
        });
      }
      problemas.push(problema);
      await tx.alterar('nota_soap_codigo', num(x['id']), num(x['versao']), {
        problema_paciente_id: problema,
      });
    }
    return { nota: e.nota, versao, situacao: 'assinada', avisos: '', problemas: problemas.join(',') };
  }

  private async semEfeito(tx: TxOperacao, e: EntradaSemEfeitoNotaSoap): Promise<ResultadoNota> {
    const atual = await this.notaDaUnidade(tx, e.nota);
    const fc = acaoNotaSoap(
      {
        situacao: String(atual['situacao']) as SituacaoNotaSoap,
        autorUsuarioId: numOuNull(atual['criado_por']),
      },
      Number(tx.contexto.usuario ?? 0),
      'sem_efeito',
      e.justificativa,
    );
    if (fc.length) recusar(fc);
    const versao = await tx.alterar('nota_soap', e.nota, e.versao, { situacao: 'sem_efeito' });
    return { nota: e.nota, versao, situacao: 'sem_efeito', avisos: '', problemas: '' };
  }

  private async configurar(tx: TxOperacao, e: EntradaConfiguracaoNotaSoap) {
    const f = validarConfiguracaoNota({
      id: e.id,
      estabelecimentoId: e.estabelecimento,
      especialidadeId: e.especialidade,
      descricao: e.descricao,
      exigeSubjetivo: e.exigeSubjetivo,
      exigeObjetivo: e.exigeObjetivo,
      exigeAvaliacao: e.exigeAvaliacao,
      exigePlano: e.exigePlano,
      usaCiap: e.usaCiap,
      exigeCidAvaliacao: e.exigeCidAvaliacao,
      ativo: e.ativo,
    });
    if (f.length) recusar(f);
    const valores = {
      estabelecimento_id: e.estabelecimento,
      especialidade_medica_id: e.especialidade,
      descricao: e.descricao.trim(),
      exige_subjetivo: e.exigeSubjetivo,
      exige_objetivo: e.exigeObjetivo,
      exige_avaliacao: e.exigeAvaliacao,
      exige_plano: e.exigePlano,
      usa_ciap: e.usaCiap,
      exige_cid_avaliacao: e.exigeCidAvaliacao,
      ativo: e.ativo,
    };
    const mesmo = await tx.uma(
      `SELECT id FROM configuracao_nota_soap WHERE estabelecimento_id <=> ? AND especialidade_medica_id <=> ?
          AND id <> COALESCE(?, 0)`,
      [e.estabelecimento, e.especialidade, e.id],
    );
    if (mesmo)
      throw recusa(
        'configuracao-repetida',
        'Já existe configuração para este estabelecimento e especialidade.',
      );
    if (e.id === null) return { id: await tx.incluir('configuracao_nota_soap', valores), versao: 1 };
    if (e.versao === null) throw recusa('versao-obrigatoria', 'Informe a versão da configuração alterada.');
    return { id: e.id, versao: await tx.alterar('configuracao_nota_soap', e.id, e.versao, valores) };
  }
}
