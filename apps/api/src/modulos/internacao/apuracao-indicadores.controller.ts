// Rotas da apuração dos indicadores obrigatórios de internação (01-REL L112; F3; sem chave de liberação: só a
// permissão):
//   GET  /api/relatorios/indicadores-internacao/apuracao?competencia=AAAA-MM   as apurações gravadas do mês
//   POST /api/relatorios/indicadores-internacao/apuracao  { competencia }       apura o mês pelo censo e grava
// O cálculo sai do motor do censo (bases mensais: paciente-dia, leito-dia, saídas, óbitos) pela regra do domínio
// (apurarIndicadoresInternacao); a gravação é da porta própria (apuracao_indicador com numerador e denominador).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import { PERMISSOES_M16_CODIGOS, PERMISSOES_M34_CODIGOS } from '@sgh/contratos';
import { mesDoDia } from '@sgh/dominio-internacao';
import { apurarIndicadoresInternacao, conferirCompetenciaApuracao } from '@sgh/dominio-relatorio';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import type { ContextoComunicacao } from '../integracao/comunicacao-base-propria.js';
import {
  PORTA_APURACAO_INTERNACAO,
  type PortaApuracaoInternacaoPropria,
} from '../relatorio/apuracao-internacao-propria.js';
import type { ConfiguracaoM16 } from './configuracao.js';
import { ctxM16 } from './leitos.controller.js';
import type { ServicoInternacao } from './servico.js';
import { CONFIGURACAO_M16, SERVICO_INTERNACAO } from './simbolos.js';

const TRILHA = 'apuração mensal dos indicadores de internação pelo executor (trilha na mesma transação)';
const esquemaCompetencia = z.object({ competencia: z.string().trim().max(7) });

@Controller('relatorios/indicadores-internacao')
export class ApuracaoIndicadoresController {
  constructor(
    @Inject(SERVICO_INTERNACAO) private readonly servico: ServicoInternacao,
    @Inject(CONFIGURACAO_M16) private readonly cfg: ConfiguracaoM16,
    @Optional()
    @Inject(PORTA_APURACAO_INTERNACAO)
    private readonly porta: PortaApuracaoInternacaoPropria | null = null,
  ) {}

  private competencia(entrada: unknown, mesAtual: string): string {
    const r = esquemaCompetencia.safeParse(entrada);
    const competencia = r.success ? r.data.competencia : '';
    const erros = conferirCompetenciaApuracao(competencia, mesAtual);
    if (erros.length > 0)
      throw new ErroProblema('entrada-invalida', 422, 'Competência recusada', erros[0]!.mensagem);
    return competencia;
  }

  private exigirPorta(): PortaApuracaoInternacaoPropria {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return this.porta;
  }

  @Get('apuracao')
  @Permissao(PERMISSOES_M16_CODIGOS.indicadoresLer)
  async ler(@Req() req: RequisicaoAutorizada, @Query() q: Record<string, string>) {
    const porta = this.exigirPorta();
    const competencia = this.competencia(q, '9999-12');
    const s = sessaoDe(req);
    return { competencia, apuracoes: await porta.lerApuracoes(s.porta as ContextoComunicacao, competencia) };
  }

  @Post('apuracao')
  @HttpCode(200)
  @Permissao(PERMISSOES_M34_CODIGOS.indicadorApurar)
  @AuditadoNoHandler(TRILHA)
  async apurar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    const porta = this.exigirPorta();
    const s = sessaoDe(req);
    const p = await this.cfg.parametros(s);
    const { motor, lidoEm } = await this.servico.motor(ctxM16(s, 'apuracao-indicadores'), p);
    const competencia = this.competencia(corpo, mesDoDia(motor.diaAtual));
    const apuracoes = apurarIndicadoresInternacao(motor.basesMensais(competencia, competencia), p.metas);
    try {
      const r = await porta.apurar(s.porta as ContextoComunicacao, apuracoes, new Date(lidoEm));
      return {
        competencia,
        incluidas: r.incluidas,
        atualizadas: r.atualizadas,
        mantidasFechadas: r.mantidasFechadas,
        semMudanca: r.semMudanca,
        apuracoes: await porta.lerApuracoes(s.porta as ContextoComunicacao, competencia),
      };
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }
}
