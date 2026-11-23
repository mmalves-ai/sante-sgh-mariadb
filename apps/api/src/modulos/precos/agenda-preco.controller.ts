// ADR 0009, rotas (permissões no formato modulo.recurso.acao):
//   GET  /api/precos-particulares?profissional&agenda&convenio&vigentesEm   preco.regraParticular.ler
//   POST /api/precos-particulares                                         preco.regraParticular.editar (só particular)
//   GET  /api/precos-particulares/calculo?convenio&plano&profissional&agenda&item&consulta&tabelaConta&data
//                                                                         preco.regraParticular.ler (valor + origem)
//   GET  /api/credenciamentos?profissional&convenio&data                  convenio.credenciamento.ler
//   POST /api/credenciamentos                                             convenio.credenciamento.editar
//   GET  /api/credenciamentos/verificacao?profissional&convenio&plano&data convenio.credenciamento.ler (alerta|bloqueio)
//   GET  /api/convenios/:id/opcoes-credenciamento                         convenio.credenciamento.ler
//   PUT  /api/convenios/:id/opcoes-credenciamento                         convenio.credenciamento.editar
//   POST /api/convenios/:id/credenciar-todos                              convenio.credenciamento.editar
//   POST /api/convenios                                                   convenio.contrato.editar (convênio novo;
//        com credenciaTodosAoCriar, credencia os médicos ativos na mesma transação: decisão 26)
//   GET  /api/agendas/:id/estruturada?data                                agenda.estruturada.ler
//   GET  /api/agendas/:id/respostas?data&convenio&plano&idade&sexo&item&retorno&encaixe   agenda.estruturada.ler
//   POST /api/agendas/:id/coberturas | restricoes | preparos              agenda.estruturada.editar
//   PUT  /api/agendas/:id/coberturas/:regra | restricoes/:regra | preparos/:regra (com versão)  agenda.estruturada.editar
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { esquemaFiltroRegrasPrecoParticular } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  esquemaPedidoCalculo,
  esquemaPerguntasAgenda,
  type ServicoAgendaPreco,
} from './agenda-preco.servico.js';
import { contextoOperacao, ctxDe, inteiro, problemaDoPreco } from './base.js';

export const SERVICO_AGENDA_PRECO = Symbol('SERVICO_AGENDA_PRECO');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

const opc = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));
const nulo = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
const bool = (v: string | undefined) => v === '1' || v === 'true' || v === 'sim';

function validar<T>(esquema: z.ZodType<T>, bruto: unknown): T {
  const r = esquema.safeParse(bruto);
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Entrada inválida',
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return r.data;
}

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class AgendaPrecoController {
  constructor(@Inject(SERVICO_AGENDA_PRECO) private readonly servico: ServicoAgendaPreco | null) {}

  private s(): ServicoAgendaPreco {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'O banco próprio do cliente não está ligado.',
      );
    return this.servico;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  // ---------------------------------------------------------------- preço particular
  @Get('precos-particulares')
  @Permissao('preco.regraParticular.ler')
  regras(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const f = validar(esquemaFiltroRegrasPrecoParticular, {
      profissionalId: opc(q['profissional']),
      agendaId: opc(q['agenda']),
      fontePagadoraId: opc(q['convenio']),
      vigentesEm: q['vigentesEm'] || undefined,
    });
    return this.rodar(() => this.s().listarRegras(ctxDe(req, 'precos-particulares'), f));
  }

  @Post('precos-particulares')
  @HttpCode(201)
  @Permissao('preco.regraParticular.editar')
  @AuditadoNoHandler(EXECUTOR)
  incluirRegra(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().incluirRegra(contextoOperacao(req, 'precos-particulares'), corpo));
  }

  @Put('precos-particulares/:id')
  @HttpCode(200)
  @Permissao('preco.regraParticular.editar')
  @AuditadoNoHandler(EXECUTOR)
  revisarRegra(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const e = { ...objeto(corpo), id: inteiro(id, 'regra', [1, Number.MAX_SAFE_INTEGER]) };
    return this.rodar(() => this.s().revisarRegra(contextoOperacao(req, 'precos-particulares'), e));
  }

  /** Prévia do preço e do credenciamento de um procedimento no atendimento (tela de procedimentos, antes de lançar). */
  @Get('atendimento/:reg/preco')
  @Permissao('atendimento.procedimento.lancar')
  async precoDoAtendimento(
    @Param('reg') reg: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ) {
    const p = validar(
      z.object({
        procedimento: z.number().int().positive(),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      {
        procedimento: opc(q['procedimento']),
        data: q['data'] || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
      },
    );
    const r = await this.rodar(() =>
      this.s().precoDoAtendimento(
        ctxDe(req, 'atendimento-preco'),
        inteiro(reg, 'atendimento', [1, Number.MAX_SAFE_INTEGER]),
        p.procedimento,
        p.data,
      ),
    );
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'O atendimento não existe.');
    return r;
  }

  @Get('precos-particulares/calculo')
  @Permissao('preco.regraParticular.ler')
  calculo(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const p = validar(esquemaPedidoCalculo, {
      fontePagadoraId: nulo(q['convenio']),
      planoId: nulo(q['plano']),
      profissionalId: nulo(q['profissional']),
      agendaId: nulo(q['agenda']),
      itemFaturavelId: nulo(q['item']),
      consulta: bool(q['consulta']),
      tabelaContaId: nulo(q['tabelaConta']),
      data: q['data'],
    });
    return this.rodar(() => this.s().calcular(ctxDe(req, 'precos-particulares-calculo'), p));
  }

  // ---------------------------------------------------------------- credenciamento
  @Get('credenciamentos')
  @Permissao('convenio.credenciamento.ler')
  credenciamentos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const p = validar(
      z
        .object({
          profissionalId: z.number().int().positive().nullable(),
          fontePagadoraId: z.number().int().positive().nullable(),
          data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .refine((v) => v.profissionalId !== null || v.fontePagadoraId !== null, {
          message: 'informe o profissional ou o convênio',
          path: ['profissional'],
        }),
      { profissionalId: nulo(q['profissional']), fontePagadoraId: nulo(q['convenio']), data: q['data'] },
    );
    return this.rodar(() => this.s().credenciamentos(ctxDe(req, 'credenciamentos'), p));
  }

  @Post('credenciamentos')
  @HttpCode(201)
  @Permissao('convenio.credenciamento.editar')
  @AuditadoNoHandler(EXECUTOR)
  incluirCredenciamento(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().incluirCredenciamento(contextoOperacao(req, 'credenciamentos'), corpo));
  }

  @Get('credenciamentos/verificacao')
  @Permissao('convenio.credenciamento.ler')
  verificacao(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const p = validar(
      z.object({
        profissionalId: z.number().int().positive(),
        fontePagadoraId: z.number().int().positive(),
        planoId: z.number().int().positive().nullable(),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      {
        profissionalId: opc(q['profissional']),
        fontePagadoraId: opc(q['convenio']),
        planoId: nulo(q['plano']),
        data: q['data'],
      },
    );
    return this.rodar(() => this.s().verificar(ctxDe(req, 'credenciamentos-verificacao'), p));
  }

  @Get('convenios/:id/opcoes-credenciamento')
  @Permissao('convenio.credenciamento.ler')
  async opcoes(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const r = await this.rodar(() =>
      this.s().opcoes(ctxDe(req, 'convenio-opcoes'), inteiro(id, 'convênio', [1, Number.MAX_SAFE_INTEGER])),
    );
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'O convênio não existe.');
    return r;
  }

  @Put('convenios/:id/opcoes-credenciamento')
  @HttpCode(200)
  @Permissao('convenio.credenciamento.editar')
  @AuditadoNoHandler(EXECUTOR)
  definirOpcoes(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const e = { ...objeto(corpo), fontePagadoraId: inteiro(id, 'convênio', [1, Number.MAX_SAFE_INTEGER]) };
    return this.rodar(() => this.s().definirOpcoes(contextoOperacao(req, 'convenio-opcoes'), e));
  }

  @Post('convenios')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  incluirConvenio(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() => this.s().incluirConvenio(contextoOperacao(req, 'convenio-novo'), objeto(corpo)));
  }

  @Post('convenios/:id/credenciar-todos')
  @HttpCode(200)
  @Permissao('convenio.credenciamento.editar')
  @AuditadoNoHandler(EXECUTOR)
  credenciarTodos(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const e = { ...objeto(corpo), fontePagadoraId: inteiro(id, 'convênio', [1, Number.MAX_SAFE_INTEGER]) };
    return this.rodar(() => this.s().credenciarTodos(contextoOperacao(req, 'convenio-credenciar-todos'), e));
  }

  // ---------------------------------------------------------------- agenda estruturada
  @Get('agendas/:id/estruturada')
  @Permissao('agenda.estruturada.ler')
  async estruturada(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ) {
    const data = q['data'] ? validar(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), q['data']) : undefined;
    const a = await this.rodar(() =>
      this.s().agendaEstruturada(
        ctxDe(req, 'agenda-estruturada'),
        inteiro(id, 'agenda', [1, Number.MAX_SAFE_INTEGER]),
        data,
      ),
    );
    if (!a) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'A agenda não existe.');
    return a;
  }

  @Get('agendas/:id/respostas')
  @Permissao('agenda.estruturada.ler')
  async respostas(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ) {
    const p = validar(esquemaPerguntasAgenda, {
      data: q['data'],
      fontePagadoraId: nulo(q['convenio']),
      planoId: nulo(q['plano']),
      idadeAnos: nulo(q['idade']),
      sexo: q['sexo'] || null,
      itemAgendavelId: nulo(q['item']),
      retorno: bool(q['retorno']),
      encaixe: bool(q['encaixe']),
    });
    const r = await this.rodar(() =>
      this.s().responder(
        ctxDe(req, 'agenda-respostas'),
        inteiro(id, 'agenda', [1, Number.MAX_SAFE_INTEGER]),
        p,
      ),
    );
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'A agenda não existe.');
    return r;
  }

  private daAgenda(id: string, corpo: unknown) {
    return { ...objeto(corpo), agendaId: inteiro(id, 'agenda', [1, Number.MAX_SAFE_INTEGER]) };
  }

  /** PUT de cobertura, restrição ou preparo: o corpo é a entrada inteira, com a versão lida. */
  private revisao(id: string, regra: string, corpo: unknown) {
    const { versao, ...valores } = objeto(corpo);
    return {
      id: inteiro(regra, 'regra', [1, Number.MAX_SAFE_INTEGER]),
      versao,
      valores: this.daAgenda(id, valores),
    };
  }

  @Put('agendas/:id/coberturas/:regra')
  @HttpCode(200)
  @Permissao('agenda.estruturada.editar')
  @AuditadoNoHandler(EXECUTOR)
  revisarCobertura(
    @Param('id') id: string,
    @Param('regra') regra: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.rodar(() =>
      this.s().revisarCobertura(contextoOperacao(req, 'agenda-cobertura'), this.revisao(id, regra, corpo)),
    );
  }

  @Put('agendas/:id/restricoes/:regra')
  @HttpCode(200)
  @Permissao('agenda.estruturada.editar')
  @AuditadoNoHandler(EXECUTOR)
  revisarRestricao(
    @Param('id') id: string,
    @Param('regra') regra: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.rodar(() =>
      this.s().revisarRestricao(contextoOperacao(req, 'agenda-restricao'), this.revisao(id, regra, corpo)),
    );
  }

  @Put('agendas/:id/preparos/:regra')
  @HttpCode(200)
  @Permissao('agenda.estruturada.editar')
  @AuditadoNoHandler(EXECUTOR)
  revisarPreparo(
    @Param('id') id: string,
    @Param('regra') regra: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.rodar(() =>
      this.s().revisarPreparo(contextoOperacao(req, 'agenda-preparo'), this.revisao(id, regra, corpo)),
    );
  }

  @Post('agendas/:id/coberturas')
  @HttpCode(201)
  @Permissao('agenda.estruturada.editar')
  @AuditadoNoHandler(EXECUTOR)
  cobertura(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().incluirCobertura(contextoOperacao(req, 'agenda-cobertura'), this.daAgenda(id, corpo)),
    );
  }

  @Post('agendas/:id/restricoes')
  @HttpCode(201)
  @Permissao('agenda.estruturada.editar')
  @AuditadoNoHandler(EXECUTOR)
  restricao(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().incluirRestricao(contextoOperacao(req, 'agenda-restricao'), this.daAgenda(id, corpo)),
    );
  }

  @Post('agendas/:id/preparos')
  @HttpCode(201)
  @Permissao('agenda.estruturada.editar')
  @AuditadoNoHandler(EXECUTOR)
  preparo(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.rodar(() =>
      this.s().incluirPreparo(contextoOperacao(req, 'agenda-preparo'), this.daAgenda(id, corpo)),
    );
  }
}
