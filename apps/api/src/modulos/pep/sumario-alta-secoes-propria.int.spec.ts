// Contrato de efeito das seções configuráveis do sumário de alta (F3.3, linha 03-PEP L124) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, categoria de atendimento de internação e
// atendimento fictícios (chaves desligadas só no preparo); usuário, paciente e profissional são ids já existentes do
// cliente de teste (só lidos). Prova o que fica no banco: a seção do estabelecimento com versão, a recusa da versão
// velha, tirar de uso sem apagar, o período próprio do cliente e as pendências das obrigatórias pelo atendimento.
// A linha do cliente inteiro é provada no tipo "hospital_dia", que nenhum outro teste usa, e apagada no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaSumarioSecoesPropria } from './sumario-alta-secoes-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'l0324sa';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(`DELETE FROM componente_sumario_alta WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    "DELETE FROM componente_sumario_alta WHERE estabelecimento_id IS NULL AND codigo = 'l124-cli'",
  );
  await e.executar("DELETE FROM periodo_consulta_sumario_alta WHERE codigo LIKE 'l124-%'");
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM categoria_atendimento WHERE codigo = 'l124-int'");
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaSumarioSecoesPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSumarioSecoesPropria;
  let m: { est: number; usuario: number; atd: number };
  const ctx = () => ({
    cliente: CLIENTE,
    estabelecimento: m.est,
    usuario: m.usuario,
    correlacao: P,
    rede: 'rede-teste',
    hospital: P,
  });
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { problema?: { status?: number; codigo?: string } }).problema ?? {};
    }
    throw new Error('Era para recusar.');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const prof = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      if (!usuario?.['id'] || !paciente?.['id'] || !prof?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente e profissional.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const cat = await e.inserir(
        `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em)
         VALUES ('l124-int', 'Internação (teste)', 'internacao', ?)`,
        [agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const atd = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`,
          [est, `${P}-1`, paciente['id'], cat, prof['id'], agora, agora],
        );
        return { est, usuario: Number(usuario['id']), atd };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaSumarioSecoesPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  }, 120_000);

  it('a seção do estabelecimento grava com versão; a versão velha é recusada; tirar de uso não apaga', async () => {
    const base = {
      codigo: 'l124-orient',
      descricao: 'Orientações ao paciente',
      tipoConteudo: 'orientacoes',
      tipoAtendimento: 'internacao',
      ordem: 15,
      obrigatorio: true,
    };
    const { id } = await porta.gravarComponente(ctx(), base);
    const [l1] = await ler<Record<string, unknown>>(
      'SELECT estabelecimento_id, tipo_conteudo, obrigatorio, ativo, versao, criado_por FROM componente_sumario_alta WHERE id = ?',
      [id],
    );
    expect(l1).toMatchObject({ estabelecimento_id: m.est, tipo_conteudo: 'orientacoes', versao: 1 });
    expect(Number(l1!['obrigatorio'])).toBe(1);
    expect(Number(l1!['criado_por'])).toBe(m.usuario);

    expect(await porta.gravarComponente(ctx(), { ...base, id, versao: 1, ordem: 5 })).toEqual({ id });
    expect((await erro(porta.gravarComponente(ctx(), { ...base, id, versao: 1 }))).codigo).toBe(
      'conflito-versao',
    );
    expect((await erro(porta.gravarComponente(ctx(), { ...base, codigo: 'L 124' }))).codigo).toBe(
      'codigo-invalido',
    );
    expect(
      (await erro(porta.gravarComponente(ctx(), { ...base, codigo: 'l124-x', periodo: 'ultimas_24_horas' })))
        .codigo,
    ).toBe('periodo-sem-dados');

    // As pendências pelo atendimento (categoria de internação): a obrigatória sem texto recusa.
    const vazio = {
      diagnosticos: [],
      procedimentos: [],
      medicamentosAlta: [],
      alergias: [],
      encaminhamentos: [],
    };
    expect((await porta.pendencias(ctx(), m.atd, vazio)).map((p) => p.campo)).toEqual(['secao.l124-orient']);
    expect(
      await porta.pendencias(ctx(), m.atd, {
        ...vazio,
        secoes: [{ codigo: 'l124-orient', texto: 'Repouso' }],
      }),
    ).toEqual([]);

    await porta.gravarComponente(ctx(), { ...base, id, versao: 2, ordem: 5, ativo: false });
    const [l3] = await ler<Record<string, unknown>>(
      'SELECT ativo, versao, ordem FROM componente_sumario_alta WHERE id = ?',
      [id],
    );
    expect({
      ativo: Number(l3!['ativo']),
      versao: Number(l3!['versao']),
      ordem: Number(l3!['ordem']),
    }).toEqual({
      ativo: 0,
      versao: 3,
      ordem: 5,
    });
    expect(await porta.pendencias(ctx(), m.atd, vazio)).toEqual([]);
    const trilha = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria
        WHERE estabelecimento_id = ? AND entidade = 'componente_sumario_alta' AND entidade_id = ?`,
      [m.est, id],
    );
    // Uma gravação na trilha por gravação aceita (inclusão, alteração e retirada de uso); as recusadas não gravam.
    expect(Number(trilha[0]!.n)).toBeGreaterThanOrEqual(3);
  });

  it('a seção do cliente inteiro vale para o estabelecimento quando ele não tem a própria', async () => {
    const { id } = await porta.gravarComponente(ctx(), {
      doCliente: true,
      codigo: 'l124-cli',
      descricao: 'Dispositivos na alta',
      tipoConteudo: 'dispositivos',
      tipoAtendimento: 'hospital_dia',
      periodo: 'ultimas_24_horas',
    });
    const [l] = await ler<Record<string, unknown>>(
      'SELECT estabelecimento_id, periodo FROM componente_sumario_alta WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({ estabelecimento_id: null, periodo: 'ultimas_24_horas' });
    const v = await porta.vigentes(ctx(), 'hospital_dia');
    expect(v.find((x) => x.codigo === 'l124-cli')).toMatchObject({
      origem: 'cliente',
      periodo: 'ultimas_24_horas',
    });
  });

  it('período próprio do cliente: horas antes da alta, com versão; sem horas é recusado', async () => {
    const { id } = await porta.gravarPeriodo(ctx(), {
      codigo: 'l124-h12',
      descricao: 'Últimas 12 horas',
      atendimentoInteiro: false,
      horasRetroativas: 12,
    });
    const [l] = await ler<Record<string, unknown>>(
      'SELECT atendimento_inteiro, horas_retroativas, versao FROM periodo_consulta_sumario_alta WHERE id = ?',
      [id],
    );
    expect([
      Number(l!['atendimento_inteiro']),
      Number(l!['horas_retroativas']),
      Number(l!['versao']),
    ]).toEqual([0, 12, 1]);
    expect(
      (
        await erro(
          porta.gravarPeriodo(ctx(), {
            codigo: 'l124-h0',
            descricao: 'Sem horas',
            atendimentoInteiro: false,
          }),
        )
      ).codigo,
    ).toBe('horas-invalidas');
    await porta.gravarPeriodo(ctx(), {
      id,
      versao: 1,
      codigo: 'l124-h12',
      descricao: 'Atendimento todo',
      atendimentoInteiro: true,
      horasRetroativas: 12,
    });
    const [l2] = await ler<Record<string, unknown>>(
      'SELECT atendimento_inteiro, horas_retroativas, versao FROM periodo_consulta_sumario_alta WHERE id = ?',
      [id],
    );
    expect([Number(l2!['atendimento_inteiro']), l2!['horas_retroativas'], Number(l2!['versao'])]).toEqual([
      1,
      null,
      2,
    ]);
    expect((await porta.periodos(ctx())).some((p) => p.codigo === 'l124-h12')).toBe(true);
  });
});
