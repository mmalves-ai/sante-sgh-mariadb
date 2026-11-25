// Contrato de efeito do carregador real do data mart sobre o MariaDB real (01-ADM L115; cliente f22_o5): a rotina lê o
// banco próprio só do estabelecimento carregado e publica o arquivo dele, com os agregados por mês (atendimentos por
// categoria, convênio e especialidade; itens de conta sem o estornado, com o baixado só da conta paga; dispensações),
// a linha da carga (versão do esquema, modo por estabelecimento, impressão da chave) e nenhuma coluna identificadora;
// o registro em carga_data_mart fica concluído com uma etapa por objeto e as linhas somadas. O outro estabelecimento
// não entra no arquivo. Massa sintética (f528p, f528q), apagada no fim com a trilha. SGH_NUCLEO_SEM_BANCO=1 pula.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  colunasIdentificadoras,
  impressaoDaChave,
  VERSAO_ESQUEMA_DATAMART,
} from '@sgh/dominio-relatorio/datamart';
import type { Escritor } from '@sgh/nucleo';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaDataMartPropria } from './datamart-carga-propria.js';
import { cicloDataMart } from './datamart-carga.service.js';
import { carregadorProprio } from './datamart-carregador-proprio.js';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  garantirUsuario,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import type { AlvoEstabelecimento } from './servico-worker.js';
import { limparTrilhaDaMassa } from './teste/limpar-trilha.spec-util.js';

const FUSO = 'America/Sao_Paulo';
const P = 'F528DM';
const CHAVE = 'chave-sintetica-do-data-mart-f528';
// 05:00 local: depois da hora da carga.
const AGORA = new Date('2026-11-25T08:00:00.000Z');

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('carregador real do data mart (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: AlvoEstabelecimento;
  let outro: AlvoEstabelecimento;
  let pasta: string;
  const ids: Record<string, number> = {};

  const ler = (sql: string, p: unknown[]) => escrever(nucleo, (e) => e.consultar(sql, p));

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      for (const id of [est?.id, outro?.id].filter(Boolean)) {
        await e.executar(
          'DELETE it FROM conta_hospitalar_item it JOIN conta_hospitalar c ON c.id = it.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
          [id],
        );
        await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [id]);
        await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [id]);
        await e.executar(
          'DELETE x FROM carga_data_mart_etapa x JOIN carga_data_mart c ON c.id = x.carga_data_mart_id WHERE c.estabelecimento_id = ?',
          [id],
        );
        await e.executar('DELETE FROM carga_data_mart WHERE estabelecimento_id = ?', [id]);
      }
      await e.executar(
        'DELETE p FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome = ?',
        [`PACIENTE SINTETICO ${P}`],
      );
      await e.executar(
        'DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome = ?)',
        [`PROFISSIONAL SINTETICO ${P}`],
      );
      await e.executar('DELETE FROM pessoa_fisica WHERE nome IN (?, ?)', [
        `PACIENTE SINTETICO ${P}`,
        `PROFISSIONAL SINTETICO ${P}`,
      ]);
      await limparTrilhaDaMassa(e, { codigos: ['f528p', 'f528q'] });
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    pasta = mkdtempSync(join(tmpdir(), 'datamart-f528-'));
    const a = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f528p'));
    const b = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f528q'));
    est = { cliente: CLIENTE, id: a, codigo: 'f528p', fuso: FUSO };
    outro = { cliente: CLIENTE, id: b, codigo: 'f528q', fuso: FUSO };
    await limpar();
    const quando = new Date('2026-10-15T13:00:00.000Z');
    await escrever(nucleo, async (e) => {
      ids.usuario = await garantirUsuario(e, 'f528dm-servico');
      const pessoa = (nome: string) =>
        e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [nome, quando]);
      const pac = await pessoa(`PACIENTE SINTETICO ${P}`);
      ids.paciente = await e.inserir(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pac, 528_901, quando],
      );
      ids.prof = await e.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [await pessoa(`PROFISSIONAL SINTETICO ${P}`), quando],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, 'OPERADORA SINTETICA F528', quando],
      );
      ids.categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'ambulatorio', ?)",
        [P, 'CATEGORIA SINTETICA F528', quando],
      );
      ids.carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['L9'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L9', ?, 'teste', ?)",
        ['CARATER SINTETICO F528', quando],
      );
      ids.tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'ambulatorial', ?)",
        [P, 'TIPO DE CONTA SINTETICO F528', quando],
      );
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [P],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, 'GRUPO SINTETICO F528', quando],
      );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        ['85280001'],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
        ['85280001', 'PROCEDIMENTO SINTETICO 85280001', grupo, quando],
      );
      const atendimento = (estab: number, numero: string) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
          [estab, numero, ids.paciente, ids.categoria, ids.carater, ids.fonte, ids.prof, quando, quando],
        );
      const conta = (estab: number, atend: number, numero: string, situacao: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, natureza, competencia, inicio_em, situacao, fechada_em, fechada_por_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', '2026-10-01', ?, ?, ?, ?, ?)`,
          [
            estab,
            numero,
            atend,
            ids.paciente,
            ids.fonte,
            ids.tipoConta,
            quando,
            situacao,
            quando,
            ids.usuario,
            quando,
          ],
        );
      const item = (c: number, seq: number, total: number, pago: number, situacao: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, valor_pago, situacao, criado_em)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [c, seq, ids.item, quando, total, total, pago, situacao, quando],
        );
      const a1 = await atendimento(est.id, `${P}-1`);
      const a2 = await atendimento(est.id, `${P}-2`);
      const paga = await conta(est.id, a1, `${P}-C1`, 'paga');
      await item(paga, 1, 100, 90, 'conferido');
      await item(paga, 2, 50, 50, 'conferido');
      await item(paga, 3, 999, 0, 'estornado');
      const fechada = await conta(est.id, a2, `${P}-C2`, 'fechada');
      await item(fechada, 1, 30, 0, 'lancado');
      // O outro estabelecimento: atendimento e conta que não podem entrar no arquivo do f528p.
      const b1 = await atendimento(outro.id, `${P}-3`);
      await item(await conta(outro.id, b1, `${P}-C3`, 'paga'), 1, 7000, 7000, 'conferido');
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  it('publica o arquivo do estabelecimento só com agregados dele e registra a carga concluída com as etapas', async () => {
    const carregador = carregadorProprio(nucleo, { pasta, chave: CHAVE, agora: () => AGORA.getTime() });
    const porta = new PortaDataMartPropria(nucleo, CLIENTE);
    const r = await cicloDataMart(porta, CLIENTE, est, carregador, AGORA, () => AGORA);
    expect(r).toMatchObject({ devida: true, situacao: 'concluida' });

    const db = new DatabaseSync(join(pasta, 'f528p.sqlite'), { readOnly: true });
    try {
      const at = db.prepare('SELECT * FROM fato_atendimento').all() as Record<string, unknown>[];
      expect(at).toEqual([
        {
          estabelecimento: 'f528p',
          mes: '2026-10',
          tipo_atendimento: P,
          convenio: `${P}FP`,
          especialidade: null,
          quantidade: 2,
        },
      ]);
      const it2 = db.prepare('SELECT * FROM fato_item_conta').all() as Record<string, unknown>[];
      expect(it2).toEqual([
        {
          estabelecimento: 'f528p',
          mes_item: '2026-10',
          mes_competencia: '2026-10',
          tipo_conta: P,
          natureza: 'ambulatorial',
          convenio: `${P}FP`,
          itens: 3,
          cobrado: 180,
          pago: 140,
          cobrado_baixado: 150,
          pago_baixado: 140,
        },
      ]);
      expect(db.prepare('SELECT COUNT(*) AS n FROM fato_internacao').get()).toEqual({ n: 0 });
      const carga = db.prepare('SELECT * FROM carga').get() as Record<string, unknown>;
      expect(carga['estabelecimento']).toBe('f528p');
      expect(carga['versao_esquema']).toBe(VERSAO_ESQUEMA_DATAMART);
      expect(carga['modo_pseudonimo']).toBe('por-estabelecimento');
      expect(carga['chave_impressao']).toBe(impressaoDaChave(CHAVE));
      expect(carga['carregado_em']).toBe(AGORA.toISOString());
      // Nenhuma coluna identificadora no arquivo publicado.
      const tabelas = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => ({
        nome: t.name,
        colunas: Object.fromEntries(
          (db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map((c) => [
            c.name,
            'texto' as const,
          ]),
        ),
      }));
      expect(colunasIdentificadoras(tabelas)).toEqual([]);
    } finally {
      db.close();
    }

    const [c] = await ler(
      'SELECT situacao, linhas_gravadas, mensagem_erro, concluido_em IS NOT NULL AS fechada FROM carga_data_mart WHERE id = ?',
      [r.carga],
    );
    expect(c!['situacao']).toBe('concluida');
    expect(c!['mensagem_erro']).toBeNull();
    expect(Number(c!['fechada'])).toBe(1);
    // fato_atendimento 1 + fato_item_conta 1 + carga 1 (internação, dia e dispensação vazias).
    expect(Number(c!['linhas_gravadas'])).toBe(3);
    const etapas = await ler(
      'SELECT objeto_carga, linhas_gravadas, situacao FROM carga_data_mart_etapa WHERE carga_data_mart_id = ? ORDER BY objeto_carga',
      [r.carga],
    );
    expect(etapas.map((x) => [x['objeto_carga'], Number(x['linhas_gravadas']), x['situacao']])).toEqual([
      ['carga', 1, 'concluida'],
      ['fato_atendimento', 1, 'concluida'],
      ['fato_dispensacao', 0, 'concluida'],
      ['fato_internacao', 0, 'concluida'],
      ['fato_internacao_dia', 0, 'concluida'],
      ['fato_item_conta', 1, 'concluida'],
    ]);
    // O outro estabelecimento não foi carregado nem registrado.
    expect(await ler('SELECT id FROM carga_data_mart WHERE estabelecimento_id = ?', [outro.id])).toHaveLength(
      0,
    );
  });
});
