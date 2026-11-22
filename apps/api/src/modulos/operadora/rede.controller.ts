// Rotas da rede credenciada da operadora própria (M56, etapa 4, F3; ficha, seções 4, 6 e 7):
//   GET  /api/operadora/rede/apoio                       domínios, convênios do hospital, estabelecimentos da Rede e a
//                                                        situação da fatia (vale também desligada: a tela diz o motivo)
//   GET  /api/operadora/prestadores                      a rede, paginada pela chave (busca, situação, tipo, apos), com
//                                                        as contagens; CPF mascarado
//   GET  /api/operadora/prestadores/:id                  a ficha do prestador com os movimentos do RPS (leitura na trilha)
//   POST /api/operadora/prestadores                      operadora.credenciarPrestador
//   POST /api/operadora/prestadores/:id/alterar          operadora.alterarPrestador
//   POST /api/operadora/prestadores/:id/descredenciar    operadora.descredenciarPrestador
//   POST /api/operadora/prestadores/:id/reincluir        operadora.reincluirPrestador
//   GET  /api/operadora/rede/movimentos                  os movimentos do RPS (situação, apos)
// Tudo exige a chave da fatia `operadora.rede`, que só vale com a do módulo (regra 1), menos o apoio. Cada gravação muda
// o prestador da rede (prestador_rede, contrato e histórico) e registra o movimento do registro da ANS com a trilha na
// mesma transação, pelo Executor do núcleo (porta própria).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioRede,
  CHAVE_OPERADORA_REDE,
  esquemaAlterarPrestador,
  esquemaCredenciarPrestador,
  esquemaDescredenciarPrestador,
  esquemaFiltroMovimentosRps,
  esquemaFiltroPrestadores,
  esquemaReincluirPrestador,
  EVENTOS_AUDITAVEIS,
  type MovimentosRps,
  type PrestadorDetalhe,
  type Prestadores,
  ROTAS_OPERADORA_F3 as R,
  type ResultadoRede,
} from '@sgh/contratos';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ServicoSituacaoOperadora, type SujeitoOperadora } from './aplicacao/situacao.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  type GravacaoRede,
  type GravadorRede,
  PORTA_REDE_OPERADORA,
  type PortaRedeOperadora,
} from './rede-porta.js';
import { type EstabelecimentoDaRede, resumoDe, ServicoRedeOperadora } from './rede-servico.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.prestador';
const TABELA = 'prestador_rede';

/** Cursor da lista: o nome de busca e o ID da última linha (base64url, opaco para a tela). */
export function cursorPrestador(c: { nome: string; id: number }): string {
  return Buffer.from(`${c.nome}\u0000${c.id}`, 'utf8').toString('base64url');
}
export function lerCursorPrestador(s: string): { nome: string; id: number } | null {
  const t = Buffer.from(s, 'base64url').toString('utf8');
  const i = t.lastIndexOf('\u0000');
  const id = Number(t.slice(i + 1));
  if (i < 1 || !Number.isInteger(id) || id < 1) return null;
  return { nome: t.slice(0, i), id };
}

function filtro<T extends { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } }>(
  esquema: T,
  q: unknown,
) {
  const r = esquema.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data as T extends { safeParse(v: unknown): { data?: infer D } } ? Exclude<D, undefined> : never;
}

@Controller()
export class RedeOperadoraController {
  readonly situacoes: ServicoSituacaoOperadora;
  readonly servico: ServicoRedeOperadora;

  constructor(
    @Inject(PORTA_REDE_OPERADORA) private readonly porta: PortaRedeOperadora,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.situacoes = new ServicoSituacaoOperadora(fonte, cache);
    this.servico = new ServicoRedeOperadora(porta);
  }

  private sujeito(req: RequisicaoAutorizada, s: SessaoCadastro): SujeitoOperadora {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      setor: req.sgh?.sessao.unidadeAtiva ?? null,
    };
  }

  private estabelecimentos(req: RequisicaoAutorizada): EstabelecimentoDaRede[] {
    return (req.sgh?.sessao.estabelecimentos ?? []).map((e) => ({ codigo: e.codigo, nome: e.nome }));
  }

  /** A fatia vale (módulo e rede ligados) ou 403 `recurso-desligado` com o motivo (nada é lido nem gravado). */
  private async exigirFatia(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    await this.situacoes.exigir(this.sujeito(req, s), CHAVE_OPERADORA_REDE);
    return s;
  }

  /** Gravação com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<T extends GravacaoRede>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    fn: (g: GravadorRede) => Promise<T>,
  ): Promise<T> {
    const linha = (r: T): RegistroTrilhaTela =>
      linhaTrilha(s, evento, RECURSO, operacao, { tabela: TABELA, id: String(r.id) });
    const r = await this.porta.gravar(s.porta, linha, fn).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (this.porta.destino === 'memoria')
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso: RECURSO,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: String(r.id),
      });
    return r;
  }

  @Get(R.apoio.caminho)
  @Permissao(R.apoio.permissao)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioRede> {
    const s = sessaoDe(req);
    const situacao = await this.situacoes.situacao(this.sujeito(req, s));
    const fatia = situacao.fatias.find((f) => f.chave === CHAVE_OPERADORA_REDE);
    const ligada = fatia?.situacao === 'ligada';
    return this.servico.apoio(s.porta, {
      ligada,
      motivo: ligada ? null : (fatia?.motivo ?? situacao.modulo.motivo),
      podeEditar: s.pode(R.credenciar.permissao),
      estabelecimentos: this.estabelecimentos(req),
    });
  }

  @Get(R.prestadores.caminho)
  @Permissao(R.prestadores.permissao)
  async prestadores(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Prestadores> {
    const f = filtro(esquemaFiltroPrestadores, q);
    const apos = f.apos ? lerCursorPrestador(f.apos) : null;
    if (f.apos && !apos)
      throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
    const s = await this.exigirFatia(req);
    const [r, totais] = await Promise.all([
      this.porta.prestadores(s.porta, {
        ...(f.busca !== undefined ? { busca: f.busca } : {}),
        ...(f.situacao !== undefined ? { situacao: f.situacao } : {}),
        ...(f.tipo !== undefined ? { tipo: f.tipo } : {}),
        ...(apos ? { apos } : {}),
      }),
      this.porta.totais(s.porta),
    ]);
    return { itens: r.itens.map(resumoDe), proxima: r.proxima ? cursorPrestador(r.proxima) : null, totais };
  }

  @Get(R.prestador.caminho)
  @Permissao(R.prestador.permissao)
  @Auditar(E.operadoraPrestadorLido.codigo)
  async prestador(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<PrestadorDetalhe> {
    const n = idDaRota(id);
    const s = await this.exigirFatia(req);
    return this.servico.detalhe(s.porta, n);
  }

  @Get(R.movimentos.caminho)
  @Permissao(R.movimentos.permissao)
  async movimentos(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<MovimentosRps> {
    const f = filtro(esquemaFiltroMovimentosRps, q);
    const s = await this.exigirFatia(req);
    return this.porta.movimentos(s.porta, {
      ...(f.situacao !== undefined ? { situacao: f.situacao } : {}),
      ...(f.apos !== undefined ? { apos: f.apos } : {}),
    });
  }

  @Post(R.credenciar.caminho)
  @HttpCode(200)
  @Permissao(R.credenciar.permissao)
  @AuditadoNoHandler(
    'operadora.credenciarPrestador (prestador, contrato e o movimento do registro da ANS) com a trilha na mesma transação',
  )
  async credenciar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRede> {
    const e = corpo(esquemaCredenciarPrestador, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirCredenciamento(s.porta, e, this.estabelecimentos(req));
    const r = await this.gravar(
      s,
      E.operadoraPrestadorCredenciado.codigo,
      'operadora.credenciarPrestador',
      (g) => g.credenciar({ ...x, usuario: s.login }),
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      movimento: 1,
      mensagem:
        'Prestador credenciado. A inclusão vai ao registro de prestadores da ANS com os próximos envios.',
      avisos: [],
    };
  }

  @Post(R.alterar.caminho)
  @HttpCode(200)
  @Permissao(R.alterar.permissao)
  @AuditadoNoHandler(
    'operadora.alterarPrestador (prestador, contrato e, se muda campo do registro da ANS, o movimento) com a trilha na mesma transação',
  )
  async alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRede> {
    const n = idDaRota(id);
    const e = corpo(esquemaAlterarPrestador, b);
    const s = await this.exigirFatia(req);
    const { camposRps } = await this.servico.conferirAlteracao(s.porta, n, e, this.estabelecimentos(req));
    const { versao, ...campos } = e;
    const r = await this.gravar(s, E.operadoraPrestadorAlterado.codigo, 'operadora.alterarPrestador', (g) =>
      g.alterar({ ...campos, id: n, versao, camposRps, usuario: s.login }),
    );
    return {
      ok: true,
      id: n,
      versao: r.versao,
      movimento: r.movimento === null ? null : 2,
      mensagem:
        r.movimento === null
          ? 'Prestador alterado. Nada muda no registro de prestadores da ANS.'
          : 'Prestador alterado. A alteração vai ao registro de prestadores da ANS com os próximos envios.',
      avisos: [],
    };
  }

  @Post(R.descredenciar.caminho)
  @HttpCode(200)
  @Permissao(R.descredenciar.permissao)
  @AuditadoNoHandler(
    'operadora.descredenciarPrestador (prestador, histórico e o movimento de exclusão) com a trilha na mesma transação',
  )
  async descredenciar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRede> {
    const n = idDaRota(id);
    const e = corpo(esquemaDescredenciarPrestador, b);
    const s = await this.exigirFatia(req);
    const { avisos } = await this.servico.conferirDescredenciamento(s.porta, n, e);
    const r = await this.gravar(
      s,
      E.operadoraPrestadorDescredenciado.codigo,
      'operadora.descredenciarPrestador',
      (g) => g.descredenciar({ ...e, id: n, usuario: s.login }),
    );
    return {
      ok: true,
      id: n,
      versao: r.versao,
      movimento: 3,
      mensagem: `Prestador descredenciado a partir de ${e.efetivoEm.split('-').reverse().join('/')}; até essa data ele segue credenciado na rede. A exclusão vai ao registro de prestadores da ANS com os próximos envios.`,
      avisos,
    };
  }

  @Post(R.reincluir.caminho)
  @HttpCode(200)
  @Permissao(R.reincluir.permissao)
  @AuditadoNoHandler(
    'operadora.reincluirPrestador (prestador, contrato novo e o movimento de reinclusão) com a trilha na mesma transação',
  )
  async reincluir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRede> {
    const n = idDaRota(id);
    const e = corpo(esquemaReincluirPrestador, b);
    const s = await this.exigirFatia(req);
    await this.servico.conferirReinclusao(s.porta, n, e);
    const r = await this.gravar(
      s,
      E.operadoraPrestadorReincluido.codigo,
      'operadora.reincluirPrestador',
      (g) => g.reincluir({ ...e, id: n, usuario: s.login }),
    );
    return {
      ok: true,
      id: n,
      versao: r.versao,
      movimento: 4,
      mensagem:
        'Prestador reincluído na rede. A reinclusão vai ao registro de prestadores da ANS com os próximos envios.',
      avisos: [],
    };
  }
}
