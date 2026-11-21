// Regra 10 do M25 (ficha, seção 8; cap-11 §11.2 "Suspensão"): a suspensão feita na prescrição (neste ou no outro
// sistema) passa os horários futuros a suspensos na tela e avisa a enfermagem em até 2 segundos; a checagem feita
// depois da leitura vira conflito visível (nunca sobrescreve). Pela HTTP, com a porta em memória, e pela vigia dos
// horários sobre a mesma porta (dados sintéticos).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppEnfermagem,
  checagemPadrao,
  criarAppEnfermagem,
  horariosDaUti,
} from '../enfermagem.spec-util.js';
import { CONTEXTO_SINTETICO } from '../app-enfermagem.spec-util.js';
import { VigiaHorarios } from '../vigia.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

/** O estabelecimento sintético da sessão de teste (sem banco: o código da sessão identifica o estado em memória). */
const ALVO = CONTEXTO_SINTETICO;

describe('regra 10: suspensão vinda da prescrição', () => {
  it('a vigia avisa em menos de 2 s; a tela mostra suspensa; checar o que a tela leu antes abre o conflito', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const antes = await horariosDaUti(a, s);
    const cef = antes.horarios.filter((x) => x.descricao.startsWith('CEFTRIAXONA'));
    expect(cef.every((x) => x.situacao === 'P')).toBe(true);
    const vigia = new VigiaHorarios(a.porta, 100);
    let avisos = 0;
    const parar = vigia.assinar(ALVO, 'leitos', () => {
      avisos += 1;
    });
    await new Promise((r) => setTimeout(r, 250));
    const inicio = Date.now();
    a.porta.suspenderPrescricaoPorFora(ALVO, 25103);
    while (avisos === 0 && Date.now() - inicio < 2_000) await new Promise((r) => setTimeout(r, 20));
    parar();
    expect(avisos).toBeGreaterThan(0);
    expect(Date.now() - inicio).toBeLessThan(2_000);
    const depois = await horariosDaUti(a, s);
    expect(
      depois.horarios
        .filter((x) => x.descricao.startsWith('CEFTRIAXONA'))
        .every((x) => x.estado === 'suspensa'),
    ).toBe(true);
    // A tela tinha lido "P": a checagem é recusada e o conflito aparece para o enfermeiro.
    const r = await a.post(s, `/enfermagem/horarios/${cef[0]!.id}/checar`, checagemPadrao(25003, 25203));
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('horario-suspenso');
    const k = (await a.get(s, '/enfermagem/conflitos')).json();
    expect(
      k.some((x: { horario: number; tipo: string }) => x.horario === cef[0]!.id && x.tipo === 'suspenso'),
    ).toBe(true);
    const id = k.find((x: { horario: number }) => x.horario === cef[0]!.id).id;
    const res = await a.post(s, `/enfermagem/conflitos/${id}/resolver`, {
      resolucao: 'farmaciaAvisada',
      observacao: 'dose devolvida à farmácia',
    });
    expect(res.statusCode).toBe(200);
    expect((await a.get(s, '/enfermagem/conflitos')).json().some((x: { id: number }) => x.id === id)).toBe(
      false,
    );
  });
});
