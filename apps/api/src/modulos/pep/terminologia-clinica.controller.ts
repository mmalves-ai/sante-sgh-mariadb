// Rotas da terminologia clínica (F8, 09-AREA linha 84): busca de conceitos clínicos e de regiões anatômicas, os
// diagnósticos do paciente com o conceito equivalente, o registro do diagnóstico do atendimento e a troca do conceito,
// e a região anatômica do exame. Ler: quem lê o prontuário (pep.prontuario.ler); registrar diagnóstico e trocar o
// conceito: quem registra no prontuário (pep.evolucao.criar); a região do exame é configuração do catálogo de exames
// (sadt.catalogo.editar). Sem banco próprio, 503. Como as vizinhas do prontuário: toda rota do paciente confere o
// vínculo assistencial (AcessoPacientePep, 403 `sem-vinculo` com a tentativa na trilha); a leitura vai à trilha.
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
  esquemaDiagnostico,
  esquemaRegiaoExame,
  type TerminologiaClinicaPropria,
} from './terminologia-clinica-propria.js';

export const TERMINOLOGIA_CLINICA = Symbol('TERMINOLOGIA_CLINICA');
const LER = 'pep.prontuario.ler';
const ESCREVER = 'pep.evolucao.criar';
const CATALOGO_EXAME = 'sadt.catalogo.editar';

const inteiro = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return v !== undefined && Number.isInteger(n) && n > 0 ? n : undefined;
};

@Controller('pep/terminologia-clinica')
export class TerminologiaClinicaController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional()
    @Inject(TERMINOLOGIA_CLINICA)
    private readonly porta: TerminologiaClinicaPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private banco(): TerminologiaClinicaPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'A terminologia clínica fica no banco do estabelecimento, que não está configurado.',
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

  private ctx(s: SessaoCadastro, rotulo: string) {
    const g = contextoGravacao(s, rotulo, true);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get('conceitos')
  @Permissao(LER)
  conceitos(@Query('texto') texto?: string, @Query('cid') cid?: string) {
    const c = inteiro(cid);
    return this.banco().conceitos({ texto: (texto ?? '').slice(0, 100), ...(c ? { cid: c } : {}) });
  }

  @Get('cids')
  @Permissao(LER)
  cids(@Query('texto') texto?: string) {
    return this.banco().cids((texto ?? '').slice(0, 100));
  }

  @Get('regioes')
  @Permissao(LER)
  regioes(
    @Query('texto') texto?: string,
    @Query('superior') superior?: string,
    @Query('exame') exame?: string,
  ) {
    const sup = inteiro(superior);
    const ex = inteiro(exame);
    return this.banco().regioes({
      texto: (texto ?? '').slice(0, 100),
      ...(sup ? { superior: sup } : {}),
      ...(ex ? { exame: ex } : {}),
    });
  }

  @Get('paciente/:paciente/diagnosticos')
  @Permissao(LER)
  async diagnosticos(@Param('paciente', ParseIntPipe) paciente: number, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, LER, true);
    return { diagnosticos: await this.banco().diagnosticosDoPaciente(paciente) };
  }

  @Post('diagnosticos')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.diagnostico_atendimento pelo executor (trilha na mesma transação)')
  async gravarDiagnostico(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaDiagnostico, b);
    const s = sessaoDe(req);
    const paciente =
      e.acao === 'registrar' ? e.paciente : await this.banco().pacienteDoDiagnostico(e.diagnostico);
    if (paciente === null) throw new ErroProblema('nao-encontrado', 404, 'Diagnóstico não encontrado');
    await this.paciente(s, paciente, ESCREVER, false);
    const r = await this.banco().gravarDiagnosticoAtendimento(this.ctx(s, 'pep.diagnosticoAtendimento'), e);
    return { ok: true, ...r };
  }

  @Post('exame-regioes')
  @HttpCode(200)
  @Permissao(CATALOGO_EXAME)
  @AuditadoNoHandler('sadt.exame_regiao_anatomica pelo executor (trilha na mesma transação)')
  async gravarRegiaoExame(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegiaoExame, b);
    const s = sessaoDe(req);
    const r = await this.banco().gravarRegiaoDoExame(this.ctx(s, 'sadt.exameRegiaoAnatomica'), e);
    return { ok: true, ...r };
  }
}
