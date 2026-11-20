// Catálogo de relatórios parametrizados (M34; ficha, seções 1, 7 e 8, regras 1, 3, 4 e 6; cap-07 §7.5.1). Parte
// PÚBLICA de cada relatório: código, título, área e papel dono, onda de liberação, fonte (ao vivo ou cópia diária),
// régua da receita, fórmula documentada, parâmetros tipados (o formulário da tela e a validação do servidor saem do
// mesmo Zod), colunas com a classe (dado de pessoa sai mascarado para quem não tem a permissão) e os tetos de linhas
// e de tempo. A consulta em si (SQL revisado, parâmetro nunca concatenado) mora em @sgh/legado
// (`relatorio/catalogo/`): nenhum nome de tabela do banco aparece aqui (fronteira). As permissões
// `relatorio.<codigo>.executar` e `relatorio.<codigo>.exportar` saem daqui, com as opções do menu do legado dos
// relatórios que cada um substitui (quem emitia o relatório lá emite aqui; ninguém ganha acesso que não tinha).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const TIPOS_PARAMETRO_RELATORIO = ['data', 'mes', 'inteiro', 'escolha'] as const;
export type TipoParametroRelatorio = (typeof TIPOS_PARAMETRO_RELATORIO)[number];

/** Valores relativos aceitos no padrão de um parâmetro e no envio agendado (resolvidos no dia do envio). */
export const DATAS_RELATIVAS = [
  'hoje',
  'ontem',
  'inicioDoMes',
  'inicioDoMesAnterior',
  'fimDoMesAnterior',
] as const;
export type DataRelativa = (typeof DATAS_RELATIVAS)[number];
export const MESES_RELATIVOS = ['mesAtual', 'mesAnterior'] as const;
export type MesRelativo = (typeof MESES_RELATIVOS)[number];

export interface OpcaoParametroRelatorio {
  readonly valor: string;
  readonly rotulo: string;
}

export interface ParametroRelatorio {
  readonly campo: string;
  readonly rotulo: string;
  readonly tipo: TipoParametroRelatorio;
  readonly obrigatorio: boolean;
  /** Valor sugerido no formulário (data/mês relativo, inteiro ou opção). */
  readonly padrao?: string;
  readonly opcoes?: readonly OpcaoParametroRelatorio[];
  readonly minimo?: number;
  readonly maximo?: number;
  readonly ajuda?: string;
}

export const TIPOS_COLUNA_RELATORIO = [
  'texto',
  'inteiro',
  'decimal',
  'dinheiro',
  'percentual',
  'data',
  'dataHora',
] as const;
export type TipoColunaRelatorio = (typeof TIPOS_COLUNA_RELATORIO)[number];

/** comum: sem dado de pessoa; pessoal: nome ou documento (mascarado sem `relatorio.dadoPessoal.ver`). */
export const CLASSES_COLUNA_RELATORIO = ['comum', 'pessoal'] as const;
export type ClasseColunaRelatorio = (typeof CLASSES_COLUNA_RELATORIO)[number];

export interface ColunaRelatorio {
  readonly campo: string;
  readonly rotulo: string;
  readonly tipo: TipoColunaRelatorio;
  readonly classe: ClasseColunaRelatorio;
  /** Soma na linha de total (dinheiro e contagens). */
  readonly total?: boolean;
}

/** Fonte: o minuto atual (banco ao vivo) ou a cópia diária (consulta pesada; cap-10 §10.11). */
export type FonteRelatorio = 'ao-vivo' | 'copia-diaria';

/** Régua da receita (regra 6): competência da conta ou data do item; `escolha` = parâmetro do relatório. */
export type ReguaRelatorio = 'competencia' | 'data-do-item' | 'escolha';

export interface ConferenciaRelatorio {
  /** pendente: ainda não conferido contra o número do mesmo período no relatório que substitui. */
  readonly situacao: 'pendente' | 'conferida';
  /** O que a área confere (relatório de origem, período e número). */
  readonly como: string;
}

export interface RelatorioCatalogo {
  readonly codigo: string;
  readonly titulo: string;
  readonly descricao: string;
  /** Área que usa o relatório (onda do setor) e o papel dono (quem confere e responde pelo número). */
  readonly area: string;
  readonly papelDono: string;
  /** Onda de liberação (cap-15 §15.3.3): 0 diretoria e consultas, 1 a 4 conforme o setor. */
  readonly onda: 0 | 1 | 2 | 3 | 4;
  readonly fonte: FonteRelatorio;
  readonly regua: ReguaRelatorio | null;
  /** Fórmula documentada (o que cada número conta e de onde vem). */
  readonly formula: string;
  /** Opções de menu do legado que concedem executar e exportar (os relatórios que este substitui). */
  readonly opcoesLegado: readonly number[];
  readonly parametros: readonly ParametroRelatorio[];
  readonly colunas: readonly ColunaRelatorio[];
  /** Teto de linhas (a consulta é cancelada acima dele) e tempo máximo; ajustáveis por parâmetro do sistema. */
  readonly tetoLinhas: number;
  readonly tempoMaximoMs: number;
  /** Período máximo entre `inicio` e `fim`, em dias (consulta pesada fica dentro do teto). */
  readonly periodoMaximoDias?: number;
  readonly conferencia: ConferenciaRelatorio;
  readonly marco: string;
}

const REGUA: ParametroRelatorio = {
  campo: 'regua',
  rotulo: 'Régua da receita',
  tipo: 'escolha',
  obrigatorio: true,
  padrao: 'competencia',
  opcoes: [
    { valor: 'competencia', rotulo: 'Competência da conta' },
    { valor: 'data-do-item', rotulo: 'Data do item' },
  ],
  ajuda: 'Competência: o mês de produção da conta. Data do item: o dia em que o item foi lançado.',
};
const MES_INICIO: ParametroRelatorio = {
  campo: 'mesInicio',
  rotulo: 'Do mês',
  tipo: 'mes',
  obrigatorio: true,
  padrao: 'mesAnterior',
};
const MES_FIM: ParametroRelatorio = {
  campo: 'mesFim',
  rotulo: 'Até o mês',
  tipo: 'mes',
  obrigatorio: true,
  padrao: 'mesAnterior',
};
const INICIO: ParametroRelatorio = {
  campo: 'inicio',
  rotulo: 'De',
  tipo: 'data',
  obrigatorio: true,
  padrao: 'inicioDoMes',
};
const FIM: ParametroRelatorio = {
  campo: 'fim',
  rotulo: 'Até',
  tipo: 'data',
  obrigatorio: true,
  padrao: 'hoje',
};
const CONVENIO: ParametroRelatorio = {
  campo: 'convenio',
  rotulo: 'Convênio (código; vazio = todos)',
  tipo: 'inteiro',
  obrigatorio: false,
  minimo: 1,
  maximo: 32767,
};

/** Opções de relatório do faturamento de convênios no menu do legado ("Meus relatórios" e os relatórios do usuário). */
const OPCOES_RELATORIO_FATURAMENTO = [5573, 5583, 5584, 5585, 5587, 5630, 5635, 6799] as const;

export const RELATORIOS_CATALOGO: readonly RelatorioCatalogo[] = [
  {
    codigo: 'faturamentoPorConvenio',
    titulo: 'Faturamento por convênio',
    descricao:
      'Cobrado e pago por convênio no período, na régua escolhida, com as contas e os itens contados (substitui os relatórios de faturamento mensal, mapa de apuração, resumo diário e valores de cobrança).',
    area: 'Diretoria e faturamento de convênios',
    papelDono: 'gerente de faturamento',
    onda: 0,
    fonte: 'copia-diaria',
    regua: 'escolha',
    formula:
      'Cobrado = soma de VALOR_C dos itens; pago = soma de VLR_PG dos itens. Competência: itens das contas com mês e ano de produção no período. Data do item: itens lançados no período (DATA do item), as contas contadas mês a mês (a conta com itens em dois meses conta em cada um). Por convênio da conta.',
    opcoesLegado: [...OPCOES_RELATORIO_FATURAMENTO, 1169, 6785],
    parametros: [MES_INICIO, MES_FIM, REGUA, CONVENIO],
    colunas: [
      { campo: 'convenio', rotulo: 'Convênio', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeConvenio', rotulo: 'Nome do convênio', tipo: 'texto', classe: 'comum' },
      { campo: 'contas', rotulo: 'Contas', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'itens', rotulo: 'Itens', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'cobrado', rotulo: 'Cobrado (R$)', tipo: 'dinheiro', classe: 'comum', total: true },
      { campo: 'pago', rotulo: 'Pago (R$)', tipo: 'dinheiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 2_000,
    tempoMaximoMs: 120_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'O faturamento confere o cobrado e o pago de cada convênio contra o "Faturamento mensal anual - valor" do mesmo mês, nas duas réguas.',
    },
    marco: 'M34',
  },
  {
    codigo: 'glosasPorConvenio',
    titulo: 'Glosas por convênio',
    descricao:
      'Glosa sobre os itens já baixados, por convênio e no período, na régua escolhida (substitui o relatório de glosas de contas pagas).',
    area: 'Faturamento de convênios',
    papelDono: 'gerente de faturamento',
    onda: 4,
    fonte: 'copia-diaria',
    regua: 'escolha',
    formula:
      'Glosa = VALOR_C − VLR_PG dos itens com GLOSADO = T (a marca de item baixado); percentual = glosa ÷ cobrado dos baixados. Item sem baixa não entra (o mês recente sem baixa mostra "sem baixa", nunca 0% de glosa).',
    opcoesLegado: [...OPCOES_RELATORIO_FATURAMENTO, 1169],
    parametros: [MES_INICIO, MES_FIM, REGUA, CONVENIO],
    colunas: [
      { campo: 'convenio', rotulo: 'Convênio', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeConvenio', rotulo: 'Nome do convênio', tipo: 'texto', classe: 'comum' },
      { campo: 'itensBaixados', rotulo: 'Itens baixados', tipo: 'inteiro', classe: 'comum', total: true },
      {
        campo: 'cobradoBaixado',
        rotulo: 'Cobrado dos baixados (R$)',
        tipo: 'dinheiro',
        classe: 'comum',
        total: true,
      },
      {
        campo: 'pagoBaixado',
        rotulo: 'Pago dos baixados (R$)',
        tipo: 'dinheiro',
        classe: 'comum',
        total: true,
      },
      { campo: 'glosa', rotulo: 'Glosa (R$)', tipo: 'dinheiro', classe: 'comum', total: true },
      { campo: 'percentualGlosa', rotulo: 'Glosa (%)', tipo: 'percentual', classe: 'comum' },
    ],
    tetoLinhas: 2_000,
    tempoMaximoMs: 120_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'O faturamento confere a glosa de cada convênio contra o "Relatório de glosas de contas pagas" do mesmo período e régua.',
    },
    marco: 'M34',
  },
  {
    codigo: 'contasNaoFechadas',
    titulo: 'Contas não emitidas ou não fechadas',
    descricao:
      'Contas com alta no período ainda não emitidas ou não fechadas, por tipo (internação ou externa) e convênio, com o paciente.',
    area: 'Faturamento de convênios',
    papelDono: 'gerente de faturamento',
    onda: 4,
    fonte: 'ao-vivo',
    regua: null,
    formula:
      'Conta com alta (ALTA) no período e emissão diferente de T (não emitida) ou fechamento N (aberta). Situação: "não emitida" quando IND_EMI ≠ T; "aberta" quando FECHADA = N.',
    opcoesLegado: [5649, 6409, 6411, 6412, 5641, 5592, 6994, 6995, 5638, 5640, 5656, 6799, 5573],
    parametros: [
      INICIO,
      FIM,
      {
        campo: 'tipo',
        rotulo: 'Tipo de conta',
        tipo: 'escolha',
        obrigatorio: true,
        padrao: 'todas',
        opcoes: [
          { valor: 'todas', rotulo: 'Todas' },
          { valor: 'I', rotulo: 'Internação' },
          { valor: 'E', rotulo: 'Externa' },
        ],
      },
      CONVENIO,
    ],
    colunas: [
      { campo: 'conta', rotulo: 'Conta', tipo: 'inteiro', classe: 'comum' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto', classe: 'comum' },
      { campo: 'competencia', rotulo: 'Competência', tipo: 'texto', classe: 'comum' },
      { campo: 'convenio', rotulo: 'Convênio', tipo: 'inteiro', classe: 'comum' },
      { campo: 'alta', rotulo: 'Alta', tipo: 'dataHora', classe: 'comum' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto', classe: 'comum' },
      { campo: 'paciente', rotulo: 'Paciente', tipo: 'texto', classe: 'pessoal' },
    ],
    tetoLinhas: 5_000,
    tempoMaximoMs: 30_000,
    periodoMaximoDias: 92,
    conferencia: {
      situacao: 'pendente',
      como: 'O faturamento confere a quantidade de contas por tipo contra o relatório de contas não emitidas e não fechadas do mesmo período.',
    },
    marco: 'M34',
  },
  {
    codigo: 'examesPorSetor',
    titulo: 'Exames por setor do diagnóstico',
    descricao: 'Exames lançados no período por setor (ato), com os liberados e os pendentes de resultado.',
    area: 'Diagnóstico (SADT)',
    papelDono: 'coordenação do diagnóstico',
    onda: 2,
    fonte: 'ao-vivo',
    regua: null,
    formula:
      'Exames = lançamentos do setor no período (DATA do lançamento); liberados = com RESLIB = T; pendentes = sem resultado digitado (DIGRES ≠ T).',
    opcoesLegado: [2804, 2799, 2882, 2879, 5621],
    parametros: [INICIO, FIM],
    colunas: [
      { campo: 'ato', rotulo: 'Setor (ato)', tipo: 'inteiro', classe: 'comum' },
      { campo: 'exames', rotulo: 'Exames', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'liberados', rotulo: 'Liberados', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'pendentes', rotulo: 'Sem resultado', tipo: 'inteiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 200,
    tempoMaximoMs: 30_000,
    periodoMaximoDias: 92,
    conferencia: {
      situacao: 'pendente',
      como: 'A coordenação do diagnóstico confere a quantidade por setor contra o mapa estatístico do mesmo período.',
    },
    marco: 'M34',
  },
  {
    codigo: 'mapaCirurgicoDia',
    titulo: 'Mapa cirúrgico do dia',
    descricao: 'Cirurgias do dia por sala, com o horário, a duração, o tipo e o atendimento.',
    area: 'Centro cirúrgico',
    papelDono: 'coordenação do centro cirúrgico',
    onda: 2,
    fonte: 'ao-vivo',
    regua: null,
    formula: 'Cirurgias registradas com DATA igual ao dia, em ordem de sala e hora de início.',
    opcoesLegado: [2284, 2293, 2294],
    parametros: [{ campo: 'dia', rotulo: 'Dia', tipo: 'data', obrigatorio: true, padrao: 'hoje' }],
    colunas: [
      { campo: 'sala', rotulo: 'Sala', tipo: 'inteiro', classe: 'comum' },
      { campo: 'inicio', rotulo: 'Início', tipo: 'texto', classe: 'comum' },
      { campo: 'termino', rotulo: 'Término', tipo: 'texto', classe: 'comum' },
      { campo: 'duracao', rotulo: 'Duração', tipo: 'texto', classe: 'comum' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto', classe: 'comum' },
      { campo: 'convenio', rotulo: 'Convênio', tipo: 'inteiro', classe: 'comum' },
      { campo: 'atendimento', rotulo: 'Atendimento', tipo: 'inteiro', classe: 'comum' },
    ],
    tetoLinhas: 500,
    tempoMaximoMs: 15_000,
    conferencia: {
      situacao: 'pendente',
      como: 'A coordenação do centro cirúrgico confere o mapa do dia contra o "Mapa cirúrgico diário" do mesmo dia.',
    },
    marco: 'M34',
  },
  {
    codigo: 'cirurgiasPorPeriodo',
    titulo: 'Cirurgias por período',
    descricao:
      'Cirurgias por dia e tipo no período (substitui o relatório gerencial de cirurgias por período).',
    area: 'Diretoria e centro cirúrgico',
    papelDono: 'diretoria',
    onda: 0,
    fonte: 'copia-diaria',
    regua: null,
    formula: 'Contagem das cirurgias registradas por DATA e tipo de cirurgia.',
    opcoesLegado: [2284, 2294, 6785],
    parametros: [INICIO, FIM],
    colunas: [
      { campo: 'dia', rotulo: 'Dia', tipo: 'data', classe: 'comum' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto', classe: 'comum' },
      { campo: 'cirurgias', rotulo: 'Cirurgias', tipo: 'inteiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 2_000,
    tempoMaximoMs: 60_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'A diretoria confere o total do mês contra o relatório gerencial de cirurgias por período.',
    },
    marco: 'M34',
  },
  {
    codigo: 'internadosNaData',
    titulo: 'Pacientes internados na data',
    descricao:
      'Pacientes internados no fim do dia escolhido, por unidade, com a entrada e o convênio (substitui o censo diário de pacientes internados).',
    area: 'Recepção interna e coordenação de leitos',
    papelDono: 'coordenação de leitos',
    onda: 2,
    fonte: 'ao-vivo',
    regua: null,
    formula:
      'Internação com entrada até o dia e sem alta até o fim do dia (a mesma base do censo do painel de leitos), por bloco.',
    opcoesLegado: [5415, 5595, 2378, 2549, 5414],
    parametros: [{ campo: 'dia', rotulo: 'Dia', tipo: 'data', obrigatorio: true, padrao: 'hoje' }],
    colunas: [
      { campo: 'unidade', rotulo: 'Bloco', tipo: 'texto', classe: 'comum' },
      { campo: 'atendimento', rotulo: 'Atendimento', tipo: 'inteiro', classe: 'comum' },
      { campo: 'entrada', rotulo: 'Entrada', tipo: 'dataHora', classe: 'comum' },
      { campo: 'convenio', rotulo: 'Convênio', tipo: 'inteiro', classe: 'comum' },
      { campo: 'paciente', rotulo: 'Paciente', tipo: 'texto', classe: 'pessoal' },
    ],
    tetoLinhas: 2_000,
    tempoMaximoMs: 30_000,
    conferencia: {
      situacao: 'pendente',
      como: 'A coordenação de leitos confere a quantidade por unidade contra o censo diário de pacientes internados do mesmo dia.',
    },
    marco: 'M34',
  },
  {
    codigo: 'atendimentosPorDia',
    titulo: 'Atendimentos por dia',
    descricao: 'Atendimentos abertos por dia e tipo (externo ou internação) no período.',
    area: 'Diretoria e recepção',
    papelDono: 'diretoria',
    onda: 0,
    fonte: 'copia-diaria',
    regua: null,
    formula: 'Contagem dos atendimentos ativos por dia de entrada (DATA_HORA_ENTRADA) e tipo.',
    opcoesLegado: [2324, 6785, 6789, 5591, 5414],
    parametros: [INICIO, FIM],
    colunas: [
      { campo: 'dia', rotulo: 'Dia', tipo: 'data', classe: 'comum' },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'texto', classe: 'comum' },
      { campo: 'atendimentos', rotulo: 'Atendimentos', tipo: 'inteiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 2_000,
    tempoMaximoMs: 60_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'A diretoria confere o total do mês contra a estatística de atendimentos do mesmo período.',
    },
    marco: 'M34',
  },
  // ── W0-09 (catálogo A): definições declaradas, só de leitura, cada uma com o seu teste de consulta na cópia ──────
  {
    codigo: 'censoDiarioPorUnidade',
    titulo: 'Censo diário por unidade',
    descricao:
      'Por unidade (bloco), os pacientes internados no fim do dia, as admissões, as altas e os óbitos do dia (o censo hospitalar diário).',
    area: 'Recepção interna e coordenação de leitos',
    papelDono: 'coordenação de leitos',
    onda: 2,
    fonte: 'ao-vivo',
    regua: null,
    formula:
      'Internados: internação com entrada até o dia e sem alta até o fim dele. Admissões: entrada no dia. Altas: alta no dia com motivo que não é óbito. Óbitos: alta no dia com motivo de óbito (o mesmo agrupamento dos motivos de alta do censo do painel de leitos).',
    opcoesLegado: [5415, 5595, 2378, 2549, 5414],
    parametros: [{ campo: 'dia', rotulo: 'Dia', tipo: 'data', obrigatorio: true, padrao: 'ontem' }],
    colunas: [
      { campo: 'unidade', rotulo: 'Unidade', tipo: 'texto', classe: 'comum' },
      {
        campo: 'internados',
        rotulo: 'Internados no fim do dia',
        tipo: 'inteiro',
        classe: 'comum',
        total: true,
      },
      { campo: 'admissoes', rotulo: 'Admissões', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'altas', rotulo: 'Altas', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'obitos', rotulo: 'Óbitos', tipo: 'inteiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 5_000,
    tempoMaximoMs: 30_000,
    conferencia: {
      situacao: 'pendente',
      como: 'A coordenação de leitos confere os internados, as admissões e as saídas de cada unidade contra o censo diário do mesmo dia.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'altasEObitos',
    titulo: 'Altas e óbitos',
    descricao:
      'Saídas da internação no período por unidade e motivo da alta, com o grupo (alta, óbito, transferência…).',
    area: 'Recepção interna, coordenação de leitos e diretoria',
    papelDono: 'coordenação de leitos',
    onda: 2,
    fonte: 'copia-diaria',
    regua: null,
    formula:
      'Contagem das internações com a data da alta no período, por bloco e motivo da alta; o grupo do motivo é o do censo (óbito, transferência externa, internação domiciliar, evasão ou a pedido, encerramento administrativo, alta domiciliar).',
    opcoesLegado: [5415, 5595, 2378, 2549, 5414],
    parametros: [INICIO, FIM],
    colunas: [
      { campo: 'unidade', rotulo: 'Unidade', tipo: 'texto', classe: 'comum' },
      { campo: 'motivo', rotulo: 'Motivo', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeMotivo', rotulo: 'Nome do motivo', tipo: 'texto', classe: 'comum' },
      { campo: 'grupo', rotulo: 'Grupo', tipo: 'texto', classe: 'comum' },
      { campo: 'saidas', rotulo: 'Saídas', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'obitos', rotulo: 'Óbitos', tipo: 'inteiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 5_000,
    tempoMaximoMs: 60_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'A coordenação de leitos confere as saídas e os óbitos do mês contra a estatística de altas do mesmo período.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'producaoPorProfissionalSetor',
    titulo: 'Produção por profissional e setor',
    descricao:
      'Itens lançados nas contas da competência por profissional executante (titular do item) e setor, com a quantidade e o valor cobrado.',
    area: 'Diretoria, faturamento e repasse médico',
    papelDono: 'gerente de faturamento',
    onda: 0,
    fonte: 'copia-diaria',
    regua: 'competencia',
    formula:
      'Itens das contas com mês e ano de produção no período (competência da conta), por registro do profissional titular do item (vazio = sem titular) e setor (ato) do item. Quantidade = soma de QTDE; cobrado = soma de VALOR_C.',
    opcoesLegado: [...OPCOES_RELATORIO_FATURAMENTO, 1169],
    parametros: [MES_INICIO, MES_FIM],
    colunas: [
      { campo: 'profissional', rotulo: 'Registro do profissional', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeProfissional', rotulo: 'Profissional', tipo: 'texto', classe: 'comum' },
      { campo: 'setor', rotulo: 'Setor (ato)', tipo: 'inteiro', classe: 'comum' },
      { campo: 'itens', rotulo: 'Itens', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'decimal', classe: 'comum', total: true },
      { campo: 'cobrado', rotulo: 'Cobrado (R$)', tipo: 'dinheiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 20_000,
    tempoMaximoMs: 120_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'O faturamento confere o cobrado por profissional da competência contra a produção médica do mesmo mês.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'consumoPorCentroCusto',
    titulo: 'Consumo por centro de custo',
    descricao:
      'Quantidade e valor consumidos do estoque por centro de custo no período, com a participação de cada um.',
    area: 'Suprimentos, custos e diretoria',
    papelDono: 'coordenação de suprimentos',
    onda: 3,
    fonte: 'copia-diaria',
    regua: 'competencia',
    formula:
      'Competência do estoque (mês do movimento). Soma da quantidade e do valor do consumo do estoque por centro de custo nos meses do período (o consumo consolidado pelo fechamento das saídas); participação = valor do centro ÷ valor total.',
    opcoesLegado: [1964, 1982],
    parametros: [MES_INICIO, MES_FIM],
    colunas: [
      { campo: 'centroCusto', rotulo: 'Centro de custo', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeCentroCusto', rotulo: 'Nome do centro de custo', tipo: 'texto', classe: 'comum' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'decimal', classe: 'comum', total: true },
      { campo: 'valor', rotulo: 'Valor (R$)', tipo: 'dinheiro', classe: 'comum', total: true },
      { campo: 'participacao', rotulo: 'Participação (%)', tipo: 'percentual', classe: 'comum' },
    ],
    tetoLinhas: 5_000,
    tempoMaximoMs: 60_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'Suprimentos confere o valor de cada centro de custo contra o movimento por centro de custo sintético do mesmo mês.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'curvaAbcConsumo',
    titulo: 'Curva ABC do consumo',
    descricao:
      'Itens do estoque ordenados pelo valor consumido no período, com o percentual acumulado e a classe A, B ou C.',
    area: 'Suprimentos e farmácia',
    papelDono: 'coordenação de suprimentos',
    onda: 3,
    fonte: 'copia-diaria',
    regua: 'competencia',
    formula:
      'Competência do estoque (mês do movimento). Valor consumido = saídas menos devoluções (quantidade e valor) por item nos meses do período, de todos os locais ou do local escolhido. Ordem decrescente de valor; classe A até 80% do valor acumulado, B até 95%, C o resto (itens sem valor consumido ficam fora).',
    opcoesLegado: [2029, 4486],
    parametros: [
      MES_INICIO,
      MES_FIM,
      {
        campo: 'local',
        rotulo: 'Local de estoque (código; vazio = todos)',
        tipo: 'inteiro',
        obrigatorio: false,
        minimo: 1,
        maximo: 32767,
      },
    ],
    colunas: [
      { campo: 'classe', rotulo: 'Classe', tipo: 'texto', classe: 'comum' },
      { campo: 'item', rotulo: 'Item', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeItem', rotulo: 'Nome do item', tipo: 'texto', classe: 'comum' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'decimal', classe: 'comum', total: true },
      { campo: 'valor', rotulo: 'Valor (R$)', tipo: 'dinheiro', classe: 'comum', total: true },
      { campo: 'participacao', rotulo: 'Participação (%)', tipo: 'percentual', classe: 'comum' },
      { campo: 'acumulado', rotulo: 'Acumulado (%)', tipo: 'percentual', classe: 'comum' },
    ],
    tetoLinhas: 30_000,
    tempoMaximoMs: 120_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'Suprimentos confere a lista e as classes contra a curva ABC do mesmo período e local.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'validadeLote',
    titulo: 'Validade e lote',
    descricao:
      'Lotes com saldo que já venceram ou vencem dentro do prazo escolhido, por item e local, com os dias para vencer.',
    area: 'Suprimentos e farmácia',
    papelDono: 'farmacêutico responsável',
    onda: 3,
    fonte: 'ao-vivo',
    regua: null,
    formula:
      'Lotes com quantidade em saldo e validade até a data de hoje somada ao prazo (os vencidos inclusive), de todos os locais ou do local escolhido; dias para vencer = validade − hoje (negativo: vencido). Lote sem validade informada fica fora.',
    opcoesLegado: [2033, 2055],
    parametros: [
      {
        campo: 'dias',
        rotulo: 'Vencendo em até (dias)',
        tipo: 'inteiro',
        obrigatorio: true,
        padrao: '90',
        minimo: 0,
        maximo: 730,
      },
      {
        campo: 'local',
        rotulo: 'Local de estoque (código; vazio = todos)',
        tipo: 'inteiro',
        obrigatorio: false,
        minimo: 1,
        maximo: 32767,
      },
    ],
    colunas: [
      { campo: 'validade', rotulo: 'Validade', tipo: 'data', classe: 'comum' },
      { campo: 'diasParaVencer', rotulo: 'Dias para vencer', tipo: 'inteiro', classe: 'comum' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto', classe: 'comum' },
      { campo: 'item', rotulo: 'Item', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeItem', rotulo: 'Nome do item', tipo: 'texto', classe: 'comum' },
      { campo: 'lote', rotulo: 'Lote', tipo: 'texto', classe: 'comum' },
      { campo: 'local', rotulo: 'Local', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeLocal', rotulo: 'Nome do local', tipo: 'texto', classe: 'comum' },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'decimal', classe: 'comum', total: true },
    ],
    tetoLinhas: 20_000,
    tempoMaximoMs: 60_000,
    conferencia: {
      situacao: 'pendente',
      como: 'A farmácia confere os lotes vencidos e a vencer contra a validade de medicamentos do mesmo dia.',
    },
    marco: 'W0-09',
  },
  // ── W0-09 (catálogo B) ────────────────────────────────────────────────────────────────────────────────────────
  {
    codigo: 'dietasServidas',
    titulo: 'Dietas servidas',
    descricao:
      'Por dia e dieta, as dietas da prescrição diária que estavam valendo (não suspensas), com o número de pacientes atendidos.',
    area: 'Nutrição e dietética',
    papelDono: 'nutricionista responsável',
    onda: 2,
    fonte: 'copia-diaria',
    regua: null,
    formula:
      'Itens de dieta da prescrição com início de vigência no dia (a prescrição diária) e sem suspensão da prescrição nem do item, por dieta. Dietas = soma dos itens; pacientes = atendimentos distintos com aquela dieta no dia (o jejum prescrito entra como a dieta dele).',
    opcoesLegado: [2603, 3677],
    parametros: [INICIO, FIM],
    colunas: [
      { campo: 'dia', rotulo: 'Dia', tipo: 'data', classe: 'comum' },
      { campo: 'dieta', rotulo: 'Dieta', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeDieta', rotulo: 'Nome da dieta', tipo: 'texto', classe: 'comum' },
      { campo: 'dietas', rotulo: 'Dietas', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'pacientes', rotulo: 'Pacientes', tipo: 'inteiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 20_000,
    tempoMaximoMs: 60_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'A nutrição confere as dietas de cada dia contra o mapa de dietas e a contagem da copa do mesmo dia.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'prontuariosEmprestados',
    titulo: 'Prontuários emprestados (SAME)',
    descricao:
      'Prontuários que saíram do arquivo (SAME) no período e ainda não voltaram: para onde foram, onde estão agora e há quantos dias estão fora.',
    area: 'SAME e arquivo médico',
    papelDono: 'coordenação do SAME',
    onda: 2,
    fonte: 'ao-vivo',
    regua: null,
    formula:
      'Saídas e transferências (movimentos não excluídos) com origem no setor do SAME e data no período, sem movimento posterior da mesma conta com destino ao SAME nem descarte. Local atual = destino do último movimento não excluído da conta; dias fora = hoje − data da saída.',
    opcoesLegado: [2468, 3798, 2492, 378],
    parametros: [
      {
        campo: 'setorSame',
        rotulo: 'Setor do SAME (código)',
        tipo: 'inteiro',
        obrigatorio: true,
        padrao: '1',
        minimo: 1,
        maximo: 32767,
        ajuda: 'O setor do arquivo de prontuários (o mesmo do parâmetro do setor de registro do SAME).',
      },
      INICIO,
      FIM,
    ],
    colunas: [
      { campo: 'conta', rotulo: 'Conta', tipo: 'inteiro', classe: 'comum' },
      { campo: 'saidaEm', rotulo: 'Saída do SAME', tipo: 'dataHora', classe: 'comum' },
      { campo: 'operacao', rotulo: 'Operação', tipo: 'texto', classe: 'comum' },
      { campo: 'destino', rotulo: 'Enviado a', tipo: 'texto', classe: 'comum' },
      { campo: 'localAtual', rotulo: 'Local atual', tipo: 'texto', classe: 'comum' },
      { campo: 'diasFora', rotulo: 'Dias fora', tipo: 'inteiro', classe: 'comum' },
      { campo: 'prontuarios', rotulo: 'Prontuários', tipo: 'inteiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 20_000,
    tempoMaximoMs: 60_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'O SAME confere a lista contra o relatório de empréstimos do arquivo na mesma data.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'atendimentosPorConvenio',
    titulo: 'Atendimentos por convênio',
    descricao: 'Atendimentos abertos no período por convênio, separados em internação e externos.',
    area: 'Recepção, faturamento e diretoria',
    papelDono: 'gerente de faturamento',
    onda: 0,
    fonte: 'copia-diaria',
    regua: null,
    formula:
      'Atendimentos ativos com a data e hora de entrada no período, pelo convênio do atendimento; internação = tipo de atendimento I, externo = os demais (ambulatório, pronto-socorro e exames).',
    opcoesLegado: [2429, 2432, ...OPCOES_RELATORIO_FATURAMENTO],
    parametros: [INICIO, FIM, CONVENIO],
    colunas: [
      { campo: 'convenio', rotulo: 'Convênio', tipo: 'inteiro', classe: 'comum' },
      { campo: 'nomeConvenio', rotulo: 'Nome do convênio', tipo: 'texto', classe: 'comum' },
      { campo: 'internacoes', rotulo: 'Internações', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'externos', rotulo: 'Externos', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'atendimentos', rotulo: 'Atendimentos', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'participacao', rotulo: 'Participação (%)', tipo: 'percentual', classe: 'comum' },
    ],
    tetoLinhas: 5_000,
    tempoMaximoMs: 60_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'O faturamento confere os atendimentos de cada convênio contra a estatística de pacientes por convênio do mesmo período.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'producaoSus',
    titulo: 'Produção SUS (BPA e AIH)',
    descricao:
      'Produção ambulatorial (BPA) e hospitalar (AIH) da competência por procedimento, com a quantidade e o valor apresentado.',
    area: 'Faturamento SUS e diretoria',
    papelDono: 'gerente de faturamento',
    onda: 0,
    fonte: 'copia-diaria',
    regua: 'competencia',
    formula:
      'Competência do SUS (ano e mês de processamento). BPA: linhas do boletim de produção ambulatorial por procedimento, quantidade = soma de QTDE e valor = soma de VALOR. AIH: autorizações de internação da competência por procedimento realizado, quantidade = número de AIHs e valor = soma do valor total da AIH.',
    opcoesLegado: [693, 724],
    parametros: [MES_INICIO, MES_FIM],
    colunas: [
      { campo: 'instrumento', rotulo: 'Instrumento', tipo: 'texto', classe: 'comum' },
      { campo: 'procedimento', rotulo: 'Procedimento', tipo: 'texto', classe: 'comum' },
      { campo: 'registros', rotulo: 'Registros', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'quantidade', rotulo: 'Quantidade', tipo: 'decimal', classe: 'comum', total: true },
      { campo: 'valor', rotulo: 'Valor apresentado (R$)', tipo: 'dinheiro', classe: 'comum', total: true },
    ],
    tetoLinhas: 20_000,
    tempoMaximoMs: 120_000,
    periodoMaximoDias: 400,
    conferencia: {
      situacao: 'pendente',
      como: 'O faturamento SUS confere a quantidade e o valor de cada instrumento contra a remessa da mesma competência.',
    },
    marco: 'W0-09',
  },
  {
    codigo: 'escalaAgendas',
    titulo: 'Escala das agendas',
    descricao:
      'A escala semanal de cada agenda (profissional ou serviço): dia da semana, horário, intervalo, duração do atendimento e vagas por dia.',
    area: 'Recepção externa, agenda e diretoria clínica',
    papelDono: 'coordenação da agenda',
    onda: 1,
    fonte: 'ao-vivo',
    regua: null,
    formula:
      'O modelo da escala gravado na última geração de cada agenda (dia da semana, hora de início e de fim, intervalo e duração). Vagas = (minutos entre o início e o fim − minutos do intervalo) ÷ duração, arredondado para baixo. Situação: só as agendas ativas, ou todas.',
    opcoesLegado: [3311, 3406],
    parametros: [
      {
        campo: 'situacao',
        rotulo: 'Agendas',
        tipo: 'escolha',
        obrigatorio: true,
        padrao: 'ativas',
        opcoes: [
          { valor: 'ativas', rotulo: 'Só as ativas' },
          { valor: 'todas', rotulo: 'Todas' },
        ],
      },
    ],
    colunas: [
      { campo: 'agenda', rotulo: 'Agenda', tipo: 'texto', classe: 'comum' },
      { campo: 'diaSemana', rotulo: 'Dia da semana', tipo: 'texto', classe: 'comum' },
      { campo: 'inicio', rotulo: 'Início', tipo: 'texto', classe: 'comum' },
      { campo: 'fim', rotulo: 'Fim', tipo: 'texto', classe: 'comum' },
      { campo: 'intervalo', rotulo: 'Intervalo', tipo: 'texto', classe: 'comum' },
      { campo: 'duracaoMin', rotulo: 'Duração (min)', tipo: 'inteiro', classe: 'comum' },
      { campo: 'vagas', rotulo: 'Vagas no dia', tipo: 'inteiro', classe: 'comum', total: true },
      { campo: 'ativa', rotulo: 'Ativa', tipo: 'texto', classe: 'comum' },
    ],
    tetoLinhas: 5_000,
    tempoMaximoMs: 30_000,
    conferencia: {
      situacao: 'pendente',
      como: 'A coordenação da agenda confere a escala de cada agenda contra a grade de horários gerada para a semana.',
    },
    marco: 'W0-09',
  },
];

export function relatorioDoCatalogo(codigo: string): RelatorioCatalogo | undefined {
  return RELATORIOS_CATALOGO.find((r) => r.codigo === codigo);
}

/** O relatório tem coluna com dado de pessoa (exportar sem máscara pede justificativa; regra 4). */
export const temDadoPessoal = (r: Pick<RelatorioCatalogo, 'colunas'>) =>
  r.colunas.some((c) => c.classe === 'pessoal');

export const permissaoExecutarRelatorio = (codigo: string) => `relatorio.${codigo}.executar`;
export const permissaoExportarRelatorio = (codigo: string) => `relatorio.${codigo}.exportar`;
/** Chave de liberação do relatório por estabelecimento (SGH_CFG_LIBERACAO; recolher = desligar). */
export const chaveLiberacaoRelatorio = (codigo: string) => `relatorio.${codigo}`;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

function dataValida(v: string): boolean {
  if (!DATA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Esquema Zod dos parâmetros do relatório: o mesmo na tela (formulário gerado) e no servidor. */
export function esquemaParametrosRelatorio(r: RelatorioCatalogo) {
  const forma: Record<string, z.ZodType> = {};
  for (const p of r.parametros) {
    let t: z.ZodType;
    if (p.tipo === 'data')
      t = z
        .string()
        .refine(dataValida, { message: `${p.rotulo}: data inválida (AAAA-MM-DD).` })
        .refine((v) => v >= '1900-01-01' && v <= '2100-12-31', { message: `${p.rotulo}: fora da faixa.` });
    else if (p.tipo === 'mes')
      t = z
        .string()
        .regex(MES, `${p.rotulo}: mês inválido (AAAA-MM).`)
        .refine((v) => Number(v.slice(5)) >= 1 && Number(v.slice(5)) <= 12, `${p.rotulo}: mês inválido.`);
    else if (p.tipo === 'inteiro')
      t = z.coerce
        .number()
        .int(`${p.rotulo}: número inteiro.`)
        .min(p.minimo ?? -2_147_483_648)
        .max(p.maximo ?? 2_147_483_647);
    else {
      const valores = (p.opcoes ?? []).map((o) => o.valor);
      t = z.string().refine((v) => valores.includes(v), { message: `${p.rotulo}: opção inválida.` });
    }
    forma[p.campo] = p.obrigatorio ? t : t.optional();
  }
  return z
    .object(forma)
    .strict()
    .superRefine((v, ctx) => {
      const o = v as Record<string, unknown>;
      const par = (a: string, b: string): readonly [string, string] | null =>
        typeof o[a] === 'string' && typeof o[b] === 'string' ? [o[a] as string, o[b] as string] : null;
      for (const [a, b, mes] of [
        ['inicio', 'fim', false],
        ['mesInicio', 'mesFim', true],
      ] as const) {
        const p = par(a, b);
        if (!p) continue;
        if (p[0] > p[1]) ctx.addIssue({ code: 'custom', message: 'O início vem depois do fim.', path: [a] });
        if (r.periodoMaximoDias) {
          const d0 = new Date(`${mes ? `${p[0]}-01` : p[0]}T00:00:00Z`).getTime();
          const d1 = new Date(`${mes ? `${p[1]}-01` : p[1]}T00:00:00Z`).getTime();
          if ((d1 - d0) / 86_400_000 > r.periodoMaximoDias)
            ctx.addIssue({
              code: 'custom',
              message: `Período acima do máximo do relatório (${r.periodoMaximoDias} dias).`,
              path: [b],
            });
        }
      }
    });
}

export type ValoresParametros = Readonly<Record<string, string | number>>;

// ── Respostas e pedidos da API do catálogo ──────────────────────────────────────────────────────────────

export const esquemaRelatorioDescrito = z.object({
  codigo: z.string(),
  titulo: z.string(),
  descricao: z.string(),
  area: z.string(),
  papelDono: z.string(),
  onda: z.number().int(),
  fonte: z.enum(['ao-vivo', 'copia-diaria']),
  regua: z.enum(['competencia', 'data-do-item', 'escolha']).nullable(),
  formula: z.string(),
  parametros: z.array(
    z.object({
      campo: z.string(),
      rotulo: z.string(),
      tipo: z.enum(TIPOS_PARAMETRO_RELATORIO),
      obrigatorio: z.boolean(),
      padrao: z.string().optional(),
      opcoes: z.array(z.object({ valor: z.string(), rotulo: z.string() })).optional(),
      minimo: z.number().optional(),
      maximo: z.number().optional(),
      ajuda: z.string().optional(),
    }),
  ),
  colunas: z.array(
    z.object({
      campo: z.string(),
      rotulo: z.string(),
      tipo: z.enum(TIPOS_COLUNA_RELATORIO),
      classe: z.enum(CLASSES_COLUNA_RELATORIO),
      total: z.boolean().optional(),
    }),
  ),
  tetoLinhas: z.number().int(),
  tempoMaximoMs: z.number().int(),
  conferencia: z.object({ situacao: z.enum(['pendente', 'conferida']), como: z.string() }),
  /** Liberado neste estabelecimento (chave relatorio.<codigo>); desligado mostra o motivo. */
  liberado: z.boolean(),
  motivo: z.string().nullable(),
  podeExecutar: z.boolean(),
  podeExportar: z.boolean(),
  /** A sessão vê o dado de pessoa sem máscara. */
  veDadoPessoal: z.boolean(),
});
export type RelatorioDescrito = z.infer<typeof esquemaRelatorioDescrito>;

export const FORMATOS_EXPORTACAO = ['csv', 'xlsx', 'pdf'] as const;
export type FormatoExportacao = (typeof FORMATOS_EXPORTACAO)[number];

export const esquemaPedidoExecucaoRelatorio = z
  .object({
    parametros: z.record(z.string(), z.union([z.string().max(40), z.number()])),
  })
  .strict();

export const esquemaPedidoExportacaoRelatorio = z
  .object({
    parametros: z.record(z.string(), z.union([z.string().max(40), z.number()])),
    formato: z.enum(FORMATOS_EXPORTACAO),
    /** Obrigatória em toda exportação (W0-09; o serviço responde 400 `justificativa-obrigatoria` sem ela). */
    justificativa: textoCp1252(500)
      .pipe(z.string().trim().min(10, 'Justificativa: escreva o motivo (10 caracteres ou mais).'))
      .optional(),
  })
  .strict();

export const esquemaResultadoRelatorio = z.object({
  codigo: z.string(),
  execucao: z.string(),
  colunas: z.array(z.object({ campo: z.string(), rotulo: z.string(), tipo: z.enum(TIPOS_COLUNA_RELATORIO) })),
  linhas: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  totais: z.record(z.string(), z.number()),
  quantidade: z.number().int(),
  duracaoMs: z.number().int(),
  mascarado: z.boolean(),
  dadosAte: z.string().nullable(),
});
export type ResultadoRelatorio = z.infer<typeof esquemaResultadoRelatorio>;
