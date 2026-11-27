// Rotas do cadastro das restrições próprias do hospital no apoio à decisão da prescrição (03-PEP L108). Sem banco
// próprio, a porta em memória da fonte sintética (mesmas regras do domínio); sem nenhuma porta, 503.
//   GET  pep/prescricao/restricoes                 pep.regraAlerta.ler: ajustes por faixa, restrições, configurações
//   POST pep/prescricao/restricoes/ajustes-renais  pep.regraAlerta.editar: inclui ou altera (com a versão lida)
//   POST pep/prescricao/restricoes/posologia       pep.regraAlerta.editar
//   POST pep/prescricao/restricoes/configuracoes   pep.regraAlerta.editar: o alerta no estabelecimento ou no setor
// Cada gravação vai pelo executor do núcleo, com a trilha na mesma transação. Desligar é gravar com ativo = false.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CADASTRO_RESTRICOES_PRESCRICAO,
  type PortaRestricoesPrescricao,
} from './prescricao-propria-restricoes.js';

const AUD = 'pep.restricoes pelo executor (trilha na mesma transação)';

@Controller('pep/prescricao/restricoes')
export class PrescricaoRestricoesController {
  constructor(
    @Optional()
    @Inject(CADASTRO_RESTRICOES_PRESCRICAO)
    private readonly cadastro: PortaRestricoesPrescricao | null = null,
  ) {}

  private banco(): PortaRestricoesPrescricao {
    if (!this.cadastro)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'As restrições da prescrição ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.cadastro;
  }

  private ctx(req: RequisicaoAutorizada, operacao: string) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, operacao, false);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get()
  @Permissao('pep.regraAlerta.ler')
  listar(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.banco().cadastro({ hospital: s.hospital, login: s.login });
  }

  @Post('ajustes-renais')
  @HttpCode(200)
  @Permissao('pep.regraAlerta.editar')
  @AuditadoNoHandler(AUD)
  gravarAjuste(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().gravarAjusteRenal(this.ctx(req, 'pep.restricoes.ajuste'), b);
  }

  @Post('posologia')
  @HttpCode(200)
  @Permissao('pep.regraAlerta.editar')
  @AuditadoNoHandler(AUD)
  gravarRestricao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().gravarRestricao(this.ctx(req, 'pep.restricoes.posologia'), b);
  }

  @Post('configuracoes')
  @HttpCode(200)
  @Permissao('pep.regraAlerta.editar')
  @AuditadoNoHandler(AUD)
  gravarConfiguracao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().gravarConfiguracao(this.ctx(req, 'pep.restricoes.configuracao'), b);
  }
}
