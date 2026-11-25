// Rotas da anotação administrativa do caso (03-PEP L147): o registro não clínico da equipe sobre o atendimento.
// Ler: quem lê o prontuário (pep.prontuario.ler), o serviço social (pep.social.ler) ou o NIR
// (internacao.solicitacaoLeito.ler), e só o que pode ver (autor, destinatários, equipe do estabelecimento ou toda a
// rede). Marcar como lida (POST :anotacao/lida) é da mesma leitura: todo destinatário dá baixa na própria pendência,
// mesmo sem permissão de escrita. Escrever e cancelar: quem registra no prontuário (pep.evolucao.criar), o serviço
// social (pep.social.registrar) ou o NIR (internacao.solicitacaoLeito.priorizar). A busca do paciente e a reserva de
// leito de origem são servidas aqui, com a mesma leitura, para o NIR e o serviço social sem leitura do prontuário.
// Sem banco próprio, 503.
// Como as vizinhas do prontuário: toda rota do paciente confere o vínculo assistencial (AcessoPacientePep, 403
// `sem-vinculo` com a tentativa na trilha); a leitura vai à trilha. A fila de leitura de quem recebeu não traz o
// nome do paciente: o caso abre pela visão do paciente.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { esquemaConsultaBuscaPaciente, type ResultadoBuscaPaciente } from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { Auditar, AuditadoNoHandler, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { corpo } from '../agenda/agendas.controller.js';
import { problemaDoCadastro, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { PORTA_CADASTRO, type PortaCadastro } from '../cadastro/porta.js';
import { buscarPacientes } from '../cadastro/servico.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { AcessoPacientePep, chaveSessaoPep } from './acesso-paciente.js';
import {
  type AnotacoesAdministrativasPropria,
  type AnotacoesDoPaciente,
  type EntradaAnotacao,
  esquemaAnotacao,
  type PendenteDeLeitura,
} from './anotacoes-administrativas-propria.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';

export const ANOTACOES_ADMINISTRATIVAS = Symbol('ANOTACOES_ADMINISTRATIVAS');
const LER = 'pep.prontuario.ler';
const LER_OU = ['pep.social.ler', 'internacao.solicitacaoLeito.ler'] as const;
const ESCREVER = 'pep.evolucao.criar';
const ESCREVER_OU = ['pep.social.registrar', 'internacao.solicitacaoLeito.priorizar'] as const;

@Controller('pep/anotacoes-administrativas')
export class AnotacoesAdministrativasController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional()
    @Inject(ANOTACOES_ADMINISTRATIVAS)
    private readonly anotacoes: AnotacoesAdministrativasPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
    @Optional() @Inject(PORTA_CADASTRO) private readonly cadastro: PortaCadastro | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private banco(): AnotacoesAdministrativasPropria {
    if (!this.anotacoes)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'As anotações administrativas ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.anotacoes;
  }

  /** A permissão que abriu a rota (a guarda grava em req.sgh.permissao); sem ela, a primeira que a sessão tem. */
  private permissaoDe(req: RequisicaoAutorizada, opcoes: readonly string[]): string {
    const sgh = req.sgh as { permissao?: string; sessao?: { permissoes?: readonly string[] } } | undefined;
    if (sgh?.permissao) return sgh.permissao;
    const tem = sgh?.sessao?.permissoes ?? [];
    return opcoes.find((p) => tem.includes(p)) ?? opcoes[0]!;
  }

  /** Paciente do cliente + vínculo assistencial + (na leitura) a leitura na trilha, como o prontuário. */
  private async paciente(s: SessaoCadastro, paciente: number, permissao: string, leitura: boolean) {
    if (!(await this.banco().pacienteExiste(paciente)))
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    await this.acesso.exigirVinculo(s, paciente, permissao, 'pep.prontuario');
    if (leitura) {
      const chave = chaveSessaoPep(s);
      const motivo = this.estado.motivo(chave, paciente) ?? 'assistencia';
      if (!this.estado.motivo(chave, paciente)) this.estado.registrarMotivo(chave, paciente, motivo);
      await this.acesso.registrarLeitura(s, paciente, 'lista', motivo, 'pep.prontuario');
    }
  }

  @Get('pendentes')
  @Permissao(LER)
  @PermissaoOu(...LER_OU)
  pendentes(@Req() req: RequisicaoAutorizada): Promise<readonly PendenteDeLeitura[]> {
    const s = sessaoDe(req);
    return this.banco().pendentes({ hospital: s.hospital, login: s.login });
  }

  /** Busca do paciente do painel (a mesma do prontuário), aberta a quem lê as anotações; na trilha, só tipo e total. */
  @Get('pacientes')
  @Permissao(LER)
  @PermissaoOu(...LER_OU)
  @Auditar('cadastro.paciente.buscado')
  async pacientes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBuscaPaciente> {
    if (!this.cadastro)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Cadastro indisponível',
        'A busca de paciente não está configurada.',
      );
    const c = esquemaConsultaBuscaPaciente.safeParse(q);
    if (!c.success)
      throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida', 'Informe o termo da busca.');
    const r = await buscarPacientes(this.cadastro, sessaoDe(req).porta, c.data).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    req.sghAlvo = {
      tabelaAlvo: 'paciente',
      chaveNaturalAlvo: `busca:${r.tipo};n:${r.itens.length};anotacoes`,
    };
    return r;
  }

  /** O paciente da reserva de leito do NIR, para abrir as anotações do caso a partir da reserva. */
  @Get('reserva/:reserva')
  @Permissao(LER)
  @PermissaoOu(...LER_OU)
  async daReserva(
    @Param('reserva', ParseIntPipe) reserva: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ reserva: number; paciente: number }> {
    const s = sessaoDe(req);
    const paciente = await this.banco().pacienteDaReserva(reserva);
    if (paciente === null)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Reserva sem paciente',
        'A reserva não existe ou ainda não tem paciente cadastrado.',
      );
    await this.paciente(s, paciente, this.permissaoDe(req, [LER, ...LER_OU]), false);
    return { reserva, paciente };
  }

  @Get('usuarios')
  @Permissao(ESCREVER)
  @PermissaoOu(...ESCREVER_OU)
  usuarios(@Query('termo') termo: string | undefined): Promise<readonly { id: number; nome: string }[]> {
    return this.banco().usuarios(String(termo ?? '').slice(0, 80));
  }

  @Get('paciente/:paciente')
  @Permissao(LER)
  @PermissaoOu(...LER_OU)
  async doPaciente(
    @Param('paciente', ParseIntPipe) paciente: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AnotacoesDoPaciente> {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, this.permissaoDe(req, [LER, ...LER_OU]), true);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  /** Leitura confirmada pelo destinatário: basta a leitura (quem recebe nem sempre escreve). */
  @Post(':anotacao/lida')
  @HttpCode(200)
  @Permissao(LER)
  @PermissaoOu(...LER_OU)
  @AuditadoNoHandler('pep.anotacao_administrativa pelo executor (trilha na mesma transação)')
  marcarLida(@Param('anotacao', ParseIntPipe) anotacao: number, @Req() req: RequisicaoAutorizada) {
    return this.executar({ acao: 'marcar_lida', anotacao }, req, [LER, ...LER_OU]);
  }

  @Post()
  @HttpCode(200)
  @Permissao(ESCREVER)
  @PermissaoOu(...ESCREVER_OU)
  @AuditadoNoHandler('pep.anotacao_administrativa pelo executor (trilha na mesma transação)')
  gravar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.executar(corpo(esquemaAnotacao, b), req, [ESCREVER, ...ESCREVER_OU]);
  }

  private async executar(e: EntradaAnotacao, req: RequisicaoAutorizada, opcoes: readonly string[]) {
    const s = sessaoDe(req);
    const paciente = e.acao === 'registrar' ? e.paciente : await this.banco().pacienteDaAnotacao(e.anotacao);
    if (paciente === null) throw new ErroProblema('nao-encontrado', 404, 'Anotação não encontrada');
    await this.paciente(s, paciente, this.permissaoDe(req, opcoes), false);
    const g = contextoGravacao(s, 'pep.anotacaoAdministrativa', true);
    const r = await this.banco().gravarAnotacao(
      {
        hospital: s.hospital,
        login: s.login,
        correlacao: g.correlacao,
        chaveIdempotencia: g.chaveIdempotencia,
        ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      },
      e,
    );
    return { ok: true, ...r };
  }
}
