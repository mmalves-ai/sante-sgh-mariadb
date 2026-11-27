// Rotas da central de integrações externas (decisão 53), na Administração do cliente:
//   GET  /api/administracao/integracoes-externas                    painel (config.integracaoExterna.ler)
//   POST /api/administracao/integracoes-externas/parametros         parâmetros não secretos (config.integracaoExterna.gerir)
//   POST /api/administracao/integracoes-externas/credencial         credencial ao cofre, só na ida (crítica: senha de novo)
//   POST /api/administracao/integracoes-externas/modo               liga ou desliga o real (crítica: senha de novo)
// As gravações vão pelo Executor (trilha na mesma transação). Fora de produção o real fica neutralizado.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req } from '@nestjs/common';
import {
  esquemaConfigurarIntegracaoExterna,
  esquemaDefinirModoIntegracao,
  esquemaGuardarCredencialIntegracao,
  PERMISSOES_M10_CODIGOS as C,
} from '@sgh/contratos';
import type { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { reautenticar } from '../../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { ServicoSessao } from '../../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../../acesso/acesso.controller.js';
import { problema } from '../../administracao/comum.js';
import { contextoGravacao } from '../../agenda/apoio.js';
import { sessaoDe } from '../../cadastro/comum.js';
import type { GravacaoIntegracaoExterna } from './porta.js';
import type { ServicoIntegracoesExternas } from './servico.js';

export const SERVICO_INTEGRACOES_EXTERNAS = Symbol('SERVICO_INTEGRACOES_EXTERNAS');
const BASE = 'administracao/integracoes-externas';

function validar<T>(esquema: z.ZodType<T>, corpo: unknown, detalhe: string): T {
  const r = esquema.safeParse(corpo);
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', detalhe);
  return r.data;
}

@Controller()
export class IntegracoesExternasController {
  constructor(
    @Optional()
    @Inject(SERVICO_INTEGRACOES_EXTERNAS)
    private readonly servico: ServicoIntegracoesExternas | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private central(): ServicoIntegracoesExternas {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'Integrações externas indisponíveis neste ambiente');
    return this.servico;
  }

  private gravacao(
    req: RequisicaoAutorizada,
    rotulo: string,
    reautenticadoEm?: number,
  ): GravacaoIntegracaoExterna {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, rotulo, false);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      ...(reautenticadoEm !== undefined ? { reautenticadoEm } : {}),
    };
  }

  @Get(BASE)
  @Permissao(C.integracaoExternaLer)
  async painel() {
    return this.central()
      .painel()
      .catch((x: unknown) => problema(x));
  }

  @Post(`${BASE}/parametros`)
  @HttpCode(200)
  @Permissao(C.integracaoExternaGerir)
  @AuditadoNoHandler('integracao_externa.parametros_gravar pelo executor (trilha na mesma transação)')
  async parametros(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = validar(
      esquemaConfigurarIntegracaoExterna,
      corpo,
      'Escolha a integração e preencha só os parâmetros dela (texto de uma linha).',
    );
    return this.central()
      .configurar(this.gravacao(req, 'integracao-externa-parametros'), p)
      .catch((x: unknown) => problema(x));
  }

  @Post(`${BASE}/credencial`)
  @HttpCode(200)
  @Permissao(C.integracaoExternaGerir)
  @AuditadoNoHandler(
    'integracao_externa.credencial_guardar pelo executor (trilha sem o valor; reautenticação)',
  )
  async credencial(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = validar(
      esquemaGuardarCredencialIntegracao,
      corpo,
      'Escolha a integração e o campo, informe o valor e confirme a senha.',
    );
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.central()
      .guardarCredencial(this.gravacao(req, 'integracao-externa-credencial', em), p)
      .catch((x: unknown) => problema(x));
  }

  @Post(`${BASE}/modo`)
  @HttpCode(200)
  @Permissao(C.integracaoExternaGerir)
  @AuditadoNoHandler(
    'integracao_externa.modo_definir pelo executor (trilha com a justificativa; reautenticação)',
  )
  async modo(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = validar(
      esquemaDefinirModoIntegracao,
      corpo,
      'Escolha a integração e o modo, justifique (10 caracteres ou mais) e confirme a senha.',
    );
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.central()
      .definirModo(this.gravacao(req, 'integracao-externa-modo', em), p)
      .catch((x: unknown) => problema(x));
  }
}
