// Motor de preços (consulta; ficha do M12, seção 7):
//   GET /api/faturamento/credenciamento?convenio&pagina            credenciamento e código do prestador (as colunas
//                                                                bancárias só com cadastro.credenciamento.verBancario)
//   GET /api/faturamento/credenciamento/complementar?convenio      atos, Unimed e auditoras do Planserv
//   GET /api/faturamento/de-para-exames?convenio&exame&pagina       de-para de exames por convênio
//   GET /api/faturamento/portes?tabela&pagina                      portes anestésicos
//   GET /api/faturamento/terceiros/tabelas · /terceiros?tabela&busca&pagina · /unimed?busca&pagina
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { PaginaGenerica } from '@sgh/contratos';
import type { Pagina } from './tipos.js';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ctxDe, filtroConvenioDaSessao, inteiro, inteiroOuNulo, paginaDe, podeNa } from './base.js';
import { FONTE_PRECOS, type FontePrecos } from './fonte.js';

const pg = (r: Pagina, p: { pagina: number; porPagina: number }, avisos: string[] = []): PaginaGenerica => ({
  colunas: [...r.colunas],
  itens: [...r.itens],
  total: r.total,
  ...p,
  avisos,
});

@Controller('faturamento')
export class MotorController {
  constructor(@Inject(FONTE_PRECOS) private readonly fonte: FontePrecos) {}

  /**
   * Convênio pedido dentro do escopo da sessão (fora dele: nenhum item, sem vazar). Sem convênio pedido, a
   * lista do escopo da sessão: com escopo restrito, omitir o convênio nunca vira "todos".
   */
  private convenio(req: RequisicaoAutorizada, q: Record<string, string>) {
    return filtroConvenioDaSessao(req, inteiroOuNulo(q['convenio'], 'convenio'));
  }

  /** Profissional do filtro: registro no conselho (dígitos) ou trecho do nome, sem acento e sem caixa. */
  private profissional(q: Record<string, string>): string | null {
    const t = (q['profissional'] ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase()
      .slice(0, 60);
    return t || null;
  }

  @Get('credenciamento')
  @Permissao('convenio.credenciamento.ler')
  async credenciamento(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaGenerica> {
    const p = paginaDe(q);
    const conv = this.convenio(req, q);
    const bancario = podeNa(req, 'cadastro.credenciamento.verBancario');
    if (conv === 'fora') return pg({ colunas: [], itens: [], total: 0 }, p);
    const r = await this.fonte.credenciamento(
      ctxDe(req, 'credenciamento'),
      conv,
      p.pagina,
      p.porPagina,
      bancario,
      this.profissional(q),
    );
    return pg(
      r,
      p,
      bancario ? [] : ['As colunas bancárias exigem a permissão "ver dados bancários do credenciamento".'],
    );
  }

  @Get('credenciamento/complementar')
  @Permissao('convenio.credenciamento.ler')
  async complementar(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const conv = this.convenio(req, q);
    if (conv === 'fora')
      return { atos: pg({ colunas: [], itens: [], total: 0 }, { pagina: 0, porPagina: 500 }) };
    const ctx = ctxDe(req, 'credenciamento');
    const bancario = podeNa(req, 'cadastro.credenciamento.verBancario');
    const [atos, comp] = await Promise.all([
      this.fonte.credenciamentoAtos(ctx, conv, bancario),
      this.fonte.credenciamentoComplementar(ctx, conv, this.profissional(q)),
    ]);
    const p = { pagina: 0, porPagina: 500 };
    return { atos: pg(atos, p), unimed: pg(comp.unimed, p), auditoras: pg(comp.auditoras, p) };
  }

  @Get('de-para-exames')
  @Permissao('preco.dePara.ler')
  async dePara(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaGenerica> {
    const p = paginaDe(q);
    const conv = this.convenio(req, q);
    if (conv === 'fora') return pg({ colunas: [], itens: [], total: 0 }, p);
    const exame = (q['exame'] ?? '').trim().toUpperCase().slice(0, 4) || null;
    return pg(await this.fonte.dePara(ctxDe(req, 'de-para'), conv, exame, p.pagina, p.porPagina), p);
  }

  @Get('portes')
  @Permissao('preco.porte.ler')
  async portes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaGenerica> {
    const p = paginaDe(q);
    const ctx = ctxDe(req, 'portes');
    // Por convênio: a tabela de porte do contrato (a do contrato), dentro do escopo; senão, a tabela pedida.
    let tabela = inteiroOuNulo(q['tabela'], 'tabela');
    const pedido = inteiroOuNulo(q['convenio'], 'convenio');
    if (pedido !== null) {
      const f = filtroConvenioDaSessao(req, pedido);
      const conv = f === 'fora' ? null : await this.fonte.convenio(ctx, pedido);
      if (!conv || conv.porte === null)
        return pg({ colunas: [], itens: [], total: 0 }, p, [
          conv ? 'O convênio não tem tabela de porte no contrato.' : 'Convênio não encontrado.',
        ]);
      tabela = conv.porte;
    }
    return pg(await this.fonte.portes(ctx, tabela, p.pagina, p.porPagina), p);
  }

  @Get('terceiros/tabelas')
  @Permissao('preco.porte.ler')
  async tabelasTerceiros(@Req() req: RequisicaoAutorizada) {
    return { tabelas: await this.fonte.tabelasTerceiros(ctxDe(req, 'terceiros')) };
  }

  @Get('terceiros')
  @Permissao('preco.porte.ler')
  async terceiros(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaGenerica> {
    const p = paginaDe(q);
    const tab = inteiro(q['tabela'], 'tabela');
    return pg(
      await this.fonte.terceiros(
        ctxDe(req, 'terceiros'),
        tab,
        (q['busca'] ?? '').slice(0, 60),
        p.pagina,
        p.porPagina,
      ),
      p,
    );
  }

  @Get('unimed')
  @Permissao('preco.porte.ler')
  async unimed(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaGenerica> {
    const p = paginaDe(q);
    return pg(
      await this.fonte.unimed(ctxDe(req, 'unimed'), (q['busca'] ?? '').slice(0, 60), p.pagina, p.porPagina),
      p,
    );
  }
}
