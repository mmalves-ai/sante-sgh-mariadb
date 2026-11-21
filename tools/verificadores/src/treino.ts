// pnpm copia:mascarar / pnpm treino:reiniciar (M37, regra 5; cap-09 §9.12; cap-10 §10.12; cap-15 §15.4.2; scripts
// novos registrados em ESTADO.md › Desvios e em convencoes.md §13). O ambiente de treino é usado por terceiros: a
// cópia dele tem os dados pessoais mascarados pelo método registrado pelo dono (DP-41 liberou as cópias reais só para o
// dev), inclusive nos retratos HT* e nos textos clínicos em BLOB (texto sintético que mantém o formato RTF), com as
// saídas neutralizadas, e é reiniciada toda semana a partir do retrato estável.
//   pnpm copia:mascarar -- --container=redesante-fb-treino-<cod> --banco=/caminho/treino.fdb
//   pnpm treino:reiniciar -- --hospital=<cod> [--container=redesante-fb-treino-<cod>] [--plano]
// Recusas: destino que não seja container de treino do projeto (`redesante-fb-treino-<cod>`; nunca a cópia de dev,
// nunca o sante-firebird nem outro projeto), AMBIENTE diferente de `treino`, método de mascaramento não registrado
// (TREINO_METODO_MASCARAMENTO com um dos métodos conhecidos; DP-41) e, no reinício, retrato estável ausente. Roda na
// infraestrutura da Rede; a saída só tem contagens, nomes de coluna e tempos. Sem o container e o método (DP-15 e
// DP-41), sai 3 ("bloqueado") com o motivo; `--plano` só imprime os passos.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Containers de outros projetos nesta VM: nunca são tocados (AGENTS.md, regra 4). A cópia de dev do projeto
 * (`redesante-fb-<código>`) não está aqui: ela é recusada por não ser container de treino.
 */
export const CONTAINERS_ALHEIOS: readonly string[] = ['sante-firebird'];

/** Container de treino do projeto: `redesante-fb-treino-<código>` (nunca o de dev `redesante-fb-<código>`). */
export const CONTAINER_TREINO = /^redesante-fb-treino-([a-z][a-z0-9]{1,9})$/;
/** Métodos de mascaramento conhecidos (o dono registra qual vale em TREINO_METODO_MASCARAMENTO). */
export const METODOS_MASCARAMENTO = ['substituicao-sintetica-v1'] as const;
export type MetodoMascaramento = (typeof METODOS_MASCARAMENTO)[number];
/** O reinício cabe em 1 h (ficha, seção 10). */
export const LIMITE_REINICIO_MS = 3_600_000;

export class ErroTreino extends Error {
  override readonly name = 'ErroTreino';
  readonly bloqueado: boolean;
  constructor(mensagem: string, bloqueado = false) {
    super(mensagem);
    this.bloqueado = bloqueado;
  }
}

export function conferirDestinoTreino(container: string | undefined, ambiente: string | undefined): string {
  if (!container) throw new ErroTreino('Informe --container=redesante-fb-treino-<código>.');
  if (CONTAINERS_ALHEIOS.includes(container))
    throw new ErroTreino(`Recusado: ${container} é de outro projeto e nunca é tocado.`);
  const m = CONTAINER_TREINO.exec(container);
  if (!m?.[1])
    throw new ErroTreino(
      `Recusado: ${container} não é container de treino do projeto (redesante-fb-treino-<código>).`,
    );
  if ((ambiente ?? '').trim() !== 'treino') throw new ErroTreino('Recusado: só com AMBIENTE=treino.');
  return m[1];
}

export function conferirMetodo(metodo: string | undefined): MetodoMascaramento {
  const m = (metodo ?? '').trim();
  if (!m)
    throw new ErroTreino(
      'Bloqueado: o dono ainda não registrou o método de mascaramento do treino (DP-41). Até lá, o treino é sobre massa sintética.',
      true,
    );
  if (!(METODOS_MASCARAMENTO as readonly string[]).includes(m))
    throw new ErroTreino(
      `Método de mascaramento desconhecido: ${m} (conhecidos: ${METODOS_MASCARAMENTO.join(', ')}).`,
    );
  return m as MetodoMascaramento;
}

export interface ColunaBanco {
  readonly tabela: string;
  readonly coluna: string;
  /** Tipo do Firebird (RDB$FIELD_TYPE): 261 = BLOB; 37/14 = texto; 7/8/16 = número. */
  readonly tipo: number;
  readonly subtipoBlob: number | null;
  readonly tamanho: number;
}

export interface ListaPessoais {
  readonly pessoais: readonly RegExp[];
  readonly textoLivreAcimaDe: number;
}

export function lerListaPessoais(raiz: string): ListaPessoais {
  const y = parse(readFileSync(resolve(raiz, 'tools/assinatura/colunas-pessoais.yaml'), 'utf8')) as {
    pessoais?: string[];
    sensiveis?: string[];
    texto_livre_acima_de?: number;
  };
  return {
    pessoais: [...(y.pessoais ?? []), ...(y.sensiveis ?? [])].map((p) => new RegExp(`^(?:${p})$`, 'i')),
    textoLivreAcimaDe: y.texto_livre_acima_de ?? 30,
  };
}

const NOME_SEGURO = /^[A-Z][A-Z0-9_$]{0,30}$/;

/** RTF sintético (mantém o formato que o leitor do prontuário espera). */
export const RTF_SINTETICO =
  '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0\\fs20 Texto sintetico do ambiente de treino.\\par}';

/**
 * O plano do método `substituicao-sintetica-v1`: cada coluna pessoal (pela lista de pessoais e sensíveis) e cada texto
 * longo ou BLOB de texto recebe valor sintético determinístico pela linha (nunca derivado do valor real): texto vira
 * "TREINO <coluna> <n>", número vira 0, BLOB de texto vira o RTF sintético, BLOB binário pessoal sai (NULL); datas de
 * nascimento ficam no dia 1º do mês.
 * Tabelas `SGH_` e as de configuração sem pessoa não são tocadas. Só SQL de UPDATE (o container é descartável).
 */
export function planoMascaramento(colunas: readonly ColunaBanco[], lista: ListaPessoais): string[] {
  const r: string[] = [];
  for (const c of colunas) {
    if (!NOME_SEGURO.test(c.tabela) || !NOME_SEGURO.test(c.coluna) || c.tabela.startsWith('SGH_')) continue;
    const pessoal = lista.pessoais.some((p) => p.test(c.coluna));
    const blobTexto = c.tipo === 261 && c.subtipoBlob === 1;
    const textoLongo = (c.tipo === 37 || c.tipo === 14) && c.tamanho > lista.textoLivreAcimaDe;
    if (!pessoal && !blobTexto && !textoLongo) continue;
    let valor: string;
    if (blobTexto) valor = `'${RTF_SINTETICO}'`;
    // BLOB binário pessoal (imagem, assinatura digitalizada): sai inteiro.
    else if (c.tipo === 261) valor = 'NULL';
    else if (c.tipo === 37 || c.tipo === 14)
      valor = `SUBSTRING('TREINO ${c.coluna.slice(0, 12)} ' || CAST(RDB$DB_KEY AS VARCHAR(16) CHARACTER SET OCTETS) FROM 1 FOR ${Math.max(1, c.tamanho)})`;
    else if (c.tipo === 12 || c.tipo === 35)
      valor = `DATEADD(1 - EXTRACT(DAY FROM ${c.coluna}) DAY TO ${c.coluna})`;
    else valor = '0';
    r.push(`UPDATE ${c.tabela} SET ${c.coluna} = ${valor} WHERE ${c.coluna} IS NOT NULL;`);
  }
  return r;
}

/** Leitura das colunas do banco de treino (metadado; o catálogo RDB$, sem dado). */
export const SQL_COLUNAS = `SET LIST ON;
SELECT TRIM(rf.RDB$RELATION_NAME) || '|' || TRIM(rf.RDB$FIELD_NAME) || '|' || f.RDB$FIELD_TYPE || '|' ||
       COALESCE(f.RDB$FIELD_SUB_TYPE, -1) || '|' || COALESCE(f.RDB$CHARACTER_LENGTH, f.RDB$FIELD_LENGTH) AS C
  FROM RDB$RELATION_FIELDS rf JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
  JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
 WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0 AND r.RDB$VIEW_BLR IS NULL;`;

export function lerColunasDaSaida(saida: string): ColunaBanco[] {
  return saida
    .split('\n')
    .map((l) => /^C\s+(\S+)\|(\S+)\|(\d+)\|(-?\d+)\|(\d+)/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({
      tabela: m[1]!,
      coluna: m[2]!,
      tipo: Number(m[3]),
      subtipoBlob: Number(m[4]) < 0 ? null : Number(m[4]),
      tamanho: Number(m[5]),
    }));
}

/** Executor de comandos no container (o Docker real ou o falso dos testes). */
export interface ExecutorTreino {
  executar(args: readonly string[], entrada?: string): { codigo: number; saida: string; erro: string };
}

export interface PassoTreino {
  readonly passo: string;
  readonly ms: number;
  readonly detalhe: string;
}

export interface PedidoReinicio {
  readonly container: string;
  readonly banco: string;
  readonly retrato: string;
  readonly ambiente: string | undefined;
  readonly metodo: string | undefined;
  readonly turma: readonly string[];
  readonly lista: ListaPessoais;
  readonly docker: ExecutorTreino;
  readonly agora?: () => number;
  /** Recria os usuários da turma pelo executor no banco próprio do cliente de treino (treino-turma.ts). */
  readonly recriarTurma: (logins: readonly string[]) => Promise<number>;
  /** Lê CPF e telefone do banco próprio de treino para o verificador `treino-sem-dado-real` e devolve os achados. */
  readonly verificar: () => Promise<number>;
}

function isql(docker: ExecutorTreino, container: string, banco: string, sql: string): string {
  const r = docker.executar(['exec', '-i', container, 'isql', '-q', '-ch', 'WIN1252', banco], sql);
  if (r.codigo !== 0) throw new ErroTreino(`isql no container de treino falhou (saída ${r.codigo}).`);
  return r.saida;
}

/** O mascaramento no banco de treino (copia:mascarar). */
export function mascarar(
  p: Pick<PedidoReinicio, 'container' | 'banco' | 'ambiente' | 'metodo' | 'lista' | 'docker'>,
): {
  colunas: number;
  comandos: number;
} {
  conferirDestinoTreino(p.container, p.ambiente);
  conferirMetodo(p.metodo);
  const colunas = lerColunasDaSaida(isql(p.docker, p.container, p.banco, SQL_COLUNAS));
  const plano = planoMascaramento(colunas, p.lista);
  if (plano.length > 0)
    isql(p.docker, p.container, p.banco, `SET AUTODDL OFF;\n${plano.join('\n')}\nCOMMIT;\n`);
  return { colunas: colunas.length, comandos: plano.length };
}

/**
 * O reinício semanal (treino:reiniciar): restaura o retrato estável (gbak), neutraliza as saídas, mascara, recria os
 * usuários da turma e roda o verificador; falha acima de 1 h ou com achado.
 */
export async function reiniciarTreino(p: PedidoReinicio): Promise<PassoTreino[]> {
  const agora = p.agora ?? Date.now;
  conferirDestinoTreino(p.container, p.ambiente);
  conferirMetodo(p.metodo);
  if (!/^\/[A-Za-z0-9_./-]+\.fbk$/.test(p.retrato) || p.retrato.includes('..'))
    throw new ErroTreino('Retrato estável inválido (caminho absoluto .fbk no container).');
  const existe = p.docker.executar(['exec', p.container, 'test', '-f', p.retrato]);
  if (existe.codigo !== 0)
    throw new ErroTreino('Bloqueado: o retrato estável do treino não existe no container.', true);
  const inicio = agora();
  const passos: PassoTreino[] = [];
  const medir = async (passo: string, fn: () => Promise<string> | string) => {
    const t0 = agora();
    const detalhe = await fn();
    passos.push({ passo, ms: agora() - t0, detalhe });
  };
  await medir('restaurar o retrato estável', () => {
    const r = p.docker.executar(['exec', p.container, 'gbak', '-rep', '-v', p.retrato, p.banco]);
    if (r.codigo !== 0) throw new ErroTreino(`gbak falhou (saída ${r.codigo}).`);
    return 'banco de treino substituído';
  });
  await medir('neutralizar as saídas', () => {
    isql(
      p.docker,
      p.container,
      p.banco,
      // As saídas do outro sistema e do novo ficam sem destino (e-mail, SMS, integrações) no banco de treino.
      "SET AUTODDL OFF;\nUPDATE SGH_INTG_PARCEIRO SET ATIVO = 'N';\nCOMMIT;\n",
    );
    return 'integrações do novo desligadas';
  });
  await medir('mascarar os dados pessoais', () => {
    const m = mascarar(p);
    return `${m.comandos} coluna(s) mascarada(s) de ${m.colunas}`;
  });
  await medir('recriar os usuários da turma', async () => `${await p.recriarTurma(p.turma)} usuário(s)`);
  await medir('verificar sem dado real', async () => {
    const n = await p.verificar();
    if (n > 0)
      throw new ErroTreino(`O verificador achou ${n} dado(s) real(is) no treino: o reinício falhou.`);
    return '0 achado';
  });
  const total = agora() - inicio;
  if (total > LIMITE_REINICIO_MS)
    throw new ErroTreino(`O reinício levou ${Math.round(total / 60_000)} min (meta: 60 min).`);
  return passos;
}

/** Os passos, sem executar nada (--plano). */
export const PASSOS_REINICIO = [
  'conferir o destino (container de treino do projeto, AMBIENTE=treino) e o método registrado pelo dono (DP-41)',
  'restaurar o retrato estável (gbak) no banco de treino',
  'neutralizar as saídas (integrações, e-mail, SMS)',
  'mascarar os dados pessoais (copia:mascarar), inclusive retratos e textos clínicos em BLOB',
  'recriar os usuários da turma pelo executor',
  'verificar sem dado real (treino-sem-dado-real) e medir o tempo (até 1 h)',
] as const;
