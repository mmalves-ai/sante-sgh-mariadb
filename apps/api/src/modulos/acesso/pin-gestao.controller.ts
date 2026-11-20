// W1-01 (parte 11b2): o PIN da troca rápida visto e retirado pelo gestor de acessos (ficha do usuário).
//   GET  /api/acesso/gestao/usuarios/:login/pin           situação (definido, bloqueado, desde quando), sem o hash
//   POST /api/acesso/gestao/usuarios/:login/pin/retirar   retira o PIN com motivo (reautenticação em diálogo)
// A gravação é a de SGH_ACESSO_PIN (1209) com a trilha (quem, motivo e o valor anterior) na mesma transação SGH_;
// nunca o PIN nem o hash na resposta, no log ou na trilha.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  EVENTOS_AUDITAVEIS,
  esquemaLogin,
  esquemaRetirarPinGestor,
  PERMISSOES_ACESSO,
  type SituacaoPinTela,
} from '@sgh/contratos';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import { ErroSessao, type ServicoSessao } from '../../sessao/servico-sessao.js';
import type { ServicoTrocaRapida } from '../../sessao/troca-rapida.js';
import { SERVICO_SESSAO, SERVICO_TROCA_RAPIDA } from './acesso.controller.js';

@Controller('acesso/gestao/usuarios/:login/pin')
export class PinGestaoController {
  constructor(
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional()
    @Inject(SERVICO_TROCA_RAPIDA)
    private readonly troca: ServicoTrocaRapida | null = null,
  ) {}

  private servico(): ServicoTrocaRapida {
    if (!this.troca) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return this.troca;
  }

  private gestor(req: RequisicaoAutorizada): { rede: string; estabelecimento: string; login: string } {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return { rede: s.rede, estabelecimento: s.estabelecimentoAtivo, login: s.usuario.login };
  }

  private alvo(login: string): string {
    const r = esquemaLogin.safeParse(login);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Login inválido.');
    return r.data;
  }

  private problema(e: unknown): never {
    if (e instanceof ErroSessao) {
      const [tipo, status, titulo] =
        e.tipo === 'pin-recusado'
          ? (['recusa-de-negocio', 409, 'PIN não retirado'] as const)
          : (['indisponivel', 503, 'Serviço indisponível'] as const);
      throw new ErroProblema(tipo, status, titulo, e.detalhe, e.codigo ? { codigo: e.codigo } : {});
    }
    throw e;
  }

  @Get()
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async situacao(@Param('login') login: string, @Req() req: RequisicaoAutorizada): Promise<SituacaoPinTela> {
    const t = this.servico();
    const g = this.gestor(req);
    return t.situacaoDoUsuario(g, this.alvo(login)).catch((e: unknown) => this.problema(e));
  }

  @Post('retirar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'SGH_ACESSO_PIN e SGH_TRILHA (acesso.pin.retirado: quem, motivo e valor anterior) na mesma transação SGH_',
  )
  async retirar(
    @Param('login') login: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ anterior: 'definido' | 'bloqueado'; situacao: SituacaoPinTela }> {
    const t = this.servico();
    const alvo = this.alvo(login);
    const r = esquemaRetirarPinGestor.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        r.error.issues[0]?.message ?? undefined,
      );
    const g = this.gestor(req);
    await reautenticar(this.sessoes, this.resolvedor, req, r.data.senha);
    const origem = {
      estacao: estacaoDaRequisicao(req),
      correlacao: correlacaoDaRequisicao(req, 'acesso-pin'),
    };
    const feito = await t
      .retirarDoUsuario(g, alvo, r.data.motivo, origem)
      .catch((e: unknown) => this.problema(e));
    const situacao = await t.situacaoDoUsuario(g, alvo).catch((e: unknown) => this.problema(e));
    return { anterior: feito.anterior, situacao };
  }
}
