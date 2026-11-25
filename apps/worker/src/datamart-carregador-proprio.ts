// Carregador real do data mart pseudonimizado no `worker` (01-ADM L115; F8): lê o banco próprio do cliente só para
// leitura, filtrado pelo estabelecimento, e grava o arquivo SQLite dele (`<DATA_MART_DIR>/<código>.sqlite`), que a
// ferramenta de BI abre só para leitura (docs/implantacao/ligacao-bi-data-mart.md). Devolve à rotina as contagens por
// tabela (ObjetoCarregado), que viram as etapas de carga_data_mart_etapa.
//   - movimento da internação: a mesma leitura do fechamento do censo (PortaCensoPropria.movimento), já em vocabulário
//     neutro e normalizada pelo motor da internação;
//   - demografia: faixa etária e sexo (nunca a data de nascimento nem o nome) e o convênio da internação;
//   - atendimentos, itens de conta e dispensações: só agregados por mês (nada por paciente);
//   - o pseudônimo do paciente é por estabelecimento (HMAC com a chave DATA_MART_CHAVE): o banco próprio não guarda a
//     pessoa da Rede (MPI), então o modo comum não se aplica aqui.
// Antes de publicar, o arquivo passa pelo verificador do esquema (nenhuma coluna identificadora); o temporário só
// substitui o arquivo depois disso. Log e mensagens só com contagens.
// Melhoria: a carga roda pela rotina do worker, com registro e etapas, em vez de comando manual.
import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  dataDoDia,
  diaDoCenso,
  idadeEm,
  mesDoDia,
  normalizarTrajetorias,
  relogioDeParede,
} from '@sgh/dominio-internacao';
import { type ObjetoCarregado } from '@sgh/dominio-relatorio';
import {
  colunasIdentificadoras,
  ddlDoDataMart,
  faixaEtaria,
  impressaoDaChave,
  pseudonimo,
  pseudonimoDoPaciente,
  sexoDoDataMart,
  VERSAO_ESQUEMA_DATAMART,
} from '@sgh/dominio-relatorio/datamart';
import type { Leitor } from '@sgh/nucleo';
import { PortaCensoPropria } from './censo-fechamento-propria.js';
import type { CarregadorDataMart } from './datamart-carga.service.js';
import type { AlvoEstabelecimento, NucleoWorker } from './servico-worker.js';

const n = (v: unknown) => Number(v ?? 0);
const textoOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Demografia por internação (id): faixa etária sai na carga; nascimento e nome nunca vão ao arquivo. */
const SQL_DEMOGRAFIA = `SELECT i.id, DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nascimento, sx.sigla AS sexo,
       fp.codigo AS convenio
  FROM internacao i
  JOIN paciente p ON p.id = i.paciente_id
  JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
  LEFT JOIN sexo sx ON sx.id = pf.sexo_id
  LEFT JOIN fonte_pagadora fp ON fp.id = i.fonte_pagadora_id
 WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL`;

/** Atendimentos por mês da entrada, categoria, convênio e especialidade (contagem). */
const SQL_ATENDIMENTOS = `SELECT DATE_FORMAT(a.entrada_em, '%Y-%m') AS mes, COALESCE(ca.codigo, 'nao-informado') AS tipo,
       fp.codigo AS convenio, em.codigo AS especialidade, COUNT(*) AS quantidade
  FROM atendimento a
  LEFT JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id
  LEFT JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
  LEFT JOIN especialidade_medica em ON em.id = a.especialidade_medica_id
 WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.entrada_em IS NOT NULL
 GROUP BY 1, 2, 3, 4
 ORDER BY 1, 2, 3, 4`;

/**
 * Itens de conta por mês do item, competência, tipo de conta, natureza e convênio; fora o estornado e o transferido
 * (o transferido conta na conta de destino) e a conta cancelada. "Baixado" é o item de conta paga.
 */
const SQL_ITENS = `SELECT DATE_FORMAT(it.realizado_em, '%Y-%m') AS mes_item, DATE_FORMAT(c.competencia, '%Y-%m') AS mes_competencia,
       tc.codigo AS tipo_conta, c.natureza, fp.codigo AS convenio, COUNT(*) AS itens,
       COALESCE(SUM(it.valor_total), 0) AS cobrado, COALESCE(SUM(it.valor_pago), 0) AS pago,
       COALESCE(SUM(CASE WHEN c.situacao = 'paga' THEN it.valor_total ELSE 0 END), 0) AS cobrado_baixado,
       COALESCE(SUM(CASE WHEN c.situacao = 'paga' THEN it.valor_pago ELSE 0 END), 0) AS pago_baixado
  FROM conta_hospitalar_item it
  JOIN conta_hospitalar c ON c.id = it.conta_hospitalar_id
  LEFT JOIN tipo_conta tc ON tc.id = c.tipo_conta_id
  LEFT JOIN fonte_pagadora fp ON fp.id = c.fonte_pagadora_id
 WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND it.excluido_em IS NULL
   AND c.situacao <> 'cancelada' AND it.situacao NOT IN ('estornado', 'transferido')
 GROUP BY 1, 2, 3, 4, 5
 ORDER BY 1, 2, 3, 4, 5`;

/** Dispensações por mês (registros e soma das quantidades líquidas da devolução), fora as canceladas. */
const SQL_DISPENSACOES = `SELECT DATE_FORMAT(d.dispensado_em, '%Y-%m') AS mes, COUNT(DISTINCT d.id) AS registros,
       COALESCE(SUM(di.quantidade - COALESCE(di.quantidade_devolvida, 0)), 0) AS quantidade
  FROM dispensacao d
  LEFT JOIN dispensacao_item di ON di.dispensacao_id = d.id AND di.excluido_em IS NULL AND di.situacao <> 'cancelado'
 WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'cancelada' AND d.dispensado_em IS NOT NULL
 GROUP BY 1
 ORDER BY 1`;

export interface OpcoesCarregador {
  /** Pasta dos arquivos do data mart (DATA_MART_DIR). */
  readonly pasta: string;
  /** Chave do pseudônimo (DATA_MART_CHAVE, do cofre fora de dev). */
  readonly chave: string | Buffer;
  /** Relógio (ms, UTC real); o padrão é agora. */
  readonly agora?: () => number;
}

/** A configuração do carregador pelo ambiente: fora de dev, sem DATA_MART_CHAVE a carga falha (registrada). */
export function opcoesDoAmbiente(env: NodeJS.ProcessEnv): OpcoesCarregador {
  const chave = env['DATA_MART_CHAVE']?.trim() ?? '';
  const dev = ['dev', 'ci'].includes((env['AMBIENTE'] ?? '').trim());
  if (!chave && !dev)
    throw new Error('DATA_MART_CHAVE ausente: fora de dev, a chave do pseudônimo vem do cofre');
  return {
    pasta: resolve(env['DATA_MART_DIR']?.trim() || '.tmp/data-mart'),
    // Em dev sem chave, uma aleatória por processo (os pseudônimos mudam a cada reinício).
    chave: chave || randomBytes(32),
  };
}

/** As colunas reais do arquivo que o verificador recusaria (identificadoras). */
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

/** O carregador real: lê o estabelecimento no banco próprio e publica o arquivo dele. */
export function carregadorProprio(nucleo: NucleoWorker, opcoes: OpcoesCarregador): CarregadorDataMart {
  return async (cliente: string, est: AlvoEstabelecimento): Promise<ObjetoCarregado[]> => {
    const ler = <T>(fn: (l: Leitor) => Promise<T>) =>
      nucleo.lerSomente({ cliente, estabelecimento: est.id, correlacao: 'datamart-carga' }, fn);
    const t0 = performance.now();
    const mov = await new PortaCensoPropria(nucleo, cliente).movimento(est);
    const [demografia, atendimentos, itens, dispensacoes] = await ler(async (l) => [
      await l.consultar(SQL_DEMOGRAFIA, [est.id], { teto: 2_000_000 }),
      await l.consultar(SQL_ATENDIMENTOS, [est.id], { teto: 500_000 }),
      await l.consultar(SQL_ITENS, [est.id], { teto: 500_000 }),
      await l.consultar(SQL_DISPENSACOES, [est.id], { teto: 10_000 }),
    ]);
    const msLeitura = Math.round(performance.now() - t0);
    const demo = new Map(demografia.map((r) => [n(r['id']), r]));
    const { chave } = opcoes;
    const agoraMs = opcoes.agora?.() ?? Date.now();
    const agora = relogioDeParede(agoraMs, est.fuso);
    const t = normalizarTrajetorias(mov, agora);
    const unidades = new Map(mov.unidades.map((u) => [`${u.bloco}\u0000${u.acomodacao}`, u.nome]));
    mkdirSync(opcoes.pasta, { recursive: true });
    const arquivo = resolve(opcoes.pasta, `${est.codigo}.sqlite`);
    const temporario = `${arquivo}.carregando`;
    rmSync(temporario, { force: true });
    const db = new DatabaseSync(temporario);
    const contagem: Record<string, { linhas: number; rejeitadas: number; ms: number }> = {};
    const medir = (objeto: string, fn: () => { linhas: number; rejeitadas?: number }) => {
      const t1 = performance.now();
      const r = fn();
      contagem[objeto] = {
        linhas: r.linhas,
        rejeitadas: r.rejeitadas ?? 0,
        ms: Math.round(performance.now() - t1),
      };
    };
    try {
      for (const c of ddlDoDataMart()) db.exec(c);
      db.exec('BEGIN');
      const insInt = db.prepare(
        'INSERT INTO fato_internacao VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const insDia = db.prepare('INSERT INTO fato_internacao_dia VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const diaAtual = diaDoCenso(agora, 24);
      let dias = 0;
      medir('fato_internacao', () => {
        for (const i of t.internacoes) {
          const d = demo.get(i.reg);
          const pac = pseudonimoDoPaciente(chave, 'por-estabelecimento', est.codigo, i.paciente, null);
          const int = pseudonimo(chave, `${est.codigo}:internacao`, i.reg);
          const nascimento = textoOuNulo(d?.['nascimento']);
          const faixa = faixaEtaria(
            idadeEm(
              nascimento === null ? null : new Date(`${nascimento}T00:00:00Z`),
              new Date(i.ini - (i.ini % 86_400_000)),
            ),
          );
          const sexo = sexoDoDataMart(textoOuNulo(d?.['sexo']));
          insInt.run(
            est.codigo,
            int,
            pac,
            mesDoDia(Math.floor(i.ini / 86_400_000)),
            i.fim === null ? null : mesDoDia(Math.floor(i.fim / 86_400_000)),
            i.urgencia ? 'urgencia' : 'eletiva',
            i.clinica,
            i.grupo,
            i.fim === null ? null : Math.round(((i.fim - i.ini) / 86_400_000) * 10) / 10,
            i.permanencia,
            i.obitoInstitucional ? 1 : 0,
            faixa,
            sexo,
            textoOuNulo(d?.['convenio']),
          );
          for (const tr of i.trechos) {
            const d0 = Math.max(diaDoCenso(tr.ini, 24), Math.floor(Date.UTC(2020, 0, 1) / 86_400_000));
            const d1 = Math.min(tr.fim === null ? diaAtual : diaDoCenso(tr.fim, 24) - 1, diaAtual);
            for (let dia = d0; dia <= d1; dia++) {
              insDia.run(
                est.codigo,
                dataDoDia(dia),
                mesDoDia(dia),
                unidades.get(tr.unidade) ?? tr.unidade.replace('\u0000', '/'),
                mov.tipos.get(tr.tipo) ?? String(tr.tipo),
                [3, 7, 8, 9, 17].includes(tr.tipo) ? 1 : 0,
                pac,
                int,
                i.clinica,
                faixa,
                sexo,
              );
              dias++;
            }
          }
        }
        return { linhas: t.internacoes.length };
      });
      contagem['fato_internacao_dia'] = { linhas: dias, rejeitadas: 0, ms: 0 };
      medir('fato_atendimento', () => {
        const ins = db.prepare('INSERT INTO fato_atendimento VALUES (?, ?, ?, ?, ?, ?)');
        for (const a of atendimentos)
          ins.run(
            est.codigo,
            textoOuNulo(a['mes']),
            textoOuNulo(a['tipo']),
            textoOuNulo(a['convenio']),
            textoOuNulo(a['especialidade']),
            n(a['quantidade']),
          );
        return { linhas: atendimentos.length };
      });
      medir('fato_item_conta', () => {
        const ins = db.prepare('INSERT INTO fato_item_conta VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const x of itens)
          ins.run(
            est.codigo,
            textoOuNulo(x['mes_item']),
            textoOuNulo(x['mes_competencia']),
            textoOuNulo(x['tipo_conta']),
            textoOuNulo(x['natureza']),
            textoOuNulo(x['convenio']),
            n(x['itens']),
            n(x['cobrado']),
            n(x['pago']),
            n(x['cobrado_baixado']),
            n(x['pago_baixado']),
          );
        return { linhas: itens.length };
      });
      medir('fato_dispensacao', () => {
        const ins = db.prepare('INSERT INTO fato_dispensacao VALUES (?, ?, ?, ?)');
        for (const x of dispensacoes)
          ins.run(est.codigo, textoOuNulo(x['mes']), n(x['registros']), n(x['quantidade']));
        return { linhas: dispensacoes.length };
      });
      medir('carga', () => {
        db.prepare('INSERT INTO carga VALUES (?, ?, ?, ?, ?, ?)').run(
          est.codigo,
          new Date(agoraMs).toISOString(),
          mov.dadosAte.toISOString().slice(0, 10),
          VERSAO_ESQUEMA_DATAMART,
          'por-estabelecimento',
          impressaoDaChave(chave),
        );
        return { linhas: 1 };
      });
      db.exec('COMMIT');
      const ruins = conferirArquivo(db);
      if (ruins.length > 0)
        throw new Error(`arquivo do data mart com coluna identificadora: ${ruins.join(', ')}`);
    } catch (e) {
      db.close();
      rmSync(temporario, { force: true });
      throw e;
    }
    db.close();
    rmSync(arquivo, { force: true });
    renameSync(temporario, arquivo);
    // A leitura do banco vai na etapa da internação (a maior); as demais levam a gravação delas.
    return Object.entries(contagem).map(([objeto, c]) => ({
      objeto,
      linhas: c.linhas,
      ...(c.rejeitadas > 0 ? { rejeitadas: c.rejeitadas } : {}),
      duracaoMs: objeto === 'fato_internacao' ? c.ms + msLeitura : c.ms,
    }));
  };
}
