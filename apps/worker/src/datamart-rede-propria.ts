// Arquivo da Rede do data mart pela rotina do worker (01-ADM L115; F8): ao fim do ciclo do cliente em que alguma carga
// de estabelecimento concluiu, remonta o `rede.sqlite` (a união dos arquivos dos estabelecimentos ativos do cliente COM o
// BI da Rede liberado, `rede.bi`, lido no banco do cliente; recolher = desligar) e registra a remontagem como uma carga
// própria em carga_data_mart (estabelecimento nulo = a rede do cliente, assunto `data_mart_rede`), com uma etapa por
// tabela juntada. As cargas que se juntam passam por conferirCargasDaRede (esquema atual, mesmo modo de pseudônimo,
// mesma chave e mesmo ciclo); recusada a junção, o arquivo da Rede anterior é apagado (falha fechada: ele pode ter quem
// recolheu o BI) e a carga fica registrada como falha, com a mensagem sem valores. Sem nenhum liberado com arquivo, o
// arquivo da Rede também sai. Antes de publicar, o temporário passa pelo verificador de colunas identificadoras.
// Melhoria: a visão da Rede deixa de depender do comando manual; cada remontagem fica no registro, com as contagens.
import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHAVE_LIBERACAO_BI_REDE } from '@sgh/contratos';
import { fecharCarga, mensagemSemValores, type ObjetoCarregado } from '@sgh/dominio-relatorio';
import {
  avisosDasCargasDaRede,
  type CargaDoEstabelecimento,
  colunasIdentificadoras,
  conferirCargasDaRede,
  ddlDoDataMart,
  ESQUEMA_DATAMART,
  type ModoPseudonimo,
  TABELAS_FATO_DATAMART,
} from '@sgh/dominio-relatorio/datamart';
import { definirOperacao, type Executor } from '@sgh/nucleo';
import { z } from 'zod';
import { estabelecimentosAtivos, type NucleoWorker, recursoLigadoAqui } from './servico-worker.js';

/** O assunto da remontagem do arquivo da Rede em carga_data_mart (estabelecimento nulo). */
export const ASSUNTO_CARGA_DATAMART_REDE = 'data_mart_rede';

export interface ResultadoRede {
  readonly carga: number;
  readonly situacao: 'concluida' | 'falhou';
  readonly modo: ModoPseudonimo | null;
  /** Códigos dos estabelecimentos juntados no arquivo da Rede. */
  readonly estabelecimentos: readonly string[];
  /** Quantos estabelecimentos ativos ficaram fora (BI da Rede não liberado). */
  readonly foraDoBi: number;
  readonly avisos: readonly string[];
  readonly linhas: number;
}

/** Remonta o arquivo da Rede do cliente e registra a remontagem. */
export type RemontadorRede = (cliente: string, agora?: Date) => Promise<ResultadoRede>;

const ETAPA = z.object({
  sequencia: z.number().int().positive(),
  tipoObjeto: z.enum(['dimensao', 'fato']),
  objeto: z.string().regex(/^[a-z][a-z0-9_]{1,99}$/),
  linhas: z.number().int().nonnegative(),
  duracaoMs: z.number().int().nonnegative(),
  situacao: z.enum(['concluida', 'falhou']),
});

const REGISTRAR = z.object({
  inicio: z.date(),
  fim: z.date(),
  situacao: z.enum(['concluida', 'concluida_com_rejeicao', 'falhou']),
  linhasGravadas: z.number().int().nonnegative(),
  mensagemErro: z.string().max(1000).nullable(),
  etapas: z.array(ETAPA).max(50),
  estabelecimentos: z.number().int().nonnegative(),
  foraDoBi: z.number().int().nonnegative(),
  modo: z.string().max(30).nullable(),
});

const operacaoRegistrar = definirOperacao<z.infer<typeof REGISTRAR>, { carga: number }>({
  nome: 'relatorio.datamart.rede_registrar',
  tabelas: ['carga_data_mart', 'carga_data_mart_etapa'],
  entrada: REGISTRAR,
  gravar: async (tx, e) => {
    const fim = e.fim.getTime() < e.inicio.getTime() ? e.inicio : e.fim;
    const carga = await tx.incluir('carga_data_mart', {
      estabelecimento_id: null,
      assunto: ASSUNTO_CARGA_DATAMART_REDE,
      tipo_carga: 'completa',
      disparo: 'agendado',
      ocorrido_em: e.inicio,
      concluido_em: fim,
      situacao: e.situacao,
      linhas_lidas: e.linhasGravadas,
      linhas_gravadas: e.linhasGravadas,
      linhas_rejeitadas: 0,
      mensagem_erro: e.mensagemErro,
      dados: JSON.stringify({
        estabelecimentos: e.estabelecimentos,
        foraDoBi: e.foraDoBi,
        modo: e.modo,
        etapas: e.etapas.length,
      }),
    });
    let t = e.inicio.getTime();
    for (const x of e.etapas) {
      await tx.incluir('carga_data_mart_etapa', {
        carga_data_mart_id: carga,
        sequencia: x.sequencia,
        tipo_objeto: x.tipoObjeto,
        objeto_carga: x.objeto,
        iniciado_em: new Date(Math.min(t, fim.getTime())),
        concluido_em: new Date(Math.min(t + x.duracaoMs, fim.getTime())),
        duracao_ms: x.duracaoMs,
        linhas_gravadas: x.situacao === 'falhou' ? 0 : x.linhas,
        linhas_posteriores: x.situacao === 'falhou' ? null : x.linhas,
        situacao: x.situacao,
        mensagem_erro: x.situacao === 'falhou' ? e.mensagemErro : null,
      });
      t += x.duracaoMs;
    }
    return { carga };
  },
  alvo: (_e, r) => ({ tabela: 'carga_data_mart', id: r.carga }),
});

/** A linha `carga` do arquivo de um estabelecimento (o que conferirCargasDaRede confere). */
function lerCarga(arquivo: string): CargaDoEstabelecimento {
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const r = db.prepare('SELECT * FROM carga').get() as Record<string, unknown> | undefined;
    return {
      estabelecimento: String(r?.['estabelecimento'] ?? ''),
      versaoEsquema: Number(r?.['versao_esquema'] ?? 0),
      modoPseudonimo: String(r?.['modo_pseudonimo'] ?? ''),
      dadosAte: String(r?.['dados_ate'] ?? ''),
      carregadoEm: String(r?.['carregado_em'] ?? ''),
      chaveImpressao: String(r?.['chave_impressao'] ?? ''),
    };
  } finally {
    db.close();
  }
}

function conferirArquivo(db: DatabaseSync): string[] {
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  return colunasIdentificadoras(
    tabelas.map((t) => ({
      nome: t.name,
      colunas: Object.fromEntries(
        (db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map((c) => [
          c.name,
          'texto' as const,
        ]),
      ),
    })),
  );
}

interface Junta {
  readonly modo: ModoPseudonimo | null;
  readonly estabelecimentos: readonly string[];
  readonly avisos: readonly string[];
  readonly objetos: readonly ObjetoCarregado[];
}

/** Junta os arquivos dos liberados no arquivo da Rede (ou o apaga); lança na junção recusada, já sem o arquivo. */
function juntar(pasta: string, daRede: readonly string[], liberados: readonly string[]): Junta {
  const arquivo = resolve(pasta, 'rede.sqlite');
  const doEst = (cod: string) => resolve(pasta, `${cod}.sqlite`);
  const presentes = daRede.filter((cod) => liberados.includes(cod) && existsSync(doEst(cod)));
  if (presentes.length === 0) {
    rmSync(arquivo, { force: true });
    return { modo: null, estabelecimentos: [], avisos: [], objetos: [] };
  }
  const cargas = presentes.map((cod) => lerCarga(doEst(cod)));
  let modo: ModoPseudonimo;
  try {
    modo = conferirCargasDaRede(cargas, daRede);
  } catch (e) {
    rmSync(arquivo, { force: true });
    throw e;
  }
  const temporario = `${arquivo}.carregando`;
  rmSync(temporario, { force: true });
  const db = new DatabaseSync(temporario);
  const linhas = new Map<string, { linhas: number; ms: number }>();
  try {
    for (const c of ddlDoDataMart()) db.exec(c);
    presentes.forEach((cod, k) => {
      db.exec(`ATTACH DATABASE '${doEst(cod).replaceAll("'", "''")}' AS e${k}`);
      db.exec('BEGIN');
      for (const t of [...TABELAS_FATO_DATAMART, 'carga']) {
        const t1 = performance.now();
        const colunas = Object.keys(ESQUEMA_DATAMART.find((x) => x.nome === t)!.colunas).join(', ');
        const r = db.prepare(`INSERT INTO ${t} (${colunas}) SELECT ${colunas} FROM e${k}.${t}`).run();
        const ant = linhas.get(t) ?? { linhas: 0, ms: 0 };
        linhas.set(t, {
          linhas: ant.linhas + Number(r.changes),
          ms: ant.ms + Math.round(performance.now() - t1),
        });
      }
      db.exec('COMMIT');
      db.exec(`DETACH DATABASE e${k}`);
    });
    const ruins = conferirArquivo(db);
    if (ruins.length > 0)
      throw new Error(`arquivo da Rede do data mart com coluna identificadora: ${ruins.join(', ')}`);
  } catch (e) {
    db.close();
    rmSync(temporario, { force: true });
    rmSync(arquivo, { force: true });
    throw e;
  }
  db.close();
  rmSync(arquivo, { force: true });
  renameSync(temporario, arquivo);
  return {
    modo,
    estabelecimentos: presentes,
    avisos: avisosDasCargasDaRede(cargas),
    objetos: [...linhas].map(([objeto, c]) => ({ objeto, linhas: c.linhas, duracaoMs: c.ms })),
  };
}

/** O remontador real: estabelecimentos e liberação do BI da Rede lidos no banco do cliente, só para leitura. */
export function remontadorRedeProprio(
  nucleo: NucleoWorker,
  opcoes: { readonly pasta: string },
  executor: Executor = nucleo.criarExecutor(),
): RemontadorRede {
  return async (cliente: string, agora: Date = new Date()): Promise<ResultadoRede> => {
    const { daRede, liberados } = await nucleo.lerSomente(
      { cliente, estabelecimento: null, correlacao: 'datamart-rede' },
      async (l) => {
        const ests = await estabelecimentosAtivos(l, cliente, agora);
        const lib: string[] = [];
        for (const e of ests)
          if (await recursoLigadoAqui(l, CHAVE_LIBERACAO_BI_REDE, e.id, agora)) lib.push(e.codigo);
        return { daRede: ests.map((e) => e.codigo), liberados: lib };
      },
    );
    let junta: Junta = { modo: null, estabelecimentos: [], avisos: [], objetos: [] };
    let erro: unknown = null;
    try {
      junta = juntar(opcoes.pasta, daRede, liberados);
    } catch (e) {
      erro = e;
    }
    const f = fecharCarga(junta.objetos, erro);
    const foraDoBi = daRede.filter((c) => !liberados.includes(c)).length;
    const r = await executor.executar(
      operacaoRegistrar,
      cliente,
      {
        inicio: agora,
        fim: new Date(),
        situacao: f.situacao,
        linhasGravadas: f.linhasGravadas,
        mensagemErro: erro === null ? null : mensagemSemValores(erro),
        etapas: f.etapas.map((x) => ({ ...x })),
        estabelecimentos: junta.estabelecimentos.length,
        foraDoBi,
        modo: junta.modo,
      },
      {
        cliente,
        estabelecimento: null,
        usuario: null,
        correlacao: 'datamart-rede',
        chaveIdempotencia: `worker.datamart.rede.${randomUUID()}`,
      },
    );
    return {
      carga: r.resultado.carga,
      situacao: f.situacao === 'falhou' ? 'falhou' : 'concluida',
      modo: junta.modo,
      estabelecimentos: junta.estabelecimentos,
      foraDoBi,
      avisos: junta.avisos,
      linhas: f.linhasGravadas,
    };
  };
}
