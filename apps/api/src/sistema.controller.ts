import { Controller, Get, Inject } from '@nestjs/common';
import type { Saude, Versao } from '@sgh/contratos';
import { Publica } from './autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from './configuracao.js';
import { VersaoService } from './versao.service.js';

@Controller()
export class SistemaController {
  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    private readonly versaoService: VersaoService,
  ) {}

  /**
   * PÚBLICA por decisão explícita (ficha do M00, seção 7): saúde técnica para monitoramento e para o
   * E2E; não expõe dado de negócio, de pessoa nem de configuração.
   */
  @Get('saude')
  @Publica('saúde técnica para monitoramento e E2E (ficha do M00, seção 7)')
  saude(): Saude {
    return { status: 'ok', em: new Date().toISOString() };
  }

  /**
   * PÚBLICA por decisão explícita (ficha do M00, seção 7): nome configurado do produto e versão
   * rastreável ao commit, exibidos na página inicial antes do login (a tela "Sobre" vem no M07).
   */
  @Get('versao')
  @Publica('nome do produto e versão antes do login (ficha do M00, seção 7)')
  versao(): Versao {
    return this.versaoService.atual(this.configuracao.produtoNome);
  }
}
