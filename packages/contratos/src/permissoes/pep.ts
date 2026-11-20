// Permissões do M15 (ficha, seção 7; convencoes.md §12; cap-08 §8.12 e §8.13): prontuário ao vivo (consulta) e
// o registro de acesso ao prontuário. Quem tem a opção no legado tem a permissão no novo (regra 1 do M06): as
// opções do módulo do PEP (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json) que abrem o
// prontuário do paciente: Prontuário Eletrônico do paciente 2582, Localizar paciente 3900 e Selecionar paciente
// 5146, Histórico do paciente 2635/5544, a consulta dos registros (Evolução 5181, Anamnese 5163, Diagnóstico
// 5202, Evolução em grupo 5453, Registro cirúrgico 6814), Visualizar Prontuário Completo 6774/6775 e Consulta por
// termo 5864/5865 (a busca de palavra). O registro de acesso é do papel Auditor (perfil complementar; a opção
// Auditoria › Consultar 5353 do módulo do PEP também concede a leitura); exportar é só do perfil.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_PEP_PRONTUARIO = [
  2582, 3900, 5146, 2635, 5544, 5181, 5163, 5202, 5453, 6814, 6774, 6775, 5864, 5865,
] as const;
export const OPCAO_PEP_AUDITORIA = 5353;

export const PERMISSOES_PEP_M15: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'pep.prontuario.ler',
    descricao:
      'Abrir o prontuário do paciente ao vivo (registros, documento como emitido, respostas e contexto); toda leitura vai à trilha com o motivo',
    opcoesLegado: [...OPCOES_PEP_PRONTUARIO],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'auditoria.acessos.ler',
    descricao: 'Consultar o registro de acesso ao prontuário (quem leu, quando, o quê e por quê)',
    opcoesLegado: [OPCAO_PEP_AUDITORIA],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'auditoria.acessos.exportar',
    descricao: 'Exportar o registro de acesso ao prontuário (CSV, sem dado clínico)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
];

// M22 (ficha, seção 7): registros clínicos nos modelos do formulário de origem e a administração do PEP (consulta).
// Opções inferidas (POL-1b) do módulo do PEP pelo perfil da trilha do legado (TBCABTRILHA, 2026-06 a 2026-07):
// a gravação da evolução é registrada na opção 5182 "Confirmar" (2.161 dos 2.394 lançamentos de julho) e 5164 nas
// anamneses; "Salvar" 4580/4581 e "Novo(a)" 3921/3935 abrem o registro; a suspensão é a 3918 (346 de 498) e a 3913.
// A administração do PEP: Configurações 2643 › Parâmetros 2644 (Consultar 5921, Confirmar 5355) e o Cadastro de
// composições 2667 (Alterar 2668, Incluir 2669). Conferir na validação com a TI (DP-3).
export const OPCOES_PEP_EVOLUCAO_LER = [5181, 5163, 5202, 5453, 6814] as const;
export const OPCOES_PEP_EVOLUCAO_CRIAR = [5182, 5164, 4580, 4581, 3921, 3935] as const;
export const OPCOES_PEP_EVOLUCAO_SUSPENDER = [3918, 3913] as const;
export const OPCOES_PEP_ADMIN_LER = [2643, 2644, 5921, 2667] as const;
export const OPCOES_PEP_ADMIN_EDITAR = [5355, 2668, 2669] as const;

export const PERMISSOES_PEP_M22: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'pep.evolucao.ler',
    descricao:
      'Ver o registro clínico gravado (anamnese, evolução, escala) no formulário de origem; toda leitura vai à trilha',
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.evolucao.criar',
    descricao:
      'Registrar anamnese, evolução e escala nos modelos de formulário do estabelecimento, com rascunho e finalização',
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_CRIAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.evolucao.suspender',
    descricao:
      'Suspender um registro clínico com justificativa (o original continua visível, marcado suspenso)',
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_SUSPENDER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
  },
  {
    codigo: 'pep.admin.ler',
    descricao:
      'Consultar modelos de formulário, perguntas, versões do layout, relatório de conversão e modelos de impressão',
    opcoesLegado: [...OPCOES_PEP_ADMIN_LER],
    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.admin.editar',
    descricao: 'Editar os cadastros do PEP: tipos de documento, fluxos de situação e avisos',
    opcoesLegado: [...OPCOES_PEP_ADMIN_EDITAR],
    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
];

// M24 (ficha, seção 7): prescrição eletrônica (CPOE). Opções do módulo do PEP (TBOPCOES, retrato
// tools/verificadores/dados/acesso-legado.pc.json) da "Prescrição geral" 2601: Consultar 5456 e Consulta 5214
// (ler), Impressão 5222 e Imprimir 2615; Prescrever 5223, Nova 2602, Novo 4585, Salvar 5783, as abas de itens
// 2603 a 2609, Protocolo padrão 5785, Lançamento de item 5779 e Incluir itens 2611/4586/5216 (criar); Confirmar
// 5781, Assinar 5676 e Confirmar assinatura 5457 (assinar); Suspender prescrição confirmada 5219, Suspender
// prescrição 5218, Suspender 2613, Suspender item 5220/4587/3961 e Suspender horário 5221/4588/3960 (suspender);
// Manutenção 5658, Manter 2612, Editar 5215 e Alterar 2610 (renovar); Avaliar 5677 e Validar 5217 (coassinar, a
// do preceptor). A trilha do legado confirma as mais usadas (5223, 5219, 5658, 5456, 5222). Conferir na validação
// com a TI (DP-3). A reconciliação é recurso novo (SGH_ACESSO_MAPA_OPCAO): mapeada às opções de prescrever e
// consultar a prescrição (quem prescreve concilia). As regras de alerta e a ficha de antimicrobiano usam as
// opções de "Interação entre medicamentos" 2662 (e as do cadastro de interação do módulo Tabelas) e do "Pedido de
// antimicrobiano" 3925.
export const OPCOES_PRESCRICAO_LER = [2601, 5456, 5214, 5222, 2615, 5224] as const;
export const OPCOES_PRESCRICAO_CRIAR = [
  5223, 2602, 4585, 5783, 2603, 2604, 2605, 2606, 2607, 2608, 2609, 5785, 5779, 2611, 4586, 5216, 5225,
] as const;
export const OPCOES_PRESCRICAO_ASSINAR = [5781, 5676, 5457] as const;
export const OPCOES_PRESCRICAO_SUSPENDER = [5219, 5218, 2613, 5220, 4587, 3961, 5221, 4588, 3960] as const;
export const OPCOES_PRESCRICAO_RENOVAR = [5658, 2612, 5215, 2610] as const;
export const OPCOES_PRESCRICAO_COASSINAR = [5677, 5217] as const;
export const OPCOES_REGRA_ALERTA_LER = [2662, 5128, 4888, 6294, 6298, 6302, 6306, 6373, 4891] as const;
export const OPCOES_REGRA_ALERTA_EDITAR = [6295, 6296, 6297, 6299, 6300, 6301, 6303, 6304, 6305] as const;
export const OPCOES_ANTIMICROBIANO_LER = [3925, 5459, 2637, 5461, 5659] as const;
export const OPCOES_ANTIMICROBIANO_REGISTRAR = [4594, 4591, 4595, 5228, 4593] as const;
/** "Esquema de horários de prescrição" 6361 (Consultar 6365, Imprimir 6366; Alterar 6362, Incluir 6363, Excluir 6364). */
export const OPCOES_GRADE_HORARIO_LER = [6361, 6365, 6366] as const;
export const OPCOES_GRADE_HORARIO_EDITAR = [6362, 6363, 6364] as const;

/**
 * Telas de cadastro de prescrição (M24, ficha seção 7) que juntam mais de um cadastro: a consulta é de quem tem a
 * opção de qualquer um deles no legado (quem tem a opção tem a permissão). Kits de medicamentos 4671 (Consultar
 * 5947) e de soluções 4667 (Consultar 5946); frequências e horários relativos pela área "Tabelas" 3501 (inferida,
 * POL-1b) e as fórmulas 2646 (Consultar 5954).
 */
export const OPCOES_KIT_PRESCRICAO_LER = [4671, 5947, 4667, 5946] as const;
export const OPCOES_FREQUENCIA_DOSE_LER = [3501, 2646, 5954] as const;
/** As demais telas de cadastro de prescrição em consulta (para a guarda da rota; a tela confere a do cadastro). */
const OPCOES_CADASTROS_PRESCRICAO_LER = [
  ...OPCOES_KIT_PRESCRICAO_LER,
  ...OPCOES_FREQUENCIA_DOSE_LER,
  3368, // Protocolos prescrição geral
  2732, // Receitas padrão
  5924,
  3347, // Itens não padronizados
  5948,
  1643, // Itens (cadastro do item de estoque: parâmetros do item)
] as const;

export const PERMISSOES_PEP_M24: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'pep.kitPrescricao.ler',
    descricao: 'Consultar os kits de medicamentos e de soluções (com os materiais e os componentes)',
    opcoesLegado: [...OPCOES_KIT_PRESCRICAO_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.frequenciaDose.ler',
    descricao:
      'Consultar as frequências, os horários relativos e as fórmulas de dose, com a simulação dos horários',
    opcoesLegado: [...OPCOES_FREQUENCIA_DOSE_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.cadastroPrescricao.ler',
    descricao:
      'Ler os cadastros de prescrição (protocolos, kits, frequências, receitas padrão, não padronizados, parâmetros do item) pelas telas do cadastro e da prescrição; cada tela confere a permissão do próprio cadastro',
    opcoesLegado: [
      ...new Set<number>([
        ...OPCOES_CADASTROS_PRESCRICAO_LER,
        ...OPCOES_PRESCRICAO_LER,
        ...OPCOES_PRESCRICAO_CRIAR,
        ...OPCOES_GRADE_HORARIO_LER,
      ]),
    ],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.prescricao.ler',
    descricao:
      'Ver as prescrições do atendimento (itens, doses, horários previstos e situação); toda leitura vai à trilha',
    opcoesLegado: [...OPCOES_PRESCRICAO_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.prescricao.criar',
    descricao:
      'Montar a prescrição item a item (medicamentos, soluções, dietas, cuidados, oxigênio e hemoterapia), aplicar protocolo ou kit e incluir item depois de assinada',
    opcoesLegado: [...OPCOES_PRESCRICAO_CRIAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.prescricao.assinar',
    descricao: 'Assinar a prescrição com as verificações de apoio à decisão (alertas e justificativas)',
    opcoesLegado: [...OPCOES_PRESCRICAO_ASSINAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.prescricao.suspender',
    descricao:
      'Suspender a prescrição ou um item com justificativa (os horários futuros ficam suspensos; nada se apaga)',
    opcoesLegado: [...OPCOES_PRESCRICAO_SUSPENDER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
  },
  {
    codigo: 'pep.prescricao.renovar',
    descricao: 'Renovar a prescrição para o período seguinte ou copiar uma anterior, item a item confirmado',
    opcoesLegado: [...OPCOES_PRESCRICAO_RENOVAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.prescricao.coassinar',
    descricao: 'Coassinar como preceptor a prescrição do residente',
    opcoesLegado: [...OPCOES_PRESCRICAO_COASSINAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.reconciliacao.ler',
    descricao: 'Ver a reconciliação medicamentosa (medicamentos em uso antes da internação e as condutas)',
    opcoesLegado: [...OPCOES_PRESCRICAO_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.reconciliacao.registrar',
    descricao: 'Registrar a reconciliação medicamentosa na admissão e na alta',
    opcoesLegado: [...OPCOES_PRESCRICAO_CRIAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.regraAlerta.ler',
    descricao:
      'Consultar as regras de alerta da prescrição (versões), os domínios de interação e o simulador',
    opcoesLegado: [...OPCOES_REGRA_ALERTA_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.regraAlerta.editar',
    descricao:
      'Criar e alterar regras de alerta da prescrição (aviso, bloqueio com justificativa, bloqueio total), em versão nova',
    opcoesLegado: [...OPCOES_REGRA_ALERTA_EDITAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
  },
  {
    codigo: 'pep.antimicrobiano.ler',
    descricao: 'Consultar as fichas de antimicrobiano (as do novo e as anteriores, só leitura)',
    opcoesLegado: [...OPCOES_ANTIMICROBIANO_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.antimicrobiano.registrar',
    descricao: 'Registrar a ficha de antimicrobiano (indicação, sítio, empírico ou dirigido, cultura, dia)',
    opcoesLegado: [...OPCOES_ANTIMICROBIANO_REGISTRAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.gradeHorario.ler',
    descricao:
      'Ver a regra de horário de medicação de cada unidade, a grade por número de doses e a grade por classe',
    opcoesLegado: [...OPCOES_GRADE_HORARIO_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.gradeHorario.editar',
    descricao:
      'Definir a grade de horários por classe de medicamento numa unidade (versão nova; vale para prescrições novas)',
    opcoesLegado: [...OPCOES_GRADE_HORARIO_EDITAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
];

// M23 (ficha, seção 7): documentos, exames, resultados e multiprofissional. Opções do módulo do PEP (TBOPCOES,
// retrato tools/verificadores/dados/acesso-legado.pc.json) e a trilha do legado (TBCABTRILHA, 2026-06-01 a
// 2026-07-05): Localizar paciente 3900 (Selecionar 5146, Encaminhar 3907, Acompanhamento 3909) e a personalização
// 3343 (Consultar 5923, Confirmar 5360); Solicitação de exame 3926 (Consultar 5462, Nova 4596, Manter 5788,
// Suspender 4598, Confirmar 5231, Resultados 4601, Resultados Novo/Confirmar/Suspender 5799/5800/5801); Exames
// liberados 6437 (Consultar 6438), Acompanhamento 3927/5466, Visualização 3928/5467; Receita médica 2631 (Consultar
// 5481, Nova 2632, Confirmar 5251, Suspender 4606); Atestado/Requerimento 3932 (Consultar 5477, Novo 3933, Manter
// 5653, Confirmar 4239, Suspender 4605, Corrigir 6553); Termo de consentimento 3931 (Consultar 5473, Novo 5244,
// Suspender 4603); Sumário de alta 6757 (Consultar 6758, Nova 6764, Salvar 6767, Suspender 6766, Corrigir 6773);
// Anexos 4635 (Consultar 5545, Inserir 4636, Suspender 5900, Visualizar 4638); Interconsulta 5514 (Consultar 5515,
// Nova 5519); Pendências de assinatura digital 5298 (Consultar 5534); Histórico 2635 e Visualizar Prontuário
// Completo 6774/6775 (linha do tempo); Impressão completa e recibo 5718 (exportar; crítica). As alergias são
// registradas dentro do registro clínico no legado (anamnese, evolução): as opções do registro (M22). Dietas:
// Características 2675 (Consultar 5926, Incluir 4656, Alterar 5927, Excluir 4658, Confirmar 4657), Horários 2654
// (Consultar 5925, Confirmar 5362, Excluir 2657); Tabelas › Dietas 3677. Recursos [N] (lista de problemas,
// pendências de assinatura, contexto do paciente): concessão por perfil. Conferir na validação com a TI (DP-3).
export const OPCOES_PEP_PAINEL_LER = [3900, 5146, 3907, 3909, 5923] as const;
export const OPCOES_PEP_PAINEL_CONFIGURAR = [3343, 5360] as const;
export const OPCOES_PEP_LINHA_TEMPO = [2635, 5544, 6774, 6775] as const;
export const OPCOES_PEP_EXPORTAR = [5718, 5719, 5912, 5916, 6583] as const;
export const OPCOES_PEP_EXAME_LER = [3926, 5462, 6437, 6438, 3927, 5466, 3928, 5467] as const;
export const OPCOES_PEP_EXAME_CRIAR = [4596, 5788, 5231] as const;
export const OPCOES_PEP_RESULTADO_LER = [4601, 6437, 6438, 3927, 5466, 3928, 5467] as const;
export const OPCOES_PEP_RESULTADO_EXTERNO = [5799, 5800] as const;
export const OPCOES_PEP_RECEITA_LER = [2631, 5481] as const;
export const OPCOES_PEP_RECEITA_EMITIR = [2632, 5251] as const;
export const OPCOES_PEP_RECEITA_SUSPENDER = [4606] as const;
export const OPCOES_PEP_ATESTADO_LER = [3932, 5477] as const;
export const OPCOES_PEP_ATESTADO_EMITIR = [3933, 5653, 4239, 6553] as const;
export const OPCOES_PEP_ATESTADO_SUSPENDER = [4605] as const;
export const OPCOES_PEP_TCLE_LER = [3931, 5473] as const;
export const OPCOES_PEP_TCLE_EMITIR = [5244] as const;
export const OPCOES_PEP_ALTA_LER = [6757, 6758] as const;
export const OPCOES_PEP_ALTA_FINALIZAR = [6764, 6767, 6773] as const;
export const OPCOES_PEP_ANEXO_LER = [4635, 5545, 4638] as const;
export const OPCOES_PEP_ANEXO_CRIAR = [4636] as const;
export const OPCOES_PEP_INTERCONSULTA_LER = [5514, 5515] as const;
export const OPCOES_PEP_INTERCONSULTA_CRIAR = [5519] as const;
export const OPCOES_PEP_DIETA_LER = [2675, 5926, 2654, 5925] as const;
export const OPCOES_PEP_DIETA_EDITAR = [4656, 5927, 4658, 4657, 5362, 2657] as const;
export const OPCOES_TABELAS_DIETAS = [3677] as const;

const clinica = (
  codigo: string,
  descricao: string,
  opcoes: readonly number[],
  criticidade: 'normal' | 'sensivel' | 'critica' = 'sensivel',
  exigeConselho = false,
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado: [...opcoes],
  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade,
  ...(exigeConselho ? { exigeConselho: true } : {}),
});
const recursoNovo = (
  codigo: string,
  descricao: string,
  criticidade: 'normal' | 'sensivel' | 'critica' = 'sensivel',
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado: [],
  concessaoPorPerfil: 'por-perfil',
  perfis: ['assistencial-com-conselho'],
  categoria: 'clinica',
  criticidade,
});

export const PERMISSOES_PEP_M23: readonly DeclaracaoPermissao[] = [
  // Regra 3 (preceptoria): quem registra a evolução no legado coassina o registro do residente que o indicou.
  clinica(
    'pep.evolucao.coassinar',
    'Coassinar, como preceptor, o registro clínico do residente que o indicou (ou recusar com o motivo)',
    OPCOES_PEP_EVOLUCAO_CRIAR,
    'sensivel',
    true,
  ),
  clinica(
    'pep.painel.ler',
    'Ver o painel "Meus pacientes" (internados e em atendimento por unidade, com favoritos e alertas)',
    OPCOES_PEP_PAINEL_LER,
  ),
  clinica(
    'pep.painel.configurar',
    'Configurar as colunas e os filtros do próprio painel de pacientes',
    OPCOES_PEP_PAINEL_CONFIGURAR,
    'normal',
  ),
  clinica(
    'pep.prontuario.exportar',
    'Exportar ou imprimir o prontuário completo do paciente, com justificativa',
    OPCOES_PEP_EXPORTAR,
    'critica',
  ),
  clinica('pep.alergia.ler', 'Ver as alergias e reações adversas do paciente (ativas e histórico)', [
    ...OPCOES_PEP_PRONTUARIO,
  ]),
  clinica(
    'pep.alergia.criar',
    'Registrar alergia ou "nega alergias" ligada ao registro clínico do atendimento',
    [...OPCOES_PEP_EVOLUCAO_CRIAR],
  ),
  clinica('pep.alergia.inativar', 'Retirar uma alergia da lista ativa (fica no histórico), com motivo', [
    ...OPCOES_PEP_EVOLUCAO_CRIAR,
  ]),
  recursoNovo('pep.problema.ler', 'Ver a lista de problemas e diagnósticos do paciente', 'normal'),
  recursoNovo('pep.problema.criar', 'Incluir, resolver ou descartar problemas e diagnósticos do paciente'),
  clinica('pep.pedidoExame.ler', 'Ver os pedidos de exame do paciente', OPCOES_PEP_EXAME_LER),
  clinica(
    'pep.pedidoExame.criar',
    'Solicitar exames (individual ou kit), com indicação e urgência',
    OPCOES_PEP_EXAME_CRIAR,
    'sensivel',
    true,
  ),
  clinica(
    'pep.resultado.ler',
    'Ver os resultados de exames do paciente, a faixa de referência e a tendência',
    OPCOES_PEP_RESULTADO_LER,
  ),
  recursoNovo('pep.resultado.darCiencia', 'Dar ciência do valor crítico de resultado, com a conduta'),
  clinica(
    'pep.resultado.lancarExterno',
    'Lançar resultado de exame feito fora do estabelecimento',
    OPCOES_PEP_RESULTADO_EXTERNO,
  ),
  clinica('pep.receita.ler', 'Ver as receitas do paciente', OPCOES_PEP_RECEITA_LER),
  clinica(
    'pep.receita.emitir',
    'Emitir receita (simples, de controle especial ou de antimicrobiano)',
    OPCOES_PEP_RECEITA_EMITIR,
    'sensivel',
    true,
  ),
  clinica(
    'pep.receita.suspender',
    'Suspender uma receita com justificativa (a original continua visível)',
    OPCOES_PEP_RECEITA_SUSPENDER,
    'critica',
  ),
  clinica(
    'pep.atestado.ler',
    'Ver atestados, declarações e requerimentos do paciente',
    OPCOES_PEP_ATESTADO_LER,
  ),
  clinica(
    'pep.atestado.emitir',
    'Emitir atestado, declaração ou requerimento (atestado médico só por médico)',
    OPCOES_PEP_ATESTADO_EMITIR,
    'sensivel',
    true,
  ),
  clinica(
    'pep.atestado.suspender',
    'Suspender atestado, declaração ou requerimento com justificativa',
    OPCOES_PEP_ATESTADO_SUSPENDER,
    'critica',
  ),
  clinica('pep.tcle.ler', 'Ver os termos de consentimento do paciente', OPCOES_PEP_TCLE_LER),
  clinica(
    'pep.tcle.emitir',
    'Emitir, registrar a assinatura ou a revogação do termo de consentimento',
    OPCOES_PEP_TCLE_EMITIR,
  ),
  clinica(
    'pep.sumarioAlta.ler',
    'Ver o sumário de alta, o relatório de transferência e a declaração de óbito',
    OPCOES_PEP_ALTA_LER,
  ),
  clinica(
    'pep.sumarioAlta.finalizar',
    'Montar e finalizar o sumário de alta e o relatório de transferência (médico)',
    OPCOES_PEP_ALTA_FINALIZAR,
    'sensivel',
    true,
  ),
  clinica(
    'pep.declaracaoObito.emitir',
    'Registrar a declaração de óbito (médico)',
    OPCOES_PEP_ALTA_FINALIZAR,
    'critica',
    true,
  ),
  clinica('pep.anexo.ler', 'Ver os anexos e documentos digitalizados do paciente', OPCOES_PEP_ANEXO_LER),
  clinica(
    'pep.anexo.criar',
    'Anexar documento digitalizado ou exame externo ao prontuário',
    OPCOES_PEP_ANEXO_CRIAR,
  ),
  clinica(
    'pep.tempoEvento.ler',
    'Consultar os registros de tempo de evento do paciente',
    [...OPCOES_PEP_PRONTUARIO],
    'normal',
  ),
  clinica(
    'pep.interconsulta.ler',
    'Ver a fila de pareceres por especialidade ou categoria',
    OPCOES_PEP_INTERCONSULTA_LER,
  ),
  clinica(
    'pep.interconsulta.criar',
    'Pedir parecer (interconsulta) a uma especialidade ou categoria',
    OPCOES_PEP_INTERCONSULTA_CRIAR,
  ),
  clinica(
    'pep.interconsulta.responder',
    'Aceitar e responder o parecer pedido à sua especialidade',
    OPCOES_PEP_INTERCONSULTA_CRIAR,
  ),
  clinica(
    'pep.dieta.ler',
    'Consultar as dietas, características e horários de refeição',
    OPCOES_PEP_DIETA_LER,
    'normal',
  ),
  clinica(
    'pep.dieta.editar',
    'Editar as características da dieta e os horários de refeição',
    OPCOES_PEP_DIETA_EDITAR,
    'normal',
  ),
  recursoNovo(
    'documento.documento.ler',
    'Ver as próprias pendências de assinatura (documentos emitidos e não assinados)',
    'normal',
  ),
  recursoNovo(
    'documento.documento.assinar',
    'Assinar documentos emitidos (assinatura eletrônica avançada; em lote)',
    'critica',
  ),
];

// M45, etapa 1 (ficha, seção 7; cap-11 §11.1): construtor de formulários novos. A leitura continua em
// `pep.admin.ler` (M22). Opções do módulo do PEP (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json),
// do cadastro de "Composições (templates)" 4703 (Incluir 4704, Alterar 4705, Excluir 4706) e da "Edição de
// formulários de composição" 3377 (Confirmar 5394), todas ativas; as do "Cadastro de composições" 2667 a 2670
// estão inativas no retrato. A aprovação da comissão de prontuário (regra 14, DP-27) usa a mesma opção de
// confirmação da edição do formulário, e o domínio exige que quem aprova não seja quem escreveu (quatro olhos).
// Conferir na validação com a TI (DP-3).
export const OPCOES_FORMULARIO_NOVO_EDITAR = [4704, 4705] as const;
export const OPCOES_FORMULARIO_NOVO_CONFIRMAR = [5394] as const;
export const OPCOES_FORMULARIO_NOVO_APOSENTAR = [4706] as const;

export const PERMISSOES_PEP_M45_FORMULARIO_NOVO: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'pep.formularioNovo.editar',
    descricao:
      'Criar e editar formulários novos no construtor (rascunho, perguntas, regras e casos de teste) e enviá-los à revisão',
    opcoesLegado: [...OPCOES_FORMULARIO_NOVO_EDITAR],
    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.formularioNovo.aprovar',
    descricao:
      'Aprovar ou devolver, pela comissão de prontuário, a versão de formulário novo em revisão (nunca a própria)',
    opcoesLegado: [...OPCOES_FORMULARIO_NOVO_CONFIRMAR],
    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.formularioNovo.publicar',
    descricao:
      'Publicar a versão aprovada do formulário novo, com os casos de teste verdes (vira modelo do prontuário; imutável)',
    opcoesLegado: [...OPCOES_FORMULARIO_NOVO_CONFIRMAR],
    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: 'pep.formularioNovo.aposentar',
    descricao:
      'Aposentar uma versão publicada do formulário novo, com o motivo (os registros feitos continuam legíveis)',
    opcoesLegado: [...OPCOES_FORMULARIO_NOVO_APOSENTAR],
    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
];
