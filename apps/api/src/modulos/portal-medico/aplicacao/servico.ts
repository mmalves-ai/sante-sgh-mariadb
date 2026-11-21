// Portal do médico externo (M50, etapa 3; ficha, seções 4, 5 e 7; regras 1, 6 e 13; DP-43). É o portal de resultados do
// M26 (a mesma sessão, a mesma conta com segundo fator, `/resultados`): o servidor confere em cada pedido a sessão do
// portal com o perfil de médico externo, relê a conta (a recusada ou encerrada derruba a sessão) e o vínculo com o
// profissional do corpo clínico, decidido por uma pessoa do hospital. Do vínculo saem, no servidor:
//   - o extrato de produção e repasse: os códigos de prestador do profissional pelo serviço do M33 (o mesmo extrato do
//     médico interno, regra 12 do M33);
//   - a agenda cirúrgica: só as cirurgias em que o registro dele é o cirurgião (o cirurgião do agendamento), com o paciente
//     mascarado como no mapa do bloco, e os pedidos feitos por esta conta (DP-43: só o que é dele);
//   - o pedido de cirurgia: nasce "solicitado" no agendamento cirúrgico (M18), não ocupa a sala; a secretaria do bloco
//     confirma pela agenda do M18 (cirurgia.agendarCirurgia, sem mudança), localizando o cadastro do paciente.
// Toda leitura e gravação vai à trilha de auditoria sem dado pessoal. O lado interno lista as contas e liga ou desliga o
// profissional (portal.medicoExterno.vincular).
import { Logger } from '@nestjs/common';
import {
  type AtoContaMedicoExternoEntrada,
  type AtoContaMedicoExternoItem,
  type AvisoCritico,
  type AvisoCriticoPortalMedico,
  type CienciaCriticoMedico,
  type CriticosPortalMedico,
  PORTAL_MEDICO_CRITICOS_DIAS,
  type AgendaPortalMedico,
  type AgendamentoPortalMedico,
  CARATERES_CIRURGIA,
  CHAVE_PORTAL_MEDICO,
  CHAVES_SADT,
  type ContaMedicoExterno,
  type ContasMedicoExterno,
  type ContaDoMedicoResposta,
  EVENTOS_AUDITAVEIS,
  type ExtratoPortalMedico,
  type FiltroContasMedicoExterno,
  type OpcoesPortalMedico,
  PORTAL_MEDICO_AGENDA_DIAS_MAX,
  PORTAL_MEDICO_CONTAS_POR_PAGINA,
  PORTAL_MEDICO_PEDIDO_DIAS_MAX,
  type AlterarPedidoPortal,
  type PedidoCirurgiaPortal,
  type PedidoPortalMedico,
  type ResultadoAtoContaMedicoExterno,
  type PedirTrocaEmailMedicoEntrada,
  type ResultadoPortalMedico,
  type SituacaoContaMedicoExterno,
  type TrocaEmailMedicoPedida,
  type TrocarSenhaMedicoEntrada,
  type LinhaWorklistMedico,
  type MeusPacientesPortalMedico,
  type PacientePortalMedico,
  PORTAL_MEDICO_PACIENTES_TETO,
  type ProntuarioPortalMedico,
  type WorklistMedico,
  type AssinarPortalMedico,
  type AssinaturasPortalMedico,
  type InicioAssinaturaPortalMedico,
  type ResultadoAssinaturaPortalMedico,
  type RetornoAssinaturaPortalMedico,
} from '@sgh/contratos';
import { cifrarSenha, mascararEmail } from '@sgh/dominio-acesso';
import { nomeMascarado } from '@sgh/dominio-agenda';
import {
  codigosDoProfissional,
  codigosExclusivos,
  conferirPedidoPortal,
  estadoValido,
  janelaAgendaPortal,
  registroDoPedido,
  reservarPedido,
  ROTULOS_ESTADO,
} from '@sgh/dominio-cirurgia';
import { type ContextoNucleo, ErroOperacao } from '@sgh/nucleo';
import { createHash, randomBytes } from 'node:crypto';
import { ErroProblema } from '../../../problema.filter.js';
import { problemaDoCadastro } from '../../cadastro/comum.js';
import type { PortaCirurgia } from '../../cirurgia/public-api.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { ServicoRepasse } from '../../repasse/public-api.js';
import { ligadaNoEstabelecimento, type PortaSadt, type ServicoPortal } from '../../sadt/public-api.js';
import { contextoDoEstabelecimento } from '../../cadastro/contexto-nucleo.js';
import type { ContextoGravacaoPep, ResultadoLido } from '../../pep/tipos-pep.js';
import type { AcessoPortal } from '../../sadt/public-api.js';
import {
  type ContextoPortalMedico,
  type NotificacaoCriticoMedico,
  type PortaPortalMedico,
  type ProfissionalCorpoClinico,
  type TrilhaPortalMedico,
  trilhaDoNucleo,
  type VinculoMedicoExterno,
} from '../porta.js';
import { type FonteAssinaturaPortalMedico, sessaoDaAssinaturaRemota } from './assinatura-remota.js';
import { type CanalMedico, CanalMedicoSimulador, MOTIVO_HALAI_MEDICO_DESLIGADA } from './canal.js';

export const USUARIO_PORTAL_MEDICO = 'SGH.PORTAL';
type AcessoPortalLido = AcessoPortal;
type EstadoCirurgiaLido = Awaited<ReturnType<PortaCirurgia['estadosDoPortal']>>[number];
type VersaoPedidoLida = Awaited<ReturnType<PortaCirurgia['versoesDosPedidos']>>[number];
type GravadorCirurgia = Parameters<Parameters<PortaCirurgia['gravarSgh']>[2]>[0];
/** A chave da agenda cirúrgica do M18 (o pedido só vale se a secretaria pode confirmar pelo novo). */
export const CHAVE_AGENDA_CIRURGICA = 'cirurgia.agenda';
const TABELA_ACESSO = 'conta_portal_profissional_externo';
const TABELA_ESTADO = 'agendamento_cirurgico';
/** Pedidos de cirurgia por conta por hora (o portal é superfície pública). */
const PEDIDOS_POR_HORA = 10;
const E = EVENTOS_AUDITAVEIS;
/** W0-10: validade do link de confirmação do e-mail novo. */
export const TROCA_EMAIL_MEDICO_HORAS = 24;
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

export type SessaoPortalM26 = ReturnType<ServicoPortal['sessao']>;

/**
 * W0-10 (M4): o serviço da fila do médico interno (M27, módulo pep) que o portal reaproveita: a fila pelos registros
 * do profissional (vínculo assistencial) e os resultados do paciente com a marca de crítico.
 */
export interface FontePacientesPortalMedico {
  filaDoVinculo(
    c: ContextoPortalMedico,
    vinculo: { readonly cbos: readonly number[]; readonly login: string },
  ): Promise<WorklistMedico>;
  resultadosDoPaciente(
    c: ContextoPortalMedico,
    paciente: number,
  ): Promise<(ResultadoLido & { readonly critico: boolean })[]>;
  /** W0-10 (M5): a ciência do valor crítico (a do M23: registro novo com a conduta; para o escalonamento). */
  darCiencia(c: ContextoGravacaoPep, paciente: number, exame: number, conduta: string): Promise<number>;
}

const TABELA_PACIENTE = 'paciente';

const pacienteDoPortal = (l: LinhaWorklistMedico): PacientePortalMedico => {
  const contar = (tipo: string) => l.pendencias.find((p) => p.tipo === tipo)?.quantidade ?? 0;
  return {
    paciente: l.paciente,
    nome: l.nome,
    idade: l.idade,
    sexo: l.sexo,
    prontuario: l.prontuario,
    tipo: l.tipo,
    unidade: l.unidade,
    leito: l.leito,
    dias: l.dias,
    previsaoAlta: l.previsaoAlta,
    resultadosNovos: contar('resultado-novo'),
    criticos: contar('critico-nao-visto'),
    prioridade: l.prioridade,
  };
};

const referenciaDe = (v: ResultadoLido['valores'][number]): string | null =>
  v.referencia ?? (v.refIni !== null || v.refFin !== null ? `${v.refIni ?? ''} a ${v.refFin ?? ''}` : null);

export interface QuemInternoMedico {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly estacao: string;
  readonly correlacao: string;
  /** O contexto do núcleo da sessão interna (cliente, estabelecimento e usuário por id). */
  readonly contexto?: ContextoNucleo;
  /** A Idempotency-Key do pedido de gravação (o clique duplo devolve o mesmo resultado); ausente nas leituras. */
  readonly idempotencia?: string | null;
}

interface NoPedido {
  readonly c: ContextoPortalMedico;
  readonly s: SessaoPortalM26;
  readonly conta: AcessoPortalLido;
  readonly profissional: ProfissionalCorpoClinico | null;
}

const recusar = (codigo: string, titulo: string, detalhe: string, status = 409) =>
  new ErroProblema('recusa-de-negocio', status, titulo, detalhe, { codigo });

const TEXTO_RECUSA_PEDIDO: Readonly<Record<string, [string, string]>> = {
  'data-passada': ['Data inválida', 'Peça a cirurgia para a partir de amanhã.'],
  'data-distante': [
    'Data distante',
    `Peça a cirurgia para até ${PORTAL_MEDICO_PEDIDO_DIAS_MAX} dias: para datas mais distantes, fale com o bloco.`,
  ],
  'nascimento-invalido': ['Nascimento inválido', 'Confira a data de nascimento do paciente.'],
  'sala-inexistente': ['Sala inexistente', 'Escolha uma das salas da lista.'],
  'convenio-inexistente': ['Convênio inexistente', 'Escolha um dos convênios da lista.'],
  'procedimento-inexistente': ['Procedimento inexistente', 'Escolha o procedimento pela busca.'],
};

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '');

const somarDias = (dia: string, k: number) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};

/** O resultado de um ciclo da notificação de críticos (as recusas levam só ids e o código, nada do paciente). */
export interface ResultadoCicloCritico {
  contas: number;
  notificados: number;
  recusas: { aviso: number; acesso: number; codigo: string }[];
}

export class ServicoPortalMedico {
  private readonly pedidosPorConta = new Map<string, number[]>();
  /** W0-10: o canal do link da confirmação do e-mail novo (simulador no dev/ci; fora, desligado até o dono). */
  canal: CanalMedico = new CanalMedicoSimulador();
  /** W0-10: o endereço público do portal (o link do e-mail; vazio = caminho relativo). */
  enderecoPublico = '';
  /** W0-10 (M4): a fila do médico (módulo pep); sem ela, "meus pacientes" responde 503. */
  pacientes: FontePacientesPortalMedico | null = null;
  /** W0-10 (M6): o serviço da assinatura dos documentos (M49) para a fila de assinatura remota. */
  assinatura: FonteAssinaturaPortalMedico | null = null;
  /** W0-10 (M5): os estabelecimentos da vigia que notifica o médico do crítico (vazio: a vigia não roda). */
  hospitaisAvisoCritico: readonly string[] = [];
  private vigiaCritico: ReturnType<typeof setInterval> | null = null;
  private readonly logCritico = new Logger('PortalMedicoCriticos');
  private emCicloCritico = false;

  constructor(
    private readonly sessoes: ServicoPortal,
    private readonly sadt: PortaSadt,
    private readonly porta: PortaPortalMedico,
    private readonly cirurgia: PortaCirurgia,
    private readonly repasse: ServicoRepasse,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly rede: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  get destino(): 'banco' | 'memoria' {
    return this.porta.destino;
  }

  /** Contexto do núcleo do portal: o estabelecimento do endereço, sem usuário interno (quem age é a conta do portal). */
  private ctx(hospital: string): ContextoPortalMedico {
    return {
      ...contextoDoEstabelecimento(hospital),
      usuario: null,
      correlacao: `portal-medico-${randomBytes(6).toString('hex')}`,
      rede: this.rede,
      hospital,
    };
  }

  /** Contexto do núcleo da tela interna: o da sessão (cliente, estabelecimento e usuário por id). */
  private ctxInterno(q: QuemInternoMedico): ContextoPortalMedico {
    const chave = q.idempotencia ? { chaveIdempotencia: q.idempotencia } : {};
    return q.contexto
      ? {
          ...q.contexto,
          correlacao: q.correlacao.slice(0, 64) || q.contexto.correlacao,
          rede: q.rede,
          hospital: q.hospital,
          ...chave,
        }
      : {
          // Sessão sem o contexto do núcleo (dev/ci em memória): o estabelecimento pelo código, sem usuário por id.
          ...contextoDoEstabelecimento(q.hospital),
          usuario: null,
          correlacao: q.correlacao.slice(0, 64) || `portal-medico-${randomBytes(6).toString('hex')}`,
          rede: q.rede,
          hospital: q.hospital,
          ...chave,
        };
  }

  /** A gravação na agenda do bloco (porta da cirurgia) com a linha da trilha do portal. */
  private gravarNaCirurgia<T>(
    c: ContextoPortalMedico,
    trilha: TrilhaPortalMedico | ((r: T) => TrilhaPortalMedico),
    fn: (g: GravadorCirurgia) => Promise<T>,
  ): Promise<T> {
    // A chave de idempotência do pedido é da gravação do portal: cada gravação na agenda (por exemplo, os pedidos
    // retirados no encerramento da conta) é uma operação própria da cirurgia, sem reaproveitar a chave.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a chave sai do contexto de propósito
    const { chaveIdempotencia: _chave, ...semChave } = c;
    return this.cirurgia.gravarSgh<T>(
      semChave,
      typeof trilha === 'function' ? (r: T) => trilhaDoNucleo(c, trilha(r)) : trilhaDoNucleo(c, trilha),
      fn as never,
    );
  }

  /** A funcionalidade ligada no estabelecimento (na sessão sintética sem configuração, ligada, como o M26). */
  async ligado(hospital: string, chave: string = CHAVE_PORTAL_MEDICO): Promise<boolean> {
    if (this.porta.destino === 'memoria' && !this.configuracao) return true;
    return ligadaNoEstabelecimento(this.configuracao, this.rede, hospital, chave, USUARIO_PORTAL_MEDICO);
  }

  private async exigirLigado(hospital: string): Promise<void> {
    const [portal, medico] = await Promise.all([
      this.ligado(hospital, CHAVES_SADT.portal),
      this.ligado(hospital, CHAVE_PORTAL_MEDICO),
    ]);
    if (portal && medico) return;
    throw new ErroProblema(
      'recurso-desligado',
      403,
      'Portal indisponível',
      'O portal do médico externo ainda não foi liberado neste estabelecimento.',
      { codigo: 'recurso-desligado' },
    );
  }

  private trilha(
    hospital: string,
    evento: string,
    operacao: string,
    alvo: { tabela: string; id: string | null },
    acesso: number,
    resultado: 'sucesso' | 'falha' = 'sucesso',
  ): TrilhaPortalMedico {
    return {
      rede: this.rede,
      hospital,
      usuario: `${USUARIO_PORTAL_MEDICO}.M${acesso}`.slice(0, 31),
      evento,
      recurso: CHAVE_PORTAL_MEDICO,
      operacao,
      tabelaAlvo: alvo.tabela,
      idAlvo: alvo.id,
      chaveNaturalAlvo: null,
      resultado,
      estacao: 'portal-medico-externo',
      correlacao: `portal-medico-${randomBytes(6).toString('hex')}`,
      idPaciente: null,
    };
  }

  /**
   * A sessão do portal do médico externo no pedido: o perfil, a funcionalidade ligada, a conta relida (a que deixou de
   * estar ativa derruba a sessão) e o profissional ligado à conta (null: a conta ainda não foi ligada pelo hospital).
   */
  private async noPedido(s: SessaoPortalM26, sessaoId: string | null): Promise<NoPedido> {
    if (s.perfil !== 'medicoExterno')
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Área do médico externo',
        'Esta área do portal é do médico externo.',
      );
    await this.exigirLigado(s.hospital);
    const c = this.ctx(s.hospital);
    const conta = await this.sadt.acessoPorId(c, s.acesso);
    if (!conta || conta.perfil !== 'medicoExterno' || conta.situacao !== 'ativo') {
      this.sessoes.sair(sessaoId);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Sessão do portal encerrada',
        'O acesso ao portal foi encerrado pelo hospital.',
      );
    }
    const v = (await this.porta.vinculos(c, [s.acesso])).get(s.acesso);
    const profissional =
      v?.profissional !== null && v?.profissional !== undefined
        ? await this.porta.profissional(c, v.profissional)
        : null;
    return { c, s, conta, profissional };
  }

  // ── Portal ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async extrato(
    s: SessaoPortalM26,
    sessaoId: string | null,
    f: { competencia: string | null },
  ): Promise<ExtratoPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    if (!p.profissional) return { vinculado: false, profissional: null, extrato: null, retidos: 0 };
    const { prestadores, retidos } = await this.prestadoresDoPortal(p.c, p.profissional);
    const hoje = this.agora().toISOString().slice(0, 10);
    const extrato = await this.repasse.extratoDosPrestadores(p.c, prestadores, {
      desde: `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}`,
      competencia: f.competencia,
    });
    await this.porta.registrarLeitura(
      p.c,
      this.trilha(
        s.hospital,
        E.portalMedicoExtratoLido.codigo,
        'extrato do médico externo',
        { tabela: TABELA_ACESSO, id: String(s.acesso) },
        s.acesso,
      ),
    );
    return { vinculado: true, profissional: p.profissional.nome, extrato, retidos };
  }

  /**
   * Os códigos de prestador do extrato no portal: só os que são do profissional ligado. O repasse é lançado pelo número
   * do conselho, que se repete entre cadastros do corpo clínico; o número de outro profissional fica retido (a tela
   * interna das contas avisa o hospital) para o médico externo nunca ver o repasse de outro (DP-43, regra 6).
   */
  private async prestadoresDoPortal(
    c: ContextoPortalMedico,
    p: ProfissionalCorpoClinico,
  ): Promise<{ prestadores: number[]; retidos: number }> {
    const { prestadores } = codigosDoProfissional(p.registros);
    const donos = await this.porta.donosDosCodigos(c, prestadores);
    const r = codigosExclusivos(prestadores, donos, p.id);
    return { prestadores: r.exclusivos, retidos: r.retidos.length };
  }

  /** A conta de cada valor na competência (a memória da apuração, só dos itens do profissional). */
  async contaDoExtrato(
    s: SessaoPortalM26,
    sessaoId: string | null,
    competencia: string,
  ): Promise<ContaDoMedicoResposta> {
    const p = await this.noPedido(s, sessaoId);
    if (!p.profissional) return { competencia, demonstrativos: [] };
    const { prestadores } = await this.prestadoresDoPortal(p.c, p.profissional);
    const r = await this.repasse.contaDosPrestadores(p.c, prestadores, competencia);
    await this.porta.registrarLeitura(
      p.c,
      this.trilha(
        s.hospital,
        E.portalMedicoExtratoLido.codigo,
        'conta do extrato do médico externo',
        { tabela: TABELA_ACESSO, id: String(s.acesso) },
        s.acesso,
      ),
    );
    return r;
  }

  private async nomesDaAgenda(c: ContextoPortalMedico, procedimentos: readonly number[]) {
    const [procs, salas, o] = await Promise.all([
      this.cirurgia.nomesProcedimentos(c, [...new Set(procedimentos)]),
      this.cirurgia.salas(c, ''),
      this.cirurgia.opcoes(c),
    ]);
    return {
      procedimento: (x: number) => procs.get(x) ?? `Procedimento ${x}`,
      sala: (x: number) => salas.find((y) => y.codigo === x)?.nome || `Sala ${x}`,
      convenio: (x: number) => o.convenios.find((y) => y.codigo === x)?.nome ?? `Convênio ${x}`,
    };
  }

  private pedidoResposta(
    e: EstadoCirurgiaLido,
    n: Awaited<ReturnType<ServicoPortalMedico['nomesDaAgenda']>>,
    todas: readonly VersaoPedidoLida[] = [],
  ): PedidoPortalMedico {
    const estado = estadoValido(e.estado) ? e.estado : 'solicitado';
    const anteriores = todas.filter((v) => v.idEstado === e.id).sort((a, b) => b.versao - a.versao);
    const alteravel = estado === 'solicitado' && e.agendamento === null;
    return {
      id: e.id,
      data: e.inicio.slice(0, 10),
      hora: e.inicio.slice(11, 16),
      duracaoMin: e.duracaoMin,
      sala: n.sala(e.sala),
      paciente: e.portal?.paciente ?? '',
      nascimento: e.portal?.nascimento ?? null,
      procedimento: n.procedimento(e.procedimento),
      convenio: n.convenio(e.convenio),
      estado,
      estadoRotulo: ROTULOS_ESTADO[estado],
      motivo: e.complemento ?? null,
      retiravel: alteravel,
      versao: anteriores.length + 1,
      edicao: alteravel
        ? {
            sala: e.sala,
            data: e.inicio.slice(0, 10),
            hora: e.inicio.slice(11, 16),
            duracaoMin: e.duracaoMin,
            procedimento: e.procedimento,
            convenio: e.convenio,
            carater: e.carater ?? 2,
            anestesia: e.anestesia ?? 0,
            observacao: e.observacao ?? null,
          }
        : null,
      versoes: anteriores.map((v) => ({
        versao: v.versao,
        data: v.inicio.slice(0, 10),
        hora: v.inicio.slice(11, 16),
        duracaoMin: v.duracaoMin,
        sala: n.sala(v.sala),
        procedimento: n.procedimento(v.procedimento),
        convenio: n.convenio(v.convenio),
        paciente: v.paciente,
        observacao: v.observacao,
        motivo: v.motivo,
        substituidaEm: v.substituidaEm,
      })),
    };
  }

  async agenda(
    s: SessaoPortalM26,
    sessaoId: string | null,
    f: { de: string | null; ate: string | null },
  ): Promise<AgendaPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const r = await this.cirurgia.relogio(p.c);
    const j = janelaAgendaPortal(f.de, f.ate, r.hoje, PORTAL_MEDICO_AGENDA_DIAS_MAX);
    if ('recusa' in j)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        j.recusa === 'periodo-longo' ? 'Período longo' : 'Período inválido',
        j.recusa === 'periodo-longo'
          ? `Consulte até ${PORTAL_MEDICO_AGENDA_DIAS_MAX} dias por vez.`
          : 'Confira as datas do período.',
      );
    const podePedir = !!p.profissional && (await this.ligado(s.hospital, CHAVE_AGENDA_CIRURGICA));
    if (!p.profissional)
      return {
        vinculado: false,
        profissional: null,
        de: j.de,
        ate: j.ate,
        agendamentos: [],
        truncado: false,
        pedidos: [],
        podePedir: false,
      };
    const { cirurgioes } = codigosDoProfissional(p.profissional.registros);
    const [ags, pedidos] = await Promise.all([
      this.cirurgia.agendamentosDoCirurgiao(p.c, cirurgioes, j.de, j.ate),
      this.cirurgia.estadosDoPortal(p.c, s.acesso, somarDias(r.hoje, -PORTAL_MEDICO_PEDIDO_DIAS_MAX)),
    ]);
    const [estados, versoes] = await Promise.all([
      this.cirurgia.estadosDosAgendamentos(
        p.c,
        ags.itens.map((a) => a.id),
      ),
      this.cirurgia.versoesDosPedidos(
        p.c,
        pedidos.map((x) => x.id),
      ),
    ]);
    const n = await this.nomesDaAgenda(p.c, [
      ...ags.itens.map((a) => a.procedimento),
      ...pedidos.map((x) => x.procedimento),
      ...versoes.map((x) => x.procedimento),
    ]);
    const agendamentos: AgendamentoPortalMedico[] = ags.itens.map((a) => {
      const e = estados.get(a.id);
      const estado = e && estadoValido(e.estado) ? e.estado : 'confirmado';
      return {
        agendamento: a.id,
        data: a.inicio.slice(0, 10),
        hora: a.inicio.slice(11, 16),
        duracaoMin: a.duracaoMin,
        sala: n.sala(a.sala),
        paciente: nomeMascarado(a.paciente),
        procedimento: n.procedimento(a.procedimento),
        convenio: n.convenio(a.convenio),
        estado,
        estadoRotulo: ROTULOS_ESTADO[estado],
      };
    });
    await this.porta.registrarLeitura(
      p.c,
      this.trilha(
        s.hospital,
        E.portalMedicoAgendaLida.codigo,
        'agenda do cirurgião externo',
        { tabela: TABELA_ACESSO, id: String(s.acesso) },
        s.acesso,
      ),
    );
    return {
      vinculado: true,
      profissional: p.profissional.nome,
      de: j.de,
      ate: j.ate,
      agendamentos,
      truncado: ags.truncado,
      pedidos: pedidos.map((x) => this.pedidoResposta(x, n, versoes)),
      podePedir,
    };
  }

  async opcoes(s: SessaoPortalM26, sessaoId: string | null): Promise<OpcoesPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const [salas, o, r] = await Promise.all([
      this.cirurgia.salas(p.c, ''),
      this.cirurgia.opcoes(p.c),
      this.cirurgia.relogio(p.c),
    ]);
    return {
      salas: salas.map((x) => ({ codigo: x.codigo, nome: x.nome })),
      convenios: o.convenios.filter((x) => x.ativo).map((x) => ({ codigo: x.codigo, nome: x.nome })),
      caracteres:
        o.caracteres.length > 0
          ? o.caracteres
          : CARATERES_CIRURGIA.map((x) => ({ codigo: x.codigo, nome: x.rotulo })),
      anestesias: o.anestesias,
      hoje: r.hoje,
    };
  }

  async procedimentos(
    s: SessaoPortalM26,
    sessaoId: string | null,
    texto: string,
  ): Promise<{ codigo: number; nome: string }[]> {
    const p = await this.noPedido(s, sessaoId);
    const t = texto.trim().slice(0, 60);
    if (t.length < 3) return [];
    return this.cirurgia.buscarProcedimentos(p.c, t);
  }

  /** O pedido de cirurgia pelo portal: fica solicitado (não ocupa a sala) até a secretaria do bloco confirmar. */
  async pedir(
    s: SessaoPortalM26,
    sessaoId: string | null,
    e: PedidoCirurgiaPortal,
  ): Promise<ResultadoPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    if (!p.profissional)
      throw recusar(
        'sem-vinculo',
        'Conta sem vínculo',
        'O hospital ainda não ligou a sua conta ao cadastro do corpo clínico: o pedido de cirurgia fica liberado depois disso.',
      );
    if (!(await this.ligado(s.hospital, CHAVE_AGENDA_CIRURGICA)))
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Pedido indisponível',
        'O pedido de cirurgia pelo portal ainda não foi liberado neste estabelecimento: fale com o bloco cirúrgico.',
        { codigo: 'recurso-desligado' },
      );
    // A vaga é reservada antes de qualquer espera (pedidos simultâneos da mesma conta não leem a mesma lista) e
    // devolvida se o pedido não for gravado.
    const chave = `${s.hospital}:${s.acesso}`;
    const agora = this.agora().getTime();
    const reservada = reservarPedido(this.pedidosPorConta.get(chave) ?? [], agora, PEDIDOS_POR_HORA);
    if (!reservada)
      throw new ErroProblema(
        'muitas-tentativas',
        429,
        'Muitos pedidos',
        'Muitos pedidos de cirurgia em pouco tempo: aguarde antes de pedir de novo.',
      );
    this.pedidosPorConta.set(chave, reservada);
    let gravado = false;
    try {
      const id = await this.gravarPedido({ ...p, profissional: p.profissional }, s, e);
      gravado = true;
      return {
        ok: true,
        id,
        mensagem: 'Cirurgia pedida: a secretaria do bloco confirma a sala e a hora, e o pedido aparece aqui.',
      };
    } finally {
      if (!gravado) {
        const atual = [...(this.pedidosPorConta.get(chave) ?? [])];
        const k = atual.indexOf(agora);
        if (k >= 0) atual.splice(k, 1);
        this.pedidosPorConta.set(chave, atual);
      }
    }
  }

  /** A regra do pedido (data, sala, convênio, procedimento) e o registro de cirurgião do profissional ligado à conta. */
  private async conferirEntradaPedido(
    p: NoPedido & { profissional: ProfissionalCorpoClinico },
    e: PedidoCirurgiaPortal,
  ): Promise<number> {
    const [r, salas, o, procs] = await Promise.all([
      this.cirurgia.relogio(p.c),
      this.cirurgia.salas(p.c, ''),
      this.cirurgia.opcoes(p.c),
      this.cirurgia.nomesProcedimentos(p.c, [e.procedimento]),
    ]);
    const recusa = conferirPedidoPortal(
      {
        data: e.data,
        nascimento: e.paciente.nascimento,
        sala: e.sala,
        convenio: e.convenio,
        procedimento: e.procedimento,
      },
      {
        hoje: r.hoje,
        diasMax: PORTAL_MEDICO_PEDIDO_DIAS_MAX,
        salas: salas.map((x) => x.codigo),
        convenios: o.convenios.filter((x) => x.ativo).map((x) => x.codigo),
        procedimentoExiste: procs.has(e.procedimento),
      },
    );
    if (recusa) {
      const [titulo, detalhe] = TEXTO_RECUSA_PEDIDO[recusa] ?? ['Pedido inválido', 'Confira o pedido.'];
      throw recusar(recusa, titulo, detalhe);
    }
    const cirurgiao = registroDoPedido(p.profissional.registros, { uf: p.conta.uf, numero: p.conta.numero });
    if (cirurgiao === null)
      throw recusar(
        'sem-vinculo',
        'Conta sem vínculo',
        'O cadastro do corpo clínico ligado à sua conta não tem registro de cirurgião: fale com o hospital.',
      );
    return cirurgiao;
  }

  private async gravarPedido(
    p: NoPedido & { profissional: ProfissionalCorpoClinico },
    s: SessaoPortalM26,
    e: PedidoCirurgiaPortal,
  ): Promise<number> {
    const cirurgiao = await this.conferirEntradaPedido(p, e);
    const usuario = `${USUARIO_PORTAL_MEDICO}.M${s.acesso}`.slice(0, 31);
    try {
      return await this.gravarNaCirurgia(
        p.c,
        (x: number) =>
          this.trilha(
            s.hospital,
            E.portalMedicoCirurgiaPedida.codigo,
            'cirurgia.agenda.solicitar',
            { tabela: TABELA_ESTADO, id: String(x) },
            s.acesso,
          ),
        (g) =>
          g.solicitar({
            sala: e.sala,
            data: e.data,
            hora: e.hora,
            duracaoMin: e.duracaoMin,
            reg: 0,
            pront: 0,
            idPaciente: null,
            procedimento: e.procedimento,
            convenio: e.convenio,
            cirurgiao,
            carater: e.carater,
            anestesia: e.anestesia,
            observacao: e.observacao ?? null,
            usuario,
            portal: { acesso: s.acesso, paciente: e.paciente.nome, nascimento: e.paciente.nascimento },
          }),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  async retirar(
    s: SessaoPortalM26,
    sessaoId: string | null,
    id: number,
    motivo: string | null,
  ): Promise<ResultadoPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    try {
      await this.gravarNaCirurgia(
        p.c,
        this.trilha(
          s.hospital,
          E.portalMedicoPedidoRetirado.codigo,
          'cirurgia.agenda.cancelar',
          { tabela: TABELA_ESTADO, id: String(id) },
          s.acesso,
        ),
        (g) =>
          g.retirarPedidoPortal({
            id,
            acesso: s.acesso,
            complemento: motivo ? `Retirado pelo cirurgião: ${motivo}` : 'Retirado pelo cirurgião no portal',
            usuario: `${USUARIO_PORTAL_MEDICO}.M${s.acesso}`.slice(0, 31),
          }),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    return { ok: true, id, mensagem: 'Pedido retirado.' };
  }

  /**
   * W0-10: o médico altera o próprio pedido ainda não confirmado (o pedido inteiro, a versão que viu e o motivo). A
   * versão vigente fica guardada com o motivo (versão do pedido) na mesma transação da trilha; o
   * confirmado, cancelado ou suspenso devolve 409, e a versão desatualizada também.
   */
  async alterar(
    s: SessaoPortalM26,
    sessaoId: string | null,
    id: number,
    e: AlterarPedidoPortal,
  ): Promise<ResultadoPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    if (!p.profissional)
      throw recusar(
        'sem-vinculo',
        'Conta sem vínculo',
        'O hospital ainda não ligou a sua conta ao cadastro do corpo clínico: o pedido de cirurgia fica liberado depois disso.',
      );
    const cirurgiao = await this.conferirEntradaPedido({ ...p, profissional: p.profissional }, e);
    let versao: number;
    try {
      versao = await this.gravarNaCirurgia(
        p.c,
        this.trilha(
          s.hospital,
          E.portalMedicoPedidoAlterado.codigo,
          'cirurgia.agenda.alterarSolicitacao',
          { tabela: TABELA_ESTADO, id: String(id) },
          s.acesso,
        ),
        (g) =>
          g.alterarPedidoPortal({
            id,
            acesso: s.acesso,
            versao: e.versao,
            sala: e.sala,
            data: e.data,
            hora: e.hora,
            duracaoMin: e.duracaoMin,
            procedimento: e.procedimento,
            convenio: e.convenio,
            cirurgiao,
            carater: e.carater,
            anestesia: e.anestesia,
            observacao: e.observacao ?? null,
            paciente: e.paciente.nome,
            nascimento: e.paciente.nascimento,
            motivo: e.motivo,
            usuario: `${USUARIO_PORTAL_MEDICO}.M${s.acesso}`.slice(0, 31),
          }),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    return {
      ok: true,
      id,
      mensagem: `Pedido alterado (versão ${versao}); a versão anterior fica guardada com o motivo.`,
    };
  }

  // ── W0-10: o médico troca a senha e o e-mail da própria conta ────────────────────────────────────────────────────

  private async conferirCredenciais(p: NoPedido, senha: string, codigo: string): Promise<void> {
    if (!(await this.sessoes.credenciaisConferem(p.conta, senha, codigo)))
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Dados não conferem',
        'A senha atual ou o código do autenticador não conferem.',
        { codigo: 'dados-nao-conferem' },
      );
  }

  /** A senha nova (senha e código atuais); as outras sessões abertas da conta são encerradas. */
  async trocarSenha(
    s: SessaoPortalM26,
    sessaoId: string | null,
    e: TrocarSenhaMedicoEntrada,
  ): Promise<ResultadoPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    await this.conferirCredenciais(p, e.atual, e.codigo);
    const senhaResumo = await cifrarSenha(e.nova);
    try {
      await this.porta.gravar(
        p.c,
        (g) =>
          g.trocarSenha({
            acesso: s.acesso,
            senhaResumo,
            por: `${USUARIO_PORTAL_MEDICO}.M${s.acesso}`.slice(0, 31),
          }),
        this.trilha(
          s.hospital,
          E.portalMedicoSenhaTrocada.codigo,
          'portal.medico.trocarSenha',
          { tabela: TABELA_ACESSO, id: String(s.acesso) },
          s.acesso,
        ),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    this.sessoes.encerrarSessoesDaConta(s.hospital, s.acesso, sessaoId);
    return { ok: true, id: s.acesso, mensagem: 'Senha trocada. As outras sessões abertas foram encerradas.' };
  }

  /**
   * O pedido da troca do e-mail (senha e código atuais): o link vai ao e-mail NOVO pelo canal (simulador no dev; fora,
   * desligado até o dono ligar a Hal-AI) e a conta segue com o e-mail antigo até a confirmação. O pedido só é gravado
   * se o canal puder enviar; o pendente anterior é cancelado na mesma transação.
   */
  async pedirTrocaEmail(
    s: SessaoPortalM26,
    sessaoId: string | null,
    e: PedirTrocaEmailMedicoEntrada,
  ): Promise<TrocaEmailMedicoPedida> {
    const p = await this.noPedido(s, sessaoId);
    await this.conferirCredenciais(p, e.senha, e.codigo);
    const canal = await this.canal.disponivel(s.hospital);
    if (!canal.envio)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Envio desligado',
        canal.motivo ?? 'O envio ao médico está desligado.',
        {
          codigo: 'canal-desligado',
        },
      );
    const envio = canal.envio;
    const token = randomBytes(32).toString('base64url');
    const validoAte = new Date(this.agora().getTime() + TROCA_EMAIL_MEDICO_HORAS * 3_600_000);
    try {
      await this.porta.gravar(
        p.c,
        (g) =>
          g.pedirTrocaEmail({
            acesso: s.acesso,
            emailNovo: e.email,
            tokenResumo: sha256(token),
            validoAte,
            envio,
          }),
        this.trilha(
          s.hospital,
          E.portalMedicoEmailTrocaPedida.codigo,
          'portal.medico.trocarEmail',
          { tabela: TABELA_ACESSO, id: String(s.acesso) },
          s.acesso,
        ),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    const caminho = `/medico-externo/email/confirmar?h=${encodeURIComponent(s.hospital)}&t=${token}`;
    await this.canal.enviar({
      hospital: s.hospital,
      acesso: s.acesso,
      tipo: 'confirmacao-email',
      destino: e.email,
      link: `${this.enderecoPublico.replace(/\/$/, '')}${caminho}`,
      validoAte: validoAte.toISOString(),
    });
    return { envio, emailMascarado: mascararEmail(e.email) ?? '', validoAte: validoAte.toISOString() };
  }

  /** O pedido pendente da conta (para onde foi o link e até quando vale); o vencido não aparece. */
  async trocaEmailPendente(
    s: SessaoPortalM26,
    sessaoId: string | null,
  ): Promise<TrocaEmailMedicoPedida | null> {
    const p = await this.noPedido(s, sessaoId);
    const t = await this.porta.trocaEmailPendente(p.c, s.acesso);
    if (!t || t.validoAte <= this.agora()) return null;
    return {
      envio: t.envio,
      emailMascarado: mascararEmail(t.emailNovo) ?? '',
      validoAte: t.validoAte.toISOString(),
    };
  }

  /** O médico desiste do pedido pendente (fica cancelado; nada é apagado). */
  async cancelarTrocaEmail(s: SessaoPortalM26, sessaoId: string | null): Promise<ResultadoPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const t = await this.porta.trocaEmailPendente(p.c, s.acesso);
    if (!t) throw new ErroProblema('nao-encontrado', 404, 'Nenhuma troca de e-mail pendente');
    try {
      await this.porta.gravar(
        p.c,
        (g) => g.cancelarTrocaEmail(t.id),
        this.trilha(
          s.hospital,
          E.portalMedicoEmailTrocaPedida.codigo,
          'portal.medico.cancelarTrocaEmail',
          { tabela: TABELA_ACESSO, id: String(s.acesso) },
          s.acesso,
        ),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    return { ok: true, id: s.acesso, mensagem: 'Troca do e-mail cancelada.' };
  }

  /**
   * O link do e-mail novo (rota pública): a conta ativa passa ao e-mail novo, o ato 'troca-email' fica no histórico e
   * as sessões abertas da conta são encerradas. O link usado, cancelado ou vencido não vale (410).
   */
  async confirmarTrocaEmail(hospital: string, token: string): Promise<{ emailMascarado: string }> {
    await this.exigirLigado(hospital);
    const c = this.ctx(hospital);
    const tokenResumo = sha256(token);
    const t = await this.porta.trocaEmailPorToken(c, tokenResumo);
    if (!t || t.situacao !== 'pendente' || t.validoAte <= this.agora())
      throw new ErroProblema(
        'recusa-de-negocio',
        410,
        'Link vencido',
        'Este link de confirmação não vale mais. Peça a troca do e-mail de novo no portal.',
        { codigo: 'link-invalido' },
      );
    let r: { acesso: number; emailNovo: string };
    try {
      r = await this.porta.gravar(
        c,
        (g) =>
          g.confirmarTrocaEmail({
            tokenResumo,
            agora: this.agora(),
            por: `${USUARIO_PORTAL_MEDICO}.M${t.acesso}`.slice(0, 31),
          }),
        this.trilha(
          hospital,
          E.portalMedicoEmailTrocado.codigo,
          'portal.medico.trocarEmail',
          { tabela: TABELA_ACESSO, id: String(t.acesso) },
          t.acesso,
        ),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    this.sessoes.encerrarSessoesDaConta(hospital, r.acesso);
    return { emailMascarado: mascararEmail(r.emailNovo) ?? '' };
  }

  // ── Lado interno ────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * As contas aprovadas do portal do médico externo, filtradas (nome ou número do conselho; ligadas ou sem vínculo) e
   * paginadas; os profissionais, as sugestões e os donos dos números saem em lote (uma consulta cada), só da página.
   */
  async contas(q: QuemInternoMedico, f: FiltroContasMedicoExterno): Promise<ContasMedicoExterno> {
    const c = this.ctxInterno(q);
    const hoje = this.agora().toISOString().slice(0, 10);
    const todos = await this.sadt.autocadastros(c, { desde: somarDias(hoje, -3650) });
    // W0-10: as aprovadas (ativas, bloqueadas e encerradas); as encerradas só pelo filtro próprio.
    const situacaoDe = (a: { situacaoConta?: string }): SituacaoContaMedicoExterno =>
      a.situacaoConta === 'bloqueado' || a.situacaoConta === 'encerrado' ? a.situacaoConta : 'ativo';
    const ativas = todos.filter((a) => a.origem === 'novo' && a.situacao === 'aprovado');
    const vinculos = new Map<number, VinculoMedicoExterno>();
    for (let k = 0; k < ativas.length; k += 400) {
      const m = await this.porta.vinculos(
        c,
        ativas.slice(k, k + 400).map((a) => a.id),
      );
      for (const [id, v] of m) vinculos.set(id, v);
    }
    const termo = semAcento((f.q ?? '').trim()).toUpperCase();
    const filtradas = ativas.filter((a) => {
      const ligada = (vinculos.get(a.id)?.profissional ?? null) !== null;
      const sit = situacaoDe(a);
      if ((f.situacao === 'encerradas') !== (sit === 'encerrado')) return false;
      if (f.situacao === 'bloqueadas' && sit !== 'bloqueado') return false;
      if (f.situacao === 'ligadas' && !ligada) return false;
      if (f.situacao === 'sem-vinculo' && ligada) return false;
      if (!termo) return true;
      return /^\d+$/.test(termo) ? a.numero.includes(termo) : semAcento(a.nome).toUpperCase().includes(termo);
    });
    const porPagina = PORTAL_MEDICO_CONTAS_POR_PAGINA;
    const paginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
    const pagina = Math.min(f.pagina, paginas);
    const daPagina = filtradas.slice((pagina - 1) * porPagina, pagina * porPagina);
    const ids = daPagina
      .map((a) => vinculos.get(a.id)?.profissional ?? null)
      .filter((x): x is number => x !== null);
    const semVinculo = daPagina.filter((a) => (vinculos.get(a.id)?.profissional ?? null) === null);
    const [profs, sugestoes, abertos] = await Promise.all([
      this.porta.profissionais(c, ids),
      this.porta.sugestoesEmLote(
        c,
        semVinculo.map((a) => ({ uf: a.uf, numero: Number(a.numero) })),
      ),
      this.cirurgia.estadosDoPeriodo(c, hoje, somarDias(hoje, PORTAL_MEDICO_PEDIDO_DIAS_MAX)),
    ]);
    const daConta = new Map<number, EstadoCirurgiaLido[]>();
    for (const x of abertos)
      if (x.portal && x.estado === 'solicitado' && x.agendamento === null)
        daConta.set(x.portal.acesso, [...(daConta.get(x.portal.acesso) ?? []), x]);
    const naPagina = daPagina.flatMap((a) => daConta.get(a.id) ?? []);
    const [donos, n] = await Promise.all([
      this.porta.donosDosCodigos(
        c,
        [...profs.values()].flatMap((p) => codigosDoProfissional(p.registros).prestadores),
      ),
      naPagina.length > 0
        ? this.nomesDaAgenda(
            c,
            naPagina.map((x) => x.procedimento),
          )
        : null,
    ]);
    const contas: ContaMedicoExterno[] = daPagina.map((a) => {
      const v = vinculos.get(a.id);
      const prof = v?.profissional ? (profs.get(v.profissional) ?? null) : null;
      const pedidos = [...(daConta.get(a.id) ?? [])].sort((x, y) => x.inicio.localeCompare(y.inicio));
      return {
        acesso: a.id,
        situacao: situacaoDe(a),
        nome: a.nome,
        conselho: a.conselho,
        uf: a.uf,
        numero: a.numero,
        profissional: prof ? { id: prof.id, nome: prof.nome } : null,
        vinculadoPor: v?.vinculadoPor ?? null,
        vinculadoEm: v?.vinculadoEm ?? null,
        sugestoes: prof ? [] : (sugestoes.get(`${a.uf}:${Number(a.numero)}`) ?? []),
        pedidosAbertos: pedidos.length,
        pedidos: n
          ? pedidos.map((x) => ({
              id: x.id,
              data: x.inicio.slice(0, 10),
              hora: x.inicio.slice(11, 16),
              sala: n.sala(x.sala),
              procedimento: n.procedimento(x.procedimento),
              paciente: nomeMascarado(x.portal?.paciente ?? ''),
            }))
          : [],
        codigosCompartilhados: prof
          ? codigosExclusivos(codigosDoProfissional(prof.registros).prestadores, donos, prof.id).retidos
          : [],
      };
    });
    return {
      contas,
      total: filtradas.length,
      pagina,
      porPagina,
      liberado: await this.ligado(q.hospital),
    };
  }

  buscarProfissionais(q: QuemInternoMedico, texto: string): Promise<{ id: number; nome: string }[]> {
    return this.porta.buscarProfissionais(this.ctxInterno(q), texto);
  }

  /** A linha da trilha do vínculo: ligar e desligar com eventos próprios e o profissional na chave do alvo. */
  private linhaInterna(
    q: QuemInternoMedico,
    acesso: number,
    evento: string,
    profissional: number | null,
  ): TrilhaPortalMedico {
    return {
      rede: q.rede,
      hospital: q.hospital,
      usuario: q.login,
      evento,
      recurso: CHAVE_PORTAL_MEDICO,
      operacao: 'portal.vincularMedicoExterno',
      tabelaAlvo: TABELA_ACESSO,
      idAlvo: String(acesso),
      chaveNaturalAlvo: profissional !== null ? `profissional=${profissional}` : null,
      resultado: 'sucesso',
      estacao: q.estacao.slice(0, 80),
      correlacao: q.correlacao.slice(0, 64),
      idPaciente: null,
    };
  }

  async vincular(q: QuemInternoMedico, acesso: number, profissional: number): Promise<ResultadoPortalMedico> {
    const c = this.ctxInterno(q);
    const conta = await this.sadt.acessoPorId(c, acesso);
    if (!conta || conta.perfil !== 'medicoExterno')
      throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
    try {
      await this.porta.gravar(
        c,
        (g) => g.vincular({ acesso, profissional, por: q.login }),
        this.linhaInterna(q, acesso, E.portalMedicoVinculado.codigo, profissional),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    return {
      ok: true,
      id: acesso,
      mensagem: 'Conta ligada ao corpo clínico: o médico já vê o extrato e a agenda dele no portal.',
    };
  }

  async desvincular(q: QuemInternoMedico, acesso: number): Promise<ResultadoPortalMedico> {
    const c = this.ctxInterno(q);
    // O profissional que estava ligado vai à trilha (o UPDATE apaga o vínculo da linha).
    const anterior = (await this.porta.vinculos(c, [acesso])).get(acesso)?.profissional ?? null;
    try {
      await this.porta.gravar(
        c,
        (g) => g.desvincular({ acesso, por: q.login }),
        this.linhaInterna(q, acesso, E.portalMedicoDesvinculado.codigo, anterior),
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    return { ok: true, id: acesso, mensagem: 'Conta desligada do corpo clínico.' };
  }

  // ── W0-10: bloqueio, desbloqueio e encerramento da conta ────────────────────────────────────────────────────────

  /** Os pedidos da conta aguardando a secretaria do bloco (solicitados, sem agendamento), do mais próximo ao mais distante. */
  private async pedidosPendentes(c: ContextoPortalMedico, acesso: number): Promise<EstadoCirurgiaLido[]> {
    const hoje = this.agora().toISOString().slice(0, 10);
    const abertos = await this.cirurgia.estadosDoPeriodo(
      c,
      hoje,
      somarDias(hoje, PORTAL_MEDICO_PEDIDO_DIAS_MAX),
    );
    return abertos
      .filter((x) => x.portal?.acesso === acesso && x.estado === 'solicitado' && x.agendamento === null)
      .sort((x, y) => x.inicio.localeCompare(y.inicio));
  }

  /**
   * O ato do hospital sobre a conta aprovada (NGS1.03.08/09 d: a conta que operou não se exclui): bloquear (não entra no
   * portal; reversível), desbloquear ou encerrar (definitivo), sempre com motivo. O encerramento com pedidos de cirurgia
   * aguardando o bloco mostra a contagem e exige a decisão: 'retirar' (cada pedido cancelado com o motivo, pela operação
   * do M18, com a trilha própria) ou 'manter' (a secretaria do bloco decide). A conta muda antes da retirada: a encerrada
   * já não pede cirurgia, e nenhum pedido novo escapa da decisão.
   */
  async atoConta(
    q: QuemInternoMedico,
    acesso: number,
    e: AtoContaMedicoExternoEntrada,
  ): Promise<ResultadoAtoContaMedicoExterno> {
    const c = this.ctxInterno(q);
    const conta = await this.sadt.acessoPorId(c, acesso);
    if (!conta || conta.perfil !== 'medicoExterno')
      throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
    const pendentes = e.ato === 'encerramento' ? await this.pedidosPendentes(c, acesso) : [];
    const n =
      pendentes.length > 0
        ? await this.nomesDaAgenda(
            c,
            pendentes.map((x) => x.procedimento),
          )
        : null;
    const amostra = pendentes.map(
      (x) =>
        `${x.inicio.slice(0, 10).split('-').reverse().join('/')} ${x.inicio.slice(11, 16)} · ${n?.sala(x.sala)} · ${n?.procedimento(x.procedimento)}`,
    );
    const decisao = e.pedidos ?? null;
    if (pendentes.length > 0 && !decisao)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Pedidos aguardando o bloco',
        `A conta tem ${pendentes.length} pedido(s) de cirurgia aguardando o bloco: decida se serão retirados ou mantidos para a secretaria do bloco.`,
        {
          codigo: 'pedidos-pendentes',
          campos: ['pedidos'],
          dependentes: [
            {
              rotulo: 'Pedidos de cirurgia aguardando o bloco',
              quantidade: pendentes.length,
              amostra: amostra.slice(0, 10),
              origem: 'logica',
            },
          ],
        },
      );
    const evento =
      e.ato === 'bloqueio'
        ? E.portalMedicoContaBloqueada
        : e.ato === 'desbloqueio'
          ? E.portalMedicoContaDesbloqueada
          : E.portalMedicoContaEncerrada;
    let r: { situacao: SituacaoContaMedicoExterno };
    try {
      r = await this.porta.gravar(
        c,
        (g) =>
          g.atoConta({
            acesso,
            ato: e.ato,
            motivo: e.motivo,
            pedidosPendentes: pendentes.length,
            decisaoPedidos: decisao,
            amostraPedidos: amostra,
            por: q.login,
          }),
        {
          ...this.linhaInterna(q, acesso, evento.codigo, null),
          operacao: `portal.medicoExterno.${e.ato}`,
          chaveNaturalAlvo: pendentes.length > 0 ? `pedidos=${pendentes.length};decisao=${decisao}` : null,
        },
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
    let retirados = 0;
    if (decisao === 'retirar')
      for (const p of pendentes)
        try {
          await this.gravarNaCirurgia(
            c,
            {
              ...this.linhaInterna(q, acesso, E.portalMedicoPedidoRetiradoNoEncerramento.codigo, null),
              operacao: 'cirurgia.agenda.cancelar',
              tabelaAlvo: TABELA_ESTADO,
              idAlvo: String(p.id),
              chaveNaturalAlvo: `acesso=${acesso}`,
            },
            (g) =>
              g.retirarPedidoPortal({
                id: p.id,
                acesso,
                complemento: `Retirado no encerramento da conta: ${e.motivo}`.slice(0, 200),
                usuario: q.login,
              }),
          );
          retirados++;
        } catch {
          // O bloco confirmou o pedido entre a leitura e o ato: ele segue no mapa e a conta já está encerrada.
        }
    const naoRetirados = decisao === 'retirar' ? pendentes.length - retirados : 0;
    const mensagem =
      e.ato === 'bloqueio'
        ? 'Conta bloqueada: o médico não entra no portal até o desbloqueio.'
        : e.ato === 'desbloqueio'
          ? 'Conta desbloqueada: o médico volta a entrar no portal.'
          : pendentes.length === 0
            ? 'Conta encerrada.'
            : decisao === 'retirar'
              ? `Conta encerrada; ${retirados} pedido(s) retirado(s)${naoRetirados > 0 ? ` e ${naoRetirados} já confirmado(s) pelo bloco` : ''}.`
              : `Conta encerrada; ${pendentes.length} pedido(s) mantido(s) para a secretaria do bloco.`;
    return {
      ok: true,
      id: acesso,
      situacao: r.situacao,
      mensagem,
      pedidosRetirados: retirados,
      pedidosNaoRetirados: naoRetirados,
    };
  }

  /** O histórico dos atos da conta (bloqueios, desbloqueios, encerramento e trocas). */
  async atosConta(q: QuemInternoMedico, acesso: number): Promise<AtoContaMedicoExternoItem[]> {
    const c = this.ctxInterno(q);
    const conta = await this.sadt.acessoPorId(c, acesso);
    if (!conta || conta.perfil !== 'medicoExterno')
      throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
    return this.porta.atosConta(c, acesso);
  }

  // ── W0-10 (M4): meus pacientes e o resumo do prontuário (acesso remoto registrado) ───────────────────────────────

  private fontePacientes(): FontePacientesPortalMedico {
    if (this.pacientes) return this.pacientes;
    throw new ErroProblema(
      'indisponivel',
      503,
      'Pacientes indisponíveis',
      'A lista de pacientes não está disponível neste ambiente.',
    );
  }

  /** A fila do profissional ligado à conta, pelos registros dele (o vínculo assistencial da fila interna). */
  private async filaDaConta(p: NoPedido): Promise<WorklistMedico | null> {
    if (!p.profissional) return null;
    return this.fontePacientes().filaDoVinculo(p.c, {
      // O vínculo assistencial do profissional (no banco, o profissional_id; ver ProfissionalCorpoClinico).
      cbos: p.profissional.vinculoAssistencial,
      login: `${USUARIO_PORTAL_MEDICO}.M${p.s.acesso}`,
    });
  }

  async meusPacientes(s: SessaoPortalM26, sessaoId: string | null): Promise<MeusPacientesPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const fila = await this.filaDaConta(p);
    if (!fila || !p.profissional)
      return {
        vinculado: false,
        profissional: null,
        pacientes: [],
        total: 0,
        teto: PORTAL_MEDICO_PACIENTES_TETO,
        limitado: false,
        geradaEm: null,
      };
    await this.porta.registrarLeitura(
      p.c,
      this.trilha(
        s.hospital,
        E.portalMedicoPacientesLidos.codigo,
        `meus pacientes do médico externo (${fila.total})`,
        { tabela: TABELA_ACESSO, id: String(s.acesso) },
        s.acesso,
      ),
    );
    return {
      vinculado: true,
      profissional: p.profissional.nome,
      pacientes: fila.pacientes.map(pacienteDoPortal),
      total: fila.total,
      teto: PORTAL_MEDICO_PACIENTES_TETO,
      limitado: fila.limitado,
      geradaEm: fila.geradaEm,
    };
  }

  /**
   * O resumo do prontuário de um paciente da fila (a mesma regra de acesso: só com vínculo assistencial). O acesso vai
   * à trilha com o paciente (momento, responsável e registro); o negado também, com resultado 'falha', e devolve 403.
   */
  async prontuario(
    s: SessaoPortalM26,
    sessaoId: string | null,
    paciente: number,
  ): Promise<ProntuarioPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const fila = await this.filaDaConta(p);
    const linha = fila?.pacientes.find((x) => x.paciente === paciente) ?? null;
    const registrar = (resultado: 'sucesso' | 'falha') =>
      this.porta.registrarLeitura(p.c, {
        ...this.trilha(
          s.hospital,
          E.portalMedicoProntuarioAcessado.codigo,
          resultado === 'sucesso'
            ? 'acesso remoto ao prontuário pelo médico externo'
            : 'acesso remoto negado: sem vínculo assistencial',
          { tabela: TABELA_PACIENTE, id: String(paciente) },
          s.acesso,
          resultado,
        ),
        idPaciente: paciente,
      });
    if (!linha) {
      await registrar('falha');
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Paciente fora da sua lista',
        'Você só abre o prontuário dos pacientes com vínculo assistencial seu neste hospital.',
        { codigo: 'sem-vinculo-assistencial' },
      );
    }
    const resultados = await this.fontePacientes().resultadosDoPaciente(p.c, paciente);
    await registrar('sucesso');
    return {
      paciente: pacienteDoPortal(linha),
      resultados: resultados.map((r) => ({
        exame: r.exame,
        nome: r.nome,
        liberadoEm: r.liberadoEm,
        critico: r.critico,
        valores: r.valores.map((v) => ({
          elemento: v.elemento,
          valor: v.numerico !== null ? String(v.numerico) : v.alfa,
          unidade: v.unidade,
          referencia: referenciaDe(v),
        })),
        texto: r.texto,
      })),
    };
  }

  // ── W0-10 (M5): aviso de resultado crítico ao médico assistente externo ─────────────────────────────────────────
  // O aviso, o prazo e o escalonamento ao plantonista e ao supervisor são os do valor crítico do hospital (M26, a vigia
  // do SADT); a ciência é a do prontuário (M23, registro novo com a conduta), que para o escalonamento. Aqui: os avisos
  // dos pacientes com vínculo assistencial do médico, a ciência dada no portal e a notificação da conta (uma por aviso,
  // registrada; pelo canal: simulador no dev, Hal-AI desligada fora até o dono ligar), sem dado do paciente na mensagem.

  private async avisosDaFila(c: ContextoPortalMedico, fila: WorklistMedico, pendentes = false) {
    const daFila = new Set(fila.pacientes.map((x) => x.paciente));
    const { hoje } = await this.sadt.relogio(c);
    const avisos = await this.sadt.avisos(c, {
      inicio: somarDias(hoje, -(PORTAL_MEDICO_CRITICOS_DIAS - 1)),
      fim: hoje,
      pendentes,
    });
    return avisos.filter((a) => a.paciente.id !== null && daFila.has(a.paciente.id));
  }

  private avisoDoPortal(a: AvisoCritico, n: NotificacaoCriticoMedico | undefined): AvisoCriticoPortalMedico {
    return {
      aviso: a.id,
      paciente: a.paciente.id ?? 0,
      nome: a.paciente.nome,
      prontuario: String(a.paciente.prontuario),
      exame: a.exame,
      elemento: a.elemento,
      valor: a.valor,
      liberadoEm: a.liberadoEm,
      emitidoEm: a.emitidoEm,
      prazoEm: a.prazoEm,
      nivel: a.nivel,
      nivelRotulo: a.nivelRotulo,
      situacao: a.situacao,
      ciencia: a.ciencia,
      notificacao: n ? { envio: n.envio, em: n.em } : null,
    };
  }

  /** Os avisos de crítico dos pacientes do médico (os sem ciência primeiro); a leitura vai à trilha. */
  async criticos(
    s: SessaoPortalM26,
    sessaoId: string | null,
  ): Promise<CriticosPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const fila = await this.filaDaConta(p);
    if (!fila) return { vinculado: false, avisos: [], pendentes: 0 };
    const [avisos, notificacoes] = await Promise.all([
      this.avisosDaFila(p.c, fila),
      this.porta.notificacoesCritico(p.c, s.acesso),
    ]);
    const porAviso = new Map(notificacoes.map((n) => [n.aviso, n]));
    const lista = avisos
      .map((a) => this.avisoDoPortal(a, porAviso.get(a.id)))
      .sort(
        (x, y) =>
          Number(x.ciencia !== null) - Number(y.ciencia !== null) || y.emitidoEm.localeCompare(x.emitidoEm),
      );
    const pendentes = lista.filter((a) => !a.ciencia).length;
    await this.porta.registrarLeitura(
      p.c,
      this.trilha(
        s.hospital,
        E.portalMedicoCriticosLidos.codigo,
        `avisos de crítico do médico externo (${lista.length}; ${pendentes} sem ciência)`,
        { tabela: TABELA_ACESSO, id: String(s.acesso) },
        s.acesso,
      ),
    );
    return { vinculado: true, avisos: lista, pendentes };
  }

  /**
   * A ciência do crítico pelo médico externo: só aviso de paciente com vínculo assistencial dele (404 fora da lista) e
   * ainda sem ciência (409). É a ciência do prontuário (registro novo com a conduta), que para o escalonamento; a
   * trilha leva o aviso e o paciente.
   */
  async cienciaCritico(
    s: SessaoPortalM26,
    sessaoId: string | null,
    aviso: number,
    e: CienciaCriticoMedico,
  ): Promise<ResultadoPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const fila = await this.filaDaConta(p);
    const a = fila ? (await this.avisosDaFila(p.c, fila)).find((x) => x.id === aviso) : undefined;
    if (!a || a.paciente.id === null)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Aviso não encontrado',
        'O aviso não é de um paciente seu ou já saiu da janela do portal.',
        { codigo: 'aviso-fora-da-lista' },
      );
    if (a.ciencia)
      throw recusar(
        'ciencia-registrada',
        'Ciência já registrada',
        `A ciência deste resultado já foi registrada em ${a.ciencia.em.replace('T', ' ').slice(0, 16)}.`,
      );
    const usuario = `${USUARIO_PORTAL_MEDICO}.M${s.acesso}`.slice(0, 31);
    const contexto: ContextoGravacaoPep = {
      ...p.c,
      usuarioLogin: usuario,
      traceId: p.c.correlacao,
      estacao: 'portal-medico-externo',
    };
    const id = await this.fontePacientes().darCiencia(contexto, a.paciente.id, a.exame, e.conduta);
    await this.porta.registrarLeitura(p.c, {
      ...this.trilha(
        s.hospital,
        E.portalMedicoCriticoCiente.codigo,
        `ciência do crítico pelo médico externo (aviso ${a.id})`,
        { tabela: 'aviso_valor_critico', id: String(a.id) },
        s.acesso,
      ),
      chaveNaturalAlvo: `ciencia=${id}`,
      idPaciente: a.paciente.id,
    });
    return { ok: true, id, mensagem: 'Ciência registrada. O aviso não sobe mais ao plantonista.' };
  }

  // ── W0-10 (M6): fila de assinatura remota ───────────────────────────────────────────────────────────────────────

  /**
   * O login do sistema do profissional ligado à conta (o autor dos documentos): null sem vínculo ou sem login. Nunca
   * vem da tela.
   */
  private async loginDaAssinatura(p: NoPedido): Promise<string | null> {
    if (!p.profissional) return null;
    return this.porta.loginDoProfissional(p.c, p.profissional.id);
  }

  private sessaoAssinatura(p: NoPedido, login: string, ip: string | null) {
    return sessaoDaAssinaturaRemota({
      rede: this.rede,
      hospital: p.s.hospital,
      login,
      acesso: p.s.acesso,
      ip,
      contexto: p.c,
    });
  }

  private fonteAssinatura(): FonteAssinaturaPortalMedico {
    if (this.assinatura) return this.assinatura;
    throw new ErroProblema(
      'indisponivel',
      503,
      'Assinatura indisponível',
      'A assinatura remota não está disponível neste ambiente.',
    );
  }

  /** Desligada (a chave `assinatura.icp`, o serviço ou o provedor): a fila diz o motivo, sem erro. */
  private desligadaPor(x: unknown): string | null {
    if (!(x instanceof ErroProblema)) return null;
    const st = x.getStatus();
    if (st !== 403 && st !== 503) return null;
    const r = x.getResponse() as { detail?: string } | string;
    return (
      (typeof r === 'object' && r?.detail) || 'A assinatura remota está desligada neste estabelecimento.'
    );
  }

  /**
   * A fila: os documentos do profissional ligado que aguardam a assinatura ICP-Brasil, e o certificado em nuvem ativo
   * dele. A leitura vai à trilha (só a conta e o total).
   */
  async assinaturas(
    s: SessaoPortalM26,
    sessaoId: string | null,
    ip: string | null = null,
  ): Promise<AssinaturasPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const vazia = (x: Partial<AssinaturasPortalMedico>): AssinaturasPortalMedico => ({
      vinculado: p.profissional !== null,
      comLogin: false,
      ligada: false,
      motivoDesligada: null,
      certificado: null,
      documentos: [],
      limitado: false,
      ...x,
    });
    const login = await this.loginDaAssinatura(p);
    if (!login) return vazia({});
    let fila;
    try {
      fila = await this.fonteAssinatura().fila(this.sessaoAssinatura(p, login, ip));
    } catch (x) {
      const motivo = this.desligadaPor(x);
      if (motivo === null) throw x;
      return vazia({ comLogin: true, motivoDesligada: motivo });
    }
    const ligada = fila.liberada && fila.modo !== 'desligado';
    const certificado = fila.certificados.find((c) => c.ativo && c.midia === 'nuvem') ?? null;
    const documentos = fila.itens.map((i) => ({
      documento: i.documento,
      titulo: i.titulo,
      paciente: i.paciente,
      nome: i.nome,
      emitidoEm: i.emitidoEm,
      exigencia: i.exigencia,
      situacao: i.situacao,
    }));
    await this.porta.registrarLeitura(
      p.c,
      this.trilha(
        s.hospital,
        E.portalMedicoAssinaturasLidas.codigo,
        `fila de assinatura remota do médico externo (${documentos.length})`,
        { tabela: TABELA_ACESSO, id: String(s.acesso) },
        s.acesso,
      ),
    );
    return {
      vinculado: true,
      comLogin: true,
      ligada,
      motivoDesligada: ligada
        ? null
        : (fila.motivoDesligada ?? 'A assinatura remota está desligada neste estabelecimento.'),
      certificado,
      documentos,
      limitado: fila.limitado,
    };
  }

  /**
   * Assina o lote escolhido com o certificado em nuvem do profissional: a prévia exata de cada documento (o hash do
   * PDF com o selo) e o pedido numa autorização só do provedor, que devolve à tela do portal. Os documentos fora da
   * fila do profissional são recusados pelo próprio serviço do M49 (não é o autor, suspenso, tipo sem ICP...).
   */
  async assinar(
    s: SessaoPortalM26,
    sessaoId: string | null,
    e: AssinarPortalMedico,
    ip: string | null = null,
  ): Promise<InicioAssinaturaPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const login = await this.loginDaAssinatura(p);
    if (!login)
      throw recusar(
        'sem-login-do-profissional',
        'Assinatura indisponível',
        'A conta não está ligada a um profissional com acesso ao sistema do hospital.',
      );
    const fonte = this.fonteAssinatura();
    const sa = this.sessaoAssinatura(p, login, ip);
    const fila = await fonte.fila(sa);
    const cert = fila.certificados.find((c) => c.ativo && c.midia === 'nuvem');
    if (!cert)
      throw recusar(
        'sem-certificado-nuvem',
        'Sem certificado em nuvem',
        'Vincule no hospital o seu certificado em nuvem (ICP-Brasil) para assinar pelo portal.',
      );
    const lote = await fonte.prepararLote(sa, { documentos: e.documentos, certificado: cert.id });
    const recusados = [...lote.recusados];
    let endereco: string | null = null;
    let expiraEm: string | null = null;
    if (lote.itens.length) {
      const r = await fonte.pedir(
        sa,
        {
          documentos: lote.itens.map((i) => i.documento),
          hashes: lote.itens.map((i) => i.hash),
          certificado: cert.id,
        },
        fonte.retorno,
      );
      recusados.push(...r.recusados);
      if (r.inicio?.tipo === 'nuvem') {
        endereco = r.inicio.endereco;
        expiraEm = r.inicio.expiraEm;
      }
    }
    await this.porta.registrarLeitura(
      p.c,
      this.trilha(
        s.hospital,
        E.portalMedicoAssinaturaPedida.codigo,
        `assinatura remota pedida (${e.documentos.length} documento(s); ${recusados.length} recusado(s))`,
        { tabela: TABELA_ACESSO, id: String(s.acesso) },
        s.acesso,
        endereco ? 'sucesso' : 'falha',
      ),
    );
    return { endereco, expiraEm, recusados };
  }

  /**
   * A volta do provedor (a tela do portal manda o state e o código): o serviço do M49 consome o pedido do profissional
   * (uma vez só, no prazo, do mesmo login e estabelecimento), troca o código e conclui o lote.
   */
  async concluirAssinatura(
    s: SessaoPortalM26,
    sessaoId: string | null,
    q: RetornoAssinaturaPortalMedico,
    ip: string | null = null,
  ): Promise<ResultadoAssinaturaPortalMedico> {
    const p = await this.noPedido(s, sessaoId);
    const login = await this.loginDaAssinatura(p);
    if (!login)
      throw recusar(
        'sem-login-do-profissional',
        'Assinatura indisponível',
        'A conta não está ligada a um profissional com acesso ao sistema do hospital.',
      );
    const fonte = this.fonteAssinatura();
    const r = await fonte.concluir(this.sessaoAssinatura(p, login, ip), q, fonte.retorno);
    const lote = r.lote ?? { assinados: 0, pendentes: 0, recusados: 0 };
    const res: ResultadoAssinaturaPortalMedico = {
      ok: r.ok && r.finalidade === 'documento',
      motivo: r.finalidade === 'documento' ? r.motivo : (r.motivo ?? 'autorizacao-expirada'),
      ...lote,
    };
    await this.porta.registrarLeitura(
      p.c,
      this.trilha(
        s.hospital,
        E.portalMedicoAssinaturaConcluida.codigo,
        `assinatura remota: ${lote.assinados} assinado(s), ${lote.pendentes} pendente(s), ${lote.recusados} recusado(s)`,
        { tabela: TABELA_ACESSO, id: String(s.acesso) },
        s.acesso,
        res.ok ? 'sucesso' : 'falha',
      ),
    );
    return res;
  }

  /**
   * Um ciclo da notificação no estabelecimento: para cada conta ativa ligada a um profissional, os avisos sem ciência
   * dos pacientes com vínculo assistencial dele ainda não notificados; cada um vira uma notificação registrada (uma por
   * aviso e conta) e, se o canal puder enviar, uma mensagem sem dado do paciente (o link do portal). Sem canal, a
   * notificação fica 'desligado' com o motivo: nada sai. A recusa de um aviso (ex.: 'canal-inexistente' quando o
   * cliente não tem o canal do portal cadastrado) não para o ciclo: vai em `recusas` (só ids e código), e a vigia a
   * registra no log; o aviso segue sem tentativa gravada e volta no próximo ciclo.
   */
  async notificarCriticos(hospital: string): Promise<ResultadoCicloCritico> {
    const zero: ResultadoCicloCritico = { contas: 0, notificados: 0, recusas: [] };
    const fonte = this.pacientes;
    if (!fonte) return zero;
    const [portal, medico] = await Promise.all([
      this.ligado(hospital, CHAVES_SADT.portal),
      this.ligado(hospital, CHAVE_PORTAL_MEDICO),
    ]);
    if (!portal || !medico) return zero;
    const c = this.ctx(hospital);
    const { hoje } = await this.sadt.relogio(c);
    const pendentes = (
      await this.sadt.avisos(c, {
        inicio: somarDias(hoje, -(PORTAL_MEDICO_CRITICOS_DIAS - 1)),
        fim: hoje,
        pendentes: true,
      })
    ).filter((a) => !a.ciencia && a.paciente.id !== null);
    if (pendentes.length === 0) return zero;
    const ativas = (await this.sadt.autocadastros(c, { desde: somarDias(hoje, -3650) })).filter(
      (a) =>
        a.origem === 'novo' &&
        a.situacao === 'aprovado' &&
        a.situacaoConta !== 'bloqueado' &&
        a.situacaoConta !== 'encerrado',
    );
    let contas = 0;
    let notificados = 0;
    const recusas: ResultadoCicloCritico['recusas'] = [];
    for (let k = 0; k < ativas.length; k += 400) {
      const vinculos = await this.porta.vinculos(
        c,
        ativas.slice(k, k + 400).map((a) => a.id),
      );
      for (const [acesso, v] of vinculos) {
        if (v.profissional === null) continue;
        const prof = await this.porta.profissional(c, v.profissional);
        if (!prof) continue;
        const fila = await fonte.filaDoVinculo(c, {
          cbos: prof.vinculoAssistencial,
          login: `${USUARIO_PORTAL_MEDICO}.M${acesso}`,
        });
        const daFila = new Set(fila.pacientes.map((x) => x.paciente));
        const ja = new Set((await this.porta.notificacoesCritico(c, acesso)).map((n) => n.aviso));
        const novos = pendentes.filter((a) => daFila.has(a.paciente.id ?? -1) && !ja.has(a.id));
        if (novos.length === 0) continue;
        contas++;
        const canal = await this.canal.disponivel(hospital);
        for (const a of novos) {
          const envio = canal.envio ?? 'desligado';
          let gravou: boolean;
          try {
            gravou = await this.porta.gravar(
              c,
              (g) =>
                g.notificarCritico({
                  aviso: a.id,
                  acesso,
                  envio,
                  motivo: canal.envio ? null : (canal.motivo ?? MOTIVO_HALAI_MEDICO_DESLIGADA),
                }),
              {
                ...this.trilha(
                  hospital,
                  E.portalMedicoCriticoNotificado.codigo,
                  `notificação do crítico ao médico externo (${envio})`,
                  { tabela: 'aviso_valor_critico', id: String(a.id) },
                  acesso,
                ),
                idPaciente: a.paciente.id,
              },
            );
          } catch (e) {
            if (!(e instanceof ErroOperacao)) throw e;
            recusas.push({ aviso: a.id, acesso, codigo: String(e.problema['codigo'] ?? e.problema.status) });
            continue;
          }
          if (!gravou) continue;
          notificados++;
          if (canal.envio)
            await this.canal.enviar({
              hospital,
              acesso,
              tipo: 'resultado-critico',
              destino: `conta M${acesso}`,
              link: `${this.enderecoPublico.replace(/\/$/, '')}/medico-externo/criticos`,
              validoAte: `${a.prazoEm}Z`,
            });
        }
      }
    }
    return { contas, notificados, recusas };
  }

  /** Liga a vigia da notificação (um ciclo por estabelecimento a cada `intervaloMs`; um ciclo de cada vez). */
  iniciarAvisosCriticos(intervaloMs = 60_000): void {
    if (this.vigiaCritico || this.hospitaisAvisoCritico.length === 0) return;
    this.vigiaCritico = setInterval(() => {
      if (this.emCicloCritico) return;
      this.emCicloCritico = true;
      void Promise.all(
        this.hospitaisAvisoCritico.map((h) =>
          this.notificarCriticos(h)
            .then((r) => {
              // Só ids e códigos no log (nada do paciente): a recusa fica visível em vez de engolida.
              for (const x of r.recusas)
                this.logCritico.warn(`aviso ${x.aviso} conta M${x.acesso} em ${h}: notificação recusada (${x.codigo})`);
            })
            .catch((e: unknown) => {
              const codigo = e instanceof ErroOperacao ? String(e.problema['codigo'] ?? e.problema.status) : 'erro';
              this.logCritico.error(`ciclo da notificação de críticos em ${h} falhou (${codigo})`);
            }),
        ),
      ).finally(() => {
        this.emCicloCritico = false;
      });
    }, intervaloMs);
    this.vigiaCritico.unref?.();
  }

  pararAvisosCriticos(): void {
    if (this.vigiaCritico) clearInterval(this.vigiaCritico);
    this.vigiaCritico = null;
  }
}
