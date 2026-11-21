// Decisão sobre a retrocompatibilidade e plano de evolução do modelo de dados (M59, etapa 6, `M59-F6`; ficha, seção 1,
// regras 1, 6, 11 e 12; cap-10 §10.13; cap-09 §9.6). A retrocompatibilidade (o novo grava no banco exatamente como o
// sistema anterior gravaria, pelo executor do M04) só é extinta por ADR com decisão do dono, por hospital, depois da
// migração completa dos usuários, do outro sistema desligado e do fim do período de contingência (DP-6). Extinta, a
// evolução é aos poucos, dentro do adaptador, um passo por vez, cada um com ficha própria, testes de regressão e o
// combinado com a Hal-AI quando muda o que a sante-api lê.
//
// A decisão e cada passo ficam no registro versionado `docs/coexistencia/retrocompatibilidade/<h>.yaml`, preenchido por
// PR revisado (como o fim do M43 e os passos do M58); o painel só lê. SEM dado pessoal: datas, papéis e referências.
// Falha fechada: registro ausente, inválido ou com a extinção sem as condições vale "retrocompatibilidade mantida".
import { z } from 'zod';
import { ESTADOS_OPERACAO } from '../assinatura/catalogo.js';
import { RE_TEXTO_SEM_DADO_PESSOAL } from '../homologacao/homologacao.js';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD');
const codigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{0,9}$/);
const textoRegistro = z
  .string()
  .regex(RE_TEXTO_SEM_DADO_PESSOAL, 'texto sem dado pessoal (até 600 caracteres)');

/** O número do ADR que a extinção registrada tem de citar (o esquema do registro recusa outro). */
export const ADR_RETROCOMPATIBILIDADE = {
  numero: '0033',
} as const;

// ── Condições para extinguir (regra 11; regra 1 e DP-6) ──────────────────────────────────────────────────────────

export const CONDICOES_EXTINCAO = [
  'fim-da-coexistencia-registrado',
  'outro-sistema-desligado',
  'dp6-decidida',
  'contingencia-encerrada',
] as const;
export type CondicaoExtincao = (typeof CONDICOES_EXTINCAO)[number];

/** De onde vem cada condição (o painel mostra; o dono confere). */
export const FONTE_CONDICAO_EXTINCAO: Readonly<Record<CondicaoExtincao, string>> = {
  'fim-da-coexistencia-registrado':
    'registro do fim da coexistência do hospital (M43): migração completa dos usuários',
  'outro-sistema-desligado': 'registro dos passos do desligamento (M58): passo "desligamento" executado',
  'dp6-decidida': 'registro do fim (M43): DP-6 decidida, com a data do fim do período de contingência',
  'contingencia-encerrada':
    'parâmetro "Período de contingência aberto" do estabelecimento desligado pelo dono (M59, regra 1)',
};

// ── Decisão ──────────────────────────────────────────────────────────────────────────────────────────────────

export const DECISOES_RETROCOMPATIBILIDADE = ['pendente', 'mantida', 'extinta'] as const;
export type DecisaoRetrocompatibilidade = (typeof DECISOES_RETROCOMPATIBILIDADE)[number];

const esquemaDecisao = z.discriminatedUnion('situacao', [
  z.object({ situacao: z.literal('pendente') }).strict(),
  z
    .object({
      situacao: z.literal('mantida'),
      data: dia,
      /** A linha de ESTADO.md › Autorizações ou a ata em que o dono decidiu. */
      referencia: textoRegistro,
      /** Mantida com contingência longa: as retiradas do que o outro sistema lê ficam só especificadas (ficha, seção 5). */
      contingenciaLonga: z.boolean().default(false),
      /** Quando o dono revê a decisão (opcional). */
      revisarEm: dia.nullable().default(null),
    })
    .strict(),
  z
    .object({
      situacao: z.literal('extinta'),
      data: dia,
      referencia: textoRegistro,
      adr: z.literal(ADR_RETROCOMPATIBILIDADE.numero),
      papel: z.literal('dono-do-projeto'),
    })
    .strict(),
]);
export type DecisaoRegistrada = z.infer<typeof esquemaDecisao>;

// ── Plano de evolução (regra 11; regra 6: a imutabilidade por linha é o primeiro) ──────────────────────────────

export const PASSOS_EVOLUCAO = [
  'imutabilidade-por-linha',
  'regras-dos-gatilhos',
  'booleanos',
  'data-e-hora',
  'chaves-por-id',
] as const;
export type PassoEvolucao = (typeof PASSOS_EVOLUCAO)[number];

/** O que cada passo mede no banco do hospital (o tamanho do passo, contado no catálogo). */
export const MEDIDAS_EVOLUCAO = [
  'tabelas-clinicas',
  'gatilhos',
  'colunas-de-uma-letra',
  'pares-data-hora',
  'chaves-em-texto',
] as const;
export type MedidaEvolucao = (typeof MEDIDAS_EVOLUCAO)[number];

export interface DefinicaoPassoEvolucao {
  readonly passo: PassoEvolucao;
  readonly ordem: number;
  readonly titulo: string;
  readonly descricao: string;
  readonly medida: MedidaEvolucao;
  /** Se o passo muda o que a sante-api lê (regra 12): exige o combinado com a Hal-AI e os contratos Pact. */
  readonly mudaLeituraSanteApi: boolean;
  readonly fonte: string;
}

export const PLANO_EVOLUCAO: readonly DefinicaoPassoEvolucao[] = [
  {
    passo: 'imutabilidade-por-linha',
    ordem: 1,
    titulo: 'Imutabilidade do registro assinado por linha',
    descricao:
      'Gatilho SGH_ por tabela clínica que recusa alterar ou apagar registro assinado (só retificação por nova versão), no lugar da regra só por privilégio',
    medida: 'tabelas-clinicas',
    mudaLeituraSanteApi: false,
    fonte: 'ficha do M59, regra 6; SBIS-26; cap-08 §8.16',
  },
  {
    passo: 'regras-dos-gatilhos',
    ordem: 2,
    titulo: 'Regras dos gatilhos na aplicação',
    descricao:
      'O que os gatilhos das tabelas fazem passa para as regras do domínio, gatilho por gatilho, com a assinatura do M03 provando o mesmo efeito antes de desativá-lo',
    medida: 'gatilhos',
    mudaLeituraSanteApi: true,
    fonte: 'cap-10 §10.13; cap-09 §9.6',
  },
  {
    passo: 'booleanos',
    ordem: 3,
    titulo: 'Letras no lugar de verdadeiro e falso',
    descricao:
      'Colunas de uma letra (S/N, T/F, A/I) viram booleano, tabela por tabela, com a leitura dupla no adaptador durante a troca',
    medida: 'colunas-de-uma-letra',
    mudaLeituraSanteApi: true,
    fonte: 'cap-10 §10.13; cap-09 §9.6',
  },
  {
    passo: 'data-e-hora',
    ordem: 4,
    titulo: 'Data e hora num campo só',
    descricao:
      'Pares de coluna de data e coluna de hora viram um campo de data e hora, com o fuso do estabelecimento',
    medida: 'pares-data-hora',
    mudaLeituraSanteApi: true,
    fonte: 'cap-10 §10.13; cap-09 §9.6',
  },
  {
    passo: 'chaves-por-id',
    ordem: 5,
    titulo: 'Chaves em texto por identificadores',
    descricao:
      'Chaves estrangeiras que apontam para código em texto passam a apontar para o identificador numérico, com o código mantido como chave natural',
    medida: 'chaves-em-texto',
    mudaLeituraSanteApi: true,
    fonte: 'cap-10 §10.13; cap-09 §9.6',
  },
];

export const SITUACOES_PASSO_EVOLUCAO = [
  'bloqueado',
  'pronto-para-autorizar',
  'autorizado',
  'executado',
] as const;
export type SituacaoPassoEvolucao = (typeof SITUACOES_PASSO_EVOLUCAO)[number];

export const MOTIVOS_BLOQUEIO_EVOLUCAO = [
  'retrocompatibilidade-nao-extinta',
  'passo-anterior-pendente',
  'sem-ficha',
  'sem-combinado-hal-ai',
  'regressao-nao-aprovada',
] as const;
export type MotivoBloqueioEvolucao = (typeof MOTIVOS_BLOQUEIO_EVOLUCAO)[number];

const referenciaData = z.object({ data: dia, referencia: textoRegistro }).strict();
const PASSO_EVOLUCAO_VAZIO = {
  ficha: null,
  combinadoHalAi: null,
  regressao: null,
  autorizacao: null,
  execucao: null,
};
const passoEvolucaoRegistrado = z
  .object({
    /** O arquivo da ficha do passo (planejamento ou docs/adr), por PR do coordenador. */
    ficha: z
      .string()
      .regex(/^(docs|planejamento)\/[A-Za-z0-9_./#-]{3,200}$/, 'caminho da ficha no repositório')
      .nullable()
      .default(null),
    combinadoHalAi: referenciaData.nullable().default(null),
    regressao: z
      .object({ data: dia, relatorio: textoRegistro, resultado: z.enum(['aprovado', 'reprovado']) })
      .strict()
      .nullable()
      .default(null),
    autorizacao: referenciaData.nullable().default(null),
    execucao: referenciaData.nullable().default(null),
  })
  .strict()
  .default(PASSO_EVOLUCAO_VAZIO);

const PASSOS_VAZIOS = Object.fromEntries(PASSOS_EVOLUCAO.map((p) => [p, PASSO_EVOLUCAO_VAZIO])) as Record<
  PassoEvolucao,
  typeof PASSO_EVOLUCAO_VAZIO
>;

/**
 * Registro versionado da retrocompatibilidade de um hospital. Quem preenche: a decisão, o dono (ESTADO.md ›
 * Autorizações); a ficha de cada passo, o coordenador; o combinado com a Hal-AI, a equipe dela; a regressão, a IA com o
 * relatório; a autorização de cada passo, o dono; a execução, a TI. Coerência: nada além da ficha antes da extinção;
 * execução com autorização e regressão aprovada; um passo só se executa com o anterior executado.
 */
export const esquemaRegistroRetrocompatibilidade = z
  .object({
    formato: z.literal(1),
    estabelecimento: codigoEstabelecimento,
    decisao: esquemaDecisao.default({ situacao: 'pendente' }),
    passos: z
      .object(
        Object.fromEntries(PASSOS_EVOLUCAO.map((p) => [p, passoEvolucaoRegistrado])) as Record<
          PassoEvolucao,
          typeof passoEvolucaoRegistrado
        >,
      )
      .strict()
      .default(PASSOS_VAZIOS),
  })
  .strict()
  .superRefine((r, ctx) => {
    const extinta = r.decisao.situacao === 'extinta';
    PASSOS_EVOLUCAO.forEach((p, i) => {
      const x = r.passos[p];
      if (!extinta && (x.autorizacao || x.execucao || x.regressao))
        ctx.addIssue({
          code: 'custom',
          path: ['passos', p],
          message: 'passo do plano com registro além da ficha sem a retrocompatibilidade extinta',
        });
      if (x.execucao && (!x.autorizacao || x.regressao?.resultado !== 'aprovado'))
        ctx.addIssue({
          code: 'custom',
          path: ['passos', p, 'execucao'],
          message: 'execução sem autorização ou sem regressão aprovada',
        });
      const anterior = i > 0 ? PASSOS_EVOLUCAO[i - 1] : undefined;
      if (x.execucao && anterior && !r.passos[anterior].execucao)
        ctx.addIssue({
          code: 'custom',
          path: ['passos', p, 'execucao'],
          message: 'passo executado antes do anterior',
        });
    });
  });
export type RegistroRetrocompatibilidade = z.infer<typeof esquemaRegistroRetrocompatibilidade>;

// ── Inventário medido no catálogo (agregados de estrutura, nunca valor) ───────────────────────────────────────

export const esquemaInventarioRetrocompatibilidade = z.object({
  /** Tabelas do outro sistema (sem as SGH_ nem as do motor). */
  tabelas: z.number().int().nonnegative(),
  gatilhos: z.object({
    total: z.number().int().nonnegative(),
    ativos: z.number().int().nonnegative(),
    tabelas: z.number().int().nonnegative(),
  }),
  colunasDeUmaLetra: z.object({
    colunas: z.number().int().nonnegative(),
    tabelas: z.number().int().nonnegative(),
  }),
  paresDataHora: z.object({ pares: z.number().int().nonnegative(), tabelas: z.number().int().nonnegative() }),
  chavesEmTexto: z.object({
    chaves: z.number().int().nonnegative(),
    deTotal: z.number().int().nonnegative(),
    tabelas: z.number().int().nonnegative(),
  }),
  /** As tabelas clínicas da matriz (o tamanho do passo 1) e quantas existem neste banco. */
  tabelasClinicas: z.object({
    matriz: z.number().int().nonnegative(),
    presentes: z.number().int().nonnegative(),
  }),
  /** Gatilhos SGH_ em tabela do outro sistema: tem de ser 0 enquanto a retrocompatibilidade durar (guardas:legado). */
  gatilhosSghEmTabelaLegada: z.number().int().nonnegative(),
});
export type InventarioRetrocompatibilidade = z.infer<typeof esquemaInventarioRetrocompatibilidade>;

// ── Painel (GET administracao/coexistencia/retrocompatibilidade) ──────────────────────────────────────────────

/** As operações que retiram o que o outro sistema lê (ficha, seção 5) e o estado esperado delas pela decisão. */
export const OPERACOES_DE_RETIRADA = [
  'acesso.retirarSenhaLegado',
  'acesso.retirarSenhaSecundaria',
  'integracao.cifrarSegredoLegado',
] as const;
export type OperacaoDeRetirada = (typeof OPERACOES_DE_RETIRADA)[number];

/** O estado esperado de uma retirada: "especificada" com contingência longa, "verde" no resto (ficha, seção 5). */
export const ESTADOS_RETIRADA_ESPERADOS = ['verde', 'especificada'] as const;
export type EstadoRetiradaEsperado = (typeof ESTADOS_RETIRADA_ESPERADOS)[number];

/**
 * Os estados do catálogo que cumprem o esperado: "verde" ou além (conferida, liberada) quando se espera verde; só
 * "especificada" ou "bloqueada" (não grava) quando se espera especificada. Fora disso o painel avisa a divergência.
 */
export const ESTADOS_QUE_CUMPREM_RETIRADA: Readonly<
  Record<EstadoRetiradaEsperado, readonly (typeof ESTADOS_OPERACAO)[number][]>
> = {
  verde: ['verde', 'conferida', 'liberada'],
  especificada: ['especificada', 'bloqueada'],
};

export const esquemaCondicaoAvaliada = z.object({
  condicao: z.enum(CONDICOES_EXTINCAO),
  cumprida: z.boolean(),
  /** A data que a cumpriu (quando há), para o dono conferir. */
  em: dia.nullable(),
  fonte: z.string(),
});
export type CondicaoAvaliada = z.infer<typeof esquemaCondicaoAvaliada>;

export const esquemaPassoEvolucaoAvaliado = z.object({
  passo: z.enum(PASSOS_EVOLUCAO),
  ordem: z.number().int().positive(),
  titulo: z.string(),
  descricao: z.string(),
  medida: z.enum(MEDIDAS_EVOLUCAO),
  /** O tamanho do passo neste banco (null: sem medida, o catálogo não foi lido). */
  tamanho: z.number().int().nonnegative().nullable(),
  mudaLeituraSanteApi: z.boolean(),
  ficha: z.string().nullable(),
  situacao: z.enum(SITUACOES_PASSO_EVOLUCAO),
  motivos: z.array(z.enum(MOTIVOS_BLOQUEIO_EVOLUCAO)),
});
export type PassoEvolucaoAvaliado = z.infer<typeof esquemaPassoEvolucaoAvaliado>;

export const esquemaPainelRetrocompatibilidade = z.object({
  hospital: z.string(),
  em: z.iso.datetime(),
  adr: z.object({ numero: z.string(), caminho: z.string() }),
  /** A decisão como registrada e como vale (extinta sem as condições vale mantida: falha fechada). */
  decisaoRegistrada: z.enum(DECISOES_RETROCOMPATIBILIDADE),
  decisaoVigente: z.enum(['mantida', 'extinta']),
  decididaEm: dia.nullable(),
  referencia: z.string().nullable(),
  contingenciaLonga: z.boolean(),
  revisarEm: dia.nullable(),
  /** A extinção registrada não vale porque falta esta(s) condição(ões). */
  extincaoSemCondicoes: z.array(z.enum(CONDICOES_EXTINCAO)),
  condicoes: z.array(esquemaCondicaoAvaliada),
  /** Todas as condições cumpridas: o dono pode decidir a extinção (a decisão é dele). */
  podeDecidirExtincao: z.boolean(),
  passos: z.array(esquemaPassoEvolucaoAvaliado),
  /**
   * O estado esperado de cada retirada pela decisão, o estado que o catálogo de operações declara para o hospital
   * (null: catálogo ilegível ou operação ausente) e se os dois divergem (sem leitura também é divergência).
   */
  operacoesDeRetirada: z.array(
    z.object({
      operacao: z.enum(OPERACOES_DE_RETIRADA),
      estadoEsperado: z.enum(ESTADOS_RETIRADA_ESPERADOS),
      estadoAtual: z.enum(ESTADOS_OPERACAO).nullable(),
      divergente: z.boolean(),
    }),
  ),
  inventario: esquemaInventarioRetrocompatibilidade.nullable(),
  inventarioMedidoEm: z.iso.datetime().nullable(),
  /** A leitura do catálogo falhou (o painel segue com o registro; o tamanho dos passos fica sem medida). */
  inventarioIndisponivel: z.boolean(),
  registro: z.string(),
  registroInvalido: z.string().nullable(),
});
export type PainelRetrocompatibilidade = z.infer<typeof esquemaPainelRetrocompatibilidade>;
