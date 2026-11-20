// Textos do ensaio da conversão do texto do banco para UTF-8 (M58, etapa 3; ficha, seções 5, 7, 8 e 11): a tela da
// migração gradual e a linha do cartão "Plataforma do banco". Sem o nome do sistema anterior (ADR 0023). Toda etapa,
// situação, motivo de bloqueio e achado do contrato tem texto (conferido no teste).
import type { EtapaEnsaioUtf8, MotivoEtapaBloqueada, SituacaoEtapaEnsaio } from '@sgh/contratos';

const etapas: Record<EtapaEnsaioUtf8, { titulo: string; descricao: string }> = {
  base: {
    titulo: 'Banco de partida',
    descricao:
      'A cópia já ensaiada na versão 5 do motor, íntegra, com a estrutura homologada naquele ensaio.',
  },
  inventario: {
    titulo: 'Colunas de texto',
    descricao:
      'As colunas de texto por forma de conversão: acentuação atual, já em UTF-8, ou mantidas em bytes.',
  },
  indices: {
    titulo: 'Índices com texto',
    descricao: 'A chave de cada índice em UTF-8 (até 4 bytes por letra) cabe na página do banco convertido.',
  },
  literais: {
    titulo: 'Textos fixos nos gatilhos e procedimentos',
    descricao: 'Os textos acentuados escritos dentro dos gatilhos e procedimentos, revistos um a um.',
  },
  conversao: {
    titulo: 'Conversão dos dados',
    descricao: 'Os dados copiados para o banco em UTF-8 sem perda, com o tempo medido para a janela.',
  },
  equivalencia: {
    titulo: 'Prova de equivalência',
    descricao: 'Mesma contagem por tabela e o mesmo resumo de cada coluna de texto, lida antes e depois.',
  },
  'utf8-catalogadas': {
    titulo: 'Colunas que já guardam UTF-8',
    descricao: 'As poucas colunas que já recebiam texto em UTF-8 passam sem nova conversão.',
  },
  rtf: {
    titulo: 'Documentos e anexos em bytes',
    descricao: 'Evoluções em RTF e demais anexos mantidos byte a byte; os documentos continuam abrindo.',
  },
  objetos: {
    titulo: 'Gatilhos e procedimentos',
    descricao: 'Todos válidos no banco convertido; os que já eram inválidos antes ficam à parte.',
  },
  codec: {
    titulo: 'Leitura e gravação deste sistema',
    descricao: 'O adaptador em modo UTF-8: ida e volta dos 256 caracteres e o charset conferido na partida.',
  },
  schema: {
    titulo: 'Estrutura do banco',
    descricao:
      'A impressão digital do convertido; a diferença em relação à homologada explicada só pelo charset.',
  },
  assinaturas: {
    titulo: 'Assinaturas das operações',
    descricao:
      'Todas as operações de gravação reexecutadas no banco convertido, comparadas por classe de valor.',
  },
  carga: {
    titulo: 'Teste de carga',
    descricao: 'A carga somada com os objetivos de tempo de resposta atendidos.',
  },
  'sante-api': {
    titulo: 'API de integração da Hal-AI',
    descricao: 'Os contratos e as suítes da API de integração verdes contra o banco convertido.',
  },
  parceiros: {
    titulo: 'Parceiros que leem o banco',
    descricao:
      'As visões e as contas de parceiros lidas sem erro no banco convertido, e cada parceiro avisado.',
  },
  'volta-atras': {
    titulo: 'Volta atrás',
    descricao: 'O banco de partida restaurado de novo e verificado, para o caso de desistir da conversão.',
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

/** Achados (o prefixo antes de ":" é o código; o resto é o nome do objeto, da coluna ou a categoria). */
const achados: Record<string, string> = {
  'sem-impressao-base': 'Falta a impressão digital homologada do banco de partida.',
  'integridade-nao-verificada': 'A integridade não foi verificada ou falhou.',
  'sem-inventario': 'Nenhuma coluna de texto inventariada.',
  'catalogada-ausente': 'A coluna {nome}, conhecida como UTF-8, não existe no banco.',
  'indice-sem-pagina': 'O índice {nome} não cabe em nenhuma página em UTF-8 e precisa mudar.',
  'sem-pagina': 'O tamanho de página do banco não foi lido.',
  'pagina-alvo-insuficiente': 'A página do banco convertido não comporta todos os índices.',
  'literal-a-rever': 'O texto fixo de {nome} precisa de revisão.',
  'literal-mudou': 'O texto fixo de {nome} mudou de letra no banco convertido.',
  'funcao-por-byte':
    'A função {nome} conta e corta por byte: em UTF-8 pode partir a letra acentuada nos objetos que a usam.',
  'fonte-sem-ida-e-volta': 'Há gatilhos ou procedimentos cujo texto não volta igual.',
  'tabela-rejeitada': 'A tabela {nome} não foi copiada por inteiro.',
  'sem-tempo': 'O tempo não foi medido.',
  'sem-tabelas': 'Nenhuma tabela conferida.',
  'tabela-diferente': 'A tabela {nome} tem contagem diferente, ou existe de um lado só.',
  'coluna-diferente': 'A coluna {nome} mudou de conteúdo na conversão.',
  'tabela-nao-verificada': 'A tabela {nome} não pôde ser percorrida para a prova.',
  'sem-resumo': 'O resumo das colunas não foi calculado.',
  'resumo-diferente': 'O resumo das colunas difere entre antes e depois.',
  'contagem-diferente': 'Há tabelas ou colunas que não bateram.',
  'sem-catalogadas': 'Nenhuma coluna em UTF-8 conferida.',
  'catalogada-sem-ida-e-volta': 'Há coluna em UTF-8 que não voltou igual.',
  'sem-blobs': 'Nenhum anexo em bytes conferido.',
  'blob-diferente': 'Há anexos com bytes diferentes.',
  'rtf-nao-abre': 'Há documentos em RTF que não abrem depois da conversão.',
  'sem-objetos': 'Nenhum gatilho ou procedimento conferido.',
  invalido: 'O objeto {nome} ficou inválido no banco convertido.',
  'corpus-incompleto': 'O teste de ida e volta não cobriu os 256 caracteres.',
  'corpus-sem-ida-e-volta': 'Há caracteres que não voltam iguais.',
  'charset-nao-conferido': 'O charset do banco não foi conferido na partida do adaptador.',
  'sem-impressao': 'A impressão digital do banco convertido não foi tirada.',
  'schema-ausentes': 'Faltam objetos na categoria {nome}.',
  'schema-novos': 'Objetos novos na categoria {nome}.',
  'schema-alterados': 'Objetos alterados sem explicação na categoria {nome}.',
  'sem-operacoes': 'Nenhuma operação reexecutada.',
  'assinaturas-diferentes': 'Há operações com diferença.',
  'slo-nao-medido-ou-falhou': 'Carga não medida, ou os objetivos de tempo não foram atendidos.',
  'contratos-nao-verdes': 'Contratos da API de integração quebrados ou não verificados.',
  'parceiro-com-erro': 'Leitura com erro no parceiro {nome}.',
  'parceiros-nao-avisados': 'Há parceiros ainda não avisados da janela.',
  'sem-parceiros': 'Nenhum parceiro conferido.',
  desconhecido: 'Achado não reconhecido: {nome}',
};

export const mensagensEnsaioUtf8 = {
  titulo: 'Ensaio da conversão do texto para UTF-8',
  descricao:
    'O banco deste hospital, já ensaiado na versão 5 do motor, convertido para UTF-8 numa cópia isolada, com as 16 etapas medidas. Nada aqui muda o banco em uso: a conversão só acontece na janela autorizada, e a digitação continua restrita aos caracteres de hoje até a liberação.',
  atualizadoEm: 'Lido em {em}',
  ensaiadoEm: 'Ensaiado em {dia}',
  naoEnsaiado: 'O ensaio ainda não tem relatório válido: {motivo}',
  relatorio: 'Relatório',
  origem: 'Banco de partida',
  alvo: 'Banco convertido',
  janela: 'Janela estimada',
  janelaMinutos: '{n} minutos (conversão e prova de equivalência, com margem)',
  semJanela: 'Sem o tempo da conversão',
  pagina: 'Página do banco convertido',
  paginaBytes: '{n} bytes',
  semPagina: 'Não definida',
  firebird5: 'Ensaio da versão 5',
  firebird5Aprovado: 'aprovado no registro dos passos',
  firebird5Pendente: 'ainda não aprovado no registro dos passos (a conversão parte dele)',
  aprovavel: 'Todas as etapas aprovadas: o ensaio pode ser registrado como aprovado no registro dos passos.',
  naoAprovavel:
    'Aprovadas {aprovadas} de {total} etapas; o ensaio ainda não pode ser registrado como aprovado.',
  registro: 'Registro dos passos',
  registrado: 'Registrado em {dia}: {resultado}',
  semRegistro: 'Sem registro do ensaio',
  resultados: { aprovado: 'aprovado', reprovado: 'reprovado' },
  colunas: { etapa: 'Etapa', situacao: 'Situação', achados: 'O que falta' },
  semAchados: 'Nada a corrigir',
  indices: 'Índices que pedem página maior',
  semIndices: 'Todos os índices com texto cabem na página atual.',
  indicesColunas: { nome: 'Índice', tabela: 'Tabela', chave: 'Chave em UTF-8', pagina: 'Página mínima' },
  chaveBytes: '{n} bytes',
  nenhumaPagina: 'nenhuma (o índice tem de mudar)',
  verTela: 'Ver o ensaio do UTF-8',
  resumoCartao: 'Ensaio do UTF-8: aprovadas {aprovadas} de {total} etapas',
  etapas,
  situacoes,
  bloqueios,
  achados,
};

/** O texto de um achado ("coluna-diferente:TABELA.COLUNA" → código e nome). */
export function chaveAchadoUtf8(a: string): { codigo: string; nome: string } {
  const i = a.indexOf(':');
  const codigo = i < 0 ? a : a.slice(0, i);
  const nome = i < 0 ? '' : a.slice(i + 1);
  return codigo in achados ? { codigo, nome } : { codigo: 'desconhecido', nome: a };
}
