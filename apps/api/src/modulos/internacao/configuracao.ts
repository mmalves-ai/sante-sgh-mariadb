// Liberação e parâmetros do M16 (ficha, seções 5 e 12): as chaves `internacao.leitos.painel`, `relatorio.paineis`,
// `internacao.censo.fechamento` e `relatorio.bi` por estabelecimento e setor (POL-3: desligada, 403
// `recurso-desligado` com o motivo, e o menu esconde o destino), e os parâmetros do sistema novo (hora de
// fechamento do censo, tipos de terapia intensiva e as metas dos indicadores), pelo resolvedor do M08 (nível mais
// específico vigente; sem a fonte, o padrão do registro). Falha da fonte da configuração = desligado (fechado).
import {
  MOTIVO_FORA_DO_ESCOPO_ONDA_0,
  CHAVES_LIBERACAO_M16,
  CODIGOS_INDICADOR,
  type CodigoIndicador,
  definicaoParametro,
  HORA_FECHAMENTO_PADRAO,
  type LiberacaoM16,
  recursoDesligado,
  TIPOS_INTENSIVA_PADRAO,
  type ValorParametro,
} from '@sgh/contratos';
import { resolverParametro, situacaoDaChave, type SujeitoParametro, valorTipado } from '@sgh/dominio-config';
import { metaDoTexto } from '@sgh/dominio-relatorio';
import { ErroProblema } from '../../problema.filter.js';
import { type CacheConfig, type FonteConfiguracao, TTL_CONFIG_NOVO_S } from '../config/public-api.js';

export interface SujeitoM16 {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly setor: number | null;
  /** M38 (regra 3): grupo do legado, para o escopo `grupo` das chaves (ausente: sem grupo). */
  readonly grupo?: string | null;
}

export type ChaveM16 = keyof typeof CHAVES_LIBERACAO_M16;

const TITULOS: Readonly<Record<ChaveM16, string>> = {
  painel: 'O painel de leitos ao vivo e o censo diário',
  paineis: 'Os painéis gerenciais e os indicadores hospitalares',
  fechamento: 'O fechamento automático do censo',
  bi: 'A análise livre no BI',
};

const motivoDesligado = (k: ChaveM16) =>
  `${TITULOS[k]} ainda não foi liberado para este estabelecimento ou setor. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.`;
const motivoPrerequisito = (k: ChaveM16) => `${TITULOS[k]} tem pré-requisito pendente neste estabelecimento.`;
const MOTIVO_SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: a funcionalidade fica desligada.';

export interface ParametrosM16 {
  readonly horaFechamento: number;
  readonly intensivas: readonly number[];
  readonly metas: Readonly<Record<CodigoIndicador, number | null>>;
}

export const PARAMETROS_PADRAO: ParametrosM16 = {
  horaFechamento: HORA_FECHAMENTO_PADRAO,
  intensivas: [...TIPOS_INTENSIVA_PADRAO],
  metas: Object.fromEntries(CODIGOS_INDICADOR.map((c) => [c, null])) as Record<
    CodigoIndicador,
    number | null
  >,
};

/** Lista "3, 7,8" → [3, 7, 8] (inválida ou vazia: o padrão). */
export function tiposDoTexto(texto: string): number[] {
  const t = texto
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  return t.length > 0 ? t : [...TIPOS_INTENSIVA_PADRAO];
}

export class ConfiguracaoM16 {
  constructor(
    private readonly fonte: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
  ) {}

  private async dados(s: SujeitoM16) {
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

  /** As quatro chaves para esta pessoa e o setor ativo. */
  async liberacao(s: SujeitoM16): Promise<LiberacaoM16> {
    const r: LiberacaoM16 = { painel: false, paineis: false, fechamento: false, bi: false, motivos: {} };
    let d: Awaited<ReturnType<ConfiguracaoM16['dados']>>;
    try {
      d = await this.dados(s);
    } catch {
      d = null;
    }
    const motivos: Record<string, string> = {};
    const sujeito = {
      pessoa: s.login,
      ...(s.setor !== null ? { setor: String(s.setor) } : {}),
      ...(s.grupo ? { grupo: s.grupo } : {}),
    };
    const valores = { ...r } as Record<ChaveM16, boolean>;
    for (const k of Object.keys(CHAVES_LIBERACAO_M16) as ChaveM16[]) {
      const chave = CHAVES_LIBERACAO_M16[k];
      if (!d) {
        motivos[k] = MOTIVO_SEM_CONFIGURACAO;
        continue;
      }
      const chaves = d.chaves
        .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
        .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
      const declarados = recursoDesligado(chave)?.prerequisitos ?? [];
      const registrados = d.prerequisitos.filter((p) => p.recurso === chave);
      const situacao = situacaoDaChave({ chaves, declarados, registrados, sujeito, agora: new Date() });
      if (situacao === 'ligada') valores[k] = true;
      else
        motivos[k] =
          situacao === 'prerequisito'
            ? motivoPrerequisito(k)
            : situacao === 'fora-do-escopo'
              ? MOTIVO_FORA_DO_ESCOPO_ONDA_0
              : motivoDesligado(k);
    }
    return { ...valores, motivos };
  }

  /** Desligada: 403 `recurso-desligado` com o motivo (nada é lido). */
  async exigir(s: SujeitoM16, k: ChaveM16): Promise<void> {
    const l = await this.liberacao(s);
    if (!l[k])
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Funcionalidade desligada',
        l.motivos[k] ?? motivoDesligado(k),
        { codigo: 'recurso-desligado' },
      );
  }

  /** Parâmetros do M16 no estabelecimento (falha da fonte: o padrão do registro). */
  async parametros(s: Pick<SujeitoM16, 'rede' | 'hospital'>): Promise<ParametrosM16> {
    let valores: ValorParametro[] = [];
    try {
      valores = this.fonte ? await this.fonte.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const sujeito: SujeitoParametro = {
      rede: s.rede,
      empresa: null,
      estabelecimento: s.hospital,
      unidade: null,
      perfis: [],
      usuario: '',
    };
    const ler = (chave: string): string | number | boolean | null => {
      const def = definicaoParametro(chave);
      return def ? valorTipado(def, resolverParametro(def, valores, sujeito, new Date()).valor) : null;
    };
    const hora = ler('internacao.censo.horaFechamento');
    return {
      horaFechamento:
        typeof hora === 'number' && Number.isInteger(hora) && hora >= 1 && hora <= 24
          ? hora
          : HORA_FECHAMENTO_PADRAO,
      intensivas: tiposDoTexto(String(ler('internacao.acomodacao.intensiva') ?? '')),
      metas: Object.fromEntries(
        CODIGOS_INDICADOR.map((c) => [c, metaDoTexto(String(ler(`relatorio.meta.${c}`) ?? ''))]),
      ) as Record<CodigoIndicador, number | null>,
    };
  }
}
