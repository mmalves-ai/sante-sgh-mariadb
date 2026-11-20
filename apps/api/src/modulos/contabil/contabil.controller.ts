// Rotas da contabilidade, etapa 1 (M54-F1; ficha, seções 2, 4, 7 e 12):
//   GET  /api/contabil/apoio                  domínios, empresas, máscara e a situação da chave `contabil` (vale também
//                                             desligada: a tela mostra a descrição e o pré-requisito; POL-3)
//   GET  /api/contabil/fatos/apoio            o mesmo apoio para a tela dos fatos (contabil.fato.ler, sem a do plano)
//   GET  /api/contabil/plano?empresa=         o plano na ordem da árvore e os problemas do plano
//   POST /api/contabil/plano/contas           contabil.incluirConta (SGH_CTB_PLANO_CONTA)
//   POST /api/contabil/plano/contas/alterar   contabil.alterarConta (versão vista; a trilha leva os campos mudados)
//   GET  /api/contabil/regras?empresa=&origem=&tipoFato=   as versões (publicada e substituídas)
//   POST /api/contabil/regras/simular         a regra (rascunho) aplicada aos fatos de uma competência, sem gravar
//                                             (devolve os fatos um a um: exige contabil.fato.ler e contabil.plano.ler)
//   POST /api/contabil/regras/publicar        contabil.publicarRegra (crítica: senha de novo; SGH_CTB_REGRA só INSERT)
//   GET  /api/contabil/fatos                  os fatos lidos dos módulos, paginados (≤ 200)
//   GET  /api/contabil/fatos/resumo           por fonte: marca, última leitura e as contagens por situação
//   POST /api/contabil/periodos/reprocessar   a conferência do reprocessamento (regra 2); sem `somenteConferir`,
//                                             grava a situação recalculada dos fatos (crítica: senha de novo)
// Tudo exige a chave `contabil`, menos os dois apoios. Cada gravação vai com a SGH_TRILHA na mesma transação; nenhuma tabela do
// banco anterior é escrita (regra 1).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioContabil,
  CADASTROS_CONTABIL,
  CHAVE_CONTABIL,
  esquemaAlterarConta,
  esquemaCompetenciaSimulacao,
  esquemaEmpresaContabil,
  esquemaFiltroFatos,
  esquemaFiltroRegras,
  esquemaIncluirConta,
  esquemaPublicarRegra,
  esquemaRegraContabil,
  esquemaReprocessarPeriodo,
  esquemaSenhaReautenticacao,
  EVENTOS_AUDITAVEIS,
  type FatosContabeis,
  type PlanoContabil,
  recursoDesligado,
  type RegrasContabeis,
  type ResultadoContaPlano,
  type ResultadoPublicacaoRegra,
  type ResultadoReprocessamento,
  type ResumoFatosContabeis,
  ROTAS_CONTABIL_F1 as R,
  type SimulacaoRegra,
} from '@sgh/contratos';
import type { LinhaTrilha } from '@sgh/legado';
import { z } from 'zod';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  chaveDeRecursoNaSessao,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { type GravadorContabil, PORTA_CONTABIL, type PortaContabil } from './porta.js';
import { ServicoContabil } from './servico.js';

const E = EVENTOS_AUDITAVEIS;

function filtro<T>(esquema: z.ZodType<T>, q: unknown): T {
  const r = esquema.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data;
}

/** O motivo da chave desligada: a descrição do recurso e o pré-requisito (POL-3; ficha, seção 12). */
export function motivoContabilDesligada(): string {
  const r = recursoDesligado(CHAVE_CONTABIL);
  const pre = (r?.prerequisitos ?? []).map((p) => p.descricao).join(' ');
  return `A contabilidade está desligada neste estabelecimento.${pre ? ` Pré-requisito: ${pre}` : ''} O administrador liga em Funcionalidades por estabelecimento.`;
}

const esquemaSimular = z.object({
  regra: esquemaRegraContabil,
  competencia: esquemaCompetenciaSimulacao,
});
const esquemaPublicarComSenha = esquemaPublicarRegra.extend(esquemaSenhaReautenticacao.shape);
const esquemaReprocessarComSenha = esquemaReprocessarPeriodo.extend(esquemaSenhaReautenticacao.shape);
const esquemaFiltroFatosConsulta = z.object({
  empresa: z.coerce.number().int().positive().optional(),
  competencia: z.string().optional(),
  origem: z.coerce.number().int().optional(),
  tipoFato: z.string().optional(),
  situacao: z.string().optional(),
  pagina: z.coerce.number().int().optional(),
  tamanho: z.coerce.number().int().optional(),
});

@Controller()
export class ContabilController {
  readonly servico: ServicoContabil;

  constructor(
    @Inject(PORTA_CONTABIL) private readonly porta: PortaContabil,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoContabil(porta);
  }

  private async ligada(req: RequisicaoAutorizada): Promise<boolean> {
    return (await chaveDeRecursoNaSessao(this.fonte, this.cache, req, CHAVE_CONTABIL)).ligada;
  }

  /** A chave vale ou 403 `recurso-desligado` com o motivo (nada é lido nem gravado). */
  private async exigirChave(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    if (!(await this.ligada(req)))
      throw new ErroProblema('recurso-desligado', 403, 'Contabilidade desligada', motivoContabilDesligada(), {
        codigo: 'recurso-desligado',
      });
    return s;
  }

  /** A senha de novo (permissão crítica); a sessão sintética da memória dispensa (sem login real). */
  private async reautenticar(req: RequisicaoAutorizada, senha: string | undefined): Promise<void> {
    if (this.porta.destino === 'memoria' && !req.sgh?.real) return;
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  /** Gravação SGH_ com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<T>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    alvo: (r: T) => { tabela: string; id?: string | null; chave?: string | null; diferenca?: string | null },
    fn: (g: GravadorContabil) => Promise<T>,
  ): Promise<T> {
    const linha = (r: T): LinhaTrilha => {
      const a = alvo(r);
      return {
        ...linhaTrilha(s, evento, 'contabil', operacao, a),
        ...(a.diferenca ? { diferenca: a.diferenca.slice(0, 400) } : {}),
      };
    };
    const r = await this.porta.gravarSgh(s.porta, linha, fn).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (this.porta.destino === 'memoria') {
      const a = alvo(r);
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso: 'contabil',
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: a.id ?? a.chave ?? '',
      });
    }
    return r;
  }

  @Get(R.apoio.caminho)
  @Permissao(R.apoio.permissao)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioContabil> {
    return this.montarApoio(req);
  }

  /** O mesmo apoio para a tela dos fatos, com a permissão de acompanhar os fatos (sem a do plano). */
  @Get(R.apoioFatos.caminho)
  @Permissao(R.apoioFatos.permissao)
  async apoioFatos(@Req() req: RequisicaoAutorizada): Promise<ApoioContabil> {
    return this.montarApoio(req);
  }

  private async montarApoio(req: RequisicaoAutorizada): Promise<ApoioContabil> {
    const s = sessaoDe(req);
    const ligada = await this.ligada(req);
    return this.servico.apoio(s.porta, {
      ligada,
      motivo: ligada ? null : motivoContabilDesligada(),
      podeEditar: s.pode(R.incluirConta.permissao),
      podePublicar: s.pode(R.publicar.permissao),
      podeVerFatos: s.pode(R.fatos.permissao),
      // Os cadastros genéricos valem com a chave desligada: são do sistema todo (receita genérica do M08).
      cadastros: CADASTROS_CONTABIL.filter((c) => s.pode(`${c}.ler`)),
    });
  }

  @Get(R.plano.caminho)
  @Permissao(R.plano.permissao)
  async plano(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PlanoContabil> {
    const { empresa } = filtro(esquemaEmpresaContabil, q);
    const s = await this.exigirChave(req);
    return this.servico.plano(s.porta, empresa);
  }

  @Post(R.incluirConta.caminho)
  @HttpCode(200)
  @Permissao(R.incluirConta.permissao)
  @AuditadoNoHandler('contabil.incluirConta (SGH_CTB_PLANO_CONTA) com a SGH_TRILHA na mesma transação')
  async incluirConta(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoContaPlano> {
    const conta = corpo(esquemaIncluirConta, b);
    const s = await this.exigirChave(req);
    await this.servico.conferirInclusao(s.porta, conta);
    const r = await this.gravar(
      s,
      E.contabilContaIncluida.codigo,
      'contabil.incluirConta',
      () => ({ tabela: 'SGH_CTB_PLANO_CONTA', chave: `${conta.empresa}:${conta.codigo}` }),
      (g) => g.incluirConta({ conta, usuario: s.login }),
    );
    const plano = await this.servico.plano(s.porta, conta.empresa);
    return {
      ok: true,
      codigo: conta.codigo,
      versao: r.versao,
      mensagem: 'Conta incluída no plano.',
      problemas: plano.problemas.length,
    };
  }

  @Post(R.alterarConta.caminho)
  @HttpCode(200)
  @Permissao(R.alterarConta.permissao)
  @AuditadoNoHandler(
    'contabil.alterarConta (SGH_CTB_PLANO_CONTA, versão vista; os campos mudados na trilha) com a SGH_TRILHA na mesma transação',
  )
  async alterarConta(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoContaPlano> {
    const e = corpo(esquemaAlterarConta, b);
    const s = await this.exigirChave(req);
    const { depois, campos } = await this.servico.montarAlteracao(s.porta, e);
    const r = await this.gravar(
      s,
      E.contabilContaAlterada.codigo,
      'contabil.alterarConta',
      () => ({
        tabela: 'SGH_CTB_PLANO_CONTA',
        chave: `${e.empresa}:${e.codigo}`,
        diferenca: `campos=${campos.join(',')};versao=${e.versao}`,
      }),
      (g) =>
        g.alterarConta({ empresa: e.empresa, codigo: e.codigo, versao: e.versao, depois, usuario: s.login }),
    );
    const plano = await this.servico.plano(s.porta, e.empresa);
    return {
      ok: true,
      codigo: e.codigo,
      versao: r.versao,
      mensagem: 'Conta alterada.',
      problemas: plano.problemas.length,
    };
  }

  @Get(R.regras.caminho)
  @Permissao(R.regras.permissao)
  async regras(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegrasContabeis> {
    const f = filtro(esquemaFiltroRegras, q);
    const s = await this.exigirChave(req);
    return this.servico.regras(s.porta, f.empresa, {
      ...(f.origem !== undefined ? { origem: f.origem } : {}),
      ...(f.tipoFato !== undefined ? { tipoFato: f.tipoFato } : {}),
    });
  }

  @Post(R.simular.caminho)
  @HttpCode(200)
  @Permissao(R.simular.permissao)
  @AuditadoNoHandler(
    'a simulação não grava: lê os fatos da competência e aplica a regra em memória (nenhuma escrita, nem em SGH_)',
  )
  async simular(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<SimulacaoRegra> {
    const e = corpo(esquemaSimular, b);
    const s = await this.exigirChave(req);
    if (!s.pode(R.regras.permissao))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Seu perfil não consulta as regras de contabilização.',
      );
    return this.servico.simular(s.porta, e.regra, e.competencia);
  }

  @Post(R.publicar.caminho)
  @HttpCode(200)
  @Permissao(R.publicar.permissao)
  @AuditadoNoHandler(
    'contabil.publicarRegra (SGH_CTB_REGRA, só inclusão; a versão anterior fica) com a SGH_TRILHA na mesma transação',
  )
  async publicar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPublicacaoRegra> {
    const e = corpo(esquemaPublicarComSenha, b);
    const s = await this.exigirChave(req);
    await this.reautenticar(req, e.senha);
    const { conteudo, impressao } = await this.servico.prepararPublicacao(s.porta, e.regra);
    const r = await this.gravar(
      s,
      E.contabilRegraPublicada.codigo,
      'contabil.publicarRegra',
      (x: { id: number; versao: number }) => ({
        tabela: 'SGH_CTB_REGRA',
        id: String(x.id),
        diferenca: `origem=${e.regra.origem};tipo=${e.regra.tipoFato};versao=${e.regra.versao}`,
      }),
      (g) =>
        g.publicarRegra({
          regra: e.regra,
          conteudo,
          impressao,
          justificativa: e.justificativa,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      impressao,
      mensagem: `Versão ${r.versao} publicada. Ela vale para os fatos a partir de ${e.regra.vigenciaInicio.split('-').reverse().join('/')}; as versões anteriores continuam valendo para os fatos de antes.`,
    };
  }

  @Get(R.fatos.caminho)
  @Permissao(R.fatos.permissao)
  async fatos(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FatosContabeis> {
    const bruto = filtro(esquemaFiltroFatosConsulta, q);
    const f = filtro(esquemaFiltroFatos, bruto);
    const s = await this.exigirChave(req);
    return this.servico.fatos(
      s.porta,
      {
        ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
        ...(f.competencia !== undefined ? { competencia: f.competencia } : {}),
        ...(f.origem !== undefined ? { origem: f.origem } : {}),
        ...(f.tipoFato !== undefined ? { tipoFato: f.tipoFato } : {}),
        ...(f.situacao !== undefined ? { situacao: f.situacao } : {}),
      },
      f.pagina,
      f.tamanho,
    );
  }

  @Get(R.resumoFatos.caminho)
  @Permissao(R.resumoFatos.permissao)
  async resumoFatos(@Req() req: RequisicaoAutorizada): Promise<ResumoFatosContabeis> {
    const s = await this.exigirChave(req);
    return this.servico.resumoFatos(s.porta);
  }

  @Post(R.reprocessar.caminho)
  @HttpCode(200)
  @Permissao(R.reprocessar.permissao)
  @AuditadoNoHandler(
    'contabil.reprocessarPeriodo (conferência sem gravar; ou a situação dos fatos em SGH_CTB_FATO) com a SGH_TRILHA na mesma transação',
  )
  async reprocessar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoReprocessamento> {
    const e = corpo(esquemaReprocessarComSenha, b);
    const s = await this.exigirChave(req);
    if (!e.somenteConferir) await this.reautenticar(req, e.senha);
    const { resultado, mudancas } = await this.servico.reprocessar(
      s.porta,
      e.empresa,
      e.competencia,
      e.somenteConferir,
    );
    const gravar = !e.somenteConferir && resultado.identico && !resultado.parcial;
    let mudaram = 0;
    const diferenca = `conferir=${e.somenteConferir ? 'S' : 'N'};fatos=${resultado.fatos};iguais=${resultado.iguais};diferentes=${resultado.diferentes};situacoes=${gravar ? mudancas.length : 0}`;
    if (gravar)
      await this.gravar(
        s,
        E.contabilPeriodoReprocessado.codigo,
        'contabil.reprocessarPeriodo',
        () => ({ tabela: 'SGH_CTB_FATO', chave: `${e.empresa}:${e.competencia}`, diferenca }),
        async (g) => {
          // D-CORRIDA-542: cada mudança grava só se a situação ainda for a lida (o worker ou o Contabilizar pode ter
          // contabilizado o fato depois da leitura); a que não grava conta em `mudaramDurante`.
          for (const m of mudancas) if (!(await g.marcarSituacao(m))) mudaram++;
          return resultado;
        },
      );
    else
      // Só conferência (ou nada a gravar): a trilha pelo registrador da API, sem transação SGH_ (vale na cópia só leitura).
      await this.trilha.registrar({
        evento: E.contabilPeriodoReprocessado.codigo,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, 'contabil.reprocessarPeriodo').slice(0, 64),
        recurso: 'contabil',
        resultado: 'sucesso',
        tabelaAlvo: 'SGH_CTB_FATO',
        idAlvo: `${e.empresa}:${e.competencia}`,
      });
    if (!e.somenteConferir && resultado.parcial)
      return {
        ...resultado,
        mensagem:
          'A competência tem fatos demais para reprocessar de uma vez: nada foi gravado. Avise o suporte.',
      };
    if (mudaram > 0)
      return {
        ...resultado,
        situacoesAlteradas: resultado.situacoesAlteradas - mudaram,
        mudaramDurante: mudaram,
        mensagem: `${resultado.mensagem} ${mudaram} fato(s) mudaram durante o reprocessamento e ficaram como estavam: confira de novo.`,
      };
    return resultado;
  }
}
