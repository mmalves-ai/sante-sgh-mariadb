// Revisão do W0-02 (D-CRUD-SEM-GATILHO): a RODADA PERIÓDICA da vigia de reconciliação dos cadastros. A base (leitura da
// contagem, do checksum e das chaves; achados; relatório) está em @sgh/legado (nucleo/gravacao/vigia-reconciliacao.ts);
// aqui ela ganha o despertar: a cada `intervaloMs`, para cada estabelecimento configurado, uma transação SGH_ da fonte
// dos domínios (as leituras do legado passam; as gravações só em SGH_) roda `rodarVigia`, que só lê e grava quando o
// parâmetro `crud.vigiaReconciliacao` está ligado no estabelecimento ou na rede. Uma rodada de cada vez; a falha de uma
// rodada não derruba a API (vai à telemetria, sem dado de pessoa). Só com a fonte do banco: a fonte em memória não tem
// as tabelas de domínio inteiras nem a SQL da contagem, e o relatório responde vazio.
import {
  DECLARACOES,
  type LinhaRelatorioExclusoesFora,
  relatorioExclusoesFora,
  rodarVigia,
} from '@sgh/legado';
import type { FonteDominios } from './dominios-fonte.js';

export const VIGIA_RECONCILIACAO = Symbol('VIGIA_RECONCILIACAO');
/** Uma rodada por hora (as tabelas de domínio mudam pouco; a leitura é só de chaves). */
export const INTERVALO_VIGIA_RECONCILIACAO_MS = 60 * 60_000;

export interface ResumoRodada {
  readonly hospital: string;
  readonly ligada: boolean;
  readonly tabelas: number;
  readonly achados: number;
  readonly erro?: string;
}

export class VigiaReconciliacaoCrud {
  private timer: ReturnType<typeof setInterval> | null = null;
  private emRodada = false;
  /** A última rodada por estabelecimento (para a tela: quando rodou e se estava ligada). */
  private readonly ultimas = new Map<string, ResumoRodada & { readonly em: string }>();

  constructor(
    private readonly fonte: FonteDominios,
    private readonly rede: string,
    private readonly hospitais: readonly string[],
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Uma rodada no estabelecimento (transação SGH_ confirmada; desligada pelo parâmetro: nada lido nem gravado). */
  async rodada(hospital: string): Promise<ResumoRodada> {
    if (this.fonte.destino !== 'legado') return { hospital, ligada: false, tabelas: 0, achados: 0 };
    let r: ResumoRodada;
    try {
      const x = await this.fonte.gravarSgh(this.rede, hospital, (e) => rodarVigia(e, hospital, DECLARACOES));
      r = { hospital, ligada: x.ligada, tabelas: x.tabelas, achados: x.achados.length };
    } catch (e) {
      r = {
        hospital,
        ligada: true,
        tabelas: 0,
        achados: 0,
        erro: e instanceof Error ? e.message.slice(0, 200) : 'falha',
      };
    }
    this.ultimas.set(hospital, { ...r, em: this.agora().toISOString() });
    return r;
  }

  /** A última rodada do estabelecimento (ou null: ainda não rodou neste processo). */
  ultima(hospital: string): (ResumoRodada & { readonly em: string }) | null {
    return this.ultimas.get(hospital) ?? null;
  }

  /** O relatório "exclusões feitas fora do sistema" do estabelecimento (fonte em memória: vazio). */
  async relatorio(
    hospital: string,
    rotulo: (tabela: string) => string | undefined,
    desde?: Date,
  ): Promise<LinhaRelatorioExclusoesFora[]> {
    if (this.fonte.destino !== 'legado') return [];
    return this.fonte.ler(this.rede, hospital, (l) => relatorioExclusoesFora(l, hospital, rotulo, desde));
  }

  /** Liga o despertar (uma rodada por estabelecimento a cada `intervaloMs`; uma rodada de cada vez). */
  iniciar(intervaloMs = INTERVALO_VIGIA_RECONCILIACAO_MS): void {
    if (this.timer || this.hospitais.length === 0 || this.fonte.destino !== 'legado') return;
    this.timer = setInterval(() => void this.rodarTodos(), intervaloMs);
    this.timer.unref?.();
  }

  /** Uma rodada em todos os estabelecimentos (pulada quando a anterior ainda corre). */
  async rodarTodos(): Promise<readonly ResumoRodada[]> {
    if (this.emRodada) return [];
    this.emRodada = true;
    try {
      const r: ResumoRodada[] = [];
      for (const h of this.hospitais) r.push(await this.rodada(h));
      return r;
    } finally {
      this.emRodada = false;
    }
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get ligadoODespertar(): boolean {
    return this.timer !== null;
  }
}
