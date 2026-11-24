// Contrato de efeito da redação do laudo e do laudo estruturado (F3.5, 05-SADT linhas 16 e 17) no MariaDB real
// (cliente f22_o2; massa SINTÉTICA). Prova o que fica no banco: o rascunho com o modelo e as medidas (fora da
// referência marcada pela faixa do paciente, indexada pela superfície corporal); a assinatura recusada sem médico e sem
// a medida obrigatória, sem gravar nada; a assinatura do médico com a versão 1, o hash e a foto das medidas; o rascunho
// recusado depois de assinado; a retificação com motivo que vira a versão 2 sem apagar a 1; a medida retirada marcada
// como excluída (nunca apagada); o modelo pessoal com os campos variáveis. Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoLaudoRedacao } from './laudo-redacao.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const falha = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'passou';
  } catch (e) {
    return codigoDe(e);
  }
};

describe.skipIf(SEM_BANCO)('redação do laudo e laudo estruturado (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoLaudoRedacao;
  let m: MassaSadt | null = null;
  const ids = { secao: 0, fe: 0, massa: 0, obs: 0, inscricao: 0, motivo: 0, modelo: 0 };
  const ctxT = { cliente: CLIENTE, correlacao: 't-f354' };
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(ctxT, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) => nucleo.lerSomente(ctxT, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'F354');
    servico = new ServicoLaudoRedacao(nucleo);
    const agora = new Date();
    await nucleo.escrever(ctxT, async (e) => {
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
      const ex = m!.exameImagem;
      ids.secao = await ins(
        `INSERT INTO secao_laudo_estruturado (exame_id, codigo, nome, ordem, criado_em) VALUES (?, 'VE', 'Ventrículo esquerdo', 1, ?)`,
        [ex, agora],
      );
      const g = (codigo: string, desc: string, ordem: number, obrig: boolean, casas: number) =>
        ins(
          `INSERT INTO grandeza_laudo (exame_id, secao_laudo_estruturado_id, codigo, descricao, casas_decimais, ordem, obrigatoria, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [ex, ids.secao, codigo, desc, casas, ordem, obrig, agora],
        );
      ids.fe = await g('fe', 'Fração de ejeção', 1, true, 0);
      ids.massa = await g('massa_ve', 'Massa do VE', 2, false, 0);
      ids.obs = await g('valvas', 'Valvas', 3, false, 0);
      await e.executar(
        `INSERT INTO faixa_referencia_grandeza (grandeza_laudo_id, referencia_minima, referencia_maxima, vigencia_inicio, criado_em)
         VALUES (?, 55, 75, '2020-01-01', ?)`,
        [ids.fe, agora],
      );
      await e.executar(
        `INSERT INTO faixa_referencia_grandeza (grandeza_laudo_id, referencia_maxima, indexada_superficie, vigencia_inicio, criado_em)
         VALUES (?, 115, TRUE, '2020-01-01', ?)`,
        [ids.massa, agora],
      );
      ids.motivo =
        Number(
          (await e.uma("SELECT id FROM motivo_retificacao_laudo WHERE codigo = 'T-F354'", []))?.['id'],
        ) ||
        (await ins(
          "INSERT INTO motivo_retificacao_laudo (codigo, descricao, ativo, criado_em) VALUES ('T-F354', 'Correção de medida', TRUE, ?)",
          [agora],
        ));
    });
  }, 60_000);

  afterAll(async () => {
    if (m) {
      await nucleo.escrever(ctxT, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        const laudos = `(SELECT id FROM laudo_diagnostico WHERE exame_item_id = ${Number(m!.itemImagem)})`;
        await x(`DELETE FROM valor_grandeza_laudo WHERE laudo_diagnostico_id IN ${laudos}`, []);
        await x(`DELETE FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id IN ${laudos}`, []);
        await x('DELETE FROM laudo_diagnostico WHERE exame_item_id = ?', [m!.itemImagem]);
        await x('DELETE FROM modelo_laudo WHERE estabelecimento_id = ?', [m!.base.est]);
        await x('DELETE FROM faixa_referencia_grandeza WHERE grandeza_laudo_id IN (?, ?, ?)', [
          ids.fe,
          ids.massa,
          ids.obs,
        ]);
        await x('DELETE FROM grandeza_laudo WHERE exame_id = ?', [m!.exameImagem]);
        await x('DELETE FROM secao_laudo_estruturado WHERE exame_id = ?', [m!.exameImagem]);
        await x("DELETE FROM motivo_retificacao_laudo WHERE codigo = 'T-F354'", []);
        if (ids.inscricao) await x('DELETE FROM inscricao_conselho WHERE id = ?', [ids.inscricao]);
      });
    }
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 60_000);

  it('rascunho com modelo e medidas, assinatura do médico, retificação com versão, nada apagado', async () => {
    const c = contexto(m!);
    const item = m!.itemImagem;
    // Modelo pessoal com campos variáveis.
    const modelo = await servico.salvarModelo(c, {
      codigo: `M${m!.marca}`.slice(0, 30),
      nome: 'Ecocardiograma normal',
      exame: m!.exameImagem,
      pessoal: true,
      tipo: 'normal',
      texto:
        'Fração de ejeção de {{fe}}%. Massa do VE {{massa_ve}} g. Superfície {{superficie_corporal}} m².',
    });
    ids.modelo = modelo.id;
    expect(modelo.campos).toEqual(['fe', 'massa_ve', 'superficie_corporal']);
    const previa = await servico.previaModelo(c, item, modelo.id, {
      valores: [{ grandeza: ids.fe, numero: 62, texto: null }],
      pesoKg: 80,
      alturaCm: 180,
    });
    expect(previa.faltam).toEqual(['massa_ve']);

    // Rascunho: medidas avaliadas pela faixa (FE 48 abaixo; massa 240 g / 2 m² = 120 acima de 115).
    const r = await servico.salvar(c, item, {
      modelo: modelo.id,
      texto: previa.texto,
      pesoKg: 80,
      alturaCm: 180,
      valores: [
        { grandeza: ids.fe, numero: 48 },
        { grandeza: ids.massa, numero: 240 },
        { grandeza: ids.obs, texto: 'Sem alterações' },
      ],
    });
    expect(r).toMatchObject({ situacao: 'rascunho', valores: 3, foraReferencia: 2 });
    expect(
      await todos(
        'SELECT grandeza_laudo_id AS g, sequencia, fora_referencia AS fora FROM valor_grandeza_laudo WHERE laudo_diagnostico_id = ? ORDER BY sequencia',
        [r.id],
      ),
    ).toEqual([
      { g: ids.fe, sequencia: 1, fora: 1 },
      { g: ids.massa, sequencia: 2, fora: 1 },
      { g: ids.obs, sequencia: 3, fora: 0 },
    ]);

    // Assinatura: sem a medida obrigatória e sem médico, recusada sem gravar nada.
    expect(await falha(servico.assinar(c, item, { texto: 'Laudo de teste completo.', valores: [] }))).toBe(
      'grandeza-obrigatoria',
    );
    const semMedico = await falha(
      servico.assinar(c, item, {
        texto: 'Laudo de teste completo.',
        valores: [{ grandeza: ids.fe, numero: 60 }],
      }),
    );
    expect(['sem-vinculo', 'conselho-inativo', 'laudo-privativo-medico']).toContain(semMedico);
    expect(await um('SELECT situacao FROM laudo_diagnostico WHERE id = ?', [r.id])).toEqual({
      situacao: 'rascunho',
    });
    expect(
      await um('SELECT COUNT(*) AS n FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id = ?', [r.id]),
    ).toEqual({
      n: 0,
    });

    // Vínculo de médico ativo para o profissional da conta (massa sintética).
    await nucleo.escrever(ctxT, async (e) => {
      const id = async (sql: string, p: unknown[] = []) => Number((await e.uma(sql, p))?.['id'] ?? 0);
      const cbo =
        (await id("SELECT id FROM ocupacao_cbo WHERE codigo_cbo LIKE '2251%' ORDER BY id LIMIT 1")) ||
        (await e.inserir(
          "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES ('225125', 'Médico clínico', ?)",
          [new Date()],
        ));
      const conselho = await id('SELECT id FROM conselho_classe ORDER BY id LIMIT 1');
      const uf = await id('SELECT id FROM unidade_federativa ORDER BY id LIMIT 1');
      const seq = Number(
        (
          await e.uma(
            'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM inscricao_conselho WHERE profissional_id = ?',
            [m!.base.profissional],
          )
        )?.['s'],
      );
      ids.inscricao = await e.inserir(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id, numero_inscricao,
           ocupacao_cbo_id, situacao, principal, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'ativa', FALSE, ?)`,
        [m!.base.profissional, seq, conselho, uf, `9${Date.now() % 1_000_000}`, cbo, new Date()],
      );
    });

    const a = await servico.assinar(c, item, {
      modelo: modelo.id,
      texto: 'Fração de ejeção de 60%. Laudo de teste.',
      pesoKg: 80,
      alturaCm: 180,
      valores: [
        { grandeza: ids.fe, numero: 60 },
        { grandeza: ids.massa, numero: 240 },
      ],
    });
    expect(a).toMatchObject({
      id: r.id,
      situacao: 'assinado',
      versaoAtual: 1,
      valores: 2,
      foraReferencia: 1,
    });
    const l1 = await um(
      `SELECT situacao, versao_atual, laudista_profissional_id IS NOT NULL AS laudista, assinado_em IS NOT NULL AS assinado
         FROM laudo_diagnostico WHERE id = ?`,
      [r.id],
    );
    expect(l1).toEqual({ situacao: 'assinado', versao_atual: 1, laudista: 1, assinado: 1 });
    // A medida retirada (valvas) fica marcada como excluída, nunca apagada.
    expect(
      await todos(
        'SELECT grandeza_laudo_id AS g, excluido_em IS NOT NULL AS excluida FROM valor_grandeza_laudo WHERE laudo_diagnostico_id = ? ORDER BY sequencia',
        [r.id],
      ),
    ).toEqual([
      { g: ids.fe, excluida: 0 },
      { g: ids.massa, excluida: 0 },
      { g: ids.obs, excluida: 1 },
    ]);

    // Depois de assinado, o rascunho é recusado; a retificação exige motivo.
    expect(await falha(servico.salvar(c, item, { texto: 'mudar' }))).toBe('laudo-assinado');
    expect(
      await falha(
        servico.retificar(c, item, {
          texto: 'Texto retificado do laudo.',
          valores: [{ grandeza: ids.fe, numero: 58 }],
        }),
      ),
    ).toBe('retificacao-sem-motivo');
    const rt = await servico.retificar(c, item, {
      motivo: ids.motivo,
      texto: 'Fração de ejeção de 58%. Laudo retificado.',
      valores: [{ grandeza: ids.fe, numero: 58 }],
    });
    expect(rt).toMatchObject({ situacao: 'retificado', versaoAtual: 2 });
    const versoes = await todos(
      `SELECT numero_versao AS v, situacao, motivo_retificacao_laudo_id IS NOT NULL AS motivo, CHAR_LENGTH(hash_sha256) AS h,
              JSON_LENGTH(dados, '$.valores') AS medidas
         FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id = ? ORDER BY numero_versao`,
      [r.id],
    );
    expect(versoes).toEqual([
      { v: 1, situacao: 'assinado', motivo: 0, h: 64, medidas: 2 },
      { v: 2, situacao: 'retificado', motivo: 1, h: 64, medidas: 1 },
    ]);

    // A tela lê tudo numa chamada: o laudo, as versões, as medidas e o modelo pessoal sugerido.
    const tela = await servico.abrir(c, item);
    expect(tela.laudo).toMatchObject({ situacao: 'retificado', versaoAtual: 2 });
    expect(tela.versoes.map((v) => v.numero)).toEqual([2, 1]);
    expect(tela.valores.map((v) => v.grandeza)).toEqual([ids.fe]);
    expect(tela.modelos[0]?.id).toBe(modelo.id);
    expect(tela.pode).toEqual({ salvar: false, assinar: false, retificar: true });

    // O exame de laboratório não lauda por aqui.
    expect(await falha(servico.abrir(c, m!.itemLab))).toBe('setor-sem-laudo');
  }, 60_000);
});
