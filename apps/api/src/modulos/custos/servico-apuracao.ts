// Apuração do custo do mês, custo por conta, resultado e exportação (M54, etapa 5; ficha, seções 4, 6, 7 e 8) — as telas
// `Controladoria > Custos hospitalares > Custo por procedimento e por paciente` (`/custos/apuracao`) e `Resultado por
// unidade e por convênio` (`/custos/resultado`). As regras são de @sgh/dominio-custos; aqui só a orquestração: lê a
// estrutura (etapa 4), as estatísticas vigentes e as fontes agregadas, apura, confere a conservação, assina o resultado
// (SHA-256 da forma canônica) e grava em SGH_CUS_* com a trilha na mesma transação.
import { createHash } from 'node:crypto';
import {
  AGRUPAMENTOS_RESULTADO,
  type AgrupamentoResultado,
  type ApoioApuracaoCustos,
  type ApuracaoCustos,
  type ApurarCustos,
  type ArquivoExportacaoCustos,
  type ClasseCentroCusto,
  type CodigoEstatistica,
  type ConsultaContasCusto,
  type CustoConta,
  DESTINOS_EXPORTACAO_CUSTOS,
  type DestinoExportacaoCustos,
  EVENTOS_AUDITAVEIS,
  GRUPOS_CUSTO_DIRETO,
  type GrupoResultado,
  ID_GRUPO_EXPORTACAO,
  LIMITE_LINHA_SAIDA_PADRAO_CENTAVOS,
  type LinhaApuracaoCentro,
  type PaginaContasCusto,
  type PainelApuracao,
  type PendenciaApuracaoCustos,
  PERMISSOES_CUSTOS_CODIGOS as P,
  type ResultadoCustos,
  type ResumoApuracao,
  ROTULOS_AGRUPAMENTO_RESULTADO,
  ROTULOS_DESTINO_EXPORTACAO,
  ROTULOS_GRUPO_CUSTO_DIRETO,
  ROTULOS_SITUACAO_APURACAO,
  SITUACOES_APURACAO,
  type SituacaoCompletude,
  TAMANHO_PAGINA_CONTAS_CUSTO,
  type TotaisApuracao,
} from '@sgh/contratos';
import {
  apurarCompetencia,
  type CentroParaApuracao,
  classeValida,
  competenciaFutura,
  conservacaoConfere,
  formaCanonica,
  gerarArquivoExportacao,
  indicadoresDaApuracao,
  intervaloDaCompetencia,
  margemPercentualCent,
  montarMatriz,
  pendenciasDaEstrutura,
} from '@sgh/dominio-custos';
import type { ApuracaoCustosLida, CustoContaLido, LinhaCentroLida } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoCustos, PortaCustos } from './porta.js';
import { fonteValida, paraDominio, paraEstrutura, type SessaoCustos } from './servico.js';

const ctx = (s: SessaoCustos): ContextoCustos => ({ rede: s.rede, hospital: s.hospital });
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

function json<T>(t: string, padrao: T): T {
  try {
    return JSON.parse(t) as T;
  } catch {
    return padrao;
  }
}

const recusa = (status: number, titulo: string, detalhe: string, codigo: string) =>
  new ErroProblema('recusa-de-negocio', status, titulo, detalhe, { codigo });

const naoEncontrada = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Apuração não encontrada',
    'A apuração não existe neste estabelecimento.',
  );

/** A linha por centro lida do banco no formato do contrato. */
export function linhaDaLida(x: LinhaCentroLida): LinhaApuracaoCentro {
  const recebidos = json<[number, number][]>(x.recebidos, []).map(([de, centavos]) => ({ de, centavos }));
  return {
    centro: x.centro,
    codigo: x.codigo,
    nome: x.nome,
    classe: (classeValida(x.classe) ? x.classe : 'produtivo') as ClasseCentroCusto,
    ordemRateio: x.ordemRateio,
    criterio: x.criterio as CodigoEstatistica | null,
    direto: { pessoal: x.pessoal, materiais: x.materiais, despesas: x.despesas },
    despesasGerais: x.despesasGerais,
    diretoTotal: x.diretoTotal,
    recebidos,
    recebidoTotal: x.recebidoTotal,
    repassado: x.repassado,
    naoRateado: x.naoRateado,
    custoFinal: x.custoFinal,
    baseCriterioCent: x.baseCriterioCent,
    producao:
      x.producaoCodigo && x.producaoCent
        ? { codigo: x.producaoCodigo as CodigoEstatistica, quantidadeCent: x.producaoCent }
        : null,
    custoUnitario: x.custoUnitario,
    receita: x.receita,
  };
}

export function contaDaLida(x: CustoContaLido): CustoConta {
  return {
    conta: x.conta,
    numero: x.numero,
    tipoConta: x.tipoConta,
    convenio: x.convenio,
    procedimento: x.procedimento,
    receitaBruta: x.receitaBruta,
    glosa: x.glosa,
    recurso: x.recurso,
    receitaLiquida: x.receitaLiquida,
    custo: x.custo,
    margem: x.margem,
    margemPercentualCent: margemPercentualCent(x.margem, x.receitaLiquida),
    parcelas: json<[number, number, number][]>(x.parcelas, []).map(([centro, receita, custo]) => ({
      centro,
      receita,
      custo,
    })),
    prontuario: x.prontuario,
  };
}

function resumoDe(a: ApuracaoCustosLida): ResumoApuracao {
  return {
    id: a.id,
    competencia: a.competencia,
    situacao: a.situacao,
    parcial: a.parcial,
    rotuloParcial: a.rotuloParcial,
    custoFinalProdutivos: a.custoProdutivos,
    impressao: a.impressao,
    apuradaPor: a.apuradaPor,
    apuradaEm: a.apuradaEm,
    aprovadaPor: a.aprovadaPor,
    aprovadaEm: a.aprovadaEm,
  };
}

const COMPLETUDE_VAZIA: SituacaoCompletude = { fontes: [], parcial: false, rotulo: null };

export function apuracaoDe(a: ApuracaoCustosLida, linhas: readonly LinhaCentroLida[]): ApuracaoCustos {
  return {
    id: a.id,
    competencia: a.competencia,
    situacao: a.situacao,
    versao: a.versao,
    completude: json<SituacaoCompletude>(a.completude, COMPLETUDE_VAZIA),
    limiteLinhaSaida: a.limiteLinha,
    totais: json<TotaisApuracao>(a.totais, {} as TotaisApuracao),
    linhas: linhas.map(linhaDaLida),
    pendencias: json<PendenciaApuracaoCustos[]>(a.pendencias, []),
    impressao: a.impressao,
    justificativa: a.justificativa,
    apuradaPor: a.apuradaPor,
    apuradaEm: a.apuradaEm,
    aprovadaPor: a.aprovadaPor,
    aprovadaEm: a.aprovadaEm,
    duracaoMs: a.duracaoMs,
  };
}

const vigenteDe = (as: readonly ApuracaoCustosLida[]) => as.find((a) => a.situacao !== 'substituida') ?? null;

const ROTULO_TIPO_CONTA: Readonly<Record<string, string>> = {
  I: 'Internação',
  E: 'Externa (ambulatório e exames)',
};

export class ServicoApuracaoCustos {
  constructor(private readonly porta: PortaCustos) {}

  apoio(s: SessaoCustos, ligada: boolean, gruposAtivos: ReadonlyMap<number, boolean>): ApoioApuracaoCustos {
    return {
      grupos: GRUPOS_CUSTO_DIRETO.map((valor) => ({ valor, rotulo: ROTULOS_GRUPO_CUSTO_DIRETO[valor] })),
      situacoes: SITUACOES_APURACAO.map((valor) => ({ valor, rotulo: ROTULOS_SITUACAO_APURACAO[valor] })),
      agrupamentos: AGRUPAMENTOS_RESULTADO.map((valor) => ({
        valor,
        rotulo: ROTULOS_AGRUPAMENTO_RESULTADO[valor],
      })),
      destinos: DESTINOS_EXPORTACAO_CUSTOS.map((valor) => ({
        valor,
        rotulo: ROTULOS_DESTINO_EXPORTACAO[valor],
        ativo: gruposAtivos.get(ID_GRUPO_EXPORTACAO[valor]) ?? false,
      })),
      limiteLinhaSaidaPadrao: LIMITE_LINHA_SAIDA_PADRAO_CENTAVOS,
      acoes: {
        apurar: ligada && s.pode(P.apuracaoApurar),
        aprovar: ligada && s.pode(P.apuracaoAprovar),
        exportar: ligada && s.pode(P.apuracaoExportar),
        resultado: s.pode(P.resultadoLer),
      },
      liberacao: { ligada },
    };
  }

  /** O que bloqueia a apuração: as pendências bloqueantes da estrutura (etapa 4). */
  private async bloqueios(s: SessaoCustos): Promise<{
    bloqueios: PendenciaApuracaoCustos[];
    centros: CentroParaApuracao[];
  }> {
    const [lidos, d] = await Promise.all([this.porta.centros(ctx(s)), this.porta.dominios(ctx(s))]);
    const est = lidos.map(paraEstrutura);
    const pend = pendenciasDaEstrutura(est.map(paraDominio), new Set(d.unidades.map((u) => u.codigo)));
    return {
      bloqueios: pend
        .filter((p) => p.bloqueia)
        .map((p) => ({
          tipo: 'estrutura',
          bloqueia: true,
          centros: p.centros,
          centavos: 0,
          mensagem: p.mensagem,
        })),
      centros: est.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        nome: c.nome,
        ativo: c.ativo,
        classificacao: c.classificacao
          ? {
              classe: c.classificacao.classe,
              ordemRateio: c.classificacao.ordemRateio,
              criterio: c.classificacao.criterio,
            }
          : null,
      })),
    };
  }

  async painel(s: SessaoCustos, competencia: string): Promise<PainelApuracao> {
    const [as, b] = await Promise.all([this.porta.apuracoes(ctx(s), competencia), this.bloqueios(s)]);
    const v = vigenteDe(as);
    return {
      competencia,
      apuracao: v ? apuracaoDe(v, await this.porta.linhasApuracao(ctx(s), v.id)) : null,
      historico: as.map(resumoDe),
      bloqueios: b.bloqueios,
    };
  }

  /** Apura a competência e grava (a apuração vigente fica substituída). */
  async apurar(s: SessaoCustos, x: ApurarCustos, hoje: string): Promise<ApuracaoCustos> {
    if (competenciaFutura(x.competencia, hoje))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Competência futura',
        'A apuração é da competência corrente ou de uma anterior.',
        { campos: ['competencia'] },
      );
    const t0 = performance.now();
    const [b, as] = await Promise.all([this.bloqueios(s), this.porta.apuracoes(ctx(s), x.competencia)]);
    if (b.bloqueios.length > 0)
      throw recusa(
        422,
        'Estrutura de custos com pendência',
        `Resolva antes na estrutura de custos: ${b.bloqueios.map((p) => p.mensagem).join(' ')}`,
        'estrutura-pendente',
      );
    const vigente = vigenteDe(as);
    if (vigente?.situacao === 'aprovada') {
      if (!s.pode(P.apuracaoAprovar))
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Apuração aprovada',
          'A competência já tem apuração aprovada: refazer exige a permissão de aprovar a apuração.',
          { codigo: 'apuracao-aprovada' },
        );
      if (!x.justificativa)
        throw recusa(
          422,
          'Justificativa obrigatória',
          'A competência já tem apuração aprovada: justifique por que refazer (a aprovada fica guardada como substituída).',
          'justificativa-obrigatoria',
        );
    }
    const i = intervaloDaCompetencia(x.competencia);
    const [ano, mes] = x.competencia.split('-').map(Number) as [number, number];
    const [fontes, est] = await Promise.all([
      this.porta.fontesCusteio(ctx(s), {
        ano,
        mes,
        inicio: i.inicio,
        fim: i.fim,
        competencia: x.competencia,
        limiteLinhaCentavos: x.limiteLinhaSaida,
      }),
      this.porta.estatisticas(ctx(s), x.competencia),
    ]);
    if (fontes.truncado)
      throw recusa(
        422,
        'Competência grande demais',
        'A competência tem mais itens de conta do que a apuração lê de uma vez: nada foi gravado. Avise o suporte.',
        'fontes-truncadas',
      );
    const matriz = montarMatriz(
      x.competencia,
      est.registros.map((r) => ({ ...r, fonte: fonteValida(r.fonte) })),
    );
    const r = apurarCompetencia({ centros: b.centros, fontes, matriz });
    if (!conservacaoConfere(r.totais))
      throw new ErroProblema(
        'erro-interno',
        500,
        'Apuração não fechou',
        'A soma das parcelas não fechou com o custo lido: nada foi gravado.',
      );
    const pendencias = est.truncado
      ? [
          ...r.pendencias,
          {
            tipo: 'sem-base' as const,
            bloqueia: false,
            centros: [],
            centavos: 0,
            mensagem:
              'A competência tem mais estatísticas do que a apuração leu: confira a matriz de estatísticas.',
          },
        ]
      : r.pendencias;
    const impressao = sha256(`${x.competencia}|${x.limiteLinhaSaida}|${formaCanonica(r)}`);
    const g = await this.porta.gravarApuracao(
      ctx(s),
      {
        competencia: x.competencia,
        substitui: vigente ? { id: vigente.id, versao: vigente.versao } : null,
        rotuloParcial: r.completude.rotulo,
        limiteLinha: x.limiteLinhaSaida,
        custoProdutivos: r.totais.custoFinalProdutivos,
        totais: JSON.stringify(r.totais),
        completude: JSON.stringify(r.completude),
        pendencias: JSON.stringify(pendencias),
        impressao,
        justificativa: x.justificativa,
        duracaoMs: performance.now() - t0,
        linhas: r.linhas.map((l) => ({
          centro: l.centro,
          codigo: l.codigo,
          nome: l.nome,
          classe: l.classe,
          ordemRateio: l.ordemRateio,
          criterio: l.criterio,
          pessoal: l.direto.pessoal,
          materiais: l.direto.materiais,
          despesas: l.direto.despesas,
          despesasGerais: l.despesasGerais,
          diretoTotal: l.diretoTotal,
          recebidoTotal: l.recebidoTotal,
          recebidos: l.recebidos.map((p) => [p.de, p.centavos] as const),
          repassado: l.repassado,
          naoRateado: l.naoRateado,
          custoFinal: l.custoFinal,
          baseCriterioCent: l.baseCriterioCent,
          producaoCodigo: l.producao?.codigo ?? null,
          producaoCent: l.producao?.quantidadeCent ?? null,
          custoUnitario: l.custoUnitario,
          receita: l.receita,
        })),
        contas: r.contas.map((c) => ({
          conta: c.conta,
          numero: c.numero,
          tipoConta: c.tipoConta,
          convenio: c.convenio,
          procedimento: c.procedimento,
          receitaBruta: c.receitaBruta,
          glosa: c.glosa,
          recurso: c.recurso,
          receitaLiquida: c.receitaLiquida,
          custo: c.custo,
          margem: c.margem,
          parcelas: c.parcelas.map((p) => [p.centro, p.receita, p.custo] as const),
        })),
      },
      s.login,
      s.trilha(EVENTOS_AUDITAVEIS.custosApurado.codigo, 'apurar', 'SGH_CUS_APURACAO', null),
    );
    return apuracaoDe(g.apuracao, await this.porta.linhasApuracao(ctx(s), g.apuracao.id));
  }

  async aprovar(s: SessaoCustos, id: number, versao: number): Promise<ApuracaoCustos> {
    const r = await this.porta.aprovarApuracao(
      ctx(s),
      id,
      versao,
      s.login,
      s.trilha(EVENTOS_AUDITAVEIS.custosApuracaoAprovada.codigo, 'aprovar', 'SGH_CUS_APURACAO', id),
    );
    if (!r) throw naoEncontrada();
    return apuracaoDe(r.depois, await this.porta.linhasApuracao(ctx(s), id));
  }

  async resultado(
    s: SessaoCustos,
    competencia: string,
    agrupamento: AgrupamentoResultado,
  ): Promise<ResultadoCustos> {
    const v = vigenteDe(await this.porta.apuracoes(ctx(s), competencia));
    const vazio = {
      contas: 0,
      receitaBruta: 0,
      glosa: 0,
      recurso: 0,
      receitaLiquida: 0,
      custo: 0,
      margem: 0,
      margemPercentualCent: null,
    };
    if (!v) return { competencia, apuracao: null, agrupamento, grupos: [], total: vazio, indicadores: [] };
    const linhas = (await this.porta.linhasApuracao(ctx(s), v.id)).map(linhaDaLida);
    let grupos: GrupoResultado[];
    if (agrupamento === 'centro') {
      grupos = linhas
        .filter((l) => l.classe === 'produtivo' || l.receita !== 0)
        .map((l) => {
          const custo = l.classe === 'produtivo' ? l.custoFinal : 0;
          return {
            chave: String(l.centro),
            rotulo: `${l.codigo} ${l.nome}`,
            contas: 0,
            receitaBruta: l.receita,
            glosa: 0,
            recurso: 0,
            receitaLiquida: l.receita,
            custo,
            margem: l.receita - custo,
            margemPercentualCent: margemPercentualCent(l.receita - custo, l.receita),
          };
        })
        .sort((a, b) => b.receitaLiquida - a.receitaLiquida || a.chave.localeCompare(b.chave));
    } else {
      const lidos = await this.porta.resultadoAgrupado(ctx(s), v.id, agrupamento);
      const nomes =
        agrupamento === 'convenio'
          ? await this.porta.nomesConvenios(
              ctx(s),
              lidos.map((g) => Number(g.chave)).filter((n) => Number.isSafeInteger(n)),
            )
          : new Map<number, string>();
      const rotulo = (k: string | null): string => {
        if (k === null)
          return agrupamento === 'convenio'
            ? 'Sem convênio'
            : agrupamento === 'paciente'
              ? 'Sem prontuário'
              : 'Não informado';
        if (agrupamento === 'paciente') return `Prontuário ${k}`;
        if (agrupamento === 'convenio') return nomes.get(Number(k)) ?? `Convênio ${k}`;
        if (agrupamento === 'tipoConta') return ROTULO_TIPO_CONTA[k] ?? k;
        return k;
      };
      grupos = lidos
        .map((g) => ({
          chave: g.chave ?? 'sem',
          rotulo: rotulo(g.chave),
          contas: g.contas,
          receitaBruta: g.receitaBruta,
          glosa: g.glosa,
          recurso: g.recurso,
          receitaLiquida: g.receitaLiquida,
          custo: g.custo,
          margem: g.margem,
          margemPercentualCent: margemPercentualCent(g.margem, g.receitaLiquida),
        }))
        .sort((a, b) => b.receitaLiquida - a.receitaLiquida || a.chave.localeCompare(b.chave));
    }
    const t = grupos.reduce(
      (a, g) => ({
        contas: a.contas + g.contas,
        receitaBruta: a.receitaBruta + g.receitaBruta,
        glosa: a.glosa + g.glosa,
        recurso: a.recurso + g.recurso,
        receitaLiquida: a.receitaLiquida + g.receitaLiquida,
        custo: a.custo + g.custo,
        margem: a.margem + g.margem,
      }),
      { contas: 0, receitaBruta: 0, glosa: 0, recurso: 0, receitaLiquida: 0, custo: 0, margem: 0 },
    );
    return {
      competencia,
      apuracao: resumoDe(v),
      agrupamento,
      grupos,
      total: { ...t, margemPercentualCent: margemPercentualCent(t.margem, t.receitaLiquida) },
      indicadores: indicadoresDaApuracao(linhas),
    };
  }

  async contas(s: SessaoCustos, q: ConsultaContasCusto): Promise<PaginaContasCusto> {
    const v = vigenteDe(await this.porta.apuracoes(ctx(s), q.competencia));
    if (!v)
      return {
        competencia: q.competencia,
        pagina: q.pagina,
        tamanho: TAMANHO_PAGINA_CONTAS_CUSTO,
        total: 0,
        contas: [],
      };
    const r = await this.porta.contasApuracao(ctx(s), v.id, {
      convenio: q.convenio,
      procedimento: q.procedimento,
      numero: q.numero,
      prontuario: q.prontuario,
      negativas: q.negativas,
      pagina: q.pagina,
    });
    return {
      competencia: q.competencia,
      pagina: q.pagina,
      tamanho: TAMANHO_PAGINA_CONTAS_CUSTO,
      total: r.total,
      contas: r.contas.map(contaDaLida),
    };
  }

  /** Gera o arquivo da apuração APROVADA da competência para o destino (só gera; o envio só existe em produção). */
  async exportar(
    s: SessaoCustos,
    competencia: string,
    destino: DestinoExportacaoCustos,
  ): Promise<ArquivoExportacaoCustos> {
    const [as, d] = await Promise.all([
      this.porta.apuracoes(ctx(s), competencia),
      this.porta.dominios(ctx(s)),
    ]);
    const v = vigenteDe(as);
    if (!v || v.situacao !== 'aprovada')
      throw recusa(
        422,
        'Apuração não aprovada',
        'Só a apuração aprovada da competência é exportada. Apure e aprove antes.',
        'apuracao-nao-aprovada',
      );
    const grupo = d.gruposExportacao.find((g) => g.id === ID_GRUPO_EXPORTACAO[destino]);
    if (!grupo?.ativo)
      throw recusa(
        422,
        'Destino inativo',
        'O destino de exportação está inativo no cadastro de grupos de exportação.',
        'destino-inativo',
      );
    const [linhas, codigos] = await Promise.all([
      this.porta.linhasApuracao(ctx(s), v.id),
      this.porta.codigosExportacao(ctx(s)),
    ]);
    const unidade = new Map(codigos.unidades.map((u) => [u.codigo, u.codigoApurasus]));
    const a = gerarArquivoExportacao({
      destino,
      competencia,
      hospital: s.hospital,
      rotuloParcial: v.rotuloParcial,
      linhas: linhas.map(linhaDaLida),
      centros: new Map(
        codigos.centros.map((c) => [
          c.id,
          {
            id: c.id,
            codigoApurasus: c.codigoApurasus,
            unidadeApurasus: c.unidade === null ? null : (unidade.get(c.unidade) ?? null),
          },
        ]),
      ),
    });
    return {
      destino,
      competencia,
      nomeArquivo: a.nomeArquivo,
      conteudo: a.conteudo,
      linhas: a.linhas,
      sha256: sha256(a.conteudo),
      semCodigo: a.semCodigo,
      envio: 'somente-producao',
      avisos: a.avisos,
    };
  }
}
