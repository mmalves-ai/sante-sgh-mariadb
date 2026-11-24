// Integração do carregador versionado da terminologia de enfermagem licenciada (fecho-1, família sae-terminologia)
// contra o MariaDB real (cliente f22_o2), com o arquivo SINTÉTICO sae-terminologia-sintetica.json (nenhum conteúdo
// licenciado). Contrato de efeito de sae.carregar-terminologia: uma edição por sistema (NANDA-I, NIC, NOC), um termo por
// sistema + código + edição, uma ligação por superior, os catálogos de uso com o que faltava; a leitura devolve a última
// edição; a edição carregada não se recarrega; a mesma chave em outra edição convive; o termo divergente é recusado.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { readFileSync } from 'node:fs';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contextoDe,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  P,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { impressaoDaCarga, PortaSaePropria } from './sae-porta-propria.js';

interface TermoArquivo {
  tipo: string;
  codigo: string;
  pai: string | null;
  descricao: string;
  risco: boolean;
}
const arquivo = JSON.parse(
  readFileSync(new URL('./sae-terminologia-sintetica.json', import.meta.url), 'utf8'),
) as { sistema: 'NNN'; licenca: string; termos: TermoArquivo[] };

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const recusada = async (p: Promise<unknown>) =>
  codigoDe(
    await p.then(
      () => null,
      (e: unknown) => e,
    ),
  );

describe.skipIf(SEM_BANCO)(
  'carregador da terminologia de enfermagem por edição (MariaDB, cliente f22_o2)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaSaePropria;
    let m: MassaEnfermagem | null = null;
    const run = Date.now().toString(36).toUpperCase();
    const pre = `ZT${run}-`;
    const v1 = `T${run}`;
    const v2 = `T${run}-2`;
    const termos = arquivo.termos.map((t) => ({
      ...t,
      codigo: pre + t.codigo,
      pai: t.pai ? pre + t.pai : null,
    }));

    const contar = (sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-sae-term' }, async (l) =>
        Number((await l.uma<{ n: number }>(sql, p))?.n ?? 0),
      );
    const carregar = (versao: string, t = termos) =>
      porta.gravarSgh(contextoDe(m!), null, (g) =>
        g.carregarTerminologia({
          sistema: arquivo.sistema,
          versao,
          licenca: arquivo.licenca,
          termos: t,
          usuario: m!.login,
        }),
      );

    beforeAll(async () => {
      garantirCliente();
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo, `${P}T`, false);
      porta = new PortaSaePropria(nucleo);
    }, 60_000);

    afterAll(async () => {
      if (nucleo) {
        // Limpeza da massa sintética desta execução (o produto nunca apaga uma edição carregada).
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-sae-term-limpeza' }, async (e) => {
          await e.executar(
            `DELETE g FROM ligacao_termo_enfermagem g JOIN termo_terminologia_enfermagem t
              ON t.id = g.termo_terminologia_enfermagem_id WHERE t.edicao IN (?, ?)`,
            [v1, v2],
          );
          await e.executar('DELETE FROM termo_terminologia_enfermagem WHERE edicao IN (?, ?)', [v1, v2]);
          await e.executar('DELETE FROM edicao_terminologia_enfermagem WHERE edicao IN (?, ?)', [v1, v2]);
          await e.executar(
            `DELETE x FROM diagnostico_enfermagem_caracteristica x JOIN diagnostico_enfermagem d
              ON d.id = x.diagnostico_enfermagem_id WHERE d.codigo LIKE ?`,
            [`${pre}%`],
          );
          for (const t of [
            'diagnostico_enfermagem',
            'caracteristica_diagnostico_enfermagem',
            'resultado_enfermagem',
            'intervencao_enfermagem',
          ])
            await e.executar(`DELETE FROM ${t} WHERE codigo LIKE ?`, [`${pre}%`]);
        });
        await limparMassa(nucleo, m);
        await nucleo.encerrar();
      }
    });

    it('carrega a edição: uma por sistema, termo único por sistema + código + edição, ligações e catálogos de uso', async () => {
      expect(await carregar(v1)).toEqual({ termos: 7 });
      const ed = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-sae-term' }, (l) =>
        l.consultar<{ sistema: string; pacote: string; total_termos: number; hash_sha256: string }>(
          'SELECT sistema, pacote, total_termos, hash_sha256 FROM edicao_terminologia_enfermagem WHERE edicao = ? ORDER BY sistema',
          [v1],
        ),
      );
      expect(ed.map((x) => [x.sistema, x.pacote, Number(x.total_termos)])).toEqual([
        ['NANDA-I', 'NNN', 4],
        ['NIC', 'NNN', 2],
        ['NOC', 'NNN', 1],
      ]);
      expect(new Set(ed.map((x) => x.hash_sha256))).toEqual(new Set([impressaoDaCarga(termos)]));
      expect(
        await contar('SELECT COUNT(*) n FROM termo_terminologia_enfermagem WHERE edicao = ?', [v1]),
      ).toBe(7);
      expect(
        await contar(
          `SELECT COUNT(*) n FROM ligacao_termo_enfermagem g JOIN termo_terminologia_enfermagem t
            ON t.id = g.termo_terminologia_enfermagem_id WHERE t.edicao = ?`,
          [v1],
        ),
      ).toBe(4);
      // Catálogos de uso: 2 diagnósticos (um de risco), característica e fator de risco, resultado, intervenção.
      expect(
        await contar('SELECT COUNT(*) n FROM diagnostico_enfermagem WHERE codigo LIKE ? AND ativo', [
          `${pre}%`,
        ]),
      ).toBe(2);
      expect(
        await contar("SELECT COUNT(*) n FROM diagnostico_enfermagem WHERE codigo = ? AND tipo = 'risco'", [
          `${pre}D2`,
        ]),
      ).toBe(1);
      expect(
        await contar(
          "SELECT COUNT(*) n FROM caracteristica_diagnostico_enfermagem WHERE codigo = ? AND tipo = 'fator_risco'",
          [`${pre}F1`],
        ),
      ).toBe(1);
      expect(await contar('SELECT COUNT(*) n FROM resultado_enfermagem WHERE codigo = ?', [`${pre}R1`])).toBe(
        1,
      );
      expect(
        await contar('SELECT COUNT(*) n FROM intervencao_enfermagem WHERE codigo = ?', [`${pre}I1`]),
      ).toBe(1);
      expect(
        await contar(
          `SELECT COUNT(*) n FROM diagnostico_enfermagem_caracteristica x JOIN diagnostico_enfermagem d
            ON d.id = x.diagnostico_enfermagem_id WHERE d.codigo LIKE ?`,
          [`${pre}%`],
        ),
      ).toBe(3);
    });

    it('a leitura devolve a última edição carregada, com a característica nos dois diagnósticos', async () => {
      const t = await porta.terminologia(contextoDe(m!));
      expect(t).toHaveLength(8);
      expect(t.every((x) => x.sistema === 'NNN' && x.versao === v1 && x.licenca === arquivo.licenca)).toBe(
        true,
      );
      expect(
        t
          .filter((x) => x.codigo === `${pre}C1`)
          .map((x) => x.pai)
          .sort(),
      ).toEqual([`${pre}D1`, `${pre}D2`]);
    });

    it('a edição carregada não se recarrega; a mesma chave em outra edição convive; o divergente é recusado', async () => {
      expect(await recusada(carregar(v1))).toBe('versao-ja-carregada');
      expect(await carregar(v2)).toEqual({ termos: 7 });
      expect(
        await contar(
          'SELECT COUNT(*) n FROM termo_terminologia_enfermagem WHERE sistema = ? AND codigo = ?',
          ['NANDA-I', `${pre}C1`],
        ),
      ).toBe(2);
      // O catálogo de uso não duplica (único pelo código).
      expect(
        await contar('SELECT COUNT(*) n FROM diagnostico_enfermagem WHERE codigo LIKE ?', [`${pre}%`]),
      ).toBe(2);
      const divergente = [
        ...termos,
        { ...termos[2]!, pai: `${pre}D2`, descricao: 'Outra descrição sintética' },
      ];
      expect(await recusada(carregar(`T${run}-3`, divergente))).toBe('termo-divergente');
      expect(
        await contar('SELECT COUNT(*) n FROM edicao_terminologia_enfermagem WHERE edicao = ?', [`T${run}-3`]),
      ).toBe(0);
    });
  },
);
