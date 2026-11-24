// Contrato de efeito dos leitos do sistema público (F78.04-2, 04-INT linha 79) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste e três leitos fictícios (chaves de unidade e
// acomodação desligadas só no preparo); a especialidade de leito e o usuário são ids já existentes do cliente (só lidos).
// Prova o que fica no banco: a habilitação com portaria e vigência, a recusa do código repetido, os leitos no programa
// até a quantidade habilitada (o terceiro é recusado sem gravar), a saída do programa que libera a vaga sem apagar, a
// capacidade como histórico (inclusão, alteração com liberação nominal e retirada, cada uma uma linha nova com o
// retrato), o teto de diárias, o encerramento da habilitação que fecha os leitos abertos, o isolamento por
// estabelecimento e a trilha da operação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaLeitosSusPropria } from './leitos-sus-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f7804sus';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE v FROM leito_habilitado_sus v JOIN habilitacao_leito_sus h ON h.id = v.habilitacao_leito_sus_id
        WHERE h.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM habilitacao_leito_sus WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM capacidade_leito_sus WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM leito_hospitalar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM especialidade_leito WHERE versao_fonte = ?', [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaLeitosSusPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaLeitosSusPropria;
  let m: { est: number; usuario: number; esp: number; leitos: number[] };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!usuario?.['id']) throw new Error('O cliente de teste precisa de usuário.');
      // Especialidade de leito: a do catálogo quando houver; senão uma sintética (removida na limpeza).
      let esp = await e.uma('SELECT MIN(id) AS id FROM especialidade_leito');
      if (!esp?.['id'])
        esp = {
          id: await e.inserir(
            `INSERT INTO especialidade_leito (codigo_cnes, descricao, codigo_cnes_tipo_leito, vigencia_inicio, versao_fonte, criado_em)
             VALUES ('Z9', ?, '9', '2000-01-01', ?, ?)`,
            [`Especialidade sintética ${P}`, P, agora],
          ),
        };
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const leitos: number[] = [];
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const cod of ['L1', 'L2', 'L3'])
          leitos.push(
            await e.inserir(
              `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, situacao_leito_id, codigo, criado_em)
               VALUES (?, 999999991, 999999991, 999999991, ?, ?)`,
              [est, `${P}-${cod}`, agora],
            ),
          );
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
      return { est, usuario: Number(usuario['id']), esp: Number(esp['id']), leitos };
    });
    porta = new PortaLeitosSusPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  let hab = 0;
  const habilitacao = {
    codigo: '2601',
    nome: 'UTI adulto tipo II (sintética)',
    numeroPortaria: '1/2025',
    dataPortaria: '2025-01-10',
    vigenciaInicio: '2025-02-01',
    quantidadeLeitosHabilitados: 2,
  };

  it('grava a habilitação com portaria e vigência e recusa o código repetido e a portaria pela metade', async () => {
    hab = (await porta.incluirHabilitacao(ctx(), habilitacao)).id;
    const [h] = await ler(
      'SELECT estabelecimento_id, codigo, numero_portaria, quantidade_leitos_habilitados, tipo_atendimento, ativo, criado_por FROM habilitacao_leito_sus WHERE id = ?',
      [hab],
    );
    expect(h).toMatchObject({
      estabelecimento_id: m.est,
      codigo: '2601',
      numero_portaria: '1/2025',
      quantidade_leitos_habilitados: 2,
      tipo_atendimento: 'internacao',
      ativo: 1,
      criado_por: m.usuario,
    });
    await expect(porta.incluirHabilitacao(ctx(), habilitacao)).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(
      porta.incluirHabilitacao(ctx(), { ...habilitacao, codigo: 'X', dataPortaria: null }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const [n] = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM habilitacao_leito_sus WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(Number(n!.n)).toBe(1);
  });

  it('põe leitos no programa até a quantidade habilitada; a saída libera a vaga sem apagar', async () => {
    const [l1, l2, l3] = m.leitos as [number, number, number];
    await porta.vincularLeito(ctx(), hab, { leito: l1, vigenciaInicio: '2025-02-01' });
    const v2 = (await porta.vincularLeito(ctx(), hab, { leito: l2, vigenciaInicio: '2025-02-01' })).id;
    await expect(
      porta.vincularLeito(ctx(), hab, { leito: l3, vigenciaInicio: '2025-03-01' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.vincularLeito(ctx(), hab, { leito: l1, vigenciaInicio: '2025-03-01' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.vincularLeito(ctx(), hab, { leito: l3, vigenciaInicio: '2025-01-01' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const lidos = await porta.leitos(ctx(), hab);
    const v = lidos.find((x) => x.id === v2)!;
    await porta.encerrarVinculo(ctx(), v2, { vigenciaFim: '2025-02-28', versao: v.versao });
    await porta.vincularLeito(ctx(), hab, { leito: l3, vigenciaInicio: '2025-03-01' });
    const linhas = await ler<{ leito_hospitalar_id: number; vigencia_fim: unknown }>(
      'SELECT leito_hospitalar_id, vigencia_fim FROM leito_habilitado_sus WHERE habilitacao_leito_sus_id = ? ORDER BY id',
      [hab],
    );
    expect(linhas.map((x) => [x.leito_hospitalar_id, x.vigencia_fim === null])).toEqual([
      [l1, true],
      [l2, false],
      [l3, true],
    ]);
    expect((await porta.habilitacoes(ctx())).find((x) => x.id === hab)?.leitosNoPrograma).toBe(2);
  });

  it('capacidade é histórico: inclusão, alteração com liberação nominal e retirada, cada uma uma linha nova', async () => {
    const base = { especialidade: m.esp, competencia: '2025-03-01' };
    const a = await porta.registrarCapacidade(ctx(), { ...base, quantidadeLeitos: 10 });
    expect(a).toMatchObject({ operacao: 'inclusao', tetoDiarias: 310 });
    await expect(porta.registrarCapacidade(ctx(), { ...base, quantidadeLeitos: 10 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(
      porta.registrarCapacidade(ctx(), { ...base, competencia: '2025-03-02', quantidadeLeitos: 1 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const b = await porta.registrarCapacidade(ctx(), {
      ...base,
      quantidadeLeitos: 12,
      criticaLiberada: true,
    });
    expect(b).toMatchObject({ operacao: 'alteracao', tetoDiarias: 372 });
    let cap = await porta.capacidade(ctx(), '2025-03-01');
    expect(cap).toHaveLength(1);
    expect(cap[0]).toMatchObject({ quantidadeLeitos: 12, criticaLiberada: true, tetoDiarias: 372 });
    expect(cap[0]!.historico.map((h) => h.operacao)).toEqual(['inclusao', 'alteracao']);
    await porta.registrarCapacidade(ctx(), { ...base, excluir: true });
    cap = await porta.capacidade(ctx(), '2025-03-01');
    expect(cap[0]).toMatchObject({ quantidadeLeitos: 0, tetoDiarias: 0 });
    const linhas = await ler<Record<string, unknown>>(
      `SELECT operacao, quantidade_leitos, critica_liberada, liberada_por_usuario_id, usuario_id, dados
         FROM capacidade_leito_sus WHERE estabelecimento_id = ? ORDER BY id`,
      [m.est],
    );
    expect(linhas.map((x) => [x['operacao'], x['quantidade_leitos'], x['critica_liberada']])).toEqual([
      ['inclusao', 10, 0],
      ['alteracao', 12, 1],
      ['exclusao', 12, 0],
    ]);
    expect(linhas[1]!['liberada_por_usuario_id']).toBe(m.usuario);
    expect(linhas.every((x) => x['usuario_id'] === m.usuario)).toBe(true);
    const dados =
      typeof linhas[1]!['dados'] === 'string' ? JSON.parse(String(linhas[1]!['dados'])) : linhas[1]!['dados'];
    expect(dados).toMatchObject({ anterior: { quantidadeLeitos: 10 }, quantidadeLeitos: 12 });
  });

  it('encerrar a habilitação grava o fim e fecha os leitos abertos (nada apagado); trilha registrada', async () => {
    const h = (await porta.habilitacoes(ctx())).find((x) => x.id === hab)!;
    await porta.encerrarHabilitacao(ctx(), hab, { vigenciaFim: '2025-06-30', versao: h.versao });
    const [r] = await ler<Record<string, unknown>>(
      'SELECT vigencia_fim, versao FROM habilitacao_leito_sus WHERE id = ?',
      [hab],
    );
    expect(String((r!['vigencia_fim'] as Date).toISOString()).slice(0, 10)).toBe('2025-06-30');
    const abertos = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM leito_habilitado_sus WHERE habilitacao_leito_sus_id = ? AND vigencia_fim IS NULL',
      [hab],
    );
    expect(Number(abertos[0]!.n)).toBe(0);
    const total = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM leito_habilitado_sus WHERE habilitacao_leito_sus_id = ?',
      [hab],
    );
    expect(Number(total[0]!.n)).toBe(3);
    await expect(
      porta.encerrarHabilitacao({ ...ctx(), hospital: 'inexistente-x' }, hab, {
        vigenciaFim: '2025-07-01',
        versao: 2,
      }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    const trilha = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?
          AND entidade IN ('habilitacao_leito_sus', 'leito_habilitado_sus', 'capacidade_leito_sus')`,
      [m.est, m.usuario],
    );
    expect(Number(trilha[0]!.n)).toBeGreaterThanOrEqual(9);
  });
});
