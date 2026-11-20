// Relay da outbox (ficha do M04, seção 1; cap-09 §9.10): lê SGH_OUTBOX pendente em ordem de ID por
// estabelecimento, publica cada evento (no worker, no BullMQ com a chave do evento como jobId: republicar
// não duplica) e marca publicado; falha vai para nova tentativa com espera crescente e, esgotadas as
// tentativas, para `morto`. A primeira falha para o lote daquele estabelecimento (a ordem é preservada).
// O publicador é injetado: o adaptador não conhece fila nem Valkey.
import type { Escritor, Leitor } from '../transacao.js';
import { lerPendentesOutbox, marcarFalha, marcarPublicado, type PendenteOutbox } from './tecnicas.js';

export interface ConfiguracaoRelay {
  /** Eventos por ciclo, por estabelecimento. */
  readonly lote: number;
  /** Tentativas antes de `morto`. */
  readonly tentativas: number;
  /** Primeira espera; dobra a cada falha, até o teto. */
  readonly esperaInicialS: number;
  readonly esperaMaximaS: number;
}

export const CONFIGURACAO_RELAY_PADRAO: ConfiguracaoRelay = Object.freeze({
  lote: 100,
  tentativas: 8,
  esperaInicialS: 2,
  esperaMaximaS: 600,
});

export interface AcessoRelay {
  ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T>;
  /** Transação curta confirmada (marcar publicado ou a falha). */
  escrever<T>(fn: (e: Escritor) => Promise<T>): Promise<T>;
}

export type Publicador = (evento: PendenteOutbox) => Promise<void>;

export interface ResultadoCiclo {
  readonly lidos: number;
  readonly publicados: number;
  readonly falhas: number;
  readonly mortos: number;
}

/** Espera da próxima tentativa: inicial × 2^tentativas, até o teto. */
export function esperaDaTentativa(tentativas: number, cfg: ConfiguracaoRelay): number {
  return Math.min(cfg.esperaMaximaS, cfg.esperaInicialS * 2 ** Math.max(0, tentativas));
}

/** Mensagem curta da falha (sem dado: só o nome e o começo da mensagem do publicador). */
function resumoFalha(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : 'falha ao publicar';
}

export async function cicloRelay(
  acesso: AcessoRelay,
  hospital: string,
  publicar: Publicador,
  cfg: ConfiguracaoRelay = CONFIGURACAO_RELAY_PADRAO,
): Promise<ResultadoCiclo> {
  const pendentes = await acesso.ler((l) => lerPendentesOutbox(l, hospital, cfg.lote));
  let publicados = 0;
  let falhas = 0;
  let mortos = 0;
  for (const ev of pendentes) {
    try {
      await publicar(ev);
    } catch (e) {
      falhas++;
      const situacao = await acesso.escrever((w) =>
        marcarFalha(
          w,
          ev.id,
          ev.tentativas,
          cfg.tentativas,
          esperaDaTentativa(ev.tentativas, cfg),
          resumoFalha(e),
        ),
      );
      if (situacao === 'morto') mortos++;
      break; // ordem por ID: os seguintes esperam o próximo ciclo
    }
    await acesso.escrever((w) => marcarPublicado(w, ev.id));
    publicados++;
  }
  return { lidos: pendentes.length, publicados, falhas, mortos };
}
