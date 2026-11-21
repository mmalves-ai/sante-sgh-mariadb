// Portaria e visitantes pela HTTP (M50, etapa 5; regras 9, 10 e 13), com a sessão real sobre a fonte sintética e a porta
// EM MEMÓRIA (nada conecta a banco; dados sintéticos): o cadastro mínimo com a foto, a visita com o crachá (ZPL) e a
// saída, as regras da unidade (horário, limite, idade) com a exceção do supervisor, o bloqueio (mensagem genérica, o
// leito escondido) e a revogação, o sigilo de presença, o bloqueio clínico da enfermagem, o acompanhante com direito
// legal e a troca, o relatório de contatos, os terminais e a catraca, a biometria desligada e o expurgo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CrachaVisita, PacientePortaria, PainelPortaria } from '@sgh/contratos';
import { acompanhantesComRefeicao } from './public-api.js';
import { type AppPortaria, cadastrar, criarAppPortaria, visita } from './portaria.spec-util.js';

let a: AppPortaria;
beforeAll(async () => {
  a = await criarAppPortaria();
});
afterAll(async () => {
  await a.fechar();
});

const UM = 50_501; // INT-2 (a regra das 16 h às 18 h), 1950: pessoa idosa
const DOIS = 50_502; // INT-2, em isolamento
const TRES = 50_503; // UTI-1 (1 visitante ao mesmo tempo)
const SIGILO = 50_504; // sigilo de presença
const CRIANCA = 50_505; // INT-1, 2018
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]).toString(
  'base64',
);

const busca = async (s: Awaited<ReturnType<AppPortaria['entrar']>>, q: string) => {
  const r = await a.get(s, `/portaria/pacientes?busca=${encodeURIComponent(q)}`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as PacientePortaria[];
};

describe('portaria (M50, etapa 5)', () => {
  it('o painel com os domínios, a biometria indisponível (DP-45) e a portaria liberada na sessão sintética', async () => {
    const s = await a.entrar('SINT.PORTARIA');
    const r = await a.get(s, '/portaria');
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json() as PainelPortaria;
    expect(p.gravacao.ligada).toBe(true);
    expect(p.gravacao.operacoes['registrar']?.pode).toBe(true);
    expect(p.gravacao.operacoes['regrar']?.pode).toBe(false);
    expect(p.biometriaLigada).toBe(false);
    expect(p.dominios.identificacoes.filter((i) => !i.disponivel).map((i) => i.nome)).toEqual([
      'Biometria',
      'Facial',
    ]);
    expect(p.retencaoDias).toBe(365);
    expect(a.trilha.eventos.some((l) => l.evento === 'hotelaria.visita.lida')).toBe(true);
  });

  it('a busca: 3 letras ou mais; sem o paciente com sigilo; o isolamento com a orientação; o leito só com a visita permitida', async () => {
    const s = await a.entrar('SINT.PORTARIA');
    expect((await a.get(s, '/portaria/pacientes?busca=pa')).statusCode).toBe(400);
    const r = await busca(s, 'sintetico portaria');
    expect(r.map((p) => p.internacao).sort()).toEqual([UM, DOIS, TRES, CRIANCA].sort());
    const um = r.find((p) => p.internacao === UM)!;
    // INT-2: das 16 h às 18 h; às 15 h, fora do horário: sem o leito.
    expect(um).toMatchObject({
      permitida: false,
      recusa: 'fora-do-horario',
      leito: null,
      horario: '16:00 às 18:00',
    });
    const tres = r.find((p) => p.internacao === TRES)!;
    expect(tres).toMatchObject({ permitida: true, leito: 'U1-02', limite: 1 });
    expect(tres.orientacao).toMatch(/terapia intensiva/);
    expect((await a.get(s, `/portaria/pacientes/${SIGILO}/avaliacao`)).statusCode).toBe(404);
    expect(await busca(s, 'sigilo')).toEqual([]);
  });

  it('o cadastro mínimo: CPF conferido, a foto (só imagem), o mesmo documento atualiza; a busca mascara o documento', async () => {
    const s = await a.entrar('SINT.PORTARIA');
    const ruim = await a.post(s, '/portaria/visitantes', {
      nome: 'Visitante Sintetico',
      tipoDocumento: 'cpf',
      documento: '111.111.111-12',
      tipoVisitante: 6,
    });
    expect(ruim.statusCode).toBe(400);
    const foto = await a.post(s, '/portaria/visitantes', {
      nome: 'Visitante Sintetico Foto',
      tipoDocumento: 'cpf',
      documento: '529.982.247-25',
      tipoVisitante: 6,
      foto: { tipo: 'image/png', base64: JPEG },
    });
    expect(foto.statusCode).toBe(400);
    const id = await cadastrar(a, s, 'SINTFOTO01', { foto: { tipo: 'image/jpeg', base64: JPEG } });
    const de_novo = await a.post(s, '/portaria/visitantes', {
      nome: 'Visitante Sintetico Atualizado',
      tipoDocumento: 'outro',
      documento: 'sint-foto-01',
      tipoVisitante: 6,
    });
    expect(de_novo.json()).toMatchObject({ id, mensagem: expect.stringMatching(/atualizado/) });
    const v = await a.get(s, '/portaria/visitantes?busca=visitante sint');
    expect(v.json()).toContainEqual(
      expect.objectContaining({
        id,
        nome: 'Visitante Sintetico Atualizado',
        documentoMascarado: '•••••••O01',
        temFoto: true,
      }),
    );
    const f = await a.get(s, `/portaria/visitantes/${id}/foto`);
    expect(f.json()).toMatchObject({ tipo: 'image/jpeg', conteudo: JPEG });
    const doc = await a.get(s, '/portaria/visitantes?tipo=outro&documento=SINTFOTO01');
    expect(doc.json()).toHaveLength(1);
    expect((await a.get(s, '/portaria/visitantes?busca=ab')).statusCode).toBe(400);
    expect((await a.get(s, '/portaria/visitantes?tipo=x&documento=AB')).statusCode).toBe(400);
  });

  it('a visita com o crachá e a saída; a segunda entrada do mesmo visitante é recusada; a chave do ato não grava duas vezes', async () => {
    const s = await a.entrar('SINT.PORTARIA');
    const v = await cadastrar(a, s, 'SINTVIS001');
    const r = await visita(a, s, v, TRES, {});
    expect(r.statusCode, r.body).toBe(201);
    const c = (r.json() as { cracha: CrachaVisita }).cracha;
    expect(c.codigo).toMatch(/^[0-9A-Z]{12}$/);
    expect(c.destino).toBe('UTI SINTETICA · U1-02');
    // A UTI: 60 minutos de visita.
    expect(c.validoAte).toBe('2026-10-25T16:00');
    expect(c.zpl).toContain(`^FD${c.codigo}^FS`);
    expect((await visita(a, s, v, TRES)).json()).toMatchObject({ codigo: 'ja-em-visita' });
    const reenvio = await a.post(
      s,
      '/portaria/visitas',
      { visitante: v, destino: { tipo: 'paciente', internacao: TRES }, identificacao: 2 },
      'chave-fixa-m50-5-0001',
    );
    expect(reenvio.statusCode).toBe(409);
    const id = (r.json() as { id: number }).id;
    const de_novo = await a.get(s, `/portaria/visitas/${id}/cracha`);
    expect(de_novo.json()).toMatchObject({ codigo: c.codigo, visita: id });
    const painel = (await a.get(s, '/portaria')).json() as PainelPortaria;
    expect(painel.abertas.find((x) => x.id === id)).toMatchObject({
      destino: { tipo: 'paciente', internacao: TRES, leito: 'U1-02' },
      vencida: false,
    });
    expect((await a.post(s, `/portaria/visitas/${id}/saida`)).statusCode).toBe(201);
    expect((await a.post(s, `/portaria/visitas/${id}/saida`)).json()).toMatchObject({
      codigo: 'visita-encerrada',
    });
    expect(a.trilha.eventos.some((l) => l.evento === 'hotelaria.visita.registrada')).toBe(true);
  });

  it('o limite da unidade e a idade: recusa com exceção possível; só o supervisor autoriza a exceção, com o motivo', async () => {
    const p = await a.entrar('SINT.PORTARIA');
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const v1 = await cadastrar(a, p, 'SINTLIM001');
    const v2 = await cadastrar(a, p, 'SINTLIM002');
    expect((await visita(a, p, v1, TRES)).statusCode).toBe(201);
    const limite = await visita(a, p, v2, TRES);
    expect(limite.statusCode).toBe(409);
    expect(limite.json()).toMatchObject({ codigo: 'limite' });
    const av = await a.get(p, `/portaria/pacientes/${TRES}/avaliacao?visitante=${v2}&identificacao=2`);
    expect(av.json()).toMatchObject({ permitida: false, recusa: 'limite', excepcionavel: true, leito: null });
    expect(
      (await visita(a, p, v2, TRES, { excecao: 'Autorizado pela enfermagem SINTETICA' })).statusCode,
    ).toBe(403);
    const ok = await visita(a, sup, v2, TRES, { excecao: 'Autorizado pela enfermagem SINTETICA' });
    expect(ok.statusCode, ok.body).toBe(201);
    const aberta = (await a.porta.abertas({ hospital: 'aa' } as never)).find((x) => x.visitante === v2)!;
    expect(aberta.excecao).toBe('limite: Autorizado pela enfermagem SINTETICA');
    // A idade: 12 anos na regra.
    const crianca = await cadastrar(a, p, 'SINTIDA001', { nascimento: '2020-01-01' });
    expect((await visita(a, p, crianca, CRIANCA)).json()).toMatchObject({ codigo: 'idade' });
    const sem = await cadastrar(a, p, 'SINTIDA002', { nascimento: null });
    expect((await visita(a, p, sem, CRIANCA)).json()).toMatchObject({ codigo: 'nascimento-exigido' });
    // Biometria sem a DP-45.
    const bio = await visita(a, p, sem, CRIANCA, { identificacao: 1 });
    expect(bio.statusCode).toBe(403);
    expect(bio.json()).toMatchObject({ codigo: 'identificacao-biometrica' });
    // Outro destino: sem o tipo "Paciente".
    const outro = await a.post(p, '/portaria/visitas', {
      visitante: sem,
      destino: { tipo: 'outro', tipoVisitado: 4, local: 'FARMACIA' },
      identificacao: 2,
    });
    expect(outro.statusCode).toBe(400);
    const forn = await a.post(p, '/portaria/visitas', {
      visitante: sem,
      destino: { tipo: 'outro', tipoVisitado: 2, local: 'FARMACIA SINTETICA' },
      identificacao: 3,
    });
    expect(forn.statusCode, forn.body).toBe(201);
    expect((forn.json() as { cracha: CrachaVisita }).cracha.destino).toBe('FARMACIA SINTETICA');
  });

  it('o bloqueio do paciente: a portaria vê só a mensagem genérica, sem o leito; a revogação libera', async () => {
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const p = await a.entrar('SINT.PORTARIA');
    const sem = await a.post(sup, '/portaria/bloqueios', {
      internacao: CRIANCA,
      motivo: 'judicial',
      abrangencia: 'todos',
      justificativa: 'Ordem SINTETICA de restricao de visitas',
    });
    expect(sem.json()).toMatchObject({ campos: ['documento'] });
    const b = await a.post(sup, '/portaria/bloqueios', {
      internacao: CRIANCA,
      motivo: 'judicial',
      abrangencia: 'todos',
      justificativa: 'Ordem SINTETICA de restricao de visitas',
      documento: 'PROC-SINT-0001',
    });
    expect(b.statusCode, b.body).toBe(201);
    const [c] = (await busca(p, 'crianca')).filter((x) => x.internacao === CRIANCA);
    expect(c).toMatchObject({ permitida: false, recusa: 'bloqueio', leito: null });
    expect(c!.mensagem).not.toMatch(/judicial|ordem|processo/i);
    const v = await cadastrar(a, p, 'SINTBLQ001');
    expect(
      (await visita(a, sup, v, CRIANCA, { excecao: 'Tentativa SINTETICA de exceção' })).json(),
    ).toMatchObject({
      codigo: 'bloqueio',
    });
    const painel = (await a.get(sup, '/portaria/regras')).json() as {
      bloqueios: { id: number; motivo: string }[];
    };
    expect(painel.bloqueios.find((x) => x.motivo === 'judicial')).toBeDefined();
    const id = (b.json() as { id: number }).id;
    expect(
      (await a.post(sup, `/portaria/bloqueios/${id}/revogacao`, { motivo: 'Fim da ordem SINTETICA' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await a.post(sup, `/portaria/bloqueios/${id}/revogacao`, { motivo: 'Fim da ordem SINTETICA' })).json(),
    ).toMatchObject({
      codigo: 'ja-revogado',
    });
    expect((await busca(p, 'crianca')).find((x) => x.internacao === CRIANCA)?.recusa).not.toBe('bloqueio');
    expect(a.trilha.eventos.some((l) => l.evento === 'hotelaria.visita.bloqueada')).toBe(true);
  });

  it('o bloqueio clínico é da enfermagem; a supervisão não o grava nem revoga', async () => {
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const corpo = {
      internacao: DOIS,
      motivo: 'clinico',
      abrangencia: 'limite',
      limite: 1,
      justificativa: 'Decisao clinica SINTETICA: repouso',
    };
    expect((await a.post(sup, '/portaria/bloqueios', corpo)).json()).toMatchObject({ campos: ['motivo'] });
    expect((await a.post(sup, '/portaria/bloqueios-clinicos', corpo)).statusCode).toBe(403);
    const lista = await a.get(enf, '/portaria/bloqueios-clinicos?unidade=INT-2');
    expect(lista.statusCode, lista.body).toBe(200);
    expect(lista.json().internados.map((i: { internacao: number }) => i.internacao)).toContain(DOIS);
    const r = await a.post(enf, '/portaria/bloqueios-clinicos', corpo);
    expect(r.statusCode, r.body).toBe(201);
    const id = (r.json() as { id: number }).id;
    expect(
      (await a.post(sup, `/portaria/bloqueios/${id}/revogacao`, { motivo: 'Tentativa SINTETICA' })).json(),
    ).toMatchObject({
      codigo: 'bloqueio-clinico',
    });
    expect(
      (
        await a.post(enf, `/portaria/bloqueios-clinicos/${id}/revogacao`, {
          motivo: 'Alta clinica SINTETICA',
        })
      ).statusCode,
    ).toBe(201);
  });

  it('o acompanhante com direito legal: o fundamento confere; entra fora do horário; a troca encerra o anterior', async () => {
    const p = await a.entrar('SINT.PORTARIA');
    const v1 = await cadastrar(a, p, 'SINTACO001');
    const v2 = await cadastrar(a, p, 'SINTACO002');
    expect(
      (
        await a.post(p, '/portaria/acompanhantes', {
          internacao: UM,
          visitante: v1,
          fundamento: 'crianca',
          refeicao: true,
          pernoite: true,
        })
      ).json(),
    ).toMatchObject({ codigo: 'fundamento' });
    const r = await a.post(p, '/portaria/acompanhantes', {
      internacao: UM,
      visitante: v1,
      fundamento: 'idoso',
      refeicao: true,
      pernoite: true,
    });
    expect(r.statusCode, r.body).toBe(201);
    // Às 15 h a INT-2 está fora do horário: o visitante não entra, o acompanhante entra.
    expect((await visita(a, p, v2, UM)).json()).toMatchObject({ codigo: 'fora-do-horario' });
    const e = await visita(a, p, v1, UM);
    expect(e.statusCode, e.body).toBe(201);
    expect(e.json()).toMatchObject({ mensagem: expect.stringMatching(/acompanhante/) });
    expect((e.json() as { cracha: CrachaVisita }).cracha.validoAte).toBe('2026-10-26T15:00');
    expect(await acompanhantesComRefeicao(a.porta, { hospital: 'aa' } as never, 'INT-2')).toEqual([
      {
        id: expect.any(Number),
        internacao: UM,
        paciente: 905_501,
        unidade: 'INT-2',
        fundamento: 'idoso',
        pernoite: true,
        desde: '2026-10-25T15:00',
      },
    ]);
    const troca = await a.post(p, '/portaria/acompanhantes', {
      internacao: UM,
      visitante: v2,
      fundamento: 'idoso',
      refeicao: false,
      pernoite: false,
    });
    expect(troca.json()).toMatchObject({ mensagem: expect.stringMatching(/trocado/) });
    const l = (await a.get(p, '/portaria/acompanhantes?unidade=INT-2')).json();
    expect(l.acompanhantes).toEqual([
      expect.objectContaining({
        visitante: { id: v2, nome: expect.any(String) },
        substitui: expect.any(Number),
      }),
    ]);
    const id = (troca.json() as { id: number }).id;
    expect(
      (await a.post(p, `/portaria/acompanhantes/${id}/fim`, { motivo: 'Alta SINTETICA do paciente' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await a.post(p, `/portaria/acompanhantes/${id}/fim`, { motivo: 'Alta SINTETICA do paciente' })).json(),
    ).toMatchObject({
      codigo: 'ja-encerrado',
    });
  });

  it('as regras da unidade pela versão e o relatório de contatos do paciente', async () => {
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const regra = {
      unidade: 'INT-1',
      horaInicio: '15:00',
      horaFim: '16:00',
      maxSimultaneos: 1,
      idadeMinima: 0,
      uti: false,
      isolamento: 'bloquear',
      duracaoMaxMin: 30,
    };
    expect((await a.post(sup, '/portaria/regras', { ...regra, duracaoMaxMin: 90 })).statusCode).toBe(400);
    expect((await a.post(sup, '/portaria/regras', { ...regra, unidade: 'XX-9' })).statusCode).toBe(400);
    expect((await a.post(sup, '/portaria/regras', regra)).statusCode).toBe(201);
    expect((await a.post(sup, '/portaria/regras', regra)).json()).toMatchObject({ codigo: 'regra-mudou' });
    expect(
      (await a.post(sup, '/portaria/regras', { ...regra, versao: 1, maxSimultaneos: 2 })).statusCode,
    ).toBe(201);
    const painel = (await a.get(sup, '/portaria/regras')).json();
    expect(painel.regras.find((r: { unidade: string }) => r.unidade === 'INT-1')).toMatchObject({
      versao: 2,
      maxSimultaneos: 2,
    });
    expect((await a.get(sup, '/portaria/regras/internados?unidade=INT-1')).json()).toEqual([
      expect.objectContaining({ internacao: CRIANCA }),
    ]);
    const c = await a.get(sup, `/portaria/contatos?internacao=${TRES}&de=2026-10-25&ate=2026-10-25`);
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json().length).toBeGreaterThanOrEqual(2);
    expect(c.json()[0]).toMatchObject({
      unidade: 'UTI SINTETICA',
      documentoMascarado: expect.stringMatching(/^•+/),
    });
    expect((await a.get(sup, '/portaria/contatos?de=2026-10-25&ate=2026-10-25')).statusCode).toBe(400);
    expect(
      (await a.get(sup, '/portaria/contatos?unidade=UTI-1&de=2026-01-01&ate=2026-10-25')).statusCode,
    ).toBe(400);
    expect(a.trilha.eventos.some((l) => l.evento === 'hotelaria.visita.contatosEmitidos')).toBe(true);
  });

  it('terminais e catraca: a entrada liberada, o mesmo evento uma vez só, o relógio do terminal, a saída encerra; o simulador', async () => {
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const cat = await a.entrar('SINT.PORTARIA.CATRACA');
    const p = await a.entrar('SINT.PORTARIA');
    const t = await a.get(sup, '/portaria/terminais');
    expect(t.statusCode, t.body).toBe(200);
    expect(t.json()).toMatchObject({ catracaLigada: true, simulador: true });
    const terminal = t.json().terminais[0] as { id: number; versao: number };
    const novo = await a.post(sup, '/portaria/terminais', {
      nome: 'Catraca SINTETICA B',
      tipoTerminal: 6,
      local: 'Portaria B',
      sentido: 'saida',
      ativo: true,
    });
    expect(novo.statusCode, novo.body).toBe(201);
    expect(
      (
        await a.post(sup, '/portaria/terminais', {
          nome: 'X1',
          tipoTerminal: 2,
          local: 'P',
          sentido: 'ambos',
          ativo: true,
        })
      ).statusCode,
    ).toBe(400);
    const alt = await a.post(sup, `/portaria/terminais/${(novo.json() as { id: number }).id}`, {
      nome: 'Catraca SINTETICA B',
      tipoTerminal: 6,
      local: 'Portaria B',
      sentido: 'saida',
      ativo: false,
      versao: 1,
    });
    expect(alt.statusCode).toBe(201);
    const v = await cadastrar(a, p, 'SINTCAT001');
    const e = await a.post(p, '/portaria/visitas', {
      visitante: v,
      destino: { tipo: 'outro', tipoVisitado: 2, local: 'ALMOXARIFADO SINTETICO' },
      identificacao: 2,
    });
    const cracha = (e.json() as { cracha: CrachaVisita }).cracha.codigo;
    const ev = {
      terminal: terminal.id,
      cracha,
      sentido: 'entrada',
      ocorridoEm: '2026-10-25T15:01',
      chave: 'evt-sint-0001',
    };
    expect((await a.post(p, '/portaria/catraca/eventos', ev)).statusCode).toBe(403);
    const r1 = await a.post(cat, '/portaria/catraca/eventos', ev);
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json()).toMatchObject({ resultado: 'liberado', repetido: false });
    expect((await a.post(cat, '/portaria/catraca/eventos', ev)).json()).toMatchObject({ repetido: true });
    expect(
      (
        await a.post(cat, '/portaria/catraca/eventos', {
          ...ev,
          chave: 'evt-sint-0002',
          ocorridoEm: '2026-10-25T16:00',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await a.post(cat, '/portaria/catraca/eventos', {
          ...ev,
          chave: 'evt-sint-0003',
          cracha: 'ZZZZZZZZZZZZ',
        })
      ).json(),
    ).toMatchObject({
      resultado: 'negado',
      motivo: 'cracha-desconhecido',
    });
    const sim = await a.post(sup, '/portaria/catraca/simular', {
      terminal: terminal.id,
      cracha,
      sentido: 'saida',
    });
    expect(sim.json()).toMatchObject({ resultado: 'liberado' });
    expect(
      (await a.porta.visita({ hospital: 'aa' } as never, (e.json() as { id: number }).id))?.saida,
    ).not.toBeNull();
    const eventos = (await a.get(sup, '/portaria/terminais')).json().eventos;
    expect(eventos[0]).toMatchObject({ sentido: 'saida', terminalNome: 'CATRACA SINTETICA PRINCIPAL' });
  });

  it('o expurgo anonimiza o cadastro vencido sem visita aberta', async () => {
    const sup = await a.entrar('SINT.PORTARIA.SUP');
    const p = await a.entrar('SINT.PORTARIA');
    const id = await cadastrar(a, p, 'SINTEXP001');
    const v = a.porta.visitantes.find((x) => x.id === id)!;
    Object.assign(v, { reterAte: '2026-01-01' });
    expect((await a.get(sup, '/portaria/regras')).json().vencidos).toBeGreaterThanOrEqual(1);
    const r = await a.post(sup, '/portaria/visitantes/expurgo');
    expect(r.json()).toMatchObject({ mensagem: expect.stringMatching(/anonimizado/) });
    expect((await a.get(p, '/portaria/visitantes?tipo=outro&documento=SINTEXP001')).json()).toEqual([]);
    expect((await a.post(p, '/portaria/visitantes/expurgo')).statusCode).toBe(403);
  });
});
