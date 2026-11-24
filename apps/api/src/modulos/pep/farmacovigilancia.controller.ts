// Rotas da farmacovigilância no paciente (03-PEP L103) e da lista de uso contínuo com a reconciliação que parte
// dela (03-PEP L104). Ler: quem vê a reconciliação medicamentosa (pep.reconciliacao.ler). Reação adversa: quem
// registra no prontuário (pep.evolucao.criar), inclusive a avaliação da farmácia clínica e a notificação. Uso
// contínuo e reconciliação pela lista: pep.reconciliacao.registrar. Sem banco próprio, 503.
// Como as vizinhas do prontuário: toda rota confere o vínculo assistencial com o paciente (AcessoPacientePep, 403
// `sem-vinculo` com a tentativa na trilha); a leitura vai à trilha (primeira leitura do paciente na sessão) e conta
// para os alertas ao Auditor. Na gravação por id da reação ou do uso, o paciente sai do registro gravado.
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
  esquemaReacao,
  esquemaUsoContinuo,
  type FarmacovigilanciaDoPaciente,
  type FarmacovigilanciaPropria,
} from './farmacovigilancia-propria.js';

export const FARMACOVIGILANCIA = Symbol('FARMACOVIGILANCIA');

@Controller('pep/farmacovigilancia')
export class FarmacovigilanciaController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FARMACOVIGILANCIA) private readonly fv: FarmacovigilanciaPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
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

  /** O paciente da gravação: o do corpo (registro, inclusão, reconciliação) ou o da reação ou do uso gravado. */
  private async pacienteDaGravacao(
    alvo: 'reacao' | 'uso',
    e: { paciente?: number; reacao?: number; uso?: number },
  ): Promise<number> {
    if (e.paciente) return e.paciente;
    const id = alvo === 'reacao' ? e.reacao : e.uso;
    const p = id ? await this.banco().pacienteDe(alvo, id) : null;
    if (p === null)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        alvo === 'reacao' ? 'Reação não encontrada' : 'Medicamento de uso contínuo não encontrado',
      );
    return p;
  }

  private banco(): FarmacovigilanciaPropria {
    if (!this.fv)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'A farmacovigilância fica no banco do estabelecimento, que não está configurado.',
      );
    return this.fv;
  }

  private ctx(req: RequisicaoAutorizada, operacao: string) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, operacao, true);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get('paciente/:paciente')
  @Permissao('pep.reconciliacao.ler')
  async doPaciente(
    @Param('paciente', ParseIntPipe) paciente: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FarmacovigilanciaDoPaciente> {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, 'pep.reconciliacao.ler', true);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  @Post('reacoes')
  @HttpCode(200)
  @Permissao('pep.evolucao.criar')
  @AuditadoNoHandler('pep.reacao_adversa pelo executor (trilha na mesma transação)')
  async reacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaReacao, b);
    const s = sessaoDe(req);
    await this.paciente(s, await this.pacienteDaGravacao('reacao', e), 'pep.evolucao.criar', false);
    const r = await this.banco().reacao(this.ctx(req, 'pep.reacaoAdversa'), e);
    return { ok: true, ...r };
  }

  @Post('uso-continuo')
  @HttpCode(200)
  @Permissao('pep.reconciliacao.registrar')
  @AuditadoNoHandler('pep.uso_continuo pelo executor (trilha na mesma transação)')
  async usoContinuo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaUsoContinuo, b);
    const s = sessaoDe(req);
    await this.paciente(s, await this.pacienteDaGravacao('uso', e), 'pep.reconciliacao.registrar', false);
    const r = await this.banco().usoContinuo(this.ctx(req, 'pep.usoContinuo'), e);
    return { ok: true, ...r };
  }
}
