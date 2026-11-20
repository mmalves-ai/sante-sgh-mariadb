// Retrocompatibilidade e plano de evolução do modelo por hospital (M59, etapa 6; ficha, regra 11; ADR 0033): o painel
// só de leitura, com `config.coexistencia.ler` (o mesmo do painel de concessões e da prontidão do desligamento). A
// decisão e cada passo do plano são registrados no registro versionado ou, com coexistencia.registro.modo = 'tela'
// (W0-09, D-RETRO-REGISTRO-F6), pela tela, com a senha de novo e a trilha (versão nova em SGH_CFG_COEX_REGISTRO):
//   GET  /api/administracao/coexistencia/registros/:tipo   o registro gravado (modo, fonte que vale, histórico)
//   POST /api/administracao/coexistencia/registros/:tipo   versão nova ({conteudo|null, motivo, senha}; reautenticação)
// :tipo = fim (M43) | retrocompatibilidade (M59-F6).
import { resolve } from 'node:path';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  PERMISSOES_M58_CODIGOS,
  type PainelRetrocompatibilidade,
  type RegistroCoexGravado,
} from '@sgh/contratos';
import { fonteCatalogoArquivo } from '@sgh/legado';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { contingenciaPelaConfiguracao } from '../acesso/identidade/contingencia.js';
import { sessaoDe } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { modoRegistroPelaConfiguracao, ServicoRegistroCoex } from './aplicacao/registro.js';
import { ServicoRetrocompatibilidade } from './aplicacao/retrocompatibilidade.js';
import {
  RAIZES_DESLIGAMENTO,
  type RaizesDesligamento,
  raizesDesligamentoDoAmbiente,
} from './desligamento.controller.js';
import { RAIZ_FIM_COEXISTENCIA, raizFimDoAmbiente } from './fim.controller.js';
import { PORTA_COEXISTENCIA, type PortaCoexistencia } from './porta.js';

/** O catálogo de operações (CATALOGO_OPERACOES; padrão docs/operacoes/catalogo), o mesmo do executor. */
const caminhoCatalogoOperacoes = (env: NodeJS.ProcessEnv): string =>
  resolve(process.cwd(), env['CATALOGO_OPERACOES'] ?? 'docs/operacoes/catalogo');

export const ROTA_RETROCOMPATIBILIDADE = 'administracao/coexistencia/retrocompatibilidade';
export const ROTA_REGISTROS_COEX = 'administracao/coexistencia/registros';

const senhaDe = (b: unknown) =>
  typeof (b as { senha?: unknown })?.senha === 'string' ? (b as { senha: string }).senha : undefined;

/** A pasta do registro da retrocompatibilidade (SGH_COEX_RETROCOMPAT; padrão docs/coexistencia/retrocompatibilidade). */
export const RAIZ_RETROCOMPATIBILIDADE = Symbol('RAIZ_RETROCOMPATIBILIDADE');
export const raizRetrocompatibilidadeDoAmbiente = (env: NodeJS.ProcessEnv): string =>
  resolve(process.cwd(), env['SGH_COEX_RETROCOMPAT'] ?? 'docs/coexistencia/retrocompatibilidade');

@Controller()
export class RetrocompatibilidadeController {
  readonly servico: ServicoRetrocompatibilidade;
  readonly registros: ServicoRegistroCoex;

  constructor(
    @Inject(PORTA_COEXISTENCIA) porta: PortaCoexistencia,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(RAIZ_FIM_COEXISTENCIA) raizFim: string | null = null,
    @Optional() @Inject(RAIZES_DESLIGAMENTO) raizes: RaizesDesligamento | null = null,
    @Optional() @Inject(RAIZ_RETROCOMPATIBILIDADE) raiz: string | null = null,
  ) {
    const catalogo = fonteCatalogoArquivo(caminhoCatalogoOperacoes(process.env));
    this.registros = new ServicoRegistroCoex(
      porta,
      modoRegistroPelaConfiguracao(() => configuracao),
    );
    this.servico = new ServicoRetrocompatibilidade({
      porta,
      raizRetrocompatibilidade: raiz ?? raizRetrocompatibilidadeDoAmbiente(process.env),
      raizFim: raizFim ?? raizFimDoAmbiente(process.env),
      raizDesligamento: (raizes ?? raizesDesligamentoDoAmbiente(process.env)).desligamento,
      contingenciaLigada: contingenciaPelaConfiguracao(() => configuracao),
      estadoOperacao: (operacao, hospital) => catalogo.estado(operacao, hospital),
      registroGravado: this.registros.vigente,
    });
  }

  @Get(ROTA_RETROCOMPATIBILIDADE)
  @Permissao(PERMISSOES_M58_CODIGOS.painelLer)
  painel(@Req() req: RequisicaoAutorizada): Promise<PainelRetrocompatibilidade> {
    return this.servico.painel(sessaoDe(req));
  }

  /** O registro gravado pela tela (W0-09): o mesmo leitor do painel (config.coexistencia.ler). */
  @Get(`${ROTA_REGISTROS_COEX}/:tipo`)
  @Permissao(PERMISSOES_M58_CODIGOS.painelLer)
  registro(@Param('tipo') tipo: string, @Req() req: RequisicaoAutorizada): Promise<RegistroCoexGravado> {
    return this.registros.ler(sessaoDe(req), tipo);
  }

  /** Grava a versão nova do registro (operação crítica: config.desligamento.registrar, com a senha de novo). */
  @Post(`${ROTA_REGISTROS_COEX}/:tipo`)
  @HttpCode(200)
  @Permissao(PERMISSOES_M58_CODIGOS.checklistRegistrar)
  @AuditadoNoHandler('SGH_CFG_COEX_REGISTRO e SGH_TRILHA na mesma transação SGH_ (reautenticação)')
  async gravarRegistro(
    @Param('tipo') tipo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroCoexGravado> {
    await reautenticar(this.sessoes, this.resolvedor, req, senhaDe(b));
    return this.registros.gravar(sessaoDe(req), tipo, b);
  }
}
