// Rotas da farmacovigilância no paciente (03-PEP L103) e da lista de uso contínuo com a reconciliação que parte
// dela (03-PEP L104). Ler: quem vê a reconciliação medicamentosa (pep.reconciliacao.ler). Reação adversa: quem
// registra no prontuário (pep.evolucao.criar), inclusive a avaliação da farmácia clínica e a notificação. Uso
// contínuo e reconciliação pela lista: pep.reconciliacao.registrar. Sem banco próprio, 503.
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
import { corpo } from '../agenda/agendas.controller.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  esquemaReacao,
  esquemaUsoContinuo,
  type FarmacovigilanciaDoPaciente,
  type FarmacovigilanciaPropria,
} from './farmacovigilancia-propria.js';

export const FARMACOVIGILANCIA = Symbol('FARMACOVIGILANCIA');

@Controller('pep/farmacovigilancia')
export class FarmacovigilanciaController {
  constructor(
    @Optional() @Inject(FARMACOVIGILANCIA) private readonly fv: FarmacovigilanciaPropria | null = null,
  ) {}

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
  doPaciente(
    @Param('paciente', ParseIntPipe) paciente: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FarmacovigilanciaDoPaciente> {
    const s = sessaoDe(req);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  @Post('reacoes')
  @HttpCode(200)
  @Permissao('pep.evolucao.criar')
  @AuditadoNoHandler('pep.reacao_adversa pelo executor (trilha na mesma transação)')
  async reacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaReacao, b);
    const r = await this.banco().reacao(this.ctx(req, 'pep.reacaoAdversa'), e);
    return { ok: true, ...r };
  }

  @Post('uso-continuo')
  @HttpCode(200)
  @Permissao('pep.reconciliacao.registrar')
  @AuditadoNoHandler('pep.uso_continuo pelo executor (trilha na mesma transação)')
  async usoContinuo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaUsoContinuo, b);
    const r = await this.banco().usoContinuo(this.ctx(req, 'pep.usoContinuo'), e);
    return { ok: true, ...r };
  }
}
