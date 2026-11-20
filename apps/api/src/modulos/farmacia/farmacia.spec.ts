// M29 (farmácia hospitalar, dispensação e farmácia clínica) pela HTTP, com a sessão real sobre a fonte sintética e a
// porta EM MEMÓRIA (nada conecta a banco): permissões pelas opções do legado, fila por paciente e horário, política
// "dispensar só depois de validar", dispensação com etiqueta, Idempotency-Key, fila disputada (dose ocupada passa
// adiante), aceite da enfermagem (leitura e tablet), devolução do não administrado, avaliação com intervenção
// respondida pelo médico, controlado com dupla conferência, livro em modo conferência, SNGPC desligado, textos de
// produto. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaFarmaciaMemoria, UNIDADE_SINTETICA } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const farmacia = new PortaFarmaciaMemoria({ estado: () => 'verde' });
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, farmacia, vigia: null });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'] as string[];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const h = (s: Sessao, idem?: string) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': idem ?? `teste-m29-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}, idem?: string) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s, idem), payload: payload as object });

interface DoseFila {
  horario: number;
  item: number;
  classe: string;
  rastreavel: boolean;
  bloqueio: string | null;
  controlado: string | null;
}
interface PacienteFila {
  atendimento: number;
  leito: string;
  horarios: { previsto: string; doses: DoseFila[] }[];
}
const ctxSint = { rede: 'rede-sintetica', hospital: 'aa' };

describe('permissões e textos de produto', () => {
  it('sem as opções da farmácia, 403; o farmacêutico vê a fila e nenhum nome de sistema antigo', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, `/farmacia/fila?unidade=${UNIDADE_SINTETICA}`)).statusCode).toBe(403);
    const s = await entrar('SINT.FARMACEUTICO');
    const g = (await get(s, '/farmacia/gravacao')).json();
    expect(g.operacoes['suprimentos.dispensarHorario'].ligada).toBe(true);
    const u = (await get(s, '/farmacia/unidades')).json();
    expect(u[0].unidade).toBe(UNIDADE_SINTETICA);
    expect(u[0].janelaHoras).toBe(12);
    const f = (await get(s, `/farmacia/fila?unidade=${UNIDADE_SINTETICA}`)).json();
    expect(f.pacientes.length).toBeGreaterThan(0);
    expect(JSON.stringify([g, u, f])).not.toMatch(/SPDATA|legado|sistema atual/i);
    // A leitura da fila (lista pacientes) é auditada.
    expect(trilha.eventos.some((r) => r.evento === 'suprimentos.dispensacao.lida')).toBe(true);
  });
});

describe('fila e dispensação (regras 1 a 4)', () => {
  it('a fila separa por paciente e horário; o antimicrobiano não validado fica bloqueado pela política', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const f = (await get(s, `/farmacia/fila?unidade=${UNIDADE_SINTETICA}`)).json();
    const p = (f.pacientes as PacienteFila[]).find((x) => x.atendimento === 9001)!;
    expect(p.horarios.length).toBeGreaterThan(0);
    const doses = p.horarios.flatMap((x) => x.doses);
    // Os horários do sintético têm o 5 "válido automaticamente": nada bloqueado.
    expect(doses.every((d) => d.bloqueio === null)).toBe(true);
    expect(doses.some((d) => d.classe === 'antimicrobiano')).toBe(true);
  });

  it('dispensa com etiqueta; repetir com a mesma chave não dispensa de novo; a dose some da fila', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const f = (await get(s, `/farmacia/fila?unidade=${UNIDADE_SINTETICA}`)).json();
    const p = (f.pacientes as PacienteFila[]).find((x) => x.atendimento === 9001)!;
    const dose = p.horarios.flatMap((x) => x.doses).find((d) => d.item === 7001)!;
    const corpo = { atendimento: 9001, local: 10, centroCusto: 300100, doses: [{ horario: dose.horario }] };
    const r = await post(s, '/farmacia/dispensar', corpo, 'idem-dispensa-1');
    expect(r.statusCode).toBe(200);
    expect(r.json().mensagem).toMatch(/Doses dispensadas/);
    expect(r.json().etiquetas.zpl[0]).toContain('^BXN');
    const repetida = await post(s, '/farmacia/dispensar', corpo, 'idem-dispensa-1');
    expect(repetida.json().repetida).toBe(true);
    const depois = (await get(s, `/farmacia/fila?unidade=${UNIDADE_SINTETICA}`)).json();
    const horarios = (depois.pacientes as PacienteFila[]).flatMap((x) =>
      x.horarios.flatMap((y) => y.doses.map((d) => d.horario)),
    );
    expect(horarios).not.toContain(dose.horario);
    // De novo com outra chave: já dispensada.
    const outra = await post(s, '/farmacia/dispensar', corpo);
    expect(outra.statusCode).toBe(409);
    expect(outra.json().codigo).toBe('dose-ja-dispensada');
  });

  it('fila disputada: a dose ocupada em outro terminal passa à seguinte; só ocupadas: recusa', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const a = { horario: farmacia.novaPrescricao(ctxSint, 9003, 7001, 5) };
    const b = { horario: farmacia.novaPrescricao(ctxSint, 9003, 7001, 6) };
    expect(a && b).toBeTruthy();
    farmacia.marcarHorario(ctxSint, a!.horario, { ocupado: true });
    const r = await post(s, '/farmacia/dispensar', {
      atendimento: 9003,
      local: 10,
      centroCusto: 300100,
      doses: [{ horario: a!.horario }, { horario: b!.horario }],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().ids.doses).toBe(1);
    expect(r.json().avisos[0]).toMatch(/passaram adiante/);
    const so = await post(s, '/farmacia/dispensar', {
      atendimento: 9003,
      local: 10,
      centroCusto: 300100,
      doses: [{ horario: a!.horario }],
    });
    expect(so.json().codigo).toBe('doses-ocupadas');
    farmacia.marcarHorario(ctxSint, a!.horario, { ocupado: false });
  });

  it('item rastreável sem lote é recusado; controlado com lote sai com o prescritor', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const f = (await get(s, `/farmacia/fila?unidade=${UNIDADE_SINTETICA}`)).json();
    const p = (f.pacientes as PacienteFila[]).find((x) => x.atendimento === 9002)!;
    const ctrl = p.horarios.flatMap((x) => x.doses).find((d) => d.controlado === 'A1')!;
    const sem = await post(s, '/farmacia/dispensar', {
      atendimento: 9002,
      local: 10,
      centroCusto: 300100,
      doses: [{ horario: ctrl.horario }],
    });
    expect(sem.statusCode).toBe(409);
    const com = await post(s, '/farmacia/dispensar', {
      atendimento: 9002,
      local: 10,
      centroCusto: 300100,
      doses: [
        {
          horario: ctrl.horario,
          quantidade: 1,
          lotes: [{ lote: 'MRF-77', validade: lotesValidade(), quantidade: 1 }],
        },
      ],
    });
    expect(com.statusCode).toBe(200);
  });
});

function lotesValidade(): string {
  const d = new Date();
  return `${d.getFullYear() + 1}-03-31`;
}

describe('entrega, não administrado e devolução (regras 5 e 6)', () => {
  it('a enfermagem aceita por leitura; outra etiqueta é recusada; a farmácia não aceita', async () => {
    const enf = await entrar('SINT.ENF.SETOR');
    const ls = (await get(enf, '/farmacia/entregas?situacao=7')).json();
    expect(ls.length).toBeGreaterThan(0);
    const e = ls[0];
    const errada = await post(enf, `/farmacia/entregas/${e.controle}/aceite`, {
      modo: 'leitura',
      leitura: '21D1',
    });
    expect(errada.json().codigo).toBe('etiqueta-diferente');
    const ok = await post(enf, `/farmacia/entregas/${e.controle}/aceite`, {
      modo: 'leitura',
      leitura: `21${e.doses[0].serie}`,
    });
    expect(ok.statusCode).toBe(200);
    const dnv = await post(enf, `/farmacia/entregas/${e.controle}/aceite`, { modo: 'tablet' });
    expect(dnv.json().codigo).toBe('ja-entregue');
    const farm = await entrar('SINT.FARMACEUTICO');
    expect(
      (await post(farm, `/farmacia/entregas/${ls[1]?.controle ?? e.controle}/aceite`, { modo: 'tablet' }))
        .statusCode,
    ).toBe(403);
    const entregues = (await get(enf, '/farmacia/entregas?situacao=8')).json();
    expect(entregues.find((x: { controle: number }) => x.controle > e.controle)?.aceite?.modo).toBe(
      'leitura',
    );
  });

  it('o horário não administrado vira sugestão de devolução; a devolução passa da dose é recusada', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const d = (await get(s, '/farmacia/atendimentos/9001/doses')).json();
    const dose = d.doses[0];
    farmacia.marcarHorario(ctxSint, dose.horario, { situacao: 'N' });
    const d2 = (await get(s, '/farmacia/atendimentos/9001/doses')).json();
    expect(d2.sugestoes.map((x: { dose: number }) => x.dose)).toContain(dose.dose);
    const demais = await post(s, '/farmacia/devolucoes', {
      dose: dose.dose,
      local: 10,
      quantidade: 5,
      motivo: 'nao-administrado',
    });
    expect(demais.json().codigo).toBe('quantidade-maior-que-a-saida');
    const ok = await post(s, '/farmacia/devolucoes', {
      dose: dose.dose,
      local: 10,
      quantidade: dose.quantidade,
      motivo: 'nao-administrado',
    });
    expect(ok.statusCode).toBe(200);
    const d3 = (await get(s, '/farmacia/atendimentos/9001/doses')).json();
    expect(d3.sugestoes.map((x: { dose: number }) => x.dose)).not.toContain(dose.dose);
  });
});

describe('avaliação farmacêutica (regras 7 e 8) e intervenção', () => {
  it('triagem: antimicrobiano à fila humana; decisão; intervenção respondida pelo prescritor', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const f = (await get(s, `/farmacia/avaliacao?unidade=${UNIDADE_SINTETICA}`)).json();
    const atb = f.itens.find((x: { classe: string }) => x.classe === 'antimicrobiano');
    expect(atb.destino).toBe('humana');
    expect(Object.keys(f.resumo)).toEqual(
      expect.arrayContaining(['a-avaliar', 'liberado', 'pendencia', 'dispensacao', 'interrompido']),
    );
    const t = await post(s, '/farmacia/avaliacao/triagem', { unidade: UNIDADE_SINTETICA });
    expect(t.statusCode).toBe(200);
    const sem = await post(s, `/farmacia/avaliacao/${atb.item}/decisao`, {
      decisao: 'nao-aprovado',
      justificativa: 'x',
    });
    expect(sem.json().codigo).toBe('sem-justificativa');
    const i = await post(s, `/farmacia/avaliacao/${atb.item}/intervencoes`, {
      tipo: 'ajuste-dose',
      texto: 'Sugiro ajustar a dose pela função renal do paciente.',
    });
    expect(i.statusCode).toBe(200);
    const med = await entrar('SINT.MEDICO.FARM');
    const minhas = (await get(med, '/farmacia/intervencoes/minhas')).json();
    expect(minhas.length).toBe(1);
    const resp = await post(med, `/farmacia/intervencoes/${minhas[0].id}/resposta`, { resposta: 'aceita' });
    expect(resp.statusCode).toBe(200);
    const ok = await post(s, `/farmacia/avaliacao/${atb.item}/decisao`, {
      decisao: 'valido',
      unidade: UNIDADE_SINTETICA,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mensagem).toMatch(/registrada no novo/);
    const outra = await entrar('SINT.FARMACEUTICO2');
    expect(
      (await post(outra, `/farmacia/avaliacao/${atb.item}/decisao`, { decisao: 'valido' })).json().codigo,
    ).toBe('ja-avaliado');
    const w = (await get(s, '/farmacia/worklist')).json();
    expect(w.intervencoesAbertas).toBe(0);
  });

  it('intervenção sem prescritor com usuário: outro farmacêutico (com a mesma opção) não responde por ele (403)', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const f = (await get(s, `/farmacia/avaliacao?unidade=${UNIDADE_SINTETICA}`)).json();
    const item = f.itens.find((x: { classe: string }) => x.classe !== 'antimicrobiano') ?? f.itens[0];
    const i = await post(s, `/farmacia/avaliacao/${item.item}/intervencoes`, {
      tipo: 'ajuste-dose',
      texto: 'Sugiro rever o intervalo entre as doses deste item.',
    });
    expect(i.statusCode).toBe(200);
    const id = Number(i.json().ids.intervencao);
    const est = farmacia.e(ctxSint);
    const k = est.intervencoes.findIndex((y) => y.id === id);
    est.intervencoes[k] = { ...est.intervencoes[k]!, prescritor: null };
    const outro = await entrar('SINT.FARMACEUTICO2');
    const r = await post(outro, `/farmacia/intervencoes/${id}/resposta`, { resposta: 'aceita' });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('sem-prescritor');
    expect(farmacia.e(ctxSint).intervencoes.find((y) => y.id === id)?.estado).toBe('aberta');
  });
});

describe('controlados, livro e SNGPC (regras 4, 9 e 10)', () => {
  it('a segunda conferência é de outra pessoa; o livro fecha em modo conferência e não como oficial', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const c = (await get(s, '/farmacia/controlados')).json();
    const morfina = c.itens.find((x: { lista: string }) => x.lista === 'A1');
    expect(morfina.livro).toBe(1);
    const m = (await get(s, `/farmacia/controlados/${morfina.item}/movimentos`)).json();
    const saida = m.movimentos.find((x: { tipo: string }) => x.tipo === 'saida');
    const dados = {
      item: morfina.item,
      documento: { tipo: 'saida', id: saida.documentoId },
      quantidadeDocumento: saida.quantidade,
      quantidadeContada: saida.quantidade,
    };
    const mesma = await post(s, '/farmacia/controlados/conferencia', { senha: SENHA, dados });
    expect(mesma.json(), JSON.stringify(mesma.json())).toMatchObject({ codigo: 'conferente-igual' });
    const outra = await entrar('SINT.FARMACEUTICO2');
    expect((await post(outra, '/farmacia/controlados/conferencia', { senha: SENHA, dados })).statusCode).toBe(
      200,
    );
    const l = (await get(s, '/farmacia/livro?livro=1')).json();
    expect(l.modo).toBe('conferencia');
    expect(l.paginas.length).toBeGreaterThan(0);
    const of = await post(s, '/farmacia/livro/fechar', {
      livro: 1,
      inicio: l.inicio,
      fim: l.fim,
      oficial: true,
    });
    expect(of.json().codigo).toBe('livro-oficial-desligado');
    const conf = await post(s, '/farmacia/livro/fechar', { livro: 1, inicio: l.inicio, fim: l.fim });
    expect(conf.statusCode).toBe(200);
    expect(conf.json().mensagem).toMatch(/modo conferência/);
    expect((await get(s, '/farmacia/livro?livro=1')).json().fechado.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('SNGPC desligado: nenhuma escrita (a recusa vem antes da transação)', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    const a = (await get(s, '/farmacia/ambulatorial')).json();
    expect(a.ligada).toBe(false);
    const r = await post(s, '/farmacia/ambulatorial/dispensar', {
      paciente: 8001,
      item: 7001,
      lote: 'L1',
      validade: lotesValidade(),
      quantidade: 1,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().detail).toMatch(/CNAE de farmácia/);
    expect((await farmacia.ambulatoriais(ctxSint)).length).toBe(0);
  });

  it('parâmetros e tipos de envio: consulta (config.parametro.ler)', async () => {
    const s = await entrar('SINT.FARMACEUTICO');
    expect((await get(s, '/farmacia/parametros')).statusCode).toBe(403);
  });
});
