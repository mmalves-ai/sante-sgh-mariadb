// Rotas da remuneração e do pagamento do prestador da rede (08-SGO L102, C2-120). Base /api/operadora/remuneracao-rede.
// Cadastro da remuneração (tabela, item, regra, pacote, reajuste): operadora.prestador.ler / .editar. Pagamento
// (calendário, adiantamento, lote): operadora.conta.ler / .pagar. Cada gravação vai pela porta própria (Executor do
// núcleo), com a trilha_auditoria na mesma transação.
//   GET  :op/opcoes | :op/tabelas | :op/regras | :op/pacotes | :op/valorar?...          operadora.prestador.ler
//   GET  procedimentos?tipo=termo|item&busca= | tabela/:id/itens | contrato/:id/reajustes operadora.prestador.ler
//   POST :op/tabelas | tabela/:id/itens | :op/regras | :op/pacotes | contrato/:id/reajustes  operadora.prestador.editar
//   GET  :op/calendario?ano= | :op/lotes | :op/prestador/:p                              operadora.conta.ler
//   POST :op/calendario | calendario/:id/fechar | prestador/:p/adiantamentos             operadora.conta.pagar
//   POST :op/lotes | lote/:id/fechar | lote/:id/cancelar                                 operadora.conta.pagar
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type Gravado,
  PORTA_REMUNERACAO_REDE,
  type PortaRemuneracaoRedePropria,
} from './remuneracao-rede-propria.js';

const B = 'operadora/remuneracao-rede';
const LER = 'operadora.prestador.ler';
const EDITAR = 'operadora.prestador.editar';
const LER_PAG = 'operadora.conta.ler';
const PAGAR = 'operadora.conta.pagar';
const AUD = 'operadora.remuneracao.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dataNula = data.nullable().default(null);
const id = z.number().int().positive();
const idNulo = id.nullable().default(null);
const dinheiro = z.number().nonnegative().max(1_000_000_000);
const unidade = z.number().nonnegative().max(1_000_000).nullable().default(null);
const textoNulo = (n: number) => z.string().max(n).nullable().default(null);
const hora = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable()
  .default(null);

const esquemaTabela = z
  .object({
    codigo: z.string().min(1).max(30),
    nome: z.string().min(1).max(150),
    finalidade: z.enum(['pagamento_rede', 'referencia', 'custo', 'reembolso', 'intercambio']),
    tipoValor: z.enum(['valor_fixo', 'indice']),
    valorCh: unidade,
    valorUco: unidade,
    valorFilme: unidade,
    prestador: idNulo,
    inicio: data,
    fim: dataNula,
  })
  .strict();
const esquemaItem = z
  .object({
    procedimento: idNulo,
    grupo: idNulo,
    prestador: idNulo,
    valor: dinheiro.nullable().default(null),
    quantidadeCh: unidade,
    quantidadeUco: unidade,
    quantidadeFilme: unidade,
    inicio: data,
    fim: dataNula,
  })
  .strict();
const esquemaRegra = z
  .object({
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    prioridade: z.number().int().min(1).max(9999).default(100),
    prestador: idNulo,
    tipoPrestador: idNulo,
    grupo: idNulo,
    item: idNulo,
    tabela: id,
    fator: z.number().positive().max(100),
    acrescimo: z.number().min(0).max(500).nullable().default(null),
    diaSemana: z.number().int().min(1).max(7).nullable().default(null),
    horaInicio: hora,
    horaFim: hora,
    inicio: data,
    fim: dataNula,
  })
  .strict();
const esquemaPacote = z
  .object({
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    prestador: idNulo,
    principal: id,
    tipo: z.enum(['clinico', 'cirurgico', 'obstetrico', 'diagnostico', 'terapeutico', 'outro']),
    regime: z.enum(['ambulatorial', 'internacao', 'hospital_dia']).nullable().default(null),
    diarias: z.number().int().min(0).max(365).nullable().default(null),
    valorGlobal: dinheiro,
    inicio: data,
    fim: dataNula,
    inclusoes: textoNulo(4000),
    itens: z
      .array(
        z
          .object({
            item: id,
            inclusao: z.enum(['incluido', 'excluido']),
            quantidade: z.number().positive().max(100_000).nullable().default(null),
          })
          .strict(),
      )
      .max(500)
      .default([]),
  })
  .strict();
const esquemaReajuste = z
  .object({
    forma: z.enum(['acordo', 'indice_contratual', 'indice_legal']),
    indice: idNulo,
    percentual: z.number().min(-50).max(100),
    dataBase: data,
    inicio: data,
    descricao: textoNulo(2000),
    tabela: idNulo,
    grupo: idNulo,
  })
  .strict();
const esquemaCalendario = z
  .object({
    competencia: data,
    prestador: idNulo,
    atendimentoInicio: data,
    atendimentoFim: data,
    entregaInicio: dataNula,
    entregaFim: dataNula,
    corte: dataNula,
    pagamento: data,
  })
  .strict();
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();
const esquemaAdiantamento = z
  .object({
    descricao: z.string().min(1).max(150),
    data,
    valor: dinheiro,
    parcelas: z.number().int().min(1).max(60),
    inicioCompensacao: dataNula,
    natureza: id,
    documento: id,
    vencimento: data,
  })
  .strict();
const esquemaLote = z
  .object({
    prestador: id,
    competencia: data,
    vencimento: data,
    contas: z.array(id).max(1000),
    tributos: z
      .array(
        z
          .object({
            tributo: id,
            // Nula: vale a alíquota do cadastro (vigência e enquadramento); informada e diferente, é exceção com motivo.
            aliquota: z.number().min(0).max(100).nullable().default(null),
            deducao: dinheiro.default(0),
            motivo: textoNulo(300),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    mensagemPrestador: textoNulo(2000),
  })
  .strict();
const esquemaFechar = z.object({ versao: z.number().int().positive(), natureza: id, documento: id }).strict();
const esquemaValorar = z
  .object({
    prestador: z.coerce.number().int().positive(),
    procedimento: z.coerce.number().int().positive(),
    item: z.coerce.number().int().positive().nullable().default(null),
    grupo: z.coerce.number().int().positive().nullable().default(null),
    data,
    hora,
    urgencia: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    quantidade: z.coerce.number().positive().max(100_000).default(1),
  })
  .strip();

@Controller()
export class RemuneracaoRedeController {
  constructor(@Inject(PORTA_REMUNERACAO_REDE) private readonly porta: PortaRemuneracaoRedePropria) {}

  private trilha(s: SessaoCadastro, evento: string) {
    return (r: Gravado & { tabela: string }) =>
      linhaTrilha(s, evento, 'operadora.remuneracao', evento, { tabela: r.tabela, id: String(r.id) });
  }
  private ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  // ---------------------------------------------------------------- leituras do cadastro
  @Get(`${B}/procedimentos`)
  @Permissao(LER)
  procedimentos(
    @Query('tipo') tipo: unknown,
    @Query('busca') busca: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.ok(
      this.porta.procedimentos(
        sessaoDe(req).porta,
        tipo === 'item' ? 'item' : 'termo',
        typeof busca === 'string' ? busca.slice(0, 60) : '',
      ),
    );
  }
  @Get(`${B}/tabela/:id/itens`)
  @Permissao(LER)
  itens(@Param('id') t: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.itens(sessaoDe(req).porta, idDaRota(t)));
  }
  @Get(`${B}/contrato/:id/reajustes`)
  @Permissao(LER)
  reajustes(@Param('id') k: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.reajustes(sessaoDe(req).porta, idDaRota(k)));
  }
  @Get(`${B}/:op/opcoes`)
  @Permissao(LER)
  opcoes(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.opcoes(sessaoDe(req).porta, idDaRota(op)));
  }
  @Get(`${B}/:op/tabelas`)
  @Permissao(LER)
  tabelas(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.tabelas(sessaoDe(req).porta, idDaRota(op)));
  }
  @Get(`${B}/:op/regras`)
  @Permissao(LER)
  regras(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.regras(sessaoDe(req).porta, idDaRota(op)));
  }
  @Get(`${B}/:op/pacotes`)
  @Permissao(LER)
  pacotes(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.pacotes(sessaoDe(req).porta, idDaRota(op)));
  }
  @Get(`${B}/:op/valorar`)
  @Permissao(LER)
  valorar(@Param('op') op: string, @Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.valorar(sessaoDe(req).porta, idDaRota(op), corpo(esquemaValorar, q)));
  }

  // ---------------------------------------------------------------- gravações do cadastro
  @Post(`${B}/tabela/:id/itens`)
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  incluirItem(@Param('id') t: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirItem(
        s.porta,
        idDaRota(t),
        corpo(esquemaItem, b),
        this.trilha(s, 'operadora.remuneracao.item.incluido'),
      ),
    );
  }
  @Post(`${B}/contrato/:id/reajustes`)
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  reajustar(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.reajustar(
        s.porta,
        idDaRota(k),
        corpo(esquemaReajuste, b),
        this.trilha(s, 'operadora.remuneracao.reajuste.aplicado'),
      ),
    );
  }
  @Post(`${B}/:op/tabelas`)
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  incluirTabela(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirTabela(
        s.porta,
        idDaRota(op),
        corpo(esquemaTabela, b),
        this.trilha(s, 'operadora.remuneracao.tabela.incluida'),
      ),
    );
  }
  @Post(`${B}/:op/regras`)
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  incluirRegra(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirRegra(
        s.porta,
        idDaRota(op),
        corpo(esquemaRegra, b),
        this.trilha(s, 'operadora.remuneracao.regra.incluida'),
      ),
    );
  }
  @Post(`${B}/:op/pacotes`)
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  incluirPacote(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirPacote(
        s.porta,
        idDaRota(op),
        corpo(esquemaPacote, b),
        this.trilha(s, 'operadora.remuneracao.pacote.incluido'),
      ),
    );
  }

  // ---------------------------------------------------------------- pagamento
  @Get(`${B}/:op/calendario`)
  @Permissao(LER_PAG)
  calendario(@Param('op') op: string, @Query('ano') ano: unknown, @Req() req: RequisicaoAutorizada) {
    const a = typeof ano === 'string' && /^\d{4}$/.test(ano) ? Number(ano) : new Date().getFullYear();
    return this.ok(this.porta.calendario(sessaoDe(req).porta, idDaRota(op), a));
  }
  @Get(`${B}/:op/lotes`)
  @Permissao(LER_PAG)
  lotes(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.lotes(sessaoDe(req).porta, idDaRota(op)));
  }
  @Get(`${B}/:op/prestador/:p`)
  @Permissao(LER_PAG)
  prestador(@Param('op') op: string, @Param('p') p: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.prestadorPagamento(sessaoDe(req).porta, idDaRota(op), idDaRota(p)));
  }
  @Post(`${B}/calendario/:id/fechar`)
  @HttpCode(200)
  @Permissao(PAGAR)
  @AuditadoNoHandler(AUD)
  fecharCalendario(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.fecharCalendario(
        s.porta,
        idDaRota(k),
        corpo(esquemaVersao, b).versao,
        this.trilha(s, 'operadora.remuneracao.calendario.fechado'),
      ),
    );
  }
  @Post(`${B}/prestador/:p/adiantamentos`)
  @HttpCode(201)
  @Permissao(PAGAR)
  @AuditadoNoHandler(AUD)
  incluirAdiantamento(@Param('p') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirAdiantamento(
        s.porta,
        idDaRota(p),
        corpo(esquemaAdiantamento, b),
        this.trilha(s, 'operadora.remuneracao.adiantamento.incluido'),
      ),
    );
  }
  @Post(`${B}/lote/:id/fechar`)
  @HttpCode(200)
  @Permissao(PAGAR)
  @AuditadoNoHandler(AUD)
  fecharLote(@Param('id') l: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.fecharLote(
        s.porta,
        idDaRota(l),
        corpo(esquemaFechar, b),
        this.trilha(s, 'operadora.remuneracao.lote.fechado'),
      ),
    );
  }
  @Post(`${B}/lote/:id/cancelar`)
  @HttpCode(200)
  @Permissao(PAGAR)
  @AuditadoNoHandler(AUD)
  cancelarLote(@Param('id') l: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.cancelarLote(
        s.porta,
        idDaRota(l),
        corpo(esquemaVersao, b).versao,
        this.trilha(s, 'operadora.remuneracao.lote.cancelado'),
      ),
    );
  }
  @Post(`${B}/:op/calendario`)
  @HttpCode(201)
  @Permissao(PAGAR)
  @AuditadoNoHandler(AUD)
  incluirCalendario(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirCalendario(
        s.porta,
        idDaRota(op),
        corpo(esquemaCalendario, b),
        this.trilha(s, 'operadora.remuneracao.calendario.incluido'),
      ),
    );
  }
  @Post(`${B}/:op/lotes`)
  @HttpCode(201)
  @Permissao(PAGAR)
  @AuditadoNoHandler(AUD)
  criarLote(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.criarLote(
        s.porta,
        idDaRota(op),
        corpo(esquemaLote, b),
        this.trilha(s, 'operadora.remuneracao.lote.criado'),
      ),
    );
  }
}
