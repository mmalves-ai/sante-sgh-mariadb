// Espécie do logradouro na comparação da carga de CEP (F3.1, 02-CAD linha 14) contra o MariaDB real, no cliente de teste
// f22_o1 (espécies do catálogo oficial carregadas): a leitura do banco devolve a espécie gravada no CEP e as
// equivalências (sigla e descrição → descrição); o CEP sintético sem espécie vira alteração com a descrição, que é o que
// a publicação grava pela descrição; gravada a espécie, a mesma sigla dá igual. A linha sintética sai no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { definicaoCatalogo } from '@sgh/contratos';
import { compararEdicao, chaveEquivalencia, type ItemValidado } from '@sgh/dominio-catalogo';
import { type Leitor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leituraPropria } from './leitura-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = 'f22_o1';
const CEP = '99999989';

describe.skipIf(SEM_BANCO)('espécie do logradouro na comparação da carga de CEP (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let especie: { id: number; sigla: string; descricao: string };
  const ler = <T>(fn: (l: Leitor) => Promise<T>) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1-025-especie-cep' }, fn);
  const escrever = (sql: string, p: readonly unknown[]) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1-025-especie-cep' }, (e) => e.executar(sql, p));
  const item = (tipo: string): ItemValidado => ({
    entidade: 'cep',
    linha: 1,
    chave: `cep=${CEP}`,
    campos: { cep: CEP, uf: 'MG', cidade: 'X', logradouro: 'DAS ACACIAS SINTETICAS', tipoLogradouro: tipo },
    resultado: 'valida',
    motivos: [],
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever('DELETE FROM logradouro_cep WHERE codigo_cep = ?', [CEP]);
    // Uma espécie de sigla e descrição únicas no catálogo (a publicação só grava quando casa com uma só).
    const x = await ler((l) =>
      l.uma(
        `SELECT e.id, e.sigla, e.descricao FROM especie_logradouro e
          WHERE e.ativo = TRUE AND e.sigla IS NOT NULL AND e.sigla <> e.descricao
            AND (SELECT COUNT(*) FROM especie_logradouro o WHERE o.ativo = TRUE
                  AND (o.sigla IN (e.sigla, e.descricao) OR o.descricao IN (e.sigla, e.descricao))) = 1
          ORDER BY e.id LIMIT 1`,
      ),
    );
    expect(x).not.toBeNull();
    especie = { id: Number(x!['id']), sigla: String(x!['sigla']), descricao: String(x!['descricao']) };
    await escrever(
      `INSERT INTO logradouro_cep (codigo_cep, logradouro, municipio_ibge_id, unidade_federativa_id, ativo, criado_em)
       SELECT ?, 'DAS ACACIAS SINTETICAS', m.id, m.unidade_federativa_id, TRUE, NOW(3)
         FROM municipio_ibge m JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
        WHERE u.sigla = 'MG' AND m.ativo ORDER BY m.id LIMIT 1`,
      [CEP],
    );
  }, 120_000);

  afterAll(async () => {
    await escrever('DELETE FROM logradouro_cep WHERE codigo_cep = ?', [CEP]).catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('CEP sem espécie: a leitura devolve nulo e a sigla do arquivo vira alteração com a descrição', async () => {
    const banco = leituraPropria('cep', ler);
    const atuais = await banco.atuais('cep', [`cep=${CEP}`]);
    const lido = atuais.get(`cep=${CEP}`);
    expect(lido).toBeDefined();
    expect(lido!['tipoLogradouro']).toBeNull();
    const eq = await banco.equivalencias!('cep');
    const mapa = eq.get('tipoLogradouro')!;
    expect(mapa.get(chaveEquivalencia(especie.sigla))).toBe(especie.descricao);
    expect(mapa.get(chaveEquivalencia(especie.descricao))).toBe(especie.descricao);
    const r = compararEdicao(definicaoCatalogo('cep')!, [item(especie.sigla)], new Map([['cep', atuais]]), {
      equivalencias: new Map([['cep', eq]]),
    }).itens[0]!;
    expect(r.comparacao).not.toBe('igual');
    expect(r.depois).toMatchObject({ tipoLogradouro: especie.descricao });
  });

  it('CEP com a espécie gravada: sigla e descrição dão igual na espécie; tipo fora do catálogo não acusa diferença', async () => {
    await escrever('UPDATE logradouro_cep SET especie_logradouro_id = ? WHERE codigo_cep = ?', [
      especie.id,
      CEP,
    ]);
    const banco = leituraPropria('cep', ler);
    const atuais = await banco.atuais('cep', [`cep=${CEP}`]);
    expect(atuais.get(`cep=${CEP}`)!['tipoLogradouro']).toBe(especie.descricao);
    const eq = await banco.equivalencias!('cep');
    for (const tipo of [especie.sigla, especie.descricao.toLowerCase(), 'TIPO FORA DO CATALOGO C1025']) {
      const r = compararEdicao(definicaoCatalogo('cep')!, [item(tipo)], new Map([['cep', atuais]]), {
        equivalencias: new Map([['cep', eq]]),
      }).itens[0]!;
      expect(r.depois?.['tipoLogradouro']).toBeUndefined();
    }
  });
});
