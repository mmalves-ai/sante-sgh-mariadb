// Configuração do núcleo lida do ambiente (o do processo sobre o .env da raiz). Mensagens citam só nomes de chave.
// Desenvolvimento: MariaDB em 127.0.0.1:3410, usuário root, senha em MARIADB_SENHA. A senha fica numa propriedade
// não enumerável: não aparece em JSON.stringify nem em console.log da configuração.
import type { Ambiente } from './ambiente.js';
import { ErroConfiguracao } from './erros.js';

export interface ConfiguracaoNucleo {
  readonly host: string;
  readonly porta: number;
  readonly usuario: string;
  /** Não enumerável (nunca vai a log). */
  readonly senha: string;
  /** Banco de controle da plataforma, com a tabela `cliente`. */
  readonly bancoPlataforma: string;
  /** Conexões por banco de cliente. */
  readonly tetoPorBanco: number;
  /** Espera máxima por uma conexão livre. */
  readonly esperaConexaoMs: number;
  /** Tempo máximo de cada consulta de leitura (max_statement_time). */
  readonly tempoConsultaMs: number;
  /** Teto de linhas padrão por consulta de leitura: passar dele é erro (pagine no servidor). */
  readonly tetoLinhas: number;
  /** innodb_lock_wait_timeout das escritas, em segundos. */
  readonly esperaTravaSegundos: number;
}

export const PADROES = Object.freeze({
  host: '127.0.0.1',
  porta: 3410,
  usuario: 'root',
  bancoPlataforma: 'plataforma',
  tetoPorBanco: 4,
  esperaConexaoMs: 5_000,
  tempoConsultaMs: 15_000,
  tetoLinhas: 1_000,
  esperaTravaSegundos: 5,
});

/** Chave do ambiente, mínimo e máximo de cada inteiro. */
const INTEIROS = {
  porta: ['MARIADB_PORTA', 1, 65_535],
  tetoPorBanco: ['SGH_MARIADB_POOL_TETO', 1, 64],
  esperaConexaoMs: ['SGH_MARIADB_POOL_ESPERA_MS', 100, 120_000],
  tempoConsultaMs: ['SGH_CONSULTA_TEMPO_MS', 100, 600_000],
  tetoLinhas: ['SGH_CONSULTA_TETO_LINHAS', 1, 100_000],
  esperaTravaSegundos: ['SGH_TRAVA_ESPERA_S', 1, 60],
} as const satisfies Record<string, readonly [string, number, number]>;

export const FORMATO_NOME_BANCO = /^[a-z][a-z0-9_]{0,63}$/;

/** Inteiro do ambiente dentro da faixa; ausente ou vazio dá o padrão; inválido é erro (cita só a chave). */
export function lerInteiroAmbiente(
  env: Ambiente,
  chave: string,
  padrao: number,
  min: number,
  max: number,
): number {
  const bruto = env[chave]?.trim();
  if (!bruto) return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ErroConfiguracao(`${chave} deve ser inteiro entre ${min} e ${max}.`);
  return n;
}

export function lerConfiguracaoNucleo(env: Ambiente): ConfiguracaoNucleo {
  const senha = env['MARIADB_SENHA'];
  if (!senha) throw new ErroConfiguracao('MARIADB_SENHA ausente no ambiente (ou no .env da raiz).');
  const bancoPlataforma = env['SGH_BANCO_PLATAFORMA']?.trim() || PADROES.bancoPlataforma;
  if (!FORMATO_NOME_BANCO.test(bancoPlataforma)) throw new ErroConfiguracao('SGH_BANCO_PLATAFORMA inválido.');
  const inteiro = (k: keyof typeof INTEIROS) => {
    const [chave, min, max] = INTEIROS[k];
    return lerInteiroAmbiente(env, chave, PADROES[k], min, max);
  };
  const config = {
    host: env['SGH_MARIADB_HOST']?.trim() || PADROES.host,
    porta: inteiro('porta'),
    usuario: env['SGH_MARIADB_USUARIO']?.trim() || PADROES.usuario,
    bancoPlataforma,
    tetoPorBanco: inteiro('tetoPorBanco'),
    esperaConexaoMs: inteiro('esperaConexaoMs'),
    tempoConsultaMs: inteiro('tempoConsultaMs'),
    tetoLinhas: inteiro('tetoLinhas'),
    esperaTravaSegundos: inteiro('esperaTravaSegundos'),
  };
  Object.defineProperty(config, 'senha', { value: senha, enumerable: false, writable: false });
  return Object.freeze(config) as ConfiguracaoNucleo;
}
