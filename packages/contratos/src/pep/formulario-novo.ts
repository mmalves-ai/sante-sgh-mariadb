// Formulários novos do PEP (M45, etapa 1; ficha do M45, seções 5, 6, 7 e regra 14; cap-11 §11.1 "Formulários novos
// e construtor visual", "Versionamento"). O contrato é o que o construtor (tela) e a API trocam: a DEFINIÇÃO do
// formulário (perguntas em árvore, opções com pontos, regras em JSON Logic), os casos de teste (respostas → valores
// esperados), o ciclo de vida (rascunho → revisão → publicado → aposentado) e as entradas de cada passo. Nada aqui
// cita tabela ou coluna do legado: o plano de gravação do modelo (que vira modelo do prontuário de origem) é do
// domínio (@sgh/dominio-pep, `formulario-novo/plano.ts`) e da receita `pep.publicarFormularioNovo`.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Tipos de pergunta ──────────────────────────────────────────────────────────────────────────────────

/**
 * Tipos que o construtor oferece. São os que o gravador do M22 já sabe gravar no formato do formulário de
 * origem (texto, número, data, hora, escolha, múltipla, escolha com texto) mais a seção (título). CID, grade,
 * alergias e os tipos sem uso nos modelos ficam fora do construtor nesta versão (cap-11 §11.1; ficha regra 15).
 */
export const TIPOS_PERGUNTA_FORMULARIO_NOVO = [
  'secao',
  'texto',
  'texto-formatado',
  'decimal',
  'inteiro',
  'data',
  'hora',
  'escolha',
  'escolha-com-texto',
  'multipla',
] as const;
export type TipoPerguntaFormularioNovo = (typeof TIPOS_PERGUNTA_FORMULARIO_NOVO)[number];

/** Tipos com lista de opções. */
export const TIPOS_COM_OPCOES: ReadonlySet<TipoPerguntaFormularioNovo> = new Set([
  'escolha',
  'escolha-com-texto',
  'multipla',
]);

/** Tipo de registro do modelo (a família do prontuário em que o registro aparece). */
export const TIPOS_REGISTRO_FORMULARIO_NOVO = [
  'diagnostico',
  'evolucao',
  'anamnese',
  'resumo-clinico',
  'sumario-alta',
] as const;
export type TipoRegistroFormularioNovo = (typeof TIPOS_REGISTRO_FORMULARIO_NOVO)[number];

/** Ciclo de vida (regra 14): o publicado é imutável; corrigir é publicar nova versão. */
export const ESTADOS_FORMULARIO_NOVO = ['rascunho', 'revisao', 'publicado', 'aposentado'] as const;
export type EstadoFormularioNovo = (typeof ESTADOS_FORMULARIO_NOVO)[number];

/** Limites das colunas do formulário de origem (texto em CP1252, 1 caractere = 1 byte). */
export const LIMITES_FORMULARIO_NOVO = {
  codigo: 10,
  titulo: 100,
  tituloPergunta: 100,
  unidade: 10,
  textoOpcao: 255,
  perguntas: 400,
  opcoesPorPergunta: 27,
  niveis: 6,
  casos: 50,
} as const;

/** Código do modelo: maiúsculas, dígitos e sublinhado (todos os 67 modelos da cópia seguem a forma). */
export const FORMATO_CODIGO_FORMULARIO_NOVO = /^[A-Z][A-Z0-9_]{1,9}$/;
/**
 * Código de um modelo na definição: o criado no construtor segue o formato acima; o modelo migrado guarda a chave
 * numérica da origem como código, e a nova versão a partir dele mantém esse código (a linhagem do modelo).
 */
export const FORMATO_CODIGO_MODELO_FORMULARIO_NOVO = /^[A-Z0-9][A-Z0-9_]{0,9}$/;
/** Identificador estável da pergunta na definição (as regras citam por ele). */
export const FORMATO_LINK_ID = /^[a-z][a-z0-9_]{0,39}$/;

// ── Definição ──────────────────────────────────────────────────────────────────────────────────────────

/** Regra em JSON Logic (o mesmo subconjunto do motor do M22: `var`, `if`, comparações, aritmética, `soma`…). */
export type RegraFormularioNovo = unknown;

export const esquemaOpcaoFormularioNovo = z.object({
  /** Código estável da opção na definição (o índice gravado é a posição na lista). */
  codigo: z.string().regex(FORMATO_LINK_ID),
  texto: textoCp1252(LIMITES_FORMULARIO_NOVO.textoOpcao).pipe(z.string().trim().min(1)),
  /** Pontos da opção nas escalas (Braden, Morse, NEWS2…); nulo quando a opção não pontua. */
  pontos: z.number().finite().nullable(),
});
export type OpcaoFormularioNovo = z.infer<typeof esquemaOpcaoFormularioNovo>;

export interface PerguntaFormularioNovo {
  readonly linkId: string;
  readonly tipo: TipoPerguntaFormularioNovo;
  readonly titulo: string;
  readonly obrigatorio: boolean;
  readonly unidade: string | null;
  readonly minimo: number | null;
  readonly maximo: number | null;
  readonly opcoes: readonly OpcaoFormularioNovo[];
  /** Quando habilitar (JSON Logic); nulo = sempre. */
  readonly habilitar: RegraFormularioNovo | null;
  /** Valor calculado (JSON Logic): o total de escala é sempre calculado no formulário novo (regra 3). */
  readonly calcular: RegraFormularioNovo | null;
  /** Pergunta do banco reaproveitada (ID da pergunta do formulário de origem), quando o construtor achou igual. */
  readonly reuso: number | null;
  readonly itens: readonly PerguntaFormularioNovo[];
}

export const esquemaPerguntaFormularioNovo: z.ZodType<PerguntaFormularioNovo> = z.lazy(() =>
  z.object({
    linkId: z.string().regex(FORMATO_LINK_ID),
    tipo: z.enum(TIPOS_PERGUNTA_FORMULARIO_NOVO),
    titulo: textoCp1252(LIMITES_FORMULARIO_NOVO.tituloPergunta).pipe(z.string().trim().min(1)),
    obrigatorio: z.boolean(),
    unidade: textoCp1252(LIMITES_FORMULARIO_NOVO.unidade).nullable(),
    minimo: z.number().finite().nullable(),
    maximo: z.number().finite().nullable(),
    opcoes: z.array(esquemaOpcaoFormularioNovo).max(LIMITES_FORMULARIO_NOVO.opcoesPorPergunta),
    habilitar: z.unknown().nullable(),
    calcular: z.unknown().nullable(),
    reuso: z.number().int().positive().nullable(),
    itens: z.array(esquemaPerguntaFormularioNovo),
  }),
);

export const esquemaDefinicaoFormularioNovo = z.object({
  codigo: z.string().regex(FORMATO_CODIGO_MODELO_FORMULARIO_NOVO),
  titulo: textoCp1252(LIMITES_FORMULARIO_NOVO.titulo).pipe(z.string().trim().min(3)),
  tipoRegistro: z.enum(TIPOS_REGISTRO_FORMULARIO_NOVO),
  /** Especialidades em que o modelo é visível (vazio: livre, como no formulário de origem). */
  especialidades: z.array(z.number().int().positive()).max(200),
  perguntas: z.array(esquemaPerguntaFormularioNovo).min(1),
});
export type DefinicaoFormularioNovo = z.infer<typeof esquemaDefinicaoFormularioNovo>;

// ── Casos de teste ─────────────────────────────────────────────────────────────────────────────────────

/** Valor de resposta no caso de teste (o mesmo domínio das respostas: texto, número, data ISO, opção, lista). */
export const esquemaValorCasoFormularioNovo = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type ValorCasoFormularioNovo = z.infer<typeof esquemaValorCasoFormularioNovo>;

export const esquemaCasoFormularioNovo = z.object({
  nome: z.string().trim().min(1).max(80),
  /** Respostas por linkId (opção pelo código; múltipla pela lista de códigos). */
  respostas: z.record(z.string().regex(FORMATO_LINK_ID), esquemaValorCasoFormularioNovo),
  /** Valores esperados das perguntas calculadas e o estado de habilitação esperado, por linkId. */
  esperado: z.record(z.string().regex(FORMATO_LINK_ID), esquemaValorCasoFormularioNovo),
  habilitadasEsperadas: z.array(z.string().regex(FORMATO_LINK_ID)).nullable(),
});
export type CasoFormularioNovo = z.infer<typeof esquemaCasoFormularioNovo>;

export interface DiferencaCasoFormularioNovo {
  readonly linkId: string;
  readonly esperado: ValorCasoFormularioNovo;
  readonly obtido: ValorCasoFormularioNovo;
  readonly motivo: 'valor' | 'habilitacao' | 'erro-regra' | 'resposta-invalida';
}

export interface ResultadoCasoFormularioNovo {
  readonly caso: string;
  readonly passou: boolean;
  readonly diferencas: readonly DiferencaCasoFormularioNovo[];
}

// ── Versões e listas ───────────────────────────────────────────────────────────────────────────────────

/** Situação da ponte com o prontuário de origem (ficha seção 5: `especificada` até o cenário controlado do M36). */
export const PONTES_FORMULARIO_NOVO = ['modelo-legado', 'registro-resumo', 'so-sante'] as const;
export type PonteFormularioNovo = (typeof PONTES_FORMULARIO_NOVO)[number];

export interface VersaoFormularioNovoResumo {
  readonly id: number;
  readonly codigo: string;
  readonly titulo: string;
  readonly versao: number;
  readonly estado: EstadoFormularioNovo;
  /** SHA-256 do conteúdo canônico (JCS) da definição; só no publicado e no aposentado. */
  readonly contentHash: string | null;
  readonly ponte: PonteFormularioNovo;
  readonly casos: number;
  readonly casosVerdes: number | null;
  readonly atualizadoEm: string;
  /** Modelo do prontuário de origem criado na publicação (nulo antes, ou na ponte por registro-resumo). */
  readonly idModeloLegado: number | null;
}

export interface VersaoFormularioNovoDetalhe extends VersaoFormularioNovoResumo {
  /** Versão da linha vista (controle otimista: vai de volta em cada passo). */
  readonly versaoLinha: string;
  /** Conta de quem escreveu a última alteração (quatro olhos: não aprova). */
  readonly autor: string;
  /** Hash da definição como está agora (o diálogo de publicação mostra e devolve). */
  readonly contentHashAtual: string;
  /** Publicado: o hash guardado confere com a definição guardada? (nulo antes de publicar). */
  readonly integro: boolean | null;
  readonly codigoModelo: string | null;
  readonly eventos: readonly EventoFormularioNovo[];
  readonly definicao: DefinicaoFormularioNovo;
  readonly casosTeste: readonly CasoFormularioNovo[];
  readonly resultados: readonly ResultadoCasoFormularioNovo[] | null;
  /** Revisão: quem aprovou (só o identificador da conta) e o parecer da comissão de prontuário. */
  readonly aprovacao: { readonly por: string; readonly em: string; readonly parecer: string } | null;
  readonly motivoAposentadoria: string | null;
}

export const TIPOS_EVENTO_FORMULARIO_NOVO = [
  'salvo',
  'revisao',
  'aprovado',
  'devolvido',
  'publicado',
  'aposentado',
] as const;
export interface EventoFormularioNovo {
  readonly tipo: (typeof TIPOS_EVENTO_FORMULARIO_NOVO)[number];
  readonly por: string;
  readonly em: string;
  readonly contentHash: string | null;
  readonly texto: string | null;
}

// ── Entradas ───────────────────────────────────────────────────────────────────────────────────────────

/** Salvar rascunho (`pep.salvarFormularioNovo`, só SGH_): definição e casos; `versaoEsperada` evita sobrescrita. */
export const esquemaSalvarFormularioNovo = z.object({
  id: z.number().int().positive().nullable(),
  /** Nova versão a partir de uma publicada (corrigir é publicar nova versão, regra 14). */
  baseadoEm: z.number().int().positive().nullable(),
  definicao: esquemaDefinicaoFormularioNovo,
  casos: z.array(esquemaCasoFormularioNovo).max(LIMITES_FORMULARIO_NOVO.casos),
  versaoEsperada: z.string().nullable(),
});
export type SalvarFormularioNovo = z.infer<typeof esquemaSalvarFormularioNovo>;

export const esquemaEnviarRevisaoFormularioNovo = z.object({
  id: z.number().int().positive(),
  versaoEsperada: z.string(),
});
export type EnviarRevisaoFormularioNovo = z.infer<typeof esquemaEnviarRevisaoFormularioNovo>;

export const esquemaDecidirRevisaoFormularioNovo = z.object({
  id: z.number().int().positive(),
  versaoEsperada: z.string(),
  decisao: z.enum(['aprovar', 'devolver']),
  parecer: textoCp1252(500).pipe(z.string().trim().min(10)),
});
export type DecidirRevisaoFormularioNovo = z.infer<typeof esquemaDecidirRevisaoFormularioNovo>;

/** Publicar (`pep.publicarFormularioNovo`): ação crítica, com a senha de novo (reautenticação, SBIS-07). */
export const esquemaPublicarFormularioNovo = z.object({
  id: z.number().int().positive(),
  versaoEsperada: z.string(),
  contentHashEsperado: z.string().regex(/^[0-9a-f]{64}$/),
  senha: z.string().min(1).max(100),
});
export type PublicarFormularioNovo = z.infer<typeof esquemaPublicarFormularioNovo>;

export const esquemaAposentarFormularioNovo = z.object({
  id: z.number().int().positive(),
  motivo: textoCp1252(500).pipe(z.string().trim().min(10)),
  senha: z.string().min(1).max(100),
});
export type AposentarFormularioNovo = z.infer<typeof esquemaAposentarFormularioNovo>;

// ── Banco de perguntas (reuso, cap-11 §11.1) ───────────────────────────────────────────────────────────

/** Pergunta ativa do banco do formulário de origem, como o construtor a mostra para reuso. */
export interface PerguntaDoBanco {
  readonly id: number;
  readonly titulo: string;
  readonly tipo: TipoPerguntaFormularioNovo | null;
  readonly unidade: string | null;
  readonly opcoes: readonly string[];
  /** Em quantos modelos a pergunta aparece (agregado). */
  readonly usoEmModelos: number;
}

export const esquemaBuscarPerguntaDoBanco = z.object({
  termo: z.string().trim().min(2).max(60),
  tipo: z.enum(TIPOS_PERGUNTA_FORMULARIO_NOVO).nullable(),
});
export type BuscarPerguntaDoBanco = z.infer<typeof esquemaBuscarPerguntaDoBanco>;

export interface EspecialidadeFormularioNovo {
  readonly codigo: number;
  readonly nome: string;
}

// ── Liberação (POL-3) ──────────────────────────────────────────────────────────────────────────────────

/** O construtor (só do novo): desligado até a comissão de prontuário assumir a revisão (DP-27). */
export const CHAVE_LIBERACAO_FORMULARIO_NOVO = 'pep.formularioNovo';
/**
 * A ponte com o prontuário de origem (`pep.publicarFormularioNovo`): desligada até o cenário controlado do M36. Com
 * ela desligada, a versão publicada vale só no Sante SGH (ponte `so-sante`).
 */
export const CHAVE_PONTE_FORMULARIO_NOVO = 'pep.formularioNovo.modeloLegado';

// ── Respostas da API (esquemas: a tela valida o que recebe) ────────────────────────────────────────────

const esquemaRegraJson = z.unknown();
const esquemaPerguntaResposta: z.ZodType<PerguntaFormularioNovo> = z.lazy(() =>
  z.object({
    linkId: z.string(),
    tipo: z.enum(TIPOS_PERGUNTA_FORMULARIO_NOVO),
    titulo: z.string(),
    obrigatorio: z.boolean(),
    unidade: z.string().nullable(),
    minimo: z.number().nullable(),
    maximo: z.number().nullable(),
    opcoes: z.array(z.object({ codigo: z.string(), texto: z.string(), pontos: z.number().nullable() })),
    habilitar: esquemaRegraJson,
    calcular: esquemaRegraJson,
    reuso: z.number().nullable(),
    itens: z.array(esquemaPerguntaResposta),
  }),
) as z.ZodType<PerguntaFormularioNovo>;

export const esquemaVersaoFormularioNovoResumo = z.object({
  id: z.number(),
  codigo: z.string(),
  titulo: z.string(),
  versao: z.number(),
  estado: z.enum(ESTADOS_FORMULARIO_NOVO),
  contentHash: z.string().nullable(),
  ponte: z.enum(PONTES_FORMULARIO_NOVO),
  casos: z.number(),
  casosVerdes: z.number().nullable(),
  atualizadoEm: z.string(),
  idModeloLegado: z.number().nullable(),
});

export const esquemaListaFormulariosNovos = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  ponte: z.object({ ligada: z.boolean(), motivo: z.string().nullable() }),
  versoes: z.array(esquemaVersaoFormularioNovoResumo),
});
export type ListaFormulariosNovos = z.infer<typeof esquemaListaFormulariosNovos>;

const esquemaValorResposta = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);

export const esquemaVersaoFormularioNovoDetalhe = esquemaVersaoFormularioNovoResumo.extend({
  versaoLinha: z.string(),
  autor: z.string(),
  contentHashAtual: z.string(),
  integro: z.boolean().nullable(),
  codigoModelo: z.string().nullable(),
  eventos: z.array(
    z.object({
      tipo: z.enum(TIPOS_EVENTO_FORMULARIO_NOVO),
      por: z.string(),
      em: z.string(),
      contentHash: z.string().nullable(),
      texto: z.string().nullable(),
    }),
  ),
  definicao: z.object({
    codigo: z.string(),
    titulo: z.string(),
    tipoRegistro: z.enum(TIPOS_REGISTRO_FORMULARIO_NOVO),
    especialidades: z.array(z.number()),
    perguntas: z.array(esquemaPerguntaResposta),
  }),
  casosTeste: z.array(
    z.object({
      nome: z.string(),
      respostas: z.record(z.string(), esquemaValorResposta),
      esperado: z.record(z.string(), esquemaValorResposta),
      habilitadasEsperadas: z.array(z.string()).nullable(),
    }),
  ),
  resultados: z
    .array(
      z.object({
        caso: z.string(),
        passou: z.boolean(),
        diferencas: z.array(
          z.object({
            linkId: z.string(),
            esperado: esquemaValorResposta,
            obtido: esquemaValorResposta,
            motivo: z.enum(['valor', 'habilitacao', 'erro-regra', 'resposta-invalida']),
          }),
        ),
      }),
    )
    .nullable(),
  aprovacao: z.object({ por: z.string(), em: z.string(), parecer: z.string() }).nullable(),
  motivoAposentadoria: z.string().nullable(),
});

export const esquemaPerguntaDoBanco = z.object({
  id: z.number(),
  titulo: z.string(),
  tipo: z.enum(TIPOS_PERGUNTA_FORMULARIO_NOVO).nullable(),
  unidade: z.string().nullable(),
  opcoes: z.array(z.string()),
  usoEmModelos: z.number(),
});

export const esquemaEspecialidadeFormularioNovo = z.object({ codigo: z.number(), nome: z.string() });

export const esquemaResultadoFormularioNovo = z.object({
  id: z.number(),
  versao: z.number(),
  versaoLinha: z.string(),
  estado: z.enum(ESTADOS_FORMULARIO_NOVO),
  ponte: z.enum(PONTES_FORMULARIO_NOVO).nullable(),
  mensagem: z.string(),
});
export type ResultadoFormularioNovo = z.infer<typeof esquemaResultadoFormularioNovo>;

export const esquemaPreviaResumoFormularioNovo = z.object({
  definicao: esquemaDefinicaoFormularioNovo,
  versao: z.number().int().positive(),
  respostas: z.record(z.string().regex(FORMATO_LINK_ID), esquemaValorCasoFormularioNovo),
});
