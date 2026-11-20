// Situação das chaves da operadora própria no estabelecimento da sessão (M56, regra 1; ficha, seções 8 e 12; POL-3):
// a chave do módulo (`operadora`, com o registro da operadora na ANS como pré-requisito) e a de cada fatia
// (`operadora.<recurso>`), pelo resolvedor do M08 (estabelecimento, setor, grupo ou pessoa, com os pré-requisitos
// declarados e registrados). Sem nenhuma linha em SGH_CFG_LIBERACAO, tudo está desligado; a fatia ligada só vale com o
// módulo ligado (`chaveOperadoraValendo`). Falha da fonte da configuração = desligada (falha fechada). As rotas de cada
// fatia exigem a chave dela por `exigir` (403 `recurso-desligado` com o motivo).
import {
  CHAVE_MODULO_OPERADORA,
  CHAVES_FATIA_OPERADORA,
  type ChaveOperadora,
  type ChaveSituacaoOperadora,
  recursoDesligado,
  type SituacaoOperadora,
} from '@sgh/contratos';
import { recursoLigado } from '@sgh/dominio-config';
import { situacaoChaveOperadora } from '@sgh/dominio-operadora';
import { ErroProblema } from '../../../problema.filter.js';
import { type CacheConfig, type FonteConfiguracao, TTL_CONFIG_NOVO_S } from '../../config/public-api.js';

export interface SujeitoOperadora {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly setor: number | null;
}

export const SEM_CONFIGURACAO_OPERADORA =
  'A configuração das funcionalidades do estabelecimento não está disponível: a operadora própria fica desligada.';
const DESLIGADA = (titulo: string) =>
  `"${titulo}" está desligada neste estabelecimento. O administrador liga em Funcionalidades por estabelecimento.`;
const AGUARDANDO =
  'Ligada, mas só vale quando a operadora própria for ligada no estabelecimento (a chave do módulo).';

export class ServicoSituacaoOperadora {
  constructor(
    private readonly fonte: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
  ) {}

  private async dados(s: SujeitoOperadora) {
    const fonte = this.fonte;
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

  /** O retrato do módulo e das fatias (uma leitura da configuração). */
  async situacao(s: SujeitoOperadora): Promise<SituacaoOperadora> {
    let d: Awaited<ReturnType<ServicoSituacaoOperadora['dados']>>;
    try {
      d = await this.dados(s);
    } catch {
      d = null;
    }
    const sujeito = { pessoa: s.login, ...(s.setor !== null ? { setor: String(s.setor) } : {}) };
    const agora = new Date();
    const todas: { chave: ChaveOperadora; fatia: string | null }[] = [
      { chave: CHAVE_MODULO_OPERADORA, fatia: null },
      ...CHAVES_FATIA_OPERADORA.map((c) => ({
        chave: `operadora.${c.recurso}` as ChaveOperadora,
        fatia: c.fatia as string,
      })),
    ];
    // Primeiro, cada chave sozinha (com os pré-requisitos dela); depois, a regra do módulo sobre as que valem.
    const ligadas = new Set<string>();
    const parciais = todas.map(({ chave, fatia }) => {
      const declarado = recursoDesligado(chave);
      const titulo = declarado?.titulo ?? chave;
      const declarados = declarado?.prerequisitos ?? [];
      const registrados = d ? d.prerequisitos.filter((p) => p.recurso === chave) : [];
      const prerequisitos = declarados.map((p) => ({
        descricao: p.descricao,
        situacao: registrados.find((x) => x.tipo === p.tipo)?.situacao ?? 'pendente',
      }));
      if (!d) return { chave, fatia, titulo, prerequisitos, motivo: SEM_CONFIGURACAO_OPERADORA };
      const chaves = d.chaves
        .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
        .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
      if (recursoLigado(chaves, declarados, registrados, sujeito, agora)) {
        ligadas.add(chave);
        return { chave, fatia, titulo, prerequisitos, motivo: null };
      }
      const motivo = recursoLigado(chaves, [], [], sujeito, agora)
        ? `"${titulo}" tem pré-requisito pendente neste estabelecimento: ${declarados.map((p) => p.descricao).join(' ')}`
        : DESLIGADA(titulo);
      return { chave, fatia, titulo, prerequisitos, motivo };
    });
    const itens: ChaveSituacaoOperadora[] = parciais.map((p) => {
      const situacao = situacaoChaveOperadora(p.chave, ligadas);
      return {
        chave: p.chave,
        fatia: p.fatia,
        titulo: p.titulo,
        situacao,
        motivo: situacao === 'aguardando-modulo' ? AGUARDANDO : p.motivo,
        prerequisitos: p.prerequisitos,
      };
    });
    const [modulo, ...fatias] = itens;
    return {
      modulo: modulo!,
      fatias,
      aguardandoModulo: fatias.filter((f) => f.situacao === 'aguardando-modulo').map((f) => f.chave),
    };
  }

  /** A chave não vale: 403 `recurso-desligado` com o motivo (nada é lido nem gravado). */
  async exigir(s: SujeitoOperadora, chave: ChaveOperadora): Promise<void> {
    const r = await this.situacao(s);
    const item = chave === CHAVE_MODULO_OPERADORA ? r.modulo : r.fatias.find((f) => f.chave === chave);
    if (item?.situacao !== 'ligada')
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Funcionalidade desligada',
        item?.motivo ?? SEM_CONFIGURACAO_OPERADORA,
        { codigo: 'recurso-desligado' },
      );
  }
}
