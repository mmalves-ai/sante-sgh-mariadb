// Integração da porta própria da fachada (M58-F4) contra o MariaDB real (cliente f22_o4; massa sintética): os
// convênios do estabelecimento, o retrato e o impacto, e a troca de situação pelo Executor (trava, trilha e
// idempotência pela chave da proposta), com as recusas no contrato de erro da fachada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  garantir,
  garantirEstabelecimento,
  SEM_BANCO,
} from '../infra/massa-integracao.spec-util.js';
import type { ContextoFachada } from './porta.js';
import { PortaFachadaPropria } from './porta-propria.js';

const CODIGO = 'f2241-fp1';
const A: ContextoFachada = { rede: 'rede-teste', hospital: 'f2241a' };
const B: ContextoFachada = { rede: 'rede-teste', hospital: 'f2241b' };

describe.skipIf(SEM_BANCO)('porta própria da fachada contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFachadaPropria;
  let cod = 0;
  let estA = 0;
  let estB = 0;
  const sql = (q: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f2241' }, (l) => l.consultar(q, p));
  const limpar = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f2241' }, async (e) => {
      await e.executar(
        'DELETE FROM fonte_pagadora_estabelecimento WHERE fonte_pagadora_id IN (SELECT id FROM fonte_pagadora WHERE codigo = ?)',
        [CODIGO],
      );
      await e.executar('DELETE FROM fonte_pagadora WHERE codigo = ?', [CODIGO]);
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await limpar();
    cod = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f2241' }, async (e) => {
      const est = await garantirEstabelecimento(e, 'f2241a');
      estA = est;
      estB = await garantirEstabelecimento(e, 'f2241b');
      const fp = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [CODIGO],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'CONVENIO DE TESTE F2241', 'operadora', 'ativa', ?)",
        [CODIGO, new Date()],
      );
      await e.inserir(
        "INSERT INTO fonte_pagadora_estabelecimento (fonte_pagadora_id, estabelecimento_id, situacao, criado_em) VALUES (?, ?, 'ativa', ?)",
        [fp, est, new Date()],
      );
      return fp;
    });
    porta = new PortaFachadaPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('lista só os convênios do estabelecimento, na forma do contrato; retrato e impacto', async () => {
    expect(await porta.convenios(A)).toContainEqual({
      cod,
      nome: 'CONVENIO DE TESTE F2241',
      situacao: 'A',
      permiteAtend: 1,
    });
    expect((await porta.convenios(B)).map((c) => c.cod)).not.toContain(cod);
    expect(estB).toBeGreaterThan(0);
    expect(await porta.convenio(B, cod)).toBeNull();
    expect(await porta.retratoConvenio(A, cod)).toMatchObject({
      existe: true,
      cod,
      situacao: 'A',
      agendasConsulta: 0,
      agendasExame: 0,
    });
    expect(await porta.retratoConvenio(B, cod)).toEqual({ existe: false, cod });
    expect(await porta.impactoConvenio(A, cod)).toEqual({
      consulta: 0,
      exame: 0,
      contasAbertas: 0,
      carteira: 0,
      profissionais: 0,
    });
    expect(await porta.diariaConvenio()).toBeNull();
    expect(porta.estado('convenio.alterarSituacao')).toBe('verde');
    expect(porta.estado('outra.operacao')).toBeNull();
    expect((await porta.saudeBanco(A)).banco).toMatch(/^MariaDB /);
  });

  const vinculo = (est: () => number) =>
    sql(
      'SELECT id, situacao, versao FROM fonte_pagadora_estabelecimento WHERE fonte_pagadora_id = ? AND estabelecimento_id = ?',
      [cod, est()],
    );

  it('suspende pelo Executor (versão, trilha) e a mesma proposta não grava duas vezes; a desatualizada é recusada', async () => {
    const chave = `f2241-prop-${Date.now()}`;
    const g = { cod, operacao: 'suspender' as const, justificativa: 'teste automatizado', chave };
    expect(await porta.gravarSituacaoConvenio(A, g)).toBe('I');
    const [v] = await vinculo(() => estA);
    expect(v).toMatchObject({ situacao: 'suspensa', versao: 2 });
    // O cadastro do cliente inteiro não muda.
    expect(await sql('SELECT situacao, versao FROM fonte_pagadora WHERE id = ?', [cod])).toEqual([
      { situacao: 'ativa', versao: 1 },
    ]);
    const t = await sql(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'fonte_pagadora_estabelecimento' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [v?.['id']],
    );
    expect(t).toEqual([{ motivo: 'teste automatizado' }]);
    // A repetição da mesma proposta: o resultado da primeira, sem gravar de novo.
    expect(await porta.gravarSituacaoConvenio(A, g)).toBe('I');
    expect((await vinculo(() => estA))[0]).toMatchObject({ versao: 2 });
    // Outra proposta de suspender o já suspenso: o cadastro mudou (409 no contrato da fachada).
    await expect(porta.gravarSituacaoConvenio(A, { ...g, chave: `${chave}-b` })).rejects.toMatchObject({
      status: 409,
    });
    // Outro estabelecimento não altera.
    await expect(
      porta.gravarSituacaoConvenio(B, { ...g, operacao: 'reativar', chave: `${chave}-c` }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await porta.gravarSituacaoConvenio(A, { ...g, operacao: 'reativar', chave: `${chave}-d` })).toBe(
      'A',
    );
  });

  it('com o convênio nos dois estabelecimentos, suspender em A não muda B; o cadastro suspenso é o teto', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f2241' }, (e) =>
      e.inserir(
        "INSERT INTO fonte_pagadora_estabelecimento (fonte_pagadora_id, estabelecimento_id, situacao, criado_em) VALUES (?, ?, 'ativa', ?)",
        [cod, estB, new Date()],
      ),
    );
    const chave = `f2241-dois-${Date.now()}`;
    const g = { cod, operacao: 'suspender' as const, justificativa: 'teste automatizado', chave };
    expect(await porta.gravarSituacaoConvenio(A, g)).toBe('I');
    expect(await porta.convenio(A, cod)).toMatchObject({ situacao: 'I', permiteAtend: 0 });
    expect(await porta.convenio(B, cod)).toMatchObject({ situacao: 'A', permiteAtend: 1 });
    expect((await vinculo(() => estB))[0]).toMatchObject({ situacao: 'ativa', versao: 1 });
    expect(await porta.gravarSituacaoConvenio(A, { ...g, operacao: 'reativar', chave: `${chave}-r` })).toBe(
      'A',
    );
    // O cadastro suspenso para o cliente inteiro vale nos dois e o vínculo sozinho não o reativa.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f2241' }, (e) =>
      e.executar("UPDATE fonte_pagadora SET situacao = 'suspensa' WHERE id = ?", [cod]),
    );
    expect(await porta.convenio(B, cod)).toMatchObject({ situacao: 'I', permiteAtend: 0 });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f2241' }, (e) =>
      e.executar(
        "UPDATE fonte_pagadora_estabelecimento SET situacao = 'suspensa', versao = versao + 1 WHERE fonte_pagadora_id = ? AND estabelecimento_id = ?",
        [cod, estA],
      ),
    );
    await expect(
      porta.gravarSituacaoConvenio(A, { ...g, operacao: 'reativar', chave: `${chave}-t` }),
    ).rejects.toMatchObject({ status: 409 });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f2241' }, async (e) => {
      await e.executar("UPDATE fonte_pagadora SET situacao = 'ativa' WHERE id = ?", [cod]);
      await e.executar(
        "UPDATE fonte_pagadora_estabelecimento SET situacao = 'ativa' WHERE fonte_pagadora_id = ?",
        [cod],
      );
    });
  });
});
