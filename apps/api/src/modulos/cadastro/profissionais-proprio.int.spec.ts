// D-PROF-39 sobre o banco próprio (fecho-1): as gravações do profissional pelo Executor contra o MariaDB real (cliente
// f22_o1, a massa do cadastro). Profissional SINTÉTICO (marca PROFPROPRIO, CPF de dígito calculado), apagado no fim.
// Contrato de efeito: cadastrar (pessoa, profissional, inscrição principal, ocupação, credenciamento), alterar pela
// versão (pessoa e profissional; versão velha 409), registro novo e repetido, especialidade pelo registro,
// descredenciar (vigência fechada, nunca apagada) e credenciar de novo no mesmo dia (a mesma vigência reabre), alterar o
// registro à mão (a marca da inativação sai), inativar e reativar (só o que a inativação desligou, com situação, data e
// motivo lidos do banco e a trilha com o motivo), retrato em profissional_versao (historicoProfissional), registro
// repetido entre profissionais, recusa da exclusão com login ligado (histórico do vínculo do usuário), excluir o registro
// principal (o próximo vira principal) e o profissional por engano (excluido_em), recadastro do mesmo CPF (a mesma linha
// volta), CPF de pessoa excluída (recusa própria, sem 500) e as pendências de modelo (lotação e login: 501).
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';

const M = 'PROFPROPRIO';

async function falha(p: Promise<unknown>): Promise<{ status: unknown; codigo: unknown }> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).not.toBeNull();
  const x = e as {
    status?: unknown;
    getStatus?: () => unknown;
    problema?: { codigo?: unknown; status?: unknown };
    extras?: { codigo?: unknown };
  };
  return {
    status: x.getStatus ? x.getStatus() : (x.problema?.status ?? x.status),
    codigo: x.problema?.codigo ?? x.extras?.['codigo'],
  };
}

describe.skipIf(SEM_BANCO)('gravações do profissional no banco próprio (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCadastroPropria;
  let m: Massa;
  let cbo = 0;
  let sigla = '';
  const cpf = cpfSintetico(String(100_000_000 + Math.floor(Math.random() * 800_000_000)));
  const cpf2 = cpfSintetico(String(100_000_000 + Math.floor(Math.random() * 800_000_000)));
  const cpf3 = cpfSintetico(String(100_000_000 + Math.floor(Math.random() * 800_000_000)));
  const numero = 700_000 + Math.floor(Math.random() * 99_999);
  const VIGENCIA_LOGIN = '2001-01-01';

  const ler = <T>(fn: (l: Parameters<Parameters<NucleoProprio['lerSomente']>[1]>[0]) => Promise<T>) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'prof-proprio' }, fn);
  const gravar = (op: Parameters<PortaCadastroPropria['gravarProfissional']>[1], entrada: unknown) =>
    porta.gravarProfissional(
      contextoPorta(m),
      op,
      entrada,
      contextoGravacao(m, { reautenticadoEm: Date.now() }),
    );

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'prof-proprio-limpa' }, async (e) => {
      const prof = `SELECT pr.id FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pf.nome LIKE '%${M}%'`;
      await e.executar(
        `DELETE FROM usuario_vinculo_profissional WHERE vigencia_inicio = '${VIGENCIA_LOGIN}' AND profissional_id IN (${prof})`,
      );
      for (const t of [
        'profissional_fonte_pagadora',
        'profissional_especialidade',
        'profissional_ocupacao',
        'profissional_versao',
      ])
        await e.executar(`DELETE FROM ${t} WHERE profissional_id IN (${prof})`);
      await e.executar(`DELETE FROM inscricao_conselho WHERE profissional_id IN (${prof})`);
      await e.executar(
        `DELETE pr FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pf.nome LIKE '%${M}%'`,
      );
      await e.executar(`DELETE FROM pessoa_fisica WHERE nome LIKE '%${M}%'`);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    porta = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    await limpar();
    const x = await ler(async (l) => ({
      cbo: await l.uma<{ id: unknown }>('SELECT id FROM ocupacao_cbo WHERE ativo ORDER BY id LIMIT 1'),
      sigla: await l.uma<{ sigla: unknown }>('SELECT sigla FROM conselho_classe WHERE id = ?', [m.conselho]),
    }));
    cbo = Number(x.cbo?.id);
    sigla = String(x.sigla?.sigla);
  }, 180_000);

  afterAll(async () => {
    await limpar().catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('cadastra, altera pela versão, inclui registro, especialidade, credenciamento, inativa, reativa e exclui', async () => {
    const registro = { conselho: sigla, numero, uf: 'MG', cbo, convenios: [m.fonte] };
    const r1 = await gravar('cadastro.cadastrarProfissional', {
      nome: `MEDICA ${M}`,
      cpf,
      sexo: 'F',
      nascimento: '1980-01-02',
      email: 'prof.proprio@exemplo.invalid',
      registro,
    });
    const prof = r1.resultado['profissional']!;
    const reg = r1.resultado['registro']!;
    expect(prof).toBeGreaterThan(0);
    const efeito = await ler(async (l) => ({
      p: await l.uma(
        `SELECT pr.situacao, pr.tipo, pr.email_profissional, pf.cpf = ? AS cpf_ok, sx.sigla AS sexo FROM profissional pr
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id LEFT JOIN sexo sx ON sx.id = pf.sexo_id WHERE pr.id = ?`,
        [cpf, prof],
      ),
      i: await l.uma(
        'SELECT principal, situacao, sequencia, ocupacao_cbo_id FROM inscricao_conselho WHERE id = ?',
        [reg],
      ),
      o: await l.uma(
        'SELECT COUNT(*) AS n FROM profissional_ocupacao WHERE profissional_id = ? AND principal',
        [prof],
      ),
      c: await l.uma(
        'SELECT COUNT(*) AS n FROM profissional_fonte_pagadora WHERE inscricao_conselho_id = ? AND vigencia_fim IS NULL',
        [reg],
      ),
    }));
    expect(efeito.p).toMatchObject({ situacao: 'ativo', tipo: 'assistencial', sexo: 'F' });
    expect(Number(efeito.p?.['cpf_ok'])).toBe(1);
    expect(Number(efeito.i?.['principal'])).toBe(1);
    expect(efeito.i).toMatchObject({ situacao: 'ativa' });
    expect(Number(efeito.o?.['n'])).toBe(1);
    expect(Number(efeito.c?.['n'])).toBe(1);

    // CPF e registro repetidos recusam (nada gravado).
    expect(
      (await falha(gravar('cadastro.cadastrarProfissional', { nome: `OUTRA ${M}`, cpf, registro }))).codigo,
    ).toBe('cpf-existente');
    // O mesmo conselho, número e UF ativo em outro profissional recusa (outra pessoa, nada gravado).
    expect(
      (await falha(gravar('cadastro.cadastrarProfissional', { nome: `OUTRA ${M}`, cpf: cpf2, registro })))
        .codigo,
    ).toBe('registro-repetido');
    expect(
      Number(
        (
          await ler((l) =>
            l.uma<{ n: unknown }>('SELECT COUNT(*) AS n FROM pessoa_fisica WHERE cpf = ?', [cpf2]),
          )
        )?.n,
      ),
    ).toBe(0);

    // Alterar pela versão lida: sobe a versão; a versão velha é conflito.
    const v1 = (await porta.dadosProfissional(contextoPorta(m), prof))!.versao;
    await gravar('cadastro.alterarProfissional', {
      profissional: prof,
      versao: v1,
      alteracoes: { nomeMae: `MAE ${M}`, celular: '31988887777' },
    });
    const d = (await porta.dadosProfissional(contextoPorta(m), prof))!;
    expect(d).toMatchObject({ nomeMae: `MAE ${M}`, celular: '31988887777' });
    expect(d.versao).not.toBe(v1);
    // Retrato de cada gravação em profissional_versao: o histórico mostra o valor anterior.
    const h = await porta.historicoProfissional(contextoPorta(m), prof, 1, 10);
    expect(h.total).toBe(2);
    expect(h.versoes[0]!.valores).toMatchObject({ nomeMae: `MAE ${M}`, celular: '31988887777' });
    expect(h.versoes[1]!.valores).toMatchObject({ nomeMae: null, nome: `MEDICA ${M}` });
    expect(
      (
        await falha(
          gravar('cadastro.alterarProfissional', {
            profissional: prof,
            versao: v1,
            alteracoes: { nome: `X ${M}` },
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await falha(
          gravar('cadastro.alterarProfissional', {
            profissional: prof,
            versao: d.versao,
            alteracoes: { celular: '31988887777' },
          }),
        )
      ).codigo,
    ).toBe('sem-alteracao');

    // Segundo registro (outra UF): não é o principal; o mesmo de novo recusa.
    const r2 = await gravar('cadastro.incluirRegistroProfissional', {
      ...registro,
      uf: 'SP',
      convenios: [],
      profissional: prof,
    });
    const reg2 = r2.resultado['registro']!;
    expect(
      (
        await falha(
          gravar('cadastro.incluirRegistroProfissional', {
            ...registro,
            uf: 'SP',
            convenios: [],
            profissional: prof,
          }),
        )
      ).codigo,
    ).toBe('registro-repetido');

    // Especialidade pelo registro; repetir a mesma situação recusa.
    await gravar('cadastro.definirEspecialidadeProfissional', {
      registro: reg,
      especialidade: m.especialidade,
      ativo: true,
    });
    expect(
      (
        await falha(
          gravar('cadastro.definirEspecialidadeProfissional', {
            registro: reg,
            especialidade: m.especialidade,
            ativo: true,
          }),
        )
      ).codigo,
    ).toBe('sem-alteracao');
    const esp = await ler((l) =>
      l.uma(
        'SELECT inscricao_conselho_id, ativo FROM profissional_especialidade WHERE profissional_id = ? AND especialidade_medica_id = ? AND excluido_em IS NULL',
        [prof, m.especialidade],
      ),
    );
    expect([Number(esp?.['inscricao_conselho_id']), Number(esp?.['ativo'])]).toEqual([reg, 1]);

    // Descredenciar fecha a vigência (a linha fica); descredenciar de novo recusa.
    await gravar('cadastro.credenciarProfissional', { registro: reg, convenio: m.fonte, credenciado: false });
    const cred = await ler((l) =>
      l.uma<{ n: unknown; abertas: unknown }>(
        'SELECT COUNT(*) AS n, SUM(vigencia_fim IS NULL) AS abertas FROM profissional_fonte_pagadora WHERE inscricao_conselho_id = ?',
        [reg],
      ),
    );
    expect([Number(cred?.n), Number(cred?.abertas ?? 0)]).toEqual([1, 0]);
    expect(
      (
        await falha(
          gravar('cadastro.credenciarProfissional', { registro: reg, convenio: m.fonte, credenciado: false }),
        )
      ).codigo,
    ).toBe('sem-alteracao');
    // Credenciar de novo no mesmo dia: a mesma vigência reabre (nenhuma linha nova).
    await gravar('cadastro.credenciarProfissional', { registro: reg, convenio: m.fonte, credenciado: true });
    const cred2 = await ler((l) =>
      l.uma<{ n: unknown; abertas: unknown }>(
        'SELECT COUNT(*) AS n, SUM(vigencia_fim IS NULL) AS abertas FROM profissional_fonte_pagadora WHERE inscricao_conselho_id = ?',
        [reg],
      ),
    );
    expect([Number(cred2?.n), Number(cred2?.abertas ?? 0)]).toEqual([1, 1]);

    // Terceiro registro inativado à mão (alterar o registro, com motivo) no mesmo dia, antes da inativação do
    // profissional: a reativação do profissional não o devolve.
    const reg3 = (
      await gravar('cadastro.incluirRegistroProfissional', {
        ...registro,
        uf: 'RJ',
        convenios: [],
        profissional: prof,
      })
    ).resultado['registro']!;
    const v3 = await ler((l) =>
      l.uma<{ versao: unknown }>('SELECT versao FROM inscricao_conselho WHERE id = ?', [reg3]),
    );
    await gravar('cadastro.alterarRegistroProfissional', {
      registro: reg3,
      versao: `v${Number(v3?.versao)}`,
      alteracoes: { ativo: false },
      motivo: 'Inscrição cancelada no conselho (teste)',
    });

    // Inativar: os dois registros ativos e o profissional (data e motivo); de novo recusa. Reativar volta só os dois.
    const ina = await gravar('cadastro.inativarProfissional', {
      profissional: prof,
      motivo: 'Saiu do corpo clínico (teste)',
    });
    expect(ina.resultado['registros']).toBe(2);
    const situacoes = () =>
      ler(async (l) => ({
        p: await l.uma<{ situacao: unknown; hoje: unknown; motivo_inativacao: unknown }>(
          'SELECT situacao, data_inativacao = CURRENT_DATE AS hoje, motivo_inativacao FROM profissional WHERE id = ?',
          [prof],
        ),
        r: (
          await l.consultar(
            'SELECT id, situacao, inativado_com_profissional AS marca FROM inscricao_conselho WHERE profissional_id = ? ORDER BY id',
            [prof],
          )
        ).map((x) => [Number(x['id']), String(x['situacao']), Number(x['marca'])]),
      }));
    const s1 = await situacoes();
    expect(s1.p).toMatchObject({ situacao: 'inativo', motivo_inativacao: 'Saiu do corpo clínico (teste)' });
    expect(Number(s1.p?.hoje)).toBe(1);
    expect(s1.r).toEqual([
      [reg, 'inativa', 1],
      [reg2, 'inativa', 1],
      [reg3, 'inativa', 0],
    ]);
    expect(
      (
        await falha(
          gravar('cadastro.inativarProfissional', { profissional: prof, motivo: 'Saiu de novo (teste)' }),
        )
      ).codigo,
    ).toBe('ja-inativo');
    const rea = await gravar('cadastro.reativarProfissional', {
      profissional: prof,
      motivo: 'Voltou ao corpo clínico (teste)',
    });
    expect(rea.resultado['registros']).toBe(2);
    const s2 = await situacoes();
    expect(s2.p).toMatchObject({ situacao: 'ativo', motivo_inativacao: null });
    expect(s2.p?.hoje ?? null).toBeNull();
    expect(s2.r).toEqual([
      [reg, 'ativa', 0],
      [reg2, 'ativa', 0],
      [reg3, 'inativa', 0],
    ]);
    // Trilha com o motivo de cada operação, na mesma transação.
    const trilha = await ler((l) =>
      l.uma<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'profissional' AND entidade_id = ?
            AND motivo IN ('Saiu do corpo clínico (teste)', 'Voltou ao corpo clínico (teste)')`,
        [prof],
      ),
    );
    expect(Number(trilha?.n)).toBeGreaterThanOrEqual(2);

    // Login ligado (aqui, o histórico de um vínculo do usuário já encerrado) impede excluir, com a frase da memória.
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'prof-proprio-login' }, (e) =>
      e.executar(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio,
            vigencia_fim, criado_em) VALUES (?, ?, ?, '${VIGENCIA_LOGIN}', '2001-01-31', NOW(3))`,
        [m.usuario, m.estabelecimento, prof],
      ),
    );
    expect(await porta.vinculosProfissional(contextoPorta(m), prof)).toEqual([
      { grupo: 'Histórico do login do sistema', quantidade: 1 },
    ]);
    expect(
      (
        await falha(
          gravar('cadastro.excluirProfissional', {
            profissional: prof,
            motivo: 'Cadastrado por engano (teste)',
          }),
        )
      ).codigo,
    ).toBe('profissional-com-vinculos');
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'prof-proprio-login' }, (e) =>
      e.executar(
        `DELETE FROM usuario_vinculo_profissional WHERE profissional_id = ? AND vigencia_inicio = '${VIGENCIA_LOGIN}'`,
        [prof],
      ),
    );

    // Excluir o registro principal por engano: o próximo registro ativo passa a ser o principal.
    await gravar('cadastro.excluirRegistroProfissional', {
      registro: reg,
      motivo: 'Incluído por engano (teste)',
    });
    const princ = await ler((l) =>
      l.consultar(
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND principal AND excluido_em IS NULL',
        [prof],
      ),
    );
    expect(princ.map((x) => Number(x['id']))).toEqual([reg2]);
    await gravar('cadastro.excluirProfissional', {
      profissional: prof,
      motivo: 'Cadastrado por engano (teste)',
    });
    const fim = await ler((l) =>
      l.uma<{ p: unknown; i: unknown }>(
        `SELECT (SELECT COUNT(*) FROM profissional WHERE id = ? AND excluido_em IS NOT NULL) AS p,
                (SELECT COUNT(*) FROM inscricao_conselho WHERE profissional_id = ? AND excluido_em IS NOT NULL) AS i`,
        [prof, prof],
      ),
    );
    expect([Number(fim?.p), Number(fim?.i)]).toEqual([1, 3]);
    expect(reg2).toBeGreaterThan(reg);
    expect(
      Number(
        (
          await ler((l) =>
            l.uma<{ n: unknown }>(
              "SELECT COUNT(*) AS n FROM profissional_versao WHERE profissional_id = ? AND operacao = 'exclusao'",
              [prof],
            ),
          )
        )?.n,
      ),
    ).toBe(1);

    // Recadastro do mesmo CPF depois da exclusão por engano: a mesma linha do profissional e do registro volta.
    const r3 = await gravar('cadastro.cadastrarProfissional', { nome: `MEDICA ${M}`, cpf, registro });
    expect([r3.resultado['profissional'], r3.resultado['registro']]).toEqual([prof, reg]);
    const volta = await ler((l) =>
      l.uma(
        `SELECT pr.situacao, pr.excluido_em IS NULL AS vivo, ic.situacao AS reg, ic.principal, ic.excluido_em IS NULL AS reg_vivo
           FROM profissional pr JOIN inscricao_conselho ic ON ic.id = ? WHERE pr.id = ?`,
        [reg, prof],
      ),
    );
    expect(volta).toMatchObject({ situacao: 'ativo', reg: 'ativa' });
    expect([Number(volta?.['vivo']), Number(volta?.['principal']), Number(volta?.['reg_vivo'])]).toEqual([
      1, 1, 1,
    ]);

    // CPF de pessoa excluída: recusa própria (nunca o UNIQUE como 500).
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'prof-proprio-pessoa' }, (e) =>
      e.executar(
        'INSERT INTO pessoa_fisica (nome, cpf, criado_em, excluido_em) VALUES (?, ?, NOW(3), NOW(3))',
        [`EXCLUIDA ${M}`, cpf3],
      ),
    );
    const f3 = await falha(
      gravar('cadastro.cadastrarProfissional', {
        nome: `EXCLUIDA ${M}`,
        cpf: cpf3,
        registro: { ...registro, uf: 'BA', convenios: [] },
      }),
    );
    expect([f3.status, f3.codigo]).toEqual([409, 'cpf-pessoa-excluida']);
  });
});
