// Permissões do M45, etapa 5 (ficha, seção 7; convencoes.md §12): a nutrição clínica (fila de pacientes a triar e a
// triagem NRS-2002 ou NUTRIC; a terapia nutricional da EMTN), o serviço de nutrição e dietética (mapa de dietas por
// unidade e refeição, etiqueta de bandeja, refeição do acompanhante) e o serviço social. Quem tem a opção no sistema
// anterior tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - o grupo NUTRICÃO (5 usuários ativos) registra no prontuário pelas opções da evolução (3915 e o Salvar 4581) e lê
//     os internados pelo relatório Recepção interna › Relatórios › Pacientes internados (2382), que a HOTELARIA (a copa)
//     também tem; o "Gerenciamento de dietas" (6355 a 6360) e as tabelas de dietas (3677) só estão com o MASTER. A fila
//     da triagem (nome e risco nutricional) é de quem lê o prontuário (as opções da consulta da evolução); o relatório de
//     internados abre só o mapa de dietas, que a copa precisa;
//   - a triagem e a terapia nutricional são atos clínicos de quem registra no prontuário (as opções da evolução), com a
//     categoria conferida na hora pelo CBO do vínculo da sessão: a triagem, a nutricionista (CBO 2237); a terapia, a
//     EMTN (médico, nutricionista, enfermeiro e farmacêutico; perfil composto da cap-05b §5.9);
//   - o serviço social não tem grupo nem opção própria no sistema anterior (a especialidade "Assistente social" existe
//     sem modelo nem registro, cap-05b §5.9): a avaliação social é de quem registra no prontuário, com a categoria de
//     assistente social (CBO 2516) conferida na hora; o parecer é dado sensível (LGPD), lido só pela categoria, e as
//     demais categorias com vínculo veem o resumo (risco, barreiras e orientações à equipe);
//   - o mapa de dietas é lido por quem lê os internados e as dietas; fechar e imprimir é da copa (Higienização ›
//     Lançamentos 5011, a opção de operação da hotelaria) e do gerenciamento de dietas (6355, 6357, 6360). O Salvar da
//     evolução (4581) NÃO entra (correção da revisão do M45.5): ele está com médicos, fisioterapia, enfermagem e a
//     nutrição, e o retrato fechado é irreversível;
//   - a refeição do acompanhante é registrada por quem cuida das alterações da internação (6075, 6076) e pela copa
//     (as mesmas opções do fechamento).
// Sem escopo próprio. Conferir com a nutrição, a copa e o serviço social na validação (DP-3).
import { OPCOES_FARMACIA } from './farmacia.js';
import { OPCOES_INTERNACAO as O } from './internacao-adt.js';
import {
  OPCOES_PEP_DIETA_LER,
  OPCOES_PEP_EVOLUCAO_CRIAR,
  OPCOES_PEP_EVOLUCAO_LER,
  OPCOES_PRESCRICAO_LER,
} from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_NUTRICAO_CODIGOS = {
  nutricaoLer: 'pep.nutricao.ler',
  nutricaoTriar: 'pep.nutricao.triar',
  terapiaLer: 'pep.terapiaNutricional.ler',
  terapiaAcompanhar: 'pep.terapiaNutricional.acompanhar',
  terapiaAvaliarNpt: 'pep.terapiaNutricional.avaliarNpt',
  mapaLer: 'hotelaria.mapaDieta.ler',
  mapaFechar: 'hotelaria.mapaDieta.fechar',
  mapaImprimir: 'hotelaria.mapaDieta.imprimir',
  acompanhanteRegistrar: 'hotelaria.dietaAcompanhante.registrar',
  socialLer: 'pep.social.ler',
  socialRegistrar: 'pep.social.registrar',
} as const;

const C = PERMISSOES_NUTRICAO_CODIGOS;

/** Relatório "Pacientes internados" da recepção interna (nutrição, copa e a maioria dos setores assistenciais). */
export const OPCAO_RELATORIO_INTERNADOS = 2382;
/** Localização de pacientes (copa e recepção da internação). */
export const OPCAO_LOCALIZACAO_PACIENTES = 2420;
/** Higienização › Lançamentos: a operação da hotelaria (copa). */
export const OPCAO_HOTELARIA_LANCAMENTOS = 5011;
/** Gerenciamento de dietas (consultar 6359, incluir 6357, imprimir 6360; raiz 6355). */
export const OPCOES_GERENCIAMENTO_DIETAS = {
  raiz: 6355,
  incluir: 6357,
  consultar: 6359,
  imprimir: 6360,
} as const;
/** O Salvar da evolução que a nutrição tem (4581). */
export const OPCAO_EVOLUCAO_SALVAR_NUTRICAO = 4581;

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado: [...new Set(opcoesLegado)],
  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
  ...extra,
});

const OPERAR_COPA = [
  OPCAO_HOTELARIA_LANCAMENTOS,
  OPCOES_GERENCIAMENTO_DIETAS.raiz,
  OPCOES_GERENCIAMENTO_DIETAS.incluir,
];

export const PERMISSOES_NUTRICAO_M45: readonly DeclaracaoPermissao[] = [
  p(
    C.nutricaoLer,
    'Ver a fila da nutrição: os internados a triar (prazo de 48 h, de preferência 24 h), as triagens e as reavaliações (lista com nomes)',
    [...OPCOES_PEP_EVOLUCAO_LER],
  ),
  p(
    C.nutricaoTriar,
    'Registrar a triagem nutricional (NRS-2002 ou NUTRIC na terapia intensiva): nutricionista com o conselho ativo',
    [...OPCOES_PEP_EVOLUCAO_CRIAR],
    { exigeConselho: true },
  ),
  p(
    C.terapiaLer,
    'Ver a terapia nutricional enteral e parenteral do paciente: a meta, o volume prescrito e infundido e o percentual atingido',
    [...OPCOES_PEP_EVOLUCAO_LER, ...OPCOES_PRESCRICAO_LER],
  ),
  p(
    C.terapiaAcompanhar,
    'Registrar a meta e o acompanhamento diário da terapia nutricional (EMTN: médico, nutricionista, enfermeiro e farmacêutico)',
    [...OPCOES_PEP_EVOLUCAO_CRIAR],
    { exigeConselho: true },
  ),
  p(
    C.terapiaAvaliarNpt,
    'Registrar a avaliação farmacêutica da formulação de nutrição parenteral (adequação, osmolaridade e acesso, estabilidade e compatibilidade): farmacêutico com o conselho ativo',
    // Quem avalia a prescrição na farmácia (6752) avalia a NPT (W0-05; Portaria SVS/MS 272/1998, anexo II).
    [OPCOES_FARMACIA.avaliarPrescricao, ...OPCOES_PEP_EVOLUCAO_CRIAR],
    { exigeConselho: true },
  ),
  p(
    C.mapaLer,
    'Ver o mapa de dietas por unidade e refeição (dieta, características, jejum, alergias alimentares e acompanhante; lista com nomes)',
    [
      OPCAO_RELATORIO_INTERNADOS,
      OPCAO_LOCALIZACAO_PACIENTES,
      OPCOES_GERENCIAMENTO_DIETAS.consultar,
      ...OPCOES_PEP_DIETA_LER,
    ],
    { categoria: 'administrativa' },
  ),
  p(
    C.mapaFechar,
    'Fechar o mapa da refeição no horário de corte (o retrato que a copa produz e entrega; nunca regravado)',
    OPERAR_COPA,
    { categoria: 'administrativa', criticidade: 'normal' },
  ),
  p(
    C.mapaImprimir,
    'Imprimir o mapa e as etiquetas de bandeja (dois identificadores, leito, dieta e restrições, em ZPL)',
    [...OPERAR_COPA, OPCOES_GERENCIAMENTO_DIETAS.imprimir],
    { categoria: 'administrativa' },
  ),
  p(
    C.acompanhanteRegistrar,
    'Registrar ou encerrar a refeição do acompanhante com direito legal (idoso, criança ou adolescente, parturiente, pessoa com deficiência)',
    [...OPERAR_COPA, O.alteracaoIncluir, O.alteracaoAlterar],
    { categoria: 'administrativa', criticidade: 'normal' },
  ),
  p(
    C.socialLer,
    'Ver o serviço social do paciente: o parecer só para a categoria (assistente social); as demais com vínculo veem o risco, as barreiras e as orientações',
    [...OPCOES_PEP_EVOLUCAO_LER],
  ),
  p(
    C.socialRegistrar,
    'Registrar a avaliação social (rede de apoio, vulnerabilidades, encaminhamentos e a barreira social de alta no NIR): assistente social',
    [...OPCOES_PEP_EVOLUCAO_CRIAR],
    { exigeConselho: true },
  ),
];
