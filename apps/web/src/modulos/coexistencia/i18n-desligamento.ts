// Textos do M58 (ficha, seção 7): o cartão "Prontidão do desligamento por hospital" (aba da migração gradual), o cartão
// "Plataforma do banco" (verificação da estrutura do banco) e o painel de estado da fachada da API de integração da
// Hal-AI. Sem o nome do sistema anterior (ADR 0023): "o outro sistema" é a forma usada, só para dizer o que sai e o que
// fica; nunca para mandar fazer lá. Toda chave de vocabulário do contrato tem texto (conferido no teste).
import type {
  ContingenciaDesligamento,
  DestinoContaTecnica,
  MotivoBloqueioPasso,
  PassoDesligamento,
  SituacaoItemDesligamento,
  SituacaoPasso,
  TipoRecursoFornecedor,
} from '@sgh/contratos';

const passos: Record<PassoDesligamento, string> = {
  desligamento: 'Desligar o outro sistema',
  firebird5: 'Trocar o motor do banco para a versão 5',
  utf8: 'Converter o texto do banco para UTF-8',
};

const situacoesPasso: Record<SituacaoPasso, string> = {
  bloqueado: 'Bloqueado',
  'pronto-para-autorizar': 'Pronto para autorizar',
  autorizado: 'Autorizado (aguarda a janela)',
  executado: 'Executado',
};

const motivos: Record<MotivoBloqueioPasso, string> = {
  'passo-anterior-pendente': 'O passo anterior ainda não foi executado.',
  'dp6-sem-data': 'A data do desligamento e a contingência ainda não foram decididas.',
  'fim-da-coexistencia-nao-registrado': 'O fim da coexistência ainda não foi registrado neste hospital.',
  'sessoes-na-janela': 'Ainda há pessoas usando o outro sistema nas duas últimas semanas.',
  'inventario-pendente': 'Há itens do inventário sem substituto em uso nem aceite da área.',
  'contingencia-nao-definida': 'A contingência de algum item não foi definida.',
  'ensaio-nao-aprovado': 'O ensaio na cópia ainda não foi aprovado.',
  'funcoes-externas-pendentes': 'Há funções externas do banco sem habilitação nem substituição.',
  'parceiros-nao-avisados': 'Há parceiros que leem o banco sem teste na cópia ou sem aviso da janela.',
  'sante-api-sem-contrato': 'Os contratos da API de integração da Hal-AI ainda não passaram contra a cópia.',
  'autorizacao-ausente': 'Falta a autorização do dono do projeto para este passo.',
};

const tipos: Record<TipoRecursoFornecedor, string> = {
  'aplicacao-estacao': 'Aplicação nas estações',
  servico: 'Serviço',
  'tarefa-agendada': 'Tarefa agendada',
  painel: 'Painel de TV',
};

const situacoesItem: Record<SituacaoItemDesligamento, string> = {
  pendente: 'Pendente',
  'substituto-em-uso': 'Substituto em uso',
  'aceito-como-perdido': 'Aceito como perdido pela área',
};

const contingencias: Record<ContingenciaDesligamento, string> = {
  'reinstalavel-no-periodo': 'Pode ser reinstalado no período de contingência',
  'somente-consulta-no-periodo': 'Só consulta no período de contingência',
  nenhuma: 'Nenhuma volta',
};

const destinos: Record<DestinoContaTecnica, string> = {
  'para-com-o-fornecedor': 'Para junto com o serviço',
  continua: 'Continua',
  'desligar-quando-a-area-concordar': 'Desligada quando a área concordar',
  'parceiro-no-ensaio': 'Parceiro: testado na cópia e avisado antes da janela',
};

/** Um texto por item de INVENTARIO_DESLIGAMENTO (o teste confere que não falta nenhum). */
const itens: Record<string, { titulo: string; descricao: string }> = {
  'aplicacao-estacoes': {
    titulo: 'Aplicação das estações de trabalho',
    descricao: 'O programa instalado nos computadores. Sai quando ninguém mais o usa há duas semanas.',
  },
  'portal-resultados': {
    titulo: 'Portal de resultados',
    descricao:
      'Laudos e imagens liberados para pacientes e médicos externos, com o código impresso no protocolo.',
  },
  'paineis-tv': {
    titulo: 'Painéis de TV',
    descricao:
      'Os painéis dos andares, UTIs, pronto atendimento, laboratório, farmácia, higienização e centro cirúrgico.',
  },
  'envio-agendado-relatorios': {
    titulo: 'Envio agendado de relatórios',
    descricao: 'Relatórios enviados por e-mail em horário marcado.',
  },
  'editor-relatorios': {
    titulo: 'Editor de relatórios',
    descricao:
      'Relatórios escritos em consulta livre, substituídos pelo catálogo de relatórios parametrizados.',
  },
  'servico-autorizador': {
    titulo: 'Serviço de autorização',
    descricao: 'Conexão técnica usada para autorizações junto às operadoras.',
  },
  'servico-tiss': {
    titulo: 'Serviço de webservices TISS',
    descricao: 'Envio e consulta TISS pelas operadoras.',
  },
  'servico-portal': {
    titulo: 'Serviço do portal',
    descricao: 'Servidor do portal na internet.',
  },
  'servico-sac-movel': {
    titulo: 'Serviço do aplicativo de atendimento ao cliente',
    descricao:
      'Aplicativo de atendimento ao cliente. Sem substituto previsto: a área decide se aceita perdê-lo.',
  },
  'servico-importador-pep': {
    titulo: 'Importador do prontuário',
    descricao: 'Importação de registros para o prontuário.',
  },
  'servico-integracao-apoio': {
    titulo: 'Integração com o laboratório de apoio',
    descricao: 'Pedidos e resultados trocados com o laboratório de apoio.',
  },
  'servico-integracao-resultados': {
    titulo: 'Integração de resultados',
    descricao: 'Recebimento de resultados de equipamentos e parceiros.',
  },
};

export const mensagensDesligamento = {
  prontidao: {
    titulo: 'Prontidão do desligamento',
    descricao:
      'O que falta, neste hospital, para desligar o outro sistema, trocar o motor do banco e converter o texto. Desligar o outro sistema não desliga o banco: as contas, guias, saldos e filas continuam.',
    hospital: 'Hospital',
    atualizadoEm: 'Atualizado em {em}',
    padraoAtual:
      'Hoje o outro sistema continua ligado. Nenhum passo de desligamento será dado até a decisão do dono do projeto.',
    registroInvalido:
      'O registro dos passos deste hospital não vale ({motivo}): todos os passos ficam bloqueados até a correção.',
    registro: 'Autorizações, ensaios e execuções ficam no registro {caminho}.',
    fimRegistrado: 'Fim da coexistência registrado em {data}.',
    fimNaoRegistrado: 'Fim da coexistência ainda não registrado neste hospital.',
    dp6Decidida: 'Desligamento decidido em {data}.',
    dp6Prevista: 'Decisão do desligamento prevista para {data}.',
    dp6Pendente: 'Decisão do desligamento ainda não tomada.',
    verPlataforma: 'Ver a plataforma do banco',
  },
  sessoes: {
    titulo: 'Pessoas no outro sistema',
    janela: 'Últimos {dias} dias',
    pessoas: '{n} pessoa(s) com uso na janela',
    diasSem: 'Sem uso há {n} dia(s)',
    nenhumUso: 'Nenhum uso registrado no período lido',
    cumprido: 'Critério cumprido: duas semanas sem uso de pessoa',
    naoCumprido: 'Critério não cumprido',
    cap14: 'Critério de 30 dias: {situacao}',
    nota: 'Contas técnicas, de contingência e de painéis ficam fora da contagem. A série mostra o dia do último uso de cada pessoa.',
    colunas: { dia: 'Dia', pessoas: 'Pessoas' },
    serie: 'Pessoas por dia do último uso',
    tabela: 'Pela tabela de conexões: {situacao}',
    medida: 'Pela medida diária: {n} de {exigidos} dia(s) seguidos sem uso',
    semMedida: 'Sem medida em {dia}: um dia sem medida não conta como dia sem uso.',
    ultimaSessao: 'Último dia com uso medido: {dia}',
    ultimoDiaTabela: 'Último dia registrado na tabela de conexões: {dia}',
    semDia: 'nenhum',
    combinadas: '{n} conta(s) técnica(s) ou de contingência combinada(s) fora da contagem.',
    criterioFinal: 'Critério das duas semanas',
    cumpridoCurto: 'cumprido',
    naoCumpridoCurto: 'não cumprido',
  },
  inventario: {
    titulo: 'Inventário do desligamento',
    descricao:
      'Cada programa, serviço, tarefa ou painel que sai: o substituto neste sistema ou o aceite da área.',
    colunas: {
      item: 'Item',
      tipo: 'Tipo',
      area: 'Área responsável',
      substituto: 'Substituto',
      situacao: 'Situação',
      contingencia: 'Contingência',
      pendencias: 'O que falta',
    },
    semSubstituto: 'Sem substituto previsto',
    aConfirmar: 'Equivalência a confirmar com a TI',
    substitutoSistema: 'Este sistema inteiro',
    marco: 'Entregue no marco {marco}',
    registrar: 'Registrar',
    registradoEm: 'Registrado em {em} por {papel}',
    evidencia: 'Evidência: {evidencia}',
    nenhuma: 'Nenhuma',
    pendencias: {
      'sem-registro': 'Registrar o substituto em uso ou o aceite da área.',
      'sem-substituto-e-sem-aceite': 'Sem substituto: registre o aceite da área.',
      'substituto-a-confirmar': 'A equivalência não foi confirmada: registre o aceite da área.',
      'sem-contingencia': 'Defina a contingência.',
    },
    itens,
    tipos,
    situacoes: situacoesItem,
    contingencias,
  },
  registrar: {
    titulo: 'Registrar o item',
    item: 'Item',
    situacao: 'Situação',
    contingencia: 'Contingência',
    papel: 'Papel de quem aceitou',
    evidencia: 'Evidência (ata, chamado ou protocolo)',
    senha: 'Senha (confirmação)',
    gravar: 'Registrar',
    gravado: 'Registro gravado.',
    erroPendente: 'Escolha se o substituto está em uso ou se a área aceitou perder o item.',
    registrarDe: 'Registrar: {item}',
    cancelar: 'Cancelar',
    explicacao:
      'Quem registra é o responsável da área. O substituto só pode ser marcado em uso quando a equivalência está confirmada; nos outros casos, registre o aceite de perder o item.',
  },
  contas: {
    titulo: 'Contas técnicas do banco',
    descricao: 'Contas de serviços e parceiros com acesso ao banco, e o que acontece com cada uma.',
    colunas: { conta: 'Conta', destino: 'Destino', presente: 'No banco', escrita: 'Com escrita' },
    naoDeclaradas: '{n} conta(s) com acesso ao banco fora da lista: a TI do hospital revê cada uma.',
    destinos,
  },
  passos: {
    titulo: 'Passos',
    fatia: 'Etapa {fatia}',
    nomes: passos,
    situacoes: situacoesPasso,
    motivos,
  },
  plataforma: {
    titulo: 'Plataforma do banco',
    versao: 'Versão do motor',
    ods: 'Formato do arquivo (ODS)',
    charsetBanco: 'Codificação declarada no banco',
    charsetParametro: 'Codificação usada por este sistema',
    confere: 'As duas codificações conferem',
    naoConfere: 'As codificações não conferem: a conexão com este banco é recusada até a correção.',
    funcoes: 'Funções externas',
    funcaoDependentes: '{n} objeto(s) dependente(s)',
    funcaoNova: 'Função nova, fora da lista do ensaio',
    descricao:
      'A versão do motor, o formato do arquivo e a codificação do texto do banco deste hospital, para a troca de versão e a conversão para UTF-8.',
    colunasTexto: 'Colunas de texto',
    colunasLinha: '{tipo} em {charset}: {n}',
    tiposColuna: { char: 'Texto fixo', varchar: 'Texto variável', 'blob-texto': 'Texto longo' },
    indices: '{n} índice(s) com texto, a conferir na conversão',
    pendentes: 'Funções que impedem a troca para a versão 5: {lista}',
    semPendentes: 'Nenhuma função externa impede a troca para a versão 5.',
    atualizadoEm: 'Lido em {em}',
    impressao: 'Impressão digital homologada',
    semImpressao: 'Sem impressão homologada',
    restricaoEntrada: {
      cp1252: 'Entrada de texto restrita aos caracteres aceitos pelo banco',
      livre: 'Entrada de texto sem restrição de caracteres',
    },
  },
  fachada: {
    titulo: 'Fachada da API de integração da Hal-AI',
    descricao:
      'Serviço de compatibilidade que mantém o contrato da API de integração da Hal-AI quando o modelo de dados evoluir. A escrita vem desligada.',
    naoConstruida: 'Não construída: a API de integração atende sem fachada.',
    escritaDesligada: 'Escrita desligada',
    escritaLigada: 'Escrita ligada',
    superficies: 'Superfícies',
    contratos: 'Contratos verificados',
  },
};
