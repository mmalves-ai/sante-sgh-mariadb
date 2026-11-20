// BI consolidado da Rede (M57, etapa 3; ficha, seção 7) — `Relatórios e BI > BI consolidado da Rede`:
//   GET /api/relatorios/bi/rede?de&ate                               indicadores consolidados (último mês fechado)
//   GET /api/relatorios/bi/rede/indicadores/:codigo?de&ate           a série consolidada, com as parcelas
//   GET /api/relatorios/bi/rede/indicadores/:codigo/exportar         planilha (a Rede e as parcelas de cada um)
//   GET /api/relatorios/bi/rede/paineis/:painel?de&ate               operacional ou financeiro da Rede
// Permissão `relatorio.biRede.acessar` (perfil da diretoria da Rede, sem nenhuma do prontuário: regra 10). A chave
// `rede.bi` no estabelecimento da sessão (desligada: 403 `recurso-desligado` com o motivo) e, nos outros, conferida
// estabelecimento a estabelecimento (o desligado fica fora do consolidado, com o motivo). Só agregados: nada de pessoa.
import { Controller, Get, Inject, Optional, Param, Query, Req, Res } from '@nestjs/common';
import {
  type BiRede,
  CHAVE_LIBERACAO_BI_REDE,
  CHAVE_PSEUDONIMO_COMUM_REDE,
  esquemaConsultaBiRede,
  EVENTOS_AUDITAVEIS,
  type PainelConsolidadoRede,
  PERMISSOES_REDE_BI_CODIGOS as P,
  type SerieIndicadorBiRede,
} from '@sgh/contratos';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import type { ConfiguracaoM16 } from '../internacao/configuracao.js';
import type { ServicoInternacao } from '../internacao/servico.js';
import { CONFIGURACAO_M16, SERVICO_INTERNACAO } from '../internacao/simbolos.js';
import { LiberacaoPep } from '../pep/liberacao-pep.js';
import { PORTA_REDE, type PortaRede } from '../rede/porta.js';
import { planilhaDaSerieRede, ServicoBiRede } from './aplicacao/bi-rede.js';

interface RespostaArquivo {
  header(nome: string, valor: string): RespostaArquivo;
}

function consulta(q: Record<string, string>): { de?: string; ate?: string } {
  const c = esquemaConsultaBiRede.safeParse(q);
  if (!c.success)
    throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida', 'Confira o período (AAAA-MM).');
  return { ...(c.data.de ? { de: c.data.de } : {}), ...(c.data.ate ? { ate: c.data.ate } : {}) };
}

@Controller('relatorios/bi/rede')
export class BiRedeController {
  readonly servico: ServicoBiRede;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(PORTA_REDE) porta: PortaRede,
    @Inject(SERVICO_INTERNACAO) internacao: ServicoInternacao,
    @Inject(CONFIGURACAO_M16) cfg: ConfiguracaoM16,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.liberacao = new LiberacaoPep(configuracao, cache);
    const liberacao = this.liberacao;
    this.servico = new ServicoBiRede({
      lista: porta,
      internacao,
      parametros: (rede, hospital) => cfg.parametros({ rede, hospital }),
      biLigado: (rede, hospital) =>
        liberacao.ligadaNoEstabelecimento(rede, hospital, CHAVE_LIBERACAO_BI_REDE),
      pseudonimoComum: (rede, hospital) =>
        liberacao.ligadaNoEstabelecimento(rede, hospital, CHAVE_PSEUDONIMO_COMUM_REDE),
    });
  }

  private async entrar(req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_BI_REDE);
    return { rede: s.rede, hospital: s.hospital };
  }

  @Get()
  @Permissao(P.biRedeAcessar)
  @Auditar(EVENTOS_AUDITAVEIS.biRedeConsultado.codigo)
  async consolidado(@Req() req: RequisicaoAutorizada, @Query() q: Record<string, string>): Promise<BiRede> {
    const s = await this.entrar(req);
    const c = consulta(q);
    return this.servico.consolidado(s, c.de, c.ate);
  }

  @Get('indicadores/:codigo')
  @Permissao(P.biRedeAcessar)
  @Auditar(EVENTOS_AUDITAVEIS.biRedeConsultado.codigo)
  async serie(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Query() q: Record<string, string>,
  ): Promise<SerieIndicadorBiRede> {
    const s = await this.entrar(req);
    const c = consulta(q);
    return this.servico.serie(s, codigo, c.de, c.ate);
  }

  @Get('indicadores/:codigo/exportar')
  @Permissao(P.biRedeAcessar)
  @Auditar(EVENTOS_AUDITAVEIS.biRedeExportado.codigo)
  async exportar(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Query() q: Record<string, string>,
    @Res({ passthrough: true }) res: RespostaArquivo,
  ): Promise<string> {
    const s = await this.entrar(req);
    const c = consulta(q);
    const serie = await this.servico.serie(s, codigo, c.de, c.ate);
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', `attachment; filename="rede-${serie.ficha.codigo}.csv"`);
    return `\uFEFF${planilhaDaSerieRede(serie)}`;
  }

  @Get('paineis/:painel')
  @Permissao(P.biRedeAcessar)
  @Auditar(EVENTOS_AUDITAVEIS.biRedeConsultado.codigo)
  async painel(
    @Req() req: RequisicaoAutorizada,
    @Param('painel') painel: string,
    @Query() q: Record<string, string>,
  ): Promise<PainelConsolidadoRede> {
    if (painel !== 'operacional' && painel !== 'financeiro')
      throw new ErroProblema('nao-encontrado', 404, 'Painel não encontrado');
    const s = await this.entrar(req);
    const c = consulta(q);
    return this.servico.painel(s, painel, c.de, c.ate);
  }
}
