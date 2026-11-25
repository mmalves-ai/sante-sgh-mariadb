// Rotas da declaração de saúde, da doença preexistente com a CPT e da portabilidade de carências do beneficiário
// (08-SGO L95, C2-113; F7; RN ANS 162 e 438). Ler com operadora.beneficiario.ler; gravar com
// operadora.beneficiario.editar:
//   GET  operadora/saude-beneficiario?matricula=              beneficiário pela matrícula exata
//   GET  operadora/saude-beneficiario/cids?busca=            termos do CID-10 pelo código ou pela descrição
//   GET  operadora/saude-beneficiario/questionarios           questionários vigentes de declaração de saúde
//   GET  operadora/saude-beneficiario/:id                     visão por beneficiário (carências, declarações, CPT...)
//   POST operadora/saude-beneficiario/:id/declaracoes         registra a declaração com respostas e doenças
//   POST operadora/saude-beneficiario/doencas/:id/decisao     decide a cobertura da doença (CPT, agravo, sem restrição)
//   POST operadora/saude-beneficiario/cpts/:id/encerramento   encerra ou cancela a CPT com motivo
//   POST operadora/saude-beneficiario/:id/portabilidades      registra o pedido de portabilidade de carências
//   POST operadora/saude-beneficiario/portabilidades/:id/decisao  em análise, aprovada, recusada ou cancelada
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  DECISOES_DLP,
  DIRECOES_PORTABILIDADE,
  FORMAS_IDENTIFICACAO_DLP,
  MODALIDADES_PORTABILIDADE,
  SITUACOES_PORTABILIDADE,
} from '@sgh/dominio-operadora';
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
  PORTA_BENEFICIARIO_SAUDE,
  type PortaBeneficiarioSaudePropria,
} from './beneficiario-saude-propria.js';

const LER = 'operadora.beneficiario.ler';
const EDITAR = 'operadora.beneficiario.editar';
const AUD = 'operadora.saude-beneficiario.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const versao = z.number().int().positive();
const tn = (max: number) => z.string().max(max).nullable();

const esquemaDeclaracao = z.object({
  questionario: id,
  preenchidaEm: data,
  pesoKg: z.number().positive().max(999).nullable(),
  alturaM: z.number().positive().max(9).nullable(),
  entrevistaQualificada: z.boolean(),
  medicoOrientador: id.nullable(),
  dispensouOrientacao: z.boolean(),
  respostas: z
    .array(
      z.object({
        pergunta: id,
        afirmativa: z.boolean().nullable(),
        texto: tn(500),
        complemento: tn(2000),
      }),
    )
    .max(300),
  doencas: z.array(z.object({ termo: id, inicio: data, forma: z.enum(FORMAS_IDENTIFICACAO_DLP) })).max(50),
});
const esquemaDecisao = z.object({
  versao,
  decisao: z.enum(DECISOES_DLP),
  prazoMeses: z.number().int().min(1).max(24).nullable(),
  percentualAgravo: z.number().positive().max(999).nullable(),
  observacao: tn(1000),
});
const esquemaEncerramento = z.object({
  versao,
  situacao: z.enum(['encerrada', 'cancelada']),
  data,
  motivo: z.string().min(1).max(500),
});
const esquemaPortabilidade = z.object({
  direcao: z.enum(DIRECOES_PORTABILIDADE),
  modalidade: z.enum(MODALIDADES_PORTABILIDADE),
  registroAnsOrigem: z.string().regex(/^\d{6}$/),
  nomeOperadoraOrigem: tn(150),
  registroProdutoOrigem: tn(20),
  vinculoInicio: data.nullable(),
  faixaPrecoCompativel: z.boolean(),
  adimplente: z.boolean(),
  solicitadoEm: data,
  observacao: tn(4000),
});
const esquemaDecisaoPortabilidade = z.object({
  versao,
  situacao: z.enum(SITUACOES_PORTABILIDADE),
  motivoRecusa: tn(500),
  cumpriuCptNaOrigem: z.boolean(),
  jaPortouAntes: z.boolean(),
});
const esquemaBusca = z.object({ matricula: z.string().min(1).max(40) });
const esquemaBuscaCid = z.object({ busca: z.string().min(2).max(80) });

@Controller()
export class BeneficiarioSaudeOperadoraController {
  constructor(@Inject(PORTA_BENEFICIARIO_SAUDE) private readonly porta: PortaBeneficiarioSaudePropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.saude-beneficiario', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  // ---- rotas fixas antes das rotas com :id ----
  @Get('operadora/saude-beneficiario')
  @Permissao(LER)
  buscar(@Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.buscar(sessaoDe(req).porta, corpo(esquemaBusca, q).matricula));
  }

  @Get('operadora/saude-beneficiario/cids')
  @Permissao(LER)
  cids(@Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.cids(sessaoDe(req).porta, corpo(esquemaBuscaCid, q).busca));
  }

  @Get('operadora/saude-beneficiario/questionarios')
  @Permissao(LER)
  questionarios(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.questionarios(sessaoDe(req).porta));
  }

  @Post('operadora/saude-beneficiario/doencas/:id/decisao')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  decidirDoenca(@Param('id') d: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.decidirDoenca(
        s.porta,
        idDaRota(d),
        corpo(esquemaDecisao, b),
        this.trilha(s, 'operadora.saude-beneficiario.doenca-decidida', 'doenca_preexistente_declarada'),
      ),
    );
  }

  @Post('operadora/saude-beneficiario/cpts/:id/encerramento')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  encerrarCpt(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.encerrarCpt(
        s.porta,
        idDaRota(k),
        corpo(esquemaEncerramento, b),
        this.trilha(s, 'operadora.saude-beneficiario.cpt-encerrada', 'cobertura_parcial_temporaria'),
      ),
    );
  }

  @Post('operadora/saude-beneficiario/portabilidades/:id/decisao')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  decidirPortabilidade(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.decidirPortabilidade(
        s.porta,
        idDaRota(k),
        corpo(esquemaDecisaoPortabilidade, b),
        this.trilha(s, 'operadora.saude-beneficiario.portabilidade-decidida', 'portabilidade_carencia'),
      ),
    );
  }

  @Get('operadora/saude-beneficiario/:id')
  @Permissao(LER)
  painel(@Param('id') b: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.painel(sessaoDe(req).porta, idDaRota(b)));
  }

  @Post('operadora/saude-beneficiario/:id/declaracoes')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  declaracao(@Param('id') ben: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.registrarDeclaracao(
        s.porta,
        idDaRota(ben),
        corpo(esquemaDeclaracao, b),
        this.trilha(s, 'operadora.saude-beneficiario.declaracao-registrada', 'declaracao_saude'),
      ),
    );
  }

  @Post('operadora/saude-beneficiario/:id/portabilidades')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  portabilidade(@Param('id') ben: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.registrarPortabilidade(
        s.porta,
        idDaRota(ben),
        corpo(esquemaPortabilidade, b),
        this.trilha(s, 'operadora.saude-beneficiario.portabilidade-registrada', 'portabilidade_carencia'),
      ),
    );
  }
}
