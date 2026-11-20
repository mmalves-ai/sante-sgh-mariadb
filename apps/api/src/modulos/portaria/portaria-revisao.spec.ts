// Correção da revisão do M50.5 pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (dados
// sintéticos; nada conecta a banco): a rota clínica não revoga o sigilo; o porteiro não vê o paciente com sigilo pela
// tela dos acompanhantes; o acompanhante com direito legal entra mesmo com o sigilo; o autorizado pela equipe segue a
// regra da unidade e não tem a refeição; a recepção interna (só a opção dos acompanhantes) busca e cadastra a pessoa; o
// controle de infecção (só os relatórios) emite os contatos sem as regras; a visita vencida não conta nem prende.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CrachaVisita, PacientePortaria } from '@sgh/contratos';
import { type AppPortaria, cadastrar, criarAppPortaria, visita } from './portaria.spec-util.js';

let a: AppPortaria;
beforeAll(async () => {
  a = await criarAppPortaria();
});
afterAll(async () => {
  await a.fechar();
});

const UM = 50_501; // INT-2 (16 h às 18 h), 1950
const TRES = 50_503; // UTI-1 (1 visitante ao mesmo tempo; o dia inteiro pela regra dos testes: 14 h às 20 h)
const SIGILO = 50_504; // INT-3, sigilo de presença semeado
const CRIANCA = 50_505; // INT-1

describe('portaria: correção da revisão (M50.5)', () => {
  it('a rota do bloqueio clínico não revoga o sigilo de presença (nem outro motivo): 409 e o bloqueio continua', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const p = await a.entrar('SINT.PORTARIA');
    const regras = (await a.get(sup, '/portaria/regras')).json() as {
      bloqueios: { id: number; motivo: string; internacao: number }[];
    };
    const sigilo = regras.bloqueios.find((b) => b.motivo === 'sigilo' && b.internacao === SIGILO)!;
    expect(sigilo).toBeDefined();
    const r = await a.post(enf, `/portaria/bloqueios-clinicos/${sigilo.id}/revogacao`, {
      motivo: 'Tentativa SINTETICA pela rota clinica',
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({ codigo: 'so-bloqueio-clinico' });
    expect((await a.get(p, `/portaria/pacientes/${SIGILO}/avaliacao`)).statusCode).toBe(404);
    const depois = (await a.get(sup, '/portaria/regras')).json() as { bloqueios: { id: number }[] };
    expect(depois.bloqueios.some((b) => b.id === sigilo.id)).toBe(true);
  });

  it('o porteiro não vê o paciente com sigilo pela tela dos acompanhantes; o acompanhante legal dele entra mesmo assim', async () => {
    const p = await a.entrar('SINT.PORTARIA');
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const lista = (await a.get(p, '/portaria/acompanhantes?unidade=INT-3')).json() as {
      internados: { internacao: number }[];
    };
    expect(lista.internados.map((i) => i.internacao)).not.toContain(SIGILO);
    const doSup = (await a.get(sup, '/portaria/acompanhantes?unidade=INT-3')).json() as {
      internados: { internacao: number }[];
    };
    expect(doSup.internados.map((i) => i.internacao)).toContain(SIGILO);
    const acomp = await cadastrar(a, p, 'SINTSIG001');
    const outro = await cadastrar(a, p, 'SINTSIG002');
    const corpo = {
      internacao: SIGILO,
      visitante: acomp,
      fundamento: 'deficiencia',
      refeicao: true,
      pernoite: true,
    };
    // O porteiro não confirma a internação com sigilo; a supervisão registra o acompanhante.
    expect((await a.post(p, '/portaria/acompanhantes', corpo)).statusCode).toBe(404);
    expect((await a.post(sup, '/portaria/acompanhantes', corpo)).statusCode).toBe(201);
    const l2 = (await a.get(p, '/portaria/acompanhantes')).json() as {
      acompanhantes: { internacao: number }[];
    };
    expect(l2.acompanhantes.map((x) => x.internacao)).not.toContain(SIGILO);
    // Pelo próprio visitante: a internação de que ele é o acompanhante.
    const ac = (await a.get(p, `/portaria/visitantes/${acomp}/acompanhamento`)).json() as {
      paciente: PacientePortaria | null;
    };
    expect(ac.paciente).toMatchObject({ internacao: SIGILO });
    expect(
      ((await a.get(p, `/portaria/visitantes/${outro}/acompanhamento`)).json() as { paciente: unknown })
        .paciente,
    ).toBeNull();
    const av = await a.get(p, `/portaria/pacientes/${SIGILO}/avaliacao?visitante=${acomp}&identificacao=2`);
    expect(av.statusCode, av.body).toBe(200);
    expect(av.json()).toMatchObject({ permitida: true, papel: 'acompanhante' });
    expect((await a.get(p, `/portaria/pacientes/${SIGILO}/avaliacao?visitante=${outro}`)).statusCode).toBe(
      404,
    );
    expect((await visita(a, p, outro, SIGILO)).statusCode).toBe(404);
    const e = await visita(a, p, acomp, SIGILO);
    expect(e.statusCode, e.body).toBe(201);
    expect(e.json()).toMatchObject({ mensagem: expect.stringMatching(/acompanhante/) });
  });

  it('o autorizado pela equipe segue a regra da unidade (horário) e não tem a refeição do acompanhante', async () => {
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const p = await a.entrar('SINT.PORTARIA');
    const v = await cadastrar(a, p, 'SINTAUT001');
    const base = { internacao: UM, visitante: v, fundamento: 'autorizado', pernoite: false };
    const comRefeicao = await a.post(p, '/portaria/acompanhantes', { ...base, refeicao: true });
    expect(comRefeicao.statusCode).toBe(400);
    expect(comRefeicao.json()).toMatchObject({ campos: ['refeicao'] });
    const r = await a.post(p, '/portaria/acompanhantes', { ...base, refeicao: false });
    expect(r.statusCode, r.body).toBe(201);
    // Às 15 h a INT-2 (16 h às 18 h) está fora do horário: o autorizado não entra; o supervisor pode excepcionar.
    expect((await visita(a, p, v, UM)).json()).toMatchObject({ codigo: 'fora-do-horario' });
    const x = await visita(a, sup, v, UM, { excecao: 'Excecao SINTETICA do supervisor' });
    expect(x.statusCode, x.body).toBe(201);
    // O crachá do autorizado tem a validade do visitante (não a do acompanhante legal, de 24 horas).
    expect((x.json() as { cracha: CrachaVisita }).cracha.validoAte < '2026-10-26T00:00').toBe(true);
    await a.post(sup, `/portaria/visitas/${(x.json() as { id: number }).id}/saida`);
  });

  it('a recepção interna (só a opção dos acompanhantes) busca e cadastra a pessoa e registra o acompanhante', async () => {
    const rec = await a.entrar('SINT.RECEPCAO.INTERNA');
    expect((await a.get(rec, '/portaria/visitantes?busca=visitante')).statusCode).toBe(403);
    const painel = await a.get(rec, '/portaria/acompanhantes?unidade=INT-1');
    expect(painel.statusCode, painel.body).toBe(200);
    expect((painel.json() as { tiposVisitante: unknown[] }).tiposVisitante.length).toBeGreaterThan(0);
    const c = await a.post(rec, '/portaria/acompanhantes/visitantes', {
      nome: 'Acompanhante Sintetico Recepcao',
      tipoDocumento: 'outro',
      documento: 'SINTREC001',
      nascimento: '1980-01-01',
      tipoVisitante: 1,
    });
    expect(c.statusCode, c.body).toBe(201);
    const [pessoa] = (
      await a.get(rec, '/portaria/acompanhantes/visitantes?tipo=outro&documento=SINTREC001')
    ).json() as {
      id: number;
    }[];
    expect(pessoa).toBeDefined();
    const r = await a.post(rec, '/portaria/acompanhantes', {
      internacao: CRIANCA,
      visitante: pessoa!.id,
      fundamento: 'crianca',
      refeicao: true,
      pernoite: true,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(a.trilha.eventos.some((l) => l.evento === 'hotelaria.visitante.registrado')).toBe(true);
  });

  it('o controle de infecção (só os relatórios) emite os contatos sem as regras de visita', async () => {
    const scih = await a.entrar('SINT.SCIH');
    expect((await a.get(scih, '/portaria/regras')).statusCode).toBe(403);
    const u = await a.get(scih, '/portaria/contatos/unidades');
    expect(u.statusCode, u.body).toBe(200);
    expect((u.json() as { unidade: string }[]).map((x) => x.unidade)).toContain('INT-2');
    const i = await a.get(scih, '/portaria/contatos/internados?unidade=INT-3');
    expect(i.statusCode, i.body).toBe(200);
    // A investigação de surto vê todos os internados da unidade (o sigilo vale para a portaria).
    expect((i.json() as { internacao: number }[]).map((x) => x.internacao)).toContain(SIGILO);
    const c = await a.get(scih, `/portaria/contatos?internacao=${SIGILO}&de=2026-10-20&ate=2026-10-25`);
    expect(c.statusCode, c.body).toBe(200);
    const p = await a.entrar('SINT.PORTARIA');
    expect((await a.get(p, '/portaria/contatos/unidades')).statusCode).toBe(403);
  });
});

describe('portaria: a visita vencida sem a saída (M50.5, correção da revisão)', () => {
  let b: AppPortaria;
  beforeAll(async () => {
    b = await criarAppPortaria();
  });
  afterAll(async () => {
    await b.fechar();
  });

  it('não conta no limite, não prende o visitante (encerrada como expirada) e some das abertas depois de 24 horas', async () => {
    const p = await b.entrar('SINT.PORTARIA');
    const v1 = await cadastrar(b, p, 'SINTVEN001');
    const v2 = await cadastrar(b, p, 'SINTVEN002');
    // UTI-1: 1 visitante ao mesmo tempo.
    const e1 = await visita(b, p, v1, TRES);
    expect(e1.statusCode, e1.body).toBe(201);
    expect((await visita(b, p, v2, TRES)).json()).toMatchObject({ codigo: 'limite' });
    const validoAte = (e1.json() as { cracha: CrachaVisita }).cracha.validoAte;
    // O visitante 1 foi embora sem passar na portaria; depois da validade, a vaga volta.
    b.relogio.agora = new Date(
      Number(validoAte.slice(0, 4)),
      Number(validoAte.slice(5, 7)) - 1,
      Number(validoAte.slice(8, 10)),
      Number(validoAte.slice(11, 13)),
      Number(validoAte.slice(14, 16)) + 1,
    );
    const e2 = await visita(b, p, v2, TRES);
    expect(e2.statusCode, e2.body).toBe(201);
    const s2 = await b.post(p, `/portaria/visitas/${(e2.json() as { id: number }).id}/saida`);
    expect(s2.statusCode, s2.body).toBe(201);
    // O mesmo visitante 1 entra de novo: a visita vencida é encerrada como expirada.
    const e3 = await visita(b, p, v1, TRES);
    expect(e3.statusCode, e3.body).toBe(201);
    const antiga = b.porta.visitas.find((x) => x.id === (e1.json() as { id: number }).id)!;
    expect(antiga).toMatchObject({ saida: validoAte, origem: 'expirada' });
    // A vencida há mais de 24 horas não aparece mais entre as abertas do painel.
    const e3id = (e3.json() as { id: number }).id;
    b.relogio.agora = new Date(b.relogio.agora.getTime() + 3 * 24 * 3_600_000);
    const painel = (await b.get(p, '/portaria')).json() as { abertas: { id: number }[] };
    expect(painel.abertas.map((x) => x.id)).not.toContain(e3id);
  });
});
