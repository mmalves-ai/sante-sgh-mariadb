// Serviço do ponto, fatia F4 (M52.4; ficha, seções 4 a 8, regras 11 a 15; cap-07 §7.1.3; Portaria MTP 671/2021): a
// importação do arquivo do relógio com a validação e a quarentena do arquivo inteiro, o painel do período, o espelho de
// cada colaborador (apuração contra a escala publicada, ajustes, banco de horas, trilha do período), os ajustes com o
// aprovador, o fechamento e a reabertura com o lançamento no banco, a ciência do próprio espelho, o acerto do banco, a
// regra do banco de cada regime e o AEJ. Toda gravação confere a chave `pessoas.ponto` e a permissão, relê o
// colaborador do estabelecimento da sessão e vai numa transação só com a trilha. As regras ficam em
// @sgh/dominio-pessoas; o CPF do arquivo vira HMAC na hora e nunca é gravado nem devolvido.
import { createHash } from 'node:crypto';
import {
  ACOES_FECHAMENTO,
  ALERTAS_PONTO,
  type AcertoBancoEntrada,
  type AjustePontoResposta,
  type ApoioPonto,
  type ArquivoAfdDetalhe,
  type ArquivoAfdResumo,
  type BancoEspelho,
  CHAVE_PESSOAS_PONTO,
  type SituacaoRegraBancoEntrada,
  CLASSES_HORA,
  type CienciaEspelhoEntrada,
  type ClasseHora,
  CODIGOS_CLASSE_HORA,
  CODIGOS_EVENTO_FOLHA,
  type ColaboradorPonto,
  type DecidirAjusteEntrada,
  type DesistirAjusteEntrada,
  type DestinoBanco,
  type DiaEspelho,
  type EspelhoPonto,
  EVENTO_AFD_IMPORTADO,
  EVENTO_PONTO_FECHADO,
  EVENTO_PONTO_REABERTO,
  type EventoFolha,
  type EventoPeriodoResposta,
  EVENTOS_AUDITAVEIS,
  EVENTOS_FOLHA,
  FALHAS_AFD,
  type FalhaAfd,
  type FecharPeriodoEntrada,
  type FiltroArquivosAfdEntrada,
  type FiltroPontoEntrada,
  type ImportarAfdEntrada,
  INCONSISTENCIAS_PONTO,
  type InicioBanco,
  LEIAUTE_AFD_PADRAO,
  type LancarAjusteEntrada,
  type LinhaPainelPonto,
  type ListaArquivosAfd,
  type MeuEspelho,
  type MinutosClasse,
  ORIGENS_BANCO,
  type OrigemBanco,
  PADROES_PONTO,
  type PainelPonto,
  PARAMETRO_BIOMETRIA_PONTO,
  type ReabrirPeriodoEntrada,
  type RegraBancoEntrada,
  type RegraBancoResposta,
  type RegrasBancoLista,
  type ResultadoImportacaoAfd,
  type ResultadoPonto,
  TIPOS_AJUSTE,
  type TipoAjuste,
  type TipoRep,
} from '@sgh/contratos';
import {
  type AjusteLido,
  type ApuracaoPeriodo,
  apurarPeriodo,
  biometriaNoPonto,
  conferirAcerto,
  conferirAjuste,
  conferirCiencia,
  conferirDecisao,
  conferirFechamento,
  conferirReabertura,
  dataHoraAej,
  diasDaCompetencia,
  diasEntre,
  estadoDoPeriodo,
  type EstadoPeriodo,
  type EventoPeriodoLido,
  fecharNoBanco,
  gerarAej,
  horasMinutos,
  justificativasAprovadas,
  type MarcacaoAej,
  marcacoesEfetivas,
  type MinutosPorEvento,
  type RegraBanco,
  regimeNoDia,
  saldoBanco,
  type VinculoAej,
  validarAfd,
  zeroEventos,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { CifraCpf } from '../cifra-cpf.js';
import type { PortaEscala } from '../escala/porta-escala.js';
import type { PortaPessoas, VinculoColaborador } from '../porta.js';
import type { GravadorPonto, PortaPonto } from './porta-ponto.js';
import type {
  AjustePonto,
  ArquivoRelogio,
  EventoDoPeriodo,
  MovimentoBancoHoras,
  RegraBancoDoRegime,
} from './tipos-ponto.js';

/** O regime de jornada como a porta da escala o devolve. */
type RegimeEscala = NonNullable<Awaited<ReturnType<PortaEscala['regime']>>>;

const E = EVENTOS_AUDITAVEIS;
export const PERMISSOES_PONTO = {
  ler: 'pessoas.ponto.ler',
  importar: 'pessoas.ponto.importar',
  justificar: 'pessoas.ponto.justificar',
  aprovar: 'pessoas.ponto.aprovar',
  exportar: 'pessoas.ponto.exportar',
  ciencia: 'pessoas.ponto.ciencia',
  regraEditar: 'pessoas.regime.editar',
} as const;
const P = PERMISSOES_PONTO;
const TTL_DOMINIOS_MS = 10 * 60_000;
/** O programa de tratamento do ponto no AEJ (registro 08; nome provisório, DP-49; a confirmar com o jurídico). */
export const PROGRAMA_AEJ = { nome: 'Sante SGH', versao: '1.0' } as const;

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusaRegra = (codigo: string, mensagem: string, campo: string | null = null) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campo ? { campos: [campo] } : {}),
  });
const recusar = (r: { codigo: string; mensagem: string; campo: string | null }) =>
  recusaRegra(r.codigo, r.mensagem, r.campo);

/**
 * Sessão "como" (ADR 0021): o login da sessão é o do usuário-alvo. A ciência do espelho é ato pessoal, e o lançamento e a
 * decisão do ajuste são os dois lados da segregação (quem pediu não aprova): nenhum deles se faz por outra pessoa, senão
 * o mesmo humano lançaria "como" um e aprovaria com a própria conta (D-COMO-524).
 */
export const MOTIVO_SESSAO_COMO_PONTO =
  'Na sessão de suporte não se registra a ciência do espelho nem se lança ou decide ajuste do ponto: entre com a sua própria conta.';
/** O aprovador não trata o próprio ponto (decidir ajuste, fechar, reabrir, acertar o banco; D-PROPRIO-524). */
export const MOTIVO_PROPRIO_PONTO = 'O seu próprio ponto é tratado por outro aprovador.';
const emComo = (s: SessaoCadastro): boolean => !!s.req?.sghComo;
function naoComo(s: SessaoCadastro): void {
  if (emComo(s))
    throw new ErroProblema('recusa-de-negocio', 403, 'Ação pessoal', MOTIVO_SESSAO_COMO_PONTO, {
      codigo: 'sessao-como',
    });
}

const p2 = (x: number) => String(x).padStart(2, '0');
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function competenciaAnterior(hoje: string): string {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  return m === 1 ? `${a - 1}-12` : `${a}-${p2(m - 1)}`;
}
function lerEventos(totais: string): Partial<MinutosPorEvento> {
  try {
    return (JSON.parse(totais) as { eventos?: MinutosPorEvento }).eventos ?? {};
  } catch {
    return {};
  }
}
const rotulos = (xs: readonly { codigo: number; nome: string }[]) =>
  new Map(xs.map((x) => [x.codigo, x.nome]));
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const paraEvento = (e: EventoDoPeriodo): EventoPeriodoLido => ({
  id: e.id,
  acao: e.acao,
  ref: e.ref,
  concorda: e.concorda,
  registradoPor: e.registradoPor,
  registradoEm: e.registradoEm,
});
const paraAjuste = (a: AjustePonto): AjusteLido => ({
  id: a.id,
  tipo: a.tipo as TipoAjuste,
  dia: a.dia,
  marcacao: a.marcacao,
  instante: a.instante,
  movimento: a.movimento,
  minutos: a.minutos,
  situacao: a.situacao as AjusteLido['situacao'],
  pedidoPor: a.pedidoPor,
});

interface ParametrosPonto {
  readonly leiauteAfd: string;
  readonly conferirCrc: boolean;
  readonly toleranciaMarcacaoMin: number;
  readonly toleranciaDiariaMin: number;
  readonly janelaMarcacaoMin: number;
  readonly faixa1Min: number;
  readonly intervaloPreAssinalado: boolean;
  readonly biometria: boolean;
}

/** Tudo o que o espelho de um vínculo numa competência junta (a tela, o fechamento, a ciência e o AEJ usam). */
interface Apurado {
  readonly v: VinculoColaborador;
  readonly competencia: string;
  readonly dias: readonly string[];
  readonly hmac: string | null;
  readonly regime: RegimeEscala | null;
  readonly regra: RegraBancoDoRegime | null;
  readonly apuracao: ApuracaoPeriodo;
  readonly originais: readonly { id: number; instante: string; numeroRep: string }[];
  readonly posteriores: number;
  readonly ajustes: readonly AjustePonto[];
  readonly eventos: readonly EventoDoPeriodo[];
  readonly estado: EstadoPeriodo;
  readonly movimentos: readonly MovimentoBancoHoras[];
  readonly plantoes: readonly { id: number; inicio: string; fim: string }[];
}

export class ServicoPonto {
  readonly apoio: ApoioGravacao<GravadorPonto>;
  private readonly dominiosCache = new Map<
    string,
    { ate: number; d: Awaited<ReturnType<PortaPonto['dominios']>> }
  >();

  constructor(
    readonly porta: PortaPonto,
    readonly pessoas: PortaPessoas,
    readonly escala: PortaEscala,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    private readonly cifra: CifraCpf | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorPonto>(
      { chave: CHAVE_PESSOAS_PONTO, nome: 'o ponto', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Apoio ───────────────────────────────────────────────────────────────────────────────────────────────────

  private async dominios(s: SessaoCadastro) {
    const c = this.dominiosCache.get(s.hospital);
    if (c && c.ate > Date.now()) return c.d;
    const d = await this.porta.dominios(s.porta);
    this.dominiosCache.set(s.hospital, { ate: Date.now() + TTL_DOMINIOS_MS, d });
    return d;
  }

  async parametros(s: SessaoCadastro): Promise<ParametrosPonto> {
    const r = await this.apoio.resolvedorParametros(s).catch(() => () => null);
    const valor = (k: string) => {
      try {
        return r(k, null);
      } catch {
        return null;
      }
    };
    const num = (k: string, padrao: number) => {
      const v = valor(k);
      const x = typeof v === 'number' ? v : Number(v);
      return v === null || v === undefined || v === '' || !Number.isFinite(x) ? padrao : x;
    };
    const bool = (k: string, padrao: boolean) => {
      const v = valor(k);
      return v === null || v === undefined || v === '' ? padrao : v === true || v === 'true';
    };
    const leiaute = valor('pessoas.ponto.leiauteAfd');
    return {
      leiauteAfd: typeof leiaute === 'string' && /^\d{3}$/.test(leiaute) ? leiaute : LEIAUTE_AFD_PADRAO,
      conferirCrc: bool('pessoas.ponto.afdConferirCrc', true),
      toleranciaMarcacaoMin: num('pessoas.ponto.toleranciaMarcacaoMin', PADROES_PONTO.toleranciaMarcacaoMin),
      toleranciaDiariaMin: num('pessoas.ponto.toleranciaDiariaMin', PADROES_PONTO.toleranciaDiariaMin),
      janelaMarcacaoMin: num('pessoas.ponto.janelaMarcacaoMin', PADROES_PONTO.janelaMarcacaoMin),
      faixa1Min: num('pessoas.ponto.faixa1HoraExtraMin', PADROES_PONTO.faixa1Min),
      intervaloPreAssinalado: bool('pessoas.ponto.intervaloPreAssinalado', true),
      biometria: biometriaNoPonto(valor(PARAMETRO_BIOMETRIA_PONTO)),
    };
  }

  async apoioTela(s: SessaoCadastro): Promise<ApoioPonto> {
    const [relogio, d, unidades, params, gravacao] = await Promise.all([
      this.porta.relogio(s.porta),
      this.dominios(s),
      this.pessoas.unidades(s.porta),
      this.parametros(s),
      this.apoio.gravacao(s, {
        importar: P.importar,
        justificar: P.justificar,
        aprovar: P.aprovar,
        exportar: P.exportar,
        regraBanco: P.regraEditar,
      }),
    ]);
    const op = (k: string) => gravacao.operacoes[k]?.pode ?? false;
    const negadas = ['importar', 'justificar', 'aprovar']
      .map((k) => gravacao.operacoes[k])
      .filter((o) => o && !o.pode);
    const o = (xs: readonly { codigo: number; nome: string }[]) =>
      xs.map((x) => ({ codigo: x.codigo, rotulo: x.nome }));
    return {
      hoje: relogio.hoje,
      competenciaPadrao: competenciaAnterior(relogio.hoje),
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: {
        importar: op('importar'),
        justificar: op('justificar'),
        aprovar: op('aprovar'),
        exportar: op('exportar'),
        regraBanco: op('regraBanco'),
        motivo: negadas.length === 3 ? (negadas[0]?.motivo ?? gravacao.motivo) : null,
      },
      biometria: {
        ligada: params.biometria,
        motivo: params.biometria
          ? 'Biometria liberada pelo encarregado de dados para este estabelecimento.'
          : 'A biometria no ponto fica desligada até a base legal registrada pelo encarregado de dados: as marcações vêm do relógio de ponto e o acesso é por senha.',
      },
      dominios: {
        modelosRelogio: o(d.modelosRelogio),
        movimentos: o(d.movimentos),
        justificativas: o(d.justificativas),
        periodos: o(d.periodos),
        classes: CODIGOS_CLASSE_HORA.map((c) => ({ codigo: c, rotulo: this.rotuloClasse(d.classesHora, c) })),
        eventos: CODIGOS_EVENTO_FOLHA.map((c) => ({
          codigo: c,
          rotulo: rotulos(d.eventosFolha).get(c) ?? EVENTOS_FOLHA[c],
        })),
        destinosBanco: o(d.destinosBanco.filter((x) => x.codigo >= 1 && x.codigo <= 3)),
        iniciosBanco: o(d.iniciosBanco),
        unidades: unidades.map((u) => ({ codigo: u.codigo, rotulo: u.nome })),
      },
      parametros: {
        leiauteAfd: params.leiauteAfd,
        conferirCrc: params.conferirCrc,
        toleranciaMarcacaoMin: params.toleranciaMarcacaoMin,
        toleranciaDiariaMin: params.toleranciaDiariaMin,
        janelaMarcacaoMin: params.janelaMarcacaoMin,
        faixa1Min: params.faixa1Min,
        intervaloPreAssinalado: params.intervaloPreAssinalado,
      },
    };
  }

  private rotuloClasse(xs: readonly { codigo: number; nome: string }[], c: ClasseHora): string {
    return rotulos(xs).get(c) ?? CLASSES_HORA[c];
  }

  // ── Colaborador ─────────────────────────────────────────────────────────────────────────────────────────────

  private async vinculoOu404(s: SessaoCadastro, id: number): Promise<VinculoColaborador> {
    const v = await this.pessoas.vinculo(s.porta, id);
    if (!v) throw naoEncontrado('Colaborador');
    return v;
  }

  private async nomesUnidades(s: SessaoCadastro): Promise<Map<number, string>> {
    return new Map((await this.pessoas.unidades(s.porta)).map((u) => [u.codigo, u.nome]));
  }

  async buscarColaboradores(s: SessaoCadastro, termo: string, estado: 'ativo' | 'desligado' | 'todos') {
    const [r, unidades] = await Promise.all([
      this.pessoas.listarVinculos(s.porta, { termo, estado, limite: 20 }),
      this.nomesUnidades(s),
    ]);
    return {
      itens: r.itens.map((v) => this.colaborador(v, unidades, null)),
    };
  }

  private colaborador(
    v: VinculoColaborador,
    unidades: Map<number, string>,
    regime: string | null,
  ): ColaboradorPonto {
    return {
      vinculo: v.id,
      nome: v.nome,
      matricula: v.matricula,
      cargo: v.cargo,
      unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
      setor: v.setor,
      admissao: v.admissao,
      desligamento: v.desligamento,
      regime,
    };
  }

  // ── Arquivo do relógio (regra 12) ───────────────────────────────────────────────────────────────────────────

  private resumoArquivo(a: ArquivoRelogio, modelos: Map<number, string>): ArquivoAfdResumo {
    return {
      id: a.id,
      nome: a.nome,
      situacao: a.situacao,
      tipoRep: a.tipoRep as TipoRep,
      modelo: a.modelo !== null ? (modelos.get(a.modelo) ?? null) : null,
      numeroRep: a.numeroRep,
      de: a.dataInicial,
      ate: a.dataFinal,
      marcacoes: a.marcacoes,
      novas: a.novas,
      jaImportadas: a.jaImportadas,
      semColaborador: a.semColaborador,
      totalFalhas: a.totalFalhas,
      importadoPor: a.importadoPor,
      importadoEm: a.importadoEm,
    };
  }

  private detalheArquivo(a: ArquivoRelogio, modelos: Map<number, string>): ArquivoAfdDetalhe {
    let falhas: { codigo: FalhaAfd; linha: number | null }[] = [];
    try {
      const x: unknown = a.falhas ? JSON.parse(a.falhas) : [];
      if (Array.isArray(x))
        falhas = x.filter((f) => f && typeof f.codigo === 'string' && f.codigo in FALHAS_AFD);
    } catch {
      falhas = [];
    }
    return {
      ...this.resumoArquivo(a, modelos),
      falhas: falhas.map((f) => ({ codigo: f.codigo, rotulo: FALHAS_AFD[f.codigo], linha: f.linha ?? null })),
    };
  }

  async listarArquivos(s: SessaoCadastro, f: FiltroArquivosAfdEntrada): Promise<ListaArquivosAfd> {
    const [xs, d] = await Promise.all([
      this.porta.arquivos(s.porta, {
        situacao: f.situacao === 'todos' ? null : f.situacao,
        de: f.de ?? null,
        ate: f.ate ?? null,
        pular: f.pagina * f.limite,
        limite: f.limite + 1,
      }),
      this.dominios(s),
    ]);
    const modelos = rotulos(d.modelosRelogio);
    return {
      itens: xs.slice(0, f.limite).map((a) => this.resumoArquivo(a, modelos)),
      pagina: f.pagina,
      temMais: xs.length > f.limite,
    };
  }

  async arquivo(s: SessaoCadastro, id: number): Promise<ArquivoAfdDetalhe> {
    const [a, d] = await Promise.all([this.porta.arquivo(s.porta, id), this.dominios(s)]);
    if (!a) throw naoEncontrado('Arquivo');
    return this.detalheArquivo(a, rotulos(d.modelosRelogio));
  }

  async importarAfd(s: SessaoCadastro, e: ImportarAfdEntrada): Promise<ResultadoImportacaoAfd> {
    await this.apoio.exigirLiberacao(s);
    const cifra = this.cifra;
    if (!cifra)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Importação desligada',
        'A chave do CPF não está configurada neste ambiente: sem ela, a marcação não se liga ao colaborador.',
        { codigo: 'sem-chave-cpf' },
      );
    const [params, d] = await Promise.all([this.parametros(s), this.dominios(s)]);
    if (e.modelo !== null && !d.modelosRelogio.some((m) => m.codigo === e.modelo))
      throw recusaRegra('modelo', 'Escolha o modelo do relógio da lista.', 'modelo');
    const hash = sha256(e.conteudo);
    const r = validarAfd(e.conteudo, {
      leiaute: params.leiauteAfd,
      conferirCrc: params.conferirCrc,
      tipoRep: e.tipoRep,
    });
    const cab = r.cabecalho;
    const hmacs = new Map<string, string>();
    for (const m of r.marcacoes) if (!hmacs.has(m.cpf)) hmacs.set(m.cpf, cifra.hmac(m.cpf));
    const vinculos = await this.porta.vinculosPorHmacs(s.porta, [...hmacs.values()]);
    const numeroRep = cab?.numeroRep || null;
    const id = await this.apoio.sgh(
      s,
      E.pessoasAfdImportado.codigo,
      CHAVE_PESSOAS_PONTO,
      (x: { id: number }) => ({ tabela: 'arquivo_ponto', id: String(x.id) }),
      async (g) => {
        if (await g.arquivoPorHash(hash))
          throw recusaRegra(
            'arquivo-ja-importado',
            'Este arquivo já foi importado (mesmo conteúdo).',
            'conteudo',
          );
        const valido = r.situacao === 'valido' && numeroRep !== null;
        const ja =
          valido && r.nsrInicial !== null && r.nsrFinal !== null
            ? await g.nsrsImportados(numeroRep, r.nsrInicial, r.nsrFinal)
            : new Set<number>();
        const novas = valido ? r.marcacoes.filter((m) => !ja.has(m.nsr)) : [];
        let semColaborador = 0;
        const escolhas = novas.map((m) => {
          const vs = vinculos.get(hmacs.get(m.cpf)!) ?? [];
          const dia = m.instante.slice(0, 10);
          const v =
            vs.find((x) => x.admissao <= dia && (x.desligamento === null || x.desligamento >= dia)) ??
            vs[0] ??
            null;
          if (!v) semColaborador++;
          return { m, v };
        });
        const falhas =
          r.situacao === 'valido' && numeroRep === null
            ? [{ codigo: 'cabecalho-invalido', linha: 1 }]
            : r.falhas;
        const total = r.situacao === 'valido' && numeroRep === null ? 1 : r.totalFalhas;
        const arquivo = await g.incluirArquivo({
          nome: e.nome,
          hash,
          tamanho: e.conteudo.length,
          tipoRep: e.tipoRep,
          modelo: e.modelo,
          numeroRep,
          cnpjEmpregador: cab?.cnpjEmpregador ?? null,
          razaoSocial: cab?.razaoSocial?.slice(0, 150) || null,
          leiaute: cab?.leiaute ?? null,
          dataInicial: cab?.dataInicial ?? null,
          dataFinal: cab?.dataFinal ?? null,
          nsrInicial: r.nsrInicial,
          nsrFinal: r.nsrFinal,
          marcacoes: r.marcacoes.length,
          novas: novas.length,
          jaImportadas: valido ? r.marcacoes.length - novas.length : 0,
          semColaborador,
          situacao: valido ? 'importado' : 'quarentena',
          totalFalhas: valido ? 0 : total,
          // Até 50 falhas (código e linha) cabem na coluna; nenhum conteúdo de linha.
          falhas: valido ? null : JSON.stringify(falhas),
          por: s.login,
        });
        for (const { m, v } of escolhas)
          await g.incluirMarcacao({
            arquivo,
            numeroRep: numeroRep!,
            nsr: m.nsr,
            tipoRegistro: m.tipoRegistro,
            instante: m.instante,
            fuso: m.fuso,
            cpfHmac: hmacs.get(m.cpf)!,
            pessoa: v?.pessoa ?? null,
            vinculo: v?.vinculo ?? null,
          });
        if (valido)
          await g.outbox({
            tipo: EVENTO_AFD_IMPORTADO,
            chave: `afd:${s.hospital}:${arquivo}`,
            carga: { arquivo, novas: novas.length },
          });
        return { id: arquivo };
      },
    );
    const lido = await this.porta.arquivo(s.porta, id.id);
    const detalhe = lido
      ? this.detalheArquivo(lido, rotulos(d.modelosRelogio))
      : ({
          id: id.id,
          nome: e.nome,
          situacao: r.situacao === 'valido' ? 'importado' : 'quarentena',
          tipoRep: e.tipoRep,
          modelo: null,
          numeroRep,
          de: cab?.dataInicial ?? null,
          ate: cab?.dataFinal ?? null,
          marcacoes: r.marcacoes.length,
          novas: 0,
          jaImportadas: 0,
          semColaborador: 0,
          totalFalhas: r.totalFalhas,
          importadoPor: s.login,
          importadoEm: '',
          falhas: r.falhas.map((f) => ({ codigo: f.codigo, rotulo: FALHAS_AFD[f.codigo], linha: f.linha })),
        } satisfies ArquivoAfdDetalhe);
    return {
      ...detalhe,
      mensagem:
        detalhe.situacao === 'importado'
          ? `Arquivo importado: ${detalhe.novas} marcação(ões) nova(s), ${detalhe.jaImportadas} já importada(s), ${detalhe.semColaborador} sem colaborador cadastrado.`
          : `Arquivo em quarentena: ${detalhe.totalFalhas} falha(s); nenhuma marcação entrou. Corrija no relógio e exporte de novo.`,
    };
  }

  // ── Painel do período ───────────────────────────────────────────────────────────────────────────────────────

  private async vinculosDoPeriodo(
    s: SessaoCadastro,
    competencia: string,
    f: Pick<FiltroPontoEntrada, 'termo' | 'unidade'>,
  ) {
    const dias = diasDaCompetencia(competencia);
    const de = dias[0]!;
    const ate = dias[dias.length - 1]!;
    const r: VinculoColaborador[] = [];
    let depois: number | undefined;
    for (let i = 0; i < 25; i++) {
      const pg = await this.pessoas.listarVinculos(s.porta, {
        estado: 'todos',
        limite: 200,
        ...(f.termo ? { termo: f.termo } : {}),
        ...(f.unidade !== undefined ? { unidade: f.unidade } : {}),
        ...(depois !== undefined ? { depois } : {}),
      });
      r.push(...pg.itens);
      if (pg.depois === null) break;
      depois = pg.depois;
    }
    return r.filter((v) => v.admissao <= ate && (v.desligamento === null || v.desligamento >= de));
  }

  async painel(s: SessaoCadastro, f: FiltroPontoEntrada): Promise<PainelPonto> {
    const dias = diasDaCompetencia(f.competencia);
    const de = dias[0]!;
    const ate = dias[dias.length - 1]!;
    const vs = await this.vinculosDoPeriodo(s, f.competencia, f);
    const ids = vs.map((v) => v.id);
    const [unidades, hmacs, pendentes, eventos, saldos] = await Promise.all([
      this.nomesUnidades(s),
      this.porta.hmacs(s.porta, ids),
      this.porta.pendentesPorVinculo(s.porta, de, ate),
      this.porta.eventosDaCompetencia(s.porta, f.competencia),
      this.porta.saldosBanco(s.porta, ids),
    ]);
    const contagem = await this.porta.contagemMarcacoes(
      s.porta,
      [...hmacs.values()],
      `${de}T00:00`,
      `${somarDias(ate, 1)}T12:00`,
    );
    const porVinculo = new Map<number, EventoDoPeriodo[]>();
    for (const e of eventos) porVinculo.set(e.vinculo, [...(porVinculo.get(e.vinculo) ?? []), e]);
    const linhas: LinhaPainelPonto[] = vs.map((v) => {
      const est = estadoDoPeriodo((porVinculo.get(v.id) ?? []).map(paraEvento));
      const h = hmacs.get(v.id);
      return {
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        cargo: v.cargo,
        unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
        setor: v.setor,
        estado: est.estado,
        marcacoes: h ? (contagem.get(h) ?? 0) : 0,
        ajustesPendentes: pendentes.get(v.id) ?? 0,
        ciencia: est.ciencia !== null,
        saldoBancoMin: saldos.has(v.id) ? saldos.get(v.id)! : null,
      };
    });
    const contagens = {
      abertos: linhas.filter((l) => l.estado === 'aberto').length,
      fechados: linhas.filter((l) => l.estado === 'fechado').length,
      comAjustePendente: linhas.filter((l) => l.ajustesPendentes > 0).length,
      semCiencia: linhas.filter((l) => l.estado === 'fechado' && !l.ciencia).length,
    };
    const filtradas = linhas.filter((l) =>
      f.situacao === 'abertos'
        ? l.estado === 'aberto'
        : f.situacao === 'fechados'
          ? l.estado === 'fechado'
          : f.situacao === 'pendentes'
            ? l.ajustesPendentes > 0
            : f.situacao === 'sem-ciencia'
              ? l.estado === 'fechado' && !l.ciencia
              : true,
    );
    const paginas = Math.max(1, Math.ceil(filtradas.length / f.limite));
    const pagina = Math.min(f.pagina, paginas - 1);
    return {
      competencia: f.competencia,
      itens: filtradas.slice(pagina * f.limite, (pagina + 1) * f.limite),
      total: filtradas.length,
      pagina,
      paginas,
      contagens,
    };
  }

  // ── Apuração e espelho (regras 11, 13 e 14) ─────────────────────────────────────────────────────────────────

  private async apurar(s: SessaoCadastro, v: VinculoColaborador, competencia: string): Promise<Apurado> {
    const todos = diasDaCompetencia(competencia);
    const dias = todos.filter((d) => d >= v.admissao && (v.desligamento === null || d <= v.desligamento));
    const de = todos[0]!;
    const ate = todos[todos.length - 1]!;
    const [params, hmacs, ajustes, eventos, movimentos, regras, vigencias, regimes, feriadosLidos] =
      await Promise.all([
        this.parametros(s),
        this.porta.hmacs(s.porta, [v.id]),
        this.porta.ajustes(s.porta, v.id, de, ate),
        this.porta.eventosPeriodo(s.porta, v.id),
        this.porta.movimentosBanco(s.porta, v.id),
        this.porta.regrasBanco(s.porta),
        this.escala.vigencias(s.porta, [v.id]),
        this.escala.regimes(s.porta),
        this.porta.feriados(s.porta, de, ate),
      ]);
    const hmac = hmacs.get(v.id) ?? null;
    const doPeriodo = eventos.filter((e) => e.competencia === competencia);
    const estado = estadoDoPeriodo(doPeriodo.map(paraEvento));
    const fechamento =
      estado.fechamento !== null ? doPeriodo.find((e) => e.id === estado.fechamento) : undefined;
    const lidas = hmac
      ? await this.porta.marcacoes(s.porta, hmac, `${somarDias(de, -1)}T00:00`, `${somarDias(ate, 2)}T00:00`)
      : [];
    // O período fechado mostra o que foi fechado: a marcação importada depois fica para a reabertura.
    const originais = fechamento ? lidas.filter((m) => m.criadoEm <= fechamento.registradoEm) : lidas;
    const plantoesLidos = await this.escala.plantoesDaPessoa(s.porta, v.pessoa, {
      de: `${de}T00:00`,
      ate: `${somarDias(ate, 1)}T00:00`,
      inicioDesde: `${somarDias(de, -1)}T00:00`,
    });
    const doVinculo = plantoesLidos.filter(
      (p) =>
        p.vinculo === v.id && p.situacao === 'previsto' && (p.tipo === 'presencial' || p.tipo === 'diarista'),
    );
    const escalas = await Promise.all(
      [...new Set(doVinculo.map((p) => p.escala))].map((id) => this.escala.escala(s.porta, id)),
    );
    const publicadas = new Set(escalas.filter((x) => x?.estado === 'publicada').map((x) => x!.id));
    const plantoes = doVinculo
      .filter((p) => publicadas.has(p.escala))
      .map((p) => ({ id: p.id, inicio: p.inicio, fim: p.fim }));
    const vig = regimeNoDia(vigencias, ate);
    const regime = vig ? (regimes.find((r) => r.id === vig.regime) ?? null) : null;
    // W0-06: a regra desativada não entra no fechamento (o regime fica sem banco até reativar).
    const regra = regime ? (regras.find((r) => r.regime === regime.id && r.ativo !== false) ?? null) : null;
    const ano = (d: string) => d.slice(0, 4);
    const feriados = new Set(
      feriadosLidos.map((f) => (ano(f.data) === '9999' ? `${ano(de)}${f.data.slice(4)}` : f.data)),
    );
    const apuracao = apurarPeriodo({
      dias,
      plantoes,
      marcacoes: marcacoesEfetivas(
        originais.map((m) => ({ id: m.id, instante: m.instante })),
        ajustes.map(paraAjuste),
      ),
      justificativas: justificativasAprovadas(ajustes.map(paraAjuste)),
      feriados,
      regras: {
        toleranciaMarcacaoMin: params.toleranciaMarcacaoMin,
        toleranciaDiariaMin: params.toleranciaDiariaMin,
        noturnoInicio: PADROES_PONTO.noturnoInicio,
        noturnoFim: PADROES_PONTO.noturnoFim,
        prorrogacaoNoturna: true,
        janelaMarcacaoMin: params.janelaMarcacaoMin,
        limiteExtraDiarioMin: PADROES_PONTO.limiteExtraDiarioMin,
        faixas: [params.faixa1Min, PADROES_PONTO.faixa2Min, PADROES_PONTO.faixa3Min],
        feriadoCompensado: !!regime?.acordo,
        intervaloPreAssinalado: params.intervaloPreAssinalado,
        dsrMin: regime?.minutosPlantao ?? PADROES_PONTO.dsrPadraoMin,
        descansoMinimoMin: regime?.descansoMinimoMin ?? 11 * 60,
      },
    });
    return {
      v,
      competencia,
      dias,
      hmac,
      regime,
      regra,
      apuracao,
      originais: originais.map((m) => ({ id: m.id, instante: m.instante, numeroRep: m.numeroRep })),
      posteriores: lidas.length - originais.length,
      ajustes,
      eventos,
      estado,
      movimentos,
      plantoes,
    };
  }

  private regraDominio(r: RegraBancoDoRegime | null): RegraBanco | null {
    return r
      ? {
          destino: r.destino as DestinoBanco,
          inicio: r.inicio as InicioBanco,
          desde: r.desde,
          cicloMeses: r.cicloMeses,
          faltaDebita: r.faltaDebita,
        }
      : null;
  }

  /** O banco do período: aberto, a prévia do fechamento; fechado, o que foi lançado. */
  private banco(a: Apurado) {
    const anteriores = a.movimentos.filter((m) => m.competencia < a.competencia);
    const doPeriodo = a.movimentos.filter((m) => m.competencia === a.competencia);
    const saldoAnterior = saldoBanco(anteriores);
    // A virada do ciclo trata o saldo das competências anteriores; o acerto manual do período soma depois.
    const manuais = saldoBanco(doPeriodo.filter((m) => m.origem === 'acerto'));
    const bruta = fecharNoBanco(a.apuracao.eventos, this.regraDominio(a.regra), a.competencia, saldoAnterior);
    const previa = { ...bruta, saldoFinal: bruta.saldoFinal + manuais };
    return { saldoAnterior, doPeriodo, previa };
  }

  private totais(a: Apurado, eventosFolha: MinutosPorEvento) {
    return JSON.stringify({ classes: a.apuracao.totais, eventos: eventosFolha });
  }

  private hashDo(a: Apurado, eventosFolha: MinutosPorEvento): string {
    return sha256(
      JSON.stringify({
        vinculo: a.v.id,
        competencia: a.competencia,
        versao: a.estado.versao + (a.estado.estado === 'aberto' ? 1 : 0),
        dias: a.apuracao.dias.map((d) => [
          d.dia,
          d.minutos,
          d.noturnoReduzidoMin,
          d.jornadas.map((j) => j.pares),
        ]),
        totais: a.apuracao.totais,
        eventos: eventosFolha,
      }),
    );
  }

  private eventoResposta(e: EventoDoPeriodo): EventoPeriodoResposta {
    return {
      id: e.id,
      acao: e.acao,
      acaoRotulo: ACOES_FECHAMENTO[e.acao],
      concorda: e.concorda,
      texto: e.texto,
      registradoPor: e.registradoPor,
      registradoEm: e.registradoEm,
    };
  }

  private async montarEspelho(s: SessaoCadastro, a: Apurado, proprio: boolean): Promise<EspelhoPonto> {
    const [{ hoje }, d, unidades, gravacao] = await Promise.all([
      this.porta.relogio(s.porta),
      this.dominios(s),
      this.nomesUnidades(s),
      this.apoio.liberacao(s),
    ]);
    const mov = rotulos(d.movimentos);
    const jus = rotulos(d.justificativas);
    const per = rotulos(d.periodos);
    const b = this.banco(a);
    const fechamento =
      a.estado.fechamento !== null ? a.eventos.find((e) => e.id === a.estado.fechamento) : undefined;
    let eventosFolha: MinutosPorEvento = b.previa.eventosFolha;
    if (fechamento?.totais) {
      try {
        const t = JSON.parse(fechamento.totais) as { eventos?: MinutosPorEvento };
        if (t.eventos) eventosFolha = { ...zeroEventos(), ...t.eventos };
      } catch {
        /* totais ilegíveis: a prévia vale para a tela */
      }
    }
    const hash = fechamento?.hash ?? this.hashDo(a, eventosFolha);
    const efetivas = marcacoesEfetivas(
      a.originais.map((m) => ({ id: m.id, instante: m.instante })),
      a.ajustes.map(paraAjuste),
    );
    const diaDe = new Map<number, string>();
    for (const dd of a.apuracao.dias)
      for (const j of dd.jornadas)
        for (const p of j.pares) {
          diaDe.set(Date.parse(`${p.entrada}:00Z`), dd.dia);
          diaDe.set(Date.parse(`${p.saida}:00Z`), dd.dia);
        }
    const doDia = (dia: string) =>
      efetivas.filter((m) => {
        const atribuido = diaDe.get(Date.parse(`${m.instante}:00Z`));
        return atribuido ? atribuido === dia : m.instante.slice(0, 10) === dia;
      });
    const minutos = (xs: Record<ClasseHora, number>): MinutosClasse[] =>
      CODIGOS_CLASSE_HORA.filter((c) => xs[c] > 0).map((c) => ({
        classe: c,
        rotulo: this.rotuloClasse(d.classesHora, c),
        minutos: xs[c],
      }));
    const dias: DiaEspelho[] = a.apuracao.dias.map((dd) => ({
      dia: dd.dia,
      feriado: dd.feriado,
      previstos: dd.jornadas
        .filter((j) => j.previstoInicio && j.previstoFim)
        .map((j) => ({ inicio: j.previstoInicio!, fim: j.previstoFim! })),
      marcacoes: doDia(dd.dia).map((m) => ({
        id: m.id,
        instante: m.instante,
        fonte: m.fonte,
        desconsiderada: m.desconsiderada,
        ajuste: m.ajuste,
      })),
      minutos: minutos(dd.minutos),
      noturnoReduzidoMin: dd.noturnoReduzidoMin,
      abonadoMin: dd.abonadoMin,
      justificativa: dd.justificativa !== null ? (mov.get(dd.justificativa) ?? null) : null,
      inconsistencias: [
        ...dd.inconsistencias.map((c) => ({ codigo: c, rotulo: INCONSISTENCIAS_PONTO[c] })),
        ...(a.ajustes.some((x) => x.dia === dd.dia && x.situacao === 'pendente')
          ? [{ codigo: 'ajuste-pendente' as const, rotulo: INCONSISTENCIAS_PONTO['ajuste-pendente'] }]
          : []),
      ],
      alertas: dd.alertas.map((c) => ({ codigo: c, rotulo: ALERTAS_PONTO[c] })),
    }));
    const ajustes: AjustePontoResposta[] = a.ajustes.map((x) => ({
      id: x.id,
      tipo: x.tipo as TipoAjuste,
      tipoRotulo: TIPOS_AJUSTE[x.tipo as TipoAjuste] ?? x.tipo,
      dia: x.dia,
      marcacao: x.marcacao,
      instante: x.instante,
      movimento: x.movimento,
      movimentoRotulo: x.movimento !== null ? (mov.get(x.movimento) ?? null) : null,
      justificativa: x.justificativa,
      justificativaRotulo: x.justificativa !== null ? (jus.get(x.justificativa) ?? null) : null,
      periodo: x.periodo,
      periodoRotulo: x.periodo !== null ? (per.get(x.periodo) ?? null) : null,
      minutos: x.minutos,
      motivo: x.motivo,
      situacao: x.situacao as AjustePontoResposta['situacao'],
      pedidoPor: x.pedidoPor,
      pedidoEm: x.pedidoEm,
      decididoPor: x.decididoPor,
      decididoEm: x.decididoEm,
      motivoDecisao: x.motivoDecisao,
    }));
    const fechado = a.estado.estado === 'fechado';
    const lancados = b.doPeriodo.filter((m) => m.fechamento !== null && m.fechamento === a.estado.fechamento);
    const credito = fechado
      ? lancados.filter((m) => m.origem === 'apuracao' && m.minutos > 0).reduce((t, m) => t + m.minutos, 0)
      : b.previa.credito;
    const debito = fechado
      ? -lancados.filter((m) => m.origem === 'apuracao' && m.minutos < 0).reduce((t, m) => t + m.minutos, 0)
      : b.previa.debito;
    const saldoFinal = fechado
      ? saldoBanco(a.movimentos.filter((m) => m.competencia <= a.competencia))
      : b.previa.saldoFinal;
    const banco: BancoEspelho = {
      regra: a.regra ? this.regraResposta(a.regra) : null,
      saldoAnteriorMin: b.saldoAnterior,
      creditoMin: credito,
      debitoMin: debito,
      saldoFinalMin: saldoFinal,
      movimentos: a.movimentos
        .filter((m) => m.competencia <= a.competencia)
        .map((m) => ({
          id: m.id,
          competencia: m.competencia,
          origem: m.origem as OrigemBanco,
          origemRotulo: ORIGENS_BANCO[m.origem as OrigemBanco] ?? m.origem,
          destino: m.destino as DestinoBanco,
          minutos: m.minutos,
          motivo: m.motivo,
          registradoPor: m.registradoPor,
          registradoEm: m.registradoEm,
        })),
      parcelas: a.regra
        ? [
            `Saldo anterior ${horasMinutos(b.saldoAnterior)} + movimentos do período ${horasMinutos(saldoFinal - b.saldoAnterior)} = saldo ${horasMinutos(saldoFinal)}`,
            `Crédito das horas extras ${horasMinutos(credito)} − débito dos atrasos ${horasMinutos(debito)} = ${horasMinutos(credito - debito)}`,
          ]
        : ['Sem banco de horas no regime: as horas extras e os atrasos vão à folha.'],
    };
    const parcelas = CODIGOS_CLASSE_HORA.filter((c) => a.apuracao.totais[c] > 0).map((c) => {
      const ps = a.apuracao.dias.filter((x) => x.minutos[c] > 0).map((x) => String(x.minutos[c]));
      return `${this.rotuloClasse(d.classesHora, c)}: ${ps.join(' + ')} = ${a.apuracao.totais[c]} min`;
    });
    if (a.apuracao.noturnoMin > 0)
      parcelas.push(
        `Adicional noturno: ${a.apuracao.noturnoMin} min de relógio × 60 / 52,5 = ${a.apuracao.noturnoReduzidoMin} min de hora noturna`,
      );
    if (a.apuracao.semanasDsr.length > 0)
      parcelas.push(
        `Descanso semanal descontado: ${a.apuracao.semanasDsr.length} semana(s) com falta × ${a.apuracao.eventos[2] / a.apuracao.semanasDsr.length} min = ${a.apuracao.eventos[2]} min`,
      );
    if (a.posteriores > 0)
      parcelas.push(
        `${a.posteriores} marcação(ões) importada(s) depois do fechamento: entram se o período for reaberto.`,
      );
    const ligado = gravacao.ligada;
    const como = emComo(s);
    const terminou = diasEntre(this.ultimo(a.competencia), hoje) > 0;
    return {
      colaborador: this.colaborador(a.v, unidades, a.regime ? `${a.regime.codigo} · ${a.regime.nome}` : null),
      competencia: a.competencia,
      hoje,
      estado: a.estado.estado,
      versao: a.estado.versao,
      hash,
      ciencia: a.estado.ciencia
        ? this.eventoResposta(a.eventos.find((e) => e.id === a.estado.ciencia!.id)!)
        : null,
      trilha: a.eventos.filter((e) => e.competencia === a.competencia).map((e) => this.eventoResposta(e)),
      dias,
      totais: minutos(a.apuracao.totais),
      eventos: CODIGOS_EVENTO_FOLHA.map((c: EventoFolha) => ({
        codigo: c,
        rotulo: rotulos(d.eventosFolha).get(c) ?? EVENTOS_FOLHA[c],
        minutos: eventosFolha[c],
      })),
      semanasDsr: a.apuracao.semanasDsr,
      diasInconsistentes: a.apuracao.diasInconsistentes,
      ajustes,
      banco,
      parcelas,
      acoes: {
        justificar: ligado && !fechado && !como && s.pode(P.justificar),
        aprovar: ligado && !fechado && !como && !proprio && s.pode(P.aprovar),
        fechar: ligado && !fechado && terminou && !proprio && s.pode(P.aprovar),
        reabrir: ligado && fechado && !proprio && s.pode(P.aprovar),
        ciencia: ligado && fechado && proprio && !como && !a.estado.ciencia,
        exportar: s.pode(P.exportar),
        motivo: como ? MOTIVO_SESSAO_COMO_PONTO : proprio && s.pode(P.aprovar) ? MOTIVO_PROPRIO_PONTO : null,
      },
    };
  }

  /** O aprovador não trata o próprio vínculo (D-PROPRIO-524): relê os vínculos do login na hora da gravação. */
  private async naoProprio(s: SessaoCadastro, vinculo: number): Promise<void> {
    if ((await this.porta.vinculosDoLogin(s.porta, s.login)).includes(vinculo))
      throw recusaRegra('proprio-vinculo', MOTIVO_PROPRIO_PONTO);
  }

  private ultimo(competencia: string): string {
    const d = diasDaCompetencia(competencia);
    return d[d.length - 1]!;
  }

  async espelho(s: SessaoCadastro, vinculo: number, competencia: string): Promise<EspelhoPonto> {
    const v = await this.vinculoOu404(s, vinculo);
    const proprio = (await this.porta.vinculosDoLogin(s.porta, s.login)).includes(v.id);
    return this.montarEspelho(s, await this.apurar(s, v, competencia), proprio);
  }

  async meuEspelho(
    s: SessaoCadastro,
    competencia: string | null,
    vinculo: number | null,
  ): Promise<MeuEspelho> {
    const ids = await this.porta.vinculosDoLogin(s.porta, s.login);
    const unidades = await this.nomesUnidades(s);
    const vs = (await Promise.all(ids.map((id) => this.pessoas.vinculo(s.porta, id)))).filter(
      (v): v is VinculoColaborador => !!v,
    );
    const escolhido = vs.find((v) => v.id === vinculo) ?? vs[0] ?? null;
    const lista = vs.map((v) => ({
      vinculo: v.id,
      cargo: v.cargo,
      unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
    }));
    if (!escolhido) return { vinculos: lista, competencias: [], espelho: null };
    const eventos = await this.porta.eventosPeriodo(s.porta, escolhido.id);
    const fechadas = [...new Set(eventos.map((e) => e.competencia))]
      .filter(
        (c) =>
          estadoDoPeriodo(eventos.filter((e) => e.competencia === c).map(paraEvento)).estado === 'fechado',
      )
      .sort()
      .reverse();
    const comp = competencia && fechadas.includes(competencia) ? competencia : (fechadas[0] ?? null);
    return {
      vinculos: lista,
      competencias: fechadas,
      espelho: comp ? await this.montarEspelho(s, await this.apurar(s, escolhido, comp), true) : null,
    };
  }

  // ── Ajustes (regra 11) ──────────────────────────────────────────────────────────────────────────────────────

  async lancarAjuste(s: SessaoCadastro, e: LancarAjusteEntrada): Promise<ResultadoPonto> {
    naoComo(s);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    const [{ hoje }, d, hmacs] = await Promise.all([
      this.porta.relogio(s.porta),
      this.dominios(s),
      this.porta.hmacs(s.porta, [v.id]),
    ]);
    if (e.justificativa !== null && !d.justificativas.some((x) => x.codigo === e.justificativa))
      throw recusaRegra('justificativa', 'Escolha o motivo da lista.', 'justificativa');
    if (e.periodo !== null && !d.periodos.some((x) => x.codigo === e.periodo))
      throw recusaRegra('periodo', 'Escolha a marcação da jornada da lista.', 'periodo');
    const competencia = e.dia.slice(0, 7);
    const comp = diasDaCompetencia(competencia);
    const hmac = hmacs.get(v.id) ?? null;
    const r = await this.apoio.sgh(
      s,
      E.pessoasAjustePontoLancado.codigo,
      CHAVE_PESSOAS_PONTO,
      (x: { id: number }) => ({ tabela: 'ajuste_ponto', id: String(x.id) }),
      async (g) => {
        await g.travarPessoa(v.pessoa);
        const eventos = (await g.eventosPeriodo(v.id)).filter((x) => x.competencia === competencia);
        const originais = hmac
          ? await g.marcacoes(hmac, `${e.dia}T00:00`, `${somarDias(e.dia, 2)}T00:00`)
          : [];
        const recusa = conferirAjuste(
          {
            tipo: e.tipo,
            dia: e.dia,
            marcacao: e.marcacao,
            instante: e.instante,
            movimento: e.movimento,
            minutos: e.minutos,
          },
          {
            hoje,
            admissao: v.admissao,
            desligamento: v.desligamento,
            periodoFechado: estadoDoPeriodo(eventos.map(paraEvento)).estado === 'fechado',
            originais: originais.map((m) => ({ id: m.id, instante: m.instante })),
            ajustes: (await g.ajustes(v.id, comp[0]!, comp[comp.length - 1]!)).map(paraAjuste),
            movimentos: d.movimentos.map((x) => x.codigo),
          },
        );
        if (recusa) throw recusar(recusa);
        const id = await g.incluirAjuste({
          vinculo: v.id,
          dia: e.dia,
          tipo: e.tipo,
          marcacao: e.tipo === 'desconsiderar' ? e.marcacao : null,
          instante: e.tipo === 'inclusao' ? e.instante : null,
          movimento: e.tipo === 'justificativa' ? e.movimento : null,
          justificativa: e.tipo === 'justificativa' ? e.justificativa : null,
          periodo: e.tipo === 'inclusao' ? e.periodo : null,
          minutos: e.tipo === 'justificativa' ? e.minutos : null,
          motivo: e.motivo,
          por: s.login,
        });
        return { id };
      },
    );
    return { id: r.id, mensagem: 'Ajuste lançado: aguarda a aprovação de outra pessoa.' };
  }

  async decidirAjuste(s: SessaoCadastro, e: DecidirAjusteEntrada): Promise<ResultadoPonto> {
    naoComo(s);
    await this.apoio.exigirLiberacao(s);
    const atual = await this.porta.ajuste(s.porta, e.ajuste);
    if (!atual) throw naoEncontrado('Ajuste');
    const v = await this.vinculoOu404(s, atual.vinculo);
    await this.naoProprio(s, v.id);
    await this.apoio.sgh(
      s,
      E.pessoasAjustePontoDecidido.codigo,
      CHAVE_PESSOAS_PONTO,
      { tabela: 'ajuste_ponto', id: String(atual.id) },
      async (g) => {
        await g.travarPessoa(v.pessoa);
        const a = await g.ajuste(atual.id);
        if (!a) throw naoEncontrado('Ajuste');
        const competencia = a.dia.slice(0, 7);
        const eventos = (await g.eventosPeriodo(v.id)).filter((x) => x.competencia === competencia);
        const recusa = conferirDecisao(
          paraAjuste(a),
          s.login,
          estadoDoPeriodo(eventos.map(paraEvento)).estado === 'fechado',
        );
        if (recusa) throw recusar(recusa);
        await g.decidirAjuste({
          id: a.id,
          versao: a.versao,
          situacao: e.decisao === 'aprovar' ? 'aprovado' : 'recusado',
          motivo: e.motivo?.trim() || null,
          por: s.login,
        });
        return { id: a.id };
      },
    );
    return { id: atual.id, mensagem: e.decisao === 'aprovar' ? 'Ajuste aprovado.' : 'Ajuste recusado.' };
  }

  // ── Fechamento, reabertura e ciência ────────────────────────────────────────────────────────────────────────

  async fechar(s: SessaoCadastro, e: FecharPeriodoEntrada): Promise<ResultadoPonto> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    await this.naoProprio(s, v.id);
    const [a, { hoje }] = await Promise.all([this.apurar(s, v, e.competencia), this.porta.relogio(s.porta)]);
    const recusa = conferirFechamento({
      competencia: e.competencia,
      hoje,
      estado: a.estado,
      diasInconsistentes: a.apuracao.diasInconsistentes,
      ajustesPendentes: a.ajustes.filter((x) => x.situacao === 'pendente').length,
    });
    if (recusa) throw recusar(recusa);
    const b = this.banco(a);
    const hash = this.hashDo(a, b.previa.eventosFolha);
    const r = await this.apoio.sgh(
      s,
      E.pessoasPontoFechado.codigo,
      CHAVE_PESSOAS_PONTO,
      (x: { id: number }) => ({ tabela: 'fechamento_ponto', id: String(x.id) }),
      async (g) => {
        await g.travarPessoa(v.pessoa);
        // Releitura na transação: ninguém fechou nem lançou ajuste entre a apuração e aqui.
        const eventos = (await g.eventosPeriodo(v.id)).filter((x) => x.competencia === e.competencia);
        if (eventos.length !== a.eventos.filter((x) => x.competencia === e.competencia).length)
          throw recusaRegra(
            'desatualizado',
            'O período mudou depois que você abriu. Abra o espelho de novo.',
          );
        const ultimo = diasDaCompetencia(e.competencia);
        const ajustes = await g.ajustes(v.id, ultimo[0]!, ultimo[ultimo.length - 1]!);
        if (
          ajustes.length !== a.ajustes.length ||
          ajustes.some(
            (x) => x.situacao === 'pendente' || a.ajustes.find((y) => y.id === x.id)?.versao !== x.versao,
          )
        )
          throw recusaRegra(
            'desatualizado',
            'Os ajustes do período mudaram depois que você abriu. Abra o espelho de novo.',
          );
        const movimentos = await g.movimentosBanco(v.id);
        const saldoAnterior = saldoBanco(movimentos.filter((m) => m.competencia < e.competencia));
        const banco = fecharNoBanco(
          a.apuracao.eventos,
          this.regraDominio(a.regra),
          e.competencia,
          saldoAnterior,
        );
        const id = await g.incluirEventoPeriodo({
          vinculo: v.id,
          competencia: e.competencia,
          acao: 'fechado',
          ref: null,
          hash,
          totais: this.totais(a, banco.eventosFolha),
          concorda: null,
          texto: null,
          por: s.login,
        });
        for (const m of banco.movimentos)
          await g.incluirMovimentoBanco({
            vinculo: v.id,
            competencia: e.competencia,
            origem: m.origem,
            destino: m.destino,
            minutos: m.minutos,
            fechamento: id,
            motivo: null,
            por: s.login,
          });
        await g.outbox({
          tipo: EVENTO_PONTO_FECHADO,
          chave: `ponto:${s.hospital}:${v.id}:${e.competencia}:${id}`,
          carga: { vinculo: v.id, competencia: e.competencia, fechamento: id },
        });
        return { id };
      },
    );
    return { id: r.id, mensagem: 'Período fechado: o espelho aguarda a ciência do colaborador.' };
  }

  async reabrir(s: SessaoCadastro, e: ReabrirPeriodoEntrada): Promise<ResultadoPonto> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    await this.naoProprio(s, v.id);
    const r = await this.apoio.sgh(
      s,
      E.pessoasPontoFechado.codigo,
      CHAVE_PESSOAS_PONTO,
      (x: { id: number }) => ({ tabela: 'fechamento_ponto', id: String(x.id) }),
      async (g) => {
        await g.travarPessoa(v.pessoa);
        const todos = await g.eventosPeriodo(v.id);
        const estado = estadoDoPeriodo(todos.filter((x) => x.competencia === e.competencia).map(paraEvento));
        const seguintes = [
          ...new Set(todos.filter((x) => x.competencia > e.competencia).map((x) => x.competencia)),
        ];
        const seguinteFechada = seguintes.some(
          (c) =>
            estadoDoPeriodo(todos.filter((x) => x.competencia === c).map(paraEvento)).estado === 'fechado',
        );
        const recusa = conferirReabertura(estado, seguinteFechada);
        if (recusa) throw recusar(recusa);
        const id = await g.incluirEventoPeriodo({
          vinculo: v.id,
          competencia: e.competencia,
          acao: 'reaberto',
          ref: estado.fechamento,
          hash: null,
          totais: null,
          concorda: null,
          texto: e.motivo,
          por: s.login,
        });
        // O banco encadeia: a reabertura estorna, com outro movimento, o que o fechamento lançou.
        for (const m of (await g.movimentosBanco(v.id)).filter((x) => x.fechamento === estado.fechamento))
          await g.incluirMovimentoBanco({
            vinculo: v.id,
            competencia: e.competencia,
            origem: m.origem,
            destino: m.destino,
            minutos: -m.minutos,
            fechamento: id,
            motivo: `Estorno da reabertura: ${e.motivo}`.slice(0, 400),
            por: s.login,
          });
        await g.outbox({
          tipo: EVENTO_PONTO_REABERTO,
          chave: `ponto:${s.hospital}:${v.id}:${e.competencia}:${id}`,
          carga: { vinculo: v.id, competencia: e.competencia, fechamento: estado.fechamento ?? 0 },
        });
        return { id };
      },
    );
    return { id: r.id, mensagem: 'Período reaberto: os ajustes voltam a entrar; feche de novo depois.' };
  }

  async ciencia(s: SessaoCadastro, e: CienciaEspelhoEntrada): Promise<ResultadoPonto> {
    naoComo(s);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    const proprio = (await this.porta.vinculosDoLogin(s.porta, s.login)).includes(v.id);
    const r = await this.apoio.sgh(
      s,
      E.pessoasPontoCiencia.codigo,
      CHAVE_PESSOAS_PONTO,
      (x: { id: number }) => ({ tabela: 'fechamento_ponto', id: String(x.id) }),
      async (g) => {
        const eventos = (await g.eventosPeriodo(v.id)).filter((x) => x.competencia === e.competencia);
        const estado = estadoDoPeriodo(eventos.map(paraEvento));
        const recusa = conferirCiencia(estado, proprio);
        if (recusa) throw recusar(recusa);
        const f = eventos.find((x) => x.id === estado.fechamento);
        if (!f || f.hash !== e.hash)
          throw recusaRegra(
            'espelho-mudou',
            'O espelho mudou depois que você abriu. Abra de novo para conferir.',
          );
        const id = await g.incluirEventoPeriodo({
          vinculo: v.id,
          competencia: e.competencia,
          acao: 'ciencia',
          ref: f.id,
          hash: e.hash,
          totais: null,
          concorda: e.concorda,
          texto: e.observacao?.trim() || null,
          por: s.login,
        });
        return { id };
      },
    );
    return {
      id: r.id,
      mensagem: e.concorda
        ? 'Ciência registrada.'
        : 'Ciência registrada com a sua discordância: o RH vai analisar.',
    };
  }

  // ── Banco de horas (regra 14) ───────────────────────────────────────────────────────────────────────────────

  async acertoBanco(s: SessaoCadastro, e: AcertoBancoEntrada): Promise<ResultadoPonto> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoOu404(s, e.vinculo);
    await this.naoProprio(s, v.id);
    const r = await this.apoio.sgh(
      s,
      E.pessoasBancoHorasAlterado.codigo,
      CHAVE_PESSOAS_PONTO,
      (x: { id: number }) => ({ tabela: 'movimento_banco_horas', id: String(x.id) }),
      async (g) => {
        await g.travarPessoa(v.pessoa);
        const eventos = (await g.eventosPeriodo(v.id)).filter((x) => x.competencia === e.competencia);
        const recusa = conferirAcerto(
          e.minutos,
          estadoDoPeriodo(eventos.map(paraEvento)).estado === 'fechado',
        );
        if (recusa) throw recusar(recusa);
        const id = await g.incluirMovimentoBanco({
          vinculo: v.id,
          competencia: e.competencia,
          origem: 'acerto',
          destino: 2,
          minutos: e.minutos,
          fechamento: null,
          motivo: e.motivo,
          por: s.login,
        });
        return { id };
      },
    );
    return { id: r.id, mensagem: 'Acerto lançado no banco de horas.' };
  }

  private regraResposta(r: RegraBancoDoRegime): RegraBancoResposta {
    return {
      regime: r.regime,
      destino: r.destino as DestinoBanco,
      inicio: r.inicio as InicioBanco,
      desde: r.desde,
      cicloMeses: r.cicloMeses,
      faltaDebita: r.faltaDebita,
      versao: r.versao,
      ativo: r.ativo !== false,
      motivoSituacao: r.motivoSituacao ?? null,
    };
  }

  /**
   * W0-06: desativação ou reativação da regra do banco do regime, com motivo (matriz, linha "Tabelas de domínio": o
   * item referenciado se inativa). A desativada não entra no fechamento; os movimentos já lançados ficam.
   */
  async situacaoRegraBanco(s: SessaoCadastro, e: SituacaoRegraBancoEntrada): Promise<ResultadoPonto> {
    await this.apoio.exigirLiberacao(s);
    const regime = await this.escala.regime(s.porta, e.regime);
    if (!regime) throw naoEncontrado('Regime');
    const r = await this.apoio.sgh(
      s,
      E.pessoasBancoHorasAlterado.codigo,
      CHAVE_PESSOAS_PONTO,
      (x: { id: number }) => ({ tabela: 'regra_banco_horas', id: String(x.id) }),
      async (g) => {
        const atual = (await g.regrasBanco()).find((x) => x.regime === e.regime) ?? null;
        if (!atual) throw naoEncontrado('Regra do banco de horas');
        if ((atual.ativo !== false) === e.ativo)
          throw recusaRegra(
            e.ativo ? 'regra-ativa' : 'regra-inativa',
            e.ativo ? 'A regra já está ativa.' : 'A regra já está desativada.',
            'ativo',
          );
        const id = await g.situacaoRegraBanco({
          regime: e.regime,
          versao: e.versao,
          ativo: e.ativo,
          motivo: e.motivo.trim(),
          por: s.login,
        });
        // O motivo e o autor da mudança anterior ficam no histórico (a linha da regra só guarda a última).
        await g.registrarCorrecao({
          tabela: 'regra_banco_horas',
          registro: id,
          operacao: e.ativo ? 'banco.regra.reativada' : 'banco.regra.desativada',
          antes: {
            ativo: atual.ativo !== false,
            motivoSituacao: atual.motivoSituacao ?? null,
            alteradoPor: atual.alteradoPor ?? null,
          },
          depois: { ativo: e.ativo, motivoSituacao: e.motivo.trim(), alteradoPor: s.login },
          motivo: e.motivo.trim(),
          por: s.login,
        });
        return { id };
      },
    );
    return {
      id: r.id,
      mensagem: e.ativo
        ? 'Regra do banco de horas reativada.'
        : 'Regra do banco de horas desativada: o regime fecha o ponto sem banco até reativar.',
    };
  }

  /**
   * W0-06: desistência do ajuste PENDENTE pelo PRÓPRIO solicitante, com motivo (o ajuste fica, com a situação
   * "desistência do solicitante"; nada se apaga). Outra pessoa: 403. Já decidido: 409.
   */
  async desistirAjuste(s: SessaoCadastro, e: DesistirAjusteEntrada): Promise<ResultadoPonto> {
    await this.apoio.exigirLiberacao(s);
    const atual = await this.porta.ajuste(s.porta, e.ajuste);
    if (!atual) throw naoEncontrado('Ajuste');
    await this.vinculoOu404(s, atual.vinculo);
    if (atual.pedidoPor.toUpperCase() !== s.login.toUpperCase())
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Só quem pediu desiste',
        'Só o próprio solicitante desiste do ajuste pendente; quem aprova recusa com o motivo.',
        { codigo: 'nao-e-o-solicitante' },
      );
    if (atual.situacao !== 'pendente')
      throw recusaRegra('ja-decidido', 'Este ajuste já foi decidido.', 'ajuste');
    await this.apoio.sgh(
      s,
      E.pessoasAjustePontoDesistido.codigo,
      CHAVE_PESSOAS_PONTO,
      { tabela: 'ajuste_ponto', id: String(atual.id) },
      async (g) => {
        const a = await g.ajuste(atual.id);
        if (!a || a.situacao !== 'pendente')
          throw recusaRegra('ja-decidido', 'Este ajuste já foi decidido.', 'ajuste');
        await g.desistirAjuste({ id: a.id, versao: a.versao, motivo: e.motivo.trim(), por: s.login });
        return { id: a.id };
      },
    );
    return { id: atual.id, mensagem: 'Você desistiu do ajuste: ele fica no histórico, sem efeito.' };
  }

  async regrasBanco(s: SessaoCadastro): Promise<RegrasBancoLista> {
    const regras = await this.porta.regrasBanco(s.porta);
    const correcoes = await this.porta.correcoes(
      s.porta,
      'regra_banco_horas',
      regras.map((r) => r.id),
    );
    const regimeDe = new Map(regras.map((r) => [r.id, r.regime]));
    return {
      itens: regras.map((r) => this.regraResposta(r)),
      correcoes: correcoes.map((c) => ({
        id: c.id,
        operacao: c.operacao,
        registro: c.registro,
        regime: regimeDe.get(c.registro) ?? null,
        antes: c.antes,
        depois: c.depois,
        motivo: c.motivo,
        por: c.por,
        em: c.em,
      })),
    };
  }

  async gravarRegraBanco(s: SessaoCadastro, e: RegraBancoEntrada): Promise<ResultadoPonto> {
    await this.apoio.exigirLiberacao(s);
    const regime = await this.escala.regime(s.porta, e.regime);
    if (!regime) throw naoEncontrado('Regime');
    const r = await this.apoio.sgh(
      s,
      E.pessoasBancoHorasAlterado.codigo,
      CHAVE_PESSOAS_PONTO,
      (x: { id: number }) => ({ tabela: 'regra_banco_horas', id: String(x.id) }),
      async (g) => {
        const atual = (await g.regrasBanco()).find((x) => x.regime === e.regime) ?? null;
        if (atual && e.versao === null)
          throw recusaRegra('regra-existente', 'O regime já tem a regra do banco: altere-a.', 'regime');
        const id = await g.gravarRegraBanco({
          regime: e.regime,
          destino: e.destino,
          inicio: e.inicio,
          desde: e.desde,
          cicloMeses: e.cicloMeses,
          faltaDebita: e.faltaDebita,
          versao: atual ? e.versao : null,
          por: s.login,
        });
        return { id };
      },
    );
    return { id: r.id, mensagem: 'Regra do banco de horas gravada.' };
  }

  // ── AEJ e eventos para a folha ──────────────────────────────────────────────────────────────────────────────

  /** O AEJ da competência com os vínculos de período fechado (o CPF só aqui, decifrado para o arquivo legal). */
  async aej(
    s: SessaoCadastro,
    competencia: string,
  ): Promise<{ nome: string; conteudo: string; vinculos: number }> {
    const cifra = this.cifra;
    if (!cifra)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Exportação desligada',
        'A chave do CPF não está configurada neste ambiente.',
        {
          codigo: 'sem-chave-cpf',
        },
      );
    const dias = diasDaCompetencia(competencia);
    const [{ agora }, eventos, arquivos] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.eventosDaCompetencia(s.porta, competencia),
      this.porta.arquivosDoPeriodo(s.porta, dias[0]!, dias[dias.length - 1]!),
    ]);
    const porVinculo = new Map<number, EventoDoPeriodo[]>();
    for (const e of eventos) porVinculo.set(e.vinculo, [...(porVinculo.get(e.vinculo) ?? []), e]);
    const fechados = [...porVinculo.entries()]
      .filter(([, xs]) => estadoDoPeriodo(xs.map(paraEvento)).estado === 'fechado')
      .map(([v]) => v)
      .sort((a, b) => a - b);
    if (fechados.length === 0)
      throw recusaRegra(
        'sem-fechamento',
        'Nenhum colaborador tem o período desta competência fechado.',
        'competencia',
      );
    const reps = [...new Map(arquivos.filter((a) => a.numeroRep).map((a) => [a.numeroRep!, a])).values()];
    const idRep = new Map(reps.map((a, i) => [a.numeroRep!, String(i + 1)]));
    const horarios = new Map<
      string,
      { codigo: string; duracaoMin: number; entrada: string; saida: string }
    >();
    const vinculos: VinculoAej[] = [];
    for (const id of fechados) {
      const v = await this.vinculoOu404(s, id);
      const a = await this.apurar(s, v, competencia);
      const cpf = cifra.decifrar(v.cpfCifrado);
      if (!cpf) continue;
      const repDe = new Map(a.originais.map((m) => [m.id, m.numeroRep]));
      const horarioDe = (instante: string): string | null => {
        const p = a.plantoes.find(
          (x) => Math.abs(Date.parse(`${x.inicio}:00Z`) - Date.parse(`${instante}:00Z`)) <= 16 * 3_600_000,
        );
        if (!p) return null;
        const ent = p.inicio.slice(11, 16).replace(':', '');
        const sai = p.fim.slice(11, 16).replace(':', '');
        const chave = `${ent}-${sai}`;
        if (!horarios.has(chave))
          horarios.set(chave, {
            codigo: `H${horarios.size + 1}`,
            duracaoMin: (Date.parse(`${p.fim}:00Z`) - Date.parse(`${p.inicio}:00Z`)) / 60_000,
            entrada: ent,
            saida: sai,
          });
        return horarios.get(chave)!.codigo;
      };
      const marcacoes: MarcacaoAej[] = [];
      const motivoDe = new Map(a.ajustes.map((x) => [x.id, x.motivo]));
      for (const dd of a.apuracao.dias)
        for (const j of dd.jornadas)
          for (const p of j.pares) {
            for (const [instante, tipo] of [
              [p.entrada, 'E'],
              [p.saida, 'S'],
            ] as const) {
              const ef = marcacoesEfetivas(
                a.originais.map((m) => ({ id: m.id, instante: m.instante })),
                a.ajustes.map(paraAjuste),
              ).find((m) => m.instante === instante && !m.desconsiderada);
              marcacoes.push({
                instante,
                rep: ef?.id ? (idRep.get(repDe.get(ef.id) ?? '') ?? null) : null,
                tipo,
                fonte: ef?.fonte ?? 'O',
                horario: horarioDe(instante),
                motivo: ef?.ajuste ? (motivoDe.get(ef.ajuste) ?? null) : null,
              });
            }
          }
      for (const m of marcacoesEfetivas(
        a.originais.map((x) => ({ id: x.id, instante: x.instante })),
        a.ajustes.map(paraAjuste),
      ).filter((x) => x.desconsiderada))
        marcacoes.push({
          instante: m.instante,
          rep: m.id ? (idRep.get(repDe.get(m.id) ?? '') ?? null) : null,
          tipo: 'D',
          fonte: 'O',
          horario: horarioDe(m.instante),
          motivo: m.ajuste ? (motivoDe.get(m.ajuste) ?? null) : null,
        });
      const lancados = a.movimentos.filter(
        (m) => m.competencia === competencia && m.fechamento === a.estado.fechamento,
      );
      vinculos.push({
        id: String(v.id),
        cpf,
        nome: v.nome,
        matricula: v.matricula,
        marcacoes,
        ausencias: [
          ...a.apuracao.dias
            .filter((dd) => dd.minutos[7] > 0)
            .map((dd) => ({ tipo: 2 as const, data: dd.dia, minutos: dd.minutos[7], movimentoBanco: null })),
          ...a.apuracao.semanasDsr.map((w) => ({
            tipo: 1 as const,
            data: w,
            minutos: a.apuracao.eventos[2] / a.apuracao.semanasDsr.length,
            movimentoBanco: null,
          })),
          ...lancados
            .filter((m) => m.origem === 'apuracao')
            .map((m) => ({
              tipo: 3 as const,
              data: this.ultimo(competencia),
              minutos: Math.abs(m.minutos),
              movimentoBanco: (m.minutos > 0 ? 1 : 2) as 1 | 2,
            })),
        ],
      });
    }
    const ultimoArquivo = arquivos[0];
    const conteudo = gerarAej({
      empregador: {
        cnpj: ultimoArquivo?.cnpjEmpregador ?? null,
        razaoSocial: ultimoArquivo?.razaoSocial ?? '',
      },
      dataInicial: dias[0]!,
      dataFinal: dias[dias.length - 1]!,
      geradoEm: agora,
      reps: reps.map((a) => ({
        id: idRep.get(a.numeroRep!)!,
        tipo: a.tipoRep === 'REP-C' ? '1' : a.tipoRep === 'REP-A' ? '2' : '3',
        numero: a.numeroRep!,
      })),
      horarios: [...horarios.values()],
      vinculos,
      programa: {
        nome: PROGRAMA_AEJ.nome,
        versao: PROGRAMA_AEJ.versao,
        cnpjDesenvolvedor: null,
        razaoDesenvolvedor: PROGRAMA_AEJ.nome,
        email: '',
      },
    });
    return { nome: `AEJ_${s.hospital}_${competencia}.txt`, conteudo, vinculos: vinculos.length };
  }

  /** Os eventos de ponto para a folha (os 13 tipos de integração) dos períodos fechados da competência, sem CPF. */
  async eventosFolha(s: SessaoCadastro, competencia: string): Promise<string> {
    const eventos = await this.porta.eventosDaCompetencia(s.porta, competencia);
    const porVinculo = new Map<number, EventoDoPeriodo[]>();
    for (const e of eventos) porVinculo.set(e.vinculo, [...(porVinculo.get(e.vinculo) ?? []), e]);
    const linhas = ['vinculo;matricula;competencia;evento;minutos'];
    for (const [id, xs] of [...porVinculo.entries()].sort((a, b) => a[0] - b[0])) {
      const est = estadoDoPeriodo(xs.map(paraEvento));
      const f = xs.find((x) => x.id === est.fechamento);
      if (!f?.totais) continue;
      const v = await this.pessoas.vinculo(s.porta, id);
      const ev = lerEventos(f.totais);
      for (const c of CODIGOS_EVENTO_FOLHA)
        if ((ev[c] ?? 0) > 0) linhas.push([id, v?.matricula ?? '', competencia, c, ev[c]].join(';'));
    }
    return `${linhas.join('\r\n')}\r\n`;
  }

  /** Data e hora no formato do AEJ (exposto para o teste do controlador). */
  static dataHora = dataHoraAej;
}
