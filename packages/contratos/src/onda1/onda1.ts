// Onda 1 da coexistência (ficha do M39; cap-15 §15.3.2 e §15.3.3; cap-10 §10.5; DP-4, DP-8): cadastros, agendamento
// e call center, recepção ambulatorial, senhas e painéis. O marco não cria operação nova: leva de `conferida` a
// `liberada`, setor a setor e no `pc` primeiro, as operações já especificadas (campo 5 da ficha). Este módulo é a
// fonte única do que entra na onda 1: as operações da ficha com o nome no catálogo docs/operacoes/catalogo (a
// ficha usa nomes de trabalho que mudaram na construção: `recepcao.encaminharSenha` é o evento
// `recepcao.registrarEventoSenha`; `atendimento.registrarAlta` é `atendimento.encerrarAtendimento`), as telas com as
// permissões do catálogo do M06, os itens da lista para ligar um setor (regra 1), os indicadores de disputa do
// painel de migração (entregável) e os cenários de assinatura extras do campo 9. Só contagens e nomes de estrutura;
// os textos daqui podem aparecer na tela e nunca citam o outro sistema pelo nome (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

/** Setores da onda 1 (ids de SETORES_PRONTIDAO com `onda: 1`). */
export const SETORES_ONDA_1 = ['cadastros-estrutura', 'agendamento', 'recepcao-ambulatorial'] as const;
export type SetorOnda1 = (typeof SETORES_ONDA_1)[number];

/** Estabelecimento que recebe a onda primeiro (DP-4: o `hs` só depois de todas as ondas prontas no `pc`). */
export const ESTABELECIMENTO_ONDA_1 = 'pc';

export interface OperacaoOnda1 {
  /** Nome da operação como a ficha do M39 escreve (campo 5). */
  readonly ficha: string;
  /** Nomes no catálogo docs/operacoes/catalogo que realizam a operação da ficha. */
  readonly catalogo: readonly string[];
  readonly setor: SetorOnda1;
  /** Marco de origem (onde a operação foi especificada e provada). */
  readonly marco: string;
  /** Motivo de ficar fora da liberação da onda 1 (decisão registrada), ou null. */
  readonly foraDaOnda1: string | null;
}

const DP8 =
  'DP-8 (padrão aprovado em 2026-10-19): a agenda de exames do novo fica fora da onda 1 até a correção da integração externa que grava sem a marcação';

/** Campo 5 da ficha, linha a linha, com os nomes do catálogo. */
export const OPERACOES_FICHA_ONDA_1: readonly OperacaoOnda1[] = [
  {
    ficha: 'cadastro.cadastrarPaciente',
    catalogo: ['cadastro.cadastrarPaciente'],
    setor: 'cadastros-estrutura',
    marco: 'M04',
    foraDaOnda1: null,
  },
  {
    ficha: 'cadastro.alterarPaciente',
    catalogo: ['cadastro.alterarPaciente'],
    setor: 'cadastros-estrutura',
    marco: 'M11',
    foraDaOnda1: null,
  },
  // Revisão do M39 (campo 7: "Cadastros > Profissionais > Médicos solicitantes externos", com a edição): a inclusão do
  // solicitante externo pela tela do cadastro (receita do M26, verde no pc).
  {
    ficha: 'cadastro.cadastrarSolicitante',
    catalogo: ['cadastro.cadastrarSolicitante'],
    setor: 'cadastros-estrutura',
    marco: 'M26',
    foraDaOnda1: null,
  },
  {
    ficha: 'agenda.gerarGrade',
    catalogo: ['agenda.gerarGrade', 'agenda.reverterGrade', 'agenda.bloquearHorarios'],
    setor: 'agendamento',
    marco: 'M17',
    foraDaOnda1: null,
  },
  {
    ficha: 'agenda.agendarConsulta',
    catalogo: ['agenda.agendarConsulta', 'agenda.confirmarConsulta', 'agenda.registrarFalta'],
    setor: 'agendamento',
    marco: 'M17',
    foraDaOnda1: null,
  },
  {
    ficha: 'agenda.encaixar',
    catalogo: ['agenda.encaixar'],
    setor: 'agendamento',
    marco: 'M17',
    foraDaOnda1: null,
  },
  {
    ficha: 'agenda.desfazerEncaixe',
    catalogo: ['agenda.desfazerEncaixe'],
    setor: 'agendamento',
    marco: 'M17',
    foraDaOnda1: null,
  },
  {
    ficha: 'agenda.cancelarConsulta',
    catalogo: ['agenda.cancelarConsulta'],
    setor: 'agendamento',
    marco: 'M17',
    foraDaOnda1: null,
  },
  {
    ficha: 'agenda.remarcarConsulta',
    catalogo: ['agenda.remarcarConsulta'],
    setor: 'agendamento',
    marco: 'M17',
    foraDaOnda1: null,
  },
  {
    ficha: 'agenda.definirCobertura',
    catalogo: ['agenda.definirCobertura'],
    setor: 'agendamento',
    marco: 'M17',
    foraDaOnda1: null,
  },
  {
    ficha: 'agenda.agendarExame',
    catalogo: ['agenda.agendarExame'],
    setor: 'agendamento',
    marco: 'M18',
    foraDaOnda1: DP8,
  },
  {
    ficha: 'agenda.cancelarExame',
    catalogo: ['agenda.cancelarExame'],
    setor: 'agendamento',
    marco: 'M18',
    foraDaOnda1: DP8,
  },
  {
    ficha: 'recepcao.emitirSenha',
    catalogo: ['recepcao.emitirSenha', 'recepcao.registrarChegada'],
    setor: 'recepcao-ambulatorial',
    marco: 'M19',
    foraDaOnda1: null,
  },
  {
    ficha: 'recepcao.chamarSenha',
    catalogo: ['recepcao.chamarSenha', 'recepcao.abrirGuiche', 'recepcao.fecharGuiche'],
    setor: 'recepcao-ambulatorial',
    marco: 'M19',
    foraDaOnda1: null,
  },
  {
    ficha: 'recepcao.encaminharSenha',
    catalogo: ['recepcao.registrarEventoSenha'],
    setor: 'recepcao-ambulatorial',
    marco: 'M19',
    foraDaOnda1: null,
  },
  {
    ficha: 'atendimento.abrirAtendimento',
    catalogo: ['atendimento.abrirAtendimento', 'atendimento.alterarSegurado'],
    setor: 'recepcao-ambulatorial',
    marco: 'M20',
    foraDaOnda1: null,
  },
  {
    ficha: 'atendimento.registrarAlta',
    catalogo: ['atendimento.encerrarAtendimento', 'atendimento.conduzirNoConsultorio'],
    setor: 'recepcao-ambulatorial',
    marco: 'M20',
    foraDaOnda1: null,
  },
  {
    ficha: 'atendimento.cancelarAtendimento',
    catalogo: ['atendimento.cancelarAtendimento'],
    setor: 'recepcao-ambulatorial',
    marco: 'M20',
    foraDaOnda1: null,
  },
  {
    ficha: 'atendimento.lancarProcedimentoExtra',
    catalogo: ['atendimento.lancarProcedimentoExtra'],
    setor: 'recepcao-ambulatorial',
    marco: 'M20',
    foraDaOnda1: null,
  },
  // Receita do CRUD genérico dos domínios de recepção e agenda (M14, M17, M18).
  {
    ficha: 'crud.recepcao',
    catalogo: [
      'recepcao.incluirGerador',
      'recepcao.alterarGerador',
      'recepcao.inativarGerador',
      'recepcao.alterarPainel',
      'recepcao.alterarRecepcao',
    ],
    setor: 'recepcao-ambulatorial',
    marco: 'M19',
    foraDaOnda1: null,
  },
  {
    ficha: 'crud.agenda',
    catalogo: ['agenda.incluirAgenda', 'agenda.alterarAgenda', 'agenda.definirEspecialidade'],
    setor: 'agendamento',
    marco: 'M17',
    foraDaOnda1: null,
  },
  {
    ficha: 'crud.agendaExame',
    catalogo: ['agenda.gerarGradeExame', 'agenda.definirCoberturaExame'],
    setor: 'agendamento',
    marco: 'M18',
    foraDaOnda1: DP8,
  },
];

/** Nomes do catálogo que a onda 1 libera no setor (sem os que ficam fora, DP-8). */
export function operacoesLiberaveisOnda1(setor: SetorOnda1): string[] {
  return [
    ...new Set(
      OPERACOES_FICHA_ONDA_1.filter((o) => o.setor === setor && o.foraDaOnda1 === null).flatMap(
        (o) => o.catalogo,
      ),
    ),
  ];
}

/** Nomes do catálogo da onda 1 que ficam fora da liberação, com o motivo. */
export function operacoesForaDaOnda1(): { nome: string; motivo: string }[] {
  return OPERACOES_FICHA_ONDA_1.flatMap((o) =>
    o.foraDaOnda1 === null ? [] : o.catalogo.map((nome) => ({ nome, motivo: o.foraDaOnda1 ?? '' })),
  );
}

// ── Telas (campo 7) ──────────────────────────────────────────────────────────────────────────────────

export interface TelaOnda1 {
  readonly tela: string;
  /** Item da árvore de menu (rótulo de produto). */
  readonly item: string;
  readonly setor: SetorOnda1;
  /** Permissões do catálogo do M06 (três partes). Painel e totem entram por token de dispositivo: lista vazia. */
  readonly ler: readonly string[];
  readonly agir: readonly string[];
  readonly marco: string;
  /** A tela fica fora da liberação da onda 1 (o motivo), como as operações que ela grava. */
  readonly foraDaOnda1?: string;
}

/**
 * Telas da onda 1 com as permissões do catálogo. A ficha escreve códigos de trabalho (`agenda.consulta.agendar`,
 * `atendimento.ambulatorio.abrir`); valem os do catálogo, gerados das opções do legado (regra 1 do M06).
 */
export const TELAS_ONDA_1: readonly TelaOnda1[] = [
  {
    tela: 'Cadastro e busca de paciente',
    item: 'Cadastros > Pacientes (cadastro único) > Cadastro e busca de paciente',
    setor: 'cadastros-estrutura',
    ler: ['cadastro.paciente.ler'],
    agir: ['cadastro.paciente.criar', 'cadastro.paciente.editar'],
    marco: 'M11',
  },
  {
    tela: 'Pessoas (CPF/CNPJ)',
    item: 'Cadastros > Pacientes (cadastro único) > Pessoas (CPF/CNPJ)',
    setor: 'cadastros-estrutura',
    ler: ['cadastro.pessoa.ler'],
    agir: [],
    marco: 'M11',
  },
  {
    tela: 'Profissionais e solicitantes',
    item: 'Cadastros > Profissionais',
    setor: 'cadastros-estrutura',
    ler: ['cadastro.profissional.ler', 'cadastro.solicitante.ler'],
    // Revisão do M39: a inclusão do solicitante externo; D-PROF-39 (liberação full): a inclusão, a edição, a
    // inativação e a exclusão (só sem vínculo) do profissional.
    agir: [
      'cadastro.solicitante.criar',
      'cadastro.profissional.criar',
      'cadastro.profissional.editar',
      'cadastro.profissional.excluir',
    ],
    marco: 'M11',
  },
  {
    tela: 'Agenda de consultas',
    item: 'Agenda > Agenda ambulatorial (consultas)',
    setor: 'agendamento',
    ler: ['agenda.agenda.ler', 'agenda.marcacao.ler', 'agenda.grade.ler'],
    agir: [
      'agenda.marcacao.agendar',
      'agenda.marcacao.cancelar',
      'agenda.marcacao.remarcar',
      'agenda.marcacao.confirmar',
      'agenda.encaixe.criar',
      'agenda.grade.gerar',
      'agenda.grade.reverter',
      'agenda.cobertura.editar',
      'agenda.falta.registrar',
    ],
    marco: 'M17',
  },
  {
    tela: 'Agenda de exames',
    item: 'Agenda > Agenda de exames (SADT)',
    setor: 'agendamento',
    ler: ['agenda.exame.ler'],
    agir: ['agenda.exame.agendar', 'agenda.exame.cancelar'],
    marco: 'M18',
    foraDaOnda1: DP8,
  },
  {
    tela: 'Senhas, guichê e totem',
    item: 'Recepção > Senhas e filas',
    setor: 'recepcao-ambulatorial',
    ler: ['recepcao.senha.ler'],
    agir: ['recepcao.senha.emitir', 'recepcao.senha.chamar', 'recepcao.senha.encaminhar'],
    marco: 'M19',
  },
  {
    tela: 'Painéis de chamada (TV)',
    item: 'Recepção > Senhas e filas > Painéis de chamada (TV, com voz)',
    setor: 'recepcao-ambulatorial',
    ler: [],
    agir: [],
    marco: 'M19',
  },
  {
    tela: 'Abertura e encerramento de atendimento ambulatorial',
    item: 'Recepção > Atendimento',
    setor: 'recepcao-ambulatorial',
    ler: ['atendimento.atendimento.ler'],
    agir: [
      'atendimento.atendimento.abrir',
      'atendimento.atendimento.encerrar',
      'atendimento.atendimento.cancelar',
      'atendimento.segurado.editar',
      'atendimento.procedimento.lancar',
      'atendimento.impresso.emitir',
    ],
    marco: 'M20',
  },
  {
    tela: 'Fila da recepção',
    item: 'Início > Minha fila de trabalho (worklist do perfil) > Recepção',
    setor: 'recepcao-ambulatorial',
    ler: ['recepcao.senha.ler'],
    agir: [],
    marco: 'M27',
  },
];

// ── Lista para ligar um setor (regra 1; cap-15 §15.3.2; cap-14 §14.8.2) ──────────────────────────────

/** Itens que precisam estar cumpridos para ligar um setor da onda 1 num estabelecimento. */
export const ITENS_LIGAR_SETOR = [
  'operacoes-conferidas',
  'aceite-jornada',
  'trilha-concluida',
  'estacoes-ti',
  'impressoras-etiqueta',
  'leitores',
  'tvs',
  'carga-pico-recepcao',
  'apoio-no-setor',
  'canal-chamados',
  'teste-retorno',
  'ensaio-recolhimento',
  'autorizacao-dono',
] as const;
export type ItemLigarSetor = (typeof ITENS_LIGAR_SETOR)[number];

/** Rótulo de produto de cada item (tela e evidências). */
export const ROTULO_ITEM_LIGAR: Readonly<Record<ItemLigarSetor, string>> = {
  'operacoes-conferidas': 'Operações do setor conferidas no estabelecimento',
  'aceite-jornada': 'Aceite da jornada pelo chave-usuário',
  'trilha-concluida': 'Trilha de treinamento concluída por quem vai começar',
  'estacoes-ti': 'Estações conferidas pela TI',
  'impressoras-etiqueta': 'Impressoras de etiqueta conferidas pela TI',
  leitores: 'Leitores conferidos pela TI',
  tvs: 'TVs dos painéis conferidas pela TI',
  'carga-pico-recepcao': 'Carga do pico da recepção dentro do limite na homologação',
  'apoio-no-setor': 'Apoio no setor nos primeiros turnos',
  'canal-chamados': 'Canal de chamados aberto',
  'teste-retorno': 'Teste de retorno ao sistema anterior feito com o setor',
  'ensaio-recolhimento': 'Ensaio de recolhimento na homologação',
  'autorizacao-dono': 'Autorização do dono para o setor e o estabelecimento',
};

export const SITUACOES_ITEM_LIGAR = ['cumprido', 'pendente', 'nao-se-aplica'] as const;
export type SituacaoItemLigar = (typeof SITUACOES_ITEM_LIGAR)[number];

export const esquemaItemLigar = z.object({
  item: z.enum(ITENS_LIGAR_SETOR),
  situacao: z.enum(SITUACOES_ITEM_LIGAR),
  /** Onde está a prova (caminho, chamado, registro); nunca nome de pessoa nem dado de paciente. */
  evidencia: z.string().max(300).default(''),
  /** Data civil do cumprimento (AAAA-MM-DD), ou null. */
  em: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});
export type ItemLigar = z.infer<typeof esquemaItemLigar>;

/** Itens que só se aplicam a setores com o equipamento (o cadastro não tem TV nem leitor). */
export const ITENS_POR_SETOR: Readonly<Record<SetorOnda1, readonly ItemLigarSetor[]>> = {
  'cadastros-estrutura': ITENS_LIGAR_SETOR.filter((i) => !['tvs', 'leitores'].includes(i)),
  agendamento: ITENS_LIGAR_SETOR.filter((i) => !['tvs', 'leitores', 'impressoras-etiqueta'].includes(i)),
  'recepcao-ambulatorial': [...ITENS_LIGAR_SETOR],
};

export const VEREDITOS_LIGAR = ['pode-ligar', 'falta', 'bloqueado'] as const;
export type VereditoLigar = (typeof VEREDITOS_LIGAR)[number];

export const esquemaAvaliacaoLigar = z.object({
  setor: z.enum(SETORES_ONDA_1),
  hospital: z.string(),
  veredito: z.enum(VEREDITOS_LIGAR),
  /** Motivo do bloqueio do estabelecimento (DP-4, HS-1), ou null. */
  bloqueio: z.string().nullable(),
  itens: z.array(
    z.object({
      item: z.enum(ITENS_LIGAR_SETOR),
      rotulo: z.string(),
      situacao: z.enum(SITUACOES_ITEM_LIGAR),
      detalhe: z.string(),
    }),
  ),
  /** Operações do setor fora de `conferida`/`liberada`, com o estado. */
  operacoesPendentes: z.array(z.object({ nome: z.string(), estado: z.string() })),
  foraDaOnda: z.array(z.object({ nome: z.string(), motivo: z.string() })),
});
export type AvaliacaoLigar = z.infer<typeof esquemaAvaliacaoLigar>;

// ── Indicadores de disputa (entregável; painel de migração do M37; cap-10 §10.5; cap-15 §15.3.4) ────────

/** Os quatro indicadores de disputa da onda 1. */
export const INDICADORES_DISPUTA = [
  'colisoes-grade',
  'recusas-horario-ocupado',
  'senhas-por-sistema',
  'esperas-trava',
] as const;
export type IndicadorDisputa = (typeof INDICADORES_DISPUTA)[number];

export const ROTULO_INDICADOR_DISPUTA: Readonly<Record<IndicadorDisputa, string>> = {
  'colisoes-grade': 'Colisões na grade de horários',
  'recusas-horario-ocupado': 'Recusas por horário ocupado',
  'senhas-por-sistema': 'Senhas chamadas por sistema',
  'esperas-trava': 'Esperas por registro em edição',
};

/** Código do problema que o executor devolve quando o horário foi ocupado por outro terminal (M17, M18). */
export const CODIGO_HORARIO_OCUPADO = 'horario-ocupado';

export const esquemaIndicadoresDisputa = z.object({
  hospital: z.string(),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  setores: z.array(
    z.object({
      setor: z.enum(SETORES_ONDA_1),
      colisoesGrade: z.number().int().nonnegative(),
      recusasHorarioOcupado: z.number().int().nonnegative(),
      esperasTrava: z.number().int().nonnegative(),
      senhas: z
        .object({
          noNovo: z.number().int().nonnegative(),
          noOutro: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
        })
        .nullable(),
      /** As contas com as parcelas impressas (ex.: "3 + 1 = 4"). */
      parcelas: z.record(z.enum(INDICADORES_DISPUTA), z.string()),
    }),
  ),
});
export type IndicadoresDisputa = z.infer<typeof esquemaIndicadoresDisputa>;

// ── Assinaturas extras (campo 9) ─────────────────────────────────────────────────────────────────────

export interface CenarioExtraOnda1 {
  readonly operacao: string;
  readonly cenario: string;
  readonly descricao: string;
  /** Estabelecimento do cenário (o `hs` fica bloqueado por HS-1). */
  readonly hospital: 'pc' | 'hs';
}

/**
 * Cenários de assinatura que a ficha pede além dos das fichas de origem. Os arquivos ficam em
 * packages/legado/src/<grupo>/assinaturas/<operacao>/<cenario>.assinatura.json (a pasta usa o nome completo da
 * operação, como as demais).
 */
export const CENARIOS_EXTRAS_ONDA_1: readonly CenarioExtraOnda1[] = [
  {
    operacao: 'agenda.agendarConsulta',
    cenario: 'colisao-legado',
    descricao:
      'marcação feita pelo outro sistema no mesmo horário depois de a tela ler a vaga e antes da gravação: recusa sem gravar',
    hospital: 'pc',
  },
  {
    operacao: 'agenda.agendarExame',
    cenario: 'colisao-legado',
    descricao: 'o mesmo, na agenda de exames (fora da liberação da onda 1, DP-8)',
    hospital: 'pc',
  },
  {
    operacao: 'recepcao.chamarSenha',
    cenario: 'disputa-legado',
    descricao:
      'primeira senha da fila já chamada pelo outro sistema quando o novo lê a fila: passa à seguinte (a corrida no meio da chamada é do teste da receita)',
    hospital: 'pc',
  },
  {
    operacao: 'cadastro.cadastrarPaciente',
    cenario: 'pc',
    descricao: 'prontuário pela regra do parâmetro do estabelecimento (anual ou não)',
    hospital: 'pc',
  },
  {
    operacao: 'cadastro.cadastrarPaciente',
    cenario: 'hs',
    descricao: 'o mesmo, no Serrano (HS-1: sem a cópia)',
    hospital: 'hs',
  },
];

// ── API da onda 1 no painel de migração (M39; GET e PUT da lista para ligar; indicadores de disputa) ──────

/** Itens que a pessoa registra (o das operações é calculado pelo catálogo, nunca registrado à mão). */
export const ITENS_LIGAR_REGISTRAVEIS = ITENS_LIGAR_SETOR.filter((i) => i !== 'operacoes-conferidas');

/**
 * Evidência sem dado pessoal: caminho, número de chamado ou de ata. Recusa sequência longa de dígitos (o formato de
 * CPF, CNS, telefone ou prontuário) e o sinal de e-mail.
 */
const evidenciaSemPessoal = textoCp1252(300).pipe(
  z
    .string()
    .trim()
    .refine(
      (v) => !/\d[\d.\-/ ]{9,}\d/.test(v),
      'A evidência não pode ter número de documento ou de telefone.',
    )
    .refine((v) => !v.includes('@'), 'A evidência não pode ter endereço de e-mail.'),
);

export const esquemaGravarItensLigar = z.object({
  itens: z
    .array(
      z.object({
        item: z.enum(ITENS_LIGAR_SETOR).refine((i) => i !== 'operacoes-conferidas', {
          message: 'As operações conferidas são calculadas pelo catálogo: não se registram à mão.',
        }),
        situacao: z.enum(SITUACOES_ITEM_LIGAR),
        evidencia: evidenciaSemPessoal.default(''),
        em: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.')
          .nullable()
          .default(null),
      }),
    )
    .min(1)
    .max(ITENS_LIGAR_SETOR.length)
    .refine((xs) => new Set(xs.map((x) => x.item)).size === xs.length, 'Cada item só uma vez.')
    .refine(
      (xs) => xs.every((x) => x.situacao === 'pendente' || (x.evidencia.length >= 3 && x.em !== null)),
      'Item cumprido ou que não se aplica precisa da evidência e da data.',
    ),
  justificativa: textoCp1252(200).pipe(z.string().trim().min(10, 'Justifique com pelo menos 10 caracteres.')),
  senha: z.string().max(200).optional(),
});
export type GravarItensLigar = z.infer<typeof esquemaGravarItensLigar>;

/** Um item como está gravado (SGH_CFG_COEX_LIGAR): quem alterou é o login, nunca o nome. */
export const esquemaItemLigarGravado = esquemaItemLigar.extend({
  alteradoPor: z.string(),
  alteradoEm: z.string(),
});
export type ItemLigarGravado = z.infer<typeof esquemaItemLigarGravado>;

export const esquemaPainelOnda1 = z.object({
  estabelecimento: z.string(),
  /** DP-4: o estabelecimento que vai primeiro. */
  primeiro: z.string(),
  avaliacoes: z.array(
    esquemaAvaliacaoLigar.extend({
      nome: z.string(),
      registrados: z.array(esquemaItemLigarGravado),
    }),
  ),
  /** Indicadores de disputa do dia corrente (as parcelas impressas). */
  disputa: esquemaIndicadoresDisputa,
  /** Telas da onda 1 por setor (rótulo e as permissões do catálogo). */
  telas: z.array(
    z.object({
      tela: z.string(),
      item: z.string(),
      setor: z.enum(SETORES_ONDA_1),
      ler: z.array(z.string()),
      agir: z.array(z.string()),
    }),
  ),
});
export type PainelOnda1 = z.infer<typeof esquemaPainelOnda1>;

/** Código da recusa do lote de um setor da onda 1 com a lista para ligar incompleta (regra 1). */
export const CODIGO_LISTA_LIGAR_INCOMPLETA = 'lista-ligar-incompleta';
