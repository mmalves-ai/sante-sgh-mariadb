// Quebra de vidro (M06, regra 8; cap-08 §8.5): só perfil assistencial com conselho (acesso.emergencia.
// solicitar); aviso na tela, motivo de lista, justificativa, REAUTENTICAÇÃO (a senha vai junto e é conferida
// no legado), prazo configurável (ACESSO_EMERGENCIA_MINUTOS), registro em SGH_ACESSO_EMERGENCIA e na
// SGH_TRILHA na mesma transação, e alerta ao Auditor pela fila `email`: com o núcleo real, o alerta vai à
// SGH_OUTBOX na MESMA transação (o relay do worker publica; fila fora não perde o alerta); com a fonte
// sintética (dev/ci), direto à fila. O paciente é conferido em RICADPAC (ID inexistente: 404). A revisão é
// obrigatória (tela do M10). Em dev/ci com a fonte sintética, o registro é em memória (nada grava na cópia).
// A rota de demonstração (só AMBIENTE=dev) abre o "prontuário" de um paciente SINTÉTICO de recurso novo
// (vínculo sempre exigido), para provar a decisão em passos e o diálogo no E2E até o PEP (M15).
import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import {
  EVENTOS_AUDITAVEIS,
  type EmergenciaAberta,
  esquemaPedidoEmergencia,
  PERMISSOES_ACESSO,
} from '@sgh/contratos';
import {
  decidir,
  emergenciaVigente,
  exigeVinculo,
  fimDaEmergencia,
  prazoEmergencia,
  recusaDaEmergencia,
  type VinculoAssistencialPort,
} from '@sgh/dominio-acesso';
import { ErroPacienteInexistente, type LinhaTrilha } from '@sgh/legado';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/auditoria.interceptor.js';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CABECALHO_CSRF, COOKIE_CSRF, lerCookie } from '../../sessao/cookies.js';
import { ErroSessao, type ServicoSessao } from '../../sessao/servico-sessao.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from './alerta.js';
import { SERVICO_SESSAO } from './acesso.controller.js';

export const REGISTRO_EMERGENCIA = Symbol('REGISTRO_EMERGENCIA');
export const VINCULO_ASSISTENCIAL = Symbol('VINCULO_ASSISTENCIAL');

export interface AberturaRegistrada {
  readonly id: string;
  readonly inicio: Date;
  readonly fim: Date;
  /** O alerta ao Auditor já está na SGH_OUTBOX da mesma transação (núcleo real). */
  readonly alertaNaOutbox?: boolean;
}

/** Onde a abertura fica: SGH_ACESSO_EMERGENCIA + SGH_TRILHA (núcleo) ou memória (fonte sintética). */
export interface RegistroEmergencia {
  abrir(a: {
    rede: string;
    hospital: string;
    idUsuario: number;
    login: string;
    idPaciente: number;
    atendimento: number | null;
    motivo: string;
    justificativa: string;
    minutos: number;
    estacao: string;
    correlacao: string;
  }): Promise<AberturaRegistrada>;
  vigente(hospital: string, login: string, idPaciente: number): Promise<{ id: string; fim: Date } | null>;
}

/** Registro em memória (dev/ci sintético); a trilha vai ao registrador (memória). */
export class RegistroEmergenciaMemoria implements RegistroEmergencia {
  private n = 0;
  readonly aberturas: {
    id: string;
    hospital: string;
    login: string;
    idPaciente: number;
    fim: Date;
    inicio?: Date;
    motivo?: string;
  }[] = [];
  constructor(private readonly trilha: RegistradorTrilha) {}
  async abrir(a: Parameters<RegistroEmergencia['abrir']>[0]): Promise<AberturaRegistrada> {
    // Só o paciente sintético da demonstração existe na fonte sintética (como RICADPAC no núcleo real).
    if (a.idPaciente !== PACIENTE_DEMONSTRACAO.id) throw new ErroPacienteInexistente();
    const inicio = new Date();
    const fim = fimDaEmergencia(inicio, a.minutos);
    // Número da abertura em memória: crescente entre reinícios (o alerta e o Mailpit não confundem aberturas).
    const id = String(Date.now() * 10 + (++this.n % 10));
    await this.trilha.registrar({
      evento: EVENTOS_AUDITAVEIS.emergenciaAberta.codigo,
      rede: a.rede,
      hospital: a.hospital,
      usuario: a.login,
      estacao: a.estacao,
      correlacao: a.correlacao,
      recurso: 'acesso.emergencia',
      resultado: 'sucesso',
      paciente: a.idPaciente,
      tabelaAlvo: 'SGH_ACESSO_EMERGENCIA',
      idAlvo: id,
    });
    this.aberturas.push({
      id,
      hospital: a.hospital,
      login: a.login,
      idPaciente: a.idPaciente,
      fim,
      inicio,
      motivo: a.motivo,
    });
    return { id, inicio, fim };
  }
  vigente(hospital: string, login: string, idPaciente: number) {
    const agora = new Date();
    const a = [...this.aberturas]
      .reverse()
      .find(
        (x) =>
          x.hospital === hospital &&
          x.login === login &&
          x.idPaciente === idPaciente &&
          emergenciaVigente(x.fim, agora),
      );
    return Promise.resolve(a ? { id: a.id, fim: a.fim } : null);
  }
}

/** Paciente SINTÉTICO da demonstração (nenhum dado real; recurso novo: vínculo sempre exigido). */
export const PACIENTE_DEMONSTRACAO = { id: 999_000_001, nome: 'Paciente Fictício Um', prontuario: '000001' };

@Controller('acesso')
export class EmergenciaController {
  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: Configuracao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Inject(REGISTRO_EMERGENCIA) private readonly registro: RegistroEmergencia,
    @Inject(ALERTA_AUDITOR) private readonly alerta: AlertaAuditor,
    @Inject(VINCULO_ASSISTENCIAL) private readonly vinculo: VinculoAssistencialPort,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
  ) {}

  /** Reautenticação: sessão real, CSRF e a senha conferida de novo no legado (SBIS-07). */
  private async reautenticar(req: RequisicaoAutorizada, senha: string): Promise<number> {
    const id = this.resolvedor.idSessao(req);
    if (!this.servico || !id || !req.sgh?.real)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF);
    const bruto = req.headers[CABECALHO_CSRF];
    const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
    const rede = this.resolvedor.rede(req);
    const csrf =
      !!doCookie &&
      doCookie === doCabecalho &&
      (await this.servico.csrfConfere(id, rede, doCabecalho).catch(() => false));
    if (!csrf) throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
    try {
      await this.servico.reautenticar(id, rede, senha);
    } catch (e) {
      if (e instanceof ErroSessao && e.tipo === 'muitas-tentativas')
        throw new ErroProblema('muitas-tentativas', 429, 'Muitas tentativas');
      throw new ErroProblema('reautenticacao-necessaria', 401, 'Confirme a senha', 'Senha não conferida.');
    }
    return Date.now();
  }

  @Post('emergencias')
  @AuditadoNoHandler(
    'SGH_ACESSO_EMERGENCIA, SGH_TRILHA e SGH_OUTBOX na mesma transação (registrarEmergencia)',
  )
  @HttpCode(201)
  @Permissao(PERMISSOES_ACESSO.emergenciaSolicitar)
  async abrir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<EmergenciaAberta> {
    const a = req.sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const r = esquemaPedidoEmergencia.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escolha o motivo e escreva a justificativa (de 15 a 500 caracteres).',
      );
    const reautenticadoEm = await this.reautenticar(req, r.data.senha);
    const recusa = recusaDaEmergencia({
      permissoes: new Set(a.sessao.permissoes),
      temConselho: a.sessao.perfil?.complementares.includes('assistencial-com-conselho') ?? false,
      motivo: r.data.motivo,
      justificativa: r.data.justificativa,
      reautenticadoEm,
      agora: Date.now(),
    });
    if (recusa)
      throw new ErroProblema('sem-permissao', 403, 'Quebra de vidro não permitida', `Motivo: ${recusa}.`);
    const login = a.sessao.usuario.login ?? a.sessao.usuario.id;
    const hospital = a.sessao.estabelecimentoAtivo ?? '';
    const rede = a.sessao.rede ?? '';
    let aberta: AberturaRegistrada;
    try {
      aberta = await this.registro.abrir({
        rede,
        hospital,
        idUsuario: Number(a.sessao.usuario.id),
        login,
        idPaciente: r.data.idPaciente,
        atendimento: r.data.atendimento ?? null,
        motivo: r.data.motivo,
        justificativa: r.data.justificativa,
        minutos: prazoEmergencia(Number(process.env['ACESSO_EMERGENCIA_MINUTOS'] ?? '')),
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'emergencia'),
      });
    } catch (e) {
      if (e instanceof ErroPacienteInexistente)
        throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
      throw new ErroProblema(
        'trilha-indisponivel',
        503,
        'Trilha de auditoria indisponível',
        'O acesso de emergência não foi aberto porque não pôde ser registrado.',
      );
    }
    let alerta: 'enfileirado' | 'sem-fila' = 'enfileirado';
    if (!aberta.alertaNaOutbox)
      try {
        alerta = await this.alerta.emergenciaAberta({
          rede,
          hospital,
          idEmergencia: aberta.id,
          idUsuario: a.sessao.usuario.id,
          motivo: r.data.motivo,
          inicio: aberta.inicio.toISOString(),
          fim: aberta.fim.toISOString(),
        });
      } catch {
        alerta = 'sem-fila';
      }
    return { id: aberta.id, inicio: aberta.inicio.toISOString(), fim: aberta.fim.toISOString(), alerta };
  }

  /** Demonstração (só dev): decisão em passos sobre o paciente sintético de recurso novo. */
  @Get('emergencias/demonstracao/pacientes/:id')
  @Permissao(PERMISSOES_ACESSO.inicioLer)
  async demonstracao(@Param('id') idTexto: string, @Req() req: RequisicaoAutorizada) {
    if (this.cfg.ambiente !== 'dev') throw new NotFoundException();
    const a = req.sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const id = Number(idTexto);
    if (id !== PACIENTE_DEMONSTRACAO.id)
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    const login = a.sessao.usuario.login ?? a.sessao.usuario.id;
    const hospital = a.sessao.estabelecimentoAtivo ?? '';
    const vigente = await this.registro.vigente(hospital, login, id);
    const d = decidir({
      autenticado: true,
      ability: a.ability,
      permissao: PERMISSOES_ACESSO.inicioLer,
      exigeVinculo: exigeVinculo(true, a.sessao.restricaoVinculo ?? false),
      temVinculo: (await this.vinculo.vinculo(login, { idPaciente: id })) !== null,
      emergenciaVigente: vigente !== null,
      podeQuebrarVidro: a.sessao.permissoes.includes(PERMISSOES_ACESSO.emergenciaSolicitar),
    });
    if (d.desfecho !== 'permite')
      throw new ErroProblema('sem-vinculo', 403, 'Sem vínculo assistencial com o paciente', d.motivo, {
        quebraDeVidro: d.desfecho === 'quebra-de-vidro',
      });
    // Leitura auditada: sem trilha, sem dado.
    try {
      await this.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.consultaRes.codigo,
        rede: a.sessao.rede ?? '',
        hospital,
        usuario: login,
        estacao: estacaoDaRequisicao(req),
        correlacao: 'demonstracao',
        recurso: 'pep.prontuario',
        resultado: 'sucesso',
        tabelaAlvo: 'SGH_DEMONSTRACAO',
        idAlvo: String(id),
      });
    } catch {
      throw new ErroProblema('trilha-indisponivel', 503, 'Trilha de auditoria indisponível');
    }
    return {
      paciente: PACIENTE_DEMONSTRACAO,
      porEmergencia: d.porEmergencia,
      ate: vigente?.fim.toISOString() ?? null,
    };
  }
}

export interface NucleoEmergencia {
  registrarEmergencia(
    ctx: { rede: string; hospital: string; traceId: string },
    abertura: {
      rede: string;
      hospital: string;
      idUsuario: number;
      login: string;
      idPaciente: number;
      atendimento: number | null;
      motivo: string;
      justificativa: string;
      minutos: number;
    },
    linha: Omit<LinhaTrilha, 'idAlvo' | 'tabelaAlvo'>,
  ): Promise<{ id: string; inicio: Date; fim: Date; trilha: string }>;
  emergenciaVigente(
    codigo: string,
    login: string,
    idPaciente: number,
  ): Promise<{ id: string; fim: Date } | null>;
}

/** Registro no banco do estabelecimento: SGH_ACESSO_EMERGENCIA e SGH_TRILHA na mesma transação. */
export class RegistroEmergenciaLegado implements RegistroEmergencia {
  constructor(private readonly nucleo: NucleoEmergencia) {}
  async abrir(a: Parameters<RegistroEmergencia['abrir']>[0]): Promise<AberturaRegistrada> {
    const r = await this.nucleo.registrarEmergencia(
      { rede: a.rede, hospital: a.hospital, traceId: a.correlacao },
      {
        rede: a.rede,
        hospital: a.hospital,
        idUsuario: a.idUsuario,
        login: a.login,
        idPaciente: a.idPaciente,
        atendimento: a.atendimento,
        motivo: a.motivo,
        justificativa: a.justificativa,
        minutos: a.minutos,
      },
      {
        rede: a.rede,
        hospital: a.hospital,
        usuario: a.login,
        evento: EVENTOS_AUDITAVEIS.emergenciaAberta.codigo,
        recurso: 'acesso.emergencia',
        operacao: 'acesso.abrirEmergencia',
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: a.estacao.slice(0, 80),
        correlacao: a.correlacao,
        origem: a.estacao,
        idPaciente: a.idPaciente,
        atendimento: a.atendimento,
      },
    );
    return { id: r.id, inicio: r.inicio, fim: r.fim, alertaNaOutbox: true };
  }
  vigente(hospital: string, login: string, idPaciente: number) {
    return this.nucleo.emergenciaVigente(hospital, login, idPaciente);
  }
}
