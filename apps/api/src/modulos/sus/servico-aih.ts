// Faturamento SUS próprio, etapa 4 (ficha do M51, seções 4, 5, 7, 8 e 12; regra 6): AIH, leitos de UTI, espelho, retorno
// e glosa do gestor. Construído completo e DESLIGADO por estabelecimento (DP-35: a chave `faturamento.susAih`; o retorno
// do BPA segue a chave `faturamento.susBpa`). Regras que o servidor confere sempre:
//   - a chave de liberação do instrumento no estabelecimento;
//   - o escopo por convênio: a AIH é do financiador SUS (quem não tem os convênios SUS no escopo não lê nem grava); a
//     faixa, o SISAIH01 e o retorno exigem acesso a todos os convênios do estabelecimento;
//   - a máquina de estados da AIH e a versão (controle otimista) em cada ação;
//   - a regra 6 no fechamento: laudo autorizado, número da faixa, CID compatível, permanência coerente e as diárias de UTI
//     pela trajetória com leito habilitado (a crítica bloqueante recusa o fechamento);
//   - a auditoria (regra 10) sem dado pessoal: a AIH, a internação, o número, as contagens e o hash.
// Exportação só em arquivo (regra 9): nada aqui fala com serviço do SUS.
import { createHash } from 'node:crypto';
import {
  type AihLida,
  type ArquivoSusGerado,
  type CaraterInternacaoSih,
  type CompetenciaSus,
  cnsValido,
  type EspelhoAih,
  EVENTOS_AUDITAVEIS,
  type FaixaAihLida,
  type FiltroAihs,
  type FiltroRetornosSus,
  type GerarSisaihEntrada,
  type ImportarRetornoSusEntrada,
  type InstrumentoSus,
  type InternacaoParaAih,
  type LinhaEspelhoAih,
  type PaginaAihs,
  type PaginaRetornosSus,
  type RegistrarAihEntrada,
  type RegistrarFaixaAihEntrada,
  type ResultadoRetornoSus,
  type RetornoSusLido,
  type TratarRetornoSusEntrada,
  versaoSus,
} from '@sgh/contratos';
import {
  acaoPermitida,
  aihApresentavel,
  baseAih,
  conferirEstrutura,
  gerarArquivoSisaih,
  intervaloDaCompetencia,
  LEIAUTE_SISAIH01,
  lerRetornoSus,
  numeroAih,
  numeroNaFaixa,
  proximoNumeroDaFaixa,
  recusaFaixaAih,
  resumoRetornoSus,
  utiPorAcomodacaoDoParametro,
  valorNaCompetencia,
} from '@sgh/dominio-faturamento';
import { ErroProblema } from '../../problema.filter.js';
import {
  type AihMontada,
  aihParaArquivo,
  caraterDaInternacao,
  criticaAihDaCompetencia,
  montarAihs,
  PARAMETROS_AIH_VAZIOS,
  type ParametrosAih,
} from './montagem-aih.js';
import type { ContextoSus, GravacaoSus, LeituraSus, PortaSus } from './porta.js';
import type { ArmazemArquivoSus, MontadorCriticaSus, ServicoSus, SessaoSus } from './servico.js';
import { type AihRegistro, ErroAih, ErroSus, type FaixaAih, type ItemAihParaGravar, type RetornoSus } from './tipos.js';

export const MENSAGENS_RECUSA_AIH = {
  'instrumento-desligado': 'Este instrumento está desligado neste estabelecimento.',
  'escopo-parcial':
    'Seu acesso cobre só parte dos convênios: a faixa, o arquivo e o retorno exigem acesso a todos os convênios do estabelecimento.',
  'fora-do-escopo-sus': 'Seu acesso não cobre os convênios do SUS deste estabelecimento.',
  'versao-alterada': 'O registro mudou desde que você abriu a tela. Recarregue.',
  'internacao-inexistente': 'Internação não encontrada.',
  'internacao-nao-sus': 'A conta desta internação não é do SUS: a internação vai na CIHA, não na AIH.',
  'aih-ja-registrada': 'Esta internação já tem uma AIH (cancele ou negue a anterior para registrar outra).',
  'situacao-nao-permite': 'A situação da AIH não permite esta ação.',
  'faixa-inativa': 'A faixa escolhida não está ativa.',
  'numero-fora-da-faixa': 'O número não pertence à faixa (ou o dígito não confere).',
  'numero-em-uso': 'Este número de AIH já foi usado.',
  'faixa-esgotada': 'A faixa não tem mais números livres: registre a faixa nova liberada pelo gestor.',
  'autorizacao-antes-do-laudo': 'A autorização não pode ser anterior ao laudo.',
  'aih-com-bloqueante': 'A AIH tem críticas bloqueantes: corrija na origem (ou no laudo) antes de fechar.',
  'opm-sem-dados': 'Informe a nota fiscal e o CNPJ do fornecedor de cada OPM da conta.',
  'solicitante-inexistente': 'O médico solicitante não está no cadastro de médicos solicitantes SUS.',
  'procedimento-inexistente': 'O procedimento não está na SIGTAP.',
  'faixa-invalida':
    'A faixa não confere: os dois números com o dígito, em ordem e com o mesmo início (UF, ano e tipo).',
  'faixa-sobreposta': 'A faixa sobrepõe uma faixa já registrada.',
  'competencia-nao-aberta': 'Abra a competência antes.',
  'competencia-ja-fechada': 'Esta competência já está fechada.',
  'critica-nao-executada': 'Rode a crítica antes de gerar o arquivo.',
  'criticas-bloqueantes-abertas':
    'Há críticas bloqueantes abertas: corrija na origem e rode a crítica de novo.',
  'aih-sem-producao':
    'A competência não tem AIH fechada para apresentar (o SISAIH01 não aceita remessa vazia).',
  'retorno-sem-linhas': 'O arquivo de retorno não tem nenhuma linha válida.',
  'retorno-sem-pendencia': 'Esta linha do retorno não está pendente de decisão.',
  'reapresentacao-so-rejeitada': 'Só a AIH rejeitada pelo gestor pode ser reapresentada.',
} as const;
export type RecusaAihApi = keyof typeof MENSAGENS_RECUSA_AIH;

function recusa(codigo: RecusaAihApi, detalhe: Record<string, unknown> = {}): ErroProblema {
  const m = MENSAGENS_RECUSA_AIH[codigo];
  if (codigo === 'versao-alterada')
    return new ErroProblema('conflito-de-versao', 409, 'Registro alterado', m, { codigo });
  if (codigo === 'instrumento-desligado')
    return new ErroProblema('recurso-desligado', 403, 'Funcionalidade desligada', m, {
      codigo: 'recurso-desligado',
    });
  if (codigo === 'escopo-parcial' || codigo === 'fora-do-escopo-sus')
    return new ErroProblema('sem-permissao', 403, 'Fora do escopo', m, { codigo });
  if (codigo === 'internacao-inexistente')
    return new ErroProblema('nao-encontrado', 404, 'Não encontrado', m);
  if (codigo === 'numero-em-uso' || codigo === 'faixa-sobreposta' || codigo === 'aih-ja-registrada')
    return new ErroProblema('recusa-de-negocio', 409, 'Já registrado', m, { codigo });
  return new ErroProblema('recusa-de-negocio', 422, 'Operação recusada', m, { codigo, ...detalhe });
}

function problemaDaGravacao(erro: unknown): never {
  if (erro instanceof ErroAih) {
    if (erro.codigo === 'nao-encontrado')
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', erro.message);
    throw recusa(erro.codigo);
  }
  if (erro instanceof ErroSus) {
    if (erro.codigo === 'nao-encontrado')
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', erro.message);
    if (erro.codigo === 'versao-alterada' || erro.codigo === 'equivalencia-alterada')
      throw recusa('versao-alterada');
    if (erro.codigo === 'competencia-nao-aberta' || erro.codigo === 'competencia-ja-fechada')
      throw recusa(erro.codigo);
    throw recusa('situacao-nao-permite');
  }
  throw erro;
}

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const naoEncontrada = () => new ErroProblema('nao-encontrado', 404, 'AIH não encontrada');
const CARATERES: readonly CaraterInternacaoSih[] = ['01', '02', '03', '04', '05', '06'];
const carater = (v: string): CaraterInternacaoSih =>
  (CARATERES as readonly string[]).includes(v) ? (v as CaraterInternacaoSih) : '01';
const centavos = (v: number) => Math.round(v * 100) / 100;

export class ServicoSusAih {
  constructor(
    private readonly porta: PortaSus,
    private readonly sus: ServicoSus,
    private readonly armazem: ArmazemArquivoSus,
    /** Os parâmetros da AIH do estabelecimento da sessão (o controlador resolve). */
    private readonly parametrosAih: (s: SessaoSus) => Promise<ParametrosAih> = async () =>
      PARAMETROS_AIH_VAZIOS,
    private readonly avisar: (mensagem: string) => void = () => undefined,
  ) {}

  /** A crítica da competência AIH, registrada no serviço das competências (a tela das competências roda). */
  montadorCritica(): MontadorCriticaSus {
    return async (s, competencia) => {
      const r = await this.montarCompetencia(s, competencia);
      return {
        comp: r.comp,
        m: {
          criticas: r.m.criticas,
          cnes: r.m.cnes,
          resultado: { criticas: r.m.todas, registros: { length: r.m.registros }, foraPorSerSus: 0 },
        },
      };
    };
  }

  private ctx(s: SessaoSus): ContextoSus {
    return {
      rede: s.rede,
      hospital: s.hospital,
      ...(s.estabelecimento !== undefined ? { estabelecimento: s.estabelecimento } : {}),
      ...(s.usuario !== undefined ? { usuario: s.usuario } : {}),
      ...(s.correlacao !== undefined ? { correlacao: s.correlacao } : {}),
    };
  }

  private async gravar<T>(s: SessaoSus, fn: (g: GravacaoSus) => Promise<T>): Promise<T> {
    try {
      return await this.porta.gravar(this.ctx(s), fn);
    } catch (erro) {
      return problemaDaGravacao(erro);
    }
  }

  private async exigirLiberado(s: SessaoSus, i: InstrumentoSus = 'aih'): Promise<void> {
    if (!(await s.liberado(i))) throw recusa('instrumento-desligado');
  }

  private exigirEscopoTotal(s: SessaoSus): void {
    if (s.convenios !== null) throw recusa('escopo-parcial');
  }

  /** A AIH é do SUS: o escopo da pessoa tem de cobrir os convênios SUS do estabelecimento. */
  private exigirSus(s: SessaoSus): void {
    if (s.convenios === null) return;
    const sus = s.parametros.conveniosSus;
    if (sus.length === 0 || !sus.every((c) => s.convenios?.includes(c))) throw recusa('fora-do-escopo-sus');
  }

  // ── Leituras e mapeamentos ───────────────────────────────────────────────────────────────────────────

  private async aihsLidas(l: LeituraSus, s: SessaoSus, aihs: readonly AihRegistro[]): Promise<AihLida[]> {
    const nomes = new Map<string, string | null>();
    for (const c of new Set(aihs.map((a) => a.procedimentoSolicitado)))
      nomes.set(c, (await l.sigtapPorCodigo(c))?.nome ?? null);
    const solicitantes = new Map<string, string | null>();
    for (const c of new Set(aihs.map((a) => a.solicitante)))
      solicitantes.set(c, (await l.solicitanteAih(c))?.nome ?? null);
    const internacoes = new Map<number, { entrada: string | null; alta: string | null }>();
    for (const r of new Set(aihs.map((a) => a.registro))) {
      const i = await l.internacaoAih(r, s.parametros.conveniosSus);
      internacoes.set(r, { entrada: i?.entrada ?? null, alta: i?.alta ?? null });
    }
    return aihs.map((a) => this.aihLida(a, nomes, solicitantes, internacoes));
  }

  private aihLida(
    a: AihRegistro,
    nomes: ReadonlyMap<string, string | null>,
    solicitantes: ReadonlyMap<string, string | null>,
    internacoes: ReadonlyMap<number, { entrada: string | null; alta: string | null }>,
  ): AihLida {
    const i = internacoes.get(a.registro);
    return {
      id: a.id,
      situacao: a.situacao,
      registro: a.registro,
      prontuario: a.prontuario,
      conta: a.conta,
      entrada: i?.entrada ?? null,
      alta: i?.alta ?? null,
      procedimentoSolicitado: a.procedimentoSolicitado,
      procedimentoSolicitadoNome: nomes.get(a.procedimentoSolicitado) ?? null,
      procedimentoRealizado: a.procedimentoRealizado,
      cidPrincipal: a.cidPrincipal,
      cidSecundario: a.cidSecundario,
      carater: carater(a.carater),
      solicitante: a.solicitante,
      solicitanteNome: solicitantes.get(a.solicitante) ?? null,
      dataLaudo: a.dataLaudo,
      justificativa: a.justificativa,
      faixa: a.faixa,
      numero: a.numero,
      dataAutorizacao: a.dataAutorizacao,
      permanencia: a.permanencia,
      diariasUti: a.diariasUti,
      competenciaApresentacao: a.competenciaApresentacao,
      arquivo: a.arquivo,
      reapresentacoes: a.reapresentacoes,
      justificativaSituacao: a.justificativaSituacao,
      registradaPor: a.registradaPor,
      registradaEm: a.registradaEm,
      alteradaPor: a.alteradaPor,
      alteradaEm: a.alteradaEm,
      versao: versaoSus(a.versao),
    };
  }

  private faixaLida(f: FaixaAih): FaixaAihLida {
    const inicio = BigInt(f.inicio);
    const fim = BigInt(f.fim);
    const total = Number(fim - inicio + 1n);
    return {
      id: f.id,
      inicial: numeroAih(f.inicio),
      final: numeroAih(f.fim),
      proximo: null,
      usados: f.usados,
      total,
      orgaoEmissor: f.orgaoEmissor,
      dataLiberacao: f.dataLiberacao,
      situacao: f.situacao,
      registradaPor: f.registradaPor,
      registradaEm: f.registradaEm,
      justificativa: f.justificativa,
      versao: versaoSus(f.versao),
    };
  }

  private retornoLido(r: RetornoSus): RetornoSusLido {
    return {
      id: r.id,
      instrumento: r.instrumento,
      competencia: r.competencia,
      identificacao: r.identificacao,
      procedimento: r.procedimento,
      aih: r.aih,
      linhaBpa: r.linhaBpa,
      situacao: r.situacao,
      motivo: r.motivo,
      valorApresentado: r.valorApresentado,
      valorAprovado: r.valorAprovado,
      valorGlosado: r.valorGlosado,
      tratamento: r.tratamento,
      justificativa: r.justificativa,
      arquivoRetorno: r.arquivoRetorno,
      hashRetorno: r.hashRetorno,
      importadoPor: r.importadoPor,
      importadoEm: r.importadoEm,
      tratadoPor: r.tratadoPor,
      tratadoEm: r.tratadoEm,
      versao: versaoSus(r.versao),
    };
  }

  /** O painel da tela: a chave, os parâmetros prontos, as faixas, os leitos de UTI habilitados e as contagens. */
  async painel(s: SessaoSus): Promise<{
    liberado: boolean;
    retornoBpaLiberado: boolean;
    parametros: { cnes: boolean; diretorClinico: boolean; diariasUti: number };
    faixas: FaixaAihLida[];
    leitosUti: { tipo: number; nome: string; leitos: number }[];
    porSituacao: Record<string, number>;
    leiauteConferido: boolean;
  }> {
    const pAih = await this.parametrosAih(s);
    const liberado = await s.liberado('aih');
    const retornoBpaLiberado = await s.liberado('bpa');
    return this.porta.ler(this.ctx(s), async (l) => {
      const faixas = await this.faixasCom(l);
      const pagina = await l.paginaAihs({ pagina: 0, porPagina: 1 });
      return {
        liberado,
        retornoBpaLiberado,
        parametros: {
          cnes: /^\d{7}$/.test(s.parametros.cnes),
          diretorClinico: cnsValido(pAih.diretorClinicoCns),
          diariasUti: utiPorAcomodacaoDoParametro(pAih.utiPorAcomodacao).size,
        },
        faixas,
        leitosUti: await l.leitosUti(),
        porSituacao: pagina.porSituacao,
        leiauteConferido: LEIAUTE_SISAIH01.conferidoContraOficial,
      };
    });
  }

  private async faixasCom(l: LeituraSus): Promise<FaixaAihLida[]> {
    const out: FaixaAihLida[] = [];
    for (const f of await l.faixasAih()) {
      const x = this.faixaLida(f);
      const maior = f.situacao === 'ativa' ? await l.maiorNumeroDaFaixa(f.id) : null;
      out.push({
        ...x,
        proximo:
          f.situacao === 'ativa'
            ? proximoNumeroDaFaixa({ inicio: BigInt(f.inicio), fim: BigInt(f.fim) }, maior)
            : null,
      });
    }
    return out;
  }

  async faixas(s: SessaoSus): Promise<FaixaAihLida[]> {
    this.exigirSus(s);
    return this.porta.ler(this.ctx(s), (l) => this.faixasCom(l));
  }

  async listar(s: SessaoSus, f: FiltroAihs): Promise<PaginaAihs> {
    this.exigirSus(s);
    return this.porta.ler(this.ctx(s), async (l) => {
      const p = await l.paginaAihs({
        ...(f.situacao ? { situacao: f.situacao } : {}),
        ...(f.numero ? { numero: f.numero } : {}),
        ...(f.prontuario ? { prontuario: f.prontuario } : {}),
        ...(f.registro ? { registro: f.registro } : {}),
        pagina: f.pagina,
        porPagina: f.porPagina,
      });
      return { itens: await this.aihsLidas(l, s, p.itens), total: p.total, porSituacao: p.porSituacao };
    });
  }

  /** A internação para o laudo (pelo registro): o SUS, as datas, o CID e se já tem AIH; o CNS só como "válido". */
  async internacao(s: SessaoSus, registro: number): Promise<InternacaoParaAih> {
    this.exigirSus(s);
    return this.porta.ler(this.ctx(s), async (l) => {
      const i = await l.internacaoAih(registro, s.parametros.conveniosSus);
      if (!i) throw recusa('internacao-inexistente');
      // O convênio da internação tem de estar no escopo da pessoa (o exigirSus só confere os convênios SUS).
      if (s.convenios !== null && !s.convenios.includes(i.convenio)) throw recusa('fora-do-escopo-sus');
      const vivas = await l.aihsDasInternacoes([registro]);
      return {
        registro: i.registro,
        prontuario: i.prontuario,
        conta: i.conta,
        convenio: i.convenio,
        sus: s.parametros.conveniosSus.includes(i.convenio),
        entrada: i.entrada,
        alta: i.alta,
        cidPrincipal: i.cidPrincipal,
        carater: caraterDaInternacao(i.carater),
        motivoSaida: i.motivoSaida,
        cnsValido: cnsValido(i.paciente.cns),
        aih: vivas[0]?.id ?? null,
      };
    });
  }

  // ── Faixa ────────────────────────────────────────────────────────────────────────────────────────────

  async registrarFaixa(s: SessaoSus, e: RegistrarFaixaAihEntrada): Promise<FaixaAihLida> {
    await this.exigirLiberado(s);
    this.exigirEscopoTotal(s);
    return this.gravar(s, async (g) => {
      let id: number;
      if (e.acao === 'registrar') {
        const existentes = (await g.faixasAih()).map((f) => ({
          inicio: BigInt(f.inicio),
          fim: BigInt(f.fim),
          situacao: f.situacao,
        }));
        const r = recusaFaixaAih(e.inicial, e.final, existentes);
        if (r === 'faixa-sobreposta') throw recusa('faixa-sobreposta');
        if (r) throw recusa('faixa-invalida', { motivo: r });
        id = await g.inserirFaixaAih({
          inicio: baseAih(e.inicial),
          fim: baseAih(e.final),
          orgaoEmissor: e.orgaoEmissor,
          dataLiberacao: e.dataLiberacao,
          por: s.login,
        });
      } else {
        const f = await g.faixaAih(e.faixa, true);
        if (!f) throw new ErroProblema('nao-encontrado', 404, 'Faixa não encontrada');
        if (versaoSus(f.versao) !== e.versao) throw recusa('versao-alterada');
        if (f.situacao !== 'ativa') throw recusa('faixa-inativa');
        await g.mudarFaixaAih({
          id: f.id,
          versao: f.versao,
          situacao: 'cancelada',
          justificativa: e.justificativa,
          por: s.login,
        });
        id = f.id;
      }
      const f = (await this.faixasCom(g)).find((x) => x.id === id);
      if (!f) throw new ErroProblema('nao-encontrado', 404, 'Faixa não encontrada');
      await g.trilha(
        s.trilha(EVENTOS_AUDITAVEIS.faturamentoFaixaAihRegistrada.codigo, 'faturamento.registrarFaixaAih', {
          tabela: 'faixa_numeracao_aih',
          id: String(id),
          diferenca: `acao=${e.acao};inicial=${f.inicial};final=${f.final};situacao=${f.situacao}`,
        }),
      );
      return f;
    });
  }

  // ── AIH ──────────────────────────────────────────────────────────────────────────────────────────────

  /** `faturamento.registrarAih`: uma ação por chamada (laudo, autorizar, negar, fechar, reabrir, cancelar). */
  async registrar(s: SessaoSus, e: RegistrarAihEntrada): Promise<AihLida> {
    await this.exigirLiberado(s);
    this.exigirSus(s);
    const pAih = await this.parametrosAih(s);
    // O fechamento monta antes da transação (a leitura da produção é longa); a transação confere a versão.
    let fechamento: { itens: ItemAihParaGravar[]; m: AihMontada } | null = null;
    if (e.acao === 'fechar') fechamento = await this.prepararFechamento(s, e, pAih);
    const id = await this.gravar(s, async (g) => {
      if (e.acao === 'laudo') return this.laudo(s, g, e.laudo);
      const a = await g.aih(e.aih, true);
      if (!a) throw naoEncontrada();
      if (versaoSus(a.versao) !== e.versao) throw recusa('versao-alterada');
      if (!acaoPermitida(e.acao, a.situacao)) throw recusa('situacao-nao-permite', { situacao: a.situacao });
      let diferenca = `acao=${e.acao};registro=${a.registro}`;
      if (e.acao === 'autorizar') {
        const f = await g.faixaAih(e.faixa, true);
        if (!f || f.situacao !== 'ativa') throw recusa('faixa-inativa');
        const faixa = { inicio: BigInt(f.inicio), fim: BigInt(f.fim) };
        let numero = e.numero;
        if (numero) {
          if (!numeroNaFaixa(numero, faixa)) throw recusa('numero-fora-da-faixa');
          if (await g.numeroAihEmUso(numero)) throw recusa('numero-em-uso');
        } else {
          numero = proximoNumeroDaFaixa(faixa, await g.maiorNumeroDaFaixa(f.id));
          if (!numero) throw recusa('faixa-esgotada');
        }
        if (e.dataAutorizacao < a.dataLaudo) throw recusa('autorizacao-antes-do-laudo');
        await g.autorizarAih(a, {
          faixa: f.id,
          numero,
          autorizador: e.autorizador,
          dataAutorizacao: e.dataAutorizacao,
          por: s.login,
        });
        // O último número da faixa a esgota.
        if (baseAih(numero) === faixa.fim)
          await g.mudarFaixaAih({
            id: f.id,
            versao: f.versao,
            situacao: 'esgotada',
            justificativa: null,
            por: s.login,
          });
        diferenca += `;numero=${numero};faixa=${f.id}`;
      } else if (e.acao === 'negar') await g.negarAih(a, e.justificativa, s.login);
      else if (e.acao === 'reabrir') await g.reabrirAih(a, e.justificativa, s.login);
      else if (e.acao === 'cancelar') await g.cancelarAih(a, e.justificativa, s.login);
      else if (e.acao === 'fechar' && fechamento) {
        const r = fechamento.m.resultado;
        await g.fecharAih(a, {
          procedimentoRealizado: e.procedimentoRealizado ?? a.procedimentoSolicitado,
          permanencia: r.permanencia.dias ?? 0,
          diariasUti: r.diariasUti.total,
          diariasUtiAnterior: r.diariasUti.mesAnterior,
          itens: fechamento.itens,
          por: s.login,
        });
        const n = (t: string) => fechamento?.itens.filter((x) => x.tipo === t).length ?? 0;
        diferenca += `;permanencia=${r.permanencia.dias ?? ''};diariasUti=${r.diariasUti.total};secundarios=${n('secundario') + n('especial')};opm=${n('opm')}`;
      }
      await g.trilha(
        s.trilha(EVENTOS_AUDITAVEIS.faturamentoAihRegistrada.codigo, 'faturamento.registrarAih', {
          tabela: 'conta_aih',
          id: String(a.id),
          diferenca,
        }),
      );
      return a.id;
    });
    return this.porta.ler(this.ctx(s), async (l) => {
      const a = await l.aih(id);
      if (!a) throw naoEncontrada();
      return (await this.aihsLidas(l, s, [a]))[0] as AihLida;
    });
  }

  private async laudo(
    s: SessaoSus,
    g: GravacaoSus,
    laudo: Extract<RegistrarAihEntrada, { acao: 'laudo' }>['laudo'],
  ): Promise<number> {
    const i = await g.internacaoAih(laudo.registro, s.parametros.conveniosSus);
    if (!i) throw recusa('internacao-inexistente');
    if (!s.parametros.conveniosSus.includes(i.convenio)) throw recusa('internacao-nao-sus');
    if ((await g.aihsDasInternacoes([i.registro])).length > 0) throw recusa('aih-ja-registrada');
    if (!(await g.solicitanteAih(laudo.solicitante))) throw recusa('solicitante-inexistente');
    if (!(await g.sigtapPorCodigo(laudo.procedimentoSolicitado))) throw recusa('procedimento-inexistente');
    const id = await g.inserirAih({
      registro: i.registro,
      prontuario: i.prontuario,
      conta: i.conta,
      atendimento: i.atendimento,
      procedimentoSolicitado: laudo.procedimentoSolicitado,
      cidPrincipal: laudo.cidPrincipal,
      cidSecundario: laudo.cidSecundario,
      carater: laudo.carater,
      solicitante: laudo.solicitante.padStart(11, '0'),
      dataLaudo: laudo.dataLaudo,
      justificativa: laudo.justificativa,
      por: s.login,
    });
    await g.trilha(
      s.trilha(EVENTOS_AUDITAVEIS.faturamentoAihRegistrada.codigo, 'faturamento.registrarAih', {
        tabela: 'conta_aih',
        id: String(id),
        diferenca: `acao=laudo;registro=${i.registro};procedimento=${laudo.procedimentoSolicitado};cid=${laudo.cidPrincipal}`,
      }),
    );
    return id;
  }

  /** A montagem das AIHs dadas (a leitura da produção e a SIGTAP), com o realizado do fechamento. */
  private async montar(
    l: LeituraSus,
    s: SessaoSus,
    pAih: ParametrosAih,
    aihs: readonly AihRegistro[],
    realizado: ReadonlyMap<number, string> = new Map(),
  ): Promise<{ montadas: AihMontada[]; cnesCadastrados: readonly number[] }> {
    if (aihs.length === 0) return { montadas: [], cnesCadastrados: [] };
    const equivalencias = await l.equivalencias();
    const uti = [...utiPorAcomodacaoDoParametro(pAih.utiPorAcomodacao).values()].map((x) => x.procedimento);
    const codigos = [
      ...new Set([
        ...aihs.flatMap((a) => [a.procedimentoSolicitado, a.procedimentoRealizado ?? '']),
        ...realizado.values(),
        ...uti,
      ]),
    ].filter(Boolean);
    const dados = await l.dadosAih(
      aihs.map((a) => a.registro),
      codigos,
      equivalencias.map((x) => x.sigtap),
      s.parametros.conveniosSus,
    );
    return {
      montadas: montarAihs(dados, aihs, s.parametros, pAih, equivalencias, realizado),
      cnesCadastrados: dados.cnesCadastrados,
    };
  }

  private async prepararFechamento(
    s: SessaoSus,
    e: Extract<RegistrarAihEntrada, { acao: 'fechar' }>,
    pAih: ParametrosAih,
  ): Promise<{ itens: ItemAihParaGravar[]; m: AihMontada }> {
    return this.porta.ler(this.ctx(s), async (l) => {
      const a = await l.aih(e.aih);
      if (!a) throw naoEncontrada();
      if (!acaoPermitida('fechar', a.situacao))
        throw recusa('situacao-nao-permite', { situacao: a.situacao });
      const realizado = new Map<number, string>();
      if (e.procedimentoRealizado) realizado.set(a.id, e.procedimentoRealizado);
      const { montadas } = await this.montar(l, s, pAih, [a], realizado);
      const m = montadas[0] as AihMontada;
      const bloqueantes = m.resultado.criticas.filter((c) => c.gravidade === 'bloqueante');
      if (bloqueantes.length > 0)
        throw recusa('aih-com-bloqueante', {
          regras: [...new Set(bloqueantes.map((c) => c.regra))].sort().join(','),
        });
      const opm = new Map(e.opm.map((x) => [x.item, x]));
      const semDados = m.resultado.linhas.filter(
        (x) => x.tipo === 'opm' && (x.item === null || !opm.has(x.item)),
      );
      if (semDados.length > 0)
        throw recusa('opm-sem-dados', { itens: semDados.map((x) => x.item ?? 0).join(',') });
      const itens: ItemAihParaGravar[] = m.resultado.linhas.map((x) => {
        const o = x.tipo === 'opm' && x.item !== null ? opm.get(x.item) : undefined;
        return {
          tipo: x.tipo,
          procedimento: x.procedimento,
          sigtap: x.sigtap,
          quantidade: x.quantidade,
          cbo: x.cbo,
          item: x.item,
          tipoUti: x.tipoUti,
          opm: o
            ? {
                cnpjFornecedor: o.cnpjFornecedor,
                notaFiscal: o.notaFiscal,
                registroAnvisa: o.registroAnvisa,
                serie: o.serie,
                lote: o.lote,
              }
            : null,
        };
      });
      return { itens, m };
    });
  }

  /** O espelho da AIH: a montagem de agora (ou o fechamento gravado), os valores da SIGTAP, as críticas e o retorno. */
  async espelho(s: SessaoSus, id: number): Promise<EspelhoAih> {
    this.exigirSus(s);
    const pAih = await this.parametrosAih(s);
    return this.porta.ler(this.ctx(s), async (l) => {
      const a = await l.aih(id);
      if (!a) throw naoEncontrada();
      const { montadas } = await this.montar(l, s, pAih, [a]);
      const m = montadas[0] as AihMontada;
      const gravado = a.fechamento > 0 && !['solicitada', 'autorizada', 'negada'].includes(a.situacao);
      const linhas = gravado
        ? (await l.itensAih(a.id, a.fechamento)).map((x) => ({ ...x }))
        : m.resultado.linhas.map((x) => ({ ...x, opm: null }));
      const ids = [...new Set(linhas.map((x) => x.sigtap).filter((x): x is number => x !== null))];
      const valores = await l.valoresSigtap(ids);
      const nomes = new Map<string, string | null>();
      for (const c of new Set(linhas.map((x) => x.procedimento)))
        nomes.set(c, (await l.sigtapPorCodigo(c))?.nome ?? null);
      const competencia = m.resultado.competencia;
      const linhasEspelho: LinhaEspelhoAih[] = linhas.map((x) => {
        const v =
          x.sigtap !== null && competencia
            ? valorNaCompetencia(
                valores.filter((y) => y.id === x.sigtap),
                competencia,
              )
            : null;
        const sh = centavos((v?.servicoHospitalar ?? 0) * x.quantidade);
        const sp = centavos((v?.servicoProfissional ?? 0) * x.quantidade);
        return {
          tipo: x.tipo,
          procedimento: x.procedimento,
          nome: nomes.get(x.procedimento) ?? null,
          quantidade: x.quantidade,
          cbo: x.cbo,
          item: x.item,
          tipoUti: x.tipoUti,
          valorServicoHospitalar: sh,
          valorServicoProfissional: sp,
          valorTotal: centavos(sh + sp),
          opm: x.opm,
        };
      });
      const retorno = await l.ultimoRetornoDaAih(a.id);
      return {
        aih: (await this.aihsLidas(l, s, [a]))[0] as AihLida,
        origem: gravado ? 'fechamento' : 'montagem',
        competencia,
        linhas: linhasEspelho,
        permanencia: m.resultado.permanencia,
        diariasUti: m.resultado.diariasUti,
        itensForaDaAih: m.resultado.itensForaDaAih,
        itensSemSigtap: m.resultado.itensSemSigtap,
        valorTotal: centavos(linhasEspelho.reduce((t, x) => t + x.valorTotal, 0)),
        criticas: m.resultado.criticas.map((c) => ({
          regra: c.regra,
          gravidade: c.gravidade,
          detalhe: c.detalhe,
        })),
        lotesSaida: await l.lotesSaida(a.registro),
        retorno: retorno
          ? {
              situacao: retorno.situacao,
              motivo: retorno.motivo,
              valorAprovado: retorno.valorAprovado,
              tratamento: retorno.tratamento,
            }
          : null,
      };
    });
  }

  // ── Competência e SISAIH01 ──────────────────────────────────────────────────────────────────────────

  private async montarCompetencia(s: SessaoSus, competencia: CompetenciaSus) {
    const pAih = await this.parametrosAih(s);
    return this.porta.ler(this.ctx(s), async (l) => {
      const comp = await l.competencia('aih', competencia);
      if (!comp)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Competência não encontrada',
          'Abra a competência antes.',
        );
      const intervalo = intervaloDaCompetencia(competencia);
      const internacoes = await l.internacoesSus(intervalo, s.parametros.conveniosSus);
      const vivas = await l.aihsDasInternacoes(internacoes.map((x) => x.registro));
      const candidatas = await l.aihsParaApresentar(competencia);
      const { montadas, cnesCadastrados } = await this.montar(l, s, pAih, candidatas);
      const apresentaveis = montadas.filter(
        (m) =>
          (m.aih.situacao === 'apresentada' && m.aih.competenciaApresentacao === competencia) ||
          aihApresentavel({ situacao: m.aih.situacao, alta: m.internacao?.alta ?? null }, competencia),
      );
      const cadastrados = cnesCadastrados.length
        ? cnesCadastrados
        : (await l.dadosAih([], [], [], s.parametros.conveniosSus)).cnesCadastrados;
      return {
        comp,
        m: criticaAihDaCompetencia(
          competencia,
          internacoes,
          vivas,
          apresentaveis,
          s.parametros,
          pAih,
          cadastrados,
        ),
        pAih,
      };
    });
  }

  /**
   * `faturamento.gerarSisaih`: a competência AIH aberta, criticada, sem bloqueante e na versão que a tela leu; as AIHs
   * fechadas (e as já apresentadas nela) com alta até o fim dela. O conteúdo vai ao armazenamento com retenção (tem dado
   * pessoal) e o banco guarda o hash e as AIHs apresentadas.
   */
  async gerarSisaih(s: SessaoSus, e: GerarSisaihEntrada): Promise<ArquivoSusGerado> {
    await this.exigirLiberado(s);
    this.exigirEscopoTotal(s);
    const t0 = Date.now();
    const { comp, m, pAih } = await this.montarCompetencia(s, e.competencia);
    if (comp.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
    if (comp.criticadaEm === null) throw recusa('critica-nao-executada');
    if (versaoSus(comp.versao) !== e.versao) throw recusa('versao-alterada');
    if (m.todas.some((c) => c.gravidade === 'bloqueante') || m.cnes === null)
      throw recusa('criticas-bloqueantes-abertas');
    if (m.apresentaveis.length === 0) throw recusa('aih-sem-producao');
    const paraArquivo = await this.porta.ler(this.ctx(s), async (l) => {
      const out = [];
      for (const x of m.apresentaveis) {
        const linhas = await l.itensAih(x.aih.id, x.aih.fechamento);
        const sol = await l.solicitanteAih(x.aih.solicitante);
        const doc = sol?.cns && cnsValido(sol.cns) ? sol.cns : x.aih.solicitante.padStart(11, '0');
        const a = aihParaArquivo(x, linhas, doc);
        if (a) out.push(a);
      }
      return out;
    });
    const arquivo = gerarArquivoSisaih(e.competencia, m.cnes, pAih.diretorClinicoCns, paraArquivo);
    const problemas = conferirEstrutura(LEIAUTE_SISAIH01, arquivo.conteudo);
    if (problemas.length > 0)
      throw new ErroProblema(
        'erro-interno',
        500,
        'Arquivo fora do leiaute',
        `O arquivo gerado tem ${problemas.length} erro(s) de estrutura: nada foi gravado.`,
      );
    const bytes = new TextEncoder().encode(arquivo.conteudo);
    const hash = sha256(bytes);
    const id = await this.gravar(s, (g) => g.proximoArquivo());
    const chave = `sus/${s.hospital}/aih/${e.competencia}/${id}-${hash.slice(0, 16)}.txt`;
    const tempoMs = Date.now() - t0;
    let guardado: { versao: string | null } | null = null;
    let gerado: ArquivoSusGerado;
    try {
      gerado = await this.gravar(s, async (g) => {
        const c = await g.competencia('aih', e.competencia, true);
        if (!c) throw recusa('competencia-nao-aberta');
        if (c.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
        if (versaoSus(c.versao) !== e.versao) throw recusa('versao-alterada');
        guardado = await this.armazem.guardar(chave, bytes);
        await g.gravarCriticas(c, m.criticas, { registros: m.registros, cnes: m.cnes });
        const { substituidos } = await g.gravarArquivoSisaih(
          {
            id,
            competencia: { id: c.id, instrumento: 'aih', competencia: c.competencia },
            leiaute: arquivo.leiaute,
            versaoLeiaute: arquivo.versaoLeiaute,
            conferidoOficial: arquivo.conferidoContraOficial,
            nome: arquivo.nomeArquivo,
            linhas: arquivo.linhas,
            registros: arquivo.registros,
            procedimentos: arquivo.procedimentos,
            semMovimento: false,
            hash,
            bytes: bytes.byteLength,
            chaveObjeto: chave,
            versaoObjeto: (guardado as { versao: string | null }).versao,
            por: s.login,
          },
          m.apresentaveis.map((x) => ({ id: x.aih.id, versao: x.aih.versao })),
        );
        await g.trilha(
          s.trilha(EVENTOS_AUDITAVEIS.faturamentoSisaihGerado.codigo, 'faturamento.gerarSisaih', {
            tabela: 'arquivo',
            id: String(id),
            diferenca: `competencia=${c.competencia};aihs=${arquivo.registros};procedimentos=${arquivo.procedimentos};controle=${arquivo.controle};sha256=${hash}`,
          }),
        );
        const lido = await g.arquivo(id);
        const depois = await g.competencia('aih', e.competencia);
        if (!lido || !depois) throw new ErroProblema('nao-encontrado', 404, 'Arquivo não encontrado');
        return {
          arquivo: this.sus.arquivoLido(lido),
          competencia: this.sus.resumo(depois, true),
          substituidos,
          tempoMs,
        };
      });
    } catch (erro) {
      const g = guardado as { versao: string | null } | null;
      if (g)
        await this.armazem
          .remover(chave, g.versao)
          .catch(() =>
            this.avisar(`faturamento.gerarSisaih: o objeto do arquivo ${id} não foi removido após a recusa`),
          );
      throw erro;
    }
    const final = guardado as { versao: string | null } | null;
    await this.armazem
      .fixar(chave, final?.versao ?? null)
      .catch(() =>
        this.avisar(
          `faturamento.gerarSisaih: a guarda definitiva do arquivo ${id} não foi fixada após o COMMIT`,
        ),
      );
    return gerado;
  }

  // ── Retorno do gestor ────────────────────────────────────────────────────────────────────────────────

  async listarRetornos(s: SessaoSus, f: FiltroRetornosSus): Promise<PaginaRetornosSus> {
    this.exigirSus(s);
    const r = await this.porta.ler(this.ctx(s), (l) =>
      l.paginaRetornos({
        ...(f.instrumento ? { instrumento: f.instrumento } : {}),
        ...(f.competencia ? { competencia: f.competencia } : {}),
        ...(f.situacao ? { situacao: f.situacao } : {}),
        ...(f.tratamento ? { tratamento: f.tratamento } : {}),
        pagina: f.pagina,
        porPagina: f.porPagina,
      }),
    );
    return {
      itens: r.itens.map((x) => this.retornoLido(x)),
      total: r.total,
      porSituacao: r.porSituacao,
      valorGlosado: r.valorGlosado,
    };
  }

  /**
   * `faturamento.importarRetornoSus`: o espelho do SIH ou o relatório do SIA (CSV, D-RETORNO-51). Cada linha casa com a
   * AIH apresentada (pelo número) ou com a linha do BPA do arquivo vigente (tipo, folha e sequência); a que não casa fica
   * fora, listada. A AIH fica aprovada ou rejeitada; a linha rejeitada ou glosada fica pendente da decisão.
   */
  async importarRetorno(s: SessaoSus, e: ImportarRetornoSusEntrada): Promise<ResultadoRetornoSus> {
    await this.exigirLiberado(s, e.instrumento);
    this.exigirEscopoTotal(s);
    const leitura = lerRetornoSus(e.conteudo, e.instrumento, e.competencia);
    if (leitura.linhas.length === 0) throw recusa('retorno-sem-linhas', { erros: leitura.erros.length });
    if (leitura.linhas.length > 20_000) throw recusa('retorno-sem-linhas', { linhas: leitura.linhas.length });
    const hash = sha256(e.conteudo);
    return this.gravar(s, async (g) => {
      const naoCasadas: { linha: number; identificacao: string }[] = [];
      const gravadas: (typeof leitura.linhas)[number][] = [];
      let repetidas = 0;
      for (const x of leitura.linhas) {
        let aih: number | null = null;
        let linhaBpa: number | null = null;
        let arquivo: number | null = null;
        if (e.instrumento === 'aih') {
          const a = await g.aihPorNumero(x.identificacao);
          if (!a || !['apresentada', 'aprovada', 'rejeitada'].includes(a.situacao)) {
            naoCasadas.push({ linha: x.linha, identificacao: x.identificacao });
            continue;
          }
          aih = a.id;
          arquivo = a.arquivo;
        } else if (x.bpa) {
          const b = await g.linhaBpaDaCompetencia(e.competencia, x.bpa);
          if (!b || (x.procedimento && x.procedimento !== b.procedimento)) {
            naoCasadas.push({ linha: x.linha, identificacao: x.identificacao });
            continue;
          }
          linhaBpa = b.linha;
          arquivo = b.arquivo;
        }
        const novo = await g.inserirRetornoSus({
          instrumento: e.instrumento,
          competencia: e.competencia,
          identificacao: x.identificacao,
          procedimento: x.procedimento,
          aih,
          linhaBpa,
          arquivo,
          situacao: x.situacao,
          motivo: x.motivo,
          valorApresentado: x.valorApresentado,
          valorAprovado: x.valorAprovado,
          valorGlosado: x.valorGlosado,
          arquivoRetorno: e.nomeArquivo,
          hashRetorno: hash,
          por: s.login,
        });
        if (novo === null) {
          repetidas += 1;
          continue;
        }
        if (aih !== null)
          await g.aplicarRetornoNaAih(aih, x.situacao === 'rejeitada' ? 'rejeitada' : 'aprovada', s.login);
        gravadas.push(x);
      }
      const r = resumoRetornoSus(gravadas);
      await g.trilha(
        s.trilha(EVENTOS_AUDITAVEIS.faturamentoRetornoSusImportado.codigo, 'faturamento.importarRetornoSus', {
          tabela: 'retorno_sus',
          id: null,
          diferenca:
            `instrumento=${e.instrumento};competencia=${e.competencia};linhas=${leitura.linhas.length};casadas=${gravadas.length};naoCasadas=${naoCasadas.length};repetidas=${repetidas};erros=${leitura.erros.length};glosado=${r.valorGlosado};sha256=${hash}`.slice(
              0,
              1000,
            ),
        }),
      );
      return {
        instrumento: e.instrumento,
        competencia: e.competencia,
        hash,
        linhas: leitura.linhas.length + leitura.erros.length,
        casadas: gravadas.length,
        naoCasadas: naoCasadas.slice(0, 200),
        erros: leitura.erros.slice(0, 200).map((x) => ({ linha: x.linha, problema: x.problema })),
        porSituacao: r.porSituacao,
        valorGlosado: r.valorGlosado,
        repetidas,
      };
    });
  }

  /** A decisão sobre a linha rejeitada ou glosada: reapresentar (a AIH rejeitada volta a fechada) ou aceitar a glosa. */
  async tratarRetorno(s: SessaoSus, e: TratarRetornoSusEntrada): Promise<RetornoSusLido> {
    this.exigirEscopoTotal(s);
    return this.gravar(s, async (g) => {
      const r = await g.retornoSus(e.retorno, true);
      if (!r) throw new ErroProblema('nao-encontrado', 404, 'Retorno não encontrado');
      if (!(await s.liberado(r.instrumento))) throw recusa('instrumento-desligado');
      if (versaoSus(r.versao) !== e.versao) throw recusa('versao-alterada');
      if (r.tratamento !== 'pendente' || r.situacao === 'aprovada') throw recusa('retorno-sem-pendencia');
      if (e.decisao === 'reapresentar' && r.instrumento === 'aih' && r.situacao !== 'rejeitada')
        throw recusa('reapresentacao-so-rejeitada');
      await g.tratarRetornoSus(r, {
        decisao: e.decisao,
        justificativa: e.justificativa,
        por: s.login,
        aih: r.instrumento === 'aih' ? r.aih : null,
      });
      await g.trilha(
        s.trilha(EVENTOS_AUDITAVEIS.faturamentoRetornoSusTratado.codigo, 'faturamento.tratarRetornoSus', {
          tabela: 'retorno_sus',
          id: String(r.id),
          diferenca: `instrumento=${r.instrumento};competencia=${r.competencia};identificacao=${r.identificacao};decisao=${e.decisao};glosado=${r.valorGlosado}`,
        }),
      );
      const depois = await g.retornoSus(r.id);
      if (!depois) throw new ErroProblema('nao-encontrado', 404, 'Retorno não encontrado');
      return this.retornoLido(depois);
    });
  }
}
