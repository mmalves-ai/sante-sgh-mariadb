// Onda 2: internação, PA, médicos, enfermagem, SADT, centro cirúrgico, higienização e SAME (ficha do M40; cap-15
// §15.3.1 a §15.3.4, §15.4.3, §15.9; cap-14 §14.8 e §14.10.2). Vocabulário puro, sem banco nem tela: a ordem dos
// setores na onda (campo 12), as operações que a ficha nomeia com o nome do catálogo de operações e os cenários
// mínimos de assinatura (campos 5 e 9), os itens do critério de liberação (regra 1 e as condições próprias da onda:
// regras 4, 5, 6, 9, 11 e 12), os recursos que só existem no novo (regra 6), os códigos de baixa confiança (regra 14),
// as tabelas que o novo nunca grava (regra 15), a janela sem versão nova (regra 16) e o registro por setor e hospital
// das evidências (campo 11). As regras 1 a 8 valem para as ondas 2 a 5 (M40 a M43): o que é geral não cita a onda.
// Textos daqui podem aparecer na tela: nunca citam o outro sistema pelo nome (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

/** Hospital em que a onda começa (DP-4, decidida em 2026-10-19: o Serrano só depois de todas as ondas no pc). */
export const HOSPITAL_INICIAL_ONDAS = 'pc';

/**
 * Ordem recomendada dos setores da onda 2 (campo 12; ajustável pelo dono, DP-4). Ids de `SETORES_PRONTIDAO`
 * (prontidao/catalogo.ts). Setores no mesmo passo podem ser liberados juntos (internação, leitos e SAME).
 */
export const ORDEM_SETORES_ONDA_2: readonly (readonly string[])[] = [
  ['internacao-leitos', 'same'],
  ['pronto-atendimento'],
  ['centro-cirurgico'],
  ['sadt'],
  ['medicos'],
  ['enfermagem'],
  ['higienizacao'],
];

export const SETORES_ONDA_2: readonly string[] = ORDEM_SETORES_ONDA_2.flat();

/** Operação de gravação que a ficha nomeia no campo 5, com o(s) nome(s) do catálogo e os cenários do campo 9. */
export interface OperacaoFichaOnda2 {
  /** Nome como está escrito na ficha (às vezes diferente do catálogo). */
  readonly ficha: string;
  /** Nomes exatos no catálogo de operações (docs/operacoes/catalogo). */
  readonly catalogo: readonly string[];
  /** Setor da onda (id de SETORES_PRONTIDAO); a condução por grupo é transversal (null). */
  readonly setor: string | null;
  readonly marco: string;
  /**
   * Cenários mínimos do campo 9 (os nomes da ficha). O cenário controlado é capturado com estes nomes; os cenários de
   * perfil que o catálogo já tem continuam valendo.
   */
  readonly cenariosMinimos: readonly string[];
  /** Por que o nome da ficha difere do catálogo (vazio quando é o mesmo). */
  readonly nota?: string;
}

export const OPERACOES_FICHA_ONDA_2: readonly OperacaoFichaOnda2[] = [
  {
    ficha: 'internacao.preInternar',
    catalogo: ['internacao.preInternar'],
    setor: 'internacao-leitos',
    marco: 'M21',
    cenariosMinimos: [],
  },
  {
    ficha: 'internacao.internar',
    catalogo: ['internacao.internar'],
    setor: 'internacao-leitos',
    marco: 'M21',
    cenariosMinimos: ['convenio-com-guia', 'particular', 'vinda-do-pa', 'recusa-leito-ocupado'],
  },
  {
    ficha: 'internacao.transferirLeito',
    catalogo: ['internacao.transferirLeito'],
    setor: 'internacao-leitos',
    marco: 'M21',
    cenariosMinimos: ['mesma-unidade', 'outra-unidade', 'recusa-leito-bloqueado'],
  },
  {
    ficha: 'internacao.trocarResponsavel',
    catalogo: [
      'internacao.trocarConvenio',
      'internacao.trocarClinica',
      'internacao.trocarEspecialidade',
      'internacao.trocarMedico',
    ],
    setor: 'internacao-leitos',
    marco: 'M21',
    cenariosMinimos: [],
    nota: 'o catálogo separa a troca por convênio, clínica, especialidade e médico (uma tabela de troca cada)',
  },
  {
    ficha: 'internacao.darAlta',
    catalogo: ['internacao.darAlta'],
    setor: 'internacao-leitos',
    marco: 'M21',
    cenariosMinimos: ['alta-medica', 'obito', 'transferencia-externa'],
  },
  {
    ficha: 'internacao.solicitarHigienizacao',
    catalogo: ['hotelaria.solicitarLimpeza'],
    setor: 'higienizacao',
    marco: 'M21',
    cenariosMinimos: ['na-alta', 'manual'],
    nota: 'no catálogo, a solicitação manual é da hotelaria; a da saída é gravada por internacao.darAlta',
  },
  {
    ficha: 'internacao.movimentarProntuario',
    catalogo: ['same.movimentarProntuario'],
    setor: 'same',
    marco: 'M21',
    cenariosMinimos: [],
    nota: 'no catálogo, o movimento de prontuários é do módulo do arquivo (same)',
  },
  {
    ficha: 'atendimento.abrirAtendimento',
    catalogo: ['atendimento.abrirAtendimento'],
    setor: 'pronto-atendimento',
    marco: 'M20',
    cenariosMinimos: ['pa-convenio', 'pa-particular'],
  },
  {
    ficha: 'atendimento.registrarAlta',
    catalogo: ['atendimento.encerrarAtendimento'],
    setor: 'pronto-atendimento',
    marco: 'M20',
    cenariosMinimos: [],
    nota: 'no catálogo, a saída do PA é o encerramento do atendimento (fluxo do atendimento)',
  },
  {
    ficha: 'atendimento.cancelarAtendimento',
    catalogo: ['atendimento.cancelarAtendimento'],
    setor: 'pronto-atendimento',
    marco: 'M20',
    cenariosMinimos: [],
  },
  {
    ficha: 'atendimento.lancarProcedimentoExtra',
    catalogo: ['atendimento.lancarProcedimentoExtra'],
    setor: 'pronto-atendimento',
    marco: 'M20',
    cenariosMinimos: [],
  },
  {
    ficha: 'cirurgia.agendarCirurgia',
    catalogo: ['cirurgia.agendarCirurgia'],
    setor: 'centro-cirurgico',
    marco: 'M18',
    cenariosMinimos: [],
  },
  {
    ficha: 'cirurgia.registrarCirurgia',
    catalogo: ['cirurgia.registrarCirurgia'],
    setor: 'centro-cirurgico',
    marco: 'M18',
    cenariosMinimos: ['eletiva-agendada', 'urgencia-sem-agenda', 'equipe-com-auxiliares'],
  },
  {
    ficha: 'pep.registrarEvolucao',
    catalogo: ['pep.registrarEvolucao'],
    setor: 'medicos',
    marco: 'M22',
    cenariosMinimos: [],
    nota: 'um cenário por modelo liberado (os 10 de maior uso primeiro), com e sem histórico mantido (regra 10)',
  },
  {
    ficha: 'pep.registrarAlergia',
    catalogo: ['pep.registrarAlergia'],
    setor: 'medicos',
    marco: 'M23',
    cenariosMinimos: [],
  },
  {
    ficha: 'pep.emitirDocumento',
    catalogo: ['pep.emitirDocumento'],
    setor: 'medicos',
    marco: 'M23',
    cenariosMinimos: ['receita-simples', 'receita-controle-especial', 'atestado'],
  },
  {
    ficha: 'pep.solicitarExame',
    catalogo: ['pep.solicitarExame'],
    setor: 'medicos',
    marco: 'M23',
    cenariosMinimos: [],
  },
  {
    ficha: 'pep.prescrever',
    catalogo: ['pep.prescrever'],
    setor: 'medicos',
    marco: 'M24',
    cenariosMinimos: [
      'medicamento-com-aprazamento',
      'solucao',
      'dieta',
      'se-necessario',
      'protocolo',
      'recusa-alergia-sem-justificativa',
    ],
  },
  {
    ficha: 'pep.suspenderItem',
    catalogo: ['pep.suspenderItem'],
    setor: 'medicos',
    marco: 'M24',
    cenariosMinimos: [],
  },
  {
    ficha: 'pep.renovarPrescricao',
    catalogo: ['pep.renovarPrescricao'],
    setor: 'medicos',
    marco: 'M24',
    cenariosMinimos: [],
  },
  {
    ficha: 'pep.copiarPrescricao',
    catalogo: ['pep.copiarPrescricao'],
    setor: 'medicos',
    marco: 'M24',
    cenariosMinimos: [],
  },
  {
    ficha: 'enfermagem.checarAdministracao',
    catalogo: ['enfermagem.checarAdministracao'],
    setor: 'enfermagem',
    marco: 'M25',
    cenariosMinimos: ['administrado', 'nao-administrado-com-motivo', 'atrasado', 'offline-sincronizado'],
  },
  {
    ficha: 'sadt.lancarExame',
    catalogo: ['sadt.lancarExame'],
    setor: 'sadt',
    marco: 'M26',
    cenariosMinimos: ['laboratorio', 'imagem', 'recusa-duplicado-no-indice-unico'],
  },
  {
    ficha: 'sadt.registrarResultado',
    catalogo: ['sadt.registrarResultado'],
    setor: 'sadt',
    marco: 'M26',
    cenariosMinimos: [],
  },
  {
    ficha: 'sadt.liberarExame',
    catalogo: ['sadt.liberarExame'],
    setor: 'sadt',
    marco: 'M26',
    cenariosMinimos: ['normal', 'valor-critico'],
  },
  {
    ficha: 'acesso.revogarOpcao',
    catalogo: ['acesso.revogarOpcoesGrupo'],
    setor: null,
    marco: 'M10',
    cenariosMinimos: ['revogar-uma-opcao'],
    nota: 'no catálogo, a revogação por grupo é a do ADR 0022 (opções do grupo), usada pela condução do M37',
  },
  {
    ficha: 'acesso.concederOpcao',
    catalogo: ['acesso.concederOpcoesGrupo'],
    setor: null,
    marco: 'M10',
    cenariosMinimos: ['reabrir-lista'],
    nota: 'no catálogo, a concessão por grupo é a do ADR 0022, usada para devolver a lista reversível',
  },
];

/** Todos os nomes do catálogo cobertos pelo campo 5 da ficha (sem repetição, na ordem da ficha). */
export const OPERACOES_CATALOGO_ONDA_2: readonly string[] = [
  ...new Set(OPERACOES_FICHA_ONDA_2.flatMap((o) => o.catalogo)),
];

// ---------------------------------------------------------------------------------------------------------------
// Critério de liberação do setor (regra 1, cap-15 §15.3.2; mais as condições próprias das ondas clínicas)

export const ITENS_CRITERIO_LIBERACAO = [
  /** Regra 1: toda operação de escrita do setor `conferida` no hospital. */
  'operacoes-conferidas',
  /** Regra 1: aceite da jornada pelo chave-usuário. */
  'aceite-jornada',
  /** Regra 1: trilha de treinamento concluída por quem vai começar (M37). */
  'treinamento-concluido',
  /** Regra 1: estações, impressoras e leitores conferidos pela TI. */
  'estacoes-conferidas',
  /** Regra 1: carga do banco dentro do limite acordado (k6 carga-somada). */
  'carga-dentro-do-limite',
  /** Regra 1: apoio no setor e canal de chamados abertos. */
  'apoio-e-chamados',
  /** Regra 1 e 2: autorização do dono registrada no ESTADO.md › Autorizações (a IA nunca liga em produção). */
  'autorizacao-do-dono',
  /** Regra 4: recolhimento ensaiado no setor. */
  'recolhimento-ensaiado',
  /** Regra 5: teste de retorno ao sistema anterior feito no setor. */
  'retorno-ensaiado',
  /** Regra 6: relatório de contingência por posto gerado e impresso (só setores com recurso que só existe no novo). */
  'relatorio-contingencia',
  /** Regra 9: registros clínicos gravados pelo novo abertos por médico e enfermeiro no outro sistema. */
  'pep-aberto-no-outro-sistema',
  /** Regras 11 e 12: liberação começa pela unidade-piloto. */
  'unidade-piloto',
  /** Regras de segurança do M36: pentest sem achado crítico ou alto aberto. */
  'pentest-sem-critico',
  /** Onda 3 (M41, campo 2): inventário recente dos locais que entram (o saldo de partida é o do banco). */
  'inventario-recente',
  /** Onda 3 (M41, campo 12): cada documento gravado pelo novo na cópia aberto e conferido no outro sistema. */
  'documentos-conferidos',
  /** Onda 3 (M41, regra 1): a prescrição eletrônica em uso nas unidades atendidas pela farmácia. */
  'prescricao-na-unidade',
  /** Onda 3 (M41, campo 10): conferência numérica de saldo e preço médio com 0 divergência. */
  'conferencia-numerica',
  /** Onda 4 (M42, regra 1): o início do setor marcado para a abertura de uma competência (primeiro dia útil). */
  'abertura-da-competencia',
  /** Onda 4 (M42, regra 3): reprodução do faturamento da competência sem diferença (o motor é o do banco). */
  'reproducao-sem-diferenca',
  /** Onda 4 (M42, campo 12): conta, lote, glosa, título e RPA gravados aqui conferidos no outro sistema. */
  'registros-conferidos',
] as const;
export type ItemCriterioLiberacao = (typeof ITENS_CRITERIO_LIBERACAO)[number];

/** Rótulos de produto dos itens (tela e evidências). */
export const ROTULOS_CRITERIO_LIBERACAO: Readonly<Record<ItemCriterioLiberacao, string>> = {
  'operacoes-conferidas': 'Operações de gravação do setor conferidas no hospital',
  'aceite-jornada': 'Aceite da jornada pelo chave-usuário',
  'treinamento-concluido': 'Trilha de treinamento concluída por quem vai começar',
  'estacoes-conferidas': 'Estações, impressoras e leitores conferidos pela TI',
  'carga-dentro-do-limite': 'Carga do banco dentro do limite acordado',
  'apoio-e-chamados': 'Apoio no setor e canal de chamados abertos',
  'autorizacao-do-dono': 'Autorização do dono registrada',
  'recolhimento-ensaiado': 'Recolhimento ensaiado no setor',
  'retorno-ensaiado': 'Teste de retorno ao sistema anterior feito no setor',
  'relatorio-contingencia': 'Relatório de contingência por posto gerado e impresso',
  'pep-aberto-no-outro-sistema': 'Registros clínicos abertos no outro sistema por médico e enfermeiro',
  'unidade-piloto': 'Liberação começando pela unidade-piloto',
  'pentest-sem-critico': 'Teste de invasão sem achado crítico ou alto aberto',
  'inventario-recente': 'Inventário recente dos locais de estoque que entram',
  'documentos-conferidos': 'Documentos gravados aqui abertos e conferidos no outro sistema',
  'prescricao-na-unidade': 'Prescrição eletrônica em uso nas unidades atendidas',
  'conferencia-numerica': 'Conferência de saldo e preço médio sem divergência',
  'abertura-da-competencia': 'Início marcado para a abertura de uma competência',
  'reproducao-sem-diferenca': 'Reprodução do faturamento da competência sem diferença',
  'registros-conferidos': 'Conta, lote, glosa, título e RPA gravados aqui conferidos no outro sistema',
};

/** Itens que valem para todo setor de toda onda (regra 1 e regras 4 e 5). */
export const ITENS_CRITERIO_GERAIS: readonly ItemCriterioLiberacao[] = [
  'operacoes-conferidas',
  'aceite-jornada',
  'treinamento-concluido',
  'estacoes-conferidas',
  'carga-dentro-do-limite',
  'apoio-e-chamados',
  'autorizacao-do-dono',
  'recolhimento-ensaiado',
  'retorno-ensaiado',
  'pentest-sem-critico',
];

/**
 * Itens a mais por setor da onda 2 (regras 9, 11 e 12). O relatório de contingência (regra 6) não está aqui: entra
 * para todo setor que usa uma chave de `RECURSOS_SO_NO_NOVO` (derivado dos recursos do setor no catálogo de
 * prontidão; @sgh/dominio-config, itensDoSetor).
 */
export const ITENS_CRITERIO_POR_SETOR_ONDA_2: Readonly<Record<string, readonly ItemCriterioLiberacao[]>> = {
  medicos: ['pep-aberto-no-outro-sistema'],
  enfermagem: ['pep-aberto-no-outro-sistema', 'unidade-piloto'],
  higienizacao: ['unidade-piloto'],
};

/**
 * Regra 6: recursos (chaves de liberação) que só existem no novo. O setor que usa um deles só é liberado com o
 * relatório de contingência por posto funcionando. Chave → o que o relatório imprime.
 */
export const RECURSOS_SO_NO_NOVO: Readonly<Record<string, string>> = {
  'enfermagem.sinaisVitais': 'sinais vitais estruturados',
  'hotelaria.limpeza': 'etapas da higienização (aceite, checklist e inspeção)',
  'sadt.rastreio': 'rastreio de amostra',
  'pep.problema.lista': 'lista de problemas',
  /** As justificativas de alerta são gravadas com a prescrição (M24). */
  'pep.prescricao.cpoe': 'justificativas de alerta da prescrição',
};

// ---------------------------------------------------------------------------------------------------------------
// Regra 14: códigos de baixa confiança da onda (DP-46.6 e DP-46.7)

export interface CodigoBaixaConfianca {
  readonly tabela: string;
  readonly coluna: string;
  /** Valores já vistos no perfil: só eles são gravados até a confirmação. */
  readonly vistos: readonly string[];
  readonly decisao: string;
  /** Quem confirma (área). */
  readonly confirma: string;
}

export const CODIGOS_BAIXA_CONFIANCA_ONDA_2: readonly CodigoBaixaConfianca[] = [
  {
    tabela: 'RECADATE',
    coluna: 'TIPO_SADT',
    vistos: ['H', 'E', 'S'],
    decisao: 'DP-46.6',
    confirma: 'recepção',
  },
  {
    tabela: 'SILANEXA',
    coluna: 'TIPO_RESULTADO',
    vistos: ['P', 'V', 'T'],
    decisao: 'DP-46.7',
    confirma: 'laboratório',
  },
  {
    tabela: 'SILIBERACAOEXAME',
    coluna: 'SITUACAO',
    vistos: ['2'],
    decisao: 'DP-46.7',
    confirma: 'laboratório',
  },
  {
    tabela: 'ATCABECATEND',
    coluna: 'TCLE',
    vistos: ['1'],
    decisao: 'DP-46.6',
    confirma: 'diretoria clínica',
  },
];

/** Legenda dos códigos de baixa confiança até a confirmação (regra 14). */
export const LEGENDA_A_CONFIRMAR = 'a confirmar';

// ---------------------------------------------------------------------------------------------------------------
// Regra 15: o que o novo nunca grava (os gatilhos fazem)

/** Tabelas de ocupação, guia, conta e da conexão do outro sistema: nunca gravadas pelo novo (cap-10 §10.2). */
export const TABELAS_NUNCA_GRAVADAS: readonly string[] = [
  'TBLEITO',
  'TBACOMODLEITO',
  'TBSGHCONEXAO',
  'ATCONTA',
  'RICONTAS',
  'RICGUIAS',
  'RECONTAS',
  'FCCTAEXT',
  'RILEITOS',
];

/**
 * Exceções conhecidas e justificadas no catálogo: o próprio outro sistema grava a linha na mesma ação (não é
 * gatilho), e o novo grava como ele (convencoes §5). Cada exceção é revista na conferência do setor.
 */
export interface ExcecaoRegra15 {
  readonly operacao: string;
  readonly tabela: string;
  readonly acao: 'INSERT' | 'UPDATE' | 'DELETE';
  readonly motivo: string;
}

export const EXCECOES_REGRA_15: readonly ExcecaoRegra15[] = [
  {
    operacao: 'internacao.transferirLeito',
    tabela: 'RILEITOS',
    acao: 'UPDATE',
    motivo: 'a troca de leito move a ocupação na mesma ação da tela de transferência (ficha do M21)',
  },
  {
    operacao: 'internacao.darAlta',
    tabela: 'RILEITOS',
    acao: 'UPDATE',
    motivo: 'a saída libera o leito na mesma ação da tela de alta (ficha do M21)',
  },
  {
    operacao: 'internacao.cancelarAlta',
    tabela: 'RILEITOS',
    acao: 'UPDATE',
    motivo: 'cancelar a alta reocupa o leito na mesma ação da tela do supervisor (ficha do M21)',
  },
  {
    operacao: 'internacao.reservarLeito',
    tabela: 'RILEITOS',
    acao: 'UPDATE',
    motivo:
      'especificada (M44): as colunas de reserva do cadastro de leitos só se o cenário controlado do M36 mostrar que o outro sistema grava ao reservar; até lá não grava',
  },
  {
    operacao: 'internacao.registrarGuia',
    tabela: 'RICGUIAS',
    acao: 'INSERT',
    motivo:
      'a guia inicial e a prorrogação digitadas na tela de guias (a da admissão continua com o gatilho; M21)',
  },
  {
    operacao: 'atendimento.cancelarAtendimento',
    tabela: 'RECONTAS',
    acao: 'DELETE',
    motivo:
      'o cancelamento desfaz a conta aberta pelo gatilho da abertura, como a tela de cancelamento (M20)',
  },
  {
    operacao: 'atendimento.cancelarAtendimento',
    tabela: 'FCCTAEXT',
    acao: 'DELETE',
    motivo:
      'o cancelamento desfaz a conta aberta pelo gatilho da abertura, como a tela de cancelamento (M20)',
  },
  {
    operacao: 'atendimento.alterarAtendimento',
    tabela: 'FCCTAEXT',
    acao: 'UPDATE',
    motivo:
      'a correção da ficha leva o convênio, o procedimento, o profissional, o CID, o solicitante e a observação à conta aberta na mesma ação da tela de alteração (nenhum gatilho o faz; medido no W1-05)',
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Regra 16: sem versão nova em feriado prolongado; hotfix a qualquer hora só para S1

export interface JanelaSemVersao {
  /** AAAA-MM-DD, inclusive. */
  readonly de: string;
  readonly ate: string;
  readonly motivo: string;
}

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD');

export const esquemaJanelaSemVersao = z
  .object({ de: data, ate: data, motivo: z.string().min(3).max(120) })
  .strict()
  .refine((j) => j.de <= j.ate, { message: 'início depois do fim' });

/**
 * Janelas de referência das festas de fim de ano da onda 2 (cap-14 §14.10.2). O calendário de versões vigente fica
 * no ESTADO.md; estas são o padrão até o dono ajustar.
 */
export const JANELAS_SEM_VERSAO_PADRAO: readonly JanelaSemVersao[] = [
  { de: '2026-12-24', ate: '2026-12-27', motivo: 'Natal' },
  { de: '2026-12-31', ate: '2027-01-03', motivo: 'Ano-novo' },
];

// ---------------------------------------------------------------------------------------------------------------
// Registro do critério por setor e hospital (campo 11; regra 1). Decisão do M40 (D-REG-40): o registro vive na mesma
// tabela da lista para ligar da onda 1 (SGH_CFG_COEX_LIGAR, M39: hospital × setor × item, com a situação, a evidência,
// a data e quem alterou pelo login), e não num arquivo por setor: o comitê registra pela tela, com a trilha, e o
// critério é avaliado pela API. Dois itens são calculados e nunca se registram à mão: as operações (catálogo) e o
// teste de invasão (matriz de achados do M36). A evidência é caminho, chamado ou ata: nunca nome de pessoa nem dado
// de paciente (o esquema recusa).

/** Itens calculados (nunca registrados à mão). */
export const ITENS_CALCULADOS_ONDA_2: readonly ItemCriterioLiberacao[] = [
  'operacoes-conferidas',
  'pentest-sem-critico',
];

/** Itens que o comitê registra pela tela (os demais do critério). */
export const ITENS_REGISTRAVEIS_ONDA_2: readonly ItemCriterioLiberacao[] = ITENS_CRITERIO_LIBERACAO.filter(
  (i) => !ITENS_CALCULADOS_ONDA_2.includes(i),
);

export const SITUACOES_ITEM_CRITERIO = ['cumprido', 'pendente', 'nao-se-aplica'] as const;

/**
 * Itens que nunca aceitam "não se aplica" (regras 1, 2, 4, 5, 6, 9, 11 e 12): a autorização do dono, o aceite, o
 * treinamento, os ensaios de recolhimento e de retorno e as condições próprias do setor (que só entram no critério do
 * setor que as tem). Só "cumprido" os satisfaz; os demais (estações, carga, apoio) podem não se aplicar ao setor.
 */
export const ITENS_SEM_NAO_SE_APLICA_ONDA_2: readonly ItemCriterioLiberacao[] = [
  'aceite-jornada',
  'treinamento-concluido',
  'autorizacao-do-dono',
  'recolhimento-ensaiado',
  'retorno-ensaiado',
  'relatorio-contingencia',
  'pep-aberto-no-outro-sistema',
  'unidade-piloto',
  'inventario-recente',
  'documentos-conferidos',
  'prescricao-na-unidade',
  'conferencia-numerica',
  'abertura-da-competencia',
  'reproducao-sem-diferenca',
  'registros-conferidos',
];
export type SituacaoItemCriterio = (typeof SITUACOES_ITEM_CRITERIO)[number];

/** Um item registrado (o que a tabela guarda), sem quem alterou. */
export interface ItemCriterioRegistrado {
  readonly item: ItemCriterioLiberacao;
  readonly situacao: SituacaoItemCriterio;
  readonly evidencia: string;
  readonly em: string | null;
}

/**
 * Evidência sem dado pessoal: caminho, número de chamado ou de ata. Recusa sequência longa de dígitos (o formato de
 * CPF, CNS, telefone ou prontuário) e o sinal de e-mail (o mesmo critério da lista da onda 1).
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

export const esquemaGravarItensOnda2 = z.object({
  itens: z
    .array(
      z.object({
        item: z.enum(ITENS_CRITERIO_LIBERACAO).refine((i) => !ITENS_CALCULADOS_ONDA_2.includes(i), {
          message:
            'As operações e o teste de invasão são calculados (catálogo e matriz de achados): não se registram à mão.',
        }),
        situacao: z.enum(SITUACOES_ITEM_CRITERIO),
        evidencia: evidenciaSemPessoal.default(''),
        em: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.')
          .nullable()
          .default(null),
      }),
    )
    .min(1)
    .max(ITENS_CRITERIO_LIBERACAO.length)
    .refine((xs) => new Set(xs.map((x) => x.item)).size === xs.length, 'Cada item só uma vez.')
    .refine(
      (xs) => xs.every((x) => x.situacao === 'pendente' || (x.evidencia.length >= 3 && x.em !== null)),
      'Item cumprido ou que não se aplica precisa da evidência e da data.',
    )
    .refine(
      (xs) =>
        xs.every((x) => x.situacao !== 'nao-se-aplica' || !ITENS_SEM_NAO_SE_APLICA_ONDA_2.includes(x.item)),
      'Autorização do dono, aceite, treinamento, ensaios de recolhimento e de retorno e as condições do setor não admitem "não se aplica": só cumprido ou pendente.',
    ),
  justificativa: textoCp1252(200).pipe(z.string().trim().min(10, 'Justifique com pelo menos 10 caracteres.')),
  senha: z.string().max(200).optional(),
});
export type GravarItensOnda2 = z.infer<typeof esquemaGravarItensOnda2>;

/**
 * Estados de operação desligada pela POL-3 (a prova falta): a operação fica no outro sistema e não segura a liberação
 * do setor; a tela do novo fica só de consulta para ela (D-OPS-40). As verdes precisam chegar a `conferida`.
 * `bloqueada` só fica fora quando é desde a origem: a que já foi conferida no hospital e voltou a `bloqueada` (recolhida,
 * regra 4) ou que divergiu na reexecução das assinaturas (regra 6 do M36) segura o setor até voltar à conferência
 * (@sgh/dominio-config, operacaoForaDaOnda).
 */
export const ESTADOS_FORA_DA_ONDA: readonly string[] = ['especificada', 'referencia', 'bloqueada'];

/** Código da recusa do lote de um setor da onda 2 com o critério incompleto (regra 1). */
export const CODIGO_CRITERIO_ONDA_2_INCOMPLETO = 'criterio-onda2-incompleto';

// ---------------------------------------------------------------------------------------------------------------
// Painel da onda 2 (aba do painel de migração gradual do M37)

const itemAvaliado = z
  .object({
    item: z.enum(ITENS_CRITERIO_LIBERACAO),
    rotulo: z.string(),
    ok: z.boolean(),
    /** `calculado` para os dois itens que não se registram; os demais, a situação registrada. */
    origem: z.enum(['calculado', 'registrado']),
    situacao: z.enum(SITUACOES_ITEM_CRITERIO),
    falta: z.string().nullable(),
    detalhe: z.string(),
  })
  .strict();

export const esquemaSetorOnda2 = z
  .object({
    setor: z.string(),
    nome: z.string(),
    /** Passo da ordem recomendada (1 = primeiro; campo 12). */
    passo: z.number().int().min(1),
    podeLiberar: z.boolean(),
    itens: z.array(itemAvaliado),
    registrados: z.array(
      z
        .object({
          item: z.string(),
          situacao: z.enum(SITUACOES_ITEM_CRITERIO),
          evidencia: z.string(),
          em: z.string().nullable(),
          alteradoPor: z.string(),
          alteradoEm: z.string(),
        })
        .strict(),
    ),
    /**
     * Operações de gravação do setor com o estado no hospital. `fora`: a operação está desligada pela POL-3
     * (especificada, em referência ou bloqueada) e fica no outro sistema nesta onda; não segura o setor (D-OPS-40).
     */
    operacoes: z.array(z.object({ nome: z.string(), estado: z.string(), fora: z.boolean() }).strict()),
    /** Regra 6: recursos do setor que só existem no novo (o que o relatório de contingência imprime). */
    recursosSoNoNovo: z.array(z.object({ chave: z.string(), imprime: z.string() }).strict()),
    /** Regra 4: o que o recolhimento desliga (chaves) e bloqueia (operações liberadas). */
    recolhimento: z.object({ chaves: z.array(z.string()), bloquear: z.array(z.string()) }).strict(),
  })
  .strict();
export type SetorOnda2 = z.infer<typeof esquemaSetorOnda2>;

export const esquemaPainelOnda2 = z
  .object({
    estabelecimento: z.string(),
    /** DP-4: o hospital em que as ondas começam. */
    primeiro: z.string(),
    /** Regra 8: setores do hospital inicial que ainda seguram este hospital (vazio: pode começar). */
    seguramHospital: z.array(z.string()),
    ordem: z.array(z.array(z.string())),
    setores: z.array(esquemaSetorOnda2),
    /** Itens calculados: pentest (M36). */
    pentest: z.object({ bloqueia: z.boolean(), motivo: z.string() }).strict(),
    /** Regra 16: a data de hoje e se uma versão nova pode sair (só hotfix de S1 nas janelas). */
    versao: z
      .object({
        hoje: z.string(),
        permitida: z.boolean(),
        motivo: z.string().nullable(),
        janelas: z.array(z.object({ de: z.string(), ate: z.string(), motivo: z.string() }).strict()),
      })
      .strict(),
    /** Regra 14: códigos com a legenda "a confirmar". */
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
export type PainelOnda2 = z.infer<typeof esquemaPainelOnda2>;

// ---------------------------------------------------------------------------------------------------------------
// Acompanhamento da onda (campo 4): agregados diários sem dado de pessoa

const codigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{0,9}$/);

/** Período do acompanhamento (até 62 dias; o leitor recusa acima). */
export const esquemaConsultaAcompanhamento = z
  .object({ de: data, ate: data })
  .refine((p) => p.de <= p.ate, { message: 'início depois do fim' })
  .refine((p) => (Date.parse(`${p.ate}T00:00:00Z`) - Date.parse(`${p.de}T00:00:00Z`)) / 86_400_000 <= 62, {
    message: 'período acima de 62 dias',
  });

export const esquemaAcompanhamentoOnda2 = z
  .object({
    estabelecimento: codigoEstabelecimento,
    de: data,
    ate: data,
    /** Checagem: horários do dia por unidade e quantos têm administração registrada (A ou N). */
    checagem: z.array(
      z
        .object({
          dia: data,
          unidade: z.string(),
          horarios: z.number().int().min(0),
          checados: z.number().int().min(0),
          percentual: z.number().min(0).max(100),
        })
        .strict(),
    ),
    /** Higienização: solicitações do dia e quantas avançaram além do primeiro estado (no outro sistema ou no novo). */
    higienizacao: z.array(
      z
        .object({
          dia: data,
          unidade: z.string(),
          solicitacoes: z.number().int().min(0),
          avancaram: z.number().int().min(0),
          percentual: z.number().min(0).max(100),
        })
        .strict(),
    ),
    /** Registros clínicos e prescrições do dia: total no banco e quantos o novo gravou (trilha). */
    registros: z.array(
      z
        .object({
          dia: data,
          tipo: z.enum(['evolucao', 'prescricao']),
          total: z.number().int().min(0),
          peloNovo: z.number().int().min(0),
          peloOutro: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type AcompanhamentoOnda2 = z.infer<typeof esquemaAcompanhamentoOnda2>;

// ---------------------------------------------------------------------------------------------------------------
// Relatório de contingência por posto (regra 6; cap-14 §14.8 e §14.8.1). Dado de paciente: o PDF vai só ao armazém de
// documentos (S3, com o hash no registro das emissões), a leitura é auditada e nada vai a log nem ao repositório.

/** Unidade de internação (o bloco do leito), como a linha do tempo do turno da enfermagem. */
const unidadePosto = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 ._-]{1,5}$/, 'Escolha a unidade.');

export const esquemaPedidoContingencia = z
  .object({
    unidade: unidadePosto,
    /** Horizonte dos horários aprazados, em horas a partir de agora. */
    horas: z.number().int().min(2).max(12).default(6),
  })
  .strict();
export type PedidoContingencia = z.infer<typeof esquemaPedidoContingencia>;

export const TITULO_RELATORIO_CONTINGENCIA = 'Relatório de contingência do posto';

/** Parâmetros (SGH_CFG_PARAMETRO): os postos com a geração automática a cada hora e o horizonte dos horários. */
export const PARAMETRO_CONTINGENCIA_POSTOS = 'enfermagem.contingenciaPostos';
export const PARAMETRO_CONTINGENCIA_HORAS = 'enfermagem.contingenciaHoras';

/** O que o relatório traz de cada paciente do posto (montado pela API a partir das leituras; nunca a log). */
export interface PacienteContingencia {
  readonly leito: string;
  readonly nome: string;
  readonly atendimento: number;
  readonly alergias: readonly string[];
  /** Há alergia registrada (o nome pode faltar no cadastro). */
  readonly temAlergia: boolean;
  /** Itens da prescrição vigente (descrição, dose e via), sem repetir. */
  readonly prescricao: readonly string[];
  /** Horários aprazados no horizonte (AAAA-MM-DDTHH:mm e o item). */
  readonly horarios: readonly { readonly previsto: string; readonly descricao: string }[];
  /** Recursos que só existem no novo (regra 6). */
  readonly sinais: readonly { readonly tipo: string; readonly valor: string; readonly em: string }[];
  readonly problemas: readonly string[];
  readonly justificativas: readonly string[];
  readonly amostras: readonly { readonly codigo: string; readonly estado: string }[];
  /**
   * Alergias, lista de problemas e amostras deste paciente não foram lidos (teto da leitura): o papel diz "não lido:
   * consulte o prontuário" em vez de "nenhum registro".
   */
  readonly extrasNaoLidos?: boolean;
}

export interface RelatorioContingencia {
  readonly unidade: string;
  readonly geradoEm: string;
  readonly horizonte: { readonly de: string; readonly ate: string };
  readonly pacientes: readonly PacienteContingencia[];
  /** Leitos da unidade com limpeza em andamento no novo (etapa e prazo). */
  readonly limpezas: readonly {
    readonly leito: string;
    readonly etapa: string;
    readonly prazo: string | null;
  }[];
  /** A leitura dos horários, ou a dos registros de algum paciente, foi cortada pelo teto (o relatório avisa). */
  readonly cortado: boolean;
  /** Pacientes sem a leitura de alergias, problemas e amostras (teto); 0 ou ausente quando todos foram lidos. */
  readonly extrasCortados?: number;
}

/** Resposta da geração (o PDF vai em separado, pela rota do documento). */
export const esquemaContingenciaGerada = z
  .object({
    unidade: z.string(),
    pacientes: z.number().int().min(0),
    horarios: z.number().int().min(0),
    geradoEm: z.string(),
    documento: z.string(),
    cortado: z.boolean(),
  })
  .strict();
export type ContingenciaGerada = z.infer<typeof esquemaContingenciaGerada>;
