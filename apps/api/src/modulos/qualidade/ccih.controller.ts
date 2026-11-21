// CCIH, etapa 3 do M48 (ficha, seções 4, 5, 7 e 8; regras 5, 6, 7 e 11; ADR 0031):
//   GET  /api/qualidade/ccih/formulario                 liberação, ações, unidades, tipos de surto, prazo da política
//   GET  /api/qualidade/ccih/vigilancia                 a fila da vigilância ativa (internados com algum motivo)
//   GET  /api/qualidade/ccih/internados              os internados (a escolha do paciente nos formulários)
//   GET  /api/qualidade/ccih/resumo                     o cartão "CCIH: pacientes em vigilância" da página inicial
//   GET  /api/qualidade/ccih/internacoes/:reg           o internado: dispositivos, IRAS, precauções, antimicrobianos,
//                                                       culturas, cirurgias, febre e os leitos vizinhos
//   POST /api/qualidade/ccih/dispositivos               qualidade.registrarDispositivo
//   POST /api/qualidade/ccih/dispositivos/:id/retirar   qualidade.retirarDispositivo (acidental sugere notificar)
//   GET  /api/qualidade/ccih/iras?competencia=          as fichas da competência
//   POST /api/qualidade/ccih/iras                       qualidade.registrarIras (critérios, janela, associação)
//   POST /api/qualidade/ccih/iras/:id/descartar         qualidade.registrarIras com o desfecho "descartada"
//   GET  /api/qualidade/ccih/denominadores?competencia= pacientes-dia, dispositivos-dia, densidade e utilização
//   GET  /api/qualidade/ccih/antimicrobianos            a fila dos restritos em uso (situação, prazo, revisão devida)
//   GET  /api/qualidade/ccih/antimicrobianos/consumo    DDD e DOT por 1.000 pacientes-dia da competência
//   GET  /api/qualidade/ccih/antimicrobianos/itens      os antimicrobianos do cadastro com a política e a DDD
//   POST /api/qualidade/ccih/antimicrobianos/itens      qualidade.configurarAntimicrobiano
//   POST /api/qualidade/ccih/antimicrobianos/liberar    qualidade.liberarAntimicrobiano
//   POST /api/qualidade/ccih/antimicrobianos/liberacoes/:id/revisar  qualidade.revisarAntimicrobiano
//   GET  /api/qualidade/ccih/antimicrobianos/alertas/:reg o alerta ao prescritor (restrito sem liberação no prazo)
//   GET  /api/qualidade/ccih/antimicrobianos/alertas?atendimento= o mesmo alerta pelo atendimento da prescrição
//   GET  /api/qualidade/ccih/precaucoes/do-paciente/:paciente as precauções abertas do internado (cabeçalho do prontuário)
//   GET  /api/qualidade/ccih/precaucoes                 as precauções abertas (o painel do isolamento)
//   POST /api/qualidade/ccih/precaucoes                 qualidade.definirPrecaucao (reflete no mapa do M21)
//   POST /api/qualidade/ccih/precaucoes/:id/encerrar    qualidade.definirPrecaucao com o encerramento
//   GET  /api/qualidade/ccih/maos?competencia=          adesão (5 momentos) e consumo de preparação alcoólica
//   POST /api/qualidade/ccih/maos/observacoes           qualidade.registrarObservacaoMaos
//   POST /api/qualidade/ccih/maos/consumo               qualidade.registrarObservacaoMaos (consumo do setor)
//   GET  /api/qualidade/ccih/surtos                     os surtos abertos e os recentes
//   POST /api/qualidade/ccih/surtos                     qualidade.registrarSurto
//   POST /api/qualidade/ccih/surtos/:id                 qualidade.registrarSurto (atualização e encerramento)
// Tudo pela chave `qualidade.ccih` (POL-3). Regra 11: a trilha leva só os IDs (a linha SGH_ e o paciente).
import { TABELA_DO_REGISTRO } from './tipos.js';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type TipoDispositivoInvasivo,
  esquemaRegistrarBundle,
  esquemaCorrigirBundle,
  esquemaAlterarPrecaucao,
  esquemaCancelarRegistroQualidade,
  esquemaCorrigirDispositivo,
  esquemaCorrigirIras,
  esquemaCorrigirObservacaoMaos,
  esquemaFecharCompetenciaCcih,
  PERMISSOES_QUALIDADE,
  type RegistroVersionadoQualidade,
  esquemaAtualizarSurto,
  esquemaCompetenciaCcih,
  esquemaConfigurarAntimicrobiano,
  esquemaDefinirPrecaucao,
  esquemaDescartarIras,
  esquemaEncerrarPrecaucao,
  esquemaFiltroCompetencia,
  esquemaLiberarAntimicrobiano,
  esquemaRegistrarConsumoAlcool,
  esquemaRegistrarDispositivo,
  esquemaRegistrarIras,
  esquemaRegistrarObservacaoMaos,
  esquemaRegistrarSurto,
  esquemaRetirarDispositivo,
  esquemaRevisarAntimicrobiano,
  EVENTOS_AUDITAVEIS,
  motivoMultirresistente,
  PERMISSOES_CCIH as P,
  type Precaucao,
} from '@sgh/contratos';
import {
  alertaPermanencia,
  associacoesDesfeitas,
  autoriaDaCorrecao,
  conferirBundle,
  dispositivosDiaDaAba,
  itensDoBundle,
  MENSAGENS_BUNDLE,
  turnoDe,
  competenciaDe,
  competenciasDoIntervalo,
  competenciasFechadasTocadas,
  conferirCorrecaoDispositivo,
  conferirCorrecaoObservacao,
  dispositivosDoDenominador,
  MENSAGENS_CORRECAO_CCIH,
  podeFecharCompetencia,
  type RecusaCorrecaoCcih,
  adesaoHigieneMaos,
  bloqueioDoVizinho,
  bloqueiosALiberar,
  conferirCriterios,
  conferirDataInfeccao,
  conferirInsercao,
  conferirJanelaIsc,
  conferirObservacao,
  conferirPrecaucao,
  conferirRetirada,
  conferirRevisao,
  conferirSurto,
  consumoAlcoolPorPacienteDia,
  contarObservacao,
  diasDaCompetencia,
  diasDeUso,
  dispositivosSemRetiradaAposAlta,
  limitarPelaAlta,
  limitesDaCompetencia,
  MENSAGENS_RECUSA_CCIH,
  precaucaoDoLeito,
  prazoDaPolitica,
  type RecusaCcih,
  reconciliarPrecaucoes,
  separarBloqueiosCompartilhados,
  somarDias,
  sugereNotificacao,
  tiposVigentesNoLeito,
  vizinhosParaBloquear,
} from '@sgh/dominio-qualidade';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import type { InternadoCcih } from './tipos.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { AcessoPacientePep, chaveSessaoPep, type RecursoPep } from '../pep/acesso-paciente.js';
import { ESTADO_PRONTUARIO } from '../pep/prontuario.controller.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { type GravadorCcih, PORTA_CCIH, type PortaCcih } from './porta-ccih.js';
import {
  associarIras,
  emUso,
  filaAntimicrobianos,
  inicioDoTratamento,
  montarConsumo,
  montarDenominadores,
  montarVigilancia,
  textoLeito,
} from './servico-ccih.js';

/** A chave da funcionalidade (recursos de liberação do M08; ficha, seção 12). */
export const CHAVE_QUALIDADE_CCIH = 'qualidade.ccih';
export const PARAMETRO_PRAZO_LIBERACAO = 'qualidade.prazoLiberacaoAntimicrobianoHoras';
const E = EVENTOS_AUDITAVEIS;
/** A vigilância olha os antimicrobianos com vigência nos últimos 14 dias (o d7 cabe com folga). */
const JANELA_ANTIMICROBIANO_DIAS = 14;

const recusaCcih = (motivo: RecusaCcih, status = 409) =>
  new ErroProblema(
    status === 422 ? 'entrada-invalida' : 'recusa-de-negocio',
    status,
    'CCIH',
    MENSAGENS_RECUSA_CCIH[motivo],
    { codigo: motivo, bloqueios: [motivo] },
  );
/** W0-04: a recusa da correção (409) com o código e o texto; `extras` leva a oferta e a lista dos dependentes. */
const recusaCorrecao = (motivo: RecusaCorrecaoCcih, avisos: readonly string[] = [], status = 409) =>
  new ErroProblema(
    'recusa-de-negocio',
    status,
    'CCIH',
    [MENSAGENS_CORRECAO_CCIH[motivo], ...avisos].join(' '),
    { codigo: motivo, bloqueios: [motivo], ...(avisos.length ? { avisos } : {}) },
  );
/** Quantos e quais (D-CRUD-ORFAOS): "Fichas de IRAS confirmadas (1): nº 3." */
const avisosDependentes = (ds: readonly { grupo: string; quantidade: number; ids: readonly number[] }[]) =>
  ds.map((d) => `${d.grupo} (${String(d.quantidade)}): nº ${d.ids.join(', nº ')}.`);
const PQ = PERMISSOES_QUALIDADE;
const naoEncontrado = (o = 'Registro') => new ErroProblema('nao-encontrado', 404, `${o} não encontrado`);
const anoMes = (c: string) => c.split('-').map(Number) as [number, number];

@Controller('qualidade/ccih')
export class CcihController {
  private readonly apoio: ApoioGravacao<GravadorCcih>;
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(PORTA_CCIH) private readonly porta: PortaCcih,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    // As rotas que entram no prontuário e na prescrição (cabeçalho e alerta) seguem a restrição por vínculo do M23 e
    // registram a leitura, como as do PEP e da nutrição.
    @Optional()
    @Inject(ESTADO_PRONTUARIO)
    private readonly estado: EstadoProntuario = new EstadoProntuario(),
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional()
    @Inject(VINCULO_ASSISTENCIAL)
    vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_QUALIDADE_CCIH, nome: 'o controle de infecção (CCIH)', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private agora(s: SessaoCadastro): Promise<string> {
    return this.porta.relogio(s.porta);
  }

  /** O vínculo assistencial (restrição do M23) e a leitura na trilha do prontuário, como no PEP. */
  private async acessoAoPaciente(
    s: SessaoCadastro,
    paciente: number,
    permissao: string,
    recurso: RecursoPep,
  ): Promise<void> {
    await this.acesso.exigirVinculo(s, paciente, permissao, recurso);
    const chave = chaveSessaoPep(s);
    if (!this.estado.motivo(chave, paciente)) this.estado.registrarMotivo(chave, paciente, 'assistencia');
    await this.acesso.registrarLeitura(
      s,
      paciente,
      'registro',
      this.estado.motivo(chave, paciente) ?? 'assistencia',
      recurso,
    );
  }

  /** As precauções abertas com a situação diante da internação ao vivo (D-RECONC-48.3) e os internados. */
  private async precaucoesReconciliadas(s: SessaoCadastro) {
    const [abertas, ints] = await Promise.all([
      this.porta.precaucoesAbertas(s.porta),
      this.porta.internados(s.porta),
    ]);
    return { abertas: reconciliarPrecaucoes(abertas, ints.itens), ints };
  }

  private async prazoHoras(s: SessaoCadastro): Promise<number> {
    return prazoDaPolitica(await this.apoio.parametro(s, PARAMETRO_PRAZO_LIBERACAO).catch(() => 0));
  }

  private async internacaoAberta(s: SessaoCadastro, reg: number): Promise<InternadoCcih> {
    const i = await this.porta.internacao(s.porta, reg);
    if (!i) throw naoEncontrado('Internação');
    if (!i.aberta) throw recusaCcih('internacao-encerrada');
    return i;
  }

  private async unidadeExiste(s: SessaoCadastro, codigo: number): Promise<void> {
    const us = await this.porta.unidades(s.porta);
    if (!us.some((u) => u.codigo === codigo))
      throw new ErroProblema('entrada-invalida', 422, 'CCIH', 'Escolha uma unidade da lista.', {
        codigo: 'unidade-invalida',
        campos: ['unidade'],
      });
  }

  /** A fila do antimicrobiano dos internados (restritos; `todos` inclui os não restritos em uso). */
  private async fila(s: SessaoCadastro, regs: readonly number[], agora: string, todos = false) {
    const desde = `${somarDias(agora.slice(0, 10), -JANELA_ANTIMICROBIANO_DIAS)}T00:00:00`;
    const [pres, itens, prazo] = await Promise.all([
      this.porta.antimicrobianos(s.porta, regs, desde),
      this.porta.itensConfigurados(s.porta),
      this.prazoHoras(s),
    ]);
    const emUsoAgora = pres.itens.filter((p) => emUso(p, agora));
    const ids = emUsoAgora.map((p) => p.itemPrescricao);
    const [liberacoes, fichas] = await Promise.all([
      this.porta.liberacoesDos(s.porta, ids),
      this.porta.fichas(s.porta, ids),
    ]);
    return {
      prescritos: pres.itens,
      cortada: pres.cortada,
      prazo,
      fila: filaAntimicrobianos({
        prescritos: pres.itens,
        liberacoes,
        itens,
        fichas,
        agora,
        prazoHoras: prazo,
        incluirNaoRestritos: todos,
      }),
    };
  }

  private async vigilancia(s: SessaoCadastro) {
    const agora = await this.agora(s);
    const hoje = agora.slice(0, 10);
    const ints = await this.porta.internados(s.porta);
    const regs = ints.itens.map((i) => i.reg);
    const pacientes = ints.itens.map((i) => i.paciente).filter((p): p is number => p !== null);
    const [disp, f, culturas, cirurgias, temperaturas, precaucoes, iras] = await Promise.all([
      this.porta.dispositivosDas(s.porta, regs).then(dispositivosDoDenominador),
      this.fila(s, regs, agora, true),
      this.porta.culturas(s.porta, regs, somarDias(hoje, -7)),
      this.porta.cirurgias(s.porta, regs, somarDias(hoje, -30)),
      this.porta.temperaturas(s.porta, pacientes, `${somarDias(hoje, -2)}T00:00:00`),
      // A precaução segue o paciente transferido (motivo da vigilância); a de internação encerrada fica fora.
      this.porta.precaucoesAbertas(s.porta).then((ps) => ps.filter((p) => regs.includes(p.reg))),
      this.porta.irasDas(s.porta, regs),
    ]);
    const itens = montarVigilancia({
      internados: ints.itens,
      dispositivos: disp,
      fila: f.fila,
      prescritos: f.prescritos,
      culturas,
      cirurgias,
      temperaturas,
      precaucoes,
      iras,
      agora,
    });
    return { agora, itens, cortada: ints.cortada || f.cortada, internados: ints.itens.length };
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────

  @Get('formulario')
  @Permissao(P.ccihLer)
  async formulario(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [l, unidades, tiposSurto, agora, prazo] = await Promise.all([
      this.apoio.liberacao(s),
      this.porta.unidades(s.porta),
      this.porta.tiposSurto(s.porta),
      this.agora(s),
      this.prazoHoras(s),
    ]);
    return {
      ligada: l.ligada,
      motivo: l.motivo,
      agora,
      prazoLiberacaoHoras: prazo,
      unidades,
      tiposSurto,
      acoes: {
        registrar: l.ligada && s.pode(P.ccihRegistrar),
        iras: l.ligada && s.pode(P.irasRegistrar),
        liberar: l.ligada && s.pode(P.antimicrobianoLiberar),
        precaucao: l.ligada && s.pode(P.precaucaoDefinir),
      },
    };
  }

  @Get('vigilancia')
  @Permissao(P.ccihLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  async listaVigilancia(@Req() req: RequisicaoAutorizada) {
    const v = await this.vigilancia(sessaoDe(req));
    return {
      agora: v.agora,
      itens: v.itens,
      cortada: v.cortada,
      resumo: {
        internados: v.internados,
        emVigilancia: v.itens.length,
        semLiberacao: v.itens.filter((i) => i.motivos.includes('antimicrobianoSemLiberacao')).length,
        febre: v.itens.filter((i) => i.febre).length,
        dispositivos: v.itens.reduce((n, i) => n + i.dispositivos.length, 0),
      },
    };
  }

  /** Os internados do estabelecimento (a escolha do paciente na ficha de IRAS e na precaução), na ordem do leito. */
  @Get('internados')
  @Permissao(P.ccihLer)
  async internados(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const ints = await this.porta.internados(s.porta);
    return {
      itens: ints.itens
        .map((i) => ({
          internacao: i.reg,
          nome: i.nome,
          prontuario: i.pront,
          setor: i.bloco,
          leito: textoLeito(i),
          entrada: i.entrada,
        }))
        .sort((a, b) => a.leito.localeCompare(b.leito)),
      cortada: ints.cortada,
    };
  }

  /** O cartão da página inicial: só contagens (sem nome de paciente). */
  @Get('resumo')
  @Permissao(P.ccihLer)
  async resumo(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const l = await this.apoio.liberacao(s);
    if (!l.ligada) return { ligada: false, emVigilancia: 0, semLiberacao: 0 };
    const v = await this.vigilancia(s);
    return {
      ligada: true,
      emVigilancia: v.itens.length,
      semLiberacao: v.itens.filter((i) => i.motivos.includes('antimicrobianoSemLiberacao')).length,
    };
  }

  @Get('internacoes/:reg')
  @Permissao(P.ccihLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  async internacao(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const r = idDaRota(reg);
    const i = await this.porta.internacao(s.porta, r);
    if (!i) throw naoEncontrado('Internação');
    const agora = await this.agora(s);
    const hoje = agora.slice(0, 10);
    const leito = { bloco: i.bloco, acomodacao: i.acomodacao, leito: i.leito };
    const [disp, iras, precaucoes, f, culturas, cirurgias, temperaturas, vizinhos] = await Promise.all([
      this.porta.dispositivosDas(s.porta, [r]),
      this.porta.irasDas(s.porta, [r]),
      this.porta.precaucoesDa(s.porta, r),
      this.fila(s, [r], agora, true),
      this.porta.culturas(s.porta, [r], somarDias(hoje, -30)),
      this.porta.cirurgias(s.porta, [r], somarDias(hoje, -90)),
      i.paciente === null
        ? Promise.resolve([])
        : this.porta.temperaturas(s.porta, [i.paciente], `${somarDias(hoje, -2)}T00:00:00`),
      i.aberta && i.leito ? this.porta.vizinhos(s.porta, leito) : Promise.resolve([]),
    ]);
    return {
      agora,
      internacao: {
        internacao: i.reg,
        paciente: i.paciente,
        nome: i.nome,
        prontuario: i.pront,
        setor: i.bloco,
        leito: textoLeito(i),
        chaveLeito: leito,
        entrada: i.entrada,
        aberta: i.aberta,
      },
      dispositivos: disp.map((d) => ({ ...d, dias: diasDeUso(d, agora) })),
      iras,
      precaucoes,
      antimicrobianos: f.fila,
      culturas,
      cirurgias,
      temperaturaMaxima48h: temperaturas.reduce<number | null>(
        (m, t) => (m === null || t.valor > m ? t.valor : m),
        null,
      ),
      vizinhos,
    };
  }

  @Get('iras')
  @Permissao(P.irasLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  async listaIras(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetencia, q);
    const { de, ate } = limitesDaCompetencia(f.competencia);
    const r = await this.porta.irasNoPeriodo(s.porta, de, ate);
    return {
      competencia: f.competencia,
      itens: r.itens.filter((i) => !f.setor || i.setor === f.setor),
      cortada: r.cortada,
    };
  }

  @Get('denominadores')
  @Permissao(P.irasLer)
  async denominadores(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetencia, q);
    const { de, ate } = limitesDaCompetencia(f.competencia);
    const [agora, censo, disp, iras] = await Promise.all([
      this.agora(s),
      this.porta.censo(s.porta, de, ate),
      this.porta.dispositivosNoPeriodo(s.porta, de, ate),
      this.porta.irasNoPeriodo(s.porta, de, ate),
    ]);
    // D-ALTA-DISP-48.3: a alta feita no outro sistema encerra a contagem do dispositivo sem retirada registrada.
    const abertos = disp.itens.filter((d) => d.retiradoEm === null);
    const altas = new Map(
      abertos.length
        ? (
            await this.porta.altasDas(
              s.porta,
              abertos.map((d) => d.reg),
            )
          ).map((a) => [a.reg, a.alta])
        : [],
    );
    const semRetirada = dispositivosSemRetiradaAposAlta(abertos, altas);
    const m = montarDenominadores({
      competencia: f.competencia,
      agora,
      censo: censo.porSetor,
      dispositivos: disp.itens.map((d) => limitarPelaAlta(d, altas.get(d.reg) ?? null)),
      iras: iras.itens.filter((i) => i.dataInfeccao >= de && i.dataInfeccao <= ate),
      ...(f.setor ? { setor: f.setor } : {}),
    });
    const diasTerminados = diasDaCompetencia(f.competencia).filter((d) => d < agora.slice(0, 10)).length;
    return {
      competencia: f.competencia,
      ...m,
      censo: {
        diasFechados: censo.diasFechados,
        diasTerminados,
        completo: censo.diasFechados >= diasTerminados,
      },
      // A pendência da CCIH: registrar a retirada dos dispositivos de quem já recebeu alta.
      semRetirada: semRetirada
        .filter((d) => !f.setor || d.setor === f.setor)
        .map((d) => ({
          id: d.id,
          versao: d.versao,
          internacao: d.reg,
          tipo: d.tipo,
          setor: d.setor,
          inseridoEm: d.inseridoEm,
          alta: d.alta,
        })),
      cortada: disp.cortada || iras.cortada,
    };
  }

  @Get('antimicrobianos')
  @Permissao(P.antimicrobianoLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  async antimicrobianos(@Query('todos') todos: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const ints = await this.porta.internados(s.porta);
    const f = await this.fila(
      s,
      ints.itens.map((i) => i.reg),
      agora,
      todos === '1',
    );
    const porReg = new Map(ints.itens.map((i) => [i.reg, i]));
    return {
      agora,
      prazoLiberacaoHoras: f.prazo,
      itens: f.fila.map((x) => {
        const i = porReg.get(x.internacao);
        return { ...x, paciente: i?.nome ?? '', prontuario: i?.pront ?? null, leito: i ? textoLeito(i) : '' };
      }),
      cortada: f.cortada || ints.cortada,
    };
  }

  /**
   * Regra 7: as precauções abertas da internação do paciente, para o cabeçalho do prontuário (só o tipo, o motivo e se é
   * multirresistente; sem leito nem quem registrou). Fora de internação aberta, ou com a CCIH desligada, nada.
   */
  @Get('precaucoes/do-paciente/:paciente')
  @Permissao('pep.prontuario.ler')
  async precaucoesDoPaciente(@Param('paciente') paciente: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const id = idDaRota(paciente);
    const l = await this.apoio.liberacao(s);
    if (!l.ligada) return { itens: [] };
    const ints = await this.porta.internados(s.porta);
    const regs = new Set(ints.itens.filter((x) => x.paciente === id).map((x) => x.reg));
    if (!regs.size) return { itens: [] };
    await this.acessoAoPaciente(s, id, 'pep.prontuario.ler', 'pep.prontuario');
    const abertas = await this.porta.precaucoesAbertas(s.porta);
    return {
      itens: abertas
        .filter((p) => regs.has(p.reg))
        .map((p) => ({
          tipo: p.tipo,
          motivo: p.motivo,
          motivoOutro: p.motivoOutro,
          multirresistente: p.multirresistente,
        })),
    };
  }

  /**
   * O alerta pelo atendimento da tela da prescrição (o atendimento da internação aberta); fora de internação, nada.
   */
  @Get('antimicrobianos/alertas')
  @Permissao('pep.prescricao.ler')
  async alertasDoAtendimento(@Query('atendimento') atendimento: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const id = idDaRota(atendimento);
    const l = await this.apoio.liberacao(s);
    if (!l.ligada) return { itens: [] };
    const ints = await this.porta.internados(s.porta);
    const i = ints.itens.find((x) => x.atendimento === id);
    if (!i) return { itens: [] };
    if (i.paciente !== null)
      await this.acessoAoPaciente(s, i.paciente, 'pep.prescricao.ler', 'pep.prescricao');
    return this.alertasDa(s, i.reg);
  }

  /** O alerta ao prescritor (regra 6): os restritos sem liberação no prazo da internação; nunca suspende. */
  @Get('antimicrobianos/alertas/:reg')
  @Permissao('pep.prescricao.ler')
  async alertas(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const l = await this.apoio.liberacao(s);
    if (!l.ligada) return { itens: [] };
    const r = idDaRota(reg);
    const i = await this.porta.internacao(s.porta, r);
    if (!i) return { itens: [] };
    if (i.paciente !== null)
      await this.acessoAoPaciente(s, i.paciente, 'pep.prescricao.ler', 'pep.prescricao');
    return this.alertasDa(s, r);
  }

  private async alertasDa(s: SessaoCadastro, reg: number) {
    const agora = await this.agora(s);
    const f = await this.fila(s, [reg], agora);
    return {
      itens: f.fila
        .filter((x) => x.situacao.alerta || x.situacao.situacao === 'naoLiberado')
        .map((x) => ({
          itemPrescricao: x.itemPrescricao,
          nome: x.nome,
          situacao: x.situacao.situacao,
          venceEm: x.situacao.venceEm,
        })),
    };
  }

  @Get('antimicrobianos/consumo')
  @Permissao(P.antimicrobianoLer)
  async consumo(@Query('competencia') competencia: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const c = corpo(esquemaCompetenciaCcih, competencia);
    const { de, ate } = limitesDaCompetencia(c);
    const [ano, mes] = anoMes(c);
    const [dispensado, vig, itens, censo] = await Promise.all([
      this.porta.consumoDispensado(s.porta, ano, mes),
      this.porta.vigencias(s.porta, de, ate),
      this.porta.itensConfigurados(s.porta),
      this.porta.censo(s.porta, de, ate),
    ]);
    const pacientesDia = censo.porSetor.reduce((n, x) => n + x.pacientesDia, 0);
    return {
      competencia: c,
      pacientesDia,
      ...montarConsumo({ competencia: c, dispensado, vigencias: vig.itens, itens, pacientesDia }),
      cortada: vig.cortada,
    };
  }

  @Get('antimicrobianos/itens')
  @Permissao(P.antimicrobianoLer)
  async itens(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [cadastro, cfg] = await Promise.all([
      this.porta.itensAntimicrobianos(s.porta),
      this.porta.itensConfigurados(s.porta),
    ]);
    const m = new Map(cfg.map((c) => [c.item, c]));
    return {
      itens: cadastro.map((i) => {
        const c = m.get(i.item);
        return {
          item: i.item,
          nome: i.nome,
          restrito: c?.restrito ?? false,
          atc: c?.atc ?? null,
          dddGramas: c?.dddGramas ?? null,
          gramasPorUnidade: c?.gramasPorUnidade ?? null,
          configurado: c !== undefined,
        };
      }),
    };
  }

  @Get('precaucoes')
  @Permissao(P.precaucaoLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  async precaucoes(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { abertas, ints } = await this.precaucoesReconciliadas(s);
    const porReg = new Map(ints.itens.map((i) => [i.reg, i]));
    return {
      // A transferida e a de internação encerrada ficam no painel como pendência da CCIH (D-RECONC-48.3).
      itens: abertas.map((p) => ({
        ...p,
        paciente: porReg.get(p.reg)?.nome ?? '',
        prontuario: porReg.get(p.reg)?.pront ?? null,
        leitoTexto: textoLeito(p.leito),
        multirresistente: p.multirresistente,
        leitoAtual: p.situacao === 'transferida' ? textoLeito(porReg.get(p.reg) ?? p.leito) : null,
      })),
    };
  }

  @Get('maos')
  @Permissao(P.ccihLer)
  async maos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetencia, q);
    const { de, ate } = limitesDaCompetencia(f.competencia);
    const [obs, consumo, censo] = await Promise.all([
      this.porta.observacoesMaos(s.porta, de, ate),
      this.porta.consumoAlcool(s.porta, f.competencia),
      this.porta.censo(s.porta, de, ate),
    ]);
    const daqui = obs.itens.filter((o) => !f.setor || o.setor === f.setor);
    const adesao = adesaoHigieneMaos(
      daqui.map((o) => ({
        categoria: o.categoria as Parameters<typeof adesaoHigieneMaos>[0][number]['categoria'],
        oportunidades: o.detalhe as Parameters<typeof adesaoHigieneMaos>[0][number]['oportunidades'],
      })),
    );
    const pd = new Map(censo.porSetor.map((c) => [c.setor, c.pacientesDia]));
    return {
      competencia: f.competencia,
      observacoes: daqui.length,
      adesao,
      consumo: consumo
        .filter((c) => !f.setor || c.setor === f.setor)
        .map((c) => ({
          ...c,
          porPacienteDia: consumoAlcoolPorPacienteDia(
            c.mililitros,
            c.setor ? (pd.get(c.setor) ?? 0) : censo.porSetor.reduce((n, x) => n + x.pacientesDia, 0),
          ),
        })),
      cortada: obs.cortada,
    };
  }

  @Get('surtos')
  @Permissao(P.ccihLer)
  async surtos(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    return { itens: await this.porta.surtos(s.porta, somarDias(agora.slice(0, 10), -180)) };
  }

  // ── Dispositivos ─────────────────────────────────────────────────────────────────────────────

  @Post('dispositivos')
  @HttpCode(201)
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler(
    'qualidade.registrarDispositivo: dispositivo_invasivo_paciente com a trilha_auditoria na mesma transação',
  )
  async registrarDispositivo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.registrarDispositivoPor(sessaoDe(req), b, P.ccihRegistrar);
  }

  /** O registro do dispositivo pela CCIH ou pela aba do prontuário (W0-04, M1): o mesmo registro e as mesmas regras. */
  private async registrarDispositivoPor(s: SessaoCadastro, b: unknown, recurso: string, daAba = false) {
    const e = corpo(esquemaRegistrarDispositivo, b);
    const i = await this.internacaoAberta(s, e.internacao);
    if (daAba) await this.vinculoParaGravar(s, i.paciente, recurso);
    await this.apoio.exigirLiberacao(s);
    const responsavel = await this.responsavelDe(s, e.responsavel ?? null);
    const [agora, disp] = await Promise.all([this.agora(s), this.porta.dispositivosDas(s.porta, [i.reg])]);
    const problema = conferirInsercao({
      tipo: e.tipo,
      inseridoEm: e.inseridoEm,
      agora,
      entrada: i.entrada,
      ativos: dispositivosDoDenominador(disp)
        .filter((d) => d.retiradoEm === null)
        .map((d) => ({ tipo: d.tipo as typeof e.tipo })),
    });
    if (problema) throw recusaCcih(problema, problema === 'dispositivo-ja-ativo' ? 409 : 422);
    await this.exigirCompetenciasAbertas(s, competenciasDoIntervalo(e.inseridoEm, null, agora));
    const r = await this.apoio.sgh(
      s,
      E.qualidadeDispositivoRegistrado.codigo,
      recurso,
      (x: { id: number }) => ({ tabela: 'dispositivo_invasivo_paciente', id: String(x.id), paciente: i.paciente }),
      (g) =>
        g.registrarDispositivo({
          reg: i.reg,
          paciente: i.paciente,
          leito: { bloco: i.bloco, acomodacao: i.acomodacao || null, leito: i.leito || null },
          tipo: e.tipo,
          sitio: e.sitio,
          inseridoEm: e.inseridoEm,
          itemPrescricao: e.itemPrescricao,
          observacao: e.observacao,
          responsavel: responsavel ?? null,
          usuario: s.login,
        }),
    );
    return { id: r.id };
  }

  @Post('dispositivos/:id/retirar')
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler('qualidade.retirarDispositivo: dispositivo_invasivo_paciente (versão conferida) com a trilha_auditoria')
  async retirarDispositivo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.retirarDispositivoPor(sessaoDe(req), id, b, P.ccihRegistrar);
  }

  private async retirarDispositivoPor(
    s: SessaoCadastro,
    id: string,
    b: unknown,
    recurso: string,
    daAba = false,
  ) {
    const e = corpo(esquemaRetirarDispositivo, { ...(b as object), dispositivo: idDaRota(id) });
    const d = await this.porta.dispositivo(s.porta, e.dispositivo);
    if (!d) throw naoEncontrado('Dispositivo');
    if (daAba) await this.vinculoParaGravar(s, d.paciente, recurso);
    await this.apoio.exigirLiberacao(s);
    const problema = conferirRetirada({
      dispositivo: d,
      retiradoEm: e.retiradoEm,
      agora: await this.agora(s),
    });
    if (problema) throw recusaCcih(problema, problema === 'ja-retirado' ? 409 : 422);
    if (d.canceladoEm) throw recusaCorrecao('registro-cancelado');
    await this.exigirCompetenciasAbertas(s, [competenciaDe(e.retiradoEm)]);
    const r = await this.apoio.sgh(
      s,
      E.qualidadeDispositivoRetirado.codigo,
      recurso,
      { tabela: 'dispositivo_invasivo_paciente', id: String(d.id), paciente: d.paciente },
      (g) =>
        g.retirarDispositivo({
          id: d.id,
          versao: e.versao,
          retiradoEm: e.retiradoEm,
          motivo: e.motivo,
          observacao: e.observacao,
          agora: e.retiradoEm,
          usuario: s.login,
        }),
    );
    // Regra 4: a retirada acidental (extubação não planejada) sugere a notificação; quem decide é o usuário.
    return { versao: r.versao, sugerirNotificacao: sugereNotificacao(e.motivo) };
  }

  // ── IRAS ─────────────────────────────────────────────────────────────────────────────────────

  @Post('iras')
  @HttpCode(201)
  @Permissao(P.irasRegistrar)
  @AuditadoNoHandler('qualidade.registrarIras: caso_infeccao com a trilha_auditoria na mesma transação')
  async registrarIras(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarIras, b);
    await this.apoio.exigirLiberacao(s);
    const i = await this.porta.internacao(s.porta, e.internacao);
    if (!i) throw naoEncontrado('Internação');
    const agora = await this.agora(s);
    const data = conferirDataInfeccao(e.sitio, e.dataInfeccao, i.entrada, agora.slice(0, 10));
    if (data) throw recusaCcih(data, 422);
    const crit = conferirCriterios(e.sitio, e.criterios);
    if (crit) throw recusaCcih(crit, 422);
    if (e.cirurgia !== null) {
      const c = await this.porta.cirurgia(s.porta, e.cirurgia);
      if (!c || c.reg !== i.reg) throw recusaCcih('cirurgia-de-outra-internacao', 422);
      const janela = conferirJanelaIsc(c.data, e.dataInfeccao, e.implante);
      if (janela) throw recusaCcih(janela, 422);
    }
    if (e.exame !== null) {
      const x = await this.porta.exame(s.porta, e.exame);
      if (!x || x.reg !== i.reg) throw recusaCcih('exame-de-outra-internacao', 422);
    }
    await this.exigirCompetenciasAbertas(s, [competenciaDe(e.dataInfeccao)]);
    const dispositivo = associarIras(
      e.sitio,
      dispositivosDoDenominador(await this.porta.dispositivosDas(s.porta, [i.reg])),
      e.dataInfeccao,
    );
    const r = await this.apoio.sgh(
      s,
      E.qualidadeIrasRegistrada.codigo,
      P.irasRegistrar,
      (x: { id: number }) => ({ tabela: 'caso_infeccao', id: String(x.id), paciente: i.paciente }),
      (g) =>
        g.registrarIras({
          reg: i.reg,
          paciente: i.paciente,
          setor: i.bloco,
          sitio: e.sitio,
          dataInfeccao: e.dataInfeccao,
          criterios: e.criterios,
          nivelIsc: e.nivelIsc,
          cirurgia: e.cirurgia,
          implante: e.implante,
          exame: e.exame,
          microrganismo: e.microrganismo,
          multirresistente: e.multirresistente,
          dispositivo,
          descricao: e.descricao,
          usuario: s.login,
        }),
    );
    return { id: r.id, dispositivoAssociado: dispositivo };
  }

  @Post('iras/:id/descartar')
  @Permissao(P.irasRegistrar)
  @AuditadoNoHandler('qualidade.registrarIras (descarte): caso_infeccao com a versão conferida e a trilha_auditoria')
  async descartarIras(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDescartarIras, { ...(b as object), iras: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const x = await this.porta.iras(s.porta, e.iras);
    if (!x) throw naoEncontrado('Ficha de IRAS');
    if (x.situacao !== 'confirmada') throw recusaCcih('iras-descartada');
    await this.exigirCompetenciasAbertas(s, [competenciaDe(x.dataInfeccao)]);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeIrasDescartada.codigo,
      P.irasRegistrar,
      { tabela: 'caso_infeccao', id: String(x.id), paciente: x.paciente },
      (g) =>
        g.descartarIras({
          id: x.id,
          versao: e.versao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── Antimicrobianos ──────────────────────────────────────────────────────────────────────────

  @Post('antimicrobianos/itens')
  @Permissao(P.antimicrobianoLiberar)
  @AuditadoNoHandler(
    'qualidade.configurarAntimicrobiano: configuracao_antimicrobiano_insumo (uma por insumo) com a trilha_auditoria',
  )
  async configurar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaConfigurarAntimicrobiano, b);
    await this.apoio.exigirLiberacao(s);
    const item = await this.porta.itemDoCadastro(s.porta, e.item);
    if (!item?.antimicrobiano) throw recusaCcih('nao-e-antimicrobiano', 422);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeAntimicrobianoConfigurado.codigo,
      P.antimicrobianoLiberar,
      (x: { id: number }) => ({ tabela: 'configuracao_antimicrobiano_insumo', id: String(x.id) }),
      (g) => g.configurarAntimicrobiano({ ...e, agora, usuario: s.login }),
    );
  }

  @Post('antimicrobianos/liberar')
  @HttpCode(201)
  @Permissao(P.antimicrobianoLiberar)
  @AuditadoNoHandler(
    'qualidade.liberarAntimicrobiano: decisao_antimicrobiano (uma decisão por item) com a trilha_auditoria',
  )
  async liberar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaLiberarAntimicrobiano, b);
    await this.apoio.exigirLiberacao(s);
    const p = await this.porta.antimicrobianoPrescrito(s.porta, e.itemPrescricao);
    if (!p) throw naoEncontrado('Item da prescrição');
    const [itens, ja, agora, prazo, i] = await Promise.all([
      this.porta.itensConfigurados(s.porta),
      this.porta.liberacoesDos(s.porta, [p.itemPrescricao]),
      this.agora(s),
      this.prazoHoras(s),
      this.porta.internacao(s.porta, p.reg),
    ]);
    if (!itens.some((x) => x.item === p.item && x.restrito)) throw recusaCcih('nao-e-restrito');
    if (ja.length > 0) throw recusaCcih('ja-decidido');
    const [todos, fichas] = await Promise.all([
      this.porta.antimicrobianos(s.porta, [p.reg], null),
      this.porta.fichas(s.porta, [p.itemPrescricao]),
    ]);
    const situacao = filaAntimicrobianos({
      prescritos: [p],
      liberacoes: [],
      itens,
      fichas,
      agora,
      prazoHoras: prazo,
      incluirNaoRestritos: true,
    })[0]?.situacao;
    const r = await this.apoio.sgh(
      s,
      E.qualidadeAntimicrobianoLiberado.codigo,
      P.antimicrobianoLiberar,
      (x: { id: number }) => ({
        tabela: 'decisao_antimicrobiano',
        id: String(x.id),
        paciente: i?.paciente ?? null,
      }),
      (g) =>
        g.liberarAntimicrobiano({
          itemPrescricao: p.itemPrescricao,
          prescricao: p.prescricao,
          reg: p.reg,
          paciente: i?.paciente ?? null,
          item: p.item,
          ficha: fichas.get(p.itemPrescricao) ?? null,
          prescritoEm: p.prescritoEm,
          inicioTratamento: inicioDoTratamento(p, todos.itens),
          decisao: e.decisao,
          diasAutorizados: e.diasAutorizados,
          justificativa: e.justificativa,
          noPrazo: !(situacao?.alerta ?? false),
          agora,
          usuario: s.login,
        }),
    );
    return { id: r.id, noPrazo: !(situacao?.alerta ?? false) };
  }

  @Post('antimicrobianos/liberacoes/:id/revisar')
  @Permissao(P.antimicrobianoLiberar)
  @AuditadoNoHandler(
    'qualidade.revisarAntimicrobiano: decisao_antimicrobiano (versão conferida) e revisao_decisao_antimicrobiano com a trilha_auditoria',
  )
  async revisar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRevisarAntimicrobiano, { ...(b as object), liberacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const l = await this.porta.liberacao(s.porta, e.liberacao);
    if (!l) throw naoEncontrado('Liberação');
    if (l.decisao === 'naoLiberado') throw recusaCcih('sem-liberacao');
    const agora = await this.agora(s);
    const problema = conferirRevisao({
      marco: e.marco,
      inicio: l.inicioTratamento,
      agora,
      feitas: { d3: l.revisoes.d3 !== null, d7: l.revisoes.d7 !== null },
    });
    if (problema) throw recusaCcih(problema);
    return this.apoio.sgh(
      s,
      E.qualidadeAntimicrobianoRevisado.codigo,
      P.antimicrobianoLiberar,
      { tabela: 'decisao_antimicrobiano', id: String(l.id), paciente: l.paciente },
      (g) =>
        g.revisarAntimicrobiano({
          id: l.id,
          versao: e.versao,
          marco: e.marco,
          conduta: e.conduta,
          observacao: e.observacao,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── Precauções ───────────────────────────────────────────────────────────────────────────────

  @Post('precaucoes')
  @HttpCode(201)
  @Permissao(P.precaucaoDefinir)
  @AuditadoNoHandler(
    'qualidade.definirPrecaucao: isolamento_paciente e o estado do leito (leito) com a trilha_auditoria na mesma transação',
  )
  async definirPrecaucao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDefinirPrecaucao, b);
    await this.apoio.exigirLiberacao(s);
    const i = await this.internacaoAberta(s, e.internacao);
    const leito = { bloco: i.bloco, acomodacao: i.acomodacao, leito: i.leito };
    const temLeito = Boolean(i.bloco && i.acomodacao && i.leito);
    const [daInternacao, { abertas }, vizinhos, agora] = await Promise.all([
      this.porta.precaucoesDa(s.porta, i.reg),
      this.precaucoesReconciliadas(s),
      temLeito ? this.porta.vizinhos(s.porta, leito) : Promise.resolve([]),
      this.agora(s),
    ]);
    const problema = conferirPrecaucao({
      temLeito,
      motivo: e.motivo,
      tipo: e.tipo,
      motivosAbertos: daInternacao.filter((p) => p.fimEm === null).map((p) => p.motivo as typeof e.motivo),
      bloquearVizinhos: e.bloquearVizinhos,
      vizinhos,
    });
    if (problema) throw recusaCcih(problema);
    if (e.exame !== null) {
      const x = await this.porta.exame(s.porta, e.exame);
      if (!x || x.reg !== i.reg) throw recusaCcih('exame-de-outra-internacao', 422);
    }
    // Só as vigentes no leito (a órfã de quem saiu sem o Sante saber não pesa; D-RECONC-48.3).
    const noLeito = tiposVigentesNoLeito(
      abertas.map((p) => ({ ...p, tipo: p.tipo as Precaucao })),
      leito,
    );
    const tipoDoLeito = precaucaoDoLeito([...noLeito, e.tipo]) ?? e.tipo;
    const { bloquear: livres, ocupados } = e.bloquearVizinhos
      ? vizinhosParaBloquear(vizinhos)
      : { bloquear: [], ocupados: [] };
    // O vizinho já na lista de outra precaução aberta é compartilhado (o encerramento de uma não o solta).
    const { bloquear, compartilhar } = separarBloqueiosCompartilhados(livres, abertas);
    const chaveDe = ({
      bloco,
      acomodacao,
      leito: l,
    }: {
      bloco: string;
      acomodacao: string;
      leito: string;
    }) => ({
      bloco,
      acomodacao,
      leito: l,
    });
    const r = await this.apoio.sgh(
      s,
      E.qualidadePrecaucaoDefinida.codigo,
      P.precaucaoDefinir,
      (x: { id: number }) => ({ tabela: 'isolamento_paciente', id: String(x.id), paciente: i.paciente }),
      (g) =>
        g.definirPrecaucao({
          reg: i.reg,
          paciente: i.paciente,
          leito,
          motivo: e.motivo,
          motivoOutro: e.motivo === 'outro' ? e.motivoOutro : null,
          tipo: e.tipo,
          tipoDoLeito,
          origem: e.origem,
          exame: e.exame,
          multirresistente: motivoMultirresistente(e.motivo),
          bloquear: bloquear.map(chaveDe),
          compartilhar: compartilhar.map(chaveDe),
          observacao: e.observacao,
          agora,
          usuario: s.login,
        }),
    );
    return {
      id: r.id,
      leito: r.leito,
      tipoDoLeito,
      bloqueados: r.bloqueados,
      bloqueioVizinho: bloqueioDoVizinho(e.tipo, e.motivo, vizinhos.length),
      // Os vizinhos ocupados não são bloqueados: a CCIH e o NIR transferem (alerta na tela).
      vizinhosOcupados: ocupados.map((v) => textoLeito(v)),
    };
  }

  @Post('precaucoes/:id/encerrar')
  @Permissao(P.precaucaoDefinir)
  @AuditadoNoHandler(
    'qualidade.definirPrecaucao (encerramento): isolamento_paciente e o leito com a trilha_auditoria',
  )
  async encerrarPrecaucao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarPrecaucao, { ...(b as object), precaucao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const p = await this.porta.precaucao(s.porta, e.precaucao);
    if (!p) throw naoEncontrado('Precaução');
    if (p.fimEm !== null) throw recusaCcih('precaucao-encerrada');
    const [{ abertas }, agora] = await Promise.all([this.precaucoesReconciliadas(s), this.agora(s)]);
    // O leito passa à mais restritiva das vigentes nele (a do novo ocupante, se a encerrada era de quem já saiu) e
    // só se liberam os vizinhos que nenhuma outra precaução aberta ainda pede (D-RECONC-48.3, D-VIZINHO-48.3).
    const restantes = tiposVigentesNoLeito(
      abertas.map((x) => ({ ...x, tipo: x.tipo as Precaucao })),
      p.leito,
      p.id,
    );
    return this.apoio.sgh(
      s,
      E.qualidadePrecaucaoEncerrada.codigo,
      P.precaucaoDefinir,
      { tabela: 'isolamento_paciente', id: String(p.id), paciente: p.paciente },
      (g) =>
        g.encerrarPrecaucao({
          id: p.id,
          versao: e.versao,
          leito: p.leito,
          tipoDoLeito: precaucaoDoLeito(restantes),
          bloqueios: bloqueiosALiberar(p, abertas),
          motivo: e.motivo,
          observacao: e.observacao,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── Higiene das mãos e surtos ────────────────────────────────────────────────────────────────

  @Post('maos/observacoes')
  @HttpCode(201)
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler(
    'qualidade.registrarObservacaoMaos: observacao_higiene_maos com a trilha_auditoria (sem identificar o observado)',
  )
  async observacaoMaos(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarObservacaoMaos, b);
    await this.apoio.exigirLiberacao(s);
    await this.unidadeExiste(s, e.unidade);
    const problema = conferirObservacao(e.observadoEm, await this.agora(s));
    if (problema) throw recusaCcih(problema, 422);
    const { oportunidades, conformes } = contarObservacao(e);
    return this.apoio.sgh(
      s,
      E.qualidadeHigieneMaosRegistrada.codigo,
      P.ccihRegistrar,
      (x: { id: number }) => ({ tabela: 'observacao_higiene_maos', id: String(x.id) }),
      (g) =>
        g.registrarObservacaoMaos({
          unidade: e.unidade,
          setor: e.setor,
          observadoEm: e.observadoEm,
          categoria: e.categoria,
          oportunidades,
          conformes,
          detalhe: e.oportunidades,
          observacao: e.observacao,
          usuario: s.login,
        }),
    );
  }

  @Post('maos/consumo')
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler('qualidade.registrarObservacaoMaos (consumo): observacao_higiene_maos com a trilha_auditoria')
  async consumoAlcool(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarConsumoAlcool, b);
    await this.apoio.exigirLiberacao(s);
    await this.unidadeExiste(s, e.unidade);
    if (e.competencia > (await this.agora(s)).slice(0, 7)) throw recusaCcih('data-futura', 422);
    return this.apoio.sgh(
      s,
      E.qualidadeHigieneMaosRegistrada.codigo,
      P.ccihRegistrar,
      { tabela: 'observacao_higiene_maos', chave: `${String(e.unidade)}|${e.setor ?? ''}|${e.competencia}` },
      (g) => g.registrarConsumoAlcool({ ...e, usuario: s.login }),
    );
  }

  @Post('surtos')
  @HttpCode(201)
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler('qualidade.registrarSurto: surto_infeccao com a trilha_auditoria')
  async registrarSurto(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarSurto, b);
    await this.apoio.exigirLiberacao(s);
    await this.unidadeExiste(s, e.unidade);
    if (e.tipoSurto !== null && !(await this.porta.tiposSurto(s.porta)).some((t) => t.codigo === e.tipoSurto))
      throw new ErroProblema('entrada-invalida', 422, 'CCIH', 'Escolha o tipo de surto da lista.', {
        codigo: 'tipo-surto-invalido',
        campos: ['tipoSurto'],
      });
    const hoje = (await this.agora(s)).slice(0, 10);
    const problema = conferirSurto({ atual: null, inicio: e.inicio, encerradoEm: null, hoje });
    if (problema) throw recusaCcih(problema, 422);
    return this.apoio.sgh(
      s,
      E.qualidadeSurtoRegistrado.codigo,
      P.ccihRegistrar,
      (x: { id: number }) => ({ tabela: 'surto_infeccao', id: String(x.id) }),
      (g) => g.registrarSurto({ ...e, usuario: s.login }),
    );
  }

  @Post('surtos/:id')
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler(
    'qualidade.registrarSurto (atualização): surto_infeccao com a versão conferida e a trilha_auditoria',
  )
  async atualizarSurto(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAtualizarSurto, { ...(b as object), surto: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const x = await this.porta.surto(s.porta, e.surto);
    if (!x) throw naoEncontrado('Surto');
    const agora = await this.agora(s);
    const problema = conferirSurto({
      atual: x.situacao as 'investigacao',
      inicio: x.inicio,
      encerradoEm: e.encerradoEm,
      hoje: agora.slice(0, 10),
    });
    if (problema) throw recusaCcih(problema, problema === 'surto-encerrado' ? 409 : 422);
    return this.apoio.sgh(
      s,
      E.qualidadeSurtoRegistrado.codigo,
      P.ccihRegistrar,
      { tabela: 'surto_infeccao', id: String(x.id) },
      (g) => g.atualizarSurto({ ...e, id: x.id, agora, usuario: s.login }),
    );
  }

  // ── W0-04: correção por versão, cancelamento com motivo e competência fechada ─────────────────

  /** A senha das operações críticas (reautenticação em diálogo, SBIS-07): vem no corpo e sai dele. */
  private async reautenticado(req: RequisicaoAutorizada, b: unknown): Promise<unknown> {
    const { senha, ...resto } = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, typeof senha === 'string' ? senha : undefined);
    return resto;
  }

  /**
   * Revisão do W0-04 (regras_governanca: "correção por versão, com justificativa e pelo autor"): o autor corrige sem
   * senha extra; o registro de outro autor só com `qualidade.ccih.corrigirDeOutro`, e então com a senha (a trilha guarda
   * quem). Devolve o corpo sem a senha. `critica` = a operação já pede a senha de qualquer forma (cancelamento, estorno).
   */
  private async corpoDoAutor(
    s: SessaoCadastro,
    req: RequisicaoAutorizada,
    autor: string,
    b: unknown,
    critica = false,
  ): Promise<unknown> {
    const quem = autoriaDaCorrecao({ autor, login: s.login, podeDeOutro: s.pode(PQ.ccihCorrigirDeOutro) });
    if (quem === 'nao-e-autor') throw recusaCorrecao('nao-e-autor', [`Autor do registro: ${autor}.`], 403);
    return quem === 'outro' || critica ? this.reautenticado(req, b) : b;
  }

  /** Revisão do W0-04: a gravação pela aba do prontuário confere o vínculo com o paciente (restrição do M23). */
  private async vinculoParaGravar(s: SessaoCadastro, paciente: number | null, permissao: string) {
    if (paciente !== null) await this.acesso.exigirVinculo(s, paciente, permissao, 'pep.prontuario');
  }

  /** O nome do responsável pela inserção pelo registro (422 se não existe). */
  private async responsavelDe(s: SessaoCadastro, registro: number | null | undefined) {
    if (registro === undefined) return undefined;
    if (registro === null) return null;
    const [p] = await this.porta.profissionaisPorRegistro(s.porta, [registro]);
    if (!p) throw recusaCorrecao('responsavel-inexistente', [], 422);
    return { registro: p.id, nome: p.nome };
  }

  /** As competências fechadas da lista viram 409 com a oferta da reabertura (os indicadores dela não mudam). */
  private async exigirCompetenciasAbertas(s: SessaoCadastro, tocadas: readonly string[]): Promise<void> {
    if (tocadas.length === 0) return;
    const fechadas = new Set(
      (await this.porta.competencias(s.porta, [...new Set(tocadas)]))
        .filter((c) => c.situacao === 'fechada')
        .map((c) => c.competencia),
    );
    const bloqueiam = competenciasFechadasTocadas(tocadas, fechadas);
    if (bloqueiam.length)
      throw recusaCorrecao(
        'competencia-fechada',
        bloqueiam.map((c) => `Competência fechada: ${c}.`),
      );
  }

  /** O que impede o cancelamento do dispositivo (quantos e quais), para a tela avisar antes de pedir o motivo. */
  @Get('dispositivos/:id/dependentes')
  @Permissao(P.ccihLer)
  async dependentesDispositivo(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const itens = await this.porta.dependentes(s.porta, 'dispositivo_invasivo_paciente', idDaRota(id));
    return { itens, podeCancelar: itens.length === 0 };
  }

  @Get('versoes/:registro/:id')
  @Permissao(P.ccihLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  async versoesDoRegistro(
    @Param('registro') registro: string,
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const tabela = TABELA_DO_REGISTRO[registro as RegistroVersionadoQualidade];
    if (
      !tabela ||
      !['dispositivo', 'iras', 'precaucao', 'observacao-maos', 'competencia', 'bundle'].includes(registro)
    )
      throw naoEncontrado('Registro');
    return { itens: await this.porta.versoes(s.porta, tabela, idDaRota(id)) };
  }

  @Get('maos/sessoes')
  @Permissao(P.ccihLer)
  async sessoesMaos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetencia, q);
    const { de, ate } = limitesDaCompetencia(f.competencia);
    const r = await this.porta.sessoesMaos(s.porta, de, ate);
    return {
      competencia: f.competencia,
      itens: r.itens.filter((o) => !f.setor || o.setor === f.setor),
      cortada: r.cortada,
    };
  }

  @Get('competencias')
  @Permissao(P.irasLer)
  async competencias(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [itens, agora] = await Promise.all([this.porta.competencias(s.porta), this.agora(s)]);
    return {
      itens,
      acoes: {
        fechar: s.pode(PQ.competenciaFechar),
        reabrir: s.pode(PQ.competenciaReabrir),
      },
      agora,
    };
  }

  @Post('competencias')
  @Permissao(PQ.competenciaFechar)
  @AuditadoNoHandler('qualidade.fecharCompetencia: fechamento_vigilancia_iras com a trilha_auditoria na mesma transação')
  async fecharCompetencia(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaFecharCompetenciaCcih, b);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    if (!podeFecharCompetencia(e.competencia, agora))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'CCIH',
        'A competência só pode ser fechada depois de terminada (ou no último dia do mês).',
        { codigo: 'competencia-em-curso', campos: ['competencia'] },
      );
    return this.apoio.sgh(
      s,
      E.qualidadeCompetenciaFechada.codigo,
      PQ.competenciaFechar,
      (x: { id: number }) => ({ tabela: 'fechamento_vigilancia_iras', id: String(x.id) }),
      (g) => g.fecharCompetencia({ competencia: e.competencia, agora, usuario: s.login }),
    );
  }

  @Post('competencias/:id/reabrir')
  @Permissao(PQ.competenciaReabrir)
  @AuditadoNoHandler(
    'qualidade.reabrirCompetencia: fechamento_vigilancia_iras (versão conferida, retrato na trilha_auditoria) com a trilha_auditoria',
  )
  async reabrirCompetencia(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarRegistroQualidade, await this.reautenticado(req, b));
    await this.apoio.exigirLiberacao(s);
    const n = idDaRota(id);
    const c = (await this.porta.competencias(s.porta)).find((x) => x.id === n);
    if (!c) throw naoEncontrado('Competência');
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeCompetenciaReaberta.codigo,
      PQ.competenciaReabrir,
      { tabela: 'fechamento_vigilancia_iras', id: String(c.id) },
      (g) =>
        g.reabrirCompetencia({
          id: c.id,
          versao: e.versao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('dispositivos/:id/correcao')
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler(
    'qualidade.corrigirDispositivo: dispositivo_invasivo_paciente (nova versão; a anterior na trilha_auditoria) com a trilha_auditoria',
  )
  async corrigirDispositivo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.corrigirDispositivoPor(sessaoDe(req), req, id, b, P.ccihRegistrar);
  }

  private async corrigirDispositivoPor(
    s: SessaoCadastro,
    req: RequisicaoAutorizada,
    id: string,
    b: unknown,
    recurso: string,
    daAba = false,
  ) {
    const d = await this.porta.dispositivo(s.porta, idDaRota(id));
    if (!d) throw naoEncontrado('Dispositivo');
    if (daAba) await this.vinculoParaGravar(s, d.paciente, recurso);
    const e = corpo(esquemaCorrigirDispositivo, await this.corpoDoAutor(s, req, d.registradoPor, b));
    await this.apoio.exigirLiberacao(s);
    const [i, agora, daInternacao, fichas] = await Promise.all([
      this.porta.internacao(s.porta, d.reg),
      this.agora(s),
      this.porta.dispositivosDas(s.porta, [d.reg]),
      this.porta.irasDas(s.porta, [d.reg]),
    ]);
    const problema = conferirCorrecaoDispositivo({
      atual: d,
      novo: { tipo: e.tipo, sitio: e.sitio, inseridoEm: e.inseridoEm, retiradoEm: e.retiradoEm },
      agora,
      entrada: i?.entrada ?? e.inseridoEm.slice(0, 10),
      outrosAtivos: dispositivosDoDenominador(daInternacao).filter(
        (x) => x.id !== d.id && x.retiradoEm === null,
      ),
    });
    const responsavel = await this.responsavelDe(s, e.responsavel);
    const soResponsavel =
      problema === 'sem-mudanca' &&
      responsavel !== undefined &&
      (responsavel?.registro ?? null) !== (d.responsavel?.registro ?? null);
    if (
      (problema === 'sem-mudanca' && !soResponsavel) ||
      problema === 'retirada-sem-registro' ||
      problema === 'registro-cancelado'
    )
      throw recusaCorrecao(problema, [], problema === 'registro-cancelado' ? 409 : 422);
    if (
      problema === 'instante-futuro' ||
      problema === 'antes-da-internacao' ||
      problema === 'antes-da-insercao' ||
      problema === 'dispositivo-ja-ativo'
    )
      throw recusaCcih(problema, problema === 'dispositivo-ja-ativo' ? 409 : 422);
    if (problema && problema !== 'sem-mudanca') throw recusaCorrecao(problema);
    // Revisão do W0-04 (D-CRUD-ORFAOS, vínculo por critério): a ficha de IRAS confirmada associada a este dispositivo
    // não pode perder a associação pela correção (tipo do sítio, inserção e retirada cobrindo a data da infecção).
    const retirado = d.retiradoEm === null ? null : (e.retiradoEm ?? d.retiradoEm);
    const desfeitas = associacoesDesfeitas({
      dispositivo: { id: d.id, tipo: e.tipo, inseridoEm: e.inseridoEm, retiradoEm: retirado },
      outros: dispositivosDoDenominador(daInternacao).filter((x) => x.id !== d.id),
      fichas: fichas
        .filter((f) => f.situacao === 'confirmada')
        .map((f) => ({ id: f.id, sitio: f.sitio, dataInfeccao: f.dataInfeccao, dispositivo: f.dispositivo })),
    });
    if (desfeitas.length)
      throw recusaCorrecao('associacao-desfeita', [
        `Fichas de IRAS confirmadas (${String(desfeitas.length)}): nº ${desfeitas.join(', nº ')}.`,
      ]);
    // O antes e o depois: a competência fechada que um ou outro toca fica como está.
    await this.exigirCompetenciasAbertas(s, [
      ...competenciasDoIntervalo(d.inseridoEm, d.retiradoEm, agora),
      ...competenciasDoIntervalo(e.inseridoEm, e.retiradoEm ?? d.retiradoEm, agora),
    ]);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCorrigido.codigo,
      recurso,
      { tabela: 'dispositivo_invasivo_paciente', id: String(d.id), paciente: d.paciente },
      (g) =>
        g.corrigirDispositivo({
          id: d.id,
          versao: e.versao,
          tipo: e.tipo,
          sitio: e.sitio,
          inseridoEm: e.inseridoEm,
          retiradoEm: d.retiradoEm === null ? null : e.retiradoEm,
          ...(responsavel === undefined ? {} : { responsavel }),
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('dispositivos/:id/cancelamento')
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler(
    'qualidade.cancelarDispositivo: dispositivo_invasivo_paciente (cancelamento lógico; retrato na trilha_auditoria) com a trilha_auditoria',
  )
  async cancelarDispositivo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.cancelarDispositivoPor(sessaoDe(req), req, id, b, P.ccihRegistrar);
  }

  private async cancelarDispositivoPor(
    s: SessaoCadastro,
    req: RequisicaoAutorizada,
    id: string,
    b: unknown,
    recurso: string,
    daAba = false,
  ) {
    const d = await this.porta.dispositivo(s.porta, idDaRota(id));
    if (!d) throw naoEncontrado('Dispositivo');
    if (daAba) await this.vinculoParaGravar(s, d.paciente, recurso);
    const e = corpo(
      esquemaCancelarRegistroQualidade,
      await this.corpoDoAutor(s, req, d.registradoPor, b, true),
    );
    await this.apoio.exigirLiberacao(s);
    if (d.canceladoEm) throw recusaCorrecao('registro-cancelado');
    // D-CRUD-ORFAOS: a ficha de IRAS confirmada que usa o dispositivo como critério ficaria órfã.
    const dependentes = await this.porta.dependentes(s.porta, 'dispositivo_invasivo_paciente', d.id);
    if (dependentes.length) throw recusaCorrecao('dispositivo-com-iras', avisosDependentes(dependentes));
    const agora = await this.agora(s);
    await this.exigirCompetenciasAbertas(s, competenciasDoIntervalo(d.inseridoEm, d.retiradoEm, agora));
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      recurso,
      { tabela: 'dispositivo_invasivo_paciente', id: String(d.id), paciente: d.paciente },
      (g) =>
        g.cancelarDispositivo({
          id: d.id,
          versao: e.versao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('iras/:id/correcao')
  @Permissao(P.irasRegistrar)
  @AuditadoNoHandler(
    'qualidade.corrigirIras: caso_infeccao (nova versão; a anterior na trilha_auditoria) com a trilha_auditoria',
  )
  async corrigirIras(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCorrigirIras, b);
    await this.apoio.exigirLiberacao(s);
    const x = await this.porta.iras(s.porta, idDaRota(id));
    if (!x) throw naoEncontrado('Ficha de IRAS');
    if (x.situacao !== 'confirmada') throw recusaCcih('iras-descartada');
    const [i, agora] = await Promise.all([this.porta.internacao(s.porta, x.reg), this.agora(s)]);
    const data = conferirDataInfeccao(
      x.sitio as 'ipcs',
      e.dataInfeccao,
      i?.entrada ?? e.dataInfeccao,
      agora.slice(0, 10),
    );
    if (data) throw recusaCcih(data, 422);
    const crit = conferirCriterios(x.sitio as 'ipcs', e.criterios);
    if (crit) throw recusaCcih(crit, 422);
    await this.exigirCompetenciasAbertas(s, [competenciaDe(x.dataInfeccao), competenciaDe(e.dataInfeccao)]);
    // Revisão do W0-04 (D-CRUD-ORFAOS, vínculo por critério): a associação ao dispositivo é refeita com a data nova pela
    // mesma regra do registro e gravada na mesma versão (o retrato guarda a anterior).
    const associado = associarIras(
      x.sitio as 'ipcs',
      dispositivosDoDenominador(await this.porta.dispositivosDas(s.porta, [x.reg])),
      e.dataInfeccao,
    );
    const r = await this.apoio.sgh(
      s,
      E.qualidadeRegistroCorrigido.codigo,
      P.irasRegistrar,
      { tabela: 'caso_infeccao', id: String(x.id), paciente: x.paciente },
      (g) =>
        g.corrigirIras({
          id: x.id,
          versao: e.versao,
          dataInfeccao: e.dataInfeccao,
          criterios: e.criterios,
          microrganismo: e.microrganismo,
          multirresistente: e.multirresistente,
          descricao: e.descricao,
          ...(associado === x.dispositivo ? {} : { dispositivo: associado }),
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
    return { ...r, dispositivoAssociado: associado };
  }

  @Post('precaucoes/:id/alteracao')
  @Permissao(P.precaucaoDefinir)
  @AuditadoNoHandler(
    'qualidade.alterarPrecaucao: isolamento_paciente (nova versão), o leito e os vizinhos (leito) com a trilha_auditoria',
  )
  async alterarPrecaucao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const p = await this.porta.precaucao(s.porta, idDaRota(id));
    if (!p) throw naoEncontrado('Precaução');
    const e = corpo(esquemaAlterarPrecaucao, await this.corpoDoAutor(s, req, p.inicioPor, b));
    await this.apoio.exigirLiberacao(s);
    if (p.fimEm !== null) throw recusaCcih('precaucao-encerrada');
    const [{ abertas }, vizinhos, agora] = await Promise.all([
      this.precaucoesReconciliadas(s),
      this.porta.vizinhos(s.porta, p.leito),
      this.agora(s),
    ]);
    const outras = abertas.filter((x) => x.id !== p.id);
    const problema = conferirPrecaucao({
      temLeito: true,
      motivo: e.motivo,
      tipo: e.tipo,
      motivosAbertos: outras.filter((x) => x.reg === p.reg).map((x) => x.motivo as typeof e.motivo),
      bloquearVizinhos: e.bloquearVizinhos,
      vizinhos,
    });
    if (problema) throw recusaCcih(problema);
    const noLeito = tiposVigentesNoLeito(
      outras.map((x) => ({ ...x, tipo: x.tipo as Precaucao })),
      p.leito,
    );
    const tipoDoLeito = precaucaoDoLeito([...noLeito, e.tipo]) ?? e.tipo;
    const chave = (v: { bloco: string; acomodacao: string; leito: string }) =>
      `${v.bloco}|${v.acomodacao}|${v.leito}`;
    const atuais = new Set(p.bloqueios.map(chave));
    let manter = p.bloqueios;
    let bloquear: typeof p.bloqueios = [];
    let liberar: typeof p.bloqueios = [];
    if (e.bloquearVizinhos) {
      const { bloquear: livres } = vizinhosParaBloquear(vizinhos);
      const novos = livres.filter((v) => !atuais.has(chave(v)));
      const { bloquear: b2, compartilhar } = separarBloqueiosCompartilhados(novos, outras);
      bloquear = b2.map(({ bloco, acomodacao, leito }) => ({ bloco, acomodacao, leito }));
      manter = [
        ...p.bloqueios,
        ...compartilhar.map(({ bloco, acomodacao, leito }) => ({ bloco, acomodacao, leito })),
      ];
    } else {
      // Deixa de bloquear: libera só os que nenhuma outra precaução aberta ainda pede.
      liberar = bloqueiosALiberar(p, outras);
      manter = [];
    }
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCorrigido.codigo,
      P.precaucaoDefinir,
      { tabela: 'isolamento_paciente', id: String(p.id), paciente: p.paciente },
      (g) =>
        g.alterarPrecaucao({
          id: p.id,
          versao: e.versao,
          tipo: e.tipo,
          motivo: e.motivo,
          motivoOutro: e.motivo === 'outro' ? e.motivoOutro : null,
          multirresistente: motivoMultirresistente(e.motivo),
          leito: p.leito,
          tipoDoLeito,
          manter,
          bloquear,
          liberar,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('maos/observacoes/:id/correcao')
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler(
    'qualidade.corrigirObservacaoMaos: observacao_higiene_maos (nova versão; a anterior na trilha_auditoria) com a trilha_auditoria',
  )
  async corrigirObservacaoMaos(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const o = await this.porta.observacaoMaos(s.porta, idDaRota(id));
    if (!o) throw naoEncontrado('Sessão de observação');
    const e = corpo(esquemaCorrigirObservacaoMaos, await this.corpoDoAutor(s, req, o.registradoPor, b));
    await this.apoio.exigirLiberacao(s);
    const est = conferirCorrecaoObservacao(o);
    if (est) throw recusaCorrecao(est);
    const problema = conferirObservacao(e.observadoEm, await this.agora(s));
    if (problema) throw recusaCcih(problema, 422);
    const { oportunidades, conformes } = contarObservacao(e);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCorrigido.codigo,
      P.ccihRegistrar,
      { tabela: 'observacao_higiene_maos', id: String(o.id) },
      (g) =>
        g.corrigirObservacaoMaos({
          id: o.id,
          versao: e.versao,
          observadoEm: e.observadoEm,
          categoria: e.categoria,
          oportunidades,
          conformes,
          detalhe: e.oportunidades,
          observacao: e.observacao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('maos/observacoes/:id/estorno')
  @Permissao(P.ccihRegistrar)
  @AuditadoNoHandler(
    'qualidade.estornarObservacaoMaos: observacao_higiene_maos (estorno lógico; retrato na trilha_auditoria) com a trilha_auditoria',
  )
  async estornarObservacaoMaos(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const o = await this.porta.observacaoMaos(s.porta, idDaRota(id));
    if (!o) throw naoEncontrado('Sessão de observação');
    const e = corpo(
      esquemaCancelarRegistroQualidade,
      await this.corpoDoAutor(s, req, o.registradoPor, b, true),
    );
    await this.apoio.exigirLiberacao(s);
    const est = conferirCorrecaoObservacao(o);
    if (est) throw recusaCorrecao(est);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      P.ccihRegistrar,
      { tabela: 'observacao_higiene_maos', id: String(o.id) },
      (g) =>
        g.estornarObservacaoMaos({
          id: o.id,
          versao: e.versao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── W0-04 (M1): a aba de dispositivos do prontuário (o MESMO registro da CCIH) ──────────────────

  /** A internação aberta do paciente (a aba só registra em internação aberta). */
  private async internacaoDoPaciente(s: SessaoCadastro, paciente: number) {
    const ints = await this.porta.internados(s.porta);
    return ints.itens.find((x) => x.paciente === paciente) ?? null;
  }

  @Get('enfermagem/paciente/:paciente/dispositivos')
  @Permissao(PQ.dispositivoInvasivoLer)
  async dispositivosDoPaciente(@Param('paciente') paciente: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const id = idDaRota(paciente);
    const [agora, l] = await Promise.all([this.agora(s), this.apoio.liberacao(s)]);
    const i = await this.internacaoDoPaciente(s, id);
    const base = {
      agora,
      ligada: l.ligada,
      turnoAtual: turnoDe(agora),
      podeRegistrar: l.ligada && s.pode(PQ.dispositivoInvasivoRegistrar),
      // Revisão do W0-04: quem corrige o registro de outro autor (com a senha); o autor corrige o próprio.
      login: s.login,
      podeCorrigirDeOutro: s.pode(PQ.ccihCorrigirDeOutro),
    };
    if (!i) return { ...base, internacao: null, itens: [] };
    await this.acessoAoPaciente(s, id, PQ.dispositivoInvasivoLer, 'pep.prontuario');
    const disp = await this.porta.dispositivosDas(s.porta, [i.reg]);
    const bundles = await this.porta.bundles(
      s.porta,
      disp.map((d) => d.id),
    );
    const naCompetencia = new Map(
      dispositivosDiaDaAba(
        disp.map((d) => ({
          id: d.id,
          tipo: d.tipo as TipoDispositivoInvasivo,
          setor: d.setor,
          inseridoEm: d.inseridoEm,
          retiradoEm: d.retiradoEm,
          canceladoEm: d.canceladoEm ?? null,
        })),
        agora.slice(0, 7),
        agora,
      ).map((x) => [x.id, x.dias]),
    );
    const turno = turnoDe(agora);
    return {
      ...base,
      internacao: { internacao: i.reg, setor: i.bloco, leito: textoLeito(i), entrada: i.entrada },
      itens: disp.map((d) => {
        const doDisp = bundles.filter((x) => x.dispositivo === d.id);
        // Revisão do W0-04: o checklist estornado fica visível (inativo), mas sai do alerta e do turno registrado.
        const validos = doDisp.filter((x) => !x.estornadoEm);
        return {
          ...d,
          dias: diasDeUso(d, agora),
          dispositivosDiaCompetencia: naCompetencia.get(d.id) ?? 0,
          itensBundle: itensDoBundle(d.tipo),
          bundles: doDisp.slice(0, 9),
          bundleDoTurno: validos.some((x) => x.data === turno.data && x.turno === turno.turno),
          alerta: alertaPermanencia(
            d,
            validos.filter((x) => x.indicacaoRevisada).map((x) => x.registradoEm),
            agora,
          ),
        };
      }),
    };
  }

  @Post('enfermagem/dispositivos')
  @HttpCode(201)
  @Permissao(PQ.dispositivoInvasivoRegistrar)
  @AuditadoNoHandler(
    'qualidade.registrarDispositivo (aba do prontuário): dispositivo_invasivo_paciente com a trilha_auditoria na mesma transação',
  )
  async registrarDispositivoEnfermagem(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.registrarDispositivoPor(sessaoDe(req), b, PQ.dispositivoInvasivoRegistrar, true);
  }

  @Post('enfermagem/dispositivos/:id/retirar')
  @Permissao(PQ.dispositivoInvasivoRegistrar)
  @AuditadoNoHandler(
    'qualidade.retirarDispositivo (aba do prontuário): dispositivo_invasivo_paciente (versão conferida) com a trilha_auditoria',
  )
  async retirarDispositivoEnfermagem(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.retirarDispositivoPor(sessaoDe(req), id, b, PQ.dispositivoInvasivoRegistrar, true);
  }

  // Revisão do W0-04 (regras_governanca: a enfermagem corrige e cancela o PRÓPRIO registro pela aba, com justificativa;
  // o de outro autor só com qualidade.ccih.corrigirDeOutro e a senha).
  @Post('enfermagem/dispositivos/:id/correcao')
  @Permissao(PQ.dispositivoInvasivoRegistrar)
  @AuditadoNoHandler(
    'qualidade.corrigirDispositivo (aba do prontuário): dispositivo_invasivo_paciente (nova versão; a anterior na trilha_auditoria) com a trilha_auditoria',
  )
  async corrigirDispositivoEnfermagem(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.corrigirDispositivoPor(sessaoDe(req), req, id, b, PQ.dispositivoInvasivoRegistrar, true);
  }

  @Post('enfermagem/dispositivos/:id/cancelamento')
  @Permissao(PQ.dispositivoInvasivoRegistrar)
  @AuditadoNoHandler(
    'qualidade.cancelarDispositivo (aba do prontuário): dispositivo_invasivo_paciente (cancelamento lógico; retrato na trilha_auditoria) com a trilha_auditoria',
  )
  async cancelarDispositivoEnfermagem(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.cancelarDispositivoPor(sessaoDe(req), req, id, b, PQ.dispositivoInvasivoRegistrar, true);
  }

  /** O que impede o cancelamento pela aba (a mesma conferência da CCIH). */
  @Get('enfermagem/dispositivos/:id/dependentes')
  @Permissao(PQ.dispositivoInvasivoLer)
  async dependentesDispositivoEnfermagem(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const itens = await this.porta.dependentes(s.porta, 'dispositivo_invasivo_paciente', idDaRota(id));
    return { itens, podeCancelar: itens.length === 0 };
  }

  /** A busca do profissional responsável pela inserção (SanteSelecao remota; teto 30). */
  @Get('enfermagem/profissionais')
  @Permissao(PQ.dispositivoInvasivoRegistrar)
  async profissionaisEnfermagem(@Query('q') q: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { itens: await this.porta.buscarProfissionais(s.porta, String(q ?? '').slice(0, 60)) };
  }

  @Get('profissionais')
  @Permissao(P.ccihRegistrar)
  async profissionais(@Query('q') q: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { itens: await this.porta.buscarProfissionais(s.porta, String(q ?? '').slice(0, 60)) };
  }

  @Post('enfermagem/dispositivos/:id/bundle')
  @HttpCode(201)
  @Permissao(PQ.dispositivoInvasivoRegistrar)
  @AuditadoNoHandler(
    'qualidade.registrarBundleDispositivo: verificacao_bundle com a trilha_auditoria (só inclusão)',
  )
  async registrarBundle(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarBundle, b);
    const d = await this.porta.dispositivo(s.porta, idDaRota(id));
    if (!d) throw naoEncontrado('Dispositivo');
    await this.vinculoParaGravar(s, d.paciente, PQ.dispositivoInvasivoRegistrar);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const r = conferirBundle({
      tipo: d.tipo,
      ativo: d.retiradoEm === null && !d.canceladoEm,
      itens: e.itens,
      data: e.data,
      turno: e.turno,
      agora,
    });
    if ('recusa' in r)
      throw new ErroProblema(
        'recusa-de-negocio',
        r.recusa === 'dispositivo-inativo' ? 409 : 422,
        'CCIH',
        MENSAGENS_BUNDLE[r.recusa],
        { codigo: r.recusa, bloqueios: [r.recusa] },
      );
    return this.apoio.sgh(
      s,
      E.qualidadeBundleRegistrado.codigo,
      PQ.dispositivoInvasivoRegistrar,
      (x: { id: number }) => ({ tabela: 'verificacao_bundle', id: String(x.id), paciente: d.paciente }),
      (g) =>
        g.registrarBundle({
          dispositivo: d.id,
          data: e.data,
          turno: e.turno,
          itens: e.itens,
          conforme: r.conforme,
          indicacaoRevisada: r.indicacaoRevisada,
          observacao: e.observacao,
          agora,
          usuario: s.login,
        }),
    );
  }

  /** O checklist e o dispositivo dele, com o vínculo do paciente conferido (correção e estorno pela aba). */
  private async bundleParaMudar(s: SessaoCadastro, id: string) {
    const x = await this.porta.bundle(s.porta, idDaRota(id));
    if (!x) throw naoEncontrado('Checklist do bundle');
    const d = await this.porta.dispositivo(s.porta, x.dispositivo);
    if (!d) throw naoEncontrado('Dispositivo');
    await this.vinculoParaGravar(s, d.paciente, PQ.dispositivoInvasivoRegistrar);
    if (x.estornadoEm) throw recusaCorrecao('bundle-estornado');
    return { x, d };
  }

  @Post('enfermagem/bundles/:id/correcao')
  @Permissao(PQ.dispositivoInvasivoRegistrar)
  @AuditadoNoHandler(
    'qualidade.corrigirBundleDispositivo: verificacao_bundle (nova versão; a anterior na trilha_auditoria) com a trilha_auditoria',
  )
  async corrigirBundle(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { x, d } = await this.bundleParaMudar(s, id);
    const e = corpo(esquemaCorrigirBundle, await this.corpoDoAutor(s, req, x.registradoPor, b));
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    // As mesmas regras do registro (itens do tipo); o turno e o dispositivo não mudam. O dispositivo retirado depois
    // do turno ainda tem o checklist daquele turno corrigível (ativo = não cancelado).
    const r = conferirBundle({
      tipo: d.tipo,
      ativo: !d.canceladoEm,
      itens: e.itens,
      data: x.data,
      turno: x.turno,
      agora,
    });
    if ('recusa' in r)
      throw new ErroProblema(
        'recusa-de-negocio',
        r.recusa === 'dispositivo-inativo' ? 409 : 422,
        'CCIH',
        MENSAGENS_BUNDLE[r.recusa],
        { codigo: r.recusa, bloqueios: [r.recusa] },
      );
    const igual =
      r.conforme === x.conforme &&
      (e.observacao ?? null) === (x.observacao ?? null) &&
      Object.keys({ ...x.itens, ...e.itens }).every((k) => (x.itens[k] ?? false) === (e.itens[k] ?? false));
    if (igual) throw recusaCorrecao('sem-mudanca', [], 422);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCorrigido.codigo,
      PQ.dispositivoInvasivoRegistrar,
      { tabela: 'verificacao_bundle', id: String(x.id), paciente: d.paciente },
      (g) =>
        g.corrigirBundle({
          id: x.id,
          versao: e.versao,
          itens: e.itens,
          conforme: r.conforme,
          indicacaoRevisada: r.indicacaoRevisada,
          observacao: e.observacao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('enfermagem/bundles/:id/estorno')
  @Permissao(PQ.dispositivoInvasivoRegistrar)
  @AuditadoNoHandler(
    'qualidade.estornarBundleDispositivo: verificacao_bundle (estorno lógico; retrato na trilha_auditoria) com a trilha_auditoria',
  )
  async estornarBundle(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { x, d } = await this.bundleParaMudar(s, id);
    const e = corpo(
      esquemaCancelarRegistroQualidade,
      await this.corpoDoAutor(s, req, x.registradoPor, b, true),
    );
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      PQ.dispositivoInvasivoRegistrar,
      { tabela: 'verificacao_bundle', id: String(x.id), paciente: d.paciente },
      (g) =>
        g.estornarBundle({
          id: x.id,
          versao: e.versao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  /** As versões anteriores do checklist do bundle (a aba mostra como inativas). */
  @Get('enfermagem/versoes/:registro/:id')
  @Permissao(PQ.dispositivoInvasivoLer)
  async versoesEnfermagem(
    @Param('registro') registro: string,
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    if (registro !== 'bundle' && registro !== 'dispositivo') throw naoEncontrado('Registro');
    const tabela = TABELA_DO_REGISTRO[registro];
    return { itens: await this.porta.versoes(s.porta, tabela, idDaRota(id)) };
  }
}
