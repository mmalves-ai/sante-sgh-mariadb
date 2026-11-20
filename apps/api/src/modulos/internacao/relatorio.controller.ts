// Relatórios e BI (M16; ficha, seção 7):
//   GET /api/relatorios/paineis/:painel?de&ate            assistencial, operacional ou financeiro (duas réguas)
//   GET /api/relatorios/indicadores?de&ate                índice: ficha, último mês fechado e situação diante da meta
//   GET /api/relatorios/indicadores/:codigo?de&ate&recorte&valor&detalhar   série, ano anterior, recortes e detalhe
//   GET /api/relatorios/indicadores/:codigo/exportar      planilha com numerador e denominador
//   GET /api/relatorios/bi                                a ferramenta de BI (endereço) e o que falta para abrir
// Painel financeiro: além de relatorio.paineis.ler, relatorio.financeiro.ler. Tudo depende da chave
// `relatorio.paineis` (o BI, da `relatorio.bi`). Só agregados: nada de pessoa sai daqui.
import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import {
  esquemaConsultaIndicador,
  esquemaConsultaPainel,
  EVENTOS_AUDITAVEIS,
  type IndiceIndicadores,
  PAINEIS_GERENCIAIS,
  type PainelGerencial,
  type PainelGerencialDados,
  PERMISSOES_M16_CODIGOS,
  recursoDesligado,
  type SerieIndicador,
} from '@sgh/contratos';
import { fichaDe, planilhaDaSerie } from '@sgh/dominio-relatorio';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, sessaoDe } from '../cadastro/comum.js';
import type { ConfiguracaoM16 } from './configuracao.js';
import { ctxM16, sujeitoDe } from './leitos.controller.js';
import type { ServicoInternacao } from './servico.js';
import { CONFIGURACAO_M16, SERVICO_INTERNACAO } from './simbolos.js';

const C = PERMISSOES_M16_CODIGOS;

interface RespostaArquivo {
  header(nome: string, valor: string): RespostaArquivo;
}

export interface DestinoBi {
  readonly ligado: boolean;
  readonly endereco: string | null;
  readonly motivo: string | null;
  readonly pendencias: readonly string[];
}

function consultaOu400<T>(r: { success: true; data: T } | { success: false }): T {
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Consulta inválida',
      'Confira o período (AAAA-MM) e o recorte.',
    );
  return r.data;
}

@Controller('relatorios')
export class RelatorioController {
  constructor(
    @Inject(SERVICO_INTERNACAO) private readonly servico: ServicoInternacao,
    @Inject(CONFIGURACAO_M16) private readonly cfg: ConfiguracaoM16,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
  ) {}

  @Get('paineis/:painel')
  @Permissao(C.paineisLer)
  @Auditar(EVENTOS_AUDITAVEIS.paineisConsultados.codigo)
  async painel(
    @Req() req: RequisicaoAutorizada,
    @Param('painel') painel: string,
    @Query() q: Record<string, string>,
  ): Promise<PainelGerencialDados> {
    const s = sessaoDe(req);
    if (!(PAINEIS_GERENCIAIS as readonly string[]).includes(painel))
      throw new ErroProblema('nao-encontrado', 404, 'Painel não encontrado');
    await this.cfg.exigir(sujeitoDe(s), 'paineis');
    if (painel === 'financeiro') await exigir(s, C.financeiroLer, this.trilha);
    const c = consultaOu400(esquemaConsultaPainel.safeParse(q));
    return this.servico.painelGerencial(
      ctxM16(s, `painel-${painel}`),
      await this.cfg.parametros(s),
      painel as PainelGerencial,
      c.de,
      c.ate,
    );
  }

  @Get('indicadores')
  @Permissao(C.indicadoresLer)
  @Auditar(EVENTOS_AUDITAVEIS.indicadoresConsultados.codigo)
  async indice(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
  ): Promise<IndiceIndicadores> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'paineis');
    const c = consultaOu400(esquemaConsultaPainel.safeParse(q));
    return this.servico.indice(ctxM16(s, 'indicadores'), await this.cfg.parametros(s), c.de, c.ate);
  }

  @Get('indicadores/:codigo')
  @Permissao(C.indicadoresLer)
  @Auditar(EVENTOS_AUDITAVEIS.indicadoresConsultados.codigo)
  async serie(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Query() q: Record<string, string>,
  ): Promise<SerieIndicador> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'paineis');
    const c = consultaOu400(esquemaConsultaIndicador.safeParse(q));
    return this.servico.serieIndicador(ctxM16(s, 'indicador'), await this.cfg.parametros(s), codigo, c);
  }

  @Get('indicadores/:codigo/exportar')
  @Permissao(C.indicadoresExportar)
  @Auditar(EVENTOS_AUDITAVEIS.indicadoresExportados.codigo)
  async exportar(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Query() q: Record<string, string>,
    @Res({ passthrough: true }) res: RespostaArquivo,
  ): Promise<string> {
    const s = sessaoDe(req);
    await this.cfg.exigir(sujeitoDe(s), 'paineis');
    const c = consultaOu400(esquemaConsultaIndicador.safeParse(q));
    const serie = await this.servico.serieIndicador(
      ctxM16(s, 'indicador-exportar'),
      await this.cfg.parametros(s),
      codigo,
      c,
    );
    const ficha = fichaDe(serie.ficha.codigo)!;
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', `attachment; filename="indicador-${ficha.codigo}.csv"`);
    return `\uFEFF${planilhaDaSerie(ficha, serie.valores)}`;
  }

  @Get('bi')
  @Permissao(C.biAcessar)
  @Auditar(EVENTOS_AUDITAVEIS.biAberto.codigo)
  async bi(@Req() req: RequisicaoAutorizada): Promise<DestinoBi> {
    const s = sessaoDe(req);
    const l = await this.cfg.liberacao(sujeitoDe(s));
    const endereco = process.env['BI_ENDERECO']?.trim() || null;
    const pendencias = (recursoDesligado('relatorio.bi')?.prerequisitos ?? []).map((p) => p.descricao);
    return {
      ligado: l.bi && endereco !== null,
      endereco: l.bi ? endereco : null,
      motivo: l.bi
        ? endereco
          ? null
          : 'O endereço da ferramenta de BI não está configurado neste ambiente.'
        : (l.motivos['bi'] ?? null),
      pendencias,
    };
  }
}
