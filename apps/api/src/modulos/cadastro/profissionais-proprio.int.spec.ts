// D-PROF-39 sobre o banco próprio (fecho-1): as gravações do profissional pelo Executor contra o MariaDB real (cliente
// f22_o1, a massa do cadastro). Profissional SINTÉTICO (marca PROFPROPRIO, CPF de dígito calculado), apagado no fim.
// Contrato de efeito: cadastrar (pessoa, profissional, inscrição principal, ocupação, credenciamento), alterar pela
// versão (pessoa e profissional; versão velha 409), registro novo e repetido, especialidade pelo registro,
// descredenciar (vigência fechada, nunca apagada), inativar e reativar (registros e situação), excluir por engano
// (excluido_em) e as pendências de modelo (lotação e login: 501). SGH_NUCLEO_SEM_BANCO=1 pula.
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
  const numero = 700_000 + Math.floor(Math.random() * 99_999);

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
      for (const t of ['profissional_fonte_pagadora', 'profissional_especialidade', 'profissional_ocupacao'])
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

    // Inativar: os dois registros e o profissional; de novo recusa. Reativar volta os dois.
    const ina = await gravar('cadastro.inativarProfissional', {
      profissional: prof,
      motivo: 'Saiu do corpo clínico (teste)',
    });
    expect(ina.resultado['registros']).toBe(2);
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

    // Pendências de modelo: 501.
    expect(
      (
        await falha(
          gravar('cadastro.lotarProfissional', {
            registro: reg,
            unidade: 1,
            horasAmbulatorio: 1,
            horasHospital: 1,
            horasOutros: 0,
            ativo: true,
          }),
        )
      ).status,
    ).toBe(501);

    // Excluir o registro e o profissional cadastrados por engano: excluido_em (nada some do banco).
    await gravar('cadastro.excluirRegistroProfissional', {
      registro: reg2,
      motivo: 'Incluído por engano (teste)',
    });
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
    expect([Number(fim?.p), Number(fim?.i)]).toEqual([1, 2]);
    expect(reg2).toBeGreaterThan(reg);
  });
});
