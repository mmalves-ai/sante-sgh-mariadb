// Vigia de mudanças (M16; regra 15; cap-09 §9.9): por estabelecimento e canal, UM laço neste processo faz uma
// consulta leve por ciclo (1 a 2 s) enquanto houver quem escute (as telas pelo canal de eventos ou um consumidor
// do servidor), qualquer que seja o número de telas: 50 telas geram as mesmas consultas que 1. Selo diferente do
// ciclo anterior = um evento (só o canal e uma versão); a tela relê. A marca d'água fica no armazém compartilhado
// (Valkey; memória sem ele); perdida, o canal recomeça do zero — as tabelas pequenas relidas inteiras — e avisa
// a mudança por precaução. Erro do banco: conta, espera o próximo ciclo e nunca derruba o laço.
import {
  type CanalVigia,
  type EventoVigia,
  INTERVALO_VIGIA_MAX_MS,
  INTERVALO_VIGIA_MIN_MS,
  INTERVALO_VIGIA_PADRAO_MS,
  type SaudeCanalVigia,
  type SaudeVigia,
} from '@sgh/contratos';
import { type LeituraCanal, MARCA_ZERO, type MarcaVigia } from '@sgh/legado';
import type { ArmazemSessao } from '../../sessao/armazem.js';

export const MOTOR_VIGIA = Symbol('MOTOR_VIGIA');

/** Validade da marca d'água no armazém (um dia; a cada ciclo é renovada). */
const TTL_MARCA_S = 86_400;

export interface DependenciasVigia {
  readonly rede: string;
  /** A consulta do canal no banco do estabelecimento (a fonte do M16). */
  lerCanal(hospital: string, canal: CanalVigia, marca: MarcaVigia): Promise<LeituraCanal>;
  /** Armazém da marca d'água (Valkey ou memória). */
  readonly armazem: ArmazemSessao;
  readonly tipoArmazem: 'valkey' | 'memoria';
  readonly intervaloMs?: number;
  readonly agora?: () => number;
  readonly aviso?: (mensagem: string, campos: Record<string, unknown>) => void;
}

type Ouvinte = (e: EventoVigia) => void;

interface EstadoCanal {
  readonly hospital: string;
  readonly canal: CanalVigia;
  readonly ouvintes: Set<Ouvinte>;
  selo: string | null;
  marca: MarcaVigia | null;
  versao: number;
  ciclos: number;
  consultasUltimoCiclo: number;
  consultasTotais: number;
  mudancas: number;
  erros: number;
  releituras: number;
  ultimoCiclo: number | null;
  ultimaMudanca: number | null;
  duracaoUltimoMs: number | null;
  temporizador: NodeJS.Timeout | null;
  rodando: boolean;
}

/** Intervalo do ciclo pela variável VIGIA_MUDANCAS_MS (1 000 a 2 000 ms; fora da faixa: o padrão). */
export function intervaloDoAmbiente(env: NodeJS.ProcessEnv): number {
  const n = Number(env['VIGIA_MUDANCAS_MS'] ?? '');
  return Number.isInteger(n) && n >= INTERVALO_VIGIA_MIN_MS && n <= INTERVALO_VIGIA_MAX_MS
    ? n
    : INTERVALO_VIGIA_PADRAO_MS;
}

export class MotorVigia {
  private readonly canais = new Map<string, EstadoCanal>();
  private readonly intervaloMs: number;
  private parado = false;

  constructor(private readonly d: DependenciasVigia) {
    this.intervaloMs = Math.min(
      INTERVALO_VIGIA_MAX_MS,
      Math.max(INTERVALO_VIGIA_MIN_MS, d.intervaloMs ?? INTERVALO_VIGIA_PADRAO_MS),
    );
  }

  private agora(): number {
    return this.d.agora?.() ?? Date.now();
  }

  private chave(hospital: string, canal: CanalVigia): string {
    return `sgh:${this.d.rede}:vigia:${hospital}:${canal}`;
  }

  private estado(hospital: string, canal: CanalVigia): EstadoCanal {
    const k = this.chave(hospital, canal);
    let e = this.canais.get(k);
    if (!e) {
      e = {
        hospital,
        canal,
        ouvintes: new Set(),
        selo: null,
        marca: null,
        versao: 0,
        ciclos: 0,
        consultasUltimoCiclo: 0,
        consultasTotais: 0,
        mudancas: 0,
        erros: 0,
        releituras: 0,
        ultimoCiclo: null,
        ultimaMudanca: null,
        duracaoUltimoMs: null,
        temporizador: null,
        rodando: false,
      };
      this.canais.set(k, e);
    }
    return e;
  }

  /** Escuta um canal; devolve o cancelamento. O laço do canal liga com o primeiro ouvinte e para com o último. */
  assinar(hospital: string, canal: CanalVigia, ouvinte: Ouvinte): () => void {
    const e = this.estado(hospital, canal);
    e.ouvintes.add(ouvinte);
    this.agendar(e, 0);
    return () => {
      e.ouvintes.delete(ouvinte);
      if (e.ouvintes.size === 0 && e.temporizador) {
        clearTimeout(e.temporizador);
        e.temporizador = null;
      }
    };
  }

  /** Versão atual do canal neste processo (os caches do servidor a usam para saber se mudou). */
  versao(hospital: string, canal: CanalVigia): number {
    return this.canais.get(this.chave(hospital, canal))?.versao ?? 0;
  }

  /** Momento do último ciclo bem-sucedido do canal (ISO), ou null ("dados até", regra 14). */
  ultimoCiclo(hospital: string, canal: CanalVigia): string | null {
    const t = this.canais.get(this.chave(hospital, canal))?.ultimoCiclo;
    return t ? new Date(t).toISOString() : null;
  }

  private agendar(e: EstadoCanal, atraso: number): void {
    if (this.parado || e.temporizador || e.ouvintes.size === 0) return;
    e.temporizador = setTimeout(() => {
      e.temporizador = null;
      void this.ciclo(e).finally(() => this.agendar(e, this.intervaloMs));
    }, atraso);
    e.temporizador.unref?.();
  }

  /** Um ciclo do canal (público para os testes e para o consumidor do servidor). */
  async ciclo(e: EstadoCanal): Promise<void> {
    if (e.rodando) return;
    e.rodando = true;
    const inicio = this.agora();
    try {
      let marca = e.marca;
      let guardada: string | null = null;
      let semArmazem = false;
      try {
        guardada = await this.d.armazem.obter(this.chave(e.hospital, e.canal));
      } catch {
        // Armazém fora: segue com a marca da memória do processo (não é perda).
        semArmazem = true;
      }
      let perdida = false;
      if (guardada) {
        try {
          marca = JSON.parse(guardada) as MarcaVigia;
        } catch {
          marca = null;
        }
      } else if (!semArmazem && e.selo !== null) perdida = true;
      if (perdida || !marca) {
        if (perdida) e.releituras++;
        marca = MARCA_ZERO;
      }
      const r = await this.d.lerCanal(e.hospital, e.canal, marca);
      e.ciclos++;
      e.consultasUltimoCiclo = r.consultas;
      e.consultasTotais += r.consultas;
      e.ultimoCiclo = this.agora();
      e.duracaoUltimoMs = e.ultimoCiclo - inicio;
      const mudou = (e.selo !== null && r.selo !== e.selo) || perdida;
      e.selo = r.selo;
      e.marca = r.marca;
      try {
        await this.d.armazem.gravar(this.chave(e.hospital, e.canal), JSON.stringify(r.marca), TTL_MARCA_S);
      } catch {
        // Sem armazém: a marca fica na memória do processo.
      }
      if (mudou) {
        e.versao++;
        e.mudancas++;
        e.ultimaMudanca = e.ultimoCiclo;
        const evento: EventoVigia = {
          canal: e.canal,
          estabelecimento: e.hospital,
          versao: e.versao,
          em: new Date(e.ultimoCiclo).toISOString(),
        };
        for (const o of [...e.ouvintes]) {
          try {
            o(evento);
          } catch {
            // Um ouvinte com defeito não derruba os outros.
          }
        }
      }
    } catch (x) {
      e.erros++;
      this.d.aviso?.('vigia: ciclo falhou', {
        estabelecimento: e.hospital,
        canal: e.canal,
        erro: x instanceof Error ? x.name : 'erro',
      });
    } finally {
      e.rodando = false;
    }
  }

  /** Ciclo imediato de um canal (testes e consumidores do servidor). */
  cicloAgora(hospital: string, canal: CanalVigia): Promise<void> {
    return this.ciclo(this.estado(hospital, canal));
  }

  saude(): SaudeVigia {
    const agora = this.agora();
    const canais: SaudeCanalVigia[] = [...this.canais.values()].map((e) => ({
      canal: e.canal,
      estabelecimento: e.hospital,
      ligado: e.ouvintes.size > 0,
      intervaloMs: this.intervaloMs,
      ciclos: e.ciclos,
      consultasUltimoCiclo: e.consultasUltimoCiclo,
      consultasTotais: e.consultasTotais,
      mudancas: e.mudancas,
      erros: e.erros,
      assinantes: e.ouvintes.size,
      ultimoCiclo: e.ultimoCiclo ? new Date(e.ultimoCiclo).toISOString() : null,
      ultimaMudanca: e.ultimaMudanca ? new Date(e.ultimaMudanca).toISOString() : null,
      atrasoMs: e.ultimoCiclo ? agora - e.ultimoCiclo : null,
      duracaoUltimoMs: e.duracaoUltimoMs,
      releituras: e.releituras,
    }));
    return { canais, marcaDagua: this.d.tipoArmazem };
  }

  parar(): void {
    this.parado = true;
    for (const e of this.canais.values()) {
      if (e.temporizador) clearTimeout(e.temporizador);
      e.temporizador = null;
    }
  }
}
