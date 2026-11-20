// Tempo das tarefas-chave (cap-15 §15.3.4: abrir prontuário, prescrever, chamar senha, dispensar): o gancho de resposta
// da API (app.ts, o mesmo do histograma do M09) entrega aqui a duração das rotas dessas tarefas; o painel de
// indicadores mostra o p50 e o p95 do dia e o processo da API grava o dia em SGH_CFG_COEX_USO_DIA (operação
// `tarefa:<id>`, setor `*`). Só durações e contagens; nenhum parâmetro da rota (o padrão da rota, nunca a URL).
// As amostras ficam por estabelecimento (rede e hospital da sessão da requisição): o painel e a gravação de um
// estabelecimento nunca veem as do outro; requisição sem estabelecimento ativo não entra na conta.

/** As tarefas-chave e o padrão de rota (do Fastify) de cada uma. */
export const TAREFAS_CHAVE = [
  {
    id: 'abrir-prontuario',
    titulo: 'Abrir prontuário',
    metodo: 'GET',
    rota: /\/pep\/prontuario\/:paciente$/,
  },
  {
    id: 'prescrever',
    titulo: 'Prescrever',
    metodo: 'POST',
    rota: /\/pep\/prescricao\/:paciente\/prescrever$/,
  },
  { id: 'chamar-senha', titulo: 'Chamar senha', metodo: 'POST', rota: /\/senhas\/chamar$/ },
  { id: 'dispensar', titulo: 'Dispensar', metodo: 'POST', rota: /\/farmacia\/(ambulatorial\/)?dispensar$/ },
] as const;

const LIMITE_AMOSTRAS = 5_000;

/** Percentil por posição (amostras ordenadas); null sem amostra. */
export function percentil(ordenadas: readonly number[], p: number): number | null {
  if (ordenadas.length === 0) return null;
  const i = Math.min(ordenadas.length - 1, Math.max(0, Math.ceil((p / 100) * ordenadas.length) - 1));
  return Math.round(ordenadas[i]!);
}

export class MedidorTarefas {
  private dia = '';
  /** Chave `rede|hospital` → tarefa → amostras do dia. */
  private readonly amostras = new Map<string, Map<string, number[]>>();

  constructor(private readonly hoje: () => string = () => new Date().toISOString().slice(0, 10)) {}

  private static chave(rede: string, hospital: string): string {
    return `${rede}|${hospital}`;
  }

  registrar(
    estabelecimento: { readonly rede: string; readonly hospital: string } | null,
    rota: string,
    metodo: string,
    status: number,
    ms: number,
  ): void {
    if (!estabelecimento?.hospital) return;
    if (status >= 400) return;
    const t = TAREFAS_CHAVE.find((x) => x.metodo === metodo && x.rota.test(rota));
    if (!t) return;
    const d = this.hoje();
    if (d !== this.dia) {
      this.dia = d;
      this.amostras.clear();
    }
    const k = MedidorTarefas.chave(estabelecimento.rede, estabelecimento.hospital);
    const doEstab = this.amostras.get(k) ?? new Map<string, number[]>();
    const l = doEstab.get(t.id) ?? [];
    if (l.length >= LIMITE_AMOSTRAS) l.splice(0, l.length - LIMITE_AMOSTRAS + 1);
    l.push(ms);
    doEstab.set(t.id, l);
    this.amostras.set(k, doEstab);
  }

  /** O p50 e o p95 do dia por tarefa no estabelecimento (as quatro sempre aparecem; sem amostra, nulos). */
  doDia(estabelecimento: { readonly rede: string; readonly hospital: string }): {
    dia: string;
    tarefa: string;
    titulo: string;
    amostras: number;
    p50Ms: number | null;
    p95Ms: number | null;
  }[] {
    const hoje = this.hoje();
    const dia = this.dia || hoje;
    // O dia virou sem requisição nova: as amostras de ontem não aparecem como de hoje.
    const doEstab =
      dia === hoje
        ? this.amostras.get(MedidorTarefas.chave(estabelecimento.rede, estabelecimento.hospital))
        : undefined;
    return TAREFAS_CHAVE.map((t) => {
      const l = [...(doEstab?.get(t.id) ?? [])].sort((a, b) => a - b);
      return {
        dia: hoje,
        tarefa: t.id,
        titulo: t.titulo,
        amostras: l.length,
        p50Ms: percentil(l, 50),
        p95Ms: percentil(l, 95),
      };
    });
  }
}

/** O medidor do processo da API (o gancho de resposta registra; o painel lê). */
export const MEDIDOR_TAREFAS = new MedidorTarefas();
