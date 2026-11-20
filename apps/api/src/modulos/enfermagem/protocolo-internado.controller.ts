// W0-03, mercado M3: os protocolos gerenciados no paciente internado (unidades de internação e UTI). A definição é a
// mesma do PA (versão publicada pela diretoria clínica); muda a inclusão (pelo alerta do NEWS2 ou por suspeita) e o
// tempo zero (a hora do alerta ou a do reconhecimento).
//   GET  /api/enfermagem/protocolos-internado/relogio?unidade      os protocolos dos internados da unidade (metas e
//                                                                  prazos), os encerrados e inativados, as sugestões
//                                                                  pelo NEWS2 e os indicadores dos últimos 30 dias
//                                                                  (lista com nomes: leitura auditada)
//   GET  /api/enfermagem/protocolos-internado/indicadores?de&ate   os indicadores por origem (PA, internação, UTI), com
//                                                                  o numerador e o denominador
//   POST /api/enfermagem/protocolos-internado                      a inclusão (enfermeiro ou médico, conselho ativo)
//   POST /api/enfermagem/protocolos-internado/:id/metas            a meta ou o item do checklist (perdida com o motivo)
//   POST /api/enfermagem/protocolos-internado/:id/encerrar         o encerramento (desfecho)
//   POST /api/enfermagem/protocolos-internado/:id/inativar         a inclusão por engano (só do autor; motivo e senha)
// Só do novo (SGH_), com a SGH_TRILHA na mesma transação; nada se edita nem se apaga. A liberação é a dos escores de
// risco (`enfermagem.escores`). Permissões reusadas (nenhuma nova): ler, a da linha do tempo do turno; incluir e
// registrar, a dos protocolos gerenciados (`recepcao.protocoloPaciente.iniciar` e `.registrar`), a do enfermeiro que
// apraza (`enfermagem.horario.aprazar`) ou a do prescritor (`pep.prescricao.criar`) — sempre com o vínculo de
// enfermeiro ou de médico e o conselho ativo conferidos (o técnico com a permissão de aprazar não inclui).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  esquemaEncerrarProtocoloInternado,
  esquemaIncluirProtocoloInternado,
  esquemaInativarProtocoloInternado,
  esquemaRegistrarMetaInternado,
  EVENTOS_AUDITAVEIS,
  type IndicadorOrigemProtocolo,
  PERMISSOES_ENFERMAGEM,
  PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS,
  type RelogioInternado,
  TIPOS_PROTOCOLO_INTERNADO,
} from '@sgh/contratos';
import { localDaUnidade, somarMinutos } from '@sgh/dominio-enfermagem';
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
import { corpo } from '../exames/public-api.js';
import {
  PORTA_CLASSIFICACAO,
  type PortaClassificacao,
  ServicoProtocoloGerenciado,
} from '../recepcao/public-api.js';
import { ApoioEscores } from './escores.controller.js';
import { PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import {
  conferirEncerramento,
  conferirInclusao,
  conferirMeta,
  desdeDaJanela,
  fechado,
  indicadoresDoPeriodo,
  motivoSemAtor,
  parametrosProtocoloInternado,
  protocoloParaTela,
  sugestoesDaUnidade,
  type VersaoComConteudo,
} from './protocolo-internado-servico.js';

const P = PERMISSOES_ENFERMAGEM;
const G = PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS;
const TABELA = 'SGH_PEP_PROTOC_INTERNADO';
const TABELA_EVT = 'SGH_PEP_PROTOC_INT_EVT';
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** O período padrão dos indicadores no relógio. */
const DIAS_INDICADOR = 30;
const PERMISSAO_PRESCREVER = 'pep.prescricao.criar';

/** A permissão que vale para incluir ou registrar (a primeira que o perfil tem), ou null. */
function recursoDe(s: SessaoCadastro, gerenciado: string): string | null {
  return [gerenciado, P.horarioAprazar, PERMISSAO_PRESCREVER].find((x) => s.pode(x)) ?? null;
}

function unidadeDe(v: string | undefined): string {
  const u = (v ?? '').trim();
  if (!UNIDADE.test(u))
    throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
  return u;
}

/** A vigente do tipo: a de maior versão publicada. */
const vigenteDe = (versoes: readonly VersaoComConteudo[], tipo: string) =>
  versoes
    .filter((x) => x.v.tipo === tipo)
    .reduce<VersaoComConteudo | undefined>((m, x) => (!m || x.v.versao > m.v.versao ? x : m), undefined);

/** A fonte do PA não é usada aqui (só as versões publicadas): qualquer chamada é erro de programação. */
const SEM_PA = {
  paAbertos: () => Promise.reject(new Error('fonte do PA não usada no internado')),
  pacienteDoAtendimento: () => Promise.reject(new Error('fonte do PA não usada no internado')),
} as unknown as ConstructorParameters<typeof ServicoProtocoloGerenciado>[1];

@Controller('enfermagem/protocolos-internado')
export class ProtocoloInternadoController {
  private readonly a: ApoioEscores;
  private readonly gerenciados: ServicoProtocoloGerenciado;

  constructor(
    @Inject(PORTA_ESCORES) porta: PortaEscores,
    @Inject(PORTA_ENFERMAGEM) enfermagem: PortaEnfermagem,
    @Inject(PORTA_CLASSIFICACAO) private readonly classificacao: PortaClassificacao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.a = new ApoioEscores(porta, enfermagem, trilha, configuracao, cache);
    this.gerenciados = new ServicoProtocoloGerenciado(classificacao, SEM_PA);
  }

  private async parametros(s: SessaoCadastro, unidade: string | null) {
    const [limiar, uti] = await Promise.all([
      this.a.apoio.parametroValor(s, 'enfermagem.protocolos.limiarNews2', unidade),
      this.a.apoio.parametroValor(s, 'enfermagem.trr.unidadesUti', null),
    ]);
    return parametrosProtocoloInternado(limiar, uti);
  }

  private versoes(s: SessaoCadastro): Promise<VersaoComConteudo[]> {
    return this.gerenciados.versoes(s.porta);
  }

  /** A permissão e o vínculo de quem inclui ou registra: devolve a permissão (para a trilha) e o vínculo. */
  private async exigirAtor(
    s: SessaoCadastro,
    gerenciado: string,
  ): Promise<{ recurso: string; vinculo: number }> {
    const recurso = recursoDe(s, gerenciado);
    if (!recurso)
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.', {
        codigo: 'sem-permissao',
      });
    return { recurso, vinculo: await this.vinculoDoAtor(s) };
  }

  private async vinculoDoAtor(s: SessaoCadastro): Promise<number> {
    const v = await this.a.porta.vinculo(s.porta, s.login).catch(() => null);
    const motivo = motivoSemAtor(v);
    if (motivo || !v)
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', motivo ?? '', {
        codigo: 'sem-ator-protocolo',
      });
    return v.vinculo;
  }

  private async protocolo(s: SessaoCadastro, id: number) {
    const p = await this.a.porta.protocoloInternado(s.porta, id);
    if (!p)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Protocolo não encontrado',
        'A inclusão no protocolo não existe.',
      );
    return p;
  }

  private async indicadores(s: SessaoCadastro, de: string, ate: string, versoes: VersaoComConteudo[]) {
    const fim = somarMinutos(`${ate}T00:00`, 24 * 60);
    const [internado, pa] = await Promise.all([
      this.a.porta.protocolosInternados(s.porta, { desde: `${de}T00:00`, ate: fim }),
      this.classificacao.protocolosDoPeriodo(s.porta, `${de}T00:00`, fim),
    ]);
    return indicadoresDoPeriodo(internado, pa, versoes);
  }

  @Get('relogio')
  @Permissao(P.horarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemProtocoloInternadoLido.codigo)
  async relogio(
    @Query('unidade') u: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RelogioInternado> {
    const s = sessaoDe(req);
    const unidade = unidadeDe(u);
    const [p, l, agora, internados, versoes, ator] = await Promise.all([
      this.parametros(s, unidade),
      this.a.apoio.liberacao(s),
      this.a.enfermagem.relogio(s.porta),
      this.a.enfermagem.internados(s.porta, unidade),
      this.versoes(s),
      this.a.porta.vinculo(s.porta, s.login).catch(() => null),
    ]);
    const protocolos = await this.a.porta.protocolosInternados(s.porta, {
      atendimentos: internados.map((i) => i.atendimento),
    });
    const desde = protocolos
      .map((x) => x.reconhecidoEm.slice(0, 16))
      .reduce((m, x) => (x < m ? x : m), desdeDaJanela(agora));
    const escores = internados.length
      ? await this.a.porta.escores(
          s.porta,
          internados.map((i) => i.paciente),
          desde,
        )
      : [];
    const porEscore = new Map(escores.map((e) => [e.id, e]));
    const porVersao = new Map(versoes.map((x) => [x.v.id, x]));
    const nomes = new Map(internados.map((i) => [i.atendimento, i.nome]));
    const tela = protocolos.map((x) =>
      protocoloParaTela(
        x,
        porVersao.get(x.gerenciado),
        nomes.get(x.atendimento) ?? '',
        x.escore === null ? undefined : porEscore.get(x.escore),
        agora,
      ),
    );
    const hoje = agora.slice(0, 10);
    const de = somarMinutos(`${hoje}T00:00`, -(DIAS_INDICADOR - 1) * 24 * 60).slice(0, 10);
    const indicadores = await this.indicadores(s, de, hoje, versoes);
    const motivoAtor = motivoSemAtor(ator);
    const podeIncluir = recursoDe(s, G.protocoloPacienteIniciar) !== null;
    const podeRegistrar = recursoDe(s, G.protocoloPacienteRegistrar) !== null;
    const motivo = !l.ligada
      ? l.motivo
      : !podeIncluir && !podeRegistrar
        ? 'Seu perfil só consulta o relógio dos protocolos.'
        : motivoAtor;
    req.sghAlvo = {
      tabelaAlvo: TABELA,
      chaveNaturalAlvo: `unidade:${unidade};n:${protocolos.filter((x) => !fechado(x)).length}`,
    };
    return {
      ativos: tela.filter((x) => !x.encerramento && !x.inativacao),
      encerrados: tela.filter((x) => x.encerramento || x.inativacao),
      sugestoes: sugestoesDaUnidade(internados, escores, protocolos, p),
      limiarNews2: p.limiar,
      pacientes: internados.map((i) => ({
        atendimento: i.atendimento,
        nome: i.nome,
        leito: i.leito,
        local: localDaUnidade(i.unidade, p.unidadesUti),
      })),
      vigentes: TIPOS_PROTOCOLO_INTERNADO.flatMap((tipo) => {
        const v = vigenteDe(versoes, tipo);
        return v
          ? [
              {
                tipo,
                id: v.v.id,
                versao: v.v.versao,
                nome: v.conteudo.nome,
                criterios: v.conteudo.criterios.map((c) => ({ codigo: c.codigo, titulo: c.titulo })),
              },
            ]
          : [];
      }),
      indicadores,
      periodo: { desde: de, ate: hoje },
      acoes: {
        incluir: l.ligada && podeIncluir && motivoAtor === null,
        registrar: l.ligada && podeRegistrar && motivoAtor === null,
        motivo,
      },
      lidoEm: agora.slice(0, 16),
    };
  }

  @Get('indicadores')
  @Permissao(P.horarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemProtocoloInternadoLido.codigo)
  async indicadoresDoPeriodo(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ periodo: { desde: string; ate: string }; indicadores: IndicadorOrigemProtocolo[] }> {
    const s = sessaoDe(req);
    if (!de || !ate || !DATA.test(de) || !DATA.test(ate) || de > ate)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'Informe o período (de e até).');
    if (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`) > 366 * 86_400_000)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O período vai até um ano.');
    const indicadores = await this.indicadores(s, de, ate, await this.versoes(s));
    req.sghAlvo = { tabelaAlvo: TABELA, chaveNaturalAlvo: `indicadores:${de}:${ate}` };
    return { periodo: { desde: de, ate }, indicadores };
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.horarioLer)
  @AuditadoNoHandler('a inclusão em SGH_PEP_PROTOC_INTERNADO com a SGH_TRILHA na mesma transação')
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { recurso, vinculo } = await this.exigirAtor(s, G.protocoloPacienteIniciar);
    const e = corpo(esquemaIncluirProtocoloInternado, b);
    const i = await this.a.enfermagem.internado(s.porta, e.atendimento);
    if (!i)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Paciente não internado',
        'O atendimento não é de paciente internado: abra-o pela unidade.',
      );
    const [p, agora, versoes, abertos] = await Promise.all([
      this.parametros(s, i.unidade),
      this.a.enfermagem.relogio(s.porta),
      this.versoes(s),
      this.a.porta.protocolosInternados(s.porta, { atendimentos: [e.atendimento] }),
    ]);
    const vigente = vigenteDe(versoes, e.tipo);
    const escore =
      e.escore === null
        ? undefined
        : (await this.a.porta.escores(s.porta, [i.paciente], desdeDaJanela(agora))).find(
            (x) => x.id === e.escore,
          );
    const { reconhecidoEm } = conferirInclusao({
      e,
      vigente,
      escore,
      jaAberto: abertos.some((x) => x.tipo === e.tipo && !fechado(x)),
      limiar: p.limiar,
      agora,
    });
    const local = localDaUnidade(i.unidade, p.unidadesUti);
    const id = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemProtocoloInternadoIncluido.codigo,
      recurso,
      (x: number) => ({
        tabela: TABELA,
        id: String(x),
        paciente: i.paciente,
        chave: `${e.atendimento}:${e.tipo}:${e.origem}:${local}`,
      }),
      (g) =>
        g.incluirProtocoloInternado({
          paciente: i.paciente,
          atendimento: e.atendimento,
          unidade: i.unidade,
          local,
          tipo: e.tipo,
          gerenciado: vigente!.v.id,
          origem: e.origem,
          escore: e.origem === 'news2' ? e.escore : null,
          criterios: e.criterios,
          observacao: e.observacao,
          reconhecidoEm,
          autor: s.login,
          vinculo,
        }),
    );
    return {
      ok: true as const,
      id,
      reconhecidoEm,
      mensagem: `Paciente incluído no protocolo: o relógio começou às ${reconhecidoEm.slice(11, 16)} (${
        e.origem === 'news2' ? 'hora do alerta do NEWS2' : 'hora do reconhecimento'
      }).`,
    };
  }

  @Post(':id/metas')
  @HttpCode(201)
  @Permissao(P.horarioLer)
  @AuditadoNoHandler('a meta ou o item em SGH_PEP_PROTOC_INT_EVT com a SGH_TRILHA na mesma transação')
  async meta(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { recurso } = await this.exigirAtor(s, G.protocoloPacienteRegistrar);
    const e = corpo(esquemaRegistrarMetaInternado, b);
    const p = await this.protocolo(s, idDaRota(id));
    const [versoes, agora] = await Promise.all([this.versoes(s), this.a.enfermagem.relogio(s.porta)]);
    const d = conferirMeta(
      p,
      versoes.find((x) => x.v.id === p.gerenciado),
      e,
      agora,
    );
    const ev = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemProtocoloInternadoRegistrado.codigo,
      recurso,
      (x: number) => ({
        tabela: TABELA_EVT,
        id: String(x),
        paciente: p.paciente,
        chave: `${p.id}:${e.tipo}:${e.codigo}:${d.situacao}`,
      }),
      (g) =>
        g.eventoProtocoloInternado({
          protocolo: p.id,
          tipoEvento: e.tipo,
          codigo: e.codigo,
          situacao: d.situacao,
          ocorridoEm: e.situacao === 'cumprida' ? e.quando : null,
          prazoEm: d.prazoEm,
          motivo: e.motivo,
          por: s.login,
        }),
    );
    return {
      ok: true as const,
      id: ev,
      situacao: d.situacao,
      mensagem:
        d.situacao === 'cumprida'
          ? 'Registrado: cumprida no prazo.'
          : 'Registrado como perdida, com o motivo.',
    };
  }

  @Post(':id/encerrar')
  @HttpCode(201)
  @Permissao(P.horarioLer)
  @AuditadoNoHandler('o encerramento em SGH_PEP_PROTOC_INT_EVT com a SGH_TRILHA na mesma transação')
  async encerrar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { recurso } = await this.exigirAtor(s, G.protocoloPacienteRegistrar);
    const e = corpo(esquemaEncerrarProtocoloInternado, b);
    const p = await this.protocolo(s, idDaRota(id));
    const versoes = await this.versoes(s);
    conferirEncerramento(
      p,
      versoes.find((x) => x.v.id === p.gerenciado),
      e,
    );
    const ev = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemProtocoloInternadoRegistrado.codigo,
      recurso,
      (x: number) => ({
        tabela: TABELA_EVT,
        id: String(x),
        paciente: p.paciente,
        chave: `${p.id}:${e.desfecho}`,
      }),
      (g) =>
        g.eventoProtocoloInternado({
          protocolo: p.id,
          tipoEvento: 'encerramento',
          codigo: 'encerramento',
          situacao: e.desfecho,
          ocorridoEm: null,
          prazoEm: null,
          motivo: e.motivo,
          por: s.login,
        }),
    );
    return { ok: true as const, id: ev, mensagem: 'Protocolo encerrado: o relógio parou.' };
  }

  @Post(':id/inativar')
  @HttpCode(200)
  @Permissao(P.horarioLer)
  @AuditadoNoHandler('a inativação em SGH_PEP_PROTOC_INT_EVT (com a senha) e a SGH_TRILHA na mesma transação')
  async inativar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaInativarProtocoloInternado, b);
    const p = await this.protocolo(s, idDaRota(id));
    // Só o autor (que incluiu, logo era enfermeiro ou médico); a permissão de quem inclui ou registra ainda vale.
    const recurso = recursoDe(s, G.protocoloPacienteRegistrar);
    if (!recurso)
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.', {
        codigo: 'sem-permissao',
      });
    if (p.incluidoPor !== s.login)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Não registrado',
        'Só quem incluiu o paciente inativa a inclusão (lançada por engano).',
        { codigo: 'so-o-autor' },
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
      EVENTOS_AUDITAVEIS.enfermagemProtocoloInternadoInativado.codigo,
      recurso,
      { tabela: TABELA_EVT, id: String(p.id), paciente: p.paciente, chave: 'inativacao' },
      (g) =>
        g.eventoProtocoloInternado({
          protocolo: p.id,
          tipoEvento: 'inativacao',
          codigo: 'inativacao',
          situacao: 'inativa',
          ocorridoEm: null,
          prazoEm: null,
          motivo: e.motivo,
          por: s.login,
        }),
    );
    return {
      ok: true as const,
      id: p.id,
      mensagem:
        'Inclusão inativada: continua visível, tachada, com o motivo, e sai dos indicadores. Inclua de novo no paciente ou protocolo certo.',
    };
  }
}
