// Permissões do M15 (ficha, seção 7; convencoes.md §12; cap-08 §8.12 e §8.13): prontuário ao vivo (consulta) e
// o registro de acesso ao prontuário. Quem tem a opção no legado tem a permissão no novo (regra 1 do M06): as
// opções do módulo do PEP (menu de origem, retrato tools/verificadores/dados/acesso-legado.pc.json) que abrem o
// prontuário do paciente: Prontuário Eletrônico do paciente 2582, Localizar paciente 3900 e Selecionar paciente
// 5146, Histórico do paciente 2635/5544, a consulta dos registros (Evolução 5181, Anamnese 5163, Diagnóstico
// 5202, Evolução em grupo 5453, Registro cirúrgico 6814), Visualizar Prontuário Completo 6774/6775 e Consulta por
// termo 5864/5865 (a busca de palavra). O registro de acesso é do papel Auditor (perfil complementar; a opção
// Auditoria › Consultar 5353 do módulo do PEP também concede a leitura); exportar é só do perfil.
import type { DeclaracaoPermissao } from './tipos.js';
export const OPCAO_PEP_AUDITORIA = 5353;

export const PERMISSOES_PEP_M15: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'pep.prontuario.ler',
    descricao:
      'Abrir o prontuário do paciente ao vivo (registros, documento como emitido, respostas e contexto); toda leitura vai à trilha com o motivo',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'auditoria.acessos.ler',
    descricao: 'Consultar o registro de acesso ao prontuário (quem leu, quando, o quê e por quê)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'auditoria.acessos.exportar',
    descricao: 'Exportar o registro de acesso ao prontuário (CSV, sem dado clínico)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
];

// M22 (ficha, seção 7): registros clínicos nos modelos do formulário de origem e a administração do PEP (consulta).
// Opções inferidas (POL-1b) do módulo do PEP pelo perfil da trilha do legado (trilha de auditoria, 2026-06 a 2026-07):
// a gravação da evolução é registrada na opção 5182 "Confirmar" (2.161 dos 2.394 lançamentos de julho) e 5164 nas
// anamneses; "Salvar" 4580/4581 e "Novo(a)" 3921/3935 abrem o registro; a suspensão é a 3918 (346 de 498) e a 3913.
// A administração do PEP: Configurações 2643 › Parâmetros 2644 (Consultar 5921, Confirmar 5355) e o Cadastro de
// composições 2667 (Alterar 2668, Incluir 2669). Conferir na validação com a TI (DP-3).
export const OPCOES_PEP_EVOLUCAO_LER = [5181, 5163, 5202, 5453, 6814] as const;
export const OPCOES_PEP_EVOLUCAO_CRIAR = [5182, 5164, 4580, 4581, 3921, 3935] as const;

export const PERMISSOES_PEP_M22: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'pep.evolucao.ler',
    descricao:
      'Ver o registro clínico gravado (anamnese, evolução, escala) no formulário de origem; toda leitura vai à trilha',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.evolucao.criar',
    descricao:
      'Registrar anamnese, evolução e escala nos modelos de formulário do estabelecimento, com rascunho e finalização',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.evolucao.suspender',
    descricao:
      'Suspender um registro clínico com justificativa (o original continua visível, marcado suspenso)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
  },
  {
    codigo: 'pep.admin.ler',
    descricao:
      'Consultar modelos de formulário, perguntas, versões do layout, relatório de conversão e modelos de impressão',

    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.admin.editar',
    descricao: 'Editar os cadastros do PEP: tipos de documento, fluxos de situação e avisos',

    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.admin.cliente',
    descricao:
      'Editar a configuração do PEP que vale para todos os estabelecimentos do cliente (ex.: seções do sumário de alta)',

    // Recurso novo, sem opção correspondente no menu de origem: concedido ao administrador do sistema.
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
];

export const PERMISSOES_PEP_M24: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'pep.kitPrescricao.ler',
    descricao: 'Consultar os kits de medicamentos e de soluções (com os materiais e os componentes)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.frequenciaDose.ler',
    descricao:
      'Consultar as frequências, os horários relativos e as fórmulas de dose, com a simulação dos horários',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.cadastroPrescricao.ler',
    descricao:
      'Ler os cadastros de prescrição (protocolos, kits, frequências, receitas padrão, não padronizados, parâmetros do item) pelas telas do cadastro e da prescrição; cada tela confere a permissão do próprio cadastro',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.prescricao.ler',
    descricao:
      'Ver as prescrições do atendimento (itens, doses, horários previstos e situação); toda leitura vai à trilha',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.prescricao.criar',
    descricao:
      'Montar a prescrição item a item (medicamentos, soluções, dietas, cuidados, oxigênio e hemoterapia), aplicar protocolo ou kit e incluir item depois de assinada',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.prescricao.assinar',
    descricao: 'Assinar a prescrição com as verificações de apoio à decisão (alertas e justificativas)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.prescricao.suspender',
    descricao:
      'Suspender a prescrição ou um item com justificativa (os horários futuros ficam suspensos; nada se apaga)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
  },
  {
    codigo: 'pep.prescricao.renovar',
    descricao: 'Renovar a prescrição para o período seguinte ou copiar uma anterior, item a item confirmado',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.prescricao.coassinar',
    descricao: 'Coassinar como preceptor a prescrição do residente',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.reconciliacao.ler',
    descricao: 'Ver a reconciliação medicamentosa (medicamentos em uso antes da internação e as condutas)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.reconciliacao.registrar',
    descricao: 'Registrar a reconciliação medicamentosa na admissão e na alta',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    // 03-PEP L103: a avaliação da reação adversa (causalidade) é ato da farmácia clínica, não de quem registra a
    // evolução; a supervisão da farmácia conduz a farmacovigilância com o NSP (D-PERM-48.2).
    codigo: 'pep.farmacovigilancia.avaliar',
    descricao:
      'Avaliar, pela farmácia clínica, a reação adversa a medicamento registrada no paciente (causalidade e parecer)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['supervisor-farmacia'],
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
  {
    codigo: 'pep.regraAlerta.ler',
    descricao:
      'Consultar as regras de alerta da prescrição (versões), os domínios de interação e o simulador',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.regraAlerta.editar',
    descricao:
      'Criar e alterar regras de alerta da prescrição (aviso, bloqueio com justificativa, bloqueio total), em versão nova',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
  },
  {
    codigo: 'pep.antimicrobiano.ler',
    descricao: 'Consultar as fichas de antimicrobiano (as do novo e as anteriores, só leitura)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.antimicrobiano.registrar',
    descricao: 'Registrar a ficha de antimicrobiano (indicação, sítio, empírico ou dirigido, cultura, dia)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.gradeHorario.ler',
    descricao:
      'Ver a regra de horário de medicação de cada unidade, a grade por número de doses e a grade por classe',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: 'pep.gradeHorario.editar',
    descricao:
      'Definir a grade de horários por classe de medicamento numa unidade (versão nova; vale para prescrições novas)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
];
export const OPCOES_PEP_ANEXO_LER = [4635, 5545, 4638] as const;
export const OPCOES_PEP_ANEXO_CRIAR = [4636] as const;

const clinica = (
  codigo: string,
  descricao: string,

  criticidade: 'normal' | 'sensivel' | 'critica' = 'sensivel',
  exigeConselho = false,
): DeclaracaoPermissao => ({
  codigo,
  descricao,

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

    'sensivel',
    true,
  ),
  clinica(
    'pep.painel.ler',
    'Ver o painel "Meus pacientes" (internados e em atendimento por unidade, com favoritos e alertas)',
  ),
  // Recurso novo, sem opção correspondente no menu de origem: concedido a quem assiste com conselho.
  recursoNovo(
    'pep.equipe.gerenciar',
    'Registrar a equipe assistencial do paciente: incluir o profissional com função e encerrar a participação com motivo',

    'sensivel',
  ),
  clinica(
    'pep.painel.configurar',
    'Configurar as colunas e os filtros do próprio painel de pacientes',

    'normal',
  ),
  clinica(
    'pep.prontuario.exportar',
    'Exportar ou imprimir o prontuário completo do paciente, com justificativa',

    'critica',
  ),
  clinica('pep.alergia.ler', 'Ver as alergias e reações adversas do paciente (ativas e histórico)'),
  clinica(
    'pep.alergia.criar',
    'Registrar alergia ou "nega alergias" ligada ao registro clínico do atendimento',
  ),
  clinica('pep.alergia.inativar', 'Retirar uma alergia da lista ativa (fica no histórico), com motivo'),
  recursoNovo('pep.problema.ler', 'Ver a lista de problemas e diagnósticos do paciente', 'normal'),
  recursoNovo('pep.problema.criar', 'Incluir, resolver ou descartar problemas e diagnósticos do paciente'),
  clinica('pep.pedidoExame.ler', 'Ver os pedidos de exame do paciente'),
  clinica(
    'pep.pedidoExame.criar',
    'Solicitar exames (individual ou kit), com indicação e urgência',

    'sensivel',
    true,
  ),
  clinica(
    'pep.resultado.ler',
    'Ver os resultados de exames do paciente, a faixa de referência e a tendência',
  ),
  recursoNovo('pep.resultado.darCiencia', 'Dar ciência do valor crítico de resultado, com a conduta'),
  clinica('pep.resultado.lancarExterno', 'Lançar resultado de exame feito fora do estabelecimento'),
  clinica('pep.receita.ler', 'Ver as receitas do paciente'),
  clinica(
    'pep.receita.emitir',
    'Emitir receita (simples, de controle especial ou de antimicrobiano)',

    'sensivel',
    true,
  ),
  clinica(
    'pep.receita.suspender',
    'Suspender uma receita com justificativa (a original continua visível)',

    'critica',
  ),
  clinica('pep.atestado.ler', 'Ver atestados, declarações e requerimentos do paciente'),
  clinica(
    'pep.atestado.emitir',
    'Emitir atestado, declaração ou requerimento (atestado médico só por médico)',

    'sensivel',
    true,
  ),
  clinica(
    'pep.atestado.suspender',
    'Suspender atestado, declaração ou requerimento com justificativa',

    'critica',
  ),
  clinica('pep.tcle.ler', 'Ver os termos de consentimento do paciente'),
  clinica('pep.tcle.emitir', 'Emitir, registrar a assinatura ou a revogação do termo de consentimento'),
  clinica(
    'pep.sumarioAlta.ler',
    'Ver o sumário de alta, o relatório de transferência e a declaração de óbito',
  ),
  clinica(
    'pep.sumarioAlta.finalizar',
    'Montar e finalizar o sumário de alta e o relatório de transferência (médico)',

    'sensivel',
    true,
  ),
  clinica(
    'pep.declaracaoObito.emitir',
    'Registrar a declaração de óbito (médico)',

    'critica',
    true,
  ),
  clinica('pep.anexo.ler', 'Ver os anexos e documentos digitalizados do paciente'),
  clinica('pep.anexo.criar', 'Anexar documento digitalizado ou exame externo ao prontuário'),
  clinica(
    'pep.tempoEvento.ler',
    'Consultar os registros de tempo de evento do paciente',

    'normal',
  ),
  clinica('pep.interconsulta.ler', 'Ver a fila de pareceres por especialidade ou categoria'),
  clinica('pep.interconsulta.criar', 'Pedir parecer (interconsulta) a uma especialidade ou categoria'),
  clinica('pep.interconsulta.responder', 'Aceitar e responder o parecer pedido à sua especialidade'),
  clinica(
    'pep.dieta.ler',
    'Consultar as dietas, características e horários de refeição',

    'normal',
  ),
  clinica(
    'pep.dieta.editar',
    'Editar as características da dieta e os horários de refeição',

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

export const PERMISSOES_PEP_M45_FORMULARIO_NOVO: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'pep.formularioNovo.editar',
    descricao:
      'Criar e editar formulários novos no construtor (rascunho, perguntas, regras e casos de teste) e enviá-los à revisão',

    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.formularioNovo.aprovar',
    descricao:
      'Aprovar ou devolver, pela comissão de prontuário, a versão de formulário novo em revisão (nunca a própria)',

    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'pep.formularioNovo.publicar',
    descricao:
      'Publicar a versão aprovada do formulário novo, com os casos de teste verdes (vira modelo do prontuário; imutável)',

    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: 'pep.formularioNovo.aposentar',
    descricao:
      'Aposentar uma versão publicada do formulário novo, com o motivo (os registros feitos continuam legíveis)',

    concessaoPorPerfil: null,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
];
