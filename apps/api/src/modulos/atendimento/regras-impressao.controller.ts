// Rotas das regras de impressão da recepção (02-REC linha 35). Configurar (modelos de ficha e regras por fonte
// pagadora, especialidade, grupo, unidade e tipo de atendimento): quem mantém os cadastros de impressão
// (documento.cadastro.editar). Ver o que já foi emitido para o atendimento (reimpressões com quem e quando): quem
// emite impressos (atendimento.impresso.emitir). Sem banco próprio, 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { corpo } from '../agenda/agendas.controller.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  type ConfiguracaoImpressao,
  type EmissaoImpresso,
  esquemaManterRegraImpressao,
  type RegrasImpressaoPropria,
} from './regras-impressao.js';

export const REGRAS_IMPRESSAO = Symbol('REGRAS_IMPRESSAO');

@Controller('atendimento/regras-impressao')
export class RegrasImpressaoController {
  constructor(
    @Optional() @Inject(REGRAS_IMPRESSAO) private readonly regras: RegrasImpressaoPropria | null = null,
  ) {}

  private exigirBanco(): RegrasImpressaoPropria {
    if (!this.regras)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'As regras de impressão ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.regras;
  }

  @Get()
  @Permissao('documento.cadastro.editar')
  configuracao(@Req() req: RequisicaoAutorizada): Promise<ConfiguracaoImpressao> {
    const s = sessaoDe(req);
    return this.exigirBanco().configuracao({ hospital: s.hospital, login: s.login });
  }

  @Get('emissoes/:reg')
  @Permissao('atendimento.impresso.emitir')
  emissoes(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada): Promise<EmissaoImpresso[]> {
    const s = sessaoDe(req);
    const n = Number(reg);
    if (!Number.isInteger(n) || n <= 0)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Atendimento inválido',
        'Informe o atendimento pelo número do registro.',
      );
    return this.exigirBanco().emissoes({ hospital: s.hospital, login: s.login }, n);
  }

  @Post()
  @HttpCode(200)
  @Permissao('documento.cadastro.editar')
  @AuditadoNoHandler('atendimento.manter_regra_impressao pelo executor (trilha na mesma transação)')
  async manter(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaManterRegraImpressao, b);
    const g = contextoGravacao(s, 'atendimento.manterRegraImpressao', true);
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
      mensagem: e.acao === 'modelo' ? 'Modelo de ficha gravado.' : 'Regra de impressão gravada.',
    };
  }
}
