// Funcionalidades por estabelecimento (POL-3, 2026-10-19; DP-4; cap-09 §9.13; cap-15 §15.3.2; ADR 0019):
// todo recurso construído completo e DESLIGADO aparece na tela com descrição, estado e pré-requisitos; o
// administrador liga por estabelecimento, setor, grupo ou pessoa, sem nova implantação, com reautenticação e
// trilha. Recurso com pré-requisito externo pendente não liga (a tela diz o que falta). Liberação em lote
// (DP-4): a mesma chave aceita uma lista de setores, grupos ou usuários numa ação só, reversível.
// As chaves ficam em SGH_CFG_LIBERACAO (M04, expandida no M08 com o tipo `recurso`, o grupo e o lote); os
// pré-requisitos em SGH_CFG_PREREQUISITO (situação, validade e evidência sem segredo; o certificado em si
// fica no cofre). As chaves de OPERAÇÃO (gravação no legado) são as do catálogo docs/operacoes/catalogo.
import { z } from 'zod';
import { CATALOGOS, chaveResponsavelCatalogo } from '../catalogo/definicoes.js';
import { chaveLiberacaoRelatorio, RELATORIOS_CATALOGO } from '../relatorio/catalogo.js';
import { CHAVES_FATIA_OPERADORA } from '../operadora/chaves.js';
import { textoCp1252 } from '../texto-cp1252.js';

export const TIPOS_PREREQUISITO = ['certificado', 'credenciamento', 'contrato', 'aprovacao'] as const;
export type TipoPrerequisito = (typeof TIPOS_PREREQUISITO)[number];

export const SITUACOES_PREREQUISITO = ['pendente', 'cumprido', 'dispensado'] as const;
export type SituacaoPrerequisito = (typeof SITUACOES_PREREQUISITO)[number];

export const ESCOPOS_LIBERACAO = ['hospital', 'setor', 'grupo', 'pessoa'] as const;
export type EscopoLiberacao = (typeof ESCOPOS_LIBERACAO)[number];

export interface PrerequisitoDeclarado {
  readonly tipo: TipoPrerequisito;
  readonly descricao: string;
  /** Quem providencia (papel; nunca nome). */
  readonly responsavel: string;
}

export interface RecursoDesligado {
  /** Chave da funcionalidade (`<modulo>.<recurso>`; o tipo `recurso` a distingue das de operação). */
  readonly chave: string;
  readonly titulo: string;
  readonly descricao: string;
  /** Decisão ou política que o mandou construir completo e desligado. */
  readonly decisao: string;
  /** Marco que constrói o recurso (até lá, a chave existe e a tela diz "em construção"). */
  readonly marco: string;
  readonly prerequisitos: readonly PrerequisitoDeclarado[];
}

/** Recursos construídos completos e desligados (POL-3; ESTADO.md, decisões de 2026-10-19; nomes das chaves do roteiro). */
export const RECURSOS_DESLIGADOS: readonly RecursoDesligado[] = [
  // Ficha do M50, seção 12 (etapa 6): a agenda de sessões e recursos (DP-32: itens sob demanda; construída e desligada
  // até o serviço existir) e a digitalização certificada do SAME. Desligadas, as terapias seguem marcadas como hoje e o
  // papel segue no arquivo; as telas ficam em consulta.
  {
    chave: 'sessoes',
    titulo: 'Agenda de sessões e recursos (cadeiras e salas)',
    descricao:
      'Série de sessões de um plano terapêutico (quimioterapia, infusão, fisioterapia, hemodiálise) em cadeira ou sala, sem sobreposição do recurso nem do paciente, com a complexidade, a duração e a faixa etária do recurso; a sessão realizada, a falta e o cancelamento.',
    decisao: 'POL-1, POL-3, DP-32 e ficha do M50 (seção 12; regra 11)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'O serviço de terapias em série existe no estabelecimento (DP-32: quimioterapia, terapias) e as cadeiras e salas estão cadastradas com a complexidade, a duração e a faixa etária conferidas pela coordenação do serviço.',
        responsavel: 'diretoria clínica e coordenação do serviço de terapias',
      },
    ],
  },
  {
    chave: 'digitalizacao',
    titulo: 'Digitalização certificada do prontuário (Lei 13.787/2018)',
    descricao:
      'Captura do papel com o resumo SHA-256 e o arquivo com retenção, indexação (prontuário, internação, tipo documental, data, páginas, resolução), conferência da fidelidade por outra pessoa e assinatura ICP-Brasil de quem conferiu com o carimbo do tempo; nenhum papel é eliminado pelo sistema.',
    decisao: 'POL-3 e ficha do M50 (seção 12; regra 12)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Fluxo de digitalização aprovado pela comissão de revisão de prontuários (tipos documentais, resolução, conferência, quem assina) e um lote digitalizado e conferido na cópia com o SAME.',
        responsavel: 'comissão de revisão de prontuários e SAME',
      },
      {
        tipo: 'certificado',
        descricao:
          'Certificado ICP-Brasil de quem confere e assina, vinculado em Meu certificado, e o carimbo do tempo da ACT configurado no serviço de assinatura.',
        responsavel: 'SAME e TI',
      },
    ],
  },
  {
    // Ficha do M15, seção 12: onda 0, por estabelecimento e setor; recolher = desligar (a consulta volta a ser
    // feita só no sistema que o estabelecimento já usa).
    chave: 'pep.prontuario.consulta',
    titulo: 'Prontuário ao vivo (consulta)',
    descricao:
      'Consulta do prontuário do paciente: registros, documento como emitido, respostas e contexto do ato, com o motivo de acesso e a trilha de cada leitura.',
    decisao: 'POL-3 e ficha do M15 (seção 12)',
    marco: 'M15',
    prerequisitos: [],
  },
  {
    // Ficha do M22, seção 12: onda 2 (M40), modelo a modelo (os modelos liberados vão no parâmetro
    // pep.evolucao.modelosLiberados), por estabelecimento, setor e pessoa; recolher = desligar (os profissionais
    // voltam a registrar como hoje; o que foi gravado continua no prontuário único).
    chave: 'pep.evolucao.registro',
    titulo: 'Registro clínico nos modelos do formulário',
    descricao:
      'Anamnese, evolução e escalas nos modelos de formulário do estabelecimento, com rascunho, finalização, impressão e suspensão com justificativa.',
    decisao: 'POL-3 e ficha do M22 (seção 12)',
    marco: 'M22',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência modelo a modelo pelos chave-usuários médico e enfermeiro: o registro gravado abre, aparece e imprime corretamente em todas as telas do prontuário (DP-3).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  // M16 (ficha, seção 12): onda 0, primeiro o pc; recolher = desligar por estabelecimento (as pessoas voltam aos
  // relatórios e ao mapa de leitos que o estabelecimento já usa).
  {
    chave: 'internacao.leitos.painel',
    titulo: 'Painel de leitos ao vivo e censo diário (consulta)',
    descricao:
      'Ocupação dos leitos ao vivo por bloco e acomodação, a divergência de cadastro de leitos e o censo hospitalar diário calculado do movimento.',
    decisao: 'POL-3 e ficha do M16 (seção 12)',
    marco: 'M16',
    prerequisitos: [],
  },
  {
    chave: 'relatorio.paineis',
    titulo: 'Painéis gerenciais e indicadores hospitalares',
    descricao:
      'Painéis assistencial, operacional e financeiro (duas réguas de receita) e os indicadores da Portaria SAS 312/2002 e da ANAHP com ficha técnica.',
    decisao: 'POL-3 e ficha do M16 (seção 12)',
    marco: 'M16',
    prerequisitos: [],
  },
  {
    // Ligada com a onda 2 (M40), junto do mapa operacional; até lá, o censo de qualquer dia é calculado na hora.
    chave: 'internacao.censo.fechamento',
    titulo: 'Fechamento automático do censo diário',
    descricao:
      'Na hora de fechamento, o retrato do censo do dia é guardado por unidade (uma vez só por dia e estabelecimento; nunca regravado).',
    decisao: 'POL-3 e ficha do M16 (seção 12: ligada com a onda 2)',
    marco: 'M16',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Hora de fechamento do censo definida pela coordenação de leitos e conferência do censo calculado com o mapa de leitos (DP-3).',
        responsavel: 'coordenação de leitos',
      },
    ],
  },
  {
    chave: 'relatorio.bi',
    titulo: 'Análise livre no BI',
    descricao:
      'Data mart pseudonimizado (sem nome, documento, contato nem texto clínico) carregado da cópia diária, aberto na ferramenta de BI.',
    decisao: 'POL-3, ficha do M16 (seção 12) e ADR 0025',
    marco: 'M16',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao: 'Servidor da cópia diária de produção configurado (DP-15: no deploy).',
        responsavel: 'dono do projeto',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Encarregado de dados (DPO) confere o data mart sem dado pessoal e a guarda da chave do pseudônimo.',
        responsavel: 'encarregado de dados',
      },
    ],
  },
  {
    // Ficha do M17, seção 12: onda 1 (M39), primeiro pc; chave por estabelecimento, setor e pessoa; recolher =
    // desligar (a agenda do setor volta a ser operada só no outro sistema sobre os mesmos dados).
    chave: 'agenda.consulta',
    titulo: 'Agenda de consultas (marcação, encaixe, remarcação, cancelamento e confirmação)',
    descricao:
      'Marcação, encaixe, remarcação, confirmação, cancelamento com motivo, bloqueios, geração de horários e lista de espera da agenda ambulatorial, sobre as mesmas grades.',
    decisao: 'POL-3 e ficha do M17 (seção 12)',
    marco: 'M17',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelos chave-usuários do call center e da recepção ambulatorial: marcar, encaixar, desfazer, cancelar e remarcar por estas telas e conferir a mesma agenda aberta no balcão da recepção, e o inverso (DP-3).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  // Ficha do M23, seção 12: onda 2 (médicos, residentes e multiprofissional), primeiro o pc. Os atos que gravam no
  // banco do estabelecimento só ligam depois da conferência no outro sistema (alergia no cabeçalho e na prescrição,
  // pedido de exame na pauta do SADT, receita e atestado abrindo e imprimindo, sumário de alta, anexo); até lá, a
  // tela mostra tudo em consulta. Os recursos só do novo (fila de parecer, lista de problemas, ciência de crítico,
  // assinatura em lote) não gravam no legado e podem ligar antes. Recolher = desligar.
  ...(
    [
      [
        'pep.documentos.emissao',
        'Receitas, atestados, termos, sumário de alta e óbito',
        'Emissão de receita (simples, de controle especial e de antimicrobiano), atestado, declaração, requerimento, termo de consentimento, sumário de alta, relatório de transferência e declaração de óbito, com PDF/A, hash e validação pelo QR.',
        'Conferência na cópia de homologação: receita, atestado e sumário emitidos aqui abrem e imprimem no outro sistema (médicos chave-usuários e diretoria clínica).',
      ],
      [
        'pep.alergia.registro',
        'Registro de alergias',
        'Registro e retirada de alergias e de "nega alergias" no registro clínico do atendimento, com reação, gravidade e origem da informação.',
        'Conferência na cópia de homologação: a alergia registrada aqui aparece no cabeçalho e na prescrição do outro sistema.',
      ],
      [
        'pep.exame.solicitacao',
        'Solicitação de exames',
        'Pedido de exames individual ou por kit, com indicação e urgência, avisos de duplicidade e de incompatibilidade de sexo ou idade.',
        'Conferência na cópia de homologação: o pedido feito aqui aparece na pauta e no lançamento do SADT do outro sistema, com a pendência criada.',
      ],
      [
        'pep.anexo.registro',
        'Anexos e exames externos',
        'Inclusão de documento digitalizado e de resultado de exame externo no prontuário.',
        'Conferência na cópia de homologação: o anexo e o exame externo incluídos aqui abrem no outro sistema.',
      ],
    ] as const
  ).map(([chave, titulo, descricao, conferencia]) => ({
    chave,
    titulo,
    descricao,
    decisao: 'POL-3 e ficha do M23 (seção 12)',
    marco: 'M23',
    prerequisitos: [
      { tipo: 'aprovacao' as const, descricao: conferencia, responsavel: 'responsável técnico' },
    ],
  })),
  ...(
    [
      [
        'pep.interconsulta.fila',
        'Fila de parecer e interconsulta',
        'Fila de pareceres por especialidade ou categoria, com prioridade, prazo e situação; o pedido e a resposta continuam nos modelos de registro clínico.',
      ],
      [
        'pep.problema.lista',
        'Lista de problemas e diagnósticos',
        'Problemas e diagnósticos do paciente (CID-10, início, fim e situação), com histórico de versões.',
      ],
      [
        'pep.resultado.ciencia',
        'Ciência de valor crítico',
        'Resultado com valor crítico destacado e ciência obrigatória com a conduta, venha a liberação de qualquer sistema.',
      ],
      [
        'documento.assinatura.lote',
        'Pendências de assinatura e assinatura em lote',
        'Lista dos documentos emitidos e ainda não assinados, prévia exata, assinatura eletrônica avançada um a um ou em lote e aviso ao sair.',
      ],
    ] as const
  ).map(([chave, titulo, descricao]) => ({
    chave,
    titulo,
    descricao,
    decisao: 'POL-3 e ficha do M23 (seção 12: recurso só do novo, pode ligar antes)',
    marco: 'M23',
    prerequisitos: [],
  })),
  {
    // Ficha do M19, seção 12: onda 1 (M39), primeiro pc; chave por estabelecimento, setor (a recepção) e pessoa;
    // recolher = desligar (o guichê volta ao outro sistema; o painel do novo pode continuar só lendo).
    chave: 'recepcao.senha',
    titulo: 'Recepção: emissão, chamada e condução de senhas, totem e check-in',
    descricao:
      'Emitir senha no balcão e no totem, chamar pelo guichê, chamar de novo, suspender, concluir, encaminhar entre locais e registrar a chegada do agendado, sobre as mesmas filas do outro sistema.',
    decisao: 'POL-3 e ficha do M19 (seção 12)',
    marco: 'M19',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Turno simulado na cópia com guichês nos dois sistemas: a senha emitida aqui aparece na fila do outro e vice-versa, nenhuma numeração repetida no dia, a ordem de prioridade e as obrigatoriedades conferidas com o supervisor da recepção (DP-3).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    // Ficha do M18, seção 12: onda 1 (M39), primeiro pc, e só com a correção da sante-api (DP-8): sem ela, a chave
    // não é ligada e a agenda de exames do setor segue no outro sistema (o relatório de resíduo e o aviso de
    // marcação incompleta ficam ligados). Chave por estabelecimento, setor e pessoa; recolher = desligar.
    chave: 'agenda.exame',
    titulo: 'Agenda de exames (marcação, cancelamento, remarcação e geração de horários)',
    descricao:
      'Marcação de exame com o prontuário, cancelamento com motivo, remarcação, geração da grade e convênios e exames cobertos da agenda de exames, sobre as mesmas grades.',
    decisao: 'POL-3, DP-8 e ficha do M18 (seção 12)',
    marco: 'M18',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelo chave-usuário da central de exames: marcar, cancelar e remarcar por estas telas e abrir a mesma marcação no balcão do outro sistema (completa, com o prontuário), e o inverso (DP-3).',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Correção do serviço de integração que hoje grava o exame sem a marcação e cancela com a situação de confirmado (DP-8), pedida à equipe responsável pela integração.',
        responsavel: 'dono do projeto',
      },
    ],
  },
  {
    // Ficha do M18, seção 12: onda 2 (M40), por bloco inteiro (secretaria, cirurgiões e coordenação).
    chave: 'cirurgia.agenda',
    titulo: 'Agenda cirúrgica (mapa de salas, solicitação, confirmação, remarcação e cancelamento)',
    descricao:
      'Mapa das salas com a recusa de sobreposição, solicitação de sala, confirmação, remarcação, cancelamento auditável e pendências pré-operatórias, sobre o mesmo mapa.',
    decisao: 'POL-3 e ficha do M18 (seção 12)',
    marco: 'M18',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pela secretaria do bloco e pela coordenação do centro cirúrgico: agendar, mover e cancelar por estas telas e conferir o mapa e o histórico no outro sistema; tentar sobrepor pelo outro sistema e ver o alerta aqui (DP-3).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'cirurgia.registro',
    titulo: 'Registro do ato cirúrgico (procedimentos, equipe e tempos)',
    descricao:
      'Registro da cirurgia realizada com os procedimentos, a equipe por função e os tempos, para os gatilhos e o faturamento seguirem como hoje.',
    decisao: 'POL-3 e ficha do M18 (seção 12)',
    marco: 'M18',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pela coordenação do centro cirúrgico: registrar o ato por esta tela e abrir a mesma cirurgia no outro sistema (procedimentos, equipe e tempos), e a conta do paciente sem lançamento novo (DP-3).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    // Ficha do M24, seção 12: onda 2 (médicos, residentes e nutricionistas), unidade a unidade, primeiro `pc`, só
    // depois de o M22 e o M23 estarem conferidos; recolher = desligar (prescreve-se como hoje, sobre os mesmos dados,
    // e o novo mostra a prescrição em consulta). Cada operação de gravação tem ainda a sua chave do catálogo.
    chave: 'pep.prescricao.cpoe',
    titulo: 'Prescrição eletrônica (CPOE)',
    descricao:
      'Prescrição item a item com horários previstos, alertas de apoio à decisão com justificativa, cópia, renovação, adendo, suspensão e correção, protocolos e kits.',
    decisao: 'POL-3 e ficha do M24 (seção 12)',
    marco: 'M24',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelos chave-usuários médicos, farmacêutico clínico e nutricionista: a prescrição feita no novo abre no outro sistema com os mesmos itens, doses, vias, frequências e horários, a farmácia a vê para dispensar e a suspensão aparece nos dois (DP-3).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    // Ficha do M24, seção 12: só em SGH_, pode ser ligada antes da prescrição.
    chave: 'pep.reconciliacao.registro',
    titulo: 'Reconciliação medicamentosa',
    descricao:
      'Medicamentos em uso antes da internação e a conduta de cada um na admissão e na alta (manter, suspender, substituir, ajustar).',
    decisao: 'POL-3 e ficha do M24 (seção 12)',
    marco: 'M24',
    prerequisitos: [],
  },
  {
    chave: 'pep.antimicrobiano.ficha',
    titulo: 'Ficha de antimicrobiano',
    descricao:
      'Indicação, sítio, empírico ou dirigido, cultura colhida e dia de tratamento do antimicrobiano prescrito, para a farmácia clínica e o controle de infecção.',
    decisao: 'POL-3 e ficha do M24 (seção 12)',
    marco: 'M24',
    prerequisitos: [],
  },
  {
    // Ficha do M20, seção 12: onda 1 (M39) a recepção ambulatorial e a central de exames; onda 2 (M40) o PA. Primeiro
    // pc; chave por estabelecimento, setor e pessoa; recolher = desligar (a tela fica em consulta, com o motivo).
    chave: 'atendimento.ambulatorio',
    titulo: 'Atendimento ambulatorial e central de exames',
    descricao:
      'Abrir a ficha do atendimento externo (consulta, exame, requisição de laboratório), alterar carteirinha e guia, lançar procedimento extra, encerrar e emitir os impressos, sobre a mesma ficha e a mesma conta do outro sistema.',
    decisao: 'POL-3 e ficha do M20 (seção 12)',
    marco: 'M20',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia da ficha aberta aqui: o atendimento e a conta aparecem como se tivessem sido gravados pelo outro sistema, e o lançamento de procedimento extra com o faturamento olhando a conta (DP-33).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'atendimento.pa',
    titulo: 'Pronto atendimento: recepção, quadro, observação e desfecho',
    descricao:
      'Abrir a ficha do pronto atendimento, acompanhar o paciente no quadro por etapa, alocar leito ou poltrona de observação e registrar o desfecho (alta, internação, transferência, evasão).',
    decisao: 'POL-3 e ficha do M20 (seção 12)',
    marco: 'M20',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Turno simulado do pronto atendimento na cópia com a recepção e os médicos do PA: ficha, quadro, observação e desfecho conferidos, e o desfecho clínico só por médico com conselho ativo.',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'atendimento.cancelar',
    titulo: 'Exclusão de atendimento externo (supervisor)',
    descricao:
      'Excluir o atendimento aberto por engano, com o motivo, mostrando antes o que será desfeito (conta, ligações, senha).',
    decisao: 'POL-3 e ficha do M20 (seção 12)',
    marco: 'M20',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado na cópia com o faturamento olhando a conta: a exclusão deixa ficha, cabeçalho, conta e itens como o outro sistema deixa (Fase 4, M36).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  // Ficha do M26, seção 12: onda 2 (cap-15 §15.3.3), laboratório, imagem e SADT, primeiro no pc; chave por
  // operação, estabelecimento e setor do diagnóstico; recolher = desligar (o setor volta ao outro sistema sobre os
  // mesmos dados). O rastreio de amostra e o valor crítico com ciência podem ser ligados antes (só no novo).
  {
    chave: 'sadt.laboratorio',
    titulo: 'Laboratório: receber, lançar, digitar, liberar e emitir',
    descricao:
      'Receber o pedido do prontuário, lançar exame no setor, digitar o resultado, liberar pelo responsável técnico, retificar e emitir o laudo com autenticação, sobre os mesmos exames do outro sistema.',
    decisao: 'POL-3 e ficha do M26 (seção 12)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelos chave-usuários do laboratório (técnico e biomédico ou bioquímico): o exame lançado, recebido, digitado e liberado aqui aparece no outro sistema com a mesma pendência e abre no portal de lá; o laudo emitido aparece nas emissões de lá com o mesmo código (ficha do M26, seção 12).',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Lançamento do exame recebido ou lançado na conta do atendimento (o outro sistema lança o item na conta ao receber ou lançar; o faturamento do novo, M30, faz essa parte): até lá, receber e lançar ficam com o outro sistema.',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'sadt.imagem',
    titulo: 'Imagem: receber, lançar, laudar e emitir',
    descricao:
      'Receber o pedido, lançar o exame de radiologia, tomografia ou ultrassonografia, escrever e assinar o laudo (privativo de médico) e emitir com autenticação.',
    decisao: 'POL-3 e ficha do M26 (seção 12)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelos chave-usuários da imagem (médico laudador): o exame lançado, recebido, digitado e liberado aqui aparece no outro sistema com a mesma pendência e abre no portal de lá; o laudo emitido aparece nas emissões de lá com o mesmo código (ficha do M26, seção 12).',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Lançamento do exame recebido ou lançado na conta do atendimento (o outro sistema lança o item na conta ao receber ou lançar; o faturamento do novo, M30, faz essa parte): até lá, receber e lançar ficam com o outro sistema.',
        responsavel: 'faturamento',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Inventário de onde se laudam hoje os exames de imagem (sistema externo, arquivo ou texto livre: DP-16): os setores que laudam no outro sistema usam o editor daqui; os laudos externos ficam onde estão.',
        responsavel: 'TI do hospital e diretoria clínica',
      },
    ],
  },
  {
    chave: 'sadt.metodosGraficos',
    titulo: 'Métodos gráficos: laudo estruturado do eco, ECG, Holter e ergometria',
    descricao:
      'Receber, lançar e laudar os métodos gráficos (privativo de médico), com as grandezas do laudo estruturado do ecocardiograma.',
    decisao: 'POL-3 e ficha do M26 (seção 12)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelos chave-usuários dos métodos gráficos (médico laudador): o exame lançado, recebido, digitado e liberado aqui aparece no outro sistema com a mesma pendência e abre no portal de lá; o laudo emitido aparece nas emissões de lá com o mesmo código (ficha do M26, seção 12).',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Lançamento do exame recebido ou lançado na conta do atendimento (o outro sistema lança o item na conta ao receber ou lançar; o faturamento do novo, M30, faz essa parte): até lá, receber e lançar ficam com o outro sistema.',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'sadt.endoscopia',
    titulo: 'Endoscopia: receber, lançar e laudar',
    descricao: 'Receber, lançar e laudar os exames de endoscopia (privativo de médico).',
    decisao: 'POL-3 e ficha do M26 (seção 12)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelos chave-usuários da endoscopia (médico laudador): o exame lançado, recebido, digitado e liberado aqui aparece no outro sistema com a mesma pendência e abre no portal de lá; o laudo emitido aparece nas emissões de lá com o mesmo código (ficha do M26, seção 12).',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Lançamento do exame recebido ou lançado na conta do atendimento (o outro sistema lança o item na conta ao receber ou lançar; o faturamento do novo, M30, faz essa parte): até lá, receber e lançar ficam com o outro sistema.',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'sadt.requisicao',
    titulo: 'Requisição de exames do atendimento (conta do setor)',
    descricao:
      'Abrir a requisição de exames do atendimento com o convênio, o médico solicitante, a autorização e a guia, quando a conta do setor ainda não existe.',
    decisao: 'POL-3 e ficha do M26 (seção 12)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelos chave-usuários da recepção do diagnóstico: o exame lançado, recebido, digitado e liberado aqui aparece no outro sistema com a mesma pendência e abre no portal de lá; o laudo emitido aparece nas emissões de lá com o mesmo código (ficha do M26, seção 12).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'sadt.orcamento',
    titulo: 'Orçamento particular de exames',
    descricao:
      'Fazer o orçamento particular com validade e convertê-lo em lançamento no atendimento, com os mesmos exames e valores.',
    decisao: 'POL-3 e ficha do M26 (seção 12)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelos chave-usuários da recepção do diagnóstico: o exame lançado, recebido, digitado e liberado aqui aparece no outro sistema com a mesma pendência e abre no portal de lá; o laudo emitido aparece nas emissões de lá com o mesmo código (ficha do M26, seção 12).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'sadt.rastreio',
    titulo: 'Rastreio de amostra e etiqueta na coleta',
    descricao:
      'Código único por amostra com dois identificadores, leitura da pulseira na coleta do internado, etiqueta na hora da coleta e as passagens coletada, em transporte, recebida, em análise, rejeitada e recoleta.',
    decisao: 'POL-3 e ficha do M26 (seção 12: pode ser ligado antes, só no novo)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Impressoras de etiqueta e leitores de pulseira conferidos pela TI nas estações de coleta (cap-15 §15.3.2).',
        responsavel: 'TI do hospital',
      },
    ],
  },
  {
    chave: 'sadt.critico',
    titulo: 'Valor crítico: aviso ativo, ciência e escalonamento',
    descricao:
      'Ao liberar (aqui ou no outro sistema), aviso ativo do valor crítico ao responsável em menos de 1 minuto, ciência obrigatória no prontuário e escalonamento ao plantonista ou supervisor sem ciência no prazo.',
    decisao: 'POL-3 e ficha do M26 (seção 12: pode ser ligado antes, só no novo)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Lista de valores críticos e prazo de comunicação definidos pelo laboratório e aprovados pela diretoria clínica.',
        responsavel: 'diretoria clínica',
      },
    ],
  },
  // Ficha do M50, seção 12: pacientes por convite, começando por um serviço; pc primeiro. Recolher fecha o canal; o
  // que já foi registrado (consentimentos, pedidos) continua valendo.
  {
    chave: 'portal.conta',
    titulo: 'Portal do paciente: conta, documentos, responsável legal e privacidade',
    descricao:
      'Conta própria do paciente com segundo fator, por convite do hospital; resultados liberados e documentos assinados; acesso do responsável legal com prova de vínculo; consentimentos, pedidos do titular e o relatório de quem acessou o próprio prontuário.',
    decisao: 'POL-3 e ficha do M50 (seção 12; DP-44 a)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Termo de uso, política de privacidade do portal, regras do responsável legal (idade da conta própria, provas aceitas) e o que o titular vê no relatório de acessos aprovados pelo encarregado de dados; teste de invasão da superfície pública sem achado crítico ou alto.',
        responsavel: 'encarregado de dados (DPO)',
      },
    ],
  },
  // Ficha do M50, seção 12 (etapa 2): o canal do agendamento online e o pagamento do particular pelo portal. As agendas
  // oferecidas ficam na configuração da agenda online (SGH_AGE_ONLINE_CFG, por agenda); a chave liga o canal no
  // estabelecimento. Recolher fecha o canal: as marcações já gravadas continuam no outro sistema como qualquer outra.
  {
    chave: 'portal.agenda',
    titulo: 'Portal do paciente: agendamento online e pré-check-in',
    descricao:
      'O paciente marca, cancela e remarca pelo portal nas agendas liberadas (as mesmas operações do call center, com o canal "portal"), envia o pré-check-in (contato, documentos, carteirinha e termo) para a recepção conferir e responde a pesquisa de satisfação depois do atendimento.',
    decisao: 'POL-3 e ficha do M50 (seção 12; DP-46.2)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelos chave-usuários do call center e da recepção: a marcação feita pelo portal aparece no outro sistema igual à do call center (cenários portal-* e precheckin conferidos), a colisão com outro canal é transparente e a recepção confere o pré-check-in antes de o cadastro mudar.',
        responsavel: 'chave-usuários do call center e da recepção',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Teste de invasão da superfície pública do portal sem achado crítico ou alto (cap-15 §15.3.2).',
        responsavel: 'TI do hospital',
      },
    ],
  },
  {
    chave: 'portal.pagamento',
    titulo: 'Portal do paciente: pagamento do particular (Pix e cartão)',
    descricao:
      'Cobrança da consulta ou do exame particular pelo portal, por Pix ou cartão no gateway contratado; a confirmação grava o pagamento no caixa do portal (conferido pelo faturamento) uma vez só por transação.',
    decisao: 'POL-3 e ficha do M50 (seção 12)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Autorização do dono para o gateway de pagamento em produção (contrato, credenciais e o endereço do retorno assinado), com a conferência do caixa do portal pelo faturamento.',
        responsavel: 'dono do projeto',
      },
    ],
  },
  // M50, etapa 4 (ficha, seção 12; regra 7; cap-13 §13.7 ponto 18): a teleconsulta (sala de espera no portal, a sala do
  // provedor, o atendimento aberto como consulta) e a teleinterconsulta. Recolher fecha o canal: os atendimentos já
  // abertos continuam no outro sistema como qualquer consulta.
  {
    chave: 'telemedicina',
    titulo: 'Telemedicina: teleconsulta e teleinterconsulta',
    descricao:
      'O paciente entra na sala de espera virtual pelo portal (termo aceito e local informado), o médico abre a sala do provedor e o atendimento como uma consulta, e os documentos do atendimento saem com a marca da telemedicina; o médico também pede e responde teleinterconsulta.',
    decisao: 'POL-3 e ficha do M50 (seção 12; regra 7; cap-13 §13.7 ponto 18)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Resposta do jurídico e do consultor SBIS ao ponto 18 do cap-13 §13.7 (teleconsulta durante a coexistência, com o banco compartilhado e o NGS2): até lá, a telemedicina espera o fim da coexistência.',
        responsavel: 'jurídico e consultor SBIS',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Assinatura digital do M49 em produção (certificado ICP-Brasil dos médicos): a receita e o atestado da teleconsulta saem assinados.',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Autorização do dono para o provedor de teleconsulta em produção (contrato, credenciais, sala sem gravação e servidores no Brasil).',
        responsavel: 'dono do projeto',
      },
    ],
  },
  {
    chave: 'sadt.portal',
    titulo: 'Portal de resultados do paciente e do médico externo',
    descricao:
      'Portal ao lado do portal do outro sistema, sobre os mesmos laudos: o paciente pelo código do protocolo e a data de nascimento, o médico externo pela conta com segundo fator; só exames liberados de setores publicados; toda visualização grava data e IP.',
    decisao: 'POL-3 e ficha do M26 (seção 12; DP-43)',
    marco: 'M26',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Escopo do acesso do médico externo aprovado pelo encarregado de dados (DP-43; proposta: só os pedidos em que ele é o solicitante).',
        responsavel: 'encarregado de dados (DPO)',
      },
    ],
  },
  // Ficha do M48, seção 12: a etapa 1 (notificação de incidentes) é antecipável pela DP-31a e pode ligar antes do resto
  // da fase; pc primeiro, hs depois de tudo pronto no pc (DP-4). Recolher esconde o botão e as telas; o que foi
  // notificado continua no banco para o NSP. Até ligar, o hospital segue o processo atual (planilhas e formulários).
  {
    chave: 'qualidade.notificacao',
    titulo: 'Notificação de incidentes e eventos adversos',
    descricao:
      'O botão "Notificar incidente" em qualquer tela, com ou sem identificação, a triagem e a distribuição pelo NSP, a devolutiva ao notificador pelo número de acompanhamento e os prazos regulatórios com os campos para transcrição no Notivisa.',
    decisao: 'POL-3, DP-31 (a) e ficha do M48 (seção 12)',
    marco: 'M48',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Aceite do NSP na cópia (10 notificações roteirizadas, anônimas e identificadas, com e sem paciente, pelo fluxo inteiro) e ciência do encarregado de dados (DPO) sobre o tratamento dos dados da notificação e o anonimato.',
        responsavel: 'NSP, encarregado de dados e responsável técnico',
      },
    ],
  },
  // Ficha do M48, seção 12: a etapa 3 (CCIH). pc primeiro, hs depois de tudo pronto no pc (DP-4). Recolher esconde as
  // telas da CCIH; dispositivos, fichas de IRAS, liberações e precauções registrados continuam no banco (a precaução
  // aberta segue no mapa de leitos até alguém da CCIH encerrá-la). Nada é gravado no outro sistema.
  {
    chave: 'qualidade.ccih',
    titulo: 'Controle de infecção (CCIH)',
    descricao:
      'A vigilância ativa dos internados, o registro de dispositivos invasivos, a ficha de IRAS com os denominadores automáticos, a liberação e a revisão de antimicrobianos restritos com DDD e DOT, as precauções refletidas no mapa de leitos, a higiene das mãos e os surtos.',
    decisao: 'POL-3 e ficha do M48 (seção 12)',
    marco: 'M48',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Aceite da CCIH (médico e enfermeiro) na cópia: um mês de denominadores conferido contra o censo diário e uma liberação de antimicrobiano restrito pelo fluxo inteiro.',
        responsavel: 'CCIH e responsável técnico',
      },
    ],
  },
  // Ficha do M48, seção 12: a etapa 4 (notificação compulsória). pc primeiro, hs depois de tudo pronto no pc (DP-4).
  // Recolher esconde a fila e a ficha; os casos registrados continuam no banco para a vigilância. Nada é gravado no
  // outro sistema (a carga da lista nacional no cadastro é do importador do catálogo, pela chave do responsável).
  {
    chave: 'qualidade.agravos',
    titulo: 'Notificação compulsória de agravos',
    descricao:
      'A fila de gatilhos (CID notificável, resultado reagente e óbito), o caso com o prazo da periodicidade (imediata em 24 horas, semanal em 7 dias), a ficha SINAN pré-preenchida e o registro da notificação à autoridade sanitária.',
    decisao: 'POL-3, ficha do M48 (seção 12) e DP-47.3',
    marco: 'M48',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Aceite da vigilância epidemiológica hospitalar na cópia: um caso de agravo aberto por CID e notificado pelo fluxo inteiro, com a ficha impressa conferida.',
        responsavel: 'Núcleo de vigilância epidemiológica hospitalar',
      },
    ],
  },
  // Ficha do M48, seção 12: a etapa 5 (gestão da qualidade e envios regulatórios). pc primeiro, hs depois de tudo
  // pronto no pc (DP-4). Recolher esconde as telas da gestão; o que foi registrado continua no banco. Nada é gravado no
  // outro sistema (os cadastros da matriz GUT e das autoridades sanitárias seguem o CRUD genérico, com a receita própria).
  {
    chave: 'qualidade.gestao',
    titulo: 'Gestão da qualidade e envios regulatórios',
    descricao:
      'Gestão documental com revisão e ciência, indicadores com ficha técnica e análise crítica, auditorias internas por checklist, comissões com atas, matriz de riscos GUT, não conformidades, ouvidoria com NPS e os arquivos dos envios regulatórios (PM-QUALISS, IRAS e Notivisa) com resumo SHA-256 e transmissão manual registrada.',
    decisao: 'POL-3, ficha do M48 (seção 12), DP-47.8 e DP-47.9',
    marco: 'M48',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Aceite do escritório da qualidade e da ouvidoria na cópia: um POP publicado com ciência, a análise crítica de um indicador fora da meta, uma auditoria com não conformidade tratada, uma manifestação respondida e um envio gerado e conferido.',
        responsavel: 'Escritório da qualidade',
      },
    ],
  },
  // Ficha do M47, seção 12: agência transfusional. `agencia.transfusao` liga a etapa 1 (requisição, amostra, ato à beira
  // do leito, reação e hemovigilância), escopo comum às duas respostas da DP-21; `agencia.completa` liga a etapa 2
  // (imuno-hematologia, prova cruzada, estoque de bolsas) só com agência própria. pc primeiro; hs depois (DP-4).
  // Recolher = desligar: volta o processo atual (papel e hemocentro).
  {
    chave: 'agencia.transfusao',
    titulo: 'Requisição, ato transfusional e hemovigilância',
    descricao:
      'A requisição transfusional a partir do item de hemoterapia da prescrição, a amostra identificada à beira do leito, o ato com a dupla checagem da bolsa contra a pulseira e os sinais vitais antes, aos 10 a 15 minutos e ao término, a reação transfusional e o painel de hemovigilância.',
    decisao: 'POL-3, DP-4, DP-21 e ficha do M47 (seção 12)',
    marco: 'M47',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Transfusão completa simulada na cópia com reação simulada: o horário do item aparece administrado no prontuário, com o profissional e a hora, e o registro clínico do ato aparece no prontuário.',
        responsavel: 'enfermeiro chave-usuário, comitê transfusional e responsável técnico',
      },
    ],
  },
  {
    chave: 'agencia.completa',
    titulo: 'Agência transfusional completa (imuno-hematologia, prova cruzada e estoque de bolsas)',
    descricao:
      'A tipagem ABO e Rh, a pesquisa de anticorpos irregulares, a prova cruzada, o estoque de bolsas por tipo, validade e situação (quarentena, liberada, reservada, transfundida, descartada) e os cadastros da agência; só com agência própria.',
    decisao: 'POL-1, POL-3 e DP-21 (agência própria ou do hemocentro); ficha do M47 (regra 6)',
    marco: 'M47',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: 'Decisão da DP-21: o hospital tem agência transfusional própria.',
        responsavel: 'diretoria clínica',
      },
    ],
  },
  // Ficha do M50, seção 12 (etapa 3): médicos externos, pc primeiro. Recolher fecha o extrato, a agenda e o pedido pelo
  // portal; os pedidos já feitos continuam na agenda do bloco como qualquer solicitação.
  {
    chave: 'portal.medicoExterno',
    titulo: 'Portal do médico externo: extrato de produção e repasse e agenda cirúrgica',
    descricao:
      'No portal de resultados, o médico externo com a conta ligada ao corpo clínico vê o próprio extrato do repasse e a própria agenda do bloco e pede cirurgia; o pedido fica solicitado, sem ocupar a sala, até a secretaria do bloco confirmar.',
    decisao: 'POL-3 e ficha do M50 (seção 12; DP-43)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Escopo do portal do médico externo aprovado pelo encarregado de dados (DP-43: só a produção, o repasse e as cirurgias em que ele é o cirurgião, com o paciente mascarado) e o fluxo do pedido de cirurgia aceito pela coordenação do bloco cirúrgico.',
        responsavel: 'encarregado de dados (DPO) e coordenação do bloco cirúrgico',
      },
    ],
  },
  // Ficha do M25, seção 12: onda 2, unidade-piloto primeiro (recomendação: CTI), no pc; o hs só depois de todas as ondas
  // no pc (DP-4). Recolher = desligar: a unidade volta ao papel e ao outro sistema; as unidades no papel não mudam.
  {
    chave: 'enfermagem.checagem',
    titulo: 'Checagem da administração à beira do leito',
    descricao:
      'A linha do tempo do turno, a checagem em tela e no tablet (pulseira, dupla checagem, infusão), os conflitos de sincronização e os aparelhos da beira do leito; a dose checada aqui aparece como administrada ou não administrada, com o profissional e a hora.',
    decisao: 'POL-3, DP-4 e ficha do M25 (seção 12)',
    marco: 'M25',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Plantão simulado na cópia com a enfermagem da unidade-piloto: a dose checada aqui aparece administrada no outro sistema, com o profissional e a hora, e a suspensão feita lá bloqueia a checagem aqui.',
        responsavel: 'gerência de enfermagem e responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Leitores, tablets e impressoras de pulseira conferidos pela TI na unidade (cap-15 §15.3.2).',
        responsavel: 'TI',
      },
    ],
  },
  {
    chave: 'enfermagem.aprazamento',
    titulo: 'Aprazamento da prescrição pela enfermagem',
    descricao:
      'A proposta de aprazamento pela grade da unidade, o ajuste, a confirmação em lote, o reaprazar e o suprimir com o motivo; registrados aqui enquanto o horário da prescrição não muda.',
    decisao: 'POL-3 e ficha do M25 (seção 5)',
    marco: 'M25',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: 'Conferência do aprazamento com o enfermeiro da unidade-piloto na cópia.',
        responsavel: 'gerência de enfermagem',
      },
    ],
  },
  {
    chave: 'enfermagem.sinaisVitais',
    titulo: 'Sinais vitais e controles estruturados',
    descricao:
      'O registro dos sinais vitais com a unidade e a faixa plausível, a retificação com a justificativa e a grade e o gráfico com a glicemia e o laboratório na mesma régua.',
    decisao: 'POL-3 e ficha do M25 (seção 12)',
    marco: 'M25',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência das faixas e das unidades com a enfermagem e a equipe médica da unidade-piloto.',
        responsavel: 'gerência de enfermagem',
      },
    ],
  },
  {
    chave: 'enfermagem.plantao',
    titulo: 'Modo plantão e passagem de turno (SBAR)',
    descricao:
      'A passagem de plantão com a nota SBAR de cada paciente, as pendências herdadas (doses atrasadas, exames a colher, cuidados não feitos) e o aceite de quem recebe.',
    decisao: 'POL-3 e ficha do M25 (seção 12)',
    marco: 'M25',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: 'Passagem de plantão simulada na cópia com os enfermeiros da unidade-piloto.',
        responsavel: 'gerência de enfermagem',
      },
    ],
  },
  {
    chave: 'enfermagem.leituraDose',
    titulo: 'Leitura obrigatória da dose à beira do leito',
    descricao:
      'A checagem passa a exigir a leitura do código da dose (medicamento, lote e validade) nas unidades ligadas.',
    decisao: 'DP-26 e ficha do M25 (seção 12)',
    marco: 'M25',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'A etiqueta de dose da farmácia (M29) e a política de checagem por código de barras decididas (DP-26), com a compra dos leitores.',
        responsavel: 'enfermagem e farmácia',
      },
    ],
  },
  {
    chave: 'enfermagem.aparelhoAutorizado',
    titulo: 'Envio sem rede só de aparelho autorizado',
    descricao:
      'Os atos feitos sem rede (checagem, sinal vital e anotação) só são aceitos de tablet, coletor ou celular autorizado e ativo na lista de aparelhos da unidade; aparelho retirado deixa de enviar.',
    decisao: 'POL-3 e ficha do M25 (seção 6)',
    marco: 'M25',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Os aparelhos da unidade-piloto autorizados na lista de aparelhos, cada um com o identificador guardado nele, antes de ligar.',
        responsavel: 'supervisão de enfermagem',
      },
    ],
  },
  // M27 (ficha, seção 12): os componentes da página inicial, por estabelecimento, setor, grupo ou pessoa. As filas e a
  // central de avisos ligam junto com o primeiro módulo do setor; mensagens e dicionário podem ir na onda 1. Recolher
  // desliga o componente: a fila some da página inicial e o servidor recusa a leitura (403 `recurso-desligado`).
  {
    chave: 'inicio.worklistMedico',
    titulo: 'Página inicial: fila do médico',
    descricao:
      'Os pacientes com vínculo assistencial do médico: leito, dias, previsão de alta, resultados novos e críticos não vistos, prescrição a renovar, pareceres, assinaturas pendentes e internado sem evolução há mais de 24 horas.',
    decisao: 'POL-3 e ficha do M27 (seção 12)',
    marco: 'M27',
    prerequisitos: [],
  },
  {
    chave: 'inicio.worklistRecepcao',
    titulo: 'Página inicial: fila da recepção',
    descricao:
      'As senhas pela prioridade legal, as chegadas do dia e as guias aguardando autorização do convênio.',
    decisao: 'POL-3 e ficha do M27 (seção 12)',
    marco: 'M27',
    prerequisitos: [],
  },
  {
    chave: 'inicio.avisos',
    titulo: 'Central de avisos',
    descricao:
      'O sino da barra superior: os avisos dos módulos e das mensagens, com o estado novo, lido ou resolvido; só o risco grave interrompe.',
    decisao: 'POL-3 e ficha do M27 (seção 12)',
    marco: 'M27',
    prerequisitos: [],
  },
  {
    chave: 'inicio.mensagens',
    titulo: 'Mensagens internas e comunicados',
    descricao:
      'Mensagens entre usuários, perfis, setores e unidades e comunicados com vigência e ciência obrigatória; o paciente só como link de contexto. As mensagens do sistema anterior ficam para consulta.',
    decisao: 'POL-3 e ficha do M27 (seção 12)',
    marco: 'M27',
    prerequisitos: [],
  },
  {
    chave: 'inicio.dicionario',
    titulo: 'Dicionário ortográfico pessoal',
    descricao:
      'As palavras do próprio usuário para o corretor ortográfico; o mesmo dicionário nos dois sistemas (incluir e excluir gravam no banco do estabelecimento).',
    decisao: 'POL-3 e ficha do M27 (seção 12)',
    marco: 'M27',
    prerequisitos: [],
  },
  // Ficha do M21, seção 12: onda 2 (M40) a recepção de internação, a coordenação de leitos e o NIR (mapa), a
  // enfermagem, os médicos (alta médica), a higienização e o SAME. Primeiro pc; o mapa operacional liberado por setor
  // inteiro (DP-4), para as admissões e as transferências de um setor acontecerem num só sistema; recolher = desligar.
  {
    chave: 'internacao.adt',
    titulo: 'Internação: pré-internação, admissão, guias, trocas e alta',
    descricao:
      'Agendar a pré-internação, admitir o paciente no leito, registrar as guias, trocar convênio e clínica, registrar a alta médica e dar a saída, sobre a mesma internação, conta e leito do outro sistema.',
    decisao: 'POL-3 e ficha do M21 (seção 12)',
    marco: 'M21',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia de admitir, transferir e dar alta aqui: a internação, a conta e o leito aparecem como se tivessem sido gravados pelo outro sistema, com o faturamento olhando a conta e a guia (DP-33).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'leitos.mapa',
    titulo: 'Mapa de leitos operacional (admitir, transferir, bloquear)',
    descricao:
      'Admitir, transferir e bloquear leitos pelo mapa em tempo real, com o alerta quando o outro sistema ocupa um leito bloqueado aqui; liberado por setor inteiro.',
    decisao: 'POL-3, DP-4 e ficha do M21 (seção 12)',
    marco: 'M21',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Turno simulado na cópia com a coordenação de leitos: ocupar pelo outro sistema um leito bloqueado aqui e ver o alerta no mapa; o setor inteiro passa a admitir e transferir por aqui.',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'internacao.supervisor',
    titulo: 'Cancelar alta e excluir internação (supervisor)',
    descricao:
      'Cancelar a alta dada por engano e excluir a internação aberta por engano, com o motivo, a dupla confirmação e o aviso do que será apagado.',
    decisao: 'POL-3 e ficha do M21 (seção 5)',
    marco: 'M21',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado na cópia com o faturamento: o cancelamento da alta e a exclusão deixam a internação, a conta e as guias como o outro sistema deixa (Fase 4, M36).',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'hotelaria.limpeza',
    titulo: 'Higienização: solicitação, execução, inspeção e liberação do leito',
    descricao:
      'A fila da higienização por prazo, o aplicativo do profissional (checklist e foto), a inspeção e a liberação do leito, com a solicitação que nasce na alta.',
    decisao: 'POL-3 e ficha do M21 (seção 12)',
    marco: 'M21',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Decisão sobre as situações "Em higienização" e "Liberado" da execução (nunca gravadas no outro sistema) ou mantê-las só aqui, e o ciclo de limpeza completo no celular com o supervisor da higienização.',
        responsavel: 'hotelaria e responsável técnico',
      },
    ],
  },
  {
    chave: 'same.movimento',
    titulo: 'SAME: movimentação física de prontuários e contas',
    descricao:
      'Registrar a saída, o recebimento, a transferência, a devolução e o descarte de prontuários e contas em papel pela leitura do código de barras, com o protocolo e a cobrança da devolução.',
    decisao: 'POL-3 e ficha do M21 (seção 12)',
    marco: 'M21',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia com o SAME: a movimentação feita aqui aparece no controle de prontuários do outro sistema e a localização atual é a mesma nos dois.',
        responsavel: 'responsável técnico',
      },
    ],
  },
  // Ficha do M52, seção 12 (fatia F1): o cadastro de colaboradores (admissão, dependentes, mudança funcional, validade
  // do conselho e o desligamento que bloqueia o acesso no mesmo dia). Primeiro o RH do pc; recolher = desligar a chave
  // (as telas ficam em consulta e os dados ficam em SGH_).
  {
    chave: 'pessoas.colaborador',
    titulo: 'Cadastro de colaboradores',
    descricao:
      'Admitir o colaborador reusando o profissional e o usuário da mesma pessoa, incluir dependentes, registrar a mudança funcional e a validade do conselho e desligar, com o acesso bloqueado no mesmo dia.',
    decisao: 'POL-3 e ficha do M52 (seção 12; regras 1 a 4)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo RH na cópia: colaboradores sintéticos admitidos e desligados, e o usuário bloqueado pelo desligamento visto na tela de usuários.',
        responsavel: 'RH/DP',
      },
    ],
  },
  // Ficha do M52, seção 12 (fatia F2): a escala de plantão (regimes, montagem e publicação). Primeiro um setor-piloto
  // de enfermagem do pc por um ciclo mensal; recolher = desligar a chave (a escala volta à planilha, sem perda: os dados
  // ficam em SGH_).
  {
    chave: 'pessoas.escala',
    titulo: 'Escala de plantão',
    descricao:
      'Montar a escala do setor por competência com os regimes de jornada, conferindo o conselho no dia do plantão, a interjornada, o limite do contrato, a sobreposição na Rede e a cobertura mínima, e publicá-la; depois de publicada, só muda com motivo.',
    decisao: 'POL-3 e ficha do M52 (seção 12; regras 3 e 5 a 8)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pela coordenação de enfermagem do setor-piloto na cópia: escala de um mês montada e publicada com colaboradores sintéticos, as recusas de conselho vencido, interjornada e limite do contrato vistas na tela.',
        responsavel: 'coordenação de enfermagem',
      },
    ],
  },
  // Ficha do M52, seção 12 (fatia F5): o SESMT (prontuário ocupacional e ASO, vacinas, acidentes e CAT, riscos por
  // função, EPI e dosimetria). Liberação depois do RH; recolher = desligar a chave (as telas ficam em consulta e os
  // registros de saúde ficam em SGH_).
  {
    chave: 'pessoas.sesmt',
    titulo: 'SESMT (saúde e segurança do trabalho)',
    descricao:
      'Registrar o ASO e os exames do PCMSO, as vacinas e o anti-HBs, o acidente de trabalho com a profilaxia, a sorologia e a CAT, o mapa de riscos e o EPI por função, a entrega de EPI com o CA, a dosimetria e a exposição a quimioterápico.',
    decisao: 'POL-3 e ficha do M52 (seção 12; regras 16 a 19)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo médico ou enfermeiro do trabalho (SESMT) na cópia: ASO, vacinas, acidente com material biológico e CAT, mapa de riscos e entrega de EPI de colaboradores sintéticos, e o prazo da CAT confirmado com o jurídico.',
        responsavel: 'SESMT',
      },
    ],
  },
  // M52.3 (fatia F3): o dimensionamento de enfermagem registrado (a prévia do cálculo não grava e vale sem a chave). A
  // troca de plantão e o acionamento do sobreaviso são parte da escala e seguem a chave `pessoas.escala`.
  {
    chave: 'pessoas.dimensionamento',
    titulo: 'Dimensionamento de enfermagem',
    descricao:
      'Registrar o dimensionamento de enfermagem da unidade e do turno pela Resolução COFEN 543/2017 (horas por categoria de cuidado, constante de Marinho, índice de segurança técnica, proporção de enfermeiros), com as parcelas da conta, e sugerir a cobertura mínima da escala.',
    decisao: 'POL-3 e ficha do M52 (seção 12; regra 9)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pela coordenação de enfermagem do setor-piloto na cópia: o cálculo de uma unidade com as parcelas conferidas à mão, as horas por categoria, a proporção de enfermeiros e o mínimo de enfermeiros confirmados.',
        responsavel: 'coordenação de enfermagem',
      },
    ],
  },
  // Ficha do M52, seção 12 (fatia F4): o ponto (AFD dos relógios, ajustes e justificativas com aprovador, apuração contra
  // a escala publicada, banco de horas, espelho com ciência e AEJ). Primeiro o RH e o setor-piloto de enfermagem do pc
  // por um ciclo mensal; recolher = desligar a chave (o ponto volta ao relógio e à planilha, sem perda: os dados ficam em
  // SGH_).
  {
    chave: 'pessoas.ponto',
    titulo: 'Ponto eletrônico (tratamento)',
    descricao:
      'Importar o arquivo do relógio de ponto com a validação e a quarentena, tratar as marcações com ajustes e justificativas aprovados, apurar contra a escala publicada, lançar o banco de horas, fechar o período com a ciência do colaborador e gerar o arquivo eletrônico de jornada e os eventos para a folha.',
    decisao: 'POL-3 e ficha do M52 (seção 12; regras 11 a 15)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo RH e pela coordenação de enfermagem do setor-piloto na cópia: arquivo de teste do relógio escolhido importado, as quarentenas vistas, ajustes aprovados por outra pessoa, o espelho fechado e a ciência registrada; o leiaute do arquivo do relógio e do arquivo de jornada confirmado com o jurídico trabalhista e o fornecedor do relógio.',
        responsavel: 'RH/DP',
      },
    ],
  },
  // Ficha do M52, seção 12 (fatia F6): treinamentos e capacitações com a ciência de POP versionado. Liberação com o RH e a
  // educação permanente; recolher = desligar a chave (as telas ficam em consulta e os registros ficam em SGH_).
  {
    chave: 'pessoas.treinamento',
    titulo: 'Treinamentos e capacitações',
    descricao:
      'Manter o catálogo de cursos com a carga, a validade e o público obrigatório, abrir turmas, registrar presença e conclusão, acompanhar a situação de cada colaborador e publicar as versões dos POPs com a ciência.',
    decisao: 'POL-3 e ficha do M52 (seção 12; regra 20)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo RH e pela educação permanente na cópia: cursos obrigatórios de colaboradores sintéticos, turma com a lista de presença, a situação vencida e a ciência da versão nova de um POP.',
        responsavel: 'RH/DP',
      },
    ],
  },
  // Ficha do M52, seção 12 (fatia F6): o autosserviço do colaborador (Meu espaço). Liberação depois do ponto e da escala;
  // recolher = desligar a chave (a tela mostra só o aviso; a ciência do espelho continua pela chave do ponto).
  {
    chave: 'pessoas.autoatendimento',
    titulo: 'Meu espaço (autosserviço do colaborador)',
    descricao:
      'O colaborador vê os próprios dados: o vínculo, os próximos plantões, o banco de horas, os treinamentos e POPs pendentes (com a ciência) e os próximos exames ocupacionais; o holerite e as férias só com a folha no sistema.',
    decisao: 'POL-3 e ficha do M52 (seção 12; regra 21)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo RH e pelo encarregado de dados (DPO) na cópia: o colaborador sintético vê só o próprio espaço e o pedido de outro vínculo é recusado.',
        responsavel: 'RH/DP com o encarregado de dados',
      },
    ],
  },
  // Ficha do M52, seções 5 e 12 (fatia F6): o plantão realizado da escala publicada, registrado e aprovado por outra
  // pessoa, e o relatório de plantões realizados ao repasse. Recolher = desligar a chave (o realizado volta à planilha).
  {
    chave: 'pessoas.plantaoRealizado',
    titulo: 'Plantão realizado',
    descricao:
      'Registrar o horário real de cada plantão da escala publicada (informado ou pelas marcações do ponto), aprová-lo por outra pessoa da coordenação e emitir o relatório de plantões realizados ao repasse com o valor pela tarifa por hora.',
    decisao: 'POL-3 e ficha do M52 (seções 5 e 12)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pela coordenação médica na cópia: realizados de plantões sintéticos registrados e aprovados por outra pessoa, as tarifas por hora e o relatório ao repasse conferidos à mão.',
        responsavel: 'coordenação médica',
      },
    ],
  },
  // Ficha do M52, seção 5 (repasse.lancarEvento, cenário origem-plantao) e seção 14 (DP-33): o lançamento do realizado
  // aprovado do prestador no repasse. Pronto e desligado até a DP-33 confirmar que o plantão é lançado como evento.
  {
    chave: 'pessoas.repassePlantao',
    titulo: 'Lançamento do plantão realizado no repasse',
    descricao:
      'Lançar no repasse, por prestador e competência, os plantões realizados e aprovados (cooperado, PJ ou terceiro), com o evento de repasse configurado e o valor pela tarifa por hora.',
    decisao: 'DP-33 (parte repasse) e POL-3; ficha do M52 (seção 5, cenário origem-plantao)',
    marco: 'M52',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Decisão do faturamento e do repasse (DP-33): o plantão realizado do prestador é lançado como evento de repasse, com o evento e as tarifas por hora confirmados.',
        responsavel: 'faturamento e repasse',
      },
    ],
  },
  {
    chave: 'pessoas.folha',
    titulo: 'Folha de pagamento e RH',
    descricao: 'Folha e RH completos, prontos e desligados.',
    decisao: 'DP-10',
    marco: 'M53',
    prerequisitos: [],
  },
  {
    chave: 'pessoas.folhaExterna',
    titulo: 'Interface com a folha externa',
    descricao:
      'Lote da competência para o sistema de folha (colaboradores, lotação, afastamentos, ponto e plantões), o retorno com a folha líquida e os encargos conferido por contagem e soma, e o registro dos afastamentos.',
    decisao: 'DP-10',
    marco: 'M53',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência do departamento pessoal na cópia: um lote gerado e um retorno importado com contagem e soma batendo, e o leiaute aceito pelo sistema de folha.',
        responsavel: 'departamento pessoal',
      },
    ],
  },
  {
    chave: 'pessoas.esocial',
    titulo: 'Transmissão ao eSocial',
    descricao: 'Eventos do eSocial gerados e transmitidos por este sistema.',
    decisao: 'DP-10',
    marco: 'M53',
    prerequisitos: [
      {
        tipo: 'certificado',
        descricao: 'Certificado digital do empregador (e-CNPJ) para o eSocial',
        responsavel: 'contabilidade e TI',
      },
    ],
  },
  {
    chave: 'operadora',
    titulo: 'Operadora própria',
    descricao: 'Beneficiários, carteirinhas, planos, mensalidades, rede credenciada e relatórios à ANS.',
    decisao: 'DP-11',
    marco: 'M56',
    prerequisitos: [
      { tipo: 'credenciamento', descricao: 'Registro da operadora na ANS', responsavel: 'diretoria' },
    ],
  },
  // Ficha do M55, seção 12 (fatia F1): engenharia clínica e manutenção, com a OS aberta por todos os setores, por
  // hospital (pc primeiro). Recolher é desligar a chave: a OS volta ao processo de hoje.
  {
    chave: 'manutencao',
    titulo: 'Manutenção e engenharia clínica',
    descricao:
      'Equipamentos, ordens de serviço corretivas e prediais abertas por qualquer setor com prioridade e prazo, plano de preventiva, calibração e segurança elétrica com laudo, contratos de manutenção e indicadores de disponibilidade, MTBF e MTTR.',
    decisao: 'POL-3 e ficha do M55 (seção 12)',
    marco: 'M55',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Validação na cópia pela chefia de manutenção e engenharia clínica (ficha do M55, seção 13): OS sintéticas abertas, atendidas e encerradas, equipamentos e planos cadastrados, indicadores conferidos com as parcelas.',
        responsavel: 'manutenção e engenharia clínica',
      },
    ],
  },
  // M56 (etapa F0; ficha, seções 8 e 12): uma chave por fatia, todas desligadas por padrão e por estabelecimento (a
  // empresa da operadora). A da fatia só vale com a do módulo (`operadora`) ligada no mesmo escopo (regra pura em
  // @sgh/dominio-operadora, `chaveOperadoraValendo`); recolher = desligar a do módulo (a operadora volta ao sistema que
  // usa hoje). As mensagens ao beneficiário têm chave à parte: só com a base legal da DP-44 (a).
  ...CHAVES_FATIA_OPERADORA.map((c): RecursoDesligado => ({
    chave: `operadora.${c.recurso}`,
    titulo: c.titulo,
    descricao: c.descricao,
    decisao: `DP-11 (construir, 2026-10-19); fatia M56-${c.fatia}`,
    marco: 'M56',
    prerequisitos: c.prerequisitos,
  })),
  // Ficha do M55, seção 12 (etapa 3): os contratos com fornecedores (vigência, aditivos, reajuste, saldo consumido
  // pelos pedidos e títulos ligados, alertas de vencimento, gestor e fiscal, avaliação do fornecedor). Desligado (POL-3);
  // recolher = desligar: o vínculo com contrato deixa de ser exigido e os pedidos e títulos seguem como hoje.
  {
    chave: 'contratos',
    titulo: 'Contratos com fornecedores: vigência, aditivos, saldo e avaliação',
    descricao:
      'O contrato com o fornecedor ou prestador: partes, objeto, vigência com os alertas de 90, 60 e 30 dias, valor, garantias, anexos, aditivos, reajuste pelo índice, o saldo consumido pelos pedidos de compra e títulos a pagar ligados, o gestor e o fiscal e a avaliação do fornecedor crítico; o contrato vencido recusa novo pedido, salvo a exceção aprovada.',
    decisao: 'POL-3 e ficha do M55 (seção 12)',
    marco: 'M55',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Os contratos vigentes cadastrados pelo setor de compras e conferidos com os documentos assinados (número, vigência, valor, aditivos e o saldo já consumido).',
        responsavel: 'compras e jurídico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'O gestor e o fiscal de cada contrato indicados pela diretoria administrativa, e a alçada que aprova a exceção do contrato vencido definida.',
        responsavel: 'diretoria administrativa',
      },
    ],
  },
  // Ficha do M55, seção 12 (etapa 5; DP-13, DP-35 e DP-47.4 decididas em 2026-10-19): a contratualização SUS, construída
  // completa e desligada; ligada pelo administrador quando houver contrato com o gestor do SUS. Recolher = desligar: as
  // telas ficam em consulta e as metas deixam de ser apuradas; nada do faturamento muda.
  {
    chave: 'contratualizacao',
    titulo: 'Contratualização SUS: metas, incentivos e painel produção × meta',
    descricao:
      'O contrato com o gestor do SUS (esfera, vigência, orçamento pré-fixado e pós-fixado, incentivos e habilitação), as metas quantitativas por grupo SIGTAP e qualitativas por indicador, com periodicidade, pontos e escore, a apuração de cada período e o painel produção × meta com o repasse estimado, alimentado pelo faturamento SUS ou pelas contas SUS.',
    decisao: 'DP-13, DP-35, DP-47.4, POL-3 e ficha do M55 (seção 12; regra 11)',
    marco: 'M55',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'O estabelecimento tem contrato (ou convênio) assinado com o gestor do SUS e habilitação SUS ativa, cadastrados com o documento descritivo, as metas e os incentivos conferidos pelo faturamento SUS.',
        responsavel: 'faturamento SUS e diretoria administrativa',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'As faixas de cumprimento e o percentual do pré-fixado ligado às metas qualitativas conferidos com o contrato assinado (parâmetro de faixas e cadastro do contrato).',
        responsavel: 'faturamento SUS',
      },
    ],
  },
  {
    // Ficha do M55, regra 9 e seção 12 (etapa 4): o processo formal de compra construído e desligado (DP-13), ligado
    // pelo administrador quando houver unidade pública ou regulamento próprio de compras aprovado; regras e alçadas por
    // estabelecimento nos parâmetros `licitacao.*`. Recolher = desligar: os processos ficam guardados para consulta e
    // as compras seguem pelos pedidos como hoje.
    chave: 'licitacao',
    titulo: 'Licitação, pregão e compras públicas',
    descricao:
      'O processo formal de compra pela Lei 14.133/2021 ou pelo regulamento próprio: termo de referência, pesquisa de preços com o valor estimado, parecer jurídico, edital e aviso no prazo mínimo, sessão com propostas e lances, julgamento, recurso, homologação por outra pessoa, ata e o pedido de compra do vencedor.',
    decisao: 'DP-13 e ficha do M55 (regra 9 e seção 12)',
    marco: 'M55',
    // Um pré-requisito só (D-PREREQ-554): o registro é um por tipo (SGH_CFG_PREREQUISITO, UNIQUE por tipo) e casa
    // pelo tipo; dois de 'aprovacao' se cumpririam com um registro só. A aprovação registrada cobre as duas partes.
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Aprovação conjunta da diretoria e do jurídico: (1) unidade pública, convênio ou contrato de gestão que exija o processo formal, ou o regulamento próprio de compras aprovado pela diretoria; e (2) parecer do jurídico sobre o regime (Lei 14.133/2021 ou regulamento próprio), os prazos, os limites da dispensa e as alçadas configurados para o estabelecimento. Registre como cumprida só com os dois documentos.',
        responsavel: 'diretoria administrativa e jurídico',
      },
    ],
  },
  {
    // Ficha do M51, seção 12 e regra 8: até a conferência e a autorização do dono, "o novo só gera e mostra" (a
    // competência, a crítica e o arquivo funcionam desligados, para a conferência contra o envio atual); ligada, o
    // arquivo daqui passa a ser a fonte do envio. A CIHA primeiro, no pc; o hs só depois do pc (DP-4). Recolher =
    // desligar (o envio volta ao processo atual na competência seguinte; os arquivos ficam guardados com o hash).
    chave: 'faturamento.susCiha',
    titulo: 'Faturamento SUS: CIHA como fonte do envio',
    descricao:
      'O arquivo CIHA gerado aqui (competência com crítica prévia, leiaute do CIHA01 e hash) passa a ser o que o hospital importa no aplicativo do Ministério e entrega ao gestor; desligada, a CIHA é gerada e mostrada para conferência contra o envio atual.',
    decisao: 'POL-3 e ficha do M51 (seções 8 e 12)',
    marco: 'M51',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo faturamento do arquivo CIHA gerado aqui contra o que é enviado hoje, numa competência inteira, e autorização do dono para este passar a ser a fonte do envio (ficha do M51, regra 8 e seção 12).',
        responsavel: 'faturamento e dono do projeto',
      },
    ],
  },
  ...(['Aih', 'Bpa', 'Apac'] as const).map((x): RecursoDesligado => ({
    chave: `faturamento.sus${x}`,
    titulo: `Faturamento SUS: ${x.toUpperCase()}`,
    descricao: `${x.toUpperCase()} por este sistema, desligado por estabelecimento.`,
    decisao: 'DP-47.4 e DP-35',
    marco: 'M51',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao: 'Contrato ou habilitação SUS do estabelecimento (CNES com leitos SUS)',
        responsavel: 'diretoria e faturamento',
      },
    ],
  })),
  {
    chave: 'enfermagem.vacina',
    titulo: 'Registro de vacinas com envio à RNDS',
    descricao: 'Registro clínico da vacina aplicada e envio RIA à RNDS em até 24 h.',
    decisao: 'DP-47.5 (b) e DP-47.6',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'credenciamento',
        descricao: 'Credenciamento na RNDS (Portal de Serviços do DATASUS) com certificado ICP-Brasil',
        responsavel: 'TI e diretoria técnica',
      },
    ],
  },
  {
    chave: 'suprimentos.ambulatorial',
    titulo: 'Farmácia ambulatorial com SNGPC',
    descricao: 'Dispensação ambulatorial com escrituração no SNGPC (fora da farmácia hospitalar).',
    decisao: 'DP-47.5 (b)',
    marco: 'M29',
    prerequisitos: [
      // Ficha do M29, regra 10: a farmácia só hospitalar não está sujeita ao SNGPC (RDC 22/2014, art. 3º, parágrafo
      // único); liga só com a farmácia ambulatorial com CNAE de farmácia e o credenciamento no SNGPC registrados.
      {
        tipo: 'aprovacao',
        descricao:
          'Farmácia ambulatorial com CNAE de farmácia e licença da Vigilância Sanitária (a farmácia só hospitalar não escritura no SNGPC)',
        responsavel: 'farmácia',
      },
      { tipo: 'credenciamento', descricao: 'Credenciamento no SNGPC (Anvisa)', responsavel: 'farmácia' },
    ],
  },
  {
    chave: 'suprimentos.livroControlados',
    titulo: 'Livro de controlados informatizado',
    descricao: 'Escrituração informatizada de controlados (Portaria 344/98, art. 63 §1º).',
    decisao: 'DP-47.14',
    marco: 'M29',
    prerequisitos: [
      { tipo: 'aprovacao', descricao: 'Aprovação prévia da Vigilância Sanitária', responsavel: 'farmácia' },
    ],
  },
  {
    chave: 'receita.sncr',
    titulo: 'Receita eletrônica de controle especial (SNCR)',
    descricao: 'Numeração SNCR da Anvisa na receita eletrônica de controle especial e antimicrobiano.',
    decisao: 'DP-47.2 e DP-23',
    marco: 'M49',
    prerequisitos: [
      {
        tipo: 'credenciamento',
        descricao: 'Credenciamento no SNCR (API da Anvisa)',
        responsavel: 'farmácia e TI',
      },
    ],
  },
  // Ficha do M49, seção 12: por estabelecimento, tipo de documento e pessoa; médicos primeiro (receita de controle
  // especial e atestado, se a DP-23 antecipar), pc primeiro e hs depois em lote (DP-4). Recolher volta ao papel; as
  // assinaturas já feitas continuam válidas e verificáveis.
  {
    chave: 'assinatura.icp',
    titulo: 'Assinatura com certificado ICP-Brasil',
    descricao:
      'Assinar os documentos emitidos aqui com certificado ICP-Brasil (em nuvem ou A1/A3), um a um ou em lote, com carimbo do tempo, selo, QR e verificação pública.',
    decisao: 'POL-3, DP-22 e ficha do M49 (seção 12)',
    marco: 'M49',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao:
          'Provedor de certificado em nuvem contratado e cadastrado, com o segredo no cofre (DP-22).',
        responsavel: 'diretoria administrativa e TI',
      },
      {
        tipo: 'aprovacao',
        // Um pré-requisito por tipo (SGH_CFG_PREREQUISITO casa pelo tipo): a aprovação junta as três condições.
        descricao:
          'Política de assinatura por tipo de documento aprovada pela diretoria clínica e pelo jurídico (DP-22), autorização do dono para a integração em produção, documento assinado aberto no outro sistema sem diferença e teste de invasão do verificador público sem achado crítico ou alto.',
        responsavel: 'diretoria clínica, jurídico e responsável técnico',
      },
    ],
  },
  // M49 (etapa 3; "login por certificado", opcional na ficha): entrar com o certificado A1/A3 pelo agente local, sem a
  // senha (a posse da chave, a cadeia, a revogação, o CPF e o vínculo com a conta conferidos no servidor). Desligada
  // até o teste de invasão da superfície nova e a escolha do agente local (POL-3).
  {
    chave: 'acesso.loginCertificado',
    titulo: 'Entrada com certificado ICP-Brasil',
    descricao:
      'Entrar no sistema com o próprio certificado ICP-Brasil A1 ou A3 (agente local), sem digitar a senha.',
    decisao: 'POL-3 e ficha do M49 (etapa 3)',
    marco: 'M49',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Teste de invasão da entrada com certificado sem achado crítico ou alto e o agente local A1/A3 escolhido e instalado nas estações.',
        responsavel: 'responsável técnico e TI',
      },
    ],
  },
  // W1-01 (parte 7): "Esqueci a senha" em autosserviço (token de uso único ao e-mail institucional, resposta genérica,
  // limite por hora, senha provisória com troca obrigatória). Desligada até o servidor de e-mail institucional existir.
  {
    chave: 'acesso.recuperacaoSenha',
    titulo: 'Esqueci a senha (recuperação pelo e-mail institucional)',
    descricao:
      'O botão "Esqueci a senha" na entrada: um link de uso único e prazo curto vai ao e-mail institucional e gera uma senha provisória, trocada no próximo acesso.',
    decisao: 'W1-01 (mercado b) e D-W101-26',
    marco: 'W1-01',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Servidor de notificações com a credencial do e-mail institucional configurado e o e-mail institucional dos usuários conferido.',
        responsavel: 'dono e TI',
      },
    ],
  },
  // M34 (ficha, seção 12): cada relatório do catálogo entra na onda do setor que o usa (os da diretoria na onda 0), só
  // depois de conferido contra o número do relatório de origem no mesmo período (regra 6); recolher = desligar.
  ...RELATORIOS_CATALOGO.map((r): RecursoDesligado => ({
    chave: chaveLiberacaoRelatorio(r.codigo),
    titulo: `Relatório do catálogo: ${r.titulo}`,
    descricao: `${r.descricao} Onda ${r.onda}; papel dono: ${r.papelDono}.`,
    decisao: 'POL-3 e ficha do M34 (regra 6 e seção 12)',
    marco: 'M34',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: `Conferência do número contra o relatório de origem no mesmo período: ${r.conferencia.como}`,
        responsavel: r.papelDono,
      },
    ],
  })),
  {
    chave: 'relatorio.envioAgendado',
    titulo: 'Envio agendado de relatório por e-mail (com link)',
    descricao:
      'O e-mail leva só o link autenticado do relatório (nunca o arquivo); a falha alerta o dono do envio. Fora de produção, só o coletor local de e-mail.',
    decisao: 'POL-3 e ficha do M34 (regra 5)',
    marco: 'M34',
    prerequisitos: [],
  },
  // M34 (ficha, seção 12 e regras 12 a 15a): integração nova em produção só com a autorização do dono e a homologação
  // com o parceiro; a troca da interface do laboratório de apoio é combinada com o laboratório e a TI e reversível.
  {
    chave: 'integracao.parceiros',
    titulo: 'Entrega às integrações novas (outbox, filas e reprocessamento)',
    descricao:
      'Os eventos da outbox chegam aos parceiros novos ativos neste estabelecimento, com tentativas e fila de mortos; nada que um gatilho já envia é repetido.',
    decisao: 'POL-3 e ficha do M34 (seção 12)',
    marco: 'M34',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Autorização do dono registrada para a integração nova em produção e homologação com o parceiro.',
        responsavel: 'dono do projeto e TI do hospital',
      },
    ],
  },
  {
    chave: 'integracao.hl7',
    titulo: 'Canais HL7 v2 no motor de integração',
    descricao:
      'Mensagens HL7 v2 novas (pedido ao laboratório, classificação externa) pelos canais versionados do motor de integração.',
    decisao: 'POL-3, ficha do M34 (regra 12) e DP-17',
    marco: 'M34',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Analisadores e parceiros do primeiro canal real definidos com o laboratório e a TI (DP-17).',
        responsavel: 'laboratório e TI',
      },
    ],
  },
  {
    chave: 'integracao.apoio',
    titulo: 'Conector do laboratório de apoio (envio e retorno)',
    descricao:
      'Pedido ao laboratório de apoio e retorno estruturado, conferido e liberado pelo responsável técnico; uma interface por estabelecimento de cada vez.',
    decisao: 'POL-3 e ficha do M34 (regra 13; Fase 4, reversível)',
    marco: 'M34',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao:
          'Troca combinada com o laboratório de apoio e a TI, testada na cópia, com a interface em uso desligada para este laboratório (religar desfaz).',
        responsavel: 'laboratório e TI',
      },
    ],
  },
  {
    chave: 'integracao.rndsVacina',
    titulo: 'Envio de vacina aplicada à RNDS (modelo RIA)',
    descricao: 'Registro de imunobiológico administrado (Immunization, BR Core fixado) à RNDS em até 24 h.',
    decisao: 'DP-47.5 (b), DP-47.6 e ficha do M34 (regra 14)',
    marco: 'M34',
    prerequisitos: [
      {
        tipo: 'credenciamento',
        descricao: 'Credenciamento do estabelecimento na RNDS em produção (Portal de Serviços do DATASUS).',
        responsavel: 'TI e diretoria técnica',
      },
      {
        tipo: 'certificado',
        descricao: 'Certificado ICP-Brasil do estabelecimento (e-CNPJ A1) registrado para o token da RNDS.',
        responsavel: 'TI',
      },
    ],
  },
  {
    chave: 'integracao.classificacaoExterna',
    titulo: 'Classificação de risco externa pelo motor de integração',
    descricao:
      'A classificação de risco feita na ferramenta externa entra pelo motor de integração (nunca junto com o gatilho que já envia).',
    decisao: 'POL-3, ficha do M34 (regra 12) e DP-16',
    marco: 'M34',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Integração confirmada pela TI e pela diretoria clínica (DP-16) e o gatilho em uso desligado para ela.',
        responsavel: 'TI e diretoria clínica',
      },
    ],
  },
  {
    chave: 'integracao.mensagensPaciente',
    titulo: 'Mensagens ao paciente pela Hal-AI',
    descricao:
      'Confirmações, lembretes e avisos ao paciente pelas APIs da Hal-AI (sem canal próprio de WhatsApp, SMS ou webchat).',
    decisao: 'DP-44 (b) e ficha do M34 (regra 15a); DP-44 (a) pendente',
    marco: 'M34',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: 'Base legal da comunicação com o paciente definida pelo encarregado de dados (DP-44 a).',
        responsavel: 'encarregado de dados (DPO)',
      },
    ],
  },
  // M13: um responsável por catálogo de cada vez (ficha, seção 5; cap-10 §10.8). Ligada no estabelecimento, este
  // sistema publica as cargas do catálogo; desligada (padrão), o importador recusa publicar. Brasíndice e Simpro
  // só ligam com o contrato de dados registrado (DP-36).
  ...CATALOGOS.map((c): RecursoDesligado => ({
    chave: chaveResponsavelCatalogo(c.codigo),
    titulo: `Importador deste sistema: ${c.titulo}`,
    descricao: `Este sistema passa a carregar ${c.titulo} (um responsável por catálogo de cada vez).`,
    decisao: 'cap-10 §10.8 e cap-15 §15.3.3 (Fase 4, onda 0 ou 4)',
    marco: 'M13',
    prerequisitos: c.exigeContrato
      ? [
          {
            tipo: 'contrato',
            descricao: `Contrato de dados de conteúdo de preços (${c.titulo}) vigente (DP-36)`,
            responsavel: 'diretoria administrativa',
          },
        ]
      : [],
  })),
  // Ficha do M30, seção 12: onda 4 (cap-15 §15.3.3, início de janeiro, na abertura de uma competência): faturamento de
  // convênios, auditoria de contas e particular; chave por operação, estabelecimento, setor e pessoa (e grupo de item no
  // lançamento manual); recolher = desligar (a conta continua no outro sistema).
  {
    chave: 'faturamento.contas',
    titulo: 'Contas do paciente: conferir, fechar e reabrir',
    descricao:
      'Conta do paciente ao vivo: pendências, conferência em bloco, fechamento com os vetos e o pré-voo do banco e reabertura pelo supervisor, sobre a mesma conta do outro sistema.',
    decisao: 'POL-3 e ficha do M30 (seção 12)',
    marco: 'M30',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelo faturista chave-usuário (cap-15 §15.3.1): a conta fechada, reaberta, conferida e com item lançado aqui abre igual no outro sistema (ficha do M30, seção 12).',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'faturamento.lancamentoManual',
    titulo: 'Lançamento manual na conta',
    descricao:
      'Lançamento de procedimento, taxa e mat/med à mão na conta aberta, com a memória de cálculo; liberado por grupo de item só quando o teste de reprodução atinge a meta.',
    decisao: 'POL-3 e ficha do M30 (seção 12)',
    marco: 'M30',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelo faturista chave-usuário (cap-15 §15.3.1): a conta fechada, reaberta, conferida e com item lançado aqui abre igual no outro sistema (ficha do M30, seção 12).',
        responsavel: 'faturamento',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Teste de reprodução (faturamento:reproduzir) com o grupo do item na meta: 99% em SADT e em diárias e taxas, 98% em mat/med, 97% em honorários; até lá, o lançamento manual do grupo segue no outro sistema, na mesma conta.',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'faturamento.lancamentoTardio',
    titulo: 'Fila de lançamento após o fechamento',
    descricao:
      'A fila dos lançamentos feitos com a conta já fechada (de qualquer sistema) e a decisão: reabrir, gerar conta complementar ou descartar com motivo.',
    decisao: 'POL-3 e ficha do M30 (seção 12)',
    marco: 'M30',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelo faturista chave-usuário (cap-15 §15.3.1): a conta fechada, reaberta, conferida e com item lançado aqui abre igual no outro sistema (ficha do M30, seção 12).',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'faturamento.auditoria',
    titulo: 'Auditoria de contas',
    descricao:
      'Auditoria da conta pelo enfermeiro e pelo médico auditor: versões, diferenças, irregularidades e parecer.',
    decisao: 'POL-3 e ficha do M30 (seção 12)',
    marco: 'M30',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo auditor de contas (enfermeiro e médico) na cópia (ficha do M30, seção 13).',
        responsavel: 'auditoria de contas',
      },
    ],
  },
  {
    chave: 'faturamento.regras',
    titulo: 'Regras de faturabilidade e pacotes',
    descricao:
      'Regras de faturabilidade como dados (senha, carteira, guia) e pacotes vigentes do contrato; a violação é aviso na conta.',
    decisao: 'POL-3 e ficha do M30 (seção 12)',
    marco: 'M30',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo supervisor do faturamento das regras e dos pacotes cadastrados (DP-33.6).',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'faturamento.particular',
    titulo: 'Particular: orçamento, caixa e recibo',
    descricao:
      'Orçamento de particular, caixa do operador, recebimento e recibo; urgência nunca condicionada a caução.',
    decisao: 'POL-3 e ficha do M30 (seção 12)',
    marco: 'M30',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelo operador do caixa do particular e pela tesouraria (ficha do M30, seção 13).',
        responsavel: 'tesouraria',
      },
    ],
  },
  {
    chave: 'faturamento.pagamentoEletronico',
    titulo: 'Pagamento por Pix e cartão',
    descricao: 'Recebimento por Pix e cartão pelo conector; fora de produção, só o conector simulado.',
    decisao: 'POL-3 e ficha do M30 (seção 12)',
    marco: 'M30',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Escolha do provedor de Pix e de cartão (PSP e adquirente) pela diretoria administrativa, registrada em ESTADO.md, antes de ligar em produção (decisão nova, sem DP).',
        responsavel: 'diretoria administrativa',
      },
    ],
  },
  // Ficha do M32, seção 12: onda 4 (cap-15 §15.3.3), na abertura de uma competência, primeiro no pc: contas a pagar,
  // contas a receber, tesouraria e fiscal, cada uma com a sua chave (por operação, estabelecimento e setor). Recolher é
  // desligar a chave: os usuários voltam ao outro sistema sobre os mesmos dados.
  // Ficha do M33, seção 12: onda 4, junto com o contas a pagar, na abertura da competência de janeiro; pc primeiro.
  // Recolher é desligar a chave: os usuários voltam ao outro sistema e a apuração do período continua no sistema que a
  // começou (regra 10).
  // Ficha do M54, seção 12: controladoria, por hospital (pc primeiro; hs só depois, em lote, DP-4). A contabilidade
  // própria liga só depois de uma competência contabilizada no novo conferida com a do escritório contábil; até lá a
  // exportação do M32 continua. `contabil.sped` nasce desligada (decisão da controladoria sobre a escrituração).
  {
    chave: 'contabil',
    titulo: 'Contabilidade',
    descricao:
      'Plano de contas com o plano referencial, regras de contabilização versionadas, leitura dos fatos dos módulos, lançamentos automáticos e manuais, estorno e encerramento do período.',
    decisao: 'POL-3 e ficha do M54 (seção 12)',
    marco: 'M54',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Uma competência contabilizada no novo conferida com a do escritório contábil (totais do lote da exportação contra o razão do mesmo período).',
        responsavel: 'contabilidade',
      },
    ],
  },
  {
    chave: 'contabil.sped',
    titulo: 'SPED contábil (ECD e ECF)',
    descricao:
      'Geração da ECD e da ECF a partir da contabilidade própria, com o hash e o recibo de cada arquivo.',
    decisao: 'POL-3 e ficha do M54 (seção 2, Nota do cap-07 §7.2)',
    marco: 'M54',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Decisão da controladoria de trazer a escrituração para o novo, registrada como Decisão em ESTADO.md.',
        responsavel: 'controladoria',
      },
    ],
  },
  {
    chave: 'repasse',
    titulo: 'Repasse médico',
    descricao:
      'Propor e aprovar regras de repasse, apurar o período com a memória de cálculo, lançar eventos (ajuste e estorno por glosa) e emitir o RPA com o título a pagar.',
    decisao: 'POL-3 e ficha do M33 (seção 12)',
    marco: 'M33',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência pelos chave-usuários do repasse (cap-15 §15.3.1): o lançamento e o RPA do novo abertos nas telas de repasse do outro sistema e o título do RPA visto no contas a pagar; a meta do teste dourado aprovada (DP-33).',
        responsavel: 'repasse',
      },
    ],
  },
  {
    chave: 'financeiro.contasPagar',
    titulo: 'Contas a pagar',
    descricao:
      'Lançar o título a pagar (parcelas, classificação, retenções), aprovar na alçada, montar o borderô e pagar, com a segregação de funções.',
    decisao: 'POL-3 e ficha do M32 (seção 12)',
    marco: 'M32',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelos chave-usuários do setor (cap-15 §15.3.1): o título lançado no novo aberto na tela de contas a pagar do outro sistema, a baixa vista no borderô e no saldo, o título a receber visto na conta (ficha do M32, seção 12).',
        responsavel: 'financeiro',
      },
    ],
  },
  {
    chave: 'financeiro.contasReceber',
    titulo: 'Contas a receber',
    descricao:
      'Criar o título a receber da conta (convênio pela competência, particular), baixar por demonstrativo com a glosa no título e a baixa manual com motivo.',
    decisao: 'POL-3 e ficha do M32 (seção 12)',
    marco: 'M32',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelos chave-usuários do setor (cap-15 §15.3.1): o título lançado no novo aberto na tela de contas a pagar do outro sistema, a baixa vista no borderô e no saldo, o título a receber visto na conta (ficha do M32, seção 12).',
        responsavel: 'financeiro',
      },
    ],
  },
  {
    chave: 'financeiro.tesouraria',
    titulo: 'Tesouraria',
    descricao:
      'Lançar o movimento bancário das contas do escopo, importar o extrato e conciliar, e o crédito não identificado até a atribuição.',
    decisao: 'POL-3 e ficha do M32 (seção 12)',
    marco: 'M32',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelos chave-usuários do setor (cap-15 §15.3.1): o título lançado no novo aberto na tela de contas a pagar do outro sistema, a baixa vista no borderô e no saldo, o título a receber visto na conta (ficha do M32, seção 12).',
        responsavel: 'financeiro',
      },
    ],
  },
  {
    chave: 'financeiro.fiscal',
    titulo: 'Fiscal e exportação contábil',
    descricao:
      'NFS-e de saída, DMED, EFD-REINF (gerados, não enviados até a DP-38) e o lote contábil ao sistema do contador.',
    decisao: 'POL-3 e ficha do M32 (seção 12)',
    marco: 'M32',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelos chave-usuários do setor (cap-15 §15.3.1): o título lançado no novo aberto na tela de contas a pagar do outro sistema, a baixa vista no borderô e no saldo, o título a receber visto na conta (ficha do M32, seção 12).',
        responsavel: 'financeiro',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Emissão real de NFS-e e envio de DMED e EFD-REINF só depois das respostas do fiscal (DP-38), com o certificado no cofre e a autorização do dono registrada em ESTADO.md › Autorizações; fora de produção, o simulador.',
        responsavel: 'fiscal e contabilidade',
      },
    ],
  },

  // Ficha do M31, seção 12: onda 4 (cap-15 §15.3.3), com o M30: protocolo, recurso e retorno primeiro (já gravados pela
  // sante-api em produção); conciliação, lote e competência depois da conferência. Recolher = desligar (a remessa volta
  // ao outro sistema).
  {
    chave: 'faturamento.protocoloRecurso',
    titulo: 'Protocolo, recurso e retorno do recurso',
    descricao:
      'Registrar o protocolo do lote (congela o lote), o recurso de glosa do item e o desfecho do recurso, com data, autor e o indeferimento que o outro sistema não guarda.',
    decisao: 'POL-3 e ficha do M31 (seção 12)',
    marco: 'M31',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelo faturista chave-usuário de remessa e de recurso (cap-15 §15.3.1): o lote, o protocolo, a baixa e o recurso gravados aqui aparecem iguais nas telas do outro sistema (ficha do M31, seção 12).',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'faturamento.conciliacao',
    titulo: 'Demonstrativos, baixa e decisão da glosa',
    descricao:
      'Importar ou digitar o demonstrativo da operadora, casar item a item, baixar o retorno (valor pago e motivo da glosa) e decidir aceitar ou recorrer.',
    decisao: 'POL-3 e ficha do M31 (seção 12)',
    marco: 'M31',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelo faturista chave-usuário de remessa e de recurso (cap-15 §15.3.1): o lote, o protocolo, a baixa e o recurso gravados aqui aparecem iguais nas telas do outro sistema (ficha do M31, seção 12).',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'faturamento.lote',
    titulo: 'Lote TISS 04.03.00',
    descricao:
      'Montar o lote TISS na versão vigente, validar no XSD oficial, guardar o XML com hash e numerar pelo contador do outro sistema; o envio à operadora só em produção.',
    decisao: 'POL-3 e ficha do M31 (seção 12)',
    marco: 'M31',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelo faturista chave-usuário de remessa e de recurso (cap-15 §15.3.1): o lote, o protocolo, a baixa e o recurso gravados aqui aparecem iguais nas telas do outro sistema (ficha do M31, seção 12).',
        responsavel: 'faturamento',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Envio real à operadora: só em produção, com a operação liberada e a autorização do dono registrada em ESTADO.md › Autorizações; credenciais e certificados no cofre (ficha do M31, seção 12).',
        responsavel: 'dono do projeto',
      },
    ],
  },
  {
    chave: 'faturamento.competencia',
    titulo: 'Fechamento de competência por convênio',
    descricao:
      'Fechar a competência do convênio como o outro sistema grava; a competência fechada não recebe conta nova nas telas do novo.',
    decisao: 'POL-3 e ficha do M31 (seção 12)',
    marco: 'M31',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelo faturista chave-usuário de remessa e de recurso (cap-15 §15.3.1): o lote, o protocolo, a baixa e o recurso gravados aqui aparecem iguais nas telas do outro sistema (ficha do M31, seção 12).',
        responsavel: 'faturamento',
      },
    ],
  },
  {
    chave: 'integracao.tiss',
    titulo: 'Webservices TISS por operadora',
    descricao:
      'Endpoint por operadora e transação com a referência à credencial no cofre; os cadastros do outro sistema ficam só em leitura.',
    decisao: 'POL-3 e ficha do M31 (seção 12)',
    marco: 'M31',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência no outro sistema pelo faturista chave-usuário de remessa e de recurso (cap-15 §15.3.1): o lote, o protocolo, a baixa e o recurso gravados aqui aparecem iguais nas telas do outro sistema (ficha do M31, seção 12).',
        responsavel: 'faturamento',
      },
    ],
  },

  // Ficha do M28, seção 12: onda 3 (cap-15 §15.3.3), almoxarifado central e compras primeiro; chave por operação,
  // estabelecimento, local de estoque e pessoa; recolher = desligar (os usuários seguem no outro sistema).
  {
    chave: 'suprimentos.estoque',
    titulo: 'Estoque: saídas, requisições, devoluções e transferências',
    descricao:
      'Saída a setor, paciente e terceiro, requisição do setor e atendimento, devolução e transferência entre locais, sobre os mesmos documentos e saldos do outro sistema.',
    decisao: 'POL-3 e ficha do M28 (seção 12)',
    marco: 'M28',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelo chave-usuário do almoxarifado (supervisor): o documento gravado aqui abre no outro sistema com o mesmo saldo, custo, consumo e item na conta (ficha do M28, seção 12).',
        responsavel: 'almoxarifado',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado (M36): a consolidação do documento no outro sistema grava também o saldo por local e, na entrada e na devolução, o custo do item; nenhum gatilho faz isso (D-MOTOR-28). Até a prova, os documentos de estoque ficam com o outro sistema.',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'suprimentos.notaFiscal',
    titulo: 'Entrada por nota fiscal',
    descricao: 'Entrada por nota fiscal com lotes, validade, fator de unidade e conferência contra o pedido.',
    decisao: 'POL-3 e ficha do M28 (seção 12)',
    marco: 'M28',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelo chave-usuário do almoxarifado (supervisor): o documento gravado aqui abre no outro sistema com o mesmo saldo, custo, consumo e item na conta (ficha do M28, seção 12).',
        responsavel: 'almoxarifado',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado (M36): a consolidação do documento no outro sistema grava também o saldo por local e, na entrada e na devolução, o custo do item; nenhum gatilho faz isso (D-MOTOR-28). Até a prova, os documentos de estoque ficam com o outro sistema.',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Título a pagar da nota (M32): o outro sistema gera o título na entrada; até o M32, a nota fica com o outro sistema.',
        responsavel: 'financeiro',
      },
    ],
  },
  {
    chave: 'suprimentos.compras',
    titulo: 'Compras: pedidos, cotação e aprovação por alçada',
    descricao:
      'Pedido de compra com fornecedores convidados, mapa de cotação com rateio, escolha do vencedor com registro de quem escolheu e aprovação por faixa de valor.',
    decisao: 'POL-3 e ficha do M28 (seção 12)',
    marco: 'M28',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelo comprador: o pedido e o vencedor gravados aqui abrem no outro sistema iguais (ficha do M28, seção 12).',
        responsavel: 'compras',
      },
    ],
  },
  {
    chave: 'suprimentos.inventario',
    titulo: 'Inventário com contagem cega',
    descricao:
      'Inventário geral ou cíclico com contagem cega, recontagem acima do limite e o ajuste aprovado pelo supervisor (vira o balanço).',
    decisao: 'POL-3 e ficha do M28 (seção 12)',
    marco: 'M28',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelo chave-usuário do almoxarifado (supervisor): o documento gravado aqui abre no outro sistema com o mesmo saldo, custo, consumo e item na conta (ficha do M28, seção 12).',
        responsavel: 'almoxarifado',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado (M36): a consolidação do documento no outro sistema grava também o saldo por local e, na entrada e na devolução, o custo do item; nenhum gatilho faz isso (D-MOTOR-28). Até a prova, os documentos de estoque ficam com o outro sistema.',
        responsavel: 'responsável técnico',
      },
    ],
  },
  {
    chave: 'suprimentos.kits',
    titulo: 'Kits e carrinhos de parada',
    descricao: 'Reposição e conferência do carrinho de parada com lacre numerado e checklist.',
    decisao: 'POL-3 e ficha do M28 (seção 12)',
    marco: 'M28',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: 'Conferência pela enfermagem e pela farmácia do checklist e do lacre do carrinho.',
        responsavel: 'farmácia',
      },
    ],
  },
  {
    chave: 'suprimentos.fechamento',
    titulo: 'Fechamento mensal do estoque',
    descricao:
      'Fechar e reabrir o mês do estoque, com o motivo; os efeitos do fechamento (resumo contábil, consumo para os custos) são levantados no cenário controlado.',
    decisao: 'POL-3 e ficha do M28 (seção 12)',
    marco: 'M28',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado (M36) dos efeitos do fechamento; até lá o fechamento continua no outro sistema.',
        responsavel: 'controladoria',
      },
    ],
  },
  {
    chave: 'suprimentos.saneamento',
    titulo: 'Saneamento de validade de lote',
    descricao: 'Correção da validade digitada errada de um lote (dígitos trocados), com o motivo.',
    decisao: 'POL-3 e ficha do M28 (seção 12)',
    marco: 'M28',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: 'Conferência pelo farmacêutico responsável das validades a corrigir.',
        responsavel: 'farmácia',
      },
    ],
  },
  // Ficha do M29, seção 12: onda 3 (dezembro), farmácia central e satélites; chave por operação, estabelecimento,
  // unidade ou farmácia satélite e pessoa; recolher = desligar (a farmácia volta ao outro sistema sobre a mesma fila).
  {
    chave: 'suprimentos.dispensacao',
    titulo: 'Dispensação por horário com etiqueta de dose',
    descricao:
      'Fila por unidade, paciente e horário a partir da prescrição, dispensação com etiqueta DataMatrix, cancelamento da dose não entregue e devolução do não administrado, sobre a mesma fila do outro sistema.',
    decisao: 'POL-3 e ficha do M29 (seção 12)',
    marco: 'M29',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia (ficha do M29, seção 12): a dose dispensada aqui aparece na farmácia do outro sistema como dispensada e entregue, a saída e o item na conta iguais, e a prescrição com a mesma situação.',
        responsavel: 'farmácia',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado (M36): a saída da dispensação usa a consolidação do estoque, que no outro sistema grava também o saldo por local e o item na conta sem gatilho (D-MOTOR-28).',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao: 'Impressora de etiquetas da farmácia conferida pela TI (agente local).',
        responsavel: 'TI',
      },
    ],
  },
  {
    chave: 'suprimentos.entrega',
    titulo: 'Entrega da dose ao setor com aceite da enfermagem',
    descricao:
      'Aceite da entrega pela leitura da etiqueta ou pela confirmação no tablet, com quem recebeu e quando.',
    decisao: 'POL-3 e ficha do M29 (seção 12)',
    marco: 'M29',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conferência na cópia pelo enfermeiro chave-usuário e pela farmácia: o aceite registrado aqui aparece no controle de entrega do outro sistema (D-ENTREGA-29: o "Entregue" sobre o documento da dispensação por horário é combinação nova).',
        responsavel: 'enfermagem e farmácia',
      },
    ],
  },
  {
    chave: 'suprimentos.avaliacao',
    titulo: 'Avaliação farmacêutica da prescrição',
    descricao:
      'Fila priorizada (alto risco e antimicrobiano), regras automáticas, decisão e intervenção ao prescritor, só no novo até a DP-25.',
    decisao: 'POL-3, DP-25 e ficha do M29 (seção 12)',
    marco: 'M29',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: 'Escopo da validação farmacêutica decidido pela farmácia clínica (DP-25).',
        responsavel: 'farmácia clínica',
      },
    ],
  },
  {
    chave: 'suprimentos.controlados',
    titulo: 'Controlados: saldo por substância, dupla conferência e perda',
    descricao:
      'Saldo por substância e movimentos dos dois sistemas, dupla conferência com reautenticação e perda ou descarte com testemunha.',
    decisao: 'POL-3 e ficha do M29 (seção 12)',
    marco: 'M29',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao: 'Conferência pelo farmacêutico responsável (controlados) na cópia.',
        responsavel: 'farmácia',
      },
    ],
  },
  // Ficha do M38, seção 12 (onda 0): uma chave por tela de consulta e estabelecimento (e por grupo), ligadas em lote
  // pelo painel de migração (M37); recolher = desligar a tela. A chave liga a TELA para o público da onda; a leitura
  // continua sob a permissão do catálogo, conferida pelo servidor (D-CHAVE-TELA-38).
  ...(
    [
      [
        'cadastro.paciente.consulta',
        'Pacientes: cadastro e busca (consulta)',
        'Busca do paciente por nome, documento ou prontuário e a ficha do cadastro, só para consulta nesta etapa.',
      ],
      [
        'cadastro.historico.consulta',
        'Pacientes: histórico de alterações do cadastro (consulta)',
        'Quem alterou o quê no cadastro do paciente e quando.',
      ],
      [
        'cadastro.profissional.consulta',
        'Profissionais, registros e especialidades (consulta)',
        'Profissionais com o conselho, o CBO e as especialidades, só para consulta nesta etapa.',
      ],
      [
        'config.dominio.consulta',
        'Domínios e tabelas auxiliares (consulta)',
        'As tabelas auxiliares do estabelecimento (estado civil, conselhos, unidades e as demais), em modo consulta.',
      ],
      [
        'auditoria.acessos.consulta',
        'Registro de acesso ao prontuário (consulta)',
        'As leituras do prontuário por usuário, paciente e dia, com o motivo de acesso.',
      ],
      [
        'config.matriz.consulta',
        'Painel da matriz de cobertura (consulta)',
        'Quanto de cada módulo já está no Sante SGH, por marco e por tela.',
      ],
      [
        'sistema.saude.consulta',
        'Saúde do sistema (consulta)',
        'Situação da aplicação, das conexões com o banco e das filas, para a TI.',
      ],
    ] as const
  ).map(([chave, titulo, descricao]): RecursoDesligado => ({
    chave,
    titulo,
    descricao,
    decisao: 'POL-3 e ficha do M38 (seção 12)',
    marco: 'M38',
    prerequisitos: [],
  })),
  // Ficha do M44, seção 12: a classificação própria por hospital e setor, primeiro no pc; ligar desliga, na mesma
  // mudança, a classificação externa do M34 (regra 6); recolher volta ao formulário do prontuário, e a classificação
  // estruturada já gravada continua legível.
  {
    chave: 'pa.classificacao',
    titulo: 'Classificação de risco no pronto atendimento',
    descricao:
      'Fila de classificação, classificar e reclassificar com protocolo versionado, cor e tempo-alvo no quadro do PA, com a classificação gravada também no formulário do prontuário; relógio dos protocolos gerenciados (sepse, dor torácica, AVC, trauma) com as metas.',
    decisao: 'POL-3, DP-18 e ficha do M44 (seção 12)',
    marco: 'M44',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Protocolo de produção publicado pela diretoria clínica (Manchester com a licença registrada ou ACCR próprio, DP-18) e o de-para cor → prioridade clínica aprovado pela enfermagem.',
        responsavel: 'diretoria clínica e enfermagem',
      },
      {
        tipo: 'aprovacao',
        descricao:
          '30 classificações roteirizadas na cópia cobrindo as 5 cores, com 5 reclassificações, e o registro aberto no prontuário pelo enfermeiro chave-usuário; tablets do PA conferidos pela TI.',
        responsavel: 'enfermagem do PA e TI',
      },
    ],
  },
  // Ficha do M44, seção 12 (etapa 2): o NIR por hospital e setor, primeiro no pc. Recolher desliga a chave e a
  // coordenação volta ao mapa de leitos; as solicitações, reservas, altas previstas e barreiras gravadas continuam
  // legíveis. A reserva vale só no novo enquanto a reserva no outro sistema não estiver liberada (aviso de conflito).
  {
    chave: 'nir',
    titulo: 'NIR: solicitação de leito, fila, reserva, alta prevista e barreiras',
    descricao:
      'Solicitação de leito pelo médico, fila priorizada com prazo, reserva com validade, data provável de alta, barreiras de alta e quadro de permanência para a reunião de leitos.',
    decisao: 'POL-3 e ficha do M44 (seção 12)',
    marco: 'M44',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Aceite do NIR e da coordenação de leitos: uma solicitação do PA até a admissão, uma reserva expirada e uma ocupação feita no outro sistema sobre leito reservado aqui, com o aviso; o de-para das 23 situações aprovado.',
        responsavel: 'NIR e coordenação de leitos',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Limites de permanência por clínica (calibrados em dias da Portaria 312) aceitos pela diretoria clínica.',
        responsavel: 'diretoria clínica',
      },
    ],
  },
  // Ficha do M45, etapa 5 (seção 12): a nutrição (fila de pacientes a triar, triagem, EMTN, mapa de dietas com a etiqueta
  // de bandeja e a refeição do acompanhante) e o serviço social, por hospital e unidade, primeiro no pc. Recolher desliga a
  // chave: a nutrição e a copa voltam ao papel e aos formulários do prontuário; o que o novo gravou continua legível.
  {
    chave: 'nutricao',
    titulo: 'Nutrição: triagem, terapia nutricional, mapa de dietas e etiqueta de bandeja',
    descricao:
      'Fila de pacientes a triar (NRS-2002 ou NUTRIC em até 48 h), meta e acompanhamento da terapia nutricional (EMTN), mapa de dietas por unidade e refeição com jejum e alergias, etiqueta de bandeja e a refeição do acompanhante com direito legal.',
    decisao: 'POL-3 e ficha do M45 (seção 12)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Aceite da nutricionista chave-usuária e da copa: a triagem de um internado, o mapa de uma refeição com jejum do bloco e alergia alimentar conferido contra a prescrição e a etiqueta impressa e lida.',
        responsavel: 'nutricionista chave-usuária e copa',
      },
    ],
  },
  {
    chave: 'servico.social',
    titulo: 'Serviço social: avaliação social e barreiras sociais de alta',
    descricao:
      'Avaliação e evolução do serviço social (rede de apoio, vulnerabilidades, risco, encaminhamentos), com o parecer restrito à categoria e a barreira social de alta enviada ao NIR.',
    decisao: 'POL-3 e ficha do M45 (seção 12; regra 13)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Aceite da assistente social e do encarregado de dados (DPO) sobre o acesso ao dado socioeconômico: o parecer só para a categoria e o resumo para a equipe com vínculo.',
        responsavel: 'assistente social e encarregado de dados (DPO)',
      },
    ],
  },
  // Ficha do M45, etapa 1 (seção 7; cap-11 §11.1): o construtor de formulários novos, só do novo, por estabelecimento.
  // Recolher desliga o construtor; as versões publicadas e os registros continuam legíveis.
  {
    chave: 'pep.formularioNovo',
    titulo: 'Construtor de formulários novos',
    descricao:
      'Formulários novos com perguntas em árvore, escalas com pontos e total calculado, regras de exibição, casos de teste, revisão pela comissão de prontuário e publicação imutável por versão.',
    decisao: 'POL-3, DP-27 e ficha do M45 (seções 5 e 7, regra 14)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Comissão de prontuário nomeada para revisar e aprovar os formulários novos (DP-27), com a apresentação das famílias de modelos decidida.',
        responsavel: 'comissão de prontuário e responsável técnico',
      },
    ],
  },
  // Ficha do M45, seção 5 (`pep.publicarFormularioNovo`): a versão publicada vira modelo do prontuário. Desligada até o
  // cenário controlado do M36 (a operação fica `especificada`); desligada, a versão publicada vale só no Sante SGH.
  {
    chave: 'pep.formularioNovo.modeloLegado',
    titulo: 'Formulário novo como modelo do prontuário',
    descricao:
      'Na publicação, o formulário novo é criado também como modelo do prontuário (perguntas, opções, vínculos e especialidades), para o registro aparecer nas telas de prontuário em uso.',
    decisao: 'POL-3 e ficha do M45 (seção 5: cenário controlado do M36)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado capturado: o administrador do PEP cria na cópia de homologação um modelo de teste com os mesmos tipos de pergunta, e um registro de teste feito no modelo criado pelo Sante SGH abre, aparece e imprime corretamente no prontuário (conferência humana).',
        responsavel: 'administrador do PEP e responsável técnico',
      },
    ],
  },
  // Ficha do M50, seção 12 (etapa 5): a portaria e os visitantes (pc primeiro). Desligada, a portaria segue como hoje
  // (sem registro) e as telas ficam em consulta. A catraca e a biometria têm chaves próprias.
  {
    chave: 'portaria',
    titulo: 'Portaria e visitantes',
    descricao:
      'Cadastro mínimo do visitante com foto e prazo de retenção, visita com crachá de validade, entrada e saída; regras de visita por unidade (horário, visitantes ao mesmo tempo, idade, UTI, isolamento), bloqueio por paciente, sigilo de presença, acompanhante com direito legal e o relatório de contatos para a investigação de surto.',
    decisao: 'POL-3 e ficha do M50 (seção 12; regra 9)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Prazo de retenção do cadastro do visitante e o que a portaria vê aprovados pelo encarregado de dados; regras de visita por unidade conferidas pela enfermagem e pela supervisão da recepção; uma visita com bloqueio simulada na cópia com a portaria.',
        responsavel: 'encarregado de dados (DPO), supervisão da recepção e da portaria',
      },
    ],
  },
  {
    chave: 'portaria.catraca',
    titulo: 'Catracas e terminais da portaria',
    descricao:
      'Integração com a catraca: o integrador local do terminal pergunta se o crachá passa, o sistema responde na hora (liberado ou negado, com o motivo) e registra a passagem; a saída pela catraca encerra a visita. Fora de produção, só o simulador.',
    decisao: 'POL-3 e ficha do M50 (seção 12: autorização do dono para as catracas em produção)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao:
          'Autorização do dono para a integração com as catracas em produção, com o integrador local do fabricante instalado e o usuário de integração criado (acesso.criarUsuarioIntegracao).',
        responsavel: 'dono do projeto e TI',
      },
    ],
  },
  {
    chave: 'portaria.biometria',
    titulo: 'Identificação biométrica e facial na portaria',
    descricao:
      'Identificação do visitante por biometria ou reconhecimento facial na portaria e na catraca. Sem ela, o crachá ou a etiqueta com o documento e a foto (DP-45).',
    decisao: 'POL-3 e DP-45 (biometria só com a decisão do encarregado de dados com a TI)',
    marco: 'M50',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Decisão da DP-45: base legal do dado biométrico (LGPD, art. 11), relatório de impacto e o prazo de retenção aprovados pelo encarregado de dados com a TI.',
        responsavel: 'encarregado de dados (DPO) e TI',
      },
    ],
  },
  // Ficha do M45, seção 12 (etapa 3): o balanço hídrico por unidade, começando pela UTI. Desligado, o balanço segue no
  // papel e a tela fica em consulta.
  {
    chave: 'enfermagem.balanco',
    titulo: 'Balanço hídrico',
    descricao:
      'Ganhos e perdas por paciente com o ganho da checagem e a diurese dos sinais vitais sem redigitar, as perdas por tipo de eliminação, as perdas insensíveis, o fechamento parcial e o de 24 horas na hora de corte da unidade e o débito urinário com o alerta de oligúria.',
    decisao: 'POL-3 e ficha do M45 (seção 12; regra 6)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Plantão de UTI simulado na cópia com o enfermeiro chave-usuário: os ganhos da checagem, as perdas, a fórmula das perdas insensíveis e a hora de corte da unidade conferidos pela gerência de enfermagem.',
        responsavel: 'gerência de enfermagem e enfermeiro chave-usuário da UTI',
      },
    ],
  },
  // Ficha do M45, seção 12 (etapa 2): os escores, as reavaliações, a classificação de pacientes e os índices de UTI, por
  // estabelecimento e unidade, começando pela UTI; só do novo. Recolher volta às escalas em formulário e ao papel; o que
  // foi gravado continua legível.
  {
    chave: 'enfermagem.escores',
    titulo: 'Escores de risco, classificação de pacientes e índices de UTI',
    descricao:
      'NEWS2 calculado a cada aferição com o aviso da conduta, Braden, Morse, Glasgow, RASS, CAM-ICU e dor com o total calculado e as faixas versionadas, reavaliação programada com os cuidados preventivos, Fugulin e NAS por turno com a carga da unidade, e APACHE II e SOFA com a mortalidade esperada e a validação médica.',
    decisao: 'POL-3 e ficha do M45 (seção 12)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Faixas dos escores e cuidados preventivos aprovados pela gerência de enfermagem, os índices de UTI conferidos pela coordenação da UTI (DP-20) e um plantão de UTI simulado na cópia com o NEWS2, o APACHE II e a classificação.',
        responsavel: 'gerência de enfermagem e coordenação da UTI',
      },
    ],
  },
  // Ficha do M45, etapa 6 (seção 12; DP-32): as especialidades sob demanda e o lactário, construídos completos e
  // desligados, ligados quando a área pedir (POL-1, POL-3), por estabelecimento, setor ou pessoa. Recolher desliga a
  // chave: a área volta aos formulários do prontuário e ao papel; o que o novo gravou continua legível.
  {
    chave: 'pep.especialidade.oftalmologia',
    titulo: 'Oftalmologia: exame oftalmológico e acuidade visual',
    descricao:
      'Exame oftalmológico com a acuidade visual sem e com correção pelo cadastro de acuidade, a pressão intraocular com o alerta de hipertensão ocular, a gonioscopia e os exames complementares do cadastro, com a classificação da visão.',
    decisao: 'POL-3, DP-32 e ficha do M45 (seções 7 e 12)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Demanda confirmada pela diretoria clínica (DP-32) e o exame de um paciente conferido pelo oftalmologista chave-usuário na cópia (acuidade, pressão e exames complementares).',
        responsavel: 'diretoria clínica e oftalmologista chave-usuário',
      },
    ],
  },
  {
    chave: 'pep.especialidade.oncologia',
    titulo: 'Oncologia: protocolos de quimioterapia e ciclos',
    descricao:
      'Protocolos de quimioterapia publicados por versão (imutáveis), ciclos do paciente com a dose por superfície corporal, peso ou AUC calculada pelo sistema com as parcelas, o intervalo entre ciclos e a validação farmacêutica com a dupla checagem independente. Os medicamentos do ciclo são prescritos pela prescrição geral.',
    decisao: 'POL-3, DP-32 e ficha do M45 (seções 5, 7 e 12)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Serviço de quimioterapia confirmado pela diretoria clínica (DP-32), protocolos institucionais revisados pelo oncologista responsável e a farmácia clínica com a dupla checagem conferida em um ciclo na cópia.',
        responsavel: 'diretoria clínica, oncologista responsável e farmácia clínica',
      },
    ],
  },
  {
    chave: 'pep.especialidade.obstetricia',
    titulo: 'Obstetrícia e neonatologia: partograma e recém-nascido',
    descricao:
      'Partograma com dilatação, altura da apresentação, batimentos cardíacos fetais, contrações e as linhas de alerta e de ação a partir da fase ativa, com os alertas; registro do recém-nascido com Apgar, peso, idade gestacional e as classificações.',
    decisao: 'POL-3, DP-32 e ficha do M45 (seções 7 e 12)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Serviço de obstetrícia confirmado pela diretoria clínica (DP-32) e um trabalho de parto simulado conferido pelo obstetra e pela enfermagem obstétrica na cópia.',
        responsavel: 'diretoria clínica e obstetra chave-usuário',
      },
    ],
  },
  {
    chave: 'nutricao.lactario',
    titulo: 'Lactário: produção de fórmulas, conferência e etiqueta',
    descricao:
      'Ordem de produção de fórmula por paciente e horário com a validade desde o preparo, a conferência por outra pessoa e a etiqueta de cada porção com os dois identificadores, a fórmula, o volume, o horário e a validade.',
    decisao: 'POL-3, DP-32 e ficha do M45 (seção 12)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Lactário confirmado pela nutrição (DP-32), a validade das fórmulas do serviço definida e a produção de um dia conferida com as etiquetas impressas e lidas.',
        responsavel: 'nutricionista chave-usuária do lactário',
      },
    ],
  },
  // Ficha do M45, seção 12 (etapa 4): o processo de enfermagem e a prescrição de enfermagem aprazada e checada, por
  // estabelecimento e unidade, começando pela UTI. Desligada, a SAE segue no papel e as telas ficam em consulta; o que foi
  // gravado continua legível.
  {
    chave: 'enfermagem.sae',
    titulo: 'Processo de enfermagem e prescrição de enfermagem',
    descricao:
      'Processo de enfermagem em cinco etapas (avaliação, diagnóstico, planejamento com a meta, implementação e evolução) e a prescrição de enfermagem com as atividades aprazadas pela grade da unidade e checadas no turno, com o motivo do não feito e o estorno justificado.',
    decisao: 'POL-3, DP-19 e ficha do M45 (seção 12; regras 7 e 8)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Terminologia do processo de enfermagem escolhida pela diretoria de enfermagem (NANDA-I/NIC/NOC ou CIPE, com a licença) e carregada, e um plantão simulado na cópia com a SAE e a prescrição de enfermagem checada no turno.',
        responsavel: 'diretoria e gerência de enfermagem',
      },
    ],
  },
  // Ficha do M45, seção 12 e regra 17 (etapa 4): a prescrição de medicamento pelo enfermeiro na consulta de enfermagem
  // (Res. COFEN 801/2026), construída e desligada por padrão.
  {
    chave: 'enfermagem.prescricaoMedicamento',
    titulo: 'Prescrição de medicamento pelo enfermeiro',
    descricao:
      'Receita de medicamento do enfermeiro na consulta de enfermagem, pelo protocolo institucional ou de programa de saúde publicado, com o conteúdo mínimo da Res. COFEN 801/2026 e a lista de medicamentos versionada.',
    decisao: 'POL-3, DP-47.10 e ficha do M45 (seção 12; regra 17)',
    marco: 'M45',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Protocolos institucionais ou de programa de saúde publicados e a lista de medicamentos do anexo II conferida (parâmetros da prescrição do enfermeiro), aprovados pela gerência de enfermagem e pelo responsável técnico.',
        responsavel: 'gerência de enfermagem e responsável técnico',
      },
    ],
  },
  // Ficha do M44, seção 5 e regra 14 (etapa 3): o conector com a central de regulação do estado só existe se a DP-29
  // confirmar uma API. Desligado, o número da regulação é registrado à mão (sempre possível). Ligado fora de produção, a
  // mensagem sai pela outbox na mesma transação e o simulador responde (a trava de saídas recusa endereço real).
  {
    chave: 'nir.regulacaoConector',
    titulo: 'Conector com a central de regulação do estado',
    descricao:
      'Envio do pedido de regulação à central e recebimento da resposta (número e situação) sem digitação; sem ele, o NIR registra o número à mão.',
    decisao: 'POL-3, DP-29 e ficha do M44 (seção 5, regra 14)',
    marco: 'M44',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao:
          'API da central de regulação do estado confirmada (DP-29), com o credenciamento do hospital e o ambiente de homologação da central.',
        responsavel: 'NIR, diretoria clínica e TI',
      },
    ],
  },
  // Ficha do M57, seção 12 (etapa 1): o MPI da Rede por estabelecimento, depois do fim da migração dele (M43; regra
  // comum 1 da Fase 7). Recolher = desligar: o índice fica guardado e os cadastros de cada estabelecimento não mudam.
  {
    chave: 'rede.mpi',
    titulo: 'MPI da Rede: paciente único entre os estabelecimentos',
    descricao:
      'Fila de prováveis duplicados entre os estabelecimentos da rede, com a comparação lado a lado, "é a mesma pessoa" ou "é outra pessoa", desfazer o vínculo e o relatório de divergência entre os índices.',
    decisao: 'POL-3 e ficha do M57 (seção 12)',
    marco: 'M57',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Fim da migração do estabelecimento registrado na aba do fim, com a ata do comitê (a Rede só liga depois dele).',
        responsavel: 'dono do projeto',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Amostra da fila e dos pares automáticos revisada na cópia pelo gestor de cadastro de cada estabelecimento.',
        responsavel: 'gestor de cadastro',
      },
    ],
  },
  // Ficha do M57, seção 12 (etapa 3): o BI consolidado da Rede por estabelecimento (o que está desligado fica fora do
  // consolidado, com o motivo) e o pseudônimo comum do data mart, que só liga com a DP-42 registrada.
  {
    chave: 'rede.bi',
    titulo: 'BI consolidado da Rede',
    descricao:
      'Indicadores com a mesma ficha técnica, painel operacional e financeiro somados entre os estabelecimentos da rede, com as parcelas de cada um, e o registro dos serviços compartilhados.',
    decisao: 'POL-3 e ficha do M57 (seções 12 e 13)',
    marco: 'M57',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Painéis consolidados validados pela diretoria da Rede com a ficha técnica (mesma definição nos estabelecimentos).',
        responsavel: 'diretoria da Rede',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Encarregado de dados (DPO) confere o data mart da Rede sem dado pessoal e a guarda da chave do pseudônimo.',
        responsavel: 'encarregado de dados',
      },
    ],
  },
  {
    chave: 'rede.pseudonimoComum',
    titulo: 'Pseudônimo comum entre os estabelecimentos (data mart da Rede)',
    descricao:
      'O paciente ligado no MPI da Rede recebe o mesmo pseudônimo em todos os estabelecimentos, e a reinternação passa a poder ser contada entre eles. Desligado: pseudônimo por estabelecimento.',
    decisao: 'POL-3, ficha do M57 (regra 9) e DP-42',
    marco: 'M57',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'DP-42 (compartilhamento entre os estabelecimentos) registrada pelo encarregado de dados e pelo jurídico, permitindo o pseudônimo comum.',
        responsavel: 'encarregado de dados e jurídico',
      },
    ],
  },
  // Ficha do M57, seção 12 (etapa 2): o acesso cruzado ao prontuário entre os estabelecimentos da rede só existe pela
  // regra da DP-42 (prontuário compartilhado ou acesso cruzado sob regra; regra 6). Até a decisão, só o aviso de que há
  // atendimentos (chave `rede.mpi`). Ligada, vale nos DOIS estabelecimentos: no da sessão e no do registro.
  {
    chave: 'rede.acessoCruzado',
    titulo: 'Acesso ao prontuário do paciente em outro estabelecimento da rede',
    descricao:
      'Abrir, a partir do aviso no cabeçalho do paciente, a linha do tempo dele no outro estabelecimento da rede, com motivo e justificativa; a leitura vai à trilha do banco onde o registro está.',
    decisao: 'POL-3, DP-42 e ficha do M57 (seção 12)',
    marco: 'M57',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Regra de compartilhamento do prontuário entre os estabelecimentos da rede decidida e registrada (DP-42: prontuário compartilhado ou acesso cruzado sob regra).',
        responsavel: 'DPO e jurídico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'MPI da Rede liberado nos dois estabelecimentos (o acesso segue o vínculo da mesma pessoa).',
        responsavel: 'gestor de cadastro',
      },
    ],
  },
  // Ficha do M57, seção 5 (etapa 2; especificada no M11): a unificação de prontuários duplicados do mesmo
  // estabelecimento pelo Sante. A receita está completa, mas o que mais o programa de hoje move (atendimentos, contas,
  // documentos) só se sabe pelo cenário controlado na homologação: até lá, desligada.
  {
    chave: 'cadastro.unificacao',
    titulo: 'Unificação de prontuários duplicados',
    descricao:
      'Na fila de duplicidades, "Unificar" o par: o prontuário absorvido fica inativo e aponta para o que fica, e a fila registra a unificação.',
    decisao: 'POL-3 e ficha do M57 (seção 5)',
    marco: 'M57',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Cenário controlado da unificação capturado na homologação (o que mais é movido junto: atendimentos, contas, documentos) e as assinaturas com 0 diferença.',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao: 'Conferência da unificação pelo chave-usuário do arquivo médico (SAME).',
        responsavel: 'chave-usuário do SAME',
      },
    ],
  },
  // Ficha do M46, seção 12 (etapa 1): APA, ficha anestésica e SRPA, por bloco inteiro, primeiro no pc; recolher = o
  // bloco volta ao processo atual, e o que já foi registrado no novo continua legível.
  {
    chave: 'bloco.ficha',
    titulo: 'Avaliação pré-anestésica, ficha anestésica e recuperação pós-anestésica',
    descricao:
      'Avaliação pré-anestésica estruturada (ASA, via aérea, jejum, risco e plano), ficha anestésica com sinais a cada 5 minutos, fármacos, gases, fluidos, eventos e passagem entre anestesistas, assinada pelo anestesista da cirurgia, e a recuperação com o índice de Aldrete-Kroulik a cada 15 minutos e a alta pela regra versionada.',
    decisao: 'POL-3 e ficha do M46 (seção 12)',
    marco: 'M46',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Formulários do bloco (avaliação pré-anestésica, ficha anestésica em resumo e recuperação) publicados e conferidos no prontuário pelo anestesista chave-usuário (DP-3).',
        responsavel: 'anestesista chave-usuário',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Uma cirurgia eletiva roteirizada na cópia, da avaliação à alta da recuperação, conferida pela coordenação do bloco e pela enfermagem; a regra de alta (índice mínimo, dor e permanência) confirmada pela anestesia.',
        responsavel: 'coordenação do bloco e anestesia',
      },
    ],
  },
  // Ficha do M47, seção 12 (etapa 3): a lista de trabalho DICOM. Desligada, a modalidade continua sem worklist (o
  // processo atual); ligada, todo exame de imagem lançado de setor com modalidade DICOM vira item da MWL pela outbox
  // (fora de produção, só ao simulador: a trava de saídas recusa endereço real) e o status do exame volta ao prontuário.
  // Recolher: a outbox para de enviar à MWL; os itens e os estudos já recebidos continuam em consulta.
  {
    chave: 'imagem.worklist',
    titulo: 'Lista de trabalho DICOM e integração com o PACS',
    descricao:
      'O exame de imagem lançado vira item da lista de trabalho da modalidade (número de acesso único, reenvio sem duplicar), o status do exame volta da modalidade e o link do visualizador aparece no prontuário e, com o laudo liberado, no portal.',
    decisao: 'POL-3 e ficha do M47 (seção 12, regra 8)',
    marco: 'M47',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao:
          'PACS/RIS real configurado como parceiro de integração (endereço do intermediário da lista de trabalho, AE title das modalidades e a credencial do retorno do status), com a autorização do dono para a integração.',
        responsavel: 'TI e coordenação da imagem',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Worklist testada com o PACS real em produção: um exame lançado chega à modalidade com o número de acesso, o status volta e o link abre o estudo.',
        responsavel: 'técnico de imagem, radiologista e responsável técnico',
      },
    ],
  },
  // Ficha do M46, seção 12 (etapa 2): o checklist de cirurgia segura (OMS) em três momentos, primeiro sem trava
  // (DP-31b: pode ser liberado antes do resto do bloco); o registro no prontuário entra com o formulário publicado.
  {
    chave: 'bloco.checklistFormulario',
    titulo: 'Checklist de cirurgia segura',
    descricao:
      'O checklist de cirurgia segura da OMS em três momentos (antes da indução, antes da incisão e antes de sair da sala), conduzido pelo circulante no tablet, com quem confirmou cada item e a hora. Sem a trava da incisão.',
    decisao: 'POL-3, DP-31 (b) e ficha do M46 (seção 12)',
    marco: 'M46',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Lista de itens (versão 1, da OMS e do protocolo do Ministério da Saúde) aprovada pelo núcleo de segurança do paciente e o formulário do checklist conferido no prontuário (DP-31 e DP-27).',
        responsavel: 'núcleo de segurança do paciente',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Uma cirurgia eletiva roteirizada na cópia com os três momentos do checklist, conferida pela enfermagem do bloco.',
        responsavel: 'enfermagem do bloco',
      },
    ],
  },
  // A trava (regra 2): sem a pausa cirúrgica concluída, a incisão não é registrada no novo. Ligada por bloco inteiro: só
  // quando todo o bloco do estabelecimento estiver no novo (a trava não alcança o que é registrado fora dele).
  {
    chave: 'bloco.checklistTrava',
    titulo: 'Trava da incisão pelo checklist',
    descricao:
      'A hora da incisão (no registro da cirurgia e na ficha anestésica) só é aceita com a pausa cirúrgica do checklist concluída; em urgência, o supervisor do bloco registra a exceção com o motivo.',
    decisao: 'POL-3 e ficha do M46 (regra 2 e seção 12)',
    marco: 'M46',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'O bloco inteiro do estabelecimento liberado no novo (checklist, avaliação pré-anestésica, ficha anestésica, recuperação e registro da cirurgia): a trava não alcança o que é registrado fora dele.',
        responsavel: 'coordenação do bloco',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'Procedimento da exceção em urgência (quem é o supervisor e como registra o motivo) aprovado pelo núcleo de segurança do paciente.',
        responsavel: 'núcleo de segurança do paciente',
      },
    ],
  },
  // O rastreio do paciente no bloco e o painel para familiares (código anônimo, etapa e horário; nunca nome).
  {
    chave: 'bloco.rastreio',
    titulo: 'Rastreio do paciente no bloco e painel para familiares',
    descricao:
      'A movimentação do paciente no bloco (pré-operatório, espera, sala, recuperação e saída) com o quadro do bloco em tempo real e o painel para familiares na sala de espera, só com o código anônimo, a etapa e o horário.',
    decisao: 'POL-3 e ficha do M46 (seção 12)',
    marco: 'M46',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'O painel para familiares conferido na sala de espera (só o código, a etapa e o horário) e a entrega do código à família combinada com a secretaria do bloco.',
        responsavel: 'coordenação do bloco',
      },
    ],
  },
  // Ficha do M46, seção 12 (etapa 3): o OPME ponta a ponta (solicitação ligada à agenda, autorização da operadora,
  // consignação, consumo em sala com o rastreio e a etiqueta, devolução e conciliação com a conta). O consumo é a saída
  // do estoque a paciente internado (M28), que segue pendente do item na conta gravado na consolidação (D-MOTOR-28).
  {
    chave: 'suprimentos.opme',
    titulo: 'OPME: solicitação, autorização, consumo em sala e conciliação',
    descricao:
      'O OPME pedido para a cirurgia agendada, com a autorização da operadora (senha e guia), a consignação, o consumo em sala com o rastreio por lote ou série e a etiqueta em três vias, a devolução do não usado e a conciliação com a conta.',
    decisao: 'POL-3, D-MOTOR-28 e ficha do M46 (seção 12)',
    marco: 'M46',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Os consumos de OPME conferidos: o saldo, o valor e o item na conta iguais aos que o lançamento atual produz para a mesma saída, numa cirurgia eletiva completa com OPME consignado, do pedido à conta.',
        responsavel: 'almoxarifado e faturamento da conta cirúrgica',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'O item na conta do paciente gravado com a saída do estoque (o cenário controlado do motor de estoque; até lá o consumo fica em consulta).',
        responsavel: 'responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'A etiqueta de três vias (prontuário, paciente e faturamento) impressa e lida no bloco, e a rotina da autorização da operadora combinada com o faturamento.',
        responsavel: 'enfermagem do bloco e faturamento',
      },
    ],
  },
  // Ficha do M46, seção 12 (etapa 4): os consignados (saldo por fornecedor e item, remessa, reposição, faturamento pela
  // nota da entrada e devolução ao fornecedor) e a manipulação (ordem do item validado, capela, dupla conferência e a
  // baixa do insumo pela saída do estoque, que segue pendente do motor do cenário controlado, D-MOTOR-28).
  {
    chave: 'suprimentos.consignado',
    titulo: 'Consignados: saldo por fornecedor, remessa, reposição e faturamento',
    descricao:
      'O material consignado por fornecedor e item: a remessa com a nota do fornecedor, o consumo em sala do OPME consignado, a reposição, o faturamento ligado à nota fiscal da entrada do estoque e a devolução ao fornecedor, com o saldo e o indicador do consumo sem faturamento.',
    decisao: 'POL-3 e ficha do M46 (seção 12)',
    marco: 'M46',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'O saldo de consignado de cada fornecedor conferido com o inventário físico do material em consignação no almoxarifado e no bloco (a carga inicial pelas remessas).',
        responsavel: 'almoxarifado e suprimentos',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'A rotina da reposição e do faturamento combinada com os fornecedores de consignado e com o faturamento da conta cirúrgica (a nota fiscal registrada na entrada do estoque).',
        responsavel: 'suprimentos e faturamento',
      },
    ],
  },
  // Ficha do M55, seção 12 (fatia F2): rouparia e lavanderia, por hospital (pc primeiro). Recolher é desligar a chave: a
  // rouparia volta ao controle de hoje e o que foi gravado continua legível.
  {
    chave: 'rouparia',
    titulo: 'Rouparia e lavanderia',
    descricao:
      'O enxoval com peças e kits, a cota por setor, a coleta pesada por setor, o envio e o retorno da lavanderia conferidos em quilos e peças (a diferença acima da tolerância vira ocorrência para o fornecedor), a entrega ao setor, as perdas, o inventário e os quilos por setor para o custeio.',
    decisao: 'POL-3 e ficha do M55 (seção 12)',
    marco: 'M55',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Validação na cópia pela hotelaria (ficha do M55, seção 13): o enxoval e as cotas cadastrados, uma coleta pesada, um envio e o retorno conferido, uma entrega, uma perda e um inventário registrados, e os quilos por setor conferidos com as parcelas.',
        responsavel: 'hotelaria (rouparia)',
      },
    ],
  },
  {
    chave: 'suprimentos.manipulacao',
    titulo: 'Manipulação: ordem do item validado, capela e dupla conferência',
    descricao:
      'A ordem de manipulação do item prescrito validado pela farmácia, com a capela e o grupo, o insumo com o lote e a validade, a validade da sobra, a dupla conferência por outro farmacêutico e a baixa do insumo pela saída do estoque.',
    decisao: 'POL-3, D-MOTOR-28 e ficha do M46 (seção 12)',
    marco: 'M46',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'A avaliação farmacêutica em uso no estabelecimento (a ordem nasce do item validado pela farmácia) e as capelas e os grupos de manipulação conferidos no cadastro.',
        responsavel: 'farmácia hospitalar e responsável técnico',
      },
      {
        tipo: 'aprovacao',
        descricao:
          'A baixa do insumo conferida: o saldo, o lote e o valor iguais aos que o lançamento atual produz para a mesma saída (o motor de estoque do cenário controlado).',
        responsavel: 'farmácia hospitalar e almoxarifado',
      },
    ],
  },
  // M58 (ficha, seções 6 e 12; regra 6): a entrada deixa de ser restrita ao CP1252 só depois da conversão do banco do
  // estabelecimento para UTF-8, ensaiada na cópia (M58-F3) e executada na janela pela TI. O validador de entrada (M02)
  // lê esta chave junto com o parâmetro `legado.charset`; com o charset ainda CP1252 a chave não liga (D-UTF8-58).
  {
    chave: 'entrada.utf8',
    titulo: 'Entrada de texto sem a restrição de caracteres',
    descricao:
      'Aceita qualquer caractere nos campos de texto (emoji e outros alfabetos), depois da conversão do banco do estabelecimento para UTF-8.',
    decisao: 'ficha do M58 (seções 6 e 12; regra 6)',
    marco: 'M58',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Conversão para UTF-8 ensaiada na cópia (assinaturas, codec e parceiros) e executada na janela, com a autorização do dono registrada.',
        responsavel: 'dono do projeto e TI do hospital',
      },
    ],
  },
  // Ficha do M54, seção 12 (etapa 4): custos hospitalares por hospital (pc primeiro; hs só depois, em lote, DP-4). A
  // estrutura e as estatísticas gravam só SGH_CUS_*; a chave liga quando o analista de custos revisar a classificação
  // dos centros, a ordem e os critérios do rateio e conferir uma competência de estatísticas.
  {
    chave: 'custos',
    titulo: 'Custos hospitalares',
    descricao:
      'Estrutura de custos (centros produtivos, auxiliares e administrativos, ordem e critério do rateio), coleta e lançamento das estatísticas por centro e competência e, nas etapas seguintes, a apuração do custo do mês.',
    decisao: 'POL-3 e ficha do M54 (seção 12)',
    marco: 'M54',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'A classificação dos centros, a ordem e os critérios do rateio revisados e uma competência de estatísticas conferida com as áreas (internação, bloco, exames, almoxarifado e pessoas).',
        responsavel: 'analista de custos e controladoria',
      },
    ],
  },
  // Ficha do M54, seção 12 (etapa 7): orçamento empresarial por hospital (pc primeiro; hs só depois, em lote, DP-4). As
  // versões e as linhas gravam só SGH_ORC_*; o realizado é só lido. A chave liga quando a controladoria montar o
  // orçamento de um centro na cópia e conferir o realizado com o financeiro e o almoxarifado.
  {
    chave: 'orcamento',
    titulo: 'Orçamento empresarial',
    descricao:
      'Orçamento anual por centro de custo e item gerencial, com versões e aprovação, e o comparativo orçado × realizado (despesas e receitas pela classificação gerencial, consumo de estoque por centro) com o desvio.',
    decisao: 'POL-3 e ficha do M54 (seção 12)',
    marco: 'M54',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'O orçamento de um centro de custo montado na cópia e o realizado do período conferido com o financeiro (classificação gerencial) e com o almoxarifado (consumo por centro).',
        responsavel: 'controller e diretoria administrativa e financeira',
      },
    ],
  },
  // Ficha do M54, seção 12 (etapa 6): patrimônio por hospital (pc primeiro; hs só depois, em lote, DP-4). Bens,
  // movimentos, depreciação e inventário gravam só SGH_PAT_*; a chave liga quando o responsável pelo patrimônio cadastrar
  // bens de notas de teste, conferir uma depreciação com a contabilidade e fizer um inventário de teste.
  {
    chave: 'patrimonio',
    titulo: 'Patrimônio',
    descricao:
      'Cadastro de bens a partir da nota fiscal de entrada (ou da doação com termo), plaqueta e QR, transferência com aceite, empréstimo, comodato e baixa, depreciação mensal integrada à contabilidade e inventário pelo celular.',
    decisao: 'POL-3 e ficha do M54 (seção 12)',
    marco: 'M54',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Bens cadastrados de notas de teste, uma depreciação mensal conferida com a contabilidade (regra do fato de origem Patrimônio) e um inventário de teste feito com o celular.',
        responsavel: 'responsável pelo patrimônio e controladoria',
      },
    ],
  },
];

export function recursoDesligado(chave: string): RecursoDesligado | undefined {
  return RECURSOS_DESLIGADOS.find((r) => r.chave === chave);
}

// ── API ──────────────────────────────────────────────────────────────────────────────────────────

const valorEscopo = textoCp1252(40)
  .pipe(z.string().min(1))
  .refine((v) => [...v].every((c) => c.charCodeAt(0) >= 32), 'sem caractere de controle');

/** Linha de ESTADO.md › Autorizações (texto que o banco grava em WIN1252). */
const referenciaAutorizacao = textoCp1252(200).pipe(z.string().min(3));

/** Data de calendário AAAA-MM-DD que existe (2026-13-45 e 2026-02-30 são recusadas no contrato). */
export function dataDeCalendario(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const x = new Date(Date.UTC(a, me - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === me - 1 && x.getUTCDate() === d;
}

export const esquemaChaveDescrita = z.object({
  escopo: z.enum(ESCOPOS_LIBERACAO),
  valor: z.string(),
  ligada: z.boolean(),
  lote: z.string().nullable(),
  alteradoPor: z.string(),
  alteradoEm: z.string(),
});
export type ChaveDescrita = z.infer<typeof esquemaChaveDescrita>;

export const esquemaPrerequisitoDescrito = z.object({
  tipo: z.enum(TIPOS_PREREQUISITO),
  descricao: z.string(),
  responsavel: z.string(),
  situacao: z.enum(SITUACOES_PREREQUISITO),
  validade: z.string().nullable(),
  evidencia: z.string().nullable(),
  /** Falta (pendente ou vencido): a chave não liga. */
  falta: z.boolean(),
  motivo: z.string().nullable(),
});

export const esquemaFuncionalidadeDescrita = z.object({
  tipo: z.enum(['recurso', 'operacao']),
  chave: z.string(),
  titulo: z.string(),
  descricao: z.string(),
  marco: z.string().nullable(),
  /** Estado no catálogo de operações (só `operacao`). */
  estadoCatalogo: z.string().nullable(),
  ligadaNoEstabelecimento: z.boolean(),
  chaves: z.array(esquemaChaveDescrita),
  prerequisitos: z.array(esquemaPrerequisitoDescrito),
  podeLigar: z.boolean(),
  motivoBloqueio: z.string().nullable(),
});
export type FuncionalidadeDescrita = z.infer<typeof esquemaFuncionalidadeDescrita>;

export const esquemaPainelLiberacao = z.object({
  estabelecimento: z.string(),
  funcionalidades: z.array(esquemaFuncionalidadeDescrita),
  destino: z.enum(['legado', 'memoria']),
});
export type PainelLiberacao = z.infer<typeof esquemaPainelLiberacao>;

/** Liga ou desliga a chave numa ação só (lote: lista de setores, grupos ou pessoas; DP-4). */
export const esquemaPedidoLiberacao = z.object({
  chave: z.string().min(1).max(80),
  tipo: z.enum(['recurso', 'operacao']),
  escopo: z.enum(ESCOPOS_LIBERACAO),
  /** '*' para o estabelecimento inteiro; lista no lote. */
  valores: z.array(valorEscopo).min(1).max(500),
  ligar: z.boolean(),
  justificativa: textoCp1252(200).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
  /** Reautenticação (config.liberacao.editar é crítica). */
  senha: z.string().min(1).max(200),
  /** Linha de ESTADO.md › Autorizações (obrigatória para LIGAR qualquer chave em produção). */
  referenciaAutorizacao: referenciaAutorizacao.optional(),
});
export type PedidoLiberacao = z.infer<typeof esquemaPedidoLiberacao>;

export const esquemaReverterLote = z.object({
  lote: z.string().regex(/^\d{1,18}$/),
  justificativa: textoCp1252(200).pipe(z.string().min(10)),
  senha: z.string().min(1).max(200),
  /** Obrigatória em produção quando a reversão volta a LIGAR alguma linha. */
  referenciaAutorizacao: referenciaAutorizacao.optional(),
});

/**
 * Registro do pré-requisito. `cumprido` exige a referência da evidência; `dispensado` exige a evidência e a
 * linha de autorização do dono (ESTADO.md › Autorizações): sem isso, quem liga a chave se dispensaria sozinho.
 */
export const esquemaPedidoPrerequisito = z
  .object({
    recurso: z.string().min(1).max(80),
    tipo: z.enum(TIPOS_PREREQUISITO),
    situacao: z.enum(SITUACOES_PREREQUISITO),
    validade: z.string().refine(dataDeCalendario, 'data inexistente').nullable(),
    /** Referência da evidência (protocolo, número do credenciamento), NUNCA o segredo nem o certificado. */
    evidencia: textoCp1252(200).nullable(),
    referenciaAutorizacao: referenciaAutorizacao.optional(),
    senha: z.string().min(1).max(200),
  })
  .refine((p) => p.situacao === 'pendente' || (p.evidencia !== null && p.evidencia.trim().length >= 3), {
    message: 'Cumprido ou dispensado exige a referência da evidência.',
    path: ['evidencia'],
  })
  .refine((p) => p.situacao !== 'dispensado' || p.referenciaAutorizacao !== undefined, {
    message: 'Dispensar exige a linha de autorização do dono.',
    path: ['referenciaAutorizacao'],
  });

export const esquemaResultadoLiberacao = z.object({
  lote: z.string(),
  alteradas: z.number().int(),
  destino: z.enum(['legado', 'memoria']),
});
export type ResultadoLiberacao = z.infer<typeof esquemaResultadoLiberacao>;
