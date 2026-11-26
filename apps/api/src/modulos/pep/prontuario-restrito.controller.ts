// Rotas do prontuário de acesso restrito (F8, 03-PEP L93):
//   GET  /api/pep/prontuario-restrito                    fila de pedidos pendentes e configuração (pep.prontuarioRestrito.ler)
//   GET  /api/pep/prontuario-restrito/paciente/:id       visão por paciente (pep.prontuarioRestrito.ler)
//   POST /api/pep/prontuario-restrito/configuracao       quem autoriza, validade, senha, limite (pep.prontuarioRestrito.configurar)
//   POST /api/pep/prontuario-restrito/restricoes         restringir o prontuário (pep.prontuarioRestrito.configurar)
//   POST /api/pep/prontuario-restrito/restricoes/encerrar  encerrar a restrição (pep.prontuarioRestrito.configurar)
//   POST /api/pep/prontuario-restrito/senha              senha do paciente, só em resumo (pep.prontuarioRestrito.autorizar)
//   POST /api/pep/prontuario-restrito/pedidos            pedir acesso (pep.prontuarioRestrito.pedir)
//   POST /api/pep/prontuario-restrito/pedidos/cancelar   cancelar o próprio pedido (pep.prontuarioRestrito.pedir)
//   POST /api/pep/prontuario-restrito/pedidos/decidir    aprovar/negar, pela equipe ou pelo paciente com a senha (pep.prontuarioRestrito.autorizar)
//   POST /api/pep/prontuario-restrito/autorizacoes/revogar  revogar com motivo (pep.prontuarioRestrito.autorizar)
//   POST /api/pep/prontuario-restrito/abrir              abrir pela autorização, contando contra o limite; sem autorização, 403
// Gravações pelo executor (trilha e autoria na mesma transação, Idempotency-Key). Sem banco próprio, 503.
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  type PainelRestrito,
  PORTA_PRONTUARIO_RESTRITO,
  type PortaProntuarioRestritoPropria,
} from './prontuario-restrito-propria.js';

const MENSAGEM_DECISAO: Record<string, string> = {
  aprovado: 'Acesso autorizado.',
  negado: 'Pedido negado.',
  expirado: 'O pedido passou da validade e expirou: peça de novo.',
};

@Controller('pep/prontuario-restrito')
export class ProntuarioRestritoController {
  constructor(
    @Optional()
    @Inject(PORTA_PRONTUARIO_RESTRITO)
    private readonly porta: PortaProntuarioRestritoPropria | null = null,
  ) {}

  private exigirBanco(): PortaProntuarioRestritoPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O prontuário restrito fica no banco do estabelecimento, que não está configurado.',
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
  @Permissao('pep.prontuarioRestrito.ler')
  fila(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.exigirBanco().fila({ hospital: s.hospital, login: s.login });
  }

  @Get('paciente/:id')
  @Permissao('pep.prontuarioRestrito.ler')
  painel(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada): Promise<PainelRestrito> {
    const s = sessaoDe(req);
    return this.exigirBanco().painel({ hospital: s.hospital, login: s.login }, id);
  }

  @Post('configuracao')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.configurar')
  @AuditadoNoHandler('pep.configurar_prontuario_restrito pelo executor (trilha na mesma transação)')
  async configurar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().configurar(this.gravacao(req, 'pep.configurarProntuarioRestrito'), b);
    return { ok: true, ...r, mensagem: 'Configuração gravada.' };
  }

  @Post('restricoes')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.configurar')
  @AuditadoNoHandler('pep.restringir_prontuario pelo executor (trilha na mesma transação)')
  async restringir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().restringir(this.gravacao(req, 'pep.restringirProntuario'), b);
    return { ok: true, ...r, mensagem: 'Prontuário restrito.' };
  }

  @Post('restricoes/encerrar')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.configurar')
  @AuditadoNoHandler('pep.encerrar_restricao_prontuario pelo executor (trilha na mesma transação)')
  async encerrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().encerrarRestricao(
      this.gravacao(req, 'pep.encerrarRestricaoProntuario'),
      b,
    );
    return { ok: true, ...r, mensagem: 'Restrição encerrada.' };
  }

  @Post('senha')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.autorizar')
  @AuditadoNoHandler(
    'pep.definir_senha_prontuario_paciente pelo executor (trilha na mesma transação; só o resumo)',
  )
  async senha(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().definirSenha(this.gravacao(req, 'pep.definirSenhaProntuario'), b);
    return { ok: true, repetida: r.repetida, mensagem: 'Senha do paciente gravada.' };
  }

  @Post('pedidos')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.pedir')
  @AuditadoNoHandler('pep.pedir_acesso_prontuario_restrito pelo executor (trilha na mesma transação)')
  async pedir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().pedir(this.gravacao(req, 'pep.pedirAcessoProntuarioRestrito'), b);
    return { ok: true, ...r, mensagem: 'Pedido de acesso enviado.' };
  }

  @Post('pedidos/cancelar')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.pedir')
  @AuditadoNoHandler('pep.cancelar_pedido_prontuario_restrito pelo executor (trilha na mesma transação)')
  async cancelar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().cancelarPedido(
      this.gravacao(req, 'pep.cancelarPedidoProntuarioRestrito'),
      b,
    );
    return { ok: true, ...r, mensagem: 'Pedido cancelado.' };
  }

  @Post('pedidos/decidir')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.autorizar')
  @AuditadoNoHandler('pep.decidir_acesso_prontuario_restrito pelo executor (trilha na mesma transação)')
  async decidir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().decidir(this.gravacao(req, 'pep.decidirAcessoProntuarioRestrito'), b);
    const sit = r.resultado.situacao;
    // A senha errada fica contada no banco (a operação grava), mas a resposta é 403. É recusa de negócio: a tela
    // mostra o motivo (senha que não confere ou bloqueada), não o aviso genérico de perfil sem permissão.
    if (sit === 'senha-recusada' || sit === 'senha-bloqueada')
      throw new ErroProblema(
        'recusa-de-negocio',
        403,
        'Senha do paciente',
        sit === 'senha-recusada'
          ? 'A senha do paciente não confere.'
          : 'A senha do paciente está bloqueada por erros seguidos: tente mais tarde.',
        { codigo: sit },
      );
    return { ok: true, ...r, mensagem: MENSAGEM_DECISAO[sit] ?? '' };
  }

  @Post('autorizacoes/revogar')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.autorizar')
  @AuditadoNoHandler('pep.revogar_acesso_prontuario_restrito pelo executor (trilha na mesma transação)')
  async revogar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().revogar(this.gravacao(req, 'pep.revogarAcessoProntuarioRestrito'), b);
    return { ok: true, ...r, mensagem: 'Autorização revogada.' };
  }

  @Post('abrir')
  @HttpCode(200)
  @Permissao('pep.prontuarioRestrito.pedir')
  @AuditadoNoHandler(
    'pep.abrir_prontuario_restrito pelo executor (trilha na mesma transação e leitura do prontuário)',
  )
  async abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.exigirBanco().abrir(this.gravacao(req, 'pep.abrirProntuarioRestrito'), b);
    return { ok: true, ...r, mensagem: 'Abertura registrada.' };
  }
}
