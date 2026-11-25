// Rotas das curvas de crescimento do paciente (03-PEP L141). Ler: quem lê o prontuário (pep.prontuario.ler); registrar
// a medida de crescimento (peso, estatura, perímetro cefálico, dentro ou fora do atendimento): quem registra no
// prontuário (pep.evolucao.criar). Sem banco próprio, 503. Como as vizinhas do prontuário: toda rota confere o vínculo
// assistencial com o paciente (AcessoPacientePep, 403 `sem-vinculo` com a tentativa na trilha); a leitura vai à
// trilha (primeira leitura do paciente na sessão).
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
  type CrescimentoDoPaciente,
  type CurvasCrescimentoPropria,
  esquemaMedidaCrescimento,
} from './curvas-crescimento-propria.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';

export const CURVAS_CRESCIMENTO = Symbol('CURVAS_CRESCIMENTO');
const LER = 'pep.prontuario.ler';
const ESCREVER = 'pep.evolucao.criar';

@Controller('pep/crescimento')
export class CurvasCrescimentoController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(CURVAS_CRESCIMENTO) private readonly curvas: CurvasCrescimentoPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private banco(): CurvasCrescimentoPropria {
    if (!this.curvas)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'As curvas de crescimento ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.curvas;
  }

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
  ): Promise<CrescimentoDoPaciente> {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, LER, true);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  @Post('medidas')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.medida_crescimento pelo executor (trilha na mesma transação)')
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaMedidaCrescimento, b);
    const s = sessaoDe(req);
    await this.paciente(s, e.paciente, ESCREVER, false);
    const g = contextoGravacao(s, 'pep.medidaCrescimento', true);
    const r = await this.banco().registrarMedida(
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
