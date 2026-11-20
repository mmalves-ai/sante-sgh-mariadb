// Textos do ensaio da versão 5 do motor na cópia (M58, etapa 2; ficha, seções 2, 5, 10 e 11): a tela da migração
// gradual e o resumo no cartão "Plataforma do banco". Sem o nome do sistema anterior (ADR 0023). Toda etapa, situação,
// motivo de bloqueio, resolução e achado do contrato tem texto (conferido no teste).
import type {
  EtapaEnsaioFirebird5,
  MotivoEtapaBloqueada,
  ResolucaoFuncaoExterna,
  SituacaoEtapaEnsaio,
} from '@sgh/contratos';

const etapas: Record<EtapaEnsaioFirebird5, { titulo: string; descricao: string }> = {
  backup: {
    titulo: 'Cópia de segurança na versão atual',
    descricao: 'Cópia de segurança completa do banco na versão em uso hoje; o tempo é a base da janela.',
  },
  restauracao: {
    titulo: 'Restauração na versão 5',
    descricao: 'A cópia restaurada no motor novo, com a verificação de integridade do arquivo.',
  },
  contagens: {
    titulo: 'Contagem de linhas por tabela',
    descricao: 'O número de linhas de cada tabela, antes e depois, comparado pelo resumo da lista.',
  },
  objetos: {
    titulo: 'Gatilhos e procedimentos',
    descricao: 'Todos recompilados na restauração e válidos; os que já eram inválidos antes ficam à parte.',
  },
  'funcoes-externas': {
    titulo: 'Funções externas',
    descricao: 'Cada função de biblioteca externa habilitada por configuração ou substituída.',
  },
  driver: {
    titulo: 'Conexão deste sistema',
    descricao: 'O adaptador conecta ao motor novo, com a autenticação e o canal cifrado.',
  },
  schema: {
    titulo: 'Estrutura do banco',
    descricao: 'A impressão digital da estrutura igual à homologada, ou a diferença explicada só pelo motor.',
  },
  assinaturas: {
    titulo: 'Assinaturas das operações',
    descricao: 'Todas as operações de gravação reexecutadas, sem diferença em relação à versão atual.',
  },
  carga: {
    titulo: 'Teste de carga',
    descricao: 'A carga somada com os objetivos de tempo de resposta atendidos.',
  },
  'sante-api': {
    titulo: 'API de integração da Hal-AI',
    descricao: 'Os contratos e as suítes da API de integração verdes contra a cópia de ensaio.',
  },
  parceiros: {
    titulo: 'Parceiros que leem o banco',
    descricao: 'As visões e as contas de parceiros lidas sem erro, e cada parceiro avisado da janela.',
  },
  'volta-atras': {
    titulo: 'Volta atrás',
    descricao: 'A mesma cópia de segurança restaurada de novo na versão atual, para o caso de desistir.',
  },
  'restauracao-isolada': {
    titulo: 'Restauração isolada',
    descricao: 'Uma cópia feita já na versão 5, restaurada à parte e verificada.',
  },
};

const situacoes: Record<SituacaoEtapaEnsaio, string> = {
  'nao-executada': 'Não executada',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
  bloqueada: 'Bloqueada',
};

const bloqueios: Record<MotivoEtapaBloqueada, string> = {
  'biblioteca-do-fornecedor': 'Aguarda a biblioteca da função, que vem da TI do hospital.',
  'equipe-hal-ai': 'Aguarda a verificação da equipe da Hal-AI.',
  'lista-da-ti': 'Aguarda a lista de parceiros e contas técnicas da TI do hospital.',
  parceiro: 'Aguarda o teste do parceiro, do lado dele.',
  'autorizacao-do-dono': 'Aguarda a autorização do dono do projeto para corrigir objeto do banco.',
};

const resolucoes: Record<ResolucaoFuncaoExterna, string> = {
  pendente: 'Pendente',
  'habilitada-por-configuracao': 'Habilitada por configuração',
  substituida: 'Substituída',
};

/** Achados (o prefixo antes de ":" é o código; o resto é o nome do objeto ou a categoria). */
const achados: Record<string, string> = {
  'sem-tempo': 'O tempo não foi medido.',
  'integridade-nao-verificada': 'A integridade não foi verificada ou falhou.',
  'sem-tabelas': 'Nenhuma tabela contada.',
  'contagens-diferentes': 'Há tabelas com contagem diferente.',
  'tabelas-ausentes': 'Há tabelas que existem só de um lado.',
  'resumo-diferente': 'O resumo das contagens difere entre antes e depois.',
  'objetos-invalidos': 'Há gatilhos ou procedimentos inválidos depois da troca.',
  'funcao-pendente': 'Função sem resolução: {nome}',
  'udf-access-fechado': 'O servidor não libera as funções externas habilitadas.',
  'sem-conexao': 'O adaptador não conectou.',
  'sem-impressao': 'A impressão digital da cópia de ensaio não foi tirada.',
  'sem-homologada': 'Não há impressão digital homologada para comparar.',
  'schema-ausentes': 'Faltam objetos na categoria {nome}.',
  'schema-novos': 'Objetos novos na categoria {nome}.',
  'schema-alterados': 'Objetos alterados sem explicação na categoria {nome}.',
  'sem-operacoes': 'Nenhuma operação reexecutada.',
  'assinaturas-diferentes': 'Há operações com diferença.',
  'gatilho-a-corrigir': 'O gatilho {nome} do banco precisa de correção para a versão 5.',
  'slo-nao-medido-ou-falhou': 'Carga não medida, ou os objetivos de tempo não foram atendidos.',
  'contratos-nao-verdes': 'Contratos da API de integração quebrados ou não verificados.',
  'parceiro-com-erro': 'Leitura com erro no parceiro {nome}.',
  'parceiros-nao-avisados': 'Há parceiros ainda não avisados da janela.',
  'sem-parceiros': 'Nenhum parceiro conferido.',
  desconhecido: 'Achado não reconhecido: {nome}',
};

export const mensagensEnsaioFirebird5 = {
  titulo: 'Ensaio da versão 5 do motor do banco',
  descricao:
    'O banco deste hospital copiado da versão atual e restaurado na versão 5, numa cópia isolada, com as 13 etapas medidas. Nada aqui muda o banco em uso: a troca só acontece na janela autorizada.',
  atualizadoEm: 'Lido em {em}',
  ensaiadoEm: 'Ensaiado em {dia}',
  naoEnsaiado: 'O ensaio ainda não tem relatório válido: {motivo}',
  relatorio: 'Relatório',
  origem: 'Versão de origem',
  alvo: 'Versão ensaiada',
  janela: 'Janela estimada',
  janelaMinutos: '{n} minutos (cópia, restauração e verificação, com margem de 50%)',
  semJanela: 'Sem os tempos da cópia e da restauração',
  aprovavel: 'Todas as etapas aprovadas: o ensaio pode ser registrado como aprovado no registro dos passos.',
  naoAprovavel:
    'Aprovadas {aprovadas} de {total} etapas; o ensaio ainda não pode ser registrado como aprovado.',
  registro: 'Registro dos passos',
  registrado: 'Registrado em {dia}: {resultado}',
  semRegistro: 'Sem registro do ensaio',
  resultados: { aprovado: 'aprovado', reprovado: 'reprovado' },
  colunas: { etapa: 'Etapa', situacao: 'Situação', achados: 'O que falta' },
  semAchados: 'Nada a corrigir',
  funcoes: 'Funções externas',
  funcoesColunas: {
    nome: 'Função',
    biblioteca: 'Biblioteca',
    chamada: 'Chamada de prova',
    dependentes: 'Dependentes válidos',
    resolucao: 'Resolução',
  },
  semFuncoes: 'Nenhuma função externa no relatório.',
  presente: 'presente',
  ausente: 'ausente',
  respondeu: 'respondeu',
  naoRespondeu: 'não respondeu',
  naoChamada: 'não chamada',
  dependentesLinha: '{validos} de {total}',
  verTela: 'Ver o ensaio da versão 5',
  resumoCartao: 'Ensaio da versão 5: aprovadas {aprovadas} de {total} etapas',
  etapas,
  situacoes,
  bloqueios,
  resolucoes,
  achados,
};

/** O texto de um achado ("funcao-pendente:VLR_MED" → código e nome). */
export function chaveAchado(a: string): { codigo: string; nome: string } {
  const i = a.indexOf(':');
  const codigo = i < 0 ? a : a.slice(0, i);
  const nome = i < 0 ? '' : a.slice(i + 1);
  return codigo in achados ? { codigo, nome } : { codigo: 'desconhecido', nome: a };
}
