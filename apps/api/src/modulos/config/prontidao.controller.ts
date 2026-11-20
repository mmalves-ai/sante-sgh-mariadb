// M35: "Administração > Coexistência com o legado > Testes de assinatura de dados" › aba "Prontidão por setor"
// (config.coexistencia.ler) e a carga somada do painel "Saúde das conexões e avisos de colisão"
// (config.conexao.ler). Só leitura do relatório gerado; nenhuma ação (as chaves continuam desligadas e são ligadas
// pelo comitê na tela de funcionalidades por estabelecimento).
import { Controller, Get, Inject } from '@nestjs/common';
import type { CargaProntidao, RelatorioProntidao } from '@sgh/contratos';
import { Permissao } from '../../autorizacao/decoradores.js';
import { FONTE_PRONTIDAO, type FonteProntidao } from './prontidao.js';

@Controller('config')
export class ProntidaoController {
  constructor(@Inject(FONTE_PRONTIDAO) private readonly fonte: FonteProntidao) {}

  @Get('prontidao')
  @Permissao('config.coexistencia.ler')
  prontidao(): { relatorio: RelatorioProntidao | null } {
    return { relatorio: this.fonte.relatorio() };
  }

  @Get('carga')
  @Permissao('config.conexao.ler')
  carga(): { carga: CargaProntidao | null } {
    return { carga: this.fonte.relatorio()?.carga ?? null };
  }
}
