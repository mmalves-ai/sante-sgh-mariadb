// Rotas das regras de coparticipação do plano e do contrato (08-SGO L98, C2-116): a regra geral e as restritas a tipo
// de guia, grupo, procedimento e regime, com os tetos por evento, mês e ano. Ler com a consulta de produtos e contratos;
// gravar com a edição do produto e do contrato (concedidas por perfil em permissoes/operadora.ts):
//   GET  operadora/coparticipacao-regras/:op/opcoes                 operadora.beneficiario.ler
//   GET  operadora/coparticipacao-regras/:op?plano=&contrato=       operadora.beneficiario.ler
//   GET  operadora/coparticipacao-procedimentos?busca=              operadora.beneficiario.ler
//   POST operadora/coparticipacao-regras/:op                        operadora.beneficiario.editar   inclui a regra
//   POST operadora/coparticipacao-regras/regra/:id/encerrar         operadora.beneficiario.editar   fim da vigência
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
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
  PORTA_REGRAS_COPARTICIPACAO,
  type PortaRegrasCoparticipacaoPropria,
} from './regras-coparticipacao-propria.js';

const LER = 'operadora.beneficiario.ler';
const EDITAR = 'operadora.beneficiario.editar';
const AUD = 'operadora.coparticipacao.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const idNulo = id.nullable().default(null);
const dinheiro = z.number().nonnegative().max(1_000_000_000).nullable().default(null);
const esquemaRegra = z
  .object({
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    plano: idNulo,
    contrato: idNulo,
    tipo: z.enum(['nenhuma', 'percentual', 'valor_fixo']),
    valor: dinheiro,
    tetoEvento: dinheiro,
    tetoMensal: dinheiro,
    tetoAnual: dinheiro,
    procedimento: idNulo,
    grupo: idNulo,
    tipoGuia: idNulo,
    regime: idNulo,
    inicio: data,
    fim: data.nullable().default(null),
  })
  .strict();
const esquemaEncerrar = z.object({ versao: z.number().int().positive(), fim: data }).strict();
const idDaConsulta = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);

@Controller()
export class RegrasCoparticipacaoController {
  constructor(
    @Inject(PORTA_REGRAS_COPARTICIPACAO) private readonly porta: PortaRegrasCoparticipacaoPropria,
  ) {}

  private trilha(s: SessaoCadastro, evento: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.coparticipacao', evento, {
        tabela: 'regra_coparticipacao',
        id: String(r.id),
      });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/coparticipacao-regras/:op/opcoes')
  @Permissao(LER)
  opcoes(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.opcoes(sessaoDe(req).porta, idDaRota(op)));
  }

  @Get('operadora/coparticipacao-procedimentos')
  @Permissao(LER)
  procedimentos(@Query('busca') busca: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ok(
      this.porta.procedimentos(sessaoDe(req).porta, typeof busca === 'string' ? busca.slice(0, 60) : ''),
    );
  }

  @Get('operadora/coparticipacao-regras/:op')
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

  @Post('operadora/coparticipacao-regras/:op')
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
        this.trilha(s, 'operadora.coparticipacao.regra.incluida'),
      ),
    );
  }

  @Post('operadora/coparticipacao-regras/regra/:id/encerrar')
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
        this.trilha(s, 'operadora.coparticipacao.regra.encerrada'),
      ),
    );
  }
}
