// M60, etapa 1 (entrega 2): gerador da lista de scripts SGH_ com o hash, gerada do repositório na hora do pacote
// (inclui o que os marcos seguintes acrescentarem e nunca desatualiza). Anexo do manual de implantação.
import { ordemDeAplicacao, type ScriptSgh } from '@sgh/legado';

export interface ItemListaScripts {
  /** Posição na ordem em que `sgh:aplicar` aplica (a de dependência, D8-601), a partir de 1. */
  readonly ordem: number;
  readonly numero: string;
  readonly arquivo: string;
  readonly sha256: string;
  readonly comandos: number;
}

/** Na ordem em que `sgh:aplicar` aplica: pelo número, salvo quando um script cita objeto de outro maior. */
export function listaDeScripts(scripts: readonly ScriptSgh[]): ItemListaScripts[] {
  return ordemDeAplicacao([...scripts].sort((a, b) => a.numero - b.numero)).map((s, k) => ({
    ordem: k + 1,
    numero: String(s.numero).padStart(4, '0'),
    arquivo: s.arquivo,
    sha256: s.hash,
    comandos: s.comandos.length,
  }));
}

/** Anexo em Markdown: nº, arquivo (em packages/legado/src/), sha256 completo e comandos. */
export function anexoDeScripts(itens: readonly ItemListaScripts[]): string {
  return [
    '# Anexo: scripts SGH_ do pacote',
    '',
    '<!-- Gerado por `pnpm implantacao:listas`; não edite à mão. -->',
    '',
    `São ${itens.length} scripts, listados na ordem em que \`sgh:aplicar\` os aplica (a mesma da simulação):`,
    'a de dependência, que segue o número salvo quando um script cita objeto de outro de número maior. Cada um só',
    'cria objetos `SGH_` e é registrado em `SGH_VERSAO_SCRIPT` com o hash abaixo; um hash diferente no banco é',
    'recusado.',
    '',
    '| ordem | nº | arquivo | sha256 | comandos |',
    '|---:|---|---|---|---:|',
    ...itens.map(
      (i) => `| ${i.ordem} | \`${i.numero}\` | \`${i.arquivo}\` | \`${i.sha256}\` | ${i.comandos} |`,
    ),
    '',
  ].join('\n');
}

/** Scripts do repositório que o anexo (ou o manual) não cita, e hashes do anexo que não batem. */
export function conferirAnexo(
  texto: string,
  itens: readonly ItemListaScripts[],
): { faltam: string[]; hashDivergente: string[] } {
  const faltam = itens.filter((i) => !texto.includes(i.arquivo)).map((i) => i.arquivo);
  const hashDivergente = itens
    .filter((i) => texto.includes(i.arquivo) && !texto.includes(i.sha256))
    .map((i) => i.arquivo);
  return { faltam, hashDivergente };
}
