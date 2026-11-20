// M60, etapa 2 (instalação no servidor Ubuntu): o contrato da conferência da instalação e da conexão ao banco.
// A TI do hospital, depois de instalar, abre a conferência (ou chama a rota) e vê, para o estabelecimento ativo: a
// versão instalada, a conexão de verdade (motor, autenticação, cifragem do canal, charset, conta técnica e papel) e
// os scripts SGH_ do pacote contra os registrados no banco. Só leitura; nada de pessoa, de senha nem de endereço.
import { z } from 'zod';

/**
 * A permissão da conferência: a mesma dos painéis de saúde do M09 ("Ver a saúde do sistema e do banco"), concedida
 * por perfil ao Administrador do sistema (D-PERM-60.2: nenhum código novo no catálogo).
 */
export const PERMISSAO_CONFERENCIA_INSTALACAO = 'sistema.saude.ler';

export const ROTA_CONFERENCIA_INSTALACAO = '/api/administracao/implantacao/conferencia';

/**
 * A mesma conferência para a fumaça pós-implantação, sem sessão: só com o cabeçalho x-sonda-token = SONDA_TOKEN
 * (como as sondas da implantação azul/verde); sem ele, 404. Nada de pessoa, senha nem endereço.
 */
export const ROTA_SONDA_INSTALACAO = '/api/sistema/sonda/instalacao';

/** Métodos de autenticação aceitos na conexão da aplicação (Srp; nunca Legacy_Auth em produção). */
export const AUTENTICACOES_ACEITAS = ['Srp256', 'Srp'] as const;

/** Nomes dos charsets do Firebird pelo id do catálogo (RDB$CHARACTER_SETS) que a conferência precisa mostrar. */
export const NOMES_CHARSET_FIREBIRD: Readonly<Record<number, string>> = Object.freeze({
  0: 'NONE',
  1: 'OCTETS',
  2: 'ASCII',
  3: 'UNICODE_FSS',
  4: 'UTF8',
  21: 'ISO8859_1',
  53: 'WIN1252',
});

export const SITUACOES_ITEM_CONFERENCIA = ['ok', 'alerta', 'falha'] as const;
export type SituacaoItemConferencia = (typeof SITUACOES_ITEM_CONFERENCIA)[number];

/** Códigos dos itens da conferência, na ordem em que aparecem. */
export const ITENS_CONFERENCIA_INSTALACAO = [
  'motor',
  'autenticacao',
  'canal-cifrado',
  'charset',
  'conta-propria',
  'papel-aplicacao',
  'scripts',
  'versao',
] as const;
export type ItemConferenciaInstalacao = (typeof ITENS_CONFERENCIA_INSTALACAO)[number];

export const esquemaItemConferencia = z.object({
  codigo: z.enum(ITENS_CONFERENCIA_INSTALACAO),
  titulo: z.string().min(1),
  situacao: z.enum(SITUACOES_ITEM_CONFERENCIA),
  detalhe: z.string(),
});
export type ItemConferencia = z.infer<typeof esquemaItemConferencia>;

export const esquemaConexaoConferida = z.object({
  versaoMotor: z.string(),
  charsetBanco: z.string(),
  charsetConexao: z.string().nullable(),
  charsetParametro: z.enum(['CP1252', 'UTF8']),
  autenticacao: z.string().nullable(),
  canalCifrado: z.boolean().nullable(),
  canalComprimido: z.boolean().nullable(),
  protocolo: z.string().nullable(),
  /** A conta técnica da conexão (nome de conta de serviço, nunca de pessoa) e o papel em uso. */
  conta: z.string(),
  papel: z.string().nullable(),
});
export type ConexaoConferida = z.infer<typeof esquemaConexaoConferida>;

export const esquemaScriptsConferidos = z.object({
  /** Falso quando a conta da aplicação não conseguiu ler o registro dos scripts no banco (contagens do banco zeradas). */
  registroLido: z.boolean(),
  /** Scripts SGH_ que vieram no pacote instalado. */
  noPacote: z.number().int().nonnegative(),
  ultimoNoPacote: z.string().nullable(),
  /** Registrados em SGH_VERSAO_SCRIPT no banco do estabelecimento. */
  aplicados: z.number().int().nonnegative(),
  ultimoAplicado: z.string().nullable(),
  /** Do pacote e ainda não aplicados (números de 4 dígitos, no máximo 20 listados). */
  pendentes: z.array(z.string()),
  pendentesTotal: z.number().int().nonnegative(),
  /** Aplicados com hash diferente do arquivo do pacote. */
  divergentes: z.array(z.string()),
  /** Aplicados no banco que o pacote não conhece (o banco está à frente do pacote). */
  desconhecidos: z.array(z.string()),
});
export type ScriptsConferidos = z.infer<typeof esquemaScriptsConferidos>;

export const esquemaConferenciaInstalacao = z.object({
  hospital: z.string(),
  em: z.string(),
  ambiente: z.string(),
  versao: z.object({ identificacao: z.string(), versao: z.string() }),
  conexao: esquemaConexaoConferida,
  scripts: esquemaScriptsConferidos,
  itens: z.array(esquemaItemConferencia),
  situacao: z.enum(SITUACOES_ITEM_CONFERENCIA),
});
export type ConferenciaInstalacao = z.infer<typeof esquemaConferenciaInstalacao>;
