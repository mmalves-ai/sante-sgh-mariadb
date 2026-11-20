// Vigia dos horários da enfermagem (ficha do M25, regra 10 e seção 4 "Vigia de suspensões feitas no legado"): enquanto
// houver uma tela da beira do leito aberta no estabelecimento, lê a cada 1 a 2 segundos as mudanças de situação dos
// horários da janela (12 horas para trás e para frente do relógio do banco), pelo índice do horário previsto, e avisa as
// telas (canal de eventos) quando um horário mudou: a suspensão feita na prescrição (neste ou no outro sistema) e a
// checagem feita em outro terminal aparecem em até 2 segundos. Sem ouvinte, nada é lido.
import { mudancasDeSituacao, somarMinutos } from '@sgh/dominio-enfermagem';
import type { PortaEnfermagem } from './porta.js';

type Ouvinte = (e?: unknown) => void;

interface EstadoVigia {
  ouvintes: Set<Ouvinte>;
  temporizador: ReturnType<typeof setTimeout> | null;
  vistos: Map<number, string>;
  desde: string | null;
}

export const INTERVALO_VIGIA_ENFERMAGEM_MS = 1_500;

export class VigiaHorarios {
  private readonly estados = new Map<string, EstadoVigia>();

  constructor(
    private readonly porta: PortaEnfermagem,
    private readonly rede: string,
    private readonly intervaloMs = INTERVALO_VIGIA_ENFERMAGEM_MS,
    private readonly aviso: (m: string) => void = () => undefined,
  ) {}

  /** A assinatura no formato do vigia do M16 (o canal é ignorado: a enfermagem tem o dela). */
  assinar(hospital: string, _canal: unknown, ouvinte: (e: never) => void): () => void {
    let e = this.estados.get(hospital);
    if (!e) {
      e = { ouvintes: new Set(), temporizador: null, vistos: new Map(), desde: null };
      this.estados.set(hospital, e);
    }
    e.ouvintes.add(ouvinte as Ouvinte);
    this.agendar(hospital, e, 0);
    return () => {
      e.ouvintes.delete(ouvinte as Ouvinte);
      if (e.ouvintes.size === 0 && e.temporizador) {
        clearTimeout(e.temporizador);
        e.temporizador = null;
      }
    };
  }

  private agendar(hospital: string, e: EstadoVigia, ms: number) {
    if (e.temporizador || e.ouvintes.size === 0) return;
    e.temporizador = setTimeout(() => {
      e.temporizador = null;
      void this.ciclo(hospital).finally(() => this.agendar(hospital, e, this.intervaloMs));
    }, ms);
    e.temporizador.unref?.();
  }

  /** Um ciclo: as mudanças desde a última leitura; havendo alguma nova, avisa os ouvintes. */
  async ciclo(hospital: string): Promise<number> {
    const e = this.estados.get(hospital);
    if (!e) return 0;
    try {
      const c = { rede: this.rede, hospital };
      const agora = (await this.porta.relogio(c)).slice(0, 16);
      const desde = e.desde ?? somarMinutos(agora, -1);
      const ms = await this.porta.mudancas(c, {
        inicio: somarMinutos(agora, -720),
        fim: somarMinutos(agora, 720),
        desde,
      });
      const depois = new Map(e.vistos);
      for (const m of ms) depois.set(m.id, m.situacao);
      const novas =
        mudancasDeSituacao(e.vistos, depois).length + ms.filter((m) => !e.vistos.has(m.id)).length;
      e.vistos = depois;
      e.desde = desde > agora ? desde : somarMinutos(agora, -1);
      if (novas > 0) for (const o of [...e.ouvintes]) o();
      return novas;
    } catch (x) {
      this.aviso(`vigia da enfermagem: ${x instanceof Error ? x.message : String(x)}`);
      return 0;
    }
  }
}
