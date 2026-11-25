// Fechamento da checagem do turno (03-PEP L113), no banco próprio do cliente:
//   GET  /api/enfermagem/fechamento-checagem?unidade&data[&turno]  os fechamentos do dia e do anterior (vigentes e
//        reabertos), com a composição; com o turno, marca os de turnos anteriores (os pendentes que chegaram a ele)
//   POST /api/enfermagem/fechamento-checagem                fecha o turno (setor da unidade ou um paciente)
//   POST /api/enfermagem/fechamento-checagem/:id/reabertura reabre com o motivo (os horários destravam)
// Quem fecha é quem passa o plantão (enfermagem.plantao.passar); quem reabre é quem pode estornar a checagem
// (enfermagem.administracao.estornar). Tudo ligado para todos: controla só o nível de acesso de cada cargo.
// A trilha vai na mesma transação da gravação (Executor), e a mesma Idempotency-Key não grava duas vezes.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_ENFERMAGEM } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  fechamentosDoDia,
  fecharChecagemTx,
  type FechamentoFeito,
  reabrirChecagemTx,
  TABELAS_FECHAMENTO,
} from './fechamento-checagem-propria.js';
import { sessaoComAto } from './gravacao-direta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { PortaEnfermagemPropria } from './porta-propria.js';

const P = PERMISSOES_ENFERMAGEM;
const UNIDADE = /^[A-Za-z0-9 ._-]{1,20}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaFechamentoChecagem = z
  .object({
    unidade: z.string().trim().regex(UNIDADE),
    data: z.string().regex(DATA),
    turno: z.enum(['diurno', 'noturno']),
    atendimento: z.number().int().positive().nullable().default(null),
    justificativa: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

export const esquemaReaberturaChecagem = z.object({ motivo: z.string().trim().min(1).max(500) }).strict();

@Controller('enfermagem/fechamento-checagem')
export class FechamentoChecagemController {
  constructor(@Inject(PORTA_ENFERMAGEM) private readonly porta: PortaEnfermagem) {}

  private propria(): PortaEnfermagemPropria {
    if (!(this.porta instanceof PortaEnfermagemPropria))
      throw new ErroProblema(
        'recurso-desligado',
        501,
        'Fechamento da checagem',
        'O fechamento do turno grava só no banco próprio do cliente.',
        { codigo: 'pendente-modelo-proprio' },
      );
    return this.porta;
  }

  @Get()
  @Permissao(P.horarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async listar(
    @Query('unidade') unidade: string | undefined,
    @Query('data') data: string | undefined,
    @Query('turno') turno: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const u = (unidade ?? '').trim();
    if (!UNIDADE.test(u) || !DATA.test(data ?? ''))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Fechamento da checagem',
        'Informe a unidade e a data.',
      );
    const s = sessaoDe(req);
    const t = turno === 'diurno' || turno === 'noturno' ? turno : null;
    const itens = await this.propria().lerNoBanco(s.porta, (l, est) => fechamentosDoDia(l, est, u, data!, t));
    req.sghAlvo = { tabelaAlvo: 'fechamento_horario_checagem', chaveNaturalAlvo: `unidade:${u}:${data}` };
    return { itens };
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.plantaoPassar)
  @AuditadoNoHandler('o fechamento em fechamento_horario_checagem com a trilha_auditoria na mesma transação')
  async fechar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaFechamentoChecagem, b);
    const s = sessaoComAto(sessaoDe(req), e, null, ':fechamento-checagem');
    const r = await this.propria().gravarNaTransacao<FechamentoFeito>(
      s.porta,
      'enfermagem.fechar-checagem-turno',
      TABELAS_FECHAMENTO,
      (f) => ({
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'inclusao',
        entidade: 'fechamento_horario_checagem',
        entidadeId: f.id,
        dadosDepois: { unidade: e.unidade, data: e.data, turno: e.turno, atendimento: e.atendimento },
      }),
      (tx, est, an) => fecharChecagemTx(tx, est, an, e),
    );
    return {
      ok: true,
      ...r,
      mensagem:
        r.pendentes.length > 0
          ? `Turno fechado: ${r.travados} horário(s) travado(s); ${r.pendentes.length} pendente(s) segue(m) para o próximo turno${r.pendentesAnteriores.length > 0 ? `, ${r.pendentesAnteriores.length} deles vindo(s) de turno anterior` : ''}.`
          : `Turno fechado: ${r.travados} horário(s) travado(s).`,
    };
  }

  @Post(':id/reabertura')
  @HttpCode(200)
  @Permissao(P.administracaoEstornar)
  @AuditadoNoHandler('a reabertura em fechamento_horario_checagem com a trilha_auditoria na mesma transação')
  async reabrir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaReaberturaChecagem, b);
    const s = sessaoComAto(sessaoDe(req), { id: n, ...e }, null, ':reabertura-checagem');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.reabrir-checagem-turno',
      TABELAS_FECHAMENTO,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'fechamento_horario_checagem',
        entidadeId: n,
        motivo: e.motivo,
      },
      (tx, est, an) => reabrirChecagemTx(tx, est, an, n, e.motivo),
    );
    return { ok: true, ...r, mensagem: 'Fechamento reaberto: os horários voltam a aceitar correção.' };
  }
}
