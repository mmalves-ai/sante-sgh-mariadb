// Rotas da operadora própria na etapa F0 (M56; ficha, seções 4, 7 e 8). Só leitura:
//   GET /api/operadora/situacao                    chaves do módulo e das fatias no estabelecimento (regra 1)
//   GET /api/operadora/ans/sip/grupos              grupos de eventos do SIP
//   GET /api/operadora/ans/sip/procedimentos       procedimentos por grupo do SIP (grupo, vigentesEm, procedimento,
//                                                  apos), paginados por chave
//   GET /api/operadora/ans/classificacoes          classificação de procedimentos da ANS (busca, apos), paginada
// Os catálogos da ANS são domínio de leitura útil também ao hospital: valem com o módulo desligado (D-ANS-CONSULTA-56)
// e pedem `catalogo.ans.ler`, que quem consulta os catálogos oficiais no hospital tem (D-ANS-HOSPITAL-56);
// o que é movimento da operadora (beneficiário, cobrança, guia, conta, envio) é das fatias F1 a F8 e exige a chave da
// fatia (`ServicoSituacaoOperadora.exigir`).
import { Controller, Get, Inject, Optional, Query, Req } from '@nestjs/common';
import {
  type ClassificacoesAns,
  cursorSip,
  esquemaFiltroClassificacoesAns,
  esquemaFiltroProcedimentosSip,
  type GruposSip,
  lerCursorSip,
  type ProcedimentosSip,
  ROTAS_OPERADORA_F0 as R,
  type SituacaoOperadora,
} from '@sgh/contratos';
import type { z } from 'zod';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ServicoSituacaoOperadora } from './aplicacao/situacao.js';
import { PORTA_OPERADORA, type PortaOperadora } from './porta.js';

function entrada<T extends z.ZodType>(esquema: T, q: unknown): z.infer<T> {
  const r = esquema.safeParse(q ?? {});
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Parâmetros inválidos',
      r.error.issues[0]?.message ?? 'Filtro inválido.',
    );
  return r.data;
}

@Controller()
export class OperadoraController {
  readonly situacoes: ServicoSituacaoOperadora;

  constructor(
    @Inject(PORTA_OPERADORA) private readonly porta: PortaOperadora,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.situacoes = new ServicoSituacaoOperadora(fonte, cache);
  }

  @Get(R.situacao.caminho)
  @Permissao(R.situacao.permissao)
  situacao(@Req() req: RequisicaoAutorizada): Promise<SituacaoOperadora> {
    const s = sessaoDe(req);
    return this.situacoes.situacao({
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      setor: req.sgh?.sessao.unidadeAtiva ?? null,
    });
  }

  @Get(R.gruposSip.caminho)
  @Permissao(R.gruposSip.permissao)
  async gruposSip(@Req() req: RequisicaoAutorizada): Promise<GruposSip> {
    return { itens: await this.porta.gruposSip(sessaoDe(req).porta) };
  }

  @Get(R.procedimentosSip.caminho)
  @Permissao(R.procedimentosSip.permissao)
  async procedimentosSip(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProcedimentosSip> {
    const f = entrada(esquemaFiltroProcedimentosSip, q);
    const apos = f.apos ? lerCursorSip(f.apos) : null;
    const r = await this.porta.procedimentosSip(sessaoDe(req).porta, {
      ...(f.grupo !== undefined ? { grupo: f.grupo } : {}),
      ...(f.procedimento !== undefined ? { procedimento: f.procedimento } : {}),
      ...(f.vigentesEm !== undefined ? { vigentesEm: f.vigentesEm } : {}),
      ...(apos ? { apos } : {}),
    });
    return { itens: r.itens, proxima: r.proxima ? cursorSip(r.proxima) : null };
  }

  @Get(R.classificacoesAns.caminho)
  @Permissao(R.classificacoesAns.permissao)
  classificacoesAns(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ClassificacoesAns> {
    const f = entrada(esquemaFiltroClassificacoesAns, q);
    return this.porta.classificacoesAns(sessaoDe(req).porta, {
      ...(f.apos !== undefined ? { apos: f.apos } : {}),
      ...(f.busca !== undefined ? { busca: f.busca } : {}),
    });
  }
}
