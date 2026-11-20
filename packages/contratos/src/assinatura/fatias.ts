// Carregador único do catálogo de operações (W0-01): o catálogo mora em docs/operacoes/catalogo/<prefixo>.yaml, um
// arquivo por prefixo do nome da operação (`cadastro.cadastrarPaciente` → cadastro.yaml), para que os pacotes da
// obra andem em paralelo sem editar o mesmo arquivo. Esta parte é pura (sem disco): recebe os arquivos já lidos
// (o YAML de cada um) e devolve o catálogo validado pelo esquema de assinatura/catalogo.ts. A leitura do disco
// fica em @sgh/legado (nucleo/catalogo-operacoes.ts, lerCatalogoOperacoes), usada pelo executor M04, pelo
// `pnpm operacoes:estado`, pela tela de testes de assinatura e pelas ferramentas.
// Regras do carregador (além das do esquema): nome repetido entre arquivos é recusado; operação gravada no
// arquivo de outro prefixo é recusada. A ordem do catálogo devolvido é a do nome (independe do arquivo e da
// posição dentro dele), para que a saída de quem lista as operações não dependa da arrumação dos arquivos.
import { z } from 'zod';
import { type CatalogoOperacoes, esquemaCatalogoOperacoes, esquemaOperacaoCatalogo } from './catalogo.js';

/** Prefixo do nome da operação (= nome do arquivo sem `.yaml`). */
export const PADRAO_PREFIXO_CATALOGO = /^[a-z]+$/;

/** Um arquivo do catálogo: o nome (`cadastro.yaml`) e o conteúdo YAML já interpretado. */
export interface FatiaCatalogo {
  readonly arquivo: string;
  readonly dados: unknown;
}

const esquemaFatia = z
  .object({
    formato: z.literal(1),
    operacoes: z.array(z.record(z.string(), z.unknown())).nullable(),
  })
  .strict();

/** Prefixo do arquivo (`cadastro.yaml` → `cadastro`), ou null quando o nome não segue a regra. */
export function prefixoDoArquivoCatalogo(arquivo: string): string | null {
  const base = arquivo.split(/[\\/]/).pop() ?? '';
  const m = /^([a-z]+)\.yaml$/.exec(base);
  return m ? (m[1] ?? null) : null;
}

/** Prefixo do nome da operação (`cadastro.cadastrarPaciente` → `cadastro`). */
export const prefixoDaOperacao = (nome: string): string => nome.split('.')[0] ?? '';

/** Ordem do catálogo: pelo nome, comparação por código (estável e igual em qualquer máquina). */
export function ordenarCatalogo(cat: CatalogoOperacoes): CatalogoOperacoes {
  return {
    ...cat,
    operacoes: [...cat.operacoes].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0)),
  };
}

/** Catálogo de um texto único já interpretado (testes e catálogos de exemplo), validado e na ordem do nome. */
export function catalogoUnico(dados: unknown): CatalogoOperacoes {
  return ordenarCatalogo(esquemaCatalogoOperacoes.parse(dados));
}

/** Um problema do zod em texto: `caminho.do.campo mensagem` (sem o índice da lista, que não ajuda a achar). */
const textoDoProblema = (issue: z.core.$ZodIssue, sem = 0): string => {
  const caminho = issue.path.slice(sem).map(String).join('.');
  return caminho ? `${caminho} ${issue.message}` : issue.message;
};

/**
 * Junta os arquivos do catálogo. Recusa (Error com todos os problemas): arquivo fora da regra do nome,
 * arquivo fora do formato, operação fora do arquivo do seu prefixo, nome repetido (no mesmo arquivo ou
 * entre arquivos) e operação fora do esquema. Depois, o catálogo inteiro passa pelo esquema (estado,
 * conferência, autorização). Todo problema sai como `<arquivo>: <operação>: <campo> <mensagem>`, nunca pela
 * posição na lista juntada (que não corresponde a nenhuma linha de nenhum arquivo).
 */
export function juntarFatiasCatalogo(fatias: readonly FatiaCatalogo[]): CatalogoOperacoes {
  const problemas: string[] = [];
  const onde = new Map<string, string>();
  const operacoes: unknown[] = [];
  /** De onde veio cada operação de `operacoes` (para traduzir o índice de um erro do esquema). */
  const origem: string[] = [];
  const vistos = new Set<string>();
  for (const f of fatias) {
    const prefixo = prefixoDoArquivoCatalogo(f.arquivo);
    if (!prefixo) {
      problemas.push(`${f.arquivo}: nome de arquivo fora da regra (<prefixo>.yaml, só letras minúsculas)`);
      continue;
    }
    if (vistos.has(prefixo)) {
      problemas.push(`${f.arquivo}: arquivo repetido`);
      continue;
    }
    vistos.add(prefixo);
    const lido = esquemaFatia.safeParse(f.dados);
    if (!lido.success) {
      problemas.push(`${f.arquivo}: fora do formato (formato: 1 e a lista operacoes)`);
      continue;
    }
    for (const op of lido.data.operacoes ?? []) {
      const nome = typeof op['nome'] === 'string' ? op['nome'] : '';
      if (!nome) {
        problemas.push(`${f.arquivo}: operação sem nome`);
        continue;
      }
      if (prefixoDaOperacao(nome) !== prefixo)
        problemas.push(
          `${f.arquivo}: ${nome} fora do arquivo do seu prefixo (vai em ${prefixoDaOperacao(nome)}.yaml)`,
        );
      const antes = onde.get(nome);
      if (antes !== undefined) problemas.push(`${nome}: nome repetido (${antes} e ${f.arquivo})`);
      else onde.set(nome, f.arquivo);
      const valida = esquemaOperacaoCatalogo.safeParse(op);
      if (!valida.success)
        for (const issue of valida.error.issues)
          problemas.push(`${f.arquivo}: ${nome}: ${textoDoProblema(issue)}`);
      operacoes.push(op);
      origem.push(`${f.arquivo}: ${nome}`);
    }
  }
  if (problemas.length) recusar(problemas);
  // Regras transversais do esquema (módulo, conferência, autorização): o índice vira arquivo e operação.
  const lido = esquemaCatalogoOperacoes.safeParse({ formato: 1, operacoes });
  if (!lido.success)
    recusar(
      lido.error.issues.map((issue) => {
        const [raiz, i] = issue.path;
        return raiz === 'operacoes' && typeof i === 'number' && origem[i] !== undefined
          ? `${origem[i]}: ${textoDoProblema(issue, 2)}`
          : textoDoProblema(issue);
      }),
    );
  return ordenarCatalogo(lido.data);
}

function recusar(problemas: readonly string[]): never {
  throw new Error(`Catálogo de operações recusado pelo carregador:\n- ${problemas.join('\n- ')}`);
}
