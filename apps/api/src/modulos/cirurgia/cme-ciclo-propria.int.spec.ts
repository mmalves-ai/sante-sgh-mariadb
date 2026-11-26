// Contrato de efeito do ciclo de esterilização pelos testes dos indicadores e da rejeição no reprocessamento (CME; F7,
// 04-CME linha 116; RDC 15/2012) contra o MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimentos com o
// código do teste, método, tipos de indicador, fases e motivos de rejeição fictícios, paciente, caráter e agendamento
// cirúrgico fictícios; usuário, profissional, produto do estoque e setor são ids já existentes do cliente de teste (só
// os ids são lidos).
// Prova o que fica no banco: o ciclo sem teste não se encerra (422, sem escrita); o teste lido sem hora de leitura e o
// biológico aprovado sem controle são recusados sem escrita; os testes ficam com sequência, lote, validade, leitura,
// resultado e responsável; o encerramento libera o ciclo pelos testes aprovados (indicadores gravados, pacotes
// estéreis); a rejeição do pacote estéril o deixa rejeitado e a rejeição fica concluída; a rejeição do ciclo liberado o
// reprova, rejeita o pacote que estava na CME e põe em recolhimento o distribuído; o recolhimento o traz de volta e
// conclui a rejeição; o teste reprovado reprova o outro ciclo e rejeita os pacotes; tudo na trilha; a sessão de outro
// estabelecimento não enxerga o ciclo (404). Nada é apagado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaCmeCicloPropria } from './cme-ciclo-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c3014cic';
const P2 = `${P}b`;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(`DELETE FROM rejeicao_reprocessamento WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE t FROM teste_ciclo_esterilizacao t JOIN ciclo_esterilizacao c ON c.id = t.ciclo_esterilizacao_id
      WHERE c.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(
    `DELETE mi FROM movimento_material_esteril_item mi JOIN movimento_material_esteril m
        ON m.id = mi.movimento_material_esteril_id WHERE m.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM movimento_material_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM ciclo_esterilizacao_item i JOIN ciclo_esterilizacao c ON c.id = i.ciclo_esterilizacao_id
      WHERE c.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(
    `DELETE x FROM pacote_esteril_conteudo x JOIN pacote_esteril p ON p.id = x.pacote_esteril_id
      WHERE p.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM pacote_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM ciclo_esterilizacao WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM equipamento_esterilizacao WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM caixa_instrumental_item i JOIN caixa_instrumental c ON c.id = i.caixa_instrumental_id
      WHERE c.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM caixa_instrumental WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM agendamento_cirurgico WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar('DELETE FROM motivo_rejeicao_reprocessamento WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM fase_reprocessamento WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM tipo_indicador_esterilizacao WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM metodo_esterilizacao WHERE codigo = ?', [`${P}-VAP`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

interface Massa {
  usuario: number;
  metodo: number;
  insumo: number;
  setor: number;
  agendamento: number;
  fisico: number;
  quimico: number;
  biologico: number;
  limpeza: number;
  esterilizacao: number;
  motivoSimples: number;
  motivoRecolhe: number;
}

describe.skipIf(SEM_BANCO)('PortaCmeCicloPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCmeCicloPropria;
  let m: Massa;
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0] ?? {};
  const erro = async (pr: Promise<unknown>) => {
    try {
      await pr;
    } catch (e) {
      const x = e as { problema?: { status?: number } };
      return x.problema?.status;
    }
    throw new Error('Esperava recusa.');
  };
  const situacao = async (pacote: number) =>
    String((await um('SELECT situacao FROM pacote_esteril WHERE id = ?', [pacote]))['situacao']);
  const versao = async (ciclo: number) =>
    Number((await um('SELECT versao FROM ciclo_esterilizacao WHERE id = ?', [ciclo]))['versao']);
  const testes = async (ciclo: number) =>
    Number(
      (await um('SELECT COUNT(*) AS n FROM teste_ciclo_esterilizacao WHERE ciclo_esterilizacao_id = ?', [ciclo]))[
        'n'
      ],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaCmeCicloPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const cirurgiao = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const insumo = await e.uma('SELECT MIN(id) AS id FROM insumo WHERE excluido_em IS NULL');
      const setor = await e.uma('SELECT MIN(id) AS id FROM setor_funcional');
      if (!usuario?.['id'] || !cirurgiao?.['id'] || !insumo?.['id'] || !setor?.['id'])
        throw new Error('O cliente de teste precisa de usuário, profissional, produto e setor.');
      const g = async (sql: string, args: unknown[], ins: string, iargs: unknown[]) =>
        Number((await e.uma(sql, args))?.['id'] ?? (await e.inserir(ins, iargs)));
      const pf = await g(
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      const paciente = await g(
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 933014, 'ativo', ?)",
        [pf, agora],
      );
      const carater = await g(
        'SELECT id FROM carater_cirurgia WHERE codigo = ?',
        [`${P}-ELE`],
        'INSERT INTO carater_cirurgia (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-ELE`, `CARATER SINTETICO ${P}`, agora],
      );
      const novoEst = (c: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [c, `Hospital sintético ${c}`, `Hospital sintético ${c} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const metodo = await e.inserir(
        "INSERT INTO metodo_esterilizacao (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'esterilizacao', ?)",
        [`${P}-VAP`, `VAPOR SINTETICO ${P}`, agora],
      );
      const agendamento = await e.inserir(
        `INSERT INTO agendamento_cirurgico (estabelecimento_id, numero, paciente_id, cirurgiao_profissional_id,
                                            carater_cirurgia_id, tipo_cobertura, solicitado_em, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, 'particular', ?, 'solicitado', ?)`,
        [est, `${P}-1`, paciente, cirurgiao['id'], carater, agora, agora],
      );
      const tipo = (cod: string, categoria: string, lote: boolean, controle: boolean) =>
        e.inserir(
          `INSERT INTO tipo_indicador_esterilizacao (codigo, descricao, categoria, exige_lote, exige_controle, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [`${P}-${cod}`, `INDICADOR SINTETICO ${cod}`, categoria, lote, controle, agora],
        );
      const fase = (cod: string, ordem: number) =>
        e.inserir('INSERT INTO fase_reprocessamento (codigo, descricao, ordem, criado_em) VALUES (?, ?, ?, ?)', [
          `${P}-${cod}`,
          `FASE SINTETICA ${cod}`,
          ordem,
          agora,
        ]);
      const motivo = (cod: string, recolhe: boolean) =>
        e.inserir(
          'INSERT INTO motivo_rejeicao_reprocessamento (codigo, descricao, exige_recolhimento, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}-${cod}`, `MOTIVO SINTETICO ${cod}`, recolhe, agora],
        );
      return {
        usuario: Number(usuario['id']),
        metodo,
        insumo: Number(insumo['id']),
        setor: Number(setor['id']),
        agendamento,
        fisico: await tipo('FIS', 'fisico', false, false),
        quimico: await tipo('QUI', 'quimico', true, false),
        biologico: await tipo('BIO', 'biologico', true, true),
        limpeza: await fase('LIM', 241),
        esterilizacao: await fase('EST', 244),
        motivoSimples: await motivo('EMB', false),
        motivoRecolhe: await motivo('IND', true),
      };
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  let equipamento = 0;
  let caixa = 0;
  const pacotes: number[] = [];
  let ciclo = 0;
  const leitura = '2026-11-26T10:00';

  it('abre a carga e não encerra sem teste (422, sem escrita)', async () => {
    caixa = (
      await porta.criarCaixa(ctx(), {
        codigo: 'CX-C3014',
        descricao: 'Caixa sintética do ciclo',
        validadeDias: 30,
        metodo: m.metodo,
        itens: [{ insumo: m.insumo, quantidade: 1, pecaMestre: true }],
      })
    ).caixa;
    equipamento = (
      await porta.criarEquipamento(ctx(), {
        codigo: 'AC-C3014',
        descricao: 'Autoclave sintética',
        natureza: 'autoclave',
        metodo: m.metodo,
      })
    ).equipamento as number;
    for (let i = 0; i < 3; i++) pacotes.push((await porta.prepararPacote(ctx(), { caixa })).pacote);
    ciclo = (await porta.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes })).ciclo;
    const v = await versao(ciclo);
    expect(await erro(porta.encerrar(ctx(), ciclo, { versao: v }))).toBe(422);
    const c = await um('SELECT situacao, versao, fim_em FROM ciclo_esterilizacao WHERE id = ?', [ciclo]);
    expect(c).toMatchObject({ situacao: 'em_andamento', fim_em: null });
    expect(Number(c['versao'])).toBe(v);
  });

  it('recusa teste lido sem hora e biológico sem controle; grava os testes com responsável', async () => {
    expect(
      await erro(porta.registrarTeste(ctx(), ciclo, { tipo: m.quimico, resultado: 'aprovado', lote: 'LQ1' })),
    ).toBe(422);
    expect(
      await erro(
        porta.registrarTeste(ctx(), ciclo, {
          tipo: m.biologico,
          resultado: 'aprovado',
          lote: 'LB1',
          incubacaoInicio: '2026-11-26T08:00',
          leitura,
          controlePositivoOk: false,
        }),
      ),
    ).toBe(422);
    expect(await testes(ciclo)).toBe(0);
    await porta.registrarTeste(ctx(), ciclo, { tipo: m.fisico, resultado: 'aprovado', leitura, valorMedido: '134 C' });
    // O químico inconclusivo é repetido: vale o último teste do tipo, e o repetido aprovado libera.
    await porta.registrarTeste(ctx(), ciclo, { tipo: m.quimico, resultado: 'inconclusivo', lote: 'LQ0', leitura });
    expect((await porta.ciclo(ctx(), ciclo)).indicadores.quimico).toBe('pendente');
    await porta.registrarTeste(ctx(), ciclo, {
      tipo: m.quimico,
      resultado: 'aprovado',
      lote: 'LQ1',
      validade: '2027-12-31',
      leitura,
    });
    const ts = await ler(
      `SELECT sequencia, resultado, lote_indicador, validade_indicador, leitura_em, responsavel_usuario_id, criado_por
         FROM teste_ciclo_esterilizacao WHERE ciclo_esterilizacao_id = ? ORDER BY sequencia`,
      [ciclo],
    );
    expect(ts.map((t) => Number(t['sequencia']))).toEqual([1, 2, 3]);
    expect(ts[1]).toMatchObject({ resultado: 'inconclusivo', lote_indicador: 'LQ0' });
    expect(ts[2]).toMatchObject({ resultado: 'aprovado', lote_indicador: 'LQ1' });
    expect(ts.every((t) => Number(t['responsavel_usuario_id']) === m.usuario && t['leitura_em'])).toBe(true);
    const lido = await porta.ciclo(ctx(), ciclo);
    expect(lido.indicadores).toEqual({ fisico: 'conforme', quimico: 'conforme', biologico: 'pendente' });
  });

  it('encerra pelos testes aprovados: ciclo liberado com indicadores e pacotes estéreis', async () => {
    const r = await porta.encerrar(ctx(), ciclo, { versao: await versao(ciclo), temperatura: 134 });
    expect(r.situacao).toBe('liberado');
    const c = await um(
      `SELECT situacao, indicador_fisico, indicador_quimico, indicador_biologico, liberado_em, temperatura_c
         FROM ciclo_esterilizacao WHERE id = ?`,
      [ciclo],
    );
    expect(c).toMatchObject({ situacao: 'liberado' });
    expect([Number(c['indicador_fisico']), Number(c['indicador_quimico']), Number(c['indicador_biologico'])]).toEqual(
      [1, 1, 0],
    );
    expect(c['liberado_em']).not.toBeNull();
    for (const p of pacotes) expect(await situacao(p)).toBe('esteril');
  });

  it('rejeita o pacote estéril: pacote rejeitado e rejeição concluída', async () => {
    await porta.entregar(ctx(), pacotes[0]!, { agendamento: m.agendamento, cme: m.setor, setor: m.setor });
    expect(await situacao(pacotes[0]!)).toBe('distribuido');
    expect(
      await erro(
        porta.rejeitar(ctx(), {
          objeto: 'pacote',
          pacote: pacotes[1],
          motivo: m.motivoSimples,
          fase: m.limpeza,
          faseRetorno: m.esterilizacao,
        }),
      ),
    ).toBe(422);
    const r = await porta.rejeitar(ctx(), {
      objeto: 'pacote',
      pacote: pacotes[1],
      motivo: m.motivoSimples,
      fase: m.esterilizacao,
      faseRetorno: m.limpeza,
      descricao: 'Embalagem violada (sintético)',
    });
    expect(r.situacao).toBe('concluida');
    expect(await situacao(pacotes[1]!)).toBe('rejeitado');
    expect(await situacao(pacotes[2]!)).toBe('esteril');
    const rj = await um(
      'SELECT situacao, retorno_fase_reprocessamento_id, rejeitado_por_usuario_id FROM rejeicao_reprocessamento WHERE id = ?',
      [r.rejeicao],
    );
    expect(rj).toMatchObject({ situacao: 'concluida' });
    expect(Number(rj['retorno_fase_reprocessamento_id'])).toBe(m.limpeza);
    expect(Number(rj['rejeitado_por_usuario_id'])).toBe(m.usuario);
  });

  it('rejeita o ciclo liberado: reprovado, pacote na CME rejeitado e o distribuído em recolhimento', async () => {
    const r = await porta.rejeitar(ctx(), {
      objeto: 'ciclo',
      ciclo,
      motivo: m.motivoRecolhe,
      fase: m.esterilizacao,
      faseRetorno: m.limpeza,
      descricao: 'Biológico do dia positivo (sintético)',
    });
    expect(r).toMatchObject({ situacao: 'em_recolhimento', distribuidos: 1 });
    expect((await um('SELECT situacao FROM ciclo_esterilizacao WHERE id = ?', [ciclo]))['situacao']).toBe(
      'reprovado',
    );
    expect(await situacao(pacotes[2]!)).toBe('rejeitado');
    expect(await situacao(pacotes[0]!)).toBe('distribuido');
    expect(
      await erro(porta.recolher(ctx(), r.rejeicao as number, { pacote: pacotes[2] })),
    ).toBe(422);
    const painel = await porta.painelCiclos(ctx());
    expect(painel.rejeicoes.find((x) => x.id === r.rejeicao)).toMatchObject({ pendentes: 1, exigeRecolhimento: true });
    const v = await porta.recolher(ctx(), r.rejeicao as number, { pacote: pacotes[0] });
    expect(v).toMatchObject({ pendentes: 0, situacao: 'concluida' });
    expect(await situacao(pacotes[0]!)).toBe('rejeitado');
    const rj = await um(
      'SELECT situacao, pacotes_recolhidos, recolhimento_concluido_em, exige_recolhimento FROM rejeicao_reprocessamento WHERE id = ?',
      [r.rejeicao],
    );
    expect(rj).toMatchObject({ situacao: 'concluida' });
    expect(Number(rj['pacotes_recolhidos'])).toBe(1);
    expect(Number(rj['exige_recolhimento'])).toBe(1);
    expect(rj['recolhimento_concluido_em']).not.toBeNull();
  });

  it('teste reprovado reprova o ciclo e rejeita os pacotes; trilha e outro estabelecimento', async () => {
    const p = (await porta.prepararPacote(ctx(), { caixa })).pacote;
    const c2 = (await porta.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes: [p] })).ciclo;
    await porta.registrarTeste(ctx(), c2, { tipo: m.fisico, resultado: 'aprovado', leitura, valorMedido: '134 C' });
    await porta.registrarTeste(ctx(), c2, { tipo: m.quimico, resultado: 'reprovado', lote: 'LQ2', leitura });
    const r = await porta.encerrar(ctx(), c2, { versao: await versao(c2) });
    expect(r.situacao).toBe('reprovado');
    expect(await situacao(p)).toBe('rejeitado');
    expect(await erro(porta.ciclo(ctx(P2), c2))).toBe(404);
    expect(
      await erro(porta.registrarTeste(ctx(P2), c2, { tipo: m.fisico, resultado: 'pendente' })),
    ).toBe(404);
    const trilha = await um(
      `SELECT COUNT(*) AS n FROM trilha_auditoria t JOIN estabelecimento e ON e.id = t.estabelecimento_id
        WHERE e.codigo = ? AND t.entidade IN ('teste_ciclo_esterilizacao', 'rejeicao_reprocessamento')`,
      [P],
    );
    expect(Number(trilha['n'])).toBeGreaterThanOrEqual(6);
    expect(await testes(c2)).toBe(2);
  });
});
