// M47 (etapa 2): a chave de recurso (liberação por estabelecimento) vale para quem pergunta (pessoa, grupo do legado, setor ativo),
// com os pré-requisitos declarados cumpridos? É a mesma conta das telas de trabalho (ApoioGravacao) para quem não tem
// a porta de gravação delas (o CRUD genérico dos cadastros da agência, ligado pela `agencia.completa`). Falha fechada:
// sem a configuração, desligada.
import { recursoDesligado } from '@sgh/contratos';
import { recursoLigado } from '@sgh/dominio-config';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { type CacheConfig, TTL_CONFIG_NOVO_S } from './cache-config.js';
import type { FonteConfiguracao } from './configuracao-fonte.js';

export const MOTIVO_CHAVE_DESLIGADA =
  'Este cadastro ainda não foi liberado para gravar neste estabelecimento: fica em consulta. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.';
export const MOTIVO_SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: este cadastro fica em consulta.';

export async function chaveDeRecursoNaSessao(
  fonte: FonteConfiguracao | null,
  cache: CacheConfig | null,
  req: RequisicaoAutorizada,
  chave: string,
): Promise<{ readonly ligada: boolean; readonly motivo: string | null }> {
  const a = req.sgh;
  if (!a || !fonte) return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
  const rede = a.sessao.rede ?? '';
  const hospital = a.sessao.estabelecimentoAtivo ?? '';
  const carregar = async () => ({
    chaves: await fonte.chaves(rede, hospital),
    prerequisitos: await fonte.prerequisitos(rede, hospital),
  });
  let dados: Awaited<ReturnType<typeof carregar>>;
  try {
    dados = cache
      ? await cache.lerOuCarregar(cache.chave(rede, hospital, 'liberacao'), TTL_CONFIG_NOVO_S, carregar)
      : await carregar();
  } catch {
    return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
  }
  const setor = a.sessao.unidadeAtiva;
  const grupo = a.sessao.grupoLegado;
  const sujeito = {
    pessoa: a.sessao.usuario.login ?? a.sessao.usuario.id,
    ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
    ...(grupo ? { grupo } : {}),
  };
  const ligada = recursoLigado(
    dados.chaves
      .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true })),
    recursoDesligado(chave)?.prerequisitos ?? [],
    dados.prerequisitos.filter((p) => p.recurso === chave),
    sujeito,
    new Date(),
  );
  return ligada ? { ligada: true, motivo: null } : { ligada: false, motivo: MOTIVO_CHAVE_DESLIGADA };
}
