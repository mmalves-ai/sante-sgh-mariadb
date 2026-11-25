// Rotas do exame físico estruturado por sistema e região do corpo (03-PEP L97):
//   GET  /api/pep/exame-fisico/catalogo              sistemas, regiões com o desenho do mapa e achados padronizados
//   GET  /api/pep/exame-fisico/paciente/:paciente    registros recentes com os achados e o resumo por sistema
//   POST /api/pep/exame-fisico                       acrescentar achados a um registro (só o autor, registro em vigor)
// Ler: quem lê o prontuário (pep.prontuario.ler); gravar: quem registra no prontuário (pep.evolucao.criar). Como as
// vizinhas do prontuário, a visão por paciente e a gravação conferem o vínculo assistencial (AcessoPacientePep, 403
// `sem-vinculo` com a tentativa na trilha) e a leitura vai à trilha. Na gravação, o paciente sai do registro gravado.
// Gravação pelo executor (trilha na mesma transação, Idempotency-Key). Sem banco próprio, 503.
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
import {
  type CatalogoExameLido,
  esquemaExameFisico,
  type ExameDoPaciente,
  type ExameFisicoPropria,
} from './exame-fisico-propria.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';

export const EXAME_FISICO = Symbol('EXAME_FISICO');
const LER = 'pep.prontuario.ler';
const ESCREVER = 'pep.evolucao.criar';

@Controller('pep/exame-fisico')
export class ExameFisicoController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(EXAME_FISICO) private readonly exame: ExameFisicoPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private banco(): ExameFisicoPropria {
    if (!this.exame)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O exame físico fica no banco do estabelecimento, que não está configurado.',
      );
    return this.exame;
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

  @Get('catalogo')
  @Permissao(LER)
  catalogo(): Promise<CatalogoExameLido> {
    return this.banco().catalogo();
  }

  @Get('paciente/:paciente')
  @Permissao(LER)
  async doPaciente(
    @Param('paciente', ParseIntPipe) paciente: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ExameDoPaciente> {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, LER, true);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  @Post()
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.exame_fisico pelo executor (trilha na mesma transação)')
  async gravar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaExameFisico, b);
    const s = sessaoDe(req);
    const paciente = await this.banco().pacienteDoRegistro(e.registro);
    if (paciente === null) throw new ErroProblema('nao-encontrado', 404, 'Registro clínico não encontrado');
    await this.paciente(s, paciente, ESCREVER, false);
    const g = contextoGravacao(s, 'pep.exameFisico', true);
    const r = await this.banco().gravarExame(
      {
        hospital: s.hospital,
        login: s.login,
        correlacao: g.correlacao,
        chaveIdempotencia: g.chaveIdempotencia,
        ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      },
      e,
    );
    return { ok: true, ...r, mensagem: 'Exame físico gravado.' };
  }
}
