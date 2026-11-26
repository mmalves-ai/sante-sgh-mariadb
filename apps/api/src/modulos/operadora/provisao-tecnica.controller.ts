// Rotas da contabilidade regulatória da operadora (08-SGO L111, C3-026; F7):
//   GET  operadora/provisoes-tecnicas/plano-ans                       plano de contas padrão da ANS
//   POST operadora/provisoes-tecnicas/plano-ans                       inclui uma conta do plano padrão
//   GET  operadora/provisoes-tecnicas/:op/mapa                        mapa das contas próprias da operadora
//   POST operadora/provisoes-tecnicas/:op/mapa                        liga uma conta própria a uma conta da ANS
//   POST operadora/provisoes-tecnicas/mapa/:id/encerramento           encerra a vigência do mapa
//   GET  operadora/provisoes-tecnicas/:op/balancete?data=AAAA-MM-DD   balancete no padrão da ANS (para o DIOPS)
//   GET  operadora/provisoes-tecnicas                                 competências com os itens
//   POST operadora/provisoes-tecnicas/calculo                         calcula (ou recalcula) a competência
//   POST operadora/provisoes-tecnicas/:id/contabilizacao              grava o lançamento da variação
//   POST operadora/provisoes-tecnicas/:id/cancelamento                cancela com motivo
// Ler com operadora.provisao-tecnica.ler; plano e mapa com .editar; cálculo, contabilização e cancelamento com
// .calcular. Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { METODOS_PROVISAO_TECNICA, MODALIDADES_OPERADORA, TIPOS_PROVISAO_TECNICA } from '@sgh/dominio-operadora';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { type Gravado, PORTA_PROVISAO_TECNICA, type PortaProvisaoTecnicaPropria } from './provisao-tecnica-propria.js';

const LER = 'operadora.provisao-tecnica.ler';
const EDITAR = 'operadora.provisao-tecnica.editar';
const CALCULAR = 'operadora.provisao-tecnica.calcular';
const AUD = 'operadora.provisao-tecnica.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = z.number().int().positive();
const id = z.number().int().positive();
const valor = z.number().min(0).max(1e13);
const esquemaConta = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(255),
  tipo: z.enum(['sintetica', 'analitica']),
  natureza: z.enum(['devedora', 'credora']).nullable(),
  modalidades: z.array(z.enum(MODALIDADES_OPERADORA)).max(8).nullable(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  versaoFonte: z.string().min(1).max(30),
});
const esquemaMapa = z.object({
  contaContabil: id,
  contaAns: z.string().min(1).max(30),
  duplicaValor: z.boolean(),
  grupo: z.string().max(60).nullable(),
  subgrupo: z.string().max(60).nullable(),
  paginaDiops: z.number().int().min(0).max(65535).nullable(),
  linhaDiops: z.number().int().min(0).max(65535).nullable(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
});
const esquemaCalculo = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),
  metodo: z.enum(METODOS_PROVISAO_TECNICA),
  contas: z.partialRecord(z.enum(TIPOS_PROVISAO_TECNICA), id),
  base: z.object({ contraprestacoes: valor, eventos: valor, avisadosNaoPagos: valor }).nullable(),
  informados: z
    .array(z.object({ tipo: z.enum(TIPOS_PROVISAO_TECNICA), valor, observacao: z.string().max(500).nullable() }))
    .max(20),
  notaTecnica: z.string().max(200).nullable(),
  versao: versao.nullable(),
});
const esquemaContabilizacao = z.object({ versao, contaDespesa: id, contaReversao: id.nullable() });
const esquemaCancelamento = z.object({ versao, motivo: z.string().min(1).max(500) });
const esquemaEncerramento = z.object({ versao, fim: data });

@Controller()
export class ProvisaoTecnicaOperadoraController {
  constructor(@Inject(PORTA_PROVISAO_TECNICA) private readonly porta: PortaProvisaoTecnicaPropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) => linhaTrilha(s, evento, 'operadora.provisao-tecnica', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/provisoes-tecnicas/plano-ans')
  @Permissao(LER)
  planoAns(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.contasPadrao(sessaoDe(req).porta));
  }

  @Post('operadora/provisoes-tecnicas/plano-ans')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  gravarConta(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarContaPadrao(
        s.porta,
        corpo(esquemaConta, b),
        this.trilha(s, 'operadora.ans.conta-padrao-incluida', 'plano_contas_padrao_ans'),
      ),
    );
  }

  @Get('operadora/provisoes-tecnicas/:op/mapa')
  @Permissao(LER)
  mapa(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.mapas(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/provisoes-tecnicas/:op/mapa')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  gravarMapa(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarMapa(
        s.porta,
        idDaRota(op),
        corpo(esquemaMapa, b),
        this.trilha(s, 'operadora.ans.mapa-conta-incluido', 'mapa_conta_balancete_ans'),
      ),
    );
  }

  @Post('operadora/provisoes-tecnicas/mapa/:id/encerramento')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  encerrarMapa(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.encerrarMapa(
        s.porta,
        idDaRota(i),
        corpo(esquemaEncerramento, b),
        this.trilha(s, 'operadora.ans.mapa-conta-encerrado', 'mapa_conta_balancete_ans'),
      ),
    );
  }

  @Get('operadora/provisoes-tecnicas/:op/balancete')
  @Permissao(LER)
  balancete(@Param('op') op: string, @Query('data') dia: string | undefined, @Req() req: RequisicaoAutorizada) {
    const d = corpo(z.object({ data }), { data: dia });
    return this.ok(this.porta.balancete(sessaoDe(req).porta, idDaRota(op), d.data));
  }

  @Get('operadora/provisoes-tecnicas')
  @Permissao(LER)
  provisoes(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.provisoes(sessaoDe(req).porta));
  }

  @Post('operadora/provisoes-tecnicas/calculo')
  @HttpCode(201)
  @Permissao(CALCULAR)
  @AuditadoNoHandler(AUD)
  calcular(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.calcular(
        s.porta,
        corpo(esquemaCalculo, b),
        this.trilha(s, 'operadora.provisao-tecnica.calculada', 'provisao_tecnica_competencia'),
      ),
    );
  }

  @Post('operadora/provisoes-tecnicas/:id/contabilizacao')
  @HttpCode(200)
  @Permissao(CALCULAR)
  @AuditadoNoHandler(AUD)
  contabilizar(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.contabilizar(
        s.porta,
        idDaRota(i),
        corpo(esquemaContabilizacao, b),
        this.trilha(s, 'operadora.provisao-tecnica.contabilizada', 'provisao_tecnica_competencia'),
      ),
    );
  }

  @Post('operadora/provisoes-tecnicas/:id/cancelamento')
  @HttpCode(200)
  @Permissao(CALCULAR)
  @AuditadoNoHandler(AUD)
  cancelar(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.cancelar(
        s.porta,
        idDaRota(i),
        corpo(esquemaCancelamento, b),
        this.trilha(s, 'operadora.provisao-tecnica.cancelada', 'provisao_tecnica_competencia'),
      ),
    );
  }
}
