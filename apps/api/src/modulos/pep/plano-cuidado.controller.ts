// Rotas do plano de cuidado e da estratificação de risco do paciente (03-PEP L142). Ler: quem lê o prontuário
// (pep.prontuario.ler); criar, registrar a não criação, estratificar, incluir itens e dar os passos: quem registra no
// prontuário (pep.evolucao.criar). Sem banco próprio, 503. Como as vizinhas do prontuário: toda rota confere o vínculo
// assistencial com o paciente (AcessoPacientePep, 403 `sem-vinculo`); a leitura vai à trilha. Na gravação pelo id do
// plano ou do item, o paciente sai do registro gravado.
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
import {
  type EntradaPlano,
  esquemaPlano,
  type PlanoCuidadoPropria,
  type PlanosDoPaciente,
} from './plano-cuidado-propria.js';

export const PLANO_CUIDADO = Symbol('PLANO_CUIDADO');
const LER = 'pep.prontuario.ler';
const ESCREVER = 'pep.evolucao.criar';

@Controller('pep/plano-cuidado')
export class PlanoCuidadoController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(PLANO_CUIDADO) private readonly planos: PlanoCuidadoPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private banco(): PlanoCuidadoPropria {
    if (!this.planos)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O plano de cuidado fica no banco do estabelecimento, que não está configurado.',
      );
    return this.planos;
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
  ): Promise<PlanosDoPaciente> {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, LER, true);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  @Post()
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.plano_cuidado pelo executor (trilha na mesma transação)')
  async gravar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaPlano, b) as EntradaPlano;
    const s = sessaoDe(req);
    const paciente =
      e.acao === 'criar' || e.acao === 'nao_criar'
        ? e.paciente
        : await this.banco().pacienteDe(e.acao === 'passo_item' ? { item: e.item } : { plano: e.plano });
    if (paciente === null) throw new ErroProblema('nao-encontrado', 404, 'Plano de cuidado não encontrado');
    await this.paciente(s, paciente, ESCREVER, false);
    const g = contextoGravacao(s, 'pep.planoCuidado', true);
    const r = await this.banco().gravarPlano(
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
