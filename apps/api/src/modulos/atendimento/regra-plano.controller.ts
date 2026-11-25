// Rotas da regra própria do plano da fonte pagadora na recepção (02-CAD linha 24):
//   GET  /api/atendimento/regras-plano/fontes           as fontes ativas para escolher (convenio.contrato.ler)
//   GET  /api/atendimento/regras-plano?fonte=ID         regras da fonte (todas as vigências), planos e categorias
//   POST /api/atendimento/regras-plano                  incluir ou encerrar (convenio.contrato.editar; executor:
//                                                       trilha e autoria na mesma transação, Idempotency-Key)
//   POST /api/atendimento/regras-plano/previa           a crítica da abertura sem gravar (atendimento.atendimento.abrir)
// A mesma crítica roda e decide na abertura do atendimento (atendimento.abrir-atendimento). Sem banco próprio, 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { corpo } from '../agenda/agendas.controller.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  type CriticaPlanoVisao,
  esquemaManterRegraPlano,
  esquemaPreviaRegraPlano,
  type Opcao,
  type RegraPlanoPropria,
  type RegrasPlanoDaFonte,
} from './regra-plano-propria.js';

export const REGRA_PLANO = Symbol('REGRA_PLANO');

@Controller('atendimento/regras-plano')
export class RegraPlanoController {
  constructor(@Optional() @Inject(REGRA_PLANO) private readonly regras: RegraPlanoPropria | null = null) {}

  private exigirBanco(): RegraPlanoPropria {
    if (!this.regras)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'A regra do plano fica no banco do estabelecimento, que não está configurado.',
      );
    return this.regras;
  }

  @Get('fontes')
  @Permissao('convenio.contrato.ler')
  fontes(): Promise<Opcao[]> {
    return this.exigirBanco().fontes();
  }

  @Get()
  @Permissao('convenio.contrato.ler')
  regrasDaFonte(
    @Query('fonte') fonte: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegrasPlanoDaFonte> {
    const n = Number(fonte);
    if (!Number.isInteger(n) || n <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Fonte pagadora inválida', 'Escolha a fonte pagadora.');
    const s = sessaoDe(req);
    return this.exigirBanco().regras({ hospital: s.hospital, login: s.login }, n);
  }

  @Post()
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler('atendimento.manter_regra_plano pelo executor (trilha na mesma transação)')
  async manter(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaManterRegraPlano, b);
    const g = contextoGravacao(s, 'atendimento.manterRegraPlano', true);
    const r = await this.exigirBanco().manter(
      {
        hospital: s.hospital,
        login: s.login,
        correlacao: g.correlacao,
        chaveIdempotencia: g.chaveIdempotencia,
        ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      },
      e,
    );
    return {
      ok: true,
      resultado: r.resultado,
      repetida: r.repetida,
      mensagem: e.acao === 'incluir' ? 'Regra do plano gravada.' : 'Vigência da regra encerrada.',
    };
  }

  @Post('previa')
  @HttpCode(200)
  @Permissao('atendimento.atendimento.abrir')
  @AuditadoNoHandler(
    'prévia sem gravação: a mesma crítica decide e fica na trilha da abertura do atendimento',
  )
  previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<CriticaPlanoVisao> {
    const s = sessaoDe(req);
    return this.exigirBanco().previa(
      { hospital: s.hospital, login: s.login },
      corpo(esquemaPreviaRegraPlano, b),
    );
  }
}
