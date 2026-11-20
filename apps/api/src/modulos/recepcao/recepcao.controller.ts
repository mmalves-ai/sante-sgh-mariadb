// Recepção: guichê, fila, emissão no balcão, chamada, eventos da senha e chegada do agendado (M19; ficha, seção 7):
//   GET  /api/recepcao/gravacao                         a funcionalidade (recepcao.senha) e cada operação podem gravar?
//   GET  /api/recepcao/apoio                            recepções, locais, geradores, guichês em uso, o meu guichê
//   GET  /api/recepcao/fila?recepcao&local&guiche&geradores=1,2   a fila do guichê na ordem de chamada
//   POST /api/recepcao/guiche/abrir                      recepcao.abrirGuiche
//   POST /api/recepcao/guiche/fechar                     recepcao.fecharGuiche (de outra pessoa: recepcao.guiche.liberar)
//   POST /api/recepcao/senhas                            recepcao.emitirSenha no balcão
//   POST /api/recepcao/senhas/chamar                     recepcao.chamarSenha (a próxima ou a escolhida; sem espera)
//   POST /api/recepcao/senhas/:id/eventos                recepcao.registrarEventoSenha (a permissão pelo evento)
//   POST /api/recepcao/senhas/:id/chegada                recepcao.registrarChegada (check-in do agendado)
//   POST /api/recepcao/senhas/:id/chegada/desfazer       recepcao.desfazerChegada (com o motivo; ficha aberta recusa)
//   GET  /api/recepcao/agendados?cpf&prontuario&agenda   agendados do dia (busca; nome mascarado; auditado)
// A chamada do novo vai ao painel logo depois do COMMIT (a central de chamadas avisa os painéis).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AgendadosDoDia,
  type ApoioRecepcao as ApoioRecepcaoTela,
  esquemaAbrirGuiche,
  esquemaChamarSenha,
  esquemaConsultaAgendados,
  esquemaEmitirSenha,
  esquemaFecharGuiche,
  esquemaDesfazerChegada,
  esquemaRegistrarChegada,
  esquemaRegistrarEventoSenha,
  EVENTOS_AUDITAVEIS,
  type FilaGuiche,
  type GravacaoRecepcao,
  type ResultadoRecepcao,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioRecepcao, permissaoDoEvento } from './apoio.js';
import { CENTRAL_CHAMADAS } from './simbolos.js';
import type { CentralChamadas } from './chamadas.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from './porta.js';
import { ServicoRecepcao } from './servico.js';

export function corpo<T>(
  esquema: {
    safeParse(
      v: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[] }[] } };
  },
  v: unknown,
): T {
  const r = esquema.safeParse(v);
  if (!r.success)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
      campos: [...new Set(r.error.issues.map((i) => i.path.map(String).join('.') || '(corpo)'))],
    });
  return r.data;
}

export const inteiroDaConsulta = (v: string | undefined): number | null => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
};

const esquemaEvento = z.object({}).passthrough();

@Controller('recepcao')
export class RecepcaoController {
  private readonly apoio: ApoioRecepcao;
  private readonly servico: ServicoRecepcao;
  constructor(
    @Inject(PORTA_RECEPCAO) private readonly porta: PortaRecepcao,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(CENTRAL_CHAMADAS) private readonly central: CentralChamadas | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioRecepcao(porta, trilha, configuracao, cache);
    this.servico = new ServicoRecepcao(porta, central);
  }

  @Get('gravacao')
  @Permissao('recepcao.senha.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoRecepcao> {
    return this.apoio.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao('recepcao.senha.ler')
  apoioTela(@Req() req: RequisicaoAutorizada): Promise<ApoioRecepcaoTela> {
    const s = sessaoDe(req);
    return this.servico.apoio(s.porta, s.login);
  }

  @Get('fila')
  @Permissao('recepcao.senha.ler')
  fila(@Req() req: RequisicaoAutorizada, @Query() q: Record<string, string>): Promise<FilaGuiche> {
    const s = sessaoDe(req);
    const recepcao = inteiroDaConsulta(q['recepcao']);
    const local = inteiroDaConsulta(q['local']);
    const guiche = Number(q['guiche'] ?? 0);
    if (!recepcao || !local || !Number.isInteger(guiche) || guiche < 0 || guiche > 99)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Guichê inválido',
        'Informe a recepção, o local e o guichê.',
      );
    const geradores = (q['geradores'] ?? '')
      .split(',')
      .map((x) => inteiroDaConsulta(x))
      .filter((x): x is number => x !== null)
      .slice(0, 40);
    return this.servico.fila(s.porta, { recepcao, local, guiche, geradores, login: s.login });
  }

  @Post('guiche/abrir')
  @HttpCode(201)
  @Permissao('recepcao.senha.chamar')
  @AuditadoNoHandler('recepcao.abrirGuiche pelo executor (trilha na mesma transação)')
  abrirGuiche(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRecepcao> {
    return this.apoio.executar(
      sessaoDe(req),
      'recepcao.abrirGuiche',
      corpo(esquemaAbrirGuiche, b),
      'Guichê aberto.',
    );
  }

  @Post('guiche/fechar')
  @HttpCode(201)
  @Permissao('recepcao.senha.chamar')
  @AuditadoNoHandler('recepcao.fecharGuiche pelo executor (trilha na mesma transação)')
  async fecharGuiche(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRecepcao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaFecharGuiche, b);
    // Fechar o guichê de outra pessoa é a liberação de guichê bloqueado (supervisor), com justificativa.
    if (e.justificativa) await exigir(s, 'recepcao.guiche.liberar', this.trilha);
    return this.apoio.executar(
      s,
      'recepcao.fecharGuiche',
      e,
      e.justificativa ? 'Guichê liberado.' : 'Guichê fechado.',
    );
  }

  @Post('senhas')
  @HttpCode(201)
  @Permissao('recepcao.senha.emitir')
  @AuditadoNoHandler('recepcao.emitirSenha pelo executor (trilha na mesma transação)')
  emitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRecepcao> {
    const e = corpo(esquemaEmitirSenha, b);
    if (e.origem !== 'balcao')
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Origem inválida',
        'No balcão a senha é emitida com origem balcão.',
      );
    return this.apoio.executar(sessaoDe(req), 'recepcao.emitirSenha', e, 'Senha emitida.');
  }

  /** Depois do COMMIT: a chamada (ou a nova chamada) vai aos painéis na hora. */
  private async avisarPainel(s: SessaoCadastro, senha: number): Promise<void> {
    if (!this.central) return;
    try {
      const x = await this.porta.senha(s.porta, senha);
      if (x) await this.central.registrarDoNovo(s.hospital, x);
    } catch {
      // O painel pega a chamada pelo vigia no próximo ciclo.
    }
  }

  @Post('senhas/chamar')
  @HttpCode(201)
  @Permissao('recepcao.senha.chamar')
  @AuditadoNoHandler('recepcao.chamarSenha pelo executor (trilha na mesma transação)')
  async chamar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRecepcao> {
    const s = sessaoDe(req);
    const r = await this.apoio.executar(
      s,
      'recepcao.chamarSenha',
      corpo(esquemaChamarSenha, b),
      'Senha chamada.',
    );
    if (!r.repetida) await this.avisarPainel(s, Number(r.resultado['senha']));
    return r;
  }

  @Post('senhas/:id/eventos')
  @HttpCode(201)
  @Permissao('recepcao.senha.ler')
  @AuditadoNoHandler('recepcao.registrarEventoSenha pelo executor (trilha na mesma transação)')
  async evento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRecepcao> {
    const s = sessaoDe(req);
    const bruto = corpo(esquemaEvento, b) as Record<string, unknown>;
    const e = corpo(esquemaRegistrarEventoSenha, { ...bruto, senha: idDaRota(id) });
    await exigir(s, permissaoDoEvento(e.evento), this.trilha);
    const r = await this.apoio.executar(s, 'recepcao.registrarEventoSenha', e, 'Evento registrado.');
    if (!r.repetida && (e.evento === 'rechamar' || e.evento === 'retomar'))
      await this.avisarPainel(s, e.senha);
    return r;
  }

  @Post('senhas/:id/chegada')
  @HttpCode(201)
  @Permissao('recepcao.checkin.registrar')
  @AuditadoNoHandler('recepcao.registrarChegada pelo executor (trilha na mesma transação)')
  chegada(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRecepcao> {
    const bruto = corpo(esquemaEvento, b) as Record<string, unknown>;
    const e = corpo(esquemaRegistrarChegada, { ...bruto, senha: idDaRota(id) });
    return this.apoio.executar(sessaoDe(req), 'recepcao.registrarChegada', e, 'Chegada registrada.');
  }

  @Post('senhas/:id/chegada/desfazer')
  @HttpCode(201)
  @Permissao('recepcao.checkin.registrar')
  @AuditadoNoHandler('recepcao.desfazerChegada pelo executor (trilha com o motivo na mesma transação)')
  desfazerChegada(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRecepcao> {
    const bruto = corpo(esquemaEvento, b) as Record<string, unknown>;
    const e = corpo(esquemaDesfazerChegada, { ...bruto, senha: idDaRota(id) });
    return this.apoio.executar(sessaoDe(req), 'recepcao.desfazerChegada', e, 'Chegada desfeita.');
  }

  @Get('agendados')
  @Permissao('recepcao.checkin.registrar')
  @Auditar(EVENTOS_AUDITAVEIS.recepcaoAgendadosLidos.codigo)
  agendados(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AgendadosDoDia> {
    const f = corpo(esquemaConsultaAgendados, {
      ...(q['cpf'] ? { cpf: q['cpf'] } : {}),
      ...(q['prontuario'] ? { prontuario: q['prontuario'] } : {}),
      ...(q['agenda'] ? { agenda: q['agenda'] } : {}),
    });
    return this.servico.agendados(sessaoDe(req).porta, f);
  }
}
