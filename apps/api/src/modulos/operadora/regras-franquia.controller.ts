// Rotas das regras de franquia do plano e do contrato (08-SGO L98, C2-116): o limite da janela de acúmulo, o
// percentual ou o fator, o teto por guia e a internação. Ler com a consulta de produtos e contratos; gravar com a
// edição do produto e do contrato (concedidas por perfil em permissoes/operadora.ts):
//   GET  operadora/franquia-regras/:op/opcoes                       operadora.beneficiario.ler
//   GET  operadora/franquia-regras/:op?plano=&contrato=             operadora.beneficiario.ler
//   GET  operadora/franquia-regras/regra/:id/acumulado?beneficiario=&data=   operadora.beneficiario.ler
//   POST operadora/franquia-regras/:op                              operadora.beneficiario.editar   inclui a regra
//   POST operadora/franquia-regras/regra/:id/encerrar               operadora.beneficiario.editar   fim da vigência
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { PERIODOS_ACUMULO, type PeriodoAcumulo } from '@sgh/dominio-operadora';
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
  PORTA_REGRAS_FRANQUIA,
  type PortaRegrasFranquiaPropria,
} from './regras-franquia-propria.js';

const LER = 'operadora.beneficiario.ler';
const EDITAR = 'operadora.beneficiario.editar';
const AUD = 'operadora.franquia.gravado com a trilha_auditoria na mesma transação (porta própria)';

const dataRe = /^\d{4}-\d{2}-\d{2}$/;
const data = z.string().regex(dataRe);
const id = z.number().int().positive();
const idNulo = id.nullable().default(null);
const numeroNulo = z.number().nonnegative().max(1_000_000_000).nullable().default(null);
const esquemaRegra = z
  .object({
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    tipoFranquia: id,
    plano: idNulo,
    contrato: idNulo,
    grupo: idNulo,
    regime: idNulo,
    valor: numeroNulo,
    percentual: numeroNulo,
    fator: numeroNulo,
    tetoPorGuia: numeroNulo,
    periodoAcumulo: z.enum(PERIODOS_ACUMULO as [PeriodoAcumulo, ...PeriodoAcumulo[]]),
    diasInternacao: z.number().int().nullable().default(null),
    cobraGuiaAmbulatorialNaInternacao: z.boolean().default(false),
    inicio: data,
    fim: data.nullable().default(null),
  })
  .strict();
const esquemaEncerrar = z.object({ versao: z.number().int().positive(), fim: data }).strict();
const idDaConsulta = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);

@Controller()
export class RegrasFranquiaController {
  constructor(@Inject(PORTA_REGRAS_FRANQUIA) private readonly porta: PortaRegrasFranquiaPropria) {}

  private trilha(s: SessaoCadastro, evento: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.franquia', evento, {
        tabela: 'regra_franquia_plano',
        id: String(r.id),
      });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/franquia-regras/:op/opcoes')
  @Permissao(LER)
  opcoes(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.opcoes(sessaoDe(req).porta, idDaRota(op)));
  }

  @Get('operadora/franquia-regras/regra/:id/acumulado')
  @Permissao(LER)
  acumulado(
    @Param('id') idRegra: string,
    @Query('beneficiario') beneficiario: unknown,
    @Query('data') dataEvento: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const dia =
      typeof dataEvento === 'string' && dataRe.test(dataEvento)
        ? dataEvento
        : new Date().toISOString().slice(0, 10);
    return this.ok(
      this.porta.acumulado(sessaoDe(req).porta, idDaRota(idRegra), idDaConsulta(beneficiario) ?? 0, dia),
    );
  }

  @Get('operadora/franquia-regras/:op')
  @Permissao(LER)
  regras(
    @Param('op') op: string,
    @Query('plano') plano: unknown,
    @Query('contrato') contrato: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.ok(
      this.porta.regras(sessaoDe(req).porta, idDaRota(op), {
        plano: idDaConsulta(plano),
        contrato: idDaConsulta(contrato),
      }),
    );
  }

  @Post('operadora/franquia-regras/:op')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  incluir(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluir(
        s.porta,
        idDaRota(op),
        corpo(esquemaRegra, b),
        this.trilha(s, 'operadora.franquia.regra.incluida'),
      ),
    );
  }

  @Post('operadora/franquia-regras/regra/:id/encerrar')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  encerrar(@Param('id') idRegra: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.encerrar(
        s.porta,
        idDaRota(idRegra),
        corpo(esquemaEncerrar, b),
        this.trilha(s, 'operadora.franquia.regra.encerrada'),
      ),
    );
  }
}
