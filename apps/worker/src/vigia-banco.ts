// Vigia do banco próprio no worker (no lugar da vigia do banco de origem, M09; lote F2.2 05-17): a cada VIGIA_BANCO_MS
// (padrão 15 s) mede as transações abertas no servidor MariaDB (information_schema.INNODB_TRX: quantas, de escrita, a
// mais longa, as acima do limite VIGIA_TRANSACAO_LIMITE_MS e as esperando trava), o estado dos pools por banco de
// cliente, a plataforma e a neutralização. Só contagens e durações: nunca o texto SQL de outra conexão nem dado de linha.
// Melhoria: a configuração é validada na partida (faixas; fora da faixa o vigia não sobe e o log diz a chave).
// Melhoria: sem o privilégio PROCESS a coleta das transações devolve "sem permissão" (null) e o resto do vigia segue,
// em vez de falhar o ciclo inteiro.
// Melhoria: as transações paradas esperando trava viram alerta próprio (antes só a duração era vigiada).
import { type Leitor, lerInteiroAmbiente } from '@sgh/nucleo';

export interface ConfiguracaoVigiaBanco {
  readonly intervaloMs: number;
  readonly limiteTransacaoMs: number;
}

export function lerConfiguracaoVigiaBanco(env: NodeJS.ProcessEnv): ConfiguracaoVigiaBanco {
  return {
    intervaloMs: lerInteiroAmbiente(env, 'VIGIA_BANCO_MS', 15_000, 5_000, 3_600_000),
    limiteTransacaoMs: lerInteiroAmbiente(env, 'VIGIA_TRANSACAO_LIMITE_MS', 5_000, 500, 600_000),
  };
}

export interface ColetaTransacoes {
  readonly abertas: number;
  readonly escrita: number;
  readonly maisLongaMs: number;
  readonly acimaDoLimite: number;
  readonly esperandoTrava: number;
}

export interface SaudeVigiada {
  readonly plataforma: boolean;
  readonly neutralizacao: boolean;
}

export interface AlertaVigiaBanco {
  readonly tipo: 'plataforma-fora' | 'neutralizacao-falhou' | 'transacao-longa' | 'espera-trava';
  readonly detalhe: string;
  readonly quantidade: number;
}

/** A falha é de privilégio (o usuário do worker sem PROCESS)? */
export function semPermissao(e: unknown): boolean {
  const o = (e ?? {}) as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
  const c = (o.cause ?? {}) as { code?: unknown; errno?: unknown; message?: unknown };
  const texto = [o.code, o.errno, o.message, c.code, c.errno, c.message]
    .map((x) => String(x ?? ''))
    .join(' ');
  return /ER_SPECIFIC_ACCESS_DENIED|ER_DBACCESS_DENIED|ER_TABLEACCESS_DENIED|\b1227\b|\b1044\b|\b1142\b|access denied/i.test(
    texto,
  );
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** As transações abertas no servidor (null: sem permissão para ver). */
export async function coletarTransacoes(l: Leitor, limiteMs: number): Promise<ColetaTransacoes | null> {
  try {
    const r = await l.uma(
      `SELECT COUNT(*) AS abertas,
              COALESCE(SUM(trx_is_read_only = 0), 0) AS escrita,
              COALESCE(MAX(TIMESTAMPDIFF(MICROSECOND, trx_started, NOW(6))), 0) AS mais_longa_us,
              COALESCE(SUM(TIMESTAMPDIFF(MICROSECOND, trx_started, NOW(6)) > ?), 0) AS acima,
              COALESCE(SUM(trx_state = 'LOCK WAIT'), 0) AS esperando
         FROM information_schema.INNODB_TRX`,
      [limiteMs * 1000],
    );
    return {
      abertas: n(r?.['abertas']),
      escrita: n(r?.['escrita']),
      maisLongaMs: Math.round(n(r?.['mais_longa_us']) / 1000),
      acimaDoLimite: n(r?.['acima']),
      esperandoTrava: n(r?.['esperando']),
    };
  } catch (e) {
    if (semPermissao(e)) return null;
    throw e;
  }
}

/** Os alertas da rodada (regra pura: só contagens e durações). */
export function alertasDaColeta(
  saude: SaudeVigiada,
  coleta: ColetaTransacoes | null,
  limiteMs: number,
): AlertaVigiaBanco[] {
  const a: AlertaVigiaBanco[] = [];
  if (!saude.plataforma)
    a.push({ tipo: 'plataforma-fora', detalhe: 'banco plataforma sem resposta', quantidade: 1 });
  if (!saude.neutralizacao)
    a.push({ tipo: 'neutralizacao-falhou', detalhe: 'neutralização de saídas reprovada', quantidade: 1 });
  if (coleta && coleta.acimaDoLimite > 0)
    a.push({
      tipo: 'transacao-longa',
      detalhe: `transação aberta há ${coleta.maisLongaMs} ms (limite ${limiteMs} ms)`,
      quantidade: coleta.acimaDoLimite,
    });
  if (coleta && coleta.esperandoTrava > 0)
    a.push({ tipo: 'espera-trava', detalhe: 'transação esperando trava', quantidade: coleta.esperandoTrava });
  return a;
}
