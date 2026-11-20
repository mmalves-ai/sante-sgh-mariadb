// Textos da janela em produção, da verificação depois dela e da retirada da restrição de entrada (M58, etapa 5;
// ficha, seções 2, 5, 8 a 12): a tela "Janela" da migração gradual. Sem o nome do sistema anterior (ADR 0023). Toda
// etapa do roteiro, fase, papel, checagem, situação, achado e motivo do contrato tem texto (conferido no teste).
import type {
  AchadoJanela,
  AmbienteVerificacaoJanela,
  ChecagemJanela,
  EtapaRoteiroJanela,
  FaseRoteiroJanela,
  MotivoRetiradaRestricao,
  ResponsavelJanela,
  SituacaoChecagemJanela,
  SituacaoRetirada,
} from '@sgh/contratos';

const etapas: Record<EtapaRoteiroJanela, { titulo: string; descricao: string }> = {
  'confirmar-autorizacao': {
    titulo: 'Confirmar a autorização',
    descricao:
      'A autorização do dono para este passo, registrada, e a data da janela combinada com as áreas.',
  },
  'conferir-sessoes': {
    titulo: 'Conferir as sessões abertas',
    descricao:
      'Ninguém mais trabalhando no outro sistema: as sessões do dia zeradas no painel do desligamento.',
  },
  'avisar-areas': {
    titulo: 'Avisar as áreas',
    descricao: 'Cada área sabe o dia, a hora e o tempo da parada, e quem chamar se algo não abrir depois.',
  },
  'avisar-parceiros': {
    titulo: 'Avisar os parceiros',
    descricao: 'Os parceiros que leem ou gravam no banco sabem da parada e confirmam o teste depois dela.',
  },
  'avisar-hal-ai': {
    titulo: 'Avisar a equipe da Hal-AI',
    descricao: 'A comunicação com os pacientes fica em espera durante a parada e é conferida na volta.',
  },
  'treinar-contingencia': {
    titulo: 'Treinar a contingência',
    descricao: 'As áreas sabem trabalhar em papel durante a parada e lançar depois, sem perder registro.',
  },
  'contar-antes': {
    titulo: 'Contar as linhas antes',
    descricao:
      'A contagem de cada tabela no início da parada, guardada fora do repositório para a comparação.',
  },
  'encerrar-sessoes': {
    titulo: 'Encerrar as sessões',
    descricao: 'As últimas sessões encerradas com aviso; nenhuma gravação em andamento.',
  },
  'parar-acesso': {
    titulo: 'Parar o acesso ao banco',
    descricao: 'O banco fechado para todos os programas, este inclusive, até o fim da execução.',
  },
  'retirar-executaveis': {
    titulo: 'Retirar os programas antigos',
    descricao: 'Os programas do outro sistema retirados das estações e do servidor, sem atalho de volta.',
  },
  'parar-servicos-fornecedor': {
    titulo: 'Parar os serviços do fornecedor',
    descricao: 'Os serviços e tarefas agendadas do fornecedor parados e desativados.',
  },
  'revogar-contas-fornecedor': {
    titulo: 'Revogar as contas do fornecedor',
    descricao: 'As contas de acesso do fornecedor desativadas no banco e no servidor.',
  },
  backup: {
    titulo: 'Cópia de segurança',
    descricao: 'A cópia completa do banco antes da mudança, conferida, guardada para a volta atrás.',
  },
  'instalar-motor': {
    titulo: 'Instalar a versão 5 do motor',
    descricao: 'O motor do banco na versão 5 no servidor, com a configuração ensaiada na cópia.',
  },
  'habilitar-funcoes-externas': {
    titulo: 'Habilitar as funções externas',
    descricao: 'As bibliotecas de funções externas ensaiadas, permitidas só na pasta restrita.',
  },
  restaurar: {
    titulo: 'Restaurar no motor novo',
    descricao: 'A cópia de segurança restaurada na versão 5, no tempo medido no ensaio.',
  },
  integridade: {
    titulo: 'Conferir a integridade',
    descricao: 'A verificação completa do banco restaurado, sem erro.',
  },
  converter: {
    titulo: 'Converter o texto para UTF-8',
    descricao: 'Os dados copiados para o banco em UTF-8 com a prova de equivalência, como no ensaio.',
  },
  'definir-charset': {
    titulo: 'Ajustar a leitura deste sistema',
    descricao: 'O parâmetro de leitura e gravação deste sistema passa para UTF-8 no hospital.',
  },
  verificar: {
    titulo: 'Verificar depois da janela',
    descricao:
      'A estrutura do banco, a plataforma, a contagem de cada tabela e a saúde das conexões, comparadas com o ensaio.',
  },
  'operacoes-chave': {
    titulo: 'Operações-chave',
    descricao: 'Os chave-usuários executam as operações principais de cada área em modo de verificação.',
  },
  reabrir: {
    titulo: 'Reabrir',
    descricao: 'O banco liberado de novo para as áreas, com o aviso de volta ao trabalho.',
  },
  'registrar-execucao': {
    titulo: 'Registrar a execução',
    descricao: 'O passo marcado como executado no registro dos passos do hospital, com a data e o resultado.',
  },
  'retirar-restricao': {
    titulo: 'Retirar a restrição de entrada',
    descricao:
      'Liberar a digitação de qualquer caractere na tela de funcionalidades, só depois da verificação.',
  },
  'religar-contingencia': {
    titulo: 'Voltar à contingência',
    descricao:
      'Se a verificação falhar antes da reabertura: as áreas seguem em papel e o passo é refeito depois.',
  },
  'restaurar-backup-anterior': {
    titulo: 'Restaurar a cópia anterior',
    descricao:
      'Se a verificação falhar antes da reabertura: o banco volta à cópia de segurança tirada na janela.',
  },
};

const fases: Record<FaseRoteiroJanela, string> = {
  antes: 'Antes da janela',
  parada: 'Parada',
  execucao: 'Execução',
  verificacao: 'Verificação',
  reabertura: 'Reabertura',
  'volta-atras': 'Volta atrás (só antes da reabertura)',
};

const responsaveis: Record<ResponsavelJanela, string> = {
  dono: 'Direção',
  ti: 'TI do hospital',
  coordenacao: 'Coordenação da migração',
  'chave-usuarios': 'Chave-usuários',
  'hal-ai': 'Equipe da Hal-AI',
  parceiros: 'Parceiros',
};

const checagens: Record<ChecagemJanela, string> = {
  plataforma: 'Versão do motor e texto do banco',
  schema: 'Estrutura do banco',
  contagens: 'Contagem de cada tabela',
  saude: 'Saúde das conexões',
  operacoes: 'Operações-chave',
};

const situacoesChecagem: Record<SituacaoChecagemJanela, string> = {
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
  'nao-executada': 'Não executada',
};

const achados: Record<AchadoJanela, string> = {
  'motor-diferente-do-alvo': 'A versão do motor não é a esperada para este passo.',
  'charset-diferente-do-alvo': 'O texto do banco não está na codificação esperada para este passo.',
  'charset-desencontrado': 'O parâmetro de leitura deste sistema não casa com a codificação do banco.',
  'sem-impressao-homologada': 'Falta a estrutura homologada no ensaio para comparar.',
  'impressao-diferente': 'A estrutura do banco difere da homologada no ensaio.',
  'sem-contagem-antes': 'Falta a contagem tirada no início da parada.',
  'contagens-diferentes': 'Há tabelas com contagem diferente da tirada antes da parada.',
  'tabelas-ausentes': 'Há tabelas que não existem mais depois da janela.',
  'conexao-falhou': 'Este sistema não conseguiu se conectar ao banco.',
  'latencia-alta': 'A resposta do banco ficou acima do limite aceito.',
  'codec-desencontrado': 'A leitura deste sistema não casa com a codificação do banco.',
  'operacoes-com-falha': 'Há operações-chave que falharam na verificação.',
  'sem-operacoes': 'Nenhuma operação-chave foi registrada pelos chave-usuários.',
  'nao-executada': 'A checagem não foi executada.',
};

const motivos: Record<MotivoRetiradaRestricao, string> = {
  'utf8-nao-autorizado': 'A conversão para UTF-8 ainda não foi autorizada pela direção.',
  'utf8-nao-executado': 'A conversão para UTF-8 ainda não foi executada neste hospital.',
  'verificacao-ausente': 'Falta a verificação depois da janela da conversão, feita na produção.',
  'verificacao-reprovada': 'A verificação depois da janela da conversão foi reprovada.',
  'banco-nao-utf8': 'O banco ainda não está em UTF-8.',
  'parametro-nao-utf8': 'A leitura deste sistema ainda não está em UTF-8.',
  'registro-invalido': 'O registro dos passos deste hospital não vale; corrija-o primeiro.',
};

const situacoesRetirada: Record<SituacaoRetirada, string> = {
  restrita: 'Restrita: a digitação segue limitada aos caracteres atuais.',
  'pode-retirar': 'Pode ser retirada na tela de funcionalidades.',
  retirada: 'Retirada: qualquer caractere já pode ser digitado.',
};

const ambientes: Record<AmbienteVerificacaoJanela, string> = {
  producao: 'Na produção (a que conta)',
  ensaio: 'Ensaio do roteiro na cópia',
};

export const mensagensJanela = {
  titulo: 'Janela em produção',
  descricao:
    'O roteiro de cada passo, a verificação depois da janela e a restrição de entrada do hospital. A execução é da TI do hospital, com a autorização da direção; esta tela só acompanha.',
  atualizadoEm: 'Atualizado em {em}',
  relatorio: 'Relatório da verificação',
  relatorioInvalido: 'O relatório da verificação não vale ({motivo}): nenhuma verificação é considerada.',
  registroInvalido: 'O registro dos passos deste hospital não vale ({motivo}).',
  autorizado: 'Autorizado',
  naoAutorizado: 'Não autorizado',
  executado: 'Executado',
  naoExecutado: 'Não executado',
  ensaioAprovado: 'Ensaio aprovado',
  ensaioPendente: 'Ensaio pendente: o roteiro é só um rascunho',
  janela: 'Janela estimada',
  janelaMinutos: '{n} minutos (da parada à reabertura, com margem)',
  semJanela: 'Sem os tempos do ensaio',
  semParada: 'Este passo não para o banco',
  voltaAtras: 'Volta atrás estimada',
  voltaAtrasMinutos: '{n} minutos',
  semVoltaAtras: 'Sem o tempo do ensaio',
  roteiro: 'Roteiro',
  colunas: {
    ordem: 'Nº',
    etapa: 'Etapa',
    fase: 'Fase',
    responsavel: 'Responsável',
    comando: 'Comando',
    minutos: 'Minutos',
  },
  critica: 'crítica: se falhar, vale a volta atrás',
  semComando: '—',
  semMinutos: '—',
  verificacoes: 'Verificação depois da janela',
  semVerificacao: 'Ainda não verificada',
  verificadaEm: 'Verificada em {em}',
  duracao: 'Janela medida: {n} minutos',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
  numeros:
    'Tabelas iguais: {iguais} de {tabelas} · operações verdes: {verdes} de {operacoes} · resposta: {latencia}',
  latenciaMs: '{n} ms',
  semLatencia: 'não medida',
  motor: 'Motor {versao}, texto {charset}',
  retirada: 'Restrição de entrada',
  chave: 'Chave',
  charsetBanco: 'Texto do banco',
  charsetParametro: 'Leitura deste sistema',
  motivosTitulo: 'O que falta para retirar',
  irFuncionalidades: 'Ir à tela de funcionalidades',
  verTela: 'Ver a janela em produção',
  etapas,
  fases,
  responsaveis,
  checagens,
  situacoesChecagem,
  achados,
  motivos,
  situacoesRetirada,
  ambientes,
};
