// Vigia de mudanças (M16; regra 15; cap-09 §9.9): por estabelecimento e canal, UM laço neste processo faz uma
// consulta leve por ciclo (1 a 2 s) enquanto houver quem escute (as telas pelo canal de eventos ou um consumidor
// do servidor), qualquer que seja o número de telas: 50 telas geram as mesmas consultas que 1. Selo diferente do
// ciclo anterior = um evento (só o canal e uma versão); a tela relê. A marca d'água fica no armazém compartilhado
// (Valkey; memória sem ele); perdida, o canal recomeça do zero e avisa a mudança por precaução. Erro do banco: conta, espera o próximo ciclo e nunca derruba o laço.
// Melhoria: o canal é do estabelecimento de um CLIENTE (um banco por cliente): a chave é o cliente e o id do
// estabelecimento (`sgh:<cliente>:vigia:<estabelecimento>:<canal>`), e a leitura recebe o contexto do núcleo, sem
// sessão (usuário nulo: processo); nada de rede nem código de hospital em texto.
import {
  type CanalVigia,
  type EventoVigia,
  INTERVALO_VIGIA_MAX_MS,
  INTERVALO_VIGIA_MIN_MS,
  INTERVALO_VIGIA_PADRAO_MS,
  type SaudeCanalVigia,
  type SaudeVigia,
} from '@sgh/contratos';
import type { ContextoNucleo } from '@sgh/nucleo';
import type { ArmazemSessao } from '../../sessao/armazem.js';

export const MOTOR_VIGIA = Symbol('MOTOR_VIGIA');

/** Marca d'água de um canal (números; 0 = recomeçar). */
export interface MarcaVigia {
  /** Maior id visto (trilha de auditoria, na fonte do banco). */
  readonly maiorId: number;
  readonly maiorId2: number;
  /** Início da janela recente (quando o canal usar). */
  readonly janela: number;
}

export const MARCA_ZERO: MarcaVigia = { maiorId: 0, maiorId2: 0, janela: 0 };

/** O que a fonte devolve a cada ciclo: o selo (muda quando algo mudou), a nova marca e as consultas feitas. */
export interface LeituraCanal {
  readonly selo: string;
  readonly marca: MarcaVigia;
  readonly consultas: number;
}

/** Validade da marca d'água no armazém (um dia; a cada ciclo é renovada). */
const TTL_MARCA_S = 86_400;

/** De quem é o canal: o cliente (banco) e o estabelecimento. O `ContextoNucleo` da sessão já serve. */
export type AlvoVigia = Pick<ContextoNucleo, 'cliente' | 'estabelecimento'>;

export interface DependenciasVigia {
  /** A consulta do canal no banco do cliente, no estabelecimento do contexto (a fonte do M16). */
  lerCanal(ctx: ContextoNucleo, canal: CanalVigia, marca: MarcaVigia): Promise<LeituraCanal>;
  /** Armazém da marca d'água (Valkey ou memória). */
  readonly armazem: ArmazemSessao;
  readonly tipoArmazem: 'valkey' | 'memoria';
  readonly intervaloMs?: number;
  readonly agora?: () => number;
  readonly aviso?: (mensagem: string, campos: Record<string, unknown>) => void;
}

type Ouvinte = (e: EventoVigia) => void;

interface EstadoCanal {
  readonly cliente: string;
  readonly estabelecimento: number;
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

  private chave(alvo: { cliente: string; estabelecimento: number | null }, canal: CanalVigia): string {
    return `sgh:${alvo.cliente}:vigia:${alvo.estabelecimento ?? 0}:${canal}`;
  }

  private estado(alvo: AlvoVigia, canal: CanalVigia): EstadoCanal {
    if (alvo.estabelecimento === null) throw new Error('vigia: o canal exige o estabelecimento.');
    const k = this.chave(alvo, canal);
    let e = this.canais.get(k);
    if (!e) {
      e = {
        cliente: alvo.cliente,
        estabelecimento: alvo.estabelecimento,
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
  assinar(alvo: AlvoVigia, canal: CanalVigia, ouvinte: Ouvinte): () => void {
    const e = this.estado(alvo, canal);
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
  versao(alvo: AlvoVigia, canal: CanalVigia): number {
    return this.canais.get(this.chave(alvo, canal))?.versao ?? 0;
  }

  /** Momento do último ciclo bem-sucedido do canal (ISO), ou null ("dados até", regra 14). */
  ultimoCiclo(alvo: AlvoVigia, canal: CanalVigia): string | null {
    const t = this.canais.get(this.chave(alvo, canal))?.ultimoCiclo;
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
        guardada = await this.d.armazem.obter(this.chave(e, e.canal));
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
      const r = await this.d.lerCanal(
        { cliente: e.cliente, estabelecimento: e.estabelecimento, usuario: null, correlacao: `vigia-${e.canal}` },
        e.canal,
        marca,
      );
      e.ciclos++;
      e.consultasUltimoCiclo = r.consultas;
      e.consultasTotais += r.consultas;
      e.ultimoCiclo = this.agora();
      e.duracaoUltimoMs = e.ultimoCiclo - inicio;
      const mudou = (e.selo !== null && r.selo !== e.selo) || perdida;
      e.selo = r.selo;
      e.marca = r.marca;
      try {
        await this.d.armazem.gravar(this.chave(e, e.canal), JSON.stringify(r.marca), TTL_MARCA_S);
      } catch {
        // Sem armazém: a marca fica na memória do processo.
      }
      if (mudou) {
        e.versao++;
        e.mudancas++;
        e.ultimaMudanca = e.ultimoCiclo;
        const evento: EventoVigia = {
          canal: e.canal,
          estabelecimento: String(e.estabelecimento),
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
        estabelecimento: e.estabelecimento,
        canal: e.canal,
        erro: x instanceof Error ? x.name : 'erro',
      });
    } finally {
      e.rodando = false;
    }
  }

  /** Ciclo imediato de um canal (testes e consumidores do servidor). */
  cicloAgora(alvo: AlvoVigia, canal: CanalVigia): Promise<void> {
    return this.ciclo(this.estado(alvo, canal));
  }

  saude(): SaudeVigia {
    const agora = this.agora();
    const canais: SaudeCanalVigia[] = [...this.canais.values()].map((e) => ({
      canal: e.canal,
      estabelecimento: String(e.estabelecimento),
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
