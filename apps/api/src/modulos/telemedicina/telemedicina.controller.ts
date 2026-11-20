// Telemedicina na tela do médico (M50, etapa 4; ficha, seção 7: `PEP > Telemedicina (teleconsulta e
// teleinterconsulta)`, rota `/pep/telemedicina/:atendimento`; regra 7):
//   GET  /api/telemedicina?data&minhas                       as teleconsultas do dia e as teleinterconsultas
//   GET  /api/telemedicina/apoio                             especialidades, unidades, centros de custo, médicos
//   GET  /api/telemedicina/cid?termo · /atendimentos?termo   buscas da abertura e do pedido da interconsulta
//   GET  /api/telemedicina/:id                               o detalhe (leitura auditada: dados do paciente)
//   POST /api/telemedicina/:id/inicio                        abrir a sala e o atendimento (receita do M20)
//   POST /api/telemedicina/:id/encerramento                  encerrar com o motivo
//   POST /api/telemedicina/interconsultas                    pedir a teleinterconsulta
//   POST /api/telemedicina/interconsultas/:id/sala | /parecer | /cancelamento
// As gravações exigem a Idempotency-Key (o executor do M20) e a chave `telemedicina` (POL-3).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AtendimentoResumo,
  esquemaCancelarTeleinterconsulta,
  esquemaEncerrarTeleconsulta,
  esquemaIniciarTeleconsulta,
  esquemaResponderTeleinterconsulta,
  esquemaSolicitarTeleinterconsulta,
  EVENTOS_AUDITAVEIS,
  type ListaTelemedicina,
  type ResultadoTeleconsulta,
  type TeleconsultaDetalhe,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import type { ServicoTelemedicina } from './servico.js';

export const SERVICO_TELEMEDICINA = Symbol('SERVICO_TELEMEDICINA');

const LER = 'atendimento.teleconsulta.ler';
const REALIZAR = 'atendimento.teleconsulta.realizar';
const versao = z.object({ versao: z.number().int().positive() }).strict();

@Controller('telemedicina')
export class TelemedicinaController {
  constructor(@Inject(SERVICO_TELEMEDICINA) private readonly servico: ServicoTelemedicina) {}

  @Get()
  @Permissao(LER)
  lista(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaTelemedicina> {
    const data = q['data'] && /^\d{4}-\d{2}-\d{2}$/.test(q['data']) ? q['data'] : null;
    return this.servico.lista(sessaoDe(req), { data, minhas: q['minhas'] === '1' });
  }

  @Get('apoio')
  @Permissao(LER)
  async apoio(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const a = await this.servico.apoioDaAbertura(s);
    return a;
  }

  @Get('cid')
  @Permissao(LER)
  cid(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.servico.cid(sessaoDe(req), (termo ?? '').slice(0, 40));
  }

  @Get('atendimentos')
  @Permissao(LER)
  @Auditar(EVENTOS_AUDITAVEIS.teleconsultaLida.codigo)
  atendimentos(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AtendimentoResumo[]> {
    req.sghAlvo = { tabelaAlvo: 'RECADATE', idAlvo: 'lista-do-dia' };
    return this.servico.atendimentosAbertos(sessaoDe(req), (termo ?? '').slice(0, 60));
  }

  @Get(':id')
  @Permissao(LER)
  @Auditar(EVENTOS_AUDITAVEIS.teleconsultaLida.codigo)
  async detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<TeleconsultaDetalhe> {
    const d = await this.servico.detalhe(sessaoDe(req), idDaRota(id));
    req.sghAlvo = {
      ...(d.paciente ? { paciente: d.paciente.id } : {}),
      tabelaAlvo: 'SGH_ATD_TELECONSULTA',
      idAlvo: String(d.id),
    };
    return d;
  }

  @Post(':id/inicio')
  @HttpCode(200)
  @Permissao(REALIZAR)
  @AuditadoNoHandler(
    'atendimento.abrirSalaTeleconsulta (SGH_) e atendimento.abrirAtendimento pelo executor (cenário teleconsulta), com a SGH_TRILHA',
  )
  iniciar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoTeleconsulta> {
    return this.servico.iniciar(sessaoDe(req), idDaRota(id), corpo(esquemaIniciarTeleconsulta, b));
  }

  @Post(':id/encerramento')
  @HttpCode(200)
  @Permissao(REALIZAR)
  @AuditadoNoHandler('atendimento.encerrarTeleconsulta (SGH_) com a SGH_TRILHA na mesma transação')
  encerrar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoTeleconsulta> {
    return this.servico.encerrar(sessaoDe(req), idDaRota(id), corpo(esquemaEncerrarTeleconsulta, b));
  }

  @Post('interconsultas')
  @HttpCode(201)
  @Permissao(REALIZAR)
  @AuditadoNoHandler('atendimento.solicitarTeleinterconsulta (SGH_) com a SGH_TRILHA na mesma transação')
  solicitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTeleconsulta> {
    return this.servico.solicitarInterconsulta(sessaoDe(req), corpo(esquemaSolicitarTeleinterconsulta, b));
  }

  @Post('interconsultas/:id/sala')
  @HttpCode(200)
  @Permissao(REALIZAR)
  @AuditadoNoHandler('sala da teleinterconsulta aberta pelo convidado (SGH_) com a SGH_TRILHA')
  sala(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoTeleconsulta> {
    return this.servico.abrirSalaInterconsulta(sessaoDe(req), idDaRota(id), corpo(versao, b).versao);
  }

  @Post('interconsultas/:id/parecer')
  @HttpCode(200)
  @Permissao(REALIZAR)
  @AuditadoNoHandler('atendimento.responderTeleinterconsulta (SGH_) com a SGH_TRILHA na mesma transação')
  responder(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoTeleconsulta> {
    return this.servico.responderInterconsulta(
      sessaoDe(req),
      idDaRota(id),
      corpo(esquemaResponderTeleinterconsulta, b),
    );
  }

  @Post('interconsultas/:id/cancelamento')
  @HttpCode(200)
  @Permissao(REALIZAR)
  @AuditadoNoHandler('teleinterconsulta cancelada por quem pediu (SGH_) com a SGH_TRILHA')
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoTeleconsulta> {
    return this.servico.cancelarInterconsulta(
      sessaoDe(req),
      idDaRota(id),
      corpo(esquemaCancelarTeleinterconsulta, b),
    );
  }
}
