// Porta própria do índice de busca por nome do cadastro e da fila de duplicidades (ficha do M11, seção 4 e regra 6;
// lote F2.2 05-15) sobre o banco do cliente, pelo @sgh/nucleo. Leitura (somente leitura): os cadastros que nasceram ou
// mudaram depois da marca (paciente com pessoa_fisica, profissional com pessoa_fisica, solicitante_externo), em ordem
// de mudança e id; a contagem índice × cadastro; os cadastros sem índice e os índices órfãos. Gravação: as palavras e
// as chaves fonéticas (chave_busca_nome) e os pares suspeitos (suspeita_duplicidade), cada lote numa operação do
// Executor (trilha na mesma transação), no contexto do estabelecimento sede (o cadastro é do cliente inteiro).
// Melhoria: o índice é derivado do cadastro próprio pela mesma regra de palavras e fonética da busca (contratos), e o
// cadastro excluído sai do índice; a conferência por contagem também repara (indexa o que falta e tira os órfãos).
// Melhoria: o candidato a duplicidade é o cadastro com a mesma chave fonética da primeira e da última palavra do nome
// (o índice; alcança o nome digitado diferente, que o agrupamento por nome igual da API não pega), e o par vai à fila
// pela mesma regra pura do escore da API (escoreDuplicidade, com o telefone fixo e o celular de telefone_pessoa), sem
// repetir par já registrado (chave única do par). Por CPF não há candidato: o CPF é único por pessoa no modelo
// (uq_pessoa_fisica_cpf) e o paciente é único por pessoa (uq_paciente_pessoa_fisica).
// Melhoria: a leitura incremental filtra por colunas indexáveis (criado_em e alterado_em do cadastro e da pessoa, cada
// uma numa faixa própria, unidas) e só então calcula a mudança e ordena o lote, em vez de varrer as tabelas inteiras.
// Pendência registrada (saida/05-15.json): a marca da leitura incremental fica em memória do processo (não há tabela
// de marca de processamento no modelo); ao reiniciar, recomeça uma hora antes do último índice gravado. Os índices
// das colunas de mudança estão no modelo (db/migracoes/03_CAD/30_tabelas.sql, onda 5d).
import { randomUUID } from 'node:crypto';
import {
  type CadastroComparavel,
  chaveFonetica,
  chavesDoNome,
  palavrasDoCadastro,
} from '@sgh/dominio-cadastro';
import { definirOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';
import { idDaSede } from './clientes-worker.js';
import { conflitoConcorrente, type NucleoWorker } from './servico-worker.js';

export type EntidadeBusca = 'paciente' | 'profissional' | 'solicitante';
export const ENTIDADES_BUSCA: readonly EntidadeBusca[] = ['paciente', 'profissional', 'solicitante'];

export interface CadastroLido {
  readonly id: number;
  readonly nome: string | null;
  readonly social: string | null;
  readonly mae: string | null;
  /** O cadastro foi excluído (sai do índice). */
  readonly excluido: boolean;
  /** Instante ISO da última mudança (a marca da leitura incremental). */
  readonly mudouEm: string;
}

export interface MarcaIndice {
  readonly em: string | null;
  readonly id: number;
}

export type AvaliarPar = (
  a: CadastroComparavel,
  b: CadastroComparavel,
) => { readonly escore: number; readonly criterios: readonly string[] } | null;

export interface PortaIndiceBusca {
  /** Uma hora antes do último índice gravado da entidade (null: índice vazio, lê desde o começo). */
  marcaInicial(entidade: EntidadeBusca): Promise<string | null>;
  mudados(entidade: EntidadeBusca, desde: MarcaIndice, teto: number): Promise<CadastroLido[]>;
  lerCadastros(entidade: EntidadeBusca, ids: readonly number[]): Promise<CadastroLido[]>;
  /** Regrava o índice dos cadastros (o excluído só sai); devolve as palavras gravadas. */
  indexar(entidade: EntidadeBusca, cadastros: readonly CadastroLido[]): Promise<number>;
  contagem(entidade: EntidadeBusca): Promise<{ readonly indice: number; readonly cadastro: number }>;
  /** Indexa os cadastros sem índice e tira os índices órfãos; devolve os cadastros reparados. */
  reparar(entidade: EntidadeBusca, teto: number): Promise<number>;
  /** Os pares novos na fila de duplicidades. */
  alimentarFila(pacientes: readonly number[], avaliar: AvaliarPar): Promise<number>;
}

interface Fonte {
  readonly tabela: string;
  readonly id: string;
  readonly mudou: string;
  readonly excluido: string;
  readonly de: string;
  readonly campos: string;
  /** As faixas indexáveis da leitura incremental (cada uma `coluna >= ?`; uma linha mudada cai em ao menos uma). */
  readonly faixas: readonly string[];
}

const MUDOU_PF = (x: string) =>
  `GREATEST(COALESCE(${x}.alterado_em, ${x}.criado_em), COALESCE(pf.alterado_em, pf.criado_em))`;
/** Lista branca das fontes por entidade (nomes literais, nunca da entrada). */
const FONTES: Readonly<Record<EntidadeBusca, Fonte>> = {
  paciente: {
    tabela: 'paciente',
    id: 'x.id',
    mudou: MUDOU_PF('x'),
    excluido: 'x.excluido_em',
    de: 'paciente x JOIN pessoa_fisica pf ON pf.id = x.pessoa_fisica_id',
    campos:
      'pf.nome, COALESCE(x.nome_social, pf.nome_social) AS social, COALESCE(x.nome_mae, pf.nome_mae) AS mae',
    faixas: ['x.criado_em', 'x.alterado_em', 'pf.criado_em', 'pf.alterado_em'],
  },
  profissional: {
    tabela: 'profissional',
    id: 'x.id',
    mudou: MUDOU_PF('x'),
    excluido: 'x.excluido_em',
    de: 'profissional x JOIN pessoa_fisica pf ON pf.id = x.pessoa_fisica_id',
    campos: 'pf.nome, pf.nome_social AS social, NULL AS mae',
    faixas: ['x.criado_em', 'x.alterado_em', 'pf.criado_em', 'pf.alterado_em'],
  },
  solicitante: {
    tabela: 'solicitante_externo',
    id: 'x.id',
    mudou: 'COALESCE(x.alterado_em, x.criado_em)',
    excluido: 'x.excluido_em',
    de: 'solicitante_externo x',
    campos: 'x.nome, NULL AS social, NULL AS mae',
    faixas: ['x.criado_em', 'x.alterado_em'],
  },
};

const selecao = (f: Fonte) =>
  `SELECT ${f.id} AS id, ${f.campos}, ${f.excluido} AS excluido_em, ${f.mudou} AS mudou FROM ${f.de}`;
const n = (v: unknown) => Number(v ?? 0);
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const em = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const INICIO = new Date('2000-01-01T00:00:00.000Z');
const CRITERIOS = ['cpf', 'fonetica', 'nascimento', 'mae', 'telefone'] as const;
/** Os tipos de telefone que entram no escore (códigos do cadastro, os mesmos da API). */
const TIPOS_TELEFONE_ESCORE = ['fixo', 'celular'] as const;

function lido(r: Record<string, unknown>): CadastroLido {
  return {
    id: n(r['id']),
    nome: tn(r['nome']),
    social: tn(r['social']),
    mae: tn(r['mae']),
    excluido: r['excluido_em'] !== null && r['excluido_em'] !== undefined,
    mudouEm: iso(r['mudou']),
  };
}

/** As palavras e as chaves fonéticas de um cadastro (regra única da busca). */
export function palavrasDoIndice(
  c: CadastroLido,
): { campo: 'nome' | 'social' | 'mae'; palavra: string; fonetica: string }[] {
  if (c.excluido) return [];
  const r: { campo: 'nome' | 'social' | 'mae'; palavra: string; fonetica: string }[] = [];
  for (const [campo, valor] of [
    ['nome', c.nome],
    ['social', c.social],
    ['mae', c.mae],
  ] as const) {
    const vistas = new Set<string>();
    for (const p of palavrasDoCadastro(valor)) {
      const palavra = p.slice(0, 40);
      if (!palavra || vistas.has(palavra)) continue;
      vistas.add(palavra);
      r.push({ campo, palavra, fonetica: chaveFonetica(palavra).slice(0, 40) });
    }
  }
  return r;
}

const ENTRADA_INDICE = z.object({
  estabelecimento: z.number().int().positive(),
  entidade: z.enum(['paciente', 'profissional', 'solicitante']),
  ids: z.array(z.number().int().positive()).min(1).max(2000),
  palavras: z.array(
    z.object({
      id: z.number().int().positive(),
      campo: z.enum(['nome', 'social', 'mae']),
      palavra: z.string().min(1).max(40),
      fonetica: z.string().max(40),
    }),
  ),
});

const ENTRADA_FILA = z.object({
  estabelecimento: z.number().int().positive(),
  pares: z
    .array(
      z.object({
        a: z.number().int().positive(),
        b: z.number().int().positive(),
        escore: z.number().int().min(0).max(100),
        criterios: z.array(z.string()),
      }),
    )
    .min(1),
});

export class PortaIndiceBuscaPropria implements PortaIndiceBusca {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    // Dado do cliente inteiro: o cadastro de pessoas e o índice não têm estabelecimento.
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: null, correlacao: 'indice-busca' },
      fn,
    );
  }

  private async sede(): Promise<number> {
    const s = await this.ler(idDaSede);
    if (s === null)
      throw recusa('cliente-sem-estabelecimento', 'O cliente não tem estabelecimento cadastrado.');
    return s;
  }

  async marcaInicial(entidade: EntidadeBusca): Promise<string | null> {
    const r = await this.ler((l) =>
      l.uma('SELECT MAX(COALESCE(alterado_em, criado_em)) AS m FROM chave_busca_nome WHERE entidade = ?', [
        entidade,
      ]),
    );
    const m = r?.['m'];
    return m === null || m === undefined
      ? null
      : new Date(new Date(iso(m)).getTime() - 3_600_000).toISOString();
  }

  mudados(entidade: EntidadeBusca, desde: MarcaIndice, teto: number): Promise<CadastroLido[]> {
    const f = FONTES[entidade];
    const marca = desde.em ? new Date(desde.em) : INICIO;
    const t = Math.max(1, Math.min(2000, Math.trunc(teto)));
    return this.ler(async (l) =>
      // Cada faixa usa o índice da sua coluna (o mudou de uma linha é uma dessas colunas: se ele passou da marca,
      // a coluna também passou); a união tira as repetidas e só o resultado é filtrado pela marca e ordenado.
      (
        await l.consultar(
          `SELECT m.* FROM (${f.faixas.map((c) => `${selecao(f)} WHERE ${c} >= ?`).join(' UNION ')}) m
            WHERE m.mudou > ? OR (m.mudou = ? AND m.id > ?) ORDER BY m.mudou, m.id LIMIT ${t}`,
          [...f.faixas.map(() => marca), marca, marca, desde.id],
          { teto: t },
        )
      ).map(lido),
    );
  }

  lerCadastros(entidade: EntidadeBusca, ids: readonly number[]): Promise<CadastroLido[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const f = FONTES[entidade];
    return this.ler(async (l) => {
      const r: CadastroLido[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const parte = ids.slice(i, i + 500);
        r.push(
          ...(
            await l.consultar(`${selecao(f)} WHERE ${f.id} IN (${em(parte.length)})`, parte, { teto: 500 })
          ).map(lido),
        );
      }
      return r;
    });
  }

  async indexar(entidade: EntidadeBusca, cadastros: readonly CadastroLido[]): Promise<number> {
    if (cadastros.length === 0) return 0;
    const estabelecimento = await this.sede();
    const op = definirOperacao<z.infer<typeof ENTRADA_INDICE>, { palavras: number }>({
      nome: 'cadastro.indexar_busca',
      tabelas: ['chave_busca_nome'],
      entrada: ENTRADA_INDICE,
      gravar: async (tx, e) => {
        await tx.executar(
          `DELETE FROM chave_busca_nome WHERE entidade = ? AND registro_id IN (${em(e.ids.length)})`,
          [e.entidade, ...e.ids],
        );
        const agora = new Date();
        for (let i = 0; i < e.palavras.length; i += 500) {
          const parte = e.palavras.slice(i, i + 500);
          await tx.executar(
            `INSERT INTO chave_busca_nome (entidade, registro_id, campo, palavra, fonetica, criado_em, versao) VALUES ${parte
              .map(() => '(?, ?, ?, ?, ?, ?, 1)')
              .join(', ')}`,
            parte.flatMap((p) => [e.entidade, p.id, p.campo, p.palavra, p.fonetica, agora]),
          );
        }
        return { palavras: e.palavras.length };
      },
      alvo: () => ({ tabela: 'chave_busca_nome', id: null }),
    });
    let total = 0;
    for (let i = 0; i < cadastros.length; i += 500) {
      const parte = cadastros.slice(i, i + 500);
      const r = await this.executor.executar(
        op,
        this.cliente,
        {
          estabelecimento,
          entidade,
          ids: parte.map((c) => c.id),
          palavras: parte.flatMap((c) => palavrasDoIndice(c).map((p) => ({ id: c.id, ...p }))),
        },
        {
          cliente: this.cliente,
          estabelecimento,
          usuario: null,
          correlacao: `indice-busca-${entidade}`,
          chaveIdempotencia: `worker.indice.${entidade}.${randomUUID()}`,
        },
      );
      total += r.resultado.palavras;
    }
    return total;
  }

  contagem(entidade: EntidadeBusca): Promise<{ readonly indice: number; readonly cadastro: number }> {
    const f = FONTES[entidade];
    return this.ler(async (l) => ({
      indice: n(
        (
          await l.uma('SELECT COUNT(DISTINCT registro_id) AS n FROM chave_busca_nome WHERE entidade = ?', [
            entidade,
          ])
        )?.['n'],
      ),
      cadastro: n(
        (await l.uma(`SELECT COUNT(*) AS n FROM ${f.tabela} WHERE excluido_em IS NULL`, []))?.['n'],
      ),
    }));
  }

  async reparar(entidade: EntidadeBusca, teto: number): Promise<number> {
    const f = FONTES[entidade];
    const t = Math.max(1, Math.min(2000, Math.trunc(teto)));
    const { faltam, orfaos } = await this.ler(async (l) => ({
      faltam: (
        await l.consultar(
          `${selecao(f)} WHERE ${f.excluido} IS NULL
             AND NOT EXISTS (SELECT 1 FROM chave_busca_nome c WHERE c.entidade = ? AND c.registro_id = ${f.id})
           ORDER BY id LIMIT ${t}`,
          [entidade],
          { teto: t },
        )
      ).map(lido),
      orfaos: (
        await l.consultar(
          `SELECT DISTINCT c.registro_id FROM chave_busca_nome c LEFT JOIN ${f.tabela} x ON x.id = c.registro_id
            WHERE c.entidade = ? AND (x.id IS NULL OR x.excluido_em IS NOT NULL) LIMIT ${t}`,
          [entidade],
          { teto: t },
        )
      ).map((r) => n(r['registro_id'])),
    }));
    const removidos: CadastroLido[] = orfaos.map((id) => ({
      id,
      nome: null,
      social: null,
      mae: null,
      excluido: true,
      mudouEm: new Date().toISOString(),
    }));
    await this.indexar(entidade, [...faltam, ...removidos]);
    return faltam.length + removidos.length;
  }

  async alimentarFila(pacientes: readonly number[], avaliar: AvaliarPar): Promise<number> {
    if (pacientes.length === 0) return 0;
    const pares = await this.ler(async (l) => {
      const comparaveis = async (ids: readonly number[]): Promise<Map<number, CadastroComparavel>> => {
        const m = new Map<number, CadastroComparavel>();
        for (let i = 0; i < ids.length; i += 500) {
          const parte = ids.slice(i, i + 500);
          // O telefone fixo e o celular da pessoa (os mesmos da regra da API; o de recado é de outra pessoa).
          const telefones = new Map<number, string[]>();
          for (const t of await l.consultar(
            `SELECT t.pessoa_fisica_id, CONCAT(COALESCE(t.ddd, ''), t.numero) AS telefone
               FROM paciente p JOIN telefone_pessoa t ON t.pessoa_fisica_id = p.pessoa_fisica_id
               JOIN tipo_telefone tt ON tt.id = t.tipo_telefone_id
              WHERE p.id IN (${em(parte.length)}) AND t.excluido_em IS NULL AND tt.codigo IN (?, ?)
              ORDER BY t.principal DESC, t.sequencia`,
            [...parte, ...TIPOS_TELEFONE_ESCORE],
            { teto: 5000 },
          ))
            telefones.set(n(t['pessoa_fisica_id']), [
              ...(telefones.get(n(t['pessoa_fisica_id'])) ?? []),
              String(t['telefone']),
            ]);
          for (const r of await l.consultar(
            `SELECT p.id, p.pessoa_fisica_id, pf.nome, pf.data_nascimento, COALESCE(p.nome_mae, pf.nome_mae) AS mae, pf.cpf
               FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
              WHERE p.id IN (${em(parte.length)}) AND p.excluido_em IS NULL AND p.situacao <> 'unificado'`,
            parte,
            { teto: 500 },
          ))
            m.set(n(r['id']), {
              id: n(r['id']),
              nome: tn(r['nome']),
              nascimento:
                r['data_nascimento'] instanceof Date
                  ? r['data_nascimento'].toISOString().slice(0, 10)
                  : (tn(r['data_nascimento'])?.slice(0, 10) ?? null),
              mae: tn(r['mae']),
              cpf: tn(r['cpf']),
              telefones: telefones.get(n(r['pessoa_fisica_id'])) ?? [],
            } as CadastroComparavel);
        }
        return m;
      };
      const base = await comparaveis(pacientes);
      const candidatos = new Map<number, number[]>();
      for (const c of base.values()) {
        const chaves = chavesDoNome(c.nome);
        if (chaves.length === 0) continue;
        const ids = (
          await l.consultar(
            `SELECT DISTINCT a.registro_id FROM chave_busca_nome a
               JOIN chave_busca_nome b ON b.entidade = a.entidade AND b.registro_id = a.registro_id AND b.campo = 'nome'
                AND b.fonetica = ?
              WHERE a.entidade = 'paciente' AND a.campo = 'nome' AND a.fonetica = ? AND a.registro_id <> ?
              LIMIT 100`,
            [chaves.at(-1), chaves[0], c.id],
            { teto: 100 },
          )
        ).map((r) => n(r['registro_id']));
        candidatos.set(c.id, ids);
      }
      const outros = await comparaveis(
        [...new Set([...candidatos.values()].flat())].filter((id) => !base.has(id)),
      );
      const todos = new Map([...outros, ...base]);
      const vistos = new Set<string>();
      const r: { a: number; b: number; escore: number; criterios: string[] }[] = [];
      for (const [id, ids] of candidatos) {
        for (const outro of ids) {
          const x = todos.get(id);
          const y = todos.get(outro);
          if (!x || !y) continue;
          const [a, b] = id < outro ? [id, outro] : [outro, id];
          if (vistos.has(`${a}:${b}`)) continue;
          vistos.add(`${a}:${b}`);
          const e = avaliar(x, y);
          if (e)
            r.push({
              a,
              b,
              escore: Math.max(0, Math.min(100, Math.round(e.escore))),
              criterios: [...e.criterios],
            });
        }
      }
      return r;
    });
    if (pares.length === 0) return 0;
    const estabelecimento = await this.sede();
    const op = definirOperacao<z.infer<typeof ENTRADA_FILA>, { novos: number }>({
      nome: 'cadastro.registrar_suspeita_duplicidade',
      tabelas: ['suspeita_duplicidade'],
      entrada: ENTRADA_FILA,
      gravar: async (tx, e) => {
        let novos = 0;
        const agora = new Date();
        for (const p of e.pares) {
          const ja = await tx.uma(
            'SELECT id FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ?',
            [p.a, p.b],
          );
          if (ja) continue;
          await tx.incluir('suspeita_duplicidade', {
            primeiro_paciente_id: p.a,
            segundo_paciente_id: p.b,
            escore: p.escore,
            ...Object.fromEntries(CRITERIOS.map((c) => [`criterio_${c}`, p.criterios.includes(c)])),
            detectado_em: agora,
            situacao: 'aberto',
            origem: 'sistema',
          });
          novos++;
        }
        return { novos };
      },
      alvo: () => ({ tabela: 'suspeita_duplicidade', id: null }),
    });
    try {
      const r = await this.executor.executar(
        op,
        this.cliente,
        { estabelecimento, pares },
        {
          cliente: this.cliente,
          estabelecimento,
          usuario: null,
          correlacao: 'indice-busca-fila',
          chaveIdempotencia: `worker.duplicidade.${randomUUID()}`,
        },
      );
      return r.resultado.novos;
    } catch (x) {
      // Outro consumidor registrou o mesmo par ao mesmo tempo: o próximo ciclo confere de novo.
      if (conflitoConcorrente(x)) return 0;
      throw x;
    }
  }
}
