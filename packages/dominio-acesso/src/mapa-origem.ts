// Correspondência entre o sistema de origem e as permissões do produto (ADR 0007, item 8). É dado do conector
// (conector/mapa/permissoes.tsv), nunca da declaração da permissão: quem tinha a opção do menu ou a marca de
// usuário na origem recebe a permissão do produto. O domínio só interpreta o texto; quem lê o arquivo é a borda.

/** Tipo da chave de origem: opção do menu (número) ou marca de usuário (`tabela.coluna`). */
export type TipoOrigem = 'opcao_menu' | 'marca_usuario';

export interface CorrespondenciaOrigem {
  readonly tipo: TipoOrigem;
  readonly chave: string;
  readonly permissao: string;
}

/** Marca de usuário da origem (complemento do usuário, usuário do estoque etc.) que concede permissão. */
export interface MarcaUsuarioOrigem {
  readonly tabela: string;
  readonly coluna: string;
}

/** Lê o texto do mapa (cabeçalho `tipo_origem`, `chave_origem`, `codigo_permissao`); linha inválida reprova. */
export function lerMapaOrigem(texto: string): CorrespondenciaOrigem[] {
  const r: CorrespondenciaOrigem[] = [];
  const linhas = texto.split('\n');
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i]!.trimEnd();
    if (l === '') continue;
    const [tipo, chave, permissao] = l.split('\t');
    const valida =
      (tipo === 'opcao_menu' && /^\d+$/.test(chave ?? '')) ||
      (tipo === 'marca_usuario' && /^[A-Z0-9_]+\.[A-Z0-9_]+$/.test(chave ?? ''));
    if (!valida || !permissao) throw new Error(`mapa de origem: linha ${i + 1} inválida`);
    r.push({ tipo: tipo as TipoOrigem, chave: chave!, permissao });
  }
  return r;
}

/** Opções do menu de origem que concedem cada permissão (ordenadas). */
export function opcoesPorPermissao(mapa: readonly CorrespondenciaOrigem[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const c of mapa)
    if (c.tipo === 'opcao_menu') m.set(c.permissao, [...(m.get(c.permissao) ?? []), Number(c.chave)]);
  for (const l of m.values()) l.sort((a, b) => a - b);
  return m;
}

/** Marcas de usuário distintas do mapa (só elas são lidas da origem). */
export function marcasDoMapa(mapa: readonly CorrespondenciaOrigem[]): MarcaUsuarioOrigem[] {
  const vistas = new Map<string, MarcaUsuarioOrigem>();
  for (const c of mapa)
    if (c.tipo === 'marca_usuario') {
      const [tabela, coluna] = c.chave.split('.') as [string, string];
      vistas.set(c.chave, { tabela, coluna });
    }
  return [...vistas.values()];
}
