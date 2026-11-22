// Estrutura de custos e estatísticas (M54, etapa 4; ficha, seções 4, 6, 7 e 8): a tela `Controladoria > Custos
// hospitalares > Centros de custo e critérios de rateio` (`/custos/centros`). Os centros de custo são os do banco
// (centro_custo do estabelecimento); a classificação, a ordem e o critério do rateio ficam no próprio centro, e as
// estatísticas em estatistica_centro_mes.
// As regras são de @sgh/dominio-custos; aqui só a orquestração (leituras, validação contra os domínios do banco,
// gravação com a trilha na mesma transação).
import {
  type ApoioCustos,
  CLASSES_CENTRO_CUSTO,
  type CentroCustoEstrutura,
  type ClassificarCentro,
  type ColetaEstatisticas,
  DESCRICOES_CLASSE_CENTRO,
  definicaoEstatistica,
  ESTATISTICAS_CUSTO,
  EVENTOS_AUDITAVEIS,
  FONTES_ESTATISTICA,
  type FonteEstatistica,
  type LancarEstatistica,
  type ListaEstruturaCustos,
  type MatrizEstatisticas,
  type ResumoFonteColeta,
  ROTULOS_CLASSE_CENTRO,
  ROTULOS_FONTE_ESTATISTICA,
  TIPOS_DADO_ESTATISTICA,
  type ValorEstatistica,
} from '@sgh/contratos';
import {
  centesimos,
  type CentroParaEstrutura,
  classeValida,
  competenciaFutura,
  contarEstrutura,
  deCentesimos,
  intervaloDaCompetencia,
  montarMatriz,
  pendenciasDaEstrutura,
  planejarColeta,
  sequenciaDoRateio,
  sugerirClasse,
} from '@sgh/dominio-custos';
import type {
  CentroCustoCadastrado,
  ColetaRegistrada,
  EstatisticaRegistrada,
  TrilhaCustos,
} from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoCustos, PortaCustos } from './porta.js';

export interface SessaoCustos {
  readonly rede: string;
  readonly hospital: string;
  /** Id do estabelecimento e do usuário no banco do cliente (null: a porta resolve pelo código ou grava sem usuário). */
  readonly estabelecimento?: number | null;
  readonly usuario?: number | null;
  readonly correlacao?: string;
  readonly login: string;
  pode(codigo: string): boolean;
  /** A linha da trilha de uma gravação. */
  trilha(evento: string, operacao: string, tabela: string, id: number | null): TrilhaCustos;
}

const ctx = (s: SessaoCustos): ContextoCustos => ({
  rede: s.rede,
  hospital: s.hospital,
  estabelecimento: s.estabelecimento ?? null,
  usuario: s.usuario ?? null,
  ...(s.correlacao ? { correlacao: s.correlacao } : {}),
});

export function paraEstrutura(x: CentroCustoCadastrado): CentroCustoEstrutura {
  const k = x.classificacao;
  return {
    id: x.id,
    codigo: x.codigo,
    nome: x.nome,
    sigla: x.sigla,
    ativo: x.ativo,
    produtivoCadastro: x.produtivoCadastro,
    classificacao:
      k && classeValida(k.classe)
        ? {
            classe: k.classe,
            ordemRateio: k.ordemRateio,
            criterio: (definicaoEstatistica(k.criterio ?? '')?.codigo ?? k.criterio) as never,
            unidadeMensuracao: k.unidadeMensuracao,
            observacao: k.observacao,
            versao: k.versao,
            alteradoPor: k.alteradoPor,
            alteradoEm: k.alteradoEm,
          }
        : null,
    sugestao: k ? null : sugerirClasse(x.produtivoCadastro, x.nome),
  };
}

export function paraDominio(c: CentroCustoEstrutura): CentroParaEstrutura {
  return {
    id: c.id,
    codigo: c.codigo,
    nome: c.nome,
    ativo: c.ativo,
    produtivoCadastro: c.produtivoCadastro,
    classificacao: c.classificacao,
  };
}

const naoEncontrado = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Centro de custo não encontrado',
    'O centro de custo não existe neste estabelecimento.',
  );

export function fonteValida(v: string): FonteEstatistica {
  return (FONTES_ESTATISTICA as readonly string[]).includes(v) ? (v as FonteEstatistica) : 'manual';
}

function coletaDaLida(x: ColetaRegistrada): ColetaEstatisticas {
  let r: { fontes?: ResumoFonteColeta[]; gravadas?: number; substituidas?: number } = {};
  try {
    r = JSON.parse(x.resumo) as typeof r;
  } catch {
    r = {};
  }
  return {
    id: x.id,
    competencia: x.competencia,
    fontes: Array.isArray(r.fontes) ? r.fontes : [],
    gravadas: x.linhas,
    substituidas: Number(r.substituidas ?? 0),
    duracaoMs: x.duracaoMs,
    coletadaPor: x.coletadaPor,
    coletadaEm: x.coletadaEm,
  };
}

function valorDoRegistro(r: EstatisticaRegistrada): ValorEstatistica {
  return {
    id: r.id,
    quantidade: deCentesimos(r.cent),
    origem: r.origem,
    fonte: fonteValida(r.fonte),
    estimada: r.estimada,
    herdadaDe: null,
    observacao: r.observacao,
    registradoPor: r.registradoPor,
    registradoEm: r.registradoEm,
  };
}

export class ServicoCustos {
  constructor(private readonly porta: PortaCustos) {}

  async apoio(
    s: SessaoCustos,
    codigos: { editar: string; registrar: string },
    ligada: boolean,
  ): Promise<ApoioCustos> {
    const d = await this.porta.dominios(ctx(s));
    return {
      classes: CLASSES_CENTRO_CUSTO.map((valor) => ({
        valor,
        rotulo: ROTULOS_CLASSE_CENTRO[valor],
        descricao: DESCRICOES_CLASSE_CENTRO[valor],
      })),
      estatisticas: ESTATISTICAS_CUSTO,
      fontes: FONTES_ESTATISTICA.map((valor) => ({ valor, rotulo: ROTULOS_FONTE_ESTATISTICA[valor] })),
      tiposDado: d.tiposDado,
      unidades: d.unidades,
      gruposExportacao: d.gruposExportacao,
      acoes: {
        editar: ligada && s.pode(codigos.editar),
        registrarEstatistica: ligada && s.pode(codigos.registrar),
      },
      liberacao: { ligada },
    };
  }

  async estrutura(s: SessaoCustos): Promise<ListaEstruturaCustos> {
    const [lidos, d] = await Promise.all([this.porta.centros(ctx(s)), this.porta.dominios(ctx(s))]);
    const centros = lidos.map(paraEstrutura);
    const dominio = centros.map(paraDominio);
    return {
      centros,
      pendencias: pendenciasDaEstrutura(dominio, new Set(d.unidades.map((u) => u.codigo))),
      contagem: contarEstrutura(dominio),
      sequencia: sequenciaDoRateio(dominio),
    };
  }

  /** Classifica ou reclassifica um centro (pela versão lida); devolve o centro e se mudou. */
  async classificar(
    s: SessaoCustos,
    id: number,
    x: ClassificarCentro,
  ): Promise<{ centro: CentroCustoEstrutura; mudou: boolean }> {
    const atual = await this.porta.centro(ctx(s), id);
    if (!atual) throw naoEncontrado();
    if (!atual.ativo && atual.classificacao === null)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Centro de custo inativo',
        'O centro está inativo no cadastro: não entra no rateio e não recebe classificação nova.',
        { codigo: 'centro-inativo' },
      );
    if (x.unidadeMensuracao !== null) {
      const d = await this.porta.dominios(ctx(s));
      if (!d.unidades.some((u) => u.codigo === x.unidadeMensuracao))
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Unidade de mensuração desconhecida',
          'Escolha uma unidade de mensuração do cadastro.',
          { campos: ['unidadeMensuracao'] },
        );
    }
    const r = await this.porta.classificar(
      ctx(s),
      {
        centro: id,
        classe: x.classe,
        ordemRateio: x.ordemRateio,
        criterio: x.criterio,
        unidadeMensuracao: x.unidadeMensuracao,
        observacao: x.observacao?.trim() ? x.observacao.trim() : null,
        versao: x.versao,
      },
      s.login,
      s.trilha(
        EVENTOS_AUDITAVEIS.custosCentroClassificado.codigo,
        'custos.classificarCentro',
        'centro_custo',
        id,
      ),
    );
    if (!r) throw naoEncontrado();
    return { centro: paraEstrutura(r.depois), mudou: r.mudou };
  }

  async matriz(s: SessaoCustos, competencia: string): Promise<MatrizEstatisticas> {
    const [{ registros, truncado }, coleta] = await Promise.all([
      this.porta.estatisticas(ctx(s), competencia),
      this.porta.ultimaColeta(ctx(s), competencia),
    ]);
    const m = montarMatriz(
      competencia,
      registros.map((r) => ({ ...r, fonte: fonteValida(r.fonte) })),
    );
    return {
      ...m,
      ultimaColeta: coleta ? coletaDaLida(coleta) : null,
      avisos: truncado
        ? [...m.avisos, 'A competência tem mais registros do que a tela mostra: refine antes da apuração.']
        : m.avisos,
    };
  }

  /** Coleta as estatísticas da competência das fontes do banco e grava (substitui só as coletadas). */
  async coletar(s: SessaoCustos, competencia: string, hoje: string): Promise<ColetaEstatisticas> {
    if (competenciaFutura(competencia, hoje))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Competência futura',
        'A coleta é da competência corrente ou de uma anterior.',
        { campos: ['competencia'] },
      );
    const t0 = performance.now();
    const intervalo = intervaloDaCompetencia(competencia);
    const [centros, fontes] = await Promise.all([
      this.porta.centros(ctx(s)),
      this.porta.fontes(ctx(s), {
        inicio: intervalo.inicio,
        fim: intervalo.fim,
        seguinte: intervalo.seguinte,
      }),
    ]);
    const plano = planejarColeta(
      fontes,
      centros.map((c) => ({ id: c.id, codigo: c.codigo })),
      intervalo.dias,
    );
    const fontesResumo = plano.fontes.map((f) => ({ ...f, aviso: f.aviso ? f.aviso.slice(0, 160) : null }));
    const duracaoMs = Math.round(performance.now() - t0);
    const r = await this.porta.gravarColeta(
      ctx(s),
      {
        competencia,
        linhas: plano.linhas,
        resumo: JSON.stringify({ fontes: fontesResumo }),
        duracaoMs,
      },
      s.login,
      s.trilha(
        EVENTOS_AUDITAVEIS.custosEstatisticasColetadas.codigo,
        'custos.coletarEstatisticas',
        'estatistica_centro_mes',
        null,
      ),
    );
    const ultima = await this.porta.ultimaColeta(ctx(s), competencia);
    return {
      id: r.id,
      competencia,
      fontes: fontesResumo,
      gravadas: r.gravadas,
      substituidas: r.substituidas,
      duracaoMs,
      coletadaPor: s.login,
      coletadaEm: ultima?.id === r.id ? ultima.coletadaEm : '',
    };
  }

  /** Lança uma estatística à mão (substitui o lançamento manual anterior do mesmo centro, estatística e competência). */
  async lancar(
    s: SessaoCustos,
    x: LancarEstatistica,
  ): Promise<{ valor: ValorEstatistica; substituidas: number }> {
    const centro = await this.porta.centro(ctx(s), x.centro);
    if (!centro) throw naoEncontrado();
    if (!centro.ativo)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Centro de custo inativo',
        'O centro está inativo no cadastro: não entra no rateio.',
        { codigo: 'centro-inativo' },
      );
    const def = definicaoEstatistica(x.codigo);
    const r = await this.porta.lancar(
      ctx(s),
      {
        competencia: x.competencia,
        centro: x.centro,
        codigo: x.codigo,
        cent: centesimos(x.quantidade),
        tipoDado: def?.tipoDado ?? TIPOS_DADO_ESTATISTICA.lancamento,
        observacao: x.observacao?.trim() ? x.observacao.trim() : null,
      },
      s.login,
      s.trilha(
        EVENTOS_AUDITAVEIS.custosEstatisticaLancada.codigo,
        'custos.lancarEstatistica',
        'estatistica_centro_mes',
        null,
      ),
    );
    return { valor: valorDoRegistro(r.registro), substituidas: r.substituidas };
  }
}
