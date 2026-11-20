// Balanço hídrico pela HTTP (M45, etapa 3; regras 6, 15 e 16), com a sessão real sobre a fonte sintética e as portas
// EM MEMÓRIA (nada conecta a banco; dados sintéticos): a janela anterior com o ganho vindo da checagem e a diurese dos
// sinais, o lançamento com a chave do ato, as recusas do domínio, o estorno uma vez só, o fechamento de 24 horas com a
// impressão vista (uma vez só; depois a janela não recebe nada), o parcial e as permissões (o técnico não fecha).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BalancoDoPaciente } from '@sgh/contratos';
import { janelaDoInstante, somarMinutos } from '@sgh/dominio-enfermagem';
import { type AppEnfermagem, criarAppEnfermagem } from './enfermagem.spec-util.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

const AT = 25_102;
// 13:00 em São Paulo (relógio fixo): a janela em curso começa às 7 h de hoje; a anterior, às 7 h de ontem.
const ATUAL = janelaDoInstante('2026-10-22T13:00', '0700').inicio;
const ANTERIOR = somarMinutos(ATUAL, -24 * 60);

const ler = async (s: Awaited<ReturnType<AppEnfermagem['entrar']>>, q = '') => {
  const r = await a.get(s, `/enfermagem/balanco/${AT}${q}`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as BalancoDoPaciente;
};

describe('balanço hídrico (M45, etapa 3)', () => {
  it('lista as unidades e os pacientes; o balanço em curso com a hora de corte padrão (7 h)', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const u = await a.get(s, '/enfermagem/balanco/unidades');
    expect(u.statusCode).toBe(200);
    const ps = await a.get(s, '/enfermagem/balanco/unidades/UTI/pacientes');
    expect(ps.json().map((p: { atendimento: number }) => p.atendimento)).toContain(AT);
    const b = await ler(s);
    expect(b).toMatchObject({ atendimento: AT, horaCorte: '0700', janela: { inicio: ATUAL, atual: true } });
    expect(b.janelas.map((j) => j.inicio)).toEqual([ATUAL, ANTERIOR, somarMinutos(ANTERIOR, -24 * 60)]);
    expect(b.gravacao.operacoes['fechar']?.pode).toBe(true);
    expect(b.dominios.tiposEliminacao.find((t) => t.codigo === 3)?.pedeIntensidade).toBe(true);
    expect(a.trilha.eventos.some((l) => l.evento === 'enfermagem.balanco.lido')).toBe(true);
    expect((await a.get(s, '/enfermagem/balanco/99999')).statusCode).toBe(404);
    expect(
      (await a.get(s, `/enfermagem/balanco/${AT}?inicio=${ANTERIOR.replace('07:00', '08:00')}`)).statusCode,
    ).toBe(400);
  });

  it('janela anterior: o ganho vindo da checagem e a diurese dos sinais entram sem redigitar; o horário sem mL fica fora com o motivo', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const b = await ler(s, `?inicio=${ANTERIOR}`);
    expect(b.janela).toMatchObject({ inicio: ANTERIOR, atual: false, fechada: false });
    expect(b.pendentes.map((p) => [p.origem, p.volumeMl, p.grupo ?? p.tipoEliminacao])).toEqual([
      ['sinal', 600, 1],
      ['checagem', 500, 4],
    ]);
    expect(b.semVolume.map((x) => x.descricao)).toEqual([expect.stringMatching(/DIPIRONA/)]);
    expect(b.peso?.valor).toBe(70);
    expect(b.calculo).toMatchObject({
      ganhosMl: 500,
      perdasMl: 600,
      insensiveisMl: 856.8,
      saldoMl: -956.8,
      horas: 24,
    });
    expect(b.calculo.debitoConta).toContain('600,0 mL ÷ 70,0 kg ÷ 24,0 h = 0,36 mL/kg/h');
    expect(b.calculo.oliguria).toBe(true);
  });

  it('lança uma perda com a intensidade; o mesmo pedido reenviado não grava de novo; as recusas do domínio', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const corpo = {
      lancamentos: [
        {
          sentido: 'perda',
          tipoEliminacao: 3,
          intensidade: 2,
          aspecto: 'bilioso',
          volumeMl: 100,
          horaReal: somarMinutos(ANTERIOR, 600),
        },
      ],
    };
    const r1 = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, corpo, 'balanco-teste-0001');
    expect(r1.statusCode, r1.body).toBe(201);
    const r2 = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, corpo, 'balanco-teste-0001');
    expect(r2.json().ids).toEqual(r1.json().ids);
    const b = await ler(s, `?inicio=${ANTERIOR}`);
    expect(b.lancamentos.filter((l) => l.origem === 'manual')).toHaveLength(1);
    expect(a.trilha.eventos.some((l) => l.evento === 'enfermagem.balanco.lancado')).toBe(true);
    const recusa = async (l: Record<string, unknown>) =>
      (
        await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, { lancamentos: [{ volumeMl: 10, ...l }] })
      ).json().codigo;
    expect(await recusa({ sentido: 'perda', tipoEliminacao: 3 })).toBe('intensidade-exigida');
    expect(await recusa({ sentido: 'perda', tipoEliminacao: 99 })).toBe('valor-nunca-visto');
    expect(await recusa({ sentido: 'ganho', grupo: 1, horaReal: '2026-10-22T14:00' })).toBe('hora-futura');
    const sem = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, corpo, 'x');
    expect(sem.statusCode).toBe(400);
  });

  it('o estorno anula o lançamento uma vez só (o original fica); o estorno de estorno é recusado', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, {
      lancamentos: [
        { sentido: 'ganho', grupo: 1, via: 'VO', volumeMl: 200, horaReal: somarMinutos(ANTERIOR, 300) },
      ],
    });
    const id = r.json().ids[0] as number;
    const e1 = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos/${id}/estorno`, {
      motivo: 'Lançado em duplicidade pelo SINTETICO',
    });
    expect(e1.statusCode, e1.body).toBe(201);
    const e2 = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos/${id}/estorno`, {
      motivo: 'Lançado em duplicidade pelo SINTETICO',
    });
    expect(e2.json().codigo).toBe('ja-estornado');
    const e3 = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos/${e1.json().ids[0]}/estorno`, {
      motivo: 'Estorno do estorno SINTETICO',
    });
    expect(e3.json().codigo).toBe('estorno-de-estorno');
    const b = await ler(s, `?inicio=${ANTERIOR}`);
    expect(b.lancamentos.find((l) => l.id === id)?.estornadoPor).toBe(e1.json().ids[0]);
    expect(b.calculo.ganhosMl).toBe(500);
  });

  it('o técnico lança mas não fecha; o fechamento de 24 horas exige a impressão vista e fecha uma vez só', async () => {
    const t = await a.entrar('SINT.TECNICO.ENF');
    const bt = await ler(t, `?inicio=${ANTERIOR}`);
    expect(bt.gravacao.operacoes['lancar']?.pode).toBe(true);
    expect(bt.gravacao.operacoes['fechar']?.pode).toBe(false);
    const pedido = {
      tipo: 'total',
      inicio: ANTERIOR,
      ate: ATUAL,
      pesoKg: null,
      impressaoVista: bt.calculo.impressao,
    };
    expect((await a.post(t, `/enfermagem/balanco/${AT}/fechamentos`, pedido)).statusCode).toBe(403);
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const errado = await a.post(s, `/enfermagem/balanco/${AT}/fechamentos`, {
      ...pedido,
      impressaoVista: '0'.repeat(64),
    });
    expect(errado.json().codigo).toBe('balanco-mudou');
    const em = await a.post(s, `/enfermagem/balanco/${AT}/fechamentos`, {
      ...pedido,
      inicio: ATUAL,
      ate: '2026-10-22T13:00',
    });
    expect(em.json().codigo).toBe('janela-em-curso');
    const ok = await a.post(s, `/enfermagem/balanco/${AT}/fechamentos`, pedido);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().mensagem).toMatch(/24 horas fechado/);
    const depois = await ler(s, `?inicio=${ANTERIOR}`);
    expect(depois.janela.fechada).toBe(true);
    expect(depois.pendentes).toEqual([]);
    expect(depois.lancamentos.filter((l) => l.origem === 'checagem' || l.origem === 'sinal')).toHaveLength(2);
    expect(depois.fechamentos[0]).toMatchObject({
      tipo: 'total',
      inicio: ANTERIOR,
      fim: ATUAL,
      oliguria: true,
    });
    expect(depois.fechamentos[0]?.parcelas).toContain('Saldo: ganhos');
    expect(a.trilha.eventos.some((l) => l.evento === 'enfermagem.balanco.fechado')).toBe(true);
    const de2 = await a.post(s, `/enfermagem/balanco/${AT}/fechamentos`, {
      ...pedido,
      impressaoVista: depois.calculo.impressao,
    });
    expect(de2.json().codigo).toBe('ja-fechado');
    const tarde = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, {
      lancamentos: [{ sentido: 'ganho', grupo: 1, volumeMl: 50, horaReal: somarMinutos(ANTERIOR, 60) }],
    });
    expect(tarde.json().codigo).toBe('janela-fechada');
  });

  it('o parcial da janela em curso, até agora, com o peso informado (o lançamento do próprio minuto conta e não recusa)', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    // O lançamento "agora" (13:00) e o parcial no mesmo minuto: o mesmo intervalo dos dois lados ([inicio, ate]).
    const agora = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, {
      lancamentos: [{ sentido: 'ganho', grupo: 1, volumeMl: 120, horaReal: '2026-10-22T13:00' }],
    });
    expect(agora.statusCode, agora.body).toBe(201);
    const b = await ler(s, '?peso=80');
    expect(b.calculo.ganhosMl).toBe(120);
    expect(b.calculo.pesoKg).toBe(80);
    expect(b.calculo.ate).toBe('2026-10-22T13:00');
    const r = await a.post(s, `/enfermagem/balanco/${AT}/fechamentos`, {
      tipo: 'parcial',
      inicio: ATUAL,
      ate: b.calculo.ate,
      pesoKg: 80,
      impressaoVista: b.calculo.impressao,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().mensagem).toMatch(/parcial fechado/);
    expect((await ler(s)).fechamentos.some((f) => f.tipo === 'parcial')).toBe(true);
    const futuro = await a.post(s, `/enfermagem/balanco/${AT}/fechamentos`, {
      tipo: 'parcial',
      inicio: ATUAL,
      ate: '2026-10-22T13:30',
      pesoKg: 80,
      impressaoVista: b.calculo.impressao,
    });
    expect(futuro.statusCode).toBe(400);
  });

  it('o parcial até uma hora anterior não conta (nem confere) o lançamento feito depois dela', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const depois = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, {
      lancamentos: [{ sentido: 'ganho', grupo: 1, volumeMl: 80, horaReal: '2026-10-22T12:50' }],
    });
    expect(depois.statusCode, depois.body).toBe(201);
    const b = await ler(s, '?ate=2026-10-22T12:30');
    expect(b.calculo.ate).toBe('2026-10-22T12:30');
    const r = await a.post(s, `/enfermagem/balanco/${AT}/fechamentos`, {
      tipo: 'parcial',
      inicio: ATUAL,
      ate: '2026-10-22T12:30',
      pesoKg: null,
      impressaoVista: b.calculo.impressao,
    });
    expect(r.statusCode, r.body).toBe(201);
  });

  it('o lançamento de antes da internação é recusado (422) e a janela de antes dela não é oferecida', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const desde = somarMinutos(ANTERIOR, -30 * 60);
    const b = await ler(s);
    expect(b.internadoDesde).toBe(desde);
    expect(b.janelas.every((j) => j.fim > desde)).toBe(true);
    const r = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, {
      lancamentos: [{ sentido: 'ganho', grupo: 1, volumeMl: 30, horaReal: somarMinutos(desde, -60) }],
    });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json().codigo).toBe('hora-antes-da-internacao');
    const naEntrada = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, {
      lancamentos: [{ sentido: 'ganho', grupo: 1, volumeMl: 30, horaReal: somarMinutos(desde, 60) }],
    });
    expect(naEntrada.statusCode, naEntrada.body).toBe(201);
  });

  it('a chave do ato usada em outro atendimento ou por outro usuário é recusada (409), sem devolver o lançamento', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const corpo = {
      lancamentos: [{ sentido: 'ganho', grupo: 1, volumeMl: 40, horaReal: '2026-10-22T11:00' }],
    };
    const r1 = await a.post(s, `/enfermagem/balanco/${AT}/lancamentos`, corpo, 'balanco-reuso-0001');
    expect(r1.statusCode, r1.body).toBe(201);
    const outro = await a.post(s, `/enfermagem/balanco/25103/lancamentos`, corpo, 'balanco-reuso-0001');
    expect(outro.statusCode, outro.body).toBe(409);
    expect(outro.json().codigo).toBe('chave-reutilizada');
    expect(outro.body).not.toContain(String(r1.json().ids[0]));
    const t = await a.entrar('SINT.TECNICO.ENF');
    const deOutro = await a.post(t, `/enfermagem/balanco/${AT}/lancamentos`, corpo, 'balanco-reuso-0001');
    expect(deOutro.json().codigo).toBe('chave-reutilizada');
  });
});
