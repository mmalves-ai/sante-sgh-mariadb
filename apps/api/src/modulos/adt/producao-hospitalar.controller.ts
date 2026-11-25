// Rotas da produção hospitalar mensal e da categoria clínica do atendimento (F8, 09-AREA linha 87):
//   GET  /api/internacao/producao-hospitalar?mes=AAAA-MM   o mês ao vivo e o apurado (internacao.censo.ler)
//   POST /api/internacao/producao-hospitalar/apurar        apurar (e fechar) o mês (faturamento.competencia.fechar)
//   GET  /api/internacao/producao-hospitalar/faixas        faixas de valor por categoria (internacao.censo.ler)
//   POST /api/internacao/producao-hospitalar/faixas        incluir faixa (faturamento.regra.editar)
//   GET  /api/internacao/producao-hospitalar/categorias?atendimento=NUM   visão por paciente (internacao.internacao.ler)
//   POST /api/internacao/producao-hospitalar/categorias    mudar a categoria clínica (internacao.troca.criar)
// Gravações pelo executor (trilha e autoria na mesma transação, Idempotency-Key). Sem banco próprio, 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { corpo } from '../agenda/agendas.controller.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  type CategoriasDoAtendimento,
  esquemaApurarProducao,
  esquemaFaixaCategoria,
  esquemaPeriodoCategoria,
  type FaixaVisao,
  type Opcao,
  type PainelProducao,
  PORTA_PRODUCAO_HOSPITALAR,
  type PortaProducaoHospitalarPropria,
} from './producao-hospitalar-propria.js';

@Controller('internacao/producao-hospitalar')
export class ProducaoHospitalarController {
  constructor(
    @Optional()
    @Inject(PORTA_PRODUCAO_HOSPITALAR)
    private readonly porta: PortaProducaoHospitalarPropria | null = null,
  ) {}

  private exigirBanco(): PortaProducaoHospitalarPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'A produção hospitalar fica no banco do estabelecimento, que não está configurado.',
      );
    return this.porta;
  }

  private gravacao(req: RequisicaoAutorizada, operacao: string) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, operacao, true);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get()
  @Permissao('internacao.censo.ler')
  painel(@Query('mes') mes: string, @Req() req: RequisicaoAutorizada): Promise<PainelProducao> {
    if (!/^\d{4}-\d{2}$/.test(mes ?? ''))
      throw new ErroProblema('entrada-invalida', 400, 'Mês inválido', 'Escolha o mês (AAAA-MM).');
    const s = sessaoDe(req);
    return this.exigirBanco().painel({ hospital: s.hospital, login: s.login }, mes);
  }

  @Post('apurar')
  @HttpCode(200)
  @Permissao('faturamento.competencia.fechar')
  @AuditadoNoHandler('internacao.apurar_producao_mensal pelo executor (trilha na mesma transação)')
  async apurar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaApurarProducao, b);
    const r = await this.exigirBanco().apurar(this.gravacao(req, 'internacao.apurarProducaoMensal'), e);
    return {
      ok: true,
      resultado: r.resultado,
      repetida: r.repetida,
      mensagem: e.fechar ? 'Produção do mês apurada e fechada.' : 'Produção do mês apurada.',
    };
  }

  @Get('faixas')
  @Permissao('internacao.censo.ler')
  faixas(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ hoje: string; faixas: FaixaVisao[]; clinicas: Opcao[] }> {
    const s = sessaoDe(req);
    return this.exigirBanco().faixas({ hospital: s.hospital, login: s.login });
  }

  @Post('faixas')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler('internacao.incluir_faixa_categoria_clinica pelo executor (trilha na mesma transação)')
  async incluirFaixa(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaFaixaCategoria, b);
    const r = await this.exigirBanco().incluirFaixa(
      this.gravacao(req, 'internacao.incluirFaixaCategoria'),
      e,
    );
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem: 'Faixa de valor gravada.' };
  }

  @Get('categorias')
  @Permissao('internacao.internacao.ler')
  categorias(
    @Query('atendimento') numero: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CategoriasDoAtendimento> {
    if (!numero?.trim() || numero.length > 20)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Atendimento inválido',
        'Informe o número do atendimento.',
      );
    const s = sessaoDe(req);
    return this.exigirBanco().categorias({ hospital: s.hospital, login: s.login }, numero);
  }

  @Post('categorias')
  @HttpCode(200)
  @Permissao('internacao.troca.criar')
  @AuditadoNoHandler('internacao.classificar_categoria_clinica pelo executor (trilha na mesma transação)')
  async classificar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaPeriodoCategoria, b);
    const r = await this.exigirBanco().classificar(
      this.gravacao(req, 'internacao.classificarCategoriaClinica'),
      e,
    );
    return {
      ok: true,
      resultado: r.resultado,
      repetida: r.repetida,
      mensagem: 'Categoria clínica atualizada.',
    };
  }
}
