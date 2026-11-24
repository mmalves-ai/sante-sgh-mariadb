// Análise da cultura positiva pela comissão de controle de infecção (F7, 09-AREA linha 68). Rotas:
//   GET  /api/qualidade/ccih/culturas                     a fila das culturas com crescimento (pendentes primeiro)
//   GET  /api/qualidade/ccih/culturas/analises            as análises de uma cultura ou de um paciente
//   GET  /api/qualidade/ccih/culturas/condutas            o cadastro das condutas
//   POST /api/qualidade/ccih/culturas/condutas            cadastra a conduta
//   POST /api/qualidade/ccih/culturas/:id/analise         registra a análise (por germe)
//   POST /api/qualidade/ccih/culturas/analises/:id/correcao  corrige a análise (versão conferida, com motivo)
// A gravação é do Executor (trilha, outbox e idempotência na mesma transação); a leitura da fila e das análises é
// auditada (`qualidade.ccih.lida`). A permissão é a da ficha de IRAS (ler e registrar), do perfil da comissão.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { CLASSIFICACOES_CULTURA } from '@sgh/dominio-qualidade';
import { EVENTOS_AUDITAVEIS, PERMISSOES_CCIH as P } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { sessaoComAto } from '../enfermagem/gravacao-direta.js';
import { corpo, type TrilhaDaGravacao } from '../exames/public-api.js';
import type { PortaAnaliseCulturaPropria } from './porta-analise-cultura-propria.js';

export const PORTA_ANALISE_CULTURA = Symbol('PORTA_ANALISE_CULTURA');
const E = EVENTOS_AUDITAVEIS;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const esquemaAnalise = z.object({
  classificacao: z.enum(CLASSIFICACOES_CULTURA),
  isolado: z.number().int().positive().nullable().default(null),
  conduta: z.number().int().positive().nullable().default(null),
  condutaDescricao: z.string().trim().max(1000).nullable().default(null),
  precaucaoIndicada: z.boolean().default(false),
  prescritorOrientado: z.boolean().default(false),
  casoInfeccao: z.number().int().positive().nullable().default(null),
});
const esquemaCorrecao = esquemaAnalise.extend({
  versao: z.number().int().positive(),
  motivo: z.string().trim().min(5).max(500),
});
const esquemaConduta = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{2,30}$/),
  descricao: z.string().trim().min(3).max(150),
  classificacaoAplicavel: z.enum(CLASSIFICACOES_CULTURA).nullable().default(null),
  abreCaso: z.boolean().default(false),
  indicaPrecaucao: z.boolean().default(false),
  exigeResposta: z.boolean().default(false),
});

const indisponivel = () =>
  new ErroProblema(
    'indisponivel',
    503,
    'Análise de culturas',
    'A análise de culturas precisa do banco do cliente configurado.',
  );

@Controller('qualidade/ccih/culturas')
export class AnaliseCulturaController {
  constructor(
    @Optional()
    @Inject(PORTA_ANALISE_CULTURA)
    private readonly porta: PortaAnaliseCulturaPropria | null = null,
  ) {}

  private p(): PortaAnaliseCulturaPropria {
    if (!this.porta) throw indisponivel();
    return this.porta;
  }

  private trilha(s: SessaoCadastro, entidade: string, id: number, evento: string): TrilhaDaGravacao {
    return {
      estabelecimento: null,
      usuario: null,
      acao: 'operacao',
      entidade,
      entidadeId: id,
      dadosDepois: { evento },
      correlacao: s.porta.correlacao,
    };
  }

  @Get()
  @Permissao(P.irasLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  culturas(
    @Req() req: RequisicaoAutorizada,
    @Query('desde') desde?: string,
    @Query('paciente') paciente?: string,
  ) {
    const s = sessaoDe(req);
    const d =
      desde && DATA.test(desde) ? desde : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const pac = paciente && /^\d+$/.test(paciente) ? Number(paciente) : null;
    return this.p().culturas(s.porta, d, pac);
  }

  @Get('analises')
  @Permissao(P.irasLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  analises(
    @Req() req: RequisicaoAutorizada,
    @Query('cultura') cultura?: string,
    @Query('paciente') paciente?: string,
  ) {
    const s = sessaoDe(req);
    const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
    const f = { cultura: num(cultura), paciente: num(paciente) };
    if (f.cultura === undefined && f.paciente === undefined)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe a cultura ou o paciente.');
    return this.p().analises(s.porta, {
      ...(f.cultura !== undefined ? { cultura: f.cultura } : {}),
      ...(f.paciente !== undefined ? { paciente: f.paciente } : {}),
    });
  }

  @Get('condutas')
  @Permissao(P.irasLer)
  condutas(@Req() req: RequisicaoAutorizada) {
    return this.p().condutas(sessaoDe(req).porta);
  }

  @Post('condutas')
  @HttpCode(201)
  @Permissao(P.irasRegistrar)
  @AuditadoNoHandler(
    'qualidade.ccih.analise-cultura (conduta): conduta_analise_cultura com a trilha_auditoria na mesma transação',
  )
  registrarConduta(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaConduta, b);
    const s = sessaoComAto(sessaoDe(req), e);
    return this.p().registrarConduta(s.porta, s.login, e, (id) =>
      this.trilha(s, 'conduta_analise_cultura', id, 'conduta-cadastrada'),
    );
  }

  @Post(':id/analise')
  @HttpCode(201)
  @Permissao(P.irasRegistrar)
  @AuditadoNoHandler(
    'qualidade.ccih.analise-cultura: analise_cultura_positiva com a trilha_auditoria na mesma transação',
  )
  registrar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const cultura = idDaRota(id);
    const e = corpo(esquemaAnalise, b);
    const s = sessaoComAto(sessaoDe(req), { cultura, ...e });
    return this.p().registrar(s.porta, s.login, cultura, e, (r) =>
      this.trilha(s, 'analise_cultura_positiva', r.id, 'analise-registrada'),
    );
  }

  @Post('analises/:id/correcao')
  @Permissao(P.irasRegistrar)
  @AuditadoNoHandler(
    'qualidade.ccih.analise-cultura (correção): analise_cultura_positiva com a versão conferida e a anterior na trilha_auditoria',
  )
  corrigir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const analise = idDaRota(id);
    const { versao, motivo, ...e } = corpo(esquemaCorrecao, b);
    const s = sessaoComAto(sessaoDe(req), { analise, versao, motivo, ...e });
    return this.p().corrigir(s.porta, s.login, analise, versao, e, motivo, (r) =>
      this.trilha(s, 'analise_cultura_positiva', r.id, 'analise-corrigida'),
    );
  }
}
