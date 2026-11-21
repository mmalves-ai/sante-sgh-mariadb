// Serviço da interface com a folha externa, fatia F0 (M53.1; ficha do M53, seções 4 a 7, regras 3 a 6): o apoio da tela
// `/pessoas/folha`, a lista de lotes, a geração do lote da competência (vínculos da folha, lotação, conselho,
// afastamentos, eventos do ponto fechado e plantões realizados aprovados), o arquivo do lote (recriado do estado gravado
// e conferido pelo SHA-256; nunca guardado, porque leva o CPF), a importação do retorno com a conferência nos dois
// sentidos e o plano de títulos (o lançamento é do F8), e o afastamento do colaborador. Toda gravação confere a chave
// `pessoas.folhaExterna` e a permissão, vai numa transação só, com a trilha, nas tabelas do modelo próprio.
// Nenhuma resposta traz CPF ou nome: o CPF só sai no arquivo do lote, com permissão sensível e trilha.
import { createHash } from 'node:crypto';
import {
  type AfastamentoResposta,
  type AlterarAfastamentoEntrada,
  type ApoioFolhaInterface,
  CHAVE_PESSOAS_FOLHA_EXTERNA,
  type DivergenciaLoteFolha,
  esquemaLoteExportacaoFolha,
  esquemaLoteRetornoFolha,
  EVENTOS_AUDITAVEIS,
  type FiltroAfastamentos,
  type FiltroLotesFolha,
  type GerarExportacaoFolha,
  type ListaAfastamentos,
  type ListaLotesFolha,
  type LoteExportacaoFolha,
  type LoteRetornoFolha,
  type RegistrarAfastamentoEntrada,
  type ResultadoExportacaoFolha,
  type ResultadoFolha,
  type ResultadoImportacaoFolha,
  type ResumoLoteFolha,
  SITUACOES_LOTE_FOLHA,
  type SituacaoLoteFolha,
  type TotaisExportacao,
  VERSAO_LEIAUTE_FOLHA_INTERFACE,
} from '@sgh/contratos';
import {
  type CampoDadoColaborador,
  camposRecusadosNoRetorno,
  conferirAfastamento,
  conferirCancelamentoAfastamento,
  conferirEncerramentoAfastamento,
  conferirRetorno,
  estadoDoPeriodo,
  eventosDoFechamento,
  horasDoFechamento,
  type EventoPeriodoLido,
  type ExportadoConferivel,
  GRUPOS_DADO_COLABORADOR,
  jsonCanonico,
  montarLoteFolha,
  periodoDaCompetencia,
  planoDeTitulos,
  podeLancarTitulos,
  FUSO_LOCAL_FOLHA,
  type PlantaoParaFolha,
  type VinculoParaFolha,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { CifraCpf } from '../cifra-cpf.js';
import type { PortaRealizado } from '../escala/porta-realizado.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import type { PortaPessoas } from '../porta.js';
import type { ContextoFolha, GravadorFolha, PortaFolha } from './porta-folha.js';
import { type AfastamentoFolha, type LinhaResumoDaFolha, type LoteDaFolha } from './tipos-folha.js';
import { type EventoDoPeriodo } from '../ponto/tipos-ponto.js';
import {
  TETO_AFASTAMENTOS,
  TETO_LOTES_FOLHA,
  TETO_PLANTOES_REALIZADO,
  TETO_VINCULOS_FOLHA,
  exigirCentroCusto,
} from './apoio-folha.js';

const E = EVENTOS_AUDITAVEIS;
export const PERMISSOES_FOLHA = {
  ler: 'pessoas.folha.ler',
  exportar: 'pessoas.folha.exportar',
  importar: 'pessoas.folha.importar',
  afastamento: 'pessoas.afastamento.registrar',
} as const;
const P = PERMISSOES_FOLHA;

/** Situações do exportado que um lote novo da mesma empresa e competência substitui (o lançado nunca). */
const SUBSTITUIVEIS_EXPORTADO = ['gerado', 'conferido', 'divergente'] as const;
/** Situações do recebido que um retorno novo do mesmo lote substitui. */
const SUBSTITUIVEIS_RECEBIDO = ['conferido', 'divergente', 'recusado'] as const;

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const p2 = (x: number) => String(x).padStart(2, '0');

function competenciaAnterior(hoje: string): string {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  return m === 1 ? `${a - 1}-12` : `${a}-${p2(m - 1)}`;
}
function proximaCompetencia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01` : `${a}-${p2(m + 1)}`;
}

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusa = (codigo: string, mensagem: string, campo: string | null = null, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campo ? { campos: [campo] } : {}),
    ...extra,
  });
const recusaRetorno = (codigo: string, mensagem: string, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 422, 'Retorno recusado', mensagem, { codigo, ...extra });
const semChaveCpf = () =>
  new ErroProblema(
    'recurso-desligado',
    403,
    'Exportação desligada',
    'A chave do CPF não está configurada neste ambiente: o lote da folha não pode ser gerado.',
    { codigo: 'sem-chave-cpf' },
  );

const paraEvento = (e: EventoDoPeriodo): EventoPeriodoLido => ({
  id: e.id,
  acao: e.acao,
  ref: e.ref,
  concorda: e.concorda,
  registradoPor: e.registradoPor,
  registradoEm: e.registradoEm,
});

function lerJson<T>(t: string | null, padrao: T): T {
  if (!t) return padrao;
  try {
    return JSON.parse(t) as T;
  } catch {
    return padrao;
  }
}

/** Os vínculos gravados no lote exportado: pares [vínculo, centro de custo] (sem CPF). */
export function vinculosDoLote(t: string | null): { vinculo: number; centroCusto: number | null }[] {
  const xs = lerJson<unknown>(t, []);
  if (!Array.isArray(xs)) return [];
  return xs
    .map((x) =>
      Array.isArray(x)
        ? { vinculo: Number(x[0]), centroCusto: x[1] === null ? null : Number(x[1]) }
        : { vinculo: Number(x), centroCusto: null },
    )
    .filter((x) => Number.isInteger(x.vinculo) && x.vinculo > 0);
}

/** A linha da lista (sem CPF, sem nome). */
export function resumoDoLote(l: LoteDaFolha): ResumoLoteFolha {
  const situacao = (SITUACOES_LOTE_FOLHA as readonly string[]).includes(l.situacao)
    ? (l.situacao as SituacaoLoteFolha)
    : 'recusado';
  return {
    id: l.id,
    sentido: l.sentido,
    empresa: l.empresa,
    competencia: l.competencia,
    situacao,
    geradoEm: `${l.geradoEm.slice(0, 19)}${FUSO_LOCAL_FOLHA}`,
    geradoPor: l.geradoPor,
    colaboradores: l.colaboradores,
    soma: l.soma,
    divergencias: lerJson<DivergenciaLoteFolha[]>(l.divergencias, []),
    resumo: l.resumo,
  };
}

/** Campos do dado do colaborador que o retorno bruto traz em algum colaborador (antes da validação estrita). */
export function camposDoRetornoBruto(bruto: unknown): CampoDadoColaborador[] {
  const todos = new Set<string>([
    ...GRUPOS_DADO_COLABORADOR.contratual,
    ...GRUPOS_DADO_COLABORADOR.assistencial,
  ]);
  const out = new Set<CampoDadoColaborador>();
  const cs = (bruto as { colaboradores?: unknown } | null)?.colaboradores;
  if (Array.isArray(cs))
    for (const c of cs)
      if (c && typeof c === 'object')
        for (const k of Object.keys(c)) if (todos.has(k)) out.add(k as CampoDadoColaborador);
  return [...out].sort();
}

export class ServicoFolha {
  readonly apoio: ApoioGravacao<GravadorFolha>;

  constructor(
    readonly porta: PortaFolha,
    readonly pessoas: PortaPessoas,
    readonly ponto: PortaPonto,
    readonly realizado: PortaRealizado,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    private readonly cifra: CifraCpf | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorFolha>(
      { chave: CHAVE_PESSOAS_FOLHA_EXTERNA, nome: 'a interface com a folha', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private ctx(s: SessaoCadastro): ContextoFolha {
    return s.porta;
  }

  // ── Apoio e lista ───────────────────────────────────────────────────────────────────────────────────────────

  async apoioTela(s: SessaoCadastro): Promise<ApoioFolhaInterface> {
    const c = this.ctx(s);
    const [relogio, empresas, eventos, motivos, tipos, gravacao] = await Promise.all([
      this.porta.relogio(c),
      this.porta.empresas(c),
      this.porta.eventosPonto(c),
      this.porta.motivosAfastamento(c),
      this.porta.tiposFolha(c),
      this.apoio.gravacao(s, { exportar: P.exportar, importar: P.importar, afastamento: P.afastamento }),
    ]);
    const remessas = (await Promise.all(empresas.map((e) => this.porta.remessas(c, e.codigo)))).flat();
    const rotuloTipo = new Map(tipos.map((t) => [t.codigo, t.rotulo]));
    const op = (k: string) => gravacao.operacoes[k]?.pode ?? false;
    const negadas = ['exportar', 'importar', 'afastamento']
      .map((k) => gravacao.operacoes[k])
      .filter((o) => o && !o.pode);
    return {
      hoje: relogio.hoje,
      competenciaSugerida: competenciaAnterior(relogio.hoje),
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: {
        exportar: op('exportar'),
        importar: op('importar'),
        afastamento: op('afastamento'),
        motivo: negadas.length === 3 ? (negadas[0]?.motivo ?? gravacao.motivo) : null,
        buscarColaborador: s.pode('pessoas.colaborador.ler'),
      },
      empresas: empresas.map((e) => ({ codigo: e.codigo, rotulo: e.rotulo })),
      eventosPonto: eventos.map((e) => ({ codigo: e.codigo, rotulo: e.rotulo })),
      motivosAfastamento: motivos.map((e) => ({ codigo: e.codigo, rotulo: e.rotulo })),
      remessas: remessas.map((r) => ({
        id: r.id,
        empresa: r.empresa,
        competencia: r.competencia,
        tipoFolha: rotuloTipo.get(r.tipoFolha) ?? String(r.tipoFolha),
        fechada: r.fechada,
      })),
    };
  }

  async listarLotes(s: SessaoCadastro, f: FiltroLotesFolha): Promise<ListaLotesFolha> {
    const ls = await this.porta.lotes(this.ctx(s), {
      ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
      ...(f.competencia !== undefined ? { competencia: f.competencia } : {}),
    });
    return {
      itens: ls.slice(0, TETO_LOTES_FOLHA).map(resumoDoLote),
      limitado: ls.length > TETO_LOTES_FOLHA,
    };
  }

  // ── Montagem do lote ────────────────────────────────────────────────────────────────────────────────────────

  /** Lê tudo o que o lote da competência junta e monta (pendências ou o lote). `lote` e `geradoEm` vêm de quem chama. */
  private async montar(
    s: SessaoCadastro,
    empresa: number,
    competencia: string,
    lote: number,
    geradoEm: string,
    hoje: string,
    competenciaLancada: boolean,
  ) {
    const cifra = this.cifra;
    if (!cifra) throw semChaveCpf();
    const c = this.ctx(s);
    const { inicio, fim } = periodoDaCompetencia(competencia);
    const [vinculos, afastamentos, eventosPeriodo, realizados, eventosPonto] = await Promise.all([
      this.porta.vinculosDaFolha(c, inicio, fim),
      this.porta.afastamentos(c, { de: inicio, ate: fim }),
      this.ponto.eventosDaCompetencia(c, competencia),
      this.realizado.realizadosAprovados(
        c,
        `${competencia}-01T00:00`,
        `${proximaCompetencia(competencia)}-01T00:00`,
      ),
      this.porta.eventosPonto(c),
    ]);
    // A leitura traz até o teto + 1: acima dele o lote sairia cortado e a conferência por contagem bateria consigo mesma.
    if (vinculos.length > TETO_VINCULOS_FOLHA || afastamentos.length > TETO_AFASTAMENTOS)
      throw recusa(
        'acima-do-teto',
        'A competência tem mais colaboradores ou afastamentos do que um lote comporta: fale com o suporte.',
        'competencia',
      );
    if (realizados.length > TETO_PLANTOES_REALIZADO)
      throw recusa(
        'acima-do-teto',
        'A competência tem mais plantões realizados do que um lote comporta: fale com o suporte.',
        'competencia',
      );
    const profissionais = vinculos.map((v) => v.profissional).filter((x): x is number => x !== null);
    const [conselhos, plantoes] = await Promise.all([
      this.porta.conselhos(c, profissionais),
      this.realizado.plantoesPorIds(c, [...new Set(realizados.map((r) => r.plantao))]),
    ]);
    const tipoDoPlantao = new Map(plantoes.map((p) => [p.plantao, p.tipo]));

    const paraFolha: VinculoParaFolha[] = exigirCentroCusto(vinculos, 'da exportação').map((v) => {
      const k = v.profissional !== null ? conselhos.get(v.profissional) : undefined;
      const conselho =
        k && k.sigla && k.numero !== null && k.uf && /^[A-Z]{2}$/.test(k.uf)
          ? { sigla: k.sigla, numero: String(k.numero), uf: k.uf, validade: k.validade }
          : null;
      return {
        id: v.id,
        cpf: cifra.decifrar(v.cpfCifrado),
        matricula: v.matricula,
        tipo: v.tipo,
        admissao: v.admissao,
        desligamento: v.desligamento,
        centroCusto: v.centroCusto,
        unidade: v.unidade,
        cbo: k?.cbo ?? null,
        conselho,
      };
    });

    const porVinculo = new Map<number, EventoDoPeriodo[]>();
    for (const e of eventosPeriodo) porVinculo.set(e.vinculo, [...(porVinculo.get(e.vinculo) ?? []), e]);
    const fechamentos = new Map<number, Readonly<Record<string, number>>>();
    const horas = new Map<number, Readonly<Record<string, number>>>();
    for (const [v, xs] of porVinculo) {
      const est = estadoDoPeriodo(xs.map(paraEvento));
      if (est.estado !== 'fechado') continue;
      const totais = xs.find((x) => x.id === est.fechamento)?.totais ?? null;
      const ev = eventosDoFechamento(totais);
      if (ev) fechamentos.set(v, ev);
      const hs = horasDoFechamento(totais);
      if (hs) horas.set(v, hs);
    }

    const plantoesFolha: PlantaoParaFolha[] = realizados.map((r) => ({
      vinculo: r.vinculo,
      plantao: r.plantao,
      modalidade: tipoDoPlantao.get(r.plantao) ?? '',
      inicio: r.inicio,
      fim: r.fim,
      minutos: r.minutos,
    }));

    return montarLoteFolha({
      lote,
      empresa,
      estabelecimento: s.hospital,
      competencia,
      geradoEm,
      hoje,
      vinculos: paraFolha,
      afastamentos: afastamentos.map((a) => ({
        vinculo: a.vinculo,
        motivo: a.motivo,
        inicio: a.inicio,
        fim: a.fim,
        situacao: a.situacao,
      })),
      fechamentos,
      horas,
      plantoes: plantoesFolha,
      eventosDisponiveis: new Set(eventosPonto.map((e) => e.codigo)),
      competenciaLancada,
    });
  }

  private async exigirEmpresa(s: SessaoCadastro, empresa: number): Promise<void> {
    const es = await this.porta.empresas(this.ctx(s));
    if (!es.some((e) => e.codigo === empresa)) throw naoEncontrado('Empresa');
  }

  // ── Geração, arquivo e retorno ──────────────────────────────────────────────────────────────────────────────

  async gerarExportacao(s: SessaoCadastro, e: GerarExportacaoFolha): Promise<ResultadoExportacaoFolha> {
    await this.apoio.exigirLiberacao(s);
    if (!this.cifra) throw semChaveCpf();
    await this.exigirEmpresa(s, e.empresa);
    const c = this.ctx(s);
    const [{ hoje, agora }, lancada] = await Promise.all([
      this.porta.relogio(c),
      this.porta.competenciaLancada(c, e.empresa, e.competencia),
    ]);
    const geradoEm = `${agora.slice(0, 19)}${FUSO_LOCAL_FOLHA}`;
    // Primeira montagem fora da transação: com pendência, nada é gravado e a tela mostra o que falta.
    const previa = await this.montar(s, e.empresa, e.competencia, 1, geradoEm, hoje, lancada);
    if (!previa.lote)
      return {
        gerado: false,
        lote: null,
        pendencias: previa.pendencias,
        conta: previa.conta,
        substituido: null,
      };

    const r = await this.apoio.sgh(
      s,
      E.pessoasFolhaLoteGerado.codigo,
      CHAVE_PESSOAS_FOLHA_EXTERNA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_FOLHA_INTERFACE', id: String(x.id) }),
      async (g) => {
        if (await g.competenciaLancada(e.empresa, e.competencia))
          throw recusa(
            'competencia-lancada',
            'A competência já tem títulos lançados: o lote não é refeito.',
            'competencia',
          );
        const id = await g.proximoIdLote();
        const montado = await this.montar(s, e.empresa, e.competencia, id, geradoEm, hoje, false);
        if (!montado.lote)
          throw recusa(
            'lote-mudou',
            'Os dados da competência mudaram durante a geração: gere de novo.',
            'competencia',
          );
        const lote = esquemaLoteExportacaoFolha.parse(montado.lote);
        const anteriores = (await g.lotesDaCompetencia(e.empresa, e.competencia)).filter(
          (x) =>
            x.sentido === 'exportado' && (SUBSTITUIVEIS_EXPORTADO as readonly string[]).includes(x.situacao),
        );
        for (const a of anteriores)
          await g.situacaoLote({ id: a.id, de: [a.situacao], para: 'substituido', por: s.login });
        await g.incluirLote({
          id,
          empresa: e.empresa,
          competencia: e.competencia,
          sentido: 'exportado',
          loteExportado: null,
          leiaute: VERSAO_LEIAUTE_FOLHA_INTERFACE,
          situacao: 'gerado',
          colaboradores: lote.totais.colaboradores,
          soma: lote.totais.minutosPonto + lote.totais.minutosPlantao,
          totais: JSON.stringify(lote.totais),
          vinculos: JSON.stringify(lote.colaboradores.map((x) => [x.vinculo, x.centroCusto])),
          divergencias: null,
          resumo: sha256(jsonCanonico(lote)),
          geradoEm: agora.slice(0, 19),
          por: s.login,
        });
        const gravado = await g.lote(id);
        return { id, gravado, conta: montado.conta, substituido: anteriores[0]?.id ?? null };
      },
    );
    return {
      gerado: true,
      lote: r.gravado ? resumoDoLote(r.gravado) : null,
      pendencias: [],
      conta: r.conta,
      substituido: r.substituido,
    };
  }

  /**
   * O arquivo do lote exportado, recriado do estado gravado (o arquivo não é guardado: leva o CPF). O SHA-256 prova que
   * é o mesmo gerado; se o estado mudou (ponto reaberto, plantão recusado, vínculo alterado), recusa e pede lote novo.
   */
  async arquivoLote(
    s: SessaoCadastro,
    id: number,
  ): Promise<{ nome: string; conteudo: string; lote: LoteExportacaoFolha }> {
    // Recolher é desligar a chave: o arquivo com o CPF também deixa de sair, inclusive o dos lotes já gerados.
    await this.apoio.exigirLiberacao(s);
    if (!this.cifra) throw semChaveCpf();
    const c = this.ctx(s);
    const l = await this.porta.lote(c, id);
    if (!l || l.sentido !== 'exportado') throw naoEncontrado('Lote');
    if (l.situacao === 'substituido')
      throw recusa('lote-substituido', 'Este lote foi substituído por um mais novo da mesma competência.');
    const { hoje } = await this.porta.relogio(c);
    const geradoEm = `${l.geradoEm.slice(0, 19)}${FUSO_LOCAL_FOLHA}`;
    const m = await this.montar(s, l.empresa, l.competencia, l.id, geradoEm, hoje, false);
    const conteudo = m.lote ? jsonCanonico(m.lote) : '';
    if (!m.lote || sha256(conteudo) !== l.resumo)
      throw recusa(
        'lote-desatualizado',
        'Os dados da competência mudaram depois da geração (ponto, plantão ou colaborador): gere um lote novo.',
      );
    return {
      nome: `folha_${s.hospital}_${l.empresa}_${l.competencia}_lote${l.id}.json`,
      conteudo,
      lote: m.lote,
    };
  }

  async importarRetorno(s: SessaoCadastro, id: number, bruto: unknown): Promise<ResultadoImportacaoFolha> {
    await this.apoio.exigirLiberacao(s);
    const leiaute = (bruto as { leiaute?: unknown } | null)?.leiaute;
    if (leiaute !== VERSAO_LEIAUTE_FOLHA_INTERFACE)
      throw recusaRetorno(
        'leiaute',
        `O arquivo não está no leiaute ${VERSAO_LEIAUTE_FOLHA_INTERFACE} da interface.`,
      );
    const recusados = camposRecusadosNoRetorno(camposDoRetornoBruto(bruto), false);
    if (recusados.length > 0)
      throw recusaRetorno(
        'campo-assistencial',
        'O retorno traz dados que são mantidos aqui e foi recusado.',
        {
          campos: recusados,
        },
      );
    const parse = esquemaLoteRetornoFolha.safeParse(bruto);
    if (!parse.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Arquivo de retorno inválido',
        'O arquivo não segue o leiaute da interface.',
        {
          codigo: 'arquivo-invalido',
          campos: [...new Set(parse.error.issues.slice(0, 20).map((i) => i.path.join('.')))],
        },
      );
    const retorno: LoteRetornoFolha = parse.data;
    const resumoArquivo = sha256(jsonCanonico(retorno));
    const { agora } = await this.porta.relogio(this.ctx(s));

    const r = await this.apoio.sgh(
      s,
      E.pessoasFolhaRetornoImportado.codigo,
      CHAVE_PESSOAS_FOLHA_EXTERNA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_FOLHA_INTERFACE', id: String(x.id) }),
      async (g) => {
        const exp = await g.lote(id);
        if (!exp || exp.sentido !== 'exportado')
          throw recusaRetorno(
            'lote-inexistente',
            'O lote a que este retorno responde não existe neste estabelecimento.',
          );
        if (exp.situacao === 'substituido')
          throw recusaRetorno(
            'lote-substituido',
            'O lote a que este retorno responde foi substituído por um mais novo.',
          );
        if (exp.situacao === 'lancado' || (await g.competenciaLancada(exp.empresa, exp.competencia)))
          throw recusaRetorno(
            'competencia-lancada',
            'A competência já tem títulos lançados: o retorno não é reimportado.',
          );
        const vinculos = vinculosDoLote(exp.vinculos);
        const conferivel: ExportadoConferivel = {
          lote: exp.id,
          empresa: exp.empresa,
          competencia: exp.competencia,
          totais: lerJson<TotaisExportacao>(exp.totais, {
            colaboradores: 0,
            afastamentos: 0,
            eventosPonto: 0,
            minutosPonto: 0,
            plantoes: 0,
            minutosPlantao: 0,
          }),
          vinculos: vinculos.map((v) => v.vinculo),
        };
        const divergencias = conferirRetorno(retorno, conferivel);
        const ok = podeLancarTitulos(divergencias);
        const situacao: SituacaoLoteFolha = ok ? 'conferido' : 'divergente';

        const anteriores = (await g.lotesDaCompetencia(exp.empresa, exp.competencia)).filter(
          (x) =>
            x.sentido === 'recebido' &&
            x.loteExportado === exp.id &&
            (SUBSTITUIVEIS_RECEBIDO as readonly string[]).includes(x.situacao),
        );
        for (const a of anteriores)
          await g.situacaoLote({ id: a.id, de: [a.situacao], para: 'substituido', por: s.login });

        const novo = await g.proximoIdLote();
        await g.incluirLote({
          id: novo,
          empresa: exp.empresa,
          competencia: exp.competencia,
          sentido: 'recebido',
          loteExportado: exp.id,
          leiaute: VERSAO_LEIAUTE_FOLHA_INTERFACE,
          situacao,
          colaboradores: retorno.totais.colaboradores,
          soma: retorno.totais.liquido + retorno.totais.encargos,
          totais: JSON.stringify(retorno.totais),
          vinculos: JSON.stringify(retorno.colaboradores.map((x) => x.vinculo)),
          divergencias: JSON.stringify(divergencias),
          resumo: resumoArquivo,
          geradoEm: agora.slice(0, 19),
          por: s.login,
        });
        if (exp.situacao !== situacao)
          await g.situacaoLote({ id: exp.id, de: [exp.situacao], para: situacao, por: s.login });

        let linhas = 0;
        if (ok) {
          const cc = new Map(vinculos.map((v) => [v.vinculo, v.centroCusto]));
          const ls: LinhaResumoDaFolha[] = [];
          for (const col of retorno.colaboradores) {
            const soma = (n: string) =>
              col.rubricas.filter((x) => x.natureza === n).reduce((t, x) => t + x.valor, 0);
            const base = { vinculo: col.vinculo, centroCusto: cc.get(col.vinculo) ?? null, vencimento: null };
            ls.push({ ...base, rubrica: 'proventos', valor: soma('provento') });
            ls.push({ ...base, rubrica: 'descontos', valor: soma('desconto') });
            ls.push({
              ...base,
              rubrica: 'liquido',
              valor: col.liquido,
              vencimento: retorno.vencimentoLiquido,
            });
          }
          const encargos = new Map<string, LinhaResumoDaFolha>();
          for (const en of retorno.encargos) {
            const k = `${en.tipo}|${en.vencimento}|${en.centroCusto ?? ''}`;
            const a = encargos.get(k);
            encargos.set(k, {
              vinculo: null,
              centroCusto: en.centroCusto,
              rubrica: en.tipo,
              valor: (a?.valor ?? 0) + en.valor,
              vencimento: en.vencimento,
            });
          }
          ls.push(...encargos.values());
          linhas = await g.incluirResumo({
            interface: novo,
            empresa: exp.empresa,
            competencia: exp.competencia,
            linhas: ls,
          });
        }
        const gravado = await g.lote(novo);
        return { id: novo, gravado, situacao, divergencias, linhas, ok };
      },
    );
    const plano = planoDeTitulos(retorno);
    if (!r.gravado) throw naoEncontrado('Lote');
    return {
      lote: resumoDoLote(r.gravado),
      situacao: r.situacao,
      divergencias: r.divergencias,
      podeLancar: r.ok,
      contaTitulos: plano.conta,
      totalTitulos: plano.total,
      linhasResumo: r.linhas,
    };
  }

  // ── Afastamentos ────────────────────────────────────────────────────────────────────────────────────────────

  private async motivos(s: SessaoCadastro): Promise<Map<number, string>> {
    return new Map((await this.porta.motivosAfastamento(this.ctx(s))).map((m) => [m.codigo, m.rotulo]));
  }

  private async vinculoOu404(s: SessaoCadastro, id: number) {
    const v = await this.pessoas.vinculo(s.porta, id);
    // A porta de pessoas já lê só o estabelecimento da sessão.
    if (!v) throw naoEncontrado('Colaborador');
    return v;
  }

  private resposta(
    a: AfastamentoFolha,
    motivos: ReadonlyMap<number, string>,
    matricula: string | null,
  ): AfastamentoResposta {
    return {
      id: a.id,
      vinculo: a.vinculo,
      matricula,
      motivo: a.motivo,
      motivoRotulo: motivos.get(a.motivo) ?? String(a.motivo),
      inicio: a.inicio,
      fim: a.fim,
      observacao: a.observacao,
      situacao: a.situacao,
      motivoCancelamento: a.motivoCancelamento,
      versao: a.versao,
    };
  }

  async listarAfastamentos(s: SessaoCadastro, f: FiltroAfastamentos): Promise<ListaAfastamentos> {
    const c = this.ctx(s);
    const periodo = f.competencia ? periodoDaCompetencia(f.competencia) : null;
    const [xs, motivos] = await Promise.all([
      this.porta.afastamentos(c, {
        ...(f.vinculo !== undefined ? { vinculo: f.vinculo } : {}),
        ...(periodo ? { de: periodo.inicio, ate: periodo.fim } : {}),
      }),
      this.motivos(s),
    ]);
    const matriculas = new Map<number, string | null>();
    for (const v of new Set(xs.map((a) => a.vinculo)))
      matriculas.set(v, (await this.pessoas.vinculo(s.porta, v))?.matricula ?? null);
    return { itens: xs.map((a) => this.resposta(a, motivos, matriculas.get(a.vinculo) ?? null)) };
  }

  async registrarAfastamento(s: SessaoCadastro, e: RegistrarAfastamentoEntrada): Promise<ResultadoFolha> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    const motivos = await this.motivos(s);
    const r = await this.apoio.sgh(
      s,
      E.pessoasAfastamentoGravado.codigo,
      CHAVE_PESSOAS_FOLHA_EXTERNA,
      (x: { id: number }) => ({ tabela: 'SGH_PES_AFASTAMENTO', id: String(x.id) }),
      async (g) => {
        const doVinculo = await g.afastamentos({ vinculo: v.id });
        const erro = conferirAfastamento(
          { inicio: e.inicio, fim: e.fim, motivo: e.motivo },
          { admissao: v.admissao, desligamento: v.desligamento },
          doVinculo,
          new Set(motivos.keys()),
        );
        if (erro) throw recusa(erro.codigo, erro.mensagem, erro.campo);
        const id = await g.incluirAfastamento({
          vinculo: v.id,
          motivo: e.motivo,
          inicio: e.inicio,
          fim: e.fim,
          observacao: e.observacao,
          por: s.login,
        });
        return { id };
      },
    );
    return { ok: true, id: r.id, mensagem: 'Afastamento registrado.' };
  }

  async alterarAfastamento(
    s: SessaoCadastro,
    id: number,
    e: AlterarAfastamentoEntrada,
  ): Promise<ResultadoFolha> {
    await this.apoio.exigirLiberacao(s);
    const atual = await this.porta.afastamento(this.ctx(s), id);
    if (!atual) throw naoEncontrado('Afastamento');
    const v = await this.vinculoOu404(s, atual.vinculo);
    const motivos = await this.motivos(s);
    await this.apoio.sgh(
      s,
      E.pessoasAfastamentoGravado.codigo,
      CHAVE_PESSOAS_FOLHA_EXTERNA,
      { tabela: 'SGH_PES_AFASTAMENTO', id: String(id) },
      async (g) => {
        const a = await g.afastamento(id);
        if (!a) throw naoEncontrado('Afastamento');
        if (a.versao !== e.versao)
          throw recusa(
            'desatualizado',
            'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
          );
        if (e.acao === 'encerrar') {
          const erro = conferirEncerramentoAfastamento(
            a,
            e.fim!,
            { admissao: v.admissao, desligamento: v.desligamento },
            await g.afastamentos({ vinculo: a.vinculo }),
            new Set(motivos.keys()),
          );
          if (erro) throw recusa(erro.codigo, erro.mensagem, erro.campo);
          await g.encerrarAfastamento({ id, versao: e.versao, fim: e.fim!, por: s.login });
        } else {
          const erro = conferirCancelamentoAfastamento(a);
          if (erro) throw recusa(erro.codigo, erro.mensagem, erro.campo);
          await g.cancelarAfastamento({ id, versao: e.versao, motivo: e.motivo!, por: s.login });
        }
        return { id };
      },
    );
    return {
      ok: true,
      id,
      mensagem: e.acao === 'encerrar' ? 'Afastamento encerrado.' : 'Afastamento cancelado.',
    };
  }
}
