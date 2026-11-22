// W0-05 (programa CRUD completo) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada
// conecta a banco): a revogação da versão do protocolo com ciclos em andamento mostra a contagem e a lista (409) e só
// segue com a ciência; os ciclos continuam com a versão deles e nenhum ciclo novo a usa; a inativação e a reativação do
// protocolo nunca excluem; o ciclo ajustado antes da validação (doses recalculadas, a versão anterior no evento), o
// validado recusa a edição (409), a suspensão, a retomada e o cancelamento com a categoria e o motivo; a ligação
// ciclo–prescrição desfeita remove só o vínculo e a prescrição fica idêntica; a ordem do lactário alterada antes da
// conferência, 409 depois (só o cancelamento) e cancelada com a etiqueta emitida, visível como cancelada. Sintético.
import { EVENTOS_AUDITAVEIS as E } from '@sgh/contratos';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { moduloEspecialidades } from './modulo.js';
import { PortaEspecialidadesMemoria } from './porta-memoria.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'config,documento,especialidades',
};
const trilha = new RegistradorTrilhaMemoria();
const especialidades = new PortaEspecialidadesMemoria(() => new Date(2026, 9, 25, 15, 0, 0));
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      config: () => import('../config/modulo.js'),
      documento: () => import('../documento/modulo.js'),
      especialidades: async () => ({ modulo: (ctx) => moduloEspecialidades(ctx, { porta: especialidades }) }),
    },
  });
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
  'idempotency-key': `teste-w0-05-esp-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const eventos = (codigo: string) => trilha.eventos.filter((l) => l.evento === codigo).length;

const PROTOCOLO = {
  codigo: 'SINT-W005',
  nome: 'Paclitaxel semanal SINTETICO',
  tipo: 3,
  intervaloDias: 7,
  ciclos: 6,
  farmacos: [{ nome: 'Paclitaxel', dose: 80, unidade: 'mg/m2', via: 'iv', dias: [1] }],
  referencia: 'Protocolo institucional SINTETICO',
};
const CICLO = { internacao: 950_102, pesoKg: 70, alturaCm: 170 };

describe('W0-05: oncologia e lactário', () => {
  let medico: Sessao;
  let farma: Sessao;
  let lact: Sessao;
  let lact2: Sessao;

  beforeAll(async () => {
    medico = await entrar('SINT.ESPECIALISTA');
    farma = await entrar('SINT.FARMA.ONCO');
    lact = await entrar('SINT.LACTARIO');
    lact2 = await entrar('SINT.LACTARIO2');
  });

  it('ciclo: ajuste antes da validação; o validado recusa a edição (409); a ligação desfeita deixa a prescrição idêntica', async () => {
    const p = await post(medico, '/especialidades/oncologia/protocolos', PROTOCOLO);
    expect(p.statusCode, p.body).toBe(201);
    const protocolo = p.json().id as number;
    const c = await post(medico, '/especialidades/oncologia/ciclos', {
      ...CICLO,
      protocolo,
      numero: 1,
      dataPrevista: '2026-10-26',
    });
    expect(c.statusCode, c.body).toBe(201);
    const id = c.json().id as number;
    // Ajuste antes da validação: o motivo é obrigatório; as doses são recalculadas e a versão anterior fica no evento.
    expect(
      (
        await post(medico, `/especialidades/oncologia/ciclos/${id}/ajustar`, {
          dataPrevista: '2026-10-27',
          reducaoPct: 0,
        })
      ).statusCode,
    ).toBe(400);
    const aj = await post(medico, `/especialidades/oncologia/ciclos/${id}/ajustar`, {
      dataPrevista: '2026-10-27',
      reducaoPct: 20,
      motivoReducao: 'Neutropenia grau 2',
      motivo: 'Redução por toxicidade hematológica',
    });
    expect(aj.statusCode, aj.body).toBe(200);
    let o = (await get(medico, '/especialidades/oncologia/internacoes/950102')).json();
    const ciclo = o.ciclos.find((x: { id: number }) => x.id === id);
    // 80 mg/m² × 1,82 m² = 145,6 mg; com 20% de redução, 116,5 mg.
    expect(ciclo).toMatchObject({ dataPrevista: '2026-10-27', reducaoPct: 20, andamento: 'ativo' });
    expect(ciclo.doses[0].final).toBe(116.5);
    expect(ciclo.eventos[0]).toMatchObject({
      evento: 'ciclo-ajustado',
      motivo: 'Redução por toxicidade hematológica',
    });
    // Revisão: a versão anterior (a prescrição do quimioterápico antes do ajuste) sai na leitura, como inativa.
    expect(ciclo.eventos[0].antes).toEqual({
      dataPrevista: '2026-10-26',
      reducaoPct: 0,
      motivoReducao: null,
      justificativaIntervalo: null,
      doses: [{ farmaco: 'Paclitaxel', final: 145.6 }],
    });
    // A ligação com a prescrição errada: desfeita só no vínculo do ciclo; a prescrição fica idêntica.
    expect(
      (await post(medico, `/especialidades/oncologia/ciclos/${id}/prescricoes`, { prescricao: 990_201 }))
        .statusCode,
    ).toBe(200);
    const antes = await especialidades.prescricoesDoDia(
      { cliente: '', estabelecimento: null, usuario: null, correlacao: 'teste-m45' },
      950_102,
      99_602,
      '2026-10-27',
    );
    const des = await post(medico, `/especialidades/oncologia/ciclos/${id}/prescricoes/990201/desligar`, {
      motivo: 'Prescrição de outro ciclo ligada por engano',
    });
    expect(des.statusCode, des.body).toBe(200);
    expect(eventos(E.cicloOncologicoPrescricaoDesligada.codigo)).toBe(1);
    const depois = await especialidades.prescricoesDoDia(
      { cliente: '', estabelecimento: null, usuario: null, correlacao: 'teste-m45' },
      950_102,
      99_602,
      '2026-10-27',
    );
    expect(depois).toEqual(antes);
    o = (await get(medico, '/especialidades/oncologia/internacoes/950102')).json();
    expect(o.ciclos.find((x: { id: number }) => x.id === id).prescricoes).toEqual([]);
    // Liga de novo e o farmacêutico valida: daí em diante, o ciclo não se edita nem desfaz a ligação (409).
    await post(medico, `/especialidades/oncologia/ciclos/${id}/prescricoes`, { prescricao: 990_201 });
    const val = await post(farma, `/especialidades/oncologia/ciclos/${id}/validar`, { doses: [116.5] });
    expect(val.statusCode, val.body).toBe(200);
    const ed = await post(medico, `/especialidades/oncologia/ciclos/${id}/ajustar`, {
      dataPrevista: '2026-10-28',
      reducaoPct: 0,
      motivo: 'Tentativa de editar o ciclo validado',
    });
    expect(ed.statusCode).toBe(409);
    expect(ed.json().codigo).toBe('ciclo-ja-validado');
    const ds = await post(medico, `/especialidades/oncologia/ciclos/${id}/prescricoes/990201/desligar`, {
      motivo: 'Tentativa',
    });
    expect(ds.statusCode).toBe(409);
    expect(ds.json().codigo).toBe('ciclo-ja-validado');
    // O validado se suspende, retoma e cancela como fato novo, com a categoria e o motivo.
    expect(
      (
        await post(medico, `/especialidades/oncologia/ciclos/${id}/suspender`, {
          categoria: 'toxicidade',
          motivo: 'Mucosite grau 3',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(medico, `/especialidades/oncologia/ciclos/${id}/suspender`, {
          categoria: 'toxicidade',
          motivo: 'De novo',
        })
      ).json().codigo,
    ).toBe('ciclo-interrompido');
    expect(
      (await post(medico, `/especialidades/oncologia/ciclos/${id}/retomar`, { motivo: 'Mucosite resolvida' }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await post(medico, `/especialidades/oncologia/ciclos/${id}/cancelar`, {
          categoria: 'desistencia',
          motivo: 'Paciente desistiu',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await post(medico, `/especialidades/oncologia/ciclos/${id}/retomar`, { motivo: 'Voltar' })).json()
        .codigo,
    ).toBe('ciclo-interrompido');
    o = (await get(medico, '/especialidades/oncologia/internacoes/950102')).json();
    const fim = o.ciclos.find((x: { id: number }) => x.id === id);
    expect(fim).toMatchObject({ situacao: 'validado', andamento: 'cancelado' });
    expect(fim.eventos.map((e: { evento: string }) => e.evento)).toEqual([
      'ciclo-cancelado',
      'ciclo-retomado',
      'ciclo-suspenso',
      'prescricao-desligada',
      'ciclo-ajustado',
    ]);
    expect(fim.eventos[0]).toMatchObject({ categoria: 'desistencia', motivo: 'Paciente desistiu' });
  });

  it('revisão: o ajuste segue as regras da inclusão (ligação, sequência, intervalo); a validação exige a prescrição do dia', async () => {
    const p = await post(medico, '/especialidades/oncologia/protocolos', { ...PROTOCOLO, codigo: 'SINT-AJ' });
    expect(p.statusCode, p.body).toBe(201);
    const protocolo = p.json().id as number;
    const c1 = await post(medico, '/especialidades/oncologia/ciclos', {
      ...CICLO,
      protocolo,
      numero: 1,
      dataPrevista: '2026-10-26',
    });
    const c2 = await post(medico, '/especialidades/oncologia/ciclos', {
      ...CICLO,
      protocolo,
      numero: 2,
      dataPrevista: '2026-11-02',
    });
    expect(c2.statusCode, c2.body).toBe(201);
    const [id1, id2] = [c1.json().id as number, c2.json().id as number];
    const ajustar = (id: number, corpo: object) =>
      post(medico, `/especialidades/oncologia/ciclos/${id}/ajustar`, {
        reducaoPct: 0,
        motivo: 'Ajuste da agenda da quimioterapia',
        ...corpo,
      });
    // A data nova não passa da do ciclo seguinte nem fica antes da do anterior.
    expect((await ajustar(id1, { dataPrevista: '2026-11-05' })).json().codigo).toBe(
      'data-depois-do-seguinte',
    );
    expect((await ajustar(id2, { dataPrevista: '2026-10-25' })).json().codigo).toBe('data-antes-do-anterior');
    // Dentro do intervalo do protocolo (7 dias), pede a justificativa clínica, como na inclusão.
    const curto = await ajustar(id2, { dataPrevista: '2026-10-30' });
    expect(curto.statusCode).toBe(409);
    expect(curto.json().codigo).toBe('intervalo-curto');
    const just = await ajustar(id2, {
      dataPrevista: '2026-10-30',
      justificativaIntervalo: 'Antecipado pela viagem do paciente',
    });
    expect(just.statusCode, just.body).toBe(200);
    expect(just.json().alertas[0]).toMatch(/Ciclo antecipado: 4 dia/);
    // Com a prescrição ligada, mudar a data ou a redução recusa (409): desfaz-se a ligação antes.
    expect(
      (await post(medico, `/especialidades/oncologia/ciclos/${id2}/prescricoes`, { prescricao: 990_201 }))
        .statusCode,
    ).toBe(200);
    const comLig = await ajustar(id2, {
      dataPrevista: '2026-11-03',
      justificativaIntervalo: 'Antecipado pela viagem do paciente',
    });
    expect(comLig.statusCode).toBe(409);
    expect(comLig.json().codigo).toBe('ciclo-com-prescricao');
    const reduz = await ajustar(id2, {
      dataPrevista: '2026-10-30',
      reducaoPct: 25,
      motivoReducao: 'Neutropenia',
    });
    expect(reduz.json().codigo).toBe('ciclo-com-prescricao');
    const lido = (await get(medico, '/especialidades/oncologia/internacoes/950102'))
      .json()
      .ciclos.find((x: { id: number }) => x.id === id2);
    expect(lido).toMatchObject({ dataPrevista: '2026-10-30', reducaoPct: 0, prescricoes: [990_201] });
    // A validação confere que a prescrição ligada vale no dia previsto (a ligada de outro dia recusa).
    const i = especialidades.ciclosGravados.findIndex((x) => x.id === id2);
    especialidades.ciclosGravados[i] = { ...especialidades.ciclosGravados[i]!, prescricoes: [990_299] };
    const val = await post(farma, `/especialidades/oncologia/ciclos/${id2}/validar`, { doses: [145.6] });
    expect(val.statusCode).toBe(409);
    expect(val.json().codigo).toBe('prescricao-fora-do-dia');
    especialidades.ciclosGravados[i] = { ...especialidades.ciclosGravados[i]!, prescricoes: [990_201] };
    expect(
      (await post(farma, `/especialidades/oncologia/ciclos/${id2}/validar`, { doses: [145.6] })).statusCode,
    ).toBe(200);
  });

  it('protocolo: revogar a versão com ciclos em andamento mostra quantos e quais; inativar nunca exclui', async () => {
    const p = await post(medico, '/especialidades/oncologia/protocolos', {
      ...PROTOCOLO,
      codigo: 'SINT-REV',
    });
    const protocolo = p.json().id as number;
    const c = await post(medico, '/especialidades/oncologia/ciclos', {
      ...CICLO,
      protocolo,
      numero: 1,
      dataPrevista: '2026-10-26',
    });
    expect(c.statusCode, c.body).toBe(201);
    const ciclo = c.json().id as number;
    const dep = (await get(medico, `/especialidades/oncologia/protocolos/${protocolo}/dependencias`)).json();
    expect(dep).toMatchObject({ protocolo, codigo: 'SINT-REV', versao: 1, emAndamento: 1, total: 1 });
    expect(dep.ciclos[0]).toMatchObject({ id: ciclo, numero: 1, situacao: 'prescrito', andamento: 'ativo' });
    // Sem a ciência: 409 com a contagem e a lista dos ciclos.
    const rec = await post(medico, `/especialidades/oncologia/protocolos/${protocolo}/revogar`, {
      motivo: 'Dose de referência errada na publicação',
    });
    expect(rec.statusCode).toBe(409);
    expect(rec.json().codigo).toBe('versao-com-ciclos');
    expect(rec.json().detail).toMatch(/^1 ciclo\(s\) em andamento/);
    expect(rec.json().bloqueios).toEqual([
      'Ciclo 1 (tratamento 1) da internação 950102, previsto em 2026-10-26: prescrito, ativo',
    ]);
    // Revisão: a ciência vale sobre o número visto; um ciclo a mais (registrado depois da lista) pede a lista de novo.
    const visto = await post(medico, `/especialidades/oncologia/protocolos/${protocolo}/revogar`, {
      motivo: 'Dose de referência errada na publicação',
      cienteDosCiclos: true,
      ciclosVistos: 0,
      senha: SENHA,
    });
    expect(visto.statusCode).toBe(409);
    expect(visto.json().codigo).toBe('versao-com-ciclos');
    // A lista cortada no teto: as contagens continuam as de todos e a resposta avisa.
    especialidades.tetoCiclosDaVersao = 0;
    const cortada = (
      await get(medico, `/especialidades/oncologia/protocolos/${protocolo}/dependencias`)
    ).json();
    especialidades.tetoCiclosDaVersao = 500;
    expect(cortada).toMatchObject({ emAndamento: 1, total: 1, cortada: true, ciclos: [] });
    const ok = await post(medico, `/especialidades/oncologia/protocolos/${protocolo}/revogar`, {
      motivo: 'Dose de referência errada na publicação',
      cienteDosCiclos: true,
      ciclosVistos: 1,
      senha: SENHA,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(eventos(E.protocoloOncologicoAlterado.codigo)).toBe(1);
    // O ciclo continua com a versão dele; nenhum ciclo novo a usa; ela sai da oferta.
    const o = (await get(medico, '/especialidades/oncologia/internacoes/950102')).json();
    expect(o.ciclos.find((x: { id: number }) => x.id === ciclo).protocolo).toMatchObject({
      id: protocolo,
      versao: 1,
    });
    expect(o.protocolos.some((x: { id: number }) => x.id === protocolo)).toBe(false);
    const novo = await post(medico, '/especialidades/oncologia/ciclos', {
      ...CICLO,
      protocolo,
      numero: 2,
      dataPrevista: '2026-11-02',
    });
    expect(novo.statusCode).toBe(409);
    expect(novo.json().codigo).toBe('versao-revogada');
    // Inativar e reativar: nunca exclui (a versão continua lida, com os eventos).
    const p2 = await post(medico, '/especialidades/oncologia/protocolos', {
      ...PROTOCOLO,
      codigo: 'SINT-INAT',
    });
    const v = p2.json().id as number;
    // A inativação é crítica: sem a senha de novo, 401; com ela, segue.
    const semSenha = await post(medico, `/especialidades/oncologia/protocolos/${v}/inativar`, {
      motivo: 'Fora da padronização',
    });
    expect(semSenha.statusCode).toBe(401);
    const ina = await post(medico, `/especialidades/oncologia/protocolos/${v}/inativar`, {
      motivo: 'Fora da padronização',
      senha: SENHA,
    });
    expect(ina.statusCode, ina.body).toBe(200);
    expect(
      (
        await post(medico, `/especialidades/oncologia/protocolos/${v}/inativar`, {
          motivo: 'De novo',
          senha: SENHA,
        })
      ).json().codigo,
    ).toBe('protocolo-sem-mudanca');
    const ps = (await get(medico, '/especialidades/oncologia/protocolos')).json().protocolos;
    expect(ps.find((x: { id: number }) => x.id === v)).toMatchObject({
      inativo: true,
      ofertavel: false,
      revogada: false,
    });
    expect(especialidades.protocolosGravados.filter((x) => x.codigo === 'SINT-INAT')).toHaveLength(1);
    const ciclo2 = await post(medico, '/especialidades/oncologia/ciclos', {
      ...CICLO,
      protocolo: v,
      numero: 1,
      dataPrevista: '2026-10-26',
    });
    expect(ciclo2.json().codigo).toBe('protocolo-inativo');
    expect(
      (
        await post(medico, `/especialidades/oncologia/protocolos/${v}/reativar`, {
          motivo: 'Voltou à padronização',
        })
      ).statusCode,
    ).toBe(200);
    const ps2 = (await get(medico, '/especialidades/oncologia/protocolos')).json().protocolos;
    expect(ps2.find((x: { id: number }) => x.id === v)).toMatchObject({ inativo: false, ofertavel: true });
    expect(ps2.find((x: { id: number }) => x.id === protocolo)).toMatchObject({
      revogada: true,
      ofertavel: false,
    });
  });

  it('lactário: altera antes da conferência; depois, 409 e só o cancelamento; cancelada com a etiqueta, visível', async () => {
    const r = await post(lact, '/nutricao/lactario/ordens', {
      internacao: 950_104,
      formula: 'Fórmula infantil de partida',
      volumeMl: 90,
      horarios: ['18:00', '21:00'],
      preparoEm: '2026-10-25T14:30',
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    // Revisão: o motivo é obrigatório também na API (não só na tela): sem ele, 400 e nada gravado.
    for (const motivo of [undefined, 'abc']) {
      const sem = await post(lact, `/nutricao/lactario/ordens/${id}/alterar`, {
        formula: 'Fórmula infantil de seguimento',
        volumeMl: 120,
        horarios: ['18:00'],
        preparoEm: '2026-10-25T14:30',
        ...(motivo ? { motivo } : {}),
      });
      expect(sem.statusCode, sem.body).toBe(400);
    }
    expect(eventos(E.ordemLactarioAlterada.codigo)).toBe(0);
    const alt = await post(lact, `/nutricao/lactario/ordens/${id}/alterar`, {
      formula: 'Fórmula infantil de seguimento',
      volumeMl: 120,
      horarios: ['18:00', '21:00', '00:00'],
      preparoEm: '2026-10-25T14:30',
      motivo: 'Troca da fórmula pela nutricionista',
    });
    expect(alt.statusCode, alt.body).toBe(200);
    expect(eventos(E.ordemLactarioAlterada.codigo)).toBe(1);
    expect((await post(lact2, `/nutricao/lactario/ordens/${id}/conferir`)).statusCode).toBe(200);
    const z = await post(lact2, `/nutricao/lactario/ordens/${id}/etiquetas`);
    expect(z.statusCode, z.body).toBe(200);
    const depois = await post(lact, `/nutricao/lactario/ordens/${id}/alterar`, {
      formula: 'Outra',
      volumeMl: 60,
      horarios: ['18:00'],
      preparoEm: '2026-10-25T14:30',
      motivo: 'Troca depois da conferência',
    });
    expect(depois.statusCode).toBe(409);
    expect(depois.json()).toMatchObject({ codigo: 'ordem-ja-conferida', avisos: ['acao:cancelar'] });
    expect((await post(lact, `/nutricao/lactario/ordens/${id}/cancelar`, {})).statusCode).toBe(400);
    const can = await post(lact, `/nutricao/lactario/ordens/${id}/cancelar`, {
      motivo: 'Paciente passou a dieta oral',
    });
    expect(can.statusCode, can.body).toBe(200);
    expect(can.json().alertas[0]).toMatch(/etiqueta já foi emitida/);
    expect(
      (await post(lact, `/nutricao/lactario/ordens/${id}/cancelar`, { motivo: 'De novo' })).json().codigo,
    ).toBe('ordem-cancelada');
    expect((await post(lact2, `/nutricao/lactario/ordens/${id}/etiquetas`)).json().codigo).toBe(
      'ordem-cancelada',
    );
    const d = (await get(lact, '/nutricao/lactario?data=2026-10-25')).json();
    const ordem = d.ordens.find((x: { id: number }) => x.id === id);
    expect(ordem).toMatchObject({
      cancelada: true,
      canceladaPor: 'SINT.LACTARIO',
      motivoCancelamento: 'Paciente passou a dieta oral',
      formula: 'Fórmula infantil de seguimento',
      volumeMl: 120,
    });
    expect(ordem.etiquetaEm).not.toBeNull();
    expect(ordem.historico.map((x: { evento: string }) => x.evento)).toEqual([
      'cancelada',
      'etiqueta-emitida',
      'alterada',
    ]);
    expect(ordem.historico[2].antes).toContain('Fórmula infantil de partida');
    // Revisão: a validade e a observação também entram no valor anterior e no novo.
    expect(JSON.parse(ordem.historico[2].antes)).toMatchObject({
      formula: 'Fórmula infantil de partida',
      volumeMl: 90,
      validadeEm: expect.stringMatching(/^2026-10-2\dT\d{2}:\d{2}$/),
      observacao: null,
    });
    expect(JSON.parse(ordem.historico[2].depois)).toHaveProperty('validadeEm');
    // A cancelada não entra nos totais da produção.
    expect(d.totais.some((t: { formula: string }) => t.formula === 'Fórmula infantil de seguimento')).toBe(
      false,
    );
  });
});
