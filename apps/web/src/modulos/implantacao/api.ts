// M60, etapas 2 e 3: a conferência da instalação e da conexão ao banco (GET /api/administracao/implantacao/conferencia).
// e a fumaça do servidor (GET /api/administracao/implantacao/fumaca, etapa 3). Só leitura. As funções puras de apresentação (contagem por situação, rótulos) ficam aqui para os unitários.
import {
  type ConferenciaInstalacao,
  esquemaConferenciaInstalacao,
  esquemaFumacaServidor,
  type FilaConferida,
  type FumacaServidor,
  ITENS_FUMACA_SERVIDOR,
  type ItemFumaca,
  ROTA_FUMACA_IMPLANTACAO,
  ITENS_CONFERENCIA_INSTALACAO,
  type ItemConferencia,
  ROTA_CONFERENCIA_INSTALACAO,
  type SituacaoItemConferencia,
} from '@sgh/contratos';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

export async function buscarConferenciaInstalacao(
  buscar: typeof fetch = fetch,
): Promise<ConferenciaInstalacao> {
  const r = await buscar(ROTA_CONFERENCIA_INSTALACAO, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaConferenciaInstalacao.parse(await r.json());
}

/** Quantos itens em cada situação (ok, alerta, falha), para o resumo no alto da tela. */
export function contagemPorSituacao(
  itens: readonly { situacao: SituacaoItemConferencia }[] | undefined,
): Record<SituacaoItemConferencia, number> {
  const c: Record<SituacaoItemConferencia, number> = { ok: 0, alerta: 0, falha: 0 };
  for (const i of itens ?? []) c[i.situacao] += 1;
  return c;
}

/** Itens na ordem do contrato (o servidor já manda assim; a tela não depende disso). */
export function itensOrdenados(itens: readonly ItemConferencia[] | undefined): ItemConferencia[] {
  const ordem = new Map<string, number>(ITENS_CONFERENCIA_INSTALACAO.map((c, i) => [c, i]));
  return [...(itens ?? [])].sort((a, b) => (ordem.get(a.codigo) ?? 99) - (ordem.get(b.codigo) ?? 99));
}

/** Texto de sim/não/desconhecido para os campos booleanos opcionais da conexão. */
export function chaveSimNao(v: boolean | null): 'sim' | 'nao' | 'desconhecido' {
  return v === null ? 'desconhecido' : v ? 'sim' : 'nao';
}

/** Os pendentes listados e quantos ficaram de fora da lista (o servidor manda no máximo 20). */
export function pendentesAlemDaLista(c: ConferenciaInstalacao | undefined): number {
  if (!c) return 0;
  return Math.max(0, c.scripts.pendentesTotal - c.scripts.pendentes.length);
}

export async function buscarFumacaServidor(buscar: typeof fetch = fetch): Promise<FumacaServidor> {
  const r = await buscar(ROTA_FUMACA_IMPLANTACAO, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaFumacaServidor.parse(await r.json());
}

/** Itens da fumaça na ordem do contrato. */
export function itensFumacaOrdenados(itens: readonly ItemFumaca[] | undefined): ItemFumaca[] {
  const ordem = new Map<string, number>(ITENS_FUMACA_SERVIDOR.map((c, i) => [c, i]));
  return [...(itens ?? [])].sort((a, b) => (ordem.get(a.codigo) ?? 99) - (ordem.get(b.codigo) ?? 99));
}

/**
 * Deriva entre os relógios em texto curto ("0,4 s", "-2,1 s"); nula quando o banco não respondeu. Positiva: o banco
 * está adiantado.
 */
export function derivaEmSegundos(ms: number | null): string | null {
  if (ms === null) return null;
  return `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

/** Fuso do banco deduzido em texto ("UTC-03:00"); nulo quando não foi lido. */
export function fusoEmTexto(min: number | null): string | null {
  if (min === null) return null;
  const sinal = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sinal}${hh}:${mm}`;
}

/** Contagem que pode faltar (Valkey fora): traço em vez de zero, para não fingir fila vazia. */
export function contagemOuTraco(n: number | null): string {
  return n === null ? '—' : String(n);
}

/** Fila sem nenhum consumidor conectado (o worker não está atendendo); nula = não se sabe. */
export function filaSemConsumidor(f: FilaConferida): boolean | null {
  return f.consumidores === null ? null : f.consumidores === 0;
}

/** Linhas ligadas de uma chave somando os escopos (o escopo pessoa só entra contado). */
export function totalLigadas(c: { hospital: number; setor: number; grupo: number; pessoa: number }): number {
  return c.hospital + c.setor + c.grupo + c.pessoa;
}
