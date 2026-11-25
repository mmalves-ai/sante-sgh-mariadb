// M60, etapa 2 (entregas 3 e 5, anexo "variáveis"): o catálogo das variáveis do arquivo de ambiente do servidor
// (`/etc/sante-sgh/sante.env`). A lista é conferida contra o REPOSITÓRIO (`varrerChaves`): toda chave que a API, o
// worker ou os pacotes leem tem de estar aqui, com descrição e uso em produção, ou na lista das que não vão para o
// servidor (dev, teste, ferramenta), com o motivo. Variável nova num marco seguinte sem entrada aqui reprova o
// `instalacao:gerar -- --conferir`; o modelo e o anexo nunca desatualizam.

export type GrupoVariavel =
  | 'produto'
  | 'banco'
  | 'servicos'
  | 'seguranca'
  | 'email'
  | 'armazenamento'
  | 'integracoes'
  | 'rotinas'
  | 'observabilidade'
  | 'caminhos';

/**
 * - obrigatoria: sem ela a instalação de produção é recusada pela conferência;
 * - recomendada: tem padrão seguro, mas o hospital deve decidir o valor;
 * - opcional: o padrão serve; muda só quando o manual manda.
 */
export type UsoVariavel = 'obrigatoria' | 'recomendada' | 'opcional';

export interface Variavel {
  readonly chave: string;
  readonly grupo: GrupoVariavel;
  readonly descricao: string;
  readonly uso: UsoVariavel;
  readonly segredo?: boolean;
  /** Valor do modelo (para segredo, o marcador; nunca um segredo real). */
  readonly exemplo: string;
  /** Como gerar o segredo (comando no servidor). */
  readonly comoGerar?: string;
  /** Valores aceitos (conferidos no arquivo do servidor). */
  readonly valores?: readonly string[];
}

export const GRUPOS: readonly { grupo: GrupoVariavel; titulo: string }[] = [
  { grupo: 'produto', titulo: 'Produto, rede e endereços' },
  { grupo: 'banco', titulo: 'Banco de cada estabelecimento e conexões' },
  { grupo: 'servicos', titulo: 'Serviços do servidor (portas, fila, documentos)' },
  { grupo: 'seguranca', titulo: 'Segurança, chaves e sessão' },
  { grupo: 'email', titulo: 'E-mail e destinatários de aviso' },
  { grupo: 'armazenamento', titulo: 'Armazenamento de arquivos (disco da máquina, ADR 0004)' },
  { grupo: 'integracoes', titulo: 'Integrações externas' },
  { grupo: 'rotinas', titulo: 'Rotinas do worker (ligar, desligar, intervalos)' },
  { grupo: 'observabilidade', titulo: 'Observabilidade e sondas' },
  { grupo: 'caminhos', titulo: 'Caminhos de dados do pacote' },
];

/** Marcador dos segredos no modelo: a conferência recusa o arquivo que ainda o tenha. */
export const MARCADOR_SEGREDO = '<gerar>';
/** Marcador de valor a preencher pelo hospital. */
export const MARCADOR_PREENCHER = '<preencher>';

const GERAR_32 = 'openssl rand -base64 32';
const GERAR_TOKEN = 'openssl rand -hex 32';
const LIG = ['ligado', 'desligado'] as const;

const v = (
  chave: string,
  grupo: GrupoVariavel,
  uso: UsoVariavel,
  exemplo: string,
  descricao: string,
  extra: Partial<Pick<Variavel, 'segredo' | 'comoGerar' | 'valores'>> = {},
): Variavel => ({ chave, grupo, uso, exemplo, descricao, ...extra });

/** Variáveis por estabelecimento: `FB_<COD>_<CAMPO>`, uma série por código de ESTABELECIMENTOS. */
export const CAMPOS_ESTABELECIMENTO: readonly {
  campo: string;
  descricao: string;
  uso: UsoVariavel;
  segredo?: boolean;
  exemplo: string;
}[] = [
  {
    campo: 'NOME',
    uso: 'obrigatoria',
    exemplo: MARCADOR_PREENCHER,
    descricao: 'Nome de exibição do estabelecimento.',
  },
  {
    campo: 'HOST',
    uso: 'obrigatoria',
    exemplo: MARCADOR_PREENCHER,
    descricao: 'Servidor do banco (nome ou endereço; com túnel, 127.0.0.1 e a porta local do túnel).',
  },
  {
    campo: 'PORTA',
    uso: 'obrigatoria',
    exemplo: '3050',
    descricao: 'Porta do Firebird (ou a porta local do túnel).',
  },
  {
    campo: 'BANCO',
    uso: 'obrigatoria',
    exemplo: MARCADOR_PREENCHER,
    descricao: 'Caminho do banco no servidor do banco, ou o apelido do databases.conf.',
  },
  {
    campo: 'USUARIO',
    uso: 'obrigatoria',
    exemplo: 'SGH_APP',
    descricao: 'Conta da APLICAÇÃO, com o papel SGH_APLICACAO (nunca SYSDBA).',
  },
  {
    campo: 'SENHA',
    uso: 'obrigatoria',
    segredo: true,
    exemplo: MARCADOR_SEGREDO,
    descricao: 'Senha da conta da aplicação.',
  },
  {
    campo: 'SCRIPTS_USUARIO',
    uso: 'obrigatoria',
    exemplo: 'SGH_SCRIPTS',
    descricao: 'Conta de SCRIPTS, dona dos objetos SGH_ (só a migração a usa).',
  },
  {
    campo: 'SCRIPTS_SENHA',
    uso: 'obrigatoria',
    segredo: true,
    exemplo: MARCADOR_SEGREDO,
    descricao:
      'Senha da conta de scripts (pode ficar fora do arquivo e ser informada só na hora da migração).',
  },
  {
    campo: 'LEITURA_USUARIO',
    uso: 'obrigatoria',
    exemplo: 'SGH_LEITURA',
    descricao: 'Conta de LEITURA, para a simulação da migração e a fumaça pós-implantação.',
  },
  {
    campo: 'LEITURA_SENHA',
    uso: 'obrigatoria',
    segredo: true,
    exemplo: MARCADOR_SEGREDO,
    descricao: 'Senha da conta de leitura.',
  },
];

export const VARIAVEIS: readonly Variavel[] = [
  // Produto, rede e endereços
  v('AMBIENTE', 'produto', 'obrigatoria', 'producao', 'Ambiente da instalação.', {
    valores: ['producao', 'homolog', 'treino'],
  }),
  v(
    'PRODUTO_NOME',
    'produto',
    'obrigatoria',
    MARCADOR_PREENCHER,
    'Nome do produto exibido nas telas e documentos (DP-49).',
  ),
  v(
    'MARCA',
    'produto',
    'recomendada',
    MARCADOR_PREENCHER,
    'Código do pacote de marca da rede nos documentos e e-mails (letras minúsculas, dígitos e hífen; padrão: rede-sante).',
  ),
  v(
    'REDE_PADRAO',
    'produto',
    'obrigatoria',
    MARCADOR_PREENCHER,
    'Código da rede (minúsculas, dígitos e hífen).',
  ),
  v(
    'DOMINIO_BASE',
    'produto',
    'obrigatoria',
    MARCADOR_PREENCHER,
    'Domínio base: a rede é resolvida pelo endereço de acesso.',
  ),
  v(
    'REDE_ENDERECOS',
    'produto',
    'opcional',
    '',
    'Nome do servidor ligado à rede, nome=rede (vários com ;); o do --dominio, salvo <rede>.<DOMINIO_BASE>.',
  ),
  v(
    'WEB_ENDERECO',
    'produto',
    'obrigatoria',
    MARCADOR_PREENCHER,
    'Endereço público https das telas (links dos e-mails).',
  ),
  v(
    'PORTAL_ENDERECO',
    'produto',
    'opcional',
    '',
    'Endereço público do portal do paciente, se diferente do das telas.',
  ),
  v(
    'DOCUMENTO_URL_VALIDACAO',
    'produto',
    'obrigatoria',
    MARCADOR_PREENCHER,
    'Endereço https do verificador público dos documentos.',
  ),
  v('BI_ENDERECO', 'produto', 'opcional', '', 'Endereço do BI externo, quando houver.'),
  v(
    'ESTABELECIMENTOS',
    'banco',
    'obrigatoria',
    'pc',
    'Códigos dos estabelecimentos deste servidor, separados por vírgula.',
  ),
  v(
    'REDE_MPI_ESTABELECIMENTOS',
    'banco',
    'opcional',
    '',
    'Estabelecimentos que entram no índice de pacientes da rede.',
  ),
  // Banco
  // Serviços
  v(
    'API_PORTA',
    'servicos',
    'opcional',
    '3300',
    'Porta local da API (só 127.0.0.1; o nginx encaminha /api). Fixada pelo pacote: só vazia ou 3300.',
  ),
  v(
    'VALKEY_URL',
    'servicos',
    'obrigatoria',
    'redis://127.0.0.1:6379',
    'Fila e cache (Valkey local do servidor).',
  ),
  v(
    'FILAS_PREFIXO',
    'servicos',
    'opcional',
    '',
    'Prefixo das filas (só quando dois ambientes dividem o Valkey).',
  ),
  v('GOTENBERG_URL', 'servicos', 'recomendada', 'http://127.0.0.1:3000', 'Conversor de documentos para PDF.'),
  v('WORKER_SERVICOS', 'servicos', 'opcional', '', 'Lista dos serviços do worker (vazio: todos).'),
  v('WORKER_SINAL_MS', 'servicos', 'opcional', '', 'Intervalo do sinal de vida do worker, em ms.'),
  v(
    'WORKER_CLIENTES',
    'servicos',
    'opcional',
    '',
    'Clientes atendidos pelos ciclos do worker, separados por vírgula (vazio: os clientes em uso na plataforma).',
  ),
  v('LOG_NIVEL', 'servicos', 'opcional', 'info', 'Nível dos logs.', {
    valores: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
  }),
  v(
    'TZ',
    'servicos',
    'obrigatoria',
    'UTC',
    'Fuso dos processos: sempre UTC (o banco guarda a hora local e o sistema converte; as telas mostram a hora de Brasília).',
    { valores: ['UTC'] },
  ),
  // Segurança
  v(
    'PLATAFORMA_CHAVE_MESTRA',
    'seguranca',
    'obrigatoria',
    MARCADOR_SEGREDO,
    'Chave mestra (32 bytes em base64): segundo fator, selos e cifras.',
    {
      segredo: true,
      comoGerar: GERAR_32,
    },
  ),
  v(
    'ACESSO_CHAVE_MESTRA',
    'seguranca',
    'opcional',
    '',
    'Chave própria do envelope da credencial forte e do segundo fator do login (32 bytes em base64; padrão: a mestra). Nunca troque depois do uso.',
    {
      segredo: true,
      comoGerar: GERAR_32,
    },
  ),
  v(
    'PORTAL_CHAVE_MESTRA',
    'seguranca',
    'opcional',
    '',
    'Chave própria do portal (32 bytes em base64; padrão: a mestra).',
    {
      segredo: true,
      comoGerar: GERAR_32,
    },
  ),
  v(
    'PESSOAS_CHAVE_CPF',
    'seguranca',
    'recomendada',
    MARCADOR_SEGREDO,
    'Chave da cifra do CPF dos colaboradores (padrão: a mestra). Nunca troque depois do uso.',
    {
      segredo: true,
      comoGerar: GERAR_32,
    },
  ),
  v('PLATAFORMA_EM_NOME_DE', 'seguranca', 'opcional', '', 'Rótulo do atendimento da plataforma na trilha.'),
  v(
    'ACESSO_BLOQUEIO_PORTA_MINUTOS',
    'seguranca',
    'opcional',
    '',
    'Minutos de bloqueio após tentativas de login erradas.',
  ),
  v('ACESSO_EMERGENCIA_MINUTOS', 'seguranca', 'opcional', '', 'Duração do acesso de emergência, em minutos.'),
  v('SUPORTE_SESSAO_MINUTOS', 'seguranca', 'opcional', '', 'Duração da sessão de suporte, em minutos.'),
  v(
    'SUPORTE_AVISO_AUDITOR',
    'seguranca',
    'opcional',
    '',
    'nao: desliga o aviso ao auditor nas sessões de suporte.',
    { valores: ['', 'sim', 'nao'] },
  ),
  v('TRILHA_ESTACAO', 'seguranca', 'opcional', '', 'Como a estação entra na trilha.'),
  v(
    'COFRE_DIR',
    'seguranca',
    'opcional',
    '/var/lib/sante-sgh/cofre',
    'Pasta do cofre dos certificados (0700, dono o usuário do serviço).',
  ),
  v('QZ_CERTIFICADO_ARQUIVO', 'seguranca', 'opcional', '', 'Certificado da impressão local (QZ Tray).'),
  v(
    'QZ_CHAVE_PRIVADA_ARQUIVO',
    'seguranca',
    'opcional',
    '',
    'Chave privada da impressão local (arquivo 0600).',
  ),
  // E-mail
  v(
    'SMTP_URL',
    'email',
    'obrigatoria',
    MARCADOR_SEGREDO,
    'Servidor de e-mail (smtps://conta:senha@host:465).',
    { segredo: true },
  ),
  v('EMAIL_REMETENTE', 'email', 'obrigatoria', MARCADOR_PREENCHER, 'Remetente dos e-mails do sistema.'),
  v('AUDITORIA_EMAIL', 'email', 'recomendada', MARCADOR_PREENCHER, 'Destino dos avisos de auditoria.'),
  v(
    'ALERTA_RELATORIO_EMAIL',
    'email',
    'opcional',
    '',
    'Destino do alerta quando o dono do relatório não tem e-mail.',
  ),
  // Armazenamento
  v(
    'ARQUIVOS_RAIZ',
    'armazenamento',
    'obrigatoria',
    MARCADOR_PREENCHER,
    'Pasta absoluta dos arquivos (uma subpasta por banco de cliente), no disco da máquina; ex.: /srv/sante-sgh/arquivos. Cópia de segurança pela hospedagem (snapshot do volume ou backup do cliente).',
  ),
  v(
    'ARQUIVOS_ALERTA_LIVRE_GB',
    'armazenamento',
    'opcional',
    '20',
    'Alerta (instalação e vigia do worker) quando o espaço livre da pasta de arquivos fica abaixo deste valor, em GB.',
  ),
  v('DOCUMENTO_RETENCAO_DIAS', 'armazenamento', 'opcional', '', 'Dias de retenção dos documentos de prova.'),
  v('VIGIA_ARQUIVOS', 'rotinas', 'opcional', '', 'Vigia de integridade dos arquivos (hash x registro).', {
    valores: ['', 'desligado'],
  }),
  v('VIGIA_ARQUIVOS_MS', 'rotinas', 'opcional', '', 'Intervalo do vigia dos arquivos, em ms (padrão 6 h).'),
  // Integrações
  v('OIE_URL', 'integracoes', 'opcional', '', 'Motor de integração (HL7) do hospital.'),
  v('OIE_MLLP_HOST', 'integracoes', 'opcional', '', 'Servidor MLLP do motor de integração.'),
  v(
    'ASSINATURA_ICP_MODO',
    'integracoes',
    'recomendada',
    '',
    'Modo da assinatura ICP-Brasil (vazio: desligada com motivo).',
  ),
  v('ASSINATURA_ACT_URL', 'integracoes', 'opcional', '', 'Carimbo do tempo (ACT).'),
  v('ASSINATURA_AGENTE_LOCAL_URL', 'integracoes', 'opcional', '', 'Agente local de assinatura das estações.'),
  v('ASSINATURA_RETORNO_URL', 'integracoes', 'opcional', '', 'Retorno da assinatura em nuvem.'),
  v('ASSINATURA_POLITICA_AD_RB', 'integracoes', 'opcional', '', 'Política AD-RB da assinatura.'),
  v('ASSINATURA_POLITICA_AD_RT', 'integracoes', 'opcional', '', 'Política AD-RT da assinatura.'),
  v('ASSINATURA_REPROCESSAR', 'integracoes', 'opcional', '', 'Reprocessamento das assinaturas pendentes.', {
    valores: ['', ...LIG],
  }),
  v(
    'ASSINATURA_REPROCESSAR_MS',
    'integracoes',
    'opcional',
    '',
    'Intervalo do reprocessamento das assinaturas, em ms.',
  ),
  v('ICP_RAIZES_DIR', 'integracoes', 'opcional', '', 'Pasta das raízes ICP-Brasil.'),
  v('ICP_INTERMEDIARIAS_DIR', 'integracoes', 'opcional', '', 'Pasta das intermediárias ICP-Brasil.'),
  v('PACS_MODO', 'integracoes', 'opcional', '', 'Modo do PACS (vazio: desligado com motivo).'),
  v(
    'PORTAL_PAGAMENTO_MODO',
    'integracoes',
    'opcional',
    '',
    'Modo do pagamento no portal (vazio: desligado).',
  ),
  v(
    'TELECONSULTA_PROVEDOR_MODO',
    'integracoes',
    'opcional',
    '',
    'Provedor da teleconsulta (vazio: desligado).',
  ),
  v(
    'RNDS_HOMOLOGACAO_AUTORIZADA',
    'integracoes',
    'opcional',
    '',
    'sim: autoriza o envio à RNDS de homologação.',
  ),
  v(
    'RNDS_CERTIFICADO_PFX',
    'integracoes',
    'opcional',
    '',
    'Certificado ICP-Brasil (e-CNPJ A1) do estabelecimento para a RNDS; vazio: o RIA não sai para a homologação nem para a produção (dev e ci usam sempre o simulador).',
  ),
  v('TISS_XSD_PASTA', 'integracoes', 'opcional', '', 'Pasta do XSD da TISS (padrão: o do pacote).'),
  v(
    'ESOCIAL_XSD_PASTA',
    'integracoes',
    'opcional',
    '',
    'Pasta dos XSD do eSocial, uma subpasta por leiaute (padrão: o do pacote).',
  ),
  // M53.6: o transmissor real do eSocial (só em producao; desligado por padrão, POL-3).
  v(
    'ESOCIAL_MODO',
    'integracoes',
    'opcional',
    '',
    'producao: envia os lotes ao serviço do eSocial (só com AMBIENTE=producao e o certificado); vazio ou coletor: coletor local.',
  ),
  v(
    'ESOCIAL_CERTIFICADO_ARQUIVO',
    'integracoes',
    'opcional',
    '',
    'Certificado e-CNPJ (A1) do transmissor do eSocial em PEM, no cofre (convertido do .pfx na implantação).',
  ),
  v(
    'ESOCIAL_CHAVE_ARQUIVO',
    'integracoes',
    'opcional',
    '',
    'Chave privada do certificado do eSocial em PEM (arquivo 0600, no cofre).',
  ),
  v('ESOCIAL_CHAVE_SENHA', 'integracoes', 'opcional', '', 'Senha da chave do certificado do eSocial.', {
    segredo: true,
  }),
  v(
    'ESOCIAL_ENVIO_URL',
    'integracoes',
    'opcional',
    '',
    'Endereço do serviço de envio do eSocial (padrão: o oficial de produção).',
  ),
  v(
    'ESOCIAL_CONSULTA_URL',
    'integracoes',
    'opcional',
    '',
    'Endereço do serviço de consulta do eSocial (padrão: o oficial de produção).',
  ),
  // Rotinas
  ...(
    [
      ['OUTBOX_RELAY', 'Envio da caixa de saída (e-mails, avisos e integrações).'],
      ['INTEGRACAO', 'Integrações de saída do worker.'],
      ['VIGIA_BANCO', 'Vigia do banco (transações, travas e conexões; desligado desliga).'],
      ['RELATORIO_ENVIO', 'Envio agendado de relatórios.'],
      ['RELATORIO_ENVIO_VENCIDOS', 'Envio dos relatórios agendados vencidos ao subir.'],
      ['BUSCA_VIGIA', 'Índice de busca de pacientes.'],
      ['CATALOGO_PUBLICADOR', 'Publicação dos catálogos.'],
      ['CENSO_FECHAMENTO', 'Fechamento diário do censo.'],
      ['CLASSIFICACAO_ESTOURO', 'Aviso de estouro do tempo da classificação de risco.'],
      ['CONTABIL_LEITURA', 'Leitura dos fatos contábeis dos módulos.'],
      [
        'CONTABIL_CONTABILIZAR',
        'Contabilização dos fatos lidos em lançamentos automáticos (desligado: só lê).',
      ],
      ['CONTINGENCIA_POR_HORA', 'Folha de contingência da enfermagem por hora.'],
      ['NIR_EXPIRACAO', 'Expiração das reservas de leito.'],
      ['PACS_WORKLIST', 'Lista de trabalho do PACS.'],
      ['PESSOAS_CONSELHO_DIARIO', 'Conferência diária dos conselhos profissionais.'],
      ['CONTRATOS_ALERTA_DIARIO', 'Alerta diário de vencimento dos contratos com fornecedores.'],
      ['REDE_MPI_NOTURNO', 'Carga noturna do índice de pacientes da rede.'],
      ['ENFERMAGEM_VIGIA', 'Vigia dos horários da enfermagem.'],
      [
        'ENFERMAGEM_VIGIA_CONTENCAO',
        'Vigia da contenção mecânica vencida (aviso ao prescritor; "nao" desliga).',
      ],
      ['SADT_VIGIA_CRITICOS', 'Vigia dos resultados críticos.'],
      [
        'ACESSO_CONTAS_DORMENTES_DESPERTAR',
        'Despertar diário das contas dormentes (sim liga em dev/ci; nao desliga).',
      ],
      ['PORTAL_VIGENCIA', 'Vigência dos acessos ao portal.'],
    ] as const
  ).map(([k, d]) => v(k, 'rotinas', 'opcional', '', `${d} Vazio: o padrão do ambiente.`)),
  ...(
    [
      ['VIGIA_MUDANCAS_MS', 'vigia de mudanças das telas ao vivo'],
      ['VIGIA_BANCO_MS', 'vigia do banco'],
      ['VIGIA_TRANSACAO_LIMITE_MS', 'limite da transação longa no vigia do banco'],
      ['OUTBOX_INTERVALO_MS', 'caixa de saída'],
      ['INTEGRACAO_INTERVALO_MS', 'integrações'],
      ['INTEGRACAO_LOTE_FATOS', 'lote das integrações (fatos por ciclo)'],
      ['BUSCA_VIGIA_MS', 'índice de busca'],
      ['CATALOGO_PUBLICADOR_MS', 'publicação dos catálogos'],
      ['CATALOGO_LOTES_POR_CICLO', 'lotes de catálogo por ciclo'],
      ['CATALOGO_JANELA_PUBLICACAO', 'janela de publicação dos catálogos'],
      ['CONTABIL_JANELA_LEITURA', 'janela da leitura dos fatos contábeis'],
      ['PORTAL_VIGENCIA_MS', 'vigência dos acessos ao portal'],
      ['BUSCA_CONFERENCIA_MS', 'conferência do índice de busca'],
      ['RELATORIO_ENVIO_INTERVALO_MS', 'envio agendado de relatórios'],
    ] as const
  ).map(([k, d]) => v(k, 'rotinas', 'opcional', '', `Intervalo ou tamanho: ${d}. Vazio: o padrão.`)),
  // Observabilidade
  v('OTEL_EXPORTER_URL', 'observabilidade', 'recomendada', '', 'Coletor OpenTelemetry (métricas e rastros).'),
  v('OTEL_INTERVALO_MS', 'observabilidade', 'opcional', '', 'Intervalo de exportação das métricas, em ms.'),
  v(
    'SONDA_TOKEN',
    'observabilidade',
    'obrigatoria',
    MARCADOR_SEGREDO,
    'Segredo das sondas de implantação (32+ caracteres).',
    {
      segredo: true,
      comoGerar: GERAR_TOKEN,
    },
  ),
  v(
    'SONDA_LOGIN',
    'observabilidade',
    'recomendada',
    MARCADOR_PREENCHER,
    'Usuário técnico de sonda (sem acesso a paciente).',
  ),
  v('SONDA_SENHA', 'observabilidade', 'recomendada', MARCADOR_SEGREDO, 'Senha do usuário técnico de sonda.', {
    segredo: true,
  }),
  v(
    'SONDA_VERSAO_ESPERADA',
    'observabilidade',
    'recomendada',
    '',
    'Identificação da versão que o pacote promete (gravada pelo instalador).',
  ),
  v(
    'IMPLANTACAO_CHAVES_ESPERADAS',
    'observabilidade',
    'opcional',
    '',
    'Chaves de liberação que podem estar ligadas (lista; prefixo.* vale para o prefixo; todas; todas-exceto:<lista>; nenhuma). Vazio: o padrão da liberação full na instalação (todas, menos as que o liberacao:ligar-tudo não liga sem decisão do dono).',
  ),
  // Banco próprio (MariaDB): um banco por cliente e o banco da plataforma no mesmo servidor.
  v(
    'SGH_MARIADB_HOST',
    'banco',
    'obrigatoria',
    MARCADOR_PREENCHER,
    'Servidor do MariaDB dos bancos dos clientes e da plataforma (nome ou endereço).',
  ),
  v(
    'SGH_MARIADB_USUARIO',
    'banco',
    'obrigatoria',
    MARCADOR_PREENCHER,
    'Conta da aplicação no MariaDB, com o papel_aplicacao como papel padrão (anexos de privilégios do manual).',
  ),
  v(
    'MARIADB_SENHA',
    'banco',
    'obrigatoria',
    MARCADOR_SEGREDO,
    'Senha da conta da aplicação no MariaDB (definida pela TI ao criar a conta).',
    { segredo: true },
  ),
  v(
    'SGH_MARIADB_USUARIO_MIGRACOES',
    'banco',
    'opcional',
    '',
    'Conta que aplica as migrações (DDL) dos bancos; vazio: as migrações não rodam pela aplicação.',
  ),
  v(
    'SGH_BANCO_PLATAFORMA',
    'banco',
    'opcional',
    '',
    'Nome do banco da plataforma (clientes, credenciais e fila do conector). Vazio: plataforma.',
  ),
  v(
    'CLIENTE_PADRAO',
    'produto',
    'opcional',
    '',
    'Cliente usado quando a requisição não traz o cliente (instalação com um só cliente).',
  ),
  v(
    'API_MODULOS',
    'servicos',
    'opcional',
    'todos',
    'Módulos da API ligados: todos ou a lista separada por vírgula.',
  ),
  v(
    'INTEGRACAO_CLIENTES',
    'integracoes',
    'opcional',
    '',
    'Clientes cujo ciclo de integração o worker roda (separados por vírgula). Vazio: os ativos da plataforma.',
  ),
  v(
    'FATURAMENTO_ROTINA_DIARIA',
    'rotinas',
    'opcional',
    '',
    'Lançamento automático do dia nas contas abertas (diárias e taxas). Em produção roda sempre, salvo "desligado"; em desenvolvimento e homologação só com "ligado".',
  ),
  v(
    'ACESSO_CONTAS_DORMENTES_ESTABELECIMENTOS',
    'seguranca',
    'opcional',
    '',
    'Estabelecimentos (códigos separados por vírgula) em que o aviso de contas sem uso roda.',
  ),
  v(
    'SMTP_HOST',
    'email',
    'opcional',
    '',
    'Servidor SMTP de saída. Fora de produção só é aceito destino local (neutralização).',
  ),
  v(
    'CONECTOR_ORIGENS_DIR',
    'caminhos',
    'opcional',
    '',
    'Pasta das imagens de origem lidas pelo conector (somente leitura). Vazio: a do pacote.',
  ),
  v(
    'CONECTOR_LOG_DIR',
    'caminhos',
    'opcional',
    '',
    'Pasta dos logs de execução do conector (worker e serviço), lida pela tela Carga e sincronismo. Vazio: a do pacote.',
  ),
  v(
    'SGH_RAIZ_REPOSITORIO',
    'caminhos',
    'opcional',
    '',
    'Pasta das ferramentas do pacote usadas pelo painel da plataforma (criar cliente). Vazio: a do pacote.',
  ),
  v(
    'ESTRUTURA_HOMOLOGADA',
    'caminhos',
    'opcional',
    '',
    'Resumo homologado da estrutura do banco, conferido pela fumaça da implantação. Vazio: o do pacote.',
  ),
  // Caminhos do pacote (relativos à pasta da versão; o padrão serve)
  ...(
    [
      ['SGH_M58_ENSAIOS', 'relatórios do ensaio da versão 5 do banco'],
      ['SGH_HOMOLOGACAO', 'registro da homologação'],
      ['SGH_PRONTIDAO', 'relatório de prontidão'],
      ['SGH_MAPA_PERMISSOES', 'mapa das permissões (implantação fora do repositório)'],
    ] as const
  ).map(([k, d]) => v(k, 'caminhos', 'opcional', '', `Pasta ou arquivo: ${d}. Vazio: o do pacote.`)),
];

/** Chaves que o código lê e que NÃO vão para o arquivo do servidor, com o motivo (dev, teste, ferramenta). */
export const NAO_CONFIGURAVEIS: Readonly<Record<string, string>> = {
  SGH_DEV_PERMITIR_SYSDBA: 'exceção de dev (SYSDBA na cópia); recusada fora de dev',
  ACESSO_EMAIL_CANAL_DONO:
    'fora de produção: e-mail de acesso do dono pelo canal de avisos da obra; ignorada em produção',
  DONO_EMAIL: 'fora de produção: destinatário do canal de avisos da obra (com ACESSO_EMAIL_CANAL_DONO)',
  ACESSO_FONTE_DEV: 'dev: fonte das contas (cópia ou sintética)',
  ACESSO_GESTAO_LEGADO_DEV: 'dev: gestão das contas na cópia',
  DEV_GRAVA_COPIA: 'dev: a API grava na cópia pelas fontes de produção',
  ACESSO_SINTETICO_INDISPONIVEL: 'teste: simula a fonte sintética fora',
  AGENDA_SINTETICA_POR_FORA: 'teste: E2E da agenda',
  ENFERMAGEM_SINTETICA_POR_FORA: 'teste: E2E da enfermagem',
  LEITOS_SINTETICOS_POR_FORA: 'teste: E2E dos leitos',
  NIR_SINTETICO_POR_FORA: 'teste: E2E do NIR',
  RECEPCAO_SINTETICA_POR_FORA: 'teste: E2E da recepção',
  REDE_SINTETICA_SEGUNDO: 'teste: segundo estabelecimento sintético',
  SESSAO_SINTETICA: 'dev/ci: sessão sintética',
  RH_SINTETICO_SEMEAR: 'teste: E2E do acesso (vínculos sintéticos do RH)',
  SESSAO_BLOQUEIO_SEGUNDOS: 'dev/ci: bloqueio da sessão sintética',
  CONFIG_FONTE: 'dev/ci: fonte de configuração sintética',
  DEV_ENDERECOS: 'dev: endereços locais por rede',
  CATALOGO_PUBLICAR_FORA_DA_JANELA: 'dev: publica fora da janela (recusado em produção)',
  CONTABIL_LER_FORA_DA_JANELA: 'dev: lê os fatos contábeis fora da janela (recusado em produção)',
  E2E_PORTAS: 'teste: portas do E2E',
  WEB_PORTA: 'dev: porta do servidor de desenvolvimento das telas (em produção o nginx serve o estático)',
  WEB_ESCUTA: 'dev: endereço do servidor de desenvolvimento das telas',
  WEB_HTTPS_CERT: 'dev: certificado do servidor de desenvolvimento (em produção, o do nginx)',
  WEB_HTTPS_CHAVE: 'dev: chave do servidor de desenvolvimento (em produção, a do nginx)',
  VITE_GRAFANA_URL: 'build das telas (dev)',
  RNDS_SIMULADOR_URL: 'teste: simulador da RNDS',
  SGH_INT_SAIDA: 'teste: saída das integrações',
  SGH_INT_REDE_PORTA2: 'teste: segunda porta da rede',
  OIE_DEPURAR: 'dev: depuração do motor de integração',
  M464_MEDIDAS: 'ferramenta de medida do M46.4',
  FB_ABC_NOME: 'teste: estabelecimento fictício',
  FB_ABC_BANCO: 'teste: estabelecimento fictício',
  SGH_ARQUIVO_AMBIENTE: 'definida pela unit do systemd (aponta para este arquivo)',
  SGH_PROCESSO: 'definida pelo próprio processo (api ou worker)',
  SGH_CONTAINERS_LOCAIS: 'dev/homologação: containers locais aceitos como destino pela neutralização',
  SGH_CLIENTE_TESTE: 'teste: cliente de teste do lote (banco e pasta de arquivos próprios)',
  ORIGEM: 'nome de coluna, não variável',
  DESTINO: 'nome de coluna, não variável',
  ENVIADA_POR: 'nome de coluna, não variável',
};

/** Prefixos de chaves montadas em tempo de execução (por código). */
export const PREFIXOS_DINAMICOS: readonly { prefixo: string; descricao: string }[] = [
  { prefixo: 'FB_', descricao: 'série por estabelecimento (CAMPOS_ESTABELECIMENTO)' },
  { prefixo: 'INTEGRACAO_DESTINO_', descricao: 'destino de cada integração de saída, por código' },
];

const CHAVES_CATALOGO = new Set(VARIAVEIS.map((x) => x.chave));

/** Chaves lidas no texto de um arquivo de código (acesso direto ao ambiente ou pelos leitores de inteiro). */
export function varrerChaves(texto: string): Set<string> {
  const achadas = new Set<string>();
  const padroes = [
    /\b(?:process\.env|env)\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g,
    /\b(?:process\.env|env)\.([A-Z][A-Z0-9_]+)\b/g,
    /\b[a-zA-Z]+\(\s*(?:process\.env|env)\s*,\s*'([A-Z][A-Z0-9_]+)'/g,
    /\[\s*'(FB_[A-Z_]+)'\s*,\s*\d/g,
  ];
  for (const p of padroes) for (const m of texto.matchAll(p)) achadas.add(m[1]!);
  // Leitura indireta: env[CONSTANTE], com a constante declarada no mesmo arquivo (const X = 'CHAVE').
  for (const m of texto.matchAll(/\b(?:process\.env|env)\[\s*([A-Z][A-Z0-9_]+)\s*\]/g)) {
    const d = new RegExp(`\\b${m[1]}\\s*=\\s*'([A-Z][A-Z0-9_]+)'`).exec(texto);
    if (d) achadas.add(d[1]!);
  }
  return achadas;
}

export function ehChaveDeEstabelecimento(chave: string): boolean {
  return (
    /^FB_[A-Z][A-Z0-9]{1,9}_[A-Z_]+$/.test(chave) &&
    CAMPOS_ESTABELECIMENTO.some((c) => chave.endsWith(`_${c.campo}`))
  );
}

/** Confere o catálogo contra as chaves achadas no repositório. */
export function conferirCatalogo(achadas: Iterable<string>): { semEntrada: string[]; obsoletas: string[] } {
  const vistas = new Set(achadas);
  const semEntrada = [...vistas]
    .filter(
      (k) =>
        !CHAVES_CATALOGO.has(k) &&
        !(k in NAO_CONFIGURAVEIS) &&
        !ehChaveDeEstabelecimento(k) &&
        !k.startsWith('INTEGRACAO_DESTINO_'),
    )
    .sort();
  // TZ é do sistema (o Node lê sozinho); as demais têm de existir no código.
  const obsoletas = [...CHAVES_CATALOGO].filter((k) => k !== 'TZ' && !vistas.has(k)).sort();
  return { semEntrada, obsoletas };
}
