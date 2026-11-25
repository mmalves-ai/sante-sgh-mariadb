// Rotas do e-mail do sistema (01-ADM L77). Sem banco próprio, 503.
// - GET  /api/administracao/email (config.email.ler): servidores, modelos de mensagem com os campos, finalidades e o
//   registro dos últimos envios (situação, tentativas, identificador da mensagem);
// - POST /api/administracao/email/modelos | servidores | servidores/:id/teste (config.email.editar): gravações pelo
//   executor (trilha na mesma transação). O cadastro do servidor leva só a referência da senha no cofre;
// - POST /api/administracao/email/servidores/:id/senha (config.email.editar): a senha vai só ao cofre (chave presa ao
//   cliente), nunca ao banco, à trilha nem à resposta; a tela vê "senha definida".
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
import { PERMISSOES_M10_CODIGOS as C } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { sessaoDe } from '../cadastro/comum.js';
import { problema } from './comum.js';
import type { EmailConfiguracaoPropria } from './email-configuracao-propria.js';

export const EMAIL_CONFIGURACAO = Symbol('EMAIL_CONFIGURACAO');

const corpoDe = (c: unknown): Record<string, unknown> =>
  c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class EmailConfiguracaoController {
  constructor(
    @Optional() @Inject(EMAIL_CONFIGURACAO) private readonly porta: EmailConfiguracaoPropria | null = null,
  ) {}

  private banco(): EmailConfiguracaoPropria {
    if (!this.porta)
      throw new ErroProblema('indisponivel', 503, 'Configuração de e-mail indisponível neste ambiente');
    return this.porta;
  }

  private gravacao(req: RequisicaoAutorizada, rotulo: string) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, rotulo, false);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get('administracao/email')
  @Permissao(C.emailLer)
  async painel(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.banco()
      .painel({ hospital: s.hospital, login: s.login })
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/email/modelos')
  @HttpCode(200)
  @Permissao(C.emailEditar)
  @AuditadoNoHandler('email.modelo_gravar pelo executor (trilha na mesma transação)')
  async modelo(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarModelo(this.gravacao(req, 'email-modelo'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/email/servidores')
  @HttpCode(200)
  @Permissao(C.emailEditar)
  @AuditadoNoHandler('email.servidor_gravar pelo executor (trilha na mesma transação)')
  async servidor(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarServidor(this.gravacao(req, 'email-servidor'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/email/servidores/:id/senha')
  @HttpCode(200)
  @Permissao(C.emailEditar)
  @AuditadoNoHandler('email.servidor_senha_definir pelo executor (trilha na mesma transação, sem a senha)')
  async senha(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const c = corpoDe(corpo);
    return this.banco()
      .definirSenha(this.gravacao(req, 'email-servidor-senha'), {
        servidor: id,
        versao: c['versao'],
        senha: c['senha'],
      })
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/email/servidores/:id/teste')
  @HttpCode(200)
  @Permissao(C.emailEditar)
  @AuditadoNoHandler('email.servidor_teste pelo executor (trilha na mesma transação)')
  async teste(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .testarServidor(this.gravacao(req, 'email-servidor-teste'), { servidor: id })
      .catch((x: unknown) => problema(x));
  }
}
