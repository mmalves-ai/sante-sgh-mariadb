// Rotas da diferença de acomodação cobrada do paciente (F3.4, 04-INT linha 81):
//   GET  /api/internacao/diferenca-acomodacao?atendimento=NUM   visão por paciente (internacao.internacao.ler)
//   POST /api/internacao/diferenca-acomodacao                   registrar a proposta (internacao.troca.criar)
//   POST /api/internacao/diferenca-acomodacao/aceite            aceite do paciente e conta particular (internacao.troca.criar)
//   POST /api/internacao/diferenca-acomodacao/decisao           recusar, encerrar ou cancelar (internacao.troca.criar)
// Gravações pelo executor (trilha e autoria na mesma transação, Idempotency-Key); o aceite e a decisão apuram a conta
// particular na mesma transação. Sem banco próprio, 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { corpo } from '../agenda/agendas.controller.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  type DiferencasDoAtendimento,
  esquemaAceitarDiferenca,
  esquemaDecidirDiferenca,
  esquemaRegistrarDiferenca,
  PORTA_DIFERENCA_ACOMODACAO,
  type PortaDiferencaAcomodacaoPropria,
} from './diferenca-acomodacao-propria.js';

@Controller('internacao/diferenca-acomodacao')
export class DiferencaAcomodacaoController {
  constructor(
    @Optional()
    @Inject(PORTA_DIFERENCA_ACOMODACAO)
    private readonly porta: PortaDiferencaAcomodacaoPropria | null = null,
  ) {}

  private exigirBanco(): PortaDiferencaAcomodacaoPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'A diferença de acomodação fica no banco do estabelecimento, que não está configurado.',
      );
    return this.porta;
  }

  private gravacao(req: RequisicaoAutorizada, operacao: string) {
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

  @Get()
  @Permissao('internacao.internacao.ler')
  doAtendimento(
    @Query('atendimento') numero: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DiferencasDoAtendimento> {
    if (!numero?.trim() || numero.length > 20)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Atendimento inválido',
        'Informe o número do atendimento.',
      );
    const s = sessaoDe(req);
    return this.exigirBanco().doAtendimento({ hospital: s.hospital, login: s.login }, numero);
  }

  @Post()
  @HttpCode(200)
  @Permissao('internacao.troca.criar')
  @AuditadoNoHandler('internacao.registrar_diferenca_acomodacao pelo executor (trilha na mesma transação)')
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegistrarDiferenca, b);
    const r = await this.exigirBanco().registrar(this.gravacao(req, 'internacao.registrarDiferenca'), e);
    return {
      ok: true,
      resultado: r.resultado,
      repetida: r.repetida,
      mensagem: 'Diferença proposta ao paciente.',
    };
  }

  @Post('aceite')
  @HttpCode(200)
  @Permissao('internacao.troca.criar')
  @AuditadoNoHandler('internacao.aceitar_diferenca_acomodacao pelo executor (trilha na mesma transação)')
  async aceitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAceitarDiferenca, b);
    const r = await this.exigirBanco().aceitar(this.gravacao(req, 'internacao.aceitarDiferenca'), e);
    return {
      ok: true,
      resultado: r.resultado,
      repetida: r.repetida,
      mensagem: `Aceite registrado: ${r.resultado.lancados} dia(s) cobrado(s) na conta particular.`,
    };
  }

  @Post('decisao')
  @HttpCode(200)
  @Permissao('internacao.troca.criar')
  @AuditadoNoHandler('internacao.decidir_diferenca_acomodacao pelo executor (trilha na mesma transação)')
  async decidir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaDecidirDiferenca, b);
    const r = await this.exigirBanco().decidir(this.gravacao(req, 'internacao.decidirDiferenca'), e);
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem: 'Diferença atualizada.' };
  }
}
