// Especialidades sob demanda e lactário (M45, etapa 6; ficha, seções 4, 5, 7 e 8; DP-32), construídos completos e
// DESLIGADOS pelas chaves `pep.especialidade.*` e `nutricao.lactario` (POL-3):
//   GET  /api/especialidades/<nome>/gravacao                 a funcionalidade e cada ação valem agora? (motivo)
//   GET  /api/especialidades/<nome>/internacoes?termo=       a busca das internações abertas (auditada)
//   GET  /api/especialidades/oftalmologia/cadastros          acuidades, exames, grupos, graduações e o limite da PIO
//   GET  /api/especialidades/oftalmologia/internacoes/:reg   os exames da internação (auditado)
//   POST /api/especialidades/oftalmologia/exames             pep.registrarExameOftalmologico (médico)
//   GET  /api/especialidades/oftalmologia/internacoes/:reg/lentes   as prescrições de lentes do paciente (auditado)
//   POST /api/especialidades/oftalmologia/lentes             pep.prescricao-lente.emitir (médico; óculos ou contato)
//   POST /api/especialidades/oftalmologia/lentes/:id/cancelamento   pep.prescricao-lente.cancelar (motivo; nada apagado)
//   GET  /api/especialidades/oncologia/protocolos            os protocolos (todas as versões) e os tipos do cadastro
//   POST /api/especialidades/oncologia/protocolos            pep.publicarProtocoloOncologico (médico; imutável)
//   GET  /api/especialidades/oncologia/internacoes/:reg      os ciclos do paciente (auditado)
//   POST /api/especialidades/oncologia/ciclos                pep.registrarCicloOncologico (médico; dose calculada aqui)
//   GET  /api/especialidades/oncologia/validacao             a fila da validação farmacêutica (auditada)
//   GET  /api/especialidades/oncologia/ciclos/:id/prescricoes as prescrições da internação no dia previsto (auditado)
//   POST /api/especialidades/oncologia/ciclos/:id/prescricoes pep.registrarCicloOncologico (a ligação com a prescrição)
//   POST /api/especialidades/oncologia/ciclos/:id/validar    pep.validarCicloOncologico (farmacêutico; dupla checagem;
//                                                            só com a prescrição ligada)
//   GET  /api/especialidades/obstetricia/internacoes/:reg    o partograma com as linhas e os recém-nascidos (auditado)
//   POST /api/especialidades/obstetricia/partograma          pep.registrarPartograma (médico ou enfermagem)
//   POST /api/especialidades/obstetricia/recem-nascidos      pep.registrarRecemNascido (médico ou enfermagem)
//   GET  /api/nutricao/lactario/gravacao | /internacoes      o estado e a busca, como acima
//   GET  /api/nutricao/lactario?data=                        a produção do dia com os totais (auditada)
//   POST /api/nutricao/lactario/ordens                       internacao.registrarProducaoLactario (a ordem)
//   POST /api/nutricao/lactario/ordens/:id/conferir          internacao.registrarProducaoLactario (outra pessoa)
//   POST /api/nutricao/lactario/ordens/:id/etiquetas         as etiquetas em ZPL (só da ordem conferida)
// Os cálculos (classificação da visão, doses, linhas do partograma, validade) são SEMPRE do domínio, aqui; as categorias
// são conferidas na hora pelo vínculo do login (CBO com o conselho ativo). Gravações pela porta, com a trilha de auditoria na mesma transação.
import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CadastrosOftalmologia,
  type CategoriaAssistencial,
  CHAVE_LIBERACAO_LACTARIO,
  CHAVE_LIBERACAO_OBSTETRICIA,
  CHAVE_LIBERACAO_OFTALMOLOGIA,
  CHAVE_LIBERACAO_ONCOLOGIA,
  type CicloOncologicoLido,
  type EtiquetasLactario,
  esquemaPublicarProtocoloOncologico,
  esquemaRegistrarCicloOncologico,
  esquemaRegistrarExameOftalmologico,
  esquemaRegistrarOrdemLactario,
  esquemaRegistrarPartograma,
  esquemaRegistrarRecemNascido,
  esquemaValidarCicloOncologico,
  esquemaVincularPrescricaoCiclo,
  EVENTOS_AUDITAVEIS as E,
  type ExameOftalmologicoLido,
  type FilaValidacaoOnco,
  type GravacaoEspecialidade,
  type InternacaoEspecialidade,
  type ListaInternacoesEspecialidade,
  type ObstetriciaPaciente,
  type OftalmologiaPaciente,
  type OncologiaPaciente,
  type PrescricoesDoCiclo,
  PARAMETRO_LACTARIO_VALIDADE,
  PARAMETRO_OBST_FASE_ATIVA,
  PARAMETRO_OFTALMO_PIO_LIMITE,
  PARAMETRO_ONCO_SC_MAXIMA,
  PARAMETRO_ONCO_TOLERANCIA,
  PERMISSOES_ESPECIALIDADES_CODIGOS as P,
  type ProducaoLactario,
  type ProtocoloOncologicoLido,
  type ProtocolosOncologicos,
  type ResultadoEspecialidade,
  type DependenciasProtocolo,
  esquemaAjustarCiclo,
  esquemaAlterarOrdemLactario,
  esquemaInterromperCiclo,
  esquemaRevogarVersaoProtocolo,
  esquemaSoMotivo,
  type EventoOncoLido,
  esquemaVersaoCicloAnterior,
  type VersaoCicloAnterior,
} from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { enfileirarZpl, ErroZpl, zplEtiquetaLactario } from '@sgh/dominio-documento';
import {
  calcularDoses,
  categoriaDoCbo,
  clearanceCockcroftGault,
  conferirCiclo,
  conferirConferencia,
  conferirEtiquetaLactario,
  conferirExameOftalmologico,
  conferirOrdemLactario,
  conferirPartograma,
  conferirPrescricaoParaValidar,
  conferirProtocolo,
  conferirRecemNascido,
  conferirVinculoPrescricao,
  cursoDoCiclo,
  decimalDaAcuidade,
  duplaChecagem,
  ErroEspecialidade,
  hashProtocolo,
  idadeEmAnos,
  linhasDoPartograma,
  porcoesDaOrdem,
  superficieCorporalOnco,
  totaisDoLactario,
  exigirCicloEditavel,
  conferirAjusteCiclo,
  exigirLigacaoDesfazivel,
  exigirOfertavel,
  exigirOrdemAlteravel,
  exigirOrdemNaoCancelada,
  ofertaDoProtocolo,
  transicaoDoCiclo,
} from '@sgh/dominio-pep';
import type {
  AlteracaoLactarioRegistrada,
  CicloOncologicoRegistrado,
  EventoOncologicoRegistrado,
  ExameOftalmologicoRegistrado,
  InternacaoEspecialidadeLida,
  OrdemLactarioRegistrada,
  ProtocoloOncologicoRegistrado,
  RecemNascidoRegistrado,
} from './tipos.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
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
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { AcessoPacientePep } from '../pep/acesso-paciente.js';
import { ESTADO_PRONTUARIO } from '../pep/prontuario.controller.js';
import type { EstadoProntuario } from '../pep/sessao-prontuario.js';
import {
  FASE_ATIVA_CM_PADRAO,
  type GravadorEspecialidades,
  PORTA_ESPECIALIDADES,
  type PortaEspecialidades,
} from './porta.js';
import {
  esquemaCancelamentoLente,
  esquemaEmissaoLente,
  PORTA_PRESCRICAO_LENTE,
  type PortaPrescricaoLente,
  type PrescricaoLenteLida,
  portaPrescricaoLenteIndisponivel,
} from './prescricao-lente.js';

/**
 * A tela da obstetrícia com o recém-nascido lido: peso, Apgar, idade gestacional e as classificações podem ser null
 * (o banco aceita o nascimento sem esses campos; nunca uma classificação sobre um zero inventado). O contrato
 * (esquemaRecemNascidoLido) ainda os tem como obrigatórios: pedido do lote 02-06 para torná-los anuláveis.
 */
type ObstetriciaLida = Omit<ObstetriciaPaciente, 'recemNascidos'> & {
  readonly recemNascidos: (Omit<RecemNascidoRegistrado, 'tipoParto'> & { readonly tipoParto: string })[];
};

type Nome = 'oftalmologia' | 'oncologia' | 'obstetricia' | 'lactario';

/** As ações de cada tela e a permissão de agir (vale também no servidor). */
const ACOES: Readonly<Record<Nome, Readonly<Record<string, string>>>> = {
  oftalmologia: { registrar: P.oftalmologiaRegistrar },
  oncologia: {
    publicar: P.oncologiaPublicarProtocolo,
    registrar: P.oncologiaRegistrar,
    validar: P.oncologiaValidar,
  },
  obstetricia: { registrar: P.obstetriciaRegistrar },
  lactario: { produzir: P.lactarioProduzir },
};

/** As categorias que agem (ATO-01): quem registra cada ato. */
const CATEGORIAS: Readonly<Record<string, readonly CategoriaAssistencial[]>> = {
  'oftalmologia.registrar': ['medico'],
  'oncologia.publicar': ['medico'],
  'oncologia.registrar': ['medico'],
  'oncologia.validar': ['farmacia'],
  'obstetricia.registrar': ['medico', 'enfermagem'],
};
const NOME_CATEGORIA: Readonly<Record<string, string>> = {
  'oftalmologia.registrar': 'O exame oftalmológico é registrado pelo médico',
  'oncologia.publicar': 'O protocolo de quimioterapia é publicado pelo médico',
  'oncologia.registrar': 'O ciclo de quimioterapia é registrado pelo médico',
  'oncologia.validar': 'A validação do ciclo é do farmacêutico',
  'obstetricia.registrar': 'O partograma e o recém-nascido são registrados pelo médico ou pela enfermagem',
};

const CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
/** A Idempotency-Key da gravação (uma por intenção de gravar); sem ela, 400. */
function chaveIdempotencia(req: RequisicaoAutorizada): string {
  const bruto = req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE_IDEMPOTENCIA.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'A Idempotency-Key do pedido falta ou é inválida.',
    );
  return k;
}
const dataBr = (d: string) => d.split('-').reverse().join('/');

const recusaDominio = (x: unknown): never => {
  if (x instanceof ErroEspecialidade)
    throw new ErroProblema('recusa-de-negocio', 409, 'Registro recusado', x.message, { codigo: x.codigo });
  throw x;
};
const tentar = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (x) {
    return recusaDominio(x);
  }
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** W0-05: a versão anterior do ciclo ajustado (o JSON do evento), validada; o que não confere sai como null. */
const versaoAnterior = (antes: string | null): VersaoCicloAnterior | null => {
  if (!antes) return null;
  try {
    const r = esquemaVersaoCicloAnterior.safeParse(JSON.parse(antes));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
};

/**
 * W0-05: o evento do protocolo ou do ciclo como a tela lê. O 'ciclo-ajustado' leva a versão anterior do ciclo (data,
 * redução e doses), que a tela mostra como inativa e imprime: o ajuste é nova versão, e a anterior continua visível.
 */
const eventoLido = (e: EventoOncologicoRegistrado): EventoOncoLido => ({
  id: e.id,
  evento: e.evento,
  categoria: e.categoria,
  prescricao: e.prescricao,
  ciclosAfetados: e.ciclosAfetados,
  antes: e.evento === 'ciclo-ajustado' ? versaoAnterior(e.antes) : null,
  motivo: e.motivo,
  por: e.por,
  em: e.em,
});
const termoDe = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const dm = (civil: string) => `${civil.slice(8, 10)}/${civil.slice(5, 7)} ${civil.slice(11, 16)}`;

@Controller()
export class EspecialidadesController {
  private readonly apoio: Readonly<Record<Nome, ApoioGravacao<GravadorEspecialidades>>>;
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(PORTA_ESPECIALIDADES) private readonly porta: PortaEspecialidades,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(ESTADO_PRONTUARIO) estado: EstadoProntuario,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional()
    @Inject(VINCULO_ASSISTENCIAL)
    vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional()
    @Inject(PORTA_PRESCRICAO_LENTE)
    private readonly lentes: PortaPrescricaoLente = portaPrescricaoLenteIndisponivel(),
  ) {
    const novo = (chave: string, nome: string) =>
      new ApoioGravacao<GravadorEspecialidades>(
        { chave, nome, operacoes: {} },
        porta,
        trilha,
        configuracao,
        cache,
      );
    this.apoio = {
      oftalmologia: novo(CHAVE_LIBERACAO_OFTALMOLOGIA, 'a oftalmologia'),
      oncologia: novo(CHAVE_LIBERACAO_ONCOLOGIA, 'a oncologia'),
      obstetricia: novo(CHAVE_LIBERACAO_OBSTETRICIA, 'a obstetrícia'),
      lactario: novo(CHAVE_LIBERACAO_LACTARIO, 'o lactário'),
    };
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  // ── Apoio ──────────────────────────────────────────────────────────────────────────────────────

  private async categorias(s: SessaoCadastro) {
    const vs = await this.porta.vinculos(s.porta, s.login).catch(() => []);
    return vs.filter((v) => v.ativo).map((v) => ({ ...v, categoria: categoriaDoCbo(v.cbo) }));
  }

  /** O vínculo ativo de uma das categorias do ato; senão 403 com o motivo. */
  private async vinculoDa(s: SessaoCadastro, ato: string) {
    const aceitas = CATEGORIAS[ato] ?? [];
    const v = (await this.categorias(s)).find((x) => x.categoria !== null && aceitas.includes(x.categoria));
    if (!v)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Categoria profissional',
        `${NOME_CATEGORIA[ato] ?? 'Ação privativa'}: a sessão precisa do vínculo da categoria com o conselho ativo.`,
        { codigo: 'categoria-nao-autorizada' },
      );
    return v;
  }

  private async gravacao(s: SessaoCadastro, nome: Nome): Promise<GravacaoEspecialidade> {
    const [g, cats] = await Promise.all([this.apoio[nome].gravacao(s, ACOES[nome]), this.categorias(s)]);
    const operacoes = { ...g.operacoes };
    for (const acao of Object.keys(ACOES[nome])) {
      const ato = `${nome}.${acao}`;
      const aceitas = CATEGORIAS[ato];
      if (aceitas && operacoes[acao]?.pode && !cats.some((c) => c.categoria && aceitas.includes(c.categoria)))
        operacoes[acao] = {
          pode: false,
          motivo: `${NOME_CATEGORIA[ato]}: a sessão precisa do vínculo da categoria com o conselho ativo.`,
        };
    }
    return { ligada: g.ligada, motivo: g.motivo, operacoes, categoria: cats[0]?.categoria ?? null };
  }

  private async lista(s: SessaoCadastro, termo: string | undefined): Promise<ListaInternacoesEspecialidade> {
    const r = await this.porta.internacoes(s.porta, termoDe(termo));
    return {
      itens: r.itens.map((i) => ({
        internacao: i.internacao,
        prontuario: i.prontuario,
        nome: i.nome,
        leito: i.leito,
        entrada: i.entrada,
      })),
      cortada: r.cortada,
    };
  }

  private async cabecalho(
    s: SessaoCadastro,
    i: InternacaoEspecialidadeLida,
  ): Promise<InternacaoEspecialidade> {
    const { hoje } = await this.porta.relogio(s.porta);
    return {
      internacao: i.internacao,
      paciente: i.paciente,
      prontuario: i.prontuario,
      nome: i.nome,
      nascimento: i.nascimento,
      idade: idadeEmAnos(i.nascimento, hoje),
      sexo: i.sexo,
      leito: { bloco: i.bloco, acomodacao: i.acomodacao, leito: i.leito },
      admissao: i.admissao,
      aberta: i.aberta,
    };
  }

  /** A internação para LER (aberta ou não), com o vínculo assistencial conferido. */
  private async internacaoLida(s: SessaoCadastro, reg: string, permissao: string) {
    const i = await this.porta.internacao(s.porta, idDaRota(reg));
    if (!i)
      throw new ErroProblema('nao-encontrado', 404, 'Internação não encontrada', 'A internação não existe.');
    await this.acesso.exigirVinculo(s, i.paciente, permissao, 'pep.evolucao');
    return i;
  }

  /** A internação para GRAVAR: aberta e com o vínculo assistencial. */
  private async internacaoAberta(s: SessaoCadastro, reg: number, permissao: string) {
    const i = await this.porta.internacao(s.porta, reg);
    if (!i)
      throw new ErroProblema('nao-encontrado', 404, 'Internação não encontrada', 'A internação não existe.');
    if (!i.aberta)
      throw new ErroProblema('recusa-de-negocio', 409, 'Internação encerrada', 'A internação já teve alta.', {
        codigo: 'internacao-encerrada',
      });
    await this.acesso.exigirVinculo(s, i.paciente, permissao, 'pep.evolucao');
    return i;
  }

  private parametro(s: SessaoCadastro, nome: Nome, chave: string, padrao: number) {
    return this.apoio[nome].parametro(s, chave).then((v) => v || padrao);
  }

  // ── Estado da gravação e busca das internações ─────────────────────────────────────────────────

  @Get('especialidades/oftalmologia/gravacao')
  @Permissao(P.oftalmologiaLer)
  gravacaoOftalmologia(@Req() req: RequisicaoAutorizada) {
    return this.gravacao(sessaoDe(req), 'oftalmologia');
  }

  @Get('especialidades/oncologia/gravacao')
  @Permissao(P.oncologiaLer)
  gravacaoOncologia(@Req() req: RequisicaoAutorizada) {
    return this.gravacao(sessaoDe(req), 'oncologia');
  }

  @Get('especialidades/obstetricia/gravacao')
  @Permissao(P.obstetriciaLer)
  gravacaoObstetricia(@Req() req: RequisicaoAutorizada) {
    return this.gravacao(sessaoDe(req), 'obstetricia');
  }

  @Get('nutricao/lactario/gravacao')
  @Permissao(P.lactarioLer)
  gravacaoLactario(@Req() req: RequisicaoAutorizada) {
    return this.gravacao(sessaoDe(req), 'lactario');
  }

  @Get('especialidades/oftalmologia/internacoes')
  @Permissao(P.oftalmologiaLer)
  @Auditar(E.especialidadeLida.codigo)
  internacoesOftalmologia(@Req() req: RequisicaoAutorizada, @Query('termo') termo?: string) {
    return this.lista(sessaoDe(req), termo);
  }

  @Get('especialidades/oncologia/internacoes')
  @Permissao(P.oncologiaLer)
  @Auditar(E.especialidadeLida.codigo)
  internacoesOncologia(@Req() req: RequisicaoAutorizada, @Query('termo') termo?: string) {
    return this.lista(sessaoDe(req), termo);
  }

  @Get('especialidades/obstetricia/internacoes')
  @Permissao(P.obstetriciaLer)
  @Auditar(E.especialidadeLida.codigo)
  internacoesObstetricia(@Req() req: RequisicaoAutorizada, @Query('termo') termo?: string) {
    return this.lista(sessaoDe(req), termo);
  }

  @Get('nutricao/lactario/internacoes')
  @Permissao(P.lactarioLer)
  @Auditar(E.lactarioLido.codigo)
  internacoesLactario(@Req() req: RequisicaoAutorizada, @Query('termo') termo?: string) {
    return this.lista(sessaoDe(req), termo);
  }

  // ── Oftalmologia ───────────────────────────────────────────────────────────────────────────────

  private async cadastroOftalmo(s: SessaoCadastro) {
    const c = await this.porta.cadastrosOftalmologia(s.porta);
    return {
      lidos: c,
      dominio: {
        exames: new Map(c.exames.map((x) => [x.codigo, x.nome])),
        acuidades: new Map(c.acuidades.map((x) => [x.codigo, x.nome])),
        graduacoes: new Map(c.graduacoes.map((x) => [x.codigo, x.nome])),
      },
    };
  }

  @Get('especialidades/oftalmologia/cadastros')
  @Permissao(P.oftalmologiaLer)
  async cadastrosOftalmologia(@Req() req: RequisicaoAutorizada): Promise<CadastrosOftalmologia> {
    const s = sessaoDe(req);
    const { lidos } = await this.cadastroOftalmo(s);
    return {
      grupos: lidos.grupos,
      exames: lidos.exames,
      acuidades: lidos.acuidades.map((a) => ({
        codigo: a.codigo,
        nome: a.nome,
        decimal: decimalDaAcuidade(a.nome).decimal,
      })),
      graduacoes: lidos.graduacoes,
      tiposArquivo: lidos.tiposArquivo,
      pioLimite: await this.parametro(s, 'oftalmologia', PARAMETRO_OFTALMO_PIO_LIMITE, 21),
    };
  }

  private exameLido(
    x: ExameOftalmologicoRegistrado,
    c: Awaited<ReturnType<EspecialidadesController['cadastroOftalmo']>>['dominio'],
  ): ExameOftalmologicoLido {
    const olho = (o: ExameOftalmologicoRegistrado['od']) => ({
      acuidadeSemCorrecao: o.avSc === null ? null : (c.acuidades.get(o.avSc) ?? `Acuidade ${o.avSc}`),
      acuidadeComCorrecao: o.avCc === null ? null : (c.acuidades.get(o.avCc) ?? `Acuidade ${o.avCc}`),
      pio: o.pio,
      gonioscopia: o.gonio === null ? null : (c.graduacoes.get(o.gonio) ?? `Graduação ${o.gonio}`),
    });
    return {
      id: x.id,
      od: olho(x.od),
      oe: olho(x.oe),
      metodoPio: x.metodoPio,
      exames: x.itens.map((i) => ({
        exame: c.exames.get(i.exame) ?? `Exame ${i.exame}`,
        lado: i.lado,
        resultado: i.resultado,
      })),
      classificacao:
        (['normal', 'reduzida', 'baixa-visao', 'cegueira'] as const).find((k) => k === x.classificacao) ??
        'sem-dado',
      alertas: x.alertas,
      conduta: x.conduta,
      por: x.por,
      em: x.em,
    };
  }

  @Get('especialidades/oftalmologia/internacoes/:reg')
  @Permissao(P.oftalmologiaLer)
  @Auditar(E.especialidadeLida.codigo)
  async oftalmologia(
    @Param('reg') reg: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<OftalmologiaPaciente> {
    const s = sessaoDe(req);
    const i = await this.internacaoLida(s, reg, P.oftalmologiaLer);
    const [cab, exames, c] = await Promise.all([
      this.cabecalho(s, i),
      this.porta.exames(s.porta, i.internacao),
      this.cadastroOftalmo(s),
    ]);
    return { internacao: cab, exames: exames.map((x) => this.exameLido(x, c.dominio)) };
  }

  // ── Prescrição de lentes (03-PEP linha 139) ──
  @Get('especialidades/oftalmologia/internacoes/:reg/lentes')
  @Permissao(P.oftalmologiaLer)
  @Auditar(E.especialidadeLida.codigo)
  async lentesDoPaciente(
    @Param('reg') reg: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ hoje: string; itens: PrescricaoLenteLida[] }> {
    const s = sessaoDe(req);
    const i = await this.internacaoLida(s, reg, P.oftalmologiaLer);
    return this.lentes.doPaciente(s.porta, i.paciente);
  }

  @Post('especialidades/oftalmologia/lentes')
  @HttpCode(201)
  @Permissao(P.oftalmologiaRegistrar)
  @AuditadoNoHandler('pep.prescricao-lente.emitir pelo executor (trilha na mesma transação)')
  async emitirLente(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { internacao, ...prescricao } = corpo(esquemaEmissaoLente, b);
    const v = await this.vinculoDa(s, 'oftalmologia.registrar');
    const i = await this.internacaoLida(s, String(internacao), P.oftalmologiaRegistrar);
    const r = await this.lentes.emitir(
      s.porta,
      { internacao: i.internacao, paciente: i.paciente, profissional: v.vinculo, prescricao },
      chaveIdempotencia(req),
    );
    return { ok: true, ...r, mensagem: `Prescrição de lentes emitida, válida até ${dataBr(r.validadeAte)}.` };
  }

  @Post('especialidades/oftalmologia/lentes/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.oftalmologiaRegistrar)
  @AuditadoNoHandler('pep.prescricao-lente.cancelar pelo executor (trilha na mesma transação, com o motivo)')
  async cancelarLente(
    @Param('id') id: string,
    @Query('internacao') reg: string | undefined,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelamentoLente, b);
    await this.vinculoDa(s, 'oftalmologia.registrar');
    const i = await this.internacaoLida(s, reg ?? '', P.oftalmologiaRegistrar);
    const r = await this.lentes.cancelar(
      s.porta,
      { id: idDaRota(id), paciente: i.paciente, motivo: e.motivo, versao: e.versao },
      chaveIdempotencia(req),
    );
    return { ok: true, ...r, mensagem: 'Prescrição de lentes cancelada: fica no histórico com o motivo.' };
  }

  @Post('especialidades/oftalmologia/exames')
  @HttpCode(201)
  @Permissao(P.oftalmologiaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarExameOftalmologico (exame_oftalmologico e os itens) com a trilha de auditoria na mesma transação',
  )
  async registrarExame(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarExameOftalmologico, b);
    await this.apoio.oftalmologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oftalmologia.registrar');
    const i = await this.internacaoAberta(s, e.internacao, P.oftalmologiaRegistrar);
    const c = await this.cadastroOftalmo(s);
    const limite = await this.parametro(s, 'oftalmologia', PARAMETRO_OFTALMO_PIO_LIMITE, 21);
    const r = tentar(() => conferirExameOftalmologico(e, c.dominio, limite));
    const id = await this.apoio.oftalmologia.sgh(
      s,
      E.exameOftalmologicoRegistrado.codigo,
      P.oftalmologiaRegistrar,
      (x: number) => ({
        tabela: 'exame_oftalmologico',
        id: String(x),
        paciente: i.paciente,
        chave: `${i.internacao}:${r.classificacao}:${r.alertas.length}`,
      }),
      (g) =>
        g.registrarExame({
          internacao: i.internacao,
          prontuario: i.prontuario,
          paciente: i.paciente,
          od: {
            avSc: e.od.acuidadeSemCorrecao,
            avCc: e.od.acuidadeComCorrecao,
            pio: e.od.pio,
            gonio: e.od.gonioscopia,
          },
          oe: {
            avSc: e.oe.acuidadeSemCorrecao,
            avCc: e.oe.acuidadeComCorrecao,
            pio: e.oe.pio,
            gonio: e.oe.gonioscopia,
          },
          metodoPio: e.metodoPio,
          classificacao: r.classificacao,
          alertas: r.alertas,
          conduta: e.conduta ?? null,
          itens: e.exames,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      alertas: r.alertas,
      mensagem: `Exame oftalmológico registrado (${ROTULO_VISAO[r.classificacao]}${r.alertas.length ? `; ${r.alertas.length} alerta(s)` : ''}).`,
    };
  }

  // ── Oncologia ──────────────────────────────────────────────────────────────────────────────────

  private async protocolosLidos(s: SessaoCadastro): Promise<ProtocolosOncologicos> {
    const [tipos, ps, eventos] = await Promise.all([
      this.porta.tiposProtocolo(s.porta),
      this.porta.protocolos(s.porta),
      this.porta.eventosProtocolos(s.porta),
    ]);
    const nomes = new Map(tipos.map((t) => [t.codigo, t.nome]));
    const vigente = new Map<string, number>();
    for (const p of ps) vigente.set(p.codigo, Math.max(vigente.get(p.codigo) ?? 0, p.versao));
    const lidos = await Promise.all(
      ps.map((p) => this.protocoloLido(p, nomes, vigente.get(p.codigo) === p.versao, eventos)),
    );
    return { tipos, protocolos: lidos };
  }

  private async protocoloLido(
    p: ProtocoloOncologicoRegistrado,
    tipos: ReadonlyMap<number, string>,
    vigente: boolean,
    eventos: readonly EventoOncologicoRegistrado[] = [],
  ): Promise<ProtocoloOncologicoLido> {
    // W0-05: a revogação da versão e a inativação do protocolo (pelo código) tiram a versão da oferta.
    const oferta = ofertaDoProtocolo({ id: p.id, codigo: p.codigo, vigente }, eventos);
    const conteudo = {
      codigo: p.codigo,
      nome: p.nome,
      tipo: p.tipo,
      intervaloDias: p.intervaloDias,
      ciclos: p.ciclos,
      farmacos: p.farmacos,
      referencia: p.referencia,
      ...(p.indicacao ? { indicacao: p.indicacao } : {}),
    };
    return {
      id: p.id,
      codigo: p.codigo,
      versao: p.versao,
      nome: p.nome,
      tipo: { codigo: p.tipo, nome: tipos.get(p.tipo) ?? `Tipo ${p.tipo}` },
      intervaloDias: p.intervaloDias,
      ciclos: p.ciclos,
      farmacos: p.farmacos,
      indicacao: p.indicacao,
      referencia: p.referencia,
      hash: p.hash,
      vigente,
      // Regra 14 (por analogia): a versão relida confere com o hash gravado.
      integro: (await hashProtocolo(conteudo)) === p.hash,
      por: p.por,
      em: p.em,
      ...oferta,
      eventos: eventos
        .filter((e) => e.codigoProtocolo === p.codigo && (e.protocolo === null || e.protocolo === p.id))
        .map(eventoLido),
    };
  }

  @Get('especialidades/oncologia/protocolos')
  @Permissao(P.oncologiaLer)
  protocolos(@Req() req: RequisicaoAutorizada): Promise<ProtocolosOncologicos> {
    return this.protocolosLidos(sessaoDe(req));
  }

  @Post('especialidades/oncologia/protocolos')
  @HttpCode(201)
  @Permissao(P.oncologiaPublicarProtocolo)
  @AuditadoNoHandler(
    'pep.publicarProtocoloOncologico (protocolo_quimioterapia, imutável) com a trilha de auditoria na mesma transação',
  )
  async publicarProtocolo(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPublicarProtocoloOncologico, b);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.publicar');
    const tipos = await this.porta.tiposProtocolo(s.porta);
    tentar(() => conferirProtocolo(e, new Set(tipos.map((t) => t.codigo))));
    const hash = await hashProtocolo(e);
    const existentes = (await this.porta.protocolos(s.porta)).filter((p) => p.codigo === e.codigo);
    if (existentes.some((p) => p.hash === hash))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Protocolo sem mudança',
        'Esta versão é igual a uma já publicada do mesmo código: nada a publicar.',
        { codigo: 'protocolo-identico' },
      );
    const r = await this.apoio.oncologia.sgh(
      s,
      E.protocoloOncologicoPublicado.codigo,
      P.oncologiaPublicarProtocolo,
      (x: { id: number; versao: number }) => ({
        tabela: 'protocolo_quimioterapia',
        id: String(x.id),
        chave: `${e.codigo}:v${x.versao}:${hash.slice(0, 16)}`,
      }),
      (g) =>
        g.publicarProtocolo({
          codigo: e.codigo,
          nome: e.nome,
          tipo: e.tipo,
          intervaloDias: e.intervaloDias,
          ciclos: e.ciclos,
          indicacao: e.indicacao ?? null,
          referencia: e.referencia,
          farmacos: e.farmacos,
          hash,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: r.id,
      alertas: [],
      mensagem: `Protocolo ${e.codigo} publicado na versão ${r.versao} (imutável).`,
    };
  }

  private cicloLido(
    c: CicloOncologicoRegistrado,
    p: { codigo: string; versao: number; nome: string } | null,
    eventos: readonly EventoOncologicoRegistrado[] = [],
  ): CicloOncologicoLido {
    return {
      id: c.id,
      protocolo: {
        id: c.protocolo,
        codigo: p?.codigo ?? c.codigoProtocolo,
        versao: p?.versao ?? 0,
        nome: p?.nome ?? '',
      },
      numero: c.numero,
      dataPrevista: c.dataPrevista,
      pesoKg: c.pesoKg,
      alturaCm: c.alturaCm,
      superficieM2: c.superficieM2,
      creatininaMgDl: c.creatininaMgDl,
      clearanceMlMin: c.clearanceMlMin,
      reducaoPct: c.reducaoPct,
      motivoReducao: c.motivoReducao,
      justificativaIntervalo: c.justificativaIntervalo,
      doses: c.doses,
      situacao: c.situacao,
      por: c.por,
      em: c.em,
      validadoPor: c.validadoPor,
      validadoEm: c.validadoEm,
      curso: c.curso,
      motivoCurso: c.motivoCurso,
      prescricoes: [...c.prescricoes],
      andamento: c.andamento,
      eventos: eventos.filter((e) => e.ciclo === c.id).map(eventoLido),
    };
  }

  @Get('especialidades/oncologia/internacoes/:reg')
  @Permissao(P.oncologiaLer)
  @Auditar(E.especialidadeLida.codigo)
  async oncologia(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada): Promise<OncologiaPaciente> {
    const s = sessaoDe(req);
    const i = await this.internacaoLida(s, reg, P.oncologiaLer);
    const [cab, ciclos, ps] = await Promise.all([
      this.cabecalho(s, i),
      this.porta.ciclosDoPaciente(s.porta, i.paciente),
      this.protocolosLidos(s),
    ]);
    const porId = new Map(ps.protocolos.map((p) => [p.id, p]));
    const eventos = await this.porta.eventosCiclos(
      s.porta,
      ciclos.map((c) => c.id),
    );
    return {
      internacao: cab,
      ciclos: ciclos.map((c) => this.cicloLido(c, porId.get(c.protocolo) ?? null, eventos)),
      // W0-05: só as versões oferecidas a ciclos novos (vigente, não revogada, protocolo ativo).
      protocolos: ps.protocolos.filter((p) => p.ofertavel),
    };
  }

  @Post('especialidades/oncologia/ciclos')
  @HttpCode(201)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarCicloOncologico (ciclo_quimioterapia) com a trilha de auditoria na mesma transação',
  )
  async registrarCiclo(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarCicloOncologico, b);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.registrar');
    const i = await this.internacaoAberta(s, e.internacao, P.oncologiaRegistrar);
    const p = await this.porta.protocolo(s.porta, e.protocolo);
    if (!p)
      throw new ErroProblema('nao-encontrado', 404, 'Protocolo não encontrado', 'O protocolo não existe.');
    // W0-05: a versão revogada e a do protocolo inativo não são oferecidas a ciclos novos.
    const ofertaAtual = ofertaDoProtocolo(
      { id: p.id, codigo: p.codigo, vigente: p.vigente },
      await this.porta.eventosProtocolos(s.porta),
    );
    if (p.vigente) tentar(() => exigirOfertavel(ofertaAtual));
    const doPaciente = (await this.porta.ciclosDoPaciente(s.porta, i.paciente)).filter(
      (c) => c.codigoProtocolo === p.codigo,
    );
    const { curso, anteriores } = tentar(() => cursoDoCiclo(e, doPaciente));
    const { diasDesdeAnterior } = tentar(() =>
      conferirCiclo(
        e,
        {
          id: p.id,
          vigente: p.vigente,
          ciclos: p.ciclos,
          intervaloDias: p.intervaloDias,
          farmacos: p.farmacos,
        },
        anteriores,
      ),
    );
    const { hoje } = await this.porta.relogio(s.porta);
    const teto = (await this.apoio.oncologia.parametro(s, PARAMETRO_ONCO_SC_MAXIMA)) / 100;
    const sc = superficieCorporalOnco(e.pesoKg, e.alturaCm, teto);
    const idade = idadeEmAnos(i.nascimento, hoje);
    if (e.creatininaMgDl !== null && idade === null)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Idade necessária',
        'O paciente não tem a data de nascimento no cadastro: a função renal (Cockcroft-Gault) não é calculada.',
        { codigo: 'idade-ausente' },
      );
    const clearance =
      e.creatininaMgDl === null || idade === null
        ? null
        : clearanceCockcroftGault(idade, e.pesoKg, e.creatininaMgDl, i.sexo);
    const doses = tentar(() =>
      calcularDoses(p.farmacos, {
        superficieM2: sc,
        pesoKg: e.pesoKg,
        clearanceMlMin: clearance,
        reducaoPct: e.reducaoPct,
      }),
    );
    const id = await this.apoio.oncologia.sgh(
      s,
      E.cicloOncologicoRegistrado.codigo,
      P.oncologiaRegistrar,
      (x: number) => ({
        tabela: 'ciclo_quimioterapia',
        id: String(x),
        paciente: i.paciente,
        chave: `${p.codigo}:v${p.versao}:curso${curso}:ciclo${e.numero}${e.reducaoPct ? `:reducao${e.reducaoPct}` : ''}`,
      }),
      (g) =>
        g.registrarCiclo({
          internacao: i.internacao,
          prontuario: i.prontuario,
          paciente: i.paciente,
          protocolo: p.id,
          codigoProtocolo: p.codigo,
          numero: e.numero,
          dataPrevista: e.dataPrevista,
          pesoKg: e.pesoKg,
          alturaCm: e.alturaCm,
          superficieM2: sc,
          creatininaMgDl: e.creatininaMgDl,
          clearanceMlMin: clearance,
          reducaoPct: e.reducaoPct,
          motivoReducao: e.motivoReducao ?? null,
          justificativaIntervalo: e.justificativaIntervalo ?? null,
          doses,
          curso,
          motivoCurso: e.novoTratamento ?? null,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    const alertas: string[] = [];
    if (e.novoTratamento)
      alertas.push(`Tratamento ${curso} com o protocolo ${p.codigo}: ${e.novoTratamento}.`);
    if (diasDesdeAnterior !== null && diasDesdeAnterior < p.intervaloDias)
      alertas.push(
        `Ciclo antecipado: ${diasDesdeAnterior} dia(s) desde o anterior (o protocolo pede ${p.intervaloDias}).`,
      );
    if (teto > 0 && sc === teto)
      alertas.push(`Superfície corporal limitada ao teto do estabelecimento (${teto} m²).`);
    return {
      ok: true,
      id,
      alertas,
      mensagem: `Ciclo ${e.numero} de ${p.codigo} registrado (superfície ${sc} m²); aguarda a validação farmacêutica. Os medicamentos são prescritos pela prescrição geral e ligados ao ciclo antes da validação.`,
    };
  }

  @Get('especialidades/oncologia/validacao')
  @Permissao(P.oncologiaValidar)
  @Auditar(E.especialidadeLida.codigo)
  async filaValidacao(@Req() req: RequisicaoAutorizada): Promise<FilaValidacaoOnco> {
    const s = sessaoDe(req);
    const [ciclos, ps] = await Promise.all([this.porta.ciclosAValidar(s.porta), this.protocolosLidos(s)]);
    const porId = new Map(ps.protocolos.map((p) => [p.id, p]));
    const itens: FilaValidacaoOnco['itens'] = [];
    for (const c of ciclos) {
      const i = await this.porta.internacao(s.porta, c.internacao);
      itens.push({
        ciclo: this.cicloLido(c, porId.get(c.protocolo) ?? null),
        internacao: c.internacao,
        nome: i?.nome ?? '',
        prontuario: i?.prontuario ?? 0,
      });
    }
    return { itens };
  }

  @Post('especialidades/oncologia/ciclos/:id/validar')
  @HttpCode(200)
  @Permissao(P.oncologiaValidar)
  @AuditadoNoHandler(
    'pep.validarCicloOncologico (ciclo_quimioterapia, uma vez, por outra pessoa) com a trilha de auditoria na mesma transação',
  )
  async validarCiclo(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaValidarCicloOncologico, b);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.validar');
    const c = await this.porta.ciclo(s.porta, idDaRota(idRota));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Ciclo não encontrado', 'O ciclo não existe.');
    if (c.situacao === 'validado')
      return recusaDominio(new ErroEspecialidade('ciclo-ja-validado', 'O ciclo já foi validado.'));
    if (c.por.trim().toUpperCase() === s.login.trim().toUpperCase())
      return recusaDominio(
        new ErroEspecialidade(
          'validador-e-prescritor',
          'A validação é de outra pessoa, não de quem prescreveu o ciclo.',
        ),
      );
    tentar(() => conferirPrescricaoParaValidar(c));
    await this.acesso.exigirVinculo(s, c.paciente, P.oncologiaValidar, 'pep.evolucao');
    // W0-05: a prescrição ligada tem de valer no dia previsto do ciclo (a validação é sobre as doses daquele dia).
    const doDia = await this.porta.prescricoesDoDia(s.porta, c.internacao, c.paciente, c.dataPrevista);
    if (!c.prescricoes.some((x) => doDia.some((d) => d.id === x && !d.suspensa)))
      return recusaDominio(
        new ErroEspecialidade(
          'prescricao-fora-do-dia',
          'Nenhuma prescrição ligada ao ciclo vale no dia previsto: ligue a prescrição vigente da data do ciclo antes da validação.',
        ),
      );
    const tolerancia = await this.parametro(s, 'oncologia', PARAMETRO_ONCO_TOLERANCIA, 5);
    const divergentes = tentar(() => duplaChecagem(c.doses, e.doses, tolerancia));
    if (divergentes.length > 0)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Dupla checagem divergente',
        `Doses fora da tolerância de ${tolerancia}%: ${divergentes
          .map(
            (d) => `${d.farmaco} (sistema ${d.sistema} mg, conferida ${d.informada} mg, ${d.diferencaPct}%)`,
          )
          .join('; ')}. Revise o cálculo com quem prescreveu.`,
        { codigo: 'dose-divergente' },
      );
    await this.apoio.oncologia.sgh(
      s,
      E.cicloOncologicoValidado.codigo,
      P.oncologiaValidar,
      {
        tabela: 'ciclo_quimioterapia',
        id: String(c.id),
        paciente: c.paciente,
        chave: `${c.codigoProtocolo}:ciclo${c.numero}:validado`,
      },
      (g) =>
        g.validarCiclo({
          id: c.id,
          doses: e.doses,
          observacao: e.observacao ?? null,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return { ok: true, id: c.id, alertas: [], mensagem: `Ciclo ${c.numero} validado com a dupla checagem.` };
  }

  /** O ciclo pela rota, com 404. */
  private async cicloDaRota(s: SessaoCadastro, idRota: string) {
    const c = await this.porta.ciclo(s.porta, idDaRota(idRota));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Ciclo não encontrado', 'O ciclo não existe.');
    return c;
  }

  @Get('especialidades/oncologia/ciclos/:id/prescricoes')
  @Permissao(P.oncologiaLer)
  @Auditar(E.especialidadeLida.codigo)
  async prescricoesDoCiclo(
    @Param('id') idRota: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PrescricoesDoCiclo> {
    const s = sessaoDe(req);
    const c = await this.cicloDaRota(s, idRota);
    await this.acesso.exigirVinculo(s, c.paciente, P.oncologiaLer, 'pep.evolucao');
    const ps = await this.porta.prescricoesDoDia(s.porta, c.internacao, c.paciente, c.dataPrevista);
    const ligadas = new Set(c.prescricoes);
    const itens = ps.map((x) => ({ ...x, vinculada: ligadas.has(x.id) }));
    // As ligadas que já não valem no dia continuam na lista (a ligação é só de inclusão).
    for (const id of c.prescricoes)
      if (!ps.some((x) => x.id === id))
        itens.push({ id, inicio: '', fim: null, suspensa: false, itens: 0, vinculada: true });
    return { ciclo: c.id, dataPrevista: c.dataPrevista, itens };
  }

  @Post('especialidades/oncologia/ciclos/:id/prescricoes')
  @HttpCode(200)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarCicloOncologico (a ligação com a prescrição em ciclo_quimioterapia_prescricao) com a trilha de auditoria na mesma transação',
  )
  async vincularPrescricao(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaVincularPrescricaoCiclo, b);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.registrar');
    const c = await this.cicloDaRota(s, idRota);
    const i = await this.internacaoAberta(s, c.internacao, P.oncologiaRegistrar);
    const candidatas = await this.porta.prescricoesDoDia(s.porta, i.internacao, i.paciente, c.dataPrevista);
    tentar(() => conferirVinculoPrescricao(c, e.prescricao, candidatas));
    await this.apoio.oncologia.sgh(
      s,
      E.cicloOncologicoPrescricaoVinculada.codigo,
      P.oncologiaRegistrar,
      {
        tabela: 'ciclo_quimioterapia_prescricao',
        id: String(c.id),
        paciente: c.paciente,
        chave: `${c.codigoProtocolo}:curso${c.curso}:ciclo${c.numero}:prescricao${e.prescricao}`,
      },
      (g) =>
        g.vincularPrescricao({
          ciclo: c.id,
          prescricao: e.prescricao,
          dataPrevista: c.dataPrevista,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: c.id,
      alertas: [],
      mensagem: `Prescrição ${e.prescricao} ligada ao ciclo ${c.numero} de ${c.codigoProtocolo}.`,
    };
  }

  // ── Obstetrícia ────────────────────────────────────────────────────────────────────────────────

  @Get('especialidades/obstetricia/internacoes/:reg')
  @Permissao(P.obstetriciaLer)
  @Auditar(E.especialidadeLida.codigo)
  async obstetricia(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada): Promise<ObstetriciaLida> {
    const s = sessaoDe(req);
    const i = await this.internacaoLida(s, reg, P.obstetriciaLer);
    // A fase ativa do estabelecimento antes dos pontos: os alertas relidos usam o mesmo parâmetro da gravação.
    const faseAtivaCm = await this.parametro(
      s,
      'obstetricia',
      PARAMETRO_OBST_FASE_ATIVA,
      FASE_ATIVA_CM_PADRAO,
    );
    const [cab, pontos, rns, tipos, relogio] = await Promise.all([
      this.cabecalho(s, i),
      this.porta.partograma(s.porta, i.internacao, faseAtivaCm),
      this.porta.recemNascidos(s.porta, i.internacao),
      this.porta.tiposParto(s.porta),
      this.porta.relogio(s.porta),
    ]);
    const nomes = new Map(tipos.map((t) => [t.codigo, t.nome]));
    return {
      internacao: cab,
      pontos,
      linhas: linhasDoPartograma(pontos, faseAtivaCm),
      recemNascidos: rns.map((r) => ({ ...r, tipoParto: nomes.get(r.tipoParto) ?? `Tipo ${r.tipoParto}` })),
      tiposParto: tipos,
      faseAtivaCm,
      agora: relogio.agora,
    };
  }

  @Post('especialidades/obstetricia/partograma')
  @HttpCode(201)
  @Permissao(P.obstetriciaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarPartograma (partograma_registro) com a trilha de auditoria na mesma transação',
  )
  async registrarPartograma(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarPartograma, b);
    await this.apoio.obstetricia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'obstetricia.registrar');
    const i = await this.internacaoAberta(s, e.internacao, P.obstetriciaRegistrar);
    const faseAtivaCm = await this.parametro(
      s,
      'obstetricia',
      PARAMETRO_OBST_FASE_ATIVA,
      FASE_ATIVA_CM_PADRAO,
    );
    const [{ agora }, anteriores] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.partograma(s.porta, i.internacao, faseAtivaCm),
    ]);
    const r = tentar(() => conferirPartograma(e, { admissao: i.admissao, agora, anteriores, faseAtivaCm }));
    const id = await this.apoio.obstetricia.sgh(
      s,
      E.partogramaRegistrado.codigo,
      P.obstetriciaRegistrar,
      (x: number) => ({
        tabela: 'partograma_registro',
        id: String(x),
        paciente: i.paciente,
        chave: `${i.internacao}:alertas:${r.alertas.length}`,
      }),
      (g) =>
        g.registrarPartograma({
          internacao: i.internacao,
          prontuario: i.prontuario,
          paciente: i.paciente,
          em: e.em,
          dilatacaoCm: e.dilatacaoCm,
          alturaApresentacao: e.alturaApresentacao,
          bcf: e.bcf,
          contracoes10min: e.contracoes10min,
          duracaoContracaoS: e.duracaoContracaoS,
          bolsa: e.bolsa,
          liquido: e.liquido,
          paSistolica: e.paSistolica,
          paDiastolica: e.paDiastolica,
          temperatura: e.temperatura,
          ocitocina: e.ocitocina,
          observacao: e.observacao ?? null,
          alertas: r.alertas,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      alertas: r.alertas,
      mensagem: `Registro do partograma salvo${r.alertas.length ? ` com ${r.alertas.length} alerta(s)` : ''}.`,
    };
  }

  @Post('especialidades/obstetricia/recem-nascidos')
  @HttpCode(201)
  @Permissao(P.obstetriciaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarRecemNascido (registro_nascimento) com a trilha de auditoria na mesma transação',
  )
  async registrarRecemNascido(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarRecemNascido, b);
    await this.apoio.obstetricia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'obstetricia.registrar');
    const i = await this.internacaoAberta(s, e.internacao, P.obstetriciaRegistrar);
    const [{ agora }, tipos] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.tiposParto(s.porta),
    ]);
    const r = tentar(() =>
      conferirRecemNascido(e, {
        sexoMae: i.sexo,
        tiposParto: new Set(tipos.map((t) => t.codigo)),
        admissao: i.admissao,
        agora,
      }),
    );
    const id = await this.apoio.obstetricia.sgh(
      s,
      E.recemNascidoRegistrado.codigo,
      P.obstetriciaRegistrar,
      (x: number) => ({
        tabela: 'registro_nascimento',
        id: String(x),
        paciente: i.paciente,
        chave: `${i.internacao}:rn`,
      }),
      (g) =>
        g.registrarRecemNascido({
          internacao: i.internacao,
          prontuario: i.prontuario,
          paciente: i.paciente,
          nascimentoEm: e.nascimentoEm,
          sexo: e.sexo,
          pesoG: e.pesoG,
          comprimentoCm: e.comprimentoCm,
          perimetroCefalicoCm: e.perimetroCefalicoCm,
          apgar1: e.apgar1,
          apgar5: e.apgar5,
          apgar10: e.apgar10,
          igSemanas: e.igSemanas,
          igDias: e.igDias,
          tipoParto: e.tipoParto,
          reanimacao: e.reanimacao,
          classificacaoIg: r.classificacaoIg,
          classificacaoPeso: r.classificacaoPeso,
          classificacaoApgar: r.classificacaoApgar,
          observacao: e.observacao ?? null,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      alertas: r.alertas,
      mensagem: `Recém-nascido registrado: ${r.classificacaoIg}; ${r.classificacaoPeso}; ${r.classificacaoApgar}.`,
    };
  }

  // ── Lactário ───────────────────────────────────────────────────────────────────────────────────

  private async ordemLida(
    s: SessaoCadastro,
    o: OrdemLactarioRegistrada,
    agora: string,
    log: readonly AlteracaoLactarioRegistrada[] = [],
  ) {
    const i = await this.porta.internacao(s.porta, o.internacao);
    return {
      id: o.id,
      internacao: o.internacao,
      nome: i?.nome ?? '',
      prontuario: o.prontuario,
      nascimento: i?.nascimento ?? null,
      leito: i
        ? { bloco: i.bloco, acomodacao: i.acomodacao, leito: i.leito }
        : { bloco: '-', acomodacao: '-', leito: '-' },
      formula: o.formula,
      volumeMl: o.volumeMl,
      horarios: o.horarios,
      preparoEm: o.preparoEm,
      validadeEm: o.validadeEm,
      lote: o.lote,
      observacao: o.observacao,
      situacao: o.situacao,
      vencida: o.validadeEm <= agora,
      por: o.por,
      em: o.em,
      conferidoPor: o.conferidoPor,
      conferidoEm: o.conferidoEm,
      cancelada: o.canceladaEm !== null,
      canceladaPor: o.canceladaPor,
      canceladaEm: o.canceladaEm,
      motivoCancelamento: o.motivoCancelamento,
      etiquetaEm: o.etiquetaEm,
      historico: log
        .filter((x) => x.idRegistro === o.id)
        .map((x) => ({
          id: x.id,
          evento: x.evento,
          antes: x.antes,
          depois: x.depois,
          motivo: x.motivo,
          por: x.por,
          em: x.em,
        })),
    };
  }

  @Get('nutricao/lactario')
  @Permissao(P.lactarioLer)
  @Auditar(E.lactarioLido.codigo)
  async lactario(@Req() req: RequisicaoAutorizada, @Query('data') data?: string): Promise<ProducaoLactario> {
    const s = sessaoDe(req);
    const { agora, hoje } = await this.porta.relogio(s.porta);
    const dia = data && DATA.test(data) ? data : hoje;
    const ordens = await this.porta.ordensDoDia(s.porta, dia);
    const log = await this.porta.alteracoesOrdens(
      s.porta,
      ordens.map((o) => o.id),
    );
    const lidas = [];
    for (const o of ordens) lidas.push(await this.ordemLida(s, o, agora, log));
    return {
      data: dia,
      ordens: lidas,
      // A ordem cancelada continua na lista, mas não entra nos totais da produção.
      totais: totaisDoLactario(ordens.filter((o) => o.canceladaEm === null)),
      validadeHoras: await this.parametro(s, 'lactario', PARAMETRO_LACTARIO_VALIDADE, 24),
      lidoEm: agora,
    };
  }

  @Post('nutricao/lactario/ordens')
  @HttpCode(201)
  @Permissao(P.lactarioProduzir)
  @AuditadoNoHandler(
    'internacao.registrarProducaoLactario (preparo_lactario_item) com a trilha de auditoria na mesma transação',
  )
  async registrarOrdem(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarOrdemLactario, b);
    await this.apoio.lactario.exigirLiberacao(s);
    const i = await this.internacaoAberta(s, e.internacao, P.lactarioProduzir);
    const { agora } = await this.porta.relogio(s.porta);
    const validadeHoras = await this.parametro(s, 'lactario', PARAMETRO_LACTARIO_VALIDADE, 24);
    const r = tentar(() => conferirOrdemLactario(e, { agora, validadeHoras, admissao: i.admissao }));
    const id = await this.apoio.lactario.sgh(
      s,
      E.ordemLactarioRegistrada.codigo,
      P.lactarioProduzir,
      (x: number) => ({
        tabela: 'preparo_lactario_item',
        id: String(x),
        paciente: i.paciente,
        chave: `${i.internacao}:${r.porcoes.length}:${e.volumeMl}`,
      }),
      (g) =>
        g.registrarOrdem({
          internacao: i.internacao,
          prontuario: i.prontuario,
          paciente: i.paciente,
          formula: e.formula,
          volumeMl: e.volumeMl,
          horarios: r.porcoes.map((p) => p.horario),
          preparoEm: e.preparoEm,
          validadeEm: r.validadeEm,
          lote: e.lote ?? null,
          observacao: e.observacao ?? null,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      alertas: [],
      mensagem: `Ordem registrada: ${r.porcoes.length} porção(ões) de ${e.volumeMl} mL, validade até ${dm(r.validadeEm)}. A conferência é de outra pessoa.`,
    };
  }

  @Post('nutricao/lactario/ordens/:id/conferir')
  @HttpCode(200)
  @Permissao(P.lactarioProduzir)
  @AuditadoNoHandler(
    'internacao.registrarProducaoLactario (a conferência por outra pessoa) com a trilha de auditoria na mesma transação',
  )
  async conferirOrdem(
    @Param('id') idRota: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    await this.apoio.lactario.exigirLiberacao(s);
    const o = await this.porta.ordem(s.porta, idDaRota(idRota));
    if (!o) throw new ErroProblema('nao-encontrado', 404, 'Ordem não encontrada', 'A ordem não existe.');
    const { agora } = await this.porta.relogio(s.porta);
    tentar(() => exigirOrdemNaoCancelada(o));
    tentar(() => conferirConferencia(o, s.login, agora));
    await this.acesso.exigirVinculo(s, o.paciente, P.lactarioProduzir, 'pep.evolucao');
    await this.apoio.lactario.sgh(
      s,
      E.ordemLactarioConferida.codigo,
      P.lactarioProduzir,
      {
        tabela: 'preparo_lactario_item',
        id: String(o.id),
        paciente: o.paciente,
        chave: `${o.internacao}:conferida`,
      },
      (g) => g.conferirOrdem({ id: o.id, usuario: s.login }),
    );
    return {
      ok: true,
      id: o.id,
      alertas: [],
      mensagem: 'Ordem conferida: as etiquetas podem ser impressas.',
    };
  }

  @Post('nutricao/lactario/ordens/:id/etiquetas')
  @HttpCode(200)
  @Permissao(P.lactarioProduzir)
  @AuditadoNoHandler(
    'etiquetas do lactário em ZPL: a trilha registra a impressão (ordem, quantidade e o hash)',
  )
  async etiquetas(@Param('id') idRota: string, @Req() req: RequisicaoAutorizada): Promise<EtiquetasLactario> {
    const s = sessaoDe(req);
    await this.apoio.lactario.exigirLiberacao(s);
    const o = await this.porta.ordem(s.porta, idDaRota(idRota));
    if (!o) throw new ErroProblema('nao-encontrado', 404, 'Ordem não encontrada', 'A ordem não existe.');
    const { agora } = await this.porta.relogio(s.porta);
    tentar(() => exigirOrdemNaoCancelada(o));
    tentar(() => conferirEtiquetaLactario(o, agora));
    const i = await this.porta.internacao(s.porta, o.internacao);
    if (!i)
      throw new ErroProblema('nao-encontrado', 404, 'Internação não encontrada', 'A internação não existe.');
    await this.acesso.exigirVinculo(s, i.paciente, P.lactarioProduzir, 'pep.evolucao');
    let zpls: string[];
    try {
      zpls = porcoesDaOrdem(o.preparoEm, o.horarios).map((p) =>
        zplEtiquetaLactario({
          nomeCompleto: i.nome,
          nascimento: i.nascimento ?? '',
          prontuario: i.prontuario,
          internacao: i.internacao,
          ordem: o.id,
          leito: `${i.bloco} ${i.acomodacao} ${i.leito}`,
          formula: o.formula,
          volumeMl: o.volumeMl,
          horario: dm(p.em),
          preparo: dm(o.preparoEm),
          validade: dm(o.validadeEm),
          lote: o.lote,
          conferidoPor: o.conferidoPor ?? '',
        }),
      );
    } catch (x) {
      if (x instanceof ErroZpl)
        throw new ErroProblema('recusa-de-negocio', 409, 'Etiqueta sem identificador', x.message, {
          codigo: 'sem-identificador',
        });
      throw x;
    }
    const conteudo = zpls.join('');
    let fila: EtiquetasLactario['fila'] = null;
    if (this.documento) {
      const bruto = s.req.headers['idempotency-key'];
      const k = Array.isArray(bruto) ? bruto[0] : bruto;
      if (typeof k !== 'string' || k.length < 8)
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Pedido incompleto',
          'Falta a Idempotency-Key do pedido de impressão.',
        );
      try {
        fila = await enfileirarZpl(
          {
            chaveIdempotencia: k,
            rede: s.rede || 'rede',
            estabelecimento: s.hospital,
            estacao: estacaoDaRequisicao(s.req)
              .replace(/[^A-Za-z0-9._-]/g, '-')
              .slice(0, 64),
            modelo: 'etiqueta-lactario',
            zpl: conteudo,
          },
          this.documento.armazem,
          this.documento.destino,
          this.documento.novoId,
        );
      } catch {
        throw new ErroProblema(
          'indisponivel',
          503,
          'Fila de impressão indisponível',
          'Não foi possível mandar à impressora da estação agora: tente de novo.',
        );
      }
    }
    // W0-05: a primeira etiqueta emitida fica na ordem (o cancelamento depois dela avisa o descarte) e cada emissão no
    // log da ordem.
    await this.apoio.lactario.sgh(
      s,
      E.etiquetaLactarioImpressa.codigo,
      P.lactarioProduzir,
      {
        tabela: 'preparo_lactario_item',
        id: String(o.id),
        paciente: o.paciente,
        chave: `etiqueta-lactario:${zpls.length}:${createHash('sha256').update(conteudo).digest('hex').slice(0, 16)}`,
      },
      async (g) => {
        await g.marcarEtiqueta({ id: o.id });
        return g.registrarAlteracao({
          id: o.id,
          evento: 'etiqueta-emitida',
          antes: null,
          depois: String(zpls.length),
          motivo: null,
          usuario: s.login,
        });
      },
    );
    return {
      formato: 'zpl',
      conteudo,
      nomeArquivo: `lactario-${o.id}.zpl`,
      etiquetas: zpls.length,
      fila,
    };
  }

  // ── W0-05: ciclo de vida do protocolo e do ciclo; alteração e cancelamento da ordem do lactário ──

  /**
   * W0-05: as operações críticas (revogar a versão, inativar o protocolo, cancelar o ciclo) pedem a senha de novo
   * (reautenticação, SBIS-07), como na ficha do profissional; a senha vem no corpo e nunca chega à entrada.
   */
  private async senhaDeNovo(req: RequisicaoAutorizada, b: unknown): Promise<unknown> {
    let senha: string | undefined;
    let resto = b;
    if (b && typeof b === 'object' && 'senha' in b) {
      const { senha: x, ...r } = b as Record<string, unknown>;
      senha = typeof x === 'string' ? x : undefined;
      resto = r;
    }
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
    return resto;
  }

  /** A versão do protocolo pela rota, com 404. */
  private async versaoDaRota(s: SessaoCadastro, idRota: string) {
    const p = await this.porta.protocolo(s.porta, idDaRota(idRota));
    if (!p)
      throw new ErroProblema('nao-encontrado', 404, 'Protocolo não encontrado', 'O protocolo não existe.');
    return p;
  }

  /** Os ciclos que usam a versão: a contagem (em andamento e total) e a lista, para a revogação. */
  private async dependencias(s: SessaoCadastro, p: { id: number; codigo: string; versao: number }) {
    const d = await this.porta.ciclosDaVersao(s.porta, p.id);
    // As contagens vêm do banco (não da lista, que é cortada no teto); `cortada` avisa a tela.
    return {
      protocolo: p.id,
      codigo: p.codigo,
      versao: p.versao,
      emAndamento: d.emAndamento,
      total: d.total,
      cortada: d.cortada,
      ciclos: d.itens,
    };
  }

  @Get('especialidades/oncologia/protocolos/:id/dependencias')
  @Permissao(P.oncologiaLer)
  @Auditar(E.especialidadeLida.codigo)
  async dependenciasProtocolo(
    @Param('id') idRota: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DependenciasProtocolo> {
    const s = sessaoDe(req);
    return this.dependencias(s, await this.versaoDaRota(s, idRota));
  }

  @Post('especialidades/oncologia/protocolos/:id/revogar')
  @HttpCode(200)
  @Permissao(P.oncologiaPublicarProtocolo)
  @AuditadoNoHandler(
    'pep.publicarProtocoloOncologico (a revogação da versão em evento_tratamento_oncologico, sem exclusão) com a trilha de auditoria',
  )
  async revogarVersao(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const { senha, ...semSenha } = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    const e = corpo(esquemaRevogarVersaoProtocolo, semSenha);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.publicar');
    const p = await this.versaoDaRota(s, idRota);
    const d = await this.dependencias(s, p);
    // Nenhum dado órfão: com ciclos em andamento, a revogação mostra quantos e quais (409) e só segue com a ciência.
    // Os ciclos continuam com a versão deles; nenhum ciclo novo a usa.
    // A ciência vale sobre o número visto: mais ciclos em andamento que os vistos pede a lista de novo.
    const vistos = e.ciclosVistos ?? d.emAndamento;
    if (d.emAndamento > 0 && (!e.cienteDosCiclos || d.emAndamento > vistos))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Versão com ciclos em andamento',
        `${d.emAndamento} ciclo(s) em andamento usam a versão ${p.versao} de ${p.codigo}: eles continuam com ela, e nenhum ciclo novo a usará. Confirme a revogação com a ciência dos ciclos.${d.cortada ? ` A lista mostra os ${d.ciclos.length} mais recentes de ${d.total}.` : ''}`,
        {
          codigo: 'versao-com-ciclos',
          // Quais: um por linha (ciclo, curso, data, situação e andamento), sem dado de pessoa além da internação.
          bloqueios: d.ciclos
            .filter((x) => x.andamento !== 'cancelado')
            .map(
              (x) =>
                `Ciclo ${x.numero} (tratamento ${x.curso}) da internação ${x.internacao}, previsto em ${x.dataPrevista}: ${x.situacao}, ${x.andamento}`,
            ),
        },
      );
    // A lista dos ciclos sai antes da senha (a tela mostra e pede a ciência); a revogação em si é crítica.
    await this.senhaDeNovo(req, { senha });
    await this.apoio.oncologia.sgh(
      s,
      E.protocoloOncologicoAlterado.codigo,
      P.oncologiaPublicarProtocolo,
      (x: number) => ({
        tabela: 'evento_tratamento_oncologico',
        id: String(x),
        chave: `${p.codigo}:v${p.versao}:revogada:${d.total}`,
      }),
      (g) =>
        g.revogarVersao({
          codigoProtocolo: p.codigo,
          protocolo: p.id,
          emAndamentoCiente: Math.min(vistos, d.emAndamento),
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: p.id,
      alertas: d.total > 0 ? [`${d.total} ciclo(s) continuam com a versão ${p.versao}.`] : [],
      mensagem: `Versão ${p.versao} de ${p.codigo} revogada: não é oferecida a ciclos novos.`,
    };
  }

  private async mudarProtocolo(
    req: RequisicaoAutorizada,
    idRota: string,
    b: unknown,
    evento: 'protocolo-inativado' | 'protocolo-reativado',
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSoMotivo, evento === 'protocolo-inativado' ? await this.senhaDeNovo(req, b) : b);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.publicar');
    const p = await this.versaoDaRota(s, idRota);
    const eventos = await this.porta.eventosProtocolos(s.porta);
    const oferta = ofertaDoProtocolo({ id: p.id, codigo: p.codigo, vigente: p.vigente }, eventos);
    if ((evento === 'protocolo-inativado') === oferta.inativo)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Protocolo sem mudança',
        oferta.inativo ? 'O protocolo já está inativo.' : 'O protocolo já está ativo.',
        { codigo: 'protocolo-sem-mudanca' },
      );
    await this.apoio.oncologia.sgh(
      s,
      E.protocoloOncologicoAlterado.codigo,
      P.oncologiaPublicarProtocolo,
      (x: number) => ({
        tabela: 'evento_tratamento_oncologico',
        id: String(x),
        chave: `${p.codigo}:${evento}`,
      }),
      (g) =>
        g.registrarEventoOnco({
          evento,
          codigoProtocolo: p.codigo,
          protocolo: null,
          ciclo: null,
          prescricao: null,
          categoria: null,
          ciclosAfetados: null,
          antes: null,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: p.id,
      alertas: [],
      mensagem:
        evento === 'protocolo-inativado'
          ? `Protocolo ${p.codigo} inativado: nenhuma versão é oferecida a ciclos novos; nada foi excluído.`
          : `Protocolo ${p.codigo} reativado: a versão vigente volta a ser oferecida (a revogada continua revogada).`,
    };
  }

  @Post('especialidades/oncologia/protocolos/:id/inativar')
  @HttpCode(200)
  @Permissao(P.oncologiaPublicarProtocolo)
  @AuditadoNoHandler(
    'pep.publicarProtocoloOncologico (a inativação em evento_tratamento_oncologico, sem exclusão) com a trilha de auditoria',
  )
  inativarProtocolo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.mudarProtocolo(req, id, b, 'protocolo-inativado');
  }

  @Post('especialidades/oncologia/protocolos/:id/reativar')
  @HttpCode(200)
  @Permissao(P.oncologiaPublicarProtocolo)
  @AuditadoNoHandler(
    'pep.publicarProtocoloOncologico (a reativação em evento_tratamento_oncologico) com a trilha de auditoria',
  )
  reativarProtocolo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.mudarProtocolo(req, id, b, 'protocolo-reativado');
  }

  @Post('especialidades/oncologia/ciclos/:id/ajustar')
  @HttpCode(200)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarCicloOncologico (o ajuste antes da validação; a versão anterior em evento_tratamento_oncologico) com a trilha de auditoria',
  )
  async ajustarCiclo(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAjustarCiclo, b);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.registrar');
    const c = await this.cicloDaRota(s, idRota);
    tentar(() => exigirCicloEditavel(c));
    if (e.reducaoPct > 0 && !e.motivoReducao)
      return recusaDominio(new ErroEspecialidade('motivo-reducao', 'A redução de dose pede o motivo.'));
    const i = await this.internacaoAberta(s, c.internacao, P.oncologiaRegistrar);
    const p = await this.porta.protocolo(s.porta, c.protocolo);
    if (!p)
      throw new ErroProblema('nao-encontrado', 404, 'Protocolo não encontrado', 'O protocolo não existe.');
    // A justificativa do intervalo: a nova, ou a que o ciclo já tinha se a data não muda.
    const justificativaIntervalo =
      e.justificativaIntervalo ?? (e.dataPrevista === c.dataPrevista ? c.justificativaIntervalo : null);
    // As regras da inclusão valem no ajuste: a ligação com a prescrição, a sequência e o intervalo do protocolo.
    const doCurso = (await this.porta.ciclosDoPaciente(s.porta, i.paciente)).filter(
      (x) => x.codigoProtocolo === c.codigoProtocolo && x.curso === c.curso && x.id !== c.id,
    );
    const { diasDesdeAnterior } = tentar(() =>
      conferirAjusteCiclo(
        c,
        { dataPrevista: e.dataPrevista, reducaoPct: e.reducaoPct, justificativaIntervalo },
        doCurso,
        p.intervaloDias,
      ),
    );
    const doses = tentar(() =>
      calcularDoses(p.farmacos, {
        superficieM2: c.superficieM2,
        pesoKg: c.pesoKg,
        clearanceMlMin: c.clearanceMlMin,
        reducaoPct: e.reducaoPct,
      }),
    );
    await this.apoio.oncologia.sgh(
      s,
      E.cicloOncologicoAlterado.codigo,
      P.oncologiaRegistrar,
      {
        tabela: 'ciclo_quimioterapia',
        id: String(c.id),
        paciente: c.paciente,
        chave: `${c.codigoProtocolo}:ciclo${c.numero}:ajustado`,
      },
      async (g) => {
        // A versão anterior (dado clínico) é a relida na transação, com a linha travada; vai no evento, nunca na trilha.
        const antes = await g.ajustarCiclo({
          id: c.id,
          dataPrevista: e.dataPrevista,
          reducaoPct: e.reducaoPct,
          motivoReducao: e.motivoReducao ?? null,
          justificativaIntervalo,
          doses,
        });
        return g.registrarEventoOnco({
          evento: 'ciclo-ajustado',
          codigoProtocolo: c.codigoProtocolo,
          protocolo: c.protocolo,
          ciclo: c.id,
          prescricao: null,
          categoria: null,
          ciclosAfetados: null,
          antes: JSON.stringify(antes),
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      id: c.id,
      alertas:
        diasDesdeAnterior !== null && diasDesdeAnterior < p.intervaloDias
          ? [
              `Ciclo antecipado: ${diasDesdeAnterior} dia(s) desde o anterior (o protocolo pede ${p.intervaloDias}).`,
            ]
          : [],
      mensagem: `Ciclo ${c.numero} ajustado (doses recalculadas); a versão anterior continua visível como inativa.`,
    };
  }

  private async interromperCiclo(
    req: RequisicaoAutorizada,
    idRota: string,
    b: unknown,
    acao: 'suspender' | 'retomar' | 'cancelar',
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e =
      acao === 'retomar'
        ? { categoria: null, ...corpo(esquemaSoMotivo, b) }
        : corpo(esquemaInterromperCiclo, acao === 'cancelar' ? await this.senhaDeNovo(req, b) : b);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.registrar');
    const c = await this.cicloDaRota(s, idRota);
    await this.acesso.exigirVinculo(s, c.paciente, P.oncologiaRegistrar, 'pep.evolucao');
    const t = tentar(() => transicaoDoCiclo(acao, c.andamento));
    const evento =
      acao === 'suspender' ? 'ciclo-suspenso' : acao === 'retomar' ? 'ciclo-retomado' : 'ciclo-cancelado';
    await this.apoio.oncologia.sgh(
      s,
      E.cicloOncologicoAlterado.codigo,
      P.oncologiaRegistrar,
      {
        tabela: 'ciclo_quimioterapia',
        id: String(c.id),
        paciente: c.paciente,
        chave: `${c.codigoProtocolo}:ciclo${c.numero}:${evento}${e.categoria ? `:${e.categoria}` : ''}`,
      },
      async (g) => {
        await g.mudarAndamentoCiclo({ id: c.id, de: t.de, para: t.para });
        return g.registrarEventoOnco({
          evento,
          codigoProtocolo: c.codigoProtocolo,
          protocolo: c.protocolo,
          ciclo: c.id,
          prescricao: null,
          categoria: e.categoria,
          ciclosAfetados: null,
          antes: null,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      id: c.id,
      alertas: [],
      mensagem:
        acao === 'suspender'
          ? `Ciclo ${c.numero} suspenso: sai da validação e da administração até ser retomado.`
          : acao === 'retomar'
            ? `Ciclo ${c.numero} retomado.`
            : `Ciclo ${c.numero} cancelado: continua visível no histórico do paciente.`,
    };
  }

  @Post('especialidades/oncologia/ciclos/:id/suspender')
  @HttpCode(200)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarCicloOncologico (a suspensão do ciclo, fato novo em evento_tratamento_oncologico) com a trilha de auditoria',
  )
  suspenderCiclo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.interromperCiclo(req, id, b, 'suspender');
  }

  @Post('especialidades/oncologia/ciclos/:id/retomar')
  @HttpCode(200)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarCicloOncologico (a retomada do ciclo em evento_tratamento_oncologico) com a trilha de auditoria',
  )
  retomarCiclo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.interromperCiclo(req, id, b, 'retomar');
  }

  @Post('especialidades/oncologia/ciclos/:id/cancelar')
  @HttpCode(200)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarCicloOncologico (o cancelamento do ciclo, fato novo em evento_tratamento_oncologico) com a trilha de auditoria',
  )
  cancelarCiclo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.interromperCiclo(req, id, b, 'cancelar');
  }

  @Post('especialidades/oncologia/ciclos/:id/prescricoes/:prescricao/desligar')
  @HttpCode(200)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler(
    'pep.registrarCicloOncologico (desfaz só a ligação ciclo_quimioterapia_prescricao; a prescrição não é tocada) com a trilha de auditoria',
  )
  async desligarPrescricao(
    @Param('id') idRota: string,
    @Param('prescricao') prescricaoRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSoMotivo, b);
    await this.apoio.oncologia.exigirLiberacao(s);
    const v = await this.vinculoDa(s, 'oncologia.registrar');
    const c = await this.cicloDaRota(s, idRota);
    const prescricao = idDaRota(prescricaoRota);
    await this.acesso.exigirVinculo(s, c.paciente, P.oncologiaRegistrar, 'pep.evolucao');
    tentar(() => exigirLigacaoDesfazivel(c, prescricao));
    await this.apoio.oncologia.sgh(
      s,
      E.cicloOncologicoPrescricaoDesligada.codigo,
      P.oncologiaRegistrar,
      {
        tabela: 'ciclo_quimioterapia_prescricao',
        id: String(c.id),
        paciente: c.paciente,
        chave: `${c.codigoProtocolo}:curso${c.curso}:ciclo${c.numero}:prescricao${prescricao}:desligada`,
      },
      async (g) => {
        await g.desligarPrescricao({ ciclo: c.id, prescricao });
        return g.registrarEventoOnco({
          evento: 'prescricao-desligada',
          codigoProtocolo: c.codigoProtocolo,
          protocolo: c.protocolo,
          ciclo: c.id,
          prescricao,
          categoria: null,
          ciclosAfetados: null,
          antes: null,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      id: c.id,
      alertas: [],
      mensagem: `Ligação com a prescrição ${prescricao} desfeita; a prescrição não foi alterada.`,
    };
  }

  /** A ordem do lactário pela rota, com 404. */
  private async ordemDaRota(s: SessaoCadastro, idRota: string) {
    const o = await this.porta.ordem(s.porta, idDaRota(idRota));
    if (!o) throw new ErroProblema('nao-encontrado', 404, 'Ordem não encontrada', 'A ordem não existe.');
    return o;
  }

  @Post('nutricao/lactario/ordens/:id/alterar')
  @HttpCode(200)
  @Permissao(P.lactarioProduzir)
  @AuditadoNoHandler(
    'internacao.registrarProducaoLactario (a alteração antes da conferência e o log em preparo_lactario_item_evento) com a trilha de auditoria',
  )
  async alterarOrdem(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarOrdemLactario, b);
    await this.apoio.lactario.exigirLiberacao(s);
    const o = await this.ordemDaRota(s, idRota);
    // Depois da conferência a etiqueta pode ter sido impressa: 409 e só o cancelamento é oferecido.
    if (o.canceladaEm === null && o.situacao === 'conferida')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Ordem conferida',
        'A ordem já foi conferida e a etiqueta pode ter sido impressa: não se altera. Cancele a ordem com o motivo e faça outra.',
        { codigo: 'ordem-ja-conferida', avisos: ['acao:cancelar'] },
      );
    tentar(() => exigirOrdemAlteravel(o));
    const i = await this.internacaoAberta(s, o.internacao, P.lactarioProduzir);
    const { agora } = await this.porta.relogio(s.porta);
    const validadeHoras = await this.parametro(s, 'lactario', PARAMETRO_LACTARIO_VALIDADE, 24);
    const r = tentar(() =>
      conferirOrdemLactario(
        {
          internacao: i.internacao,
          formula: e.formula,
          volumeMl: e.volumeMl,
          horarios: e.horarios,
          preparoEm: e.preparoEm,
        },
        { agora, validadeHoras, admissao: i.admissao },
      ),
    );
    // O valor anterior e o novo com tudo o que o UPDATE troca (a validade e a observação também).
    const valor = (x: {
      formula: string;
      volumeMl: number;
      horarios: readonly string[];
      preparoEm: string;
      validadeEm: string;
      lote: string | null;
      observacao: string | null;
    }) =>
      JSON.stringify({
        formula: x.formula,
        volumeMl: x.volumeMl,
        horarios: [...x.horarios],
        preparoEm: x.preparoEm,
        validadeEm: x.validadeEm,
        lote: x.lote,
        observacao: x.observacao,
      });
    const novo = {
      formula: e.formula,
      volumeMl: e.volumeMl,
      horarios: r.porcoes.map((p) => p.horario),
      preparoEm: e.preparoEm,
      validadeEm: r.validadeEm,
      lote: e.lote ?? null,
      observacao: e.observacao ?? o.observacao,
    };
    await this.apoio.lactario.sgh(
      s,
      E.ordemLactarioAlterada.codigo,
      P.lactarioProduzir,
      {
        tabela: 'preparo_lactario_item',
        id: String(o.id),
        paciente: o.paciente,
        chave: `${o.internacao}:alterada`,
      },
      async (g) => {
        // O anterior é o relido na transação (linha travada): duas alterações simultâneas não perdem a versão do meio.
        const antes = await g.alterarOrdem({ id: o.id, ...novo });
        return g.registrarAlteracao({
          id: o.id,
          evento: 'alterada',
          antes: valor(antes),
          depois: valor(novo),
          motivo: e.motivo.slice(0, 200),
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      id: o.id,
      alertas: [],
      mensagem: `Ordem alterada: ${r.porcoes.length} porção(ões) de ${e.volumeMl} mL, validade até ${dm(r.validadeEm)}.`,
    };
  }

  @Post('nutricao/lactario/ordens/:id/cancelar')
  @HttpCode(200)
  @Permissao(P.lactarioProduzir)
  @AuditadoNoHandler(
    'internacao.registrarProducaoLactario (o cancelamento lógico com o motivo e o log em preparo_lactario_item_evento) com a trilha de auditoria',
  )
  async cancelarOrdem(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEspecialidade> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSoMotivo, b);
    await this.apoio.lactario.exigirLiberacao(s);
    const o = await this.ordemDaRota(s, idRota);
    tentar(() => exigirOrdemNaoCancelada(o));
    await this.acesso.exigirVinculo(s, o.paciente, P.lactarioProduzir, 'pep.evolucao');
    await this.apoio.lactario.sgh(
      s,
      E.ordemLactarioCancelada.codigo,
      P.lactarioProduzir,
      {
        tabela: 'preparo_lactario_item',
        id: String(o.id),
        paciente: o.paciente,
        chave: `${o.internacao}:cancelada${o.etiquetaEm ? ':etiquetada' : ''}`,
      },
      async (g) => {
        await g.cancelarOrdem({ id: o.id, motivo: e.motivo.slice(0, 200), usuario: s.login });
        return g.registrarAlteracao({
          id: o.id,
          evento: 'cancelada',
          antes: o.situacao,
          depois: 'cancelada',
          motivo: e.motivo.slice(0, 200),
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      id: o.id,
      alertas: o.etiquetaEm ? ['A etiqueta já foi emitida: recolha e descarte as porções etiquetadas.'] : [],
      mensagem: 'Ordem cancelada com o motivo; continua visível como cancelada.',
    };
  }
}

const ROTULO_VISAO: Readonly<Record<string, string>> = {
  normal: 'visão sem deficiência',
  reduzida: 'visão reduzida',
  'baixa-visao': 'baixa visão',
  cegueira: 'cegueira',
  'sem-dado': 'sem acuidade registrada',
};
