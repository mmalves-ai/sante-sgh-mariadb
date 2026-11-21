// Coletor de transações do MariaDB para o `pnpm k6` (no lugar do coletor do banco antigo): numa transação de leitura,
// lê as conexões do banco do cliente (information_schema.PROCESSLIST), a transação aberta de cada uma
// (information_schema.INNODB_TRX) e o processo que a abriu (atributo de conexão `program_name`, em
// performance_schema.session_connect_attrs). Só contagens e tempos; nunca o texto do comando.
// Melhoria: a escrita é medida pelas linhas alteradas da transação, e a espera por trava pelo estado LOCK WAIT.
// Melhoria: a coleta roda com uma conta de MONITORAMENTO própria (SGH_MONITOR_USUARIO e SGH_MONITOR_SENHA), com o
//   privilégio global PROCESS e SELECT em performance_schema.session_connect_attrs. A conta da aplicação não tem nem
//   deve ter PROCESS (guardas-privilegios: privilégio global é VERMELHO); sem PROCESS, INNODB_TRX vem vazio e o
//   PROCESSLIST só mostra a própria conexão. Sem a conta de monitoramento configurada, o vigia usa a conta da
//   aplicação com alerta explícito (dev); a coleta que falha por privilégio vira erro nomeado, nunca silêncio.
import type { Ambiente, Leitor } from '@sgh/nucleo';
import type { Coleta, ConexaoColetada } from './k6-mon.ts';

export interface PorProcesso {
  readonly processo: string;
  readonly conexoes: number;
  readonly travas: number;
  readonly esperasPorTrava: number;
  readonly comandosLongos: number;
}

export interface ColetaTransacoes extends Coleta {
  readonly conexoesDoNovo: readonly ConexaoColetada[];
  readonly porProcesso: readonly PorProcesso[];
  readonly duracaoMs: number;
}

type LinhaConexao = {
  processo: string | null;
  tempo_ms: number | string | null;
  transacao_ms: number | string | null;
  linhas_alteradas: number | string | null;
  travas: number | string | null;
  estado_transacao: string | null;
};

/** Variáveis da conta de monitoramento (só nomes; valores nunca impressos). */
export const VARIAVEIS_CONTA_MONITORAMENTO = ['SGH_MONITOR_USUARIO', 'SGH_MONITOR_SENHA'] as const;

export interface AmbienteDoVigia {
  /** O ambiente do núcleo do vigia: a conta de monitoramento no lugar da conta da aplicação, quando configurada. */
  readonly env: Ambiente;
  readonly contaDeMonitoramento: boolean;
  readonly alertas: readonly string[];
}

/** O ambiente do núcleo do vigia do k6: a conta de monitoramento, separada da conta da aplicação. */
export function ambienteDoVigia(env: Ambiente): AmbienteDoVigia {
  const usuario = env['SGH_MONITOR_USUARIO']?.trim();
  const senha = env['SGH_MONITOR_SENHA'];
  if (usuario && senha)
    return {
      env: { ...env, SGH_MARIADB_USUARIO: usuario, MARIADB_SENHA: senha, SGH_PROCESSO: 'k6-vigia' },
      contaDeMonitoramento: true,
      alertas: [],
    };
  return {
    env: { ...env, SGH_PROCESSO: 'k6-vigia' },
    contaDeMonitoramento: false,
    alertas: [
      'conta de monitoramento ausente (SGH_MONITOR_USUARIO/SGH_MONITOR_SENHA): o vigia usa a conta da aplicação, que ' +
        'numa instalação correta não tem PROCESS; a coleta só funciona onde a conta tem privilégio a mais (dev)',
    ],
  };
}

/** A coleta recusada por falta de privilégio (PROCESS ou performance_schema): erro nomeado, sem valores. */
export class ErroPrivilegioDeColeta extends Error {
  constructor(causa: string) {
    super(
      `coleta de transações recusada pelo banco (${causa}): a conta do vigia precisa de PROCESS e de SELECT em ` +
        'performance_schema.session_connect_attrs (conta de monitoramento SGH_MONITOR_USUARIO)',
    );
    this.name = 'ErroPrivilegioDeColeta';
  }
}

const ERRO_DE_PRIVILEGIO = /denied|ER_SPECIFIC_ACCESS_DENIED|ER_TABLEACCESS_DENIED|ER_ACCESS_DENIED/i;

/** Processo sem atributo de conexão (o núcleo ainda não envia program_name): fica sem marca, explícito. */
export const SEM_MARCA = 'sem-marca';

export async function coletarTransacoes(
  l: Leitor,
  o: { readonly banco: string; readonly limiteTransacaoMs: number },
): Promise<ColetaTransacoes> {
  const t0 = performance.now();
  const consulta = l.consultar<LinhaConexao>(
    `SELECT a.ATTR_VALUE AS processo, p.TIME_MS AS tempo_ms,
            TIMESTAMPDIFF(MICROSECOND, t.trx_started, NOW(6)) / 1000 AS transacao_ms,
            t.trx_rows_modified AS linhas_alteradas, t.trx_lock_structs AS travas, t.trx_state AS estado_transacao
       FROM information_schema.PROCESSLIST p
       LEFT JOIN information_schema.INNODB_TRX t ON t.trx_mysql_thread_id = p.ID
       LEFT JOIN performance_schema.session_connect_attrs a
              ON a.PROCESSLIST_ID = p.ID AND a.ATTR_NAME = 'program_name'
      WHERE p.DB = ? AND p.ID <> CONNECTION_ID()`,
    [o.banco],
  );
  let linhas: LinhaConexao[];
  try {
    linhas = [...(await consulta)];
  } catch (e) {
    const codigo = (e as { code?: string }).code ?? (e as Error).name;
    if (ERRO_DE_PRIVILEGIO.test(`${codigo} ${(e as Error).message}`)) throw new ErroPrivilegioDeColeta(codigo);
    throw e;
  }
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  const conexoes: ConexaoColetada[] = linhas.map((x) => ({
    marca: `${o.banco}:${x.processo?.trim() || SEM_MARCA}`,
    transacaoMaisLongaMs: Math.round(n(x.transacao_ms)),
    transacoesEscrita: n(x.linhas_alteradas) > 0 ? 1 : 0,
  }));
  const grupos = new Map<string, PorProcesso>();
  for (const x of linhas) {
    const processo = x.processo?.trim() || SEM_MARCA;
    const g = grupos.get(processo) ?? { processo, conexoes: 0, travas: 0, esperasPorTrava: 0, comandosLongos: 0 };
    grupos.set(processo, {
      processo,
      conexoes: g.conexoes + 1,
      travas: g.travas + n(x.travas),
      esperasPorTrava: g.esperasPorTrava + (x.estado_transacao === 'LOCK WAIT' ? 1 : 0),
      comandosLongos: g.comandosLongos + (n(x.tempo_ms) > o.limiteTransacaoMs ? 1 : 0),
    });
  }
  const alertas = conexoes.some((c) => c.marca.endsWith(`:${SEM_MARCA}`))
    ? ['conexões sem atributo program_name: o processo não é identificável (pedido ao núcleo)']
    : [];
  return {
    conexoesDoNovo: conexoes,
    alertas,
    porProcesso: [...grupos.values()],
    duracaoMs: Math.round(performance.now() - t0),
  };
}
