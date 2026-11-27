// Porta do construtor de formulários novos sobre o banco PRÓPRIO do cliente (MariaDB, pelo @sgh/nucleo). O formulário
// novo é o próprio modelo de documento clínico (modelo_documento_clinico: código, título e tipo); cada versão do
// construtor é uma linha de modelo_documento_versao com a definição congelada em `dados` e o ciclo de revisão
// (migração 06_PEP/92_formulario): rascunho → revisão → aprovação por outra pessoa → publicação → aposentadoria. A
// história fica em modelo_documento_evento (só inclusão) e os casos de teste em modelo_documento_caso_teste (troca por
// exclusão lógica). Os modelos são do cliente inteiro (como na porta dos registros): a sessão escolhe só o fuso.
//
// As mesmas recusas da porta de memória (a especificação): código nunca repetido, versão vista, rascunho só no lugar,
// publicado imutável, quatro olhos (quem salvou não aprova nem publica), aposentar só o publicado. Gravações pelo
// Executor (trilha, idempotência e escritas auditadas na mesma transação); nada é apagado (a versão substituída e a
// aposentada continuam legíveis).
//
// Melhoria: publicar a versão já a põe em uso no prontuário deste sistema (o modelo passa a "publicado" com a versão
// apontada; a anterior fica "substituída"), sem ponte com outro sistema: `executar` (a criação do modelo no sistema de
// origem) recusa, e a liberação dela vem fechada em `podeGravar`.
// Melhoria: o banco de perguntas são os campos das versões publicadas dos modelos (modelo_campo), com as opções na
// ordem, a unidade e em quantos modelos o mesmo campo aparece.
import { randomUUID } from 'node:crypto';
import {
  type DefinicaoFormularioNovo,
  type OpcaoFormularioNovo,
  type PerguntaFormularioNovo,
  type TipoPerguntaFormularioNovo,
  TIPOS_REGISTRO_FORMULARIO_NOVO,
  LIMITES_FORMULARIO_NOVO,
} from '@sgh/contratos';
import { CODIGO_DO_TIPO_DE_CAMPO } from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { LiberacaoGravacao, TrilhaDaGravacao } from '../exames/public-api.js';
import type {
  ContextoFormularioNovo,
  GravadorFormularioNovo,
  PortaFormularioNovo,
} from './formulario-novo-porta.js';
import { dataHora, FUSO_PADRAO, fusoValido, type NucleoLeituraPep } from './registro-porta-propria.js';
import type {
  EspecialidadeLida,
  EstadoFormularioNovo,
  EventoFormularioNovoLido,
  FormularioNovoLido,
  PerguntaDoBancoLida,
  PonteFormularioNovo,
} from './tipos-pep.js';
import { FORMATO_VERSAO_MIGRADA } from './tipos-pep.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoFormularioNovo extends NucleoLeituraPep {
  criarExecutor(): Executor;
}

/** Operação do executor que cria o modelo no sistema de origem: não existe no banco próprio. */
export const OPERACAO_PONTE = 'pep.publicarFormularioNovo';
/** Teto do banco de perguntas por busca. */
export const TETO_PERGUNTAS = 50;

export const TABELAS_FORMULARIO_NOVO = [
  'modelo_documento_clinico',
  'modelo_documento_versao',
  'modelo_documento_evento',
  'modelo_documento_caso_teste',
] as const;

const recusa = (codigo: string, detalhe: string) => new ErroOperacao(409, codigo, 'Não gravado', detalhe);

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const json = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);

/** Situação da versão no banco → estado do construtor (a substituída foi publicada e continua imutável). */
const ESTADO_DA_SITUACAO: Readonly<Record<string, EstadoFormularioNovo>> = {
  rascunho: 'rascunho',
  revisao: 'revisao',
  publicada: 'publicado',
  substituida: 'publicado',
  aposentada: 'aposentado',
};
const PONTE_DO_DESTINO: Readonly<Record<string, PonteFormularioNovo>> = {
  so_sistema: 'so-sante',
  modelo_origem: 'modelo-legado',
  registro_resumo: 'registro-resumo',
};
const DESTINO_DA_PONTE: Readonly<Record<PonteFormularioNovo, string>> = {
  'so-sante': 'so_sistema',
  'modelo-legado': 'modelo_origem',
  'registro-resumo': 'registro_resumo',
};
/** Categoria do tipo de documento clínico de cada registro do construtor. */
const CATEGORIA_DO_REGISTRO: Readonly<Record<string, string>> = {
  diagnostico: 'diagnostico',
  evolucao: 'evolucao',
  anamnese: 'anamnese',
  resumo_clinico: 'sumario',
  sumario_alta: 'sumario',
};
/** Vocabulário do construtor (com hífen) ↔ banco (snake_case). */
const doBanco = (v: unknown) => String(v).replace(/_/g, '-');
const paraBanco = (v: string) => v.replace(/-/g, '_');

/** Código do tipo de pergunta do construtor ↔ tipo de campo do modelo (4 = sim/não, uma escolha). */
const CODIGO_DO_TIPO_CAMPO: ReadonlyMap<string, string> = new Map([
  ...Object.entries(CODIGO_DO_TIPO_DE_CAMPO).map(([t, cod]) => [paraBanco(t), cod] as const),
  ['booleano', '4'],
]);
const TIPO_CAMPO_DO_CODIGO: ReadonlyMap<string, string> = new Map(
  [...CODIGO_DO_TIPO_CAMPO].map(([t, cod]) => [cod, t] as const),
);

const COLUNAS_VERSAO = `v.id, m.id AS modelo_id, m.codigo, m.versao AS versao_modelo,
  m.publicada_modelo_documento_versao_id AS publicada_id, v.numero_versao, v.situacao, v.titulo, v.tipo_registro,
  v.formato, v.dados, v.hash_definicao, v.destino_publicacao, v.origem_modelo_documento_versao_id AS baseado_em,
  v.usuario_id AS autor_id, v.aprovacao_usuario_id AS aprovador_id,
  ua.login AS autor, uap.login AS aprovador, v.aprovada_em, v.parecer, up.login AS publicador, v.publicada_em,
  upo.login AS aposentador, v.aposentada_em, v.motivo_aposentadoria, v.versao,
  COALESCE(v.alterado_em, v.criado_em) AS atualizado_em, m.titulo AS titulo_modelo,
  m.tipo_registro AS tipo_registro_modelo`;
const DE_VERSAO = `FROM modelo_documento_versao v
  JOIN modelo_documento_clinico m ON m.id = v.modelo_documento_clinico_id
  LEFT JOIN usuario ua ON ua.id = v.usuario_id
  LEFT JOIN usuario uap ON uap.id = v.aprovacao_usuario_id
  LEFT JOIN usuario up ON up.id = v.publicacao_usuario_id
  LEFT JOIN usuario upo ON upo.id = v.aposentadoria_usuario_id`;
/**
 * As versões do construtor (formato preenchido) e a versão migrada que foi posta em uso (sem formato; publicada,
 * substituída ou aposentada, decisão 61): a comissão a revisa, parte dela numa nova versão e a aposenta. Nunca as
 * descartadas nem as de modelo excluído; as versões históricas migradas (rascunho) ficam fora.
 */
const SO_DO_CONSTRUTOR = `(v.formato IS NOT NULL OR v.situacao IN ('publicada', 'substituida', 'aposentada'))
  AND v.situacao <> 'descartada' AND m.excluido_em IS NULL`;

type Linha = Record<string, unknown>;

/** Campo de uma versão migrada, como a porta o lê (com as opções ativas na ordem). */
export interface CampoMigrado {
  readonly id: number;
  readonly pai: number | null;
  readonly sequencia: number;
  readonly identificador: string;
  readonly titulo: string;
  readonly tipoCampo: string;
  readonly obrigatorio: boolean;
  readonly unidade: string | null;
  readonly minimo: number | null;
  readonly maximo: number | null;
  readonly opcoes: readonly {
    readonly codigo: string;
    readonly rotulo: string;
    readonly pontos: number | null;
  }[];
}

/** Tipo do campo do modelo → tipo de pergunta do construtor (o que o construtor não oferece vai ao mais próximo). */
const TIPO_DO_CAMPO_MIGRADO: Readonly<Record<string, TipoPerguntaFormularioNovo>> = {
  secao: 'secao',
  grupo: 'secao',
  texto: 'texto',
  texto_formatado: 'texto-formatado',
  decimal: 'decimal',
  calculado: 'decimal',
  inteiro: 'inteiro',
  data: 'data',
  data_hora: 'data',
  hora: 'hora',
  booleano: 'escolha',
  escolha: 'escolha',
  escala: 'escolha',
  escolha_com_texto: 'escolha-com-texto',
  multipla: 'multipla',
};

/** Identificador no formato do construtor (minúsculas, dígitos e sublinhado, começando por letra), sem repetir. */
function identificadorUnico(bruto: string, usados: Set<string>, prefixo: string): string {
  let base = bruto.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z]/.test(base)) base = `${prefixo}_${base}`;
  base = base.slice(0, 40);
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base.slice(0, 40 - String(n).length - 1)}_${n}`;
  usados.add(id);
  return id;
}

const cortar = (t: string, limite: number) => t.trim().slice(0, limite).trim();

/**
 * Definição do construtor derivada da versão migrada (que não tem formato do construtor): as perguntas são os campos
 * da versão, na árvore e na ordem gravadas, com as opções ativas. É o ponto de partida da nova versão: o que o
 * construtor não oferece (tipo, classificação do registro) vai ao mais próximo e a comissão revisa antes de publicar.
 * Sem campos, a definição traz uma pergunta de texto livre com o título do modelo (o formato vazio com o mesmo código).
 */
export function definicaoDaVersaoMigrada(m: {
  readonly codigo: string;
  readonly titulo: string;
  readonly tipoRegistro: string;
  readonly campos: readonly CampoMigrado[];
}): DefinicaoFormularioNovo {
  const titulo = cortar(m.titulo, LIMITES_FORMULARIO_NOVO.titulo);
  const tituloModelo = titulo.length >= 3 ? titulo : `Modelo ${m.codigo}`;
  const tipo = doBanco(m.tipoRegistro);
  const tipoRegistro: (typeof TIPOS_REGISTRO_FORMULARIO_NOVO)[number] =
    TIPOS_REGISTRO_FORMULARIO_NOVO.find((t) => t === tipo) ?? 'evolucao';
  const ids = new Set(m.campos.map((c) => c.id));
  const filhos = new Map<number | null, CampoMigrado[]>();
  for (const c of m.campos) {
    const pai = c.pai !== null && ids.has(c.pai) ? c.pai : null;
    filhos.set(pai, [...(filhos.get(pai) ?? []), c]);
  }
  const usados = new Set<string>();
  const pergunta = (c: CampoMigrado): PerguntaFormularioNovo => {
    const tipoPergunta = TIPO_DO_CAMPO_MIGRADO[c.tipoCampo] ?? 'texto';
    const codigos = new Set<string>();
    const opcoes: OpcaoFormularioNovo[] =
      tipoPergunta === 'escolha' || tipoPergunta === 'escolha-com-texto' || tipoPergunta === 'multipla'
        ? (c.opcoes.length === 0 && c.tipoCampo === 'booleano'
            ? [
                { codigo: 'sim', rotulo: 'Sim', pontos: null },
                { codigo: 'nao', rotulo: 'Não', pontos: null },
              ]
            : c.opcoes
          )
            .slice(0, LIMITES_FORMULARIO_NOVO.opcoesPorPergunta)
            .map((o) => ({
              codigo: identificadorUnico(o.codigo, codigos, 'o'),
              texto: cortar(o.rotulo, LIMITES_FORMULARIO_NOVO.textoOpcao) || o.codigo,
              pontos: o.pontos,
            }))
        : [];
    return {
      linkId: identificadorUnico(c.identificador, usados, 'c'),
      tipo: tipoPergunta,
      titulo: cortar(c.titulo, LIMITES_FORMULARIO_NOVO.tituloPergunta) || c.identificador,
      obrigatorio: c.obrigatorio,
      unidade: c.unidade === null ? null : cortar(c.unidade, LIMITES_FORMULARIO_NOVO.unidade) || null,
      minimo: c.minimo,
      maximo: c.maximo,
      opcoes,
      habilitar: null,
      calcular: null,
      reuso: null,
      itens: tipoPergunta === 'secao' ? (filhos.get(c.id) ?? []).map(pergunta) : [],
    };
  };
  const perguntas = (filhos.get(null) ?? []).map(pergunta);
  return {
    codigo: m.codigo,
    titulo: tituloModelo,
    tipoRegistro,
    especialidades: [],
    perguntas:
      perguntas.length > 0
        ? perguntas
        : [
            {
              linkId: 'texto',
              tipo: 'texto',
              titulo: cortar(tituloModelo, LIMITES_FORMULARIO_NOVO.tituloPergunta),
              obrigatorio: false,
              unidade: null,
              minimo: null,
              maximo: null,
              opcoes: [],
              habilitar: null,
              calcular: null,
              reuso: null,
              itens: [],
            },
          ],
  };
}

/** Campos das versões migradas pedidas, com a unidade e as opções ativas, na ordem gravada. */
async function camposMigrados(l: Leitor, ids: readonly number[]): Promise<Map<number, CampoMigrado[]>> {
  const r = new Map<number, CampoMigrado[]>();
  if (ids.length === 0) return r;
  const marcas = ids.map(() => '?').join(', ');
  const campos = await l.consultar(
    `SELECT c.id, c.modelo_documento_versao_id AS v, c.pai_modelo_campo_id AS pai, c.sequencia, c.identificador,
            c.titulo, c.tipo_campo, c.obrigatorio, u.sigla AS unidade, c.valor_minimo, c.valor_maximo
       FROM modelo_campo c LEFT JOIN unidade_resposta u ON u.id = c.unidade_resposta_id
      WHERE c.modelo_documento_versao_id IN (${marcas}) AND c.excluido_em IS NULL
      ORDER BY c.modelo_documento_versao_id, c.sequencia, c.id`,
    [...ids],
  );
  const opcoes = await l.consultar(
    `SELECT o.modelo_campo_id AS campo, o.codigo, o.rotulo, o.pontuacao
       FROM modelo_campo_opcao o JOIN modelo_campo c ON c.id = o.modelo_campo_id
      WHERE c.modelo_documento_versao_id IN (${marcas}) AND c.excluido_em IS NULL
        AND o.excluido_em IS NULL AND o.ativo
      ORDER BY o.modelo_campo_id, o.sequencia, o.id`,
    [...ids],
  );
  const porCampo = new Map<number, CampoMigrado['opcoes'][number][]>();
  for (const o of opcoes) {
    const c = num(o['campo']);
    porCampo.set(c, [
      ...(porCampo.get(c) ?? []),
      { codigo: String(o['codigo']), rotulo: String(o['rotulo']), pontos: numOuNull(o['pontuacao']) },
    ]);
  }
  for (const c of campos) {
    const v = num(c['v']);
    r.set(v, [
      ...(r.get(v) ?? []),
      {
        id: num(c['id']),
        pai: numOuNull(c['pai']),
        sequencia: num(c['sequencia']),
        identificador: String(c['identificador']),
        titulo: String(c['titulo']),
        tipoCampo: String(c['tipo_campo']),
        obrigatorio: Boolean(num(c['obrigatorio'])),
        unidade: textoOuNull(c['unidade']),
        minimo: numOuNull(c['valor_minimo']),
        maximo: numOuNull(c['valor_maximo']),
        opcoes: porCampo.get(num(c['id'])) ?? [],
      },
    ]);
  }
  return r;
}

/** Definição de cada versão migrada entre as linhas lidas (as do construtor não entram). */
async function derivadasDe(
  l: Leitor,
  linhas: readonly Linha[],
): Promise<Map<number, DefinicaoFormularioNovo>> {
  const migradas = linhas.filter((x) => x['formato'] === null || x['formato'] === undefined);
  const campos = await camposMigrados(
    l,
    migradas.map((x) => num(x['id'])),
  );
  return new Map(
    migradas.map((x) => [
      num(x['id']),
      definicaoDaVersaoMigrada({
        codigo: String(x['codigo']),
        titulo: String(x['titulo'] ?? x['titulo_modelo'] ?? ''),
        tipoRegistro: String(x['tipo_registro'] ?? x['tipo_registro_modelo'] ?? ''),
        campos: campos.get(num(x['id'])) ?? [],
      }),
    ]),
  );
}

function versaoLida(
  x: Linha,
  casos: FormularioNovoLido['casos'],
  fuso: string,
  derivada?: DefinicaoFormularioNovo,
): FormularioNovoLido {
  const estado = ESTADO_DA_SITUACAO[String(x['situacao'])];
  if (!estado)
    throw new ErroOperacao(
      500,
      'valor-fora-do-dominio',
      'Valor fora do domínio',
      'A situação da versão veio fora da lista.',
    );
  return {
    id: num(x['id']),
    codigo: String(x['codigo']),
    versao: num(x['numero_versao']),
    estado,
    titulo: derivada ? derivada.titulo : String(x['titulo'] ?? ''),
    tipoRegistro: derivada ? derivada.tipoRegistro : doBanco(x['tipo_registro'] ?? ''),
    formato: derivada ? FORMATO_VERSAO_MIGRADA : String(x['formato']),
    definicao: derivada ?? json(x['dados']),
    contentHash: textoOuNull(x['hash_definicao']),
    ponte: PONTE_DO_DESTINO[String(x['destino_publicacao'])] ?? 'so-sante',
    baseadoEm: numOuNull(x['baseado_em']),
    autor: String(x['autor'] ?? ''),
    aprovadoPor: textoOuNull(x['aprovador']),
    aprovadoEm: dataHora(x['aprovada_em'], fuso),
    parecer: textoOuNull(x['parecer']),
    publicadoPor: textoOuNull(x['publicador']),
    publicadoEm: dataHora(x['publicada_em'], fuso),
    aposentadoPor: textoOuNull(x['aposentador']),
    aposentadoEm: dataHora(x['aposentada_em'], fuso),
    motivoAposentadoria: textoOuNull(x['motivo_aposentadoria']),
    // No banco próprio a versão publicada é o próprio modelo do prontuário: não há modelo de outro sistema ligado.
    idModeloLegado: null,
    codModelo: null,
    versaoLinha: String(num(x['versao'])),
    atualizadoEm: dataHora(x['atualizado_em'], fuso) ?? '',
    casos,
  };
}

async function casosDe(l: Leitor, ids: readonly number[]): Promise<Map<number, FormularioNovoLido['casos']>> {
  const r = new Map<number, { ordem: number; caso: unknown }[]>();
  if (ids.length === 0) return r;
  const linhas = await l.consultar(
    `SELECT modelo_documento_versao_id AS v, ordem, dados FROM modelo_documento_caso_teste
      WHERE modelo_documento_versao_id IN (${ids.map(() => '?').join(', ')}) AND excluido_em IS NULL
      ORDER BY modelo_documento_versao_id, ordem`,
    [...ids],
  );
  for (const x of linhas) {
    const v = num(x['v']);
    r.set(v, [...(r.get(v) ?? []), { ordem: num(x['ordem']), caso: json(x['dados']) }]);
  }
  return r;
}

const escaparLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

export class PortaFormularioNovoPropria implements PortaFormularioNovo {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoFormularioNovo,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoFormularioNovo, rotulo: string, fn: (l: Leitor, fuso: string) => Promise<T>) {
    return this.nucleo.lerSomente(
      { cliente: c.cliente || this.cliente, correlacao: `pep.formularioNovo.${rotulo}` },
      async (l) => fn(l, await this.fuso(l, c.estabelecimento)),
    );
  }

  private async fuso(l: Leitor, estabelecimento: number | null): Promise<string> {
    if (estabelecimento === null) return FUSO_PADRAO;
    const e = await l.uma<{ fuso_horario: unknown }>(
      'SELECT fuso_horario FROM estabelecimento WHERE id = ? AND excluido_em IS NULL',
      [estabelecimento],
    );
    return fusoValido(e?.fuso_horario);
  }

  async podeGravar(c: ContextoFormularioNovo, operacao: string): Promise<LiberacaoGravacao> {
    if (operacao === OPERACAO_PONTE)
      return {
        pode: false,
        codigo: 'operacao-indisponivel',
        motivo:
          'No banco próprio a versão publicada já é o modelo do prontuário: não há modelo a criar em outro sistema.',
      };
    return c.estabelecimento === null
      ? { pode: false, codigo: 'sem-estabelecimento', motivo: 'Escolha o estabelecimento da sessão.' }
      : { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa(
      'operacao-indisponivel',
      'No banco próprio a versão publicada já é o modelo do prontuário: não há modelo a criar em outro sistema.',
    );
  }

  async gravarSgh<T>(
    c: ContextoFormularioNovo,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorFormularioNovo) => Promise<T>,
  ): Promise<T> {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'pep.formulario-novo.gravacao-direta',
      tabelas: TABELAS_FORMULARIO_NOVO,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravador(tx, c.usuario)) };
        return { valor: saida.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => ({
        tabela: linha()?.entidade ?? 'modelo_documento_versao',
        id: linha()?.entidadeId ?? null,
      }),
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `pep.formularioNovo:${randomUUID()}`;
    const ctx: ContextoOperacao = {
      cliente: c.cliente || this.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'pep.formularioNovo',
      chaveIdempotencia: chave,
    };
    const r = await this.executor.executar(op, ctx.cliente, { chave }, ctx);
    return (r.resultado as unknown as { valor: T }).valor;
  }

  versoes(c: ContextoFormularioNovo): Promise<FormularioNovoLido[]> {
    return this.ler(c, 'versoes', async (l, fuso) => {
      const linhas = await l.consultar(`SELECT ${COLUNAS_VERSAO} ${DE_VERSAO} WHERE ${SO_DO_CONSTRUTOR}`);
      const casos = await casosDe(
        l,
        linhas.map((x) => num(x['id'])),
      );
      const derivadas = await derivadasDe(l, linhas);
      return linhas
        .map((x) => versaoLida(x, casos.get(num(x['id'])) ?? [], fuso, derivadas.get(num(x['id']))))
        .sort((a, b) => a.codigo.localeCompare(b.codigo) || b.versao - a.versao);
    });
  }

  versao(c: ContextoFormularioNovo, id: number): Promise<FormularioNovoLido | null> {
    return this.ler(c, 'versao', async (l, fuso) => {
      const x = await l.uma(`SELECT ${COLUNAS_VERSAO} ${DE_VERSAO} WHERE v.id = ? AND ${SO_DO_CONSTRUTOR}`, [
        id,
      ]);
      if (!x) return null;
      const derivada = (await derivadasDe(l, [x])).get(id);
      return versaoLida(x, (await casosDe(l, [id])).get(id) ?? [], fuso, derivada);
    });
  }

  eventos(c: ContextoFormularioNovo, id: number): Promise<EventoFormularioNovoLido[]> {
    return this.ler(c, 'eventos', async (l, fuso) => {
      const linhas = await l.consultar(
        `SELECT e.tipo_evento, u.login, e.ocorrido_em, e.hash_definicao, e.texto
           FROM modelo_documento_evento e JOIN usuario u ON u.id = e.usuario_id
          WHERE e.modelo_documento_versao_id = ?
          ORDER BY e.ocorrido_em, e.id`,
        [id],
      );
      return linhas.map((x) => ({
        tipo: String(x['tipo_evento']) as EventoFormularioNovoLido['tipo'],
        por: String(x['login']),
        em: dataHora(x['ocorrido_em'], fuso) ?? '',
        contentHash: textoOuNull(x['hash_definicao']),
        texto: textoOuNull(x['texto']),
      }));
    });
  }

  codigosEmUso(c: ContextoFormularioNovo): Promise<Set<string>> {
    // Todos os códigos de modelo do cliente, inclusive os excluídos: um código nunca é reaproveitado.
    return this.ler(c, 'codigos', async (l) => {
      const linhas = await l.consultar('SELECT codigo FROM modelo_documento_clinico');
      return new Set(linhas.map((x) => String(x['codigo']).toUpperCase()));
    });
  }

  buscarPerguntas(
    c: ContextoFormularioNovo,
    termo: string,
    tiposperg: readonly string[],
  ): Promise<PerguntaDoBancoLida[]> {
    return this.ler(c, 'perguntas', (l) => perguntas(l, { termo, tiposperg }));
  }

  especialidades(c: ContextoFormularioNovo): Promise<EspecialidadeLida[]> {
    return this.ler(c, 'especialidades', async (l) => {
      const linhas = await l.consultar(
        'SELECT id, descricao FROM especialidade_medica WHERE ativo = TRUE ORDER BY descricao, id',
      );
      return linhas.map((x) => ({ codigo: num(x['id']), nome: String(x['descricao']) }));
    });
  }

  hoje(c: ContextoFormularioNovo): Promise<string> {
    return this.ler(c, 'hoje', async (l, fuso) => {
      const x = await l.uma('SELECT UTC_TIMESTAMP(3) AS agora');
      const v = x?.['agora'];
      const instante = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
      return (dataHora(instante, fuso) ?? '').slice(0, 10);
    });
  }

  async dadosDoPlano(c: ContextoFormularioNovo, codigo: string, reusos: readonly number[]) {
    const codigosExistentes = await this.codigosEmUso(c);
    codigosExistentes.delete(codigo.toUpperCase());
    const banco = reusos.length === 0 ? [] : await this.ler(c, 'plano', (l) => perguntas(l, { ids: reusos }));
    // As opções são do próprio campo (modelo_campo_opcao): não há cadastro de respostas compartilhado.
    return { codigosExistentes, banco, respostasCadastradas: [] };
  }
}

/** Banco de perguntas: os campos das versões publicadas dos modelos, por termo e tipo ou pelos ids. */
async function perguntas(
  l: Leitor,
  f: { termo?: string; tiposperg?: readonly string[]; ids?: readonly number[] },
): Promise<PerguntaDoBancoLida[]> {
  const tipos =
    f.tiposperg && f.tiposperg.length > 0
      ? f.tiposperg.map((t) => TIPO_CAMPO_DO_CODIGO.get(t.trim())).filter((t): t is string => !!t)
      : [...CODIGO_DO_TIPO_CAMPO.keys()];
  if (tipos.length === 0) return [];
  const filtros = [`c.tipo_campo IN (${tipos.map(() => '?').join(', ')})`];
  const p: unknown[] = [...tipos];
  if (f.ids) {
    if (f.ids.length === 0) return [];
    filtros.push(`c.id IN (${f.ids.map(() => '?').join(', ')})`);
    p.push(...f.ids);
  }
  const termo = f.termo?.trim().toUpperCase() ?? '';
  if (termo) {
    filtros.push("UPPER(c.titulo) LIKE CONCAT('%', ?, '%')");
    p.push(escaparLike(termo));
  }
  const linhas = await l.consultar(
    `SELECT c.id, c.titulo, c.tipo_campo, u.sigla, m.situacao,
            (SELECT JSON_ARRAYAGG(o.rotulo ORDER BY o.sequencia) FROM modelo_campo_opcao o
              WHERE o.modelo_campo_id = c.id AND o.ativo = TRUE AND o.excluido_em IS NULL) AS opcoes,
            (SELECT COUNT(DISTINCT m2.id) FROM modelo_campo c2
               JOIN modelo_documento_clinico m2 ON m2.publicada_modelo_documento_versao_id = c2.modelo_documento_versao_id
              WHERE c2.identificador = c.identificador AND c2.excluido_em IS NULL AND m2.excluido_em IS NULL) AS uso
       FROM modelo_campo c
       JOIN modelo_documento_clinico m ON m.publicada_modelo_documento_versao_id = c.modelo_documento_versao_id
       LEFT JOIN unidade_resposta u ON u.id = c.unidade_resposta_id
      WHERE c.excluido_em IS NULL AND m.excluido_em IS NULL AND m.situacao IN ('publicado', 'aposentado')
        AND ${filtros.join(' AND ')}
      ORDER BY c.titulo, c.id
      LIMIT ${TETO_PERGUNTAS}`,
    p,
  );
  return linhas.map((x) => {
    const opcoes = json(x['opcoes']);
    return {
      id: num(x['id']),
      descricao: String(x['titulo']),
      tipoperg: CODIGO_DO_TIPO_CAMPO.get(String(x['tipo_campo'])) ?? '',
      unidade: textoOuNull(x['sigla']),
      ativo: x['situacao'] === 'publicado',
      opcoes: Array.isArray(opcoes) ? opcoes.map(String) : [],
      usoEmModelos: num(x['uso']),
    };
  });
}

/** Gravador das versões do construtor dentro da transação do executor (as recusas da porta de memória). */
function gravador(tx: TxOperacao, usuarioDaSessao: number | null): GravadorFormularioNovo {
  const agora = () => new Date();
  /**
   * Conta de quem grava, resolvida uma vez e de forma estrita: o login tem de existir em usuario e ser a mesma linha do
   * usuário da sessão. Nunca troca um login desconhecido pelo id da sessão (a versão e os eventos ficariam com outra
   * identidade e os quatro olhos não a reconheceriam).
   */
  const contas = new Map<string, number>();
  const conta = async (login: string): Promise<number> => {
    const chave = login.toUpperCase();
    const pronta = contas.get(chave);
    if (pronta !== undefined) return pronta;
    const u = await tx.uma('SELECT id FROM usuario WHERE login = ?', [login]);
    if (!u) throw recusa('usuario-inexistente', 'A conta da sessão não existe neste cliente.');
    const id = num(u['id']);
    if (usuarioDaSessao !== null && id !== usuarioDaSessao)
      throw recusa('usuario-inexistente', 'O login informado não é a conta da sessão neste cliente.');
    contas.set(chave, id);
    return id;
  };
  /** SELECT ... FOR UPDATE (pelo Escritor): a versão e o modelo ficam travados até o fim da transação. */
  const travarUma = async (sql: string, p: unknown[]): Promise<Linha | null> =>
    (await tx.consultarParaAtualizar(sql, p))[0] ?? null;
  const travar = (id: number) =>
    travarUma(`SELECT ${COLUNAS_VERSAO} ${DE_VERSAO} WHERE v.id = ? AND ${SO_DO_CONSTRUTOR}`, [id]);
  const evento = (versao: number, tipo: string, usuario: number, hash: string | null, texto: string | null) =>
    tx.incluir('modelo_documento_evento', {
      modelo_documento_versao_id: versao,
      tipo_evento: tipo,
      usuario_id: usuario,
      ocorrido_em: agora(),
      hash_definicao: hash,
      texto,
    });
  const tipoDocumento = async (tipoRegistro: string): Promise<number> => {
    const categoria = CATEGORIA_DO_REGISTRO[tipoRegistro] ?? 'outro';
    const t = await tx.uma(
      `SELECT id FROM tipo_documento_clinico WHERE categoria IN (?, 'outro') AND ativo = TRUE
        ORDER BY categoria = ? DESC, ordem IS NULL, ordem, id LIMIT 1`,
      [categoria, categoria],
    );
    if (!t)
      throw new ErroOperacao(
        503,
        'cadastro-incompleto',
        'Cadastro incompleto',
        `Cadastre um tipo de documento clínico ativo da categoria ${categoria} (ou "outro") antes de criar o formulário.`,
      );
    return num(t['id']);
  };
  /**
   * Casos de teste da versão pelas escritas auditadas (vão à trilha da operação): o caso de cada ordem é incluído ou
   * alterado com a versão lida; o que sobra além da nova lista fica excluído (lógico), e reaparece se a ordem voltar.
   */
  const gravarCasos = async (
    versao: number,
    casos: readonly { nome: string; caso: unknown }[],
    quem: number,
  ) => {
    const atuais = await tx.consultarParaAtualizar(
      `SELECT id, ordem, excluido_em, versao FROM modelo_documento_caso_teste
        WHERE modelo_documento_versao_id = ? ORDER BY ordem`,
      [versao],
    );
    const daOrdem = new Map(atuais.map((x) => [num(x['ordem']), x] as const));
    for (const [i, x] of casos.entries()) {
      const dados = JSON.stringify(x.caso);
      const atual = daOrdem.get(i + 1);
      if (!atual)
        await tx.incluir('modelo_documento_caso_teste', {
          modelo_documento_versao_id: versao,
          ordem: i + 1,
          nome: x.nome,
          dados,
        });
      else
        await tx.alterar('modelo_documento_caso_teste', num(atual['id']), num(atual['versao']), {
          nome: x.nome,
          dados,
          excluido_em: null,
          excluido_por: null,
        });
    }
    const em = agora();
    for (const x of atuais)
      if (num(x['ordem']) > casos.length && x['excluido_em'] === null)
        await tx.alterar('modelo_documento_caso_teste', num(x['id']), num(x['versao']), {
          excluido_em: em,
          excluido_por: quem,
        });
  };
  /** Quatro olhos (D-APROV-45): quem salvou qualquer alteração da versão, pela conta (usuario_id), nunca pelo texto. */
  const escreveu = async (v: Linha, usuario: number): Promise<boolean> => {
    const salvos = await tx.consultar(
      `SELECT DISTINCT usuario_id FROM modelo_documento_evento
        WHERE modelo_documento_versao_id = ? AND tipo_evento = 'salvo'`,
      [num(v['id'])],
    );
    return [numOuNull(v['autor_id']), ...salvos.map((x) => num(x['usuario_id']))].includes(usuario);
  };

  return {
    salvar: async (p) => {
      const autor = await conta(p.autor);
      const tipoRegistro = paraBanco(p.tipoRegistro);
      const dados = JSON.stringify(p.definicao);
      if (p.id !== null) {
        const v = await travar(p.id);
        if (!v) throw recusa('nao-encontrado', 'Formulário novo não encontrado neste estabelecimento.');
        const estado = ESTADO_DA_SITUACAO[String(v['situacao'])];
        if (estado === 'publicado' || estado === 'aposentado')
          throw recusa('imutavel', 'Versão publicada não se altera: crie uma nova versão a partir dela.');
        if (estado !== 'rascunho')
          throw recusa('estado-invalido', 'Em revisão: devolva ao rascunho antes de alterar.');
        if (p.versaoEsperada !== null && String(num(v['versao'])) !== p.versaoEsperada)
          throw recusa(
            'versao-concorrente',
            'Outra pessoa salvou esta versão depois que você a abriu. Reabra para ver a versão atual.',
          );
        if (String(v['codigo']) !== p.codigo)
          throw recusa('codigo-mudou', 'O código de um formulário não muda depois de criado.');
        const nova = await tx.alterar('modelo_documento_versao', p.id, num(v['versao']), {
          titulo: p.titulo,
          tipo_registro: tipoRegistro,
          formato: p.formato,
          dados,
          operacao: 'alteracao',
          ocorrido_em: agora(),
          usuario_id: autor,
        });
        await gravarCasos(p.id, p.casos, autor);
        await evento(p.id, 'salvo', autor, null, null);
        return { id: p.id, versao: num(v['numero_versao']), versaoLinha: String(nova) };
      }
      const modelo = await travarUma('SELECT id, versao FROM modelo_documento_clinico WHERE codigo = ?', [
        p.codigo,
      ]);
      let modeloId: number;
      let numero: number;
      if (p.baseadoEm !== null) {
        const b = await travar(p.baseadoEm);
        if (!b) throw recusa('nao-encontrado', 'A versão de origem não existe neste estabelecimento.');
        const estadoB = ESTADO_DA_SITUACAO[String(b['situacao'])];
        if (estadoB !== 'publicado' && estadoB !== 'aposentado')
          throw recusa('estado-invalido', 'A versão nova parte de uma versão publicada.');
        if (String(b['codigo']) !== p.codigo)
          throw recusa('codigo-mudou', 'A versão nova mantém o código do formulário.');
        modeloId = num(b['modelo_id']);
        const aberta = await tx.uma(
          `SELECT id FROM modelo_documento_versao
            WHERE modelo_documento_clinico_id = ? AND situacao IN ('rascunho', 'revisao')
              AND formato IS NOT NULL LIMIT 1`,
          [modeloId],
        );
        // As versões históricas migradas (rascunho sem formato) são retrato da origem, não trabalho aberto.
        if (aberta)
          throw recusa(
            'versao-aberta',
            'Já há uma versão deste formulário em rascunho ou em revisão: continue nela.',
          );
        const ultimo = await tx.uma(
          'SELECT MAX(numero_versao) AS n FROM modelo_documento_versao WHERE modelo_documento_clinico_id = ?',
          [modeloId],
        );
        numero = num(ultimo?.['n'] ?? 0) + 1;
      } else {
        if (modelo)
          throw recusa('codigo-em-uso', `O código ${p.codigo} já é de outro formulário: escolha outro.`);
        modeloId = await tx.incluir('modelo_documento_clinico', {
          codigo: p.codigo,
          titulo: p.titulo,
          tipo_documento_clinico_id: await tipoDocumento(tipoRegistro),
          tipo_registro: tipoRegistro,
          situacao: 'rascunho',
          origem: 'sistema',
        });
        numero = 1;
      }
      const id = await tx.incluir('modelo_documento_versao', {
        modelo_documento_clinico_id: modeloId,
        numero_versao: numero,
        situacao: 'rascunho',
        titulo: p.titulo,
        tipo_registro: tipoRegistro,
        formato: p.formato,
        origem_modelo_documento_versao_id: p.baseadoEm,
        operacao: numero === 1 ? 'inclusao' : 'alteracao',
        dados,
        ocorrido_em: agora(),
        usuario_id: autor,
      });
      await gravarCasos(id, p.casos, autor);
      await evento(id, 'salvo', autor, null, null);
      return { id, versao: numero, versaoLinha: '1' };
    },

    mudar: async (m) => {
      const v = await travar(m.id);
      if (!v) throw recusa('nao-encontrado', 'Formulário novo não encontrado neste estabelecimento.');
      const estado = ESTADO_DA_SITUACAO[String(v['situacao'])];
      const de: Record<string, EstadoFormularioNovo> = {
        revisao: 'rascunho',
        aprovado: 'revisao',
        devolvido: 'revisao',
        publicado: 'revisao',
        aposentado: 'publicado',
      };
      const p = m.passo;
      if (estado !== de[p.tipo]) {
        if (p.tipo === 'aposentado') throw recusa('estado-invalido', 'Só a versão publicada é aposentada.');
        throw recusa(
          estado === 'publicado' || estado === 'aposentado' ? 'imutavel' : 'estado-invalido',
          'A versão mudou de situação depois de aberta. Reabra para ver a situação atual.',
        );
      }
      if (m.versaoEsperada !== null && String(num(v['versao'])) !== m.versaoEsperada)
        throw recusa(
          'versao-concorrente',
          'Outra pessoa salvou esta versão depois que você a abriu. Reabra para ver a versão atual.',
        );
      const por = await conta(m.por);
      const em = agora();
      const versaoLinha = num(v['versao']);
      const modeloId = num(v['modelo_id']);
      const publicadaId = numOuNull(v['publicada_id']);
      const alterar = (valores: Record<string, unknown>) =>
        tx.alterar('modelo_documento_versao', m.id, versaoLinha, valores);
      /** Situação do modelo ainda sem versão publicada acompanha a da versão em curso. */
      const modeloSemPublicada = async (situacao: string) => {
        if (publicadaId !== null) return;
        await tx.alterar('modelo_documento_clinico', modeloId, num(v['versao_modelo']), { situacao });
      };
      let nova: number;
      let hash: string | null = null;
      let texto: string | null = null;
      if (p.tipo === 'revisao') {
        nova = await alterar({
          situacao: 'revisao',
          aprovada_em: null,
          aprovacao_usuario_id: null,
          parecer: null,
        });
        await modeloSemPublicada('revisao');
      } else if (p.tipo === 'aprovado') {
        if (await escreveu(v, por)) throw recusa('aprovador-e-autor', 'Quem escreveu a versão não a aprova.');
        texto = p.parecer;
        nova = await alterar({ aprovada_em: em, aprovacao_usuario_id: por, parecer: p.parecer });
      } else if (p.tipo === 'devolvido') {
        texto = p.parecer;
        nova = await alterar({
          situacao: 'rascunho',
          aprovada_em: null,
          aprovacao_usuario_id: null,
          parecer: p.parecer,
        });
        await modeloSemPublicada('rascunho');
      } else if (p.tipo === 'publicado') {
        const aprovador = numOuNull(v['aprovador_id']);
        if (aprovador === null) throw recusa('sem-aprovacao', 'Falta a aprovação da comissão de prontuário.');
        if (await escreveu(v, aprovador))
          throw recusa('aprovador-e-autor', 'Quem escreveu a versão não a aprova.');
        if (await escreveu(v, por))
          throw recusa('publicador-e-autor', 'Quem escreveu a versão não a publica.');
        hash = p.contentHash;
        nova = await alterar({
          situacao: 'publicada',
          publicada_em: em,
          publicacao_usuario_id: por,
          hash_definicao: p.contentHash,
          destino_publicacao: DESTINO_DA_PONTE[p.ponte],
        });
        // A anterior em uso fica substituída (continua legível e imutável); o modelo passa a usar esta versão.
        if (publicadaId !== null && publicadaId !== m.id) {
          const anterior = await travarUma(
            "SELECT versao FROM modelo_documento_versao WHERE id = ? AND situacao = 'publicada'",
            [publicadaId],
          );
          if (anterior)
            await tx.alterar('modelo_documento_versao', publicadaId, num(anterior['versao']), {
              situacao: 'substituida',
            });
        }
        const tipoRegistro = String(v['tipo_registro']);
        await tx.alterar('modelo_documento_clinico', modeloId, num(v['versao_modelo']), {
          situacao: 'publicado',
          publicada_modelo_documento_versao_id: m.id,
          titulo: String(v['titulo']),
          tipo_registro: tipoRegistro,
          tipo_documento_clinico_id: await tipoDocumento(tipoRegistro),
        });
      } else {
        texto = p.motivo;
        nova = await alterar({
          situacao: 'aposentada',
          aposentada_em: em,
          aposentadoria_usuario_id: por,
          motivo_aposentadoria: p.motivo,
        });
        // A versão em uso aposentada tira o modelo de uso (os registros feitos nela continuam consultáveis).
        if (publicadaId === m.id)
          await tx.alterar('modelo_documento_clinico', modeloId, num(v['versao_modelo']), {
            situacao: 'aposentado',
          });
      }
      await evento(m.id, p.tipo, por, hash, texto);
      return { versaoLinha: String(nova) };
    },
  };
}
