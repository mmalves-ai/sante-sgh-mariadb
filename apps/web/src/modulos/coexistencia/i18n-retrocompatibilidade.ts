// Textos do M59 (etapa 6, ficha do M59 seções 1 e 5; ADR 0033): a aba "Retrocompatibilidade" da migração gradual. Sem o
// nome do sistema anterior (ADR 0023): "o outro sistema" é a forma usada, só para dizer o que ele ainda lê; nunca para
// mandar fazer lá. Toda chave de vocabulário do contrato tem texto (conferido no teste).
import type {
  CondicaoExtincao,
  DecisaoRetrocompatibilidade,
  MedidaEvolucao,
  MotivoBloqueioEvolucao,
  PassoEvolucao,
  SituacaoPassoEvolucao,
} from '@sgh/contratos';

const condicoes: Record<CondicaoExtincao, { titulo: string; fonte: string }> = {
  'fim-da-coexistencia-registrado': {
    titulo: 'Fim da coexistência registrado',
    fonte: 'Aba "Fim da coexistência": todos os usuários do hospital migrados.',
  },
  'outro-sistema-desligado': {
    titulo: 'Outro sistema desligado',
    fonte: 'Aba "Desligamento": o passo de desligar o outro sistema executado.',
  },
  'dp6-decidida': {
    titulo: 'Data do fim da contingência decidida',
    fonte: 'Aba "Fim da coexistência": a decisão do dono com a data do fim do período de contingência.',
  },
  'contingencia-encerrada': {
    titulo: 'Período de contingência encerrado',
    fonte: 'Parâmetro "Período de contingência aberto" do estabelecimento desligado pelo dono do projeto.',
  },
};

const decisoes: Record<DecisaoRetrocompatibilidade, string> = {
  pendente: 'Pendente (vale como mantida)',
  mantida: 'Mantida',
  extinta: 'Extinta',
};

const passos: Record<PassoEvolucao, { titulo: string; descricao: string }> = {
  'imutabilidade-por-linha': {
    titulo: 'Imutabilidade do registro assinado por linha',
    descricao:
      'Cada tabela clínica passa a recusar no próprio banco alterar ou apagar um registro assinado; a correção só por nova versão. Não muda o que a integração da Hal-AI lê.',
  },
  'regras-dos-gatilhos': {
    titulo: 'Regras dos gatilhos na aplicação',
    descricao:
      'O que os gatilhos das tabelas fazem passa para as regras do Sante, um a um, provando o mesmo efeito antes de desativar cada gatilho.',
  },
  booleanos: {
    titulo: 'Letras no lugar de verdadeiro e falso',
    descricao:
      'As colunas de uma letra (S/N, T/F, A/I) viram verdadeiro ou falso, tabela por tabela, com a leitura dos dois jeitos durante a troca.',
  },
  'data-e-hora': {
    titulo: 'Data e hora num campo só',
    descricao: 'Os pares de coluna de data e coluna de hora viram um campo só, no fuso do estabelecimento.',
  },
  'chaves-por-id': {
    titulo: 'Chaves em texto por identificadores',
    descricao:
      'As ligações entre tabelas feitas por código em texto passam a usar o identificador numérico; o código continua como chave natural.',
  },
};

/** Singular | plural (a tela chama t(chave, n): 1 fica no singular; 0 e os demais, no plural). */
const medidas: Record<MedidaEvolucao, string> = {
  'tabelas-clinicas': 'tabela clínica | tabelas clínicas',
  gatilhos: 'gatilho | gatilhos',
  'colunas-de-uma-letra': 'coluna de uma letra | colunas de uma letra',
  'pares-data-hora': 'par de data e hora | pares de data e hora',
  'chaves-em-texto': 'chave em texto | chaves em texto',
};

const situacoes: Record<SituacaoPassoEvolucao, string> = {
  bloqueado: 'Bloqueado',
  'pronto-para-autorizar': 'Pronto para autorizar',
  autorizado: 'Autorizado (aguarda a execução)',
  executado: 'Executado',
};

const motivos: Record<MotivoBloqueioEvolucao, string> = {
  'retrocompatibilidade-nao-extinta': 'A retrocompatibilidade ainda não foi extinta pelo dono do projeto.',
  'passo-anterior-pendente': 'O passo anterior ainda não foi executado.',
  'sem-ficha': 'O passo ainda não tem ficha.',
  'sem-combinado-hal-ai': 'Falta o combinado com a Hal-AI: o passo muda o que a integração lê.',
  'regressao-nao-aprovada': 'A regressão do passo ainda não foi aprovada.',
};

export const mensagensRetrocompatibilidade = {
  titulo: 'Retrocompatibilidade do banco',
  texto:
    'Enquanto a retrocompatibilidade durar, o Sante grava no banco do jeito que o outro sistema lê. Ela só acaba por decisão do dono do projeto, com as quatro condições abaixo cumpridas; depois, o modelo evolui em cinco passos, na ordem. A decisão e os passos mudam no registro do hospital, gravado no fim desta tela com motivo e senha (ou, se o estabelecimento registrou a exceção, só no registro versionado).',
  carregando: 'Carregando…',
  hospital: 'Hospital: {hospital}',
  medidoEm: 'Painel de {em}',
  adr: 'Decisão de arquitetura {numero}',
  registro: 'Registro do hospital: {caminho}',
  registroInvalido:
    'O registro do hospital não pôde ser lido ({motivo}). O painel vale como retrocompatibilidade mantida.',
  decisao: {
    titulo: 'Decisão',
    registrada: 'Registrada',
    vigente: 'Vale',
    decididaEm: 'Decidida em',
    referencia: 'Referência',
    contingenciaLonga: 'Contingência longa',
    revisarEm: 'Revisar em',
    nenhuma: '—',
    sim: 'sim',
    nao: 'não',
    extincaoSemCondicoes:
      'A extinção registrada não vale enquanto faltar: {faltam}. Até lá, a retrocompatibilidade continua mantida.',
    podeDecidir: 'Todas as condições estão cumpridas: a extinção pode ser decidida pelo dono do projeto.',
    naoPodeDecidir: 'Ainda faltam condições para decidir a extinção.',
    nomes: decisoes,
  },
  condicoes: {
    titulo: 'Condições para extinguir',
    legenda: 'Condições para extinguir a retrocompatibilidade',
    condicao: 'Condição',
    situacao: 'Situação',
    em: 'Data',
    fonte: 'De onde vem',
    cumprida: 'Cumprida',
    pendente: 'Pendente',
    nomes: condicoes,
  },
  passos: {
    titulo: 'Plano de evolução do modelo',
    legenda: 'Os cinco passos do plano de evolução, na ordem',
    ordem: 'Ordem',
    passo: 'Passo',
    tamanho: 'Tamanho neste banco',
    semMedida: 'sem medida',
    integracao: 'Integração da Hal-AI',
    mudaLeitura: 'muda o que ela lê (exige o combinado)',
    naoMudaLeitura: 'não muda o que ela lê',
    ficha: 'Ficha',
    semFicha: 'sem ficha',
    situacao: 'Situação',
    motivos: 'O que falta',
    nomes: passos,
    medidas,
    situacoes,
    motivosBloqueio: motivos,
  },
  retiradas: {
    titulo: 'Retiradas do que o outro sistema lê',
    texto:
      'Pela decisão vigente, o estado esperado de cada retirada: "verde" quando ela já pode ser feita; "especificada" quando ela fica pronta e desligada até a extinção.',
    legenda: 'Estado esperado e estado atual das retiradas',
    operacao: 'Operação',
    estado: 'Estado esperado',
    estadoAtual: 'Estado no catálogo de operações',
    confere: 'Confere',
    estados: { verde: 'Verde', especificada: 'Especificada (pronta e desligada)' },
    estadosCatalogo: {
      especificada: 'Especificada',
      referencia: 'Referência',
      verde: 'Verde',
      conferida: 'Conferida',
      liberada: 'Liberada',
      bloqueada: 'Bloqueada',
    },
    semLeitura: 'Sem leitura',
    sim: 'sim',
    diverge: 'não',
    divergencia:
      'O catálogo de operações não acompanha a decisão em: {operacoes}. Ajuste o estado dessas operações no catálogo para o esperado.',
    nomes: {
      'acesso-retirarSenhaLegado': 'Retirar a senha antiga das pessoas',
      'acesso-retirarSenhaSecundaria': 'Retirar a senha secundária das pessoas',
      'integracao-cifrarSegredoLegado': 'Cifrar os segredos de integração guardados no banco',
    },
  },
  inventario: {
    titulo: 'Medidas do banco',
    texto: 'Contadas na estrutura do banco (nunca nos dados): o tamanho de cada passo do plano.',
    medidoEm: 'Medido em {em}',
    indisponivel:
      'A estrutura do banco não pôde ser lida agora. A decisão e os passos seguem; o tamanho de cada passo fica sem medida.',
    tabelas: 'Tabelas',
    gatilhos: 'Gatilhos: {total} ({ativos} ativos) em {tabelas} tabelas',
    colunasDeUmaLetra: 'Colunas de uma letra: {colunas} em {tabelas} tabelas',
    paresDataHora: 'Pares de data e hora: {pares} em {tabelas} tabelas',
    chavesEmTexto: 'Chaves em texto: {chaves} de {deTotal} chaves, em {tabelas} tabelas',
    tabelasClinicas: 'Tabelas clínicas: {presentes} de {matriz} presentes neste banco',
    gatilhosSgh: 'Gatilhos do Sante em tabela do outro sistema: {n}',
    gatilhosSghAlerta:
      'Há gatilho do Sante em tabela do outro sistema enquanto a retrocompatibilidade dura. Avise o responsável técnico.',
  },
};
