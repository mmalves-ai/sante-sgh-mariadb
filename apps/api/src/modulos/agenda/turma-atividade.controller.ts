// Rotas da agenda de grupos e turmas (02-AGE linha 50). Ler: quem lê a agenda (agenda.agenda.ler). Manter a turma, a
// escala, gerar e cancelar encontros: quem mantém a escala (agenda.escala.editar). Inscrever e encerrar a participação:
// quem marca (agenda.marcacao.agendar). Presença: quem registra o comparecimento (agenda.falta.registrar). Sem banco
// próprio, 503: as turmas são do banco do cliente.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { corpo } from './agendas.controller.js';
import { contextoGravacao } from './apoio.js';
import {
  esquemaCancelarEncontro,
  esquemaGerarEncontros,
  esquemaInscrever,
  esquemaPresenca,
  esquemaSair,
  esquemaSalvarEscala,
  esquemaSalvarTurma,
  type TurmasAtividadePropria,
} from './turma-atividade.js';

export const TURMAS_ATIVIDADE = Symbol('TURMAS_ATIVIDADE');

@Controller('agenda/turmas')
export class TurmasAtividadeController {
  constructor(
    @Optional() @Inject(TURMAS_ATIVIDADE) private readonly turmas: TurmasAtividadePropria | null = null,
  ) {}

  private exigirBanco(): TurmasAtividadePropria {
    if (!this.turmas)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'As turmas de atividade coletiva ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.turmas;
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

  private leitura(req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { hospital: s.hospital, login: s.login };
  }

  @Get()
  @Permissao('agenda.agenda.ler')
  listar(@Req() req: RequisicaoAutorizada) {
    return this.exigirBanco().listar(this.leitura(req));
  }

  @Get('opcoes')
  @Permissao('agenda.agenda.ler')
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.exigirBanco().opcoes(this.leitura(req));
  }

  @Get('paciente/:id')
  @Permissao('agenda.agenda.ler')
  doPaciente(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.exigirBanco().doPaciente(this.leitura(req), idDaRota(id));
  }

  @Get('encontros/:id')
  @Permissao('agenda.agenda.ler')
  encontro(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.exigirBanco().presencaDoEncontro(this.leitura(req), idDaRota(id));
  }

  @Get(':id')
  @Permissao('agenda.agenda.ler')
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.exigirBanco().detalhe(this.leitura(req), idDaRota(id));
  }

  @Post()
  @HttpCode(200)
  @Permissao('agenda.escala.editar')
  @AuditadoNoHandler('agenda.turma_atividade_salvar pelo executor (trilha na mesma transação)')
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarTurma, { ...(b as object), id: undefined });
    const r = await this.exigirBanco().salvarTurma(this.gravacao(sessaoDe(req), 'agenda.turma'), e);
    return { ok: true, ...r, mensagem: 'Turma criada.' };
  }

  @Post(':id')
  @HttpCode(200)
  @Permissao('agenda.escala.editar')
  @AuditadoNoHandler('agenda.turma_atividade_salvar pelo executor (trilha na mesma transação)')
  async alterar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarTurma, { ...(b as object), id: idDaRota(id) });
    const r = await this.exigirBanco().salvarTurma(this.gravacao(sessaoDe(req), 'agenda.turma'), e);
    return { ok: true, ...r, mensagem: 'Turma gravada.' };
  }

  @Post(':id/escalas')
  @HttpCode(200)
  @Permissao('agenda.escala.editar')
  @AuditadoNoHandler('agenda.turma_escala_salvar pelo executor (trilha na mesma transação)')
  async salvarEscala(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarEscala, { ...(b as object), turma: idDaRota(id) });
    const r = await this.exigirBanco().salvarEscala(this.gravacao(sessaoDe(req), 'agenda.turmaEscala'), e);
    return { ok: true, ...r, mensagem: 'Escala da turma gravada.' };
  }

  @Post(':id/encontros/gerar')
  @HttpCode(200)
  @Permissao('agenda.escala.editar')
  @AuditadoNoHandler('agenda.turma_encontros_gerar pelo executor (trilha na mesma transação)')
  async gerar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaGerarEncontros, { ...(b as object), turma: idDaRota(id) });
    const r = await this.exigirBanco().gerarEncontros(
      this.gravacao(sessaoDe(req), 'agenda.turmaEncontros'),
      e,
    );
    return { ok: true, ...r, mensagem: `${r.resultado.gerados} encontro(s) gerado(s).` };
  }

  @Post('encontros/:id/cancelar')
  @HttpCode(200)
  @Permissao('agenda.escala.editar')
  @AuditadoNoHandler('agenda.turma_encontro_cancelar pelo executor (trilha na mesma transação)')
  async cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaCancelarEncontro, { ...(b as object), encontro: idDaRota(id) });
    const r = await this.exigirBanco().cancelarEncontro(
      this.gravacao(sessaoDe(req), 'agenda.turmaEncontro'),
      e,
    );
    return { ok: true, ...r, mensagem: 'Encontro cancelado.' };
  }

  @Post('encontros/:id/presencas')
  @HttpCode(200)
  @Permissao('agenda.falta.registrar')
  @AuditadoNoHandler('agenda.turma_presenca_registrar pelo executor (trilha na mesma transação)')
  async presenca(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaPresenca, { ...(b as object), encontro: idDaRota(id) });
    const r = await this.exigirBanco().registrarPresenca(
      this.gravacao(sessaoDe(req), 'agenda.turmaPresenca'),
      e,
    );
    return { ok: true, ...r, mensagem: 'Presença registrada.' };
  }

  @Post(':id/participantes')
  @HttpCode(200)
  @Permissao('agenda.marcacao.agendar')
  @AuditadoNoHandler('agenda.turma_participante_inscrever pelo executor (trilha na mesma transação)')
  async inscrever(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaInscrever, { ...(b as object), turma: idDaRota(id) });
    const r = await this.exigirBanco().inscrever(this.gravacao(sessaoDe(req), 'agenda.turmaInscricao'), e);
    return {
      ok: true,
      ...r,
      mensagem:
        r.resultado.aviso ??
        (r.resultado.situacao === 'em_espera' ? 'Paciente na espera da turma.' : 'Paciente inscrito.'),
    };
  }

  @Post('participantes/:id/sair')
  @HttpCode(200)
  @Permissao('agenda.marcacao.agendar')
  @AuditadoNoHandler('agenda.turma_participante_sair pelo executor (trilha na mesma transação)')
  async sair(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSair, { ...(b as object), participante: idDaRota(id) });
    const r = await this.exigirBanco().sair(this.gravacao(sessaoDe(req), 'agenda.turmaSaida'), e);
    return {
      ok: true,
      ...r,
      mensagem: r.resultado.promovido
        ? 'Participação encerrada; o primeiro da espera ocupou a vaga.'
        : 'Participação encerrada.',
    };
  }
}
