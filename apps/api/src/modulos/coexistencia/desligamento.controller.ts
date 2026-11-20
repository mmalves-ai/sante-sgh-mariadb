// Prontidão do desligamento por hospital (M58, etapa 1; ficha, seção 7):
//   GET  /api/administracao/coexistencia/desligamento                 painel (sessões, inventário, contas, passos)
//   POST /api/administracao/coexistencia/desligamento/itens/:item     registrar um item da checklist (reautenticação)
//   POST /api/administracao/coexistencia/desligamento/itens/:item/pendente  voltar o item a pendente com motivo
//                                                                         (reautenticação; W0-09)
//   GET  /api/administracao/coexistencia/desligamento/plataforma      cartão "Plataforma do banco" (verificação de schema)
//   GET  /api/administracao/coexistencia/desligamento/ensaios/firebird5  o ensaio do Firebird 5 na cópia (M58-F2)
//   GET  /api/administracao/coexistencia/desligamento/ensaios/utf8       o ensaio da conversão para UTF-8 (M58-F3)
//   GET  /api/administracao/coexistencia/desligamento/janela             roteiro, verificação e retirada (M58-F5)
// Também registra no módulo config o critério de ligar `entrada.utf8` (M58-F5, regra 6), como a farmácia faz no M41.
// O painel é lido com config.coexistencia.ler e o cartão com config.schema.ler, como a ficha pede; o registro é a
// permissão crítica config.desligamento.registrar (D-PERM-58), com a senha de novo e a SGH_TRILHA na mesma transação.
import { resolve } from 'node:path';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  type CartaoPlataforma,
  type PainelDesligamento,
  type PainelJanela,
  type ResumoEnsaioFirebird5,
  type ResumoEnsaioUtf8,
  PERMISSOES_M58_CODIGOS as P,
  type ResultadoRegistroDesligamento,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CRITERIO_LIGAR_SETOR,
  type CriterioLigarSetor,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ServicoCicloCoex } from './aplicacao/ciclo.js';
import { ServicoDesligamento } from './aplicacao/desligamento.js';
import { modoRegistroPelaConfiguracao, ServicoRegistroCoex } from './aplicacao/registro.js';
import { RAIZ_FIM_COEXISTENCIA, raizFimDoAmbiente } from './fim.controller.js';
import { PORTA_COEXISTENCIA, type PortaCoexistencia } from './porta.js';

const BASE = 'administracao/coexistencia/desligamento';

/** As pastas do registro dos passos e da impressão homologada (SGH_COEX_DESLIGAMENTO e SCHEMA_HOMOLOGADO_DIR). */
export const RAIZES_DESLIGAMENTO = Symbol('RAIZES_DESLIGAMENTO');
export interface RaizesDesligamento {
  readonly desligamento: string;
  readonly homologado: string;
  /** docs/marcos/M58 (os relatórios dos ensaios por hospital: <h>/firebird5.json e <h>/utf8.json). */
  readonly ensaios?: string;
}
export const raizesDesligamentoDoAmbiente = (env: NodeJS.ProcessEnv): RaizesDesligamento => ({
  desligamento: resolve(process.cwd(), env['SGH_COEX_DESLIGAMENTO'] ?? 'docs/coexistencia/desligamento'),
  homologado: resolve(process.cwd(), env['SCHEMA_HOMOLOGADO_DIR'] ?? 'tools/schema-check/homologado'),
  ensaios: resolve(process.cwd(), env['SGH_M58_ENSAIOS'] ?? 'docs/marcos/M58'),
});

const senhaDe = (b: unknown) =>
  typeof (b as { senha?: unknown })?.senha === 'string' ? (b as { senha: string }).senha : undefined;

@Controller()
export class DesligamentoController {
  readonly servico: ServicoDesligamento;
  readonly ciclo: ServicoCicloCoex;

  constructor(
    @Inject(PORTA_COEXISTENCIA) porta: PortaCoexistencia,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(RAIZ_FIM_COEXISTENCIA) raizFim: string | null = null,
    @Optional() @Inject(RAIZES_DESLIGAMENTO) raizes: RaizesDesligamento | null = null,
    @Optional() @Inject(CRITERIO_LIGAR_SETOR) criterio: CriterioLigarSetor | null = null,
  ) {
    const r = raizes ?? raizesDesligamentoDoAmbiente(process.env);
    this.ciclo = new ServicoCicloCoex(porta);
    this.servico = new ServicoDesligamento({
      porta,
      raizFim: raizFim ?? raizFimDoAmbiente(process.env),
      raizDesligamento: r.desligamento,
      pastaHomologada: r.homologado,
      raizEnsaios: r.ensaios ?? raizesDesligamentoDoAmbiente(process.env).ensaios ?? null,
      configuracao,
      registroGravado: new ServicoRegistroCoex(
        porta,
        modoRegistroPelaConfiguracao(() => configuracao),
      ).vigente,
    });
    // M58-F5 (regra 6): a tela de funcionalidades confere por aqui antes de ligar a entrada sem restrição.
    if (criterio) criterio.regraEntradaUtf8 = (c) => this.servico.motivoLigarEntradaUtf8(c);
  }

  @Get(BASE)
  @Permissao(P.painelLer)
  painel(@Req() req: RequisicaoAutorizada): Promise<PainelDesligamento> {
    return this.servico.painel(sessaoDe(req));
  }

  @Get(`${BASE}/plataforma`)
  @Permissao(P.plataformaLer)
  plataforma(@Req() req: RequisicaoAutorizada): Promise<CartaoPlataforma> {
    return this.servico.cartaoPlataforma(sessaoDe(req));
  }

  /** O ensaio do Firebird 5 na cópia: o mesmo leitor do cartão da plataforma (config.schema.ler). */
  @Get(`${BASE}/ensaios/firebird5`)
  @Permissao(P.plataformaLer)
  ensaioFirebird5(@Req() req: RequisicaoAutorizada): Promise<ResumoEnsaioFirebird5> {
    return this.servico.ensaioFirebird5(sessaoDe(req));
  }

  /** O ensaio da conversão para UTF-8 na cópia em Firebird 5: o mesmo leitor do cartão (config.schema.ler). */
  @Get(`${BASE}/ensaios/utf8`)
  @Permissao(P.plataformaLer)
  ensaioUtf8(@Req() req: RequisicaoAutorizada): Promise<ResumoEnsaioUtf8> {
    return this.servico.ensaioUtf8(sessaoDe(req));
  }

  /** A janela em produção de cada passo (M58-F5): o mesmo leitor do painel (config.coexistencia.ler). */
  @Get(`${BASE}/janela`)
  @Permissao(P.painelLer)
  janela(@Req() req: RequisicaoAutorizada): Promise<PainelJanela> {
    return this.servico.janela(sessaoDe(req));
  }

  @Post(`${BASE}/itens/:item`)
  @HttpCode(200)
  @Permissao(P.checklistRegistrar)
  @AuditadoNoHandler('SGH_CFG_COEX_DESLIG e SGH_TRILHA na mesma transação SGH_ (reautenticação)')
  async registrar(
    @Param('item') item: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRegistroDesligamento> {
    await reautenticar(this.sessoes, this.resolvedor, req, senhaDe(b));
    return this.servico.registrar(sessaoDe(req), item, b);
  }

  @Post(`${BASE}/itens/:item/pendente`)
  @HttpCode(200)
  @Permissao(P.checklistRegistrar)
  @AuditadoNoHandler(
    'SGH_CFG_COEX_DESLIG, SGH_CRUD_EVENTO e SGH_TRILHA na mesma transação SGH_ (reautenticação)',
  )
  async voltarPendente(
    @Param('item') item: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ item: string; situacao: 'pendente' }> {
    await reautenticar(this.sessoes, this.resolvedor, req, senhaDe(b));
    return this.ciclo.voltarItemDesligamentoPendente(sessaoDe(req), item, b);
  }
}
