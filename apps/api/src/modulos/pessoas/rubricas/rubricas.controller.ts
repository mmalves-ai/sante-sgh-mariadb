// Tela "Rubricas, incidências e tabelas legais" (M53, etapa F1; ficha, seção 7; `Gestão de pessoas > Folha de
// pagamento (rubricas, férias, rescisão)`):
//   GET /api/pessoas/folha/rubricas/apoio                               domínios oficiais, gravação e cadastros embutidos
//   GET /api/pessoas/folha/rubricas?competencia=AAAA-MM[&empresa][&todas=1]  rubricas em vigor e a conferência
//   GET /api/pessoas/folha/tabelas-legais?competencia=AAAA-MM          tabela legal em vigor e a conferência
// O apoio abre para quem tem qualquer parte da área (`pessoas.folha.abrir`, D-ABRIR-532); as rubricas pela permissão
// `pessoas.rubrica.ler` (opções Eventos do outro sistema) e as tabelas legais pela do próprio cadastro,
// `pessoas.tabelaLegalFolha.ler` (opção Tabela de cálculo), como o CRUD genérico do mesmo dado. A gravação é a do CRUD genérico (`/api/dominios/pessoas/<recurso>`), que exige também
// `pessoas.rubrica.editar` (permissão do grupo, ficha §7) e, nas rubricas e incidências, a chave `pessoas.folha`.
import { Controller, Get, Inject, Optional, Query, Req } from '@nestjs/common';
import {
  type ApoioRubricas,
  esquemaCompetenciaRubricas,
  type RubricasDaCompetencia,
  type TabelasLegaisDaCompetencia,
} from '@sgh/contratos';
import { z } from 'zod';
import { Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { PORTA_RUBRICAS, type PortaRubricas } from './porta-rubricas.js';
import { PERMISSOES_RUBRICAS, ServicoRubricas } from './servico-rubricas.js';

export const esquemaFiltroRubricas = z
  .object({
    competencia: esquemaCompetenciaRubricas,
    empresa: z.coerce.number().int().nonnegative().optional(),
    todas: z.enum(['0', '1']).optional(),
  })
  .strict();
export const esquemaFiltroTabelasLegais = z.object({ competencia: esquemaCompetenciaRubricas }).strict();

@Controller('pessoas/folha')
export class RubricasController {
  readonly servico: ServicoRubricas;

  constructor(
    @Inject(PORTA_RUBRICAS) porta: PortaRubricas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoRubricas(porta, trilha, configuracao, cache);
  }

  @Get('rubricas/apoio')
  @Permissao(PERMISSOES_RUBRICAS.abrir)
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioRubricas> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('rubricas')
  @Permissao(PERMISSOES_RUBRICAS.ler)
  rubricas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RubricasDaCompetencia> {
    const f = corpo(esquemaFiltroRubricas, q);
    return this.servico.rubricas(sessaoDe(req), f.competencia, {
      empresa: f.empresa ?? null,
      todas: f.todas === '1',
    });
  }

  @Get('tabelas-legais')
  @Permissao(PERMISSOES_RUBRICAS.tabelaLegalLer)
  tabelasLegais(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<TabelasLegaisDaCompetencia> {
    const f = corpo(esquemaFiltroTabelasLegais, q);
    return this.servico.tabelasLegais(sessaoDe(req), f.competencia);
  }
}
