// Contrato de efeito dos laudos estruturados de mamografia e de anatomia patológica (F7, 05-SADT linha 18) contra o
// MariaDB real (cliente de teste com a migração 10_SADT/90_laudo_mama_patologia). Massa SINTÉTICA com o código
// "c2071lm": dois estabelecimentos fictícios, uma paciente, dois profissionais, um atendimento, setores de imagem e de
// anatomia patológica, a modalidade MG, um pedido de mamografia (com um ultrassom), um pedido com dois exames de
// anatomia patológica e uma cirurgia com a peça enviada (nenhuma pessoa real); usuário, categoria, caráter e fonte
// pagadora são ids já existentes do cliente. Prova o que fica no banco: a fila só com a mamografia (ou só com a
// anatomia patológica); o rascunho do laudo de mama com as categorias pelo catálogo, um por exame (409), exame de
// outro tipo e de outro estabelecimento (404) e categoria final menos grave que o achado (422) sem escrita; o achado
// mudado com a marca de exclusão e o novo com a sequência seguinte; versão vencida (409) sem escrita; liberação
// recusada com a recomendação errada e aceita certa, com o exame marcado realizado e o laudo imutável; a ficha do
// SISCAN; o laudo anatomopatológico com o número da sequência, amostras alteradas no lugar, retirada marcada e
// reativada; liberação do maligno exige o grau; a peça da cirurgia listada com os pedidos da paciente, recebida no
// pedido escolhido (laudo ligado à descrição, amostra A, cirurgião solicitante) e não recebida duas vezes.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { inserirMinimo } from '../suprimentos/massa-propria.spec-util.js';
import { PortaLaudoMamaPatologiaPropria } from './laudo-mama-patologia-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const P = 'c2071lm';
const P2 = `${P}b`;
const COD = (s: string) => `${P}${s}`.toUpperCase();

async function limpar(e: Escritor): Promise<void> {
  const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  const par = [P, P2];
  await e.executar(
    `DELETE FROM achado_mama WHERE laudo_mama_id IN (SELECT id FROM laudo_mama WHERE estabelecimento_id IN (${ests}))`,
    par,
  );
  await e.executar(`DELETE FROM laudo_mama WHERE estabelecimento_id IN (${ests})`, par);
  await e.executar(
    `DELETE FROM amostra_anatomopatologica WHERE laudo_anatomopatologico_id IN
       (SELECT id FROM laudo_anatomopatologico WHERE estabelecimento_id IN (${ests}))`,
    par,
  );
  await e.executar(`DELETE FROM laudo_anatomopatologico WHERE estabelecimento_id IN (${ests})`, par);
  await e.executar(
    `DELETE FROM sequencia_negocio WHERE tipo = 'laudo_anatomopatologico' AND estabelecimento_id IN (${ests})`,
    par,
  );
  const atos = `SELECT id FROM ato_cirurgico WHERE estabelecimento_id IN (${ests})`;
  await e.executar(`DELETE FROM descricao_cirurgica WHERE ato_cirurgico_id IN (${atos})`, par);
  await e.executar(`DELETE FROM ato_cirurgico WHERE estabelecimento_id IN (${ests})`, par);
  await e.executar(`DELETE FROM sala_cirurgica WHERE estabelecimento_id IN (${ests})`, par);
  await e.executar(`DELETE FROM unidade_cirurgica WHERE estabelecimento_id IN (${ests})`, par);
  await e.executar(`DELETE FROM unidade_assistencial WHERE estabelecimento_id IN (${ests})`, par);
  await e.executar('DELETE FROM carater_cirurgia WHERE codigo = ?', [COD('CAR')]);
  const reqs = `SELECT id FROM requisicao_exame WHERE estabelecimento_id IN (${ests})`;
  await e.executar(`DELETE FROM exame_item WHERE requisicao_exame_id IN (${reqs})`, par);
  await e.executar(`DELETE FROM requisicao_exame WHERE estabelecimento_id IN (${ests})`, par);
  await e.executar('DELETE FROM exame WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar('DELETE FROM modalidade_imagem WHERE codigo IN (?, ?)', [COD('MG'), COD('US')]);
  await e.executar(`DELETE FROM setor_diagnostico WHERE estabelecimento_id IN (${ests})`, par);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${ests})`, par);
  const pf = 'SELECT id FROM pessoa_fisica WHERE nome LIKE ?';
  await e.executar(`DELETE FROM profissional WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`% ${COD('')}`]);
  await limparTrilhaDaMassa(e, { codigos: par });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', par);
}

describe.skipIf(SEM_BANCO)('PortaLaudoMamaPatologiaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaLaudoMamaPatologiaPropria;
  let m: {
    usuario: number;
    paciente: number;
    medico: number;
    cirurgiao: number;
    itemMama: number;
    itemUs: number;
    itemAp1: number;
    itemAp2: number;
    descricao: number;
    grau: number;
  };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const DIA = { de: '2030-03-10', ate: '2030-03-10' };
  const DIA_CIRURGIA = { de: '2026-01-10', ate: '2026-01-10' };
  const nodulo = {
    lateralidade: 'direita',
    quadrante: 'superior_lateral',
    tipo: 'nodulo',
    categoria: '4B',
    tamanhoMm: 12,
    posicaoHoraria: 10,
    forma: 'irregular',
    contorno: 'espiculado',
  };
  const mama = () => ({
    tipoMamografia: 'diagnostica',
    composicaoDireita: 'fibroglandular_esparsa',
    composicaoEsquerda: 'fibroglandular_esparsa',
    categoriaDireita: '4B',
    categoriaEsquerda: '1',
    recomendacao: 'rotina',
    conclusao: 'Nódulo suspeito na mama direita (laudo sintético).',
    laudista: m.medico,
    achados: [nodulo],
  });
  const laudoMama = async () =>
    (
      await ler(
        `SELECT lm.id, lm.situacao, lm.versao, lm.paciente_id, lm.criado_por, lm.liberado_em, cd.categoria AS cd,
                ce.categoria AS ce FROM laudo_mama lm
           LEFT JOIN categoria_achado_mama cd ON cd.id = lm.categoria_direita_id
           LEFT JOIN categoria_achado_mama ce ON ce.id = lm.categoria_esquerda_id
          WHERE lm.exame_item_id = ?`,
        [m.itemMama],
      )
    )[0];

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const categoria = await um('SELECT MIN(id) AS id FROM categoria_atendimento');
      const caraterTiss = await um('SELECT MIN(id) AS id FROM carater_atendimento_tiss');
      const fonte = await um('SELECT MIN(id) AS id FROM fonte_pagadora');
      const grau = await um("SELECT id FROM grau_histologico WHERE codigo = 'NOTTINGHAM_2'");
      if (!usuario || !categoria || !caraterTiss || !fonte || !grau)
        throw new Error(
          'O cliente de teste precisa de usuário, categoria, caráter, fonte pagadora e da migração 90.',
        );
      const novoEst = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const min = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, P);
      const paciente = await min('paciente', {
        pessoa_fisica_id: await min('pessoa_fisica', { nome: `PACIENTE SINTETICA ${COD('')}` }),
        situacao: 'ativo',
      });
      const prof = async (n: string) =>
        min('profissional', {
          pessoa_fisica_id: await min('pessoa_fisica', { nome: `MEDICO ${n} SINTETICO ${COD('')}` }),
          tipo: 'corpo_clinico',
          situacao: 'ativo',
        });
      const medico = await prof('LAUDO');
      const cirurgiao = await prof('CIRURGIA');
      const atendimento = await min('atendimento', {
        estabelecimento_id: est,
        numero: `${P}-A`,
        paciente_id: paciente,
        categoria_atendimento_id: categoria,
        carater_atendimento_tiss_id: caraterTiss,
        fonte_pagadora_id: fonte,
        profissional_id: medico,
        entrada_em: new Date('2030-03-10T08:00:00.000Z'),
      });
      const setor = (codigo: string, tipo: string) =>
        e.inserir(
          `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em, versao)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [est, `${P}${codigo}`, `SETOR SINTETICO ${codigo}`, tipo, agora],
        );
      const img = await setor('I', 'imagem');
      const ap = await setor('P', 'anatomia_patologica');
      const modalidade = async (sigla: string) =>
        (await um(`SELECT id FROM modalidade_imagem WHERE sigla_padrao = '${sigla}'`)) ||
        (await e.inserir(
          'INSERT INTO modalidade_imagem (codigo, descricao, sigla_padrao, criado_em) VALUES (?, ?, ?, ?)',
          [COD(sigla), `MODALIDADE SINTETICA ${sigla}`, sigla, agora],
        ));
      const mg = await modalidade('MG');
      const us = await modalidade('US');
      const exame = (codigo: string, tipo: string, modalidade: number | null) =>
        e.inserir(
          `INSERT INTO exame (codigo, sigla, nome, tipo_servico, tipo_resultado, modalidade_imagem_id, ativo,
             criado_em, versao) VALUES (?, ?, ?, ?, 'laudo', ?, TRUE, ?, 1)`,
          [COD(codigo), COD(codigo).slice(-10), `EXAME SINTETICO ${codigo}`, tipo, modalidade, agora],
        );
      const mamografia = await exame('MAM', 'imagem', mg);
      const ultrassom = await exame('US', 'imagem', us);
      const histo = await exame('HIS', 'anatomia_patologica', null);
      const requisicao = (numero: string, setorReq: number) =>
        e.inserir(
          `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
             fonte_pagadora_id, solicitante_profissional_id, solicitado_em, criado_em, versao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            est,
            numero,
            paciente,
            atendimento,
            setorReq,
            fonte,
            medico,
            new Date('2030-03-10T09:00:00.000Z'),
            agora,
          ],
        );
      const r1 = await requisicao(`${P}-R1`, img);
      const r2 = await requisicao(`${P}-R2`, ap);
      const item = (req: number, seq: number, ex: number) =>
        e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, criado_em, versao)
           VALUES (?, ?, ?, 'solicitado', ?, 1)`,
          [req, seq, ex, agora],
        );
      const itemMama = await item(r1, 1, mamografia);
      const itemUs = await item(r1, 2, ultrassom);
      const itemAp1 = await item(r2, 1, histo);
      const itemAp2 = await item(r2, 2, histo);
      const ua = await e.inserir(
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, 'CC1', 'BLOCO SINTETICO', 'centro_cirurgico', ?)",
        [est, agora],
      );
      const uc = await e.inserir(
        'INSERT INTO unidade_cirurgica (estabelecimento_id, unidade_assistencial_id, funciona_24_horas, criado_em) VALUES (?, ?, TRUE, ?)',
        [est, ua, agora],
      );
      const sala = await e.inserir(
        "INSERT INTO sala_cirurgica (estabelecimento_id, unidade_cirurgica_id, codigo, descricao, situacao, criado_em) VALUES (?, ?, 'S1', 'SALA SINTETICA 1', 'ativa', ?)",
        [est, uc, agora],
      );
      const carater = await e.inserir(
        'INSERT INTO carater_cirurgia (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [COD('CAR'), 'CARATER SINTETICO', agora],
      );
      const ato = await e.inserir(
        `INSERT INTO ato_cirurgico (estabelecimento_id, numero, atendimento_id, paciente_id, sala_cirurgica_id,
           carater_cirurgia_id, diagnostico_pre_operatorio, entrada_sala_em, inicio_cirurgia_em, fim_cirurgia_em,
           saida_sala_em, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'Nódulo de mama (sintético)', ?, ?, ?, ?, 'realizado', ?)`,
        [
          est,
          `${P}-C1`,
          atendimento,
          paciente,
          sala,
          carater,
          new Date('2026-01-10T09:50:00.000Z'),
          new Date('2026-01-10T10:00:00.000Z'),
          new Date('2026-01-10T11:00:00.000Z'),
          new Date('2026-01-10T11:10:00.000Z'),
          agora,
        ],
      );
      const descricao = await e.inserir(
        `INSERT INTO descricao_cirurgica (ato_cirurgico_id, cirurgiao_profissional_id, descricao_tecnica,
           envio_anatomopatologico, descricao_pecas, situacao, concluida_em, criado_em)
         VALUES (?, ?, 'Técnica sintética', TRUE, 'Segmento de mama direita (sintético)', 'concluida', ?, ?)`,
        [ato, cirurgiao, agora, agora],
      );
      return { usuario, paciente, medico, cirurgiao, itemMama, itemUs, itemAp1, itemAp2, descricao, grau };
    });
    porta = new PortaLaudoMamaPatologiaPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  }, 120_000);

  it('fila: só a mamografia (sem o ultrassom) ou só a anatomia patológica, ainda sem laudo', async () => {
    const f = await porta.fila(ctx(), { ...DIA, tipo: 'mama' });
    expect(f.exames.map((x) => [x.item, x.situacao])).toEqual([[m.itemMama, 'sem_laudo']]);
    const a = await porta.fila(ctx(), { ...DIA, tipo: 'anatomopatologico' });
    expect(a.exames.map((x) => x.item)).toEqual([m.itemAp1, m.itemAp2]);
  });

  it('mama: rascunho pelo catálogo; um por exame; recusas sem escrita', async () => {
    await expect(porta.salvarMama(ctx(), m.itemUs, mama())).rejects.toMatchObject({
      problema: { status: 404 },
    });
    await expect(
      porta.salvarMama(ctx(), m.itemMama, { ...mama(), categoriaDireita: '3' }),
    ).rejects.toMatchObject({
      problema: { status: 422, campos: ['categoriaDireita'] },
    });
    await expect(porta.salvarMama(ctx(P2), m.itemMama, mama())).rejects.toMatchObject({
      problema: { status: 404 },
    });
    expect(await laudoMama()).toBeUndefined();
    const r = await porta.salvarMama(ctx(), m.itemMama, mama());
    expect(r).toMatchObject({ versao: 1, achadosIncluidos: 1 });
    expect(await laudoMama()).toMatchObject({
      id: r.id,
      situacao: 'rascunho',
      paciente_id: m.paciente,
      criado_por: m.usuario,
      cd: '4B',
      ce: '1',
    });
    await expect(porta.salvarMama(ctx(), m.itemMama, mama())).rejects.toMatchObject({
      problema: { status: 409 },
    });
  });

  it('mama: achado mudado vai ao histórico; versão vencida não grava; liberação confere a recomendação', async () => {
    const l = await porta.abrirMama(ctx(), m.itemMama);
    const achado = l.achados[0]!;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id e a sequência
    const { id: _id, sequencia: _s, ...base } = achado;
    const v2 = await porta.salvarMama(ctx(), m.itemMama, {
      ...mama(),
      versao: 1,
      achados: [{ ...base, id: achado.id, tamanhoMm: 14 }],
    });
    expect(v2).toMatchObject({ versao: 2, achadosIncluidos: 1, achadosRetirados: 1 });
    const linhas = await ler(
      'SELECT sequencia, tamanho_mm, excluido_em IS NOT NULL AS ex FROM achado_mama WHERE laudo_mama_id = ? ORDER BY sequencia',
      [l.laudo!.id],
    );
    expect(linhas.map((x) => [x['sequencia'], Number(x['tamanho_mm']), Number(x['ex'])])).toEqual([
      [1, 12, 1],
      [2, 14, 0],
    ]);
    await expect(porta.salvarMama(ctx(), m.itemMama, { ...mama(), versao: 1 })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    await expect(porta.liberarMama(ctx(), l.laudo!.id, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422, campos: ['recomendacao'] },
    });
    const atual = await porta.abrirMama(ctx(), m.itemMama);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id e a sequência
    const { id: i2, sequencia: _s2, ...a2 } = atual.achados[0]!;
    await porta.salvarMama(ctx(), m.itemMama, {
      ...mama(),
      recomendacao: 'biopsia',
      versao: 2,
      achados: [{ ...a2, id: i2 }],
    });
    const lib = await porta.liberarMama(ctx(), l.laudo!.id, { versao: 3 });
    expect(lib.alertas.length).toBeGreaterThan(0);
    const g = await laudoMama();
    expect(g).toMatchObject({ situacao: 'liberado', versao: 4 });
    expect(g!['liberado_em']).not.toBeNull();
    const [it] = await ler(
      'SELECT realizado_em, executante_profissional_id AS ex FROM exame_item WHERE id = ?',
      [m.itemMama],
    );
    expect(it!['realizado_em']).not.toBeNull();
    expect(it!['ex']).toBe(m.medico);
    await expect(porta.salvarMama(ctx(), m.itemMama, { ...mama(), versao: 4 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const hoje = new Date().toISOString().slice(0, 10);
    const s = await porta.siscanMamografia(ctx(), { de: hoje, ate: hoje });
    expect(s.fichas).toHaveLength(1);
    expect(s.fichas[0]).toMatchObject({
      direita: { categoria: '4B', nodulos: 1 },
      esquerda: { categoria: '1' },
      recomendacao: 'biopsia',
    });
  });

  it('anatomopatológico: número pela sequência; amostras alteradas no lugar, retirada e reativada; grau exigido', async () => {
    const corpo = {
      tipoExame: 'histopatologia',
      coletaEm: '2030-03-10T09:30:00.000Z',
      recebidoEm: '2030-03-10T12:00:00.000Z',
      macroscopia: 'Fragmentos sintéticos.',
      amostras: [
        { tipo: 'fragmento', identificacao: 'a', quantidadeFragmentos: 3 },
        { tipo: 'bloco', identificacao: 'B' },
      ],
    };
    const r = await porta.salvarAnatomopatologico(ctx(), m.itemAp1, corpo);
    expect(r).toMatchObject({ versao: 1, amostrasIncluidas: 2 });
    expect(String(r.numero)).toMatch(/^AP/);
    const v2 = await porta.salvarAnatomopatologico(ctx(), m.itemAp1, {
      ...corpo,
      versao: 1,
      amostras: [
        { tipo: 'fragmento', identificacao: 'A', quantidadeFragmentos: 4 },
        { tipo: 'lamina', identificacao: 'C' },
      ],
    });
    expect(v2).toMatchObject({ versao: 2, amostrasIncluidas: 1, amostrasAlteradas: 1, amostrasRetiradas: 1 });
    const v3 = await porta.salvarAnatomopatologico(ctx(), m.itemAp1, {
      ...corpo,
      versao: 2,
      diagnostico: 'Carcinoma sintético.',
      microscopia: 'Neoplasia sintética.',
      resultado: 'maligno',
      patologista: m.medico,
      dados: { margens: 'livres', linfonodosExaminados: 5, linfonodosComprometidos: 1 },
      amostras: [
        { tipo: 'fragmento', identificacao: 'A', quantidadeFragmentos: 4 },
        { tipo: 'lamina', identificacao: 'C' },
        { tipo: 'bloco', identificacao: 'B' },
      ],
    });
    expect(v3).toMatchObject({ versao: 3, amostrasIncluidas: 0, amostrasAlteradas: 1, amostrasRetiradas: 0 });
    const am = await ler(
      `SELECT identificacao, sequencia, quantidade_fragmentos AS q, excluido_em IS NULL AS vigente
         FROM amostra_anatomopatologica WHERE laudo_anatomopatologico_id = ? ORDER BY sequencia`,
      [r.id],
    );
    expect(am.map((x) => [x['identificacao'], x['sequencia'], x['q'], Number(x['vigente'])])).toEqual([
      ['A', 1, 4, 1],
      ['B', 2, null, 1],
      ['C', 3, null, 1],
    ]);
    await expect(porta.liberarAnatomopatologico(ctx(), r.id, { versao: 3 })).rejects.toMatchObject({
      problema: { status: 422, campos: ['grauHistologico'] },
    });
    const ab = await porta.abrirAnatomopatologico(ctx(), m.itemAp1);
    expect(ab.laudo!.dados).toMatchObject({ margens: 'livres', linfonodosComprometidos: 1 });
    await porta.salvarAnatomopatologico(ctx(), m.itemAp1, {
      ...corpo,
      versao: 3,
      diagnostico: 'Carcinoma sintético.',
      microscopia: 'Neoplasia sintética.',
      resultado: 'maligno',
      patologista: m.medico,
      grauHistologico: m.grau,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta o id e a sequência
      amostras: ab.amostras.map(({ sequencia: _s, ...a }) => a),
    });
    const lib = await porta.liberarAnatomopatologico(ctx(), r.id, { versao: 4 });
    expect(lib.alertas.length).toBeGreaterThan(0);
    const [g] = await ler(
      'SELECT situacao, liberado_por_usuario_id AS por, grau_histologico_id AS grau FROM laudo_anatomopatologico WHERE id = ?',
      [r.id],
    );
    expect(g).toMatchObject({ situacao: 'liberado', por: m.usuario, grau: m.grau });
  });

  it('peça da cirurgia: listada com os pedidos da paciente, recebida no pedido escolhido uma vez só', async () => {
    const p = await porta.pecasEnviadas(ctx(), DIA_CIRURGIA);
    expect(p.pecas).toHaveLength(1);
    expect(p.pecas[0]).toMatchObject({
      descricao: m.descricao,
      pecas: 'Segmento de mama direita (sintético)',
    });
    expect(p.pecas[0]!.pedidos.map((x) => x.item)).toEqual([m.itemAp2]);
    await expect(porta.receberPeca(ctx(), m.descricao, { item: m.itemAp1 })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    await expect(porta.receberPeca(ctx(), m.descricao, { item: m.itemMama })).rejects.toMatchObject({
      problema: { status: 404 },
    });
    const r = await porta.receberPeca(ctx(), m.descricao, { item: m.itemAp2 });
    const [l] = await ler(
      `SELECT descricao_cirurgica_id AS d, solicitante_profissional_id AS s, situacao, coleta_em, dados_clinicos,
              (SELECT CONCAT(identificacao, ':', tipo) FROM amostra_anatomopatologica WHERE laudo_anatomopatologico_id = l.id) AS am
         FROM laudo_anatomopatologico l WHERE id = ?`,
      [r.id],
    );
    expect(l).toMatchObject({
      d: m.descricao,
      s: m.cirurgiao,
      situacao: 'rascunho',
      dados_clinicos: 'Nódulo de mama (sintético)',
      am: 'A:peca',
    });
    expect(l!['coleta_em']).not.toBeNull();
    expect((await porta.pecasEnviadas(ctx(), DIA_CIRURGIA)).pecas).toEqual([]);
    await expect(porta.receberPeca(ctx(), m.descricao, { item: m.itemAp2 })).rejects.toMatchObject({
      problema: { status: 409 },
    });
  });
});
