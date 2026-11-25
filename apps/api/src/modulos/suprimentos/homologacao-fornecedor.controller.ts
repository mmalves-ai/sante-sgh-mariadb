// Homologação do fornecedor por questionário pontuado (09-AREA linha 66):
//   GET  /api/suprimentos/homologacao-fornecedor                         questionários, faixas, avaliações e ranking
//   GET  /api/suprimentos/homologacao-fornecedor/fornecedores?termo=&questionario=   busca do fornecedor a avaliar
//        (com o questionário de categoria, só quem fornece a categoria)
//   GET  /api/suprimentos/homologacao-fornecedor/:id                     a avaliação com as respostas pontuadas
//   POST /api/suprimentos/homologacao-fornecedor/questionarios           o questionário novo com as perguntas
//   POST /api/suprimentos/homologacao-fornecedor/questionarios/:id/encerramento   fecha a vigência (nada apagado)
//   POST /api/suprimentos/homologacao-fornecedor/avaliacoes              a avaliação (nota, faixa, situação, validade)
//   POST /api/suprimentos/homologacao-fornecedor/:id/excecao             a exceção justificada sobre a reprovada
//   POST /api/suprimentos/homologacao-fornecedor/:id/cancelamento        o cancelamento com motivo (fica no histórico)
// Ler pede suprimentos.contrato.ler; o questionário, suprimentos.contrato.editar; avaliar e cancelar,
// suprimentos.contrato.avaliar (avaliar e qualificar o fornecedor); a exceção, suprimentos.contrato.aditar (a alçada
// das exceções). Sem chave de liberação: vale a permissão do cargo. A gravação exige a Idempotency-Key.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { PERMISSOES_CONTRATO_CODIGOS as P } from '@sgh/contratos';
import { TIPOS_RESPOSTA_HOMOLOGACAO } from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_HOMOLOGACAO_FORNECEDOR, type PortaHomologacaoFornecedor } from './homologacao-fornecedor.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const id_ = z.number().int().positive();

export const esquemaQuestionarioHomologacao = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    categoria: id_.nullable().default(null),
    notaMinima: z.number().min(0).max(100),
    validadeMeses: z.number().int().min(1).max(60),
    instrucoes: z.string().trim().max(2000).nullable().default(null),
    vigenciaInicio: z.string().regex(DATA),
    vigenciaFim: z.string().regex(DATA).nullable().default(null),
    perguntas: z
      .array(
        z
          .object({
            identificador: z.string().trim().max(30).nullable().default(null),
            texto: z.string().trim().min(1).max(500),
            peso: z.number().positive().max(100),
            tipoResposta: z.enum(TIPOS_RESPOSTA_HOMOLOGACAO),
            opcoes: z
              .array(
                z
                  .object({
                    ordem: z.number().int().min(1).max(99),
                    texto: z.string().trim().min(1).max(150),
                    pontos: z.number().min(0).max(10),
                  })
                  .strict(),
              )
              .max(10)
              .default([]),
            obrigatoria: z.boolean().default(true),
            eliminatoria: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();

export const esquemaAvaliacaoHomologacao = z
  .object({
    fornecedor: id_,
    questionario: id_,
    insumo: id_.nullable().default(null),
    respostas: z
      .array(
        z
          .object({
            pergunta: id_,
            opcao: z.number().int().min(1).max(99).nullable().default(null),
            texto: z.string().trim().max(2000).nullable().default(null),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();

const esquemaEncerramento = z.object({ fim: z.string().regex(DATA), versao: id_ }).strict();
const esquemaExcecao = z.object({ justificativa: z.string().trim().min(1).max(2000), versao: id_ }).strict();
const esquemaCancelamento = z.object({ motivo: z.string().trim().min(1).max(500), versao: id_ }).strict();

function chaveDe(req: RequisicaoAutorizada): string {
  const bruto = req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'A Idempotency-Key do pedido falta ou é inválida.',
    );
  return k;
}

function idDe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new ErroProblema(
      'nao-encontrado',
      404,
      'Não encontrado',
      'A homologação ou o questionário não existe.',
    );
  return n;
}

@Controller('suprimentos/homologacao-fornecedor')
export class HomologacaoFornecedorController {
  constructor(@Inject(PORTA_HOMOLOGACAO_FORNECEDOR) private readonly porta: PortaHomologacaoFornecedor) {}

  @Get()
  @Permissao(P.ler)
  async painel(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const p = await this.porta.painel(s.porta);
    return {
      ...p,
      pode: { editar: s.pode(P.editar), avaliar: s.pode(P.avaliar), excecao: s.pode(P.aditar) },
    };
  }

  @Get('fornecedores')
  @Permissao(P.ler)
  async fornecedores(
    @Query('termo') termo: string | undefined,
    @Query('questionario') questionario: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const q = Number(questionario);
    return {
      itens: await this.porta.fornecedores(
        sessaoDe(req).porta,
        (termo ?? '').slice(0, 60),
        Number.isInteger(q) && q > 0 ? q : null,
      ),
    };
  }

  @Get(':id')
  @Permissao(P.ler)
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.detalhe(sessaoDe(req).porta, idDe(id));
  }

  @Post('questionarios')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.homologacao.gravar-questionario pelo executor (trilha na mesma transação)')
  async questionario(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaQuestionarioHomologacao, b);
    const r = await this.porta.gravarQuestionario(sessaoDe(req).porta, e, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Questionário gravado.' };
  }

  @Post('questionarios/:id/encerramento')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler(
    'suprimentos.homologacao.encerrar-questionario pelo executor (trilha na mesma transação)',
  )
  async encerrar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaEncerramento, b);
    const r = await this.porta.encerrarQuestionario(
      sessaoDe(req).porta,
      idDe(id),
      e.fim,
      e.versao,
      chaveDe(req),
    );
    return { ok: true, ...r, mensagem: 'Vigência do questionário encerrada: as avaliações continuam.' };
  }

  @Post('avaliacoes')
  @HttpCode(201)
  @Permissao(P.avaliar)
  @AuditadoNoHandler('suprimentos.homologacao.avaliar pelo executor (trilha na mesma transação)')
  async avaliar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAvaliacaoHomologacao, b);
    const r = await this.porta.avaliar(sessaoDe(req).porta, e, chaveDe(req));
    return {
      ok: true,
      ...r,
      mensagem:
        r.situacao === 'homologado'
          ? `Fornecedor homologado com nota ${r.nota}${r.comRestricao ? ' (com restrição)' : ''}.`
          : `Fornecedor reprovado com nota ${r.nota}.`,
    };
  }

  @Post(':id/excecao')
  @HttpCode(200)
  @Permissao(P.aditar)
  @AuditadoNoHandler('suprimentos.homologacao.aprovar-excecao pelo executor (trilha na mesma transação)')
  async excecao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaExcecao, b);
    const r = await this.porta.aprovarExcecao(
      sessaoDe(req).porta,
      idDe(id),
      e.justificativa,
      e.versao,
      chaveDe(req),
    );
    return {
      ok: true,
      ...r,
      mensagem: 'Exceção aprovada: o fornecedor fica homologado por exceção justificada.',
    };
  }

  @Post(':id/cancelamento')
  @HttpCode(200)
  @Permissao(P.avaliar)
  @AuditadoNoHandler('suprimentos.homologacao.cancelar pelo executor (trilha na mesma transação)')
  async cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaCancelamento, b);
    const r = await this.porta.cancelar(sessaoDe(req).porta, idDe(id), e.motivo, e.versao, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Homologação cancelada: fica no histórico com o motivo.' };
  }
}
