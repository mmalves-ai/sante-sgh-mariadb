// Textos da manutenção corretiva com oficina e conserto externo (C2-089, 04-HOT L135): o cadastro das oficinas e a
// seção "Orçamento e conserto externo" do detalhe da OS. As recusas das regras puras do domínio têm todas texto aqui
// (conferido pelo tipo). A saída para conserto segue a remessa com nota fiscal (CFOP 5.915 dentro do estado, 6.915 fora).
import type {
  RecusaDecisao,
  RecusaMembro,
  RecusaOficina,
  RecusaOrcamento,
  RecusaRemessa,
  RecusaRetorno,
} from '@sgh/dominio-manutencao';

type RecusaCorretiva =
  | RecusaOficina
  | RecusaMembro
  | RecusaOrcamento
  | RecusaDecisao
  | RecusaRemessa
  | RecusaRetorno
  | 'versao-obrigatoria'
  | 'sem-usuario';

export const recusasCorretiva = {
  'codigo-invalido': 'O código tem de 2 a 30 letras, números, ponto, hífen ou sublinhado.',
  'nome-obrigatorio': 'Informe o nome da oficina (pelo menos 3 letras).',
  'terceirizada-sem-fornecedor': 'A oficina terceirizada exige a empresa fornecedora.',
  'email-obrigatorio': 'Para avisar por e-mail, informe o e-mail da oficina.',
  'email-invalido': 'E-mail da oficina inválido.',
  'vigencia-invertida': 'O fim da vigência é anterior ao início.',
  'alcada-invalida': 'A alçada tem de ser maior que zero.',
  'alcada-so-do-aprovador': 'Só o aprovador tem alçada de valor.',
  'os-fechada': 'A ordem de serviço já foi concluída ou cancelada: não recebe orçamento.',
  'valor-invalido': 'O valor do orçamento tem de ser maior que zero.',
  'descricao-obrigatoria': 'Descreva o serviço orçado.',
  'validade-vencida': 'A validade do orçamento já passou.',
  'ja-aprovado': 'Esta ordem de serviço já tem orçamento aprovado.',
  'orcamento-decidido': 'Este orçamento já foi decidido.',
  'orcamento-vencido': 'O orçamento passou da validade: peça um novo ao fornecedor.',
  'mesmo-autor': 'Quem registrou o orçamento não o aprova nem reprova (segregação de funções).',
  'sem-alcada': 'Você não é aprovador vigente da oficina desta ordem de serviço.',
  'acima-da-alcada': 'O valor passa da sua alçada de aprovação: encaminhe a quem tem alçada maior.',
  'justificativa-curta': 'Escreva a justificativa com pelo menos 10 caracteres.',
  'situacao-nao-permite': 'A situação da ordem de serviço não permite enviar o equipamento agora.',
  'sem-equipamento': 'A ordem de serviço não tem equipamento para enviar.',
  'remessa-aberta': 'O equipamento já está com o fornecedor: registre o retorno antes de nova remessa.',
  'orcamento-pendente': 'O orçamento ainda aguarda a decisão do aprovador.',
  'orcamento-reprovado': 'O último orçamento foi reprovado: registre um novo antes de enviar.',
  'sem-orcamento':
    'Sem orçamento aprovado, o equipamento só sai sem custo: informe o motivo (garantia, contrato ou comodato).',
  'sem-orcamento-indevido': 'A ordem de serviço já tem orçamento aprovado: a saída segue por ele.',
  'justificativa-sem-orcamento': 'Justifique a saída sem orçamento com pelo menos 10 caracteres.',
  'previsao-invertida': 'A previsão de retorno é anterior à saída.',
  'termo-obrigatorio': 'Descreva o termo de saída (estado do equipamento e acessórios que seguem).',
  'remessa-retornada': 'O retorno desta remessa já foi registrado.',
  'retorno-antes-da-saida': 'O retorno não pode ser anterior à saída do equipamento.',
  'retorno-futuro': 'O retorno é registrado depois de acontecer.',
  'versao-obrigatoria': 'Abra a oficina de novo para gravar a versão atual.',
  'sem-usuario': 'Sessão sem usuário identificado. Entre de novo.',
} as const satisfies Record<RecusaCorretiva, string>;

export const textosOficinas = {
  titulo: 'Oficinas de manutenção',
  ajuda:
    'Cada oficina tem as pessoas que atendem, quem aprova orçamento (com a alçada de valor) e os serviços que faz. Quem sai fica inativo com o fim da vigência.',
  nova: 'Nova oficina',
  buscar: 'Buscar por código ou nome',
  inativas: 'Mostrar inativas',
  nenhuma: 'Nenhuma oficina encontrada.',
  ordensAbertas: 'OS abertas',
  ativa: 'Ativa',
  inativa: 'Inativa',
  gravar: 'Gravar oficina',
  campos: {
    codigo: 'Código',
    nome: 'Nome',
    terceirizada: 'Oficina terceirizada',
    fornecedor: 'Empresa fornecedora',
    buscarFornecedor: 'Buscar fornecedor (nome ou CNPJ)',
    especialidade: 'Especialidade',
    email: 'E-mail',
    telefone: 'Telefone',
    ramal: 'Ramal',
    notificaPorEmail: 'Avisar a oficina por e-mail',
    exigeAvaliacao: 'Exigir avaliação do serviço no aceite',
    ativo: 'Ativa',
  },
  membros: {
    titulo: 'Pessoas da oficina',
    login: 'Usuário (login)',
    funcao: 'Função',
    alcada: 'Alçada (R$)',
    alcadaAjuda: 'Só para o aprovador. Vazio: sem limite.',
    inicio: 'Início da vigência',
    fim: 'Fim da vigência',
    incluir: 'Incluir pessoa',
    retirar: 'Retirar',
    funcoes: {
      tecnico: 'Técnico',
      supervisor: 'Supervisor',
      aprovador: 'Aprovador de orçamento',
      recepcao: 'Recepção',
    },
  },
  fora: {
    os: 'OS {numero}',
    titulo: 'Equipamentos fora para conserto',
    nenhum: 'Nenhum equipamento está com fornecedor agora.',
    previsao: 'previsão',
    atrasada: 'retorno atrasado',
  },
  servicos: {
    titulo: 'Serviços da oficina',
    servico: 'Serviço',
    tempo: 'Tempo padrão (min)',
    incluir: 'Incluir serviço',
    retirar: 'Retirar',
  },
} as const;

export const textosCorretiva = {
  titulo: 'Orçamento e conserto externo',
  oficina: 'Oficina: {nome}',
  semOficina: 'A ordem de serviço não tem oficina definida.',
  orcamentos: 'Orçamentos',
  nenhumOrcamento: 'Nenhum orçamento registrado.',
  remessas: 'Saídas para conserto',
  nenhumaRemessa: 'O equipamento não saiu para conserto.',
  situacoesOrcamento: {
    pendente: 'Aguarda decisão',
    aprovado: 'Aprovado',
    reprovado: 'Reprovado',
    substituido: 'Substituído',
  },
  situacoesRemessa: { enviado: 'Com o fornecedor', retornado: 'Retornou' },
  resultados: { consertado: 'Consertado', sem_conserto: 'Sem conserto' },
  atrasada: 'Retorno atrasado',
  cfopDe: 'CFOP {cfop}',
  registradoPor: 'registrado por {nome} em {em}',
  decididoPor: 'decidido por {nome} em {em}',
  acoes: {
    orcamento: 'Registrar orçamento',
    aprovar: 'Aprovar',
    reprovar: 'Reprovar',
    remessa: 'Enviar ao fornecedor',
    retorno: 'Registrar retorno',
  },
  campos: {
    fornecedor: 'Fornecedor',
    buscarFornecedor: 'Buscar fornecedor',
    descricao: 'Serviço orçado',
    valor: 'Valor (R$)',
    prazoDias: 'Prazo (dias)',
    validade: 'Validade do orçamento',
    justificativa: 'Justificativa',
    justificativaAjuda: 'Obrigatória na reprovação: pelo menos 10 caracteres.',
    termo: 'Termo de saída',
    termoAjuda: 'Estado do equipamento, acessórios que seguem e quem retirou.',
    notaFiscal: 'Nota fiscal',
    cfop: 'Natureza da remessa (CFOP)',
    previsao: 'Previsão de retorno',
    retornadoEm: 'Retorno em',
    resultado: 'Resultado',
    observacao: 'Observação',
    observacaoAjuda: 'Obrigatória quando volta sem conserto: pelo menos 10 caracteres.',
    motivoSemOrcamento: 'Saída sem orçamento',
    justificativaSemOrcamento: 'Justificativa da saída sem orçamento',
    semOrcamentoAjuda:
      'Não há orçamento aprovado: o conserto pago exige a aprovação dentro da alçada. Sem custo, informe o motivo.',
  },
  motivosSemOrcamento: {
    garantia: 'Garantia do fabricante ou do fornecedor',
    contrato: 'Contrato de manutenção vigente',
    comodato: 'Comodato',
  },
  semOrcamentoDe: 'Sem orçamento: {motivo}',
  cfops: {
    nenhum: 'Sem nota fiscal',
    '5915': '5.915 - remessa para conserto dentro do estado',
    '6915': '6.915 - remessa para conserto para outro estado',
  },
  gravar: 'Gravar',
  valorInvalido: 'Informe o valor do orçamento (maior que zero).',
  prazoInvalido: 'O prazo é um número inteiro de dias.',
  fornecedorObrigatorio: 'Escolha o fornecedor.',
} as const;
