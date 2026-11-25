// Rotas da conferência das contas médicas recebidas (08-SGO linha 105, C1-100; F7): as críticas gravadas no
// recebimento, os pareceres da auditoria e os demonstrativos entregues de cada conta; e as regras de crítica que a
// operadora cadastra. Ler com operadora.conta.ler; gravar com operadora.conta.analisar (as mesmas da análise da conta):
//   GET  operadora/contas/:id/conferencia                       críticas, pareceres e demonstrativos emitidos da conta
//   POST operadora/contas/:id/auditorias                        registra o parecer da auditoria numa guia ou item
//   GET  operadora/regras-critica-conta/:op                     regras da operadora (as fora de uso no fim)
//   GET  operadora/regras-critica-conta/:op/apoio               procedimentos, motivos de glosa e prestadores
//   POST operadora/regras-critica-conta/:op                     inclui uma regra
//   POST operadora/regras-critica-conta/regra/:id/situacao      tira de uso ou volta (nunca apaga)
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  RESULTADOS_AUDITORIA_CONTA,
  TIPOS_AUDITORIA_CONTA,
  TIPOS_REGRA_CRITICA,
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
  PORTA_CONFERENCIA_CONTA,
  type PortaConferenciaContaPropria,
} from './conta-conferencia-propria.js';

const LER = 'operadora.conta.ler';
const ANALISAR = 'operadora.conta.analisar';
const AUD = 'operadora.conta-conferencia.gravada com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const esquemaRegra = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(150),
  tipo: z.enum(TIPOS_REGRA_CRITICA),
  principal: id.nullable(),
  relacionado: id.nullable(),
  prestador: id.nullable(),
  motivoGlosa: id.nullable(),
  percentual: z.number().min(0).max(100).nullable(),
  glosaAutomatica: z.boolean(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
});
const esquemaSituacao = z.object({ versao: id, ativo: z.boolean() });
const esquemaAuditoria = z.object({
  guia: id,
  item: id.nullable(),
  tipo: z.enum(TIPOS_AUDITORIA_CONTA),
  resultado: z.enum(RESULTADOS_AUDITORIA_CONTA),
  parecer: z.string().max(4000),
  motivoGlosa: id.nullable(),
});

@Controller()
export class ContaConferenciaOperadoraController {
  constructor(@Inject(PORTA_CONFERENCIA_CONTA) private readonly porta: PortaConferenciaContaPropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.conta-conferencia', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/contas/:id/conferencia')
  @Permissao(LER)
  conferencia(@Param('id') n: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.conferencia(sessaoDe(req).porta, idDaRota(n)));
  }

  @Post('operadora/contas/:id/auditorias')
  @HttpCode(201)
  @Permissao(ANALISAR)
  @AuditadoNoHandler(AUD)
  registrarAuditoria(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.registrarAuditoria(
        s.porta,
        idDaRota(n),
        corpo(esquemaAuditoria, b),
        this.trilha(s, 'operadora.conta.auditoria-registrada', 'auditoria_conta_recebida'),
      ),
    );
  }

  @Get('operadora/regras-critica-conta/:op')
  @Permissao(LER)
  regras(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.regras(sessaoDe(req).porta, idDaRota(op)));
  }

  @Get('operadora/regras-critica-conta/:op/apoio')
  @Permissao(LER)
  apoio(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.apoio(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/regras-critica-conta/:op')
  @HttpCode(201)
  @Permissao(ANALISAR)
  @AuditadoNoHandler(AUD)
  incluirRegra(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirRegra(
        s.porta,
        idDaRota(op),
        corpo(esquemaRegra, b),
        this.trilha(s, 'operadora.conta.regra-critica-incluida', 'regra_critica_conta'),
      ),
    );
  }

  @Post('operadora/regras-critica-conta/regra/:id/situacao')
  @HttpCode(200)
  @Permissao(ANALISAR)
  @AuditadoNoHandler(AUD)
  situacaoRegra(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaSituacao, b);
    return this.ok(
      this.porta.situacaoRegra(
        s.porta,
        idDaRota(n),
        e.versao,
        e.ativo,
        this.trilha(s, 'operadora.conta.regra-critica-situacao', 'regra_critica_conta'),
      ),
    );
  }
}
