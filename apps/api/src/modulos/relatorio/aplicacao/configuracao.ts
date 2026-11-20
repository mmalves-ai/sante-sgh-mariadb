// Liberação e parâmetros do M34 (ficha, seções 4 e 12; POL-3): cada relatório do catálogo pela chave
// `relatorio.<codigo>` (entra na onda do setor que o usa, só depois de conferido contra o número de origem), o envio
// agendado pela `relatorio.envioAgendado` e as integrações novas pelas `integracao.*` — por estabelecimento, setor,
// grupo ou pessoa, pelo resolvedor do M08. Desligada: 403 `recurso-desligado` com o motivo visível; pré-requisito
// pendente (certificado, credenciamento, autorização): continua desligada e a tela diz o que falta. Falha da fonte
// da configuração = desligada (falha fechada). Os parâmetros (teto de linhas e tempo de cada relatório, o endereço da
// Hal-AI, o limite da fila de mortos) pelo nível mais específico vigente; sem a fonte, o padrão do registro.
import { definicaoParametro, recursoDesligado, type ValorParametro } from '@sgh/contratos';
import { recursoLigado, resolverParametro, valorTipado } from '@sgh/dominio-config';
import { ErroProblema } from '../../../problema.filter.js';
import { type CacheConfig, type FonteConfiguracao, TTL_CONFIG_NOVO_S } from '../../config/public-api.js';

export interface SujeitoM34 {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly setor: number | null;
}

export interface EstadoRecurso {
  readonly ligado: boolean;
  readonly motivo: string | null;
  /** Pré-requisitos declarados e a situação registrada neste estabelecimento. */
  readonly prerequisitos: readonly { descricao: string; situacao: string }[];
}

const SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: a funcionalidade fica desligada.';

export class ConfiguracaoM34 {
  constructor(
    private readonly fonte: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
  ) {}

  private async dados(s: Pick<SujeitoM34, 'rede' | 'hospital'>) {
    const fonte = this.fonte;
    if (!fonte) return null;
    const carregar = async () => ({
      chaves: await fonte.chaves(s.rede, s.hospital),
      prerequisitos: await fonte.prerequisitos(s.rede, s.hospital),
    });
    return this.cache
      ? this.cache.lerOuCarregar(
          this.cache.chave(s.rede, s.hospital, 'liberacao'),
          TTL_CONFIG_NOVO_S,
          carregar,
        )
      : carregar();
  }

  /** O estado de várias chaves de uma vez (uma leitura da configuração). */
  async estados(s: SujeitoM34, chaves: readonly string[]): Promise<Record<string, EstadoRecurso>> {
    let d: Awaited<ReturnType<ConfiguracaoM34['dados']>>;
    try {
      d = await this.dados(s);
    } catch {
      d = null;
    }
    const sujeito = { pessoa: s.login, ...(s.setor !== null ? { setor: String(s.setor) } : {}) };
    const r: Record<string, EstadoRecurso> = {};
    for (const chave of chaves) {
      const declarado = recursoDesligado(chave);
      const declarados = declarado?.prerequisitos ?? [];
      if (!d) {
        r[chave] = {
          ligado: false,
          motivo: SEM_CONFIGURACAO,
          prerequisitos: declarados.map((p) => ({ descricao: p.descricao, situacao: 'pendente' })),
        };
        continue;
      }
      const ligadas = d.chaves
        .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
        .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
      const registrados = d.prerequisitos.filter((p) => p.recurso === chave);
      const prerequisitos = declarados.map((p) => ({
        descricao: p.descricao,
        situacao: registrados.find((x) => x.tipo === p.tipo)?.situacao ?? 'pendente',
      }));
      const titulo = declarado?.titulo ?? chave;
      if (recursoLigado(ligadas, declarados, registrados, sujeito, new Date()))
        r[chave] = { ligado: true, motivo: null, prerequisitos };
      else
        r[chave] = {
          ligado: false,
          motivo: recursoLigado(ligadas, [], [], sujeito, new Date())
            ? `"${titulo}" tem pré-requisito pendente neste estabelecimento: ${declarados.map((p) => p.descricao).join(' ')}`
            : `"${titulo}" ainda não foi liberado para este estabelecimento ou setor. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.`,
          prerequisitos,
        };
    }
    return r;
  }

  async estado(s: SujeitoM34, chave: string): Promise<EstadoRecurso> {
    return (await this.estados(s, [chave]))[chave]!;
  }

  /** Desligada: 403 `recurso-desligado` com o motivo (nada é lido nem gravado). */
  async exigir(s: SujeitoM34, chave: string): Promise<void> {
    const e = await this.estado(s, chave);
    if (!e.ligado)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Funcionalidade desligada',
        e.motivo ?? SEM_CONFIGURACAO,
        {
          codigo: 'recurso-desligado',
        },
      );
  }

  /** Parâmetro do sistema novo resolvido no estabelecimento (falha da fonte: o padrão do registro). */
  async parametro(
    s: Pick<SujeitoM34, 'rede' | 'hospital'>,
    chave: string,
  ): Promise<string | number | boolean | null> {
    const def = definicaoParametro(chave);
    if (!def) return null;
    let valores: ValorParametro[];
    try {
      valores = this.fonte ? await this.fonte.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    return valorTipado(
      def,
      resolverParametro(
        def,
        valores,
        { rede: s.rede, empresa: null, estabelecimento: s.hospital, unidade: null, perfis: [], usuario: '' },
        new Date(),
      ).valor,
    );
  }

  async inteiro(s: Pick<SujeitoM34, 'rede' | 'hospital'>, chave: string, padrao: number): Promise<number> {
    const v = await this.parametro(s, chave);
    return typeof v === 'number' && Number.isFinite(v) ? v : padrao;
  }
}
