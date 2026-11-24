// Integração do carregador versionado da terminologia de enfermagem licenciada (fecho-1, família sae-terminologia)
// contra o MariaDB real (cliente f22_o2), com o arquivo SINTÉTICO sae-terminologia-sintetica.json (nenhum conteúdo
// licenciado). Contrato de efeito de sae.carregar-terminologia: uma edição por sistema (NANDA-I, NIC, NOC), um termo por
// sistema + código + edição, uma ligação por superior, os catálogos de uso com o que faltava; a leitura devolve a última
// edição; a edição carregada não se recarrega; a mesma chave em outra edição convive; o termo divergente é recusado.
// Correção da revisão: o catálogo de uso que já existia (enunciado próprio do hospital mantido, item inativo que fica
// inativo e fora da leitura, ligação excluída que não volta nem quebra a carga, item próprio ativo fora da edição que
// segue na leitura, código cadastrado com outro tipo recusado) e o processo registrado depois da carga, lido com a
// edição e com a descrição da característica resolvida.
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
import { ServicoSae } from './sae-servico.js';

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
    const descricaoDe = (codigo: string) => arquivo.termos.find((x) => x.codigo === codigo)!.descricao;
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
      // O catálogo de uso que o hospital já tinha (sintético, com o prefixo da execução).
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-sae-term-preparo' }, async (e) => {
        const ins = (sql: string, p: unknown[]) => e.executar(sql, p);
        await ins(
          `INSERT INTO diagnostico_enfermagem (codigo, descricao, ativo, tipo, criado_em) VALUES
            (?, 'Enunciado próprio do hospital', TRUE, 'real', NOW(3)), (?, 'Diagnóstico próprio', TRUE, 'real', NOW(3)),
            (?, 'Cadastrado como real', TRUE, 'real', NOW(3))`,
          [`${pre}D1`, `${pre}H1`, `${pre}K-D2`],
        );
        await ins(
          `INSERT INTO caracteristica_diagnostico_enfermagem (codigo, descricao, ativo, tipo, criado_em)
            VALUES (?, 'Característica do hospital', TRUE, 'caracteristica_definidora', NOW(3))`,
          [`${pre}C1`],
        );
        await ins(
          `INSERT INTO diagnostico_enfermagem_caracteristica (diagnostico_enfermagem_id, caracteristica_diagnostico_enfermagem_id,
             papel, criado_em, excluido_em)
           SELECT d.id, c.id, 'definidora', NOW(3), NOW(3) FROM diagnostico_enfermagem d, caracteristica_diagnostico_enfermagem c
            WHERE d.codigo = ? AND c.codigo = ?`,
          [`${pre}D1`, `${pre}C1`],
        );
        await ins(
          `INSERT INTO intervencao_enfermagem (codigo, descricao, ativo, criado_em) VALUES (?, 'Intervenção inativada', FALSE, NOW(3))`,
          [`${pre}I1`],
        );
        // Uma escala predominante (dois resultados próprios a usam): a escala do resultado novo.
        await ins(
          `INSERT INTO escala_resultado_enfermagem (codigo, descricao, ativo, tipo_escala, ponto, criado_em)
            VALUES (?, 'Escala sintética', TRUE, ?, 1, NOW(3))`,
          [`${pre}E`, `${pre}E`],
        );
        await ins(
          `INSERT INTO resultado_enfermagem (codigo, descricao, ativo, escala_resultado_enfermagem_id, criado_em)
           SELECT x.codigo, 'Resultado próprio', TRUE, e.id, NOW(3)
             FROM escala_resultado_enfermagem e, (SELECT ? AS codigo UNION ALL SELECT ?) x WHERE e.codigo = ?`,
          [`${pre}RX1`, `${pre}RX2`, `${pre}E`],
        );
      });
    }, 60_000);

    afterAll(async () => {
      if (nucleo) {
        await limparMassa(nucleo, m);
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
          await e.executar('DELETE FROM escala_resultado_enfermagem WHERE codigo = ?', [`${pre}E`]);
        });
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
      // Catálogos de uso: D2 (de risco) e o fator de risco entram; D1 e C1 já existiam (o enunciado do hospital fica);
      // a intervenção inativa fica inativa; a ligação D1-C1 excluída fica excluída (não volta nem quebra a chave única).
      expect(
        await contar('SELECT COUNT(*) n FROM diagnostico_enfermagem WHERE codigo IN (?, ?, ?) AND ativo', [
          `${pre}D1`,
          `${pre}D2`,
          `${pre}H1`,
        ]),
      ).toBe(3);
      expect(
        await contar(
          "SELECT COUNT(*) n FROM diagnostico_enfermagem WHERE codigo = ? AND descricao = 'Enunciado próprio do hospital'",
          [`${pre}D1`],
        ),
      ).toBe(1);
      expect(
        await contar('SELECT COUNT(*) n FROM intervencao_enfermagem WHERE codigo = ? AND NOT ativo', [
          `${pre}I1`,
        ]),
      ).toBe(1);
      expect(
        await contar(
          `SELECT COUNT(*) n FROM diagnostico_enfermagem_caracteristica x JOIN diagnostico_enfermagem d
            ON d.id = x.diagnostico_enfermagem_id WHERE d.codigo = ? AND x.excluido_em IS NOT NULL`,
          [`${pre}D1`],
        ),
      ).toBe(1);
      expect(
        await contar(
          `SELECT COUNT(*) n FROM resultado_enfermagem r JOIN escala_resultado_enfermagem e
            ON e.id = r.escala_resultado_enfermagem_id WHERE r.codigo = ? AND e.codigo = ?`,
          [`${pre}R1`, `${pre}E`],
        ),
      ).toBe(1);
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

    it('a leitura: a edição, menos o que o hospital tirou de uso, mais o item próprio ativo', async () => {
      const todos = await porta.terminologia(contextoDe(m!));
      expect(todos.every((x) => x.sistema === 'NNN' && x.licenca === arquivo.licenca)).toBe(true);
      const t = todos.filter((x) => x.codigo.startsWith(pre) && !x.codigo.startsWith(`${pre}K-`));
      expect(t.every((x) => x.versao === v1)).toBe(true);
      // A ligação D1-C1 excluída fica fora; C1 segue em D2.
      expect(t.filter((x) => x.codigo === `${pre}C1`).map((x) => x.pai)).toEqual([`${pre}D2`]);
      // A intervenção inativa (e a atividade dela) fora; o diagnóstico próprio e os resultados próprios dentro.
      expect(t.some((x) => x.codigo === `${pre}I1`)).toBe(false);
      expect(t.map((x) => x.codigo)).toEqual(expect.arrayContaining([`${pre}H1`, `${pre}RX1`, `${pre}D1`]));
      // O enunciado lido do diagnóstico da edição é o da edição; o processo grava o do catálogo de uso.
      expect(t.find((x) => x.codigo === `${pre}D1`)?.descricao).toBe(descricaoDe('D1'));
    });

    it('o processo registrado depois da carga guarda a edição e resolve a descrição da característica', async () => {
      const servico = new ServicoSae(porta, null as never);
      const ctx = contextoDe(m!);
      const termo = await servico.terminologia(ctx);
      expect([termo.sistema, termo.versao]).toEqual(['NNN', v1]);
      await porta.gravarSgh(ctx, null, (g) =>
        g.registrarSae({
          paciente: m!.paciente,
          atendimento: m!.atendimento,
          versaoVista: 0,
          sistema: termo.sistema,
          versaoTerminologia: termo.versao,
          avaliacao: 'Avaliação sintética.',
          diagnosticos: [
            {
              codigo: `${pre}D2`,
              descricao: descricaoDe('D2'),
              caracteristicas: [`${pre}C1`],
              fatores: [`${pre}F1`],
              resultados: [
                { codigo: `${pre}R1`, descricao: descricaoDe('R1'), escalaAtual: 2, meta: 1, escalaMeta: 4 },
              ],
              intervencoes: [],
            },
          ],
          vinculo: m!.profissional,
          usuario: m!.login,
          chave: `${pre}sae`,
        }),
      );
      const lido = await porta.sae(ctx, m!.atendimento);
      expect([lido.cabecalho?.sistema, lido.cabecalho?.versaoTerminologia]).toEqual(['NNN', v1]);
      const { atual } = await servico.processo(ctx, m!.atendimento, termo);
      const texto = JSON.stringify(atual);
      expect(texto).toContain(descricaoDe('C1'));
      expect(texto).toContain(descricaoDe('F1'));
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
      // O catálogo de uso não duplica (único pelo código): D1, D2, H1 e o K-D2 do teste de conflito.
      expect(
        await contar('SELECT COUNT(*) n FROM diagnostico_enfermagem WHERE codigo LIKE ?', [`${pre}%`]),
      ).toBe(4);
      // O fator F1 de novo como característica (outro tipo, mesmo código no NANDA-I): termo divergente.
      const divergente = [...termos, { ...termos[4]!, tipo: 'caracteristica', pai: `${pre}D1` }];
      expect(await recusada(carregar(`T${run}-3`, divergente))).toBe('termo-divergente');
      expect(
        await contar('SELECT COUNT(*) n FROM edicao_terminologia_enfermagem WHERE edicao = ?', [`T${run}-3`]),
      ).toBe(0);
    });

    it('código do catálogo de uso cadastrado com outro tipo: recusa catalogo-tipo-divergente, nada gravado', async () => {
      const outro = arquivo.termos.map((t) => ({
        ...t,
        codigo: `${pre}K-${t.codigo}`,
        pai: t.pai ? `${pre}K-${t.pai}` : null,
      }));
      expect(await recusada(carregar(`T${run}-4`, outro))).toBe('catalogo-tipo-divergente');
      expect(
        await contar('SELECT COUNT(*) n FROM edicao_terminologia_enfermagem WHERE edicao = ?', [`T${run}-4`]),
      ).toBe(0);
      expect(
        await contar('SELECT COUNT(*) n FROM diagnostico_enfermagem WHERE codigo = ?', [`${pre}K-D1`]),
      ).toBe(0);
    });
  },
);
