// Manutenção corretiva (04-HOT L135; RDC 509/2021 e NBR 15943): oficinas, orçamento da OS e conserto externo.
//   GET  /api/manutencao/oficinas?termo=&inativas=     as oficinas do estabelecimento (com as OS abertas)
//   GET  /api/manutencao/oficinas/opcoes               especialidades e serviços de manutenção
//   GET  /api/manutencao/oficinas/:id                  a oficina com as pessoas (função, alçada, vigência) e os serviços
//   POST /api/manutencao/oficinas                      cadastrar;  PUT /api/manutencao/oficinas/:id  alterar pela versão
//   GET  /api/manutencao/os/:id/corretiva-externa      orçamentos e remessas da OS
//   POST /api/manutencao/os/:id/orcamentos             registrar o orçamento (o pendente anterior fica substituído)
//   POST /api/manutencao/orcamentos/:id/decisao        aprovar ou reprovar (aprovador vigente da oficina, na alçada)
//   POST /api/manutencao/os/:id/remessas               enviar o equipamento ao fornecedor (OS aguardando fornecedor)
//   POST /api/manutencao/remessas/:id/retorno          registrar o retorno (OS de volta ao atendimento)
//   GET  /api/manutencao/remessas/abertas              o que está fora, com as atrasadas
// A regra é do domínio (@sgh/dominio-manutencao, oficina-orcamento), entregue à porta como callback; a porta relê e
// trava a OS, o orçamento e a remessa na transação, com a trilha de auditoria junto.
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
import { EVENTOS_AUDITAVEIS, PERMISSOES_MANUTENCAO_CODIGOS as P, type SituacaoOs } from '@sgh/contratos';
import {
  conferirMembro,
  conferirOficina,
  planejarDecisao,
  planejarOrcamento,
  planejarRemessa,
  planejarRetorno,
} from '@sgh/dominio-manutencao';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import type {
  GravadorOficinaOrcamento,
  OficinaParaGravar,
  Plano,
  PortaOficinaOrcamentoPropria,
} from './oficina-orcamento-propria.js';

export const PORTA_OFICINA_ORCAMENTO = Symbol('PORTA_OFICINA_ORCAMENTO');

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'manutencao';
const id = z.number().int().positive();
const textoN = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null));
const dataN = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const esquemaOficina = z.object({
  versao: z.number().int().positive().optional(),
  codigo: z.string().min(1).max(30),
  nome: z.string().min(1).max(150),
  terceirizada: z.boolean().default(false),
  fornecedor: id.nullable().default(null),
  especialidade: id.nullable().default(null),
  email: textoN(254),
  telefone: textoN(20),
  ramal: textoN(20),
  notificaPorEmail: z.boolean().default(false),
  exigeAvaliacao: z.boolean().default(false),
  ativo: z.boolean().default(true),
  membros: z
    .array(
      z.object({
        login: z.string().min(1).max(100),
        funcao: z.enum(['tecnico', 'supervisor', 'aprovador', 'recepcao']),
        alcada: z.number().positive().nullable().default(null),
        vigenciaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        vigenciaFim: dataN,
      }),
    )
    .max(200)
    .default([]),
  servicos: z
    .array(
      z.object({ servico: id, tempoPadraoMinutos: z.number().int().positive().nullable().default(null) }),
    )
    .max(300)
    .default([]),
});

const esquemaOrcamento = z.object({
  versaoOs: z.number().int().positive(),
  fornecedor: id.nullable().default(null),
  descricao: z.string().max(1000),
  valor: z.number(),
  prazoDias: z.number().int().positive().nullable().default(null),
  validade: dataN,
});

const esquemaDecisao = z.object({
  versao: z.number().int().positive(),
  decisao: z.enum(['aprovado', 'reprovado']),
  justificativa: textoN(1000),
});

const esquemaRemessa = z.object({
  versaoOs: z.number().int().positive(),
  fornecedor: id,
  termo: z.string().max(1000),
  notaFiscal: textoN(20),
  cfop: z.enum(['5915', '6915']).nullable().default(null),
  previsaoRetorno: dataN,
});

const esquemaRetorno = z.object({
  versao: z.number().int().positive(),
  retornadoEm: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  notaFiscal: textoN(20),
  resultado: z.enum(['consertado', 'sem_conserto']),
  observacao: textoN(1000),
});

const recusada = (codigo: string, mensagem: string, campos: string[] = []) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos.length ? { campos } : {}),
  });

@Controller('manutencao')
export class OficinaOrcamentoController {
  constructor(
    @Optional() @Inject(PORTA_OFICINA_ORCAMENTO) private readonly porta: PortaOficinaOrcamentoPropria | null,
  ) {}

  private p(): PortaOficinaOrcamentoPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A oficina, o orçamento e o conserto externo exigem o banco do cliente.',
      );
    return this.porta;
  }

  private gravar<T extends { id: number }>(
    s: SessaoCadastro,
    evento: string,
    tabela: string,
    fn: (g: GravadorOficinaOrcamento) => Promise<T>,
  ): Promise<T> {
    return this.p()
      .gravar(s.porta, (r: T) => linhaTrilha(s, evento, RECURSO, evento, { tabela, id: String(r.id) }), fn)
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
  }

  // ── Oficinas ─────────────────────────────────────────────────────────────────────────────────────────────────
  @Get('oficinas')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  oficinas(
    @Query('termo') termo: string | undefined,
    @Query('inativas') inativas: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.p().oficinas(sessaoDe(req).porta, termo ?? null, inativas === 'true');
  }

  @Get('oficinas/opcoes')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.p().opcoes(sessaoDe(req).porta);
  }

  @Get('oficinas/:id')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async oficina(@Param('id') idRota: string, @Req() req: RequisicaoAutorizada) {
    const o = await this.p().oficina(sessaoDe(req).porta, idDaRota(idRota));
    if (!o) throw new ErroProblema('nao-encontrado', 404, 'Não encontrada', 'Oficina não encontrada.');
    return o;
  }

  private async salvarOficina(req: RequisicaoAutorizada, b: unknown, idOficina: number | null) {
    const s = sessaoDe(req);
    const e = corpo(esquemaOficina, b);
    if (idOficina !== null && e.versao === undefined)
      throw recusada('versao-obrigatoria', 'Informe a versão lida da oficina.', ['versao']);
    const x: OficinaParaGravar = e;
    const r = conferirOficina(x);
    if (r) throw recusada(r.recusa, r.mensagem, [r.campo]);
    const gravado = await this.gravar(s, E.manutencaoOficinaGravada.codigo, 'oficina_manutencao', (g) =>
      g.gravarOficina(idOficina, e.versao ?? null, x, (membros): Plano => {
        for (const m of membros) {
          const k = conferirMembro({ ...m, usuario: 0, ativo: true });
          if (k) return k;
        }
        return { ok: true };
      }),
    );
    return { ok: true, id: gravado.id, versao: gravado.versao, mensagem: 'Oficina gravada.' };
  }

  @Post('oficinas')
  @HttpCode(201)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'oficina_manutencao, oficina_manutencao_usuario e oficina_manutencao_servico com a trilha de auditoria na mesma transação',
  )
  incluirOficina(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.salvarOficina(req, b, null);
  }

  @Put('oficinas/:id')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'oficina_manutencao, oficina_manutencao_usuario e oficina_manutencao_servico com a trilha de auditoria na mesma transação',
  )
  alterarOficina(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.salvarOficina(req, b, idDaRota(idRota));
  }

  // ── Orçamento e conserto externo ─────────────────────────────────────────────────────────────────────────────
  @Get('os/:id/corretiva-externa')
  @Permissao(P.osAtender)
  @Auditar(E.manutencaoOsLidas.codigo)
  async corretiva(@Param('id') idRota: string, @Req() req: RequisicaoAutorizada) {
    const c = await this.p().corretiva(sessaoDe(req).porta, idDaRota(idRota));
    if (!c)
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrada', 'Ordem de serviço não encontrada.');
    return c;
  }

  @Post('os/:id/orcamentos')
  @HttpCode(201)
  @Permissao(P.osAtender)
  @AuditadoNoHandler(
    'orcamento_ordem_servico_manutencao (o pendente anterior fica substituído) com a trilha de auditoria na mesma transação',
  )
  async registrarOrcamento(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaOrcamento, b);
    const r = await this.gravar(
      s,
      E.manutencaoOsOrcamento.codigo,
      'orcamento_ordem_servico_manutencao',
      (g) =>
        g.registrarOrcamento({ ...e, os: idDaRota(idRota), validade: e.validade }, (o, haAprovado, hoje) =>
          planejarOrcamento({
            situacaoOs: o.situacao as SituacaoOs,
            valor: e.valor,
            descricao: e.descricao,
            validade: e.validade,
            hoje,
            haAprovado,
          }),
        ),
    );
    return { ok: true, id: r.id, mensagem: 'Orçamento registrado; aguarda a aprovação.' };
  }

  @Post('orcamentos/:id/decisao')
  @HttpCode(200)
  @Permissao(P.osAtender)
  @AuditadoNoHandler(
    'orcamento_ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async decidirOrcamento(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDecisao, b);
    const quem = s.porta.usuario;
    if (quem === null) throw recusada('sem-usuario', 'Sessão sem usuário identificado.');
    const r = await this.gravar(
      s,
      E.manutencaoOsOrcamento.codigo,
      'orcamento_ordem_servico_manutencao',
      (g) =>
        g.decidirOrcamento(
          {
            orcamento: idDaRota(idRota),
            versao: e.versao,
            decisao: e.decisao,
            justificativa: e.justificativa,
          },
          (orcamento, membros, hoje) =>
            planejarDecisao({
              decisao: e.decisao,
              orcamento,
              quem,
              administrador: false,
              membros,
              justificativa: e.justificativa,
              hoje,
            }),
        ),
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      mensagem: e.decisao === 'aprovado' ? 'Orçamento aprovado.' : 'Orçamento reprovado.',
    };
  }

  @Post('os/:id/remessas')
  @HttpCode(201)
  @Permissao(P.osAtender)
  @AuditadoNoHandler(
    'remessa_conserto_manutencao, ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async enviarRemessa(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRemessa, b);
    const r = await this.gravar(s, E.manutencaoOsRemessa.codigo, 'remessa_conserto_manutencao', (g) =>
      g.enviarRemessa({ ...e, os: idDaRota(idRota) }, (o, remessaAberta, orcamento, agora) =>
        planejarRemessa({
          situacaoOs: o.situacao as SituacaoOs,
          temEquipamento: o.equipamento !== null,
          remessaAberta,
          orcamento,
          enviadoEm: agora,
          previsaoRetorno: e.previsaoRetorno,
          termo: e.termo,
        }),
      ),
    );
    return {
      ok: true,
      id: r.id,
      versaoOs: r.versaoOs,
      mensagem: 'Equipamento enviado; a OS aguarda o fornecedor.',
    };
  }

  @Post('remessas/:id/retorno')
  @HttpCode(200)
  @Permissao(P.osAtender)
  @AuditadoNoHandler(
    'remessa_conserto_manutencao, ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async registrarRetorno(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRetorno, b);
    const r = await this.gravar(s, E.manutencaoOsRemessa.codigo, 'remessa_conserto_manutencao', (g) =>
      g.registrarRetorno({ ...e, remessa: idDaRota(idRota) }, (rem, retornadoEm, agora) =>
        planejarRetorno({
          situacaoRemessa: rem.situacao,
          enviadoEm: rem.enviadoEm,
          retornadoEm,
          agora,
          resultado: e.resultado,
          observacao: e.observacao,
        }),
      ),
    );
    return {
      ok: true,
      id: r.id,
      versaoOs: r.versaoOs,
      mensagem: 'Retorno registrado; a OS voltou ao atendimento.',
    };
  }

  @Get('remessas/abertas')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoOsLidas.codigo)
  remessasAbertas(@Req() req: RequisicaoAutorizada) {
    return this.p().remessasAbertas(sessaoDe(req).porta);
  }
}
