// Sinais vitais com o detalhe da aferição e os limites de alerta por setor (F3.3, 03-PEP L115), no banco próprio:
//   GET  /api/enfermagem/afericao/catalogos                 parâmetros, instrumentos, locais, posições, motivos, setores
//   GET  /api/enfermagem/pacientes/:paciente/afericoes       as aferições detalhadas recentes do paciente
//   POST /api/enfermagem/pacientes/:paciente/afericoes       registra a aferição (instrumento, local, posição, não
//        aferido com motivo; nível de alerta pelo limite do setor, do instrumento, do sexo e da idade)
//   GET  /api/enfermagem/limites-sinais                      limites (ativos e inativos) e regras dos setores
//   POST /api/enfermagem/limites-sinais                      inclui um limite
//   POST /api/enfermagem/limites-sinais/:id/inativacao       inativa com o motivo (nunca apaga)
//   POST /api/enfermagem/limites-sinais/padrao-news2         inclui os limites do adulto pelo NEWS2 que faltam
//   POST /api/enfermagem/limites-sinais/regras-setor         grava a regra do parâmetro no setor
// A trilha vai na mesma transação da gravação (Executor), e a mesma Idempotency-Key não grava duas vezes.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_ENFERMAGEM } from '@sgh/contratos';
import { horaRealAceita } from '@sgh/dominio-enfermagem';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { sessaoComAto } from './gravacao-direta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { PortaEnfermagemPropria } from './porta-propria.js';
import {
  type AfericaoFeita,
  afericoesDoPaciente,
  aplicarPadraoNews2Tx,
  catalogosAfericao,
  gravarRegraSetorTx,
  inativarLimiteTx,
  incluirLimiteTx,
  limitesDoEstabelecimento,
  regrasDosSetores,
  registrarAfericaoTx,
  TABELAS_AFERICAO_DETALHE,
  TABELAS_LIMITES,
} from './sinais-detalhe-propria.js';

const P = PERMISSOES_ENFERMAGEM;
const CODIGO = /^[a-z][a-z0-9_]{0,29}$/;
const id = z.number().int().positive();
const faixa = z.number().min(-10_000).max(100_000).nullable().default(null);

export const esquemaAfericaoDetalhada = z
  .object({
    atendimento: id.nullable().default(null),
    horaReal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .nullable()
      .default(null),
    observacao: z.string().trim().max(500).nullable().default(null),
    valores: z
      .array(
        z
          .object({
            tipo: z.string().regex(CODIGO),
            valor: z.number().min(-10_000).max(100_000).nullable().default(null),
            instrumento: id.nullable().default(null),
            local: id.nullable().default(null),
            posicao: id.nullable().default(null),
            naoAferido: z.boolean().default(false),
            motivo: id.nullable().default(null),
            justificativa: z.string().trim().max(500).nullable().default(null),
            confirmadoForaDaFaixa: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export const esquemaLimiteSinal = z
  .object({
    parametro: z.string().regex(CODIGO),
    abrangencia: z.enum(['cliente', 'estabelecimento']).default('estabelecimento'),
    setor: id.nullable().default(null),
    instrumento: id.nullable().default(null),
    sexo: z.enum(['ambos', 'feminino', 'masculino']).default('ambos'),
    idadeMinimaDias: z.number().int().min(0).max(54_750).default(0),
    idadeMaximaDias: z.number().int().min(0).max(54_750).nullable().default(null),
    limiteInferior: faixa,
    normalInferior: faixa,
    normalSuperior: faixa,
    limiteSuperior: faixa,
  })
  .strict();

export const esquemaInativarLimite = z
  .object({ versao: z.number().int().positive(), motivo: z.string().trim().min(10).max(300) })
  .strict();

export const esquemaRegraSetor = z
  .object({
    setor: id,
    parametro: z.string().regex(CODIGO),
    obrigatorio: z.boolean().default(false),
    periodicidadeMinutos: z.number().int().min(5).max(10_080).nullable().default(null),
    exibeLocal: z.boolean().default(false),
    exigeLocal: z.boolean().default(false),
    exibePosicao: z.boolean().default(false),
    exigePosicao: z.boolean().default(false),
    ativo: z.boolean().default(true),
    versao: z.number().int().positive().nullable().default(null),
  })
  .strict();

@Controller('enfermagem')
export class SinaisDetalheController {
  constructor(@Inject(PORTA_ENFERMAGEM) private readonly porta: PortaEnfermagem) {}

  private propria(): PortaEnfermagemPropria {
    if (!(this.porta instanceof PortaEnfermagemPropria))
      throw new ErroProblema(
        'recurso-desligado',
        501,
        'Sinais vitais',
        'O detalhe da aferição e os limites gravam só no banco próprio do cliente.',
        { codigo: 'pendente-modelo-proprio' },
      );
    return this.porta;
  }

  @Get('afericao/catalogos')
  @Permissao(P.sinalLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async catalogos(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'parametro_vital' };
    return this.propria().lerNoBanco(s.porta, (l, est) => catalogosAfericao(l, est));
  }

  @Get('pacientes/:paciente/afericoes')
  @Permissao(P.sinalLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async afericoes(@Param('paciente') paciente: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const p = idDaRota(paciente);
    req.sghAlvo = { paciente: p, tabelaAlvo: 'afericao_valor' };
    const itens = await this.propria().lerNoBanco(s.porta, (l, est) => afericoesDoPaciente(l, est, p));
    return { paciente: p, itens };
  }

  @Post('pacientes/:paciente/afericoes')
  @HttpCode(201)
  @Permissao(P.sinalCriar)
  @AuditadoNoHandler('a aferição em afericao e afericao_valor com a trilha_auditoria na mesma transação')
  async registrar(@Param('paciente') paciente: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const p = idDaRota(paciente);
    const e = corpo(esquemaAfericaoDetalhada, b);
    const s = sessaoComAto(sessaoDe(req), { paciente: p, ...e }, null, ':afericao-detalhada');
    const agora = (await this.porta.relogio(s.porta)).slice(0, 16);
    const hora = e.horaReal ?? agora;
    if (!horaRealAceita({ horaReal: hora, agora, prazoHoras: 24 }))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Sinais vitais',
        'A hora da aferição é do futuro ou de mais de 24 horas.',
        { campos: ['horaReal'] },
      );
    const r = await this.propria().gravarNaTransacao<AfericaoFeita>(
      s.porta,
      'enfermagem.registrar-afericao-detalhada',
      TABELAS_AFERICAO_DETALHE,
      (f) => ({
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'inclusao',
        entidade: 'afericao',
        entidadeId: f.afericao,
        dadosDepois: { paciente: p, parametros: f.valores.length },
      }),
      (tx, est, an) => registrarAfericaoTx(tx, est, an, { ...e, paciente: p, horaReal: hora }),
    );
    const criticos = r.valores.filter((v) => v.nivel === 'critico').length;
    const atencao = r.valores.filter((v) => v.nivel === 'atencao').length;
    return {
      ok: true,
      ...r,
      mensagem:
        `Aferição registrada (${r.valores.length} parâmetro(s))` +
        (criticos ? `: ${criticos} na faixa crítica` : '') +
        (atencao ? `${criticos ? ',' : ':'} ${atencao} em atenção` : '') +
        '.',
    };
  }

  @Get('limites-sinais')
  @Permissao(P.sinalLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async limites(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'limite_parametro_vital' };
    return this.propria().lerNoBanco(s.porta, async (l, est) => ({
      limites: await limitesDoEstabelecimento(l, est),
      regras: await regrasDosSetores(l, est),
    }));
  }

  @Post('limites-sinais')
  @HttpCode(201)
  @Permissao(P.limiteSinalEditar)
  @AuditadoNoHandler('o limite em limite_parametro_vital com a trilha_auditoria na mesma transação')
  async incluirLimite(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaLimiteSinal, b);
    const s = sessaoComAto(sessaoDe(req), e, null, ':limite-sinal');
    const r = await this.propria().gravarNaTransacao<{ id: number }>(
      s.porta,
      'enfermagem.incluir-limite-sinal',
      TABELAS_LIMITES,
      (f) => ({
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'inclusao',
        entidade: 'limite_parametro_vital',
        entidadeId: f.id,
        dadosDepois: { ...e },
      }),
      (tx, est, an) => incluirLimiteTx(tx, est, an, e),
    );
    return { ok: true, ...r, mensagem: 'Limite incluído: vale para as próximas aferições.' };
  }

  @Post('limites-sinais/padrao-news2')
  @HttpCode(200)
  @Permissao(P.limiteSinalEditar)
  @AuditadoNoHandler('os limites padrão em limite_parametro_vital com a trilha_auditoria na mesma transação')
  async padraoNews2(@Req() req: RequisicaoAutorizada) {
    const s = sessaoComAto(sessaoDe(req), { padrao: 'news2' }, null, ':limite-news2');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.aplicar-limites-news2',
      TABELAS_LIMITES,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'inclusao',
        entidade: 'limite_parametro_vital',
        entidadeId: null,
      },
      (tx, est, an) => aplicarPadraoNews2Tx(tx, est, an),
    );
    return {
      ok: true,
      ...r,
      mensagem: r.incluidos.length
        ? `Limites do NEWS2 incluídos para ${r.incluidos.length} parâmetro(s).`
        : 'O estabelecimento já tinha os limites do NEWS2.',
    };
  }

  @Post('limites-sinais/regras-setor')
  @HttpCode(200)
  @Permissao(P.limiteSinalEditar)
  @AuditadoNoHandler('a regra em parametro_vital_setor com a trilha_auditoria na mesma transação')
  async regraSetor(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegraSetor, b);
    const s = sessaoComAto(sessaoDe(req), e, null, ':regra-setor');
    const r = await this.propria().gravarNaTransacao<{ id: number; versao: number }>(
      s.porta,
      'enfermagem.gravar-regra-setor-sinal',
      TABELAS_LIMITES,
      (f) => ({
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: f.versao === 1 ? 'inclusao' : 'alteracao',
        entidade: 'parametro_vital_setor',
        entidadeId: f.id,
        dadosDepois: { ...e },
      }),
      (tx, est, an) => gravarRegraSetorTx(tx, est, an, e),
    );
    return { ok: true, ...r, mensagem: 'Regra do setor gravada.' };
  }

  @Post('limites-sinais/:id/inativacao')
  @HttpCode(200)
  @Permissao(P.limiteSinalEditar)
  @AuditadoNoHandler('a inativação em limite_parametro_vital com a trilha_auditoria na mesma transação')
  async inativar(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaInativarLimite, b);
    const s = sessaoComAto(sessaoDe(req), { id: n, ...e }, null, ':inativar-limite');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.inativar-limite-sinal',
      TABELAS_LIMITES,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'limite_parametro_vital',
        entidadeId: n,
        motivo: e.motivo,
      },
      (tx, est, an) => inativarLimiteTx(tx, est, an, n, e.versao, e.motivo),
    );
    return { ok: true, ...r, mensagem: 'Limite inativado: fica no histórico.' };
  }
}
