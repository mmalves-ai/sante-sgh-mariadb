// Contratos com fornecedores (M55, etapa 3; ficha, seções 4, 5, 7 e 8; regras 5 a 8):
//   GET  /api/suprimentos/contratos?situacao=&faixa=&fornecedor=&termo=&pagina=  a lista (200 por página) com o fim
//                                                     vigente, a faixa do alerta e o saldo; o painel do dia
//   GET  /api/suprimentos/contratos/fornecedores?termo=  os fornecedores (código e nome) para a busca da tela
//   GET  /api/suprimentos/contratos/:id                  o detalhe: saldo com as parcelas, eventos, vínculos e avisos
//   GET  /api/suprimentos/contratos/:id/candidatos       os pedidos e os títulos do fornecedor ainda sem contrato
//   POST /api/suprimentos/contratos                      o cadastro (suprimentos.contrato.editar)
//   PUT  /api/suprimentos/contratos/:id                  a alteração do cadastro pela versão (editar)
//   POST /api/suprimentos/contratos/:id/aditamentos      aditivo, reajuste, renovação e a exceção da regra 7 (aditar)
//   POST /api/suprimentos/contratos/:id/avaliacoes       a avaliação do fornecedor (avaliar)
//   POST /api/suprimentos/contratos/:id/eventos          ocorrência, anexo, encerramento e rescisão (editar)
//   POST /api/suprimentos/contratos/:id/vinculos         liga ao contrato um pedido ou as parcelas de um título (editar)
// Tudo só do novo (SGH_), com a SGH_TRILHA na mesma transação. O pedido e o título com contrato nascem pelas telas de
// compras e de contas a pagar (o campo `contrato` das duas operações, com o vínculo na mesma transação). Nasce
// desligado (chave `contratos`, POL-3).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  type CandidatoVinculo,
  CHAVE_LIBERACAO_CONTRATOS,
  type ContratoDetalhe,
  type ContratoResumo,
  esquemaAlterarContrato,
  esquemaCriarContrato,
  esquemaFiltroContratosFornecedor,
  esquemaRegistrarEventoContrato,
  esquemaVincularContrato,
  EVENTOS_AUDITAVEIS,
  type GravacaoAgenda,
  type PainelContratos,
  PERMISSOES_CONTRATO_CODIGOS as P,
  type TipoEventoContrato,
  lerIdBanco,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import {
  type FornecedorContrato,
  type GravadorContrato,
  PORTA_CONTRATO,
  type PortaContrato,
  type UsuarioContrato,
} from './contrato-porta.js';

const E = EVENTOS_AUDITAVEIS;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;

/** Os eventos por rota (a permissão de agir de cada um). */
export const EVENTOS_POR_ROTA: Readonly<
  Record<'aditamentos' | 'avaliacoes' | 'eventos', readonly TipoEventoContrato[]>
> = {
  aditamentos: ['aditivo', 'reajuste', 'renovacao', 'excecao'],
  avaliacoes: ['avaliacao'],
  eventos: ['ocorrencia', 'anexo', 'encerramento', 'rescisao'],
};

const MENSAGEM_EVENTO: Readonly<Record<TipoEventoContrato, string>> = {
  aditivo: 'Termo aditivo registrado.',
  reajuste: 'Reajuste registrado pelo índice.',
  renovacao: 'Renovação registrada.',
  ocorrencia: 'Ocorrência registrada.',
  avaliacao: 'Avaliação do fornecedor registrada.',
  anexo: 'Anexo registrado.',
  excecao: 'Exceção aprovada: vale para um pedido ou título nos próximos 30 dias.',
  encerramento: 'Contrato encerrado.',
  rescisao: 'Contrato rescindido.',
};

export interface ResultadoContrato {
  readonly ok: true;
  readonly id: number;
  readonly repetido: boolean;
  readonly mensagem: string;
  readonly saldo: number | null;
}

function naoEncontrado(): ErroProblema {
  return new ErroProblema(
    'nao-encontrado',
    404,
    'Contrato não encontrado',
    'O contrato não existe neste estabelecimento.',
  );
}

function idDe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw naoEncontrado();
  return n;
}

@Controller('suprimentos/contratos')
export class ContratoController {
  private readonly apoio: ApoioGravacao<GravadorContrato>;

  constructor(
    @Inject(PORTA_CONTRATO) private readonly porta: PortaContrato,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_CONTRATOS, nome: 'os contratos com fornecedores', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private chave(s: SessaoCadastro, doCorpo: string): string {
    const bruto = s.req.headers['idempotency-key'];
    const k = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof k !== 'string' || !CHAVE.test(k) || k !== doCorpo)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'A Idempotency-Key do pedido falta ou difere da chave do corpo.',
      );
    return k;
  }

  @Get()
  @Permissao(P.ler)
  async lista(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    hoje: string;
    itens: ContratoResumo[];
    pagina: number;
    cortada: boolean;
    painel: PainelContratos;
    gravacao: GravacaoAgenda;
  }> {
    const s = sessaoDe(req);
    const num = (v: string | undefined) => (v ? (lerIdBanco(v) ?? undefined) : undefined);
    const f = corpo(esquemaFiltroContratosFornecedor, {
      ...(q['situacao'] ? { situacao: q['situacao'] } : {}),
      ...(q['faixa'] ? { faixa: q['faixa'] } : {}),
      ...(num(q['fornecedor']) ? { fornecedor: num(q['fornecedor']) } : {}),
      ...(q['termo'] ? { termo: q['termo'] } : {}),
      ...(num(q['pagina']) ? { pagina: num(q['pagina']) } : {}),
    });
    const [lista, painel, gravacao] = await Promise.all([
      this.porta.listar(s.porta, f),
      this.porta.painel(s.porta),
      this.apoio.gravacao(s, { editar: P.editar, aditar: P.aditar, avaliar: P.avaliar }),
    ]);
    return { ...lista, painel, gravacao };
  }

  @Get('fornecedores')
  @Permissao(P.ler)
  async fornecedores(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: FornecedorContrato[]; cortada: boolean }> {
    const t = (termo ?? '').trim();
    if (t.length < 2) return { itens: [], cortada: false };
    return this.porta.fornecedores(sessaoDe(req).porta, t.slice(0, 60));
  }

  @Get('usuarios')
  @Permissao(P.ler)
  async usuarios(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: UsuarioContrato[] }> {
    const t = (termo ?? '').trim();
    if (t.length < 2) return { itens: [] };
    return { itens: await this.porta.usuarios(sessaoDe(req).porta, t.slice(0, 31)) };
  }

  @Get('centros')
  @Permissao(P.ler)
  async centros(@Req() req: RequisicaoAutorizada): Promise<{ itens: FornecedorContrato[] }> {
    return { itens: await this.porta.centros(sessaoDe(req).porta) };
  }

  @Get(':id')
  @Permissao(P.ler)
  async detalhe(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContratoDetalhe & { gravacao: GravacaoAgenda }> {
    const s = sessaoDe(req);
    const [c, gravacao] = await Promise.all([
      this.porta.detalhar(s.porta, idDe(id)),
      this.apoio.gravacao(s, { editar: P.editar, aditar: P.aditar, avaliar: P.avaliar }),
    ]);
    if (!c) throw naoEncontrado();
    return { ...c, gravacao };
  }

  @Get(':id/candidatos')
  @Permissao(P.editar)
  async candidatos(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: CandidatoVinculo[] }> {
    const r = await this.porta.candidatos(sessaoDe(req).porta, idDe(id));
    if (!r) throw naoEncontrado();
    return { itens: r };
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.criarContrato: SGH_SUP_CONTRATO com a SGH_TRILHA na mesma transação')
  async criar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoContrato> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCriarContrato, b);
    this.chave(s, e.chave);
    const x = await this.apoio.sgh(
      s,
      E.contratoCriado.codigo,
      P.editar,
      (y: { id: number }) => ({
        tabela: 'SGH_SUP_CONTRATO',
        id: String(y.id),
        paciente: null,
        chave: e.numero,
      }),
      (g) => g.criar({ entrada: e, usuario: s.login }),
    );
    return {
      ok: true,
      id: x.id,
      repetido: x.repetido,
      mensagem: x.repetido ? 'Este contrato já estava cadastrado.' : 'Contrato cadastrado.',
      saldo: null,
    };
  }

  @Put(':id')
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.alterarContrato: SGH_SUP_CONTRATO com a SGH_TRILHA na mesma transação')
  async alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContrato> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaAlterarContrato, b);
    const x = await this.apoio.sgh(
      s,
      E.contratoAlterado.codigo,
      P.editar,
      { tabela: 'SGH_SUP_CONTRATO', id: String(n), paciente: null },
      (g) => g.alterar({ id: n, entrada: e, usuario: s.login }),
    );
    return { ok: true, id: x.id, repetido: false, mensagem: 'Cadastro do contrato alterado.', saldo: null };
  }

  private async evento(
    rota: keyof typeof EVENTOS_POR_ROTA,
    permissao: string,
    id: string,
    b: unknown,
    req: RequisicaoAutorizada,
  ): Promise<ResultadoContrato> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaRegistrarEventoContrato, b);
    if (!EVENTOS_POR_ROTA[rota].includes(e.tipo))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inválido',
        'Este evento não é registrado por esta ação.',
        {
          campos: ['tipo'],
        },
      );
    this.chave(s, e.chave);
    const x = await this.apoio.sgh(
      s,
      E.contratoEvento.codigo,
      permissao,
      (y: { evento: number }) => ({
        tabela: 'SGH_SUP_CONTRATO_EVENTO',
        id: String(y.evento),
        paciente: null,
        chave: `${n}:${e.tipo}`,
      }),
      (g) => g.evento({ contrato: n, entrada: e, usuario: s.login }),
    );
    return {
      ok: true,
      id: x.evento,
      repetido: x.repetido,
      mensagem: x.repetido ? 'Este evento já estava registrado.' : MENSAGEM_EVENTO[e.tipo],
      saldo: null,
    };
  }

  @Post(':id/aditamentos')
  @HttpCode(201)
  @Permissao(P.aditar)
  @AuditadoNoHandler(
    'suprimentos.registrarEventoContrato: SGH_SUP_CONTRATO_EVENTO com a SGH_TRILHA na mesma transação',
  )
  aditamento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.evento('aditamentos', P.aditar, id, b, req);
  }

  @Post(':id/avaliacoes')
  @HttpCode(201)
  @Permissao(P.avaliar)
  @AuditadoNoHandler(
    'suprimentos.registrarEventoContrato: SGH_SUP_CONTRATO_EVENTO com a SGH_TRILHA na mesma transação',
  )
  avaliacao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.evento('avaliacoes', P.avaliar, id, b, req);
  }

  @Post(':id/eventos')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler(
    'suprimentos.registrarEventoContrato: SGH_SUP_CONTRATO_EVENTO com a SGH_TRILHA na mesma transação',
  )
  eventoComum(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.evento('eventos', P.editar, id, b, req);
  }

  @Post(':id/vinculos')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler(
    'suprimentos.vincularContrato: SGH_SUP_CONTRATO_VINCULO com a SGH_TRILHA na mesma transação',
  )
  async vincular(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContrato> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaVincularContrato, b);
    const chave = this.chave(s, e.chave);
    const x = await this.apoio.sgh(
      s,
      E.contratoVinculo.codigo,
      P.editar,
      (y: { vinculos: readonly number[] }) => ({
        tabela: 'SGH_SUP_CONTRATO_VINCULO',
        id: String(y.vinculos[0] ?? ''),
        paciente: null,
        chave: `${n}:${e.tipo}:${e.ids.join(',')}`.slice(0, 120),
      }),
      (g) =>
        g.vincular({
          contrato: { contrato: n, excecao: e.excecao, pedidoDeOrigem: e.pedidoDeOrigem },
          tipo: e.tipo,
          ids: e.ids,
          usuario: s.login,
          chave: `tela:${chave}`,
        }),
    );
    return {
      ok: true,
      id: x.vinculos[0] ?? 0,
      repetido: x.repetido,
      mensagem: x.repetido
        ? 'Este vínculo já estava registrado.'
        : e.tipo === 'pedido'
          ? 'Pedido ligado ao contrato.'
          : 'Título ligado ao contrato.',
      saldo: x.repetido ? null : x.saldoDepois,
    };
  }
}
