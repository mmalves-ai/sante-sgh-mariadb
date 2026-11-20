// Regra 9 do M50 (etapa 5; ficha, seção 8: `porteiro.autorizacao.int-spec.ts`): o porteiro vê só o necessário. Pela HTTP,
// com a sessão real e a porta em memória (dados sintéticos): a busca devolve só os campos da portaria (nenhum dado
// clínico, nem o prontuário); o paciente com sigilo de presença não aparece nem é confirmado (busca, avaliação e a
// entrada respondem como "não encontrado"); com o bloqueio, a mensagem é genérica e o leito não sai; o porteiro não abre
// as regras, os bloqueios, o bloqueio clínico, os contatos, os terminais nem a catraca; nem a tela dos acompanhantes
// mostra (ou aceita) o paciente com sigilo; quem não tem a opção do controle
// de acesso não abre a portaria; a trilha não leva o nome nem o documento do visitante.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PacientePortaria } from '@sgh/contratos';
import { type AppPortaria, cadastrar, criarAppPortaria, visita } from '../portaria.spec-util.js';

let a: AppPortaria;
beforeAll(async () => {
  a = await criarAppPortaria();
});
afterAll(async () => {
  await a.fechar();
});

const TRES = 50_503;
const SIGILO = 50_504;
const CRIANCA = 50_505;

describe('regra 9: o porteiro vê só o necessário', () => {
  it('a busca só com os campos da portaria; o sigilo não aparece nem é confirmado', async () => {
    const p = await a.entrar('SINT.PORTARIA');
    const r = (await a.get(p, '/portaria/pacientes?busca=sintetico')).json() as PacientePortaria[];
    expect(r.length).toBeGreaterThan(0);
    for (const x of r)
      expect(Object.keys(x).sort()).toEqual(
        [
          'acompanhante',
          'horario',
          'internacao',
          'leito',
          'limite',
          'mensagem',
          'nome',
          'orientacao',
          'permitida',
          'recusa',
          'unidade',
          'unidadeNome',
          'visitantesAgora',
        ].sort(),
      );
    expect(r.some((x) => x.internacao === SIGILO)).toBe(false);
    expect((await a.get(p, `/portaria/pacientes/${SIGILO}/avaliacao`)).statusCode).toBe(404);
    const v = await cadastrar(a, p, 'SINTAUT001');
    const e = await visita(a, p, v, SIGILO);
    expect(e.statusCode).toBe(404);
    expect(e.body).not.toMatch(/sigilo/i);
    // Nem pela tela dos acompanhantes (a lista da unidade e os vigentes), nem no registro do acompanhante.
    const ac = (await a.get(p, '/portaria/acompanhantes?unidade=INT-3')).json() as {
      internados: { internacao: number }[];
      acompanhantes: { internacao: number }[];
    };
    expect(ac.internados.some((x) => x.internacao === SIGILO)).toBe(false);
    expect(ac.acompanhantes.some((x) => x.internacao === SIGILO)).toBe(false);
    const reg = await a.post(p, '/portaria/acompanhantes', {
      internacao: SIGILO,
      visitante: v,
      fundamento: 'deficiencia',
      refeicao: false,
      pernoite: false,
    });
    expect(reg.statusCode).toBe(404);
    expect(reg.body).not.toMatch(/sigilo/i);
  });

  it('com o bloqueio, a mensagem é genérica e o leito não sai', async () => {
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const p = await a.entrar('SINT.PORTARIA');
    const b = await a.post(sup, '/portaria/bloqueios', {
      internacao: CRIANCA,
      motivo: 'pedido',
      abrangencia: 'todos',
      justificativa: 'Pedido SINTETICO da familia por escrito',
    });
    expect(b.statusCode, b.body).toBe(201);
    const [c] = ((await a.get(p, '/portaria/pacientes?busca=crianca')).json() as PacientePortaria[]).filter(
      (x) => x.internacao === CRIANCA,
    );
    expect(c).toMatchObject({ permitida: false, recusa: 'bloqueio', leito: null, orientacao: null });
    expect(JSON.stringify(c)).not.toMatch(/pedido|familia|escrito/i);
    const av = await a.get(p, `/portaria/pacientes/${CRIANCA}/avaliacao`);
    expect(av.json()).toMatchObject({ leito: null, excepcionavel: false });
    const permitido = ((await a.get(p, '/portaria/pacientes?busca=tres')).json() as PacientePortaria[])[0];
    expect(permitido?.leito).toBe('U1-02');
  });

  it('o porteiro não abre o que é da supervisão, da enfermagem e da integração', async () => {
    const p = await a.entrar('SINT.PORTARIA');
    for (const url of [
      '/portaria/regras',
      '/portaria/regras/internados?unidade=INT-1',
      '/portaria/bloqueios-clinicos',
      '/portaria/contatos?internacao=50503&de=2026-10-25&ate=2026-10-25',
      '/portaria/terminais',
    ])
      expect((await a.get(p, url)).statusCode, url).toBe(403);
    for (const [url, corpo] of [
      ['/portaria/regras', {}],
      ['/portaria/bloqueios', {}],
      ['/portaria/bloqueios-clinicos', {}],
      ['/portaria/visitantes/expurgo', {}],
      ['/portaria/terminais', {}],
      ['/portaria/catraca/eventos', {}],
      ['/portaria/catraca/simular', {}],
    ] as const)
      expect((await a.post(p, url, corpo)).statusCode, url).toBe(403);
    // Quem não tem a opção do controle de acesso não abre a portaria.
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    expect((await a.get(enf, '/portaria')).statusCode).toBe(403);
    expect((await a.get(enf, '/portaria/pacientes?busca=sintetico')).statusCode).toBe(403);
  });

  it('a trilha da portaria não leva o nome nem o documento do visitante', async () => {
    const p = await a.entrar('SINT.PORTARIA');
    const v = await cadastrar(a, p, 'SINTAUT777', { nome: 'Fulana Sintetica Trilha' });
    expect((await visita(a, p, v, TRES)).statusCode).toBe(201);
    const linhas = JSON.stringify(a.trilha.eventos.filter((l) => /^hotelaria\./.test(l.evento)));
    expect(linhas).not.toMatch(/Fulana|SINTAUT777/);
    expect(linhas).toContain('hotelaria.visitante.registrado');
  });
});
