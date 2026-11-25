// Rotas das notas e lembretes livres sobre o paciente (03-PEP L102). Ler: quem lê o prontuário (pep.prontuario.ler),
// e só as notas que pode ver (autor, equipe do estabelecimento ou toda a rede); escrever e dar os passos (encerrar,
// cancelar, prorrogar): quem registra no prontuário (pep.evolucao.criar). Sem banco próprio, 503.
// Como as vizinhas do prontuário: toda rota confere o vínculo assistencial com o paciente (AcessoPacientePep, 403
// `sem-vinculo` com a tentativa na trilha); a leitura vai à trilha (primeira leitura do paciente na sessão). Na
// gravação pelo id da nota, o paciente sai da nota gravada.
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
  Req,
} from '@nestjs/common';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
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
import { sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { AcessoPacientePep, chaveSessaoPep } from './acesso-paciente.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';
import { esquemaNota, type NotasDoPaciente, type NotasPacientePropria } from './notas-paciente-propria.js';

export const NOTAS_PACIENTE = Symbol('NOTAS_PACIENTE');
const LER = 'pep.prontuario.ler';
const ESCREVER = 'pep.evolucao.criar';

@Controller('pep/notas')
export class NotasPacienteController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(NOTAS_PACIENTE) private readonly notas: NotasPacientePropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private banco(): NotasPacientePropria {
    if (!this.notas)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'As notas do paciente ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.notas;
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

  @Get('paciente/:paciente')
  @Permissao(LER)
  async doPaciente(
    @Param('paciente', ParseIntPipe) paciente: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<NotasDoPaciente> {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, LER, true);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  @Post()
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.nota_paciente pelo executor (trilha na mesma transação)')
  async gravar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaNota, b);
    const s = sessaoDe(req);
    const paciente = e.acao === 'registrar' ? e.paciente : await this.banco().pacienteDaNota(e.nota);
    if (paciente === null) throw new ErroProblema('nao-encontrado', 404, 'Nota não encontrada');
    await this.paciente(s, paciente, ESCREVER, false);
    const g = contextoGravacao(s, 'pep.notaPaciente', true);
    const r = await this.banco().gravarNota(
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
