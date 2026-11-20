// Telas do M04 em "Administração > Coexistência com o legado" (ficha, item 7): "Conferência de gravação
// (triggers, generators, sentinelas)" (config.gravacao.ler) e "Saúde das conexões e avisos de colisão"
// (config.conexao.ler). Só leitura. M06: exigem sessão e a permissão (guarda global com as regras CASL),
// em qualquer ambiente (pendência do M04 corrigida: antes respondiam sem login, só em AMBIENTE=dev).
import { Controller, Get, Inject } from '@nestjs/common';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { PainelConexoes, PainelGravacao } from '@sgh/contratos';
import { FONTE_GRAVACAO, type FonteGravacao } from './gravacao.js';

@Controller('config')
export class GravacaoController {
  constructor(@Inject(FONTE_GRAVACAO) private readonly fonte: FonteGravacao) {}

  @Get('gravacao')
  @Permissao('config.gravacao.ler')
  gravacao(): Promise<PainelGravacao> {
    return this.fonte.painelGravacao();
  }

  @Get('conexoes')
  @Permissao('config.conexao.ler')
  conexoes(): Promise<PainelConexoes> {
    return this.fonte.painelConexoes();
  }
}
