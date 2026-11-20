// M45, etapa 6 (especialidades sob demanda e lactário; DP-32) pela HTTP, com a sessão real sobre a fonte sintética e a
// porta EM MEMÓRIA com o relógio fixo (nada conecta a banco): desligada pelo administrador, 403 com o motivo; ligada, o
// exame oftalmológico com a classificação e o alerta da pressão, o protocolo imutável (o mesmo conteúdo recusado; a
// versão nova), o ciclo com a dose calculada no servidor, a sequência, a validação pelo farmacêutico com a dupla
// checagem (o prescritor e a dose divergente recusados), o partograma com as linhas e os alertas, o recém-nascido com as
// classificações, e o lactário com a validade, a conferência por outra pessoa e a etiqueta ZPL só da ordem conferida.
// Cada gravação com o evento na trilha; quem não tem a permissão ou a categoria não grava. Dados sintéticos.
import { EVENTOS_AUDITAVEIS as E } from '@sgh/contratos';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaEspecialidadesMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
// 25/10/2026 às 15:00 (local).
// O relógio anda só no caso da ordem vencida do lactário (e volta no fim dele).
const RELOGIO_BASE = new Date(2026, 9, 25, 15, 0, 0);
let relogio = RELOGIO_BASE;
const especialidades = new PortaEspecialidadesMemoria(() => relogio);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, especialidades, vigia: null });
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
  expect(r.statusCode, r.body).toBe(201);
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m45-6-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const eventos = (codigo: string) => trilha.eventos.filter((l) => l.evento === codigo).length;

async function ligar(admin: Sessao, chaveRecurso: string, liga: boolean) {
  const r = await post(admin, '/administracao/liberacao', {
    chave: chaveRecurso,
    tipo: 'recurso',
    escopo: 'hospital',
    valores: ['*'],
    ligar: liga,
    justificativa: 'chave sintética de teste das especialidades',
    senha: SENHA,
  });
  expect(r.statusCode, r.body).toBe(200);
}

const PROTOCOLO = {
  codigo: 'SINT-PC',
  nome: 'Paclitaxel e carboplatina SINTETICO',
  tipo: 3,
  intervaloDias: 21,
  ciclos: 6,
  farmacos: [
    { nome: 'Paclitaxel', dose: 175, unidade: 'mg/m2', via: 'iv', dias: [1] },
    { nome: 'Carboplatina', dose: 5, unidade: 'auc', via: 'iv', dias: [1] },
  ],
  referencia: 'Protocolo institucional SINTETICO',
};

describe('especialidades sob demanda e lactário (M45, etapa 6)', () => {
  let medico: Sessao;
  let farma: Sessao;
  let lact: Sessao;
  let lact2: Sessao;
  let admin: Sessao;

  beforeAll(async () => {
    medico = await entrar('SINT.ESPECIALISTA');
    farma = await entrar('SINT.FARMA.ONCO');
    lact = await entrar('SINT.LACTARIO');
    lact2 = await entrar('SINT.LACTARIO2');
    admin = await entrar('SINT.ADMIN');
  });

  it('desligada pelo administrador: a gravação diz o motivo e o registro dá 403 recurso-desligado; religada, segue', async () => {
    await ligar(admin, 'pep.especialidade.oftalmologia', false);
    const g = await get(medico, '/especialidades/oftalmologia/gravacao');
    expect(g.statusCode, g.body).toBe(200);
    expect(g.json()).toMatchObject({ ligada: false });
    expect(g.json().motivo).toMatch(/liberada/);
    expect(JSON.stringify(g.json())).not.toMatch(/SPDATA|legado/i);
    const r = await post(medico, '/especialidades/oftalmologia/exames', {
      internacao: 950_103,
      od: { acuidadeSemCorrecao: 4 },
      oe: {},
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('recurso-desligado');
    await ligar(admin, 'pep.especialidade.oftalmologia', true);
    expect((await get(medico, '/especialidades/oftalmologia/gravacao')).json().ligada).toBe(true);
  });

  it('permissões e categorias: o farmacêutico não registra o exame; a lactarista não lê a oncologia', async () => {
    expect((await get(farma, '/especialidades/oftalmologia/gravacao')).statusCode).toBe(403);
    expect((await get(lact, '/especialidades/oncologia/protocolos')).statusCode).toBe(403);
    const g = await get(farma, '/especialidades/oncologia/gravacao');
    expect(g.json().operacoes).toMatchObject({ validar: { pode: true }, registrar: { pode: false } });
    const gm = await get(medico, '/especialidades/oncologia/gravacao');
    expect(gm.json().operacoes).toMatchObject({ publicar: { pode: true }, registrar: { pode: true } });
    expect(gm.json().operacoes.validar.pode).toBe(false);
  });

  it('oftalmologia: a busca auditada, os cadastros e o exame com a classificação e o alerta; valor nunca visto recusado', async () => {
    const antes = eventos(E.especialidadeLida.codigo);
    const l = await get(medico, '/especialidades/oftalmologia/internacoes?termo=ROSA');
    expect(l.statusCode, l.body).toBe(200);
    expect(l.json().itens.map((i: { internacao: number }) => i.internacao)).toEqual([950_103]);
    expect(eventos(E.especialidadeLida.codigo)).toBe(antes + 1);
    const c = await get(medico, '/especialidades/oftalmologia/cadastros');
    expect(c.json().pioLimite).toBe(21);
    expect(c.json().acuidades.find((a: { codigo: number }) => a.codigo === 4).decimal).toBe(0.5);
    const r = await post(medico, '/especialidades/oftalmologia/exames', {
      internacao: 950_103,
      od: { acuidadeSemCorrecao: 10, acuidadeComCorrecao: 4, pio: 25, gonioscopia: 4 },
      oe: { acuidadeSemCorrecao: 6, pio: 18 },
      metodoPio: 'aplanacao',
      exames: [{ exame: 33, lado: 'ao', resultado: 'Ângulo aberto nos quatro quadrantes' }],
      conduta: 'Curva tensional',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().alertas).toEqual([
      'Pressão intraocular do olho direito acima de 21 mmHg (25 mmHg): hipertensão ocular.',
      'Assimetria da pressão intraocular entre os olhos de 7 mmHg.',
    ]);
    expect(r.json().mensagem).toContain('visão sem deficiência');
    expect(eventos(E.exameOftalmologicoRegistrado.codigo)).toBe(1);
    const p = await get(medico, '/especialidades/oftalmologia/internacoes/950103');
    expect(p.json().exames[0]).toMatchObject({
      classificacao: 'normal',
      od: { acuidadeComCorrecao: '20/40 (0,5)', gonioscopia: 'Ângulo aberto' },
      exames: [{ exame: 'Gonioscopia', lado: 'ao' }],
    });
    const x = await post(medico, '/especialidades/oftalmologia/exames', {
      internacao: 950_103,
      od: { acuidadeSemCorrecao: 99 },
      oe: {},
    });
    expect(x.statusCode).toBe(409);
    expect(x.json().codigo).toBe('valor-desconhecido');
  });

  it('oncologia: o protocolo imutável, o ciclo com a dose calculada, a sequência e a validação com a dupla checagem', async () => {
    const p1 = await post(medico, '/especialidades/oncologia/protocolos', PROTOCOLO);
    expect(p1.statusCode, p1.body).toBe(201);
    expect(p1.json().mensagem).toContain('versão 1');
    const igual = await post(medico, '/especialidades/oncologia/protocolos', PROTOCOLO);
    expect(igual.statusCode).toBe(409);
    expect(igual.json().codigo).toBe('protocolo-identico');
    const ps = (await get(medico, '/especialidades/oncologia/protocolos')).json();
    expect(ps.protocolos[0]).toMatchObject({ codigo: 'SINT-PC', versao: 1, vigente: true, integro: true });
    const protocolo = ps.protocolos[0].id as number;
    // Sem a creatinina, a dose por AUC não sai.
    const semCr = await post(medico, '/especialidades/oncologia/ciclos', {
      internacao: 950_102,
      protocolo,
      numero: 1,
      dataPrevista: '2026-10-26',
      pesoKg: 70,
      alturaCm: 170,
    });
    expect(semCr.statusCode).toBe(409);
    expect(semCr.json().codigo).toBe('creatinina-ausente');
    const c1 = await post(medico, '/especialidades/oncologia/ciclos', {
      internacao: 950_102,
      protocolo,
      numero: 1,
      dataPrevista: '2026-10-26',
      pesoKg: 70,
      alturaCm: 170,
      creatininaMgDl: 1,
    });
    expect(c1.statusCode, c1.body).toBe(201);
    expect(c1.json().mensagem).toContain('superfície 1.82 m²');
    const fora = await post(medico, '/especialidades/oncologia/ciclos', {
      internacao: 950_102,
      protocolo,
      numero: 3,
      dataPrevista: '2026-11-30',
      pesoKg: 70,
      alturaCm: 170,
      creatininaMgDl: 1,
    });
    expect(fora.json().codigo).toBe('ciclo-fora-de-sequencia');
    const o = (await get(medico, '/especialidades/oncologia/internacoes/950102')).json();
    // 64 anos, 70 kg, creatinina 1,0, masculino: TFG 73,9 mL/min; Calvert 5 × (73,9 + 25) = 494,5 mg.
    expect(o.ciclos[0].doses.map((d: { final: number }) => d.final)).toEqual([318.5, 494.5]);
    expect(o.ciclos[0].clearanceMlMin).toBe(73.9);
    expect(o.ciclos[0].doses[1].conta).toBe('AUC 5,0 × (TFG 73,9 + 25) mL/min = 494,5 mg');
    const id = o.ciclos[0].id as number;
    // O prescritor não valida (nem tem a categoria); o farmacêutico com a dose divergente é recusado; depois valida.
    expect(
      (await post(medico, `/especialidades/oncologia/ciclos/${id}/validar`, { doses: [318.5, 494.5] }))
        .statusCode,
    ).toBe(403);
    const fila = (await get(farma, '/especialidades/oncologia/validacao')).json();
    expect(fila.itens.map((i: { ciclo: { id: number } }) => i.ciclo.id)).toEqual([id]);
    // Sem a prescrição dos medicamentos ligada, o ciclo não é validado.
    const semPresc = await post(farma, `/especialidades/oncologia/ciclos/${id}/validar`, {
      doses: [318, 495],
    });
    expect(semPresc.statusCode).toBe(409);
    expect(semPresc.json().codigo).toBe('ciclo-sem-prescricao');
    // O médico liga a prescrição geral da internação que vale no dia previsto (a suspensa e a de fora recusadas).
    const cand = (await get(medico, `/especialidades/oncologia/ciclos/${id}/prescricoes`)).json();
    expect(cand).toMatchObject({ ciclo: id, dataPrevista: '2026-10-26' });
    expect(cand.itens.map((x: { id: number; suspensa: boolean }) => [x.id, x.suspensa])).toEqual([
      [990_202, true],
      [990_201, false],
    ]);
    const presc = (n: number, quem = medico) =>
      post(quem, `/especialidades/oncologia/ciclos/${id}/prescricoes`, { prescricao: n });
    expect((await presc(990_202)).json().codigo).toBe('prescricao-suspensa');
    expect((await presc(123_456)).json().codigo).toBe('prescricao-fora-do-ciclo');
    expect((await presc(990_201, farma)).statusCode).toBe(403);
    const ligada = await presc(990_201);
    expect(ligada.statusCode, ligada.body).toBe(200);
    expect(ligada.json().mensagem).toContain('Prescrição 990201 ligada ao ciclo 1');
    expect((await presc(990_201)).json().codigo).toBe('prescricao-ja-vinculada');
    expect(eventos(E.cicloOncologicoPrescricaoVinculada.codigo)).toBe(1);
    const filaLigada = (await get(farma, '/especialidades/oncologia/validacao')).json();
    expect(filaLigada.itens[0].ciclo.prescricoes).toEqual([990_201]);
    const div = await post(farma, `/especialidades/oncologia/ciclos/${id}/validar`, { doses: [318, 600] });
    expect(div.statusCode).toBe(409);
    expect(div.json().codigo).toBe('dose-divergente');
    expect(div.json().detail).toContain('Carboplatina');
    const ok = await post(farma, `/especialidades/oncologia/ciclos/${id}/validar`, { doses: [318, 495] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(eventos(E.cicloOncologicoValidado.codigo)).toBe(1);
    const de = await post(farma, `/especialidades/oncologia/ciclos/${id}/validar`, { doses: [318, 495] });
    expect(de.json().codigo).toBe('ciclo-ja-validado');
    // Depois da validação, a ligação não muda.
    expect((await presc(990_202)).json().codigo).toBe('ciclo-ja-validado');
    // A versão nova substitui a anterior: ciclo na versão antiga é recusado.
    const p2 = await post(medico, '/especialidades/oncologia/protocolos', { ...PROTOCOLO, ciclos: 4 });
    expect(p2.json().mensagem).toContain('versão 2');
    const antiga = await post(medico, '/especialidades/oncologia/ciclos', {
      internacao: 950_102,
      protocolo,
      numero: 2,
      dataPrevista: '2026-11-16',
      pesoKg: 70,
      alturaCm: 170,
      creatininaMgDl: 1,
    });
    expect(antiga.json().codigo).toBe('protocolo-substituido');
    // O mesmo protocolo recomeça num tratamento novo (só no ciclo 1, com o motivo); a sequência vale dentro dele.
    const v2 = (await get(medico, '/especialidades/oncologia/protocolos'))
      .json()
      .protocolos.find((x: { versao: number }) => x.versao === 2).id as number;
    const base = { internacao: 950_102, protocolo: v2, pesoKg: 70, alturaCm: 170, creatininaMgDl: 1 };
    const repetido = await post(medico, '/especialidades/oncologia/ciclos', {
      ...base,
      numero: 1,
      dataPrevista: '2027-03-01',
    });
    expect(repetido.json().codigo).toBe('ciclo-repetido');
    const motivo = 'Recaída após remissão SINTETICA';
    const fora1 = await post(medico, '/especialidades/oncologia/ciclos', {
      ...base,
      numero: 2,
      dataPrevista: '2027-03-01',
      novoTratamento: motivo,
    });
    expect(fora1.json().codigo).toBe('novo-tratamento-fora-do-ciclo-1');
    const novo = await post(medico, '/especialidades/oncologia/ciclos', {
      ...base,
      numero: 1,
      dataPrevista: '2027-03-01',
      novoTratamento: motivo,
    });
    expect(novo.statusCode, novo.body).toBe(201);
    expect(novo.json().alertas).toContain(`Tratamento 2 com o protocolo SINT-PC: ${motivo}.`);
    const seguinte = await post(medico, '/especialidades/oncologia/ciclos', {
      ...base,
      numero: 2,
      dataPrevista: '2027-03-22',
    });
    expect(seguinte.statusCode, seguinte.body).toBe(201);
    const depois = (await get(medico, '/especialidades/oncologia/internacoes/950102')).json();
    expect(
      depois.ciclos.map((c: { curso: number; numero: number; motivoCurso: string | null }) => [
        c.curso,
        c.numero,
        c.motivoCurso,
      ]),
    ).toEqual([
      [2, 2, null],
      [2, 1, motivo],
      [1, 1, null],
    ]);
  });

  it('obstetrícia: o partograma com as linhas e os alertas; o recém-nascido com as classificações; mãe do sexo masculino recusada', async () => {
    const p1 = await post(medico, '/especialidades/obstetricia/partograma', {
      internacao: 950_101,
      em: '2026-10-25T10:00',
      dilatacaoCm: 4,
      bcf: 140,
      contracoes10min: 3,
      bolsa: 'integra',
    });
    expect(p1.statusCode, p1.body).toBe(201);
    const p2 = await post(medico, '/especialidades/obstetricia/partograma', {
      internacao: 950_101,
      em: '2026-10-25T14:50',
      dilatacaoCm: 4,
      bcf: 100,
      bolsa: 'rota',
      liquido: 'meconial',
    });
    expect(p2.json().alertas).toEqual([
      'Batimentos cardíacos fetais de 100 bpm: bradicardia fetal.',
      'Líquido amniótico meconial.',
      'Dilatação além da linha de ação: conduta médica imediata.',
    ]);
    const o = (await get(medico, '/especialidades/obstetricia/internacoes/950101')).json();
    expect(o.linhas.inicioFaseAtiva).toEqual({ em: '2026-10-25T10:00', dilatacaoCm: 4 });
    expect(o.pontos).toHaveLength(2);
    expect(o.faseAtivaCm).toBe(4);
    const rn = await post(medico, '/especialidades/obstetricia/recem-nascidos', {
      internacao: 950_101,
      nascimentoEm: '2026-10-25T14:50',
      sexo: 'F',
      pesoG: 2300,
      apgar1: 6,
      apgar5: 6,
      apgar10: 8,
      igSemanas: 36,
      igDias: 2,
      tipoParto: 2,
      reanimacao: false,
    });
    expect(rn.statusCode, rn.body).toBe(201);
    expect(rn.json().mensagem).toContain('Pré-termo moderado a tardio');
    const lido = (await get(medico, '/especialidades/obstetricia/internacoes/950101')).json();
    expect(lido.recemNascidos[0]).toMatchObject({
      tipoParto: 'CESÁRIA',
      classificacaoPeso: 'Baixo peso (menos de 2.500 g)',
    });
    const homem = await post(medico, '/especialidades/obstetricia/recem-nascidos', {
      internacao: 950_102,
      nascimentoEm: '2026-10-25T14:50',
      sexo: 'F',
      pesoG: 3000,
      apgar1: 8,
      apgar5: 9,
      igSemanas: 39,
      igDias: 0,
      tipoParto: 1,
      reanimacao: false,
    });
    expect(homem.json().codigo).toBe('mae-nao-feminina');
  });

  it('lactário: a ordem com a validade, a etiqueta só depois da conferência por outra pessoa, em ZPL', async () => {
    const r = await post(lact, '/nutricao/lactario/ordens', {
      internacao: 950_104,
      formula: 'Fórmula infantil de partida',
      volumeMl: 90,
      horarios: ['18:00', '15:00', '21:00', '03:00'],
      preparoEm: '2026-10-25T14:30',
      lote: 'L-77',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().mensagem).toContain('4 porção(ões) de 90 mL, validade até 26/10 14:30');
    const id = r.json().id as number;
    const sem = await post(lact, `/nutricao/lactario/ordens/${id}/etiquetas`);
    expect(sem.json().codigo).toBe('ordem-nao-conferida');
    const mesma = await post(lact, `/nutricao/lactario/ordens/${id}/conferir`);
    expect(mesma.json().codigo).toBe('conferente-e-preparador');
    expect((await post(lact2, `/nutricao/lactario/ordens/${id}/conferir`)).statusCode).toBe(200);
    const z = await post(lact2, `/nutricao/lactario/ordens/${id}/etiquetas`);
    expect(z.statusCode, z.body).toBe(200);
    expect(z.json().etiquetas).toBe(4);
    expect(z.json().conteudo).toContain('BEBE SINTETICO LACTARIO');
    expect(z.json().conteudo).toContain('PORCAO 26/10 03:00');
    expect(eventos(E.etiquetaLactarioImpressa.codigo)).toBe(1);
    const d = (await get(lact, '/nutricao/lactario')).json();
    expect(d.totais).toEqual([{ formula: 'Fórmula infantil de partida', porcoes: 4, volumeMl: 360 }]);
    expect(d.ordens[0]).toMatchObject({
      situacao: 'conferida',
      conferidoPor: 'SINT.LACTARIO2',
      vencida: false,
    });
    const depois = await post(lact, '/nutricao/lactario/ordens', {
      internacao: 950_104,
      formula: 'Fórmula infantil de partida',
      volumeMl: 90,
      horarios: ['15:00'],
      preparoEm: '2026-10-25T14:30',
    });
    expect(depois.statusCode).toBe(201);
    const antes = await post(lact, '/nutricao/lactario/ordens', {
      internacao: 950_104,
      formula: 'Fórmula infantil de partida',
      volumeMl: 90,
      horarios: ['15:00', '15:00'],
      preparoEm: '2026-10-25T14:00',
    });
    expect(antes.json().codigo).toBe('horario-repetido');
    const admissao = await post(lact, '/nutricao/lactario/ordens', {
      internacao: 950_104,
      formula: 'Fórmula infantil de partida',
      volumeMl: 90,
      horarios: ['15:00'],
      preparoEm: '2026-10-23T10:00',
    });
    expect(admissao.json().codigo).toBe('antes-da-admissao');
  });

  it('lactário: a ordem vencida não é conferida nem etiquetada (409 ordem-vencida), e a tela a recebe como vencida', async () => {
    const nova = async () => {
      const r = await post(lact, '/nutricao/lactario/ordens', {
        internacao: 950_104,
        formula: 'Fórmula infantil de partida',
        volumeMl: 60,
        horarios: ['15:00', '18:00'],
        preparoEm: '2026-10-25T14:40',
      });
      expect(r.statusCode, r.body).toBe(201);
      return r.json().id as number;
    };
    const preparada = await nova();
    const conferida = await nova();
    expect((await post(lact2, `/nutricao/lactario/ordens/${conferida}/conferir`)).statusCode).toBe(200);
    const impressasAntes = eventos(E.etiquetaLactarioImpressa.codigo);
    const conferidasAntes = eventos(E.ordemLactarioConferida.codigo);
    // 26/10 às 14:40: a validade de 24 h desde o preparo chegou.
    relogio = new Date(2026, 9, 26, 14, 40, 0);
    try {
      const c = await post(lact2, `/nutricao/lactario/ordens/${preparada}/conferir`);
      expect(c.statusCode, c.body).toBe(409);
      expect(c.json().codigo).toBe('ordem-vencida');
      const z = await post(lact2, `/nutricao/lactario/ordens/${conferida}/etiquetas`);
      expect(z.statusCode, z.body).toBe(409);
      expect(z.json().codigo).toBe('ordem-vencida');
      expect(eventos(E.etiquetaLactarioImpressa.codigo)).toBe(impressasAntes);
      expect(eventos(E.ordemLactarioConferida.codigo)).toBe(conferidasAntes);
      const d = (await get(lact, '/nutricao/lactario?data=2026-10-25')).json();
      const vencidas = d.ordens.filter((o: { id: number }) => o.id === preparada || o.id === conferida);
      expect(vencidas.map((o: { vencida: boolean }) => o.vencida)).toEqual([true, true]);
    } finally {
      relogio = RELOGIO_BASE;
    }
  });
});
