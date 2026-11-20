// Serviço da rescisão, fatia F4 (M53.5; ficha do M53, seções 4 a 8, regras 7 e 8): a fila dos colaboradores desligados
// (o desligamento é registrado no colaborador, M52), o cálculo do termo (prévia ou gravado: um processamento `rescisao`
// com a memória por rubrica e a rescisão em SGH_PES_RESCISAO, substituindo a anterior do vínculo), o detalhe e o
// cancelamento. A conta é a regra pura de @sgh/dominio-pessoas; grava só SGH_ (a rescisão, o processamento, as linhas e o
// cancelamento das férias programadas que a rescisão indeniza) com a trilha na mesma transação, atrás da chave
// `pessoas.folha` (POL-3). Nenhuma resposta traz CPF ou nome.
import { createHash } from 'node:crypto';
import {
  type ApoioRescisao,
  AVISOS_DA_MODALIDADE,
  type CalcularRescisaoEntrada,
  type CancelarRescisaoEntrada,
  CHAVE_PESSOAS_FOLHA,
  type ConferenciaCalculoFolha,
  type DetalheRescisao,
  EVENTOS_AUDITAVEIS,
  type FiltroDesligados,
  type FiltroRescisoes,
  type LinhaCalculoFolha,
  type ListaDesligados,
  type ListaRescisoes,
  MODALIDADES_RESCISAO,
  type RecusaRescisao,
  type RescisaoDoVinculo,
  type ResultadoCalculoRescisao,
  type ResultadoFolha,
  type TipoVinculoTrabalho,
} from '@sgh/contratos';
import {
  calcularRescisao,
  conferirCalculo,
  conferirRescisao,
  type FeriasRegistrada,
  jsonCanonico,
  maisCompetencias,
  modalidadeSugerida,
  periodoDaCompetencia,
  totalizarCalculo,
  type VinculoParaCalculo,
} from '@sgh/dominio-pessoas';
import {
  type FeriasPesLida,
  type LinhaCalculoSgh,
  type RescisaoPesLida,
  TETO_DESLIGADOS,
  TETO_RESCISOES_LISTA,
  type VinculoPesLido,
} from '@sgh/legado';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaRealizado } from '../escala/porta-realizado.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import type { ContextoCalculoFolha, GravadorCalculoFolha, PortaCalculoFolha } from './porta-calculo.js';
import type { PortaFolha } from './porta-folha.js';
import {
  cabecalhoDoProcesso,
  colaboradorDoResumo,
  feriasDoMes,
  pontoFechadoPorVinculo,
  resumoDoProcesso,
  sobreavisoPorVinculo,
} from './servico-calculo.js';

export const PERMISSOES_RESCISAO_FOLHA = {
  ler: 'pessoas.rescisao.ler',
  calcular: 'pessoas.rescisao.calcular',
  salarioLer: 'pessoas.salario.ler',
} as const;
const P = PERMISSOES_RESCISAO_FOLHA;
const E = EVENTOS_AUDITAVEIS;

/** O texto de cada recusa do cálculo (texto de produto; a tela também traduz pelo código). */
export const MENSAGEM_RECUSA_RESCISAO: Readonly<Record<RecusaRescisao, string>> = {
  'vinculo-ativo':
    'O colaborador não tem desligamento registrado: registre o desligamento no cadastro antes.',
  'vinculo-sem-rescisao': 'Este tipo de vínculo não tem rescisão pela CLT.',
  'aviso-invalido': 'O aviso prévio escolhido não serve a esta modalidade de rescisão.',
  'termo-obrigatorio': 'A antecipação do contrato a prazo exige a data do termo do contrato.',
  'termo-invalido': 'O termo do contrato vem depois da data do desligamento.',
  'pagamento-antes': 'O pagamento da rescisão não pode ser antes do desligamento.',
};

/** O motivo gravado nas férias programadas que a rescisão indeniza (D-FERPROG-535). */
export const MOTIVO_FERIAS_NA_RESCISAO = 'Desligamento: os dias saem indenizados na rescisão.';

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const semPermissao = (mensagem: string) =>
  new ErroProblema('sem-permissao', 403, 'Sem permissão', mensagem, { codigo: 'sem-permissao' });
const recusa = (codigo: string, mensagem: string, campo: string | null = null, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campo ? { campos: [campo] } : {}),
    ...extra,
  });
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

const TIPOS_VINCULO: readonly TipoVinculoTrabalho[] = [
  'clt',
  'estatutario',
  'cooperado',
  'pj',
  'residente',
  'estagiario',
  'terceiro',
];
const tipoVinculo = (t: string): TipoVinculoTrabalho =>
  (TIPOS_VINCULO as readonly string[]).includes(t) ? (t as TipoVinculoTrabalho) : 'terceiro';

const paraCalculo = (v: VinculoPesLido): VinculoParaCalculo => ({
  id: v.id,
  matricula: v.matricula,
  tipo: tipoVinculo(v.tipo),
  admissao: v.admissao,
  desligamento: v.desligamento,
  centroCusto: v.centroCusto,
  cargaSemanal: v.cargaSemanal,
});

/**
 * A rescisão para a saída da API. `verSalario` falso (sem `pessoas.salario.ler`): o saldo e a multa do FGTS saem null,
 * porque a multa é um percentual de (saldo + FGTS desta rescisão) e revela a remuneração (D-PERM-SAL-535).
 */
export const paraRescisao = (r: RescisaoPesLida, verSalario: boolean): RescisaoDoVinculo => ({
  id: r.id,
  vinculo: r.vinculo,
  empresa: r.empresa,
  desligamento: r.desligamento,
  tipoRescisao: r.tipoRescisao,
  modalidade: r.modalidade,
  aviso: r.aviso,
  diasAviso: r.diasAviso,
  diasIndenizados: r.diasIndenizados,
  projecao: r.projecao,
  termo: r.termo,
  saldoFgts: verSalario ? r.saldoFgts : null,
  saldoFgtsInformado: r.saldoFgtsInformado,
  multaFgts: verSalario ? r.multaFgts : null,
  pagamento: r.pagamento,
  situacao: r.situacao,
  processo: r.processo,
  motivo: r.motivo,
  registradoPor: r.registradoPor,
  registradoEm: r.registradoEm,
  situacaoPor: r.situacaoPor,
  situacaoEm: r.situacaoEm,
  versao: r.versao,
});

const registrada = (f: FeriasPesLida): FeriasRegistrada => ({
  id: f.id,
  aquisitivoInicio: f.aquisitivoInicio,
  inicio: f.inicio,
  fim: f.fim,
  dias: f.dias,
  abono: f.abono,
  adiantarDecimo: f.adiantarDecimo,
  situacao: f.situacao,
});

const linhaSaida = (l: LinhaCalculoSgh | LinhaCalculoFolha): LinhaCalculoFolha => ({
  papel: l.papel,
  tipo: l.tipo,
  rubrica: l.rubrica,
  codigoRubrica: l.codigoRubrica,
  quantidade: l.quantidade,
  unidade: l.unidade,
  valor: l.valor,
  memoria: l.memoria,
});

/** O carimbo do que foi lido do colaborador (id, situação e versão): muda se outra pessoa gravou nele. */
const carimbo = (xs: readonly { id: number; situacao: string; versao: number }[]) =>
  xs
    .map((x) => `${x.id}:${x.situacao}:${x.versao}`)
    .sort()
    .join(',');
const carimboInsumos = (sal: readonly unknown[], par: readonly unknown[]): string =>
  [sal, par]
    .map((xs) =>
      xs
        .map((x) => JSON.stringify(x))
        .sort()
        .join('\n'),
    )
    .join('\n--\n');

export class ServicoRescisaoFolha {
  readonly apoio: ApoioGravacao<GravadorCalculoFolha>;

  constructor(
    readonly porta: PortaCalculoFolha,
    readonly folha: PortaFolha,
    readonly rubricas: PortaRubricas,
    readonly pessoas: PortaPessoas,
    readonly ponto: PortaPonto,
    readonly realizado: PortaRealizado,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorCalculoFolha>(
      { chave: CHAVE_PESSOAS_FOLHA, nome: 'a folha de pagamento', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private ctx(s: SessaoCadastro): ContextoCalculoFolha {
    return s.porta;
  }

  private async exigirEmpresa(s: SessaoCadastro, empresa: number): Promise<void> {
    const es = await this.folha.empresas(this.ctx(s));
    if (!es.some((e) => e.codigo === empresa)) throw naoEncontrado('Empresa');
  }

  private async vinculoOu404(s: SessaoCadastro, id: number): Promise<VinculoPesLido> {
    const v = await this.pessoas.vinculo(s.porta, id);
    if (!v) throw naoEncontrado('Colaborador');
    return v;
  }

  private async rescisaoOu404(s: SessaoCadastro, id: number): Promise<RescisaoPesLida> {
    const r = await this.porta.rescisaoPorId(this.ctx(s), id);
    if (!r) throw naoEncontrado('Rescisão');
    return r;
  }

  // ── Apoio e listas ──────────────────────────────────────────────────────────────────────────────────────────

  async apoioTela(s: SessaoCadastro): Promise<ApoioRescisao> {
    const c = this.ctx(s);
    const [relogio, empresas, tipos, gravacao] = await Promise.all([
      this.folha.relogio(c),
      this.folha.empresas(c),
      this.porta.tiposRescisao(c),
      this.apoio.gravacao(s, { calcular: P.calcular }),
    ]);
    const op = gravacao.operacoes['calcular'];
    return {
      hoje: relogio.hoje,
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: {
        calcular: op?.pode ?? false,
        verSalario: s.pode(P.salarioLer),
        motivo: op && !op.pode ? (op.motivo ?? gravacao.motivo) : null,
      },
      empresas: empresas.map((e) => ({ codigo: e.codigo, rotulo: e.rotulo })),
      modalidades: MODALIDADES_RESCISAO.map((modalidade) => ({
        modalidade,
        avisos: AVISOS_DA_MODALIDADE[modalidade],
      })),
      tiposRescisao: tipos.map((t) => ({ id: t.id, nome: t.nome, modalidade: modalidadeSugerida(t) })),
    };
  }

  async desligados(s: SessaoCadastro, f: FiltroDesligados): Promise<ListaDesligados> {
    const c = this.ctx(s);
    const [xs, tipos] = await Promise.all([
      this.porta.desligados(c, f.de, f.ate),
      this.porta.tiposRescisao(c),
    ]);
    const sugestao = new Map(tipos.map((t) => [t.id, modalidadeSugerida(t)]));
    return {
      itens: xs.slice(0, TETO_DESLIGADOS).map((x) => ({
        vinculo: x.vinculo,
        matricula: x.matricula,
        tipo: x.tipo,
        admissao: x.admissao,
        desligamento: x.desligamento,
        tipoRescisao: x.tipoRescisao,
        modalidadeSugerida: x.tipoRescisao === null ? null : (sugestao.get(x.tipoRescisao) ?? null),
        rescisao: x.rescisao,
      })),
      limitado: xs.length > TETO_DESLIGADOS,
    };
  }

  async listar(s: SessaoCadastro, f: FiltroRescisoes): Promise<ListaRescisoes> {
    const verSalario = s.pode(P.salarioLer);
    const xs = await this.porta.rescisoes(this.ctx(s), {
      ...(f.vinculo !== undefined ? { vinculo: f.vinculo } : {}),
      ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
      ...(f.de !== undefined ? { de: f.de } : {}),
      ...(f.ate !== undefined ? { ate: f.ate } : {}),
      ...(f.situacao !== undefined ? { situacao: f.situacao } : {}),
    });
    return {
      itens: xs.slice(0, TETO_RESCISOES_LISTA).map((r) => paraRescisao(r, verSalario)),
      limitado: xs.length > TETO_RESCISOES_LISTA,
    };
  }

  // ── Cálculo ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** Lê o que a rescisão junta (uma vez, fora da transação; D-MONTAGEM-533) e calcula (regra pura). */
  private async montar(s: SessaoCadastro, v: VinculoPesLido, e: CalcularRescisaoEntrada) {
    const c = this.ctx(s);
    const deslig = v.desligamento!;
    const competencia = deslig.slice(0, 7);
    const ano = deslig.slice(0, 4);
    const { inicio } = periodoDaCompetencia(competencia);
    const proxima = maisCompetencias(competencia, 1);
    const [
      salarios,
      dependentes,
      historico,
      afastamentos,
      dias,
      tabelas,
      parametros,
      rubricas,
      ferias,
      adiantamentos,
      mensais,
      finais,
      eventos,
      realizados,
      feriasLidas,
      depositado,
      rescisoes,
    ] = await Promise.all([
      this.porta.salarios(c, [v.id]),
      this.porta.dependentes(c, [v.id], deslig),
      this.porta.historico(c, [v.id], maisCompetencias(competencia, -12), competencia),
      this.folha.afastamentos(c, { vinculo: v.id }),
      this.rubricas.diasAfastamento(c),
      this.rubricas.tabelasLegais(c),
      this.porta.parametros(c, e.empresa),
      this.rubricas.rubricas(c, e.empresa),
      this.porta.ferias(c, { vinculo: v.id }),
      this.porta.adiantamentosDecimo(c, e.empresa, Number(ano)),
      this.porta.processosDoVinculo(c, v.id, 'mensal', competencia, competencia),
      this.porta.processosDoVinculo(c, v.id, 'decimo2', `${ano}-12`, `${ano}-12`),
      this.ponto.eventosDaCompetencia(c, competencia),
      this.realizado.realizadosAprovados(c, `${competencia}-01T00:00`, `${proxima}-01T00:00`),
      this.porta.feriasNaCompetencia(c, inicio, deslig),
      e.saldoFgts === null ? this.porta.fgtsDepositado(c, v.id) : Promise.resolve(0),
      this.porta.rescisoes(c, { vinculo: v.id }),
    ]);
    const meus = realizados.filter((r) => r.vinculo === v.id);
    const plantoes = await this.realizado.plantoesPorIds(c, [...new Set(meus.map((r) => r.plantao))]);
    const ponto = pontoFechadoPorVinculo(eventos.filter((x) => x.vinculo === v.id)).get(v.id) ?? null;
    const sobreaviso = sobreavisoPorVinculo(meus, plantoes).get(v.id) ?? 0;
    const noMes = feriasDoMes(
      feriasLidas.filter((f) => f.vinculo === v.id),
      competencia,
      inicio,
      deslig,
    ).get(v.id);
    const dep = dependentes.get(v.id);
    const decimoPago = finais.length > 0;
    const puro = calcularRescisao({
      empresa: e.empresa,
      vinculo: paraCalculo(v),
      modalidade: e.modalidade,
      aviso: e.aviso,
      termo: e.termo,
      pagamento: e.pagamento,
      saldoFgts: e.saldoFgts,
      fgtsDepositado: depositado,
      salarios: salarios.map((x) => ({
        vinculo: x.vinculo,
        inicio: x.inicio,
        salario: x.salario,
        dependentesIrrf: dep?.irrf ?? 0,
        dependentesSalarioFamilia: dep?.salarioFamilia ?? 0,
        insalubridade: x.insalubridade,
        periculosidade: x.periculosidade,
      })),
      historico: historico
        .filter((h) => h.vinculo === v.id)
        .map((h) => ({
          competencia: h.competencia,
          papel: h.papel,
          quantidade: h.quantidade,
          valor: h.valor,
        })),
      afastamentos: afastamentos.map((a) => ({
        vinculo: a.vinculo,
        inicio: a.inicio,
        fim: a.fim,
        situacao: a.situacao,
      })),
      diasAfastamento: dias,
      ponto,
      sobreaviso,
      ferias: ferias.filter((f) => f.situacao !== 'cancelada').map(registrada),
      feriasNoMes: noMes ?? null,
      adiantamentoDecimo: decimoPago ? 0 : (adiantamentos.get(v.id) ?? 0),
      decimoPago,
      naFolhaMensal: mensais.length > 0,
      tabelasLegais: tabelas,
      parametros,
      rubricas,
    });
    return {
      puro,
      ferias,
      rescisoes,
      carimboInsumos: carimboInsumos(salarios, parametros),
    };
  }

  async calcular(s: SessaoCadastro, e: CalcularRescisaoEntrada): Promise<ResultadoCalculoRescisao> {
    if (!e.simular) await this.apoio.exigirLiberacao(s);
    await this.exigirEmpresa(s, e.empresa);
    const v = await this.vinculoOu404(s, e.vinculo);
    const antes = conferirRescisao({
      vinculo: paraCalculo(v),
      modalidade: e.modalidade,
      aviso: e.aviso,
      termo: e.termo,
      pagamento: e.pagamento,
    });
    if (antes.length > 0) {
      const [primeira] = antes;
      throw recusa(primeira!, MENSAGEM_RECUSA_RESCISAO[primeira!], 'vinculo', { recusas: antes });
    }
    const { puro, ferias, rescisoes, carimboInsumos: carimboLido } = await this.montar(s, v, e);
    if (puro.recusas.length > 0) {
      const [primeira] = puro.recusas;
      throw recusa(primeira!, MENSAGEM_RECUSA_RESCISAO[primeira!], 'vinculo', { recusas: puro.recusas });
    }
    const recibo = puro.recibo;
    const linhas = recibo ? recibo.linhas.map(linhaSaida) : [];
    const totais = recibo ? totalizarCalculo([recibo]) : null;
    const conferencia =
      recibo && totais ? (conferirCalculo([recibo], totais) as ConferenciaCalculoFolha) : null;
    const previa: ResultadoCalculoRescisao = {
      calculado: false,
      simulado: e.simular,
      rescisao: null,
      processo: null,
      substituida: null,
      apuracao: puro.apuracao,
      pendencias: puro.pendencias,
      avisos: puro.avisos,
      resumo: recibo?.resumo ?? null,
      linhas,
      conferencia,
    };
    if (puro.pendencias.length > 0 || e.simular || !recibo || !totais || !puro.apuracao) return previa;
    const a = puro.apuracao;
    const deslig = v.desligamento!;
    const carimboFerias = carimbo(ferias);
    const carimboRescisoes = carimbo(rescisoes);
    const r = await this.apoio.sgh(
      s,
      E.pessoasRescisaoCalculada.codigo,
      CHAVE_PESSOAS_FOLHA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_RESCISAO', id: String(x.id) }),
      async (g) => {
        // Depois da trava no colaborador: o desligamento, as rescisões, as férias, o salário e os parâmetros relidos
        // têm de ser os da montagem.
        const t = await g.rescisoesDoVinculoComTrava(v.id);
        if (t.desligamento !== deslig || carimbo(t.rescisoes) !== carimboRescisoes) throw desatualizado();
        const relidas = await g.feriasDoVinculoComTrava(v.id);
        if (carimbo(relidas) !== carimboFerias) throw desatualizado();
        const [sal, par] = await Promise.all([g.salarios([v.id]), g.parametros(e.empresa)]);
        if (carimboInsumos(sal, par) !== carimboLido)
          throw recusa(
            'calculo-mudou',
            'O salário ou os parâmetros mudaram durante o cálculo: calcule de novo.',
          );
        if (!conferirCalculo([recibo], totais).ok)
          throw recusa('soma-divergente', 'A prova da soma da rescisão não fechou: fale com o suporte.');
        const vigente = t.rescisoes.find((x) => x.situacao === 'calculada') ?? null;
        if (vigente) {
          await g.situacaoRescisao({
            id: vigente.id,
            versao: vigente.versao,
            de: 'calculada',
            para: 'substituida',
            motivo: null,
            por: s.login,
          });
          const p = await g.processo(vigente.processo);
          if (p && p.situacao === 'calculada')
            await g.situacaoProcesso({
              id: p.id,
              versao: p.versao,
              de: 'calculada',
              para: 'substituida',
              motivo: null,
              por: s.login,
            });
        }
        // D-FERPROG-535: as férias programadas sem recibo saem indenizadas; a programação é cancelada junto.
        for (const f of relidas.filter((x) => x.situacao === 'programada'))
          await g.situacaoFerias({
            id: f.id,
            versao: f.versao,
            de: 'programada',
            para: 'cancelada',
            motivo: MOTIVO_FERIAS_NA_RESCISAO,
            por: s.login,
          });
        const { proximoNumero } = await g.emVigorComTrava(e.empresa, a.competencia, 'rescisao');
        const processo = await g.incluirProcesso({
          empresa: e.empresa,
          competencia: a.competencia,
          tipo: 'rescisao',
          pagamento: a.pagamento,
          numero: proximoNumero,
          totais,
          foraDaFolha: 0,
          tabelaLegal: puro.tabelaLegal!,
          parametros: puro.parametros!,
          resumo: sha256(
            jsonCanonico({
              vinculo: v.id,
              modalidade: e.modalidade,
              aviso: e.aviso,
              apuracao: a,
              resumo: recibo.resumo,
              linhas: recibo.linhas,
            }),
          ),
          por: s.login,
        });
        await g.incluirLinhas(
          processo,
          recibo.linhas.map((l) => ({
            ...l,
            vinculo: v.id,
            centroCusto: recibo.resumo.centroCusto,
            diasPagos: recibo.resumo.diasPagos,
          })),
        );
        const id = await g.incluirRescisao({
          vinculo: v.id,
          empresa: e.empresa,
          desligamento: deslig,
          tipoRescisao: t.tipoRescisao,
          modalidade: e.modalidade,
          aviso: e.aviso,
          diasAviso: a.diasAviso,
          diasIndenizados: a.diasIndenizados,
          projecao: a.projecao,
          termo: e.termo,
          saldoFgts: a.saldoFgts,
          saldoFgtsInformado: a.saldoFgtsInformado,
          multaFgts: a.multaFgts,
          pagamento: a.pagamento,
          processo,
          por: s.login,
        });
        const relidos = await g.resumoVinculos(processo);
        if (
          !conferirCalculo(
            relidos.map((x) => ({ resumo: colaboradorDoResumo(x, null) })),
            totais,
          ).ok
        )
          throw recusa(
            'soma-divergente',
            'A releitura da rescisão gravada não fechou com a soma: nada foi gravado.',
          );
        return { id, gravado: await g.processo(processo), substituida: vigente?.id ?? null };
      },
    );
    const depois = await this.porta.rescisaoPorId(this.ctx(s), r.id);
    return {
      ...previa,
      calculado: true,
      rescisao: depois ? paraRescisao(depois, s.pode(P.salarioLer)) : null,
      processo: r.gravado ? resumoDoProcesso(r.gravado) : null,
      substituida: r.substituida,
    };
  }

  async detalhe(s: SessaoCadastro, id: number): Promise<DetalheRescisao> {
    const r = await this.rescisaoOu404(s, id);
    const c = this.ctx(s);
    const p = await this.porta.processo(c, r.processo);
    const verSalario = s.pode(P.salarioLer);
    const linhas =
      p && verSalario ? (await this.porta.linhasDoVinculo(c, p.id, r.vinculo)).map(linhaSaida) : [];
    return {
      rescisao: paraRescisao(r, verSalario),
      // D-PERM-SAL-533: o termo tem um colaborador só; sem o salário, os totais e o resumo também ficam de fora.
      processo: p ? (verSalario ? resumoDoProcesso(p) : cabecalhoDoProcesso(p)) : null,
      linhas,
      linhasOcultas: p !== null && !verSalario,
    };
  }

  /** O termo de rescisão para o PDF: exige o salário (D-PERM-SAL-535); só vínculo e matrícula, sem nome nem CPF. */
  async termo(
    s: SessaoCadastro,
    id: number,
  ): Promise<{ detalhe: DetalheRescisao; matricula: string | null }> {
    if (!s.pode(P.salarioLer))
      throw semPermissao(
        'O termo de rescisão mostra valores do salário: exige a permissão de consultar salário.',
      );
    const detalhe = await this.detalhe(s, id);
    const v = await this.vinculoOu404(s, detalhe.rescisao.vinculo);
    return { detalhe, matricula: v.matricula };
  }

  async cancelar(s: SessaoCadastro, id: number, e: CancelarRescisaoEntrada): Promise<ResultadoFolha> {
    await this.apoio.exigirLiberacao(s);
    const r = await this.rescisaoOu404(s, id);
    if (r.situacao !== 'calculada')
      throw recusa('nao-calculada', 'Só a rescisão em vigor pode ser cancelada.');
    await this.apoio.sgh(
      s,
      E.pessoasRescisaoCancelada.codigo,
      CHAVE_PESSOAS_FOLHA,
      { tabela: 'SGH_PES_RESCISAO', id: String(id) },
      async (g) => {
        const t = await g.rescisoesDoVinculoComTrava(r.vinculo);
        const atual = t.rescisoes.find((x) => x.id === id);
        if (!atual || atual.situacao !== 'calculada' || atual.versao !== e.versao) throw desatualizado();
        const p = await g.processo(atual.processo);
        if (p && p.situacao === 'calculada')
          await g.situacaoProcesso({
            id: p.id,
            versao: p.versao,
            de: 'calculada',
            para: 'descartada',
            motivo: e.motivo,
            por: s.login,
          });
        await g.situacaoRescisao({
          id,
          versao: e.versao,
          de: 'calculada',
          para: 'cancelada',
          motivo: e.motivo,
          por: s.login,
        });
        return { id };
      },
    );
    return { ok: true, id, mensagem: 'Rescisão cancelada.' };
  }
}
