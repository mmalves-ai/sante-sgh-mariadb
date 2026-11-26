// Contrato de efeito da redação do laudo e do laudo estruturado (F3.5, 05-SADT linhas 16 e 17) no MariaDB real
// (cliente f22_o2; massa SINTÉTICA). Prova o que fica no banco: o rascunho com o modelo e as medidas (fora da
// referência marcada pela faixa do paciente, indexada pela superfície corporal); a assinatura recusada sem médico e sem
// a medida obrigatória, sem gravar nada; a assinatura do médico com a versão 1, o hash e a foto das medidas; o rascunho
// recusado depois de assinado; a retificação com motivo que vira a versão 2 sem apagar a 1; a medida retirada marcada
// como excluída (nunca apagada); o modelo pessoal com os campos variáveis. E ainda (corretor F3.5-4): o exame não
// realizado recusado; a faixa pela data do exame (vigência); o peso e a altura gravados e herdados na retificação (a
// marca da medida indexada se mantém); o hash reproduzido do banco; a trilha de cada gravação; a recusa de outro
// estabelecimento, do modelo inativo ou de outro estabelecimento e do modelo pessoal de outro médico. E (F3.5-09, linha
// 16): a lista de trabalho; as palavras-chave do laudo (a retirada marcada, nunca apagada) e a busca de casos por elas;
// a assinatura que libera o exame; o achado crítico que abre o aviso crítico (lido pelo painel de avisos) e avisa quem
// pediu, sem repetir na retificação e cancelado sem apagar quando o achado sai; a retificação por outro laudista
// recusada sem gravar; a retificação do laudo já emitido, que avisa quem emitiu e deixa a emissão superada na validação
// do código; o texto inteiro da versão anterior; os modelos da manutenção sem o pessoal de outro médico. Só contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PortaSadtPropria } from '../porta-propria.js';
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
  const ids = {
    secao: 0,
    fe: 0,
    massa: 0,
    obs: 0,
    inscricao: 0,
    inscricao2: 0,
    motivo: 0,
    modelo: 0,
    palavraA: 0,
    palavraB: 0,
  };
  const codigoEmissao = randomUUID();
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
      const palavra = async (codigo: string, descricao: string) =>
        Number((await e.uma('SELECT id FROM palavra_chave_laudo WHERE codigo = ?', [codigo]))?.['id']) ||
        (await ins(
          'INSERT INTO palavra_chave_laudo (codigo, descricao, ativo, criado_em) VALUES (?, ?, TRUE, ?)',
          [codigo, descricao, agora],
        ));
      ids.palavraA = await palavra('T-F359-A', 'Caso de ensino (teste)');
      ids.palavraB = await palavra('T-F359-B', 'Achado raro (teste)');
      // C3-005: o tipo que a fila ICP conhece, como a migração 08_CC/94 o semeia em todo cliente (fica, é cadastro de
      // base; idempotente). A situação "lançado" vem da mesma migração.
      await e.executar(
        `INSERT INTO tipo_documento_clinico
           (codigo, descricao, ativo, categoria, ordem_medica, compoe_prontuario, gera_pendencia, impede_alta, criado_em)
         VALUES ('registro-clinico', 'Registro clínico (descrição cirúrgica e adendo)', TRUE, 'registro_cirurgico', FALSE,
                 TRUE, TRUE, FALSE, ?)
         ON DUPLICATE KEY UPDATE codigo = codigo`,
        [agora],
      );
      // Quem pediu o exame é o segundo profissional (outra conta): é ele que o aviso procura.
      await e.executar('UPDATE requisicao_exame SET solicitante_profissional_id = ? WHERE id = ?', [
        m!.base.profissional2,
        m!.requisicaoImagem,
      ]);
    });
  }, 60_000);

  afterAll(async () => {
    if (m) {
      await nucleo.escrever(ctxT, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        const laudos = `(SELECT id FROM laudo_diagnostico WHERE exame_item_id = ${Number(m!.itemImagem)})`;
        await x(
          `DELETE d FROM aviso_clinico_destinatario d JOIN aviso_clinico a ON a.id = d.aviso_clinico_id
            WHERE a.entidade_origem = 'laudo_diagnostico' AND a.entidade_origem_chave IN ${laudos}`,
          [],
        );
        await x(
          `DELETE FROM aviso_clinico WHERE entidade_origem = 'laudo_diagnostico' AND entidade_origem_chave IN ${laudos}`,
          [],
        );
        await x(`DELETE FROM aviso_valor_critico WHERE laudo_diagnostico_id IN ${laudos}`, []);
        await x(`DELETE FROM laudo_palavra_chave WHERE laudo_diagnostico_id IN ${laudos}`, []);
        await x('DELETE FROM emissao_laudo_exame WHERE exame_item_id = ?', [m!.itemImagem]);
        await x('DELETE FROM emissao_laudo WHERE codigo_autenticacao = ?', [codigoEmissao]);
        await x(`DELETE FROM valor_grandeza_laudo WHERE laudo_diagnostico_id IN ${laudos}`, []);
        // C3-005: o documento do prontuário de cada versão (e o vínculo com o exame) sai antes da versão.
        const docs = `(SELECT id FROM documento_prontuario WHERE entidade_origem = 'laudo_diagnostico_versao'
          AND entidade_origem_id IN (SELECT id FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id IN ${laudos}))`;
        await x('DELETE FROM exame_item_assinatura WHERE exame_item_id = ?', [m!.itemImagem]);
        await x(`DELETE FROM documento_prontuario_evento WHERE documento_prontuario_id IN ${docs}`, []);
        await x(`DELETE FROM documento_prontuario WHERE id IN (SELECT id FROM ${docs} t)`, []);
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
        await x("DELETE FROM palavra_chave_laudo WHERE codigo IN ('T-F359-A', 'T-F359-B')", []);
        if (ids.inscricao) await x('DELETE FROM inscricao_conselho WHERE id = ?', [ids.inscricao]);
        if (ids.inscricao2) await x('DELETE FROM inscricao_conselho WHERE id = ?', [ids.inscricao2]);
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

    // A lista de trabalho traz o exame realizado sem laudo assinado, com o paciente (só contagem aqui).
    const porta = new PortaSadtPropria(nucleo);
    const naFila = async () => (await servico.fila(c, null)).itens.filter((x) => x.item === item);
    expect((await naFila()).map((x) => ({ laudo: x.laudo, comPaciente: x.paciente.length > 0 }))).toEqual([
      { laudo: null, comPaciente: true },
    ]);
    expect((await servico.fila(c, m!.setorLab)).itens.filter((x) => x.item === item)).toEqual([]);

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
      palavrasChave: [ids.palavraA, ids.palavraB],
    });
    expect(r).toMatchObject({ situacao: 'rascunho', valores: 3, foraReferencia: 1 });
    const palavras = () =>
      todos(
        'SELECT palavra_chave_laudo_id AS p, excluido_em IS NOT NULL AS excluida FROM laudo_palavra_chave WHERE laudo_diagnostico_id = ? ORDER BY palavra_chave_laudo_id',
        [r.id],
      );
    expect(await palavras()).toEqual(
      [ids.palavraA, ids.palavraB].sort((a, b) => a - b).map((p) => ({ p, excluida: 0 })),
    );
    // A palavra-chave fora do cadastro é recusada e nada muda.
    expect(
      await falha(
        servico.salvar(c, item, { texto: 'Rascunho com palavra recusada.', palavrasChave: [999_999_999] }),
      ),
    ).toBe('palavra-chave-inexistente');
    expect((await palavras()).filter((x) => !x['excluida'])).toHaveLength(2);
    expect((await naFila()).map((x) => x.laudo)).toEqual(['rascunho']);
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
      // O segundo médico (quem pediu o exame): também habilitado, para provar que não retifica o laudo do colega.
      const seq2 = Number(
        (
          await e.uma(
            'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM inscricao_conselho WHERE profissional_id = ?',
            [m!.base.profissional2],
          )
        )?.['s'],
      );
      ids.inscricao2 = await e.inserir(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id, numero_inscricao,
           ocupacao_cbo_id, situacao, principal, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'ativa', FALSE, ?)`,
        [m!.base.profissional2, seq2, conselho, uf, `8${Date.now() % 1_000_000}`, cbo, new Date()],
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
      palavrasChave: [ids.palavraA],
      achadoCritico: true,
      achadoCriticoDescricao: 'Achado sintético de teste',
    });
    expect(a).toMatchObject({
      id: r.id,
      situacao: 'assinado',
      versaoAtual: 1,
      valores: 2,
      foraReferencia: 2,
      exameLiberado: true,
      avisoCritico: 'abrir',
      avisados: 1,
    });
    // A assinatura libera o exame (segue para a emissão) e ele sai da lista de trabalho.
    expect(
      await um(
        'SELECT situacao, liberado_em IS NOT NULL AS liberado, liberado_por_usuario_id AS por FROM exame_item WHERE id = ?',
        [item],
      ),
    ).toEqual({ situacao: 'liberado', liberado: 1, por: m!.base.usuario });
    expect(await naFila()).toEqual([]);
    // A palavra retirada fica marcada como excluída, nunca apagada.
    expect(await palavras()).toEqual(
      [ids.palavraA, ids.palavraB]
        .sort((x, y) => x - y)
        .map((p) => ({ p, excluida: p === ids.palavraB ? 1 : 0 })),
    );
    // O achado crítico abre o aviso crítico com a origem no laudo (sem resultado de laboratório), no prazo padrão, e
    // avisa quem pediu o exame (a outra conta).
    const avisosDoLaudo = () =>
      todos(
        `SELECT situacao, resultado_exame_id IS NULL AS sem_resultado, TIMESTAMPDIFF(MINUTE, gerado_em, prazo_em) AS prazo
           FROM aviso_valor_critico WHERE laudo_diagnostico_id = ? ORDER BY id`,
        [r.id],
      );
    expect(await avisosDoLaudo()).toEqual([{ situacao: 'pendente', sem_resultado: 1, prazo: 60 }]);
    const avisosClinicos = () =>
      todos(
        `SELECT a.prioridade, d.usuario_id AS para FROM aviso_clinico a JOIN aviso_clinico_destinatario d ON d.aviso_clinico_id = a.id
          WHERE a.entidade_origem = 'laudo_diagnostico' AND a.entidade_origem_chave = ? ORDER BY a.id`,
        [r.id],
      );
    expect(await avisosClinicos()).toEqual([{ prioridade: 'critica', para: m!.base.usuario2 }]);
    // O painel de avisos críticos lê o aviso do laudo junto com os do laboratório.
    const dia = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const painel = await porta.avisos(c, { inicio: dia(-1), fim: dia(1), pendentes: true });
    const noPainel = painel.filter((x) => x.exame === item);
    expect(noPainel.map((x) => x.elemento)).toEqual(['Achado crítico do laudo']);
    // O aviso do laboratório (o da massa) continua no mesmo painel.
    expect(painel.filter((x) => x.id === m!.aviso)).toHaveLength(1);

    // O laudo é emitido (massa sintética da emissão, por outra conta) e o código vale.
    await nucleo.escrever(ctxT, async (e) => {
      const antes = new Date(Date.now() - 60_000);
      const emissao = await e.inserir(
        `INSERT INTO emissao_laudo (estabelecimento_id, numero, codigo_autenticacao, numero_via, paciente_id, requisicao_exame_id,
           tipo_emissao, laudo_gerado_em, emitida_em, emitido_por_usuario_id, criado_em) VALUES (?, ?, ?, 1, ?, ?, 'pdf', ?, ?, ?, ?)`,
        [
          m!.base.est,
          `T${m!.marca}`.slice(0, 30),
          codigoEmissao,
          m!.base.paciente,
          m!.requisicaoImagem,
          antes,
          antes,
          m!.base.usuario2,
          antes,
        ],
      );
      await e.executar(
        'INSERT INTO emissao_laudo_exame (emissao_laudo_id, sequencia, exame_item_id, laudo_diagnostico_id, criado_em) VALUES (?, 1, ?, ?, ?)',
        [emissao, item, r.id, antes],
      );
    });
    expect(await porta.validarLaudo(c, codigoEmissao)).toMatchObject({ valido: true, superado: false });

    // Outro médico habilitado não retifica o laudo do colega: recusado sem gravar nada.
    const cOutroMedico = { ...c, usuario: m!.base.usuario2 };
    expect(
      await falha(
        servico.retificar(cOutroMedico, item, {
          motivo: ids.motivo,
          texto: 'Texto retificado por outro médico.',
          valores: [{ grandeza: ids.fe, numero: 10 }],
        }),
      ),
    ).toBe('retificacao-de-outro-laudista');
    expect(
      await um(
        `SELECT ld.situacao, ld.versao_atual AS v, (SELECT COUNT(*) FROM laudo_diagnostico_versao x WHERE x.laudo_diagnostico_id = ld.id) AS versoes
           FROM laudo_diagnostico ld WHERE ld.id = ?`,
        [r.id],
      ),
    ).toEqual({ situacao: 'assinado', v: 1, versoes: 1 });
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
      achadoCritico: true,
      achadoCriticoDescricao: 'Achado sintético de teste',
    });
    expect(rt).toMatchObject({ situacao: 'retificado', versaoAtual: 2, foraReferencia: 2 });
    // O achado crítico mantido não repete o aviso; o laudo já emitido avisa quem emitiu e quem pediu (a mesma conta,
    // uma vez) e a emissão anterior fica superada na validação do código. Sem o campo, as palavras-chave ficam.
    expect(rt).toMatchObject({ avisoCritico: 'nada', avisados: 1, emissoesSuperadas: 1 });
    expect(await avisosDoLaudo()).toHaveLength(1);
    expect(await avisosClinicos()).toEqual([
      { prioridade: 'critica', para: m!.base.usuario2 },
      { prioridade: 'alta', para: m!.base.usuario2 },
    ]);
    expect(await porta.validarLaudo(c, codigoEmissao)).toMatchObject({ valido: true, superado: true });
    expect((await palavras()).filter((x) => !x['excluida'])).toHaveLength(1);
    // Segunda retificação retira a massa: fica marcada como excluída, nunca apagada.
    const rt3 = await servico.retificar(c, item, {
      motivoTexto: 'Medida da massa retirada por revisão.',
      texto: 'Fração de ejeção de 58%. Laudo retificado sem a massa.',
      valores: [{ grandeza: ids.fe, numero: 58 }],
    });
    expect(rt3).toMatchObject({ situacao: 'retificado', versaoAtual: 3, avisoCritico: 'cancelar' });
    // O achado crítico retirado cancela o aviso ainda não comunicado: a linha fica, cancelada.
    expect((await avisosDoLaudo()).map((x) => x['situacao'])).toEqual(['cancelado']);
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
    // C3-005: cada versão (assinatura e retificações) virou um documento do prontuário do paciente, do tipo que a fila
    // de assinaturas com certificado ICP-Brasil conhece, situação "lançado", autor o laudista, ligado ao exame.
    const docsIcp = await todos(
      `SELECT v.numero_versao AS v, t.codigo AS tipo, s.categoria AS cat, dp.titulo, dp.paciente_id AS pac,
              dp.documento_assinado_id IS NULL AS sem_envelope,
              (SELECT COUNT(*) FROM exame_item_assinatura ea WHERE ea.documento_prontuario_id = dp.id
                  AND ea.exame_item_id = ?) AS ligado,
              (SELECT COUNT(*) FROM documento_prontuario_evento de WHERE de.documento_prontuario_id = dp.id) AS eventos
         FROM laudo_diagnostico_versao v
         JOIN documento_prontuario dp ON dp.entidade_origem = 'laudo_diagnostico_versao' AND dp.entidade_origem_id = v.id
         JOIN tipo_documento_clinico t ON t.id = dp.tipo_documento_clinico_id
         JOIN situacao_documento_prontuario s ON s.id = dp.situacao_documento_prontuario_id
        WHERE v.laudo_diagnostico_id = ? ORDER BY v.numero_versao`,
      [item, r.id],
    );
    expect(docsIcp.map((d) => [d['v'], d['tipo'], d['cat'], d['sem_envelope'], d['ligado'], d['eventos']])).toEqual([
      [1, 'registro-clinico', 'lancado', 1, 1, 1],
      [2, 'registro-clinico', 'lancado', 1, 1, 1],
      [3, 'registro-clinico', 'lancado', 1, 1, 1],
    ]);
    expect(docsIcp.every((d) => Number(d['pac']) === Number(m!.base.paciente))).toBe(true);
    expect(String(docsIcp[1]!['titulo'])).toContain('(retificação, versão 2)');
    expect(tela.versoes.every((v) => v.documento !== null)).toBe(true);
    // Sem política ICP-Brasil do estabelecimento para o tipo, fica a assinatura eletrônica avançada do clique; com a
    // política vigente (nível icp-brasil, destino interno), as três versões entram na fila do laudista.
    const tipoLaudo = Number((await um("SELECT id FROM tipo_documento_clinico WHERE codigo = 'registro-clinico'", []))!['id']);
    const politicaAntes = await um(
      `SELECT COUNT(*) AS n FROM regra_politica_assinatura r JOIN politica_assinatura p ON p.id = r.politica_assinatura_id
        WHERE p.estabelecimento_id = ? AND p.tipo_documento_clinico_id = ? AND p.ativo AND r.vigente = 1
          AND r.nivel = 'icp-brasil' AND r.destino = 'interno'`,
      [m!.base.est, tipoLaudo],
    );
    if (Number(politicaAntes!['n']) === 0) {
      expect(tela.versoes.map((v) => v.assinaturaIcp)).toEqual(['nao-exigida', 'nao-exigida', 'nao-exigida']);
      const politica = await nucleo.escrever(ctxT, (e) =>
        e.inserir(
          `INSERT INTO politica_assinatura (estabelecimento_id, tipo_documento_clinico_id, vigencia_inicio, criado_em)
           VALUES (?, ?, '2000-01-01', ?)`,
          [m!.base.est, tipoLaudo, new Date()],
        ),
      );
      try {
        await nucleo.escrever(ctxT, (e) =>
          e.inserir(
            `INSERT INTO regra_politica_assinatura (politica_assinatura_id, destino, nivel, justificativa, vigencia_inicio,
                                                    criado_em)
             VALUES (?, 'interno', 'icp-brasil', 'Teste C3-005', '2000-01-01', ?)`,
            [politica, new Date()],
          ),
        );
        const naFila = await servico.abrir(c, item);
        expect(naFila.versoes.map((v) => v.assinaturaIcp)).toEqual(['na-fila', 'na-fila', 'na-fila']);
      } finally {
        await nucleo.escrever(ctxT, async (e) => {
          await e.executar('DELETE FROM regra_politica_assinatura WHERE politica_assinatura_id = ?', [politica]);
          await e.executar('DELETE FROM politica_assinatura WHERE id = ?', [politica]);
        });
      }
    } else {
      expect(tela.versoes.map((v) => v.assinaturaIcp)).toEqual(['na-fila', 'na-fila', 'na-fila']);
    }
    expect(tela.valores.map((v) => v.grandeza)).toEqual([ids.fe]);
    expect(tela.modelos[0]?.id).toBe(modelo.id);
    expect(tela.pode).toEqual({ salvar: false, assinar: false, retificar: true });
    expect(tela.paciente.nome.length > 0).toBe(true);
    expect(tela.palavrasChave).toEqual([ids.palavraA]);
    expect(tela.palavras.filter((x) => [ids.palavraA, ids.palavraB].includes(x.id))).toHaveLength(2);
    expect(tela.anteriores).toEqual([]);
    // O texto inteiro de uma versão anterior (a assinada), com a foto das medidas; outro estabelecimento não a lê.
    const v1 = await servico.versaoAnterior(c, item, 1);
    expect(v1).toMatchObject({
      numero: 1,
      situacao: 'assinado',
      texto: 'Fração de ejeção de 60%. Laudo de teste.',
      achadoCritico: true,
    });
    expect(v1.valores).toHaveLength(2);
    expect(await falha(servico.versaoAnterior(c, item, 9))).toBe('versao-inexistente');
    expect(await falha(servico.versaoAnterior(cOutro, item, 1))).toBe('exame-inexistente');
    // Busca de casos: o laudo com todas as palavras pedidas (a retirada não conta); outro estabelecimento não acha.
    expect((await servico.buscar(c, [ids.palavraA])).filter((x) => x.item === item)).toHaveLength(1);
    expect((await servico.buscar(c, [ids.palavraA, ids.palavraB])).filter((x) => x.item === item)).toEqual(
      [],
    );
    expect(await servico.buscar(cOutro, [ids.palavraA])).toEqual([]);
    // Manutenção dos modelos: o pessoal de quem está na sessão e os do estabelecimento (o inativo também); o pessoal
    // de outro médico não aparece.
    const manut = await servico.modelos(c);
    const idsManut = manut.itens.map((x) => x.id);
    expect(idsManut).toContain(modelo.id);
    expect(idsManut).toContain(modeloInativo);
    expect(idsManut).not.toContain(modeloAlheio);
    expect(idsManut).not.toContain(modeloOutroEst);
    expect(manut.itens.find((x) => x.id === modelo.id)).toMatchObject({ pessoal: true, ativo: true });

    // O exame de laboratório não lauda por aqui.
    expect(await falha(servico.abrir(c, m!.itemLab))).toBe('setor-sem-laudo');
  }, 90_000);
});
