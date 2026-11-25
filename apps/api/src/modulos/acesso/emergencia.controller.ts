// Quebra de vidro (M06, regra 8; cap-08 §8.5): só perfil assistencial com conselho (acesso.emergencia.
// solicitar); aviso na tela, motivo de lista, justificativa, REAUTENTICAÇÃO (a senha vai junto e é conferida
// na sessão), prazo configurável (ACESSO_EMERGENCIA_MINUTOS), registro em acesso_emergencial com a trilha na
// mesma transação (Executor do @sgh/nucleo), e alerta ao Auditor pela fila `email`: com o banco do cliente, o
// alerta vai ao outbox (integracao_mensagem) na MESMA transação (o relay do worker publica; fila fora não perde o
// alerta); com a fonte sintética (dev/ci), direto à fila. O paciente é conferido no cadastro (id inexistente: 404).
// A revisão é obrigatória (tela do M10). Em dev/ci com a fonte sintética, o registro é em memória.
// Melhoria: o motivo é o do domínio do cliente (motivo_acesso_emergencial) e o registro guarda o IP de quem abriu e a
// estação de trabalho cadastrada com esse IP; a trilha sai com o código auditável da quebra de vidro.
// Melhoria: a recusa de negócio da abertura (motivo inexistente, sessão sem conta) responde como recusa, não como 503.
// A rota de demonstração (só AMBIENTE=dev) abre o "prontuário" de um paciente SINTÉTICO de recurso novo
// (vínculo sempre exigido), para provar a decisão em passos e o diálogo no E2E até o PEP (M15).
import { emitirAvisoClinicoNaTx, TABELAS_EMISSAO_AVISO_CLINICO } from '../pep/aviso-clinico-emissao.js';
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
import { definirOperacao, ErroOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';
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

/** O paciente pedido não existe no cadastro (a rota responde 404). */
export class ErroPacienteInexistente extends Error {
  override readonly name = 'ErroPacienteInexistente';
}
export const VINCULO_ASSISTENCIAL = Symbol('VINCULO_ASSISTENCIAL');

export interface AberturaRegistrada {
  readonly id: string;
  readonly inicio: Date;
  readonly fim: Date;
  /** O alerta ao Auditor já está no outbox da mesma transação (banco do cliente). */
  readonly alertaNaOutbox?: boolean;
}

/** Onde a abertura fica: acesso_emergencial com a trilha (banco do cliente) ou memória (fonte sintética). */
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
    /** IP de quem abriu (null numa sessão "como": o hospital não vê o IP do suporte). */
    enderecoIp?: string | null;
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
    // Só o paciente sintético da demonstração existe na fonte sintética.
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
      tabelaAlvo: 'acesso_emergencial',
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

  /** Reautenticação: sessão real, CSRF e a senha conferida de novo (SBIS-07). */
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
  @AuditadoNoHandler('acesso_emergencial, trilha e outbox na mesma transação (Executor do núcleo)')
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
    // Decisão do dono (b): o administrador da plataforma não é usuário do cliente (não tem usuario.id numérico); a quebra
    // de vidro grava o idUsuario e é pessoal: recusada a esse ator.
    if (a.sessao.usuario.ator === 'plataforma')
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Quebra de vidro não permitida',
        'A quebra de vidro é de um usuário do cliente; o administrador da plataforma não a abre.',
      );
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
        enderecoIp: req.sghComo ? null : (req.ip ?? '').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || null,
        correlacao: correlacaoDaRequisicao(req, 'emergencia'),
      });
    } catch (e) {
      if (e instanceof ErroPacienteInexistente)
        throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
      // Recusa de negócio (motivo inexistente, sessão sem conta, entrada): a resposta é a recusa, não a trilha fora.
      if (e instanceof ErroOperacao && e.problema.status >= 400 && e.problema.status < 500) {
        const p = e.problema;
        const tipo =
          p.status === 404
            ? 'nao-encontrado'
            : p.status === 400
              ? 'entrada-invalida'
              : p.status === 403
                ? 'sem-permissao'
                : 'recusa-de-negocio';
        throw new ErroProblema(tipo, p.status, p.title, p.detail, {
          ...(p.codigo ? { codigo: p.codigo } : {}),
        });
      }
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
        tabelaAlvo: 'demonstracao',
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

/** O que o registro usa do NucleoProprio (os testes trocam). */
export interface NucleoEmergencia {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/**
 * Ponto do outbox do alerta ao Auditor (o formato de ponto do núcleo não aceita hífen). A carga já é a do job
 * 'alerta-emergencia' que o EmailService do worker confere; o relay migrado mapeia este ponto para esse job (pedido
 * do lote 01-04 na saída).
 */
export const PONTO_ALERTA_EMERGENCIA = 'acesso.emergencia.aberta';
/**
 * O relay já entrega este ponto à fila de e-mail? Enquanto for false, a abertura devolve alertaNaOutbox: false e o
 * controlador enfileira o alerta direto (o Auditor nunca fica sem aviso). Vira true junto com o mapeamento no relay.
 */
export const RELAY_ENTREGA_ALERTA_EMERGENCIA = false;

const ABRIR_EMERGENCIA = definirOperacao({
  // O nome da operação é o código auditável da quebra de vidro: é o que o histórico de acessos ao prontuário procura.
  nome: EVENTOS_AUDITAVEIS.emergenciaAberta.codigo,
  tabelas: ['acesso_emergencial', ...TABELAS_EMISSAO_AVISO_CLINICO],
  entrada: z
    .object({
      rede: z.string().max(64),
      hospital: z.string().min(1).max(64),
      paciente: z.number().int().positive(),
      atendimento: z.number().int().positive().nullable(),
      motivo: z.string().min(1).max(30),
      justificativa: z.string().min(1).max(2000),
      inicio: z.date(),
      fim: z.date(),
      enderecoIp: z.string().max(45).nullable(),
    })
    .strict(),
  gravar: async (tx, e, ctx) => {
    const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
    if (!p) throw recusa('paciente-inexistente', 'O paciente não existe no cadastro.');
    const m = await tx.uma('SELECT id FROM motivo_acesso_emergencial WHERE codigo = ? AND ativo', [e.motivo]);
    if (!m) throw recusa('motivo-inexistente', 'O motivo do acesso de emergência não está cadastrado.');
    // Estação de trabalho cadastrada com o IP de quem abriu, no estabelecimento da sessão (null quando não há).
    const estacao = e.enderecoIp
      ? await tx.uma(
          `SELECT id FROM estacao_trabalho WHERE estabelecimento_id = ? AND endereco_ip = ? AND ativo AND excluido_em IS NULL
           ORDER BY id LIMIT 1`,
          [ctx.estabelecimento, e.enderecoIp],
        )
      : null;
    const id = await tx.incluir('acesso_emergencial', {
      estabelecimento_id: ctx.estabelecimento,
      usuario_id: ctx.usuario,
      paciente_id: e.paciente,
      atendimento_id: e.atendimento,
      motivo_acesso_emergencial_id: m['id'],
      justificativa: e.justificativa,
      inicio_em: e.inicio,
      fim_em: e.fim,
      situacao: 'ativo',
      alerta_enviado: true,
      endereco_ip: e.enderecoIp,
      estacao_trabalho_id: estacao ? estacao['id'] : null,
    });
    // A abertura passa pela central de regras de aviso clínico (03-PEP L133): categoria 'acesso_emergencia', sem o
    // autor; o texto do aviso é o da regra (nunca a justificativa).
    if (ctx.estabelecimento)
      await emitirAvisoClinicoNaTx(tx, ctx.estabelecimento, ctx.usuario ?? null, {
        categoria: 'acesso_emergencia',
        paciente: e.paciente,
        atendimento: e.atendimento,
        moduloOrigem: 'acesso.emergencia',
        entidadeOrigem: 'acesso_emergencial',
        chaveOrigem: id,
      });
    return { id };
  },
  alvo: (_e, r) => ({ tabela: 'acesso_emergencial', id: Number(r.id) }),
  // Só ids e códigos no evento, no formato que o EmailService do worker confere (o texto é montado do lado de lá).
  eventos: (e, r, ctx) => [
    {
      tipo: PONTO_ALERTA_EMERGENCIA,
      carga: {
        rede: e.rede,
        hospital: e.hospital,
        idEmergencia: String(r.id),
        idUsuario: String(ctx.usuario),
        motivo: e.motivo,
        inicio: e.inicio.toISOString(),
        fim: e.fim.toISOString(),
      },
    },
  ],
});

/** Registro no banco do cliente: acesso_emergencial, a trilha e o alerta no outbox, na mesma transação. */
export class RegistroEmergenciaPropria implements RegistroEmergencia {
  private readonly executor: Executor;
  constructor(
    private readonly nucleo: NucleoEmergencia,
    private readonly cliente: string,
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private ids(codigo: string, login: string, paciente: number) {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'emergencia' }, async (l) => ({
      estabelecimento: await l.uma(
        'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [codigo],
      ),
      usuario: await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]),
      paciente: await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente]),
    }));
  }

  async abrir(a: Parameters<RegistroEmergencia['abrir']>[0]): Promise<AberturaRegistrada> {
    const x = await this.ids(a.hospital, a.login, a.idPaciente);
    if (!x.paciente) throw new ErroPacienteInexistente();
    if (!x.estabelecimento || !x.usuario)
      throw recusa('sessao-sem-conta', 'A sessão não tem conta no cliente.');
    const inicio = new Date();
    const fim = fimDaEmergencia(inicio, a.minutos);
    const r = await this.executor.executar(
      ABRIR_EMERGENCIA,
      this.cliente,
      {
        rede: a.rede,
        hospital: a.hospital,
        paciente: a.idPaciente,
        atendimento: a.atendimento,
        motivo: a.motivo,
        justificativa: a.justificativa,
        inicio,
        fim,
        enderecoIp: a.enderecoIp ?? null,
      },
      {
        cliente: this.cliente,
        estabelecimento: Number(x.estabelecimento['id']),
        usuario: Number(x.usuario['id']),
        correlacao: a.correlacao.slice(0, 64),
        ...(a.enderecoIp ? { enderecoIp: a.enderecoIp } : {}),
        chaveIdempotencia: `emergencia-${a.correlacao}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80),
      },
    );
    return { id: String(r.resultado.id), inicio, fim, alertaNaOutbox: RELAY_ENTREGA_ALERTA_EMERGENCIA };
  }

  async vigente(hospital: string, login: string, idPaciente: number) {
    const l = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'emergencia-vigente' }, (x) =>
      x.uma(
        `SELECT a.id, a.fim_em FROM acesso_emergencial a JOIN estabelecimento e ON e.id = a.estabelecimento_id
         JOIN usuario u ON u.id = a.usuario_id
         WHERE e.codigo = ? AND u.login = ? AND a.paciente_id = ? AND a.situacao = 'ativo' AND a.excluido_em IS NULL
           AND a.fim_em > ? ORDER BY a.fim_em DESC LIMIT 1`,
        [hospital, login, idPaciente, new Date()],
      ),
    );
    return l
      ? {
          id: String(l['id']),
          fim: l['fim_em'] instanceof Date ? l['fim_em'] : new Date(String(l['fim_em'])),
        }
      : null;
  }
}
