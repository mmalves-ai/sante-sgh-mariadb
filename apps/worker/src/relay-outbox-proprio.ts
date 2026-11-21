// Ciclo do relay da fila comum de saída (outbox) sobre o banco próprio do cliente (ficha do M04; lote F2.2 05-16): lê as
// mensagens de saída pendentes de `integracao_mensagem` em ordem de id, publica cada uma (BullMQ, jobId = chave do
// evento: republicar não duplica) e marca enviada; a falha soma a tentativa com espera crescente e, esgotadas, a
// mensagem fica em erro (a fila de mortos da tela de integrações). Só ids, códigos e contagens no log e no erro.
// Dado do cliente inteiro: a fila comum leva as mensagens de todos os estabelecimentos e as do cliente (sem
// estabelecimento); o relay é um só por cliente.
// A marcação é infraestrutura da fila (não é operação de negócio): vai numa transação curta do núcleo, condicionada à
// situação pendente (dois relays não marcam duas vezes), sem trilha própria (a operação que gravou a mensagem já tem a
// sua). Pedido ao integrador: levar este ciclo para o @sgh/nucleo, como era no núcleo antigo.
// Melhoria: a espera entre tentativas e o teto de tentativas ficam na mensagem (proxima_tentativa_em, tentativas), não
// em memória; a mensagem esgotada vai a `erro` com o motivo em código, nunca com o conteúdo.
import type { Escritor, Leitor } from '@sgh/nucleo';
import type { PendenteOutbox, Publicador } from './relay-outbox.js';

export const TETO_RELAY = 100;
export const MAX_TENTATIVAS_RELAY = 8;

export interface NucleoRelay {
  lerSomente<T>(contexto: { readonly cliente: string; readonly correlacao: string }, fn: (l: Leitor) => Promise<T>): Promise<T>;
  escrever<T>(contexto: { readonly cliente: string; readonly correlacao: string }, fn: (e: Escritor) => Promise<T>): Promise<T>;
}

/** Espera antes da tentativa seguinte (ms): 2^n segundos, até 10 minutos. */
export function esperaDaTentativa(tentativas: number): number {
  return Math.min(2 ** Math.max(0, tentativas) * 1_000, 600_000);
}

function cargaDoConteudo(conteudo: unknown): Record<string, string | number | boolean | null> {
  if (conteudo === null || conteudo === undefined) return {};
  try {
    const v = typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const r: Record<string, string | number | boolean | null> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>))
      if (x === null || ['string', 'number', 'boolean'].includes(typeof x)) r[k] = x as string | number | boolean | null;
    return r;
  } catch {
    return {};
  }
}

/** As mensagens de saída pendentes e vencidas (`estabelecimento`: só as dele, para os testes isolarem a massa). */
export async function pendentesOutbox(
  l: Leitor,
  cliente: string,
  agora: Date,
  opcoes: { readonly teto?: number; readonly estabelecimento?: number } = {},
): Promise<PendenteOutbox[]> {
  const teto = Math.max(1, Math.min(TETO_RELAY, Math.trunc(opcoes.teto ?? TETO_RELAY)));
  const filtro = opcoes.estabelecimento === undefined ? '' : ' AND m.estabelecimento_id = ?';
  const linhas = await l.consultar(
    `SELECT m.id, m.ponto, m.referencia_externa, m.conteudo, m.tentativas, e.codigo AS estabelecimento
       FROM integracao_mensagem m LEFT JOIN estabelecimento e ON e.id = m.estabelecimento_id
      WHERE m.direcao = 'saida' AND m.situacao = 'pendente'
        AND (m.proxima_tentativa_em IS NULL OR m.proxima_tentativa_em <= ?)${filtro}
      ORDER BY m.id LIMIT ${teto}`,
    opcoes.estabelecimento === undefined ? [agora] : [agora, opcoes.estabelecimento],
    { teto },
  );
  return linhas.map((x) => ({
    id: String(x['id']),
    cliente,
    hospital: x['estabelecimento'] === null || x['estabelecimento'] === undefined ? null : String(x['estabelecimento']),
    tipo: String(x['ponto']),
    chave: String(x['referencia_externa'] ?? `mensagem-${String(x['id'])}`),
    carga: cargaDoConteudo(x['conteudo']),
    tentativas: Number(x['tentativas'] ?? 0),
  }));
}

export interface ResultadoRelay {
  readonly lidos: number;
  readonly publicados: number;
  readonly falhas: number;
  readonly esgotados: number;
}

/** Um ciclo do relay no cliente. */
export async function cicloRelayOutbox(
  nucleo: NucleoRelay,
  cliente: string,
  publicar: Publicador,
  opcoes: { readonly agora?: () => Date; readonly teto?: number; readonly estabelecimento?: number } = {},
): Promise<ResultadoRelay> {
  const agora = opcoes.agora ?? (() => new Date());
  const ctx = { cliente, correlacao: 'relay-outbox' };
  const pendentes = await nucleo.lerSomente(ctx, (l) => pendentesOutbox(l, cliente, agora(), opcoes));
  let publicados = 0;
  let falhas = 0;
  let esgotados = 0;
  for (const ev of pendentes) {
    try {
      await publicar(ev);
    } catch (e) {
      const n = ev.tentativas + 1;
      const esgotou = n >= MAX_TENTATIVAS_RELAY;
      const t = agora();
      await nucleo.escrever(ctx, (w) =>
        w.executar(
          `UPDATE integracao_mensagem SET tentativas = ?, proxima_tentativa_em = ?, situacao = ?, erro = ?,
                  alterado_em = ?, versao = versao + 1
            WHERE id = ? AND situacao = 'pendente'`,
          [
            n,
            new Date(t.getTime() + esperaDaTentativa(n)),
            esgotou ? 'erro' : 'pendente',
            `publicacao-falhou:${e instanceof Error ? e.name : 'erro'}`.slice(0, 200),
            t,
            Number(ev.id),
          ],
        ),
      );
      falhas++;
      if (esgotou) esgotados++;
      continue;
    }
    const t = agora();
    await nucleo.escrever(ctx, (w) =>
      w.executar(
        `UPDATE integracao_mensagem SET situacao = 'enviada', processada_em = ?, erro = NULL, alterado_em = ?,
                versao = versao + 1
          WHERE id = ? AND situacao = 'pendente'`,
        [t, t, Number(ev.id)],
      ),
    );
    publicados++;
  }
  return { lidos: pendentes.length, publicados, falhas, esgotados };
}
