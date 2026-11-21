// Portal do paciente, etapa 2 do M50 (ficha, seções 4, 5, 7 e 8; regras 3, 4, 8 e 13; cap-07 §7.6):
//   - agendamento online: as agendas que a configuração libera (SGH_AGE_ONLINE_CFG), com os convênios e os serviços da
//     própria agenda, a antecedência e o horizonte; a marcação, o cancelamento e a remarcação pelas MESMAS receitas do
//     call center (M17 e M18, pelo executor), com o canal "portal" e o usuário de integração SGH.PORTAL nas colunas de
//     autoria (nunca o paciente); a colisão com outro canal é transparente: o horário ocupado some e o próximo livre da
//     mesma agenda é oferecido;
//   - pré-check-in: contato, documentos (armazenamento de objetos; o banco guarda a chave e o SHA-256), carteirinha e o
//     termo; NADA vai ao cadastro até a recepção conferir; a conferência grava só o aprovado pela receita do M11, com
//     quem conferiu;
//   - pagamento do particular: a cobrança no gateway (simulado fora de produção), a confirmação idempotente (o retorno
//     do gateway e a conferência do paciente acham a mesma transação; o caixa do portal recebe um pagamento só);
//   - pesquisa de satisfação depois que o paciente veio, uma por marcação.
// Nenhuma mensagem ao paciente (DP-44 a): a confirmação aparece no portal. Toda gravação vai com a SGH_TRILHA.
import { createHash, randomBytes } from 'node:crypto';
import {
  type AgendamentoPortal,
  type AlteracoesPaciente,
  type AgendarPortal,
  type BuscaHorariosPortal,
  CAMPOS_PRECHECKIN,
  type CampoPreCheckin,
  CHAVE_PORTAL_AGENDA,
  lerHoraDigitada,
  CHAVE_PORTAL_PAGAMENTO,
  type CobrancaPortal,
  type ConferirPreCheckin,
  type ConfigAgendaOnlineDetalhe,
  type ConfigAgendaOnlineEntrada,
  type ConfigAgendaOnlineItem,
  CONVENIO_PARTICULAR_PORTAL,
  type DetalhePreCheckin,
  EVENTOS_AUDITAVEIS,
  esquemaAlteracoesPaciente,
  type FilaPreCheckin,
  type FiltroFilaPreCheckin,
  type FormaPagamentoPortal,
  type HorarioPortal,
  type HorariosPortal,
  type ItemFilaPreCheckin,
  type ListaAgendamentosPortal,
  type ListaConfigAgendaOnline,
  type ListaPagamentosPortal,
  MINUTOS_COBRANCA_PORTAL,
  MOTIVOS_CANCELAMENTO_PORTAL,
  type OpcoesAgendarPortal,
  type PesquisaPortal,
  type PreCheckinDoPortal,
  type PreCheckinPortal,
  type RecusarPreCheckin,
  type RemarcarPortal,
  type ResultadoAgendamentoPortal,
  TETO_HORARIOS_PORTAL,
  type TipoAgendaOnline,
  TIPOS_ARQUIVO_PRECHECKIN,
  TAMANHO_MAXIMO_PRECHECKIN,
  type TipoDocumentoPreCheckin,
} from '@sgh/contratos';
import {
  alteracaoAprovada,
  aprovadosForaDoProposto,
  camposParaConferir,
  type ConfigOnline,
  convenioLiberado,
  type EstadoMarcacao,
  type Relogio as RelogioDominio,
  horarioDentroDoPortal,
  horariosDoPortal,
  janelaDoPortal,
  partesDoNome,
  pesquisaAberta,
  podeEnviarPreCheckin,
  podeMudarPeloPortal,
  proximoOferecido,
  servicoLiberado,
  valorDoPortal,
} from '@sgh/dominio-agenda';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import { ErroPortal, type RegistroTrilhaPortal } from '../tipos.js';
import { type ConfigAgendaOnline, type PagamentoPortal, type PreCheckinOnline } from './tipos.js';
import type { PacienteFicha } from '../../cadastro/tipos.js';
import type { ContextoAgenda, ContextoGravacao } from '../../agenda/porta.js';
import type { ContextoGravacao as ContextoGravacaoCadastro } from '../../cadastro/tipos.js';
import type { ContextoPortalNucleo } from '../porta.js';
import type { SituacaoMarcacao } from '../../agenda/tipos.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { PortaAgenda } from '../../agenda/porta.js';
import type { PortaCadastro } from '../../cadastro/porta.js';
import { buscarPacientes } from '../../cadastro/servico.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { PortaExame } from '../../exames/porta.js';
import { ligadaNoEstabelecimento } from '../aplicacao/liberacao.js';
import type { ArmazemProvas } from '../aplicacao/provas.js';
import {
  type PortalNoPedido,
  quemDaConta,
  type ServicoPortalPaciente,
  type TitularInterno,
  USUARIO_PORTAL,
} from '../aplicacao/servico.js';
import type { GanchoTeleconsultaPortal } from '../../telemedicina/servico.js';
import type { GatewayPagamento } from './gateway.js';
import { TesourariaPortal } from './tesouraria.js';
import type { ContextoAgendaOnline, PortaAgendaOnline } from './porta.js';

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const ASSINATURAS: Readonly<Record<string, number[]>> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};
const ARQUIVOS_POR_SESSAO = 10;
/** As extensões da chave do armazenamento (`portal/provas/<arquivo>-<ext>`), na ordem de procura. */
const EXTENSOES_ARQUIVO = ['jpg', 'png', 'pdf'] as const;

/** Quem age nas telas internas (configuração e conferência), com o executor para a gravação do cadastro. */
export interface QuemAgendaOnline {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly estacao: string;
  readonly correlacao: string;
  pode(permissao: string): boolean;
  /** O contexto do executor (Idempotency-Key do pedido); só a conferência com campos o usa. */
  contextoOperacao(rotulo: string): ContextoGravacaoCadastro;
  /** Na memória, a trilha da gravação do cadastro vai pelo registrador da API (no banco, o executor grava). */
  trilhaMemoria(evento: string, recurso: string, idAlvo: string): Promise<void>;
}

const recusa = (codigo: string, detalhe: string, status = 409): never => {
  throw new ErroProblema(
    status === 503 ? 'indisponivel' : status === 404 ? 'nao-encontrado' : 'recusa-de-negocio',
    status,
    status === 404 ? 'Não encontrado' : 'Pedido recusado',
    detalhe,
    { codigo },
  );
};

function traduzir(e: unknown): never {
  if (e instanceof ErroProblema) throw e;
  if (e instanceof ErroPortal) {
    if (e.codigo === 'nao-encontrado') recusa('nao-encontrado', e.message, 404);
    if (e.codigo === 'situacao') recusa('situacao', e.message);
    throw new ErroProblema('conflito-de-versao', 409, 'Registro alterado', e.message, { codigo: e.codigo });
  }
  if (e instanceof ErroOperacao)
    throw new ErroProblema(
      e.problema.status === 400 ? 'entrada-invalida' : 'recusa-de-negocio',
      e.problema.status,
      e.problema.title,
      e.problema.detail,
      {
        codigo: e.problema.codigo ?? 'recusa',
        ...(e.problema.campos ? { campos: [...e.problema.campos] } : {}),
      },
    );
  throw e;
}

const COLISAO = new Set(['horario-ocupado', 'registro-em-edicao', 'minuto-ocupado', 'ocupado']);

/**
 * O estado da marcação para as regras do portal, pela situação de negócio que as portas de agenda e de exame devolvem
 * (o mesmo vocabulário: marcada, confirmada, chegou, em_atendimento, realizada, falta, transferida).
 * Melhoria: o estado sai do significado da situação, e não dos sinais S/N e letras do sistema de origem.
 */
export function estadoPelaSituacao(
  situacao: SituacaoMarcacao | string,
  atendido = false,
  chegou = false,
): EstadoMarcacao {
  if (atendido || situacao === 'realizada') return 'atendida';
  if (chegou && (situacao === 'marcada' || situacao === 'aguardando' || situacao === 'confirmada'))
    return 'chegou';
  switch (situacao) {
    case 'marcada':
    case 'aguardando':
      return 'marcada';
    case 'confirmada':
      return 'confirmada';
    case 'chegou':
    case 'em_atendimento':
      return 'chegou';
    case 'falta':
      return 'faltou';
    case 'transferida':
      return 'transferida';
    default:
      return 'outra';
  }
}

/**
 * A hora do dia no formato do contrato do portal ("HH:MM"): a porta da agenda de consultas já devolve "HH:MM" e a de
 * exames ainda devolve os quatro dígitos; as duas formas viram "HH:MM" aqui (as regras do domínio leem as duas).
 */
const paraHora = (h: string): string => lerHoraDigitada(h) ?? h;

/** Registro do profissional da agenda (consulta: o do conselho; exame: o da agenda; 0 = agenda de recurso). */
const registroDaAgenda = (a: { registroProfissional?: number | null; crm?: number }): number =>
  a.registroProfissional ?? a.crm ?? 0;

const paraCfg = (k: ConfigAgendaOnline): ConfigOnline => ({
  agenda: k.agenda,
  ativa: k.ativa,
  convenios: k.convenios,
  servicos: k.servicos,
  antecedenciaHoras: k.antecedenciaHoras,
  horizonteDias: k.horizonteDias,
  cancelaAteHoras: k.cancelaAteHoras,
  precheckin: k.precheckin,
  valorParticular: k.valorParticular,
});

/** O que está no cadastro hoje, só nos campos do pré-check-in. */
function atualDoPaciente(p: PacienteFicha): Partial<Record<CampoPreCheckin, string | number | null>> {
  return {
    celular: p.celular,
    telefone: p.telefone,
    email: p.email,
    cep: p.cep,
    logradouro: p.logradouro,
    numero: p.numero,
    complemento: p.complemento,
    bairro: p.bairro,
    contatoNome: p.contatoNome,
    contatoTelefone: p.contatoTelefone,
  };
}

interface MarcacaoUnificada {
  readonly tipo: TipoAgendaOnline;
  readonly id: number;
  readonly agenda: number | null;
  readonly nomeAgenda: string;
  readonly crm: number;
  readonly data: string;
  readonly hora: string;
  readonly paciente: number | null;
  readonly convenio: number;
  readonly estado: EstadoMarcacao;
  readonly peloPortal: boolean;
  /** W0-10: o exame da marcação (só exame; confere se a agenda de destino da remarcação o oferece). */
  readonly exame: number | null;
}

export interface ConfigServicoAgendaPortal {
  readonly ambiente: string;
}

export class ServicoAgendaPortal {
  /** Arquivos do pré-check-in enviados por sessão do portal (o envio só aceita um destes). */
  private readonly arquivos = new Map<string, Map<string, { chave: string; sha: string; mime: string }>>();

  constructor(
    private readonly portal: ServicoPortalPaciente,
    private readonly porta: PortaAgendaOnline,
    private readonly agenda: PortaAgenda,
    private readonly exame: PortaExame,
    private readonly cadastro: PortaCadastro,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly armazem: ArmazemProvas,
    readonly gateway: GatewayPagamento,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  get destino(): 'banco' | 'memoria' {
    return this.porta.destino;
  }

  /** O relógio do estabelecimento (porta da agenda) com a hora em "HH:MM", como as regras do domínio da agenda leem. */
  private async relogio(c: ContextoAgenda): Promise<RelogioDominio> {
    const r = await this.agenda.relogio(c);
    return { hoje: r.hoje, hhmm: paraHora(r.hora) };
  }

  /** O contexto da gravação na agenda de consultas: o usuário de integração do portal e a chave do pedido. */
  private ctxAgenda(n: PortalNoPedido, ctx: ContextoOperacao): ContextoGravacao {
    return {
      rede: n.c.rede,
      hospital: n.c.hospital,
      login: USUARIO_PORTAL,
      correlacao: ctx.correlacao,
      chaveIdempotencia: ctx.chaveIdempotencia,
    };
  }

  private _tesouraria: TesourariaPortal | null = null;
  /** W0-10: a tesouraria das cobranças do portal (conciliação e estorno). */
  get tesouraria(): TesourariaPortal {
    return (this._tesouraria ??= new TesourariaPortal(this.porta, this.gateway, this.portal.rede));
  }

  /** M50, etapa 4: a teleconsulta da marcação pelo portal (a telemedicina liga o gancho na montagem). */
  private teleconsulta: GanchoTeleconsultaPortal | null = null;

  ligarTeleconsulta(g: GanchoTeleconsultaPortal): void {
    this.teleconsulta = g;
  }

  private async exigirTeleconsulta(hospital: string, tipo: TipoAgendaOnline): Promise<void> {
    if (tipo !== 'consulta') recusa('sem-teleconsulta', 'A teleconsulta é só para consulta.');
    if (this.teleconsulta && (await this.teleconsulta.ligada(hospital))) return;
    throw new ErroProblema(
      'recurso-desligado',
      403,
      'Teleconsulta indisponível',
      'A teleconsulta pelo portal ainda não foi liberada neste estabelecimento.',
      { codigo: 'recurso-desligado' },
    );
  }

  // ── Liberação ────────────────────────────────────────────────────────────────────────────────────────────────────

  private async chave(hospital: string, chave: string): Promise<boolean> {
    if (this.porta.destino === 'memoria' && !this.configuracao) return true;
    return ligadaNoEstabelecimento(
      this.configuracao,
      this.portal.rede,
      hospital,
      chave,
      USUARIO_PORTAL,
      this.agora(),
    );
  }

  async agendaLigada(hospital: string): Promise<boolean> {
    return this.chave(hospital, CHAVE_PORTAL_AGENDA);
  }

  async pagamentoLigado(hospital: string): Promise<boolean> {
    return this.gateway.disponivel && (await this.chave(hospital, CHAVE_PORTAL_PAGAMENTO));
  }

  private async exigirAgenda(hospital: string): Promise<void> {
    if (await this.agendaLigada(hospital)) return;
    throw new ErroProblema(
      'recurso-desligado',
      403,
      'Agendamento indisponível',
      'O agendamento pelo portal ainda não foi liberado neste estabelecimento. Ligue para a central.',
      { codigo: 'recurso-desligado' },
    );
  }

  private async gravar<T>(
    c: ContextoAgendaOnline,
    fn: Parameters<PortaAgendaOnline['gravar']>[1],
    trilha: RegistroTrilhaPortal | ((r: T) => RegistroTrilhaPortal | null) | null,
  ): Promise<T> {
    try {
      return (await this.porta.gravar(c, fn, trilha as never)) as T;
    } catch (e) {
      return traduzir(e);
    }
  }

  private linha(
    hospital: string,
    d: {
      evento: string;
      operacao: string;
      tabela: string;
      id: number | string | null;
      usuario: string;
      paciente?: number | null;
      chave?: string | null;
      estacao?: string;
      correlacao?: string;
      resultado?: 'sucesso' | 'falha';
    },
  ): RegistroTrilhaPortal {
    return {
      rede: this.portal.rede,
      hospital,
      usuario: d.usuario.slice(0, 31),
      evento: d.evento,
      recurso: d.operacao.includes('Pagamento') ? CHAVE_PORTAL_PAGAMENTO : CHAVE_PORTAL_AGENDA,
      operacao: d.operacao,
      tabelaAlvo: d.tabela,
      idAlvo: d.id === null ? null : String(d.id),
      chaveNaturalAlvo: d.chave ?? null,
      resultado: d.resultado ?? 'sucesso',
      estacao: (d.estacao ?? 'SGH-PORTAL').slice(0, 80),
      correlacao: (d.correlacao ?? `portal-${randomBytes(6).toString('hex')}`).slice(0, 64),
      origem: null,
      idPaciente: d.paciente ?? null,
    };
  }

  /**
   * O contexto do executor: o usuário de integração do portal e a chave de idempotência do pedido (a tela manda uma
   * por ação; sem ela, uma nova). A chave leva a conta e a ação: a mesma chave de outra conta nunca colide.
   */
  private ctxExecutor(
    n: PortalNoPedido,
    rotulo: string,
    chave: string,
    idem: string | null,
  ): ContextoOperacao {
    const pedido = idem && /^[A-Za-z0-9._-]{8,64}$/.test(idem) ? idem : randomBytes(12).toString('hex');
    return {
      cliente: n.c.cliente,
      estabelecimento: n.c.estabelecimento,
      // O portal grava pelo usuário de integração (sem usuário do hospital): a conta vai na chave e na trilha.
      usuario: null,
      correlacao: `portal-${rotulo}-${n.conta.id}`.slice(0, 64),
      chaveIdempotencia: `portal-${n.conta.id}-${rotulo}-${sha256(`${chave}|${pedido}`).slice(0, 32)}`.slice(
        0,
        80,
      ),
    };
  }

  // ── Configuração da agenda online (tela interna) ─────────────────────────────────────────────────────────────────

  /**
   * A lista da tela de configuração: as agendas ativas (e as inativas já configuradas) de consulta e de exame, com a
   * situação no portal. Três leituras para a lista inteira; os convênios e os serviços de cada agenda só no detalhe
   * (`detalheConfig`), ao abrir a agenda.
   */
  async listaConfig(q: QuemAgendaOnline): Promise<ListaConfigAgendaOnline> {
    const c = await this.portal.contextoDoEstabelecimento(q.hospital);
    const [cfgs, agendas, exames] = await Promise.all([
      this.porta.configs(c),
      this.agenda.agendas(c),
      this.exame.agendas(c),
    ]);
    const cfgDe = (tipo: TipoAgendaOnline, id: number) =>
      cfgs.find((k) => k.tipo === tipo && k.agenda === id) ?? null;
    const itens: ConfigAgendaOnlineItem[] = [];
    const juntar = (tipo: TipoAgendaOnline, a: { id: number; nome: string; ativa: boolean }) => {
      const k = cfgDe(tipo, a.id);
      if (!a.ativa && !k) return;
      itens.push(this.itemDaConfig(tipo, a, k));
    };
    for (const a of agendas) juntar('consulta', a);
    for (const a of exames) juntar('exame', a);
    const ligado = await this.agendaLigada(q.hospital);
    return {
      itens,
      portalLigado: ligado,
      motivo: ligado
        ? null
        : 'O agendamento pelo portal está desligado neste estabelecimento (Funcionalidades): as agendas configuradas só aparecem para o paciente depois de ligado.',
      podeConfigurar: q.pode('agenda.online.configurar'),
    };
  }

  private itemDaConfig(
    tipo: TipoAgendaOnline,
    a: { id: number; nome: string; ativa: boolean },
    k: ConfigAgendaOnline | null,
  ): ConfigAgendaOnlineItem {
    const { procedimento, profissional } = partesDoNome(a.nome);
    return {
      tipo,
      agenda: a.id,
      nomeAgenda: a.nome,
      procedimento,
      profissional,
      agendaAtiva: a.ativa,
      config: k ? this.configDoItem(k) : null,
    };
  }

  /** O detalhe de uma agenda na configuração: os convênios e os serviços que ela aceita (a tela busca neles). */
  async detalheConfig(
    q: QuemAgendaOnline,
    tipo: TipoAgendaOnline,
    agenda: number,
  ): Promise<ConfigAgendaOnlineDetalhe> {
    const c = await this.portal.contextoDoEstabelecimento(q.hospital);
    const [k, a] = await Promise.all([
      this.porta.config(c, tipo, agenda),
      tipo === 'consulta' ? this.agenda.agenda(c, agenda) : this.exame.agenda(c, agenda),
    ]);
    if (!a) return recusa('agenda-inexistente', 'A agenda não existe.', 404);
    const item = this.itemDaConfig(tipo, a, k);
    if (tipo === 'consulta') {
      const [conv, esp] = await Promise.all([
        this.agenda.conveniosDaAgenda(c, agenda),
        this.agenda.especialidadesDaAgenda(c, agenda),
      ]);
      const servicos = esp.length ? esp : (await this.agenda.opcoes(c)).especialidades;
      return {
        ...item,
        conveniosDaAgenda: conv.map((x) => ({ codigo: x.codigo, nome: x.nome })),
        servicosDaAgenda: servicos.map((x) => ({ codigo: x.codigo, nome: x.nome })),
      };
    }
    const [conv, cob] = await Promise.all([this.exame.convenios(c, agenda), this.exame.cobertura(c, agenda)]);
    const opcoesExame = await this.exame.opcoes(c);
    const nomeConv = new Map(opcoesExame.convenios.map((x) => [x.codigo, x.nome]));
    const categoria = (a as { categoria?: unknown }).categoria;
    const servicos = cob.length
      ? [...new Map(cob.map((x) => [x.exame, { codigo: x.exame, nome: x.exameNome }])).values()]
      : opcoesExame.exames
          .filter((x) => x.categoria === categoria)
          .slice(0, 300)
          .map((x) => ({ codigo: x.id, nome: x.nome }));
    return {
      ...item,
      conveniosDaAgenda: conv.map((x) => ({
        codigo: x.codigo,
        nome: x.nome ?? nomeConv.get(x.codigo) ?? String(x.codigo),
      })),
      servicosDaAgenda: servicos,
    };
  }

  private configDoItem(k: ConfigAgendaOnline): NonNullable<ConfigAgendaOnlineItem['config']> {
    return {
      ativa: k.ativa,
      convenios: k.convenios,
      servicos: k.servicos,
      antecedenciaHoras: k.antecedenciaHoras,
      horizonteDias: k.horizonteDias,
      cancelaAteHoras: k.cancelaAteHoras,
      precheckin: k.precheckin,
      valorParticular: k.valorParticular,
      teleconsulta: k.teleconsulta,
      alteradoPor: k.alteradoPor,
      alteradoEm: k.alteradoEm,
      versao: k.versao,
    };
  }

  /** `agenda.configurarAgendaOnline`: liberar, alterar ou retirar uma agenda do portal (versão conferida). */
  async configurar(q: QuemAgendaOnline, e: ConfigAgendaOnlineEntrada): Promise<ListaConfigAgendaOnline> {
    const c = await this.portal.contextoDoEstabelecimento(q.hospital);
    const a =
      e.tipo === 'consulta' ? await this.agenda.agenda(c, e.agenda) : await this.exame.agenda(c, e.agenda);
    if (!a) return recusa('agenda-inexistente', 'A agenda não existe.', 404);
    if (e.ativa && !a.ativa)
      recusa('agenda-inativa', 'A agenda está inativa: ative-a antes de liberar no portal.');
    const daAgenda =
      e.tipo === 'consulta'
        ? (await this.agenda.conveniosDaAgenda(c, e.agenda)).map((x) => x.codigo)
        : (await this.exame.convenios(c, e.agenda)).map((x) => x.codigo);
    const fora = e.convenios.filter((x) => daAgenda.length > 0 && !daAgenda.includes(x));
    if (fora.length)
      recusa(
        'convenio-fora-da-agenda',
        `Convênio que a agenda não aceita: ${fora.join(', ')}. Ajuste a cobertura da agenda antes.`,
      );
    if (e.valorParticular !== null && daAgenda.length > 0 && !daAgenda.includes(CONVENIO_PARTICULAR_PORTAL))
      recusa('sem-particular', 'A agenda não atende particular: deixe o valor em branco.');
    await this.gravar(
      c,
      (g) =>
        g.gravarConfig({
          tipo: e.tipo,
          agenda: e.agenda,
          nomeAgenda: a.nome,
          crm: registroDaAgenda(a),
          ativa: e.ativa,
          convenios: e.convenios,
          servicos: e.servicos,
          antecedenciaHoras: e.antecedenciaHoras,
          horizonteDias: e.horizonteDias,
          cancelaAteHoras: e.cancelaAteHoras,
          precheckin: e.precheckin,
          valorParticular: e.valorParticular,
          teleconsulta: e.tipo === 'consulta' && e.teleconsulta,
          por: q.login,
          versao: e.versao,
        }),
      (r: { id: number }) =>
        this.linha(q.hospital, {
          evento: EVENTOS_AUDITAVEIS.agendaOnlineConfigurada.codigo,
          operacao: 'agenda.configurarAgendaOnline',
          tabela: 'agenda_online_configuracao',
          id: r.id,
          usuario: q.login,
          chave: `${e.tipo}:${e.agenda}:${e.ativa ? 'ativa' : 'retirada'}`,
          estacao: q.estacao,
          correlacao: q.correlacao,
        }),
    );
    return this.listaConfig(q);
  }

  // ── Portal: agendar ──────────────────────────────────────────────────────────────────────────────────────────────

  private async cfgsAtivas(c: ContextoPortalNucleo, tipo: TipoAgendaOnline) {
    return (await this.porta.configs(c)).filter((k) => k.tipo === tipo && k.ativa);
  }

  private async conveniosDaAgendaDe(c: ContextoPortalNucleo, tipo: TipoAgendaOnline, agenda: number) {
    return tipo === 'consulta'
      ? (await this.agenda.conveniosDaAgenda(c, agenda)).map((x) => ({
          codigo: x.codigo,
          nome: x.nome,
          ativo: x.ativo,
        }))
      : (await this.exame.convenios(c, agenda)).map((x) => ({ codigo: x.codigo, nome: x.nome, ativo: true }));
  }

  private async servicosDaAgendaDe(c: ContextoPortalNucleo, tipo: TipoAgendaOnline, agenda: number) {
    return tipo === 'consulta'
      ? await this.agenda.especialidadesDaAgenda(c, agenda)
      : [
          ...new Map(
            (await this.exame.cobertura(c, agenda)).map((x) => [
              x.exame,
              { codigo: x.exame, nome: x.exameNome },
            ]),
          ).values(),
        ];
  }

  async opcoes(n: PortalNoPedido, tipo: TipoAgendaOnline): Promise<OpcoesAgendarPortal> {
    this.portal.titularComEscopo(n, 'agendamentos');
    await this.exigirAgenda(n.c.hospital);
    const cfgs = await this.cfgsAtivas(n.c, tipo);
    const nomesConvenio = new Map<number, string>();
    const nomesServico = new Map<number, string>();
    const todasEsp = tipo === 'consulta' ? (await this.agenda.opcoes(n.c)).especialidades : [];
    const todosEx = tipo === 'exame' ? (await this.exame.opcoes(n.c)).exames : [];
    const agendas: OpcoesAgendarPortal['agendas'][number][] = [];
    for (const k of cfgs) {
      const a =
        tipo === 'consulta'
          ? await this.agenda.agenda(n.c, k.agenda)
          : await this.exame.agenda(n.c, k.agenda);
      if (!a || !a.ativa) continue;
      const conv = await this.conveniosDaAgendaDe(n.c, tipo, k.agenda);
      const daAgenda = conv.map((x) => x.codigo);
      const convenios = (k.convenios.length ? k.convenios : daAgenda).filter((x) =>
        convenioLiberado(k, daAgenda, x),
      );
      for (const x of conv) if (convenios.includes(x.codigo)) nomesConvenio.set(x.codigo, x.nome);
      const serv = await this.servicosDaAgendaDe(n.c, tipo, k.agenda);
      const servicos = k.servicos.length ? k.servicos : serv.map((x) => x.codigo);
      for (const s of servicos) {
        const nome =
          serv.find((x) => x.codigo === s)?.nome ??
          todasEsp.find((x) => x.codigo === s)?.nome ??
          todosEx.find((x) => x.id === s)?.nome;
        if (nome) nomesServico.set(s, nome);
      }
      const { procedimento, profissional } = partesDoNome(a.nome);
      agendas.push({
        agenda: k.agenda,
        procedimento,
        profissional,
        servicos,
        convenios,
        valorParticular: k.valorParticular,
        teleconsulta: tipo === 'consulta' && k.teleconsulta,
      });
    }
    const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR');
    return {
      tipo,
      servicos: [...nomesServico].map(([codigo, nome]) => ({ codigo, nome })).sort(porNome),
      convenios: [...nomesConvenio].map(([codigo, nome]) => ({ codigo, nome })).sort(porNome),
      agendas,
    };
  }

  private async vagas(
    c: ContextoPortalNucleo,
    tipo: TipoAgendaOnline,
    agendas: readonly number[],
    de: string,
    ate: string,
  ) {
    if (agendas.length === 0) return [];
    const r =
      tipo === 'consulta'
        ? await this.agenda.vagas(c, { agendas, de, ate, limite: 1000 })
        : await this.exame.vagas(c, { agendas, de, ate, limite: 1000 });
    return r.itens.map((v) => ({
      agenda: v.agenda,
      nomeAgenda: v.nomeAgenda,
      data: v.data,
      hora: paraHora(v.hora),
    }));
  }

  private paraHorario(v: { agenda: number; nomeAgenda: string; data: string; hora: string }): HorarioPortal {
    const { procedimento, profissional } = partesDoNome(v.nomeAgenda);
    return { agenda: v.agenda, procedimento, profissional, data: v.data, hora: v.hora };
  }

  /** Horários livres (consulta "Horários disponíveis para o portal": 200 / p95 < 500 ms). */
  async horarios(n: PortalNoPedido, b: BuscaHorariosPortal): Promise<HorariosPortal> {
    this.portal.titularComEscopo(n, 'agendamentos');
    await this.exigirAgenda(n.c.hospital);
    const r = await this.relogio(n.c);
    const elegiveis: ConfigOnline[] = [];
    if (b.modalidade === 'teleconsulta') await this.exigirTeleconsulta(n.c.hospital, b.tipo);
    for (const k of await this.cfgsAtivas(n.c, b.tipo)) {
      if (b.agenda !== null && k.agenda !== b.agenda) continue;
      if (b.modalidade === 'teleconsulta' && !k.teleconsulta) continue;
      const daAgenda = (await this.conveniosDaAgendaDe(n.c, b.tipo, k.agenda)).map((x) => x.codigo);
      if (!convenioLiberado(k, daAgenda, b.convenio)) continue;
      const serv = (await this.servicosDaAgendaDe(n.c, b.tipo, k.agenda)).map((x) => x.codigo);
      if (!servicoLiberado(k, serv, b.servico)) continue;
      elegiveis.push(paraCfg(k));
    }
    if (elegiveis.length === 0) {
      const j = janelaDoPortal({ horizonteDias: 30 }, r, b.de);
      return { itens: [], truncado: false, ...j };
    }
    const maior = Math.max(...elegiveis.map((k) => k.horizonteDias));
    const j = janelaDoPortal({ horizonteDias: maior }, r, b.de);
    const vagas = await this.vagas(
      n.c,
      b.tipo,
      elegiveis.map((k) => k.agenda),
      j.de,
      j.ate,
    );
    const h = horariosDoPortal(vagas, new Map(elegiveis.map((k) => [k.agenda, k])), r, TETO_HORARIOS_PORTAL);
    return { itens: h.itens.map((v) => this.paraHorario(v)), truncado: h.truncado, de: j.de, ate: j.ate };
  }

  private async cfgDaAgenda(c: ContextoPortalNucleo, tipo: TipoAgendaOnline, agenda: number) {
    const k = await this.porta.config(c, tipo, agenda);
    if (!k || !k.ativa) return recusa('agenda-fora-do-portal', 'Esta agenda não está disponível no portal.');
    return k;
  }

  /** O próximo livre da mesma agenda depois do horário que acabou de ser ocupado (colisão transparente). */
  private async proximo(
    n: PortalNoPedido,
    tipo: TipoAgendaOnline,
    k: ConfigAgendaOnline,
    ocupado: { agenda: number; data: string; hora: string },
  ): Promise<HorarioPortal | null> {
    const r = await this.relogio(n.c);
    const cfg = paraCfg(k);
    const j = janelaDoPortal(cfg, r);
    const vagas = await this.vagas(n.c, tipo, [k.agenda], ocupado.data < j.de ? j.de : ocupado.data, j.ate);
    const v = proximoOferecido(vagas, ocupado, cfg, r);
    return v ? this.paraHorario(v) : null;
  }

  async agendar(
    n: PortalNoPedido,
    e: AgendarPortal,
    idem: string | null = null,
  ): Promise<ResultadoAgendamentoPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    await this.exigirAgenda(n.c.hospital);
    const k = await this.cfgDaAgenda(n.c, e.tipo, e.agenda);
    if (e.modalidade === 'teleconsulta') {
      await this.exigirTeleconsulta(n.c.hospital, e.tipo);
      if (!k.teleconsulta) recusa('sem-teleconsulta', 'Esta agenda não oferece teleconsulta pelo portal.');
    }
    const daAgenda = (await this.conveniosDaAgendaDe(n.c, e.tipo, e.agenda)).map((x) => x.codigo);
    if (!convenioLiberado(k, daAgenda, e.convenio))
      recusa('convenio-nao-liberado', 'Este convênio não pode marcar por esta agenda no portal.');
    if (e.tipo === 'exame' && e.servico !== null) {
      const serv = (await this.servicosDaAgendaDe(n.c, 'exame', e.agenda)).map((x) => x.codigo);
      if (!servicoLiberado(k, serv, e.servico))
        recusa('servico-nao-liberado', 'Este exame não é marcado por esta agenda no portal.');
    }
    const r = await this.relogio(n.c);
    if (!horarioDentroDoPortal(e, paraCfg(k), r))
      recusa(
        'fora-da-janela',
        `Pelo portal, marque com ao menos ${k.antecedenciaHoras} hora(s) de antecedência e até ${k.horizonteDias} dias à frente.`,
      );
    const chave = `${e.tipo}-${e.agenda}-${e.data}-${e.hora}-${t.paciente}`;
    const ctx = this.ctxExecutor(n, 'agendar', chave, idem);
    let marcacao: number;
    try {
      const g =
        e.tipo === 'consulta'
          ? await this.agenda.executar(this.ctxAgenda(n, ctx), 'agenda.agendarConsulta', {
              agenda: e.agenda,
              data: e.data,
              hora: e.hora,
              paciente: t.paciente,
              convenio: e.convenio,
              retorno: false,
              canal: 'portal',
              // M50, etapa 4: a teleconsulta nasce na mesma transação da marcação (registrarSgh da receita).
              ...(e.modalidade === 'teleconsulta' && this.teleconsulta
                ? { teleconsulta: { conta: n.conta.id } }
                : {}),
            })
          : await this.exame.executar(
              n.c,
              'agenda.agendarExame',
              {
                agenda: e.agenda,
                data: e.data,
                hora: e.hora,
                paciente: t.paciente,
                convenio: e.convenio,
                exame: e.servico,
                solicitante: null,
                retorno: false,
                canal: 'portal',
              },
              ctx,
            );
      marcacao = Number(g.resultado['marcacao']);
    } catch (x) {
      if (x instanceof ErroOperacao && COLISAO.has(x.problema.codigo ?? '')) {
        const proximo = await this.proximo(n, e.tipo, k, e);
        return {
          ok: false,
          agendamento: null,
          proximo,
          mensagem: proximo
            ? 'Esse horário acabou de ser ocupado. Veja o próximo livre nesta agenda.'
            : 'Esse horário acabou de ser ocupado e não há outro livre nesta agenda no período.',
        };
      }
      return traduzir(x);
    }
    await this.gravar(n.c, async () => null, this.trilhaAgendamento(n, t, e.tipo, marcacao, 'marcacao'));
    // M50, etapa 4: a teleconsulta da marcação (a sala de espera no portal).
    if (e.modalidade === 'teleconsulta' && this.teleconsulta)
      await this.teleconsulta.aoMarcar(n, t.paciente, {
        marcacao,
        agenda: e.agenda,
        nomeAgenda: k.nomeAgenda,
        crm: k.crm,
        data: e.data,
        hora: e.hora,
      });
    const lista = await this.agendamentos(n);
    return {
      ok: true,
      agendamento: lista.itens.find((x) => x.tipo === e.tipo && x.id === String(marcacao)) ?? null,
      proximo: null,
      mensagem:
        e.modalidade === 'teleconsulta'
          ? 'Teleconsulta marcada. No dia, entre na sala de espera pelo portal até 30 minutos antes.'
          : 'Marcação feita. Você pode fazer o pré-check-in a partir de 7 dias antes.',
    };
  }

  private trilhaAgendamento(
    n: PortalNoPedido,
    t: TitularInterno,
    tipo: TipoAgendaOnline,
    marcacao: number,
    acao: 'marcacao' | 'cancelamento' | 'remarcacao',
  ): RegistroTrilhaPortal {
    return this.linha(n.c.hospital, {
      evento: EVENTOS_AUDITAVEIS.portalAgendamento.codigo,
      operacao:
        acao === 'cancelamento'
          ? tipo === 'consulta'
            ? 'agenda.cancelarConsulta'
            : 'agenda.cancelarExame'
          : acao === 'remarcacao'
            ? tipo === 'consulta'
              ? 'agenda.remarcarConsulta'
              : 'agenda.remarcarExame'
            : tipo === 'consulta'
              ? 'agenda.agendarConsulta'
              : 'agenda.agendarExame',
      tabela: 'marcacao_horario',
      id: marcacao,
      usuario: quemDaConta(n.conta.id),
      paciente: t.paciente,
      chave: `${tipo}:${acao}`,
    });
  }

  private async marcacoesDoTitular(c: ContextoPortalNucleo, paciente: number) {
    const [cons, exs] = await Promise.all([
      this.agenda.marcacoesDoPaciente(c, paciente),
      this.exame.marcacoesDoPaciente(c, paciente),
    ]);
    const [extE, agendasC, agendasE] = await Promise.all([
      this.exame.extensoes(
        c,
        exs.itens.map((m) => m.id),
      ),
      cons.itens.length ? this.agenda.agendas(c) : Promise.resolve([]),
      exs.itens.length ? this.exame.agendas(c) : Promise.resolve([]),
    ]);
    const regC = new Map(agendasC.map((a) => [a.id, registroDaAgenda(a)]));
    const regE = new Map(agendasE.map((a) => [a.id, registroDaAgenda(a)]));
    const lista: MarcacaoUnificada[] = [
      ...cons.itens.map((m) => ({
        tipo: 'consulta' as const,
        id: m.id,
        agenda: m.agenda,
        nomeAgenda: m.nomeAgenda,
        crm: m.agenda === null ? 0 : (regC.get(m.agenda) ?? 0),
        data: m.data,
        hora: paraHora(m.hora),
        paciente: m.idPaciente,
        convenio: m.convenio,
        estado: estadoPelaSituacao(m.situacao),
        peloPortal: m.canal === 'portal',
        exame: null,
      })),
      ...exs.itens.map((m) => ({
        tipo: 'exame' as const,
        id: m.id,
        agenda: m.agenda,
        nomeAgenda: m.nomeAgenda,
        crm: m.agenda === null ? 0 : (regE.get(m.agenda) ?? 0),
        data: m.data,
        hora: paraHora(m.hora),
        paciente: m.idPaciente,
        convenio: m.convenio,
        estado: estadoPelaSituacao(m.situacao, m.atendido, m.temSenha),
        peloPortal: extE.get(m.id)?.canal === 'portal',
        exame: extE.get(m.id)?.idExame ?? null,
      })),
    ];
    lista.sort((a, b) => b.data.localeCompare(a.data) || b.hora.localeCompare(a.hora));
    return { lista, truncado: cons.truncado || exs.truncado };
  }

  private async marcacaoDoTitular(n: PortalNoPedido, t: TitularInterno, tipo: TipoAgendaOnline, id: number) {
    const m = (await this.marcacoesDoTitular(n.c, t.paciente)).lista.find(
      (x) => x.tipo === tipo && x.id === id,
    );
    if (!m) return recusa('nao-encontrado', 'A marcação não está disponível para este acesso.', 404);
    return m;
  }

  /** "Meus agendamentos e atendimentos" (100 / p95 < 500 ms): as marcações do titular, com o que dá para fazer. */
  async agendamentos(n: PortalNoPedido): Promise<ListaAgendamentosPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    const [{ lista, truncado }, cfgs, pres, pags, pesq, r] = await Promise.all([
      this.marcacoesDoTitular(n.c, t.paciente),
      this.porta.configs(n.c),
      this.porta.preCheckinsDoPaciente(n.c, t.paciente),
      this.porta.pagamentosDoPaciente(n.c, t.paciente),
      this.porta.pesquisasDoPaciente(n.c, t.paciente),
      this.relogio(n.c),
    ]);
    const ligado = await this.agendaLigada(n.c.hospital);
    const teles = this.teleconsulta ? await this.teleconsulta.doPaciente(n, t.paciente) : new Map();
    const itens = lista.map((m) => ({
      ...this.item(m, cfgs, pres, pags, pesq, r, ligado),
      teleconsulta: m.tipo === 'consulta' ? (teles.get(m.id) ?? null) : null,
    }));
    return { itens, truncado };
  }

  private item(
    m: MarcacaoUnificada,
    cfgs: readonly ConfigAgendaOnline[],
    pres: readonly PreCheckinOnline[],
    pags: readonly PagamentoPortal[],
    pesq: readonly { tipo: string; marcacao: number }[],
    r: { hoje: string; hhmm: string },
    ligado: boolean,
  ): Omit<AgendamentoPortal, 'teleconsulta'> {
    const k =
      m.agenda === null ? null : (cfgs.find((x) => x.tipo === m.tipo && x.agenda === m.agenda) ?? null);
    const cfg = k && ligado ? paraCfg(k) : null;
    const mudar = podeMudarPeloPortal(m, cfg, r);
    const pre = pres.find((x) => x.tipo === m.tipo && x.marcacao === m.id) ?? null;
    const envio = podeEnviarPreCheckin(m, cfg, pre?.situacao ?? null, r);
    // A marcação paga mostra "pago" mesmo se depois entrou um pagamento duplicado (o faturamento devolve esse).
    const pag =
      pags
        .filter((x) => x.tipo === m.tipo && x.marcacao === m.id)
        .sort(
          (a, b) => Number(b.situacao === 'confirmado') - Number(a.situacao === 'confirmado') || b.id - a.id,
        )[0] ?? null;
    const respondida = pesq.some((x) => x.tipo === m.tipo && x.marcacao === m.id);
    const { procedimento, profissional } = partesDoNome(m.nomeAgenda);
    const situacao: AgendamentoPortal['situacao'] =
      m.estado === 'atendida' || m.estado === 'chegou'
        ? 'atendido'
        : m.estado === 'faltou'
          ? 'faltou'
          : m.estado === 'transferida'
            ? 'transferido'
            : 'marcado';
    return {
      tipo: m.tipo,
      id: String(m.id),
      procedimento,
      profissional,
      data: m.data,
      hora: m.hora,
      situacao,
      peloPortal: m.peloPortal,
      cancelar: mudar,
      // W0-10: o exame também se remarca pelo portal (agenda.remarcarExame, a mesma receita do balcão).
      remarcar: mudar,
      precheckin: {
        pode: envio.pode,
        situacao: pre?.situacao ?? null,
        motivoRecusa: pre?.situacao === 'recusado' ? pre.motivoRecusa : null,
      },
      pagamento: { valor: valorDoPortal(cfg, m.convenio), situacao: pag?.situacao ?? null },
      // Com o agendamento pelo portal desligado, a pesquisa não é oferecida (a resposta grava sob a mesma chave).
      pesquisa: respondida ? 'respondida' : ligado && pesquisaAberta(m, false, r) ? 'pendente' : null,
    };
  }

  async cancelar(
    n: PortalNoPedido,
    tipo: TipoAgendaOnline,
    id: number,
    motivo: (typeof MOTIVOS_CANCELAMENTO_PORTAL)[number]['codigo'],
    idem: string | null = null,
  ): Promise<ListaAgendamentosPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    await this.exigirAgenda(n.c.hospital);
    const m = await this.marcacaoDoTitular(n, t, tipo, id);
    const k = m.agenda === null ? null : await this.porta.config(n.c, tipo, m.agenda);
    const d = podeMudarPeloPortal(m, k ? paraCfg(k) : null, await this.relogio(n.c));
    if (!d.pode) recusa('fora-do-prazo', d.motivo ?? 'Esta marcação não pode ser cancelada pelo portal.');
    const ctx = this.ctxExecutor(n, 'cancelar', `${tipo}-${id}`, idem);
    const entrada = { marcacao: id, motivo, solicitante: 'paciente' as const };
    // M50, etapa 4: a teleconsulta viva da marcação é cancelada junto (no banco, na transação do cancelamento).
    const tele = tipo === 'consulta' && this.teleconsulta ? await this.teleconsulta.daMarcacao(n, id) : null;
    try {
      if (tipo === 'consulta')
        await this.agenda.executar(this.ctxAgenda(n, ctx), 'agenda.cancelarConsulta', entrada);
      else await this.exame.executar(n.c, 'agenda.cancelarExame', entrada, ctx);
    } catch (x) {
      return traduzir(x);
    }
    await this.gravar(
      n.c,
      (g) => g.cancelarPreCheckin(tipo, id),
      this.trilhaAgendamento(n, t, tipo, id, 'cancelamento'),
    );
    if (tipo === 'consulta' && this.teleconsulta)
      await this.teleconsulta.aoCancelar(n, t.paciente, id, tele !== null);
    return this.agendamentos(n);
  }

  async remarcar(
    n: PortalNoPedido,
    id: number,
    e: RemarcarPortal,
    idem: string | null = null,
    tipo: TipoAgendaOnline = 'consulta',
  ): Promise<ResultadoAgendamentoPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    await this.exigirAgenda(n.c.hospital);
    const m = await this.marcacaoDoTitular(n, t, tipo, id);
    const origem = m.agenda === null ? null : await this.porta.config(n.c, tipo, m.agenda);
    const r = await this.relogio(n.c);
    const d = podeMudarPeloPortal(m, origem ? paraCfg(origem) : null, r);
    if (!d.pode) recusa('fora-do-prazo', d.motivo ?? 'Esta marcação não pode ser remarcada pelo portal.');
    const k = await this.cfgDaAgenda(n.c, tipo, e.destino.agenda);
    const daAgenda = (await this.conveniosDaAgendaDe(n.c, tipo, e.destino.agenda)).map((x) => x.codigo);
    if (!convenioLiberado(k, daAgenda, m.convenio))
      recusa('convenio-nao-liberado', 'O seu convênio não pode marcar por esta agenda no portal.');
    if (tipo === 'exame' && m.exame !== null) {
      const serv = (await this.servicosDaAgendaDe(n.c, 'exame', e.destino.agenda)).map((x) => x.codigo);
      if (!servicoLiberado(k, serv, m.exame))
        recusa('servico-nao-liberado', 'Este exame não é marcado por esta agenda no portal.');
    }
    if (!horarioDentroDoPortal(e.destino, paraCfg(k), r))
      recusa(
        'fora-da-janela',
        `Pelo portal, escolha um horário com ao menos ${k.antecedenciaHoras} hora(s) de antecedência.`,
      );
    // M50, etapa 4: a teleconsulta acompanha a remarcação só para uma agenda que também a oferece.
    const tele = tipo === 'consulta' && this.teleconsulta ? await this.teleconsulta.daMarcacao(n, id) : null;
    if (tele && !k.teleconsulta)
      recusa(
        'sem-teleconsulta',
        'Esta teleconsulta só pode ser remarcada para uma agenda que ofereça teleconsulta.',
      );
    if (tele && !['agendada', 'aguardando'].includes(tele.situacao))
      recusa('teleconsulta-iniciada', 'A teleconsulta já começou: não pode ser remarcada.');
    const ctx = this.ctxExecutor(
      n,
      'remarcar',
      `${tipo === 'consulta' ? '' : 'exame-'}${id}-${e.destino.agenda}-${e.destino.data}-${e.destino.hora}`,
      idem,
    );
    const motivo = e.motivo ?? 'PAC-OUTRA-DATA';
    let nova: number;
    try {
      const entrada = { marcacao: id, destino: e.destino, modo: 'liberar', canal: 'portal', motivo };
      const g =
        tipo === 'consulta'
          ? await this.agenda.executar(this.ctxAgenda(n, ctx), 'agenda.remarcarConsulta', entrada)
          : await this.exame.executar(n.c, 'agenda.remarcarExame', entrada, ctx);
      nova = Number(g.resultado['marcacao']);
    } catch (x) {
      if (x instanceof ErroOperacao && COLISAO.has(x.problema.codigo ?? '')) {
        const proximo = await this.proximo(n, tipo, k, e.destino);
        return {
          ok: false,
          agendamento: null,
          proximo,
          mensagem: proximo
            ? 'Esse horário acabou de ser ocupado. Veja o próximo livre nesta agenda.'
            : 'Esse horário acabou de ser ocupado e não há outro livre nesta agenda no período.',
        };
      }
      return traduzir(x);
    }
    await this.gravar(
      n.c,
      (g) => g.cancelarPreCheckin(tipo, id),
      this.trilhaAgendamento(n, t, tipo, nova, 'remarcacao'),
    );
    if (tele && this.teleconsulta)
      await this.teleconsulta.aoRemarcar(n, t.paciente, id, {
        marcacao: nova,
        agenda: e.destino.agenda,
        nomeAgenda: k.nomeAgenda,
        crm: k.crm,
        data: e.destino.data,
        hora: e.destino.hora,
      });
    const lista = await this.agendamentos(n);
    return {
      ok: true,
      agendamento: lista.itens.find((x) => x.tipo === tipo && x.id === String(nova)) ?? null,
      proximo: null,
      mensagem:
        tipo === 'consulta'
          ? 'Consulta remarcada. O horário anterior foi liberado.'
          : 'Exame remarcado. O horário anterior foi liberado.',
    };
  }

  // ── Pré-check-in ─────────────────────────────────────────────────────────────────────────────────────────────────

  async preCheckin(n: PortalNoPedido, tipo: TipoAgendaOnline, id: number): Promise<PreCheckinDoPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    const lista = await this.agendamentos(n);
    const ag = lista.itens.find((x) => x.tipo === tipo && x.id === String(id));
    if (!ag) return recusa('nao-encontrado', 'A marcação não está disponível para este acesso.', 404);
    const [pre, [p]] = await Promise.all([
      this.porta.preCheckinDaMarcacao(n.c, tipo, id),
      this.cadastro.lerPacientes(n.c, [t.paciente]),
    ]);
    const m = await this.marcacaoDoTitular(n, t, tipo, id);
    return {
      agendamento: ag,
      situacao: pre?.situacao ?? null,
      motivoRecusa: pre?.situacao === 'recusado' ? pre.motivoRecusa : null,
      atual: p ? atualDoPaciente(p) : {},
      proposto: (pre?.dados ?? {}) as PreCheckinDoPortal['proposto'],
      documentos: (pre?.documentos ?? []).map((d) => ({ tipo: d.tipo as TipoDocumentoPreCheckin })),
      carteirinha: pre?.carteirinha ? { numero: pre.carteirinha, validade: pre.carteirinhaValidade } : null,
      termo: pre?.termos ?? '',
      pedeCarteirinha: m.convenio !== CONVENIO_PARTICULAR_PORTAL,
    };
  }

  /** O arquivo do pré-check-in (foto ou PDF até 700 KB, tipo conferido pelos primeiros bytes) ao armazenamento. */
  async enviarArquivo(n: PortalNoPedido, tipo: string, bytes: Uint8Array): Promise<{ arquivo: string }> {
    this.portal.titularComEscopo(n, 'agendamentos');
    await this.exigirAgenda(n.c.hospital);
    const esperado = ASSINATURAS[tipo] ?? [0];
    if (
      !(TIPOS_ARQUIVO_PRECHECKIN as readonly string[]).includes(tipo) ||
      bytes.length < 16 ||
      bytes.length > TAMANHO_MAXIMO_PRECHECKIN ||
      !esperado.every((v, i) => bytes[i] === v)
    )
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Arquivo inválido',
        'Envie uma foto (JPEG ou PNG) ou um PDF de até 700 KB.',
        {
          codigo: 'arquivo-invalido',
          campos: ['conteudo'],
        },
      );
    const daSessao = this.arquivos.get(n.s.id) ?? new Map();
    if (daSessao.size >= ARQUIVOS_POR_SESSAO)
      recusa('muitos-arquivos', 'Muitos arquivos nesta sessão. Saia e entre de novo.');
    const chave = await this.armazem.guardar(n.c.hospital, tipo, bytes);
    const arquivo = /([a-f0-9]{32})/.exec(chave)?.[1] ?? sha256(chave).slice(0, 32);
    daSessao.set(arquivo, { chave, sha: sha256(bytes), mime: tipo });
    this.arquivos.set(n.s.id, daSessao);
    if (this.arquivos.size > 5_000) this.arquivos.delete(this.arquivos.keys().next().value as string);
    return { arquivo };
  }

  async enviarPreCheckin(
    n: PortalNoPedido,
    tipo: TipoAgendaOnline,
    id: number,
    e: PreCheckinPortal,
  ): Promise<PreCheckinDoPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    await this.exigirAgenda(n.c.hospital);
    const m = await this.marcacaoDoTitular(n, t, tipo, id);
    const k = m.agenda === null ? null : await this.porta.config(n.c, tipo, m.agenda);
    const atual = await this.porta.preCheckinDaMarcacao(n.c, tipo, id);
    const d = podeEnviarPreCheckin(
      m,
      k ? paraCfg(k) : null,
      atual?.situacao ?? null,
      await this.relogio(n.c),
    );
    if (!d.pode) recusa('precheckin-fechado', d.motivo ?? 'O pré-check-in não está disponível.');
    if (Object.keys(e.dados).length === 0 && e.documentos.length === 0 && !e.carteirinha)
      recusa('precheckin-vazio', 'Informe ao menos um dado, um documento ou a carteirinha.');
    const daSessao =
      this.arquivos.get(n.s.id) ?? new Map<string, { chave: string; sha: string; mime: string }>();
    const jaUsadas = new Set((atual?.documentos ?? []).map((d) => d.chave));
    const documentos: { tipo: TipoDocumentoPreCheckin; chave: string; sha256: string; mime: string }[] = [];
    for (const x of e.documentos) {
      const a = daSessao.get(x.arquivo) ?? (await this.arquivoGuardado(n.c.hospital, x.arquivo));
      if (!a || jaUsadas.has(a.chave))
        return recusa('arquivo-desconhecido', 'Envie o arquivo de novo antes de mandar o pré-check-in.', 400);
      documentos.push({ tipo: x.tipo, chave: a.chave, sha256: a.sha, mime: a.mime });
    }
    await this.gravar(
      n.c,
      (g) =>
        g.enviarPreCheckin({
          tipo,
          marcacao: id,
          nomeAgenda: m.nomeAgenda,
          crm: m.crm,
          data: m.data,
          hora: m.hora,
          paciente: t.paciente,
          conta: n.conta.id,
          dados: e.dados,
          documentos,
          carteirinha: e.carteirinha?.numero ?? null,
          carteirinhaValidade: e.carteirinha?.validade ?? null,
          termos: `atendimento:${e.termo}`,
        }),
      (r: { id: number }) =>
        this.linha(n.c.hospital, {
          evento: EVENTOS_AUDITAVEIS.portalPreCheckinEnviado.codigo,
          operacao: 'portal.enviarPreCheckin',
          tabela: 'pre_checkin',
          id: r.id,
          usuario: quemDaConta(n.conta.id),
          paciente: t.paciente,
          chave: `${tipo}:${id}`,
        }),
    );
    for (const x of e.documentos) daSessao.delete(x.arquivo);
    return this.preCheckin(n, tipo, id);
  }

  /**
   * O arquivo enviado antes, quando a lembrança da sessão se perdeu (a API reiniciou ou o pedido caiu em outra
   * instância): a chave sai do próprio identificador devolvido no envio (128 bits aleatórios, só quem enviou o tem) e o
   * SHA-256 e o tipo são recalculados do armazenamento.
   */
  private async arquivoGuardado(
    hospital: string,
    arquivo: string,
  ): Promise<{ chave: string; sha: string; mime: string } | null> {
    if (!/^[a-f0-9]{32}$/.test(arquivo)) return null;
    for (const ext of EXTENSOES_ARQUIVO) {
      const chave = `portal/provas/${arquivo}-${ext}`;
      const a = await this.armazem.ler(hospital, chave);
      if (a) return { chave, sha: sha256(a.bytes), mime: a.tipo };
    }
    return null;
  }

  // ── Conferência do pré-check-in (tela interna) ───────────────────────────────────────────────────────────────────

  /**
   * A marcação do pré-check-in ainda existe para o mesmo paciente? Relida ao vivo (o outro canal pode ter cancelado,
   * o que apaga a linha, ou transferido); só vale para o pré-check-in ainda não decidido.
   */
  private async marcacaoViva(c: ContextoPortalNucleo, pre: PreCheckinOnline): Promise<boolean> {
    const lida =
      pre.tipo === 'consulta'
        ? await this.agenda.marcacao(c, pre.marcacao)
        : await this.exame.marcacao(c, pre.marcacao);
    if (!lida) return false;
    const m = lida.marcacao;
    const atendido = 'atendido' in m ? m.atendido : false;
    return m.idPaciente === pre.paciente && estadoPelaSituacao(m.situacao, atendido) !== 'transferida';
  }

  private itemDaFila(
    pre: PreCheckinOnline,
    pacientes: ReadonlyMap<number, PacienteFicha>,
    viva = true,
  ): ItemFilaPreCheckin {
    const p = pacientes.get(pre.paciente);
    return {
      id: String(pre.id),
      tipo: pre.tipo,
      data: pre.data,
      hora: pre.hora,
      agenda: pre.nomeAgenda,
      paciente: { id: pre.paciente, nome: p?.nome ?? '—', prontuario: p?.prontuario ?? 0 },
      situacao: pre.situacao,
      enviadoEm: pre.enviadoEm,
      campos: Object.keys(pre.dados).length,
      documentos: pre.documentos.length,
      marcacaoCancelada: !viva,
    };
  }

  async fila(q: QuemAgendaOnline, f: FiltroFilaPreCheckin): Promise<FilaPreCheckin> {
    const c = await this.portal.contextoDoEstabelecimento(q.hospital);
    const r = await this.relogio(c);
    const de = f.data ?? r.hoje;
    const ate =
      f.data ?? new Date(Date.parse(`${r.hoje}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    // A busca por nome ou prontuário: a do cadastro (M11, com o teto dela); a fila filtra pelos pacientes achados.
    let pacientesDaBusca: number[] | null = null;
    let buscaTruncada = false;
    if (f.termo) {
      const b = await buscarPacientes(this.cadastro, c, { termo: f.termo, tipo: 'auto', inativos: 'sim' });
      pacientesDaBusca = b.itens.map((x) => x.id);
      buscaTruncada = b.truncado;
    }
    const pagina = await this.porta.filaPreCheckin(c, {
      situacao: f.situacao,
      de,
      ate,
      depoisDe: f.depoisDe,
      pacientes: pacientesDaBusca,
    });
    const pacientes = new Map(
      (await this.cadastro.lerPacientes(c, [...new Set(pagina.itens.map((x) => x.paciente))])).map((p) => [
        p.id,
        p,
      ]),
    );
    // Só os ainda não decididos são relidos na agenda (uma leitura pela chave por item; a página tem até 50).
    const vivas = await Promise.all(
      pagina.itens.map((x) => (x.situacao === 'enviado' ? this.marcacaoViva(c, x) : Promise.resolve(true))),
    );
    const itens = pagina.itens.map((x, i) => this.itemDaFila(x, pacientes, vivas[i] ?? true));
    itens.sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora));
    return {
      itens,
      proximo: pagina.haMais ? (pagina.itens.at(-1)?.id ?? null) : null,
      podeConferir: q.pode('recepcao.precheckin.conferir'),
      buscaTruncada,
    };
  }

  private async preDoEstabelecimento(c: ContextoPortalNucleo, id: number) {
    const pre = await this.porta.preCheckinPorId(c, id);
    if (!pre) return recusa('nao-encontrado', 'Pré-check-in não encontrado.', 404);
    return pre;
  }

  async detalhe(q: QuemAgendaOnline, id: number): Promise<DetalhePreCheckin> {
    const c = await this.portal.contextoDoEstabelecimento(q.hospital);
    const pre = await this.preDoEstabelecimento(c, id);
    const [[p], viva] = await Promise.all([
      this.cadastro.lerPacientes(c, [pre.paciente]),
      pre.situacao === 'enviado' ? this.marcacaoViva(c, pre) : Promise.resolve(true),
    ]);
    if (!p) return recusa('nao-encontrado', 'O cadastro do paciente não foi encontrado.', 404);
    return {
      item: this.itemDaFila(pre, new Map([[p.id, p]]), viva),
      campos: camposParaConferir(
        atualDoPaciente(p),
        pre.dados as Partial<Record<CampoPreCheckin, string | number>>,
      ),
      documentos: pre.documentos.map((d, indice) => ({ tipo: d.tipo as TipoDocumentoPreCheckin, indice })),
      carteirinha: pre.carteirinha ? { numero: pre.carteirinha, validade: pre.carteirinhaValidade } : null,
      termo: pre.termos,
      motivoRecusa: pre.motivoRecusa,
      conferidoPor: pre.conferidoPor,
      reservadoPor: pre.reservadoPor,
      camposGravados: pre.camposGravados,
      versao: pre.versao,
      versaoCadastro: sha256(p.versao),
    };
  }

  /** O documento enviado (para conferir com o original); a leitura vai à trilha. */
  async documento(
    q: QuemAgendaOnline,
    id: number,
    indice: number,
  ): Promise<{ tipo: string; conteudo: string }> {
    const c = await this.portal.contextoDoEstabelecimento(q.hospital);
    const pre = await this.preDoEstabelecimento(c, id);
    const d = pre.documentos[indice];
    if (!d) return recusa('nao-encontrado', 'Documento não encontrado.', 404);
    const a = await this.armazem.ler(q.hospital, d.chave);
    if (!a || sha256(a.bytes) !== d.sha256)
      return recusa(
        'documento-indisponivel',
        'O arquivo não está disponível (ou foi alterado no armazenamento).',
        404,
      );
    await this.gravar(
      c,
      async () => null,
      this.linha(q.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalPreCheckinConferido.codigo,
        operacao: 'portal.enviarPreCheckin',
        tabela: 'pre_checkin',
        id: pre.id,
        usuario: q.login,
        paciente: pre.paciente,
        chave: `documento-lido:${d.tipo}`,
        estacao: q.estacao,
        correlacao: q.correlacao,
      }),
    );
    return { tipo: a.tipo, conteudo: Buffer.from(a.bytes).toString('base64') };
  }

  /**
   * Conferir: os campos aprovados que mudam vão ao cadastro pela receita do M11 (`cadastro.alterarPaciente`, cenário
   * "pré-check-in conferido"), com quem conferiu; depois o pré-check-in passa a `conferido` com os campos gravados.
   * A versão do cadastro lida na tela é conferida (outra pessoa mudou o cadastro: recarregue).
   * Atomicidade (a receita do M11 grava em transação própria): ANTES dela, o pré-check-in é reservado na versão lida
   * (o paciente não reenvia, outra pessoa não decide); a decisão grava na versão da reserva; se a receita recusar, a
   * reserva é desfeita. A marcação é relida ao vivo: cancelada ou transferida por outro canal, o pré-check-in é
   * encerrado (cancelado) e a conferência recusada, sem tocar no cadastro.
   */
  async conferir(q: QuemAgendaOnline, id: number, e: ConferirPreCheckin): Promise<DetalhePreCheckin> {
    const c = await this.portal.contextoDoEstabelecimento(q.hospital);
    const pre = await this.preDoEstabelecimento(c, id);
    if (pre.situacao !== 'enviado') recusa('situacao', 'Este pré-check-in já foi decidido.');
    if (pre.versao !== e.versao)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'Registro alterado',
        'O paciente reenviou o pré-check-in; recarregue.',
        {
          codigo: 'versao-desatualizada',
        },
      );
    if (pre.reservadoPor && pre.reservadoPor !== q.login)
      recusa('em-conferencia', `${pre.reservadoPor} está conferindo este pré-check-in agora.`);
    if (!(await this.marcacaoViva(c, pre))) {
      await this.gravar(
        c,
        (g) => g.cancelarPreCheckin(pre.tipo, pre.marcacao),
        this.linha(q.hospital, {
          evento: EVENTOS_AUDITAVEIS.portalPreCheckinConferido.codigo,
          operacao: 'portal.enviarPreCheckin',
          tabela: 'pre_checkin',
          id: pre.id,
          usuario: q.login,
          paciente: pre.paciente,
          chave: 'cancelado:marcacao-cancelada',
          estacao: q.estacao,
          correlacao: q.correlacao,
        }),
      );
      recusa(
        'marcacao-cancelada',
        'A marcação deste pré-check-in foi cancelada ou transferida: nada foi gravado no cadastro.',
      );
    }
    const [p] = await this.cadastro.lerPacientes(c, [pre.paciente]);
    if (!p) return recusa('nao-encontrado', 'O cadastro do paciente não foi encontrado.', 404);
    if (sha256(p.versao) !== e.versaoCadastro)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'Cadastro alterado',
        'O cadastro do paciente mudou desde a abertura; recarregue.',
        {
          codigo: 'conflito-versao',
        },
      );
    const campos = camposParaConferir(
      atualDoPaciente(p),
      pre.dados as Partial<Record<CampoPreCheckin, string | number>>,
    );
    const fora = aprovadosForaDoProposto(campos, e.campos);
    if (fora.length)
      recusa('campo-nao-proposto', `Campo que o paciente não enviou: ${fora.join(', ')}.`, 400);
    const alteracoes = alteracaoAprovada(campos, e.campos);
    const gravados = CAMPOS_PRECHECKIN.filter((x) => alteracoes[x] !== undefined);
    let versaoDaDecisao = pre.versao;
    if (gravados.length > 0) {
      if (!q.pode('cadastro.paciente.editar'))
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Sem permissão',
          'Seu perfil não altera o cadastro do paciente: confira sem aprovar campos ou peça a quem pode.',
          {
            codigo: 'sem-permissao',
          },
        );
      const validas = esquemaAlteracoesPaciente.safeParse(alteracoes);
      if (!validas.success)
        recusa(
          'dados-invalidos',
          'Os dados propostos não passam na validação do cadastro: recuse com o motivo.',
          400,
        );
      const trilhaReserva = (chave: string) =>
        this.linha(q.hospital, {
          evento: EVENTOS_AUDITAVEIS.portalPreCheckinConferido.codigo,
          operacao: 'portal.enviarPreCheckin',
          tabela: 'pre_checkin',
          id: pre.id,
          usuario: q.login,
          paciente: pre.paciente,
          chave,
          estacao: q.estacao,
          correlacao: q.correlacao,
        });
      const reserva = await this.gravar<{ versao: number }>(
        c,
        (g) => g.reservarConferencia(pre.id, pre.versao, q.login),
        trilhaReserva('reserva'),
      );
      try {
        await this.cadastro.alterar(
          c,
          { idPaciente: p.id, versao: p.versao, alteracoes: validas.data as AlteracoesPaciente },
          q.contextoOperacao('cadastro.alterarPaciente'),
        );
      } catch (x) {
        await this.gravar(
          c,
          (g) => g.liberarConferencia(pre.id, reserva.versao),
          trilhaReserva('reserva-desfeita'),
        );
        return traduzir(x);
      }
      versaoDaDecisao = reserva.versao;
      await q.trilhaMemoria(
        EVENTOS_AUDITAVEIS.pacienteGravadoMemoria.codigo,
        'cadastro.paciente',
        String(p.id),
      );
    }
    await this.gravar(
      c,
      (g) =>
        g.decidirPreCheckin(pre.id, versaoDaDecisao, { conferido: true, campos: gravados, por: q.login }),
      this.linha(q.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalPreCheckinConferido.codigo,
        operacao: 'portal.enviarPreCheckin',
        tabela: 'pre_checkin',
        id: pre.id,
        usuario: q.login,
        paciente: pre.paciente,
        chave: `conferido:${gravados.join(',') || 'sem-alteracao'}`.slice(0, 200),
        estacao: q.estacao,
        correlacao: q.correlacao,
      }),
    );
    return this.detalhe(q, id);
  }

  async recusar(q: QuemAgendaOnline, id: number, e: RecusarPreCheckin): Promise<DetalhePreCheckin> {
    const c = await this.portal.contextoDoEstabelecimento(q.hospital);
    const pre = await this.preDoEstabelecimento(c, id);
    await this.gravar(
      c,
      (g) => g.decidirPreCheckin(pre.id, e.versao, { conferido: false, motivo: e.motivo, por: q.login }),
      this.linha(q.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalPreCheckinConferido.codigo,
        operacao: 'portal.enviarPreCheckin',
        tabela: 'pre_checkin',
        id: pre.id,
        usuario: q.login,
        paciente: pre.paciente,
        chave: 'recusado',
        estacao: q.estacao,
        correlacao: q.correlacao,
      }),
    );
    return this.detalhe(q, id);
  }

  // ── Pagamento ────────────────────────────────────────────────────────────────────────────────────────────────────

  private cobranca(p: PagamentoPortal): CobrancaPortal {
    return {
      id: String(p.id),
      agendamento: String(p.marcacao),
      tipo: p.tipo,
      valor: p.valor,
      forma: p.forma,
      situacao: p.situacao,
      expiraEm: p.expiraEm.toISOString(),
      pixCopiaECola: p.situacao === 'pendente' ? p.pixCopiaECola : null,
      enderecoCartao: p.situacao === 'pendente' ? p.enderecoCartao : null,
      simulado: p.conector === 'simulado',
      confirmadoEm: p.confirmadoEm,
    };
  }

  async pagamentos(n: PortalNoPedido): Promise<ListaPagamentosPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    const lista = await this.porta.pagamentosDoPaciente(n.c, t.paciente);
    return {
      itens: lista.map((p) => this.cobranca(p)),
      ligado: await this.pagamentoLigado(n.c.hospital),
    };
  }

  async iniciarPagamento(
    n: PortalNoPedido,
    tipo: TipoAgendaOnline,
    id: number,
    forma: FormaPagamentoPortal,
  ): Promise<CobrancaPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    if (!(await this.pagamentoLigado(n.c.hospital)))
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Pagamento indisponível',
        'O pagamento pelo portal ainda não foi liberado. Pague na recepção.',
        {
          codigo: 'recurso-desligado',
        },
      );
    const m = await this.marcacaoDoTitular(n, t, tipo, id);
    const k = m.agenda === null ? null : await this.porta.config(n.c, tipo, m.agenda);
    const valor = valorDoPortal(k && k.ativa ? paraCfg(k) : null, m.convenio);
    if (valor === null) recusa('sem-cobranca', 'Esta marcação não tem pagamento pelo portal.');
    if (m.estado !== 'marcada' && m.estado !== 'confirmada')
      recusa('situacao', 'Só marcações ainda não atendidas são pagas pelo portal.');
    // A cobrança vencida desta marcação é relida NO GATEWAY antes de dar lugar a outra: a paga no fim do prazo (com o
    // retorno atrasado ou perdido) é confirmada no caixa, e a nova é recusada (nunca paga duas vezes).
    const vencidas = (await this.porta.pagamentosDoPaciente(n.c, t.paciente)).filter(
      (x) =>
        x.tipo === tipo &&
        x.marcacao === id &&
        x.situacao === 'pendente' &&
        x.expiraEm.getTime() <= this.agora().getTime(),
    );
    for (const v of vencidas) {
      const r = await this.confirmar(n.c.hospital, v.transacao, 'conferencia');
      if (r?.situacao === 'confirmado') recusa('situacao', 'Esta marcação já está paga.');
    }
    const expiraEm = new Date(this.agora().getTime() + MINUTOS_COBRANCA_PORTAL * 60_000);
    let criada: Awaited<ReturnType<GatewayPagamento['criar']>>;
    try {
      criada = await this.gateway.criar({
        valor: valor as number,
        forma,
        referencia: `${tipo}-${id}`,
        expiraEm,
      });
    } catch {
      return recusa(
        'gateway-indisponivel',
        'O pagamento está indisponível agora. Tente mais tarde ou pague na recepção.',
        503,
      );
    }
    const r = await this.gravar(
      n.c,
      (g) =>
        g.iniciarPagamento({
          conta: n.conta.id,
          paciente: t.paciente,
          tipo,
          marcacao: id,
          valor: valor as number,
          forma,
          conector: this.gateway.conector,
          transacao: criada.transacao,
          expiraEm,
          pixCopiaECola: criada.pixCopiaECola,
          enderecoCartao: criada.enderecoCartao,
        }),
      (x: { id: number }) =>
        this.linha(n.c.hospital, {
          evento: EVENTOS_AUDITAVEIS.portalPagamentoIniciado.codigo,
          operacao: 'portal.iniciarPagamento',
          tabela: 'intencao_pagamento_portal',
          id: x.id,
          usuario: quemDaConta(n.conta.id),
          paciente: t.paciente,
          chave: `${tipo}:${id}:${forma}`,
        }),
    );
    const p = await this.porta.pagamentoPorId(n.c, (r as { id: number }).id);
    return this.cobranca(p as PagamentoPortal);
  }

  /**
   * `portal.confirmarPagamento`: relê a transação NO GATEWAY (nunca confia no corpo recebido) e confirma uma vez só
   * (a repetida, pelo retorno ou pela conferência, devolve a mesma sem gravar outro pagamento no caixa). A vencida
   * também é relida: se o gateway a aprovou (paga no fim do prazo), vai ao caixa (confirmada, ou `duplicado` para o
   * faturamento devolver se a marcação já estava paga por outra).
   */
  async confirmar(
    hospital: string,
    transacao: string,
    por: 'retorno' | 'conferencia',
  ): Promise<PagamentoPortal | null> {
    const c = { rede: this.portal.rede, hospital };
    const p = await this.porta.pagamentoPorTransacao(c, transacao);
    if (!p) return null;
    if (p.situacao !== 'pendente' && p.situacao !== 'expirado') return p;
    const g = await this.gateway.consultar(transacao);
    if (g.resultado === 'pendente') return p;
    if (p.situacao === 'expirado' && g.resultado !== 'aprovado') return p;
    const r = await this.gravar(
      c,
      (x) =>
        x.confirmarPagamento({
          transacao,
          resultado: g.resultado as 'aprovado',
          comprovante: g.comprovante,
          por,
        }),
      (x: { mudou: boolean; pagamento: PagamentoPortal }) =>
        x.mudou
          ? this.linha(hospital, {
              evento: EVENTOS_AUDITAVEIS.portalPagamentoConfirmado.codigo,
              operacao: 'portal.confirmarPagamento',
              tabela: 'intencao_pagamento_portal',
              id: x.pagamento.id,
              usuario: por === 'retorno' ? `${USUARIO_PORTAL}.GATEWAY` : quemDaConta(x.pagamento.conta),
              paciente: x.pagamento.paciente,
              chave: `${x.pagamento.situacao}:${x.pagamento.pagamentoCaixa ?? ''}`,
            })
          : null,
    );
    return (r as { pagamento: PagamentoPortal }).pagamento;
  }

  async conferirPagamento(n: PortalNoPedido, id: number): Promise<CobrancaPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    const p = await this.porta.pagamentoPorId(n.c, id);
    if (!p || p.paciente !== t.paciente) return recusa('nao-encontrado', 'Pagamento não encontrado.', 404);
    const atual = (await this.confirmar(n.c.hospital, p.transacao, 'conferencia')) ?? p;
    return this.cobranca(atual);
  }

  /** Sessão sintética: "Simular o pagamento" no gateway simulado (nunca em produção: o gateway real não tem isto). */
  async simular(n: PortalNoPedido, id: number, aprovar: boolean): Promise<CobrancaPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    const p = await this.porta.pagamentoPorId(n.c, id);
    if (!p || p.paciente !== t.paciente) return recusa('nao-encontrado', 'Pagamento não encontrado.', 404);
    const g = this.gateway as { simularPagamento?: (t: string, a: boolean) => boolean };
    if (this.gateway.conector !== 'simulado' || !g.simularPagamento)
      return recusa('nao-encontrado', 'Pagamento não encontrado.', 404);
    g.simularPagamento(p.transacao, aprovar);
    // O retorno do gateway simulado chega como o real chegaria (pela rota do retorno, idempotente).
    await this.confirmar(n.c.hospital, p.transacao, 'retorno');
    return this.conferirPagamento(n, id);
  }

  // ── Pesquisa de satisfação ───────────────────────────────────────────────────────────────────────────────────────

  async responderPesquisa(
    n: PortalNoPedido,
    tipo: TipoAgendaOnline,
    id: number,
    e: PesquisaPortal,
  ): Promise<ListaAgendamentosPortal> {
    const t = this.portal.titularComEscopo(n, 'agendamentos');
    await this.exigirAgenda(n.c.hospital);
    const m = await this.marcacaoDoTitular(n, t, tipo, id);
    const r = await this.relogio(n.c);
    const respondidas = await this.porta.pesquisasDoPaciente(n.c, t.paciente);
    const ja = respondidas.some((x) => x.tipo === tipo && x.marcacao === id);
    if (!pesquisaAberta(m, ja, r))
      recusa(
        'pesquisa-fechada',
        ja
          ? 'A pesquisa deste atendimento já foi respondida.'
          : 'A pesquisa abre depois do atendimento, por 30 dias.',
      );
    await this.gravar(
      n.c,
      (g) =>
        g.responderPesquisa({
          conta: n.conta.id,
          paciente: t.paciente,
          tipo,
          marcacao: id,
          nomeAgenda: m.nomeAgenda,
          dataAtendimento: m.data,
          nota: e.nota,
          comentario: e.comentario,
        }),
      (x: { id: number }) =>
        this.linha(n.c.hospital, {
          evento: EVENTOS_AUDITAVEIS.portalPesquisaRespondida.codigo,
          operacao: 'portal.responderPesquisa',
          tabela: 'resposta_pesquisa_satisfacao',
          id: x.id,
          usuario: quemDaConta(n.conta.id),
          paciente: t.paciente,
          chave: `${tipo}:${id}`,
        }),
    );
    return this.agendamentos(n);
  }
}
