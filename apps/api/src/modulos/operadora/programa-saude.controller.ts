// Rotas da promoção da saúde e gestão de crônicos da operadora (08-SGO L115, C2-102; F8; RN ANS 264 e 265/2011).
// Ler com operadora.promocao.ler; configurar programa, critério, bonificação, grupo de risco e questionário com
// operadora.promocao.configurar; incluir e encerrar participante, registrar contato e aplicar questionário com
// operadora.promocao.registrar:
//   GET  operadora/programas-saude                                   programas com critérios e bonificações
//   POST operadora/programas-saude                                   inclui um programa
//   GET  operadora/programas-saude/:id                               um programa
//   POST operadora/programas-saude/:id/alteracao                     altera o programa (versão)
//   POST operadora/programas-saude/:id/criterios                     inclui um critério de elegibilidade
//   POST operadora/programas-saude/criterios/:id/desativacao         desativa o critério (não apaga)
//   POST operadora/programas-saude/:id/bonificacoes                  inclui uma bonificação (RN 265)
//   GET  operadora/programas-saude/:id/elegiveis                     beneficiários elegíveis com os motivos
//   GET  operadora/programas-saude/:id/participantes                 participantes do programa
//   POST operadora/programas-saude/:id/participantes                 inclui o beneficiário
//   POST operadora/programas-saude/participantes/:id/saida           encerra com data e motivo
//   POST operadora/programas-saude/participantes/:id/contatos        agenda ou registra um contato
//   POST operadora/programas-saude/contatos/:id/baixa                baixa do contato agendado
//   POST operadora/programas-saude/participantes/:id/avaliacoes      aplica o questionário de risco
//   GET  operadora/programas-saude/agenda                            agenda de visitas (atrasados, hoje, próximos)
//   GET  operadora/programas-saude/beneficiarios/:id                 visão por beneficiário
//   GET  operadora/programas-saude/:id/custo                         custo do crônico antes e depois da entrada
//   GET  operadora/programas-saude/:id/bonificacao                   adesão e direito à bonificação
//   GET  operadora/programas-saude/grupos-risco | POST              grupos de risco
//   GET  operadora/programas-saude/questionarios | POST             questionários de risco com as perguntas
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  FORMAS_ALERTA_PROGRAMA,
  MOTIVOS_SAIDA_PROGRAMA,
  SITUACOES_PROGRAMA_SAUDE,
  TIPOS_BENEFICIO_PROGRAMA,
  TIPOS_CONTATO_PROGRAMA,
  TIPOS_CRITERIO_PROGRAMA,
  TIPOS_PROGRAMA_SAUDE,
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
  PORTA_PROGRAMA_SAUDE,
  type PortaProgramaSaudePropria,
} from './programa-saude-propria.js';

const LER = 'operadora.promocao.ler';
const CONFIGURAR = 'operadora.promocao.configurar';
const REGISTRAR = 'operadora.promocao.registrar';
const AUD = 'operadora.programa-saude.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);
const id = z.number().int().positive();
const versao = z.number().int().positive();
const tn = (max: number) => z.string().max(max).nullable();
const esquemaPrograma = z.object({
  codigo: z.string().min(1).max(30),
  nome: z.string().min(1).max(150),
  tipo: z.enum(TIPOS_PROGRAMA_SAUDE),
  objetivo: tn(4000),
  publicoAlvo: tn(500),
  metas: tn(4000),
  grupoRisco: id.nullable(),
  registradoAns: z.boolean(),
  numeroRegistroAns: tn(30),
  isentaCoparticipacao: z.boolean(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  situacao: z.enum(SITUACOES_PROGRAMA_SAUDE),
});
const esquemaAlteracao = esquemaPrograma.extend({ versao });
const inteiroOuNulo = (max: number) => z.number().int().min(0).max(max).nullable();
const esquemaCriterio = z.object({
  tipo: z.enum(TIPOS_CRITERIO_PROGRAMA),
  termo: id.nullable(),
  grupoPatologia: id.nullable(),
  ocorrenciasMinimas: inteiroOuNulo(999),
  periodoMeses: inteiroOuNulo(60),
  idadeMinima: inteiroOuNulo(130),
  idadeMaxima: inteiroOuNulo(130),
  custoMensalMinimo: z.number().min(0).nullable(),
  custoPeriodoMinimo: z.number().min(0).nullable(),
  escoreMinimo: z.number().nullable(),
  formaAlerta: z.enum(FORMAS_ALERTA_PROGRAMA),
});
const esquemaBonificacao = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(150),
  tipoBeneficio: z.enum(TIPOS_BENEFICIO_PROGRAMA),
  percentualDesconto: z.number().min(0).max(100).nullable(),
  valorBonus: z.number().min(0).nullable(),
  adesaoMinimaPercentual: z.number().min(0).max(100).nullable(),
  validadeMeses: inteiroOuNulo(120),
  criterio: tn(4000),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
});
const esquemaParticipante = z.object({
  beneficiario: id,
  entrada: data,
  grupoRisco: id.nullable(),
  responsavel: id.nullable(),
  observacao: tn(2000),
});
const esquemaSaida = z.object({
  versao,
  saida: data,
  motivo: z.enum(MOTIVOS_SAIDA_PROGRAMA),
  observacao: tn(2000),
});
const esquemaContato = z.object({
  tipo: z.enum(TIPOS_CONTATO_PROGRAMA),
  situacao: z.enum(['agendado', 'realizado']),
  agendadoPara: instante.nullable(),
  realizadoEm: instante.nullable(),
  resultado: tn(4000),
  proximoContato: data.nullable(),
});
const esquemaBaixa = z.object({
  versao,
  situacao: z.enum(['realizado', 'cancelado', 'nao_localizado']),
  realizadoEm: instante.nullable(),
  resultado: tn(4000),
  proximoContato: data.nullable(),
});
const esquemaAvaliacao = z.object({
  questionario: id,
  canal: z.enum(['presencial', 'telefone', 'portal', 'aplicativo']),
  respostas: z
    .array(
      z.object({
        pergunta: id,
        opcao: z.string().max(150).nullable().optional(),
        numero: z.number().nullable().optional(),
        data: data.nullable().optional(),
        texto: z.string().max(4000).nullable().optional(),
      }),
    )
    .max(300),
  observacao: tn(2000),
});
const esquemaGrupo = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(150),
  prioridade: inteiroOuNulo(999),
});
const esquemaQuestionario = z.object({
  codigo: z.string().min(1).max(30),
  nome: z.string().min(1).max(150),
  vigenciaInicio: data,
  exigeTodas: z.boolean(),
  perguntas: z
    .array(
      z.object({
        enunciado: z.string().min(1).max(2000),
        tipoResposta: z.enum(['sim_nao', 'escolha_unica', 'multipla_escolha', 'texto', 'numero', 'data']),
        obrigatoria: z.boolean(),
        opcoes: z
          .array(
            z.object({
              codigo: z.string().min(1).max(30),
              descricao: z.string().min(1).max(150),
              pontos: z.number().min(-999).max(999).optional(),
            }),
          )
          .max(30)
          .nullable(),
        respostaIndicativa: tn(30),
      }),
    )
    .min(1)
    .max(200),
});
const esquemaAgenda = z.object({ programa: z.coerce.number().int().positive().optional() });
const esquemaCusto = z.object({ janela: z.coerce.number().int().min(1).max(36).default(12) });

@Controller()
export class ProgramaSaudeOperadoraController {
  constructor(@Inject(PORTA_PROGRAMA_SAUDE) private readonly porta: PortaProgramaSaudePropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.programa-saude', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  // ---- rotas fixas antes das rotas com :id ----
  @Get('operadora/programas-saude/agenda')
  @Permissao(LER)
  agenda(@Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.agenda(sessaoDe(req).porta, corpo(esquemaAgenda, q)));
  }

  @Get('operadora/programas-saude/grupos-risco')
  @Permissao(LER)
  gruposRisco(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.gruposRisco(sessaoDe(req).porta));
  }

  @Post('operadora/programas-saude/grupos-risco')
  @HttpCode(201)
  @Permissao(CONFIGURAR)
  @AuditadoNoHandler(AUD)
  gravarGrupo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarGrupoRisco(
        s.porta,
        corpo(esquemaGrupo, b),
        this.trilha(s, 'operadora.programa-saude.grupo-risco-incluido', 'grupo_risco_saude'),
      ),
    );
  }

  @Get('operadora/programas-saude/questionarios')
  @Permissao(LER)
  questionarios(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.questionarios(sessaoDe(req).porta));
  }

  @Post('operadora/programas-saude/questionarios')
  @HttpCode(201)
  @Permissao(CONFIGURAR)
  @AuditadoNoHandler(AUD)
  gravarQuestionario(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarQuestionario(
        s.porta,
        corpo(esquemaQuestionario, b),
        this.trilha(s, 'operadora.programa-saude.questionario-incluido', 'modelo_questionario_saude'),
      ),
    );
  }

  @Get('operadora/programas-saude/beneficiarios/:id')
  @Permissao(LER)
  doBeneficiario(@Param('id') b: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.doBeneficiario(sessaoDe(req).porta, idDaRota(b)));
  }

  @Post('operadora/programas-saude/criterios/:id/desativacao')
  @HttpCode(200)
  @Permissao(CONFIGURAR)
  @AuditadoNoHandler(AUD)
  desativarCriterio(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.desativarCriterio(
        s.porta,
        idDaRota(k),
        corpo(z.object({ versao }), b).versao,
        this.trilha(s, 'operadora.programa-saude.criterio-desativado', 'criterio_elegibilidade_programa'),
      ),
    );
  }

  @Post('operadora/programas-saude/participantes/:id/saida')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  saida(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaSaida, b);
    return this.ok(
      this.porta.encerrarParticipante(
        s.porta,
        idDaRota(p),
        e.versao,
        e,
        this.trilha(s, 'operadora.programa-saude.participante-encerrado', 'participante_programa'),
      ),
    );
  }

  @Post('operadora/programas-saude/participantes/:id/contatos')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  contato(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.registrarContato(
        s.porta,
        idDaRota(p),
        corpo(esquemaContato, b),
        this.trilha(s, 'operadora.programa-saude.contato-registrado', 'acompanhamento_programa'),
      ),
    );
  }

  @Post('operadora/programas-saude/contatos/:id/baixa')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  baixa(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaBaixa, b);
    return this.ok(
      this.porta.baixarContato(
        s.porta,
        idDaRota(k),
        e.versao,
        e,
        this.trilha(s, 'operadora.programa-saude.contato-baixado', 'acompanhamento_programa'),
      ),
    );
  }

  @Post('operadora/programas-saude/participantes/:id/avaliacoes')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  avaliacao(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.aplicarQuestionario(
        s.porta,
        idDaRota(p),
        corpo(esquemaAvaliacao, b),
        this.trilha(s, 'operadora.programa-saude.avaliacao-aplicada', 'avaliacao_risco_participante'),
      ),
    );
  }

  // ---- programas ----
  @Get('operadora/programas-saude')
  @Permissao(LER)
  programas(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.programas(sessaoDe(req).porta));
  }

  @Post('operadora/programas-saude')
  @HttpCode(201)
  @Permissao(CONFIGURAR)
  @AuditadoNoHandler(AUD)
  incluirPrograma(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarPrograma(
        s.porta,
        null,
        null,
        corpo(esquemaPrograma, b),
        this.trilha(s, 'operadora.programa-saude.programa-incluido', 'programa_saude'),
      ),
    );
  }

  @Get('operadora/programas-saude/:id')
  @Permissao(LER)
  programa(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.programa(sessaoDe(req).porta, idDaRota(p)));
  }

  @Post('operadora/programas-saude/:id/alteracao')
  @HttpCode(200)
  @Permissao(CONFIGURAR)
  @AuditadoNoHandler(AUD)
  alterarPrograma(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlteracao, b);
    return this.ok(
      this.porta.gravarPrograma(
        s.porta,
        idDaRota(p),
        e.versao,
        e,
        this.trilha(s, 'operadora.programa-saude.programa-alterado', 'programa_saude'),
      ),
    );
  }

  @Post('operadora/programas-saude/:id/criterios')
  @HttpCode(201)
  @Permissao(CONFIGURAR)
  @AuditadoNoHandler(AUD)
  criterio(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirCriterio(
        s.porta,
        idDaRota(p),
        corpo(esquemaCriterio, b),
        this.trilha(s, 'operadora.programa-saude.criterio-incluido', 'criterio_elegibilidade_programa'),
      ),
    );
  }

  @Post('operadora/programas-saude/:id/bonificacoes')
  @HttpCode(201)
  @Permissao(CONFIGURAR)
  @AuditadoNoHandler(AUD)
  bonificacaoNova(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirBonificacao(
        s.porta,
        idDaRota(p),
        corpo(esquemaBonificacao, b),
        this.trilha(s, 'operadora.programa-saude.bonificacao-incluida', 'bonificacao_programa'),
      ),
    );
  }

  @Get('operadora/programas-saude/:id/elegiveis')
  @Permissao(LER)
  elegiveis(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.elegiveis(sessaoDe(req).porta, idDaRota(p)));
  }

  @Get('operadora/programas-saude/:id/participantes')
  @Permissao(LER)
  participantes(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.participantes(sessaoDe(req).porta, { programa: idDaRota(p) }));
  }

  @Post('operadora/programas-saude/:id/participantes')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  incluirParticipante(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirParticipante(
        s.porta,
        idDaRota(p),
        corpo(esquemaParticipante, b),
        this.trilha(s, 'operadora.programa-saude.participante-incluido', 'participante_programa'),
      ),
    );
  }

  @Get('operadora/programas-saude/:id/custo')
  @Permissao(LER)
  custo(@Param('id') p: string, @Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.custo(sessaoDe(req).porta, idDaRota(p), corpo(esquemaCusto, q).janela));
  }

  @Get('operadora/programas-saude/:id/bonificacao')
  @Permissao(LER)
  bonificacao(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.bonificacao(sessaoDe(req).porta, idDaRota(p)));
  }
}
