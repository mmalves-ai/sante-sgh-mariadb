// Contrato de efeito da produção hospitalar mensal e da categoria clínica do atendimento (F8, 09-AREA linha 87) contra o
// MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, duas categorias clínicas,
// unidades e leitos, motivos de saída, atendimentos e internações fictícios (chaves de catálogo desligadas só no
// preparo); usuário e paciente são ids já existentes do cliente de teste (só lidos, nunca alterados).
// Prova o que fica no banco: a faixa nova encerra a anterior na véspera (e a sobreposta recusa); o novo período da
// categoria encerra o vigente no instante da troca com o valor pela faixa de cada dia e nasce encerrado na saída;
// recusas sem gravar (mesma categoria, início antes do vigente); a apuração do mês por categoria e o total com os
// indicadores da Portaria 312 e o valor; reapurar muda a versão; fechar congela (reapurar recusa) e o mês corrente não
// fecha; a visão por paciente; a trilha das operações.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaProducaoHospitalarPropria } from './producao-hospitalar-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c2046prod';

interface Massa {
  est: number;
  usuario: number;
  login: string;
  med: number;
  cir: number;
  ped: number;
  alta: number;
  atdB: number;
  atdD: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM producao_hospitalar_mensal WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM faixa_valor_categoria_clinica WHERE estabelecimento_id IN ${est}`, [P]);
    // As faixas gerais (de todos os estabelecimentos) da massa: pelas categorias sintéticas.
    await e.executar(
      `DELETE f FROM faixa_valor_categoria_clinica f JOIN clinica_assistencial c ON c.id = f.clinica_assistencial_id
        WHERE c.codigo LIKE ?`,
      [`${P}-%`],
    );
    await e.executar(
      `DELETE p FROM atendimento_categoria_clinica p JOIN atendimento a ON a.id = p.atendimento_id
        WHERE a.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM leito_hospitalar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM unidade_internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM motivo_saida_hospitalar WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM clinica_assistencial WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaProducaoHospitalarPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProducaoHospitalarPropria;
  let m: Massa;
  let n = 0;
  const ctx = () => ({
    hospital: P,
    login: m.login,
    correlacao: P,
    chaveIdempotencia: `${P}-${Date.now()}-${++n}`,
  });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma(
        'SELECT id, login FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 1',
      );
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      if (!usuario?.['id'] || !paciente?.['id'])
        throw new Error('O cliente de teste precisa de usuário e paciente.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const clinica = (cod: string, natureza: string) =>
        e.inserir(
          `INSERT INTO clinica_assistencial (codigo, descricao, natureza, criado_em) VALUES (?, ?, ?, ?)`,
          [`${P}-${cod}`, `Clínica sintética ${cod}`, natureza, agora],
        );
      const med = await clinica('MED', 'medica');
      const cir = await clinica('CIR', 'cirurgica');
      const ped = await clinica('PED', 'pediatrica');
      const alta = await e.inserir(
        `INSERT INTO motivo_saida_hospitalar (codigo, descricao, tipo_saida, criado_em)
         VALUES (?, 'Alta (sintético)', 'alta', ?)`,
        [`${P}-AL`, agora],
      );
      const obito = await e.inserir(
        `INSERT INTO motivo_saida_hospitalar (codigo, descricao, tipo_saida, exige_declaracao_obito, criado_em)
         VALUES (?, 'Óbito (sintético)', 'obito', TRUE, ?)`,
        [`${P}-OB`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const unidade = (cod: string, cl: number) =>
          e.inserir(
            `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo,
               clinica_assistencial_id, criado_em) VALUES (?, 999999991, ?, ?, 'enfermaria', ?, ?)`,
            [est, `${P}-${cod}`, `Unidade sintética ${cod}`, cl, agora],
          );
        const uMed = await unidade('UM', med);
        const uCir = await unidade('UC', cir);
        const leito = (u: number, cod: string, extra = false) =>
          e.inserir(
            `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, situacao_leito_id,
               codigo, extra, ativo, criado_em) VALUES (?, ?, 999999991, 999999991, ?, ?, TRUE, ?)`,
            [est, u, `${P}-${cod}`, extra, agora],
          );
        await leito(uMed, 'L1');
        await leito(uMed, 'L2');
        await leito(uMed, 'LX', true); // leito extra: fora dos operacionais
        await leito(uCir, 'L3');
        const internar = async (
          k: string,
          cl: number,
          u: number,
          entrada: string,
          saida: string | null,
          motivo: number | null,
          prevista: string | null,
          pacienteId: unknown = paciente['id'],
        ) => {
          const atd = await e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, clinica_assistencial_id, entrada_em,
               criado_em) VALUES (?, ?, ?, 1, 1, 1, 1, ?, ?, ?)`,
            [est, `${P}-${k}`, pacienteId, cl, entrada, agora],
          );
          await e.inserir(
            `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
               carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
               medico_assistente_profissional_id, fonte_pagadora_id, data_prevista_alta, situacao, data_hora_alta,
               motivo_saida_hospitalar_id, criado_em) VALUES (?, ?, ?, ?, ?, 1, 1, ?, 1, 1, 1, 1, ?, ?, ?, ?, ?)`,
            [
              est,
              `${P}-${k}`,
              atd,
              pacienteId,
              entrada,
              u,
              prevista,
              saida ? 'alta' : 'ativa',
              saida,
              motivo,
              agora,
            ],
          );
          return atd;
        };
        await internar('A', med, uMed, '2025-03-10 08:00:00', '2025-03-13 10:00:00', alta, '2025-03-14');
        const atdB = await internar(
          'B',
          med,
          uMed,
          '2025-03-18 08:00:00',
          '2025-03-25 08:00:00',
          obito,
          '2025-03-22',
        );
        await internar('C', cir, uCir, '2025-02-20 08:00:00', null, null, null);
        // D: entra na pediatria (categoria da internação), é classificada depois e sai com o período aberto.
        // Outro paciente sem internação vigente (uma vigente por paciente; C segue internado).
        const outro = await e.uma(
          `SELECT p.id FROM paciente p WHERE p.excluido_em IS NULL AND p.id <> ? AND NOT EXISTS
             (SELECT 1 FROM internacao i WHERE i.paciente_id = p.id AND i.paciente_internado_vigente IS NOT NULL)
            ORDER BY p.id LIMIT 1`,
          [paciente['id']],
        );
        if (!outro?.['id'])
          throw new Error('O cliente de teste precisa de um segundo paciente sem internação vigente.');
        const atdD = await internar('D', ped, uMed, '2024-03-01 08:00:00', null, null, null, outro['id']);
        return {
          est,
          usuario: Number(usuario['id']),
          login: String(usuario['login']),
          med,
          cir,
          ped,
          alta,
          atdB,
          atdD,
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaProducaoHospitalarPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('faixa: a nova encerra a anterior na véspera; a sobreposta recusa sem gravar', async () => {
    await porta.incluirFaixa(ctx(), { clinicaId: m.med, inicio: '2025-01-01', valorDiaria: 100 });
    await porta.incluirFaixa(ctx(), { clinicaId: m.cir, inicio: '2025-01-01', valorDiaria: 300 });
    const r = await porta.incluirFaixa(ctx(), { clinicaId: m.med, inicio: '2025-03-15', valorDiaria: 120 });
    expect(r.resultado.id).toBeGreaterThan(0);
    await expect(
      porta.incluirFaixa(ctx(), { clinicaId: m.med, inicio: '2025-03-15', valorDiaria: 130 }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    const fs = await ler<{ ini: string; fim: string | null; v: string; versao: number }>(
      `SELECT DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS ini, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim,
              valor_diaria AS v, versao FROM faixa_valor_categoria_clinica
        WHERE estabelecimento_id = ? AND clinica_assistencial_id = ? ORDER BY vigencia_inicio`,
      [m.est, m.med],
    );
    expect(fs.map((f) => [f.ini, f.fim, Number(f.v), Number(f.versao)])).toEqual([
      ['2025-01-01', '2025-03-14', 100, 2],
      ['2025-03-15', null, 120, 1],
    ]);
    const v = await porta.faixas({ hospital: P, login: m.login });
    expect(v.faixas.filter((f) => f.clinicaId === m.med)).toHaveLength(2);
  });

  it('categoria clínica: troca encerra o vigente com o valor da faixa de cada dia; recusas não gravam', async () => {
    await porta.classificar(ctx(), { atendimentoId: m.atdB, clinicaId: m.med, inicio: '2025-03-18T08:00' });
    await expect(
      porta.classificar(ctx(), { atendimentoId: m.atdB, clinicaId: m.med, inicio: '2025-03-19T08:00' }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(
      porta.classificar(ctx(), { atendimentoId: m.atdB, clinicaId: m.cir, inicio: '2025-03-17T08:00' }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    const r = await porta.classificar(ctx(), {
      atendimentoId: m.atdB,
      clinicaId: m.cir,
      inicio: '2025-03-20T09:00',
    });
    expect(r.resultado.encerrado).toBeGreaterThan(0);
    const ps = await ler<{
      c: number;
      ini: string;
      fim: string;
      v: string;
      op: string;
      u: number;
      dados: unknown;
    }>(
      `SELECT clinica_assistencial_id AS c, DATE_FORMAT(inicio_em, '%Y-%m-%d %H:%i') AS ini,
              DATE_FORMAT(fim_em, '%Y-%m-%d %H:%i') AS fim, valor_total AS v, operacao AS op, usuario_id AS u, dados
         FROM atendimento_categoria_clinica WHERE atendimento_id = ? ORDER BY inicio_em`,
      [m.atdB],
    );
    expect(ps.map((p) => [Number(p.c), p.ini, p.fim, Number(p.v), p.op, Number(p.u)])).toEqual([
      [m.med, '2025-03-18 08:00', '2025-03-20 09:00', 240, 'alteracao', m.usuario],
      [m.cir, '2025-03-20 09:00', '2025-03-25 08:00', 1500, 'inclusao', m.usuario],
    ]);
    const dados = typeof ps[0]!.dados === 'string' ? JSON.parse(ps[0]!.dados) : ps[0]!.dados;
    expect(dados).toMatchObject({ diarias: 2, diasSemFaixa: 0 });
    const visao = await porta.categorias({ hospital: P, login: m.login }, `${P}-B`);
    expect(visao.periodos.map((p) => [p.clinicaId, p.diarias, p.valor, p.emAberto])).toEqual([
      [m.med, 2, 240, false],
      [m.cir, 5, 1500, false],
    ]);
    expect(visao.valorTotal).toBe(1740);
  });

  it('visão por paciente: trecho da entrada, período aberto até a saída e faixa própria posterior à geral', async () => {
    // Geral de cirúrgica desde 2024 (a própria só desde 2025); pediatria: geral desde 2024 e própria desde 01/10/2024.
    await porta.incluirFaixa(ctx(), {
      clinicaId: m.cir,
      inicio: '2024-01-01',
      valorDiaria: 200,
      todasUnidades: true,
    });
    await porta.incluirFaixa(ctx(), {
      clinicaId: m.ped,
      inicio: '2024-01-01',
      valorDiaria: 50,
      todasUnidades: true,
    });
    await porta.incluirFaixa(ctx(), { clinicaId: m.ped, inicio: '2024-10-01', valorDiaria: 80 });
    await porta.classificar(ctx(), { atendimentoId: m.atdD, clinicaId: m.cir, inicio: '2024-03-10T08:00' });
    // A alta encerra a internação sem tocar no período da categoria (que fica aberto no banco).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `alta-${P}` }, async (e) => {
      await e.executar(
        `UPDATE internacao SET data_hora_alta = '2024-03-20 10:00:00', situacao = 'alta', motivo_saida_hospitalar_id = ?
          WHERE atendimento_id = ?`,
        [m.alta, m.atdD],
      );
      await e.executar(`UPDATE atendimento SET saida_em = '2024-03-20 10:00:00' WHERE id = ?`, [m.atdD]);
    });
    const aberto = await ler<{ fim: string | null }>(
      'SELECT fim_em AS fim FROM atendimento_categoria_clinica WHERE atendimento_id = ?',
      [m.atdD],
    );
    expect(aberto.map((x) => x.fim)).toEqual([null]);

    const visao = await porta.categorias({ hospital: P, login: m.login }, `${P}-D`);
    expect(
      visao.periodos.map((p) => [p.clinicaId, p.implicito, p.inicio, p.fim, p.diarias, p.valor, p.emAberto]),
    ).toEqual([
      [m.ped, true, '2024-03-01T08:00:00', '2024-03-10T08:00:00', 9, 450, false],
      [m.cir, false, '2024-03-10T08:00:00', '2024-03-20T10:00:00', 10, 2000, false],
    ]);
    expect(visao.periodos[0]!.id).toBeNull();
    expect(visao.valorTotal).toBe(2450);

    // O valor do paciente é o que a produção do mês valoriza para ele (único internado em 03/2024; ao vivo, sem gravar: o mês gravado do teste seguinte é só 03/2025).
    const p24 = await porta.painel({ hospital: P, login: m.login }, '2024-03');
    expect(p24.aoVivo.total).toMatchObject({ pacienteDia: 19, valorProduzido: 2450, diasSemFaixa: 0 });
    expect(visao.periodos.reduce((s, p) => s + p.diarias, 0)).toBe(19);

    // A precedência dia a dia na lista de faixas: hoje vale a própria; a geral segue listada, não vigente.
    const fx = await porta.faixas({ hospital: P, login: m.login });
    const ped = fx.faixas.filter((f) => f.clinicaId === m.ped);
    expect(ped.map((f) => [f.todasUnidades, f.valorDiaria, f.vigente])).toEqual([
      [true, 50, false],
      [false, 80, true],
    ]);
  });

  it('apuração do mês: por categoria e total com a Portaria 312, valor e pontualidade; reapura e fecha', async () => {
    const r1 = await porta.apurar(ctx(), { mes: '2025-03' });
    expect(r1.resultado).toMatchObject({ linhas: 3, situacao: 'aberta' });
    const linhas = async () =>
      ler<Record<string, unknown>>(
        `SELECT clinica_assistencial_id AS c, leitos_operacionais, entradas, saidas, obitos, paciente_dia, leito_dia,
                taxa_ocupacao, media_permanencia, giro_leito, intervalo_substituicao, taxa_mortalidade,
                saidas_com_previsao, saidas_no_prazo, pontualidade_alta, valor_produzido, dias_sem_faixa, situacao,
                DATE_FORMAT(apurado_ate, '%Y-%m-%d') AS ate, versao, fechado_por
           FROM producao_hospitalar_mensal WHERE estabelecimento_id = ? AND competencia = '2025-03-01'
          ORDER BY clinica_assistencial_id IS NULL, clinica_assistencial_id`,
        [m.est],
      );
    const porC = (ls: Record<string, unknown>[], c: number | null) =>
      ls.find((x) => (x['c'] === null ? null : Number(x['c'])) === c)!;
    let ls = await linhas();
    const nums = (x: Record<string, unknown>, ks: string[]) =>
      ks.map((k) => (x[k] === null ? null : Number(x[k])));
    const K = [
      'leitos_operacionais',
      'entradas',
      'saidas',
      'obitos',
      'paciente_dia',
      'leito_dia',
      'valor_produzido',
    ];
    expect(nums(porC(ls, m.med), K)).toEqual([2, 2, 1, 0, 5, 62, 540]);
    expect(nums(porC(ls, m.cir), K)).toEqual([1, 0, 1, 1, 36, 31, 10800]);
    const total = porC(ls, null);
    expect(nums(total, K)).toEqual([3, 2, 2, 1, 41, 93, 11340]);
    expect(
      nums(total, [
        'taxa_ocupacao',
        'media_permanencia',
        'giro_leito',
        'intervalo_substituicao',
        'taxa_mortalidade',
        'saidas_com_previsao',
        'saidas_no_prazo',
        'pontualidade_alta',
        'dias_sem_faixa',
        'versao',
      ]),
    ).toEqual([44.09, 20.5, 0.67, 26, 50, 2, 1, 50, 0, 1]);
    expect(total).toMatchObject({ situacao: 'aberta', ate: '2025-03-31' });

    await porta.apurar(ctx(), { mes: '2025-03' });
    ls = await linhas();
    expect(Number(porC(ls, null)['versao'])).toBe(2);

    await porta.apurar(ctx(), { mes: '2025-03', fechar: true });
    ls = await linhas();
    expect(ls.every((x) => x['situacao'] === 'fechada' && Number(x['fechado_por']) === m.usuario)).toBe(true);
    await expect(porta.apurar(ctx(), { mes: '2025-03' })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    const mesAtual = new Date().toISOString().slice(0, 7);
    await expect(porta.apurar(ctx(), { mes: mesAtual, fechar: true })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    expect(
      await ler(
        `SELECT id FROM producao_hospitalar_mensal WHERE estabelecimento_id = ? AND competencia <> '2025-03-01'`,
        [m.est],
      ),
    ).toHaveLength(0);

    const painel = await porta.painel({ hospital: P, login: m.login }, '2025-03');
    expect(painel.situacao).toBe('fechada');
    expect(painel.aoVivo.total).toMatchObject({
      pacienteDia: 41,
      valorProduzido: 11340,
      pontualidadeAlta: 50,
    });
  });

  it('trilha: cada gravação deixou a operação na trilha do estabelecimento', async () => {
    const t = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
      [m.est, m.usuario],
    );
    expect(Number(t[0]!.n)).toBeGreaterThanOrEqual(8);
  });
});
