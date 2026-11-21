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
/** O Salvar da evolução que a nutrição tem (4581). */
export const OPCAO_EVOLUCAO_SALVAR_NUTRICAO = 4581;

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
  ...extra,
});

export const PERMISSOES_NUTRICAO_M45: readonly DeclaracaoPermissao[] = [
  p(
    C.nutricaoLer,
    'Ver a fila da nutrição: os internados a triar (prazo de 48 h, de preferência 24 h), as triagens e as reavaliações (lista com nomes)',
  ),
  p(
    C.nutricaoTriar,
    'Registrar a triagem nutricional (NRS-2002 ou NUTRIC na terapia intensiva): nutricionista com o conselho ativo',

    { exigeConselho: true },
  ),
  p(
    C.terapiaLer,
    'Ver a terapia nutricional enteral e parenteral do paciente: a meta, o volume prescrito e infundido e o percentual atingido',
  ),
  p(
    C.terapiaAcompanhar,
    'Registrar a meta e o acompanhamento diário da terapia nutricional (EMTN: médico, nutricionista, enfermeiro e farmacêutico)',

    { exigeConselho: true },
  ),
  p(
    C.terapiaAvaliarNpt,
    'Registrar a avaliação farmacêutica da formulação de nutrição parenteral (adequação, osmolaridade e acesso, estabilidade e compatibilidade): farmacêutico com o conselho ativo',
    // Quem avalia a prescrição na farmácia (6752) avalia a NPT (W0-05; Portaria SVS/MS 272/1998, anexo II).

    { exigeConselho: true },
  ),
  p(
    C.mapaLer,
    'Ver o mapa de dietas por unidade e refeição (dieta, características, jejum, alergias alimentares e acompanhante; lista com nomes)',

    { categoria: 'administrativa' },
  ),
  p(
    C.mapaFechar,
    'Fechar o mapa da refeição no horário de corte (o retrato que a copa produz e entrega; nunca regravado)',

    { categoria: 'administrativa', criticidade: 'normal' },
  ),
  p(
    C.mapaImprimir,
    'Imprimir o mapa e as etiquetas de bandeja (dois identificadores, leito, dieta e restrições, em ZPL)',

    { categoria: 'administrativa' },
  ),
  p(
    C.acompanhanteRegistrar,
    'Registrar ou encerrar a refeição do acompanhante com direito legal (idoso, criança ou adolescente, parturiente, pessoa com deficiência)',

    { categoria: 'administrativa', criticidade: 'normal' },
  ),
  p(
    C.socialLer,
    'Ver o serviço social do paciente: o parecer só para a categoria (assistente social); as demais com vínculo veem o risco, as barreiras e as orientações',
  ),
  p(
    C.socialRegistrar,
    'Registrar a avaliação social (rede de apoio, vulnerabilidades, encaminhamentos e a barreira social de alta no NIR): assistente social',

    { exigeConselho: true },
  ),
];
