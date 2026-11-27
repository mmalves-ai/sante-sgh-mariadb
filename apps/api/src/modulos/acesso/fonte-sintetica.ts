// Fonte de acesso SINTÉTICA (ficha do M05): só com AMBIENTE=dev ou ci declarado. Usuários sintéticos, sem
// tocar no cadastro de usuários do banco, para exercitar o BFF (sessão no servidor, cookie, inatividade,
// reautenticação, tentativas) sem credencial de pessoa real (regra 1.7). O login sobre o cadastro de usuários
// é provado em packages/legado/src/acesso/credencial.int.spec.ts (usuários sintéticos inseridos e
// desfeitos com ROLLBACK); o login com a senha de sempre é a validação humana (seção 13), nunca da IA.
//
// ACESSO_SINTETICO_INDISPONIVEL="cod:Nome" acrescenta um estabelecimento sintético FORA DO AR ao seletor
// (E2E do "indisponível", ARQ-1); só nesta fonte, nunca na real.
import type {
  Autenticacao,
  ConfigLogin,
  ContaAlvo,
  ContaAcesso,
  DadosSessao,
  SaudeEstabelecimento,
} from '../../sessao/tipos-acesso.js';

/** Perfil do "login como" com a contagem de logins não bloqueados (ADR 0021). */
export interface GrupoAlvo {
  readonly grupo: string;
  readonly usuarios: number;
}

/** Login de um perfil do "login como". */
export interface UsuarioAlvo {
  readonly login: string;
  readonly nome: string;
}
import type { Ambiente } from '@sgh/nucleo';
import { lerRedePadrao } from '../../sessao/rede.js';
import { lerEstabelecimentosSinteticos } from './estabelecimentos-sinteticos.js';
import {
  DOMINIOS_DECLARADOS,
  ESCOPOS_SEM_RESTRICAO,
  OPCOES_CONSULTA_POR_MODULO,
  PERMISSOES_ENFERMAGEM,
  PERMISSOES_ENFERMAGEM_M25,
  PERMISSOES_BALANCO,
  PERMISSOES_BALANCO_M45,
  PERMISSOES_PORTARIA,
  PERMISSOES_PORTARIA_M50,
  PERMISSOES_PEP_M23,
  PERMISSOES_SUPRIMENTOS_M28,
  PERMISSOES_FARMACIA_M29,
  PERMISSOES_FATURAMENTO_M30,
  PERMISSOES_FATURAMENTO_M31,
  PERMISSOES_FATURAMENTO_M51,
  PERMISSOES_FINANCEIRO_M32,
  PERMISSOES_REPASSE_M33,
  type UnidadeSessao,
} from '@sgh/contratos';
import type { ConcessoesLegado } from '@sgh/dominio-acesso';
import type { DadosAutorizacaoLegado } from '../../autorizacao/servico-autorizacao.js';
import { conferirSenha } from '@sgh/dominio-acesso';
import { CATALOGO_COMPLETO, mapaDeOrigem, opcoesDasPermissoes } from '../../autorizacao/catalogo.js';

// Opções do menu de origem das permissões do prontuário usadas pelos usuários sintéticos (mapa do conector).
const OPCOES_PEP_EVOLUCAO_LER = opcoesDasPermissoes('pep.evolucao.ler');
const OPCOES_PEP_EVOLUCAO_CRIAR = opcoesDasPermissoes('pep.evolucao.criar');
const OPCOES_PEP_ANEXO_LER = opcoesDasPermissoes('pep.anexo.ler');
const OPCOES_PEP_ANEXO_CRIAR = opcoesDasPermissoes('pep.anexo.criar');
import type { FonteAcesso } from '../../sessao/fonte-acesso.js';
import { EstadoAcessoSintetico } from './estado-sintetico.js';

interface ContaSintetica {
  /** null: sem senha guardada (SENHA_CRIPTOGRAFADA='F' e SENHA nula). */
  readonly senha: string | null;
  readonly criptografada: boolean;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly senhaAlteradaEm: Date | null;
  readonly unidades?: UnidadeSessao[];
  readonly termoAceito?: boolean;
  /** M06: concessões sintéticas do legado (grupo, opções, papéis SBIS, conselho). */
  readonly concessoes?: Partial<ConcessoesLegado>;
  /** M17: escopos sintéticos (unidades e tipos de agenda do usuário…); ausente = sem restrição. */
  readonly escopos?: Partial<DadosAutorizacaoLegado['escopos']>;
  /** M44: perfis complementares concedidos nominalmente (como SGH_ACESSO_PERFIL_USUARIO), vigentes desde sempre. */
  readonly perfisConcedidos?: readonly string[];
}

/**
 * M14: opções do legado dos domínios do lote de um módulo (as do contrato gerado) e as da consulta do módulo:
 * o usuário sintético da área tem o que o legado daria a quem cuida das tabelas dela.
 */
function opcoesDaArea(...modulos: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const d of DOMINIOS_DECLARADOS)
    if (d.marco === 'M14' && modulos.includes(d.modulo))
      for (const lista of Object.values(d.opcoesLegado)) for (const i of lista ?? []) ids.add(i);
  for (const m of modulos) for (const i of OPCOES_CONSULTA_POR_MODULO[m] ?? []) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

/** As opções do outro sistema dos cadastros genéricos de um marco posterior ao M14 (ex.: M53, os da folha). */
function opcoesDoMarco(marco: string, modulo: string): number[] {
  const ids = new Set<number>();
  for (const d of DOMINIOS_DECLARADOS)
    if (d.marco === marco && d.modulo === modulo)
      for (const lista of Object.values(d.opcoesLegado)) for (const i of lista ?? []) ids.add(i);
  return [...ids];
}

/** Concessões padrão de um usuário sintético: sem grupo, sem papel especial (só os recursos de pessoa). */
export const CONCESSOES_VAZIAS: ConcessoesLegado = {
  grupo: null,
  opcoesGrupo: [],
  opcoesPapel: [],
  papeis: [4],
  flags: [],
  conselho: false,
};

const SENHA_SINTETICA = 'Sintetico#2026';

/** M23: as opções do legado do prontuário de uso diário (painel, documentos, exames, resultados, alta, anexos…). */
const OPCOES_PEP_M23 = [...new Set(PERMISSOES_PEP_M23.flatMap((p) => opcoesDasPermissoes(p.codigo)))].sort(
  (a, b) => a - b,
);

/** M25: as opções do legado do enfermeiro e do técnico de enfermagem (permissões da beira do leito). */
const opcoesDe = (...codigos: readonly string[]) => [
  ...new Set(
    PERMISSOES_ENFERMAGEM_M25.filter((p) => codigos.includes(p.codigo)).flatMap((p) =>
      opcoesDasPermissoes(p.codigo),
    ),
  ),
];
const OPCOES_ENFERMEIRO_M25 = opcoesDe(
  ...Object.values(PERMISSOES_ENFERMAGEM).filter((c) => !c.startsWith('enfermagem.dispositivo')),
);
const OPCOES_TECNICO_M25 = opcoesDe(
  PERMISSOES_ENFERMAGEM.horarioLer,
  PERMISSOES_ENFERMAGEM.administracaoLer,
  PERMISSOES_ENFERMAGEM.administracaoChecar,
  PERMISSOES_ENFERMAGEM.sinalLer,
  PERMISSOES_ENFERMAGEM.sinalCriar,
  PERMISSOES_ENFERMAGEM.plantaoLer,
);

/** M45 (etapa 3): o balanço hídrico (o enfermeiro lança e fecha; o técnico lança). */
const opcoesBalanco = (...codigos: readonly string[]) => [
  ...new Set(
    PERMISSOES_BALANCO_M45.filter((p) => codigos.includes(p.codigo)).flatMap((p) =>
      opcoesDasPermissoes(p.codigo),
    ),
  ),
];
const OPCOES_BALANCO_ENFERMEIRO = opcoesBalanco(
  PERMISSOES_BALANCO.ler,
  PERMISSOES_BALANCO.lancar,
  PERMISSOES_BALANCO.fechar,
);
const OPCOES_BALANCO_TECNICO = opcoesBalanco(PERMISSOES_BALANCO.ler, PERMISSOES_BALANCO.lancar);

/** M50 (etapa 5): as opções do controle de acesso do porteiro, do supervisor e do integrador da catraca. */
const opcoesPortaria = (...codigos: readonly string[]) => [
  ...new Set(
    PERMISSOES_PORTARIA_M50.filter((p) => codigos.includes(p.codigo)).flatMap((p) =>
      opcoesDasPermissoes(p.codigo),
    ),
  ),
];
const OPCOES_PORTEIRO_M50 = opcoesPortaria(
  PERMISSOES_PORTARIA.ler,
  PERMISSOES_PORTARIA.registrar,
  PERMISSOES_PORTARIA.acompanhante,
);
const OPCOES_SUPERVISOR_PORTARIA_M50 = opcoesPortaria(
  PERMISSOES_PORTARIA.ler,
  PERMISSOES_PORTARIA.registrar,
  PERMISSOES_PORTARIA.regrar,
  PERMISSOES_PORTARIA.contatos,
  PERMISSOES_PORTARIA.acompanhante,
  PERMISSOES_PORTARIA.terminalLer,
  PERMISSOES_PORTARIA.terminalEditar,
);
const OPCOES_CATRACA_M50 = opcoesPortaria(PERMISSOES_PORTARIA.catraca);

/** M28: as opções do legado das permissões do estoque e das compras dadas (pelo código da permissão). */
/** M29: as opções do legado das permissões da farmácia pedidas (prefixo com `*`). */
function opcoesFarmacia(...codigos: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const p of [...PERMISSOES_FARMACIA_M29, ...PERMISSOES_SUPRIMENTOS_M28])
    if (codigos.some((c) => p.codigo === c || (c.endsWith('*') && p.codigo.startsWith(c.slice(0, -1)))))
      for (const i of opcoesDasPermissoes(p.codigo)) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

/**
 * As marcas do usuário na origem que o mapa do conector (conector/mapa/permissoes.tsv) liga às permissões dadas: a
 * conta sintética guarda a marca como a origem a guardaria, sem o nome dela no código.
 */
function marcasDasPermissoes(...codigos: readonly string[]): string[] {
  const alvo = new Set(codigos);
  const r = new Set<string>();
  for (const c of mapaDeOrigem()) if (c.tipo !== 'opcao_menu' && alvo.has(c.permissao)) r.add(c.chave);
  return [...r].sort();
}

function opcoesSuprimentos(...codigos: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const p of PERMISSOES_SUPRIMENTOS_M28)
    if (codigos.some((c) => p.codigo === c || (c.endsWith('*') && p.codigo.startsWith(c.slice(0, -1)))))
      for (const i of opcoesDasPermissoes(p.codigo)) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

/** M32: as opções do legado das permissões do financeiro dadas (pelo código da permissão; `*` no fim é prefixo). */
function opcoesFinanceiro(...codigos: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const p of PERMISSOES_FINANCEIRO_M32)
    if (codigos.some((c) => p.codigo === c || (c.endsWith('*') && p.codigo.startsWith(c.slice(0, -1)))))
      for (const i of opcoesDasPermissoes(p.codigo)) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

/** M33: as opções do legado das permissões do repasse dadas (pelo código da permissão). */
function opcoesRepasse(...codigos: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const p of PERMISSOES_REPASSE_M33)
    if (codigos.some((c) => p.codigo === c || (c.endsWith('*') && p.codigo.startsWith(c.slice(0, -1)))))
      for (const i of opcoesDasPermissoes(p.codigo)) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

/** M31: as opções do legado das permissões do pós-fechamento dadas (pelo código da permissão). */
function opcoesTiss(...codigos: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const p of PERMISSOES_FATURAMENTO_M31)
    if (codigos.some((c) => p.codigo === c || (c.endsWith('*') && p.codigo.startsWith(c.slice(0, -1)))))
      for (const i of opcoesDasPermissoes(p.codigo)) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

/** M51: as opções do legado das permissões do faturamento SUS dadas (pelo código da permissão). */
/** M51 (etapa 2): as opções do CRUD dos médicos solicitantes SUS (cadastro e importação da tabela de médicos solicitantes). */
const OPCOES_SOLICITANTE_SUS = [920, 1100] as const;

function opcoesSus(...codigos: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const p of PERMISSOES_FATURAMENTO_M51)
    if (codigos.some((c) => p.codigo === c || (c.endsWith('*') && p.codigo.startsWith(c.slice(0, -1)))))
      for (const i of opcoesDasPermissoes(p.codigo)) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

/** M30: as opções do legado das permissões da conta do paciente dadas (pelo código da permissão). */
function opcoesFaturamento(...codigos: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const p of PERMISSOES_FATURAMENTO_M30)
    if (codigos.some((c) => p.codigo === c || (c.endsWith('*') && p.codigo.startsWith(c.slice(0, -1)))))
      for (const i of opcoesDasPermissoes(p.codigo)) ids.add(i);
  return [...ids].sort((a, b) => a - b);
}

/** Usuários sintéticos (nomes claramente fictícios; nenhuma senha real). */
export const CONTAS_SINTETICAS: Readonly<Record<string, ContaSintetica>> = {
  'SINT.USUARIO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
  },
  /** Sem senha guardada: nunca entra pelo novo (primeiro acesso no sistema atual). */
  'SINT.SEMCIFRA': {
    senha: null,
    criptografada: false,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: null,
  },
  /** Senha em texto puro (sem cifra): entra conferindo a senha e é levado à troca obrigatória. */
  'SINT.TEXTOPURO': {
    senha: 'Textopuro#2026',
    criptografada: false,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: null,
  },
  'SINT.BLOQUEADO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: true,
    senhaAlteradaEm: new Date(),
  },
  /** Acesso a duas unidades: depois do login, o segundo seletor (unidade). */
  'SINT.MULTIUNIDADE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    unidades: [
      { codigo: 1, nome: 'Unidade sintética 1' },
      { codigo: 2, nome: 'Unidade sintética 2' },
    ],
  },
  // M06: perfis para o menu filtrado e a quebra de vidro (opções reais do menu do legado, sem pessoa).
  /** Grupo MEDICOS, com conselho: PEP (localizar e selecionar paciente, consultar evolução) e quebra de vidro. */
  'SINT.MEDICO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    // M22: Evolução › Confirmar (5182: registrar) e Suspender (3918). M24: Prescrição geral (2601), Prescrever
    // (5223), Assinar (5676), Suspender prescrição confirmada (5219), Manutenção (5658) e Avaliar (5677: coassinar).
    concessoes: {
      grupo: 'MEDICOS',
      opcoesGrupo: [
        ...new Set([
          2582,
          3900,
          5146,
          5181,
          5182,
          3918,
          ...OPCOES_PEP_M23,
          2601,
          5223,
          5676,
          5219,
          5658,
          5677,
          // M49, etapa 2: Pendências de assinatura digital (5298) e Receita/Atestado Digital (6463, Nova 6468).
          5298,
          6463,
          6468,
        ]),
      ],
      conselho: true,
    },
  },
  /**
   * Grupo ATENDIMENTO (recepção): cadastro de pacientes nas duas recepções (incluir; M11: também consultar,
   * alterar e o termo de consentimento); sem dado clínico nem dado sensível (raça/cor, religião).
   */
  'SINT.RECEPCAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ATENDIMENTO', opcoesGrupo: [2349, 3255, 3254, 2348, 6027, 6534, 6535] },
  },
  /**
   * M11: supervisor de recepção e SAME: unificação de cadastros do legado (3272, 4005) — fila de duplicidades,
   * comparação lado a lado, dado sensível e linha do tempo; cadastro de pacientes. Grupo próprio (SAME): desde o
   * ADR 0022 as opções são do grupo (estado sintético), e no ATENDIMENTO elas iriam também para SINT.RECEPCAO.
   */
  'SINT.SAME': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'SAME', opcoesGrupo: [3272, 4005, 6027, 3254] },
  },
  /**
   * M17: call center e recepção ambulatorial: todas as opções de Recepção externa › Agenda (3310 a 3406 e
   * Liberar horários bloqueados 3270), a busca do cadastro de pacientes (3254, 6027) e o cadastro de pacientes da
   * recepção externa (3255: cadastro.paciente.criar, para converter o pré-cadastro da marcação sem prontuário no painel
   * do dia, 02-AGE 42). Grupo próprio (AGENDA).
   */
  'SINT.AGENDA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'AGENDA',
      opcoesGrupo: [
        3254, 6027, 3255, 3310, 3311, 3312, 3313, 3314, 3315, 3316, 3317, 3325, 3328, 3329, 3397, 3405, 3406,
        3270,
      ],
    },
  },
  /** M17: as mesmas opções da agenda, com o escopo restrito à unidade 2 (unidades do usuário). */
  'SINT.AGENDA.U2': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'AGENDA',
      opcoesGrupo: [
        3254, 6027, 3255, 3310, 3311, 3312, 3313, 3314, 3315, 3316, 3317, 3325, 3328, 3329, 3397, 3405, 3406,
        3270,
      ],
    },
    escopos: { unidades: ['2'] },
  },
  /** M17: as mesmas opções da agenda, com o escopo restrito ao tipo de agenda 5 (tipos de agenda do usuário). */
  'SINT.AGENDA.T5': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'AGENDA',
      opcoesGrupo: [
        3254, 6027, 3255, 3310, 3311, 3312, 3313, 3314, 3315, 3316, 3317, 3325, 3328, 3329, 3397, 3405, 3406,
        3270,
      ],
    },
    escopos: { tiposAgenda: ['5'] },
  },
  /**
   * M19: recepção ambulatorial: o gerador de senhas (3308), os atendimentos (5739, 5745, 6026), o encaminhamento e a
   * localização (6034 a 6038), o localizar paciente do prontuário (3900, 5149, 5147, 3907, 5148), a liberação de
   * guichê bloqueado (5572), as estatísticas (3293), os cadastros do painel eletrônico (3724 a 3727) e os painéis
   * (3970 a 3973). Na chegada, a consulta da agenda (3310: agenda.marcacao.ler) e o cadastro de pacientes da recepção
   * externa (3255: cadastro.paciente.criar), para listar os marcados de hoje sem prontuário e converter o pré-cadastro
   * ali mesmo (02-AGE 42). Grupo próprio (SENHAS).
   */
  'SINT.SENHAS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'SENHAS',
      opcoesGrupo: [
        3254, 6027, 3308, 5739, 5745, 6026, 6034, 6035, 6036, 6038, 3900, 5149, 5147, 3907, 5148, 5572, 3293,
        3724, 3725, 3726, 3727, 3970, 3971, 3972, 3973, 3255, 3310,
      ],
    },
  },
  /** M19: outra pessoa no guichê (só emitir e chamar; sem liberar guichê, sem supervisor nem dispositivos). */
  'SINT.GUICHE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'GUICHE', opcoesGrupo: [3254, 6027, 3308, 5739, 5745, 6026] },
  },
  /**
   * M18: central de exames (SADT › Agenda: agendas, manutenção, agendamento, consultas, listagens, controle de
   * criação, horários cancelados e reagendamento) e a busca do cadastro de pacientes (3254, 6027). Grupo próprio.
   */
  'SINT.EXAME': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'EXAMES',
      opcoesGrupo: [3254, 6027, 2759, 2760, 2761, 2770, 2771, 2772, 2774, 2775, 2778, 2779, 2786],
    },
  },
  /**
   * M18: secretaria e coordenação do bloco (Bloco Cirúrgico: módulo, parâmetros, salas e salas por usuário,
   * agendamento, manutenção, reagendamento, cirurgias realizadas e mapa) e a busca do cadastro. Grupo próprio; é
   * usuário permitido das salas 1 e 2 da porta em memória (a 3 fica fora).
   */
  'SINT.BLOCO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'BLOCO',
      opcoesGrupo: [
        3254, 6027, 2227, 2229, 2230, 2233, 4506, 2236, 2237, 2238, 2263, 2264, 2265, 2266, 2283, 2285, 2293,
      ],
    },
  },
  /**
   * M46 (etapa 1): o anestesista do agendamento sintético (registro 5002 da porta em memória): a ficha anestésica do
   * registro cirúrgico (APA, ficha e assinatura), o módulo e o mapa do bloco. Com o conselho ativo.
   */
  'SINT.ANESTESISTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ANESTESIA', opcoesGrupo: [6813, 6814, 6829, 2227, 2293], conselho: true },
  },
  /** M46 (etapa 1): o segundo anestesista (registro 5006), que recebe a responsabilidade na passagem. */
  'SINT.ANESTESISTA2': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ANESTESIA', opcoesGrupo: [6813, 6814, 6829, 2227, 2293], conselho: true },
  },
  /**
   * Revisão do M46.1 (regra 3): o instrumentador (registro 5004, não médico) com a opção de assinar a ficha anestésica e
   * conselho ativo (de enfermagem): mesmo na linha de responsabilidade, não assina (só o médico anestesista).
   */
  'SINT.INSTRUMENTADOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ANESTESIA', opcoesGrupo: [6813, 6814, 6829, 2227, 2293], conselho: true },
  },
  /**
   * M46 (etapa 1): o cirurgião (registro 5001) com a opção da ficha anestésica no perfil: lê e lança, mas não é o
   * anestesista da cirurgia (a assinatura é recusada com 403 e a negação vai à trilha; regra 3).
   */
  'SINT.CIRURGIAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CIRURGIA', opcoesGrupo: [6813, 6814, 6829, 2227, 2293], conselho: true },
  },
  /**
   * M46 (etapa 3): suprimentos do OPME: as solicitações e as etapas (cotação, pedido, consignação, CME, NF) e a
   * autorização da operadora (Autorização dos pedidos 4491, o supervisor do consumo sem autorização), o cadastro de
   * itens e o rastreio de lote.
   */
  'SINT.OPME': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'OPME',
      opcoesGrupo: [
        1840,
        1845,
        2123,
        2124,
        2227,
        2293,
        4491,
        5722,
        // A saída a internado (o supervisor registra o consumo sem a autorização da operadora).
        5733,
        ...opcoesSuprimentos(
          'suprimentos.item.ler',
          'suprimentos.fornecedor.ler',
          'suprimentos.lote.rastrear',
        ),
      ],
    },
  },
  /** M46 (etapa 3): a circulante do bloco que registra o consumo de OPME em sala (saída e lançamento a internado). */
  'SINT.CIRCULANTE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CIRCULANTE', opcoesGrupo: [2227, 2293, 5733, 5736], conselho: true },
  },
  /** M46 (etapa 3): o faturista da conta cirúrgica (lançamentos e contas internas): a conciliação do OPME. */
  'SINT.FATURISTA.OPME': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'FATURISTA_OPME', opcoesGrupo: [1121, 1123, 1845] },
  },
  /** M46 (etapa 1): a enfermagem da recuperação (admissão, avaliações e alta da SRPA; sem a ficha anestésica). */
  'SINT.ENF.BLOCO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ENFERMAGEM_BLOCO',
      opcoesGrupo: [6813, 6814, 6820, 6821, 6823, 2227, 2293],
      conselho: true,
    },
  },
  /** Papel SBIS Gestor de acessos (0): grupos e mapa de permissões. */
  'SINT.GESTOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [0, 4], opcoesPapel: [5429, 5433, 5437] },
  },
  /** Papel SBIS Auditor (2): revisão das quebras de vidro e leitura das trilhas. */
  'SINT.AUDITOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [2, 4] },
  },
  /** Sem aceite do termo vigente: a sessão sai com termoPendente. */
  'SINT.TERMO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    termoAceito: false,
  },
  /**
   * M08: Administrador do sistema (papel SBIS 1) com as opções do legado que dão os cadastros de domínio
   * (Tabelas › Geral A–L e M–Z, Religiões, Motivo de exclusão, Tipos de alergia, Higienização, Tipo de
   * anestesia): CRUD genérico, parâmetros e funcionalidades por estabelecimento.
   */
  'SINT.ADMIN': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      papeis: [1, 4],
      opcoesPapel: [
        3648,
        3698,
        3739,
        3590,
        5618,
        5441,
        6331,
        6332,
        6333,
        6334,
        6335,
        6337,
        6338,
        5003,
        5004,
        5005,
        5006,
        // M11: conselhos, especialidades, prestadores e profissionais (Tabelas › Geral A–L e M–Z).
        4886,
        3683,
        3684,
        3730,
        6376,
        3731,
        3733,
        6377,
        3984,
        6390,
        // Revisão do M39: Profissionais › Gerenciamento › Incluir (a inclusão do solicitante externo).
        // D-PROF-39: › Alterar (a edição do profissional do corpo clínico).
        6391,
        6392,
        // D-PROF-39 (requisitos do dono): › Excluir (inativar, reativar e excluir o cadastrado por engano).
        6393,
        6394,
        // M10: leitos (Recepção interna › Leitos › Manutenção, Listagens, Visualização e Inatividade).
        2323,
        2325,
        2341,
        2340,
        // M10 (D-PERM-4): centros de custo, locais de atendimento e locais de conta (consulta, opções do domínio).
        3663,
        3727,
        3697,
        // M22: administração do PEP (Configurações › Parâmetros: consultar e confirmar).
        2643,
        2644,
        5921,
        5355,
        // M49 (etapa 3): Tabelas › Geral A–L › Assinatura avançada e Gerenciamento (cadastros da assinatura digital).
        6922,
        6923,
        // W0-02 (pilotos do motor do CRUD genérico): os cadastros da nutrição clínica (consultar 2675; incluir, alterar e
        // excluir 4656), para o e2e da exclusão física e do texto longo nas características de dieta.
        2675,
        4656,
        // M14: os domínios do lote e a consulta das áreas de cadastro, recepção, agenda e faturamento.
        ...opcoesDaArea(
          'cadastro',
          'recepcao',
          'agenda',
          'internacao',
          'cirurgia',
          'pep',
          'faturamento',
          'financeiro',
          'suprimentos',
          'sadt',
        ),
        // F3.6 (05-SUP linhas 1, 3 e 13): o administrador mantém o cadastro do estoque: o item e o medicamento, o local e
        // o escopo dos usuários do estoque, o kit padrão da cirurgia e a requisição que o usa.
        ...opcoesSuprimentos(
          'suprimentos.item.*',
          'suprimentos.local.*',
          'suprimentos.kit.ler',
          'suprimentos.kit.editar',
          'acesso.escopo.*',
          'suprimentos.requisicao.ler',
          'suprimentos.requisicao.criar',
        ),
        ...opcoesDasPermissoes('acesso.escopo.editar'),
        // C1-090 (06-FAT linha 16): o administrador consulta o lançamento automático e mantém as regras e as exceções
        // (o recorte global, faturamento.regra.editarGlobal, ele já tinha; sem a consulta, nem chegava à tela).
        ...opcoesFaturamento(
          'faturamento.lancamento.ler',
          'faturamento.regra.ler',
          'faturamento.regra.editar',
        ),
        // C2-097: os padrões da prescrição (kits de medicamentos e de soluções, protocolos e receitas padrão).
        ...opcoesDasPermissoes(
          'pep.kitPrescricao.ler',
          'pep.kitMedicamento.ler',
          'pep.kitMedicamento.criar',
          'pep.kitMedicamento.editar',
          'pep.kitSolucao.ler',
          'pep.kitSolucao.criar',
          'pep.kitSolucao.editar',
          'pep.protocoloPrescricao.ler',
          'pep.protocoloPrescricao.criar',
          'pep.protocoloPrescricao.editar',
          'pep.receitaPadrao.ler',
        ),
        // C1-115 (03-PEP L106): o catálogo editável da prescrição: inclui e inativa o item não padronizado e mantém
        // os complementos do item (sem as opções, a tela escondia os formulários de gravação).
        ...opcoesDasPermissoes(
          'pep.itemNaoPadronizado.ler',
          'pep.itemNaoPadronizado.criar',
          'pep.itemNaoPadronizado.inativar',
          'pep.parametroClinicoItem.ler',
          'pep.parametroClinicoItem.editar',
        ),
      ],
    },
  },
  /** M14: laboratório (SADT): exames, kits, materiais, setores e resultados (Tabelas do S.A.D.T.). */
  'SINT.LABORATORIO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'LABORATORIO',
      opcoesGrupo: [
        ...new Set([
          ...opcoesDaArea('sadt'),
          // C1-097: o laboratório lança e baixa o consumo dos exames do setor executante (sadt.lancamento.*).
          ...opcoesDasPermissoes('sadt.lancamento.ler', 'sadt.lancamento.lancar'),
        ]),
      ],
    },
  },
  /**
   * M14: departamento pessoal (RH): domínios de RH e a consulta provisória das telas da Fase 6. M52.1: Funcionário
   * (358, 4224), Rescisão (388) e Afastamento (389) da folha: admite, desliga e consulta os colaboradores.
   */
  'SINT.RH': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'RH',
      // M52.2: e o quadro de escalas do ponto (5073): lê e monta a escala, sem publicar (a publicação é do perfil).
      // M52.4: e, do ponto, a importação do arquivo do relógio (5067, 5068), as solicitações (5069), o painel de
      // processamentos (5075), a manutenção individual (5076), o banco de horas (5077) e o espelho (5082): importa,
      // lança ajustes e consulta, sem aprovar nem fechar (a aprovação é do SINT.PONTO).
      opcoesGrupo: [
        ...new Set([
          ...opcoesDaArea('pessoas'),
          358,
          // W0-06, parte 4: Cargos (362) da folha: cargos, tabela salarial e quadro de vagas (pessoas.cargos.*).
          362,
          388,
          389,
          4224,
          5073,
          5067,
          5068,
          5069,
          5075,
          5076,
          5077,
          5082,
        ]),
      ].sort((a, b) => a - b),
    },
  },
  /**
   * M12: supervisor do faturamento (grupo sintético) com as opções do legado de Tabelas › Convênios
   * (consultar, alterar, incluir, honorários, diárias, índices, portes, importações, integração, prestadores):
   * convênios, contratos, reajuste e importação de tabela de preço.
   */
  'SINT.FATURAMENTO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FATURAMENTO',
      opcoesGrupo: [
        3561, 3566, 3567, 3568, 3574, 3580, 3584, 3588, 3591, 3592, 3709, 3710, 3712, 3768, 3974, 1514, 4883,
        6307, 6309, 6311, 6313, 6315,
        // M13: Tabelas › SUS › Tabela unificada (aprovação das cargas da área de faturamento: SIGTAP e TUSS).
        6921,
      ],
    },
    // C1-040: o supervisor do faturamento também mantém o de-para da fonte pagadora (perfil próprio).
    perfisConcedidos: ['faturamento-de-para'],
  },
  /** M12: faturista só de consulta (sem códigos de prestador, sem dados bancários, sem alterar nada). */
  'SINT.FATURISTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'FATURISTA', opcoesGrupo: [3561, 3566, 6307, 6309, 6311, 6313, 6315, 3591, 3592] },
  },
  /**
   * M16: coordenação de leitos e NIR (grupo LEITOS): Painel de leitos 3990 e Leitos 2322, Censo 2378 e Censo
   * hospitalar completo 2549 (exportar) e a consulta do cadastro do paciente da recepção interna (6061, o nome ao
   * abrir o cartão do leito).
   */
  'SINT.LEITOS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'LEITOS', opcoesGrupo: [3990, 2322, 2378, 2549, 6061] },
  },
  /**
   * M38: usuário técnico das sondas da implantação azul/verde (cap-14 §14.10.1): entra e sai; nenhuma opção do
   * legado (só os recursos de toda pessoa), portanto sem acesso a paciente.
   */
  'SINT.SONDA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'SONDA', opcoesGrupo: [] },
  },
  /**
   * M38 (regra 3): diretoria no grupo MASTER, o público da onda 0: painel de leitos, censo e painéis gerenciais
   * (as opções da diretoria e da coordenação de leitos do M16).
   */
  'SINT.MASTER': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'MASTER', opcoesGrupo: [6785, 6789, 6790, 2517, 2324, 1169, 3990, 2322, 2378] },
  },
  /**
   * M16: diretoria (grupo DIRETORIA): Dashboard 6785 (Consultar 6789, Imprimir 6790), Censo/estatísticas
   * hospitalar mensal 2517, Estatística 2324 e Estatísticas de contas 1169 (painel financeiro); sem o cadastro
   * do paciente (o cartão do leito não abre o nome).
   */
  'SINT.DIRETORIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'DIRETORIA', opcoesGrupo: [6785, 6789, 6790, 2517, 2324, 1169, 3990, 2378] },
  },
  // M23: a equipe multiprofissional (a matriz ação × categoria vem da ocupação; o prontuário de uso diário).
  /** Enfermagem com conselho: registra, pede parecer, alergia, anexo; sem atestado médico nem receita. */
  'SINT.ENFERMEIRO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ENFERMAGEM',
      opcoesGrupo: [...new Set([2582, 3900, 5146, 5181, 5182, ...OPCOES_PEP_M23])],
      conselho: true,
    },
  },
  /** Psicologia com conselho: o conteúdo do registro dela fica restrito à categoria (sigilo). */
  'SINT.PSICOLOGO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'PSICOLOGIA',
      opcoesGrupo: [...new Set([2582, 3900, 5146, 5181, 5182, ...OPCOES_PEP_M23])],
      conselho: true,
    },
  },
  /**
   * M23 (regra 3): médico residente; registra indicando o preceptor (SINT.MEDICO), que coassina. M24: prescreve
   * (CBO 2231); a prescrição espera a coassinatura do preceptor.
   */
  'SINT.RESIDENTE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'RESIDENCIA',
      opcoesGrupo: [
        ...new Set([2582, 3900, 5146, 5181, 5182, ...OPCOES_PEP_M23, 2601, 5223, 5676, 5219, 5658]),
      ],
      conselho: true,
    },
  },
  /** Fisioterapia com conselho, sem as opções do parecer (pedir e responder): o parecer pelo registro é recusado. */
  'SINT.FISIOTERAPEUTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FISIOTERAPIA',
      opcoesGrupo: [...new Set([2582, 3900, 5146, 5181, 5182, ...OPCOES_PEP_M23.filter((o) => o !== 5519)])],
      conselho: true,
    },
  },
  // M24: quem prescreve além do médico (a categoria vem do CBO sintético do login, como no cadastro de profissionais).
  /** Nutricionista (CBO 2237): só dietas (oral e enteral) e jejum. */
  'SINT.NUTRI': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'NUTRICAO', opcoesGrupo: [2582, 3900, 2601, 5223, 5676, 5219], conselho: true },
  },
  /**
   * Farmácia clínica: regras de alerta (Interação entre medicamentos) e fichas de antimicrobiano. M24 (P-CAD-1): e os
   * cadastros de prescrição da Farmácia e Terapêutica — kits de medicamentos (4671, 5947, 5366, 5367, 4674) e de
   * soluções (4667, 5946, 4670, 4669), itens não padronizados (3347, 5948, 3349, 4675, 3350), protocolos (3368, 5369,
   * 3371), fórmulas (2646, 5954, 5373, 2649), receitas padrão (2732, 5924), interações (6373, 4891, 4890) e o
   * cadastro do item (1643). Sem a "Prescrição geral" 2601 (correção do M24): os cadastros abrem pelas opções deles,
   * não pela da prescrição (quem tem a opção do cadastro tem a consulta, e o E2E prova isso).
   */
  'SINT.FARMACIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FARMACIA',
      opcoesGrupo: [
        2582, 3900, 2662, 6295, 3925, 4594, 4671, 5947, 5366, 5367, 4674, 4667, 5946, 4670, 4669, 3347, 5948,
        3349, 4675, 3350, 3368, 5369, 3371, 2646, 5954, 5373, 2649, 2732, 5924, 6373, 4891, 4890, 1643,
      ],
    },
  },
  /**
   * Posto de enfermagem: consulta a prescrição e cuida do esquema de horários de prescrição da unidade (grupo
   * próprio, para não mudar as opções do grupo ENFERMAGEM do SINT.ENFERMEIRO do M23).
   */
  'SINT.ENFERMAGEM': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'POSTO_ENFERMAGEM', opcoesGrupo: [2582, 3900, 2601, 6361, 6362] },
  },
  /**
   * M20: recepção ambulatorial e do pronto atendimento: Recepção externa › Atendimentos (5739: incluir 5745, alterar
   * 5746, consultar 6026), lista e atendimentos anteriores (6543, 3299), alteração de convênio (3291), lançamento rápido
   * (3294), emissão de fichas e etiquetas (3257, 3292, 3230, 3239), estatísticas (3293), Tabelas › Parâmetros (3221,
   * 6001), o laboratório e o externo do SADT (6116, 6104, 6106), o localizar e liberar paciente (3900, 5149, 5147) e a
   * busca do cadastro (3254, 6027). Sem conselho: registra a evasão e o encerramento administrativo, nunca o ato médico.
   */
  'SINT.ATENDIMENTO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'RECEPCAO_EXTERNA',
      opcoesGrupo: [
        3254, 6027, 5739, 5745, 5746, 6026, 6543, 3299, 3291, 3294, 3257, 3292, 3230, 3239, 3293, 3221, 6001,
        6116, 6104, 6106, 3900, 5149, 5147, 4552, 4555, 6014,
      ],
    },
  },
  /**
   * M20: médico do pronto atendimento (grupo próprio, com conselho: no estado sintético as opções são do grupo, e no
   * MEDICOS iriam também para SINT.MEDICO): o localizar, chamar e liberar paciente (3900, 5149,
   * 5147, 4645), os atendimentos (5739, 6026) e os leitos de observação (4552, 4555, 6010 a 6020): o desfecho clínico
   * (alta, internação, transferência, óbito) é dele. O vínculo da sessão é o da médica sintética da porta em memória.
   */
  'SINT.MEDICO.PA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MEDICOS_PA',
      opcoesGrupo: [6027, 3900, 5149, 5147, 4645, 5739, 6026, 4552, 4555, 6010, 6011, 6012, 6014, 6015, 6020],
      conselho: true,
    },
  },
  /**
   * M44: enfermeira do PA (grupo de enfermeiros, com conselho: perfil assistencial com conselho): a fila e a tela de
   * classificação (evolução do PEP 5181/5182 e localizar paciente 3900), o quadro do PA (3900) e o protocolo (publica
   * com reautenticação; o autor da versão é outra pessoa). O vínculo da porta em memória é de enfermeiro (CBO 223505).
   */
  'SINT.ENFERMEIRO.PA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ENFERMAGEM_ENFERMEIRO', opcoesGrupo: [3900, 5181, 5182], conselho: true },
  },
  /** M44: técnico de enfermagem do PA: registra os sinais vitais na tela de classificação, não conclui (regra 1). */
  'SINT.TECNICO.PA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ENFERMAGEM_TECNICO', opcoesGrupo: [3900, 5181, 5182] },
  },
  /** M20: supervisor da recepção: a exclusão do atendimento aberto por engano (5747, 6028) e a consulta (5739, 6026). */
  'SINT.SUPERVISOR.ATD': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'SUPERVISAO_ATD', opcoesGrupo: [3254, 6027, 5739, 6026, 5747, 6028, 3293] },
  },
  /**
   * M26: biomédica do laboratório (com conselho; o vínculo da porta em memória é de biomédico, responsável técnico):
   * Solicitações do PEP (2758, 6230, 6231, 6233), lançamento do laboratório (6116, 6118, 6161, 6163, 6106), o
   * rastreio e a coleta (6985, 6810, 6811, 6812, 6809, 6805, 2731, 4754), os resultados (2738, 6206, 6207, 6209, 6210,
   * 6211, 6213), a liberação para a web (2972), os parâmetros (2678), a entrega de laudos (4756, 4760, 6255, 6256, 6258,
   * 2845) e os relatórios (2804, 2849); o localizar paciente (3900).
   */
  'SINT.BIOMEDICO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'LABORATORIO_TECNICO',
      opcoesGrupo: [
        2758, 6230, 6231, 6233, 6116, 6118, 6161, 6163, 6106, 6985, 6810, 6811, 6812, 6809, 6805, 2731, 4754,
        2738, 6206, 6207, 6209, 6210, 6211, 6213, 2972, 2678, 4756, 4760, 6255, 6256, 6258, 2845, 2804, 2849,
        3900,
        // M34: S.A.D.T. › Interfaceamento (o laboratório de apoio: de-para e a fila de retorno a conferir).
        2964,
      ],
      conselho: true,
    },
  },
  /**
   * M26: médica radiologista (com conselho): as solicitações (2758, 6233), os resultados e laudos de imagem,
   * endoscopia e outros (2738, 6214, 6215, 6217, 6218, 6219, 6221, 6222, 6223, 6225, 6198, 6199, 6201, 6226, 6227,
   * 6229), o lançamento de imagem (6131, 6176, 6141, 6186) e a entrega dos laudos (4756, 4761, 4763, 2845).
   */
  'SINT.LAUDADOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MEDICOS_IMAGEM',
      opcoesGrupo: [
        2758, 6233, 6118, 6106, 2738, 6214, 6215, 6217, 6218, 6219, 6221, 6222, 6223, 6225, 6198, 6199, 6201,
        6226, 6227, 6229, 6131, 6176, 6141, 6186, 4756, 4761, 4763, 2845,
      ],
      conselho: true,
    },
  },
  /**
   * M26: recepção do diagnóstico (sem conselho): atendimentos do SADT (2728, 2729, 6104, 6106, 2730, 6150, 6152), o
   * lançamento externo do laboratório (6116, 6118), o orçamento (2803), as solicitações (2758, 6233) e o portal
   * (4743, 4744, 4745, 4747, 4748).
   */
  'SINT.RECEPCAO.SADT': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'RECEPCAO_SADT',
      opcoesGrupo: [
        2728, 2729, 6104, 6106, 2730, 6150, 6152, 6116, 6118, 2803, 2758, 6233, 4743, 4744, 4745, 4747, 4748,
      ],
    },
  },
  /**
   * M21: recepção de internação e coordenação de leitos (grupo RECEPCAO_INTERNA): a busca do cadastro (3254, 6027), a
   * manutenção da internação (2342, 5740, 6056, 6057, 6059), a pré-internação (5741, 6062 a 6065), a transferência
   * (5742, 6066, 6067, 6069), a alta (5743, 6070, 6071, 6073), as alterações (5744, 6075, 6076, 6078), as guias (2360),
   * os impressos (2372, 2373, 2315), os leitos (2322, 2323, 3990, 2483) e a solicitação de limpeza (5013). Sem
   * conselho: dá a saída, nunca a alta médica.
   */
  'SINT.INTERNACAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'RECEPCAO_INTERNA',
      opcoesGrupo: [
        3254, 6027, 2342, 5740, 6056, 6057, 6059, 5741, 6062, 6063, 6064, 6065, 5742, 6066, 6067, 6069, 5743,
        6070, 6071, 6073, 5744, 6075, 6076, 6078, 2360, 2372, 2373, 2315, 2322, 2323, 3990, 2483, 5013,
      ],
    },
  },
  /** M21: médico da internação (com conselho): a alta médica (5743, 6070, 6071, 6073) e a consulta (2342, 6059, 3990). */
  'SINT.MEDICO.INT': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MEDICOS_INTERNACAO',
      opcoesGrupo: [2342, 6059, 3990, 2322, 5743, 6070, 6071, 6073],
      conselho: true,
    },
  },
  /** M21: profissional da higienização: o painel (5012), solicitar (5013), gerenciar (5014) e executar (5015). */
  'SINT.HIGIENIZACAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'HIGIENIZACAO', opcoesGrupo: [5012, 5013, 5015] },
  },
  /** M21: supervisão da higienização: a inspeção e a liberação (5016) e os cadastros (5003 a 5010). */
  'SINT.SUPERVISOR.HIG': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'SUPERVISAO_HIG',
      opcoesGrupo: [5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010, 5012, 5013, 5014, 5015, 5016],
    },
  },
  /** M21: arquivo do SAME: o controle de prontuários (2361 a 2368, 4569) e os relatórios (2468, 2488). */
  'SINT.ARQUIVO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ARQUIVO_SAME',
      opcoesGrupo: [2361, 2362, 2363, 2364, 4569, 2365, 2366, 2367, 2368, 2468, 2488],
    },
  },
  // M25: enfermagem beira-leito (o vínculo de enfermagem de cada login vem da porta em memória: 2235 enfermeiro, 3222
  // técnico). As opções da checagem, do aprazamento, da monitorização e dos aparelhos (permissoes/enfermagem.ts).
  /** Enfermeira do plantão: apraza, checa, confere como segundo profissional, estorna, sinais, passa o plantão. */
  'SINT.ENF.PLANTAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ENFERMAGEM_PLANTAO',
      // W0-03, M4: a foto da ferida é anexo de imagem do prontuário (inserir e ver o arquivo).
      opcoesGrupo: [
        ...new Set([
          2582,
          3900,
          ...OPCOES_ENFERMEIRO_M25,
          ...OPCOES_BALANCO_ENFERMEIRO,
          ...OPCOES_PEP_ANEXO_CRIAR,
          ...OPCOES_PEP_ANEXO_LER,
        ]),
      ],
      conselho: true,
    },
  },
  /** Enfermeiro de apoio: o segundo profissional da dupla checagem e quem recebe o plantão. */
  'SINT.ENF.APOIO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ENFERMAGEM_APOIO',
      opcoesGrupo: [...new Set([2582, 3900, ...OPCOES_ENFERMEIRO_M25, ...OPCOES_BALANCO_ENFERMEIRO])],
      conselho: true,
    },
  },
  /**
   * W0-04 (M1): enfermeira da UTI com o prontuário de uso diário (M23) e a monitorização (as opções dos sinais vitais),
   * que concedem a aba de dispositivos invasivos do prontuário (o mesmo registro da CCIH).
   */
  'SINT.ENF.UTI': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ENFERMAGEM_UTI',
      opcoesGrupo: [...new Set([2582, 3900, 5146, ...OPCOES_PEP_M23, ...OPCOES_ENFERMEIRO_M25])],
      conselho: true,
    },
  },
  /** Técnica de enfermagem: executa e checa, registra sinais; não apraza nem confere. */
  'SINT.TECNICO.ENF': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'TECNICO_ENFERMAGEM',
      opcoesGrupo: [...new Set([2582, 3900, ...OPCOES_TECNICO_M25, ...OPCOES_BALANCO_TECNICO])],
      conselho: true,
    },
  },
  /**
   * Supervisão de enfermagem: os procedimentos e kits de enfermagem, os aparelhos da beira do leito e a lista de
   * internados (internacao.internacao.ler, só a consulta; @C1-074: o atalho dos gases na lista de internados).
   */
  'SINT.SUPERVISOR.ENF': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'SUPERVISAO_ENFERMAGEM',
      opcoesGrupo: [
        ...new Set([
          2582,
          3900,
          3954,
          5535,
          3736,
          3679,
          3689,
          3738,
          3361,
          3362,
          4682,
          4683,
          4684,
          ...opcoesDasPermissoes('internacao.internacao.ler'),
        ]),
      ],
      conselho: true,
    },
  },
  /** M21: supervisor da internação: cancelar a alta (6074, 6072) e excluir a internação (6058, 6060), e a consulta. */
  'SINT.SUPERVISOR.INT': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'SUPERVISAO_INT',
      opcoesGrupo: [2342, 6059, 6073, 3990, 2322, 6074, 6072, 6058, 6060],
    },
  },
  /**
   * M27: gestor da comunicação interna: "Mensagem a usuários" do módulo de abertura (2), que no outro sistema manda
   * mensagem a vários usuários (6 de 39 grupos na cópia pc): publica comunicado com vigência e ciência obrigatória.
   * Grupo próprio (COMUNICACAO), no fim da lista (o ID sintético dos demais não muda).
   */
  'SINT.COMUNICACAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'COMUNICACAO', opcoesGrupo: [2] },
  },
  /**
   * M28: almoxarife: as consultas do estoque, a nota fiscal, a requisição (pedir e atender), a saída, a devolução, a
   * transferência, a contagem do inventário, os kits e o carrinho, o rastreio de lote; os locais de estoque do
   * escopo (locais de estoque do usuário) vêm da porta do estoque.
   */
  'SINT.ALMOXARIFE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ALMOXARIFADO',
      opcoesGrupo: opcoesSuprimentos(
        'suprimentos.item.ler',
        'suprimentos.fornecedor.ler',
        'suprimentos.local.ler',
        'suprimentos.nota.*',
        'suprimentos.requisicao.ler',
        'suprimentos.requisicao.criar',
        'suprimentos.requisicao.atender',
        'suprimentos.saida.*',
        'suprimentos.transferencia.*',
        'suprimentos.devolucao.*',
        'suprimentos.saldo.ler',
        'suprimentos.lote.rastrear',
        'suprimentos.kit.*',
        'suprimentos.inventario.ler',
        'suprimentos.inventario.contar',
        'suprimentos.consumo.*',
        'suprimentos.fechamento.ler',
        'suprimentos.recalculo.ler',
        'suprimentos.sugestao.ler',
        'suprimentos.pedido.ler',
        'suprimentos.compra.ler',
      ),
    },
  },
  /**
   * M29: farmacêutico (com conselho): a fila de dispensação e as doses, a devolução e o cancelamento, as entregas, os
   * controlados (dupla conferência, perda, livro), a avaliação farmacêutica (decidir e intervir) e a farmácia
   * ambulatorial. O segundo farmacêutico confere o controlado que o primeiro dispensou.
   */
  'SINT.FARMACEUTICO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FARMACIA_HOSPITALAR',
      opcoesGrupo: opcoesFarmacia(
        'suprimentos.dispensacao.*',
        'suprimentos.devolucao.*',
        'suprimentos.controlado.*',
        'suprimentos.livro.*',
        'suprimentos.avaliacao.*',
        'suprimentos.ambulatorial.*',
        'suprimentos.item.ler',
        'suprimentos.saldo.ler',
      ),
      conselho: true,
    },
  },
  'SINT.FARMACEUTICO2': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FARMACIA_HOSPITALAR',
      opcoesGrupo: opcoesFarmacia(
        'suprimentos.dispensacao.*',
        'suprimentos.devolucao.*',
        'suprimentos.controlado.*',
        'suprimentos.livro.*',
        'suprimentos.avaliacao.*',
        'suprimentos.ambulatorial.*',
        'suprimentos.item.ler',
        'suprimentos.saldo.ler',
      ),
      conselho: true,
    },
  },
  /** M29: enfermeiro do setor (com conselho): o aceite da entrega da dose (leitura da etiqueta ou no tablet). */
  'SINT.ENF.SETOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ENFERMAGEM_SETOR',
      opcoesGrupo: opcoesFarmacia('suprimentos.entrega.*'),
      conselho: true,
    },
  },
  /** M29: o médico prescritor das prescrições sintéticas da farmácia: responde à intervenção farmacêutica. */
  'SINT.MEDICO.FARM': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MEDICOS_FARMACIA',
      opcoesGrupo: [2582, 3900, 2601, ...opcoesFarmacia('suprimentos.intervencao.responder')],
      conselho: true,
    },
  },
  /**
   * M30: supervisor do faturamento: as contas (ler, conferir, fechar, reabrir), os lançamentos (ler, lançar, preço
   * manual), a fila tardia, as pendências, a auditoria, as regras, os pacotes e o simulador; o escopo de convênio vem
   * da fonte sintética (sem restrição).
   */
  'SINT.CONTAS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'CONTAS',
      opcoesGrupo: opcoesFaturamento(
        'faturamento.conta.*',
        'faturamento.item.*',
        'faturamento.preco.*',
        'faturamento.lancamento*',
        'faturamento.pendencia.*',
        'faturamento.auditoria.*',
        'faturamento.regra.*',
        'faturamento.pacote.*',
        'cirurgia.nota.ler',
      ).concat(
        // F3.4-5: as cirurgias realizadas (2285, só leitura), para conferir e debitar o gasto de sala do ato na conta.
        2285,
      ),
    },
    // C1-114: o faturista das contas emite e confere o protocolo de documentos entre setores (perfil próprio).
    perfisConcedidos: ['protocolo-documentos'],
  },
  /** M30: operador do caixa do particular: orçamento, caixa, recebimento (Pix e cartão simulados) e recibo. */
  'SINT.CAIXA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'CAIXA',
      opcoesGrupo: opcoesFaturamento(
        'faturamento.orcamento.*',
        'faturamento.recibo.*',
        'faturamento.pagamento.*',
      ),
    },
  },
  /** M28: comprador: necessidades e pedidos, o mapa de cotação (propostas e vencedor), o histórico e a sugestão. */
  'SINT.COMPRADOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'COMPRAS',
      opcoesGrupo: opcoesSuprimentos(
        'suprimentos.item.ler',
        'suprimentos.fornecedor.*',
        'suprimentos.pedido.ler',
        'suprimentos.pedido.criar',
        'suprimentos.cotacao.*',
        'suprimentos.compra.*',
        'suprimentos.sugestao.*',
        'suprimentos.nota.ler',
        'suprimentos.saldo.ler',
      ),
    },
  },
  /**
   * M28: supervisor do estoque e das compras: a aprovação por alçada (marca de autorizar pedido), a autorização da
   * requisição, a aprovação do inventário, o fechamento e a reabertura (marca de desbloqueio), o saneamento da
   * validade e a desconsolidação; e as consultas.
   */
  'SINT.SUPERVISOR.ESTOQUE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'SUPERVISAO_ESTOQUE',
      opcoesGrupo: opcoesSuprimentos('suprimentos.*', 'acesso.escopo.ler'),
      flags: marcasDasPermissoes(
        'suprimentos.pedido.aprovar',
        'suprimentos.requisicao.autorizar',
        'suprimentos.fechamento.reabrir',
        'suprimentos.recalculo.executar',
      ),
    },
  },
  /**
   * M30 (correção; no fim da lista para não mudar o ID sintético das outras contas): o mesmo perfil do supervisor do faturamento com o escopo restrito ao convênio 10 (particular),
   * para os testes de escopo por convênio (regra 13) e de aprovador do preço manual (outro usuário com a alçada).
   */
  'SINT.CONTAS.C10': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'CONTAS',
      opcoesGrupo: opcoesFaturamento(
        'faturamento.conta.*',
        'faturamento.item.*',
        'faturamento.preco.*',
        'faturamento.lancamento*',
        'faturamento.pendencia.*',
        'faturamento.auditoria.*',
        'faturamento.regra.*',
        'faturamento.pacote.*',
        'faturamento.orcamento.*',
        'faturamento.recibo.*',
        'faturamento.pagamento.*',
      ),
    },
    escopos: { convenios: ['10'] },
  },
  /**
   * M31 (no fim da lista para não mudar o ID sintético das outras contas): o supervisor do faturamento de convênios no
   * pós-fechamento: guias, lotes, protocolo, envio, competência, demonstrativos, glosa e recurso, o painel de glosas e os
   * webservices por operadora; o escopo de convênio vem da fonte sintética (sem restrição).
   */
  'SINT.TISS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'TISS',
      opcoesGrupo: [
        ...new Set([
          ...opcoesTiss('faturamento.*', 'relatorio.glosa.*', 'integracao.tiss.*'),
          ...opcoesFaturamento('faturamento.conta.ler', 'faturamento.item.ler'),
        ]),
      ].sort((a, b) => a - b),
    },
  },
  /** M31: o faturador do pós-fechamento restrito ao convênio 92 (o escopo por convênio, anti-IDOR). */
  'SINT.TISS.ESCOPO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'TISSE',
      opcoesGrupo: opcoesTiss('faturamento.*', 'relatorio.glosa.*'),
    },
    escopos: { convenios: ['92'] },
  },
  /** M31: quem só consulta a glosa (sem decidir): não lê a evidência do prontuário. */
  'SINT.TISS.LEITOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'TISSL',
      opcoesGrupo: opcoesTiss('faturamento.glosa.ler').filter(
        (o) => !opcoesTiss('faturamento.glosa.decidir').includes(o),
      ),
    },
  } /**
   * M32 (no fim da lista para não mudar o ID sintético das outras contas): o financeiro com a segregação de funções
   * (regra 4): quem lança (contas a pagar e a receber), quem aprova na alçada (a diretoria), quem paga (tesouraria) e
   * quem concilia; o fiscal. As opções de cada um vêm do mapa das permissões do M32.
   */,
  'SINT.FIN.LANCA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FINLANCA',
      opcoesGrupo: opcoesFinanceiro(
        'financeiro.tituloPagar.ler',
        'financeiro.tituloPagar.criar',
        'financeiro.tituloPagar.prorrogar',
        'financeiro.tituloPagar.aprovar',
        'financeiro.tituloReceber.*',
        'financeiro.creditoConvenio.ler',
        'financeiro.adiantamento.ler',
        'financeiro.adiantamento.conceder',
        'financeiro.bordero.ler',
        'financeiro.indicador.ler',
        'financeiro.classificacao.*',
        'financeiro.cadastro.*',
        'financeiro.parametro.*',
        'financeiro.movimento.ler',
        'financeiro.fluxoCaixa.*',
        'financeiro.escrituracao.ler',
        'financeiro.nfse.*',
        'financeiro.dmed.*',
        'financeiro.reinf.*',
        'financeiro.exportacaoContabil.*',
        'financeiro.remessa.*',
      ),
    },
  },
  'SINT.FIN.APROVA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FINAPROVA',
      // F7 (07-FIN linha 92): vê a conta corrente do paciente para aprovar a devolução do adiantamento pedida no caixa
      // (a aprovação vem do perfil aprovador-devolucao-paciente, abaixo).
      opcoesGrupo: [
        ...new Set([
          ...opcoesFinanceiro(
            'financeiro.tituloPagar.ler',
            'financeiro.tituloPagar.aprovar',
            'financeiro.tituloPagar.aprovarDiretoria',
            'financeiro.tituloPagar.prorrogar',
            'financeiro.adiantamento.ler',
            'financeiro.adiantamento.aprovar',
          ),
          ...opcoesFaturamento('faturamento.pagamento.ler'),
        ]),
      ].sort((a, b) => a - b),
    },
    // C1-084: aprova a devolução do adiantamento ao paciente pelo perfil próprio (não pela aprovação a fornecedor).
    perfisConcedidos: ['aprovador-devolucao-paciente'],
  },
  'SINT.FIN.PAGA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FINPAGA',
      opcoesGrupo: opcoesFinanceiro(
        'financeiro.tituloPagar.ler',
        'financeiro.tituloPagar.baixar',
        'financeiro.adiantamento.ler',
        'financeiro.adiantamento.pagar',
        'financeiro.adiantamento.compensar',
        'financeiro.adiantamento.devolver',
        'financeiro.bordero.ler',
        'financeiro.remessa.*',
        'financeiro.movimento.*',
        'financeiro.tituloReceber.ler',
        'financeiro.tituloReceber.baixar',
        'financeiro.tituloReceber.baixarManual',
        'financeiro.dado.mostrar',
      ),
    },
  },
  'SINT.FIN.CONCILIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FINCONC',
      opcoesGrupo: opcoesFinanceiro(
        'financeiro.conciliacao.*',
        'financeiro.movimento.ler',
        'financeiro.tituloReceber.ler',
        'financeiro.tituloPagar.ler',
        'financeiro.creditoConvenio.ler',
      ),
    },
  },
  /**
   * M32 (correção): a tesouraria e o fiscal SEM as opções de contas a pagar (D-MODULO-32), com o escopo restrito à conta
   * 1 na porta em memória (regra 15) e só a DMED (sem as opções da EFD-REINF: D-DECLARACAO-32).
   */
  'SINT.FIN.TESFIS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FINTESFIS',
      opcoesGrupo: opcoesFinanceiro(
        'financeiro.movimento.*',
        'financeiro.conciliacao.*',
        'financeiro.dmed.*',
        'financeiro.remessa.ler',
      ),
    },
  },
  /**
   * M33 (no fim da lista para não mudar o ID sintético das outras contas): o repasse com a segregação (regras 3 e 9):
   * o analista propõe a regra, apura, lança e emite o RPA; o supervisor aprova a regra e a apuração (quem propôs ou
   * apurou não aprova); o médico (vínculo sintético com o profissional na porta em memória) só vê o próprio extrato.
   */
  'SINT.REP.ANALISTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'REPANALISTA',
      opcoesGrupo: [
        ...new Set([
          ...opcoesRepasse(
            'repasse.regra.propor',
            'repasse.apuracao.ler',
            'repasse.lancamento.*',
            'repasse.rpa.*',
            'repasse.evento.*',
            'repasse.parametro.*',
            'repasse.cooperativa.*',
          ).filter((o) => !opcoesRepasse('repasse.regra.aprovar').includes(o)),
          ...opcoesFinanceiro('financeiro.tituloPagar.ler'),
        ]),
      ].sort((a, b) => a - b),
    },
  },
  'SINT.REP.SUPERVISOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'REPSUPER',
      opcoesGrupo: opcoesRepasse('repasse.regra.aprovar', 'repasse.apuracao.aprovar', 'repasse.regra.ler'),
    },
  },
  'SINT.REP.MEDICO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'REPMEDICO', opcoesGrupo: [] },
  },
  /**
   * Revisão do M39: a conta de carga do ensaio do k6 `pico-recepcao-gravacao` (como as contas de carga da homologação):
   * o guichê e a abertura de atendimento da recepção ambulatorial (as do SINT.SENHAS) e a inclusão do paciente (as do
   * SINT.RECEPCAO). Grupo próprio (CARGA). No fim do mapa: o ID sintético é a posição (as contas de antes não mudam).
   */
  'SINT.CARGA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'CARGA',
      opcoesGrupo: [
        3254, 6027, 3308, 5739, 5745, 6026, 6034, 6035, 6036, 6038, 3900, 5149, 5147, 3907, 5148, 3293, 2349,
        3255, 2348,
      ],
    },
  },
  /**
   * M44 (no fim da lista para não mudar o ID sintético das outras contas): diretor clínico (médico com conselho, grupo da coordenação médica) com o perfil `diretoria-clinica`
   * concedido nominalmente: publica o protocolo de classificação (o autor da versão é outro usuário ativo).
   */
  'SINT.DIRETOR.CLINICO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'MEDICOS_SUPERVISAO', opcoesGrupo: [3900, 5181, 5182], conselho: true },
    perfisConcedidos: ['diretoria-clinica'],
  },
  /**
   * M42 (no fim do mapa: o ID sintético é a posição): quem acompanha a competência da onda 4 no painel de glosas, com
   * a leitura de títulos, do movimento e do repasse (os blocos do financeiro e do repasse aparecem); sem a leitura do
   * painel de migração (o bloco de quem ainda usa o outro sistema vem indisponível).
   */
  'SINT.COMPETENCIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'COMPETENCIA',
      opcoesGrupo: [
        ...new Set([
          ...opcoesTiss('relatorio.glosa.*'),
          ...opcoesFinanceiro(
            'financeiro.tituloPagar.ler',
            'financeiro.tituloReceber.ler',
            'financeiro.movimento.ler',
          ),
          ...opcoesRepasse('repasse.lancamento.ler', 'repasse.rpa.ler'),
        ]),
      ].sort((a, b) => a - b),
    },
  },
  /**
   * M42 (no fim do mapa): o mesmo acompanhamento da competência, com o escopo de contas bancárias restrito à conta 1
   * (regra 15 do M32): o bloco do movimento só mostra o da conta 1, nem pelo cache.
   */
  'SINT.COMPETENCIA.CONTA1': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'COMPETENCIA',
      opcoesGrupo: [
        ...new Set([
          ...opcoesTiss('relatorio.glosa.*'),
          ...opcoesFinanceiro(
            'financeiro.tituloPagar.ler',
            'financeiro.tituloReceber.ler',
            'financeiro.movimento.ler',
          ),
          ...opcoesRepasse('repasse.lancamento.ler', 'repasse.rpa.ler'),
        ]),
      ].sort((a, b) => a - b),
    },
  },
  /**
   * M44 (etapa 2; no fim da lista para não mudar o ID sintético das outras contas): médico plantonista que decide internar,
   * pede o leito ao NIR e registra a alta prevista só com opções que o grupo MEDICOS do pc tem de fato (retrato
   * acesso-legado.pc.json): localizar paciente 3900 e a gravação da evolução 5181, 4580 e 4581, com conselho. Nenhuma
   * opção de leitos, de internações ou de altas (o médico real não tem); grupo próprio para não somar as de outra conta.
   */
  'SINT.MEDICO.NIR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MEDICOS_NIR',
      opcoesGrupo: [3900, 5181, 4580, 4581],
      conselho: true,
    },
  },
  /**
   * M43 (no fim do mapa): o gestor de acessos da onda 5 (papel 1, administrador do sistema, e o grupo ONDA5 com as opções
   * do cadastro de usuários, do gerenciamento, de alterar usuário e das permissões, e as dos painéis): lê o painel de fim da
   * coexistência, revê os sem grupo, confere o aparelho no setor e bloqueia o login de painel substituído.
   */
  'SINT.ONDA5': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    // As opções no GRUPO próprio (as do papel valeriam para todo administrador sintético).
    concessoes: { papeis: [1, 4], grupo: 'ONDA5', opcoesGrupo: [5429, 5433, 5435, 5437, 3724, 3971, 3973] },
  },
  /** M43 (regra 5): ativos sem grupo, a rever com o gestor de acessos (sem senha: nunca entram). */
  'SINT.SEMGRUPO1': {
    senha: null,
    criptografada: false,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: null,
    concessoes: { grupo: 'SEM GRUPO', opcoesGrupo: [] },
  },
  'SINT.SEMGRUPO2': {
    senha: null,
    criptografada: false,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: null,
    concessoes: { grupo: 'SEM GRUPO', opcoesGrupo: [] },
  },
  /** M43 (regra 4): logins de TV do grupo de painéis (não são de pessoa; sem senha no novo). */
  'SINT.PAINELTV1': {
    senha: null,
    criptografada: false,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: null,
    concessoes: { grupo: 'PAINEIS', opcoesGrupo: [] },
  },
  'SINT.PAINELTV2': {
    senha: null,
    criptografada: false,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: null,
    concessoes: { grupo: 'PAINEIS', opcoesGrupo: [] },
  },
  /**
   * M56 (etapa F0; no fim do mapa: o ID sintético é a posição): gestor da operadora própria e responsável pelos envios à
   * ANS, com os perfis da operadora concedidos nominalmente (nenhuma opção do outro sistema dá a operadora, D-PERM-56).
   */
  'SINT.OPERADORA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [4] },
    perfisConcedidos: ['operadora-gestor', 'operadora-ans'],
  },
  /**
   * M57 (etapa 1): gestor de cadastro da Rede (grupo próprio GESTOR_CADASTRO): unificação (3272, 4005) e reversão da
   * unificação (6544, 6608) do cadastro de pacientes, com a busca (3254, 6027): a fila do MPI da Rede, vincular e
   * desfazer. O SINT.SAME (só unificação) vincula, mas não desfaz.
   */
  'SINT.GESTORCAD': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'GESTOR_CADASTRO', opcoesGrupo: [3272, 4005, 6544, 6608, 3254, 6027] },
  },
  /**
   * M50 (etapa 1; no fim da lista para não mudar o ID sintético das outras contas): a área de privacidade, que confere
   * os responsáveis legais do portal do paciente e bloqueia ou encerra a conta: a opção raiz de Privacidade e proteção
   * de dados (6511) e o Termo de consentimento do cadastro de pacientes (consultar 6534, incluir 6535, ações 6537).
   */
  'SINT.PRIVACIDADE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'PRIVACIDADE', opcoesGrupo: [6511, 6534, 6535, 6537] },
  },
  /**
   * M56 (etapa 4, F3; no fim do mapa): o credenciamento da operadora (credencia, altera e descredencia prestador) e o
   * auditor da operadora, que só consulta a rede. Perfis da operadora concedidos nominalmente (D-PERM-56).
   */
  /**
   * M54 (etapa 1): a contabilidade (no pc, só o grupo MASTER tem as opções do módulo; aqui um grupo próprio, sem o
   * acesso total do MASTER): Plano de contas 4297,
   * Integração 4302 (publicar regra) e Integrar lançamentos 82 (fatos dos módulos); M54.1: Empresas 14, SPED › Atualização
   * de tabelas 4338 e Usuários 4296 (os cadastros genéricos da aba Cadastros).
   */
  'SINT.CONTADOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    // M54.2: Lançamentos 22, Conciliação contábil 4328, Encerramento de exercício 85 e Desfazer 88. M54.3: Balancete 38
    // (demonstrações) e SPED Contábil › Gerar arquivos 4339.
    concessoes: {
      grupo: 'CONTABILIDADE',
      opcoesGrupo: [4297, 4302, 82, 14, 4338, 4296, 22, 4328, 85, 88, 38, 4339],
    },
  },
  /** M54 (etapa 1): só consulta o plano referencial (4312): lê o plano e as regras, não edita nem publica. */
  'SINT.CONTABIL.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CONTABIL_CONSULTA', opcoesGrupo: [4312] },
  },
  /** M54.1 (correção da revisão): só a consulta de lançamentos (81): acompanha os fatos, sem o plano nem as regras. */
  'SINT.CONTABIL.FATOS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CONTABIL_FATOS', opcoesGrupo: [81] },
  },
  'SINT.CREDENCIAMENTO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [4] },
    perfisConcedidos: ['operadora-credenciamento'],
  },
  'SINT.OPE.AUDITOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [4] },
    perfisConcedidos: ['operadora-auditor'],
  },
  /**
   * M45, etapa 1 (no fim do mapa: o ID sintético é a posição): o administrador do PEP que monta formulários novos
   * (leitura da administração do PEP, Incluir, Alterar e Excluir das composições e a confirmação da edição).
   */
  'SINT.ADMIN.PEP': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ADMIN_PEP', opcoesGrupo: [2643, 2644, 5921, 4704, 4705, 4706, 5394] },
  },
  /** M45, etapa 1: membro da comissão de prontuário (lê a administração do PEP e confirma: aprova e publica). */
  'SINT.COMISSAO.PRONT': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'COMISSAO_PRONTUARIO', opcoesGrupo: [2643, 2644, 5921, 5394] },
  },
  /**
   * M56.2 (fatia F1; no fim do mapa): atendente da operadora, que só consulta beneficiários, planos e contratos (sem
   * `operadora.beneficiario.editar`), para provar a recusa de quem só lê.
   */
  'SINT.OPE.ATENDE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [4] },
    perfisConcedidos: ['operadora-atendimento'],
  },
  /**
   * M57 (etapa 3; no fim do mapa: o ID sintético é a posição): a diretoria da Rede, só com o perfil `diretoria-rede`
   * concedido nominalmente (o BI consolidado e o registro dos serviços compartilhados) e NENHUMA opção do outro sistema:
   * sem prontuário (regra 10), sem cadastro do paciente.
   */
  'SINT.DIRETORIA.REDE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'DIRETORIA_REDE', opcoesGrupo: [] },
    perfisConcedidos: ['diretoria-rede'],
  },
  /**
   * M45 (etapa 2; no fim da lista para não mudar o ID sintético das outras contas): médico intensivista da UTI (com
   * conselho; o vínculo da porta em memória é de médico, CBO 225150): o índice prognóstico do PEP (3945: Consultar 5499,
   * Novo 5283, Manter 5284, Impressão 5286, Corrigir 6559): registra e valida o APACHE II e o SOFA.
   */
  'SINT.MEDICO.UTI': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MEDICOS_UTI',
      opcoesGrupo: [2582, 3900, 3945, 5499, 5283, 5284, 5286, 6559],
      conselho: true,
    },
  },
  /**
   * M50 (etapa 2; no fim da lista pelo mesmo motivo): a recepção que confere o pré-check-in do portal: o gerador de
   * senhas e os atendimentos da recepção externa (3308, 5739, 5745, 6026: as opções do check-in) e a alteração do
   * cadastro de pacientes (3254, 6027), que grava o aprovado. Grupo próprio (RECEPCAO_PORTAL).
   */
  'SINT.PRECHECKIN': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'RECEPCAO_PORTAL', opcoesGrupo: [3254, 6027, 3308, 5739, 5745, 6026] },
  },
  /**
   * M45, etapa 5 (no fim do mapa: o ID sintético é a posição): a nutricionista clínica (CBO 2237 pela porta sintética),
   * com o relatório de pacientes internados (2382), a consulta e o registro da evolução do prontuário (com o Salvar
   * 4581 da nutrição) e o gerenciamento de dietas: a fila, a triagem, a terapia, o mapa, a etiqueta e o acompanhante.
   */
  'SINT.NUTRI.CLINICA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'NUTRICAO_CLINICA',
      opcoesGrupo: [
        ...new Set([
          2582,
          3900,
          2382,
          2601,
          6355,
          6357,
          6359,
          6360,
          ...OPCOES_PEP_EVOLUCAO_LER,
          ...OPCOES_PEP_EVOLUCAO_CRIAR,
        ]),
      ],
      conselho: true,
    },
  },
  /** M45, etapa 5: a copa (sem conselho): o mapa de dietas, o fechamento no corte, a etiqueta e o acompanhante. */
  'SINT.COPA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'COPA', opcoesGrupo: [2382, 2420, 5011] },
  },
  /** M45, etapa 5: a assistente social (CBO 2516 pela porta sintética): lê e registra o serviço social. */
  'SINT.SOCIAL': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'SERVICO_SOCIAL',
      opcoesGrupo: [...new Set([2582, 3900, ...OPCOES_PEP_EVOLUCAO_LER, ...OPCOES_PEP_EVOLUCAO_CRIAR])],
      conselho: true,
    },
  } /**
   * M50, etapa 6 (no fim do mapa: o ID sintético é a posição): a agenda de sessões (o Agendamento: Agenda de
   * quimioterapia 4842, Pacientes agendados 4843, Agendar 4852, Alterar 4844, Desagendar 4848, Confirmar 4855,
   * Horários livres 4856; a Manutenção/criação de agendas 4834 para as cadeiras e salas; a pesquisa de pacientes 3290);
   * o SAME que captura (a Manutenção do controle de prontuários 2362, Inserir arquivo 4636 e Visualizar arquivo 4638) e
   * o que confere e assina (Controle I 2363 e II 2364, Relatório do SAME 2468 e Visualizar arquivo 4638); sem as opções
   * de cima da árvore (2361, 4635), que dariam as duas coisas à mesma pessoa.
   */,
  'SINT.SESSOES': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'TERAPIAS_SESSOES',
      opcoesGrupo: [4830, 4831, 4834, 4842, 4843, 4844, 4848, 4850, 4852, 4855, 4856, 3290],
    },
  },
  'SINT.SAME.CAPTURA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'SAME_DIGITALIZACAO', opcoesGrupo: [2362, 4636, 4638] },
  },
  'SINT.SAME.CONFERE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'SAME_CONFERENCIA', opcoesGrupo: [2363, 2364, 2468, 4638] },
  },
  /**
   * M45, etapa 6 (no fim do mapa: o ID sintético é a posição; DP-32): o médico especialista (CBO 225265 pela porta
   * sintética), com o planejamento oftalmológico e os exames complementares, o planejamento oncológico (nova, alterar,
   * prescrever) e os protocolos, o partograma e o registro no prontuário.
   */
  'SINT.ESPECIALISTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MEDICOS_ESPECIALISTAS',
      opcoesGrupo: [
        ...new Set([
          2582,
          3900,
          2600,
          5496,
          5280,
          6558,
          5967,
          4715,
          5968,
          5401,
          4271,
          5483,
          5254,
          4272,
          4273,
          4686,
          6473,
          6474,
          6476,
          ...OPCOES_PEP_EVOLUCAO_LER,
          ...OPCOES_PEP_EVOLUCAO_CRIAR,
        ]),
      ],
      conselho: true,
    },
  },
  /** M45, etapa 6: o farmacêutico da oncologia (CBO 223405 pela porta sintética): a fila e a validação do ciclo. */
  'SINT.FARMA.ONCO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'FARMACIA_ONCOLOGIA', opcoesGrupo: [2582, 3900, 4271, 5483, 4274], conselho: true },
  },
  /** M45, etapa 6: a nutricionista do lactário (CBO 223710): o gerenciamento de dietas e o Salvar da nutrição. */
  'SINT.LACTARIO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'LACTARIO',
      opcoesGrupo: [2582, 3900, 6355, 6357, 6359, 6360, 4581],
      conselho: true,
    },
  },
  /** M45, etapa 6: a segunda pessoa do lactário, que confere a ordem de outra. */
  'SINT.LACTARIO2': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'LACTARIO',
      opcoesGrupo: [2582, 3900, 6355, 6357, 6359, 6360, 4581],
      conselho: true,
    },
  },
  /**
   * M56 (etapa 3, F2; no fim do mapa: o ID sintético é a posição): a cobrança da operadora, que gera as mensalidades,
   * lança coparticipação e avulsa, baixa, faz acordo, reajusta e notifica a inadimplência (perfil
   * `operadora-cobranca`, concedido nominalmente; D-PERM-56). Lê os beneficiários, não os altera.
   */
  'SINT.OPE.COBRANCA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [4] },
    perfisConcedidos: ['operadora-cobranca'],
  },
  // M50 (etapa 5): a portaria (o porteiro registra visitantes, visitas e acompanhantes; o supervisor define as regras,
  // bloqueia, autoriza a exceção, emite os contatos e cuida dos terminais; o integrador da catraca registra a passagem).
  'SINT.PORTARIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'PORTARIA', opcoesGrupo: OPCOES_PORTEIRO_M50 },
  },
  'SINT.PORTARIA.SUP': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'PORTARIA_SUPERVISAO', opcoesGrupo: OPCOES_SUPERVISOR_PORTARIA_M50 },
  },
  'SINT.PORTARIA.CATRACA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'INTEGRACAO_CATRACA', opcoesGrupo: OPCOES_CATRACA_M50 },
  },
  /**
   * M50.5 (correção da revisão): a recepção interna só com a opção dos acompanhantes (2457), que registra o
   * acompanhante e a pessoa sem a portaria; e o controle de infecção só com os relatórios da portaria (4546, 4547), que
   * emite o relatório de contatos sem as regras de visita.
   */
  'SINT.RECEPCAO.INTERNA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'RECEPCAO_INTERNA',
      opcoesGrupo: [2457] /* acompanhantes da recepção, no menu de origem */,
    },
  },
  'SINT.SCIH': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CONTROLE_INFECCAO', opcoesGrupo: opcoesPortaria(PERMISSOES_PORTARIA.contatos) },
  },
  /**
   * M50, etapa 4 (D-SINT-50.4): o médico convidado da teleinterconsulta (grupo próprio, com conselho: no estado
   * sintético as opções são do grupo, e no MEDICOS iriam também para SINT.MEDICO): localizar, chamar e liberar o
   * paciente (3900, 5149, 5147) e a evolução (5181, 5182). O vínculo da porta em memória é o do cardiologista sintético
   * (7102). No fim do mapa, para não mudar o ID das contas de antes.
   */
  'SINT.CARDIO.TELE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'MEDICOS_TELE', opcoesGrupo: [3900, 5149, 5147, 5181, 5182], conselho: true },
  },
  /**
   * M52.1 (no fim da lista para não mudar o ID sintético das outras contas): o RH só de consulta (Afastamento, 389) e o
   * colaborador sintético com login, que a admissão reusa pelo CPF sintético e o desligamento bloqueia. O SINT.RH (M14)
   * ganhou Funcionário (358, 4224) e Rescisão (388): admite, desliga e consulta os colaboradores.
   */
  'SINT.RH.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'RH_CONSULTA', opcoesGrupo: [389] },
  },
  'SINT.COLAB': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
  },
  /**
   * M47 (etapa 3; no fim do mapa: o ID sintético é a posição): o técnico de imagem da lista de trabalho DICOM (Tabelas ›
   * Integração com PACs 4740, Equipamento 4742; consulta dos resultados de radiologia, tomografia e ultrassonografia;
   * lançamento direto nesses setores); e o técnico que só consulta a lista (sem lançar nem configurar o PACS).
   */
  'SINT.TEC.IMAGEM': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'TECNICOS_IMAGEM',
      opcoesGrupo: [4740, 4742, 6217, 6221, 6225, 6131, 6136, 6141, 6176, 6181, 6186],
    },
  },
  'SINT.TEC.IMAGEM.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'TECNICOS_IMAGEM_CONSULTA', opcoesGrupo: [6217, 6221, 6225] },
  },
  /**
   * M51 (etapa 1; no fim do mapa: o ID sintético é a posição): o faturista e supervisor do faturamento SUS (as opções
   * da CIHA, dos módulos SUS e do fechamento): abre a competência, roda a crítica, registra a equivalência SIGTAP,
   * justifica o aviso, gera e baixa a CIHA, fecha e reabre.
   */
  'SINT.FATURISTA.SUS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FATURAMENTO_SUS',
      opcoesGrupo: opcoesSus('faturamento.sus.*', 'faturamento.susCiha.*', 'faturamento.susEquivalencia.*'),
    },
  },
  /** M51: o faturista SUS restrito ao convênio 20 (lê as críticas dele; não fecha nem gera). */
  'SINT.SUS.ESCOPO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FATURAMENTO_SUSE',
      opcoesGrupo: opcoesSus('faturamento.sus.*', 'faturamento.susCiha.*'),
    },
    escopos: { convenios: ['20'] },
  },
  /**
   * M52.2 (no fim da lista para não mudar o ID sintético das outras contas): a coordenação de enfermagem do setor-piloto,
   * gestora de escala: o perfil `gestor-escala` concedido nominalmente (lê, monta e PUBLICA a escala; lê os regimes) e,
   * do Ponto eletrônico do outro sistema, Horário (5056) e Horários contratuais (5059): edita os regimes. O SINT.RH (M14)
   * lê e monta a escala pelo quadro de escalas (5073) da área de pessoas, mas não publica.
   */
  'SINT.ESCALA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'COORD_ENFERMAGEM', opcoesGrupo: [5056, 5059] },
    perfisConcedidos: ['gestor-escala'],
  },
  /**
   * M52.5 (no fim do mapa: o ID sintético é a posição): o SESMT (médico ou enfermeiro do trabalho) com o módulo de
   * segurança do trabalho (554 a 582: lançamentos de CAT, risco da seção, exame e EPI do funcionário, as tabelas do
   * PPRA e os relatórios); e o SESMT só de consulta (Funcionário 571 e os relatórios de CAT 576 e PPP 578). Nenhum dos
   * dois tem opção do prontuário (regra 16).
   */
  'SINT.SESMT': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'SESMT',
      opcoesGrupo: [
        554, 555, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 569, 570, 571, 572, 573, 574, 576,
        577, 578, 582,
      ],
    },
  },
  'SINT.SESMT.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'SESMT_CONSULTA', opcoesGrupo: [571, 576, 578] },
  },
  /**
   * M52.5 (corretor; regra 16): quem só tem o relatório de ASO (577), isto é, só `pessoas.ocupacional.ler`: o painel
   * mostra as pendências do ASO e esconde as de acidente, CAT, sorologia, EPI, dose e vacina.
   */
  'SINT.SESMT.ASO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'SESMT_ASO', opcoesGrupo: [577] },
  },
  /** M52.5 (corretor; D-PPP-525): só o relatório de PPP (578), isto é, só `pessoas.risco.ler`: o PPP sem os ASO. */
  'SINT.SESMT.PPP': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'SESMT_PPP', opcoesGrupo: [578] },
  },
  /**
   * M47 (etapa 2; no fim do mapa: o ID sintético é a posição): a médica hemoterapeuta da agência própria (com conselho),
   * que confere e libera a imuno-hematologia que a biomédica registra (dupla conferência) e cuida do estoque: Hemoterapia
   * › Pré-transfusão 3074, Bolsa 3067, Tabelas 3048 › Cadastro 3050 (Reação 3053, Conduta 3060, Local 3061); os
   * resultados do laboratório (6206, 6209) e a liberação para a web (2972).
   */
  'SINT.HEMOTERAPEUTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'HEMOTERAPIA',
      opcoesGrupo: [3074, 3067, 3048, 3050, 3053, 3060, 3061, 6206, 6209, 2972],
      conselho: true,
    },
  },
  /**
   * M51 (etapa 2): o faturista do BPA e dos solicitantes SUS (as opções do BPA, das tabelas e da importação dos médicos solicitantes;
   * a chave do BPA é ligada só para ele no E2E, escopo pessoa). No fim do mapa: o ID sintético é a posição (D-SINT-51).
   */
  'SINT.FATURISTA.BPA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FATURAMENTO_BPA',
      opcoesGrupo: [
        ...opcoesSus('faturamento.sus.*', 'faturamento.susBpa.*', 'faturamento.susEquivalencia.*'),
        ...OPCOES_SOLICITANTE_SUS,
      ],
    },
  },
  /**
   * M52.3 (no fim da lista): a segunda pessoa da coordenação, também gestora de escala, para os quatro olhos da troca
   * de plantão (quem registra o pedido ou o aceite em nome do colega não aprova; D-QUATRO-OLHOS-52.3).
   */
  'SINT.ESCALA.APROVA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'COORD_ENFERMAGEM', opcoesGrupo: [5056, 5059] },
    perfisConcedidos: ['gestor-escala'],
  },
  /**
   * M52.4 (no fim do mapa: o ID sintético é a posição): a coordenação que aprova o ponto, com o Ponto eletrônico do outro
   * sistema: autorização de trabalho/folga (5074), abertura de período (5071), banco de horas (5077 a 5079), manutenção
   * individual (5076), espelho (5082) e as exportações (5085 a 5087) e a integração com a folha (5084): aprova os ajustes
   * que o RH lança, fecha e reabre o período, acerta o banco e gera o arquivo de jornada; não importa o arquivo do
   * relógio.
   */
  'SINT.PONTO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'COORD_PONTO',
      opcoesGrupo: [5071, 5074, 5076, 5077, 5078, 5079, 5082, 5084, 5085, 5086, 5087],
    },
  },
  /** M52.4: a colaboradora do ponto com login próprio (sem opção): vê o próprio espelho e dá a ciência. */
  'SINT.COLAB.PONTO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
  },
  /**
   * M51 (etapa 3): o faturista da APAC (as opções do cadastro, do arquivo magnético e do encerramento da APAC, as da
   * competência e da equivalência; a chave da APAC é ligada só para ele no E2E, escopo pessoa). No fim do mapa: o ID
   * sintético é a posição (D-SINT-51).
   */
  'SINT.FATURISTA.APAC': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FATURAMENTO_APAC',
      opcoesGrupo: [
        ...opcoesSus('faturamento.sus.*', 'faturamento.susApac.*', 'faturamento.susEquivalencia.*'),
        ...OPCOES_SOLICITANTE_SUS,
      ],
    },
  },
  /**
   * M46 (etapa 4; no fim da lista): o almoxarife dos consignados (Consignados 4467 e 1946, a devolução ao fornecedor
   * consignado 4482 e a entrada de nota 5722), com o cadastro de itens e de fornecedores.
   */
  'SINT.CONSIGNADO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'CONSIGNADO',
      opcoesGrupo: [
        4467,
        1946,
        4482,
        5722,
        ...opcoesSuprimentos('suprimentos.item.ler', 'suprimentos.fornecedor.ler'),
      ],
    },
  },
  /**
   * M55 (etapa 3): o comprador dos contratos (Pedidos 2123 e Manutenção 2124, Definição de vencedores 2125, Contas a
   * pagar 108: lê, cadastra, liga e avalia) e o gerente de compras (Autorização dos pedidos 4491 e Pedidos 2123: adita,
   * reajusta e aprova a exceção do contrato vencido). Sem dado de pessoa.
   */
  'SINT.CONTRATOS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'CONTRATOS',
      // C1-032: o pedido ligado ao contrato inclui o item pela busca do cadastro (GET /api/suprimentos/itens).
      opcoesGrupo: [
        108,
        2123,
        2124,
        2125,
        ...opcoesSuprimentos('suprimentos.fornecedor.ler', 'suprimentos.item.ler'),
      ],
    },
  },
  'SINT.GERCOMPRAS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'GERCOMPRAS',
      opcoesGrupo: [2123, 4491],
    },
  },
  /**
   * M55 (etapa 4): o agente de contratação (Licitações 2097, Emissão 2102, Edital 2103 e Cotação de preços 2110: lê e
   * conduz o processo) e a autoridade competente (Licitações 2097 e Homologação 2107: homologa, decide o recurso, revoga
   * e anula). Sem dado de pessoa.
   */
  'SINT.LICITACAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'LICITACAO',
      opcoesGrupo: [2097, 2102, 2103, 2110],
    },
  },
  'SINT.AUTORIDADE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'AUTORIDADE',
      opcoesGrupo: [2097, 2107],
    },
  },
  /**
   * M46 (etapa 4): os dois farmacêuticos da manipulação (Manipulação 1769, Ordem 1770, Capela/Grupos 1771, os relatórios
   * 1952 e 1954 e Liberar capelas 4499), com o saldo do estoque; um prepara e o outro faz a dupla conferência.
   */
  'SINT.MANIPULACAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MANIPULACAO',
      opcoesGrupo: [
        1769,
        1770,
        1771,
        1952,
        1954,
        4499,
        ...opcoesSuprimentos('suprimentos.item.ler', 'suprimentos.saldo.ler'),
      ],
      conselho: true,
    },
  },
  'SINT.MANIPULACAO2': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MANIPULACAO',
      opcoesGrupo: [
        1769,
        1770,
        1771,
        1952,
        1954,
        4499,
        ...opcoesSuprimentos('suprimentos.item.ler', 'suprimentos.saldo.ler'),
      ],
      conselho: true,
    },
  },
  /**
   * Revisão do M46.4: o auxiliar da manipulação com a opção da ordem (1770) e sem o vínculo de farmacêutico (a dupla
   * conferência recusa: só o farmacêutico confere).
   */
  'SINT.AUXMANIP': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'MANIPULACAO',
      opcoesGrupo: [
        1769,
        1770,
        1771,
        4499,
        ...opcoesSuprimentos('suprimentos.item.ler', 'suprimentos.saldo.ler'),
      ],
    },
  },
  /**
   * M51 (etapa 4, no fim da lista): o faturista da AIH (as opções da competência SUS, da AIH com a faixa, do retorno e
   * dos cadastros do SUS; a chave da AIH é ligada só para ele no E2E, escopo pessoa; D-SINT-51).
   */
  'SINT.FATURISTA.AIH': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FATURAMENTO_AIH',
      // 6920: uma das opções de consulta dos catálogos oficiais (catalogo.item.ler: os domínios do SIH e do SIA).
      opcoesGrupo: [
        ...opcoesSus(
          'faturamento.sus.*',
          'faturamento.susAih.*',
          'faturamento.susRetorno.*',
          'faturamento.susCadastro.*',
        ),
        6920,
      ],
    },
  },
  /**
   * M48.1 (no fim do mapa: o ID sintético é a posição): a enfermeira do Núcleo de Segurança do Paciente, com conselho
   * (a categoria assistencial mantém as permissões clínicas do perfil na segregação) e o perfil complementar
   * `nucleo-seguranca-paciente` concedido nominalmente: lê, tria, distribui, devolve e exporta para o Notivisa.
   */
  'SINT.NSP': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ENFERMAGEM', opcoesGrupo: [2582], conselho: true },
    perfisConcedidos: ['nucleo-seguranca-paciente'],
  },
  /**
   * M53.1 (no fim do mapa: o ID sintético é a posição): o departamento pessoal da interface com a folha externa (Folha
   * de pagamento 351, Lançamentos 372, Folha Mensal 384, Afastamento 389, Exportações 523, Importações 547): gera e
   * baixa o lote, importa o retorno e registra os afastamentos; e quem só consulta a folha (351). M53.2: o departamento
   * pessoal também mantém os cadastros da folha (rubricas e incidências, tabela legal, lançamento automático e rotinas de
   * integração: as opções dos cadastros genéricos do M53; e Tabelas 352, a dos quatro cadastros da folha do M14).
   * M53.3: e processa a folha mensal (Processamento 391), altera o salário (392) e mantém os parâmetros (354, 355).
   * M53.4: e lança e libera as férias (387, 395) e o 13º (Lançamentos automáticos 373, 13º Salário 382).
   * M53.5: e lança a rescisão (Lançamentos › Rescisão 388).
   * M53.6: e opera o eSocial (o módulo 5105, Tabelas e Parâmetros 5107/5113, Envio 5108, Pendências 5109, Painel de
   * envio 5110, Consulta dos lotes 5111, o certificado 6977, a importação do XML 6978, o histórico 6979 e os relatórios
   * de conferência 4288). M53.9: e configura o de-para e lança os títulos da folha (371, 397, 4876 a 4882, 93).
   */
  'SINT.DP.FOLHA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'DP_FOLHA',
      opcoesGrupo: [
        ...new Set([
          351,
          352,
          354,
          355,
          372,
          384,
          389,
          373,
          382,
          387,
          388,
          391,
          392,
          395,
          // M53.7 (F6): a liberação do mês e a abertura do mês/ano (pessoas.folha.fechar).
          396,
          545,
          // M53.8 (F7): o relatório do FGTS (415), as exportações (CAGED 525, SEFIP 526, GRRF 527, RAIS 528) e os
          // aplicativos (533 a 535) das obrigações legais (pessoas.obrigacao.ler e .gerar).
          415,
          525,
          526,
          527,
          528,
          533,
          534,
          535,
          // M53.9 (F8): a integração com o financeiro e o contábil (Tabelas › Integração 371, Rotinas › Integração 397,
          // a tabela de integração da folha 4876 a 4882 e a importação da folha na contabilidade 93).
          371,
          397,
          4876,
          4877,
          4878,
          4879,
          4880,
          4881,
          4882,
          93,
          523,
          547,
          4288,
          5105,
          5107,
          5108,
          5109,
          5110,
          5111,
          5113,
          6977,
          6978,
          6979,
          ...opcoesDoMarco('M53', 'pessoas'),
        ]),
      ].sort((x, y) => x - y),
    },
  },
  'SINT.FOLHA.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'FOLHA_CONSULTA', opcoesGrupo: [351] },
  },
  /**
   * M53.2 (D-ABRIR-532; no fim do mapa: o ID sintético é a posição): quem só tem uma parte da área da folha no outro
   * sistema — os eventos (367: consulta as rubricas) ou a tabela de cálculo (370: as tabelas legais) — abre o item do
   * menu e chega à sua aba, sem a folha da competência.
   */
  'SINT.FOLHA.EVENTOS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'FOLHA_EVENTOS', opcoesGrupo: [367] },
  },
  'SINT.FOLHA.TABELAS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'FOLHA_TABELAS', opcoesGrupo: [370] },
  },
  /**
   * M48.2 (no fim do mapa: o ID sintético é a posição): a coordenadora de enfermagem que recebe a notificação
   * distribuída como gestora da área (o perfil `coordenador-enfermagem` concedido nominalmente, como o gestor de
   * acessos faz até o mapa grupo → perfil ser aprovado): analisa e planeja, sem ver quem notificou.
   */
  'SINT.COORD.ENF': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    // C2-003 (03-PEP L115): a coordenação lê os sinais vitais (opção 2642, enfermagem.sinalVital.ler) para manter os
    // limites de alerta, que grava pelo perfil assistencial-com-conselho (enfermagem.limiteSinal.editar).
    concessoes: { grupo: 'ENFERMAGEM_SUPERVISAO', opcoesGrupo: [2582, 2642], conselho: true },
    perfisConcedidos: ['coordenador-enfermagem'],
  },
  /**
   * M48.2 (correção da revisão; no fim do mapa): a supervisão da farmácia, que conduz a farmacovigilância (D-PERM-48.2:
   * registra e lê a vigilância de produto) sem ler as notificações do NSP.
   */
  'SINT.SUP.FARMACIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'FARMACIA_SUPERVISAO', opcoesGrupo: [2582], conselho: true },
    perfisConcedidos: ['supervisor-farmacia'],
  },
  /**
   * M48.3 (no fim do mapa: o ID sintético é a posição): o enfermeiro da CCIH, com conselho e o perfil complementar
   * `controle-infeccao` concedido nominalmente: vigilância, dispositivos, IRAS, liberação de antimicrobiano restrito,
   * precauções, higiene das mãos e surtos.
   */
  'SINT.CCIH': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ENFERMAGEM', opcoesGrupo: [2582], conselho: true },
    perfisConcedidos: ['controle-infeccao'],
  },
  /**
   * M48.4 (no fim do mapa: o ID sintético é a posição): o enfermeiro da vigilância epidemiológica hospitalar, com
   * conselho e o perfil complementar `vigilancia-epidemiologica` concedido nominalmente: a fila de agravos, o caso, a
   * ficha SINAN e o registro da notificação.
   */
  'SINT.VIGILANCIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    // M48.4: a Pesquisa de pacientes (3290) para o caso aberto sem sugestão (busca ativa).
    concessoes: { grupo: 'ENFERMAGEM', opcoesGrupo: [2582, 3290], conselho: true },
    perfisConcedidos: ['vigilancia-epidemiologica'],
  },
  /**
   * M48.5 (no fim do mapa: o ID sintético é a posição): a enfermeira do escritório da qualidade, com o perfil
   * complementar `gestao-qualidade` concedido nominalmente: documentos, indicadores, auditorias, comissões, riscos, não
   * conformidades e envios regulatórios.
   */
  'SINT.QUALIDADE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ENFERMAGEM', opcoesGrupo: [2582], conselho: true },
    perfisConcedidos: ['gestao-qualidade'],
  },
  /** M48.5: a ouvidoria (manifestações, encaminhamento, resposta e o NPS da pesquisa), com a Pesquisa de pacientes. */
  'SINT.OUVIDORIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ENFERMAGEM', opcoesGrupo: [3290], conselho: false },
    perfisConcedidos: ['ouvidoria'],
  },
  /**
   * M53.6 (no fim do mapa: o ID sintético é a posição): quem só acompanha as pendências do eSocial (Envio eSocial ›
   * Pendências 5109): consulta eventos, lotes, pendências e conciliação, sem gerar, sem ver XML nem ficha e sem transmitir.
   */
  'SINT.ESOCIAL.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ESOCIAL_CONSULTA', opcoesGrupo: [5109] },
  },
  /**
   * M53.8 (no fim do mapa: o ID sintético é a posição): quem só consulta o relatório do FGTS (Relatórios da folha ›
   * FGTS 415): vê as obrigações geradas e a apuração do FGTS Digital, sem gerar, sem baixar o arquivo e sem os valores.
   */
  'SINT.OBRIGACAO.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'OBRIGACAO_CONSULTA', opcoesGrupo: [415] },
  },
  /**
   * M55.2 (no fim do mapa: o ID sintético é a posição): o encarregado da rouparia, só com o perfil complementar
   * `rouparia` concedido nominalmente (sem opção da higienização): o enxoval, as cotas e os movimentos.
   */
  'SINT.ROUPARIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ROUPARIA', opcoesGrupo: [] },
    perfisConcedidos: ['rouparia'],
  },
  /** M55.2: quem só consulta a rouparia (o Painel de leitos da higienização, 5012): lê, sem registrar. */
  'SINT.ROUPARIA.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'HIGIENIZACAO_PAINEL', opcoesGrupo: [5012] },
  },
  /**
   * M54.4 (no fim do mapa: o ID sintético é a posição): o analista de custos pelas opções de Gestão de custos (Tabelas
   * 295 a 299, Buscar produção 307 com SADT 308, Internação 312 e Bloco cirúrgico 313, Calcular itens de produção 319,
   * Consultas › Centro de custo 321): classifica os centros, coleta e lança as estatísticas; e quem só consulta o
   * centro de custo (321).
   */
  'SINT.CUSTOS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'CUSTOS',
      opcoesGrupo: [295, 296, 297, 298, 299, 307, 308, 312, 313, 319, 321],
    },
  },
  'SINT.CUSTOS.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CUSTOS_CONSULTA', opcoesGrupo: [321] },
  },
  /**
   * M59.2 (no fim do mapa: o ID sintético é a posição): as duas contas que a identidade em memória conhece (credencial
   * forte e segundo fator, porta-identidade-sintetica.ts). SINT.IDENT entra pela senha antiga, ganha a credencial forte
   * no primeiro login e cadastra o segundo fator; SINT.IDENT.CRITICO é do grupo MASTER (onda 1), recusado sem ele.
   * A senha antiga é de 30 dias antes da partida: a credencial forte gravada depois decide o login.
   */
  'SINT.IDENT': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(Date.now() - 30 * 86_400_000),
  },
  'SINT.IDENT.CRITICO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(Date.now() - 30 * 86_400_000),
    concessoes: { grupo: 'MASTER' },
  },
  /**
   * M55.5 (no fim do mapa: o ID sintético é a posição): o analista de contratualização SUS pelas Tabelas e Parâmetros do
   * faturamento SUS (643, 644, 701, 920) e as raízes dos módulos (4252, 4253, 4262): cadastra o contrato com o gestor, as
   * metas e registra a apuração; e quem só consulta pelo Controle de atendimento SUS (2487).
   */
  'SINT.CONTRATUALIZACAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CONTRATUALIZACAO', opcoesGrupo: [643, 644, 701, 920, 4252, 4253, 4262] },
  },
  'SINT.CONTRATUALIZACAO.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CONTRATUALIZACAO_CONSULTA', opcoesGrupo: [2487] },
  },
  /**
   * M59.4 (saneamento dos grupos): o gestor de acessos que decide e aplica (perfil gestor-acessos concedido, papel SBIS
   * de gestor de acessos), e a pessoa da área que aprova a perda de opção usada (outra pessoa, com o mesmo perfil).
   */
  'SINT.SANEAR.GESTOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [0, 4] },
    perfisConcedidos: ['gestor-acessos'],
  },
  'SINT.SANEAR.AREA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [0, 4] },
    perfisConcedidos: ['gestor-acessos'],
  },
  /** M54.2 (correção da revisão): só Contas a pagar e receber da integração (83): acompanha os fatos, não lança. */
  'SINT.CONTABIL.INTEGRA83': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CONTABIL_INTEGRA83', opcoesGrupo: [83] },
  },
  /** M54.2 (correção da revisão): só Integrar lançamentos (82): acompanha os fatos e contabiliza. */
  'SINT.CONTABIL.INTEGRA82': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'CONTABIL_INTEGRA82', opcoesGrupo: [82] },
  },
  /**
   * M54.7 (no fim do mapa: o ID sintético é a posição): o orçamento empresarial pelas opções de Gestão de orçamento
   * (Tabelas 584 e Parâmetros 585, Lançamentos 586 com Orçamento 587 e Gerar orçamento 588, Relatórios 589 a 594).
   * SINT.ORCAMENTO monta a versão; SINT.ORCAMENTO.APROVA (as mesmas opções) aprova a que outra pessoa montou
   * (segregação); SINT.ORCAMENTO.CONSULTA só tem o Comparativo (594): lê e não grava.
   */
  'SINT.ORCAMENTO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ORCAMENTO', opcoesGrupo: [584, 585, 586, 587, 588, 589, 590, 591, 592, 593, 594] },
  },
  'SINT.ORCAMENTO.APROVA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ORCAMENTO_APROVA',
      opcoesGrupo: [584, 585, 586, 587, 588, 589, 590, 591, 592, 593, 594],
    },
  },
  'SINT.ORCAMENTO.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ORCAMENTO_CONSULTA', opcoesGrupo: [594] },
  },
  /** M54.7 (correção): só a opção Orçamento (587), sem as de Tabelas e Relatórios: abre a tela, monta e aprova. */
  'SINT.ORCAMENTO.SO587': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ORCAMENTO_LANCA', opcoesGrupo: [587] },
  },
  /**
   * M59-F5: dois do escritório da qualidade (responsável de conformidade: conduz os ciclos; o segundo verifica a
   * correção registrada pelo primeiro) e o operador de backup.
   */
  'SINT.SBIS.CONFORMIDADE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [0, 4] },
    perfisConcedidos: ['gestao-qualidade'],
  },
  'SINT.SBIS.CONFORMIDADE2': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [0, 4] },
    perfisConcedidos: ['gestao-qualidade'],
  },
  'SINT.SBIS.BACKUP': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [0, 4] },
    perfisConcedidos: ['operador-backup'],
  },
  /**
   * M54.5 (no fim do mapa: o ID sintético é a posição): o controller de custos pelas opções de Gestão de custos que
   * apuram (Gerar lançamentos 304, Rateios 316, Calcular itens de produção 319), aprovam (Manutenção 302), exportam
   * (Utilitários 341) e consultam o resultado (Comparativo faturamento 323, Custo por procedimento 324), além das
   * Tabelas (295, 298) e da consulta do centro de custo (321).
   */
  'SINT.CUSTOS.CONTROLLER': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'CUSTOS_CONTROLLER',
      opcoesGrupo: [295, 298, 302, 304, 316, 319, 321, 323, 324, 341],
    },
  },
  /**
   * M54.6 (no fim do mapa: o ID sintético é a posição): o responsável pelo patrimônio pelas opções de Gestão
   * patrimonial (Bens 266, Movimentação 268 com Cálculo de Depreciação 269, Transferência 270, Baixa 271, Manutenção 272
   * a 274, Relatórios 276 a 289); o gestor de setor que recebe a transferência (Movimentação 268: aceita ou recusa, não
   * cadastra); e quem só consulta os bens (Ficha de Bens 287).
   */
  'SINT.PATRIMONIO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'PATRIMONIO',
      opcoesGrupo: [
        266, 268, 269, 270, 271, 272, 273, 274, 276, 277, 278, 279, 280, 281, 282, 283, 284, 287, 288, 289,
      ],
    },
  },
  'SINT.PATRIMONIO.SETOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'PATRIMONIO_SETOR', opcoesGrupo: [268] },
    // D-ACEITE-546: o gestor do centro cirúrgico (o centro 102 dos dados sintéticos) recebe por esse setor.
    escopos: { centrosCusto: ['102'] },
  },
  'SINT.PATRIMONIO.CONSULTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'PATRIMONIO_CONSULTA', opcoesGrupo: [287] },
  },
  /** D-ACEITE-546: o gestor de OUTRO setor (o laboratório, 103): não aceita nem recusa o que vai para o 102. */
  'SINT.PATRIMONIO.OUTRO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'PATRIMONIO_SETOR', opcoesGrupo: [268] },
    escopos: { centrosCusto: ['103'] },
  },
  /**
   * M55.1 (no fim do mapa: o ID sintético é a posição): a chefia da manutenção e engenharia clínica pelas opções de
   * Manutenção de Bens do patrimônio (272, com Saída 273 e Retorno 274) e o Relatório de Manutenção (285): atende,
   * encerra, cadastra equipamentos e planeja; o técnico só com a Saída (273): assume e dá andamento; e a enfermeira do
   * centro cirúrgico (centro 102), sem opção da manutenção: só abre e acompanha as OS do seu setor.
   */
  'SINT.MANUTENCAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'MANUTENCAO', opcoesGrupo: [272, 273, 274, 285] },
  },
  'SINT.MANUTENCAO.TECNICO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'MANUTENCAO_TECNICO', opcoesGrupo: [273] },
  },
  'SINT.MANUTENCAO.SETOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'MANUTENCAO_SETOR', opcoesGrupo: [] },
    escopos: { centrosCusto: ['102'] },
  },
  /**
   * Revisão da D-PROF-39: gestor de acessos (papel SBIS 0) que também consulta o corpo clínico (Profissionais 3984,
   * Gerenciamento 6390): liga, troca e desliga o login do profissional (o vínculo é a identidade clínica e exige a
   * gestão de acessos). Não edita o cadastro (sem 6391): a ficha mostra os dados só para consulta.
   */
  'SINT.VINCULOS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [0, 4], opcoesPapel: [5429, 5433, 5437, 3984, 6390] },
  },
  /**
   * Revisão da D-PROF-39: cadastro do corpo clínico sem a opção Excluir (6393): inclui e altera o profissional
   * (6392, 6391), mas não inativa, reativa nem exclui (nem o profissional, nem um registro dele).
   */
  'SINT.CORPOCLINICO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { papeis: [4], opcoesPapel: [3984, 6390, 6391, 6392] },
  },
  /**
   * F3.8, 07-FIN linha 63 (no fim do mapa: o ID sintético é a posição): quem gere o contas a pagar e prorroga o
   * vencimento. A permissão de prorrogar não vem de opção de menu: é dada por perfil (administrador do sistema).
   */
  'SINT.FIN.GESTOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FINGESTOR',
      // F3.8, 07-FIN linha 108: abre a escrituração das entradas (classificar e gerar a EFD vêm do perfil).
      // F8, 07-FIN linha 79 (C1-069): cadastra o portador do desconto e da cessão (parâmetro financeiro) e confere na
      // ficha do título a receber com quem cada parcela está (leitura do título). C2-031/C2-045: a cobrança bancária e
      // Pix vem do perfil (administrador do sistema); processar o retorno e pagar no simulador baixam a parcela.
      opcoesGrupo: opcoesFinanceiro(
        'financeiro.tituloPagar.ler',
        'financeiro.tituloPagar.criar',
        'financeiro.tituloReceber.ler',
        'financeiro.tituloReceber.baixar',
        'financeiro.escrituracao.ler',
        'financeiro.parametro.editar',
      ),
    },
    perfisConcedidos: ['administrador-sistema'],
  },
  /**
   * F3.8, 07-FIN linha 67 (no fim da lista, pelo ID sintético das outras): quem só pede adiantamento, sem nenhuma
   * permissão do título a pagar. A busca do credor tem de abrir para esta pessoa.
   */
  'SINT.FIN.ADIANTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FINADIANTA',
      opcoesGrupo: opcoesFinanceiro('financeiro.adiantamento.ler', 'financeiro.adiantamento.conceder'),
    },
  },
  /**
   * C1-009 (04-HOT L128, no fim da lista, pelo ID sintético das outras): responsável do arquivo que decide os pedidos
   * de prontuário cujo motivo exige autorização (perfil `diretoria-clinica`), com o controle de prontuários do SAME.
   */
  'SINT.ARQUIVO.RESP': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'ARQUIVO_SAME',
      opcoesGrupo: [2361, 2362, 2363, 2364, 4569, 2365, 2366, 2367, 2368, 2468, 2488],
    },
    perfisConcedidos: ['diretoria-clinica'],
  },
  /**
   * C1-026 (07-FIN linha 66, no fim da lista, pelo ID sintético das outras): o cadastro de credores do financeiro, que
   * mantém os dados bancários e a chave Pix do credor (perfil `cadastro-credor`) e consulta os títulos, sem gerar
   * remessa nem pagar (segregação de funções: o SINT.FIN.PAGA gera a remessa e não mantém a conta do credor).
   */
  'SINT.FIN.CREDOR': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FINCREDOR',
      opcoesGrupo: opcoesFinanceiro('financeiro.tituloPagar.ler'),
    },
    perfisConcedidos: ['cadastro-credor'],
  },
  /**
   * C1-040 (06-FAT linha 9, no fim da lista, pelo ID sintético das outras): faturista do de-para, que consulta convênios,
   * contratos, tabelas e o de-para e mantém o de-para da fonte pagadora (perfil `faturamento-de-para`), sem editar o
   * contrato do convênio (segregação de funções).
   */
  'SINT.FAT.DEPARA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'FATDEPARA',
      opcoesGrupo: opcoesDasPermissoes(
        'convenio.operadora.ler',
        'convenio.contrato.ler',
        'preco.tabela.ler',
        'preco.dePara.ler',
      ),
    },
    perfisConcedidos: ['faturamento-de-para'],
  },
  /**
   * C1-092 (05-SADT linha 14, no fim da lista, pelo ID sintético das outras): técnico do laboratório de apoio, sem
   * nenhuma opção do menu de origem: lê o apoio, monta, fecha e envia a remessa, imprime as etiquetas e mantém o
   * de-para só pelo perfil `laboratorio-apoio`; não confere o resultado que volta (privativo do responsável técnico).
   */
  'SINT.LAB.APOIO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'LABAPOIO', opcoesGrupo: [] },
    perfisConcedidos: ['laboratorio-apoio'],
  },
  /**
   * C1-122 (06-FAT linha 24, no fim da lista, pelo ID sintético das outras): faturista das guias do convênio no
   * hospital: consulta as guias (faturamento.guia.ler) e as acompanha (faturamento.pendencia.editar: assumir,
   * resposta da operadora, pendências e anexos). Quem só consulta é o SINT.TISS.
   */
  'SINT.GUIAS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'GUIAS',
      opcoesGrupo: [
        ...new Set([
          ...opcoesTiss('faturamento.guia.ler'),
          ...opcoesFaturamento('faturamento.conta.ler', 'faturamento.pendencia.editar'),
        ]),
      ].sort((x, y) => x - y),
    },
  },
  /**
   * C2-001 (F3.4, 04-CC linha 95; no fim da lista para não mudar o ID sintético das outras contas): o usuário do bloco
   * (as mesmas opções do SINT.BLOCO, registro de cirurgia) que também lança na conta (faturamento.item.lancar), para o
   * E2E que leva a equipe realizada do ato ao item da conta.
   */
  'SINT.BLOCO.CONTA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'BLOCO_CONTA',
      opcoesGrupo: [
        ...new Set([
          3254,
          6027,
          2227,
          2229,
          2230,
          2233,
          4506,
          2236,
          2237,
          2238,
          2263,
          2264,
          2265,
          2266,
          2283,
          2285,
          2293,
          ...opcoesDasPermissoes('faturamento.item.lancar'),
        ]),
      ].sort((x, y) => x - y),
    },
  },
  /**
   * C1-112 (F8, 09-AREA linha 74; no fim da lista para não mudar o ID sintético das outras contas): o médico da
   * internação (com conselho) que acompanha o destino do corpo após o óbito: consulta a internação (2342, 6059), dá a
   * saída (6070, internacao.alta.registrar: guarda e liberação do corpo) e registra a declaração de óbito (6764,
   * pep.declaracaoObito.emitir: funerária e cartório da declaração). Nenhuma conta tinha as três juntas.
   */
  'SINT.OBITO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'MEDICOS_INTERNACAO', opcoesGrupo: [2342, 6059, 6070, 6764], conselho: true },
  },
  /**
   * C2-055 (F7, 04-CME linha 115; no fim da lista para não mudar o ID sintético das outras contas): a enfermeira da
   * central de material esterilizado, com conselho e o perfil complementar `central-material-esteril` concedido
   * nominalmente: consulta e opera a CME (cirurgia.cme.ler e cirurgia.cme.operar, permissões clínicas por perfil que a
   * segregação de funções tira do administrador sem perfil assistencial). Nenhuma conta tinha o perfil da CME.
   */
  'SINT.CME': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'ENFERMAGEM', opcoesGrupo: [2582], conselho: true },
    perfisConcedidos: ['central-material-esteril'],
  },
  /**
   * C3-020 (F8, 03-PEP L144; no fim da lista para não mudar o ID sintético das outras contas): o médico da equipe do
   * centro de pesquisa clínica, com conselho e o perfil complementar `pesquisa-clinica` concedido nominalmente:
   * consulta, cadastra e tria os estudos (pep.pesquisa.ler, gerir e triar, permissões clínicas por perfil que a
   * segregação de funções tira do administrador sem perfil assistencial). Nenhuma conta tinha o perfil da pesquisa.
   */
  'SINT.PESQUISA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: { grupo: 'MEDICOS', opcoesGrupo: [], conselho: true },
    perfisConcedidos: ['pesquisa-clinica'],
  },
  /**
   * C3-012 (F7, 02-REC L37; no fim da lista para não mudar o ID sintético das outras contas): a supervisão da
   * recepção, que consulta o contrato do convênio e abre atendimento. É quem confere na prévia das regras do plano
   * (tela de regras do plano) se uma abertura passaria (especialidade, serviço, setor e senha). Nenhuma conta tinha
   * as duas permissões: o faturamento edita o contrato sem abrir atendimento e o guichê abre sem ler o contrato.
   */
  'SINT.RECEPCAO.SUPERVISAO': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'RECEPSUP',
      opcoesGrupo: opcoesDasPermissoes('convenio.contrato.ler', 'atendimento.atendimento.abrir'),
    },
  },
  /**
   * C2-036 (03-PEP L131; no fim da lista para não mudar o ID sintético das outras contas): o balcão do serviço de
   * arquivo que atende o pedido de cópia do prontuário (lê o prontuário e registra pedido, decisão e entrega). Nenhuma
   * conta tinha as duas permissões; o administrador não tem permissão clínica.
   */
  'SINT.SAME.COPIA': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'SAME_COPIA',
      opcoesGrupo: opcoesDasPermissoes('pep.prontuario.ler', 'pep.prontuario.exportar'),
    },
  },
  /**
   * C2-064 (03-PEP L94; no fim da lista): o coordenador assistencial com conselho que monta a equipe do atendimento
   * pelo painel, aplica a equipe padrão do setor e salva a equipe atual como padrão (administração do PEP). O
   * administrador não tem o painel clínico, e o médico assistente não mexe no padrão do setor.
   */
  'SINT.COORD.EQUIPE': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'COORD_EQUIPE',
      opcoesGrupo: opcoesDasPermissoes('pep.painel.ler', 'pep.admin.editar'),
      conselho: true,
    },
  },
  /**
   * C1-019 (02-REC L30/L35; no fim da lista): a supervisão das fichas da recepção, que vê os atendimentos do dia e
   * mantém os modelos de ficha e as regras de impressão (atalho da tela do dia). Nenhuma conta tinha as duas
   * permissões: o administrador configura sem ler o atendimento (segregação) e o guichê lê sem configurar.
   */
  'SINT.RECEPCAO.FICHAS': {
    senha: SENHA_SINTETICA,
    criptografada: true,
    ativo: true,
    bloqueado: false,
    senhaAlteradaEm: new Date(),
    concessoes: {
      grupo: 'RECEPFICHAS',
      opcoesGrupo: opcoesDasPermissoes('atendimento.atendimento.ler', 'documento.cadastro.editar'),
    },
  },
};

/** M59.2: as contas sintéticas que a identidade em memória (credencial forte e segundo fator) conhece. */
export const CONTAS_IDENTIDADE_SINTETICAS = ['SINT.IDENT', 'SINT.IDENT.CRITICO'] as const;

const CODIGO = /^[a-z][a-z0-9]{1,9}$/;

const idSintetico = (login: string) => 900000 + Object.keys(CONTAS_SINTETICAS).indexOf(login);
/** M52.1: o ID sintético do usuário (a posição na lista), para as pessoas sintéticas da gestão de pessoas. */
export const idUsuarioSintetico = idSintetico;

let estado: EstadoAcessoSintetico | null = null;

/**
 * ADR 0022: o estado sintético do acesso (grupos, opções, papéis, perfis e mapa), um por processo, semeado das
 * contas sintéticas: a tela "Perfis e permissões" em memória grava nele e a fonte sintética lê dele.
 */
export function estadoAcessoSintetico(): EstadoAcessoSintetico {
  return (estado ??= new EstadoAcessoSintetico(
    Object.entries(CONTAS_SINTETICAS).map(([login, c]) => ({
      login,
      id: idSintetico(login),
      concessoes: c.concessoes ?? {},
      perfis: c.perfisConcedidos ?? [],
    })),
    new Set(CATALOGO_COMPLETO.flatMap((p) => opcoesDasPermissoes(p.codigo))),
  ));
}

/** Testes: volta ao estado semeado. */
export function reiniciarEstadoAcessoSintetico(): void {
  estado = null;
}

/** Grupo das contas sintéticas sem grupo do legado (no "login como"). */
export const GRUPO_SINTETICO_SEM_GRUPO = 'SINTETICO';

/** Política sintética (mesma forma da configuração de login). */
export const CONFIG_SINTETICA: ConfigLogin = {
  senha: {
    minimoCaracteres: 8,
    exigeLetra: true,
    exigeNumero: true,
    exigeEspecial: false,
    exigeMinuscula: false,
    exigeMaiuscula: false,
    periodoTrocaDias: 180,
    periodoReutilizacaoDias: 90,
  },
  tempo: { inatividadeSegundos: 1800, avisoSegundos: null },
  limiteTentativas: 10,
  termoPeriodico: false,
  quantidadePeriodoTermo: null,
  tipoPeriodoTermo: null,
};

function saudeSintetica(codigo: string, nome: string, disponivel: boolean): SaudeEstabelecimento {
  return {
    codigo,
    nomeConfigurado: nome,
    disponivel,
    motivo: disponivel ? null : 'sem conexão (estabelecimento sintético fora do ar)',
    conectado: disponivel,
  };
}

export class FonteAcessoSintetica implements FonteAcesso {
  readonly rede: string;
  readonly estabelecimentos: readonly { readonly codigo: string }[];
  private readonly lista: SaudeEstabelecimento[];

  constructor(env: Ambiente) {
    this.rede = lerRedePadrao(env) ?? 'rede-sintetica';
    const ests = lerEstabelecimentosSinteticos(env);
    this.estabelecimentos = ests.map((e) => ({ codigo: e.codigo }));
    this.lista = ests.map((e) => saudeSintetica(e.codigo, e.nome, true));
    const fora = env['ACESSO_SINTETICO_INDISPONIVEL']?.trim();
    if (fora) {
      const i = fora.indexOf(':');
      const codigo = (i === -1 ? fora : fora.slice(0, i)).trim();
      const nome = (i === -1 ? '' : fora.slice(i + 1)).trim() || `Estabelecimento sintético ${codigo}`;
      if (!CODIGO.test(codigo)) throw new Error('ACESSO_SINTETICO_INDISPONIVEL: código inválido.');
      if (!this.lista.some((s) => s.codigo === codigo)) this.lista.push(saudeSintetica(codigo, nome, false));
    }
  }

  saude(): SaudeEstabelecimento[] {
    return this.lista;
  }

  autenticar(codigo: string, login: string, senha: string): Promise<Autenticacao> {
    const conta = CONTAS_SINTETICAS[login];
    const existe = this.lista.some((e) => e.codigo === codigo && e.disponivel);
    if (existe && !conta) return this.autenticarContaCriada(login, senha);
    if (!existe || !conta) return Promise.resolve({ desfecho: 'credencial-invalida' });
    const semCifra = !conta.criptografada && conta.senha === null;
    // M10: o bloqueio pela tela de usuários (em memória) vale no login.
    const bloqueado = estadoAcessoSintetico().bloqueio.get(login) ?? conta.bloqueado;
    const base: ContaAcesso = {
      login,
      id: idSintetico(login),
      nomeExibicao: 'Usuário sintético (desenvolvimento)',
      ativo: conta.ativo,
      bloqueado,
      senhaAlteradaEm: conta.senhaAlteradaEm,
      semCifra,
      // Banco próprio: a senha só é guardada em argon2id e não há estado "sem cifra". A conta sintética com senha
      // em texto puro faz o papel da credencial com troca obrigatória (troca_obrigatoria=1): confere e vai à troca.
      trocaObrigatoria: !conta.criptografada,
    };
    if (!conta.ativo || bloqueado) return Promise.resolve({ desfecho: 'conta-impedida', conta: base });
    if (semCifra) return Promise.resolve({ desfecho: 'sem-cifra', conta: base });
    if (senha !== conta.senha) return Promise.resolve({ desfecho: 'credencial-invalida' });
    return Promise.resolve({ desfecho: 'ok', conta: base });
  }

  /**
   * 01-ADM L57: a conta criada pela tela de usuários em memória entra com a senha inicial (resumo argon2id gravado na
   * criação) e vai à troca obrigatória, como a credencial de troca obrigatória da receita no banco próprio.
   */
  private async autenticarContaCriada(login: string, senha: string): Promise<Autenticacao> {
    const e = estadoAcessoSintetico();
    const resumo = e.credenciaisIniciais.get(login);
    const id = e.contas.get(login)?.id;
    if (!resumo || id === undefined) return { desfecho: 'credencial-invalida' };
    const bloqueado = e.bloqueio.get(login) ?? false;
    const base: ContaAcesso = {
      login,
      id,
      nomeExibicao: 'Usuário sintético (desenvolvimento)',
      ativo: true,
      bloqueado,
      senhaAlteradaEm: null,
      semCifra: false,
      trocaObrigatoria: true,
    };
    if (bloqueado) return { desfecho: 'conta-impedida', conta: base };
    if (!(await conferirSenha(senha, resumo))) return { desfecho: 'credencial-invalida' };
    return { desfecho: 'ok', conta: base };
  }

  /**
   * M06: concessões, escopos (sem restrição) e vínculo sintéticos; nada lido do banco. ADR 0022: as concessões,
   * os perfis concedidos e o mapa vêm do estado sintético (o que a tela "Perfis e permissões" grava em memória).
   */
  dadosDeAutorizacao(_codigo: string, login: string): Promise<DadosAutorizacaoLegado> {
    const e = estadoAcessoSintetico();
    const c = e.concessoesDe(login) ?? {
      ...CONCESSOES_VAZIAS,
      ...(CONTAS_SINTETICAS[login]?.concessoes ?? {}),
    };
    return Promise.resolve({
      concessoes: c,
      escopos: { ...ESCOPOS_SEM_RESTRICAO, ...(CONTAS_SINTETICAS[login]?.escopos ?? {}) },
      restricaoVinculo: false,
      perfisConcedidos: e.perfisConcedidos(login),
      mapaPerfis: e.mapaPerfis(),
      perfisDoGrupo: e.perfisDoGrupo(c.grupo),
      // W1-01 (parte 11d): a conferência do conselho gravada pela ficha (memória).
      ...(c.conselho ? { registrosConselho: e.registrosConselhoConferidos(login) } : {}),
    });
  }

  configLogin(): Promise<ConfigLogin> {
    // W1-01 (parte 5): com a versão vigente da política do Sante publicada pela tela (estado sintético).
    return Promise.resolve({
      ...CONFIG_SINTETICA,
      sante: estadoAcessoSintetico().politicaSenhaVigente(new Date()),
      // W1-01 (parte 8): limites de sessões por perfil definidos pela tela.
      limitesSessao: estadoAcessoSintetico().limitesSessaoVigentes(),
    });
  }

  /** ADR 0021: a conta-alvo sintética do "login como" (sem senha). */
  contaAlvo(codigo: string, login: string): Promise<ContaAlvo | null> {
    const conta = CONTAS_SINTETICAS[login];
    if (!conta || !this.lista.some((e) => e.codigo === codigo && e.disponivel)) return Promise.resolve(null);
    return Promise.resolve({
      login,
      id: 900000 + Object.keys(CONTAS_SINTETICAS).indexOf(login),
      nomeExibicao: 'Usuário sintético (desenvolvimento)',
      ativo: conta.ativo,
      bloqueado: conta.bloqueado,
      grupo: estadoAcessoSintetico().contas.get(login)?.grupo ?? GRUPO_SINTETICO_SEM_GRUPO,
      // Todo grupo sintético está ativo (é a lista do modal), salvo o desativado pela tela (ADR 0022).
      grupoAtivo:
        estadoAcessoSintetico().grupos.get(estadoAcessoSintetico().contas.get(login)?.grupo ?? '') ?? true,
    });
  }

  /** ADR 0021: grupos sintéticos (o grupo do legado de cada conta) com os logins não bloqueados. */
  gruposAlvo(): Promise<GrupoAlvo[]> {
    const n = new Map<string, number>();
    for (const [login, c] of Object.entries(CONTAS_SINTETICAS)) {
      if (!c.ativo || c.bloqueado) continue;
      const g = estadoAcessoSintetico().contas.get(login)?.grupo ?? GRUPO_SINTETICO_SEM_GRUPO;
      n.set(g, (n.get(g) ?? 0) + (login ? 1 : 0));
    }
    return Promise.resolve(
      [...n].map(([grupo, usuarios]) => ({ grupo, usuarios })).sort((a, b) => a.grupo.localeCompare(b.grupo)),
    );
  }

  usuariosAlvo(_codigo: string, grupo: string): Promise<UsuarioAlvo[]> {
    return Promise.resolve(
      Object.entries(CONTAS_SINTETICAS)
        .filter(
          ([login, c]) =>
            c.ativo &&
            !c.bloqueado &&
            (estadoAcessoSintetico().contas.get(login)?.grupo ?? GRUPO_SINTETICO_SEM_GRUPO) === grupo,
        )
        .map(([login]) => ({ login, nome: 'Usuário sintético (desenvolvimento)' }))
        .sort((a, b) => a.login.localeCompare(b.login)),
    );
  }

  dadosDeSessao(_codigo: string, login: string, config?: ConfigLogin): Promise<DadosSessao> {
    const conta = CONTAS_SINTETICAS[login];
    const aceito = aceitouTermoSintetico(login);
    return Promise.resolve({
      papeis: [{ codigo: 4, nome: 'Operador de sistema' }],
      unidades: conta?.unidades ?? [{ codigo: 1, nome: 'Unidade sintética' }],
      termo: {
        vigente: true,
        aceitoEm: aceito ? new Date(Date.UTC(2026, 0, 2)) : null,
        periodico: false,
        quantidadePeriodo: null,
        tipoPeriodo: null,
      },
      config: config ?? CONFIG_SINTETICA,
    });
  }
}

/** M10 e W1-01 (parte 6b): o login aceitou a versão vigente do termo (sintético; a versão nova exige novo aceite). */
export function aceitouTermoSintetico(login: string): boolean {
  const e = estadoAcessoSintetico();
  return (
    (!e.termoRepublicado && (CONTAS_SINTETICAS[login]?.termoAceito ?? true)) || e.aceitesTermo.has(login)
  );
}
