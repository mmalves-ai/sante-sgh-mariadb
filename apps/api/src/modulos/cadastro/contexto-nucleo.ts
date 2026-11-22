// Contexto do núcleo da sessão (F2.2): o cliente da API (um banco por cliente: CLIENTE_PADRAO), o estabelecimento ativo
// por id e o usuário por id, para as portas próprias e o Executor do @sgh/nucleo. A sessão guarda o código do
// estabelecimento; o id vem do mapa código → id do banco do cliente, lido na partida do módulo e relido em segundo
// plano. Sem o mapa (memória de dev/ci, ou o código ainda não lido), o estabelecimento fica null: a porta própria
// resolve pelo código na própria leitura (falha fechada na gravação, nunca outro estabelecimento).
import type { Leitor } from '@sgh/nucleo';

/** O que o mapa usa do NucleoProprio (os testes trocam). */
export interface NucleoDoMapa {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

/** Releitura do mapa de estabelecimentos depois deste prazo (o mesmo da fonte de acesso). */
export const RELEITURA_MAPA_MS = 60_000;

export class MapaEstabelecimentos {
  private ids = new Map<string, number>();
  private lidoEm = 0;
  private lendo: Promise<void> | null = null;

  constructor(
    readonly cliente: string,
    private readonly nucleo: NucleoDoMapa,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Lê (ou relê) o mapa; uma leitura por vez. Falha: mantém o mapa anterior. */
  carregar(): Promise<void> {
    if (!this.lendo)
      this.lendo = this.nucleo
        .lerSomente({ cliente: this.cliente, correlacao: 'mapa-estabelecimentos' }, (l) =>
          l.consultar<{ id: unknown; codigo: unknown }>(
            'SELECT id, codigo FROM estabelecimento WHERE excluido_em IS NULL',
            [],
            { teto: 10_000 },
          ),
        )
        .then((linhas) => {
          this.ids = new Map(linhas.map((l) => [String(l.codigo), Number(l.id)]));
          this.lidoEm = this.agora();
        })
        .catch(() => undefined)
        .finally(() => {
          this.lendo = null;
        });
    return this.lendo;
  }

  /** Id do estabelecimento pelo código (null: desconhecido). Mapa vencido ou código ausente: relê em segundo plano. */
  idDe(codigo: string): number | null {
    const id = this.ids.get(codigo) ?? null;
    if (id === null || this.agora() - this.lidoEm > RELEITURA_MAPA_MS) void this.carregar();
    return id;
  }
}

let mapaAtivo: MapaEstabelecimentos | null = null;

/**
 * Liga o mapa da API (uma vez por processo; o mesmo cliente). Chamado pela montagem dos módulos migrados com o núcleo
 * (cadastro/modulo.ts); devolve o mapa ativo.
 */
export async function ligarMapaEstabelecimentos(
  cliente: string,
  nucleo: NucleoDoMapa,
): Promise<MapaEstabelecimentos> {
  if (mapaAtivo && mapaAtivo.cliente === cliente) return mapaAtivo;
  const m = new MapaEstabelecimentos(cliente, nucleo);
  await m.carregar();
  mapaAtivo = m;
  return m;
}

/** Desliga o mapa (testes). */
export function desligarMapaEstabelecimentos(): void {
  mapaAtivo = null;
}

/** Cliente e estabelecimento da sessão pelo mapa ativo (sem mapa: cliente vazio e estabelecimento null). */
export function contextoDoEstabelecimento(codigo: string): {
  cliente: string;
  estabelecimento: number | null;
} {
  return mapaAtivo
    ? { cliente: mapaAtivo.cliente, estabelecimento: mapaAtivo.idDe(codigo) }
    : { cliente: '', estabelecimento: null };
}

/** Id numérico do usuário da sessão (o administrador da plataforma e contas sintéticas sem id numérico: null). */
export function idUsuarioDaSessao(id: string | null | undefined): number | null {
  return id && /^\d{1,15}$/.test(id) && Number(id) > 0 ? Number(id) : null;
}
