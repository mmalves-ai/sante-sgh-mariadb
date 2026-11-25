// Contrato de efeito da programação físico-orçamentária, dos tetos e das cotas SUS (F7, 06-SUS linha 54) contra o MariaDB
// real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, dois setores, a competência do BPA e
// uma folha com três linhas de produção (removidos na limpeza); procedimento, grupo, CBO, município, conta e usuários são
// ids já existentes do cliente (só lidos). Prova o que fica no banco: a importação da programação (rascunho e metas com
// o grupo e o procedimento resolvidos) e a recusa sem gravar; a ativação que encerra a anterior na véspera; teto e cota
// incluídos e inativados sem apagar; o saldo da competência e a crítica do BPA que consulta o saldo (cota, teto que
// bloqueia e programação); o remanejamento pedido, recusado acima do saldo, não decidido por quem pediu e aprovado por
// outra pessoa (origem perde, destino nasce); o isolamento por estabelecimento e a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaProgramacaoSusPropria } from './programacao-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2114fpo';
const P2 = 'c2114fpo2';
const COMP = '202601';

async function limpar(e: Escritor): Promise<void> {
  const est = `SELECT id FROM estabelecimento WHERE codigo IN (?, ?)`;
  await e.executar(
    `DELETE t FROM transferencia_cota_sus t JOIN cota_procedimento_sus c ON c.id = t.cota_procedimento_sus_id
      WHERE c.estabelecimento_id IN (${est})`,
    [P, P2],
  );
  await e.executar(`DELETE FROM cota_procedimento_sus WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM teto_financeiro_sus WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(
    `DELETE i FROM programacao_orcamentaria_sus_item i
       JOIN programacao_orcamentaria_sus x ON x.id = i.programacao_orcamentaria_sus_id
      WHERE x.estabelecimento_id IN (${est})`,
    [P, P2],
  );
  await e.executar(`DELETE FROM programacao_orcamentaria_sus WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(
    `DELETE i FROM producao_ambulatorial_sus_item i
       JOIN producao_ambulatorial_sus f ON f.id = i.producao_ambulatorial_sus_id
      WHERE f.estabelecimento_id IN (${est})`,
    [P, P2],
  );
  await e.executar(`DELETE FROM producao_ambulatorial_sus WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM competencia_sus WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaProgramacaoSusPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProgramacaoSusPropria;
  let m: {
    est: number;
    u1: number;
    u2: number;
    s1: number;
    s2: number;
    proc: string;
    grupo: string;
    conta: number;
    mun: string;
  };
  const ctx = (usuario = m.u1, hospital = P) => ({ cliente: CLIENTE, hospital, usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.consultar('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 2');
      if (us.length < 2) throw new Error('O cliente de teste precisa de dois usuários.');
      const pr = await e.uma(
        `SELECT p.id, p.codigo_sigtap FROM procedimento_sigtap p
          WHERE EXISTS (SELECT 1 FROM grupo_sigtap g WHERE g.codigo_sigtap = LEFT(p.codigo_sigtap, 4))
          ORDER BY p.id LIMIT 1`,
      );
      const cbo = await e.uma('SELECT MIN(id) AS id FROM ocupacao_cbo');
      const conta = await e.uma('SELECT MIN(id) AS id FROM conta_hospitalar');
      const mun = await e.uma('SELECT codigo_ibge FROM municipio_ibge ORDER BY id LIMIT 1');
      if (!pr || !cbo?.['id'] || !conta?.['id'] || !mun)
        throw new Error('Catálogos do cliente de teste incompletos.');
      const novoEst = (cod: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [cod, `Hospital sintético ${cod}`, `Hospital sintético ${cod} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const setor = (cod: string) =>
        e.inserir(
          `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
           VALUES (?, ?, ?, 'assistencial', ?)`,
          [est, `${P}${cod}`, `Setor sintético ${cod}`, agora],
        );
      const s1 = await setor('a');
      const s2 = await setor('b');
      const comp = await e.inserir(
        `INSERT INTO competencia_sus (estabelecimento_id, instrumento, competencia, periodo_inicio, periodo_fim, aberta_em,
                                      criado_em)
         VALUES (?, 'bpa', ?, '2026-01-01', '2026-01-31', ?, ?)`,
        [est, COMP, agora, agora],
      );
      const folha = await e.inserir(
        `INSERT INTO producao_ambulatorial_sus (estabelecimento_id, competencia_sus_id, tipo_folha, numero_folha, criado_em)
         VALUES (?, ?, 'consolidado', 1, ?)`,
        [est, comp, agora],
      );
      for (const [seq, q] of [
        [1, 2],
        [2, 2],
        [3, 1],
      ] as const)
        await e.inserir(
          `INSERT INTO producao_ambulatorial_sus_item (producao_ambulatorial_sus_id, sequencia, procedimento_sigtap_id,
                  ocupacao_cbo_id, quantidade, executante_setor_funcional_id, conta_hospitalar_id, data_atendimento,
                  valor_total, idade_anos, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 40, ?)`,
          [folha, seq, pr['id'], cbo['id'], q, s1, conta['id'], `2026-01-0${seq}`, agora],
        );
      return {
        est,
        u1: Number(us[0]!['id']),
        u2: Number(us[1]!['id']),
        s1,
        s2,
        proc: String(pr['codigo_sigtap']),
        grupo: String(pr['codigo_sigtap']).slice(0, 4),
        conta: Number(conta['id']),
        mun: String(mun['codigo_ibge']),
      };
    });
    porta = new PortaProgramacaoSusPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  it('importa e ativa a programação; o arquivo com problema não grava nada', async () => {
    await expect(
      porta.importar(ctx(), { vigenciaInicio: '2026-01-01', conteudo: `${m.grupo};10\n123;5` }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.importar(ctx(), { vigenciaInicio: '2026-01-01', conteudo: '9999999999;5' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.importar(ctx(), { vigenciaInicio: '2026-01-02', conteudo: `${m.grupo};10` }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(
      await ler('SELECT id FROM programacao_orcamentaria_sus WHERE estabelecimento_id = ?', [m.est]),
    ).toEqual([]);

    const r = await porta.importar(ctx(), {
      descricao: 'Programação sintética',
      vigenciaInicio: '2026-01-01',
      conteudo: `codigo;quantidade;valor\n${m.grupo};100;5,00\n${m.proc};4;10`,
    });
    expect(r).toMatchObject({ itens: 2, valorTotal: 540 });
    const [x] = await ler(
      `SELECT situacao, forma_entrada, valor_total, criado_por, versao FROM programacao_orcamentaria_sus WHERE id = ?`,
      [r.id],
    );
    expect(x).toMatchObject({ situacao: 'rascunho', forma_entrada: 'importada', criado_por: m.u1 });
    expect(Number(x!['valor_total'])).toBe(540);
    const itens = await ler(
      `SELECT nivel, grupo_sigtap_id IS NOT NULL AS g, procedimento_sigtap_id IS NOT NULL AS p, quantidade_orcada
         FROM programacao_orcamentaria_sus_item WHERE programacao_orcamentaria_sus_id = ? ORDER BY sequencia`,
      [r.id],
    );
    expect(
      itens.map((i) => [i['nivel'], Number(i['g']), Number(i['p']), Number(i['quantidade_orcada'])]),
    ).toEqual([
      ['subgrupo', 1, 0, 100],
      ['procedimento', 0, 1, 4],
    ]);
    expect((await porta.itens(ctx(), r.id)).map((i) => i.codigo)).toEqual([m.grupo, m.proc]);
    await porta.ativar(ctx(), r.id, { versao: 1 });
    await expect(porta.ativar(ctx(), r.id, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
  });

  it('teto e cota; o saldo da competência e a crítica do BPA consultam o limite', async () => {
    await expect(
      porta.incluirLimite(ctx(), {
        tipo: 'cota',
        instrumento: 'todos',
        vigenciaInicio: '2026-01-01',
        quantidade: 3,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const teto = await porta.incluirLimite(ctx(), {
      tipo: 'teto',
      instrumento: 'todos',
      vigenciaInicio: '2026-01-01',
      valor: 25,
      percentualAlerta: 80,
      bloqueia: true,
    });
    const cotaA = await porta.incluirLimite(ctx(), {
      tipo: 'cota',
      instrumento: 'bpa',
      setor: m.s1,
      procedimento: m.proc,
      vigenciaInicio: '2026-01-01',
      quantidade: 3,
    });
    const cotaB = await porta.incluirLimite(ctx(), {
      tipo: 'cota',
      instrumento: 'bpa',
      setor: m.s1,
      grupo: m.grupo,
      municipio: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: '2026-12-31',
      quantidade: 10,
      valor: 100,
    });
    const [ct] = await ler(
      'SELECT quantidade_cota, setor_funcional_id, procedimento_sigtap_id IS NOT NULL AS p, ativo FROM cota_procedimento_sus WHERE id = ?',
      [cotaA.id],
    );
    expect(ct).toMatchObject({ setor_funcional_id: m.s1, ativo: 1 });
    expect(Number(ct!['quantidade_cota'])).toBe(3);

    const painel = await porta.painel(ctx(), COMP);
    expect(painel.registros).toEqual({ bpa: 3, apac: 0, aih: 0 });
    const s = (tipo: string, id: number) => painel.saldos.find((x) => x.tipo === tipo && x.id === id);
    expect(s('teto', teto.id)).toMatchObject({
      consumoValor: 30,
      saldoValor: -5,
      situacao: 'excedido',
      excedentes: 1,
    });
    expect(s('cota', cotaA.id)).toMatchObject({ consumoQuantidade: 5, saldoQuantidade: -2, excedentes: 2 });
    expect(s('cota', cotaB.id)).toMatchObject({
      consumoQuantidade: 5,
      saldoQuantidade: 5,
      situacao: 'livre',
    });
    expect(
      painel.saldos
        .filter((x) => x.tipo === 'programacao')
        .map((x) => x.situacao)
        .sort(),
    ).toEqual(['excedido', 'livre']);

    const criticas = await porta.criticasDaCompetencia(ctx(), 'bpa', COMP);
    expect(criticas.map((c) => [c.regra, c.gravidade]).sort()).toEqual([
      ['producao-acima-da-cota', 'aviso'],
      ['producao-acima-da-cota', 'aviso'],
      ['producao-acima-do-teto', 'aviso'],
      ['producao-acima-do-teto', 'bloqueante'],
    ]);
    expect(criticas.every((c) => c.conta === m.conta)).toBe(true);
    expect(await porta.criticasDaCompetencia(ctx(), 'aih', COMP)).toEqual([]);

    // Remanejamento: acima do saldo é recusado; quem pede não decide; outra pessoa aprova e a cota de destino nasce.
    const pedidoBase = {
      competencia: COMP,
      tipo: 'setor',
      destinoSetor: m.s2,
      motivo: 'Fila maior no setor de destino',
    };
    await expect(
      porta.solicitarRemanejamento(ctx(), cotaA.id, { ...pedidoBase, quantidade: 1 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.solicitarRemanejamento(ctx(), cotaB.id, { ...pedidoBase, quantidade: 6 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const pedido = await porta.solicitarRemanejamento(ctx(), cotaB.id, {
      ...pedidoBase,
      quantidade: 3,
      valor: 30,
    });
    const [t0] = await ler(
      'SELECT situacao, solicitante_usuario_id, dados FROM transferencia_cota_sus WHERE id = ?',
      [pedido.id],
    );
    expect(t0).toMatchObject({ situacao: 'solicitada', solicitante_usuario_id: m.u1 });
    await expect(
      porta.decidirRemanejamento(ctx(), pedido.id, { aprovar: true, competencia: COMP, versao: 1 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const d = await porta.decidirRemanejamento(ctx(m.u2), pedido.id, {
      aprovar: true,
      competencia: COMP,
      versao: 1,
    });
    expect(d.situacao).toBe('aprovada');
    const cotas = await ler(
      'SELECT id, setor_funcional_id, quantidade_cota, valor_cota FROM cota_procedimento_sus WHERE id IN (?, ?) ORDER BY id',
      [cotaB.id, d.destino],
    );
    expect(
      cotas.map((c) => [c['setor_funcional_id'], Number(c['quantidade_cota']), Number(c['valor_cota'])]),
    ).toEqual([
      [m.s1, 7, 70],
      [m.s2, 3, 30],
    ]);
    const [t1] = await ler(
      'SELECT situacao, aprovador_usuario_id, destino_cota_procedimento_sus_id FROM transferencia_cota_sus WHERE id = ?',
      [pedido.id],
    );
    expect(t1).toMatchObject({
      situacao: 'aprovada',
      aprovador_usuario_id: m.u2,
      destino_cota_procedimento_sus_id: d.destino,
    });

    await porta.inativarLimite(ctx(), 'teto', teto.id, { versao: 1 });
    await expect(porta.inativarLimite(ctx(), 'teto', teto.id, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(await ler('SELECT ativo FROM teto_financeiro_sus WHERE id = ?', [teto.id])).toEqual([
      { ativo: 0 },
    ]);
    expect(
      (await porta.criticasDaCompetencia(ctx(), 'bpa', COMP)).filter((c) => c.gravidade === 'bloqueante'),
    ).toEqual([]);
  });

  it('a nova programação encerra a anterior na véspera; o rascunho é cancelado; isolamento e trilha', async () => {
    const nova = await porta.importar(ctx(), { vigenciaInicio: '2026-02-01', conteudo: `${m.proc};8;10` });
    const r = await porta.ativar(ctx(), nova.id, { versao: 1 });
    expect(r.encerrada).not.toBeNull();
    const [ant] = await ler(
      `SELECT situacao, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f FROM programacao_orcamentaria_sus WHERE id = ?`,
      [r.encerrada],
    );
    expect(ant).toEqual({ situacao: 'encerrada', f: '2026-01-31' });
    // A encerrada ainda vale para janeiro.
    expect((await porta.painel(ctx(), COMP)).saldos.filter((x) => x.tipo === 'programacao')).toHaveLength(2);
    const rasc = await porta.importar(ctx(), { vigenciaInicio: '2026-03-01', conteudo: `${m.proc};1` });
    await porta.cancelar(ctx(), rasc.id, { versao: 1 });
    await expect(porta.cancelar(ctx(), nova.id, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(await ler('SELECT situacao FROM programacao_orcamentaria_sus WHERE id = ?', [rasc.id])).toEqual([
      { situacao: 'cancelada' },
    ]);

    const outro = await porta.painel(ctx(m.u1, P2), COMP);
    expect(outro).toMatchObject({ programacoes: [], saldos: [], remanejamentos: [] });
    await expect(porta.itens(ctx(m.u1, P2), nova.id)).rejects.toMatchObject({ problema: { status: 404 } });
    const op = await porta.opcoes(ctx());
    expect(op.setores.map((s) => s.id).sort()).toEqual([m.s1, m.s2].sort());
    const [t] = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(Number(t!.n)).toBeGreaterThanOrEqual(10);
  });
});
