// Rotas das cotas e prazos de marcação (02-AGE linha 47). Ler: quem lê a agenda. Manter: a permissão de manutenção da
// agenda (agenda.cobertura.editar), como os perfis de marcação. Sem banco próprio, 503: as cotas e os prazos são do
// banco do cliente. A aplicação na marcação é da porta da agenda (exigirRegrasDaMarcacao).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { corpo } from './agendas.controller.js';
import { contextoGravacao } from './apoio.js';
import {
  type CotaLida,
  type CotasPrazosPropria,
  esquemaSalvarCota,
  esquemaSalvarPrazo,
  type OpcoesCota,
  type PrazoLido,
} from './cota-prazo.js';

export const COTAS_PRAZOS = Symbol('COTAS_PRAZOS');

@Controller('agenda/cotas-prazos')
export class CotasPrazosController {
  constructor(@Optional() @Inject(COTAS_PRAZOS) private readonly cotas: CotasPrazosPropria | null = null) {}

  private exigirBanco(): CotasPrazosPropria {
    if (!this.cotas)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'As cotas e os prazos de marcação ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.cotas;
  }

  private gravacao(s: SessaoCadastro, rotulo: string) {
    const g = contextoGravacao(s, rotulo, true);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get()
  @Permissao('agenda.agenda.ler')
  listar(@Req() req: RequisicaoAutorizada): Promise<{ cotas: CotaLida[]; prazos: PrazoLido[] }> {
    const s = sessaoDe(req);
    return this.exigirBanco().listar({ hospital: s.hospital, login: s.login });
  }

  @Get('opcoes')
  @Permissao('agenda.cobertura.editar')
  opcoes(@Req() req: RequisicaoAutorizada): Promise<OpcoesCota> {
    const s = sessaoDe(req);
    return this.exigirBanco().opcoes({ hospital: s.hospital, login: s.login });
  }

  @Post('cotas')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.cota_marcacao_salvar pelo executor (trilha na mesma transação)')
  async incluirCota(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarCota, { ...(b as object), id: undefined });
    const r = await this.exigirBanco().salvarCota(this.gravacao(sessaoDe(req), 'agenda.cotaMarcacao'), e);
    return { ok: true, ...r, mensagem: 'Cota de marcação criada.' };
  }

  @Post('cotas/:id')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.cota_marcacao_salvar pelo executor (trilha na mesma transação)')
  async alterarCota(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarCota, { ...(b as object), id: idDaRota(id) });
    const r = await this.exigirBanco().salvarCota(this.gravacao(sessaoDe(req), 'agenda.cotaMarcacao'), e);
    return { ok: true, ...r, mensagem: 'Cota de marcação gravada.' };
  }

  @Post('prazos')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.prazo_aviso_marcacao_salvar pelo executor (trilha na mesma transação)')
  async incluirPrazo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarPrazo, { ...(b as object), id: undefined });
    const r = await this.exigirBanco().salvarPrazo(this.gravacao(sessaoDe(req), 'agenda.prazoAviso'), e);
    return { ok: true, ...r, mensagem: 'Prazo de aviso criado.' };
  }

  @Post('prazos/:id')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.prazo_aviso_marcacao_salvar pelo executor (trilha na mesma transação)')
  async alterarPrazo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarPrazo, { ...(b as object), id: idDaRota(id) });
    const r = await this.exigirBanco().salvarPrazo(this.gravacao(sessaoDe(req), 'agenda.prazoAviso'), e);
    return { ok: true, ...r, mensagem: 'Prazo de aviso gravado.' };
  }
}
