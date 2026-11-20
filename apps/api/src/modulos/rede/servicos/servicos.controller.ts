// Serviços compartilhados da Rede (M57, etapa 3; ficha, seção 7; regra 11) — dentro de `Relatórios e BI > BI
// consolidado da Rede` (`/relatorios/bi/rede/servicos`):
//   GET  /api/rede/servicos?area&situacao&pagina&porPagina     a lista da Rede (cada banco lido em separado)
//   POST /api/rede/servicos                                     registrar (no banco do estabelecimento da sessão)
//   POST /api/rede/servicos/:estabelecimento/:id                alterar (no banco em que o registro mora)
// Ler: `relatorio.biRede.acessar`; gravar: `rede.servico.registrar` (perfil da diretoria da Rede). A chave `rede.bi`
// no estabelecimento da sessão; nos outros, conferida estabelecimento a estabelecimento. Toda gravação vai com a
// SGH_TRILHA na mesma transação, no banco do registro (com a porta em memória, o registrador da API registra).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  CHAVE_LIBERACAO_BI_REDE,
  esquemaAlterarServicoCompartilhado,
  esquemaConsultaServicosRede,
  esquemaNovoServicoCompartilhado,
  EVENTOS_AUDITAVEIS,
  type ListaServicosRede,
  PERMISSOES_REDE_BI_CODIGOS as P,
  type ServicoCompartilhado,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { LiberacaoPep } from '../../pep/liberacao-pep.js';
import { PORTA_REDE, type PortaRede } from '../porta.js';
import { PORTA_SERVICOS_REDE, type PortaServicosRede } from './porta.js';
import { ServicoServicosRede, type SessaoServicosRede } from './servico.js';

const CODIGO_EST = /^[a-z][a-z0-9]{1,9}$/;

function invalido(erro: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    erro.issues[0]?.message ?? 'Confira os campos.',
    { campos: [...new Set(erro.issues.map((i) => i.path.map(String).join('.')))] },
  );
}

@Controller('rede/servicos')
export class ServicosRedeController {
  readonly servico: ServicoServicosRede;
  private readonly liberacao: LiberacaoPep;
  private readonly rede: PortaRede;

  constructor(
    @Inject(PORTA_SERVICOS_REDE) private readonly porta: PortaServicosRede,
    @Inject(PORTA_REDE) rede: PortaRede,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoServicosRede(porta, rede);
    this.rede = rede;
    this.liberacao = new LiberacaoPep(configuracao, cache);
  }

  private async entrar(req: RequisicaoAutorizada): Promise<{ s: SessaoCadastro; r: SessaoServicosRede }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_BI_REDE);
    const liberados = new Set<string>([s.hospital]);
    for (const e of this.rede.estabelecimentos())
      if (
        e.codigo !== s.hospital &&
        (await this.liberacao.ligadaNoEstabelecimento(s.rede, e.codigo, CHAVE_LIBERACAO_BI_REDE))
      )
        liberados.add(e.codigo);
    return {
      s,
      r: {
        rede: s.rede,
        hospital: s.hospital,
        login: s.login,
        como: s.req.sghComo !== undefined,
        liberados,
        trilha: (evento, operacao, id) =>
          linhaTrilha(s, evento, 'rede.servico', operacao, {
            tabela: 'SGH_REDE_SERVICO_COMPART',
            id: id === null ? null : String(id),
          }),
      },
    };
  }

  /** Com a porta em memória, a trilha da gravação é a do registrador da API (no núcleo, vai na transação). */
  private async trilhaMemoria(s: SessaoCadastro, evento: string, est: string, id: number): Promise<void> {
    if (this.porta.destino !== 'memoria') return;
    await this.trilha.registrar({
      evento,
      rede: s.rede,
      hospital: est,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, `rede-servico-${id}`).slice(0, 64),
      recurso: 'rede.servico',
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: String(id),
    });
  }

  @Get()
  @Permissao(P.biRedeAcessar)
  @Auditar(EVENTOS_AUDITAVEIS.redeServicosLidos.codigo)
  async listar(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaServicosRede> {
    const { r } = await this.entrar(req);
    const c = esquemaConsultaServicosRede.safeParse(q);
    if (!c.success) throw invalido(c.error);
    return this.servico.listar(r, c.data);
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.servicoRegistrar)
  @AuditadoNoHandler('SGH_TRILHA na transação SGH_ do registro, no banco do estabelecimento da sessão')
  async registrar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ServicoCompartilhado> {
    const { s, r } = await this.entrar(req);
    const d = esquemaNovoServicoCompartilhado.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const x = await this.servico.registrar(r, d.data);
    await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.redeServicoRegistrado.codigo, x.estabelecimento, x.id);
    return x;
  }

  @Post(':estabelecimento/:id')
  @HttpCode(200)
  @Permissao(P.servicoRegistrar)
  @AuditadoNoHandler('SGH_TRILHA na transação SGH_ da alteração, no banco em que o registro mora')
  async alterar(
    @Param('estabelecimento') estabelecimento: string,
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ registro: ServicoCompartilhado; mudou: boolean }> {
    const { s, r } = await this.entrar(req);
    if (!CODIGO_EST.test(estabelecimento))
      throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    const n = idDaRota(id);
    const d = esquemaAlterarServicoCompartilhado.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const x = await this.servico.alterar(r, estabelecimento, n, d.data);
    if (x.mudou)
      await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.redeServicoAlterado.codigo, estabelecimento, n);
    return x;
  }
}
