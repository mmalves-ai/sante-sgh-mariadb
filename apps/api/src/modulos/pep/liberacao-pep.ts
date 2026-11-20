// Liberação dos recursos do prontuário de uso diário (M23; POL-3; ficha, seção 12): a mesma regra do registro
// clínico do M22, por chave — a chave do tipo `recurso` por estabelecimento, setor, grupo ou pessoa, com os
// pré-requisitos declarados (a conferência no outro sistema dos atos que gravam no banco do estabelecimento) e
// registrados. Desligada: a tela fica em consulta e a gravação responde 403 `recurso-desligado` com o motivo.
import { recursoDesligado } from '@sgh/contratos';
import { recursoLigado, recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { type CacheConfig, type FonteConfiguracao, TTL_CONFIG_NOVO_S } from '../config/public-api.js';

export interface Liberacao {
  readonly ligada: boolean;
  readonly motivo: string | null;
}

const SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: a funcionalidade fica desligada.';

export class LiberacaoPep {
  constructor(
    private readonly configuracao: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
  ) {}

  private async dados(s: Pick<SessaoCadastro, 'rede' | 'hospital'>) {
    const fonte = this.configuracao;
    if (!fonte) return null;
    const carregar = async () => ({
      chaves: await fonte.chaves(s.rede, s.hospital),
      prerequisitos: await fonte.prerequisitos(s.rede, s.hospital),
    });
    return this.cache
      ? this.cache.lerOuCarregar(
          this.cache.chave(s.rede, s.hospital, 'liberacao'),
          TTL_CONFIG_NOVO_S,
          carregar,
        )
      : carregar();
  }

  async consultar(s: SessaoCadastro, chave: string): Promise<Liberacao> {
    let d: Awaited<ReturnType<LiberacaoPep['dados']>>;
    try {
      d = await this.dados(s);
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Configuração indisponível',
        'Não foi possível conferir a liberação.',
      );
    }
    if (!d) return { ligada: false, motivo: SEM_CONFIGURACAO };
    const r = recursoDesligado(chave);
    const chaves = d.chaves
      .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const registrados = d.prerequisitos.filter((p) => p.recurso === chave);
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const sujeito = {
      pessoa: s.login,
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
    };
    if (recursoLigado(chaves, r?.prerequisitos ?? [], registrados, sujeito, new Date()))
      return { ligada: true, motivo: null };
    const soPrerequisito = recursoLigado(chaves, [], [], sujeito, new Date());
    const titulo = r?.titulo ?? 'A funcionalidade';
    return {
      ligada: false,
      motivo: soPrerequisito
        ? `${titulo}: falta o pré-requisito do estabelecimento (${r?.prerequisitos.map((p) => p.descricao).join(' ') ?? ''}).`
        : `${titulo} ainda não foi liberada para este estabelecimento ou setor. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.`,
    };
  }

  /**
   * A chave ligada para o estabelecimento INTEIRO (escopo `hospital`) com os pré-requisitos DELE cumpridos: a regra de
   * quem lê ou grava no banco de outro estabelecimento a partir da sessão deste (M57, a Rede). Sem a configuração ou
   * com ela indisponível: desligado (falha fechada).
   */
  async ligadaNoEstabelecimento(rede: string, hospital: string, chave: string): Promise<boolean> {
    try {
      const d = await this.dados({ rede, hospital });
      if (!d) return false;
      const chaves = d.chaves
        .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
        .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
      return recursoLigadoNoEstabelecimento(
        chaves,
        recursoDesligado(chave)?.prerequisitos ?? [],
        d.prerequisitos.filter((p) => p.recurso === chave),
        new Date(),
      );
    } catch {
      return false;
    }
  }

  async exigir(s: SessaoCadastro, chave: string): Promise<void> {
    const l = await this.consultar(s, chave);
    if (!l.ligada)
      throw new ErroProblema('recurso-desligado', 403, 'Funcionalidade desligada', l.motivo ?? '', {
        codigo: 'recurso-desligado',
      });
  }
}
