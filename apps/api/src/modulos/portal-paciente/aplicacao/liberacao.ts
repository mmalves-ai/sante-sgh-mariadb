// A liberação do portal do paciente e os parâmetros no escopo do estabelecimento (o portal roda sem a sessão interna:
// outro domínio de identidade): as mesmas chaves e parâmetros de Funcionalidades por estabelecimento, sem pessoa nem
// setor. A mesma regra do portal de resultados do M26 (sadt/aplicacao/liberacao.ts).
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

async function valor(
  configuracao: FonteConfiguracao | null,
  rede: string,
  hospital: string,
  chave: string,
): Promise<unknown> {
  const def = definicaoParametro(chave);
  if (!def) return null;
  const valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>> = configuracao
    ? await configuracao.valoresParametro(rede, hospital).catch(() => [])
    : [];
  return valorTipado(
    def,
    resolverParametro(
      def,
      valores,
      { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
      new Date(),
    ).valor,
  );
}

/** O parâmetro numérico do novo resolvido no estabelecimento (o padrão da definição quando ausente). */
export async function parametroDoEstabelecimento(
  configuracao: FonteConfiguracao | null,
  rede: string,
  hospital: string,
  chave: string,
): Promise<number> {
  const v = await valor(configuracao, rede, hospital, chave);
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

/** O parâmetro de texto ou lista resolvido no estabelecimento. */
export async function parametroTexto(
  configuracao: FonteConfiguracao | null,
  rede: string,
  hospital: string,
  chave: string,
): Promise<string> {
  const v = await valor(configuracao, rede, hospital, chave);
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
}
