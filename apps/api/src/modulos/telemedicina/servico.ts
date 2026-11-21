// Telemedicina (cap-13 §13.3.5 TELE-01 a TELE-04):
//   - o portal: a teleconsulta marcada pelo portal numa agenda que a oferece; a sala de espera virtual (o termo vigente
//     aceito e o local informado antes de o médico iniciar); a entrada na sala do médico pelo provedor;
//   - o médico: as teleconsultas do dia com o paciente na espera; o detalhe com o alerta do crônico sem consulta
//     presencial há mais de 180 dias; INICIAR = abrir a sala no provedor (a declaração do médico) e abrir o atendimento
//     como uma consulta pelo executor do atendimento (que liga a teleconsulta na mesma transação); ENCERRAR com o
//     motivo; a teleinterconsulta (pedir, abrir a sala, responder, cancelar);
//   - a liberação pela chave `telemedicina`; nenhuma mensagem ao paciente: ele vê a sala no portal. Toda gravação vai
//     com a linha da trilha na mesma transação.
// Melhoria: o médico da sala é conferido pelo id do vínculo profissional (antes, pelo login truncado em 31 letras).
// Melhoria: a teleconsulta marcada pelo portal é criada pelo gancho na porta própria (sem depender da receita da
// agenda) e o início liga o atendimento e põe a teleconsulta em andamento na mesma transação da trilha.
// Melhoria: a trilha do portal leva só ids e códigos (evento, operação, versão do termo), nunca o local nem textos.
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  type AlertaCronico,
  type ApoioTelemedicina,
  type AtendimentoResumo,
  PROCEDIMENTO_PADRAO_TELECONSULTA,
  CHAVE_TELEMEDICINA,
  type EncerrarTeleconsulta,
  type EntrarSalaEspera,
  EVENTOS_AUDITAVEIS,
  type IniciarTeleconsulta,
  type ListaTelemedicina,
  type ListaTeleconsultasPortal,
  type ResponderTeleinterconsulta,
  type CancelarTeleinterconsulta,
  type ResultadoTeleconsulta,
  type SituacaoTeleconsulta,
  type SolicitarTeleinterconsulta,
  type TeleconsultaDetalhe,
  type TeleconsultaDoPortal,
  type TeleconsultaResumo,
  TETO_LISTA_TELEMEDICINA,
  TEXTO_TERMO_TELECONSULTA,
  VERSAO_TERMO_TELECONSULTA,
  type LocalPaciente,
  type MotivoEncerramentoTeleconsulta,
} from '@sgh/contratos';
import {
  alertaCronico,
  exigirCienciaDoAlerta,
  janelaSalaEspera,
  podeCancelarTeleinterconsulta,
  podeEncerrarTeleconsulta,
  podeEntrarSalaEspera,
  podeIniciarTeleconsulta,
  podeResponderTeleinterconsulta,
  podeSolicitarTeleinterconsulta,
  teleconsultaAberta,
} from '@sgh/dominio-atendimento';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import type { PortaAtendimento } from '../atendimento/public-api.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { contextoDoEstabelecimento } from '../cadastro/contexto-nucleo.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { PacienteFicha } from '../cadastro/tipos.js';
import type { PortaCadastro } from '../cadastro/public-api.js';
import type { FonteConfiguracao } from '../config/public-api.js';
import type {
  ApoioGravacao,
  ContextoPortaM18,
  DestinoPorta,
  GravacaoFeita,
  LiberacaoGravacao,
  PortaGravacaoM18,
  TrilhaDaGravacao,
} from '../exames/public-api.js';
import { ligadaNoEstabelecimento } from '../portal-paciente/aplicacao/liberacao.js';
import {
  type PortalNoPedido,
  quemDaConta,
  type ServicoPortalPaciente,
  USUARIO_PORTAL,
} from '../portal-paciente/aplicacao/servico.js';
import {
  type ContextoTelemedicina,
  ErroTelemedicina,
  type GravadorTelemedicina,
  type PortaTelemedicina,
  type Teleconsulta,
} from './porta.js';
import { type ProvedorTeleconsulta, salaParaQuemVe } from './provedor.js';

const E = EVENTOS_AUDITAVEIS;
const TABELA = 'teleconsulta';

/** A operação da tela do médico e a permissão de agir (o mapa vale no servidor). */
export const OPERACOES_TELEMEDICINA: Readonly<Record<string, string>> = {
  'atendimento.abrirAtendimento': 'atendimento.teleconsulta.realizar',
};

/** A porta de gravação do apoio: a abertura pelo atendimento e as gravações diretas pela telemedicina. */
export class PortaGravacaoTelemedicina implements PortaGravacaoM18<GravadorTelemedicina> {
  constructor(
    private readonly tele: PortaTelemedicina,
    private readonly atendimento: PortaAtendimento,
  ) {}
  get destino(): DestinoPorta {
    return this.tele.destino;
  }
  podeGravar(c: ContextoPortaM18, op: string): Promise<LiberacaoGravacao> {
    return this.atendimento.podeGravar(c, op);
  }
  executar(c: ContextoPortaM18, op: string, e: unknown, ctx: ContextoOperacao): Promise<GravacaoFeita> {
    return this.atendimento.executar(c, op, e, ctx);
  }
  gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorTelemedicina) => Promise<T>,
  ): Promise<T> {
    return this.tele.gravar(c, trilha, fn);
  }
}

const recusa = (codigo: string, detalhe: string, status = 409): never => {
  throw new ErroProblema(
    status === 503
      ? 'indisponivel'
      : status === 404
        ? 'nao-encontrado'
        : status === 403
          ? 'sem-permissao'
          : 'recusa-de-negocio',
    status,
    status === 404 ? 'Não encontrado' : status === 403 ? 'Sem permissão' : 'Pedido recusado',
    detalhe,
    { codigo },
  );
};

function traduzir(e: unknown): never {
  if (e instanceof ErroProblema) throw e;
  if (e instanceof ErroOperacao) {
    const p = e.problema;
    const tipo =
      p.status === 404
        ? 'nao-encontrado'
        : p.status === 400
          ? 'entrada-invalida'
          : p.status === 403
            ? 'sem-permissao'
            : p.codigo === 'conflito-versao'
              ? 'conflito-de-versao'
              : 'recusa-de-negocio';
    throw new ErroProblema(tipo, p.status, p.title, p.detail, p.codigo ? { codigo: p.codigo } : {});
  }
  if (e instanceof ErroTelemedicina) {
    if (e.codigo === 'nao-encontrado') recusa('nao-encontrado', e.message, 404);
    if (e.codigo === 'situacao') recusa('situacao', e.message);
    throw new ErroProblema('conflito-de-versao', 409, 'Registro alterado', e.message, { codigo: e.codigo });
  }
  throw e;
}

const hhmmDe = (agora: string) => `${agora.slice(11, 13)}${agora.slice(14, 16)}`;
const diasAntes = (hoje: string, n: number) =>
  new Date(Date.parse(`${hoje}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const nomeDe = (p: PacienteFicha | undefined) => (p ? (p.nomeSocial ?? p.nome) : '');
const local = (l: Teleconsulta): LocalPaciente | null =>
  l.local
    ? {
        uf: l.local.uf as LocalPaciente['uf'],
        municipio: l.local.municipio,
        tipo: l.local.tipo as LocalPaciente['tipo'],
      }
    : null;

const ANTES_DO_ATENDIMENTO: ReadonlySet<string> = new Set(['agendada', 'aguardando', 'sala-aberta']);

/**
 * A teleconsulta cuja marcação não existe mais na agenda (ou mudou de dia e hora) fora do portal e da central — pelo
 * outro sistema — deixa de valer antes do atendimento: sai como cancelada para o paciente e para o médico.
 */
function vigente(l: Teleconsulta): Teleconsulta {
  return l.modalidade === 'teleconsulta' &&
    l.marcacaoVigente === false &&
    ANTES_DO_ATENDIMENTO.has(l.situacao)
    ? { ...l, situacao: 'cancelada' }
    : l;
}

/** A sessão é o médico que abriu a sala da teleconsulta (a declaração e o vínculo são dele). */
const doMedicoDaSala = (l: Teleconsulta, vinculo: number | null) =>
  vinculo !== null && l.vinculoMedico === vinculo;

/** O contexto das portas do atendimento e do cadastro a partir do contexto da telemedicina (sessão ou portal). */
const contextoPorta = (c: ContextoTelemedicina): ContextoPorta => {
  const m = contextoDoEstabelecimento(c.hospital ?? '');
  return {
    cliente: c.cliente || m.cliente,
    estabelecimento: c.estabelecimento ?? m.estabelecimento,
    usuario: c.usuario ?? null,
    correlacao: c.correlacao ?? 'telemedicina',
    rede: c.rede ?? '',
    hospital: c.hospital ?? '',
  };
};

/** A teleconsulta no portal (o gancho que a agenda online do portal chama). */
export interface GanchoTeleconsultaPortal {
  ligada(hospital: string): Promise<boolean>;
  aoMarcar(
    n: PortalNoPedido,
    paciente: number,
    m: { marcacao: number; agenda: number; nomeAgenda: string; crm: number; data: string; hora: string },
  ): Promise<void>;
  aoCancelar(n: PortalNoPedido, paciente: number, marcacao: number, havia?: boolean): Promise<void>;
  aoRemarcar(
    n: PortalNoPedido,
    paciente: number,
    de: number,
    para: { marcacao: number; agenda: number; nomeAgenda: string; crm: number; data: string; hora: string },
  ): Promise<void>;
  daMarcacao(n: PortalNoPedido, marcacao: number): Promise<Teleconsulta | null>;
  doPaciente(
    n: PortalNoPedido,
    paciente: number,
  ): Promise<Map<number, { id: number; situacao: SituacaoTeleconsulta }>>;
}

export class ServicoTelemedicina implements GanchoTeleconsultaPortal {
  private readonly log = new Logger('Telemedicina');

  constructor(
    private readonly porta: PortaTelemedicina,
    private readonly atendimento: PortaAtendimento,
    private readonly cadastro: PortaCadastro,
    readonly apoio: ApoioGravacao<GravadorTelemedicina>,
    readonly provedor: ProvedorTeleconsulta,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly portal: ServicoPortalPaciente | null,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  get destino(): DestinoPorta {
    return this.porta.destino;
  }

  // ── Comum ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async relogio(c: ContextoTelemedicina) {
    const r = await this.atendimento.relogio(contextoPorta(c));
    return { hoje: r.hoje, hhmm: hhmmDe(r.agora) };
  }

  private async gravarSgh<T>(
    s: SessaoCadastro,
    evento: string,
    alvo: (r: T) => { tabela: string; id?: string | null; paciente?: number | null; chave?: string | null },
    fn: (g: GravadorTelemedicina) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.apoio.sgh(s, evento, CHAVE_TELEMEDICINA, alvo, fn);
    } catch (e) {
      return traduzir(e);
    }
  }

  private exigirProvedor(): void {
    if (!this.provedor.disponivel)
      recusa(
        'provedor-indisponivel',
        'O provedor de teleconsulta não está configurado neste ambiente: a autorização do dono é pré-requisito da telemedicina.',
        503,
      );
  }

  private async lida(c: ContextoTelemedicina, id: number): Promise<Teleconsulta> {
    const l = await this.porta.porId(c, id);
    if (!l) return recusa('nao-encontrado', 'Teleconsulta não encontrada.', 404);
    return vigente(l);
  }

  // ── Tela do médico ───────────────────────────────────────────────────────────────────────────────────────────────

  private resumo(l: Teleconsulta, p: PacienteFicha | undefined): TeleconsultaResumo {
    return {
      id: l.id,
      modalidade: l.modalidade,
      situacao: l.situacao,
      data: l.data,
      hora: l.hora,
      agenda:
        l.modalidade === 'teleinterconsulta'
          ? `Teleinterconsulta com ${l.nomeConvidado ?? ''}`
          : l.nomeAgenda,
      paciente: p ? { id: p.id, nome: nomeDe(p), prontuario: p.prontuario } : null,
      atendimento: l.atendimento,
      pacienteNaEspera: l.modalidade === 'teleconsulta' && l.situacao === 'aguardando',
      versao: l.versao,
    };
  }

  async lista(s: SessaoCadastro, f: { data: string | null; minhas: boolean }): Promise<ListaTelemedicina> {
    const c = s.porta;
    const r = await this.relogio(c);
    const data = f.data ?? r.hoje;
    const prof = await this.atendimento.profissional(c, s.login);
    const [dia, inter, lib] = await Promise.all([
      this.porta.doDia(c, {
        data,
        profissional: f.minhas && prof ? prof.vinculo : null,
        teto: TETO_LISTA_TELEMEDICINA,
      }),
      this.porta.interconsultas(c, {
        convidado: prof?.vinculo ?? null,
        solicitante: s.login,
        desde: diasAntes(r.hoje, 30),
        teto: TETO_LISTA_TELEMEDICINA,
      }),
      this.apoio.liberacao(s),
    ]);
    const ids = [...new Set([...dia.itens, ...inter.itens].map((x) => x.paciente))];
    const pacs = ids.length ? await this.cadastro.lerPacientes(c, ids) : [];
    const pac = (id: number) => pacs.find((p) => p.id === id);
    return {
      data,
      teleconsultas: dia.itens.map((l) => this.resumo(vigente(l), pac(l.paciente))),
      interconsultas: inter.itens.map((l) => this.resumo(l, pac(l.paciente))),
      truncado: dia.truncado || inter.truncado,
      ligada: lib.ligada,
      motivo: lib.motivo,
      podeRealizar: s.pode('atendimento.teleconsulta.realizar'),
      profissional: prof ? { vinculo: prof.vinculo, nome: prof.nome } : null,
    };
  }

  /** O alerta do crônico (TELE-04): o histórico de atendimentos; os que foram teleconsulta não contam como presencial. */
  async alerta(c: ContextoTelemedicina, paciente: number, hoje: string): Promise<AlertaCronico> {
    const hist = await this.porta.historicoClinico(c, paciente);
    return alertaCronico(
      hist.map((h) => ({
        data: h.data,
        cid: h.cid,
        teleconsulta: h.teleconsulta,
        laboratorio: h.laboratorio,
      })),
      hoje,
    );
  }

  async detalhe(s: SessaoCadastro, id: number): Promise<TeleconsultaDetalhe> {
    const c = s.porta;
    const l = await this.lida(c, id);
    const [r, prof, lib, pacs] = await Promise.all([
      this.relogio(c),
      this.atendimento.profissional(c, s.login),
      this.apoio.liberacao(s),
      this.cadastro.lerPacientes(c, [l.paciente]),
    ]);
    const podeRealizar = s.pode('atendimento.teleconsulta.realizar');
    const tele = l.modalidade === 'teleconsulta';
    const alerta = tele && teleconsultaAberta(l.situacao) ? await this.alerta(c, l.paciente, r.hoje) : null;
    const m = tele && l.marcacao ? await this.atendimento.marcacao(c, l.marcacao) : null;
    const nao = (motivo: string) => ({ pode: false, motivo });
    const iniciar = tele
      ? podeIniciarTeleconsulta(
          {
            situacao: l.situacao,
            data: l.data,
            termo: l.termo !== null,
            local: l.local !== null,
            atendimento: l.atendimento,
          },
          r,
          {
            ligada: lib.ligada,
            podeRealizar,
            profissional: prof ? { conselhoAtivo: prof.conselhoAtivo } : null,
          },
        )
      : nao('Teleinterconsulta: o convidado responde com o parecer.');
    const geral = !lib.ligada
      ? nao(lib.motivo ?? 'A telemedicina está em consulta neste estabelecimento.')
      : !podeRealizar
        ? nao('Seu perfil não permite realizar teleconsulta.')
        : null;
    const comOutroMedico =
      tele &&
      (l.situacao === 'sala-aberta' || l.situacao === 'em-andamento') &&
      !doMedicoDaSala(l, prof?.vinculo ?? null);
    const encerrar = !tele
      ? nao('A teleinterconsulta termina com o parecer ou o cancelamento.')
      : comOutroMedico
        ? nao('Esta teleconsulta está com outro médico.')
        : (geral ?? podeEncerrarTeleconsulta(l, null));
    const responder = tele
      ? nao('Só na teleinterconsulta.')
      : podeResponderTeleinterconsulta(
          { situacao: l.situacao, convidado: l.convidado ?? 0 },
          {
            ligada: lib.ligada,
            podeRealizar,
            vinculo: prof?.vinculo ?? null,
            conselhoAtivo: prof?.conselhoAtivo === true,
          },
        );
    const cancelar = tele
      ? nao('A teleconsulta se encerra (o cancelamento é da marcação).')
      : podeCancelarTeleinterconsulta(
          { situacao: l.situacao, solicitante: l.criadoPor },
          { ligada: lib.ligada, login: s.login },
        );
    const paraMim = !tele && prof !== null && l.convidado === prof.vinculo;
    // O endereço da sala só a quem participa: o médico da teleconsulta, o convidado ou quem pediu a teleinterconsulta.
    const papel: 'medico' | 'convidado' | null = !podeRealizar
      ? null
      : tele
        ? doMedicoDaSala(l, prof?.vinculo ?? null)
          ? 'medico'
          : null
        : paraMim
          ? 'convidado'
          : l.criadoPor === s.login
            ? 'medico'
            : null;
    return {
      ...this.resumo(l, pacs[0]),
      marcacao: l.marcacao,
      termo: l.termo ? { versao: l.termo.versao, aceitoEm: l.termo.aceitoEm } : null,
      local: local(l),
      esperaDesde: l.esperaDesde,
      pacienteEntrouEm: l.pacienteEntrouEm,
      iniciadaEm: l.iniciadaEm,
      encerradaEm: l.encerradaEm,
      motivoEncerramento: (l.motivoEncerramento as MotivoEncerramentoTeleconsulta | null) ?? null,
      medico: l.medico,
      sala: papel ? salaParaQuemVe(this.provedor, l, papel) : null,
      alerta,
      abertura: m
        ? {
            convenio: m.convenio,
            especialidade: m.especialidade,
            unidade: m.unidade,
            centroCusto: m.centroCusto,
            procedimento: m.procedimento,
          }
        : null,
      interconsulta: tele
        ? null
        : {
            solicitante: l.criadoPor,
            convidado: { vinculo: l.convidado ?? 0, nome: l.nomeConvidado ?? '' },
            motivo: l.motivoInterconsulta ?? '',
            parecer: l.parecer,
            respondidaEm: l.respondidaEm,
            paraMim,
            minha: l.criadoPor === s.login,
          },
      acoes: {
        iniciar:
          comOutroMedico && l.situacao === 'sala-aberta'
            ? nao('A sala foi aberta por outro médico: só ele inicia o atendimento.')
            : iniciar,
        encerrar,
        responder,
        cancelar,
      },
    };
  }

  /**
   * Iniciar: (1) a sala no provedor com a declaração do médico (trilha `salaAberta`), (2) o atendimento como uma
   * consulta pelo executor do atendimento (cenário teleconsulta; ele grava `teleconsulta.atendimento_id` na transação
   * dele) e (3) a teleconsulta em andamento com a trilha TELECONSULTA_INICIADA, noutra transação. Se (2) recusar, a sala
   * fica aberta e o médico tenta de novo (o passo 1 não se repete). Se (3) falhar depois de (2), a nova tentativa
   * encontra a sala aberta com o atendimento já ligado e só conclui o passo 3 (reentrante; ver `retomarInicio`).
   */
  async iniciar(s: SessaoCadastro, id: number, e: IniciarTeleconsulta): Promise<ResultadoTeleconsulta> {
    const c = s.porta;
    const l = await this.lida(c, id);
    if (l.modalidade !== 'teleconsulta' || l.marcacao === null)
      return recusa('nao-teleconsulta', 'Só a teleconsulta abre atendimento.');
    if (l.situacao === 'sala-aberta' && l.atendimento !== null) return this.retomarInicio(s, l);
    if (l.versao !== e.versao && l.situacao !== 'sala-aberta')
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'Registro alterado',
        'A teleconsulta mudou desde a leitura (o paciente entrou na sala de espera ou mudou o local); recarregue.',
        { codigo: 'versao-desatualizada' },
      );
    const [r, prof, lib] = await Promise.all([
      this.relogio(c),
      this.atendimento.profissional(c, s.login),
      this.apoio.liberacao(s),
    ]);
    const d = podeIniciarTeleconsulta(
      {
        situacao: l.situacao,
        data: l.data,
        termo: l.termo !== null,
        local: l.local !== null,
        atendimento: l.atendimento,
      },
      r,
      {
        ligada: lib.ligada,
        podeRealizar: s.pode('atendimento.teleconsulta.realizar'),
        profissional: prof ? { conselhoAtivo: prof.conselhoAtivo } : null,
      },
    );
    if (!d.pode || !prof)
      return recusa('nao-pode-iniciar', d.motivo ?? 'A teleconsulta não pode ser iniciada.');
    // Na nova tentativa (sala já aberta), só o médico que abriu a sala e declarou abre o atendimento.
    if (l.situacao === 'sala-aberta' && !doMedicoDaSala(l, prof.vinculo))
      return recusa(
        'outro-medico',
        'A sala desta teleconsulta foi aberta por outro médico: só ele inicia o atendimento.',
        403,
      );
    const alerta = await this.alerta(c, l.paciente, r.hoje);
    const ciencia = exigirCienciaDoAlerta(alerta, e.cienteAlerta);
    if (!ciencia.pode) return recusa('alerta-cronico', ciencia.motivo ?? 'Confirme o alerta.');
    const m = await this.atendimento.marcacao(c, l.marcacao);
    if (!m || m.registro > 0)
      return recusa(
        m ? 'marcacao-ja-atendida' : 'marcacao-inexistente',
        m ? 'A marcação já tem atendimento aberto.' : 'A marcação da teleconsulta não existe mais.',
      );
    // 1. A sala do provedor (uma vez: na nova tentativa, a sala já aberta é reaproveitada).
    if (l.situacao === 'aguardando') {
      this.exigirProvedor();
      const { sala } = await this.provedor.criarSala(`tele-${s.hospital}-${l.id}`);
      await this.gravarSgh(
        s,
        E.teleconsultaSalaAberta.codigo,
        () => ({
          tabela: TABELA,
          id: String(l.id),
          paciente: l.paciente,
          chave: `declaracao=${e.declaracao};cienteAlerta=${alerta.alerta && e.cienteAlerta ? 1 : 0}`,
        }),
        (g) =>
          g.abrirSala(l.id, l.versao, {
            provedor: this.provedor.tipo,
            sala,
            declaracao: e.declaracao,
            medico: s.login,
            vinculo: prof.vinculo,
            cienteAlerta: alerta.alerta && e.cienteAlerta,
          }),
      );
    }
    // 2. O atendimento como uma consulta, pelo executor do atendimento (cenário teleconsulta), com o vínculo da sessão.
    const entrada = {
      tipo: 'consulta' as const,
      paciente: l.paciente,
      convenio: m.convenio,
      profissional: prof.vinculo,
      especialidade: e.especialidade,
      unidade: e.unidade,
      centroCusto: e.centroCusto,
      procedimento: e.procedimento,
      carater: 'eletivo' as const,
      retorno: m.retorno,
      cidPrincipal: e.cidPrincipal,
      marcacao: l.marcacao,
      tipoGuia: 'H' as const,
      teleconsulta: { id: l.id },
    };
    const g = await this.apoio.executar(
      s,
      'atendimento.abrirAtendimento',
      entrada,
      'Teleconsulta iniciada: o atendimento foi aberto.',
    );
    const atendimentoId = Number(g.resultado['atendimento'] ?? g.resultado['id'] ?? g.resultado['reg']);
    // 3. A teleconsulta em andamento, ligada ao atendimento, e TELECONSULTA_INICIADA (só identificadores). Roda também
    // na repetição do passo 2: a vinculação é reentrante (já em andamento com o mesmo atendimento, não grava de novo).
    await this.vincular(s, l, atendimentoId, prof.vinculo);
    return {
      ok: true,
      teleconsulta: await this.detalhe(s, id),
      mensagem: 'Teleconsulta iniciada: o atendimento foi aberto e a sala está disponível para o paciente.',
    };
  }

  private vincular(
    s: SessaoCadastro,
    l: Teleconsulta,
    atendimento: number,
    vinculo: number,
  ): Promise<boolean> {
    return this.gravarSgh(
      s,
      E.teleconsultaIniciada.codigo,
      () => ({ tabela: TABELA, id: String(l.id), paciente: l.paciente, chave: `atendimento=${atendimento}` }),
      (x) => x.vincularAtendimento({ id: l.id, atendimento, profissional: vinculo }),
    );
  }

  /** A tentativa anterior abriu o atendimento mas não pôs a teleconsulta em andamento: conclui só o passo 3. */
  private async retomarInicio(s: SessaoCadastro, l: Teleconsulta): Promise<ResultadoTeleconsulta> {
    if (!s.pode('atendimento.teleconsulta.realizar'))
      return recusa('sem-permissao', 'Seu perfil não permite realizar teleconsulta.', 403);
    const prof = await this.atendimento.profissional(s.porta, s.login);
    if (!prof || !doMedicoDaSala(l, prof.vinculo))
      return recusa(
        'outro-medico',
        'A sala desta teleconsulta foi aberta por outro médico: só ele inicia o atendimento.',
        403,
      );
    await this.vincular(s, l, Number(l.atendimento), prof.vinculo);
    return {
      ok: true,
      teleconsulta: await this.detalhe(s, l.id),
      mensagem:
        'Teleconsulta iniciada: o atendimento já estava aberto e a teleconsulta passou a em andamento.',
    };
  }

  async encerrar(s: SessaoCadastro, id: number, e: EncerrarTeleconsulta): Promise<ResultadoTeleconsulta> {
    const c = s.porta;
    const l = await this.lida(c, id);
    if (l.modalidade !== 'teleconsulta') return recusa('nao-teleconsulta', 'Só a teleconsulta se encerra.');
    if (!s.pode('atendimento.teleconsulta.realizar'))
      return recusa('sem-permissao', 'Seu perfil não permite realizar teleconsulta.', 403);
    const d = podeEncerrarTeleconsulta(l, e.motivo);
    if (!d.pode) return recusa('situacao', d.motivo ?? 'A teleconsulta não pode ser encerrada.');
    const prof = await this.atendimento.profissional(c, s.login);
    const vinculo = prof?.vinculo ?? null;
    if ((l.situacao === 'sala-aberta' || l.situacao === 'em-andamento') && !doMedicoDaSala(l, vinculo))
      return recusa('outro-medico', 'Esta teleconsulta está com outro médico: só ele a encerra.', 403);
    await this.gravarSgh(
      s,
      E.teleconsultaEncerrada.codigo,
      () => ({ tabela: TABELA, id: String(l.id), paciente: l.paciente, chave: `motivo=${e.motivo}` }),
      (g) => g.encerrar(l.id, e.versao, { motivo: e.motivo, por: s.login, vinculo }),
    );
    return {
      ok: true,
      teleconsulta: await this.detalhe(s, id),
      mensagem:
        e.motivo === 'concluida'
          ? 'Teleconsulta encerrada. Registre a evolução e o desfecho do atendimento no prontuário.'
          : 'Teleconsulta encerrada.',
    };
  }

  /** As listas da abertura e do convite (do apoio do atendimento). */
  async apoioDaAbertura(s: SessaoCadastro): Promise<ApoioTelemedicina> {
    const a = await this.atendimento.apoio(s.porta);
    return {
      especialidades: a.especialidades,
      unidades: a.unidades,
      centrosCusto: a.centrosCusto,
      procedimentoPadrao: PROCEDIMENTO_PADRAO_TELECONSULTA,
      medicos: a.profissionais
        .filter((p) => p.ativo && p.crm > 0 && p.cbo.startsWith('225'))
        .map((p) => ({ vinculo: p.id, nome: p.nome, crm: p.crm }))
        .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR')),
    };
  }

  cid(s: SessaoCadastro, termo: string) {
    return this.atendimento.cid(s.porta, termo);
  }

  /** Os atendimentos abertos do dia (o pedido da teleinterconsulta parte de um deles), com a busca por nome. */
  async atendimentosAbertos(s: SessaoCadastro, termo: string): Promise<AtendimentoResumo[]> {
    const r = await this.relogio(s.porta);
    const d = await this.atendimento.atendimentosDoDia(s.porta, {
      data: r.hoje,
      ...(termo.trim().length >= 2 ? { termo: termo.trim() } : {}),
    });
    return d.itens.filter((x) => x.desfecho === null && !x.requisicao).slice(0, 50);
  }

  // ── Teleinterconsulta ────────────────────────────────────────────────────────────────────────────────────────────

  async solicitarInterconsulta(
    s: SessaoCadastro,
    e: SolicitarTeleinterconsulta,
  ): Promise<ResultadoTeleconsulta> {
    const c = s.porta;
    const [prof, lib, ficha, apoio, r] = await Promise.all([
      this.atendimento.profissional(c, s.login),
      this.apoio.liberacao(s),
      this.atendimento.detalhe(c, e.atendimento),
      this.atendimento.apoio(c),
      this.relogio(c),
    ]);
    if (!ficha || ficha.paciente.id === null)
      return recusa('nao-encontrado', 'Atendimento não encontrado.', 404);
    const p = apoio.profissionais.find((x) => x.id === e.convidado) ?? null;
    const d = podeSolicitarTeleinterconsulta({
      ligada: lib.ligada,
      podeRealizar: s.pode('atendimento.teleconsulta.realizar'),
      solicitante: prof ? { vinculo: prof.vinculo, conselhoAtivo: prof.conselhoAtivo } : null,
      convidado: p ? { vinculo: p.id, ativo: p.ativo && p.crm > 0, medico: p.cbo.startsWith('225') } : null,
      atendimentoAberto: ficha.desfecho === null,
    });
    if (!d.pode || !prof || !p) return recusa('nao-pode-solicitar', d.motivo ?? 'Pedido recusado.');
    const paciente = ficha.paciente.id;
    const novo = await this.gravarSgh(
      s,
      E.teleinterconsultaSolicitada.codigo,
      (x: { id: number }) => ({
        tabela: TABELA,
        id: String(x.id),
        paciente,
        chave: `convidado=${p.id}`,
      }),
      (g) =>
        g.solicitarInterconsulta({
          atendimento: e.atendimento,
          paciente,
          data: r.hoje,
          hora: r.hhmm,
          convidado: p.id,
          nomeConvidado: p.nome,
          motivo: e.motivo,
          solicitante: s.login,
          vinculoSolicitante: prof.vinculo,
        }),
    );
    return {
      ok: true,
      teleconsulta: await this.detalhe(s, novo.id),
      mensagem: `Teleinterconsulta pedida a ${p.nome}: aparece na tela de telemedicina do convidado.`,
    };
  }

  private async interconsultaDoConvidado(s: SessaoCadastro, id: number) {
    const c = s.porta;
    const l = await this.lida(c, id);
    if (l.modalidade !== 'teleinterconsulta') return recusa('nao-interconsulta', 'Não é teleinterconsulta.');
    const [prof, lib] = await Promise.all([
      this.atendimento.profissional(c, s.login),
      this.apoio.liberacao(s),
    ]);
    const d = podeResponderTeleinterconsulta(
      { situacao: l.situacao, convidado: l.convidado ?? 0 },
      {
        ligada: lib.ligada,
        podeRealizar: s.pode('atendimento.teleconsulta.realizar'),
        vinculo: prof?.vinculo ?? null,
        conselhoAtivo: prof?.conselhoAtivo === true,
      },
    );
    if (!d.pode || !prof) return recusa('nao-pode-responder', d.motivo ?? 'Pedido recusado.');
    return { l, prof };
  }

  async abrirSalaInterconsulta(
    s: SessaoCadastro,
    id: number,
    versao: number,
  ): Promise<ResultadoTeleconsulta> {
    const { l } = await this.interconsultaDoConvidado(s, id);
    if (l.situacao !== 'solicitada')
      return recusa('situacao', 'A sala desta teleinterconsulta já está aberta.');
    this.exigirProvedor();
    const { sala } = await this.provedor.criarSala(`inter-${s.hospital}-${l.id}`);
    await this.gravarSgh(
      s,
      E.teleconsultaSalaAberta.codigo,
      () => ({ tabela: TABELA, id: String(l.id), paciente: l.paciente, chave: 'teleinterconsulta' }),
      (g) => g.abrirSalaInterconsulta(l.id, versao, { provedor: this.provedor.tipo, sala, por: s.login }),
    );
    return {
      ok: true,
      teleconsulta: await this.detalhe(s, id),
      mensagem: 'Sala da teleinterconsulta aberta.',
    };
  }

  async responderInterconsulta(
    s: SessaoCadastro,
    id: number,
    e: ResponderTeleinterconsulta,
  ): Promise<ResultadoTeleconsulta> {
    const { l, prof } = await this.interconsultaDoConvidado(s, id);
    await this.gravarSgh(
      s,
      E.teleinterconsultaRespondida.codigo,
      () => ({ tabela: TABELA, id: String(l.id), paciente: l.paciente }),
      (g) =>
        g.responderInterconsulta(l.id, e.versao, { parecer: e.parecer, vinculo: prof.vinculo, por: s.login }),
    );
    return {
      ok: true,
      teleconsulta: await this.detalhe(s, id),
      mensagem: 'Parecer registrado: quem pediu vê na tela de telemedicina.',
    };
  }

  async cancelarInterconsulta(
    s: SessaoCadastro,
    id: number,
    e: CancelarTeleinterconsulta,
  ): Promise<ResultadoTeleconsulta> {
    const c = s.porta;
    const l = await this.lida(c, id);
    if (l.modalidade !== 'teleinterconsulta') return recusa('nao-interconsulta', 'Não é teleinterconsulta.');
    const lib = await this.apoio.liberacao(s);
    const d = podeCancelarTeleinterconsulta(
      { situacao: l.situacao, solicitante: l.criadoPor },
      { ligada: lib.ligada, login: s.login },
    );
    if (!d.pode) return recusa('nao-pode-cancelar', d.motivo ?? 'Pedido recusado.');
    await this.gravarSgh(
      s,
      E.teleinterconsultaCancelada.codigo,
      () => ({ tabela: TABELA, id: String(l.id), paciente: l.paciente }),
      (g) => g.cancelarInterconsulta(l.id, e.versao, { motivo: e.motivo, por: s.login }),
    );
    return { ok: true, teleconsulta: await this.detalhe(s, id), mensagem: 'Teleinterconsulta cancelada.' };
  }

  // ── Portal ───────────────────────────────────────────────────────────────────────────────────────────────────────

  async ligada(hospital: string): Promise<boolean> {
    if (this.porta.destino === 'memoria' && !this.configuracao) return true;
    const rede = this.portal?.rede ?? '';
    return ligadaNoEstabelecimento(
      this.configuracao,
      rede,
      hospital,
      CHAVE_TELEMEDICINA,
      USUARIO_PORTAL,
      this.agora(),
    );
  }

  /** A linha da trilha de uma gravação do portal (só ids e códigos; o estabelecimento vem do código da sessão). */
  private linhaPortal(
    n: PortalNoPedido,
    d: { evento: string; operacao: string; id: number | null; paciente: number; chave?: string | null },
  ): TrilhaDaGravacao {
    return {
      estabelecimento: contextoDoEstabelecimento(n.c.hospital).estabelecimento,
      usuario: null,
      acao: 'operacao',
      entidade: TABELA,
      entidadeId: d.id,
      dadosDepois: {
        evento: d.evento,
        operacao: d.operacao,
        recurso: CHAVE_TELEMEDICINA,
        chave: d.chave ?? null,
        paciente: d.paciente,
        quem: quemDaConta(n.conta.id),
        canal: 'portal',
      },
      motivo: null,
      correlacao: `portal-tele-${randomBytes(6).toString('hex')}`,
    };
  }

  private async gravarPortal<T>(
    n: PortalNoPedido,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao | null) | null,
    fn: (g: GravadorTelemedicina) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.porta.gravar(n.c, trilha, fn);
    } catch (e) {
      return traduzir(e);
    }
  }

  private titular(n: PortalNoPedido) {
    if (!this.portal) return recusa('indisponivel', 'O portal não está configurado.', 503);
    return this.portal.titularComEscopo(n, 'agendamentos');
  }

  private paraPortal(
    l: Teleconsulta,
    r: { hoje: string; hhmm: string },
    ligada: boolean,
  ): TeleconsultaDoPortal {
    const j = janelaSalaEspera(l, r);
    const entra = podeEntrarSalaEspera(l, r, ligada);
    const naSala = l.situacao === 'sala-aberta' || l.situacao === 'em-andamento';
    return {
      id: l.id,
      situacao: l.situacao,
      data: l.data,
      hora: l.hora,
      agenda: l.nomeAgenda,
      termo: l.termo ? { versao: l.termo.versao, aceitoEm: l.termo.aceitoEm } : null,
      local: local(l),
      salaEspera: { aberta: entra.pode, abreEm: j.abreEm, fechaEm: j.fechaEm, motivo: entra.motivo },
      sala: naSala && l.termo ? salaParaQuemVe(this.provedor, l, 'paciente') : null,
      podeEntrar: entra.pode,
    };
  }

  private async relogioPortal(n: PortalNoPedido) {
    return this.relogio(n.c);
  }

  async listaPortal(n: PortalNoPedido): Promise<ListaTeleconsultasPortal> {
    const t = this.titular(n);
    const [linhas, r, ligada] = await Promise.all([
      this.porta.doPaciente(n.c, t.paciente),
      this.relogioPortal(n),
      this.ligada(n.c.hospital),
    ]);
    const desde = diasAntes(r.hoje, 30);
    return {
      itens: linhas
        .map(vigente)
        .filter((l) => teleconsultaAberta(l.situacao) || l.data >= desde)
        .filter((l) => l.situacao !== 'cancelada' || l.data >= r.hoje)
        .map((l) => this.paraPortal(l, r, ligada)),
      ligada,
      termo: { versao: VERSAO_TERMO_TELECONSULTA, texto: TEXTO_TERMO_TELECONSULTA },
    };
  }

  private async doTitular(n: PortalNoPedido, id: number) {
    const t = this.titular(n);
    const lida = await this.porta.porId(n.c, id);
    if (!lida || lida.modalidade !== 'teleconsulta' || lida.paciente !== t.paciente)
      return recusa('nao-encontrado', 'A teleconsulta não está disponível para este acesso.', 404);
    return { t, l: vigente(lida) };
  }

  async detalhePortal(n: PortalNoPedido, id: number): Promise<TeleconsultaDoPortal> {
    const { l } = await this.doTitular(n, id);
    return this.paraPortal(l, await this.relogioPortal(n), await this.ligada(n.c.hospital));
  }

  async entrarSalaEspera(n: PortalNoPedido, id: number, e: EntrarSalaEspera): Promise<TeleconsultaDoPortal> {
    const { t, l } = await this.doTitular(n, id);
    const [r, ligada] = await Promise.all([this.relogioPortal(n), this.ligada(n.c.hospital)]);
    const d = podeEntrarSalaEspera(l, r, ligada);
    if (!d.pode)
      return recusa(
        ligada ? 'sala-fechada' : 'recurso-desligado',
        d.motivo ?? 'Sala fechada.',
        ligada ? 409 : 403,
      );
    if (l.situacao === 'em-andamento')
      return recusa('situacao', 'A teleconsulta já começou: entre na sala do médico.');
    await this.gravarPortal(
      n,
      this.linhaPortal(n, {
        evento: E.teleconsultaSalaEspera.codigo,
        operacao: 'portal.entrarSalaEspera',
        id: l.id,
        paciente: t.paciente,
        chave: `termo=${e.termo}`,
      }),
      (g) =>
        g.entrarSalaEspera(l.id, l.versao, {
          termo: e.termo,
          local: { uf: e.local.uf, municipio: e.local.municipio, tipo: e.local.tipo },
          por: quemDaConta(n.conta.id),
        }),
    );
    return this.detalhePortal(n, id);
  }

  /** O paciente entra na sala do médico (só depois que o médico abriu; a primeira entrada vai à trilha). */
  async entrarNaSala(n: PortalNoPedido, id: number): Promise<TeleconsultaDoPortal> {
    const { t, l } = await this.doTitular(n, id);
    if (!(await this.ligada(n.c.hospital)))
      return recusa('recurso-desligado', 'A teleconsulta ainda não foi liberada neste estabelecimento.', 403);
    if (!(l.situacao === 'sala-aberta' || l.situacao === 'em-andamento') || !l.termo)
      return recusa('sala-fechada', 'O médico ainda não abriu a sala. Aguarde na sala de espera.');
    await this.gravarPortal(
      n,
      (primeira: boolean) =>
        primeira
          ? this.linhaPortal(n, {
              evento: E.teleconsultaPacienteEntrou.codigo,
              operacao: 'portal.entrarSalaEspera',
              id: l.id,
              paciente: t.paciente,
            })
          : null,
      (g) => g.registrarEntradaPaciente(l.id),
    );
    return this.detalhePortal(n, id);
  }

  // ── Gancho da agenda online do portal ─────────────────────────────────────────────────────────────────────────

  /** A linha de trilha avulsa do gancho: se falhar, vai ao log (a marcação já está gravada e auditada). */
  private async trilhaDoGancho(n: PortalNoPedido, linha: TrilhaDaGravacao, evento: string): Promise<void> {
    try {
      await this.porta.gravar(n.c, linha, async () => null);
    } catch (e) {
      this.log.warn(
        `Trilha da teleconsulta (${evento}) não gravada: ${e instanceof Error ? e.name : 'erro'}`,
      );
    }
  }

  /** A marcação de teleconsulta pelo portal cria a teleconsulta (uma viva por marcação; a repetição só vai à trilha). */
  async aoMarcar(
    n: PortalNoPedido,
    paciente: number,
    m: { marcacao: number; agenda: number; nomeAgenda: string; crm: number; data: string; hora: string },
  ): Promise<void> {
    const linha = (id: number | null) =>
      this.linhaPortal(n, {
        evento: E.teleconsultaAgendada.codigo,
        operacao: 'atendimento.agendarTeleconsulta',
        id,
        paciente,
        chave: `marcacao=${m.marcacao}`,
      });
    const ja = await this.porta.daMarcacao(n.c, m.marcacao);
    if (ja) return this.trilhaDoGancho(n, linha(ja.id), E.teleconsultaAgendada.codigo);
    await this.gravarPortal(
      n,
      (x: { id: number }) => linha(x.id),
      (g) =>
        g.agendar({
          marcacao: m.marcacao,
          agenda: m.agenda,
          nomeAgenda: m.nomeAgenda,
          profissional: null,
          data: m.data,
          hora: m.hora,
          paciente,
          por: quemDaConta(n.conta.id),
        }),
    );
  }

  /** `havia`: a marcação tinha teleconsulta viva antes do cancelamento (a trilha só quando alguma foi cancelada). */
  async aoCancelar(n: PortalNoPedido, paciente: number, marcacao: number, havia = true): Promise<void> {
    void havia;
    const linha = this.linhaPortal(n, {
      evento: E.teleconsultaCancelada.codigo,
      operacao: 'atendimento.agendarTeleconsulta',
      id: null,
      paciente,
      chave: `marcacao=${marcacao}`,
    });
    await this.gravarPortal(
      n,
      (qtd: number) => (qtd > 0 ? linha : null),
      (g) => g.cancelarDaMarcacao(marcacao, quemDaConta(n.conta.id)),
    );
  }

  async aoRemarcar(
    n: PortalNoPedido,
    paciente: number,
    de: number,
    para: { marcacao: number; agenda: number; nomeAgenda: string; crm: number; data: string; hora: string },
  ): Promise<void> {
    const linha = this.linhaPortal(n, {
      evento: E.teleconsultaAgendada.codigo,
      operacao: 'atendimento.agendarTeleconsulta',
      id: null,
      paciente,
      chave: `marcacao=${para.marcacao};de=${de}`,
    });
    const qtd = await this.gravarPortal(
      n,
      (q: number) => (q > 0 ? linha : null),
      (g) =>
        g.mover({
          de,
          para: para.marcacao,
          agenda: para.agenda,
          nomeAgenda: para.nomeAgenda,
          data: para.data,
          hora: para.hora,
          por: quemDaConta(n.conta.id),
        }),
    );
    if (qtd !== 1) this.log.warn(`Teleconsulta da marcação ${de} não acompanhou a remarcação (${qtd}).`);
  }

  async daMarcacao(n: PortalNoPedido, marcacao: number): Promise<Teleconsulta | null> {
    const l = await this.porta.daMarcacao(n.c, marcacao);
    return l && vigente(l).situacao !== 'cancelada' ? l : null;
  }

  async doPaciente(n: PortalNoPedido, paciente: number) {
    const m = new Map<number, { id: number; situacao: SituacaoTeleconsulta }>();
    for (const l of (await this.porta.doPaciente(n.c, paciente)).map(vigente))
      if (l.marcacao !== null && l.situacao !== 'cancelada' && !m.has(l.marcacao))
        m.set(l.marcacao, { id: l.id, situacao: l.situacao });
    return m;
  }

  // ── Documentos do PEP (a marca da telemedicina) ──────────────────────────────────────────────────────────────────

  /** O atendimento foi teleconsulta? A receita e o atestado levam a marca da modalidade. */
  async atendimentoEmTeleconsulta(c: ContextoTelemedicina, atendimento: number): Promise<boolean> {
    return (await this.porta.doAtendimento(c, atendimento)) !== null;
  }
}
