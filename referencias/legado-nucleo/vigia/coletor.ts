// Leitura das tabelas MON$ numa transação curta somente leitura (o Firebird tira um retrato das tabelas
// MON$ no primeiro acesso da transação; as cinco consultas abaixo veem o mesmo retrato). Meta: < 200 ms por
// coleta (ficha do M09, campo 4), a cada 15 s. Nenhuma coluna de texto SQL (MON$SQL_TEXT) nem de usuário
// (MON$USER) é lida. A própria conexão e a própria transação do coletor ficam fora dos agregados.
import type { Ambiente } from '../arquivo-ambiente.js';
import { lerInteiroAmbiente } from '../configuracao.js';
import type { Leitor } from '../transacao.js';
import { VARIAVEL_SISTEMA } from '../pool.js';
import { agregar, type Alerta, type Coleta, type LeituraMon } from './agregacao.js';

export const INTERVALO_COLETA_MS = 15_000;
export const LIMITE_TRANSACAO_PADRAO_MS = 5_000;

export interface ConfiguracaoVigia {
  /** VIGIA_TRANSACAO_LIMITE_MS: de 100 ms a 10 min (NaN desligaria o alerta em silêncio: recusado). */
  readonly limiteTransacaoMs: number;
  /** VIGIA_INTERVALO_MS: de 1 s a 10 min (0 faria o setInterval bater no MON$ a cada ~1 ms: recusado). */
  readonly intervaloMs: number;
}

export function lerConfiguracaoVigia(env: Ambiente): ConfiguracaoVigia {
  return {
    limiteTransacaoMs: lerInteiroAmbiente(
      env,
      'VIGIA_TRANSACAO_LIMITE_MS',
      LIMITE_TRANSACAO_PADRAO_MS,
      100,
      600_000,
    ),
    intervaloMs: lerInteiroAmbiente(env, 'VIGIA_INTERVALO_MS', INTERVALO_COLETA_MS, 1_000, 600_000),
  };
}

const n = (v: unknown) => Number(v ?? 0);

export async function lerMon(l: Leitor): Promise<LeituraMon> {
  const [db] = await l.consultar(
    `SELECT d.MON$OLDEST_TRANSACTION OIT, d.MON$OLDEST_ACTIVE OAT, d.MON$OLDEST_SNAPSHOT OST,
            d.MON$NEXT_TRANSACTION NXT FROM MON$DATABASE d`,
    [],
    { teto: 1 },
  );
  const anexos = await l.consultar(
    `SELECT a.MON$ATTACHMENT_ID ID, a.MON$REMOTE_PROCESS PROC,
            IIF(a.MON$ATTACHMENT_ID = CURRENT_CONNECTION, 1, 0) PROPRIA,
            (SELECT FIRST 1 v.MON$VARIABLE_VALUE FROM MON$CONTEXT_VARIABLES v
              WHERE v.MON$ATTACHMENT_ID = a.MON$ATTACHMENT_ID AND v.MON$VARIABLE_NAME = '${VARIAVEL_SISTEMA}') MARCA
       FROM MON$ATTACHMENTS a WHERE a.MON$SYSTEM_FLAG = 0`,
    [],
    { teto: 5_000 },
  );
  const transacoes = await l.consultar(
    `SELECT t.MON$ATTACHMENT_ID ID, t.MON$READ_ONLY RO,
            DATEDIFF(MILLISECOND FROM t.MON$TIMESTAMP TO CURRENT_TIMESTAMP) MS,
            IIF(t.MON$TRANSACTION_ID = CURRENT_TRANSACTION, 1, 0) PROPRIA
       FROM MON$TRANSACTIONS t`,
    [],
    { teto: 20_000 },
  );
  const comandos = await l.consultar(
    `SELECT s.MON$ATTACHMENT_ID ID, s.MON$STATE ST,
            DATEDIFF(MILLISECOND FROM s.MON$TIMESTAMP TO CURRENT_TIMESTAMP) MS
       FROM MON$STATEMENTS s WHERE s.MON$STATE <> 0`,
    [],
    { teto: 20_000 },
  );
  // Travas por anexo: MON$RECORD_STATS do anexo (Firebird 3: MON$RECORD_LOCKS, _WAITS, _CONFLICTS).
  const travas = await l.consultar(
    `SELECT a.MON$ATTACHMENT_ID ID, r.MON$RECORD_LOCKS L, r.MON$RECORD_WAITS W, r.MON$RECORD_CONFLICTS C
       FROM MON$ATTACHMENTS a JOIN MON$RECORD_STATS r ON r.MON$STAT_ID = a.MON$STAT_ID
      WHERE a.MON$SYSTEM_FLAG = 0`,
    [],
    { teto: 5_000 },
  );
  return {
    banco: { oit: n(db?.['OIT']), oat: n(db?.['OAT']), ost: n(db?.['OST']), proxima: n(db?.['NXT']) },
    anexos: anexos.map((a) => ({
      id: n(a['ID']),
      processo: a['PROC'] === null || a['PROC'] === undefined ? null : String(a['PROC']),
      marca: a['MARCA'] === null || a['MARCA'] === undefined ? null : String(a['MARCA']),
      propria: n(a['PROPRIA']) === 1,
    })),
    transacoes: transacoes.map((t) => ({
      anexo: n(t['ID']),
      somenteLeitura: n(t['RO']) === 1,
      idadeMs: Math.max(0, n(t['MS'])),
      propria: n(t['PROPRIA']) === 1,
    })),
    comandos: comandos.map((c) => ({
      anexo: n(c['ID']),
      estado: n(c['ST']),
      idadeMs: Math.max(0, n(c['MS'])),
    })),
    travas: travas.map((t) => ({
      anexo: n(t['ID']),
      travas: n(t['L']),
      esperas: n(t['W']),
      conflitos: n(t['C']),
    })),
  };
}

export interface OpcoesColeta {
  readonly estabelecimento: string;
  readonly limiteTransacaoMs?: number;
  readonly alertasExternos?: readonly Alerta[];
}

/** Uma coleta completa (leitura + agregação), com a duração medida. */
export async function coletar(l: Leitor, o: OpcoesColeta): Promise<Coleta> {
  const inicio = performance.now();
  const leitura = await lerMon(l);
  return agregar(leitura, {
    estabelecimento: o.estabelecimento,
    limiteTransacaoMs: o.limiteTransacaoMs ?? LIMITE_TRANSACAO_PADRAO_MS,
    em: new Date().toISOString(),
    duracaoMs: Math.round(performance.now() - inicio),
    ...(o.alertasExternos ? { alertasExternos: o.alertasExternos } : {}),
  });
}
