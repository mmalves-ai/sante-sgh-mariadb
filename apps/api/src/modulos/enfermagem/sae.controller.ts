// Processo de enfermagem (SAE) e prescrição de enfermagem aprazada e checada (M45, etapa 4; ficha, seções 4, 5, 7 e 8;
// regras 7, 8, 15 e 16):
//   GET  /api/enfermagem/sae/unidades | unidades/:unidade/pacientes   a escolha do paciente internado
//   GET  /api/enfermagem/sae/turno?unidade=                          a prescrição de enfermagem da unidade no turno
//   GET  /api/enfermagem/sae/terminologia                            a terminologia em uso (sistema, versão, licença)
//   POST /api/enfermagem/sae/terminologia                            enfermagem.carregarTerminologiaSae (crítica)
//   GET  /api/enfermagem/sae/:atendimento                            o processo, as etapas e os horários do turno
//   POST /api/enfermagem/sae/:atendimento                            enfermagem.registrarSae (versão nova; enfermeiro)
//   POST /api/enfermagem/sae/:atendimento/evolucao                   enfermagem.registrarSae (evolução; enfermeiro)
//   POST /api/enfermagem/sae/:atendimento/cuidados                   enfermagem.prescreverCuidado (enfermeiro)
//   POST /api/enfermagem/sae/:atendimento/cuidados/:id/suspensao     a suspensão com o motivo (enfermeiro)
//   POST /api/enfermagem/sae/:atendimento/cuidados/:id/checagem      enfermagem.checarCuidado (enfermeiro e técnico)
//   POST /api/enfermagem/sae/:atendimento/checagens/:id/estorno      o estorno justificado
// Só do novo (SGH_), com a SGH_TRILHA na mesma transação e o ator real; o estabelecimento vem da sessão. SAE, diagnóstico
// e prescrição de enfermagem são privativos do enfermeiro (403 `so-enfermeiro`, conferido no servidor pelo vínculo); o
// técnico executa e checa. A funcionalidade nasce desligada (chave `enfermagem.sae`, POL-3).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  CHAVE_LIBERACAO_SAE,
  type CuidadosDoTurno,
  esquemaCarregarTerminologiaSae,
  esquemaChecarCuidado,
  esquemaEstornarCuidado,
  esquemaEvoluirSae,
  esquemaPrescreverCuidado,
  esquemaRegistrarSae,
  esquemaSuspenderCuidado,
  EVENTOS_AUDITAVEIS,
  type GravacaoSae,
  PERMISSOES_SAE as P,
  type ResultadoSae,
  type SaeDoPaciente,
} from '@sgh/contratos';
import {
  conferirChecagemCuidado,
  conferirEstornoCuidado,
  conferirEvolucao,
  conferirPrescricaoCuidado,
  conferirSae,
  conferirTerminologia,
  etapasDoProcesso,
  fimDaAtividade,
  podeChecarCuidado,
  somarMinutos,
  turnoDoInstante,
} from '@sgh/dominio-enfermagem';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { type GravadorSae, PORTA_SAE, type PortaSae } from './sae-porta.js';
import { ServicoSae } from './sae-servico.js';

const E = EVENTOS_AUDITAVEIS;
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const EXTRAS = {
  registrar: P.saeRegistrar,
  prescrever: P.cuidadoPrescrever,
  checar: P.cuidadoChecar,
  estornar: P.cuidadoEstornar,
} as const;

function unidadeDe(v: string | undefined): string {
  const u = (v ?? '').trim();
  if (!UNIDADE.test(u))
    throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
  return u;
}

/** A chave do ato (o mesmo cabeçalho Idempotency-Key das outras gravações). */
export function chaveDoPedido(s: SessaoCadastro): string {
  const bruto = s.req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'Falta a Idempotency-Key do pedido de gravação.',
    );
  return k;
}

/** A recusa do domínio em Problem Details: a versão que mudou é conflito (409); o resto, entrada inválida (422). */
export function recusaHttp(
  titulo: string,
  r: { codigo: string; mensagem: string; campo?: string },
): ErroProblema {
  const conflito = ['sae-mudou', 'ja-checado', 'ja-estornado', 'dose-ja-registrada'].includes(r.codigo);
  return new ErroProblema(
    conflito ? 'recusa-de-negocio' : 'entrada-invalida',
    conflito ? 409 : 422,
    titulo,
    r.mensagem,
    { codigo: r.codigo, ...(r.campo ? { campos: [r.campo] } : {}) },
  );
}

const SO_ENFERMEIRO = () =>
  new ErroProblema(
    'sem-permissao',
    403,
    'Ato privativo do enfermeiro',
    'O processo de enfermagem, o diagnóstico e a prescrição de enfermagem são privativos do enfermeiro com o conselho ativo; o técnico executa e checa.',
    { codigo: 'so-enfermeiro' },
  );

@Controller('enfermagem/sae')
export class SaeController {
  private readonly apoio: ApoioGravacao<GravadorSae>;
  private readonly servico: ServicoSae;

  constructor(
    @Inject(PORTA_SAE) private readonly porta: PortaSae,
    @Inject(PORTA_ENFERMAGEM) private readonly enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_LIBERACAO_SAE,
        nome: 'o processo de enfermagem e a prescrição de enfermagem',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoSae(porta, enfermagem);
  }

  private async gravacao(s: SessaoCadastro): Promise<GravacaoSae> {
    const [g, v] = await Promise.all([
      this.apoio.gravacao(s, EXTRAS),
      this.servico.vinculo(s.porta, s.login),
    ]);
    const enfermeiro = v.categoria === 'enfermeiro';
    const enfermagem = podeChecarCuidado(v.categoria);
    const op = (k: keyof typeof EXTRAS, exige: boolean, motivo: string) => {
      const o = g.operacoes[k] ?? { pode: false, motivo: null };
      return o.pode && !exige ? { pode: false, motivo } : o;
    };
    return {
      ligada: g.ligada,
      motivo: g.motivo,
      enfermeiro,
      enfermagem,
      operacoes: {
        registrar: op('registrar', enfermeiro, 'Ato privativo do enfermeiro.'),
        prescrever: op('prescrever', enfermeiro, 'Ato privativo do enfermeiro.'),
        checar: op('checar', enfermagem, 'A checagem é da enfermagem (enfermeiro ou técnico).'),
        estornar: op('estornar', enfermagem, 'O estorno é da enfermagem.'),
      },
    };
  }

  private async inicioTurno(s: SessaoCadastro): Promise<string> {
    const v = String((await this.apoio.parametroValor(s, 'enfermagem.inicioTurnoDiurno')) ?? '');
    return /^\d{4}$/.test(v) ? v : '0700';
  }

  /** O enfermeiro da sessão (vínculo 2235 ativo) ou 403. */
  private async enfermeiro(s: SessaoCadastro): Promise<number> {
    const v = await this.servico.vinculo(s.porta, s.login);
    if (v.categoria !== 'enfermeiro' || v.vinculo === null) throw SO_ENFERMEIRO();
    return v.vinculo;
  }

  @Get('unidades')
  @Permissao(P.saeLer)
  unidades(@Req() req: RequisicaoAutorizada) {
    return this.enfermagem.unidades(sessaoDe(req).porta);
  }

  @Get('unidades/:unidade/pacientes')
  @Permissao(P.saeLer)
  @Auditar(E.saeLida.codigo)
  async pacientes(@Param('unidade') unidade: string, @Req() req: RequisicaoAutorizada) {
    const u = unidadeDe(unidade);
    req.sghAlvo = { tabelaAlvo: 'internacao' };
    return (await this.enfermagem.internados(sessaoDe(req).porta, u)).map((i) => ({
      paciente: i.paciente,
      atendimento: i.atendimento,
      numero: i.numero,
      nome: i.nome,
      leito: i.leito,
      unidade: i.unidade,
    }));
  }

  @Get('turno')
  @Permissao(P.saeLer)
  @Auditar(E.saeLida.codigo)
  async turno(
    @Query('unidade') unidade: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CuidadosDoTurno> {
    const s = sessaoDe(req);
    const u = unidadeDe(unidade);
    const [inicio, gravacao] = await Promise.all([this.inicioTurno(s), this.gravacao(s)]);
    const r = await this.servico.turno(s.porta, u, { inicioTurnoDiurno: inicio, gravacao });
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PEP_SAE_ATIVIDADE',
      chaveNaturalAlvo: `unidade:${u};n:${r.horarios.length}`,
    };
    return r;
  }

  @Get('terminologia')
  @Permissao(P.saeLer)
  async terminologia(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const t = await this.servico.terminologia(s.porta);
    return {
      sistema: t.sistema,
      versao: t.versao,
      licenca: t.licenca,
      sintetica: t.sintetica,
      diagnosticos: t.diagnosticos.length,
      resultados: t.resultados.length,
      intervencoes: t.intervencoes.length,
      carregar: s.pode(P.terminologiaCarregar),
    };
  }

  @Post('terminologia')
  @HttpCode(201)
  @Permissao(P.terminologiaCarregar)
  @AuditadoNoHandler(
    'enfermagem.carregarTerminologiaSae: SGH_PEP_SAE_TERMO com a SGH_TRILHA na mesma transação',
  )
  async carregar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSae> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCarregarTerminologiaSae, b);
    const k = conferirTerminologia(e.termos);
    if (!k.ok) throw recusaHttp('Terminologia', k);
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    const r = await this.apoio.sgh(
      s,
      E.saeTerminologiaCarregada.codigo,
      P.terminologiaCarregar,
      { tabela: 'SGH_PEP_SAE_TERMO', id: null, chave: `${e.sistema}:${e.versao}` },
      (g) =>
        g.carregarTerminologia({
          sistema: e.sistema,
          versao: e.versao,
          licenca: e.licenca,
          termos: e.termos,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      ids: [],
      mensagem: `Terminologia ${e.sistema} ${e.versao} carregada: ${r.termos} termos.`,
    };
  }

  @Get(':atendimento')
  @Permissao(P.saeLer)
  @Auditar(E.saeLida.codigo)
  async paciente(
    @Param('atendimento') atendimento: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SaeDoPaciente> {
    const s = sessaoDe(req);
    const i = await this.servico.internado(s.porta, idDaRota(atendimento));
    req.sghAlvo = { paciente: i.paciente, tabelaAlvo: 'SGH_PEP_SAE' };
    const [t, dominios, gravacao, inicio, agora, grade] = await Promise.all([
      this.servico.terminologia(s.porta),
      this.servico.dominios(s.porta),
      this.gravacao(s),
      this.inicioTurno(s),
      this.enfermagem.relogio(s.porta),
      this.servico.grade(s.porta, i.unidade),
    ]);
    const { atual, versoes } = await this.servico.processo(s.porta, i.atendimento, t);
    const turno = turnoDoInstante(agora.slice(0, 16), inicio);
    const { horarios } = await this.servico.horarios(s.porta, [i], {
      de: turno.inicio,
      ate: turno.fim,
      agora: agora.slice(0, 16),
    });
    const { diagnosticos, resultados, intervencoes, ...terminologia } = t;
    return {
      atendimento: i.atendimento,
      paciente: i.paciente,
      numero: i.numero,
      nome: i.nome,
      leito: i.leito,
      unidade: i.unidade,
      agora: agora.slice(0, 16),
      terminologia,
      catalogo: { diagnosticos, resultados, intervencoes },
      dominios,
      atual,
      versoes,
      etapas: etapasDoProcesso(atual),
      horarios,
      grade,
      gravacao,
    };
  }

  @Post(':atendimento')
  @HttpCode(201)
  @Permissao(P.saeRegistrar)
  @AuditadoNoHandler(
    'enfermagem.registrarSae: SGH_PEP_SAE e SGH_PEP_SAE_ITEM com a SGH_TRILHA na mesma transação',
  )
  async registrar(
    @Param('atendimento') atendimento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSae> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarSae, b);
    const chave = chaveDoPedido(s);
    const i = await this.servico.internado(s.porta, idDaRota(atendimento));
    const vinculo = await this.enfermeiro(s);
    const [t, d, sae] = await Promise.all([
      this.servico.terminologia(s.porta),
      this.servico.dominios(s.porta),
      this.porta.sae(s.porta, i.atendimento),
    ]);
    const r = conferirSae(e, t, d, sae.cabecalho?.versao ?? 0);
    if (!r.ok) throw recusaHttp('Processo de enfermagem', r);
    const x = await this.apoio.sgh(
      s,
      E.saeRegistrada.codigo,
      P.saeRegistrar,
      (y: { id: number; versao: number }) => ({
        tabela: 'SGH_PEP_SAE',
        id: String(y.id),
        paciente: i.paciente,
        chave: `${i.atendimento}:v${y.versao}`,
      }),
      (g) =>
        g.registrarSae({
          paciente: i.paciente,
          atendimento: i.atendimento,
          versaoVista: e.versaoVista,
          sistema: t.sistema,
          versaoTerminologia: t.versao,
          avaliacao: r.avaliacao,
          diagnosticos: r.diagnosticos.map((dg) => ({
            codigo: dg.codigo,
            descricao: dg.descricao,
            caracteristicas: dg.caracteristicas.map((c) => c.codigo),
            fatores: dg.fatores.map((c) => c.codigo),
            resultados: dg.resultados,
            intervencoes: dg.intervencoes,
          })),
          vinculo,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      ids: [x.id],
      mensagem:
        x.versao === 1
          ? 'Processo de enfermagem registrado.'
          : `Processo de enfermagem revisado (versão ${x.versao}): as atividades da versão anterior param agora.`,
    };
  }

  @Post(':atendimento/evolucao')
  @HttpCode(201)
  @Permissao(P.saeRegistrar)
  @AuditadoNoHandler(
    'enfermagem.registrarSae (evolução): SGH_PEP_SAE_ITEM com a SGH_TRILHA na mesma transação',
  )
  async evoluir(
    @Param('atendimento') atendimento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSae> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEvoluirSae, b);
    const chave = chaveDoPedido(s);
    const i = await this.servico.internado(s.porta, idDaRota(atendimento));
    const vinculo = await this.enfermeiro(s);
    const [t, d] = await Promise.all([this.servico.terminologia(s.porta), this.servico.dominios(s.porta)]);
    const { atual } = await this.servico.processo(s.porta, i.atendimento, t);
    const r = conferirEvolucao(e, atual, d);
    if (!r.ok) throw recusaHttp('Evolução de enfermagem', r);
    const x = await this.apoio.sgh(
      s,
      E.saeEvoluida.codigo,
      P.saeRegistrar,
      (y: { ids: number[] }) => ({
        tabela: 'SGH_PEP_SAE_ITEM',
        id: String(y.ids[0] ?? ''),
        paciente: i.paciente,
        chave: `evolucao:${atual!.id}:${y.ids.length}`,
      }),
      (g) =>
        g.evoluir({
          sae: atual!.id,
          paciente: i.paciente,
          atendimento: i.atendimento,
          nota: r.nota,
          resultados: r.resultados,
          vinculo,
          usuario: s.login,
          chave,
        }),
    );
    const atingidas = r.resultados.filter((y) => y.situacao === 'atingida').length;
    return {
      ok: true,
      ids: x.ids,
      mensagem: `Evolução registrada: ${r.resultados.length} resultado(s) reavaliado(s), ${atingidas} com a meta atingida.`,
    };
  }

  @Post(':atendimento/cuidados')
  @HttpCode(201)
  @Permissao(P.cuidadoPrescrever)
  @AuditadoNoHandler('enfermagem.prescreverCuidado: SGH_PEP_SAE_ITEM com a SGH_TRILHA na mesma transação')
  async prescrever(
    @Param('atendimento') atendimento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSae> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPrescreverCuidado, b);
    const chave = chaveDoPedido(s);
    const i = await this.servico.internado(s.porta, idDaRota(atendimento));
    const vinculo = await this.enfermeiro(s);
    const [t, agora] = await Promise.all([
      this.servico.terminologia(s.porta),
      this.enfermagem.relogio(s.porta),
    ]);
    const { atual } = await this.servico.processo(s.porta, i.atendimento, t);
    const r = conferirPrescricaoCuidado(e.atividades, {
      processo: atual,
      versaoVista: e.versaoVista,
      terminologia: t,
      agora: agora.slice(0, 16),
    });
    if (!r.ok) throw recusaHttp('Prescrição de enfermagem', r);
    const x = await this.apoio.sgh(
      s,
      E.cuidadoPrescrito.codigo,
      P.cuidadoPrescrever,
      (y: { ids: number[] }) => ({
        tabela: 'SGH_PEP_SAE_ITEM',
        id: String(y.ids[0] ?? ''),
        paciente: i.paciente,
        chave: `cuidados:${atual!.id}:${y.ids.length}`,
      }),
      (g) =>
        g.prescrever({
          sae: atual!.id,
          paciente: i.paciente,
          atendimento: i.atendimento,
          atividades: r.atividades,
          vinculo,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      ids: x.ids,
      mensagem:
        x.ids.length === 1
          ? 'Cuidado prescrito e aprazado.'
          : `${x.ids.length} cuidados prescritos e aprazados.`,
    };
  }

  @Post(':atendimento/cuidados/:id/suspensao')
  @HttpCode(201)
  @Permissao(P.cuidadoPrescrever)
  @AuditadoNoHandler(
    'enfermagem.prescreverCuidado (suspensão): SGH_PEP_SAE_ITEM com a SGH_TRILHA na mesma transação',
  )
  async suspender(
    @Param('atendimento') atendimento: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSae> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSuspenderCuidado, b);
    const i = await this.servico.internado(s.porta, idDaRota(atendimento));
    const vinculo = await this.enfermeiro(s);
    const a = await this.porta.atividade(s.porta, idDaRota(id));
    if (!a || a.atendimento !== i.atendimento)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atividade não encontrada',
        'A atividade não é deste atendimento.',
      );
    if (a.suspensa)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Suspensão da atividade',
        'Esta atividade já foi suspensa.',
        {
          codigo: 'ja-suspensa',
        },
      );
    const novo = await this.apoio.sgh(
      s,
      E.cuidadoSuspenso.codigo,
      P.cuidadoPrescrever,
      (x: number) => ({
        tabela: 'SGH_PEP_SAE_ITEM',
        id: String(x),
        paciente: i.paciente,
        chave: `suspensao:${a.id}`,
      }),
      (g) =>
        g.suspender({
          atividade: a.id,
          atendimento: i.atendimento,
          motivo: e.motivo,
          vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      ids: [novo],
      mensagem: 'Atividade suspensa. Os horários seguintes saem da linha do tempo.',
    };
  }

  @Post(':atendimento/cuidados/:id/checagem')
  @HttpCode(201)
  @Permissao(P.cuidadoChecar)
  @AuditadoNoHandler('enfermagem.checarCuidado: SGH_PEP_SAE_ATIVIDADE com a SGH_TRILHA na mesma transação')
  async checar(
    @Param('atendimento') atendimento: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSae> {
    const s = sessaoDe(req);
    const e = corpo(esquemaChecarCuidado, b);
    const chave = chaveDoPedido(s);
    const i = await this.servico.internado(s.porta, idDaRota(atendimento));
    const v = await this.servico.vinculo(s.porta, s.login);
    if (!podeChecarCuidado(v.categoria) || v.vinculo === null)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Checagem da enfermagem',
        'A checagem do cuidado é da enfermagem (enfermeiro ou técnico com o vínculo ativo).',
        { codigo: 'so-enfermagem' },
      );
    const a = await this.porta.atividade(s.porta, idDaRota(id));
    if (!a || a.atendimento !== i.atendimento)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atividade não encontrada',
        'A atividade não é deste atendimento.',
      );
    const agora = (await this.enfermagem.relogio(s.porta)).slice(0, 16);
    const fim = fimDaAtividade(a, a.revisadoEm);
    const previsto = e.previsto.slice(0, 16);
    // As checagens do horário (o intervalo de um minuto do previsto): a vigente recusa; os estornos dão a geração.
    const { itens: doHorario } = await this.porta.checagens(s.porta, {
      atividades: [a.id],
      de: previsto,
      ate: somarMinutos(previsto, 1),
    });
    const r = conferirChecagemCuidado(e, { atividade: a, fim, agora, checagens: doHorario });
    if (!r.ok) throw recusaHttp('Checagem do cuidado', r);
    const x = await this.apoio.sgh(
      s,
      E.cuidadoChecado.codigo,
      P.cuidadoChecar,
      (y: { id: number }) => ({
        tabela: 'SGH_PEP_SAE_ATIVIDADE',
        id: String(y.id),
        paciente: i.paciente,
        chave: `${a.id}:${r.previsto.replace(/\D/g, '')}`,
      }),
      (g) =>
        g.checar({
          atividade: a.id,
          atendimento: i.atendimento,
          previsto: r.previsto,
          feita: e.feita,
          motivo: r.motivo,
          horaReal: r.horaReal,
          origemOffline: e.origemOffline,
          categoria: v.categoria as 'enfermeiro' | 'tecnico',
          vinculo: v.vinculo!,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      ids: [x.id],
      mensagem: x.repetida
        ? 'Esta checagem já estava registrada (o ato reenviado não grava de novo).'
        : e.feita
          ? 'Cuidado checado como feito.'
          : 'Cuidado registrado como não feito, com o motivo.',
    };
  }

  @Post(':atendimento/checagens/:id/estorno')
  @HttpCode(201)
  @Permissao(P.cuidadoEstornar)
  @AuditadoNoHandler(
    'enfermagem.checarCuidado (estorno): SGH_PEP_SAE_ATIVIDADE com a SGH_TRILHA na mesma transação',
  )
  async estornar(
    @Param('atendimento') atendimento: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSae> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEstornarCuidado, b);
    const i = await this.servico.internado(s.porta, idDaRota(atendimento));
    const v = await this.servico.vinculo(s.porta, s.login);
    if (!podeChecarCuidado(v.categoria) || v.vinculo === null)
      throw new ErroProblema('sem-permissao', 403, 'Estorno da checagem', 'O estorno é da enfermagem.', {
        codigo: 'so-enfermagem',
      });
    const c = await this.porta.checagem(s.porta, idDaRota(id));
    const k = conferirEstornoCuidado(c, i.atendimento);
    if (!k.ok)
      throw k.codigo === 'nao-encontrado'
        ? new ErroProblema('nao-encontrado', 404, 'Checagem não encontrada', k.mensagem, { codigo: k.codigo })
        : recusaHttp('Estorno da checagem', k);
    const novo = await this.apoio.sgh(
      s,
      E.cuidadoEstornado.codigo,
      P.cuidadoEstornar,
      (x: number) => ({
        tabela: 'SGH_PEP_SAE_ATIVIDADE',
        id: String(x),
        paciente: i.paciente,
        chave: `estorno:${id}`,
      }),
      (g) =>
        g.estornar({
          checagem: idDaRota(id),
          atendimento: i.atendimento,
          motivo: e.motivo,
          categoria: v.categoria as 'enfermeiro' | 'tecnico',
          vinculo: v.vinculo!,
          usuario: s.login,
        }),
    );
    return { ok: true, ids: [novo], mensagem: 'Checagem estornada. A checagem original fica guardada.' };
  }
}
