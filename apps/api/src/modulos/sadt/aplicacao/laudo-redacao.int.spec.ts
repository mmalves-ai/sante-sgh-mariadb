// Contrato de efeito da redação do laudo e do laudo estruturado (F3.5, 05-SADT linhas 16 e 17) no MariaDB real
// (cliente f22_o2; massa SINTÉTICA). Prova o que fica no banco: o rascunho com o modelo e as medidas (fora da
// referência marcada pela faixa do paciente, indexada pela superfície corporal); a assinatura recusada sem médico e sem
// a medida obrigatória, sem gravar nada; a assinatura do médico com a versão 1, o hash e a foto das medidas; o rascunho
// recusado depois de assinado; a retificação com motivo que vira a versão 2 sem apagar a 1; a medida retirada marcada
// como excluída (nunca apagada); o modelo pessoal com os campos variáveis. E ainda (corretor F3.5-4): o exame não
// realizado recusado; a faixa pela data do exame (vigência); o peso e a altura gravados e herdados na retificação (a
// marca da medida indexada se mantém); o hash reproduzido do banco; a trilha de cada gravação; a recusa de outro
// estabelecimento, do modelo inativo ou de outro estabelecimento e do modelo pessoal de outro médico. Só contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashDaVersao, ServicoLaudoRedacao } from './laudo-redacao.js';
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
      // Faixa da FE vigente só até 21/11/2026 (40 a 50): vale para o exame realizado em 20/11, não para o dia de hoje.
      await e.executar(
        `INSERT INTO faixa_referencia_grandeza (grandeza_laudo_id, referencia_minima, referencia_maxima, vigencia_inicio, vigencia_fim, criado_em)
         VALUES (?, 40, 50, '2026-11-01', '2026-11-21', ?)`,
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
        await x('DELETE FROM modelo_laudo WHERE estabelecimento_id IN (?, ?)', [
          m!.base.est,
          m!.base.outroEst,
        ]);
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
    const trilha = async (entidade: string, id: number) =>
      Number(
        (
          await um('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [
            entidade,
            id,
          ])
        )?.['n'],
      );
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
    expect(await trilha('modelo_laudo', modelo.id)).toBe(1);
    const previa = await servico.previaModelo(c, item, modelo.id, {
      valores: [{ grandeza: ids.fe, numero: 62, texto: null }],
      pesoKg: 80,
      alturaCm: 180,
    });
    expect(previa.faltam).toEqual(['massa_ve']);

    // O exame ainda não realizado (solicitado) não se lauda: nada gravado.
    expect(await falha(servico.salvar(c, item, { texto: 'Rascunho antes do exame.' }))).toBe(
      'exame-nao-realizado',
    );
    expect(await um('SELECT COUNT(*) AS n FROM laudo_diagnostico WHERE exame_item_id = ?', [item])).toEqual({
      n: 0,
    });
    await nucleo.escrever(ctxT, (e) =>
      e.executar(
        "UPDATE exame_item SET situacao = 'em_analise', realizado_em = '2026-11-20 10:00:00' WHERE id = ?",
        [item],
      ),
    );

    // Outro estabelecimento não abre nem grava o exame; o modelo de outro estabelecimento e o inativo são recusados.
    const cOutro = { ...c, estabelecimento: m!.base.outroEst };
    expect(await falha(servico.abrir(cOutro, item))).toBe('exame-inexistente');
    expect(await falha(servico.salvar(cOutro, item, { texto: 'Laudo de outro estabelecimento.' }))).toBe(
      'exame-inexistente',
    );
    const agora = new Date();
    const modeloOutroEst = await nucleo.escrever(ctxT, (e) =>
      e.inserir(
        "INSERT INTO modelo_laudo (estabelecimento_id, codigo, nome, tipo, texto, ativo, criado_em) VALUES (?, ?, 'Outro', 'texto', 'x', TRUE, ?)",
        [m!.base.outroEst, `O${m!.marca}`.slice(0, 30), agora],
      ),
    );
    const modeloInativo = await nucleo.escrever(ctxT, (e) =>
      e.inserir(
        "INSERT INTO modelo_laudo (estabelecimento_id, codigo, nome, tipo, texto, ativo, criado_em) VALUES (?, ?, 'Inativo', 'texto', 'x', FALSE, ?)",
        [m!.base.est, `I${m!.marca}`.slice(0, 30), agora],
      ),
    );
    for (const mod of [modeloOutroEst, modeloInativo])
      expect(await falha(servico.salvar(c, item, { modelo: mod, texto: 'Laudo com modelo recusado.' }))).toBe(
        'modelo-inexistente',
      );
    // O modelo pessoal de outro médico não muda (nem vira do estabelecimento).
    const modeloAlheio = await nucleo.escrever(ctxT, (e) =>
      e.inserir(
        "INSERT INTO modelo_laudo (estabelecimento_id, codigo, nome, tipo, texto, profissional_id, ativo, criado_em) VALUES (?, ?, 'Alheio', 'texto', 'x', ?, TRUE, ?)",
        [m!.base.est, `A${m!.marca}`.slice(0, 30), m!.base.profissional2, agora],
      ),
    );
    expect(
      await falha(
        servico.salvarModelo(c, {
          id: modeloAlheio,
          codigo: `A${m!.marca}`.slice(0, 30),
          nome: 'Apropriado',
          pessoal: false,
          texto: 'texto novo',
        }),
      ),
    ).toBe('modelo-de-outro-profissional');
    expect(
      await um('SELECT profissional_id AS p, nome FROM modelo_laudo WHERE id = ?', [modeloAlheio]),
    ).toEqual({
      p: m!.base.profissional2,
      nome: 'Alheio',
    });
    expect(await um('SELECT COUNT(*) AS n FROM laudo_diagnostico WHERE exame_item_id = ?', [item])).toEqual({
      n: 0,
    });

    // Rascunho: medidas avaliadas pela faixa do dia do exame (FE 48 dentro de 40–50, vigente em 20/11; pela faixa de
    // hoje seria fora); massa 240 g / 2 m² = 120 acima de 115 (indexada).
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
    expect(r).toMatchObject({ situacao: 'rascunho', valores: 3, foraReferencia: 1 });
    const medidasRascunho = await todos(
      'SELECT grandeza_laudo_id AS g, sequencia, valor_numerico AS v, fora_referencia AS fora, excluido_em IS NOT NULL AS excl FROM valor_grandeza_laudo WHERE laudo_diagnostico_id = ? ORDER BY sequencia',
      [r.id],
    );
    expect(medidasRascunho.map((x) => ({ g: x['g'], fora: x['fora'] }))).toEqual([
      { g: ids.fe, fora: 0 },
      { g: ids.massa, fora: 1 },
      { g: ids.obs, fora: 0 },
    ]);
    expect(
      Object.fromEntries(
        Object.entries(
          (await um(
            'SELECT peso_kg AS p, altura_cm AS a, superficie_corporal AS sc FROM laudo_diagnostico WHERE id = ?',
            [r.id],
          )) ?? {},
        ).map(([k, v]) => [k, Number(v)]),
      ),
    ).toEqual({ p: 80, a: 180, sc: 2 });
    expect(await trilha('laudo_diagnostico', r.id)).toBe(1);

    // A reabertura usa o peso e a altura gravados: a massa indexada continua fora; a data do exame vem da realização.
    const reaberto = await servico.abrir(c, item);
    expect(reaberto.paciente.dataExame).toBe('2026-11-20');
    expect(reaberto.laudo).toMatchObject({ pesoKg: 80, alturaCm: 180, superficieCorporal: 2 });
    expect(reaberto.valores.find((v) => v.grandeza === ids.massa)?.foraReferencia).toBe(true);

    // Assinatura: sem a medida obrigatória e sem médico, recusada sem gravar nada (as medidas ficam iguais).
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
    expect(
      await todos(
        'SELECT grandeza_laudo_id AS g, sequencia, valor_numerico AS v, fora_referencia AS fora, excluido_em IS NOT NULL AS excl FROM valor_grandeza_laudo WHERE laudo_diagnostico_id = ? ORDER BY sequencia',
        [r.id],
      ),
    ).toEqual(medidasRascunho);
    expect(await trilha('laudo_diagnostico', r.id)).toBe(1);

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

    // FE 60 fora de 40–50 (faixa do dia do exame) e massa indexada fora.
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
      foraReferencia: 2,
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
    expect(await trilha('laudo_diagnostico', r.id)).toBe(2);

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
    // Retificação SEM redigitar peso e altura: herda os gravados; a massa indexada continua fora (sem mudança clínica).
    const rt = await servico.retificar(c, item, {
      motivo: ids.motivo,
      texto: 'Fração de ejeção de 58%. Laudo retificado.',
      valores: [
        { grandeza: ids.fe, numero: 58 },
        { grandeza: ids.massa, numero: 240 },
      ],
    });
    expect(rt).toMatchObject({ situacao: 'retificado', versaoAtual: 2, foraReferencia: 2 });
    // Segunda retificação retira a massa: fica marcada como excluída, nunca apagada.
    const rt3 = await servico.retificar(c, item, {
      motivoTexto: 'Medida da massa retirada por revisão.',
      texto: 'Fração de ejeção de 58%. Laudo retificado sem a massa.',
      valores: [{ grandeza: ids.fe, numero: 58 }],
    });
    expect(rt3).toMatchObject({ situacao: 'retificado', versaoAtual: 3 });
    expect(
      await todos(
        'SELECT grandeza_laudo_id AS g, fora_referencia AS fora, excluido_em IS NOT NULL AS excluida FROM valor_grandeza_laudo WHERE laudo_diagnostico_id = ? ORDER BY sequencia',
        [r.id],
      ),
    ).toEqual([
      { g: ids.fe, fora: 1, excluida: 0 },
      { g: ids.massa, fora: 1, excluida: 1 },
      { g: ids.obs, fora: 0, excluida: 1 },
    ]);
    const versoes = await todos(
      `SELECT numero_versao AS v, situacao, motivo_retificacao_laudo_id IS NOT NULL OR motivo IS NOT NULL AS motivo,
              CHAR_LENGTH(hash_sha256) AS h, JSON_LENGTH(dados, '$.valores') AS medidas
         FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id = ? ORDER BY numero_versao`,
      [r.id],
    );
    expect(versoes).toEqual([
      { v: 1, situacao: 'assinado', motivo: 0, h: 64, medidas: 2 },
      { v: 2, situacao: 'retificado', motivo: 1, h: 64, medidas: 2 },
      { v: 3, situacao: 'retificado', motivo: 1, h: 64, medidas: 1 },
    ]);
    // O hash de cada versão se reproduz do que ficou no banco (texto, título e foto) e muda com o conteúdo; a foto
    // guarda o peso, a altura e a superfície usados.
    const fotos = await todos(
      'SELECT numero_versao AS v, titulo, texto, dados, hash_sha256 AS h FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id = ? ORDER BY numero_versao',
      [r.id],
    );
    const hashes = fotos.map((f) => {
      const d = (typeof f['dados'] === 'string' ? JSON.parse(f['dados']) : f['dados']) as {
        valores: { grandeza: number; numero: number | null; texto: string | null; fora: boolean }[];
        resultado: string | null;
        achadoCritico: boolean;
        paciente: { pesoKg: number | null; alturaCm: number | null; superficieCorporal: number | null };
      };
      expect(d.paciente).toEqual({ pesoKg: 80, alturaCm: 180, superficieCorporal: 2 });
      const calculado = hashDaVersao({
        titulo: (f['titulo'] as string | null) ?? null,
        texto: String(f['texto']),
        resultado: d.resultado,
        achadoCritico: d.achadoCritico,
        paciente: d.paciente,
        valores: d.valores,
      });
      expect(calculado).toBe(f['h']);
      return calculado;
    });
    expect(new Set(hashes).size).toBe(3);
    expect(await trilha('laudo_diagnostico', r.id)).toBe(4);

    // A tela lê tudo numa chamada: o laudo, as versões, as medidas e o modelo pessoal sugerido.
    const tela = await servico.abrir(c, item);
    expect(tela.laudo).toMatchObject({ situacao: 'retificado', versaoAtual: 3 });
    expect(tela.versoes.map((v) => v.numero)).toEqual([3, 2, 1]);
    expect(tela.valores.map((v) => v.grandeza)).toEqual([ids.fe]);
    expect(tela.modelos[0]?.id).toBe(modelo.id);
    expect(tela.pode).toEqual({ salvar: false, assinar: false, retificar: true });

    // O exame de laboratório não lauda por aqui.
    expect(await falha(servico.abrir(c, m!.itemLab))).toBe('setor-sem-laudo');
  }, 90_000);
});
