// A configuração dos índices de UTI do estabelecimento (ficha do M45, regra 5): agrupamentos, variáveis com as faixas de
// pontuação, os pesos das categorias diagnósticas do APACHE II e os itens de Glasgow, lidos do banco do
// estabelecimento (consulta; cache). O motor usa a configuração como está; o que nela diverge da publicação original fica
// listado para a coordenação da UTI (DP-20). Puro: sem banco.
import {
  type ConfiguracaoIndicesUti,
  type FaixaVariavelIndice,
  type IndiceUti,
  jcs,
  sha256Hex,
  type TipoAdmissaoUti,
  type VariavelIndice,
} from '@sgh/contratos';

/** A impressão SHA-256 da configuração (JCS): guardada com o índice para refazer a conta com a mesma configuração. */
export function impressaoConfiguracao(c: Omit<ConfiguracaoIndicesUti, 'impressao'>): Promise<string> {
  return sha256Hex(
    jcs({
      agrupamentos: [...c.agrupamentos].sort((a, b) => a.id - b.id),
      variaveis: [...c.variaveis].sort((a, b) => a.id - b.id),
      glasgow: [...c.glasgow].sort((a, b) => a.id - b.id),
    }),
  );
}

export async function comImpressao(
  c: Omit<ConfiguracaoIndicesUti, 'impressao'>,
): Promise<ConfiguracaoIndicesUti> {
  return { ...c, impressao: await impressaoConfiguracao(c) };
}

/**
 * Os pontos do valor na variável. As faixas, ordenadas pelo início, cobrem cada uma do seu início até o início da
 * seguinte (a configuração deixa buracos de um décimo entre faixas, como 38,4 e 38,5); a última vai até o fim dela.
 * Abaixo da primeira faixa ou acima da última: 0 (valor normal), salvo `saturarAcima` (a dose de droga vasoativa acima
 * da última faixa fica com os pontos da última).
 */
export function pontosDaVariavel(
  v: Pick<VariavelIndice, 'faixas'>,
  valor: number,
  o: { saturarAcima?: boolean } = {},
): { pontos: number; faixa: FaixaVariavelIndice | null } {
  const fs = [...v.faixas].sort((a, b) => a.de - b.de);
  if (fs.length === 0 || valor < fs[0]!.de) return { pontos: 0, faixa: null };
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]!;
    const proxima = fs[i + 1];
    if (proxima && proxima.de > f.de ? valor < proxima.de : valor <= f.ate)
      return { pontos: f.pontuacao, faixa: f };
  }
  const ultima = fs.at(-1)!;
  return o.saturarAcima ? { pontos: ultima.pontuacao, faixa: ultima } : { pontos: 0, faixa: null };
}

/** As variáveis de um índice (pelos agrupamentos), pela sigla. */
export function variaveisDoIndice(c: ConfiguracaoIndicesUti, indice: IndiceUti): Map<string, VariavelIndice> {
  const ags = new Set(c.agrupamentos.filter((a) => a.indice === indice).map((a) => a.id));
  const r = new Map<string, VariavelIndice>();
  for (const v of c.variaveis) if (ags.has(v.agrupamento) && v.sigla) r.set(v.sigla, v);
  return r;
}

/** O grupo das categorias diagnósticas de cada agrupamento do APACHE II (pela descrição do agrupamento). */
export function tipoDoAgrupamento(descricao: string): TipoAdmissaoUti {
  if (/eletiva/i.test(descricao)) return 'eletiva';
  if (/urg[eê]ncia/i.test(descricao)) return 'urgencia';
  return 'nao-cirurgico';
}

/** As categorias diagnósticas do APACHE II do tipo de admissão (para a tela e para a conferência da categoria). */
export function categoriasDoTipo(
  c: ConfiguracaoIndicesUti,
  tipo: TipoAdmissaoUti,
): { id: number; nome: string; peso: number; grupo: string }[] {
  const ags = new Map(c.agrupamentos.filter((a) => a.indice === 'apache2').map((a) => [a.id, a]));
  return c.variaveis
    .filter((v) => v.pesoCategoria !== null && ags.has(v.agrupamento))
    .filter((v) => tipoDoAgrupamento(ags.get(v.agrupamento)!.descricao) === tipo)
    .map((v) => ({
      id: v.id,
      nome: v.nome,
      peso: v.pesoCategoria!,
      grupo: ags.get(v.agrupamento)!.descricao,
    }));
}

/** Os itens de Glasgow de um índice (APACHE II: as três variáveis do agrupamento de Glasgow; SOFA: as do dele). */
export function glasgowDoIndice(
  c: ConfiguracaoIndicesUti,
  indice: IndiceUti,
): { variavel: VariavelIndice; itens: { id: number; nome: string; pontuacao: number }[] }[] {
  const ags = new Set(
    c.agrupamentos.filter((a) => a.indice === indice && /glasgow/i.test(a.descricao)).map((a) => a.id),
  );
  return c.variaveis
    .filter((v) => ags.has(v.agrupamento) && c.glasgow.some((g) => g.variavel === v.id))
    .map((v) => ({
      variavel: v,
      itens: c.glasgow
        .filter((g) => g.variavel === v.id)
        .map((g) => ({ id: g.id, nome: g.nome, pontuacao: g.pontuacao }))
        .sort((a, b) => b.pontuacao - a.pontuacao),
    }));
}

/** O que a configuração do estabelecimento tem de diferente da publicação original (para a DP-20). */
export function divergenciasDaPublicacao(c: ConfiguracaoIndicesUti): string[] {
  const r: string[] = [];
  const sofa = variaveisDoIndice(c, 'sofa');
  const deb = sofa.get('DEBURINARIO');
  if (deb && deb.faixas.some((f) => f.pontuacao === 3 && f.ate > 500))
    r.push(
      'SOFA renal: débito urinário de 500 mL/dia ou mais ainda pontua 3 (a publicação pontua 3 abaixo de 500).',
    );
  const dobu = sofa.get('DOBUTAMINA');
  if (dobu && dobu.faixas.every((f) => f.ate <= 5))
    r.push(
      'SOFA cardiovascular: dobutamina só tem faixa até 5 µg/kg/min (a publicação pontua 2 em qualquer dose); acima, o motor mantém os pontos da última faixa.',
    );
  const resp = sofa.get('PAO2');
  if (resp && resp.faixas.some((f) => f.pontuacao >= 3))
    r.push('SOFA respiratório: 3 e 4 pontos sem a exigência do suporte ventilatório da publicação.');
  const neuro = [...sofa.values()].find((v) => v.sigla === 'PONTUACAO');
  if (neuro && neuro.faixas.length === 0)
    r.push(
      'SOFA neurológico: a configuração não tem faixas para o Glasgow; o motor usa as da publicação (15: 0; 13-14: 1; 10-12: 2; 6-9: 3; menos de 6: 4).',
    );
  const ap = variaveisDoIndice(c, 'apache2');
  if (ap.get('TEMP')?.nome.match(/axilar/i))
    r.push('APACHE II: a temperatura é a axilar (a publicação usa a retal).');
  return r;
}
