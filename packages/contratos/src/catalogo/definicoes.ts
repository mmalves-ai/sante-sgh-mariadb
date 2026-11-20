// Catálogos oficiais e importadores (ficha do M13, seções 1, 5 e 7; cap-06a §6.2; cap-10 §10.8): a parte
// PÚBLICA de cada catálogo (código, título, entidades e campos no vocabulário do novo, quem aprova, se a
// carga depende de contrato de dados, como a edição é identificada). A parte física (tabelas e colunas do
// banco do estabelecimento) mora em @sgh/legado (`catalogo/declaracoes.ts`); a leitura dos arquivos oficiais,
// em @sgh/dominio-catalogo (`leiautes/`). Um responsável por catálogo de cada vez: a chave de funcionalidade
// `catalogo.<codigo>.responsavel` (ligada = o sistema novo carrega; desligada = a carga continua como hoje).

export const CODIGOS_CATALOGO = [
  'cid',
  'sigtap',
  'tuss',
  'cep',
  'cbo',
  'listas',
  'fiscal',
  'brasindice',
  'simpro',
  // M51 (etapa 4): os domínios dos leiautes do SIH e do SIA (catalogo.importarDominiosSus).
  'dominiosSus',
  // M56.7: os catálogos da ANS (operadora.importarCatalogoAns; D-IMPORT-56).
  'ans',
  // M48 (etapa 4): a lista nacional de notificação compulsória (catalogo.importarAgravos).
  'agravos',
  // M54.3: as tabelas de código e nome do SPED contábil (catalogo.importarSpedContabil).
  'spedContabil',
] as const;
export type CodigoCatalogo = (typeof CODIGOS_CATALOGO)[number];

export type TipoCampoCatalogo = 'texto' | 'inteiro' | 'decimal' | 'data' | 'letra';

export interface CampoCatalogo {
  readonly nome: string;
  readonly titulo: string;
  readonly tipo: TipoCampoCatalogo;
  /** Tamanho máximo (texto, em caracteres CP1252 = bytes). */
  readonly tamanho?: number;
  /** Campo da chave natural (código como texto, com zeros à esquerda). */
  readonly chave?: boolean;
  readonly obrigatorio?: boolean;
  /** Texto maior que o tamanho é cortado (com aviso), em vez de erro: o banco guarda só esse tamanho. */
  readonly truncar?: boolean;
}

export interface EntidadeCatalogo {
  readonly codigo: string;
  readonly titulo: string;
  readonly campos: readonly CampoCatalogo[];
  /**
   * Itens que nunca são alterados nem incluídos pelo importador (ex.: motivos de glosa locais 0 e 3095;
   * ref 01 §2.3): a comparação os mostra como "protegido".
   */
  readonly protegidos?: readonly string[];
  /** A entidade só recebe linhas novas (edição, competência ou vigência; nunca sobrescreve a passada). */
  readonly soInclusao?: boolean;
  /**
   * Toda edição publica os itens existentes do arquivo, mesmo iguais (SIGTAP: cada competência grava os valores
   * e o retrato da competência de cada procedimento).
   */
  readonly porEdicao?: boolean;
  /** Item novo da fonte não é incluído por esta carga (o motivo aparece na comparação). */
  readonly semInclusao?: string;
  /**
   * Códigos da chave que apontam para outra tabela do banco (ex.: o procedimento e o CID do par SIGTAP). O item
   * cujo código não existe no banco nem entra nesta carga (item novo publicado da entidade `nestaCarga`) não é
   * incluído: a comparação o mostra com o motivo, e o lote nunca é recusado por referência inexistente.
   */
  readonly referencias?: readonly ReferenciaCatalogo[];
  /**
   * A fonte é uma lista positiva (ex.: a lista nacional de notificação compulsória só traz os notificáveis): a chave
   * do banco que falta no arquivo "saiu da lista" e vira alteração publicada para estes valores (nunca exclusão). A
   * chave do banco que já tem estes valores não aparece como removida.
   */
  readonly naSaidaDaFonte?: Readonly<Record<string, string | number>>;
}

/** Tabelas do banco que os pares dos catálogos referenciam (leitura em @sgh/legado). */
export type TabelaReferenciaCatalogo =
  'procedimentoSigtap' | 'cid10' | 'cboSus' | 'grupoSipAns' | 'mesRecolhimentoTps';

export interface ReferenciaCatalogo {
  /** Campo da chave do item. */
  readonly campo: string;
  readonly tabela: TabelaReferenciaCatalogo;
  /** Nome do código no motivo mostrado à pessoa. */
  readonly titulo: string;
  /** Entidade desta mesma carga cujo item novo publicado satisfaz a referência (ex.: o CID-10 novo). */
  readonly nestaCarga?: string;
}

/** Quem aprova a publicação (ficha, seção 5: faturamento para preços e terminologias; administração, os demais). */
export type AprovadorCatalogo = 'faturamento' | 'administracao' | 'fiscal' | 'farmacia';
export const APROVADORES_CATALOGO: readonly AprovadorCatalogo[] = [
  'faturamento',
  'administracao',
  'fiscal',
  'farmacia',
];

/** Permissão da área que aprova a carga do catálogo (somada a `catalogo.carga.publicar`). */
export const permissaoAprovadorCatalogo = (a: AprovadorCatalogo): string => `catalogo.${a}.aprovar`;

/** Como a edição do arquivo é identificada (regra 4: edição passada nunca é sobrescrita). */
export type EdicaoCatalogo = 'competencia' | 'versao-tiss' | 'edicao' | 'nenhuma';

export interface DefinicaoCatalogo {
  readonly codigo: CodigoCatalogo;
  /** Operação de gravação do catálogo (docs/operacoes/catalogo). */
  readonly operacao: string;
  readonly titulo: string;
  readonly descricao: string;
  /** Rota da tela de consulta do catálogo. */
  readonly rota: string;
  readonly aprovador: AprovadorCatalogo;
  readonly edicao: EdicaoCatalogo;
  /** Só com contrato de dados vigente (DP-36): pré-requisito `contrato` da chave do responsável. */
  readonly exigeContrato: boolean;
  /** Arquivos aceitos (nome do arquivo oficial → leiaute). */
  readonly arquivos: readonly { readonly padrao: string; readonly descricao: string }[];
  readonly entidades: readonly EntidadeCatalogo[];
  /** Fonte oficial do arquivo (ADR 0024). */
  readonly fonte: string;
}

const t = (nome: string, titulo: string, tamanho: number, extra: Partial<CampoCatalogo> = {}) =>
  ({ nome, titulo, tipo: 'texto', tamanho, ...extra }) as const satisfies CampoCatalogo;
const i = (nome: string, titulo: string, extra: Partial<CampoCatalogo> = {}) =>
  ({ nome, titulo, tipo: 'inteiro', ...extra }) as const satisfies CampoCatalogo;
const d = (nome: string, titulo: string) =>
  ({ nome, titulo, tipo: 'decimal' }) as const satisfies CampoCatalogo;
const dt = (nome: string, titulo: string) =>
  ({ nome, titulo, tipo: 'data' }) as const satisfies CampoCatalogo;
const codigo = (tamanho: number, titulo = 'Código') =>
  t('codigo', titulo, tamanho, { chave: true, obrigatorio: true });

const FISCAIS: readonly [string, string][] = [
  ['cfop', 'CFOP'],
  ['itemServico', 'Itens da lista de serviços'],
  ['genero', 'Gêneros do item'],
  ['tipoDocumento', 'Tipos de documento fiscal'],
  ['cstCofins', 'CST da COFINS'],
  ['cstPis', 'CST do PIS'],
  ['naturezaCredito', 'Natureza do crédito (PIS/COFINS)'],
  ['indicadorOperacao', 'Indicador do tipo de operação'],
  ['naturezaRetencao', 'Natureza da retenção na fonte'],
  ['condicaoPj', 'Indicador da condição da pessoa jurídica'],
  ['naturezaReceita', 'Natureza da receita'],
  ['imunidadeIssqn', 'Imunidades do ISSQN'],
];

export const CATALOGOS: readonly DefinicaoCatalogo[] = [
  {
    codigo: 'cid',
    operacao: 'catalogo.importarCid',
    titulo: 'CID-10, CIAP e CID-O',
    descricao:
      'Classificação de doenças (CID-10), atenção primária (CIAP-2) e morfologia de tumores (CID-O).',
    rota: '/cadastros/catalogos/cid',
    aprovador: 'administracao',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: [
      { padrao: 'CID-10-SUBCATEGORIAS.CSV', descricao: 'CID-10 (DATASUS), subcategorias e categorias' },
      { padrao: 'CIAP2.CSV', descricao: 'CIAP-2 (código; título original; título leigo; sexo)' },
      { padrao: 'CID-O-MORFOLOGIA.CSV', descricao: 'CID-O: pares CID principal × morfologia' },
    ],
    entidades: [
      {
        codigo: 'cid10',
        titulo: 'CID-10',
        campos: [
          codigo(6),
          t('nome', 'Descrição', 270, { obrigatorio: true }),
          t('classificacao', 'Classificação', 1),
          t('sexo', 'Restrição de sexo', 1),
        ],
      },
      {
        codigo: 'ciap',
        titulo: 'CIAP-2',
        campos: [
          codigo(4),
          t('nomeOriginal', 'Título original', 100, { obrigatorio: true }),
          t('nomeLeigo', 'Título leigo', 100),
          t('sexo', 'Restrição de sexo', 1),
        ],
      },
      {
        codigo: 'cidMorfologia',
        titulo: 'CID-O (morfologia)',
        soInclusao: true,
        referencias: [
          { campo: 'cid', tabela: 'cid10', titulo: 'CID principal', nestaCarga: 'cid10' },
          { campo: 'morfologia', tabela: 'cid10', titulo: 'morfologia', nestaCarga: 'cid10' },
        ],
        campos: [
          t('cid', 'CID principal', 6, { chave: true, obrigatorio: true }),
          t('morfologia', 'Morfologia', 6, { chave: true, obrigatorio: true }),
        ],
      },
    ],
    fonte: 'DATASUS (CID-10 e CID-O) e SBMFC/WONCA (CIAP-2), obtidos pela TI do estabelecimento',
  },
  {
    codigo: 'sigtap',
    operacao: 'catalogo.importarSigtap',
    titulo: 'SIGTAP (tabela unificada do SUS)',
    descricao: 'Procedimentos, valores por competência e compatibilidades com CID e CBO.',
    rota: '/cadastros/catalogos/sigtap',
    aprovador: 'faturamento',
    edicao: 'competencia',
    exigeContrato: false,
    arquivos: [
      {
        padrao: 'tb_procedimento.txt',
        descricao: 'procedimentos da competência (leiaute DATASUS de posições fixas)',
      },
      { padrao: 'rl_procedimento_cid.txt', descricao: 'procedimento × CID' },
      { padrao: 'rl_procedimento_ocupacao.txt', descricao: 'procedimento × CBO' },
    ],
    entidades: [
      {
        codigo: 'procedimento',
        titulo: 'Procedimentos',
        porEdicao: true,
        semInclusao:
          'procedimento novo da tabela unificada entra pelo cadastro de procedimentos do estabelecimento (onda 4): a carga grava as competências dos procedimentos que já existem',
        campos: [
          codigo(10, 'Procedimento'),
          t('nome', 'Nome', 100, { obrigatorio: true, truncar: true }),
          t('complexidade', 'Complexidade', 1),
          t('sexo', 'Sexo', 1),
          i('quantidadeMaxima', 'Quantidade máxima'),
          i('permanencia', 'Dias de permanência'),
          i('pontos', 'Pontos'),
          i('idadeMinima', 'Idade mínima (meses)'),
          i('idadeMaxima', 'Idade máxima (meses)'),
          d('valorSh', 'Valor serviço hospitalar'),
          d('valorSa', 'Valor serviço ambulatorial'),
          d('valorSp', 'Valor serviço profissional'),
          t('financiamento', 'Financiamento', 2),
          i('tempoPermanencia', 'Tempo de permanência'),
        ],
      },
      {
        codigo: 'procedimentoCid',
        porEdicao: true,
        titulo: 'Procedimento × CID',
        referencias: [
          {
            campo: 'procedimento',
            tabela: 'procedimentoSigtap',
            titulo: 'procedimento',
            nestaCarga: 'procedimento',
          },
          { campo: 'cid', tabela: 'cid10', titulo: 'CID' },
        ],
        campos: [
          t('procedimento', 'Procedimento', 10, { chave: true, obrigatorio: true }),
          t('cid', 'CID', 6, { chave: true, obrigatorio: true }),
        ],
      },
      {
        codigo: 'procedimentoCbo',
        porEdicao: true,
        titulo: 'Procedimento × CBO',
        referencias: [
          {
            campo: 'procedimento',
            tabela: 'procedimentoSigtap',
            titulo: 'procedimento',
            nestaCarga: 'procedimento',
          },
          { campo: 'cbo', tabela: 'cboSus', titulo: 'CBO' },
        ],
        campos: [
          t('procedimento', 'Procedimento', 10, { chave: true, obrigatorio: true }),
          t('cbo', 'CBO', 6, { chave: true, obrigatorio: true }),
        ],
      },
    ],
    fonte: 'DATASUS, SIGTAP (arquivo da competência), obtido pela TI do estabelecimento',
  },
  {
    codigo: 'tuss',
    operacao: 'catalogo.importarTuss',
    titulo: 'TUSS e terminologias TISS',
    descricao:
      'Motivos de glosa (TUSS 38), CBO da ANS (TUSS 24) e materiais e medicamentos TUSS (tabela 100).',
    rota: '/cadastros/catalogos/tuss',
    aprovador: 'faturamento',
    edicao: 'versao-tiss',
    exigeContrato: false,
    arquivos: [
      { padrao: 'TUSS38*.csv', descricao: 'Terminologia 38 (mensagens e motivos de glosa)' },
      { padrao: 'TUSS24*.csv', descricao: 'Terminologia 24 (CBO)' },
      { padrao: 'TUSS19*.csv', descricao: 'Terminologias 19 e 20 (materiais e medicamentos)' },
    ],
    entidades: [
      {
        codigo: 'motivoGlosa',
        titulo: 'Motivos de glosa',
        protegidos: ['0', '3095'],
        campos: [
          codigo(4),
          t('nome', 'Termo', 4000, { obrigatorio: true }),
          dt('inicio', 'Início da vigência'),
          dt('fim', 'Fim da vigência'),
        ],
      },
      {
        codigo: 'cboAns',
        titulo: 'CBO da ANS',
        semInclusao:
          'CBO novo da ANS não é incluído: a ligação com as versões TISS é dado de sistema do banco; a carga atualiza os existentes',
        campos: [
          codigo(6),
          t('nome', 'Termo', 150, { obrigatorio: true }),
          dt('inicio', 'Início da vigência'),
          dt('fim', 'Fim da vigência'),
        ],
      },
      {
        codigo: 'materialTuss',
        titulo: 'Materiais e medicamentos TUSS',
        semInclusao:
          'item novo de materiais e medicamentos TUSS não é incluído: o item novo da tabela entra pelo cadastro de materiais e medicamentos; a carga atualiza os existentes',
        campos: [
          codigo(10),
          t('nome', 'Termo', 150, { obrigatorio: true }),
          t('registroAnvisa', 'Registro Anvisa', 15),
          t('referenciaFabricante', 'Referência do fabricante', 100),
        ],
      },
    ],
    fonte: 'ANS, terminologias TUSS (tabelas de domínio do padrão TISS), obtidas pela TI do estabelecimento',
  },
  {
    codigo: 'cep',
    operacao: 'catalogo.importarCep',
    titulo: 'Endereços (CEP e municípios)',
    descricao: 'Base de CEP (nas duas cópias que o banco mantém) e municípios do IBGE.',
    rota: '/cadastros/catalogos/enderecos',
    aprovador: 'administracao',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: [
      {
        padrao: '*.txt',
        descricao: 'base de CEP no leiaute de posições configurado em "Leiautes de importação (CEP)"',
      },
    ],
    entidades: [
      {
        codigo: 'cep',
        titulo: 'CEP',
        campos: [
          t('cep', 'CEP', 8, { chave: true, obrigatorio: true }),
          t('uf', 'UF', 2, { obrigatorio: true }),
          t('cidade', 'Cidade', 50, { obrigatorio: true }),
          t('logradouro', 'Logradouro', 80),
          t('bairro', 'Bairro', 60),
          t('tipoLogradouro', 'Tipo de logradouro', 40),
          t('ibge', 'Município (IBGE)', 7),
        ],
      },
      {
        codigo: 'municipio',
        titulo: 'Municípios (IBGE)',
        campos: [
          t('ibge', 'Código IBGE', 7, { chave: true, obrigatorio: true }),
          t('nome', 'Nome', 60, { obrigatorio: true }),
          t('uf', 'UF', 2, { obrigatorio: true }),
        ],
      },
    ],
    fonte:
      'Correios (base de CEP licenciada ao estabelecimento) e IBGE (municípios); a fonte em uso é confirmada com a TI (ADR 0024)',
  },
  {
    codigo: 'cbo',
    operacao: 'catalogo.importarCbo',
    titulo: 'CBO e ocupações',
    descricao: 'Classificação Brasileira de Ocupações (CBO 2002) e a tabela de ocupações do cadastro.',
    rota: '/cadastros/catalogos/cbo',
    aprovador: 'administracao',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: [
      { padrao: 'CBO2002 - Ocupacao.csv', descricao: 'CBO 2002 (código; título)' },
      { padrao: 'OCUPACOES.csv', descricao: 'ocupações do cadastro (código; nome)' },
    ],
    entidades: [
      { codigo: 'cbo', titulo: 'CBO', campos: [codigo(6), t('nome', 'Título', 150, { obrigatorio: true })] },
      {
        codigo: 'ocupacao',
        titulo: 'Ocupações',
        campos: [codigo(5), t('nome', 'Nome', 75, { obrigatorio: true })],
      },
    ],
    fonte: 'Ministério do Trabalho e Emprego (CBO 2002), obtido pela TI do estabelecimento',
  },
  {
    codigo: 'listas',
    operacao: 'catalogo.importarListasOficiais',
    titulo: 'DCB, fabricantes, bancos e atividades',
    descricao: 'Denominações Comuns Brasileiras, fabricantes, bancos e atividades econômicas.',
    rota: '/cadastros/catalogos/dcb',
    aprovador: 'administracao',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: [
      { padrao: 'DCB*.csv', descricao: 'lista DCB da Anvisa (número; denominação; CAS)' },
      { padrao: 'FABRICANTES*.csv', descricao: 'fabricantes (código; nome)' },
      { padrao: 'BANCOS*.csv', descricao: 'participantes do STR do Banco Central (código; nome)' },
      { padrao: 'ATIVIDADES*.csv', descricao: 'atividades econômicas (código; nome)' },
    ],
    entidades: [
      {
        codigo: 'dcb',
        titulo: 'DCB',
        campos: [codigo(6), t('nome', 'Denominação', 50, { obrigatorio: true }), t('cas', 'Número CAS', 26)],
      },
      {
        codigo: 'fabricante',
        titulo: 'Fabricantes',
        campos: [codigo(5), t('nome', 'Nome', 150, { obrigatorio: true })],
      },
      {
        codigo: 'banco',
        titulo: 'Bancos',
        campos: [codigo(3), t('nome', 'Nome', 50, { obrigatorio: true })],
      },
      {
        codigo: 'atividade',
        titulo: 'Atividades econômicas',
        campos: [codigo(5), t('nome', 'Nome', 80, { obrigatorio: true })],
      },
    ],
    fonte: 'Anvisa (DCB), Banco Central (STR) e fontes registradas no ADR 0024 (fabricantes e atividades)',
  },
  {
    codigo: 'fiscal',
    operacao: 'catalogo.importarFiscal',
    titulo: 'Tabelas fiscais e SPED',
    descricao: 'Tabelas do SPED e da legislação fiscal usadas na escrituração.',
    rota: '/financeiro/fiscal/tabelas',
    aprovador: 'fiscal',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: FISCAIS.map(([c, titulo]) => ({
      padrao: `${c}.txt`,
      descricao: `${titulo} (código|descrição|início|fim)`,
    })),
    entidades: FISCAIS.map(([c, titulo]) => ({
      codigo: c,
      titulo,
      ...(['indicadorOperacao', 'imunidadeIssqn'].includes(c)
        ? {
            semInclusao:
              'item novo desta tabela não é incluído (o identificador interno não tem gerador no banco); a carga atualiza os existentes',
          }
        : {}),
      campos: [
        codigo(6),
        t('nome', 'Descrição', 4000, { obrigatorio: true }),
        dt('inicio', 'Início da vigência'),
        dt('fim', 'Fim da vigência'),
      ],
    })),
    fonte: 'Receita Federal (tabelas do SPED, Portal do SPED), obtidas pela TI do estabelecimento',
  },
  {
    codigo: 'brasindice',
    operacao: 'catalogo.importarBrasindice',
    titulo: 'Brasíndice',
    descricao: 'Edição do Brasíndice: apresentações (tabela oficial 99) e preços PMC e PFB por edição.',
    rota: '/precos/matmed',
    aprovador: 'farmacia',
    edicao: 'edicao',
    exigeContrato: true,
    arquivos: [
      { padrao: 'BRASINDICE*.txt', descricao: 'arquivo da edição (leiaute do fornecedor, com contrato)' },
    ],
    entidades: [
      {
        codigo: 'apresentacao',
        titulo: 'Apresentações',
        campos: [
          codigo(10),
          t('nome', 'Nome', 150, { obrigatorio: true }),
          i('laboratorio', 'Laboratório'),
          d('pmc', 'Preço máximo ao consumidor'),
          d('pfb', 'Preço de fábrica'),
          i('classificacao', 'Classificação (1 material, 2 medicamento)'),
          t('apresentacao', 'Código da apresentação', 4),
          i('fator', 'Fator de conversão'),
          i('tuss', 'Código TUSS'),
        ],
      },
    ],
    fonte: 'Brasíndice (contrato de dados do estabelecimento; DP-36)',
  },
  {
    codigo: 'simpro',
    operacao: 'catalogo.importarSimpro',
    titulo: 'Simpro',
    descricao: 'Edição do Simpro: produtos (tabela oficial 98) e preços por edição.',
    rota: '/precos/matmed',
    aprovador: 'farmacia',
    edicao: 'edicao',
    exigeContrato: true,
    arquivos: [
      { padrao: 'SIMPRO*.txt', descricao: 'arquivo da edição (leiaute do fornecedor, com contrato)' },
    ],
    entidades: [
      {
        codigo: 'produto',
        titulo: 'Produtos',
        campos: [
          codigo(10),
          t('nome', 'Nome', 150, { obrigatorio: true }),
          d('valor', 'Preço'),
          i('classificacao', 'Classificação'),
          t('unidade', 'Unidade', 10),
          i('fabricante', 'Fabricante'),
          t('registroAnvisa', 'Registro Anvisa', 15),
          t('referenciaFabricante', 'Referência do fabricante', 100),
          t('identificacao', 'Identificação', 1),
          i('tuss', 'Código TUSS'),
        ],
      },
    ],
    fonte: 'Simpro (contrato de dados do estabelecimento; DP-36)',
  },
  // M51 (etapa 4): os domínios dos leiautes do SIH e do SIA (catalogo.importarDominiosSus; ficha do M51, seção 5): o
  // laudo de nefrologia da APAC (característica do tratamento, contraindicação e situação do transplante, acesso
  // vascular) e a AIH (tipos de UTI, classificação do diagnóstico, justificativa do paciente sem identificação). Carga
  // como a última do banco (INSERT do código novo e UPDATE do nome), completa e DESLIGADA (a chave do responsável).
  {
    codigo: 'dominiosSus',
    operacao: 'catalogo.importarDominiosSus',
    titulo: 'Domínios do SIH e do SIA',
    descricao:
      'Tabelas de código e nome dos leiautes do SIH e do SIA: tipos de UTI, classificação do diagnóstico, justificativa do paciente sem identificação e os domínios do laudo de nefrologia.',
    rota: '/faturamento/sus/cadastros/dominios',
    aprovador: 'faturamento',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: [
      { padrao: 'TIPOS_UTI*.csv', descricao: 'tipos de UTI do SIH (código; nome)' },
      { padrao: 'CLASSIFICACAO_DIAGNOSTICO*.csv', descricao: 'classificação do diagnóstico (código; nome)' },
      {
        padrao: 'JUSTIFICATIVA_SEM_IDENTIFICACAO*.csv',
        descricao: 'justificativa do paciente sem identificação (código; nome)',
      },
      { padrao: 'CARACTERISTICA_TRATAMENTO*.csv', descricao: 'característica do tratamento (código; nome)' },
      {
        padrao: 'CONTRAINDICACAO_TRANSPLANTE*.csv',
        descricao: 'contraindicação a transplante (código; nome)',
      },
      { padrao: 'SITUACAO_TRANSPLANTE*.csv', descricao: 'situação de transplante (código; nome)' },
      { padrao: 'ACESSO_VASCULAR*.csv', descricao: 'acesso vascular (código; nome)' },
    ],
    entidades: [
      {
        codigo: 'tipoUtiSih',
        titulo: 'Tipos de UTI',
        campos: [codigo(3), t('nome', 'Nome', 60, { obrigatorio: true })],
      },
      {
        codigo: 'classificacaoDiagnostico',
        titulo: 'Classificação do diagnóstico',
        campos: [codigo(3), t('nome', 'Nome', 40, { obrigatorio: true })],
      },
      {
        codigo: 'justificativaSemIdentificacao',
        titulo: 'Justificativa do paciente sem identificação',
        campos: [codigo(1), t('nome', 'Nome', 60, { obrigatorio: true })],
      },
      {
        codigo: 'caracteristicaTratamentoSia',
        titulo: 'Característica do tratamento',
        campos: [codigo(3), t('nome', 'Nome', 30, { obrigatorio: true })],
      },
      {
        codigo: 'contraindicacaoTransplanteSia',
        titulo: 'Contraindicação a transplante',
        campos: [codigo(3), t('nome', 'Nome', 70, { obrigatorio: true })],
      },
      {
        codigo: 'situacaoTransplanteSia',
        titulo: 'Situação de transplante',
        campos: [codigo(3), t('nome', 'Nome', 50, { obrigatorio: true })],
      },
      {
        codigo: 'acessoVascularSia',
        titulo: 'Acesso vascular',
        campos: [codigo(3), t('nome', 'Nome', 25, { obrigatorio: true })],
      },
    ],
    fonte:
      'Leiautes do SIH e do SIA do Ministério da Saúde (DATASUS), obtidos pelo faturamento do estabelecimento',
  },
  // M48 (etapa 4): a lista nacional de notificação compulsória (catalogo.importarAgravos; ficha do M48, seção 5): a
  // periodicidade da notificação no cadastro de CID (0 não notificável, 1 semanal, 2 imediata; o CID novo entra pela
  // carga do CID-10), os modelos de ficha do Sinan e as perguntas de cada ficha, como a última carga do banco (INSERT do
  // novo e UPDATE do existente; nunca apaga: o agravo que sai da lista volta a 0). Os tipos de notificação, de surto e de
  // periodicidade são dados de sistema (o gatilho do banco recusa toda gravação) e ficam em consulta. Completa e
  // DESLIGADA (a chave do responsável): a portaria vigente é a da DP-47.3 (GM/MS 11.211/2026 com a 10.175/2026).
  {
    codigo: 'agravos',
    operacao: 'catalogo.importarAgravos',
    titulo: 'Notificação compulsória (lista nacional)',
    descricao:
      'A lista nacional de doenças e agravos de notificação compulsória: a periodicidade de cada CID (imediata ou semanal), os modelos de ficha do Sinan e as perguntas de cada ficha.',
    rota: '/qualidade/vigilancia/agravos',
    aprovador: 'administracao',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: [
      {
        padrao: 'AGRAVOS_CID*.csv',
        descricao: 'periodicidade por CID (código; periodicidade: 0 não notificável, 1 semanal, 2 imediata)',
      },
      { padrao: 'AGRAVOS_FICHAS*.csv', descricao: 'modelos de ficha do Sinan (código; nome)' },
      {
        padrao: 'AGRAVOS_PERGUNTAS*.csv',
        descricao: 'perguntas das fichas (ficha; pergunta; subpergunta; nome)',
      },
    ],
    entidades: [
      {
        codigo: 'cidAgravo',
        titulo: 'Periodicidade da notificação por CID',
        campos: [codigo(6, 'CID'), i('periodicidade', 'Periodicidade (0, 1 ou 2)', { obrigatorio: true })],
        semInclusao:
          'O CID que não está no cadastro entra pela carga do CID-10; esta carga só muda a periodicidade da notificação.',
        // A lista traz só os notificáveis: o CID notificável no cadastro que falta no arquivo saiu da lista e volta a 0.
        naSaidaDaFonte: { periodicidade: 0 },
      },
      {
        codigo: 'fichaAgravo',
        titulo: 'Modelos de ficha do Sinan',
        campos: [codigo(9), t('nome', 'Nome', 30, { obrigatorio: true })],
      },
      {
        codigo: 'perguntaFichaAgravo',
        titulo: 'Perguntas das fichas',
        campos: [
          t('ficha', 'Ficha', 9, { chave: true, obrigatorio: true }),
          t('pergunta', 'Pergunta', 4, { chave: true, obrigatorio: true }),
          t('subpergunta', 'Subpergunta', 2, { chave: true, obrigatorio: true }),
          t('nome', 'Texto da pergunta', 255, { obrigatorio: true, truncar: true }),
        ],
      },
    ],
    fonte:
      'Lista nacional de notificação compulsória (Ministério da Saúde, portaria vigente pela DP-47.3) e as fichas do Sinan, obtidas pela vigilância epidemiológica',
  },
  {
    // Catálogos da ANS (ficha do M56, seções 5 e 9; D-IMPORT-56): só as 7 tabelas de referência sem gatilho de
    // recusa. As outras 7 de vigência da ANS ficam em consulta (uma vigência nova, se publicada, vai para SGH_OPE_*).
    codigo: 'ans',
    operacao: 'operadora.importarCatalogoAns',
    titulo: 'Catálogos da ANS',
    descricao:
      'Grupos de eventos e procedimentos do SIP, classificação de procedimentos, valores da TPS e os domínios da rede credenciada e da remuneração.',
    rota: '/operadora/ans',
    aprovador: 'faturamento',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: [
      { padrao: 'SIP_GRUPOS*.csv', descricao: 'grupos de eventos do SIP (código; nome)' },
      {
        padrao: 'SIP_PROCEDIMENTOS*.csv',
        descricao: 'procedimentos por grupo do SIP (procedimento; grupo; início; fim da vigência)',
      },
      {
        padrao: 'CLASSIFICACAO_PROCEDIMENTOS*.csv',
        descricao: 'classificação de procedimentos (código; nome)',
      },
      {
        padrao: 'TPS*.csv',
        descricao: 'valores da TPS (vigência; mês de recolhimento; ano; valor anual; valor trimestral)',
      },
      { padrao: 'CLASSIFICACAO_PRESTADOR*.csv', descricao: 'classificação do prestador (código; nome)' },
      { padrao: 'DISPONIBILIDADE*.csv', descricao: 'disponibilidade do serviço (código; nome)' },
      {
        padrao: 'REMUNERACAO*.csv',
        descricao: 'modelos de remuneração do prestador (código; nome; início; fim da vigência)',
      },
    ],
    entidades: [
      {
        codigo: 'grupoSip',
        titulo: 'Grupos de eventos do SIP',
        campos: [codigo(3), t('nome', 'Nome', 60, { obrigatorio: true })],
      },
      {
        codigo: 'procedimentoSip',
        titulo: 'Procedimentos por grupo do SIP',
        campos: [
          t('procedimento', 'Procedimento', 10, { chave: true, obrigatorio: true }),
          t('grupo', 'Grupo do SIP', 3, { chave: true, obrigatorio: true }),
          t('inicio', 'Início da vigência', 10, { chave: true, obrigatorio: true }),
          dt('fim', 'Fim da vigência'),
        ],
        referencias: [
          { campo: 'grupo', tabela: 'grupoSipAns', titulo: 'grupo do SIP', nestaCarga: 'grupoSip' },
        ],
      },
      {
        codigo: 'classificacaoProcedimentoAns',
        titulo: 'Classificação de procedimentos',
        campos: [codigo(10), t('nome', 'Nome', 80, { obrigatorio: true })],
      },
      {
        codigo: 'valorTps',
        titulo: 'Valores da TPS',
        soInclusao: true,
        campos: [
          t('inicio', 'Início da vigência', 10, { chave: true, obrigatorio: true }),
          t('mes', 'Mês de recolhimento', 1, { obrigatorio: true }),
          i('ano', 'Ano de recolhimento', { obrigatorio: true }),
          d('valorAnual', 'Valor anual'),
          d('valorTrimestral', 'Valor trimestral'),
        ],
        referencias: [{ campo: 'mes', tabela: 'mesRecolhimentoTps', titulo: 'mês de recolhimento' }],
      },
      {
        codigo: 'classificacaoPrestador',
        titulo: 'Classificação do prestador',
        campos: [codigo(5), t('nome', 'Nome', 40, { obrigatorio: true, truncar: true })],
      },
      {
        codigo: 'disponibilidadeServico',
        titulo: 'Disponibilidade do serviço',
        campos: [codigo(5), t('nome', 'Nome', 20, { obrigatorio: true, truncar: true })],
      },
      {
        codigo: 'remuneracaoPrestador',
        titulo: 'Modelos de remuneração',
        campos: [
          codigo(10),
          t('nome', 'Nome', 50, { obrigatorio: true }),
          dt('inicio', 'Início da vigência'),
          dt('fim', 'Fim da vigência'),
        ],
      },
    ],
    fonte: 'ANS (tabelas do SIP, da TPS e do padrão TISS), obtidas pelo responsável pelos envios à ANS',
  },
  // M54.3 (etapa F3): as tabelas de código e nome do SPED contábil (catalogo.importarSpedContabil; ficha do M54, seção
  // 5: as carga-referencia pelo importador do M13, com nova versão a cada carga). Os quatro indicadores do leiaute
  // (tipo de item, natureza da pessoa jurídica, situação especial e atividade preponderante) só recebem a alteração do
  // nome pelo código oficial: o ID é interno, sem gerador e diferente do código (a inclusão pediria MAX+1). O tipo de
  // plano referencial (código "10" duas vezes), os tipos de documento (código repetido) e os motivos da substituta
  // (gatilho que recusa gravação) ficam em consulta. Completa e DESLIGADA (a chave do responsável).
  {
    codigo: 'spedContabil',
    operacao: 'catalogo.importarSpedContabil',
    titulo: 'Tabelas do SPED contábil',
    descricao:
      'Tabelas de código e nome dos leiautes da escrituração contábil e fiscal: tipo de item, natureza da pessoa jurídica, situação especial e atividade preponderante.',
    rota: '/contabil/sped/tabelas',
    aprovador: 'fiscal',
    edicao: 'nenhuma',
    exigeContrato: false,
    arquivos: [
      { padrao: 'TIPO_ITEM*.csv', descricao: 'tipos de item (código; nome)' },
      { padrao: 'NATUREZA_PJ*.csv', descricao: 'natureza da pessoa jurídica (código; nome)' },
      { padrao: 'SITUACAO_ESPECIAL*.csv', descricao: 'situação especial (código; nome)' },
      { padrao: 'ATIVIDADE_PREPONDERANTE*.csv', descricao: 'atividade preponderante (código; nome)' },
    ],
    entidades: [
      {
        codigo: 'tipoItemSped',
        titulo: 'Tipos de item',
        campos: [codigo(2), t('nome', 'Nome', 80, { obrigatorio: true })],
      },
      {
        codigo: 'naturezaPjSped',
        titulo: 'Natureza da pessoa jurídica',
        campos: [codigo(1), t('nome', 'Nome', 80, { obrigatorio: true })],
      },
      {
        codigo: 'situacaoEspecialSped',
        titulo: 'Situação especial',
        campos: [codigo(1), t('nome', 'Nome', 25, { obrigatorio: true })],
      },
      {
        codigo: 'atividadePreponderanteSped',
        titulo: 'Atividade preponderante',
        campos: [codigo(1), t('nome', 'Nome', 90, { obrigatorio: true })],
      },
    ],
    fonte: 'Manuais de orientação do leiaute da ECD e da ECF (Receita Federal), obtidos pela controladoria',
  },
];

export function definicaoCatalogo(codigo: string): DefinicaoCatalogo | null {
  return CATALOGOS.find((c) => c.codigo === codigo) ?? null;
}

/** Chave de funcionalidade que diz quem carrega o catálogo (ligada = o sistema novo). */
export const chaveResponsavelCatalogo = (codigo: CodigoCatalogo): string => `catalogo.${codigo}.responsavel`;

/** Situações da carga (SGH_CAT_CARGA; scripts 0122 e 0140). */
export const SITUACOES_CARGA_CATALOGO = [
  'preparada',
  'validada',
  'comparada',
  'aprovada',
  'publicando',
  'publicada',
  'rejeitada',
  'cancelada',
  'falhou',
] as const;
export type SituacaoCargaCatalogo = (typeof SITUACOES_CARGA_CATALOGO)[number];

export const COMPARACOES_LINHA = ['novo', 'removido', 'alterado', 'igual'] as const;
export type ComparacaoLinha = (typeof COMPARACOES_LINHA)[number];
