// Rotas da doação e do transplante de órgãos no prontuário (03-PEP L145):
//   GET  /api/pep/transplante/opcoes                 órgãos e tecidos ativos e os parentescos
//   GET  /api/pep/transplante/paciente/:paciente     doações (antibióticos, preservação, destinos) e inscrições como
//                                                    receptor (destinos, acompanhamento depois do transplante)
//   GET  /api/pep/transplante/receptores?orgao=      receptores da unidade na lista do órgão (sem nome; prontuário)
//   POST /api/pep/transplante/doador | antibiotico | preservacao | receptor | destino | acompanhamento
// Ler: quem lê o prontuário (pep.prontuario.ler); gravar: quem registra no prontuário (pep.evolucao.criar). A visão
// por paciente e cada gravação conferem o vínculo assistencial com o paciente (o doador, no destino do órgão), como as
// vizinhas do prontuário; a leitura vai à trilha. Gravação pelo executor (trilha na mesma transação, Idempotency-Key).
// Sem banco próprio, 503.
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
  ESQUEMAS_TRANSPLANTE,
  type GravacaoTransplante,
  type ReceptorNaLista,
  type TransplanteClinicoPropria,
  type TransplanteDoPaciente,
} from './transplante-clinico-propria.js';

export const TRANSPLANTE_CLINICO = Symbol('TRANSPLANTE_CLINICO');
const LER = 'pep.prontuario.ler';
const ESCREVER = 'pep.evolucao.criar';
const MENSAGENS: Readonly<Record<GravacaoTransplante, string>> = {
  doador: 'Doador gravado.',
  antibiotico: 'Antibiótico do doador gravado.',
  preservacao: 'Solução de preservação gravada.',
  receptor: 'Receptor gravado.',
  destino: 'Destino do órgão gravado.',
  acompanhamento: 'Acompanhamento gravado.',
};

@Controller('pep/transplante')
export class TransplanteClinicoController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(TRANSPLANTE_CLINICO) private readonly porta: TransplanteClinicoPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private banco(): TransplanteClinicoPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'A doação e o transplante ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.porta;
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

  @Get('opcoes')
  @Permissao(LER)
  opcoes() {
    return this.banco().opcoes();
  }

  @Get('receptores')
  @Permissao(LER)
  receptores(
    @Query('orgao', ParseIntPipe) orgao: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<readonly ReceptorNaLista[]> {
    const s = sessaoDe(req);
    return this.banco().receptoresDoOrgao({ hospital: s.hospital, login: s.login }, orgao);
  }

  @Get('paciente/:paciente')
  @Permissao(LER)
  async doPaciente(
    @Param('paciente', ParseIntPipe) paciente: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<TransplanteDoPaciente> {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, LER, true);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  private async gravarTipo(tipo: GravacaoTransplante, b: unknown, req: RequisicaoAutorizada) {
    const e = corpo(ESQUEMAS_TRANSPLANTE[tipo] as never, b) as Record<string, unknown>;
    const s = sessaoDe(req);
    const paciente = await this.banco().pacienteDaGravacao(tipo, e);
    if (paciente === null)
      throw new ErroProblema('nao-encontrado', 404, 'Registro de transplante não encontrado');
    await this.paciente(s, paciente, ESCREVER, false);
    const g = contextoGravacao(s, `pep.transplante.${tipo}`, true);
    const r = await this.banco().gravar(
      tipo,
      {
        hospital: s.hospital,
        login: s.login,
        correlacao: g.correlacao,
        chaveIdempotencia: g.chaveIdempotencia,
        ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      },
      b,
    );
    return { ok: true, ...r, mensagem: MENSAGENS[tipo] };
  }

  @Post('doador')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.transplante.doador pelo executor (trilha na mesma transação)')
  doador(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravarTipo('doador', b, req);
  }

  @Post('antibiotico')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.transplante.antibiotico pelo executor (trilha na mesma transação)')
  antibiotico(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravarTipo('antibiotico', b, req);
  }

  @Post('preservacao')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.transplante.preservacao pelo executor (trilha na mesma transação)')
  preservacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravarTipo('preservacao', b, req);
  }

  @Post('receptor')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.transplante.receptor pelo executor (trilha na mesma transação)')
  receptor(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravarTipo('receptor', b, req);
  }

  @Post('destino')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.transplante.destino pelo executor (trilha na mesma transação)')
  destino(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravarTipo('destino', b, req);
  }

  @Post('acompanhamento')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.transplante.acompanhamento pelo executor (trilha na mesma transação)')
  acompanhamento(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravarTipo('acompanhamento', b, req);
  }
}
