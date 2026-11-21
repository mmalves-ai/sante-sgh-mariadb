// Central de chamadas do painel (M19; ficha, regras 6 e 7; cap-09 §9.9): por estabelecimento, a lista das chamadas
// recentes que os painéis de TV mostram e falam. Duas entradas:
//   - a chamada feita por esta instância da API entra na hora, depois do COMMIT (o controlador avisa: menos de 1 s
//     até a voz);
//   - a chamada feita em outra instância (outro processo da API, outro terminal) entra pelo vigia de mudanças (canal
//     "senhas"), ou pela releitura periódica sem vigia: um retrato das senhas do dia → a diferença com o retrato
//     anterior (@sgh/dominio-recepcao, chamadasEntreRetratos) → as chamadas novas.
// Os painéis só recebem o aviso de que mudou (a versão) e releem a lista; nada de pessoa sai daqui: só a senha, o
// destino e, se o parâmetro pedir, as iniciais (calculadas no serviço, nunca o nome).
// Melhoria: sem gravação de "chamada de fora" (convivência com o sistema de origem removida, ADR 0003): toda chamada
// já nasce gravada pela operação recepcao.chamarSenha, com a hora e o guichê.
import { chamadasEntreRetratos, type EstadoChamadaSenha, juntarChamadas } from '@sgh/dominio-recepcao';
import type { PortaRecepcao } from './porta.js';
import type { SenhaRecepcao } from './tipos.js';
import { guicheDaTela, letraDaSenha, prioridadeDaTela } from './tela-senha.js';

/** Aviso de mudança nas senhas do estabelecimento (um vigia de mudanças, ou nenhum: a releitura periódica vale). */
export interface AvisoMudancaSenhas {
  assinar(hospital: string, canal: 'senhas', ouvinte: () => void): () => void;
}

/** Chamadas guardadas por estabelecimento (as mais recentes; o painel mostra as últimas). */
export const TETO_CHAMADAS = 30;
/** Sem vigia (testes) ou com o vigia parado: o retrato é refeito na leitura do painel a cada tanto. */
export const RELEITURA_SEM_VIGIA_MS = 2_000;

export interface ChamadaInterna {
  readonly chave: string;
  readonly senha: number;
  readonly texto: string;
  readonly recepcao: number;
  readonly guiche: number;
  /** Local da chamada: o do guichê (guichê aberto) ou o da linha C (chamada no local). */
  readonly local: number | null;
  readonly prioridade: string;
  readonly em: string;
  readonly origem: 'novo' | 'outro';
}

interface EstadoHospital {
  retrato: Map<number, EstadoChamadaSenha> | null;
  chamadas: ChamadaInterna[];
  ouvintes: Set<(versao: number) => void>;
  cancelarVigia: (() => void) | null;
  versao: number;
  ultimaLeitura: number;
  lendo: Promise<void> | null;
}

const estadoDe = (s: SenhaRecepcao): EstadoChamadaSenha => ({
  id: s.id,
  guiche: guicheDaTela(s.guiche),
  situacao: letraDaSenha(s),
  chamadasNoFluxo: s.chamadasNoFluxo,
});

/** A chave da chamada: a senha e a contagem de chamadas (muda a cada nova chamada da mesma senha). */
export const chaveDaChamada = (s: Pick<SenhaRecepcao, 'id' | 'chamadasNoFluxo' | 'guiche'>): string =>
  `${s.id}:${s.chamadasNoFluxo + (s.guiche !== null && s.guiche > 0 ? 1 : 0)}`;

export class CentralChamadas {
  private readonly estados = new Map<string, EstadoHospital>();

  constructor(
    private readonly porta: PortaRecepcao,
    private readonly rede: string,
    private readonly vigia: AvisoMudancaSenhas | null,
    private readonly agora: () => number = Date.now,
  ) {}

  private e(hospital: string): EstadoHospital {
    let x = this.estados.get(hospital);
    if (!x) {
      x = {
        retrato: null,
        chamadas: [],
        ouvintes: new Set(),
        cancelarVigia: null,
        versao: 0,
        ultimaLeitura: 0,
        lendo: null,
      };
      this.estados.set(hospital, x);
    }
    return x;
  }

  versao(hospital: string): number {
    return this.e(hospital).versao;
  }

  /** Assina os avisos do estabelecimento (o primeiro ouvinte liga o vigia; o último desliga). */
  assinar(hospital: string, ouvinte: (versao: number) => void): () => void {
    const x = this.e(hospital);
    x.ouvintes.add(ouvinte);
    if (this.vigia && !x.cancelarVigia)
      x.cancelarVigia = this.vigia.assinar(hospital, 'senhas', () => {
        void this.atualizar(hospital);
      });
    return () => {
      x.ouvintes.delete(ouvinte);
      if (x.ouvintes.size === 0 && x.cancelarVigia) {
        x.cancelarVigia();
        x.cancelarVigia = null;
      }
    };
  }

  private avisar(x: EstadoHospital): void {
    x.versao++;
    for (const o of [...x.ouvintes]) {
      try {
        o(x.versao);
      } catch {
        // Um ouvinte com defeito não derruba os outros.
      }
    }
  }

  /** Locais dos guichês em uso (recepção:guichê → local), para a chamada do outro sistema pelo guichê. */
  private async locaisDosGuiches(hospital: string): Promise<Map<string, number>> {
    const g = await this.porta.guichesEmUso({ rede: this.rede, hospital });
    return new Map(g.map((y) => [`${y.recepcao}:${y.guiche}`, y.local]));
  }

  /** Refaz o retrato das senhas do dia e acrescenta as chamadas novas (de qualquer sistema). */
  atualizar(hospital: string): Promise<void> {
    const x = this.e(hospital);
    if (x.lendo) return x.lendo;
    x.lendo = (async () => {
      try {
        const { senhas } = await this.porta.senhasDoDia({ rede: this.rede, hospital }, {});
        x.ultimaLeitura = this.agora();
        const anterior = x.retrato;
        x.retrato = new Map(senhas.map((s) => [s.id, estadoDe(s)]));
        if (!anterior) return;
        const novas = chamadasEntreRetratos(anterior, senhas.map(estadoDe));
        if (novas.length === 0) return;
        const locais = await this.locaisDosGuiches(hospital);
        const porId = new Map(senhas.map((s) => [s.id, s]));
        const itens: ChamadaInterna[] = [];
        for (const n of novas) {
          const s = porId.get(n.id);
          if (!s) continue;
          itens.push(this.chamadaDe(s, locais, 'outro'));
        }
        const antes = new Set(x.chamadas.map((c) => c.chave));
        x.chamadas = juntarChamadas(x.chamadas, itens, TETO_CHAMADAS);
        if (itens.some((i) => !antes.has(i.chave))) this.avisar(x);
      } catch {
        // Banco fora do ar: o painel mostra a hora da última atualização; o próximo ciclo tenta de novo.
      } finally {
        x.lendo = null;
      }
    })();
    return x.lendo;
  }

  private chamadaDe(s: SenhaRecepcao, locais: Map<string, number>, origem: 'novo' | 'outro'): ChamadaInterna {
    const doFluxo = s.ultimoLocalChamada;
    // A chamada no local (linha C nova) vale pelo local da linha; a do guichê, pelo local do guichê.
    const local =
      s.localChamada ??
      (s.guiche !== null ? (locais.get(`${s.recepcao}:${s.guiche}`) ?? null) : null) ??
      doFluxo;
    return {
      chave: chaveDaChamada(s),
      senha: s.id,
      texto: s.texto,
      recepcao: s.recepcao,
      guiche: guicheDaTela(s.guiche),
      local,
      prioridade: prioridadeDaTela(s),
      em: new Date(this.agora()).toISOString(),
      origem,
    };
  }

  /** A chamada do novo, logo depois do COMMIT (a senha relida): entra na hora e avisa os painéis. */
  async registrarDoNovo(hospital: string, s: SenhaRecepcao): Promise<void> {
    const x = this.e(hospital);
    const c = this.chamadaDe(s, new Map(), 'novo');
    x.chamadas = juntarChamadas(x.chamadas, [c], TETO_CHAMADAS);
    // O retrato passa a conhecer a chamada: o vigia não a anuncia de novo como do outro sistema.
    if (x.retrato) x.retrato.set(s.id, estadoDe(s));
    this.avisar(x);
  }

  /** As chamadas do estabelecimento para um painel (a recepção e os locais do dispositivo), a mais nova primeiro. */
  async chamadas(
    hospital: string,
    filtro: { readonly recepcao: number | null; readonly locais: readonly number[] },
  ): Promise<{ chamadas: ChamadaInterna[]; atualizadoEm: string }> {
    const x = this.e(hospital);
    const semVigia = !this.vigia || !x.cancelarVigia;
    if (!x.retrato || (semVigia && this.agora() - x.ultimaLeitura > RELEITURA_SEM_VIGIA_MS))
      await this.atualizar(hospital);
    const chamadas = x.chamadas.filter(
      (c) =>
        (filtro.recepcao === null || c.recepcao === filtro.recepcao) &&
        (filtro.locais.length === 0 || (c.local !== null && filtro.locais.includes(c.local))),
    );
    return { chamadas, atualizadoEm: new Date(x.ultimaLeitura || this.agora()).toISOString() };
  }

  parar(): void {
    for (const x of this.estados.values()) {
      x.cancelarVigia?.();
      x.cancelarVigia = null;
      x.ouvintes.clear();
    }
  }
}
