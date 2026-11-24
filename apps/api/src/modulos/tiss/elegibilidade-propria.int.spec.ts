// Contrato de efeito da consulta de elegibilidade (F3.9, 08-INTG L128 (31)) contra o MariaDB real (cliente de teste).
// Massa SINTÉTICA: estabelecimento com o código do teste e uma cobertura com carteira fictícia; paciente, fonte pagadora
// e usuário são ids já existentes do cliente de teste (só lidos, nunca alterados).
// Prova o que fica no banco: a consulta pendente com a carteira como enviada e quem pediu; a resposta elegível com o
// código de validação e a última elegibilidade na cobertura; a consulta do dia reaproveitada (nada gravado de novo); a
// negativa sem motivo recusada; a inelegível com o motivo; a resposta repetida recusada; a carteira vencida recusada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaElegibilidadePropria } from './elegibilidade-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f395ele';
const CARTEIRA = 'SINTF395ELE01';

async function limpar(e: Escritor): Promise<void> {
  await e.executar(
    'DELETE FROM consulta_elegibilidade WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo = ?)',
    [P],
  );
  await e.executar('DELETE FROM cobertura_paciente WHERE numero_carteira LIKE ?', ['SINTF395ELE%']);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaElegibilidadePropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaElegibilidadePropria;
  let m: { usuario: number; paciente: number; cobertura: number; vencida: number };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const um = async (sql: string, p: unknown[] = []) =>
    (await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)))[0]!;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const fonte = await e.uma('SELECT MIN(id) AS id FROM fonte_pagadora');
      if (!usuario?.['id'] || !paciente?.['id'] || !fonte?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente e fonte pagadora.');
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const cobertura = (carteira: string, validade: string) =>
        e.inserir(
          `INSERT INTO cobertura_paciente (paciente_id, fonte_pagadora_id, numero_carteira, validade, vigencia_inicio, situacao, criado_em)
           VALUES (?, ?, ?, ?, '2026-01-01', 'ativa', ?)`,
          [paciente['id'], fonte['id'], carteira, validade, agora],
        );
      return {
        usuario: Number(usuario['id']),
        paciente: Number(paciente['id']),
        cobertura: await cobertura(CARTEIRA, '2030-12-31'),
        vencida: await cobertura('SINTF395ELE02', '2026-01-31'),
      };
    });
    porta = new PortaElegibilidadePropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  it('registra a consulta, a resposta elegível e reaproveita a do dia', async () => {
    const c = await porta.consultar(ctx(), { cobertura: m.cobertura });
    expect(c).toMatchObject({ situacao: 'pendente', reaproveitada: false });
    const g = await um('SELECT * FROM consulta_elegibilidade WHERE id = ?', [c.id]);
    expect(g).toMatchObject({ situacao: 'pendente', numero_carteira: CARTEIRA, respondida_em: null });
    expect(Number(g['cobertura_paciente_id'])).toBe(m.cobertura);
    expect(Number(g['solicitada_por_usuario_id'])).toBe(m.usuario);

    await porta.responder(ctx(), c.id, { situacao: 'elegivel', codigoValidacao: 'VAL123', versao: 1 });
    const r = await um(
      'SELECT situacao, respondida_em, codigo_validacao FROM consulta_elegibilidade WHERE id = ?',
      [c.id],
    );
    expect(r).toMatchObject({ situacao: 'elegivel', codigo_validacao: 'VAL123' });
    expect(r['respondida_em']).not.toBeNull();
    const cob = await um(
      'SELECT ultima_elegibilidade_em, ultima_elegibilidade_aprovada FROM cobertura_paciente WHERE id = ?',
      [m.cobertura],
    );
    expect(cob['ultima_elegibilidade_em']).not.toBeNull();
    expect(Number(cob['ultima_elegibilidade_aprovada'])).toBe(1);

    await expect(
      porta.responder(ctx(), c.id, { situacao: 'inelegivel', motivoNegativa: 'x', versao: 2 }),
    ).rejects.toMatchObject({
      problema: { status: 422 },
    });
    const de = await porta.consultar(ctx(), { cobertura: m.cobertura });
    expect(de).toMatchObject({ id: c.id, reaproveitada: true });
    const n = await um('SELECT COUNT(*) AS n FROM consulta_elegibilidade WHERE cobertura_paciente_id = ?', [
      m.cobertura,
    ]);
    expect(Number(n['n'])).toBe(1);
  });

  it('a negativa exige o motivo e a carteira vencida é recusada', async () => {
    await expect(porta.consultar(ctx(), { cobertura: m.vencida })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `ajuste-${P}` }, (w) =>
      w.executar("UPDATE cobertura_paciente SET validade = '2030-12-31' WHERE id = ?", [m.vencida]),
    );
    const c = await porta.consultar(ctx(), { cobertura: m.vencida });
    await expect(porta.responder(ctx(), c.id, { situacao: 'inelegivel', versao: 1 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await porta.responder(ctx(), c.id, {
      situacao: 'inelegivel',
      motivoNegativa: 'Beneficiário em carência',
      versao: 1,
    });
    const r = await um(
      'SELECT situacao, motivo_negativa, codigo_validacao FROM consulta_elegibilidade WHERE id = ?',
      [c.id],
    );
    expect(r).toMatchObject({
      situacao: 'inelegivel',
      motivo_negativa: 'Beneficiário em carência',
      codigo_validacao: null,
    });
    const cob = await um('SELECT ultima_elegibilidade_aprovada FROM cobertura_paciente WHERE id = ?', [
      m.vencida,
    ]);
    expect(Number(cob['ultima_elegibilidade_aprovada'])).toBe(0);
    const v = await porta.doPaciente(ctx(), m.paciente);
    expect(v.consultas.filter((x) => [CARTEIRA, 'SINTF395ELE02'].includes(x.carteira))).toHaveLength(2);
  });
});
