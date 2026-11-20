// A liberação da funcionalidade e o parâmetro do novo no escopo do estabelecimento, para o que roda sem a sessão
// interna (o portal de resultados, de outro domínio de identidade, e a vigia do valor crítico): as mesmas chaves e
// parâmetros de Funcionalidades por estabelecimento, sem pessoa nem setor.
import { definicaoParametro, recursoDesligado } from '@sgh/contratos';
import { recursoLigado, resolverParametro, valorTipado } from '@sgh/dominio-config';
import type { FonteConfiguracao } from '../../config/public-api.js';

export async function ligadaNoEstabelecimento(
  configuracao: FonteConfiguracao | null,
  rede: string,
  hospital: string,
  chave: string,
  pessoa: string,
  agora: Date = new Date(),
): Promise<boolean> {
  if (!configuracao) return false;
  try {
    const chaves = (await configuracao.chaves(rede, hospital))
      .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const registrados = (await configuracao.prerequisitos(rede, hospital)).filter((p) => p.recurso === chave);
    return recursoLigado(
      chaves,
      recursoDesligado(chave)?.prerequisitos ?? [],
      registrados,
      { pessoa },
      agora,
    );
  } catch {
    return false;
  }
}

/** O parâmetro do novo resolvido no estabelecimento (o padrão da definição quando ausente). */
export async function parametroDoEstabelecimento(
  configuracao: FonteConfiguracao | null,
  rede: string,
  hospital: string,
  chave: string,
): Promise<number> {
  const def = definicaoParametro(chave);
  if (!def) return 0;
  const valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>> = configuracao
    ? await configuracao.valoresParametro(rede, hospital).catch(() => [])
    : [];
  const v = valorTipado(
    def,
    resolverParametro(
      def,
      valores,
      { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
      new Date(),
    ).valor,
  );
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}
