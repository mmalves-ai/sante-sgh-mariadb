// Guarda global de permissão (ficha do M06, regra 5 e 11): sessão → permissão, com as MESMAS regras CASL da
// tela (regrasDeAcesso de @sgh/dominio-acesso). Rota sem @Permissao nem @Publica é recusada (falha fechada).
// Os passos seguintes (escopo, categoria, vínculo) são do handler, pela `decidir` sobre o registro.
// Com a sessão real, todo método que muda estado exige o CSRF por token duplo (M05). A tentativa negada
// (sessão válida sem a permissão) vai só à SGH_TRILHA, com resultado "falha" (o Delphi não registra).
import { type CanActivate, type ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EVENTOS_AUDITAVEIS, type Sessao } from '@sgh/contratos';
import { type AbilitySgh, criarAbility, pode, regrasDeAcesso } from '@sgh/dominio-acesso';
import { executarComo } from '@sgh/legado';
import { ErroProblema } from '../problema.filter.js';
import { CHAVE_PERMISSAO, CHAVE_PERMISSAO_OU, CHAVE_PUBLICA } from './decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from './estacao.js';
import {
  RESOLVEDOR_SESSAO,
  type RequisicaoComCabecalhos,
  type ResolvedorSessao,
} from './resolvedor-sessao.js';
import { AUDITORIA_COMO, REGISTRADOR_TRILHA } from './simbolos.js';
import type { RegistradorTrilha } from './trilha.js';
import { ErroSessao } from '../sessao/servico-sessao.js';

/** ADR 0021: a escrita recusada antes do handler, numa sessão "como", vai à auditoria como "blocked". */
export interface AuditoriaComoBloqueio {
  registrarBloqueada(
    como: NonNullable<RequisicaoComCabecalhos['sghComo']>,
    metodo: string,
    caminho: string,
    http: number,
  ): Promise<void>;
}

export interface AutorizacaoDaRequisicao {
  readonly sessao: Sessao;
  readonly real: boolean;
  readonly ability: AbilitySgh;
  readonly permissao: string;
}

/** Alvo do evento auditado, informado pelo handler ao interceptor do @Auditar (só identificadores). */
export interface AlvoAuditado {
  readonly paciente?: number;
  readonly atendimento?: number;
  readonly tabelaAlvo?: string;
  readonly idAlvo?: string;
  /** M11: chave natural sem dado pessoal (ex.: o tipo da busca e a quantidade de resultados). */
  readonly chaveNaturalAlvo?: string;
}

export type RequisicaoAutorizada = RequisicaoComCabecalhos & {
  sgh?: AutorizacaoDaRequisicao;
  sghAlvo?: AlvoAuditado;
};

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class GuardaPermissao implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha | null,
    @Optional() @Inject(AUDITORIA_COMO) private readonly auditoriaComo: AuditoriaComoBloqueio | null = null,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const alvos = [contexto.getHandler(), contexto.getClass()];
    if (this.reflector.getAllAndOverride<string>(CHAVE_PUBLICA, alvos)) return true;
    const permissao = this.reflector.getAllAndOverride<string>(CHAVE_PERMISSAO, alvos);
    if (!permissao) throw new ErroProblema('sem-permissao', 403, 'Rota sem permissão declarada');
    const alternativas = this.reflector.getAllAndOverride<readonly string[]>(CHAVE_PERMISSAO_OU, alvos) ?? [];
    const req = contexto.switchToHttp().getRequest<RequisicaoAutorizada>();
    // Erro do serviço de sessão (banco, armazém, guarda do "como"): 503, nunca libera (falha fechada).
    const r = await this.resolvedor.resolver(req).catch((e: unknown) => {
      if (e instanceof ErroSessao && e.tipo === 'indisponivel')
        throw new ErroProblema('indisponivel', 503, 'Serviço indisponível', e.detalhe);
      throw e;
    });
    if (!r) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária', 'Entre para continuar.');
    if (r.como) {
      req.sghComo = r.como;
      const c = r.como;
      try {
        // Marcada como o interceptor marca o handler: a negação gravada aqui vai à SGH_TRILHA com a ORIGEM
        // do ator real (conta e sessão de suporte), não só com o alvo.
        return await executarComo(
          { sessao: c.sessao, atorTipo: c.atorTipo, idConta: c.idConta, alvo: c.alvoLogin, acao: null },
          () => this.conferir(req, r, permissao, alternativas),
        );
      } catch (e) {
        const metodo = (req.method ?? 'GET').toUpperCase();
        if (!METODOS_SEGUROS.has(metodo) && e instanceof ErroProblema)
          await this.auditoriaComo?.registrarBloqueada(
            r.como,
            metodo,
            (req.url ?? '').split(/[?#]/)[0]?.slice(0, 300) ?? '',
            e.getStatus(),
          );
        throw e;
      }
    }
    return this.conferir(req, r, permissao, alternativas);
  }

  private async conferir(
    req: RequisicaoAutorizada,
    r: { sessao: Sessao; real: boolean },
    permissao: string,
    alternativas: readonly string[] = [],
  ): Promise<boolean> {
    if (r.sessao.bloqueada)
      throw new ErroProblema('sessao-bloqueada', 423, 'Sessão bloqueada', 'Confirme a senha para continuar.');
    if (r.real && !METODOS_SEGUROS.has((req.method ?? 'GET').toUpperCase()))
      if (!(await this.resolvedor.csrfConfere(req)))
        throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
    const ability = criarAbility(regrasDeAcesso(r.sessao.permissoes, r.sessao.escopos));
    // A declarada ou, se a rota tiver (@PermissaoOu), uma das alternativas: vale a primeira que a sessão tiver.
    const valeu = pode(ability, permissao) ? permissao : alternativas.find((a) => pode(ability, a));
    if (!valeu) {
      await this.registrarNegacao(req, r.sessao, permissao);
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.');
    }
    req.sgh = { sessao: r.sessao, real: r.real, ability, permissao: valeu };
    return true;
  }

  /** A recusa sai mesmo se a trilha falhar (nada foi mostrado nem gravado). */
  private async registrarNegacao(req: RequisicaoAutorizada, sessao: Sessao, permissao: string) {
    if (!this.trilha) return;
    await this.trilha
      .registrar({
        evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
        rede: sessao.rede ?? '',
        hospital: sessao.estabelecimentoAtivo ?? '',
        usuario: sessao.usuario.login ?? sessao.usuario.id,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'negada'),
        recurso: permissao.slice(0, 80),
        resultado: 'falha',
      })
      .catch(() => undefined);
  }
}
