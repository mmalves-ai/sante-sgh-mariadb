// W0-03, mercado M2 (critério 10): o Time de Resposta Rápida (TRR) e a parada cardiorrespiratória (código azul).
//   GET  /api/enfermagem/trr/unidade?unidade          os alertas abertos (escore com gatilho de TRR das últimas 12 h, sem
//                                                     estorno nem acionamento), os acionamentos das últimas 24 h e as
//                                                     fichas de PCR dos internados (leitura auditada)
//   POST /api/enfermagem/trr                          o acionamento: do alerta (a hora do alerta vem do escore) ou à mão
//   POST /api/enfermagem/trr/:id/eventos              a chegada do time ou o desfecho
//   POST /api/enfermagem/trr/pcr                      a ficha Utstein (rascunho ou finalizada), versão 1
//   POST /api/enfermagem/trr/pcr/:id/versoes          a versão seguinte (só do autor; revisão W0-03: a da finalizada é a
//                                                     correção finalizada com a justificativa)
//   POST /api/enfermagem/trr/:id/inativar             revisão W0-03: o acionamento lançado errado (só do autor; senha)
//   POST /api/enfermagem/trr/eventos/:id/retificar    revisão W0-03: a chegada ou o desfecho corrigidos (só do autor)
//   POST /api/enfermagem/trr/eventos/:id/inativar     revisão W0-03: a chegada ou o desfecho lançados errado (senha)
//   POST /api/enfermagem/trr/pcr/:id/inativar         revisão W0-03: a ficha lançada errado (só do autor; senha)
//   GET  /api/enfermagem/trr/indicadores?de&ate       PCR por 1.000 pacientes-dia fora da UTI e o tempo de resposta
// Só do novo (SGH_), com a SGH_TRILHA na mesma transação. A liberação é a dos escores de risco (`enfermagem.escores`).
// Permissões reusadas (nenhuma nova): ler, a dos escores; acionar e registrar a chegada e o desfecho, a de registrar
// escore (a enfermagem) ou a do prescritor; a ficha da PCR, a do prescritor ou a de registrar escore.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AcionamentoTrrLido,
  type AlertaTrrAberto,
  esquemaAcionarTrr,
  esquemaEventoTrr,
  esquemaFichaPcr,
  esquemaInativarTrr,
  esquemaRetificarEventoTrr,
  esquemaVersaoPcr,
  EVENTOS_AUDITAVEIS,
  type FichaPcrLida,
  type IndicadoresTrrPcr,
  PERMISSOES_ESCORES as PE,
} from '@sgh/contratos';
import { conferirFichaPcr, META_RESPOSTA_TRR_PADRAO_MINUTOS, somarMinutos } from '@sgh/dominio-enfermagem';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
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
import { ApoioEscores } from './escores.controller.js';
import { PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { acionamentoParaTela, fichasVigentes, indicadoresDoPeriodo, unidadesUti } from './trr-servico.js';

const PERMISSAO_PRESCREVER = 'pep.prescricao.criar';
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORAS_ALERTA = 12;
const HORAS_ACIONAMENTOS = 24;
/** Revisão W0-03: as fichas da unidade (pelo local da parada) dos últimos 30 dias, mesmo de quem já saiu. */
const DIAS_FICHAS = 30;

function unidadeDe(v: string | undefined): string {
  const u = (v ?? '').trim();
  if (!UNIDADE.test(u))
    throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
  return u;
}
const invalida = (codigo: string, detalhe: string, campos?: readonly string[]) =>
  new ErroProblema('entrada-invalida', 422, 'Registro incompleto', detalhe, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });

@Controller('enfermagem/trr')
export class TrrController {
  private readonly a: ApoioEscores;

  constructor(
    @Inject(PORTA_ESCORES) porta: PortaEscores,
    @Inject(PORTA_ENFERMAGEM) enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.a = new ApoioEscores(porta, enfermagem, trilha, configuracao, cache);
  }

  /** A senha na operação crítica (a inativação tira o registro dos indicadores). */
  private async senha(req: RequisicaoAutorizada, senha: string): Promise<void> {
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  /**
   * As versões completas das fichas (revisão W0-03): as da janela e, para cada atendimento achado, todas as versões
   * dele — a cadeia inteira, para a versão vigente nunca ser confundida com uma anterior fora da janela.
   */
  private async versoesCompletas(
    s: SessaoCadastro,
    atendimentos: readonly number[],
    janela: { unidade?: string; desde: string; ate?: string },
  ) {
    const daJanela = await this.a.porta.versoesPcr(s.porta, janela);
    const todos = [...new Set([...atendimentos, ...daJanela.map((v) => v.atendimento)])];
    return todos.length ? this.a.porta.versoesPcr(s.porta, { atendimentos: todos }) : [];
  }

  private podeAgir(s: SessaoCadastro): boolean {
    return s.pode(PE.escoreRegistrar) || s.pode(PERMISSAO_PRESCREVER);
  }

  private recurso(s: SessaoCadastro): string {
    return s.pode(PE.escoreRegistrar) ? PE.escoreRegistrar : PERMISSAO_PRESCREVER;
  }

  private exigirAgir(s: SessaoCadastro): void {
    if (!this.podeAgir(s))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'O acionamento e a ficha da parada são da enfermagem que registra os escores ou de quem prescreve.',
        { codigo: 'sem-permissao-trr' },
      );
  }

  private async uti(s: SessaoCadastro): Promise<Set<string>> {
    return unidadesUti(await this.a.apoio.parametroValor(s, 'enfermagem.trr.unidadesUti', null));
  }

  @Get('unidade')
  @Permissao(PE.escoreLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemTrrLido.codigo)
  async unidade(@Query('unidade') u: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const unidade = unidadeDe(u);
    const [agora, internados, l] = await Promise.all([
      this.a.enfermagem.relogio(s.porta),
      this.a.enfermagem.internados(s.porta, unidade),
      this.a.apoio.liberacao(s),
    ]);
    const ag = agora.slice(0, 16);
    const [escores, acionamentos, versoes] = await Promise.all([
      this.a.porta.escores(
        s.porta,
        internados.map((i) => i.paciente),
        somarMinutos(ag, -HORAS_ALERTA * 60),
      ),
      this.a.porta.acionamentosTrr(s.porta, { unidade, desde: somarMinutos(ag, -HORAS_ACIONAMENTOS * 60) }),
      // Revisão W0-03: as fichas dos internados E as da unidade dos últimos 30 dias (o paciente que saiu leva a ficha
      // junto: a finalizada segue legível e o rascunho, finalizável).
      this.versoesCompletas(
        s,
        internados.map((i) => i.atendimento),
        { unidade, desde: somarMinutos(ag, -DIAS_FICHAS * 24 * 60) },
      ),
    ]);
    const comTrr = await this.a.porta.escoresComTrr(
      s.porta,
      escores.filter((e) => e.gatilho === 'trr').map((e) => e.id),
    );
    const porPaciente = new Map(internados.map((i) => [i.paciente, i]));
    const alertas: AlertaTrrAberto[] = escores
      .filter((e) => e.gatilho === 'trr' && !e.estorno && !comTrr.has(e.id))
      .flatMap((e) => {
        const i = porPaciente.get(e.paciente);
        return i
          ? [
              {
                escore: e.id,
                paciente: i.paciente,
                atendimento: i.atendimento,
                leito: i.leito,
                nome: i.nome,
                escala: e.escala,
                total: e.total,
                alertaEm: e.aferidoEm.slice(0, 16),
              },
            ]
          : [];
      });
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PEP_TRR',
      chaveNaturalAlvo: `unidade:${unidade};alertas:${alertas.length};acionamentos:${acionamentos.length}`,
    };
    const nomes = new Map(internados.map((i) => [i.atendimento, { leito: i.leito, nome: i.nome }]));
    const daUnidade = new Set(internados.map((i) => i.atendimento));
    const fichas = fichasVigentes(versoes)
      .filter((f) => daUnidade.has(f.atendimento) || f.unidade === unidade)
      .map((f) => ({ ...f, foraDaUnidade: !daUnidade.has(f.atendimento) }));
    return {
      unidade,
      agora: ag,
      alertas,
      pacientes: internados.map((i) => ({
        paciente: i.paciente,
        atendimento: i.atendimento,
        leito: i.leito,
        nome: i.nome,
      })),
      acionamentos: acionamentos.map((x): AcionamentoTrrLido & { leito: string; nome: string } => ({
        ...acionamentoParaTela(x, fichas),
        leito: nomes.get(x.atendimento)?.leito ?? '',
        nome: nomes.get(x.atendimento)?.nome ?? '',
      })),
      fichas: fichas satisfies FichaPcrLida[],
      gravacao: { ligada: l.ligada, motivo: l.motivo, agir: l.ligada && this.podeAgir(s) },
    };
  }

  @Post()
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('o acionamento em SGH_PEP_TRR com a SGH_TRILHA na mesma transação')
  async acionar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const e = corpo(esquemaAcionarTrr, b);
    const i = await this.a.internado(s, e.atendimento, e.paciente);
    const [agora, uti] = await Promise.all([this.a.enfermagem.relogio(s.porta), this.uti(s)]);
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemTrrAcionado.codigo,
      this.recurso(s),
      (x: { id: number }) => ({
        tabela: 'SGH_PEP_TRR',
        id: String(x.id),
        paciente: i.paciente,
        chave: e.escore ? `escore:${e.escore}` : 'manual',
      }),
      (g) =>
        g.acionarTrr({
          paciente: i.paciente,
          atendimento: i.atendimento,
          unidade: i.unidade || null,
          uti: uti.has((i.unidade ?? '').toUpperCase()),
          escore: e.escore ?? null,
          acionadoEm: agora.slice(0, 16),
          motivo: e.motivo ?? null,
          usuario: s.login,
        }),
    );
    return {
      ok: true as const,
      id: r.id,
      acionadoEm: agora.slice(0, 16),
      alertaEm: r.alertaEm,
      mensagem: r.alertaEm
        ? `Time de Resposta Rápida acionado às ${agora.slice(11, 16)} (alerta das ${r.alertaEm.slice(11, 16)}).`
        : `Time de Resposta Rápida acionado às ${agora.slice(11, 16)}.`,
    };
  }

  @Post(':id/eventos')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('a chegada ou o desfecho em SGH_PEP_TRR_EVENTO com a SGH_TRILHA na mesma transação')
  async evento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const trr = idDaRota(id);
    const e = corpo(esquemaEventoTrr, b);
    const agora = (await this.a.enfermagem.relogio(s.porta)).slice(0, 16);
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemTrrEvento.codigo,
      this.recurso(s),
      { tabela: 'SGH_PEP_TRR_EVENTO', id: String(trr), chave: e.tipo },
      (g) => g.eventoTrr({ trr, tipo: e.tipo, em: agora, desfecho: e.desfecho ?? null, usuario: s.login }),
    );
    return {
      ok: true as const,
      mensagem:
        e.tipo === 'chegada'
          ? `Chegada do time registrada às ${agora.slice(11, 16)}.`
          : 'Desfecho registrado.',
    };
  }

  private async gravarFicha(
    s: SessaoCadastro,
    base: {
      paciente: number;
      atendimento: number;
      trr: number | null;
      anterior: number | null;
      unidade?: string | undefined;
      motivo?: string | undefined;
    },
    dados: FichaPcrLida['dados'],
    finalizar: boolean,
  ) {
    this.exigirAgir(s);
    // A primeira versão exige o paciente internado; as seguintes vêm da anterior (revisão W0-03: o rascunho do paciente
    // que já saiu — alta por óbito, por exemplo — continua finalizável). O local da parada é da ficha: com o
    // acionamento ou a versão anterior, a gravação o herda deles; sem eles, o informado pelo autor ou o leito atual.
    const i =
      base.anterior === null
        ? await this.a.internado(s, base.atendimento, base.paciente)
        : { paciente: base.paciente, atendimento: base.atendimento, unidade: '' };
    const local = (base.unidade ?? i.unidade ?? '').trim().toUpperCase();
    const [agora, uti] = await Promise.all([this.a.enfermagem.relogio(s.porta), this.uti(s)]);
    const p = conferirFichaPcr(dados, finalizar, agora);
    if (p) throw invalida(p.codigo, p.mensagem, ['dados']);
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemPcrRegistrada.codigo,
      this.recurso(s),
      (x: { id: number; versao: number }) => ({
        tabela: 'SGH_PEP_PCR',
        id: String(x.id),
        paciente: i.paciente,
        chave: `v${x.versao};${finalizar ? 'finalizada' : 'rascunho'}`,
      }),
      (g) =>
        g.gravarFichaPcr({
          paciente: i.paciente,
          atendimento: i.atendimento,
          unidade: local || null,
          uti: uti.has(local),
          trr: base.trr,
          anterior: base.anterior,
          motivo: base.motivo ?? null,
          situacao: finalizar ? 'finalizada' : 'rascunho',
          colapsoEm: dados.colapsoEm,
          dados: JSON.stringify(dados),
          autor: s.login,
        }),
    );
    return {
      ok: true as const,
      id: r.id,
      versao: r.versao,
      mensagem: finalizar
        ? `Ficha da parada finalizada (versão ${r.versao}): não muda mais.`
        : `Rascunho da ficha gravado (versão ${r.versao}): só você continua e finaliza.`,
    };
  }

  @Post('pcr')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('a ficha em SGH_PEP_PCR (versão 1) com a SGH_TRILHA na mesma transação')
  fichaPcr(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaFichaPcr, b);
    return this.gravarFicha(
      s,
      {
        paciente: e.paciente,
        atendimento: e.atendimento,
        trr: e.trr ?? null,
        anterior: null,
        unidade: e.unidade,
      },
      e.dados,
      e.finalizar,
    );
  }

  @Post('pcr/:id/versoes')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('a versão seguinte da ficha em SGH_PEP_PCR com a SGH_TRILHA na mesma transação')
  async versaoPcr(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const anterior = idDaRota(id);
    const e = corpo(esquemaVersaoPcr, b);
    // O atendimento e o acionamento vêm da versão anterior (a tela não os troca).
    const [atual] = await this.a.porta.versoesPcr(s.porta, { id: anterior });
    if (!atual)
      throw new ErroProblema('nao-encontrado', 404, 'Ficha não encontrada', 'A ficha da parada não existe.');
    return this.gravarFicha(
      s,
      {
        paciente: atual.paciente,
        atendimento: atual.atendimento,
        trr: atual.trr,
        anterior,
        motivo: e.motivo,
      },
      e.dados,
      e.finalizar,
    );
  }

  /** Revisão W0-03: a inativação do lançado errado (acionamento, evento ou ficha), só do autor, com a senha. */
  private async inativar(
    req: RequisicaoAutorizada,
    origem: 'trr' | 'evento' | 'pcr',
    id: string,
    b: unknown,
  ) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const registro = idDaRota(id);
    const e = corpo(esquemaInativarTrr, b);
    await this.senha(req, e.senha);
    const tabela =
      origem === 'trr' ? 'SGH_PEP_TRR' : origem === 'evento' ? 'SGH_PEP_TRR_EVENTO' : 'SGH_PEP_PCR';
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemTrrEvento.codigo,
      this.recurso(s),
      (x: { id: number; paciente: number }) => ({
        tabela,
        id: String(registro),
        paciente: x.paciente,
        chave: `inativacao:${origem}`,
      }),
      (g) => g.inativarTrr({ origem, id: registro, motivo: e.motivo, usuario: s.login }),
    );
    return {
      ok: true as const,
      id: registro,
      mensagem: 'Registro inativado: continua visível, tachado, com o motivo, e sai dos indicadores.',
    };
  }

  @Post(':id/inativar')
  @HttpCode(200)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('a inativação do acionamento em SGH_PEP_TRR_INATIVACAO (com a senha) e a SGH_TRILHA')
  inativarAcionamento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.inativar(req, 'trr', id, b);
  }

  @Post('eventos/:id/inativar')
  @HttpCode(200)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('a inativação da chegada ou do desfecho em SGH_PEP_TRR_INATIVACAO (com a senha)')
  inativarEvento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.inativar(req, 'evento', id, b);
  }

  @Post('pcr/:id/inativar')
  @HttpCode(200)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('a inativação da ficha em SGH_PEP_TRR_INATIVACAO (com a senha) e a SGH_TRILHA')
  inativarFicha(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.inativar(req, 'pcr', id, b);
  }

  @Post('eventos/:id/retificar')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler(
    'a retificação da chegada ou do desfecho em SGH_PEP_TRR_EVENTO (versão nova) e a SGH_TRILHA',
  )
  async retificarEvento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const evento = idDaRota(id);
    const e = corpo(esquemaRetificarEventoTrr, b);
    const agora = (await this.a.enfermagem.relogio(s.porta)).slice(0, 16);
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemTrrEvento.codigo,
      this.recurso(s),
      (x: { id: number; trr: number; tipo: string }) => ({
        tabela: 'SGH_PEP_TRR_EVENTO',
        id: String(x.id),
        chave: `retifica:${evento};${x.tipo}`,
      }),
      (g) =>
        g.retificarEventoTrr({
          evento,
          em: e.em ?? null,
          desfecho: e.desfecho ?? null,
          motivo: e.motivo,
          usuario: s.login,
          agora,
        }),
    );
    return {
      ok: true as const,
      id: r.id,
      mensagem:
        r.tipo === 'chegada'
          ? 'Chegada do time corrigida: o registro anterior continua visível, com o motivo.'
          : 'Desfecho corrigido: o registro anterior continua visível, com o motivo.',
    };
  }

  @Get('indicadores')
  @Permissao(PE.escoreLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemTrrLido.codigo)
  async indicadores(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadoresTrrPcr> {
    const s = sessaoDe(req);
    if (!de || !ate || !DATA.test(de) || !DATA.test(ate) || de > ate)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'Informe o período (de e até).');
    if (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`) > 366 * 86_400_000)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O período vai até um ano.');
    const fim = somarMinutos(`${ate}T00:00`, 24 * 60);
    const [acionamentos, versoesTodas, censo, uti, meta] = await Promise.all([
      this.a.porta.acionamentosTrr(s.porta, { desde: `${de}T00:00`, ate: fim }),
      // Revisão W0-03: a cadeia inteira de cada ficha (a vigente pode ter o colapso corrigido para fora do período).
      this.versoesCompletas(s, [], { desde: `${de}T00:00`, ate: fim }),
      this.a.porta.censo(s.porta, de, ate),
      this.uti(s),
      this.a.apoio.parametro(s, 'enfermagem.trr.metaRespostaMinutos', null),
    ]);
    req.sghAlvo = { tabelaAlvo: 'SGH_PEP_PCR', chaveNaturalAlvo: `indicadores:${de};${ate}` };
    // Só as cadeias cuja versão VIGENTE tem o colapso no período.
    const vigentesNoPeriodo = new Set(
      fichasVigentes(versoesTodas)
        .filter((f) => f.dados.colapsoEm >= `${de}T00:00` && f.dados.colapsoEm < fim)
        .map((f) => f.id),
    );
    const naCadeia = new Set<number>();
    const porId = new Map(versoesTodas.map((v) => [v.id, v]));
    for (const id of vigentesNoPeriodo) {
      let v = porId.get(id);
      while (v) {
        naCadeia.add(v.id);
        v = v.anterior === null ? undefined : porId.get(v.anterior);
      }
    }
    const versoes = versoesTodas.filter((v) => naCadeia.has(v.id));
    return indicadoresDoPeriodo(
      de,
      ate,
      acionamentos,
      versoes,
      censo,
      uti,
      meta >= 1 && meta <= 30 ? meta : META_RESPOSTA_TRR_PADRAO_MINUTOS,
    );
  }
}
