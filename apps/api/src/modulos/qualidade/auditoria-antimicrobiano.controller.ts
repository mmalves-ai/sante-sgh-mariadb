// Auditoria da prescrição de antimicrobiano pela comissão de controle de infecção (F7, 03-PEP linha 110). Rotas:
//   GET  /api/qualidade/ccih/auditoria-antimicrobiano                 a fila das fichas (pendentes primeiro)
//   GET  /api/qualidade/ccih/auditoria-antimicrobiano/historico       as auditorias de uma ficha ou de um paciente
//   GET  /api/qualidade/ccih/auditoria-antimicrobiano/cadastro        tipos de auditoria e pareceres padrão
//   POST /api/qualidade/ccih/auditoria-antimicrobiano/fichas/:id      registra a auditoria e o parecer na ficha
// A gravação é do Executor (trilha, outbox e idempotência na mesma transação); a leitura da fila e do histórico é
// auditada (`qualidade.ccih.lida`). A permissão é a do antimicrobiano da comissão (ler e liberar).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  ADEQUACOES_AUDITORIA,
  INDICACOES_AUDITORIA,
  PARECERES_AUDITORIA_ANTIMICROBIANO,
} from '@sgh/dominio-qualidade';
import { EVENTOS_AUDITAVEIS, PERMISSOES_CCIH as P } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { sessaoComAto } from '../enfermagem/gravacao-direta.js';
import { corpo } from '../exames/public-api.js';
import type { PortaAuditoriaAntimicrobianoPropria } from './porta-auditoria-antimicrobiano-propria.js';

export const PORTA_AUDITORIA_ANTIMICROBIANO = Symbol('PORTA_AUDITORIA_ANTIMICROBIANO');
const E = EVENTOS_AUDITAVEIS;

const adequacao = z.enum(ADEQUACOES_AUDITORIA);
const esquemaAuditoria = z
  .object({
    versaoFicha: z.number().int().positive(),
    avaliavel: z.boolean().default(true),
    droga: adequacao.default('nao_avaliada'),
    dose: adequacao.default('nao_avaliada'),
    tempo: adequacao.default('nao_avaliada'),
    via: adequacao.default('nao_avaliada'),
    indicacao: z.enum(INDICACOES_AUDITORIA).nullable().default(null),
    parecer: z.enum(PARECERES_AUDITORIA_ANTIMICROBIANO),
    permiteProrrogacao: z.boolean().nullable().default(null),
    recomendacao: z.string().trim().max(4000).nullable().default(null),
    tipo: z.number().int().positive().nullable().default(null),
    parecerPadrao: z.number().int().positive().nullable().default(null),
  })
  .strict();

const indisponivel = () =>
  new ErroProblema(
    'indisponivel',
    503,
    'Auditoria de antimicrobianos',
    'A auditoria de antimicrobianos precisa do banco do cliente configurado.',
  );
const id = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

@Controller('qualidade/ccih/auditoria-antimicrobiano')
export class AuditoriaAntimicrobianoController {
  constructor(
    @Optional()
    @Inject(PORTA_AUDITORIA_ANTIMICROBIANO)
    private readonly porta: PortaAuditoriaAntimicrobianoPropria | null = null,
  ) {}

  private p(): PortaAuditoriaAntimicrobianoPropria {
    if (!this.porta) throw indisponivel();
    return this.porta;
  }

  @Get()
  @Permissao(P.antimicrobianoLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  fila(
    @Req() req: RequisicaoAutorizada,
    @Query('todas') todas?: string,
    @Query('paciente') paciente?: string,
  ) {
    return this.p().fila(sessaoDe(req).porta, {
      soPendentes: !(todas === '1' || todas === 'true'),
      paciente: id(paciente) ?? null,
    });
  }

  @Get('historico')
  @Permissao(P.antimicrobianoLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  historico(
    @Req() req: RequisicaoAutorizada,
    @Query('ficha') ficha?: string,
    @Query('paciente') paciente?: string,
  ) {
    const f = { ficha: id(ficha), paciente: id(paciente) };
    if (f.ficha === undefined && f.paciente === undefined)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe a ficha ou o paciente.');
    return this.p().historico(sessaoDe(req).porta, {
      ...(f.ficha !== undefined ? { ficha: f.ficha } : {}),
      ...(f.paciente !== undefined ? { paciente: f.paciente } : {}),
    });
  }

  @Get('cadastro')
  @Permissao(P.antimicrobianoLer)
  cadastro(@Req() req: RequisicaoAutorizada) {
    return this.p().cadastro(sessaoDe(req).porta);
  }

  @Post('fichas/:id')
  @HttpCode(201)
  @Permissao(P.antimicrobianoLiberar)
  @AuditadoNoHandler(
    'qualidade.ccih.auditoria-antimicrobiano: auditoria_prescricao_ccih e o parecer em ficha_antimicrobiano (versão conferida) com a trilha_auditoria na mesma transação',
  )
  registrar(@Param('id') ficha: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const alvo = idDaRota(ficha);
    const e = corpo(esquemaAuditoria, b);
    const s = sessaoComAto(sessaoDe(req), { ficha: alvo, ...e });
    return this.p().registrar(s.porta, s.login, alvo, e, (r) => ({
      estabelecimento: null,
      usuario: null,
      acao: 'operacao',
      entidade: 'auditoria_prescricao_ccih',
      entidadeId: r.id,
      dadosDepois: { evento: 'auditoria-antimicrobiano', ficha: alvo, parecer: e.parecer },
      correlacao: s.porta.correlacao,
    }));
  }
}
