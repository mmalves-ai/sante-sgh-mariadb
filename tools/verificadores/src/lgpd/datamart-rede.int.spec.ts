// Integração do data mart da Rede nas DUAS cópias (M57, etapa 3; regra 9; ficha, seção 4 "BI consolidado: data mart
// com as duas cópias diárias"): a carga READ ONLY de cada banco (a cópia 3351 como `pc` e a 3352 como o
// estabelecimento sintético `sx`), o modo do pseudônimo lido na liberação de cada banco (sem a DP-42: por
// estabelecimento), o arquivo da Rede com a dimensão estabelecimento e sem coluna identificadora, e o mesmo paciente
// (as cópias são o mesmo banco) com pseudônimos DIFERENTES nos dois estabelecimentos. Os arquivos ficam numa pasta
// descartável dentro do repositório (.tmp), apagada no fim. Só contagens no console.
// Rodar: flock …/copia.lock flock …/copia2/copia.lock env FB_PC_PORTA=3351 SGH_INT_REDE_PORTA2=3352 ./pnpm exec vitest
//        run --config tools/verificadores/vitest.integracao.config.ts src/lgpd
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { colunasIdentificadoras, modoDoPseudonimo } from '@sgh/dominio-relatorio/datamart';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  arquivoDaRede,
  biRedeLiberado,
  carregarEstabelecimento,
  consolidarRede,
  pseudonimoComumLiberado,
} from '../datamart-carga.ts';

const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const PORTA2 = Number(process.env['SGH_INT_REDE_PORTA2'] ?? '');
const SEGUNDO = 'sx';
const DUAS =
  (env['AMBIENTE'] ?? '').trim() === 'dev' &&
  lerCodigos(env).includes('pc') &&
  Number.isInteger(PORTA2) &&
  PORTA2 > 0 &&
  PORTA2 !== Number(env['FB_PC_PORTA']) &&
  travaDaCopiaSegura(process.pid);
const seguro = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

describe.skipIf(!DUAS)('data mart da Rede nas duas cópias (READ ONLY)', () => {
  let nucleo: NucleoLegado;
  const pasta = resolve(raiz, `.tmp/int-datamart-rede-${process.pid}`);
  beforeAll(async () => {
    const doSegundo: Record<string, string> = {};
    for (const [k, v] of Object.entries(env))
      if (k.startsWith('FB_PC_') && v !== undefined)
        doSegundo[`FB_${SEGUNDO.toUpperCase()}_${k.slice(6)}`] = v;
    doSegundo[`FB_${SEGUNDO.toUpperCase()}_PORTA`] = String(PORTA2);
    const e = { ...env, ...doSegundo, ESTABELECIMENTOS: `pc,${SEGUNDO}`, FB_POOL_TETO: '3' };
    nucleo = new NucleoLegado({
      env: e,
      driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(e).bibliotecaCliente }),
      pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
      aviso: () => undefined,
    });
    await nucleo.verificarSchema('pc');
    mkdirSync(pasta, { recursive: true });
  });
  afterAll(async () => {
    rmSync(pasta, { recursive: true, force: true });
    await nucleo?.encerrar();
  });

  it('carga dos dois bancos, arquivo da Rede sem dado pessoal, pseudônimo por estabelecimento', async () => {
    const liberado = await pseudonimoComumLiberado(nucleo, ['pc', SEGUNDO]);
    const modo = modoDoPseudonimo(liberado);
    // A DP-42 não está registrada nas cópias: o pseudônimo é por estabelecimento.
    expect(modo).toBe('por-estabelecimento');
    const chave = randomBytes(32);
    const resumos = [];
    for (const h of ['pc', SEGUNDO])
      resumos.push(await carregarEstabelecimento(nucleo, { hospital: h, chave, modo, pasta }));
    const [a, b] = resumos as [(typeof resumos)[0], (typeof resumos)[0]];
    // As cópias são o mesmo banco: as mesmas contagens nos dois.
    expect(b.internacoes).toBe(a.internacoes);
    expect(b.pacientesDia).toBe(a.pacientesDia);
    expect(a.internacoes).toBeGreaterThan(0);
    // Só os estabelecimentos com o BI da Rede liberado no próprio banco entram no arquivo da Rede (D-LIB-BI-57). Nas
    // cópias, `rede.bi` está desligada (POL-3): a carga real não gera o arquivo da Rede.
    const bi = await biRedeLiberado(nucleo, ['pc', SEGUNDO]);
    expect(bi).toEqual([false, false]);
    const nada = consolidarRede(
      pasta,
      ['pc', SEGUNDO],
      ['pc', SEGUNDO].filter((_, k) => bi[k]),
    );
    expect(nada).toMatchObject({ modo: null, estabelecimentos: [] });
    expect(existsSync(arquivoDaRede(pasta))).toBe(false);
    // Com a liberação (simulada aqui: a lista dos liberados), só os liberados entram.
    expect(consolidarRede(pasta, ['pc', SEGUNDO], ['pc']).estabelecimentos).toEqual(['pc']);
    const r = consolidarRede(pasta, ['pc', SEGUNDO], ['pc', SEGUNDO]);
    expect(r.estabelecimentos).toEqual(['pc', SEGUNDO]);
    expect(r.linhas['pc']).toEqual(r.linhas[SEGUNDO]);
    const db = new DatabaseSync(arquivoDaRede(pasta), { readOnly: true });
    try {
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
      // O mesmo paciente (mesma cópia) tem pseudônimos diferentes nos dois estabelecimentos: nenhum em comum.
      const [comuns] = db
        .prepare(
          `SELECT COUNT(*) AS n FROM (SELECT DISTINCT paciente_pseudonimo FROM fato_internacao WHERE estabelecimento = 'pc')
             WHERE paciente_pseudonimo IN (SELECT paciente_pseudonimo FROM fato_internacao WHERE estabelecimento = ?)`,
        )
        .all(SEGUNDO) as { n: number }[];
      expect(Number(comuns!.n)).toBe(0);
      const porEst = db
        .prepare(
          'SELECT estabelecimento, COUNT(*) AS n FROM fato_internacao GROUP BY estabelecimento ORDER BY 1',
        )
        .all() as { estabelecimento: string; n: number }[];
      const medida = JSON.stringify({
        modo: r.modo,
        internacoes: porEst.map((x) => `${x.estabelecimento}=${seguro(Number(x.n))}`),
        pacientesDia: seguro(a.pacientesDia),
        segundos: resumos.map((x) => x.segundos),
        pseudonimosEmComum: Number(comuns!.n),
      });
      // Só agregados (abaixo de 5 vira <5); o arquivo fica em .tmp (fora do versionamento).
      writeFileSync(resolve(raiz, '.tmp/int-m57-3-datamart.json'), `${medida}\n`);
      console.log('data mart da Rede (2 bancos):', medida);
    } finally {
      db.close();
    }
  });
});
