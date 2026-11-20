// M59-F1 (ficha do M59, seções 4 e 8, regras 4 e 5; cap-08 §8.10, §8.15 e §8.16): vocabulário do inventário
// das contas do banco e do privilégio mínimo por módulo. As contas técnicas são do próprio banco (catálogo
// de segurança do Firebird), não pessoas: os nomes abaixo são os do cap-08 §8.10. Conta fora desta lista
// nunca tem o nome lido nem impresso: a leitura só a conta (agregado), porque pode ser login de pessoa.
import { z } from 'zod';

/** Classe da conta, pelo papel que ela cumpre hoje (cap-08 §8.10, tabela "Contas"). */
export const CLASSES_CONTA_BANCO = [
  /** Administrador do servidor (SYSDBA): nunca usado pela aplicação (regra 4). */
  'administrador-banco',
  /** Dona dos objetos SGH_, só para os scripts versionados (pnpm sgh:aplicar). */
  'scripts-sgh',
  /** Conta da aplicação (hoje uma; depois do F1, uma por módulo). */
  'aplicacao-sgh',
  /** Leitura do Sante SGH para relatórios pesados e BI na cópia diária. */
  'leitura-sgh',
  /** Serviços do próprio sistema anterior (portal, TISS, resultados, importação), com escrita ampla. */
  'servico-legado',
  /** Backup do servidor (gbak/nbackup), com escrita ampla. */
  'backup',
  /** Conta da sante-api (Hal-AI), só leitura. */
  'sante-api',
  /** Parceiro com leitura direta (EPIMED, ZGLOSA). */
  'leitura-parceiro',
  /** Planilhas e relatórios lidos direto do banco. */
  'planilha',
  /** Terceiro com acesso parcial (laboratórios, operadoras, portais). */
  'parceiro-terceiro',
  /** Pseudo-usuário PUBLIC (privilégio de todos): revisto só com prova na cópia de que nada depende dele. */
  'publico',
  /** Papéis do banco do sistema anterior (MASTER, SENIOR, TRAINEE), sem privilégio: ficam como estão. */
  'papel-legado',
  /** Conta com privilégio que não está nesta lista: só contada, nunca nomeada. */
  'nao-catalogada',
] as const;
export type ClasseContaBanco = (typeof CLASSES_CONTA_BANCO)[number];

/** Destino da conta depois da coexistência (cap-08 §8.10, última coluna; regra 5 do M59). */
export const DESTINOS_CONTA_BANCO = [
  /** Revogada (sem uso medido na janela, ou relatório equivalente já no catálogo). */
  'revogar',
  /** Vira cliente de API com escopo mínimo e segredo no cofre (cap-12). */
  'cliente-api',
  /** Vira função do Sante SGH (portal, TISS, integração) e a conta é revogada depois. */
  'funcao-sgh',
  /** Fica, com o privilégio reduzido ao que a função exige (backup). */
  'privilegio-reduzido',
  /** Fachada da sante-api no Sante SGH; a conta fica até lá (regra 12: combinado com a Hal-AI). */
  'fachada-sante-api',
  /** Conta do Sante SGH: privilégio mínimo por módulo (regra 4). */
  'privilegio-minimo',
  /** Fica como está (administrador do servidor, só para a TI, com acesso auditado). */
  'manter-auditada',
] as const;
export type DestinoContaBanco = (typeof DESTINOS_CONTA_BANCO)[number];

/** Uma conta catalogada pelo nome exato ou por prefixo (RELATORIO_*). */
export interface ContaTecnicaCatalogada {
  readonly nome?: string;
  readonly prefixo?: string;
  readonly classe: ClasseContaBanco;
  readonly destino: DestinoContaBanco;
  /** Pode ser revogada sem uso medido? Nunca: a regra 5 exige a medição antes (fica sempre false). */
  readonly exigeMedicao: true;
  /** Decisão de que depende (DP-16: contas de parceiros; regra 12: Hal-AI). */
  readonly dependeDe?: readonly string[];
}

const c = (
  nome: string,
  classe: ClasseContaBanco,
  destino: DestinoContaBanco,
  dependeDe?: readonly string[],
): ContaTecnicaCatalogada => ({
  nome,
  classe,
  destino,
  exigeMedicao: true,
  ...(dependeDe ? { dependeDe } : {}),
});

/**
 * Contas técnicas do banco do hospital, com o destino do cap-08 §8.10. As contas do Sante SGH (aplicação,
 * scripts e leitura) vêm da configuração do ambiente e são classificadas à parte (não têm nome fixo).
 */
export const CONTAS_TECNICAS_LEGADO: readonly ContaTecnicaCatalogada[] = [
  c('SYSDBA', 'administrador-banco', 'manter-auditada'),
  ...['AUTORIZADOR', 'PORTALSERV', 'RESULTADOWEB', 'TISSWS', 'SACMOBILE', 'IMPORTARDORPEP'].map((n) =>
    c(n, 'servico-legado', 'funcao-sgh'),
  ),
  ...['INTEGRACAOAOL', 'INTEGRARESULTADOS'].map((n) => c(n, 'servico-legado', 'cliente-api', ['DP-16'])),
  c('SGHBACKUP', 'backup', 'privilegio-reduzido'),
  c('HAL_AI', 'sante-api', 'fachada-sante-api', ['regra-12']),
  ...['EPIMED', 'ZGLOSA'].map((n) => c(n, 'leitura-parceiro', 'cliente-api', ['DP-16'])),
  ...['CONSULT', 'CONSULT_DIRETORES', 'CONSULT_GERENTE', 'EXCEL', 'EXCEL_ADM', 'EXCEL_FIN'].map((n) =>
    c(n, 'planilha', 'revogar'),
  ),
  { prefixo: 'RELATORIO_', classe: 'planilha', destino: 'revogar', exigeMedicao: true },
  ...[
    'TOLIFE',
    'UNIMEDPR',
    'INTEGRAUNIMED',
    'BHSOFT',
    'CM_TECNOLOGIA',
    'MEDIA_PLUS',
    'BIOSLAB',
    'PORTAL_PLANO',
    'FIRST',
  ].map((n) => c(n, 'parceiro-terceiro', 'cliente-api', ['DP-16'])),
  c('PUBLIC', 'publico', 'privilegio-reduzido', ['prova-na-copia']),
  ...['MASTER', 'SENIOR', 'TRAINEE'].map((n) => c(n, 'papel-legado', 'manter-auditada')),
];

/** Papéis do banco do sistema anterior: existem, sem privilégio concedido (cap-08 §8.10); ficam como estão. */
export const PAPEIS_BANCO_LEGADO = ['MASTER', 'SENIOR', 'TRAINEE'] as const;

/** Privilégios de RDB$USER_PRIVILEGES que contam (S leitura; I, U, D escrita; R referência; X execução; M papel). */
export const PRIVILEGIOS_BANCO = ['S', 'I', 'U', 'D', 'R', 'X', 'M'] as const;
export type PrivilegioBanco = (typeof PRIVILEGIOS_BANCO)[number];
export const PRIVILEGIOS_ESCRITA: readonly PrivilegioBanco[] = ['I', 'U', 'D'];

/** Contagens de objetos distintos por privilégio de uma conta (só números). */
export type ContagemPrivilegios = Readonly<Record<PrivilegioBanco, number>>;

/** Linha do inventário lida do catálogo de segurança (sem dado de pessoa). */
export interface ContaBancoLida {
  /** Nome da conta catalogada; null para o agregado das não catalogadas. */
  readonly nome: string | null;
  /** 'usuario' (RDB$USER_TYPE 8) ou 'papel' (13). */
  readonly tipo: 'usuario' | 'papel';
  /** Existe em SEC$USERS (conta com login); papel não tem. */
  readonly existeLogin: boolean;
  /** SEC$ACTIVE; null quando não há login. */
  readonly ativa: boolean | null;
  /** Quantas contas a linha soma (1 para catalogada; n para o agregado). */
  readonly quantidade: number;
  /** Objetos distintos por privilégio. */
  readonly privilegios: ContagemPrivilegios;
  /** Objetos distintos com qualquer escrita (I, U ou D). */
  readonly objetosComEscrita: number;
  /** Papéis de que a conta é membro (só nomes de papel). */
  readonly papeis: readonly string[];
}

/** Uso medido de uma conta na janela (sessões e consultas; trace ou amostras de MON$ATTACHMENTS). */
export const esquemaUsoContaBanco = z
  .object({
    conta: z.string().regex(/^[A-Z][A-Z0-9_$]{0,62}$/),
    /** Início e fim da janela medida (ISO, dia). */
    inicio: z.iso.date(),
    fim: z.iso.date(),
    sessoes: z.number().int().nonnegative(),
    consultas: z.number().int().nonnegative().nullable(),
    /** Último uso visto na janela (ISO, dia), se houve. */
    ultimoUso: z.iso.date().nullable(),
    /** De onde veio a medida. */
    fonte: z.enum(['trace', 'mon-attachments', 'log-servidor']),
  })
  .strict();
export type UsoContaBanco = z.infer<typeof esquemaUsoContaBanco>;

/** Ação de privilégio no plano por módulo (DML; DDL de objeto SGH_ só pela conta de scripts). */
/**
 * USAGE é o do generator: no Firebird 3 os gatilhos do banco rodam com o privilégio de quem grava, então o
 * módulo precisa de INSERT nas tabelas que os gatilhos alimentam (tabelas_efeito do catálogo de operações) e de
 * USAGE nos generators que eles usam e que não são de PUBLIC.
 */
export const ACOES_PRIVILEGIO_MODULO = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'USAGE'] as const;
export type AcaoPrivilegioModulo = (typeof ACOES_PRIVILEGIO_MODULO)[number];

/** O que um módulo do Sante SGH alcança no banco (derivado do catálogo de operações e das consultas). */
export interface AlcanceModulo {
  readonly modulo: string;
  /** Tabela ou visão → ações. Procedure: EXECUTE; generator: USAGE (sozinhas). */
  readonly objetos: Readonly<Record<string, readonly AcaoPrivilegioModulo[]>>;
}

/** Um privilégio real lido de RDB$USER_PRIVILEGES para uma conta (ou papel) do Sante SGH. */
export interface PrivilegioReal {
  readonly titular: string;
  readonly objeto: string;
  readonly acao: AcaoPrivilegioModulo;
}

/** Situação de uma conta no inventário (o que pode ser feito agora; regras 1 e 5 do M59). */
export const SITUACOES_CONTA_BANCO = [
  /** Pode seguir para o script (com autorização do dono por passo). */
  'pronta',
  /** Falta medir o uso na janela mínima (regra 5: medição antes de revogar). */
  'medir-uso',
  /** O sistema anterior ainda pode ser religado (DP-6): nada do que ele usa sai. */
  'aguardando-contingencia',
  /** Falta decisão registrada (DP-16, regra 12, concordância da área). */
  'aguardando-decisao',
  /** Conta fora do catálogo: a TI identifica antes de qualquer passo. */
  'identificar',
  /** Hospital ainda com o sistema anterior ligado (regra 1): nenhum endurecimento. */
  'aguardando-desligamento',
] as const;
export type SituacaoContaBanco = (typeof SITUACOES_CONTA_BANCO)[number];

/**
 * Convenção do privilégio mínimo por módulo (D-PAPEL-59): um papel do banco por módulo (`SGH_MOD_<MODULO>`) dado
 * a uma conta por módulo, informado pelo pool ao conectar (`SGH_APP_<MODULO>`). Aqui no contrato porque o núcleo do adaptador
 * (pool por módulo) e o domínio (plano e scripts) usam o mesmo nome.
 */
export const PREFIXO_CONTA_MODULO_BANCO = 'SGH_APP_';
export const PREFIXO_PAPEL_MODULO_BANCO = 'SGH_MOD_';

/** `faturamentoTiss` → `FATURAMENTO_TISS` (identificador do banco, até 63 caracteres). */
export function sufixoModuloBanco(modulo: string): string {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(modulo)) throw new Error(`Módulo inválido: ${modulo}`);
  const s = modulo.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  if (s.length + PREFIXO_CONTA_MODULO_BANCO.length > 63) throw new Error(`Módulo longo demais: ${modulo}`);
  return s;
}
export const papelModuloBanco = (modulo: string): string =>
  `${PREFIXO_PAPEL_MODULO_BANCO}${sufixoModuloBanco(modulo)}`;
export const contaModuloBanco = (modulo: string): string =>
  `${PREFIXO_CONTA_MODULO_BANCO}${sufixoModuloBanco(modulo)}`;

const identBanco = z.string().regex(/^[A-Z][A-Z0-9_$]{0,62}$/);
const contagemFaixa = z.union([z.number().int().nonnegative(), z.literal('<5')]);

/** Uma linha do painel "Contas do banco de dados e privilégios" (só conta técnica e contagens). */
export const esquemaLinhaContaBanco = z
  .object({
    /** Null: o agregado das contas fora do catálogo (nunca nomeadas). */
    nome: identBanco.nullable(),
    tipo: z.enum(['usuario', 'papel']),
    quantidade: contagemFaixa,
    existeLogin: z.boolean(),
    ativa: z.boolean().nullable(),
    classe: z.enum(CLASSES_CONTA_BANCO),
    destino: z.enum(DESTINOS_CONTA_BANCO),
    situacao: z.enum(SITUACOES_CONTA_BANCO),
    motivo: z.string().max(300),
    leitura: z.number().int().nonnegative(),
    escrita: z.number().int().nonnegative(),
    execucao: z.number().int().nonnegative(),
    papeis: z.array(identBanco),
    uso: esquemaUsoContaBanco.nullable(),
  })
  .strict();
export type LinhaContaBanco = z.infer<typeof esquemaLinhaContaBanco>;

/** Resposta de GET /api/administracao/acesso/contas-banco. */
export const esquemaInventarioContasBancoResposta = z
  .object({
    hospital: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    em: z.iso.datetime(),
    contexto: z
      .object({
        /** O passo "desligamento" do M58 executado no hospital (registro versionado dos passos). */
        desligado: z.boolean(),
        /** `legado.contingencia` do estabelecimento (padrão ligado: falha fechada). */
        contingenciaAtiva: z.boolean(),
        janelaMinimaDias: z.number().int().positive(),
        /** Avisos de leitura (registro ausente, uso não medido); sem dado pessoal. */
        avisos: z.array(z.string().max(300)),
      })
      .strict(),
    resumo: z
      .object({
        contasComPrivilegio: z.number().int().nonnegative(),
        contasComEscrita: z.number().int().nonnegative(),
        contasComEscritaAmpla: z.number().int().nonnegative(),
        maiorAlcanceEscrita: z.number().int().nonnegative(),
        naoCatalogadas: contagemFaixa,
        loginsSemPrivilegio: contagemFaixa,
        papeisSemPrivilegio: z.array(identBanco),
        porSituacao: z.record(z.enum(SITUACOES_CONTA_BANCO), z.number().int().nonnegative()),
      })
      .strict(),
    contas: z.array(esquemaLinhaContaBanco),
  })
  .strict();
export type InventarioContasBancoResposta = z.infer<typeof esquemaInventarioContasBancoResposta>;

export const esquemaItemPrivilegioModulo = z
  .object({ titular: identBanco, objeto: identBanco, acao: z.enum(ACOES_PRIVILEGIO_MODULO) })
  .strict();

/** Teto de itens de cada lista de desvio na resposta (o total vem à parte). */
export const TETO_ITENS_DESVIO = 500;

/** Resposta de GET /api/administracao/acesso/contas-banco/desvios (plano por módulo × catálogo de segurança). */
export const esquemaDesviosPrivilegiosResposta = z
  .object({
    hospital: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    em: z.iso.datetime(),
    /** Versão do plano gerado (resumo do alcance versionado). */
    versaoPlano: z.string().regex(/^[0-9a-f]{12}$/),
    modulos: z.array(
      z
        .object({
          modulo: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
          papel: identBanco,
          conta: identBanco,
          objetos: z.number().int().nonnegative(),
          itens: z.number().int().nonnegative(),
          /** A conta do módulo está no arquivo de ambiente (senão, o módulo usa a conta única). */
          contaConfigurada: z.boolean(),
        })
        .strict(),
    ),
    iguais: z.number().int().nonnegative(),
    excessoTotal: z.number().int().nonnegative(),
    faltaTotal: z.number().int().nonnegative(),
    excesso: z.array(esquemaItemPrivilegioModulo).max(TETO_ITENS_DESVIO),
    falta: z.array(esquemaItemPrivilegioModulo).max(TETO_ITENS_DESVIO),
    /** Nenhum papel por módulo no banco ainda: o plano não foi aplicado (a falta é o plano inteiro). */
    planoAplicado: z.boolean(),
  })
  .strict();
export type DesviosPrivilegiosResposta = z.infer<typeof esquemaDesviosPrivilegiosResposta>;
