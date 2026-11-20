// Tela "Administração > Coexistência com o legado > Testes de assinatura de dados (Sante SGH × legado)"
// (M03). Permissão config.assinatura.ler; nenhuma ação (a execução é pela esteira). M06: exige sessão e a
// permissão (guarda global), em qualquer ambiente.
import { Controller, Get, Inject } from '@nestjs/common';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { PainelAssinaturas } from '@sgh/contratos';
import { FONTE_ASSINATURAS, type FonteAssinaturas } from './assinaturas.js';

@Controller('config')
export class AssinaturasController {
  constructor(@Inject(FONTE_ASSINATURAS) private readonly fonte: FonteAssinaturas) {}

  @Get('assinaturas')
  @Permissao('config.assinatura.ler')
  painel(): PainelAssinaturas {
    return this.fonte.painel();
  }
}
