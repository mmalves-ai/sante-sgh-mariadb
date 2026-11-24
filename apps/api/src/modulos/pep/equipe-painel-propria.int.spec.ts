// Contrato de efeito da porta própria do painel, da configuração por setor e da equipe assistencial (F3.3, linhas
// 03-PEP L90, L91 e L94) contra o MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do
// teste, atendimento e setor fictícios (chaves de catálogo desligadas só no preparo), funções de equipe do teste;
// usuário, paciente e profissional são ids já existentes do cliente de teste (só lidos, nunca alterados).
// Prova o que fica no banco: período aberto e fechado do acompanhamento (nada apagado), colunas por usuário, a
// configuração do setor com versão, a equipe aberta na primeira inclusão, o responsável único e a saída com motivo.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaEquipePainelPropria } from './equipe-painel-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'l0333eq';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  prof: [number, number];
  atd: number;
  setor: number;
  fResp: number;
  fEnf: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE m FROM equipe_assistencial_membro m JOIN equipe_assistencial_paciente q
        ON q.id = m.equipe_assistencial_paciente_id WHERE q.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM equipe_assistencial_paciente WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM paciente_acompanhado WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM painel_filtro_usuario WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM configuracao_setor_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM funcao_equipe_assistencial WHERE codigo IN ('l0333-resp','l0333-enf')");
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaEquipePainelPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEquipePainelPropria;
  let m: Massa;
  let colunasAntes: { id: number; coluna: string; exibir: number; ordem: number; versao: number }[] = [];
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

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const profs = await e.consultar(
        'SELECT id FROM profissional WHERE excluido_em IS NULL ORDER BY id LIMIT 2',
      );
      if (!usuario?.['id'] || !paciente?.['id'] || profs.length < 2)
        throw new Error('O cliente de teste precisa de usuário, paciente e dois profissionais.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const fResp = await e.inserir(
        `INSERT INTO funcao_equipe_assistencial (codigo, descricao, categoria, responsavel_principal, criado_em)
         VALUES ('l0333-resp', 'Médico assistente (teste)', 'medica', TRUE, ?)`,
        [agora],
      );
      const fEnf = await e.inserir(
        `INSERT INTO funcao_equipe_assistencial (codigo, descricao, categoria, responsavel_principal, criado_em)
         VALUES ('l0333-enf', 'Enfermeiro de referência (teste)', 'enfermagem', FALSE, ?)`,
        [agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const atd = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?)`,
          [est, `${P}-1`, paciente['id'], profs[0]!['id'], agora, agora],
        );
        const setor = await e.inserir(
          `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
           VALUES (?, ?, 'Setor sintético', 'assistencial', ?)`,
          [est, `${P}-s`, agora],
        );
        return {
          est,
          usuario: Number(usuario['id']),
          paciente: Number(paciente['id']),
          prof: [Number(profs[0]!['id']), Number(profs[1]!['id'])] as [number, number],
          atd,
          setor,
          fResp,
          fEnf,
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    colunasAntes = await ler(
      'SELECT id, coluna, exibir, ordem, versao FROM painel_coluna_usuario WHERE usuario_id = ? AND painel_filtro_usuario_id IS NULL',
      [m.usuario],
    );
    porta = new PortaEquipePainelPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, async (e) => {
      // As colunas do usuário existente voltam como estavam (o teste não deixa preferência alheia mudada).
      await e.executar(
        'DELETE FROM painel_coluna_usuario WHERE usuario_id = ? AND painel_filtro_usuario_id IS NULL',
        [m.usuario],
      );
      for (const c of colunasAntes)
        await e.executar(
          `INSERT INTO painel_coluna_usuario (id, usuario_id, coluna, exibir, ordem, versao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
          [c.id, m.usuario, c.coluna, c.exibir, c.ordem, c.versao],
        );
      await limpar(e);
    });
    await nucleo.encerrar();
  });

  it('acompanhar abre o período; repetir recusa; deixar grava o fim e a linha fica', async () => {
    const { id } = await porta.acompanhar(ctx(), {
      paciente: m.paciente,
      atendimento: m.atd,
      motivo: 'pós-operatório',
    });
    expect((await porta.acompanhados(ctx())).map((x) => x.paciente)).toEqual([m.paciente]);
    await expect(porta.acompanhar(ctx(), { paciente: m.paciente })).rejects.toMatchObject({
      problema: { status: 422, codigo: 'ja-acompanhado' },
    });
    await porta.deixarDeAcompanhar(ctx(), m.paciente);
    expect(await porta.acompanhados(ctx())).toEqual([]);
    const [linha] = await ler<Record<string, unknown>>(
      'SELECT fim_em, motivo, versao, criado_por, alterado_por FROM paciente_acompanhado WHERE id = ?',
      [id],
    );
    expect(linha!['fim_em']).not.toBeNull();
    expect(linha!['motivo']).toBe('pós-operatório');
    expect(Number(linha!['versao'])).toBe(2);
    expect(Number(linha!['alterado_por'])).toBe(m.usuario);
    // Voltar a acompanhar abre outro período (o histórico tem os dois).
    await porta.acompanhar(ctx(), { paciente: m.paciente });
    const n = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM paciente_acompanhado WHERE estabelecimento_id = ? AND usuario_id = ?',
      [m.est, m.usuario],
    );
    expect(Number(n[0]!.n)).toBe(2);
  });

  it('colunas do painel ficam no banco por usuário, com exibir e ordem; menos de duas recusa', async () => {
    await porta.gravarColunas(ctx(), { colunas: ['paciente', 'leito'] });
    expect(await porta.colunas(ctx())).toEqual(['paciente', 'leito']);
    const ocultas = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM painel_coluna_usuario WHERE usuario_id = ? AND painel_filtro_usuario_id IS NULL AND exibir = FALSE',
      [m.usuario],
    );
    expect(Number(ocultas[0]!.n)).toBeGreaterThan(0);
    await porta.gravarColunas(ctx(), { colunas: ['leito', 'paciente', 'idade'] });
    expect(await porta.colunas(ctx())).toEqual(['leito', 'paciente', 'idade']);
    await expect(porta.gravarColunas(ctx(), { colunas: ['leito'] })).rejects.toMatchObject({
      problema: { status: 422, codigo: 'colunas-minimas' },
    });
  });

  it('filtro salvo padrão: inclui na primeira vez e altera depois, no estabelecimento da sessão', async () => {
    expect(await porta.filtroPadrao(ctx())).toEqual({ unidade: null });
    const { id } = await porta.gravarFiltroPadrao(ctx(), { unidade: null });
    await porta.gravarFiltroPadrao(ctx(), { unidade: null });
    const [linha] = await ler<Record<string, unknown>>(
      'SELECT estabelecimento_id, usuario_id, padrao, versao FROM painel_filtro_usuario WHERE id = ?',
      [id],
    );
    expect([
      Number(linha!['estabelecimento_id']),
      Number(linha!['usuario_id']),
      Number(linha!['padrao']),
    ]).toEqual([m.est, m.usuario, 1]);
    expect(Number(linha!['versao'])).toBe(2);
    await expect(porta.gravarFiltroPadrao(ctx(), { unidade: 987_654_321 })).rejects.toMatchObject({
      problema: { status: 404 },
    });
  });

  it('configuração do setor: inclui, altera com versão e resolve a que vale; tolerância sem retroativo recusa', async () => {
    const base = {
      setor: m.setor,
      tipoAtendimento: 'todos',
      permiteRetroativo: true,
      toleranciaRetroativoHoras: 12,
      assinaturaExigida: 'eletronica',
      exigeEvolucaoMedica: false,
      exigeEvolucaoEnfermagem: false,
    };
    const { id } = await porta.gravarConfiguracaoSetor(ctx(), base);
    await porta.gravarConfiguracaoSetor(ctx(), {
      ...base,
      tipoAtendimento: 'internacao',
      assinaturaExigida: 'digital_icp',
    });
    await porta.gravarConfiguracaoSetor(ctx(), { ...base, toleranciaRetroativoHoras: 6, versao: 1 });
    const [linha] = await ler<Record<string, unknown>>(
      'SELECT tolerancia_retroativo_horas, versao FROM configuracao_setor_prontuario WHERE id = ?',
      [id],
    );
    expect([Number(linha!['tolerancia_retroativo_horas']), Number(linha!['versao'])]).toEqual([6, 2]);
    expect(
      (await porta.configuracaoVigente(ctx(), m.setor, 'internacao')).configuracao.assinaturaExigida,
    ).toBe('digital_icp');
    expect((await porta.configuracaoVigente(ctx(), m.setor, 'ambulatorio')).origem).toBe('setor');
    await expect(
      porta.gravarConfiguracaoSetor(ctx(), {
        ...base,
        permiteRetroativo: false,
        toleranciaRetroativoHoras: 4,
      }),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'tolerancia-sem-retroativo' } });
    // Versão velha: conflito, nada muda.
    await expect(porta.gravarConfiguracaoSetor(ctx(), { ...base, versao: 1 })).rejects.toMatchObject({
      problema: { status: 409 },
    });
  });

  it('equipe: abre na primeira inclusão, um só responsável, saída com motivo e vínculo pela equipe vigente', async () => {
    const r1 = await porta.incluirMembro(ctx(), m.atd, { profissional: m.prof[0], funcao: m.fResp });
    const r2 = await porta.incluirMembro(ctx(), m.atd, {
      profissional: m.prof[1],
      funcao: m.fEnf,
      recebeNotificacao: true,
    });
    expect(r2.equipe).toBe(r1.equipe);
    await expect(
      porta.incluirMembro(ctx(), m.atd, { profissional: m.prof[1], funcao: m.fResp }),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'responsavel-duplicado' } });
    const eq = await porta.equipe(ctx(), m.atd);
    expect(eq.paciente).toBe(m.paciente);
    expect(eq.membros.map((x) => [x.profissional, x.responsavelPrincipal, x.fim])).toEqual([
      [m.prof[0], true, null],
      [m.prof[1], false, null],
    ]);
    expect(await porta.vinculoPelaEquipe(ctx(), m.paciente, m.prof[1])).toBe(true);
    await expect(porta.encerrarMembro(ctx(), r2.id, { motivo: 'x' })).rejects.toMatchObject({
      problema: { status: 422, codigo: 'motivo-invalido' },
    });
    await porta.encerrarMembro(ctx(), r2.id, { motivo: 'troca de plantão' });
    const [linha] = await ler<Record<string, unknown>>(
      'SELECT fim_em, motivo_saida, versao, excluido_em FROM equipe_assistencial_membro WHERE id = ?',
      [r2.id],
    );
    expect(linha!['fim_em']).not.toBeNull();
    expect(linha!['motivo_saida']).toBe('troca de plantão');
    expect(Number(linha!['versao'])).toBe(2);
    expect(linha!['excluido_em']).toBeNull();
    expect(await porta.vinculoPelaEquipe(ctx(), m.paciente, m.prof[1])).toBe(false);
    const [eqLinha] = await ler<Record<string, unknown>>(
      'SELECT estabelecimento_id, paciente_id, situacao FROM equipe_assistencial_paciente WHERE id = ?',
      [r1.equipe],
    );
    expect([
      Number(eqLinha!['estabelecimento_id']),
      Number(eqLinha!['paciente_id']),
      eqLinha!['situacao'],
    ]).toEqual([m.est, m.paciente, 'ativa']);
  });
});
