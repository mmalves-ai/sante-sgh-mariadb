// Guarda global das chaves de tela da onda 0 (ficha do M38, regra 3 e seção 12): a rota declarada com uma
// permissão sob chave de tela (PERMISSOES_SOB_CHAVE_DE_TELA) só responde quando a chave vale para quem pergunta
// (pessoa, grupo do legado ou setor ativo), ou quando vale a de uma tela das ondas seguintes que usa a mesma
// leitura. Senão, 403 `recurso-desligado` com o motivo (fora do escopo da onda, ou desligada): nada é lido. Roda
// depois da guarda de permissão (sessão e permissão já conferidas). Sem a configuração, 503 (falha fechada).
import { type CanActivate, type ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MOTIVO_FORA_DO_ESCOPO_ONDA_0, MOTIVO_TELA_DESLIGADA_ONDA_0, recursoDesligado } from '@sgh/contratos';
import { chaveDeTelaDaPermissao, situacaoDaLeitura } from '@sgh/dominio-config';
import { CHAVE_PERMISSAO, CHAVE_PUBLICA } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { CACHE_CONFIG, type CacheConfig, TTL_CONFIG_NOVO_S } from './cache-config.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from './configuracao-fonte.js';

@Injectable()
export class GuardaChaveDeTela implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const alvos = [contexto.getHandler(), contexto.getClass()];
    if (this.reflector.getAllAndOverride<string>(CHAVE_PUBLICA, alvos)) return true;
    const permissao = this.reflector.getAllAndOverride<string>(CHAVE_PERMISSAO, alvos);
    if (!permissao || chaveDeTelaDaPermissao(permissao) === null) return true;
    const a = contexto.switchToHttp().getRequest<RequisicaoAutorizada>().sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const rede = a.sessao.rede ?? '';
    const hospital = a.sessao.estabelecimentoAtivo ?? '';
    const indisponivel = () =>
      new ErroProblema(
        'indisponivel',
        503,
        'Configuração indisponível',
        'Não foi possível conferir a liberação desta consulta. Tente de novo em instantes.',
      );
    if (!this.fonte) throw indisponivel();
    const fonte = this.fonte;
    const carregar = async () => ({
      chaves: await fonte.chaves(rede, hospital),
      prerequisitos: await fonte.prerequisitos(rede, hospital),
    });
    let dados: Awaited<ReturnType<typeof carregar>>;
    try {
      dados = this.cache
        ? await this.cache.lerOuCarregar(
            this.cache.chave(rede, hospital, 'liberacao'),
            TTL_CONFIG_NOVO_S,
            carregar,
          )
        : await carregar();
    } catch {
      throw indisponivel();
    }
    const setor = a.sessao.unidadeAtiva;
    const grupo = a.sessao.grupoLegado;
    const sujeito = {
      pessoa: a.sessao.usuario.login ?? a.sessao.usuario.id,
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
      ...(grupo ? { grupo } : {}),
    };
    const agora = new Date();
    const situacao = situacaoDaLeitura(permissao, (chave) => ({
      chaves: dados.chaves
        .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
        .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true })),
      declarados: recursoDesligado(chave)?.prerequisitos ?? [],
      registrados: dados.prerequisitos.filter((p) => p.recurso === chave),
      sujeito,
      agora,
    }));
    if (situacao === null || situacao === 'ligada') return true;
    throw new ErroProblema(
      'recurso-desligado',
      403,
      'Consulta desligada',
      situacao === 'fora-do-escopo' ? MOTIVO_FORA_DO_ESCOPO_ONDA_0 : MOTIVO_TELA_DESLIGADA_ONDA_0,
      { codigo: 'recurso-desligado' },
    );
  }
}
