// W0-03, mercado M5 (critério 13): a contenção mecânica do paciente internado (Resolução COFEN 427/2012; no
// psiquiátrico, CFM 2.057/2013).
//   GET  /api/enfermagem/contencao/unidade?unidade           os internados com a ordem em curso (ativa ou vencida), os
//                                                           horários da checagem e o alerta da vencida (leitura auditada)
//   GET  /api/enfermagem/contencao/atendimentos/:atendimento  o histórico do paciente: ordens, renovações, retiradas e
//                                                           as inativadas (tachadas), com as checagens
//   POST /api/enfermagem/contencao                          a ordem: grava a ordem e o aprazamento da checagem periódica
//                                                           na mesma transação, com a trilha_auditoria
//   POST /api/enfermagem/contencao/:id/renovar              a renovação: ordem nova que aponta a anterior
//   POST /api/enfermagem/contencao/:id/checagens            a checagem de um horário aprazado
//   POST /api/enfermagem/contencao/:id/checagens/adendo     o adendo da checagem (revisão W0-03: só do autor, motivo)
//   POST /api/enfermagem/contencao/:id/retirar              a retirada (encerra; os horários depois dela são cancelados)
//   POST /api/enfermagem/contencao/:id/inativar             a inativação da ordem lançada errada (só do autor; senha)
//   GET  /api/enfermagem/contencao/indicador?unidade&de&ate  o indicador do período com o numerador e o denominador
// Só do novo (SGH_). A liberação é a dos escores de risco (`enfermagem.escores`: segurança do paciente na enfermagem).
// Permissões reusadas (nenhuma nova): ler, a da linha do tempo do turno OU a do prescritor (revisão W0-03: o médico
// abre a tela e prescreve sem a linha do turno; @PermissaoOu na guarda); prescrever, renovar e retirar, a do prescritor
// (pep.prescricao.criar) ou a do enfermeiro que apraza (enfermagem.horario.aprazar, com o conselho; revisão W0-03: e
// com a categoria de enfermeiro conferida pelo vínculo, como o próprio aprazamento — o técnico com a permissão de
// aprazar não prescreve a contenção, ato do médico ou do enfermeiro pela COFEN 427/2012); checar, a da checagem da
// administração.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type ContencaoLida,
  type ContencoesDaUnidade,
  esquemaAdendoChecagemContencao,
  esquemaChecagemContencao,
  esquemaInativarContencao,
  esquemaOrdemContencao,
  EVENTOS_AUDITAVEIS,
  type IndicadorContencaoResposta,
  PERMISSOES_ENFERMAGEM,
} from '@sgh/contratos';
import { categoriaPorCbo, podeAprazar, somarMinutos } from '@sgh/dominio-enfermagem';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
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
import { corpo } from '../exames/public-api.js';
import {
  conferirChecagem,
  contencaoParaTela,
  indicadorDoPeriodo,
  parametrosContencao,
  prepararOrdem,
  VigiaContencao,
} from './contencao-servico.js';
import { ApoioEscores } from './escores.controller.js';
import { PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';

export const VIGIA_CONTENCAO = Symbol('VIGIA_CONTENCAO');
const P = PERMISSOES_ENFERMAGEM;
const PERMISSAO_PRESCREVER = 'pep.prescricao.criar';
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** A janela da tela da unidade e do histórico (as ordens começadas nela). */
const HORAS_UNIDADE = 72;
const DIAS_HISTORICO = 30;
const esquemaRetirada = z.object({ motivo: z.string() }).strict();

function unidadeDe(v: string | undefined): string {
  const u = (v ?? '').trim();
  if (!UNIDADE.test(u))
    throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
  return u;
}

@Controller('enfermagem/contencao')
export class ContencaoController implements OnModuleInit, OnModuleDestroy {
  private readonly a: ApoioEscores;

  constructor(
    @Inject(PORTA_ESCORES) porta: PortaEscores,
    @Inject(PORTA_ENFERMAGEM) enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(VIGIA_CONTENCAO) private readonly vigia: VigiaContencao | null = null,
  ) {
    this.a = new ApoioEscores(porta, enfermagem, trilha, configuracao, cache);
  }

  onModuleInit(): void {
    this.vigia?.iniciar();
  }

  onModuleDestroy(): void {
    this.vigia?.parar();
  }

  private async parametros(s: SessaoCadastro, unidade: string | null) {
    const [prazo, intervalo, tolerancia] = await Promise.all([
      this.a.apoio.parametro(s, 'enfermagem.contencao.prazoMaximoHoras', unidade),
      this.a.apoio.parametro(s, 'enfermagem.contencao.intervaloMinutos', unidade),
      this.a.apoio.parametroValor(s, 'enfermagem.contencao.toleranciaMinutos', unidade),
    ]);
    return parametrosContencao(prazo, intervalo, tolerancia);
  }

  /** W1-08: o início do turno diurno da unidade (os horários da ordem por turno seguem a mesma régua da worklist). */
  private async inicioDiurno(s: SessaoCadastro, unidade: string | null): Promise<string> {
    const v = String((await this.a.apoio.parametroValor(s, 'enfermagem.inicioTurnoDiurno', unidade)) ?? '');
    return /^\d{4}$/.test(v) ? v : '0700';
  }

  /**
   * Quem prescreve: o prescritor; ou, pela permissão de aprazar, só o ENFERMEIRO (a categoria vem do vínculo, como no
   * aprazamento — revisão W0-03). O técnico de enfermagem com a permissão de aprazar não prescreve a contenção.
   */
  private async podePrescrever(s: SessaoCadastro): Promise<boolean> {
    if (s.pode(PERMISSAO_PRESCREVER)) return true;
    if (!s.pode(P.horarioAprazar)) return false;
    const vs = await this.a.enfermagem.vinculos(s.porta, s.login).catch(() => []);
    return vs.some((v) => podeAprazar(categoriaPorCbo(v.codigo)));
  }

  /** A permissão que vale para a trilha (a do prescritor, ou a do enfermeiro que apraza). */
  private recursoPrescrever(s: SessaoCadastro): string {
    return s.pode(PERMISSAO_PRESCREVER) ? PERMISSAO_PRESCREVER : P.horarioAprazar;
  }

  private async exigirPrescrever(s: SessaoCadastro): Promise<void> {
    if (!(await this.podePrescrever(s)))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'A ordem de contenção é do prescritor ou do enfermeiro (com o conselho ativo).',
        { codigo: 'sem-permissao-contencao' },
      );
  }

  private async ordem(s: SessaoCadastro, id: number) {
    const o = await this.a.porta.contencao(s.porta, id);
    if (!o)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Ordem não encontrada',
        'A ordem de contenção não existe.',
      );
    return o;
  }

  @Get('unidade')
  @Permissao(P.horarioLer)
  @PermissaoOu(PERMISSAO_PRESCREVER)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemContencaoLida.codigo)
  async unidade(
    @Query('unidade') u: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContencoesDaUnidade> {
    const s = sessaoDe(req);
    const unidade = unidadeDe(u);
    const [p, l, agora, internados, prescrever, inicioDiurno] = await Promise.all([
      this.parametros(s, unidade),
      this.a.apoio.liberacao(s),
      this.a.enfermagem.relogio(s.porta),
      this.a.enfermagem.internados(s.porta, unidade),
      this.podePrescrever(s),
      this.inicioDiurno(s, unidade),
    ]);
    // Revisão W0-03: a janela é a das ordens recentes, mais as ABERTAS de qualquer idade (a vencida e não retirada
    // segue na tela e no alerta até ser retirada ou renovada).
    const ordens = await this.a.porta.contencoes(s.porta, {
      atendimentos: internados.map((i) => i.atendimento),
      desde: somarMinutos(agora.slice(0, 16), -HORAS_UNIDADE * 60),
      abertas: true,
    });
    const pacientes = internados.map((i) => {
      const atual = ordens
        .filter((o) => o.atendimento === i.atendimento)
        .map((o) => contencaoParaTela(o, agora, p.toleranciaMinutos, inicioDiurno))
        .find((o) => o.situacao === 'ativa' || o.situacao === 'vencida');
      return {
        paciente: i.paciente,
        atendimento: i.atendimento,
        nome: i.nome,
        leito: i.leito,
        ordem: atual ?? null,
      };
    });
    const emCurso = pacientes.flatMap((x) => (x.ordem ? [x.ordem] : []));
    req.sghAlvo = {
      tabelaAlvo: 'contencao_paciente',
      chaveNaturalAlvo: `unidade:${unidade};n:${emCurso.length}`,
    };
    return {
      unidade,
      agora: agora.slice(0, 16),
      parametros: p,
      pacientes,
      vencidas: emCurso.filter((o) => o.situacao === 'vencida').length,
      atrasadas: emCurso.reduce((a, o) => a + o.horarios.filter((h) => h.estado === 'atrasada').length, 0),
      gravacao: {
        ligada: l.ligada,
        motivo: l.motivo,
        prescrever: l.ligada && prescrever,
        checar: l.ligada && s.pode(P.administracaoChecar),
      },
    };
  }

  @Get('atendimentos/:atendimento')
  @Permissao(P.horarioLer)
  @PermissaoOu(PERMISSAO_PRESCREVER)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemContencaoLida.codigo)
  async historico(
    @Param('atendimento') at: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ atendimento: number; agora: string; ordens: ContencaoLida[] }> {
    const s = sessaoDe(req);
    const atendimento = idDaRota(at);
    const [p, agora, inicioDiurno] = await Promise.all([
      this.parametros(s, null),
      this.a.enfermagem.relogio(s.porta),
      this.inicioDiurno(s, null),
    ]);
    const ordens = await this.a.porta.contencoes(s.porta, {
      atendimentos: [atendimento],
      desde: somarMinutos(agora.slice(0, 16), -DIAS_HISTORICO * 24 * 60),
    });
    req.sghAlvo = {
      tabelaAlvo: 'contencao_paciente',
      chaveNaturalAlvo: `atendimento:${atendimento};n:${ordens.length}`,
    };
    return {
      atendimento,
      agora: agora.slice(0, 16),
      ordens: ordens.map((o) => contencaoParaTela(o, agora, p.toleranciaMinutos, inicioDiurno)),
    };
  }

  private async gravarOrdem(s: SessaoCadastro, b: unknown, anterior: number | null) {
    await this.exigirPrescrever(s);
    const e = corpo(esquemaOrdemContencao, b);
    if (anterior !== null) {
      const a = await this.ordem(s, anterior);
      if (a.atendimento !== e.atendimento || a.paciente !== e.paciente)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Não registrado',
          'A ordem a renovar é de outro atendimento.',
          {
            codigo: 'contencao-de-outro-atendimento',
          },
        );
    }
    const i = await this.a.internado(s, e.atendimento, e.paciente);
    const [p, agora] = await Promise.all([this.parametros(s, i.unidade), this.a.enfermagem.relogio(s.porta)]);
    const o = prepararOrdem(e, i, agora, p, s.login, anterior);
    const id = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemContencaoPrescrita.codigo,
      this.recursoPrescrever(s),
      (x: number) => ({
        tabela: 'contencao_paciente',
        id: String(x),
        paciente: i.paciente,
        chave: `${anterior === null ? 'ordem' : `renova:${anterior}`};horarios:${o.horarios.length}`,
      }),
      (g) => g.prescreverContencao(o),
    );
    return {
      ok: true as const,
      id,
      inicio: o.inicio,
      horarios: o.horarios,
      mensagem:
        (anterior === null
          ? 'Contenção prescrita'
          : 'Contenção renovada (ordem nova; a anterior fica como renovada)') +
        `: ${o.horarios.length} checagens aprazadas a cada ${o.intervaloMinutos} minutos até ${o.horarios.at(-1)!.slice(11, 16)}.`,
    };
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.horarioLer)
  @PermissaoOu(PERMISSAO_PRESCREVER)
  @AuditadoNoHandler(
    'a ordem em contencao_paciente e o aprazamento em contencao_paciente_avaliacao com a trilha_auditoria',
  )
  prescrever(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravarOrdem(sessaoDe(req), b, null);
  }

  @Post(':id/renovar')
  @HttpCode(201)
  @Permissao(P.horarioLer)
  @PermissaoOu(PERMISSAO_PRESCREVER)
  @AuditadoNoHandler('a renovação (ordem nova com ID_ANTERIOR) e o aprazamento com a trilha_auditoria')
  renovar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravarOrdem(sessaoDe(req), b, idDaRota(id));
  }

  @Post(':id/checagens')
  @HttpCode(201)
  @Permissao(P.administracaoChecar)
  @AuditadoNoHandler('a checagem em contencao_paciente_avaliacao com a trilha_auditoria na mesma transação')
  async checar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const contencao = idDaRota(id);
    const { previsto, ...resto } = (b ?? {}) as { previsto?: unknown };
    if (typeof previsto !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(previsto))
      throw new ErroProblema('entrada-invalida', 422, 'Registro incompleto', 'Escolha o horário aprazado.', {
        codigo: 'previsto-invalido',
        campos: ['previsto'],
      });
    const e = corpo(esquemaChecagemContencao, resto);
    const o = await this.ordem(s, contencao);
    const [p, agora] = await Promise.all([this.parametros(s, o.unidade), this.a.enfermagem.relogio(s.porta)]);
    // Encerrada, a gravação recusa com o motivo certo (cancelada pela retirada ou inativada).
    if (!o.encerramento) conferirChecagem(previsto, agora, p.toleranciaMinutos);
    const alterado = Object.values(e.achados).includes('alterado');
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemContencaoChecada.codigo,
      P.administracaoChecar,
      {
        tabela: 'contencao_paciente_avaliacao',
        id: String(contencao),
        paciente: o.paciente,
        chave: previsto,
      },
      (g) =>
        g.checarContencao({
          contencao,
          previsto,
          achados: e.achados as Record<string, 'normal' | 'alterado'>,
          observacao: e.observacao?.trim() || null,
          usuario: s.login,
        }),
    );
    return {
      ok: true as const,
      previsto,
      mensagem: alterado
        ? 'Checagem registrada com achado alterado: avalie a necessidade de afrouxar, reposicionar ou retirar.'
        : 'Checagem registrada.',
    };
  }

  @Post(':id/checagens/adendo')
  @HttpCode(201)
  @Permissao(P.administracaoChecar)
  @AuditadoNoHandler(
    'o adendo da checagem em contencao_paciente_avaliacao com a trilha_auditoria na mesma transação',
  )
  async adendo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const contencao = idDaRota(id);
    const e = corpo(esquemaAdendoChecagemContencao, b);
    const o = await this.ordem(s, contencao);
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemContencaoChecada.codigo,
      P.administracaoChecar,
      {
        tabela: 'contencao_paciente_avaliacao',
        id: String(contencao),
        paciente: o.paciente,
        chave: `adendo:${e.previsto}`,
      },
      (g) =>
        g.adendoChecagemContencao({
          contencao,
          previsto: e.previsto,
          achados: e.achados as Record<string, 'normal' | 'alterado'>,
          observacao: e.observacao?.trim() || null,
          motivo: e.motivo,
          usuario: s.login,
        }),
    );
    return {
      ok: true as const,
      previsto: e.previsto,
      mensagem:
        'Adendo da checagem registrado: a checagem original continua visível, com o adendo e o motivo.',
    };
  }

  @Post(':id/retirar')
  @HttpCode(200)
  @Permissao(P.horarioLer)
  @PermissaoOu(PERMISSAO_PRESCREVER)
  @AuditadoNoHandler('a retirada em contencao_paciente com a trilha_auditoria na mesma transação')
  async retirar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    // A retirada é de quem prescreve ou de quem cuida (o enfermeiro que apraza), como a ordem.
    await this.exigirPrescrever(s);
    const contencao = idDaRota(id);
    const e = corpo(esquemaRetirada, b);
    const motivo = e.motivo.replace(/\s+/g, ' ').trim();
    if (motivo.length < 10)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Registro incompleto',
        'Descreva o motivo (10 caracteres ou mais).',
        {
          codigo: 'motivo-curto',
          campos: ['motivo'],
        },
      );
    const o = await this.ordem(s, contencao);
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemContencaoEncerrada.codigo,
      this.recursoPrescrever(s),
      { tabela: 'contencao_paciente', id: String(contencao), paciente: o.paciente, chave: 'retirada' },
      (g) =>
        g.encerrarContencao({ contencao, tipo: 'retirada', motivo: motivo.slice(0, 300), usuario: s.login }),
    );
    return {
      ok: true as const,
      id: contencao,
      mensagem: 'Contenção retirada: as checagens depois da retirada foram canceladas.',
    };
  }

  @Post(':id/inativar')
  @HttpCode(200)
  @Permissao(P.horarioLer)
  @PermissaoOu(PERMISSAO_PRESCREVER)
  @AuditadoNoHandler(
    'a inativação em contencao_paciente (com a senha) e a trilha_auditoria na mesma transação',
  )
  async inativar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const contencao = idDaRota(id);
    const e = corpo(esquemaInativarContencao, b);
    const o = await this.ordem(s, contencao);
    if (o.prescritor !== s.login)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Não registrado',
        'Só quem lançou a ordem a inativa (lançamento errado).',
        {
          codigo: 'so-o-autor',
        },
      );
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemContencaoEncerrada.codigo,
      P.horarioLer,
      {
        tabela: 'contencao_paciente',
        id: String(contencao),
        paciente: o.paciente,
        chave: 'inativacao',
      },
      (g) => g.encerrarContencao({ contencao, tipo: 'inativacao', motivo: e.motivo, usuario: s.login }),
    );
    return {
      ok: true as const,
      id: contencao,
      mensagem: 'Ordem inativada: continua visível, tachada, com o motivo, e sai dos indicadores.',
    };
  }

  @Get('indicador')
  @Permissao(P.horarioLer)
  @PermissaoOu(PERMISSAO_PRESCREVER)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemContencaoLida.codigo)
  async indicador(
    @Query('unidade') u: string | undefined,
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadorContencaoResposta> {
    const s = sessaoDe(req);
    const unidade = unidadeDe(u);
    if (!de || !ate || !DATA.test(de) || !DATA.test(ate) || de > ate)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'Informe o período (de e até).');
    if (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`) > 366 * 86_400_000)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O período vai até um ano.');
    const [p, agora, censo] = await Promise.all([
      this.parametros(s, unidade),
      this.a.enfermagem.relogio(s.porta),
      this.a.porta.pacientesDia(s.porta, unidade, de, ate),
    ]);
    const ordens = await this.a.porta.contencoes(s.porta, {
      unidade,
      desde: `${de}T00:00`,
      ate: somarMinutos(`${ate}T00:00`, 24 * 60),
    });
    req.sghAlvo = { tabelaAlvo: 'contencao_paciente', chaveNaturalAlvo: `indicador:${unidade};${de};${ate}` };
    return indicadorDoPeriodo(unidade, de, ate, ordens, censo, agora, p.toleranciaMinutos);
  }
}
