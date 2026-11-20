// Prontidão por setor e treinamento por papel (ficha do M35; cap-15 §15.2.2 dia 7, §15.3.2, §15.3.3, §15.4.1,
// §15.5). Catálogo versionado: os papéis do treinamento com os grupos funcionais que os compõem (as parcelas do
// cap-15 §15.4.1 são a referência; a contagem vale a medida na cópia, agregada), os setores das ondas com as
// operações (por padrão de nome do catálogo docs/operacoes/catalogo), as funcionalidades (chaves de
// liberação, POL-3), os marcos que constroem o setor, as jornadas automáticas, o roteiro de conferência e as
// dúvidas de processo abertas. Fonte única de `pnpm prontidao:relatorio`, `pnpm homologacao:pacote` e
// `pnpm treinamento:gerar` e da tela "Prontidão por setor". Os textos daqui podem aparecer na tela: nunca citam o
// outro sistema pelo nome (ADR 0023).

/** Papéis do Sante SGH para o treinamento (cap-15 §15.4.1). */
export const PAPEIS_TREINAMENTO = [
  'medico',
  'enfermagem',
  'faturamento',
  'recepcao',
  'suprimentos',
  'sadt',
  'financeiro',
  'multiprofissional',
  'gestao',
  'outros',
] as const;
export type PapelTreinamento = (typeof PAPEIS_TREINAMENTO)[number];

export interface DefinicaoPapel {
  readonly id: PapelTreinamento;
  readonly nome: string;
  /** Grupos funcionais (TBGRUUSU.NOME, chave sem acento) que compõem o papel. */
  readonly grupos: readonly string[];
  /** Parcelas de referência do cap-15 §15.4.1 no `pc` (grupo → usuários), para conferir a medida. */
  readonly referencia: Readonly<Record<string, number>>;
  /** Onda(s) em que o papel começa (cap-15 §15.4.1). */
  readonly ondas: readonly number[];
  readonly cargaHoraria: string;
}

/** Grupo de quem não tem grupo (ou tem um grupo que não existe mais no cadastro de grupos). */
export const SEM_GRUPO = 'SEM GRUPO';

export const PAPEIS: readonly DefinicaoPapel[] = [
  {
    id: 'medico',
    nome: 'Médico',
    grupos: ['MEDICOS', 'MEDICOS_SUPERVISAO'],
    referencia: { MEDICOS: 320, MEDICOS_SUPERVISAO: 6 },
    ondas: [2],
    cargaHoraria: '3 h, em módulos de 1 h no setor',
  },
  {
    id: 'enfermagem',
    nome: 'Enfermagem',
    grupos: [
      'ENFERMAGEM_TECNICO',
      'ENFERMAGEM_ENFERMEIRO',
      'ENFERMAGEM_ENFERMEIRO_CC',
      'ENFERMAGEM_SUPERVISAO',
    ],
    referencia: {
      ENFERMAGEM_TECNICO: 109,
      ENFERMAGEM_ENFERMEIRO: 27,
      ENFERMAGEM_ENFERMEIRO_CC: 16,
      ENFERMAGEM_SUPERVISAO: 2,
    },
    ondas: [2],
    cargaHoraria: '6 h, com prática de checagem',
  },
  {
    id: 'faturamento',
    nome: 'Faturamento e auditoria de contas',
    grupos: [
      'FATURAMENTO',
      'FATURAMENTO_AUDITORIA',
      'FATURAMENTO_ASSISTENCIAL',
      'FATURAMENTO_SUPERVISAO',
      'FATURAMENTO_AUDITORIA_MATMED',
    ],
    referencia: {
      FATURAMENTO: 47,
      FATURAMENTO_AUDITORIA: 14,
      FATURAMENTO_ASSISTENCIAL: 8,
      FATURAMENTO_SUPERVISAO: 3,
      FATURAMENTO_AUDITORIA_MATMED: 2,
    },
    ondas: [4],
    cargaHoraria: '16 h, em etapas',
  },
  {
    id: 'recepcao',
    nome: 'Recepção e atendimento',
    grupos: [
      'ATENDIMENTO_INTERNACAO',
      'ATENDIMENTO',
      'ATENDIMENTO_SUPERVISAO',
      'ATENDIMENTO_PRONTO ATENDIMENTO',
    ],
    referencia: {
      ATENDIMENTO_INTERNACAO: 13,
      ATENDIMENTO: 12,
      ATENDIMENTO_SUPERVISAO: 4,
      'ATENDIMENTO_PRONTO ATENDIMENTO': 2,
    },
    ondas: [1, 2],
    cargaHoraria: '6 h',
  },
  {
    id: 'suprimentos',
    nome: 'Farmácia, almoxarifado e compras',
    grupos: ['FARMACIA', 'FARMACIA_SUPERVISAO', 'ALMOXARIFADO', 'ALMOXARIFADO_SUPERVISAO', 'COMPRAS'],
    referencia: {
      FARMACIA: 17,
      FARMACIA_SUPERVISAO: 3,
      ALMOXARIFADO: 6,
      ALMOXARIFADO_SUPERVISAO: 1,
      COMPRAS: 4,
    },
    ondas: [3],
    cargaHoraria: '12 h',
  },
  {
    id: 'sadt',
    nome: 'Laboratório e SADT',
    grupos: ['LABORATORIO', 'LABORATORIO_SUPERVISAO', 'EXAMES_TECNICO'],
    referencia: { LABORATORIO: 11, LABORATORIO_SUPERVISAO: 3, EXAMES_TECNICO: 8 },
    ondas: [2],
    cargaHoraria: '6 h',
  },
  {
    id: 'financeiro',
    nome: 'Financeiro',
    grupos: [
      'FINANCEIRO',
      'FINANCEIRO_SUPERVISAO',
      'FINANCEIRO_CONTAS_A_RECEBER',
      'DIRETOR_FINANCEIRO',
      'FINANCEIRO_CONSULTA',
      'MASTER_CONSULTA_FINANCEIRO',
    ],
    referencia: {
      FINANCEIRO: 7,
      FINANCEIRO_SUPERVISAO: 3,
      FINANCEIRO_CONTAS_A_RECEBER: 2,
      DIRETOR_FINANCEIRO: 1,
      FINANCEIRO_CONSULTA: 1,
      MASTER_CONSULTA_FINANCEIRO: 1,
    },
    ondas: [4],
    cargaHoraria: '12 h',
  },
  {
    id: 'multiprofissional',
    nome: 'Multiprofissional',
    grupos: ['NUTRICAO', 'FISIOTERAPIA'],
    referencia: { NUTRICAO: 5, FISIOTERAPIA: 5 },
    ondas: [2],
    cargaHoraria: '3 h',
  },
  {
    id: 'gestao',
    nome: 'Gestão e administração do sistema',
    grupos: ['MASTER', 'MASTER_SEM_FINANCEIRO'],
    referencia: { MASTER: 17, MASTER_SEM_FINANCEIRO: 6 },
    ondas: [0],
    cargaHoraria: '8 h, mais a trilha de gestor de acessos',
  },
  {
    id: 'outros',
    nome: 'Outros (painéis, hotelaria e sem grupo)',
    grupos: [
      'PAINEIS',
      'HOTELARIA',
      SEM_GRUPO,
      'DIRETORIA',
      'TI',
      'TI_SUPERVISAO',
      'COMPRAS_SUPERVISAO',
      'EXAMES_LAUDOS',
      'HOTERIA_SUPERVISAO',
    ],
    referencia: { PAINEIS: 14, HOTELARIA: 1, [SEM_GRUPO]: 26 },
    ondas: [2, 3, 4, 5],
    cargaHoraria: 'conforme o papel',
  },
];

/** Total de referência do cap-15 §15.4.1 no `pc` (326 + 154 + 74 + 31 + 31 + 22 + 15 + 10 + 23 + 41). */
export const TOTAL_REFERENCIA_PUBLICO = 727;

/** Item de conferência do roteiro de homologação: o que abrir, onde e o que deve aparecer. */
export interface PassoConferencia {
  readonly abrir: string;
  readonly onde: string;
  readonly esperado: string;
}

/** Jornada automática do setor (arquivo do E2E e o trecho do título dos testes; integração na cópia). */
export interface JornadaSetor {
  readonly arquivo: string;
  /** Trecho do título (sem diferenciar maiúsculas); vazio = todos os testes do arquivo. */
  readonly teste: string;
}

export interface DefinicaoSetor {
  readonly id: string;
  readonly nome: string;
  /** Onda do cap-15 §15.3.3 (0 a 5). */
  readonly onda: number;
  readonly papeis: readonly PapelTreinamento[];
  /** Operações do catálogo: nome exato ou prefixo terminado em `*` (ex.: `agenda.*`). `!` exclui. */
  readonly operacoes: readonly string[];
  /** Leituras do setor fora do catálogo de gravação (só a conferência do chave-usuário, cap-15 §15.3.1). */
  readonly leituras: readonly string[];
  /** Chaves de liberação (funcionalidades, POL-3) que o setor usa. */
  readonly recursos: readonly string[];
  /** Marcos que constroem o setor (o estado vem do quadro de marcos do ESTADO.md). */
  readonly marcos: readonly string[];
  readonly jornadas: readonly JornadaSetor[];
  readonly roteiro: readonly PassoConferencia[];
  /** Dúvidas de processo e decisões abertas (DP-nn, passos da validação). */
  readonly duvidas: readonly string[];
}

export const SETORES_PRONTIDAO: readonly DefinicaoSetor[] = [
  {
    id: 'consultas-gestao',
    nome: 'Consultas para diretoria, coordenações e NIR',
    onda: 0,
    papeis: ['gestao', 'medico', 'enfermagem'],
    operacoes: ['relatorio.*', 'auditoria.*'],
    leituras: [
      'pep.abrirProntuario',
      'internacao.abrirPainelLeitos',
      'relatorio.consultarIndicadores',
      'consultas de cadastro (M14)',
      'catálogo de relatórios (M34)',
    ],
    // M38: as chaves de tela da onda 0 entram no setor, para o lote do painel de migração ligá-las juntas.
    recursos: [
      'pep.prontuario.consulta',
      'internacao.leitos.painel',
      'relatorio.paineis',
      'relatorio.bi',
      'cadastro.paciente.consulta',
      'cadastro.historico.consulta',
      'cadastro.profissional.consulta',
      'config.dominio.consulta',
      'auditoria.acessos.consulta',
      'config.matriz.consulta',
      'sistema.saude.consulta',
    ],
    marcos: ['M14', 'M15', 'M16', 'M34'],
    jornadas: [
      { arquivo: 'apps/web/e2e/prontuario.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/leitos.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/m14.spec.ts', teste: 'matriz' },
      { arquivo: 'apps/web/e2e/m34.spec.ts', teste: 'emitir relatório' },
    ],
    roteiro: [
      {
        abrir: 'Prontuário do paciente sintético da sessão',
        onde: 'Prontuário > Prontuário ao vivo',
        esperado:
          'os mesmos registros, na mesma ordem e com o documento como emitido que o outro sistema mostra para o paciente',
      },
      {
        abrir: 'Painel de leitos',
        onde: 'Internação > Painel de leitos',
        esperado: 'a mesma ocupação por unidade que o mapa de leitos do outro sistema, na mesma hora',
      },
      {
        abrir: 'Indicador do mês anterior',
        onde: 'Relatórios > Indicadores',
        esperado: 'o mesmo número do relatório de origem no mesmo período (a ficha do indicador diz qual)',
      },
    ],
    duvidas: [
      'DP-3: chave-usuário da diretoria e das coordenações',
      'passo M16-10: painel × mapa de leitos, hora de fechamento do censo',
      'passo M34-13: cada área confere o relatório do catálogo antes de ligar',
      'DP-40 e pentest (M36) antes de ligar o prontuário ao vivo',
    ],
  },
  {
    id: 'cadastros-estrutura',
    nome: 'Cadastros, acessos e estrutura',
    onda: 1,
    papeis: ['gestao', 'recepcao'],
    operacoes: [
      'cadastro.*',
      'acesso.*',
      'organizacao.*',
      'catalogo.*',
      'config.*',
      'pessoas.*',
      'integracao.*',
    ],
    leituras: ['busca de paciente', 'consultas de cadastro'],
    recursos: ['inicio.dicionario', 'inicio.avisos', 'inicio.mensagens'],
    marcos: ['M10', 'M11', 'M13', 'M14', 'M27', 'M34'],
    jornadas: [
      { arquivo: 'apps/web/e2e/cadastro.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/administracao.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/catalogos.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/dominios.spec.ts', teste: '' },
    ],
    roteiro: [
      {
        abrir: 'Cadastro do paciente sintético incluído no novo',
        onde: 'Cadastro de pacientes do outro sistema, pela busca do nome',
        esperado:
          'a ficha com o mesmo nome, nascimento, documento e endereço (CEP existente), sem caractere trocado',
      },
      {
        abrir: 'Usuário sintético criado no novo',
        onde: 'Cadastro de usuários do outro sistema',
        esperado: 'o login, o grupo e a situação gravados; a trilha do outro sistema registra a inclusão',
      },
      {
        abrir: 'Item de domínio incluído pelo cadastro genérico',
        onde: 'A tela do mesmo cadastro no outro sistema',
        esperado: 'o item com a mesma descrição e o mesmo código',
      },
    ],
    duvidas: [
      'DP-3: chave-usuários do cadastro e do gestor de acessos',
      'DP-46.1: cadastro de profissionais pelo setor dono',
      'D-FLAGS-1: efeito das flags do usuário a confirmar com as áreas',
    ],
  },
  {
    id: 'agendamento',
    nome: 'Agendamento e call center',
    onda: 1,
    papeis: ['recepcao'],
    operacoes: ['agenda.*', '!agenda.*Exame*', '!agenda.definirCoberturaExame'],
    leituras: ['busca de vaga', 'pauta do dia'],
    recursos: ['agenda.consulta'],
    marcos: ['M17'],
    jornadas: [{ arquivo: 'apps/web/e2e/agenda.spec.ts', teste: '' }],
    roteiro: [
      {
        abrir: 'Marcação feita no novo para o paciente sintético',
        onde: 'Agenda do profissional no outro sistema, no mesmo dia',
        esperado:
          'o horário ocupado com o mesmo convênio e a mesma situação; a confirmação muda para confirmado',
      },
      {
        abrir: 'Encaixe e cancelamento com motivo',
        onde: 'Agenda e histórico de cancelamentos do outro sistema',
        esperado: 'o encaixe fora da grade e o cancelamento com o motivo escolhido',
      },
    ],
    duvidas: ['DP-3: call center e recepção (passo M17-10)', 'D-SPR-1: marcação sem prontuário'],
  },
  {
    id: 'recepcao-ambulatorial',
    nome: 'Recepção ambulatorial, senhas e painéis',
    onda: 1,
    papeis: ['recepcao'],
    operacoes: ['recepcao.*', 'atendimento.*'],
    leituras: ['fila do guichê', 'painel de chamada'],
    recursos: ['recepcao.senha', 'atendimento.ambulatorio', 'inicio.worklistRecepcao'],
    marcos: ['M19', 'M20', 'M27'],
    jornadas: [
      { arquivo: 'apps/web/e2e/recepcao.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/m20.spec.ts', teste: 'senha' },
      { arquivo: 'apps/web/e2e/m27-coexistencia.spec.ts', teste: 'recepção' },
    ],
    roteiro: [
      {
        abrir: 'Senha emitida no totem do novo',
        onde: 'Fila e painel do outro sistema',
        esperado: 'a mesma senha, na mesma fila e prioridade; chamada aqui, sai da fila de lá',
      },
      {
        abrir: 'Atendimento aberto no novo',
        onde: 'Ficha de atendimento do outro sistema',
        esperado: 'o convênio, a carteirinha e a marcação ligada; a conta do atendimento existe',
      },
    ],
    duvidas: [
      'DP-3: turno simulado com guichês nos dois sistemas (passo M19-10)',
      'passos M20-12 e M20-13: recepção ambulatorial e faturista',
      'DP-33: faturamento',
    ],
  },
  {
    id: 'internacao-leitos',
    nome: 'Internação e leitos',
    onda: 2,
    papeis: ['recepcao', 'enfermagem'],
    operacoes: ['internacao.*'],
    leituras: ['mapa de leitos', 'censo'],
    recursos: ['internacao.adt', 'leitos.mapa', 'internacao.supervisor', 'internacao.censo.fechamento'],
    marcos: ['M16', 'M21'],
    jornadas: [{ arquivo: 'apps/web/e2e/m21.spec.ts', teste: '' }],
    roteiro: [
      {
        abrir: 'Internação do paciente sintético feita no novo',
        onde: 'Censo e mapa de leitos do outro sistema',
        esperado: 'o paciente no leito escolhido, com o médico assistente e a data de entrada',
      },
      {
        abrir: 'Transferência e saída',
        onde: 'Histórico de ocupação do outro sistema',
        esperado: 'a troca de leito e a saída com a data; o leito livre e a limpeza pedida',
      },
    ],
    duvidas: [
      'DP-3: recepção de internação, coordenação de leitos (passo M21-13)',
      'D-SIT-21: situações 3 e 4 da limpeza',
      'cenário controlado (M36): cancelar alta, excluir internação, trocar especialidade e médico',
    ],
  },
  {
    id: 'pronto-atendimento',
    nome: 'Pronto atendimento',
    onda: 2,
    papeis: ['recepcao', 'medico', 'enfermagem'],
    operacoes: ['atendimento.*', 'recepcao.*'],
    leituras: ['quadro do pronto atendimento'],
    recursos: ['atendimento.pa'],
    marcos: ['M19', 'M20'],
    jornadas: [{ arquivo: 'apps/web/e2e/m20.spec.ts', teste: 'pronto atendimento' }],
    roteiro: [
      {
        abrir: 'Ficha do pronto atendimento aberta no novo',
        onde: 'Quadro do pronto atendimento do outro sistema',
        esperado: 'o paciente na etapa certa; a observação e a alta pelo médico registradas',
      },
    ],
    duvidas: ['DP-3: PA e médico do PA (passo M20-13)', 'DP-16: classificação de risco externa'],
  },
  {
    id: 'medicos',
    nome: 'Médicos (evolução, prescrição e documentos)',
    onda: 2,
    papeis: ['medico', 'multiprofissional'],
    operacoes: ['pep.*'],
    leituras: ['prontuário de uso diário', 'fila "Meus pacientes"'],
    recursos: [
      'pep.evolucao.registro',
      'pep.prescricao.cpoe',
      'pep.reconciliacao.registro',
      'pep.antimicrobiano.ficha',
      'inicio.worklistMedico',
    ],
    marcos: ['M22', 'M23', 'M24', 'M27'],
    jornadas: [
      { arquivo: 'apps/web/e2e/registro-clinico.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/prescricao.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/prontuario-diario.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/m27.spec.ts', teste: 'médico' },
    ],
    roteiro: [
      {
        abrir: 'Evolução registrada no novo no modelo do formulário',
        onde: 'Prontuário do paciente no outro sistema',
        esperado: 'a evolução abre com o mesmo texto formatado e as mesmas respostas',
      },
      {
        abrir: 'Prescrição assinada no novo',
        onde: 'Prescrição do atendimento no outro sistema',
        esperado: 'os itens, as doses e os horários previstos; a enfermagem vê os horários',
      },
      {
        abrir: 'Receita e atestado emitidos no novo',
        onde: 'Documentos do paciente no outro sistema',
        esperado: 'o documento como emitido, com o mesmo número',
      },
    ],
    duvidas: [
      'DP-3: conferência dos chave-usuários (passos M22-10, M23-16, M24-15)',
      'DP-24, DP-25, DP-23: base de interações, validação farmacêutica e receita de controlado',
      'D-LIB-2: 7 modelos de formulário abaixo de 99,5% na conferência',
    ],
  },
  {
    id: 'enfermagem',
    nome: 'Enfermagem (unidade-piloto: CTI)',
    onda: 2,
    papeis: ['enfermagem'],
    operacoes: ['enfermagem.*'],
    leituras: ['lista do turno', 'histórico de sinais vitais'],
    recursos: [
      'enfermagem.checagem',
      'enfermagem.aprazamento',
      'enfermagem.sinaisVitais',
      'enfermagem.plantao',
      'enfermagem.leituraDose',
      'enfermagem.aparelhoAutorizado',
    ],
    marcos: ['M25'],
    jornadas: [{ arquivo: 'apps/web/e2e/m25.spec.ts', teste: '' }],
    roteiro: [
      {
        abrir: 'Checagem feita no novo à beira do leito',
        onde: 'Checagem da prescrição no outro sistema',
        esperado: 'o horário checado com o profissional e a hora; o não administrado com o motivo',
      },
    ],
    duvidas: [
      'DP-3: enfermeiros e técnicos do CTI (passo M25-13)',
      'DP-26: leitura obrigatória da dose',
      'cenário controlado (M36): aprazar horário e estornar checagem',
    ],
  },
  {
    id: 'sadt',
    nome: 'SADT (laboratório, imagem e agenda de exames)',
    onda: 2,
    papeis: ['sadt', 'recepcao'],
    operacoes: ['sadt.*', 'agenda.*Exame*', 'agenda.definirCoberturaExame'],
    leituras: ['mapa de trabalho', 'fila de liberação'],
    recursos: [
      'sadt.laboratorio',
      'sadt.imagem',
      'sadt.metodosGraficos',
      'sadt.endoscopia',
      'sadt.requisicao',
      'sadt.orcamento',
      'sadt.rastreio',
      'sadt.critico',
      'sadt.portal',
      'agenda.exame',
    ],
    marcos: ['M18', 'M26'],
    jornadas: [
      { arquivo: 'apps/web/e2e/m26.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/m18.spec.ts', teste: 'exame' },
    ],
    roteiro: [
      {
        abrir: 'Exame lançado, digitado e liberado no novo',
        onde: 'Resultados do paciente no outro sistema',
        esperado: 'o exame liberado com os mesmos valores, unidades e referência',
      },
      {
        abrir: 'Marcação de exame feita no novo',
        onde: 'Agenda de exames do outro sistema',
        esperado: 'o horário ocupado com o exame e o convênio',
      },
    ],
    duvidas: [
      'DP-3: laboratório, imagem, métodos gráficos (passo M26-16) e central de exames (passo M18-13)',
      'D-LAUDO-26: numeração do laudo com o fornecedor',
      'DP-8: agenda de exames só com a correção da integração atual',
    ],
  },
  {
    id: 'centro-cirurgico',
    nome: 'Centro cirúrgico',
    onda: 2,
    papeis: ['enfermagem', 'medico'],
    operacoes: ['cirurgia.*'],
    leituras: ['mapa cirúrgico'],
    recursos: ['cirurgia.agenda', 'cirurgia.registro'],
    marcos: ['M18'],
    jornadas: [{ arquivo: 'apps/web/e2e/m18.spec.ts', teste: 'cirurgia' }],
    roteiro: [
      {
        abrir: 'Cirurgia agendada e registrada no novo',
        onde: 'Mapa cirúrgico e registro do ato no outro sistema',
        esperado: 'a sala, o horário, a equipe e o ato registrado',
      },
    ],
    duvidas: ['DP-3: secretaria e coordenação do bloco (passo M18-13)', 'D-TEC-18: rótulos da técnica'],
  },
  {
    id: 'higienizacao',
    nome: 'Higienização',
    onda: 2,
    papeis: ['outros'],
    operacoes: ['hotelaria.*'],
    leituras: ['fila da limpeza'],
    recursos: ['hotelaria.limpeza'],
    marcos: ['M21'],
    jornadas: [{ arquivo: 'apps/web/e2e/m21.spec.ts', teste: 'limpeza' }],
    roteiro: [
      {
        abrir: 'Limpeza pedida na saída e concluída no celular',
        onde: 'Situação do leito no outro sistema',
        esperado: 'o leito em limpeza e, depois da inspeção, livre',
      },
    ],
    duvidas: ['DP-3: higienização (passo M21-13)', 'D-SIT-21: situações 3 e 4 da limpeza'],
  },
  {
    id: 'same',
    nome: 'SAME (arquivo de prontuários)',
    onda: 2,
    papeis: ['outros'],
    operacoes: ['same.*'],
    leituras: ['movimento de prontuários'],
    recursos: ['same.movimento'],
    marcos: ['M21'],
    jornadas: [{ arquivo: 'apps/web/e2e/m21.spec.ts', teste: 'SAME' }],
    roteiro: [
      {
        abrir: 'Saída e devolução do prontuário físico registradas no novo',
        onde: 'Movimento do arquivo no outro sistema',
        esperado: 'o mesmo movimento, com o destino e a data',
      },
    ],
    duvidas: ['DP-3: SAME (passo M21-13)'],
  },
  // Onda 3 (M41, campo 12): os quatro setores na ordem recomendada. As operações vêm de SETORES_ONDA3
  // (suprimentos/onda3.ts): almoxarifado e compras com os documentos de estoque, as compras e os cadastros do estoque;
  // as farmácias com os documentos de estoque e a dispensação; a farmácia clínica com a avaliação (DP-25). A farmácia
  // ambulatorial e o livro de controlados oficial ficam fora da onda (RECURSOS_FORA_DA_ONDA3).
  {
    id: 'almoxarifado-compras',
    nome: 'Almoxarifado central e compras',
    onda: 3,
    papeis: ['suprimentos'],
    operacoes: [
      'suprimentos.registrarSaida',
      'suprimentos.requisitarMaterial',
      'suprimentos.registrarDevolucao',
      'suprimentos.transferir',
      'suprimentos.registrarEntradaNF',
      'suprimentos.criarPedido',
      'suprimentos.registrarProposta',
      'suprimentos.definirVencedorCotacao',
      'suprimentos.registrarMovimentoDireto',
      'suprimentos.registrarBalanco',
      'suprimentos.fecharMes',
      'suprimentos.reabrirMes',
      'suprimentos.reporKitRastreavel',
      'suprimentos.desconsolidarDocumento',
      'suprimentos.corrigirValidadeLote',
      'suprimentos.incluir*',
      'suprimentos.alterar*',
    ],
    leituras: [
      'saldo por local',
      'requisições pendentes',
      'histórico de compras',
      'consumo por centro de custo',
    ],
    recursos: [
      'suprimentos.estoque',
      'suprimentos.notaFiscal',
      'suprimentos.compras',
      'suprimentos.inventario',
      'suprimentos.kits',
      'suprimentos.fechamento',
      'suprimentos.saneamento',
    ],
    marcos: ['M28'],
    jornadas: [{ arquivo: 'apps/web/e2e/m28.spec.ts', teste: '' }],
    roteiro: [
      {
        abrir: 'Entrada por nota fiscal com dois lotes feita no novo',
        onde: 'Movimento de estoque, lotes e preço médio do item no outro sistema',
        esperado:
          'os dois lotes com a validade, o saldo do local somado e o preço médio produzido pelo banco',
      },
      {
        abrir: 'Requisição atendida em parte no novo',
        onde: 'Requisições e saídas do outro sistema',
        esperado: 'a quantidade atendida, o restante pendente e a saída consolidada com o número do banco',
      },
      {
        abrir: 'Transferência do almoxarifado para a farmácia satélite',
        onde: 'Transferências e saldos dos dois locais no outro sistema',
        esperado: 'o saldo baixado na origem e somado no destino, com o lote',
      },
      {
        abrir: 'Devolução de uma saída a paciente',
        onde: 'Devoluções e conta do paciente no outro sistema',
        esperado: 'o saldo de volta e o estorno na conta, sem duplicação',
      },
      {
        abrir: 'Cotação com rateio entre dois fornecedores',
        onde: 'Pedido de compra e cotação no outro sistema',
        esperado: 'os dois vencedores com as quantidades e os preços da proposta',
      },
    ],
    duvidas: [
      'DP-3: almoxarifado e compras (passo M28)',
      'D-MOTOR-28: documentos de estoque pelo cenário controlado do M36',
      'inventário recente dos locais que entram (o saldo de partida é o do banco)',
    ],
  },
  {
    id: 'farmacia-central',
    nome: 'Farmácia central (estoque e dispensação)',
    onda: 3,
    papeis: ['suprimentos'],
    operacoes: [
      'suprimentos.registrarSaida',
      'suprimentos.requisitarMaterial',
      'suprimentos.registrarDevolucao',
      'suprimentos.transferir',
      'suprimentos.dispensarHorario',
      'suprimentos.confirmarEntrega',
      'suprimentos.devolverDose',
      'suprimentos.cancelarDispensacao',
      'suprimentos.registrarPerdaControlado',
    ],
    leituras: ['fila de horários', 'saldo por local', 'entregas ao setor'],
    recursos: [
      'suprimentos.estoque',
      'suprimentos.dispensacao',
      'suprimentos.entrega',
      'suprimentos.controlados',
    ],
    marcos: ['M28', 'M29'],
    jornadas: [{ arquivo: 'apps/web/e2e/m29.spec.ts', teste: 'fila' }],
    roteiro: [
      {
        abrir: 'Dispensação por horário de uma prescrição liberada, feita no novo',
        onde: 'Dispensação, movimento de estoque e conta do paciente no outro sistema',
        esperado:
          'os horários dispensados, a saída consolidada, o saldo e o item na conta lançados pelo banco',
      },
      {
        abrir: 'Entrega da dose ao setor aceita no novo',
        onde: 'Controle de entrega no outro sistema',
        esperado: 'a entrega com a situação de recebida e quem recebeu',
      },
    ],
    duvidas: [
      'DP-26: etiqueta da dose e leitores',
      'D-MOTOR-28: saída da dispensação pelo cenário controlado do M36',
      'regra 1 da onda 3: só nas unidades com a prescrição eletrônica em uso',
    ],
  },
  {
    id: 'farmacias-satelites',
    nome: 'Farmácias satélites',
    onda: 3,
    papeis: ['suprimentos'],
    operacoes: [
      'suprimentos.registrarSaida',
      'suprimentos.requisitarMaterial',
      'suprimentos.registrarDevolucao',
      'suprimentos.transferir',
      'suprimentos.dispensarHorario',
      'suprimentos.confirmarEntrega',
      'suprimentos.devolverDose',
      'suprimentos.cancelarDispensacao',
      'suprimentos.registrarPerdaControlado',
    ],
    leituras: ['fila de horários', 'saldo por local'],
    recursos: [
      'suprimentos.estoque',
      'suprimentos.dispensacao',
      'suprimentos.entrega',
      'suprimentos.controlados',
    ],
    marcos: ['M28', 'M29'],
    jornadas: [{ arquivo: 'apps/web/e2e/m29.spec.ts', teste: 'fila' }],
    roteiro: [
      {
        abrir: 'Transferência recebida da central e dispensação na satélite feitas no novo',
        onde: 'Saldo da satélite e dispensação no outro sistema',
        esperado: 'o saldo recebido e baixado na satélite, com o lote até o paciente',
      },
    ],
    duvidas: [
      'quais locais são satélites: o cadastro de locais não diz (lista do comitê)',
      'regra 1 da onda 3: só nas unidades com a prescrição eletrônica em uso',
    ],
  },
  {
    id: 'farmacia-clinica',
    nome: 'Farmácia clínica (avaliação da prescrição)',
    onda: 3,
    papeis: ['suprimentos'],
    operacoes: ['suprimentos.avaliarPrescricao'],
    leituras: ['fila de avaliação farmacêutica', 'prescrições a validar'],
    recursos: ['suprimentos.avaliacao'],
    marcos: ['M29'],
    jornadas: [{ arquivo: 'apps/web/e2e/m29.spec.ts', teste: 'avaliação' }],
    roteiro: [
      {
        abrir: 'Avaliação com intervenção respondida pelo médico no novo',
        onde: 'Prescrição do paciente no outro sistema',
        esperado: 'a prescrição sem alteração (a avaliação fica no novo até a decisão da DP-25)',
      },
    ],
    duvidas: ['DP-25: escopo da validação farmacêutica (status 2, 3 e 4 no banco só com a decisão)'],
  },
  // Onda 4 (M42, campo 12): os setores na ordem recomendada. As operações que a onda leva a `liberada` vêm de
  // SETORES_ONDA_4 (liberacao/onda4.ts); aqui entram também as do setor ainda especificadas (desligadas pela POL-3,
  // ficam no outro sistema: D-OPS-40) e os cadastros do setor. A carga dos catálogos de preço fica com o setor de
  // cadastros (onda 1, `catalogo.*`; DP-36). D-SET-42.
  {
    id: 'faturamento-convenio',
    nome: 'Faturamento por convênio e particular',
    onda: 4,
    papeis: ['faturamento'],
    operacoes: [
      'faturamento.fecharConta',
      'faturamento.reabrirConta',
      'faturamento.conferirItem',
      'faturamento.lancarItem',
      'faturamento.emitirConta',
      'faturamento.excluirItem',
      'faturamento.atualizarBeneficiario',
      'faturamento.incluir*',
      'faturamento.alterar*',
      'convenio.*',
      'preco.*',
    ],
    leituras: ['contas por competência', 'valor vigente', 'explicação do preço'],
    recursos: [
      'faturamento.contas',
      'faturamento.lancamentoManual',
      'faturamento.lancamentoTardio',
      'faturamento.regras',
      'faturamento.particular',
      'faturamento.pagamentoEletronico',
    ],
    marcos: ['M12', 'M30'],
    jornadas: [
      { arquivo: 'apps/web/e2e/convenios.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/m30.spec.ts', teste: '' },
      { arquivo: 'apps/web/e2e/m42.spec.ts', teste: 'conta' },
    ],
    roteiro: [
      {
        abrir: 'Conta externa e conta de internação fechadas no novo (amostra de cada convênio relevante)',
        onde: 'Contas do paciente no outro sistema',
        esperado: 'os mesmos itens e o mesmo total, a situação fechada, a data e o usuário do fechamento',
      },
      {
        abrir: 'Conta lançada no outro sistema e fechada no novo',
        onde: 'Contas do paciente no outro sistema',
        esperado: 'uma conta só, com os lançamentos do outro sistema e o fechamento do novo',
      },
    ],
    duvidas: [
      'DP-33: perguntas ao faturamento (FAT-01 a FAT-06 e FAT-11 a FAT-13; sem resposta vale o padrão de mercado)',
      'DP-34: conta e cobertura do convênio',
      'D-LANC-30: o lançamento manual fica no outro sistema até a reprodução',
    ],
  },
  {
    id: 'auditoria-contas',
    nome: 'Auditoria de contas',
    onda: 4,
    papeis: ['faturamento'],
    operacoes: ['faturamento.conferirItem', 'faturamento.auditarConta'],
    leituras: ['contas por situação e prazo', 'irregularidades da conta'],
    recursos: ['faturamento.auditoria'],
    marcos: ['M30'],
    jornadas: [{ arquivo: 'apps/web/e2e/m30.spec.ts', teste: 'internação' }],
    roteiro: [
      {
        abrir: 'Itens conferidos no novo pelo enfermeiro e pelo médico auditor',
        onde: 'Contas do paciente no outro sistema',
        esperado: 'o usuário e a data da conferência em cada item, sem item alterado',
      },
    ],
    duvidas: ['DP-33: auditoria de contas (o questionário do faturamento)'],
  },
  {
    id: 'tiss-lotes',
    nome: 'Lotes e protocolo TISS',
    onda: 4,
    papeis: ['faturamento'],
    operacoes: [
      'faturamento.gerarLote',
      'faturamento.registrarProtocolo',
      'faturamento.fecharCompetencia',
      'faturamento.reabrirCompetencia',
    ],
    leituras: ['contas prontas para o lote', 'lotes da competência', 'prazos de envio'],
    recursos: ['faturamento.lote', 'faturamento.competencia', 'integracao.tiss'],
    marcos: ['M31'],
    jornadas: [{ arquivo: 'apps/web/e2e/m31.spec.ts', teste: 'lote' }],
    roteiro: [
      {
        abrir: 'Lote da competência gerado no novo e o protocolo registrado',
        onde: 'Controle de remessa no outro sistema',
        esperado: 'o lote com as contas, o protocolo e as contas como apresentadas',
      },
      {
        abrir: 'Competência do convênio fechada no novo',
        onde: 'Fechamento de competência no outro sistema',
        esperado: 'a competência fechada com a data e o usuário',
      },
    ],
    duvidas: [
      'FAT-07 e FAT-14: versão e canal TISS (04.03.00; a primeira operadora é escolhida pelo grupo de faturamento)',
      'credenciais dos webservices de produção no cofre (pré-requisito humano)',
    ],
  },
  {
    id: 'glosa-recurso',
    nome: 'Glosa e recurso',
    onda: 4,
    papeis: ['faturamento'],
    operacoes: [
      'faturamento.registrarGlosa',
      'faturamento.registrarRecurso',
      'faturamento.registrarRetornoRecurso',
      'faturamento.gerarLoteRecurso',
    ],
    leituras: ['grade de glosa', 'demonstrativos', 'painel de glosas'],
    recursos: ['faturamento.protocoloRecurso', 'faturamento.conciliacao'],
    marcos: ['M31'],
    jornadas: [{ arquivo: 'apps/web/e2e/m31.spec.ts', teste: 'recurso' }],
    roteiro: [
      {
        abrir: 'Baixa com glosa e o recurso registrados no novo',
        onde: 'Glosas, manutenção, no outro sistema',
        esperado: 'os valores pagos, o motivo da glosa e o valor recorrido em cada item',
      },
    ],
    duvidas: ['FAT-08 e FAT-09: demonstrativo, baixa e recurso de glosa'],
  },
  {
    id: 'contas-a-pagar',
    nome: 'Contas a pagar',
    onda: 4,
    papeis: ['financeiro'],
    operacoes: [
      'financeiro.criarTituloPagar',
      'financeiro.baixarTitulo',
      'financeiro.incluir*',
      'financeiro.alterar*',
      'financeiro.inativar*',
    ],
    leituras: ['títulos a pagar', 'borderôs', 'aprovação por alçada'],
    recursos: ['financeiro.contasPagar'],
    marcos: ['M32'],
    jornadas: [{ arquivo: 'apps/web/e2e/m32.spec.ts', teste: 'borderô' }],
    roteiro: [
      {
        abrir: 'Título a pagar incluído e baixado no novo',
        onde: 'Contas a pagar no outro sistema',
        esperado: 'o fornecedor, o vencimento, o valor, a apropriação e o pagamento',
      },
    ],
    duvidas: [
      'FIS-08: códigos do contas a pagar (legenda a confirmar)',
      'leiautes de remessa conferidos pela tesouraria',
    ],
  },
  {
    id: 'contas-a-receber',
    nome: 'Contas a receber',
    onda: 4,
    papeis: ['financeiro'],
    operacoes: ['financeiro.criarTituloReceber', 'financeiro.baixarTitulo'],
    leituras: ['títulos da competência', 'glosa no título'],
    recursos: ['financeiro.contasReceber'],
    marcos: ['M32'],
    jornadas: [{ arquivo: 'apps/web/e2e/m32.spec.ts', teste: 'competência' }],
    roteiro: [
      {
        abrir: 'Título a receber da competência baixado no novo pelo demonstrativo',
        onde: 'Contas a receber no outro sistema',
        esperado: 'o convênio, o vencimento, o valor recebido e a glosa',
      },
    ],
    duvidas: ['FIS-09: códigos do contas a receber (legenda a confirmar)'],
  },
  {
    id: 'tesouraria',
    nome: 'Tesouraria',
    onda: 4,
    papeis: ['financeiro'],
    operacoes: ['financeiro.lancarMovimento'],
    leituras: ['saldos', 'conciliação', 'fluxo de caixa'],
    recursos: ['financeiro.tesouraria'],
    marcos: ['M32'],
    jornadas: [{ arquivo: 'apps/web/e2e/m32.spec.ts', teste: 'tesouraria' }],
    roteiro: [
      {
        abrir: 'Movimento bancário lançado no novo',
        onde: 'Movimento bancário no outro sistema',
        esperado: 'a conta, a data, o valor e o tipo',
      },
    ],
    duvidas: [
      'FIS-09: tipos do movimento (legenda a confirmar)',
      'contas bancárias conferidas pela tesouraria',
    ],
  },
  {
    id: 'repasse',
    nome: 'Repasse médico',
    onda: 4,
    papeis: ['faturamento', 'financeiro'],
    operacoes: ['repasse.*'],
    leituras: ['apuração do período', 'memória de cálculo', 'extrato do médico'],
    recursos: ['repasse'],
    marcos: ['M33'],
    jornadas: [{ arquivo: 'apps/web/e2e/m33.spec.ts', teste: 'RPA' }],
    roteiro: [
      {
        abrir: 'Evento lançado e RPA emitido no novo',
        onde: 'Repasse médico, RPAs, no outro sistema',
        esperado: 'o prestador, o bruto, o INSS, o IRRF e o líquido; o título do RPA no contas a pagar',
      },
    ],
    duvidas: ['FAT-10: repasse', 'FIS-04: EFD-REINF das retenções'],
  },
  {
    id: 'fiscal',
    nome: 'Fiscal',
    onda: 4,
    papeis: ['financeiro'],
    operacoes: [],
    leituras: ['escrituração de entradas', 'NFS-e', 'DMED', 'EFD-REINF'],
    recursos: ['financeiro.fiscal'],
    marcos: ['M32'],
    jornadas: [{ arquivo: 'apps/web/e2e/m32.spec.ts', teste: 'fiscal' }],
    roteiro: [
      {
        abrir: 'DMED gerada no novo para a conferência',
        onde: 'Declarações no outro sistema',
        esperado: 'os mesmos totais por pessoa atendida (só a contagem na conferência)',
      },
    ],
    duvidas: [
      'DP-38: perguntas ao fiscal (NFS-e, EFD-REINF e DMED seguem pelo sistema anterior até a resposta)',
    ],
  },
  {
    id: 'restantes',
    nome: 'Usuários restantes, plantonistas, painéis e totens',
    onda: 5,
    papeis: ['outros'],
    operacoes: [],
    leituras: ['painéis de TV', 'totens'],
    recursos: ['relatorio.paineis'],
    marcos: ['M19', 'M27'],
    jornadas: [{ arquivo: 'apps/web/e2e/recepcao.spec.ts', teste: 'totem' }],
    roteiro: [
      {
        abrir: 'Painel de TV do setor com o aparelho autorizado',
        onde: 'O painel do outro sistema ao lado',
        esperado: 'as mesmas chamadas, na mesma ordem',
      },
    ],
    duvidas: ['os 26 ativos sem grupo revistos com o gestor de acessos antes da onda'],
  },
];

/** A operação `nome` casa com o padrão (`modulo.*`, `agenda.*Exame*` ou o nome exato)? */
export function casaPadraoOperacao(padrao: string, nome: string): boolean {
  if (!padrao.includes('*')) return padrao === nome;
  // Curinga sem expressão regular montada (varredura de segurança): as partes fixas em ordem.
  const partes = padrao.split('*');
  const primeira = partes[0] ?? '';
  const ultima = partes[partes.length - 1] ?? '';
  if (!nome.startsWith(primeira) || !nome.endsWith(ultima) || nome.length < primeira.length + ultima.length)
    return false;
  let pos = primeira.length;
  const fim = nome.length - ultima.length;
  for (const p of partes.slice(1, -1)) {
    const achou = nome.indexOf(p, pos);
    if (achou < 0 || achou + p.length > fim) return false;
    pos = achou + p.length;
  }
  return true;
}

/** Operações do catálogo que o setor usa (os `!` excluem). */
export function operacoesDoSetor(setor: DefinicaoSetor, nomes: readonly string[]): string[] {
  const incluir = setor.operacoes.filter((p) => !p.startsWith('!'));
  const excluir = setor.operacoes.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
  return nomes.filter(
    (n) => incluir.some((p) => casaPadraoOperacao(p, n)) && !excluir.some((p) => casaPadraoOperacao(p, n)),
  );
}

/** Tarefa do treinamento: uma jornada automática de um papel (guia de uma página e roteiro de vídeo). */
export interface TarefaTreinamento {
  readonly id: string;
  readonly papel: PapelTreinamento;
  readonly onda: number;
  readonly titulo: string;
  readonly jornada: JornadaSetor;
}

/** Tarefas por papel (cap-15 §15.4.2: por papel e por onda, não por módulo). */
export const TAREFAS_TREINAMENTO: readonly TarefaTreinamento[] = [
  // Onda 0 — gestão (diretoria, coordenações e NIR, só leitura).
  {
    id: 'consultar-prontuario',
    papel: 'gestao',
    onda: 0,
    titulo: 'Consultar o prontuário ao vivo',
    jornada: { arquivo: 'apps/web/e2e/prontuario.spec.ts', teste: '' },
  },
  {
    id: 'acompanhar-leitos',
    papel: 'gestao',
    onda: 0,
    titulo: 'Acompanhar o painel de leitos e o censo',
    jornada: { arquivo: 'apps/web/e2e/leitos.spec.ts', teste: 'coordenação de leitos' },
  },
  {
    id: 'consultar-indicadores',
    papel: 'gestao',
    onda: 0,
    titulo: 'Consultar indicadores e painéis',
    jornada: { arquivo: 'apps/web/e2e/leitos.spec.ts', teste: 'diretoria' },
  },
  {
    id: 'emitir-relatorio',
    papel: 'gestao',
    onda: 0,
    titulo: 'Emitir um relatório do catálogo',
    jornada: { arquivo: 'apps/web/e2e/m34.spec.ts', teste: 'emitir relatório' },
  },
  {
    id: 'administrar-usuarios',
    papel: 'gestao',
    onda: 0,
    titulo: 'Administrar usuários e bloquear o acesso',
    jornada: { arquivo: 'apps/web/e2e/administracao.spec.ts', teste: 'usuários' },
  },
  // Onda 1 — recepção e atendimento (cadastro, agendamento, senhas, ficha).
  {
    id: 'buscar-paciente',
    papel: 'recepcao',
    onda: 1,
    titulo: 'Buscar o paciente e conferir a ficha',
    jornada: { arquivo: 'apps/web/e2e/cadastro.spec.ts', teste: 'busca' },
  },
  {
    id: 'cadastrar-paciente',
    papel: 'recepcao',
    onda: 1,
    titulo: 'Cadastrar o paciente sem duplicar',
    jornada: { arquivo: 'apps/web/e2e/cadastro.spec.ts', teste: 'CPF repetido' },
  },
  {
    id: 'marcar-consulta',
    papel: 'recepcao',
    onda: 1,
    titulo: 'Marcar, confirmar, remarcar e cancelar a consulta',
    jornada: { arquivo: 'apps/web/e2e/agenda.spec.ts', teste: 'marcar, confirmar' },
  },
  {
    id: 'encaixar-consulta',
    papel: 'recepcao',
    onda: 1,
    titulo: 'Encaixar fora da grade',
    jornada: { arquivo: 'apps/web/e2e/agenda.spec.ts', teste: 'encaixe' },
  },
  {
    id: 'chamar-senha',
    papel: 'recepcao',
    onda: 1,
    titulo: 'Chamar a senha no guichê',
    jornada: { arquivo: 'apps/web/e2e/recepcao.spec.ts', teste: 'totem' },
  },
  {
    id: 'abrir-atendimento',
    papel: 'recepcao',
    onda: 1,
    titulo: 'Abrir o atendimento ambulatorial',
    jornada: { arquivo: 'apps/web/e2e/m20.spec.ts', teste: 'senha' },
  },
  {
    id: 'atendimento-do-agendamento',
    papel: 'recepcao',
    onda: 1,
    titulo: 'Abrir o atendimento a partir do agendamento',
    jornada: { arquivo: 'apps/web/e2e/m20.spec.ts', teste: 'agendamento' },
  },
  // Onda 2 — as jornadas já automáticas (o material sai junto; as turmas são da onda 2).
  {
    id: 'evoluir',
    papel: 'medico',
    onda: 2,
    titulo: 'Registrar a evolução no modelo do formulário',
    jornada: { arquivo: 'apps/web/e2e/registro-clinico.spec.ts', teste: 'médico' },
  },
  {
    id: 'prescrever',
    papel: 'medico',
    onda: 2,
    titulo: 'Prescrever e assinar',
    jornada: { arquivo: 'apps/web/e2e/prescricao.spec.ts', teste: 'médico: prescreve' },
  },
  {
    id: 'fila-medico',
    papel: 'medico',
    onda: 2,
    titulo: 'Trabalhar pela fila "Meus pacientes"',
    jornada: { arquivo: 'apps/web/e2e/m27.spec.ts', teste: 'médico' },
  },
  {
    id: 'checar-administracao',
    papel: 'enfermagem',
    onda: 2,
    titulo: 'Checar a administração à beira do leito',
    jornada: { arquivo: 'apps/web/e2e/m25.spec.ts', teste: 'turno' },
  },
  {
    id: 'liberar-exame',
    papel: 'sadt',
    onda: 2,
    titulo: 'Coletar, digitar e liberar o exame',
    jornada: { arquivo: 'apps/web/e2e/m26.spec.ts', teste: 'J4' },
  },
  {
    id: 'internar',
    papel: 'recepcao',
    onda: 2,
    titulo: 'Internar, transferir e dar saída',
    jornada: { arquivo: 'apps/web/e2e/m21.spec.ts', teste: 'admitir' },
  },
];
