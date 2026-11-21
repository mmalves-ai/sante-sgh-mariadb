// Tela do M04 "Saúde das conexões e avisos de colisão" (config.conexao.ler). Só leitura. M06: exige sessão e a
// permissão (guarda global com as regras CASL), em qualquer ambiente.
// Melhoria: a "Conferência de gravação" do sistema de origem (gatilhos, geradores, sentinelas) saiu (ADR 0003).
import { Controller, Get, Inject } from '@nestjs/common';
import type { PainelConexoes } from '@sgh/contratos';
import { Permissao } from '../../autorizacao/decoradores.js';
import { FONTE_GRAVACAO, type FonteGravacao } from './gravacao.js';

@Controller('config')
export class GravacaoController {
  constructor(@Inject(FONTE_GRAVACAO) private readonly fonte: FonteGravacao) {}

  @Get('conexoes')
  @Permissao('config.conexao.ler')
  conexoes(): Promise<PainelConexoes> {
    return this.fonte.painelConexoes();
  }
}
