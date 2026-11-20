// Holerite do autosserviço (M53.3, etapa F2; ficha do M53, "Habilita: M52 (holerite no autosserviço)";
// `pessoas.autoatendimento.ler`, só o próprio; regra 21 do M52):
//   GET /api/pessoas/meu/holerite[?competencia=AAAA-MM&vinculo=]   as linhas do próprio vínculo no cálculo em vigor
//   GET /api/pessoas/meu/holerite/pdf[?competencia&vinculo]        o mesmo holerite em PDF/A (ficha, seção 10)
// O vínculo é o do login (outro vínculo é recusado, como no "Meu espaço"); a leitura é auditada (dado pessoal do próprio
// colaborador). Os encargos da empresa não saem no holerite. Desligada a folha, só a frase de onde consultar.
import { Controller, Get, Inject, Optional, Query, Req, Res } from '@nestjs/common';
import { esquemaFiltroMeuHolerite, EVENTOS_AUDITAVEIS, type MeuHolerite } from '@sgh/contratos';
import { escopoProprio } from '@sgh/dominio-pessoas';
import { Auditar, Permissao } from '../../../autorizacao/decoradores.js';
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
import { ErroProblema } from '../../../problema.filter.js';
import { PORTA_REALIZADO, type PortaRealizado } from '../escala/porta-realizado.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from '../folha/porta-calculo.js';
import {
  GERADOR_PDF_FOLHA,
  type GeradorPdfFolha,
  htmlHolerite,
  responderPdf,
  type RespostaPdf,
} from '../folha/documentos-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from '../folha/porta-folha.js';
import { ServicoCalculoFolha } from '../folha/servico-calculo.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { PORTA_RUBRICAS, type PortaRubricas } from '../rubricas/porta-rubricas.js';
import { vinculosDoLogin } from './servico-meu-espaco.js';

@Controller('pessoas/meu/holerite')
export class MeuHoleriteController {
  readonly calculo: ServicoCalculoFolha;

  constructor(
    @Inject(PORTA_CALCULO_FOLHA) porta: PortaCalculoFolha,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas,
    @Inject(PORTA_PESSOAS) readonly pessoas: PortaPessoas,
    @Inject(PORTA_PONTO) readonly ponto: PortaPonto,
    @Inject(PORTA_REALIZADO) realizado: PortaRealizado,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_FOLHA) private readonly pdf: GeradorPdfFolha | null = null,
  ) {
    this.calculo = new ServicoCalculoFolha(
      porta,
      folha,
      rubricas,
      pessoas,
      ponto,
      realizado,
      trilha,
      configuracao,
      cache,
    );
  }

  private async meu(q: Record<string, string>, req: RequisicaoAutorizada): Promise<MeuHolerite> {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroMeuHolerite, q);
    const vs = await vinculosDoLogin(this.pessoas, this.ponto, s);
    const escopo = escopoProprio(
      vs.map((v) => ({ id: v.id, ativo: v.desligamento === null })),
      f.vinculo ?? null,
    );
    if (escopo.recusa)
      throw new ErroProblema('sem-permissao', 403, 'Só o próprio', escopo.recusa.mensagem, {
        codigo: escopo.recusa.codigo,
      });
    return this.calculo.holerite(s, escopo.vinculo, f.competencia ?? null);
  }

  @Get()
  @Permissao('pessoas.autoatendimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.pessoasHoleriteLido.codigo)
  holerite(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<MeuHolerite> {
    return this.meu(q, req);
  }

  @Get('pdf')
  @Permissao('pessoas.autoatendimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.pessoasHoleriteLido.codigo)
  async holeritePdf(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: RespostaPdf,
  ) {
    const h = await this.meu(q, req);
    if (!h.disponivel || h.vinculo === null || !h.calculado)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Holerite não encontrado',
        h.mensagem ?? 'O holerite desta competência ainda não foi calculado.',
      );
    return responderPdf(
      this.pdf,
      res,
      htmlHolerite(h),
      `Holerite ${h.competencia}`,
      `holerite-${h.competencia}`,
    );
  }
}
