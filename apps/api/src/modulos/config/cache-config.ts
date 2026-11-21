// Cache de configuração (ficha do M08, seção 4 e regra 10): o painel de parâmetros e de chaves de liberação,
// invalidados POR EVENTO depois do commit (a gravação apaga as chaves do estabelecimento; vale para todos os
// processos, porque o armazém é o Valkey compartilhado). Chave com a rede e o estabelecimento (ARQ-2).
// O atraso entre o commit e a invalidação é medido (último e maior) para a tela e o teste. Uma carga que
// começou ANTES de uma invalidação não é gravada no cache (marca de geração por chave, no mesmo armazém):
// sem isso, uma leitura lenta regravaria o valor velho por cima da invalidação até o TTL. O cache nunca
// decide gravação (a liberação e os parâmetros releem na transação).
import { randomUUID } from 'node:crypto';
import type { ArmazemSessao } from '../../sessao/armazem.js';

export const CACHE_CONFIG = Symbol('CACHE_CONFIG');

export const TTL_CONFIG_NOVO_S = 300;

/** M12: a lista de convênios do estabelecimento (busca por palavra), invalidada pela situação e pelo contrato. */
export const TTL_CONVENIOS_S = 60;

/** M24: o índice de busca do item prescritível (sem acento), recarregado do banco a cada 5 minutos. */
export const TTL_BUSCA_PRESCRICAO_S = 300;

export type TipoCache =
  | 'parametros-novos'
  | 'liberacao'
  | 'convenios'
  | 'busca-prescricao'
  // M31: o painel de glosas (agregação de horas; ref 01 §4.6).
  | 'painel-glosa'
  // M37: pessoa → setor do painel de migração (usuários ativos, grupo, unidades e locais; 1 h).
  | 'coex-pessoas'
  // M40: o acompanhamento da onda 2 (agregados por dia e unidade do período; 1 h).
  | 'coex-onda2'
  // M42: o acompanhamento da competência (agregados da competência; as mesmas horas do painel de glosas).
  | 'acompanhamento-competencia'
  // M45 (etapa 2): a configuração dos índices de UTI (agrupamentos, variáveis, faixas e Glasgow; ficha, seção 4).
  | 'indices-uti'
  // M46 (etapa 1): os domínios da ficha anestésica (tipo de anestesia, posição, modo respiratório, função; 1 h).
  | 'dominios-anestesia'
  // M52 (etapa 2): os domínios de RH do ramo usados pela escala (jornada, tempo parcial e trabalho/folga; ficha, seção 4:
  // "consulta inteira, cache curto no Valkey").
  | 'dominios-pessoas';

export class CacheConfig {
  /** Atraso (ms) entre o commit e a invalidação: o último e o maior desde a partida. */
  readonly atraso = { ultimoMs: 0, maiorMs: 0 };
  constructor(private readonly armazem: ArmazemSessao) {}

  chave(rede: string, hospital: string, tipo: TipoCache, extra = ''): string {
    return `sgh:${rede || 'rede'}:cfg:${hospital}:${tipo}${extra ? `:${extra}` : ''}`;
  }

  private geracao(chave: string): string {
    return `${chave}:geracao`;
  }

  async lerOuCarregar<T>(chave: string, ttlS: number, carregar: () => Promise<T>): Promise<T> {
    let antes: string | null = null;
    try {
      const v = await this.armazem.obter(chave);
      if (v !== null) return JSON.parse(v) as T;
      antes = await this.armazem.obter(this.geracao(chave));
    } catch {
      // Valkey fora: lê direto (o cache nunca impede a tela).
    }
    const x = await carregar();
    try {
      // Invalidada durante a carga: o valor pode ser velho; serve esta resposta, mas não o grava.
      if ((await this.armazem.obter(this.geracao(chave))) === antes)
        await this.armazem.gravar(chave, JSON.stringify(x), ttlS);
    } catch {
      // sem cache
    }
    return x;
  }

  /** Depois do commit: apaga as chaves do estabelecimento e mede o atraso desde o commit. */
  async invalidar(
    rede: string,
    hospital: string,
    tipos: readonly TipoCache[],
    commitEm: number,
  ): Promise<number> {
    for (const t of tipos) {
      try {
        const c = this.chave(rede, hospital, t);
        // Geração nova ANTES de apagar: carga em andamento não regrava o valor velho (TTL dobrado: sobrevive
        // a qualquer carga que tenha começado antes).
        await this.armazem.gravar(this.geracao(c), randomUUID(), TTL_CONFIG_NOVO_S * 2);
        await this.armazem.apagar(c);
      } catch {
        // Valkey fora: o TTL curto limita o atraso
      }
    }
    const ms = Date.now() - commitEm;
    this.atraso.ultimoMs = ms;
    this.atraso.maiorMs = Math.max(this.atraso.maiorMs, ms);
    return ms;
  }
}
