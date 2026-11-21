// Onda 3 da coexistência (ficha do M41; cap-15 §15.3.3): farmácia, dispensação, almoxarifado e compras. O marco não
// constrói operação nova: leva a `liberada` as operações dos M28 e M29 por hospital, local de estoque e pessoa, na
// ordem recomendada do campo 12, e acompanha o que os gatilhos do banco produzem (saldo, lote, custo médio, consumo e
// item de conta). Este arquivo é o vocabulário da onda (setores, operações, chaves e tabelas de efeito) e o contrato
// do painel de acompanhamento (a API devolve e a tela valida com o mesmo Zod). Os textos daqui podem aparecer na tela:
// nunca citam o outro sistema pelo nome (ADR 0023).
import { z } from 'zod';
import type { ItemCriterioLiberacao } from '../onda2/onda2.js';

/** Chave da prescrição eletrônica da onda 2 (M24/M40): a farmácia de uma unidade só liga depois dela (regra 1). */
export const CHAVE_PRESCRICAO_ONDA2 = 'pep.prescricao.cpoe';

export const IDS_SETOR_ONDA3 = [
  'almoxarifado-compras',
  'farmacia-central',
  'farmacias-satelites',
  'farmacia-clinica',
] as const;
export type IdSetorOnda3 = (typeof IDS_SETOR_ONDA3)[number];

export interface SetorOnda3 {
  readonly id: IdSetorOnda3;
  /** Ordem recomendada de liberação (campo 12). */
  readonly ordem: number;
  readonly nome: string;
  /** Grupos funcionais (nome do perfil de acesso, sem acento) de quem começa no setor (cap-15 §15.4.1). */
  readonly grupos: readonly string[];
  /** Funcionalidades (chaves POL-3) que o setor liga. */
  readonly recursos: readonly string[];
  /** Operações P1: liberadas no `pc` para os locais do setor (critério de aceite do M41). */
  readonly operacoesP1: readonly string[];
  /** Operações P2: liberadas só se chegarem a `conferida`; senão, ficam com o outro sistema (linha no ESTADO.md). */
  readonly operacoesP2: readonly string[];
  /** Regra 1: a dispensação só liga nas unidades com a prescrição eletrônica já ligada. */
  readonly exigePrescricaoDaUnidade: boolean;
}

const DOCUMENTOS_ESTOQUE = [
  'suprimentos.registrarSaida',
  'suprimentos.requisitarMaterial',
  'suprimentos.registrarDevolucao',
  'suprimentos.transferir',
] as const;

/** Setores da onda 3, na ordem do campo 12 (almoxarifado central e compras; farmácia central; satélites; clínica). */
export const SETORES_ONDA3: readonly SetorOnda3[] = [
  {
    id: 'almoxarifado-compras',
    ordem: 1,
    nome: 'Almoxarifado central e compras',
    grupos: ['ALMOXARIFADO', 'ALMOXARIFADO_SUPERVISAO', 'COMPRAS'],
    recursos: [
      'suprimentos.estoque',
      'suprimentos.notaFiscal',
      'suprimentos.compras',
      'suprimentos.inventario',
      'suprimentos.kits',
      'suprimentos.fechamento',
      'suprimentos.saneamento',
    ],
    operacoesP1: [
      ...DOCUMENTOS_ESTOQUE,
      'suprimentos.registrarEntradaNF',
      'suprimentos.criarPedido',
      'suprimentos.registrarProposta',
      'suprimentos.definirVencedorCotacao',
    ],
    operacoesP2: [
      'suprimentos.registrarMovimentoDireto',
      'suprimentos.registrarBalanco',
      'suprimentos.fecharMes',
      'suprimentos.reabrirMes',
      'suprimentos.reporKitRastreavel',
      'suprimentos.desconsolidarDocumento',
      'suprimentos.corrigirValidadeLote',
    ],
    exigePrescricaoDaUnidade: false,
  },
  {
    id: 'farmacia-central',
    ordem: 2,
    nome: 'Farmácia central (estoque e dispensação)',
    grupos: ['FARMACIA', 'FARMACIA_SUPERVISAO'],
    recursos: [
      'suprimentos.estoque',
      'suprimentos.dispensacao',
      'suprimentos.entrega',
      'suprimentos.controlados',
    ],
    operacoesP1: [...DOCUMENTOS_ESTOQUE, 'suprimentos.dispensarHorario', 'suprimentos.confirmarEntrega'],
    operacoesP2: [
      'suprimentos.devolverDose',
      'suprimentos.cancelarDispensacao',
      'suprimentos.registrarPerdaControlado',
    ],
    exigePrescricaoDaUnidade: true,
  },
  {
    id: 'farmacias-satelites',
    ordem: 3,
    nome: 'Farmácias satélites',
    grupos: ['FARMACIA', 'FARMACIA_SUPERVISAO'],
    recursos: [
      'suprimentos.estoque',
      'suprimentos.dispensacao',
      'suprimentos.entrega',
      'suprimentos.controlados',
    ],
    operacoesP1: [...DOCUMENTOS_ESTOQUE, 'suprimentos.dispensarHorario', 'suprimentos.confirmarEntrega'],
    operacoesP2: [
      'suprimentos.devolverDose',
      'suprimentos.cancelarDispensacao',
      'suprimentos.registrarPerdaControlado',
    ],
    exigePrescricaoDaUnidade: true,
  },
  {
    id: 'farmacia-clinica',
    ordem: 4,
    nome: 'Farmácia clínica (avaliação da prescrição)',
    grupos: ['FARMACIA_SUPERVISAO', 'FARMACIA'],
    recursos: ['suprimentos.avaliacao'],
    operacoesP1: [],
    // DP-25: a avaliação fica só no novo (fila em SGH_); o status no banco do hospital só com a decisão registrada.
    operacoesP2: ['suprimentos.avaliarPrescricao'],
    exigePrescricaoDaUnidade: true,
  },
];

/** Construídas e desligadas, fora da liberação da onda: farmácia ambulatorial (SNGPC) e livro de controlados (VISA). */
export const RECURSOS_FORA_DA_ONDA3 = ['suprimentos.ambulatorial', 'suprimentos.livroControlados'] as const;

/**
 * Efeitos do movimento de estoque: tabelas derivadas do estoque (saldo por local, saldo mensal, saldo e custo médio do
 * insumo, consumo por centro de custo e histórico do custo médio). Sem gatilho (regra de ouro 2), quem as atualiza é a
 * operação de movimento de estoque do domínio, na mesma transação do documento. A numeração do documento e o
 * lançamento contábil são de outros domínios (núcleo e financeiro) e ficam fora desta lista.
 */
export const TABELAS_EFEITO_ESTOQUE = [
  'saldo_estoque',
  'saldo_estoque_mensal',
  'insumo',
  'consumo_centro_custo',
  'custo_medio_historico',
] as const;

/**
 * Operações de movimento de estoque: as únicas da onda que podem gravar as tabelas de efeito (regra 2). Cada uma move
 * quantidade ou fecha a competência e atualiza os efeitos na transação do próprio documento.
 */
export const OPERACOES_MOVIMENTO_ESTOQUE = [
  ...DOCUMENTOS_ESTOQUE,
  'suprimentos.registrarEntradaNF',
  'suprimentos.registrarMovimentoDireto',
  'suprimentos.registrarBalanco',
  'suprimentos.fecharMes',
  'suprimentos.reabrirMes',
  'suprimentos.dispensarHorario',
  'suprimentos.devolverDose',
  'suprimentos.cancelarDispensacao',
  'suprimentos.registrarPerdaControlado',
] as const;

/** Tipos de documento acompanhados pelo painel da onda (cabeçalho e operação do novo que o grava). */
export const DOCUMENTOS_ONDA3 = [
  { tipo: 'saida', tabela: 'documento_estoque', rotulo: 'Saídas e requisições' },
  { tipo: 'devolucao', tabela: 'documento_estoque', rotulo: 'Devoluções' },
  { tipo: 'transferencia', tabela: 'documento_estoque', rotulo: 'Transferências' },
  { tipo: 'nota', tabela: 'nota_entrada', rotulo: 'Entradas por nota fiscal' },
  { tipo: 'dispensacao', tabela: 'dispensacao', rotulo: 'Dispensações por horário' },
] as const;
export const TIPOS_DOCUMENTO_ONDA3 = ['saida', 'devolucao', 'transferencia', 'nota', 'dispensacao'] as const;
export type TipoDocumentoOnda3 = (typeof TIPOS_DOCUMENTO_ONDA3)[number];

/** Módulo de estoque nas conexões ao banco (o módulo "Gestão de estoque"). */
export const MODULO_CONEXAO_ESTOQUE = 1;

/** Tetos das leituras da onda (campo 4). */
export const TETO_DOCUMENTOS_NOVO_DIA = 1_000;
export const TETO_REQUISICOES_POR_LOCAL = 500;
/** Janela das requisições pendentes (a mesma da tela do M28). */
export const DIAS_REQUISICOES_PENDENTES = 120;
/** Janela de "ainda usa o estoque pelo outro sistema" (última conexão nos últimos N dias). */
export const DIAS_USO_ESTOQUE = 14;

// ── Painel de acompanhamento ────────────────────────────────────────────────────────────────────────────

const n = z.number();
const texto = z.string();
/** Contagem agregada: abaixo de 5 vira '<5' (dado agregado nunca reidentifica). */
const contagem = z.union([z.number().int().nonnegative(), z.literal('<5')]);

export const esquemaDocumentosPorSistema = z.object({
  tipo: z.enum(TIPOS_DOCUMENTO_ONDA3),
  local: n.nullable(),
  total: n,
  /** Gravados por este sistema (trilha com sucesso no dia). */
  novo: n,
  /** Total menos os deste sistema. */
  demais: n,
});
export type DocumentosPorSistema = z.infer<typeof esquemaDocumentosPorSistema>;

/** Efeitos esperados dos gatilhos num documento consolidado (null: não se aplica ao documento). */
export const esquemaEfeitosDocumento = z.object({
  /** O item valorizado pelo custo médio (custo médio maior que zero em todos os itens). */
  valorizado: z.boolean().nullable(),
  /** Saldo mensal do item na competência. */
  saldoMensal: z.boolean().nullable(),
  /** Consumo por centro de custo com o documento (centros de custo fora de 9901 a 9999). */
  consumo: z.boolean().nullable(),
  /** Lote do item rastreável ligado ao documento. */
  lote: z.boolean().nullable(),
  /** Saldo por local da competência (D-MOTOR-28: sem gatilho; só informativo até o cenário controlado). */
  saldoLocal: z.boolean().nullable(),
});
export type EfeitosDocumento = z.infer<typeof esquemaEfeitosDocumento>;

export const ALERTAS_EFEITO = [
  'sem-valorizacao',
  'sem-saldo-mensal',
  'sem-consumo',
  'sem-lote',
  'nao-consolidado',
] as const;
export type AlertaEfeito = (typeof ALERTAS_EFEITO)[number];

export const esquemaEfeitoDocumentoNovo = z.object({
  operacao: texto,
  tipo: z.enum(TIPOS_DOCUMENTO_ONDA3),
  chave: z.object({ ano: n, mes: n, doc: n }),
  local: n.nullable(),
  itens: n,
  efeitos: esquemaEfeitosDocumento,
  alertas: z.array(z.enum(ALERTAS_EFEITO)),
});
export type EfeitoDocumentoNovo = z.infer<typeof esquemaEfeitoDocumentoNovo>;

export const esquemaHorariosUnidade = z.object({
  unidade: texto,
  prescritos: n,
  dispensados: n,
  dispensadosNovo: n,
  /** dispensados / prescritos, em %, com 1 casa (null sem horário prescrito). */
  percentual: n.nullable(),
});
export type HorariosUnidade = z.infer<typeof esquemaHorariosUnidade>;

export const esquemaRequisicoesPorLocal = z.object({ local: n, localNome: texto, pendentes: n });
export type RequisicoesPorLocal = z.infer<typeof esquemaRequisicoesPorLocal>;

/** Quem ainda entra pelo módulo de estoque do outro sistema, por local da onda (só contagens). */
export const esquemaUsoEstoquePorLocal = z.object({
  local: n,
  localNome: texto,
  usuariosDoLocal: contagem,
  conectadosNaJanela: contagem,
});
export type UsoEstoquePorLocal = z.infer<typeof esquemaUsoEstoquePorLocal>;

export const esquemaPainelOnda3 = z.object({
  hospital: texto,
  dia: texto,
  documentos: z.array(esquemaDocumentosPorSistema),
  efeitos: z.array(esquemaEfeitoDocumentoNovo),
  /** Documentos do novo com algum alerta (o painel destaca). */
  comAlerta: n,
  horarios: z.array(esquemaHorariosUnidade),
  requisicoes: z.array(esquemaRequisicoesPorLocal),
  uso: z.array(esquemaUsoEstoquePorLocal),
  ultimoMesFechado: z.object({ ano: n, mes: n }).nullable(),
  cortada: z.boolean(),
});
export type PainelOnda3 = z.infer<typeof esquemaPainelOnda3>;

/** Conferência numérica (campo 10): saldo e preço médio lidos no outro sistema × lidos aqui, por item movimentado. */
export const esquemaDivergenciaNumerica = z.object({
  item: n,
  local: n.nullable(),
  campo: z.enum(['saldo', 'precoMedio']),
  esperado: n,
  lido: n,
  diferenca: n,
});
export type DivergenciaNumerica = z.infer<typeof esquemaDivergenciaNumerica>;

// ── Liberação por setor (aba "Onda 3" do painel de migração; regras 1 a 8 do M40 com as condições da onda) ──────

/** Ordem recomendada dos setores da onda 3 (campo 12; ids de SETORES_PRONTIDAO, um setor por passo). */
export const ORDEM_SETORES_ONDA_3: readonly (readonly IdSetorOnda3[])[] = [...SETORES_ONDA3]
  .sort((a, b) => a.ordem - b.ordem)
  .map((s) => [s.id]);

export const SETORES_ONDA_3: readonly string[] = ORDEM_SETORES_ONDA_3.flat();

/**
 * Itens a mais do critério por setor da onda 3 (somados aos gerais do M40): o inventário recente (campo 2), a
 * conferência no outro sistema de cada documento gravado pelo novo na cópia (campo 12), a conferência numérica de
 * saldo e preço médio (campo 10) e, nas farmácias, a prescrição eletrônica em uso nas unidades atendidas (regra 1).
 */
export const ITENS_CRITERIO_POR_SETOR_ONDA_3: Readonly<
  Record<IdSetorOnda3, readonly ItemCriterioLiberacao[]>
> = {
  'almoxarifado-compras': ['inventario-recente', 'documentos-conferidos', 'conferencia-numerica'],
  'farmacia-central': [
    'inventario-recente',
    'documentos-conferidos',
    'conferencia-numerica',
    'prescricao-na-unidade',
  ],
  'farmacias-satelites': [
    'inventario-recente',
    'documentos-conferidos',
    'conferencia-numerica',
    'prescricao-na-unidade',
  ],
  'farmacia-clinica': ['prescricao-na-unidade'],
};

/** Operação de gravação que a ficha nomeia (campos 5 e 9), com o nome do catálogo e os cenários mínimos. */
export interface OperacaoFichaOnda3 {
  readonly ficha: string;
  readonly catalogo: readonly string[];
  readonly setores: readonly IdSetorOnda3[];
  readonly marco: string;
  /** P1: liberada no `pc` para os locais do setor; P2: só se chegar a `conferida`. */
  readonly prioridade: 'P1' | 'P2';
  /** Cenários mínimos do campo 9, com os nomes da ficha. */
  readonly cenariosMinimos: readonly string[];
  /**
   * Cenário da ficha → cenário de perfil que o catálogo já tem com outro nome (D-CEN-41). O cenário controlado é
   * capturado com o nome da ficha; até lá vale o de perfil.
   */
  readonly equivalentes?: Readonly<Record<string, string>>;
  readonly nota?: string;
}

const ALMOX: readonly IdSetorOnda3[] = ['almoxarifado-compras'];
const DOCS: readonly IdSetorOnda3[] = ['almoxarifado-compras', 'farmacia-central', 'farmacias-satelites'];
const FARM: readonly IdSetorOnda3[] = ['farmacia-central', 'farmacias-satelites'];

export const OPERACOES_FICHA_ONDA_3: readonly OperacaoFichaOnda3[] = [
  {
    ficha: 'suprimentos.registrarSaida',
    catalogo: ['suprimentos.registrarSaida'],
    setores: DOCS,
    marco: 'M28',
    prioridade: 'P1',
    cenariosMinimos: [
      'paciente-interno-com-conta',
      'centro-de-custo',
      'item-com-dois-lotes',
      'item-controlado',
      'saldo-insuficiente',
      'mes-fechado',
    ],
  },
  {
    ficha: 'suprimentos.requisitarMaterial',
    catalogo: ['suprimentos.requisitarMaterial'],
    setores: DOCS,
    marco: 'M28',
    prioridade: 'P1',
    cenariosMinimos: [],
  },
  {
    ficha: 'suprimentos.registrarDevolucao',
    catalogo: ['suprimentos.registrarDevolucao'],
    setores: DOCS,
    marco: 'M28',
    prioridade: 'P1',
    cenariosMinimos: ['paciente-com-estorno-na-conta', 'item-com-lote'],
  },
  {
    ficha: 'suprimentos.transferir',
    catalogo: ['suprimentos.transferir'],
    setores: DOCS,
    marco: 'M28',
    prioridade: 'P1',
    cenariosMinimos: ['central-para-satelite', 'item-com-lote'],
  },
  {
    ficha: 'suprimentos.registrarEntradaNF',
    catalogo: ['suprimentos.registrarEntradaNF'],
    setores: ALMOX,
    marco: 'M28',
    prioridade: 'P1',
    cenariosMinimos: ['com-pedido-completo', 'dois-lotes', 'fator-de-unidade'],
  },
  {
    ficha: 'suprimentos.criarPedido',
    catalogo: ['suprimentos.criarPedido', 'suprimentos.registrarProposta'],
    setores: ALMOX,
    marco: 'M28',
    prioridade: 'P1',
    cenariosMinimos: [],
    nota: 'no catálogo, a proposta do fornecedor é uma operação própria, usada pela cotação',
  },
  {
    ficha: 'suprimentos.definirVencedorCotacao',
    catalogo: ['suprimentos.definirVencedorCotacao'],
    setores: ALMOX,
    marco: 'M28',
    prioridade: 'P1',
    cenariosMinimos: ['vencedor-unico', 'rateio-dois-vencedores'],
  },
  ...[
    'registrarMovimentoDireto',
    'registrarBalanco',
    'fecharMes',
    'reabrirMes',
    'reporKitRastreavel',
    'desconsolidarDocumento',
    'corrigirValidadeLote',
  ].map((o): OperacaoFichaOnda3 => ({
    ficha: `suprimentos.${o}`,
    catalogo: [`suprimentos.${o}`],
    setores: ALMOX,
    marco: 'M28',
    prioridade: 'P2',
    cenariosMinimos: [],
  })),
  {
    ficha: 'suprimentos.dispensarHorario',
    catalogo: ['suprimentos.dispensarHorario'],
    setores: FARM,
    marco: 'M29',
    prioridade: 'P1',
    cenariosMinimos: [
      'horario-unico',
      'varios-horarios-da-prescricao',
      'item-controlado',
      'horario-ja-dispensado-no-legado',
    ],
    equivalentes: {
      'horario-unico': 'internado-dose-unica',
      'varios-horarios-da-prescricao': 'internado-varios-horarios',
      'item-controlado': 'item-controlado',
      'horario-ja-dispensado-no-legado': 'dose-ja-dispensada',
    },
  },
  {
    ficha: 'suprimentos.confirmarEntrega',
    catalogo: ['suprimentos.confirmarEntrega'],
    setores: FARM,
    marco: 'M29',
    prioridade: 'P1',
    cenariosMinimos: ['entrega-completa', 'entrega-parcial'],
    equivalentes: { 'entrega-completa': 'aceite-no-tablet' },
    nota: 'a entrega parcial só no cenário controlado (o perfil não tem o caso): até lá, a entrega é da dose inteira',
  },
  ...['devolverDose', 'cancelarDispensacao', 'registrarPerdaControlado'].map((o): OperacaoFichaOnda3 => ({
    ficha: `suprimentos.${o}`,
    catalogo: [`suprimentos.${o}`],
    setores: FARM,
    marco: 'M29',
    prioridade: 'P2',
    cenariosMinimos: [],
  })),
  {
    ficha: 'suprimentos.avaliarPrescricao',
    catalogo: ['suprimentos.avaliarPrescricao'],
    setores: ['farmacia-clinica'],
    marco: 'M29',
    prioridade: 'P2',
    cenariosMinimos: [],
    nota: 'DP-25: a fila de avaliação fica no novo; o status no banco do hospital só com a decisão registrada',
  },
];

export const OPERACOES_CATALOGO_ONDA_3: readonly string[] = [
  ...new Set(OPERACOES_FICHA_ONDA_3.flatMap((o) => o.catalogo)),
];

/**
 * Regra 1: as chaves cuja ligação exige a prescrição eletrônica em uso nas unidades atendidas (a funcionalidade da
 * dispensação e da entrega, e as operações que elas liberam).
 */
export const CHAVES_REGRA_1_ONDA_3: readonly string[] = [
  'suprimentos.dispensacao',
  'suprimentos.entrega',
  'suprimentos.dispensarHorario',
  'suprimentos.confirmarEntrega',
];

/** Janela das prescrições gravadas pelo novo que provam a prescrição "em uso" na unidade (regra 1). */
export const DIAS_PRESCRICAO_EM_USO = 14;

/** Código da recusa ao ligar a dispensação com unidade atendida sem a prescrição eletrônica em uso (regra 1). */
export const CODIGO_FARMACIA_SEM_PRESCRICAO = 'farmacia-sem-prescricao';

/** Código da recusa do lote de um setor da onda 3 com o critério incompleto (regra 1 do M40). */
export const CODIGO_CRITERIO_ONDA_3_INCOMPLETO = 'criterio-onda3-incompleto';

/**
 * Recursos que só existem no novo na onda 3 (regra 6 do M40, roteiro de recolhimento). Ao recolher, voltam ao
 * processo de hoje: a fila de avaliação ao papel, a dupla conferência e o lacre ao registro manual.
 */
export const RECURSOS_SO_NO_NOVO_ONDA_3: Readonly<Record<string, string>> = {
  'suprimentos.avaliacao': 'a fila de avaliação farmacêutica',
  'suprimentos.controlados': 'a dupla conferência de controlados',
  'suprimentos.kits': 'o lacre e a conferência do carrinho de parada',
};

/** Motivo de cada recurso fora da liberação da onda (construído e desligado). */
export const MOTIVO_FORA_DA_ONDA3: Readonly<Record<(typeof RECURSOS_FORA_DA_ONDA3)[number], string>> = {
  'suprimentos.ambulatorial': 'farmácia ambulatorial e escrituração: fora da onda (DP-47.5 b)',
  'suprimentos.livroControlados':
    'livro de controlados informatizado: só depois da aprovação prévia da vigilância sanitária (DP-47.14)',
};

const itemAvaliado3 = z
  .object({
    item: z.string(),
    rotulo: z.string(),
    ok: z.boolean(),
    origem: z.enum(['calculado', 'registrado']),
    situacao: z.enum(['cumprido', 'pendente', 'nao-se-aplica']),
    falta: z.string().nullable(),
    detalhe: z.string(),
  })
  .strict();

export const esquemaSetorMigracaoOnda3 = z
  .object({
    setor: z.string(),
    nome: z.string(),
    passo: z.number().int().min(1),
    podeLiberar: z.boolean(),
    itens: z.array(itemAvaliado3),
    registrados: z.array(
      z
        .object({
          item: z.string(),
          situacao: z.enum(['cumprido', 'pendente', 'nao-se-aplica']),
          evidencia: z.string(),
          em: z.string().nullable(),
          alteradoPor: z.string(),
          alteradoEm: z.string(),
        })
        .strict(),
    ),
    operacoes: z.array(
      z
        .object({ nome: z.string(), estado: z.string(), fora: z.boolean(), prioridade: z.enum(['P1', 'P2']) })
        .strict(),
    ),
    /** Setores anteriores na ordem que ainda não estão liberados (aviso: quem decide é o comitê). */
    antesFaltam: z.array(z.string()),
    /** Regra 1: unidades atendidas pelo setor sem a prescrição eletrônica em uso (só nas farmácias). */
    exigePrescricao: z.boolean(),
    recursosSoNoNovo: z.array(z.object({ chave: z.string(), imprime: z.string() }).strict()),
    recolhimento: z.object({ chaves: z.array(z.string()), bloquear: z.array(z.string()) }).strict(),
  })
  .strict();
export type SetorMigracaoOnda3 = z.infer<typeof esquemaSetorMigracaoOnda3>;

export const esquemaPainelMigracaoOnda3 = z
  .object({
    estabelecimento: z.string(),
    primeiro: z.string(),
    seguramHospital: z.array(z.string()),
    ordem: z.array(z.array(z.string())),
    setores: z.array(esquemaSetorMigracaoOnda3),
    pentest: z.object({ bloqueia: z.boolean(), motivo: z.string() }).strict(),
    /** Regra 1: o mapa local → unidades atendidas e as unidades com a prescrição em uso (agregado, sem pessoa). */
    regra1: z
      .object({
        lido: z.boolean(),
        locais: z.array(
          z
            .object({
              local: z.number(),
              unidades: z.array(z.string()),
              faltam: z.array(z.string()),
            })
            .strict(),
        ),
        unidadesComPrescricao: z.array(z.string()),
      })
      .strict(),
    foraDaOnda: z.array(z.object({ chave: z.string(), motivo: z.string() }).strict()),
    codigosAConfirmar: z.array(
      z
        .object({
          tabela: z.string(),
          coluna: z.string(),
          vistos: z.array(z.string()),
          decisao: z.string(),
          confirma: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type PainelMigracaoOnda3 = z.infer<typeof esquemaPainelMigracaoOnda3>;

// ── Consultas da API do painel de efeito e da conferência numérica ───────────────────────────────────────────

const diaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD');

export const esquemaConsultaPainelOnda3 = z
  .object({
    dia: diaIso.optional(),
    local: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const esquemaLeituraNumerica = z
  .object({
    item: z.number().int().positive(),
    local: z.number().int().positive().nullable(),
    saldo: z.number().finite(),
    precoMedio: z.number().finite().min(0),
  })
  .strict();
export type LeituraNumericaOnda3 = z.infer<typeof esquemaLeituraNumerica>;

/** O retrato que o chave-usuário leu na outra estação (esperado), para comparar com o lido agora aqui. */
export const esquemaPedidoConferenciaNumerica = z
  .object({
    dia: diaIso,
    esperado: z.array(esquemaLeituraNumerica).min(1).max(500),
  })
  .strict();

export const esquemaConferenciaNumerica = z
  .object({
    dia: z.string(),
    /** Os itens movimentados pelo novo no dia, com o saldo do local e o preço médio lidos agora. */
    lidos: z.array(esquemaLeituraNumerica),
    divergencias: z.array(esquemaDivergenciaNumerica),
    /** Só no POST: quantos itens o chave-usuário informou. */
    conferidos: z.number().int().min(0),
  })
  .strict();
export type ConferenciaNumericaOnda3 = z.infer<typeof esquemaConferenciaNumerica>;
