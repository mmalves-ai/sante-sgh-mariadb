// Contrato de efeito dos painéis de TV operacionais (01-REL L116; F3) contra o MariaDB real (cliente de teste; massa
// SINTÉTICA com o código do teste, nenhuma pessoa real). Prova o que fica no banco: o painel nasce em rascunho e o
// código repetido é recusado; ativar sem bloco é recusado sem gravar; salvar grava os blocos em ordem com a fonte e o
// filtro (unidade intensiva, sala); unidade que não é intensiva e versão velha são recusadas sem mudar nada; o bloco que
// sai fica marcado como excluído e volta na mesma linha; a tela da TV lê na hora a ocupação da terapia intensiva (taxa
// com as parcelas), a fila da farmácia, o mapa cirúrgico do dia e o laboratório (urgente primeiro, atraso) só com
// iniciais (nenhum nome); o televisor ligado recebe o código de pareamento, o pareamento anula o código e marca o
// contato, código usado é recusado, e desligar mantém a linha marcada como excluída.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaPainelTvPropria } from './painel-tv-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const P = 'c2088tv';
const PRONTUARIOS = [920880001, 920880002, 920880003, 920880004, 920880005, 920880006];
const NOMES = [
  'Teresa Cristina Vaz',
  'Bruno de Almeida Lopes',
  'Carla Nunes',
  'Diego Prado',
  'Elisa Moura',
  'Fabio Reis',
];

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const pt = `(SELECT x.id FROM (SELECT id FROM painel_tv WHERE estabelecimento_id IN ${est}) x)`;
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM painel_tv_bloco WHERE painel_tv_id IN ${pt}`, [P]);
    await e.executar(`DELETE FROM painel_tv_dispositivo WHERE painel_tv_id IN ${pt}`, [P]);
    await e.executar(`DELETE FROM painel_tv WHERE estabelecimento_id IN ${est}`, [P]);
    for (const t of [
      'ocupacao_leito',
      'internacao',
      'leito_hospitalar',
      'unidade_internacao',
      'dispensacao',
      'agendamento_cirurgico',
      'sala_cirurgica',
      'requisicao_exame',
      'estacao_trabalho',
    ])
      await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
    const marcas = PRONTUARIOS.map(() => '?').join(',');
    await e.executar(
      `DELETE FROM pessoa_fisica WHERE id IN (SELECT x.id FROM (SELECT pessoa_fisica_id AS id FROM paciente
         WHERE numero_prontuario IN (${marcas})) x)`,
      PRONTUARIOS,
    );
    await e.executar(`DELETE FROM paciente WHERE numero_prontuario IN (${marcas})`, PRONTUARIOS);
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Painéis de TV operacionais (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPainelTvPropria;
  let m: { usuario: number; tipo: number; uti: number; enfermaria: number; sala: number; tv: number };
  let painel = 0;
  const ctx = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P, hospital: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const linhaPainel = async () =>
    (await ler('SELECT situacao, nome, versao FROM painel_tv WHERE id = ?', [painel]))[0]!;
  const blocos = () =>
    ler(
      `SELECT id, sequencia, titulo, forma_exibicao, JSON_VALUE(filtro, '$.fonte') AS fonte,
              JSON_VALUE(filtro, '$.unidadeInternacaoId') AS unidade, JSON_VALUE(filtro, '$.salaCirurgicaId') AS sala,
              excluido_em IS NOT NULL AS excluido
         FROM painel_tv_bloco WHERE painel_tv_id = ? ORDER BY sequencia`,
      [painel],
    );
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const x = e as { problema?: { status?: number }; status?: number };
      return { status: x.problema?.status ?? x.status, texto: JSON.stringify(x.problema ?? x) };
    }
    throw new Error('Era para recusar.');
  };
  const bloco = (b: Record<string, unknown>) => ({
    titulo: 'Bloco teste',
    forma: 'tabela',
    tempoEmTelaSegundos: null,
    unidadeInternacaoId: null,
    salaCirurgicaId: null,
    limite: 20,
    ...b,
  });
  const quatro = () => [
    bloco({ fonte: 'uti', titulo: 'UTI adulto', unidadeInternacaoId: m.uti, forma: 'mapa' }),
    bloco({ fonte: 'farmacia', titulo: 'Farmácia central' }),
    bloco({
      fonte: 'mapa_cirurgico',
      titulo: 'Centro cirúrgico',
      salaCirurgicaId: m.sala,
      tempoEmTelaSegundos: 20,
    }),
    bloco({ fonte: 'laboratorio', titulo: 'Laboratório', forma: 'lista' }),
  ];
  const dados = { nome: 'TV do corredor', tempoRotacaoSegundos: 30, atualizacaoSegundos: 60 };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaPainelTvPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const [u] = await e.consultar('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 1');
      const [t] = await e.consultar("SELECT id FROM tipo_painel_tv WHERE codigo = 'uti'");
      if (!u || !t)
        throw new Error('O cliente de teste precisa de usuário e do catálogo tipo_painel_tv (19_REL/99).');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const pac: number[] = [];
        for (const [i, nome] of NOMES.entries()) {
          const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
            nome,
            agora,
          ]);
          pac.push(
            await e.inserir(
              'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
              [pf, PRONTUARIOS[i], agora],
            ),
          );
        }
        const unidade = (codigo: string, tipo: string, intensiva: boolean) =>
          e.inserir(
            `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, intensiva,
               ativo, criado_em) VALUES (?, 0, ?, ?, ?, ?, TRUE, ?)`,
            [est, codigo, `Unidade ${codigo}`, tipo, intensiva, agora],
          );
        const uti = await unidade('C2088UTI', 'uti_adulto', true);
        const enfermaria = await unidade('C2088ENF', 'enfermaria', false);
        const leito = (u: number, codigo: string) =>
          e.inserir(
            `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, codigo, situacao_leito_id,
               ativo, criado_em) VALUES (?, ?, 0, ?, 0, TRUE, ?)`,
            [est, u, codigo, agora],
          );
        const l1 = await leito(uti, 'U01');
        await leito(uti, 'U02');
        const l3 = await leito(enfermaria, 'E01');
        const internar = async (p: number, l: number, u: number, numero: string, atendimento: number) => {
          const i = await e.inserir(
            `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
               carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
               medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
             VALUES (?, ?, ?, ?, NOW(3) - INTERVAL 50 HOUR, 0, 0, ?, 0, 0, 0, 0, 'ativa', ?)`,
            [est, numero, atendimento, p, u, agora],
          );
          await e.executar(
            `INSERT INTO ocupacao_leito (estabelecimento_id, internacao_id, leito_hospitalar_id, unidade_internacao_id,
               acomodacao_id, data_hora_inicio, tipo_movimento, situacao, criado_em)
             VALUES (?, ?, ?, ?, 0, NOW(3) - INTERVAL 50 HOUR, 'admissao', 'ativa', ?)`,
            [est, i, l, u, agora],
          );
        };
        await internar(pac[0]!, l1, uti, 'C2088-I1', 920880901);
        await internar(pac[1]!, l3, enfermaria, 'C2088-I2', 920880902);
        // Farmácia: uma aberta há 40 min e uma já dispensada (fora da fila).
        for (const [numero, situacao] of [
          [9208801, 'aberta'],
          [9208802, 'dispensada'],
        ] as const)
          await e.executar(
            `INSERT INTO dispensacao (estabelecimento_id, numero, tipo, paciente_id, local_estoque_id, dispensado_em,
               dispensado_usuario_id, situacao, atendimento_id, setor_funcional_id, centro_custo_id, criado_em)
             VALUES (?, ?, 'avulsa', ?, 0, NOW(3), ?, ?, 0, 0, 0, NOW(3) - INTERVAL 40 MINUTE)`,
            [est, numero, pac[2], u['id'], situacao],
          );
        const sala = await e.inserir(
          `INSERT INTO sala_cirurgica (estabelecimento_id, unidade_cirurgica_id, codigo, descricao, situacao, criado_em)
           VALUES (?, 0, 'C2088S1', 'Sala 1', 'ativa', ?)`,
          [est, agora],
        );
        // Mapa do dia: uma confirmada logo no início do dia (início atrasado), uma agendada no fim, uma cancelada.
        for (const [numero, situacao, inicio, cancelado] of [
          ['C2088-C1', 'confirmado', 'CURDATE() + INTERVAL 1 MINUTE', null],
          ['C2088-C2', 'agendado', 'CURDATE() + INTERVAL 1439 MINUTE', null],
          ['C2088-C3', 'cancelado', 'CURDATE() + INTERVAL 600 MINUTE', agora],
        ] as const)
          await e.executar(
            `INSERT INTO agendamento_cirurgico (estabelecimento_id, numero, paciente_id, sala_cirurgica_id,
               cirurgiao_profissional_id, carater_cirurgia_id, fonte_pagadora_id, solicitado_em, inicio_previsto_em, duracao_prevista_minutos,
               situacao, cancelado_em, criado_em)
             VALUES (?, ?, ?, ?, 0, 0, 0, NOW(3), ${inicio}, 90, ?, ?, ?)`,
            [est, numero, pac[3], sala, situacao, cancelado, agora],
          );
        // Laboratório: rotina em andamento (no prazo), urgente atrasada, concluída (fora).
        for (const [numero, prioridade, situacao, previsto, pac_] of [
          ['C2088-R1', 'rotina', 'em_andamento', 'NOW(3) + INTERVAL 2 HOUR', pac[4]],
          ['C2088-R2', 'urgente', 'solicitada', 'NOW(3) - INTERVAL 20 MINUTE', pac[5]],
          ['C2088-R3', 'rotina', 'concluida', 'NOW(3) - INTERVAL 1 HOUR', pac[5]],
        ] as const)
          await e.executar(
            `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, fonte_pagadora_id,
               solicitante_profissional_id, tipo_solicitacao, prioridade, situacao, solicitado_em, entrega_prevista_em, criado_em)
             VALUES (?, ?, ?, 0, 0, 0, 'lancado_no_setor', ?, ?, NOW(3) - INTERVAL 30 MINUTE, ${previsto}, ?)`,
            [est, numero, pac_, prioridade, situacao, agora],
          );
        const tv = await e.inserir(
          `INSERT INTO estacao_trabalho (estabelecimento_id, codigo, nome, tipo_estacao, ativo, criado_em)
           VALUES (?, 'C2088TV1', 'TV do corredor da UTI', 'outro', TRUE, ?)`,
          [est, agora],
        );
        return { usuario: Number(u['id']), tipo: Number(t['id']), uti, enfermaria, sala, tv };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  it('cria em rascunho, recusa código repetido e ativar sem bloco, sem gravar', async () => {
    const r = await porta.criar(ctx(), { codigo: 'TV-UTI', tipoId: m.tipo, ...dados });
    painel = r.id;
    expect(await linhaPainel()).toMatchObject({ situacao: 'rascunho', nome: 'TV do corredor' });
    expect((await erro(porta.criar(ctx(), { codigo: 'TV-UTI', tipoId: m.tipo, ...dados }))).texto).toContain(
      'codigo-repetido',
    );
    const e = await erro(porta.mudarSituacao(ctx(), painel, { versao: 1, situacao: 'ativo' }));
    expect(e.status).toBe(422);
    expect(e.texto).toContain('painel-sem-bloco');
    expect(Number((await linhaPainel())['versao'])).toBe(1);
    expect(
      (await ler('SELECT COUNT(*) AS n FROM painel_tv WHERE codigo = ?', ['TV-UTI']))[0]!['n'],
    ).toBeDefined();
  });

  it('salva os quatro blocos com fonte e filtro; unidade não intensiva e versão velha recusadas sem mudar nada', async () => {
    const naoIntensiva = quatro();
    naoIntensiva[0] = bloco({ fonte: 'uti', titulo: 'Enfermaria', unidadeInternacaoId: m.enfermaria });
    const e1 = await erro(porta.salvar(ctx(), painel, { versao: 1, ...dados, blocos: naoIntensiva }));
    expect(e1.texto).toContain('unidade-nao-intensiva');
    expect(await blocos()).toEqual([]);
    const r = await porta.salvar(ctx(), painel, { versao: 1, ...dados, nome: 'TV da UTI', blocos: quatro() });
    expect(r.versao).toBe(2);
    const bs = await blocos();
    expect(
      bs.map((b) => [Number(b['sequencia']), b['fonte'], b['forma_exibicao'], Number(b['excluido'])]),
    ).toEqual([
      [1, 'uti', 'mapa', 0],
      [2, 'farmacia', 'tabela', 0],
      [3, 'mapa_cirurgico', 'tabela', 0],
      [4, 'laboratorio', 'lista', 0],
    ]);
    expect(Number(bs[0]!['unidade'])).toBe(m.uti);
    expect(Number(bs[2]!['sala'])).toBe(m.sala);
    expect((await erro(porta.salvar(ctx(), painel, { versao: 1, ...dados, blocos: [] }))).status).toBe(409);
    expect((await linhaPainel())['nome']).toBe('TV da UTI');
  });

  it('o bloco que sai fica marcado como excluído e volta na mesma linha', async () => {
    const antes = await blocos();
    await porta.salvar(ctx(), painel, {
      versao: 2,
      ...dados,
      nome: 'TV da UTI',
      blocos: quatro().slice(0, 3),
    });
    const meio = await blocos();
    expect(meio.map((b) => Number(b['excluido']))).toEqual([0, 0, 0, 1]);
    await porta.salvar(ctx(), painel, { versao: 3, ...dados, nome: 'TV da UTI', blocos: quatro() });
    const depois = await blocos();
    expect(depois.map((b) => Number(b['excluido']))).toEqual([0, 0, 0, 0]);
    expect(depois.map((b) => Number(b['id']))).toEqual(antes.map((b) => Number(b['id'])));
  });

  it('ativa e a tela lê as quatro fontes na hora, só com iniciais', async () => {
    const a = await porta.mudarSituacao(ctx(), painel, { versao: 4, situacao: 'ativo' });
    expect(a.situacao).toBe('ativo');
    expect((await linhaPainel())['situacao']).toBe('ativo');
    const t = await porta.tela(ctx(), painel);
    const json = JSON.stringify(t);
    for (const nome of NOMES) expect(json).not.toContain(nome.split(' ')[0]!);
    const [uti, farmacia, mapa, lab] = t.blocos;
    // Forma e estado de cada linha vão à TV: o mapa da terapia intensiva marca livre e ocupado; o laboratório, o atraso.
    expect(uti!.forma).toBe('mapa');
    expect(uti!.linhas.map((l) => l['estado']).sort()).toEqual(['livre', 'ocupado']);
    expect(lab!.forma).toBe('lista');
    expect(lab!.linhas.map((l) => l['estado'])).toContain('atrasado');
    expect(uti!.resumo).toEqual([
      { rotulo: 'Leitos', valor: 2 },
      { rotulo: 'Ocupados', valor: 1 },
      { rotulo: 'Livres', valor: 1 },
      { rotulo: 'Ocupação (%)', valor: 50 },
    ]);
    expect(uti!.linhas).toEqual([
      { leito: 'U01', unidade: 'Unidade C2088UTI', paciente: 'T. C. V.', dias: 3, estado: 'ocupado' },
      { leito: 'U02', unidade: 'Unidade C2088UTI', paciente: 'Livre', dias: null, estado: 'livre' },
    ]);
    expect(farmacia!.linhas).toHaveLength(1);
    expect(farmacia!.linhas[0]).toMatchObject({
      numero: '9208801',
      paciente: 'C. N.',
      situacao: 'A separar',
    });
    expect(Number(farmacia!.linhas[0]!['espera'])).toBeGreaterThanOrEqual(40);
    expect(mapa!.tempoEmTelaSegundos).toBe(20);
    expect(mapa!.linhas.map((l) => [l['horario'], l['paciente'], l['situacao']])).toEqual([
      ['00:01', 'D. P.', 'Confirmada'],
      ['23:59', 'D. P.', 'Agendada'],
    ]);
    expect(mapa!.resumo.find((r) => r.rotulo === 'Início atrasado')!.valor).toBe(1);
    expect(mapa!.linhas.map((l) => l['estado'])).toEqual(['atrasada', 'prevista']);
    expect(lab!.linhas.map((l) => [l['numero'], l['prioridade'], l['paciente']])).toEqual([
      ['C2088-R2', 'Urgente', 'F. R.'],
      ['C2088-R1', 'Rotina', 'E. M.'],
    ]);
    expect(Number(lab!.linhas[0]!['atraso'])).toBeGreaterThanOrEqual(20);
    expect(lab!.linhas[1]!['atraso']).toBe(0);
    expect(lab!.resumo).toEqual([
      { rotulo: 'Em aberto', valor: 2 },
      { rotulo: 'Urgentes e emergências', valor: 1 },
      { rotulo: 'Atrasados', valor: 1 },
    ]);
  });

  it('televisor: código com validade, pareamento emite o segredo do aparelho, código usado recusado, desligar recusa a TV e não apaga', async () => {
    const ligado = await porta.ligarDispositivo(ctx(), painel, { estacaoId: m.tv });
    expect(ligado.codigoPareamento).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    const d0 = (
      await ler(
        `SELECT codigo_pareamento, pareado_em, TIMESTAMPDIFF(MINUTE, NOW(3), codigo_expira_em) AS validade
           FROM painel_tv_dispositivo WHERE id = ?`,
        [ligado.id],
      )
    )[0]!;
    expect(d0).toMatchObject({ codigo_pareamento: ligado.codigoPareamento, pareado_em: null });
    expect(Number(d0['validade'])).toBeGreaterThanOrEqual(28);
    expect(Number(d0['validade'])).toBeLessThanOrEqual(30);
    // Código vencido: recusado sem gravar; o cadastro já não mostra o código.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `vencer-${P}` }, (e) =>
      e.executar(
        'UPDATE painel_tv_dispositivo SET codigo_expira_em = NOW(3) - INTERVAL 1 MINUTE WHERE id = ?',
        [ligado.id],
      ),
    );
    expect(
      (await erro(porta.parear(ctx(), { codigo: ligado.codigoPareamento, versaoCliente: null }, null))).texto,
    ).toContain('codigo-invalido');
    expect((await porta.detalhe(ctx(), painel)).televisores[0]).toMatchObject({
      codigoPareamento: null,
      pareado: false,
    });
    expect(
      (
        await ler('SELECT codigo_pareamento, pareado_em FROM painel_tv_dispositivo WHERE id = ?', [ligado.id])
      )[0],
    ).toMatchObject({ codigo_pareamento: ligado.codigoPareamento, pareado_em: null });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `revalidar-${P}` }, (e) =>
      e.executar(
        'UPDATE painel_tv_dispositivo SET codigo_expira_em = NOW(3) + INTERVAL 30 MINUTE WHERE id = ?',
        [ligado.id],
      ),
    );
    expect((await erro(porta.ligarDispositivo(ctx(), painel, { estacaoId: m.tv }))).texto).toContain(
      'televisor-ja-ligado',
    );
    expect(
      (await erro(porta.parear(ctx(), { codigo: 'ZZZZZZ', versaoCliente: null }, null))).texto,
    ).toContain('codigo-invalido');
    const par = await porta.parear(
      ctx(),
      { codigo: ligado.codigoPareamento.toLowerCase(), versaoCliente: 'tv-1.0' },
      '10.0.0.9',
    );
    expect(par).toEqual({ id: ligado.id, painelId: painel, segredo: expect.stringMatching(/^[\w-]{40,}$/) });
    const d1 = (
      await ler(
        `SELECT codigo_pareamento, codigo_expira_em, segredo_resumo, pareado_em IS NOT NULL AS pareado,
                ultimo_contato_em IS NOT NULL AS contato, endereco_ip, versao_cliente
           FROM painel_tv_dispositivo WHERE id = ?`,
        [ligado.id],
      )
    )[0]!;
    expect(d1).toMatchObject({
      codigo_pareamento: null,
      codigo_expira_em: null,
      endereco_ip: '10.0.0.9',
      versao_cliente: 'tv-1.0',
    });
    // O banco guarda só o resumo do segredo, nunca o segredo.
    expect(String(d1['segredo_resumo'])).toMatch(/^[0-9a-f]{64}$/);
    expect(String(d1['segredo_resumo'])).not.toBe(par.segredo);
    expect(Number(d1['pareado'])).toBe(1);
    expect(Number(d1['contato'])).toBe(1);
    expect(
      (await erro(porta.parear(ctx(), { codigo: ligado.codigoPareamento, versaoCliente: null }, null))).texto,
    ).toContain('codigo-invalido');
    // A TV lê o painel dela pelo aparelho; sem o segredo, ou com outro, é recusada (o "no ar" não se forja).
    const telaTv = await porta.telaDoTelevisor(ctx(), ligado.id, par.segredo);
    expect(telaTv).toMatchObject({ id: painel, televisorId: ligado.id, situacao: 'ativo' });
    expect(telaTv.blocos).toHaveLength(4);
    expect((await erro(porta.telaDoTelevisor(ctx(), ligado.id, null))).status).toBe(404);
    expect((await erro(porta.telaDoTelevisor(ctx(), ligado.id, 'outro-aparelho'))).status).toBe(404);
    expect((await erro(porta.contato(ctx(), ligado.id, 'outro-aparelho', null))).status).toBe(404);
    await porta.contato(ctx(), ligado.id, par.segredo, '10.0.0.10');
    const lista = await porta.paineis(ctx());
    expect(lista).toEqual([
      expect.objectContaining({ id: painel, situacao: 'ativo', blocos: 4, televisores: 1, noAr: true }),
    ]);
    await porta.desligarDispositivo(ctx(), painel, ligado.id);
    const d2 = (
      await ler('SELECT ativo, excluido_em IS NOT NULL AS excluido FROM painel_tv_dispositivo WHERE id = ?', [
        ligado.id,
      ])
    )[0]!;
    expect(Number(d2['ativo'])).toBe(0);
    expect(Number(d2['excluido'])).toBe(1);
    // Desligado: a TV deixa de exibir e de avisar contato, mesmo com o segredo que recebeu.
    expect((await erro(porta.telaDoTelevisor(ctx(), ligado.id, par.segredo))).status).toBe(404);
    expect((await erro(porta.contato(ctx(), ligado.id, par.segredo, null))).status).toBe(404);
    expect(
      (await ler('SELECT segredo_resumo FROM painel_tv_dispositivo WHERE id = ?', [ligado.id]))[0],
    ).toMatchObject({ segredo_resumo: null });
    expect((await porta.detalhe(ctx(), painel)).televisores).toEqual([]);
  });
});
