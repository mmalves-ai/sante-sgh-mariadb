// M60, etapa 3: a fumaça do servidor (ficha do M60, M60-F3): o que a instância confere de si para a verificação
// pós-implantação. Lê o relógio do banco, o Valkey e as filas, a impressão da estrutura do banco do cliente contra a
// homologada e as chaves de liberação do estabelecimento, e devolve os itens com a situação (regras puras em
// @sgh/dominio-config). Só leitura; só códigos e contagens.
// Melhoria: a impressão da estrutura é lida do próprio banco do cliente a cada fumaça (tabelas e colunas); a
// divergência só falha a fumaça e pede as atualizações do banco que faltam (lote 02-07: sem bloqueio de escrita por
// tabela, que era herança de convivência e saiu do contrato).
import {
  definicaoParametro,
  esquemaFumacaServidor,
  FUSO_INSTITUICAO_PADRAO,
  type FumacaServidor,
  type ImpressaoConferida,
  NTP_LIMIAR_PADRAO_MS,
  NTP_SERVIDOR_PADRAO,
  PARAMETRO_FUSO_INSTITUICAO,
  PARAMETRO_NTP_LIMIAR_MS,
  PARAMETRO_NTP_SERVIDOR,
  type ValorParametro,
} from '@sgh/contratos';
import {
  compararRelogios,
  conferirChaves,
  conferirHoraConfiavel,
  itensDaFumaca,
  type LinhaChave,
  piorSituacao,
  resolverParametro,
} from '@sgh/dominio-config';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { PortaFilasImplantacao } from '../filas.js';
import type { ConsultaNtp } from '../ntp.js';
import type { ContextoImplantacao, EstruturaBanco, PortaImplantacao } from '../porta.js';

export interface DependenciasFumaca {
  readonly porta: PortaImplantacao;
  readonly filas: PortaFilasImplantacao;
  readonly ambiente: string;
  /** O resumo homologado da estrutura do banco (ESTRUTURA_HOMOLOGADA do pacote); nulo: o pacote não levou. */
  readonly estruturaHomologada: (hospital: string) => string | null;
  /** As chaves de liberação do estabelecimento (liberacao_chave); nula: sem fonte (a leitura sai em falha). */
  readonly configuracao: FonteConfiguracao | null;
  /** IMPLANTACAO_CHAVES_ESPERADAS já lidas. */
  readonly chavesEsperadas: readonly string[];
  readonly fuso: () => string;
  readonly agora?: () => number;
  /** W0-09 (M2): a consulta ao NTP (deslocamento em ms ou nulo); ausente, a hora sai 'sem referência'. */
  readonly ntp?: ConsultaNtp;
}

/** Os parâmetros da hora confiável já resolvidos (estabelecimento sobre a rede; sem fonte, os padrões). */
export interface ParametrosHora {
  readonly servidorNtp: string;
  readonly limiarMs: number;
  readonly fusoInstituicao: string;
}

export function parametrosDaHora(
  valores: readonly ValorParametro[],
  rede: string,
  hospital: string,
  agora: Date,
): ParametrosHora {
  const ler = (chave: string, padrao: string): string => {
    const def = definicaoParametro(chave);
    if (!def) return padrao;
    try {
      return resolverParametro(
        def,
        valores,
        { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
        agora,
      ).valor;
    } catch {
      return padrao;
    }
  };
  const limiar = Number(ler(PARAMETRO_NTP_LIMIAR_MS, String(NTP_LIMIAR_PADRAO_MS)));
  return {
    servidorNtp: ler(PARAMETRO_NTP_SERVIDOR, NTP_SERVIDOR_PADRAO).trim() || NTP_SERVIDOR_PADRAO,
    limiarMs: Number.isFinite(limiar) && limiar > 0 ? limiar : NTP_LIMIAR_PADRAO_MS,
    fusoInstituicao: ler(PARAMETRO_FUSO_INSTITUICAO, FUSO_INSTITUICAO_PADRAO),
  };
}

const curto = (s: string | null | undefined): string | null => (s ? s.slice(0, 16) : null);

/**
 * A impressão da estrutura contra a homologada: `atual` indefinida é o banco que não respondeu; homologada nula, o
 * pacote sem a impressão homologada.
 */
export function impressaoDaEstrutura(
  atual: EstruturaBanco | undefined,
  homologada: string | null,
  verificadaEm: string,
): ImpressaoConferida {
  if (!atual)
    return {
      estado: 'indisponivel',
      resumo: null,
      resumoHomologado: curto(homologada),
      verificadaEm: null,
    };
  const h = homologada?.trim().toLowerCase() || null;
  return {
    estado: h === null ? 'sem-homologacao' : h === atual.resumo.toLowerCase() ? 'homologado' : 'divergente',
    resumo: curto(atual.resumo),
    resumoHomologado: curto(h),
    verificadaEm,
  };
}

export class ServicoFumacaServidor {
  constructor(private readonly d: DependenciasFumaca) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  private async linhasDeChave(c: ContextoImplantacao): Promise<LinhaChave[] | null> {
    if (!this.d.configuracao) return null;
    try {
      const linhas = await this.d.configuracao.chaves(c.rede, c.hospital);
      return linhas.map((l) => ({ tipo: l.tipo, chave: l.chave, escopo: l.escopo, ligada: l.ligada }));
    } catch {
      return null;
    }
  }

  private async parametros(c: ContextoImplantacao): Promise<ParametrosHora> {
    // Fonte sem parâmetros ou que falhou: os padrões (a fumaça nunca cai por causa da hora).
    const f = this.d.configuracao;
    const valores = f
      ? await Promise.resolve()
          .then(() => f.valoresParametro(c.rede, c.hospital))
          .catch((): ValorParametro[] => [])
      : [];
    return parametrosDaHora(valores, c.rede, c.hospital, new Date(this.agora()));
  }

  private async consultarNtp(servidor: string): Promise<{ deslocamento: number | null; ms: number }> {
    const inicio = this.agora();
    const ntp = this.d.ntp;
    const deslocamento = ntp
      ? await Promise.resolve()
          .then(() => ntp(servidor))
          .catch(() => null)
      : null;
    return { deslocamento, ms: Math.round((inicio + this.agora()) / 2) };
  }

  async conferir(c: ContextoImplantacao): Promise<FumacaServidor> {
    // O instante do servidor que se compara ao do banco é o meio da leitura (a ida e a volta pela rede).
    const inicio = this.agora();
    const meio = () => Math.round((inicio + this.agora()) / 2);
    const hora = await this.parametros(c);
    const [rBanco, valkey, filas, linhas, rNtp, estrutura] = await Promise.all([
      this.d.porta.relogioBanco(c).then(
        (v) => ({ v, ms: meio() }),
        () => ({ v: null, ms: meio() }),
      ),
      this.d.filas.valkey(c.rede),
      this.d.filas.filas(c.rede),
      this.linhasDeChave(c),
      this.consultarNtp(hora.servidorNtp),
      Promise.resolve()
        .then(() => this.d.porta.estrutura(c))
        .catch((): undefined => undefined),
    ]);
    const relogio = compararRelogios(rBanco.ms, rBanco.v, this.d.fuso());
    const horaConfiavel = conferirHoraConfiavel({
      ...hora,
      deslocamentoNtpMs: rNtp.deslocamento,
      servidorMs: rNtp.ms,
      relogio,
    });
    const impressao = impressaoDaEstrutura(
      estrutura,
      this.d.estruturaHomologada(c.hospital),
      new Date(this.agora()).toISOString(),
    );
    const chaves = conferirChaves(linhas, this.d.chavesEsperadas);
    const itens = itensDaFumaca({
      ambiente: this.d.ambiente,
      relogio,
      horaConfiavel,
      valkey,
      filas,
      impressao,
      chaves,
    });
    return esquemaFumacaServidor.parse({
      hospital: c.hospital,
      em: new Date(this.agora()).toISOString(),
      ambiente: this.d.ambiente,
      relogio,
      horaConfiavel,
      valkey,
      filas,
      impressao,
      chaves,
      itens,
      situacao: piorSituacao(itens),
    });
  }
}
