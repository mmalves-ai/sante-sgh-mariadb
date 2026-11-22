// Saúde das conexões do banco do cliente e avisos de colisão (M04, tela "Saúde das conexões"): os pools do processo
// (@sgh/nucleo), as conexões e transações abertas no banco do cliente (information_schema do MariaDB) e as colisões
// contadas pelo Executor deste processo (conflito de versão e trava ocupada). Só leitura; só contagens.
// Melhoria: sem a "conferência de gravação" do sistema de origem (gatilhos, geradores e sentinelas, ADR 0003): o
// produto não grava por gatilho, e cada operação tem o seu contrato de efeito em teste.
import { esquemaPainelConexoes, type PainelConexoes } from '@sgh/contratos';
import type { EstadoPool, Leitor, MetricasExecutor } from '@sgh/nucleo';

export const METRICAS_EXECUTOR = Symbol('METRICAS_EXECUTOR');
export const FONTE_GRAVACAO = Symbol('FONTE_GRAVACAO');

/** Transação aberta há mais que isto conta como longa (padrão). */
export const LIMITE_TRANSACAO_MS = 30_000;

/** O que a fonte usa do NucleoProprio (os testes trocam). */
export interface NucleoLeitura {
  estadosDosPools(): EstadoPool[];
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

export interface FonteGravacao {
  painelConexoes(): Promise<PainelConexoes>;
}

type Coleta = NonNullable<PainelConexoes['coletas'][string]>;

/** Conexões por conta do banco e transações abertas no banco do cliente (só contagens). */
export async function coletarConexoes(l: Leitor, limiteTransacaoMs: number, agora: Date): Promise<Coleta> {
  const porConta = await l.consultar<{ sistema: string; conexoes: number }>(
    `SELECT USER AS sistema, COUNT(*) AS conexoes FROM information_schema.PROCESSLIST
      WHERE DB = DATABASE() GROUP BY USER ORDER BY USER`,
    [],
    { teto: 500 },
  );
  const trx = await l.consultar<{ sistema: string; transacoes: number; longas: number; esperas: number }>(
    `SELECT p.USER AS sistema, COUNT(*) AS transacoes,
            SUM(CASE WHEN TIMESTAMPDIFF(MICROSECOND, t.trx_started, NOW(6)) / 1000 > ? THEN 1 ELSE 0 END) AS longas,
            SUM(CASE WHEN t.trx_state = 'LOCK WAIT' THEN 1 ELSE 0 END) AS esperas
       FROM information_schema.INNODB_TRX t
       JOIN information_schema.PROCESSLIST p ON p.ID = t.trx_mysql_thread_id
      WHERE p.DB = DATABASE() GROUP BY p.USER`,
    [limiteTransacaoMs],
    { teto: 500 },
  );
  const porSistema = porConta.map((c) => {
    const t = trx.find((x) => x.sistema === c.sistema);
    return {
      sistema: String(c.sistema),
      conexoes: Number(c.conexoes),
      transacoes: Number(t?.transacoes ?? 0),
    };
  });
  const longas = trx.reduce((a, t) => a + Number(t.longas ?? 0), 0);
  const esperas = trx.reduce((a, t) => a + Number(t.esperas ?? 0), 0);
  return {
    em: agora.toISOString(),
    porSistema,
    transacoesAcimaDoLimite: longas,
    esperasPorTrava: esperas,
    alertas: longas + esperas,
  };
}

export function criarFonteGravacao(opcoes: {
  /** Código do cliente (o banco é cliente_<codigo>). */
  readonly cliente: string;
  readonly rede: string;
  readonly metricas: MetricasExecutor;
  readonly nucleo: NucleoLeitura | null;
  readonly limiteTransacaoMs?: number;
}): FonteGravacao {
  return {
    async painelConexoes() {
      const n = opcoes.nucleo;
      const coletas: PainelConexoes['coletas'] = {};
      if (n) {
        try {
          coletas[opcoes.cliente] = await n.lerSomente(
            { cliente: opcoes.cliente, correlacao: 'saude-conexoes' },
            (l) => coletarConexoes(l, opcoes.limiteTransacaoMs ?? LIMITE_TRANSACAO_MS, new Date()),
          );
        } catch {
          coletas[opcoes.cliente] = null;
        }
      } else coletas[opcoes.cliente] = null;
      const resumo = opcoes.metricas.resumo();
      return esquemaPainelConexoes.parse({
        rede: opcoes.rede,
        pools: n
          ? n.estadosDosPools().map((p) => ({
              estabelecimento: p.banco,
              abertas: p.total,
              livres: p.ociosas,
              emUso: p.ativas,
              esperando: 0,
              sysdbaDev: false,
            }))
          : [],
        coletas,
        colisoes: Object.entries(resumo)
          .map(([operacao, d]) => ({ operacao, total: (d['conflito-versao'] ?? 0) + (d.trava ?? 0) }))
          .filter((c) => c.total > 0)
          .map((c) => ({
            operacao: c.operacao,
            estabelecimento: opcoes.cliente,
            porHora: { total: c.total },
          })),
        limitacao:
          'Colisões: as do Executor deste processo da API desde a partida (sem divisão por hora). ' +
          'As conexões de outras contas do banco só aparecem quando a conta da API tem o privilégio PROCESS.',
      });
    },
  };
}
