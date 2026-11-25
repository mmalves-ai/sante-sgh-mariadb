// Rotas das alçadas de aprovação (01-ADM L59, escopo do usuário). Sem banco próprio, 503.
// - GET  /api/administracao/alcadas[?usuario=<login>] (acesso.usuario.ler): tipos de documento, perfis, regras do
//   estabelecimento com os níveis e, com `usuario`, em quais níveis a conta aprova (direto ou pelo perfil);
// - POST /api/administracao/alcadas (acesso.escopo.editar): cria ou altera a regra com os níveis;
// - POST /api/administracao/alcadas/:id/encerrar (acesso.escopo.editar): fecha a vigência (a futura é desativada).
// Gravações pelo executor, com a trilha na mesma transação.
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
import { PERMISSOES_M10_CODIGOS as C } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { sessaoDe } from '../cadastro/comum.js';
import type { AlcadaAprovacaoPropria } from './alcada-aprovacao-propria.js';
import { problema } from './comum.js';

export const ALCADA_APROVACAO = Symbol('ALCADA_APROVACAO');

const corpoDe = (c: unknown): Record<string, unknown> =>
  c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
const LOGIN = /^[A-Za-z0-9._@-]{1,60}$/;

@Controller()
export class AlcadaAprovacaoController {
  constructor(
    @Optional() @Inject(ALCADA_APROVACAO) private readonly porta: AlcadaAprovacaoPropria | null = null,
  ) {}

  private banco(): AlcadaAprovacaoPropria {
    if (!this.porta)
      throw new ErroProblema('indisponivel', 503, 'Alçadas de aprovação indisponíveis neste ambiente');
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

  @Get('administracao/alcadas')
  @Permissao(C.usuarioLer)
  async painel(@Req() req: RequisicaoAutorizada, @Query('usuario') usuario?: string) {
    const s = sessaoDe(req);
    return this.banco()
      .painel(
        { hospital: s.hospital, login: s.login },
        typeof usuario === 'string' && LOGIN.test(usuario) ? usuario : undefined,
      )
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/alcadas')
  @HttpCode(200)
  @Permissao(C.escopoEditar)
  @AuditadoNoHandler('organizacao.alcada_gravar pelo executor (trilha na mesma transação)')
  async gravar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarAlcada(this.gravacao(req, 'alcada-gravar'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('administracao/alcadas/:id/encerrar')
  @HttpCode(200)
  @Permissao(C.escopoEditar)
  @AuditadoNoHandler('organizacao.alcada_encerrar pelo executor (trilha na mesma transação)')
  async encerrar(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.banco()
      .encerrarAlcada(this.gravacao(req, 'alcada-encerrar'), { ...corpoDe(corpo), id })
      .catch((x: unknown) => problema(x));
  }
}
