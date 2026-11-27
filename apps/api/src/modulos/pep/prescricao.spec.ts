// M24 pela HTTP, com a sessão real sobre a fonte sintética e as portas do cadastro e da prescrição EM MEMÓRIA (nada
// conecta a banco; pacientes, produtos e cadastros SINTÉTICOS): contexto e períodos; verificação (duplicidade por
// princípio ativo, alergia que exige justificativa, categoria do prescritor); prescrever com os horários previstos,
// a prova e a trilha; uma ativa por período (409); adendo; suspensão do item e da prescrição com reautenticação;
// renovação; residente com coassinatura do preceptor; prescrição futura e reconciliação; farmácia clínica (regra
// versionada e simulador); horários-padrão; permissões (recepção 403).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaPrescricaoMemoria } from './prescricao-porta-memoria.js';
import { criarAppPep } from './teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarAppPep(env, {
    trilha,
    cadastro: new PortaCadastroMemoria(),
    prescricao: new PortaPrescricaoMemoria(trilha),
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
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
let chave = 0;
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste.m24.${Date.now()}.${chave++}` },
    payload: payload as object,
  });

const agora = () => new Date(Date.now() - 3 * 3_600_000 - 60_000).toISOString().slice(0, 16);

const dipirona = (k = 'm1') => ({
  chave: k,
  detalhe: { tipo: 'medicamento', item: { produto: 501 }, dose: 2, unidade: 'ML', via: 'EV', frequencia: 11 },
});
const sinaisVitais = (k = 'p1') => ({
  chave: k,
  detalhe: { tipo: 'procedimento', procedimento: 2, frequencia: 9 },
});

describe('prescrição eletrônica (M24)', () => {
  let medico: Sessao;
  beforeAll(async () => {
    medico = await entrar('SINT.MEDICO');
  });

  it('dados do paciente para o cálculo de dose (regra 12): peso, creatinina com a data e o clearance estimado', async () => {
    const c = (await get(medico, '/api/pep/prescricao/1001/contexto')).json();
    // Cockcroft-Gault: (140 − 68) × 72 / (72 × 1,6) = 45 mL/min (homem, 68 anos na data sintética).
    expect(c.dadosClinicos).toMatchObject({ pesoKg: 72, creatinina: 1.6, dataCreatinina: '2026-10-20' });
    expect(c.dadosClinicos.clearance).toBeGreaterThan(40);
    expect(c.dadosClinicos.clearance).toBeLessThan(50);
    const sem = (await get(medico, '/api/pep/prescricao/1003/contexto')).json();
    expect(sem.dadosClinicos).toMatchObject({ pesoKg: null, creatinina: null, clearance: null });
  });

  it('liberação, domínios e contexto com o prescritor e os períodos da regra da unidade', async () => {
    const l = await get(medico, '/api/pep/prescricao/liberacao');
    expect(l.statusCode).toBe(200);
    expect(l.json()).toMatchObject({ ligada: true, gravacao: { pode: true } });
    const d = (await get(medico, '/api/pep/prescricao/dominios')).json();
    expect(d.frequencias.length).toBe(16);
    expect(d.vias.map((v: { id: string }) => v.id)).toContain('EV');
    const c = await get(medico, '/api/pep/prescricao/1001/contexto');
    expect(c.statusCode).toBe(200);
    const corpo = c.json();
    expect(corpo.prescritor).toMatchObject({ categoria: 'medico', coassinatura: false });
    expect(corpo.podeCriar).toBe(true);
    const int = corpo.atendimentos.find((a: { id: number }) => a.id === 10011);
    expect(int.periodos.atual.inicio.slice(11, 16)).toBe('16:01');
    expect(int.periodos.atual.fim.slice(11, 16)).toBe('16:00');
    expect((await get(medico, '/api/pep/prescricao/999999/contexto')).statusCode).toBe(404);
  });

  it('C2-104: a farmácia clínica (restrições da prescrição) busca produto sem poder prescrever', async () => {
    const farm = await entrar('SINT.FARMACIA');
    const r = await get(farm, '/api/pep/prescricao/produtos?termo=sint');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().length).toBeGreaterThan(0);
  });

  it('busca de produto: padronizado primeiro, alto alerta, controlado e antimicrobiano', async () => {
    const r = (await get(medico, '/api/pep/prescricao/produtos?termo=sintetico')).json();
    // Sem acento e em minúsculas: "cloreto de sodio" acha "CLORETO DE SÓDIO".
    const sodio = (await get(medico, '/api/pep/prescricao/produtos?termo=cloreto%20de%20sodio')).json();
    expect(sodio.map((p: { produto: number }) => p.produto)).toEqual([504]);
    expect((await get(medico, '/api/pep/prescricao/produtos?termo=')).json()).toEqual([]);
    expect(r[0].padronizado).toBe(true);
    expect(r.at(-1).padronizado).toBe(false);
    const morfina = r.find((p: { produto: number }) => p.produto === 503);
    expect(morfina).toMatchObject({ altoAlerta: true, controlado: true });
    expect(r.find((p: { produto: number }) => p.produto === 502).antimicrobiano).toBe(true);
  });

  it('verificação: duplicidade por princípio ativo e horários previstos pela grade', async () => {
    const r = await post(medico, '/api/pep/prescricao/1001/verificar', {
      atendimento: 10011,
      periodo: 'seguinte',
      itens: [
        dipirona(),
        {
          chave: 'm2',
          detalhe: {
            tipo: 'medicamento',
            item: { produto: 507 },
            dose: 1,
            unidade: 'G',
            via: 'VO',
            frequencia: 11,
          },
        },
      ],
    });
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.alertas.some((a: { tipo: string }) => a.tipo === 'duplicidade')).toBe(true);
    expect(v.horarios.m1.length).toBe(4);
    expect(v.horarios.m1.map((h: string) => h.slice(11, 16))).toEqual(['18:00', '00:00', '06:00', '12:00']);
  });

  let prescricao = 0;
  let item = 0;
  it('prescrever: grava com os horários, a prova e a trilha; outra no mesmo período é recusada', async () => {
    const r = await post(medico, '/api/pep/prescricao/1001/prescrever', {
      atendimento: 10011,
      periodo: 'seguinte',
      dataHora: agora(),
      itens: [dipirona(), sinaisVitais()],
    });
    expect(r.statusCode, r.body).toBe(201);
    prescricao = r.json().prescricao;
    expect(r.json().horarios).toBe(7);
    expect(trilha.eventos.some((e) => e.evento === 'pep.prescricao.assinada' && e.paciente === 1001)).toBe(
      true,
    );
    const l = (await get(medico, `/api/pep/prescricao/1001/prescricoes/${prescricao}`)).json();
    expect(l).toMatchObject({ feitaNoNovo: true, prova: 'confere', situacao: 'futura', itens: 2 });
    item = l.itensLidos[0].id;
    expect(l.itensLidos[0].horarios.map((h: { rotulo: string }) => h.rotulo)).toContain('Prescrito');
    const outra = await post(medico, '/api/pep/prescricao/1001/prescrever', {
      atendimento: 10011,
      periodo: 'seguinte',
      dataHora: agora(),
      itens: [sinaisVitais()],
    });
    expect(outra.statusCode).toBe(409);
    expect(outra.json().codigo).toBe('outra-ativa-no-periodo');
    const lista = (await get(medico, '/api/pep/prescricao/1001/atendimentos/10011')).json();
    expect(lista.map((p: { id: number }) => p.id)).toContain(prescricao);
  });

  it('receita de alta (regra 15): os medicamentos no receituário certo; a emissão é a do receituário', async () => {
    const r = await get(medico, `/api/pep/prescricao/1001/prescricoes/${prescricao}/receita-alta`);
    expect(r.statusCode, r.body).toBe(200);
    const { atendimento, receitas } = r.json();
    expect(atendimento).toBe(10011);
    // Só o medicamento (o cuidado de enfermagem não vira receita); a dipirona vai à receita simples.
    expect(receitas.map((x: { tipo: string; itens: unknown[] }) => [x.tipo, x.itens.length])).toEqual([
      ['simples', 1],
    ]);
    expect(receitas[0].itens[0].posologia).toBe('2 ML, EV, 06/06');
    expect(trilha.eventos.some((e) => e.evento === 'pep.prescricao.lida' && e.paciente === 1001)).toBe(true);
    const emitida = await post(medico, '/api/pep/paciente/1001/receitas', {
      atendimento,
      tipo: receitas[0].tipo,
      itens: receitas[0].itens.map((i: { medicamento: string; posologia: string }) => ({
        medicamento: i.medicamento,
        posologia: i.posologia,
        quantidade: '1 frasco',
      })),
    });
    expect(emitida.statusCode, emitida.body).toBe(201);
  });

  it('alergia: exige a justificativa; com ela, grava', async () => {
    const amox = {
      chave: 'a1',
      detalhe: {
        tipo: 'medicamento',
        item: { produto: 506 },
        dose: 500,
        unidade: 'MG',
        via: 'VO',
        frequencia: 9,
      },
      antimicrobiano: {
        indicacao: 'Infecção sintética',
        sitio: 'Pulmão',
        tipo: 'empirico',
        culturaColhida: false,
        diaTratamento: 1,
      },
    };
    const sem = await post(medico, '/api/pep/prescricao/1003/prescrever', {
      atendimento: 10031,
      periodo: 'atual',
      dataHora: agora(),
      itens: [amox],
    });
    expect(sem.statusCode).toBe(422);
    const v = (
      await post(medico, '/api/pep/prescricao/1003/verificar', {
        atendimento: 10031,
        periodo: 'atual',
        itens: [amox],
      })
    ).json();
    const alerta = v.alertas.find((a: { tipo: string }) => a.tipo === 'alergia');
    expect(alerta).toBeDefined();
    const com = await post(medico, '/api/pep/prescricao/1003/prescrever', {
      atendimento: 10031,
      periodo: 'atual',
      dataHora: agora(),
      itens: [
        {
          ...amox,
          decisoes: v.alertas
            .filter((a: { item: string }) => a.item === 'a1')
            .map((a: { id: string }) => ({
              alerta: a.id,
              decisao: 'mantido',
              justificativa: 'Benefício avaliado, sem alternativa sintética.',
            })),
        },
      ],
    });
    expect(com.statusCode, com.body).toBe(201);
    // C2-013: a ficha do antimicrobiano vai junto da prescrição, ligada ao item gravado (nada de 501).
    const farm = await entrar('SINT.FARMACIA');
    const fichas = (await get(farm, '/api/farmacia-clinica/antimicrobianos?paciente=1003')).json();
    expect(fichas).toContainEqual(
      expect.objectContaining({
        origem: 'novo',
        produto: expect.stringContaining('AMOXICILINA'),
        item: expect.any(Number),
        indicacao: 'Infecção sintética',
        sitio: 'Pulmão',
      }),
    );
  });

  it('adendo e suspensão do item (reautenticação, justificativa, já suspenso 409)', async () => {
    const inc = await post(medico, `/api/pep/prescricao/1001/prescricoes/${prescricao}/itens`, {
      dataHora: agora(),
      item: { chave: 'n1', detalhe: { tipo: 'procedimento', procedimento: 1, frequencia: 5 } },
    });
    expect(inc.statusCode, inc.body).toBe(201);
    const url = `/api/pep/prescricao/1001/prescricoes/${prescricao}/itens/${item}/suspender`;
    expect((await post(medico, url, { justificativa: 'Sem indicação sintética.' })).statusCode).toBe(400);
    const s = await post(medico, url, { senha: SENHA, justificativa: 'Sem indicação sintética.' });
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json().horarios).toBe(4);
    const de_novo = await post(medico, url, { senha: SENHA, justificativa: 'Sem indicação sintética.' });
    expect(de_novo.statusCode).toBe(409);
    expect(de_novo.json().codigo).toBe('item-nao-ativo');
    const l = (await get(medico, `/api/pep/prescricao/1001/prescricoes/${prescricao}`)).json();
    expect(l.itens).toBe(3);
    expect(l.itensLidos.find((i: { id: number }) => i.id === item).situacao).toBe('suspenso');
  });

  it('suspensão da prescrição inteira', async () => {
    const s = await post(medico, `/api/pep/prescricao/1001/prescricoes/${prescricao}/suspender`, {
      senha: SENHA,
      justificativa: 'Alta sintética do paciente.',
    });
    expect(s.statusCode, s.body).toBe(200);
    const l = (await get(medico, `/api/pep/prescricao/1001/prescricoes/${prescricao}`)).json();
    expect(l.situacao).toBe('suspensa');
    expect(l.suspensao.justificativa).toBe('Alta sintética do paciente.');
  });

  it('renovação de uma prescrição do outro sistema (itens confirmados) para o período seguinte', async () => {
    const lista = (await get(medico, '/api/pep/prescricao/1001/atendimentos/10011')).json();
    const antiga = lista.find((p: { feitaNoNovo: boolean }) => !p.feitaNoNovo);
    const origem = (await get(medico, `/api/pep/prescricao/1001/prescricoes/${antiga.id}`)).json();
    const r = await post(medico, '/api/pep/prescricao/1001/prescrever', {
      atendimento: 10011,
      periodo: 'seguinte',
      dataHora: agora(),
      origem: { prescricao: antiga.id, modo: 'renovacao' },
      itens: [{ ...dipirona(), origem: { item: origem.itensLidos[0].id, alterado: false } }],
    });
    expect(r.statusCode, r.body).toBe(201);
  });

  it('residente: a prescrição espera a coassinatura; o preceptor coassina', async () => {
    const residente = await entrar('SINT.RESIDENTE');
    const c = (await get(residente, '/api/pep/prescricao/1003/contexto')).json();
    expect(c.prescritor).toMatchObject({ categoria: 'residente', coassinatura: true });
    const r = await post(residente, '/api/pep/prescricao/1003/prescrever', {
      atendimento: 10032,
      periodo: 'atual',
      dataHora: agora(),
      itens: [dipirona()],
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().prescricao;
    expect(
      (await get(medico, `/api/pep/prescricao/1003/prescricoes/${id}`)).json().coassinaturaPendente,
    ).toBe(true);
    const co = await post(medico, `/api/pep/prescricao/1003/prescricoes/${id}/coassinar`, { senha: SENHA });
    expect(co.statusCode, co.body).toBe(200);
    expect(
      (await get(medico, `/api/pep/prescricao/1003/prescricoes/${id}`)).json().coassinaturaPendente,
    ).toBe(false);
    expect(
      (await post(medico, `/api/pep/prescricao/1003/prescricoes/${id}/coassinar`, { senha: SENHA }))
        .statusCode,
    ).toBe(409);
  });

  it('nutricionista não prescreve medicamento (alerta de categoria impede)', async () => {
    const nutri = await entrar('SINT.NUTRI');
    const v = (
      await post(nutri, '/api/pep/prescricao/1001/verificar', {
        atendimento: 10012,
        periodo: 'atual',
        itens: [dipirona()],
      })
    ).json();
    expect(v.impede).toBe(true);
    expect(v.alertas.some((a: { tipo: string }) => a.tipo === 'categoria')).toBe(true);
  });

  it('prescrição futura e reconciliação medicamentosa (só no novo)', async () => {
    const f = await post(medico, '/api/pep/prescricao/1001/futuras', {
      atendimento: 10011,
      aPartirDe: '2030-01-02',
      item: dipirona('f1'),
    });
    expect(f.statusCode, f.body).toBe(201);
    const fs = (await get(medico, '/api/pep/prescricao/1001/futuras?atendimento=10011')).json();
    expect(fs.futuras[0]).toMatchObject({ situacao: 'programada', aPartirDe: '2030-01-02' });
    expect(
      (
        await post(medico, `/api/pep/prescricao/1001/futuras/${f.json().id}/cancelar`, {
          motivo: 'Mudou o plano.',
        })
      ).statusCode,
    ).toBe(200);
    const sem = await post(medico, '/api/pep/prescricao/1001/reconciliacao', {
      atendimento: 10011,
      momento: 'admissao',
      medicamentos: [{ descricao: 'Losartana sintética', fonte: 'paciente', conduta: 'suspender' }],
    });
    expect(sem.statusCode).toBe(400);
    const r = await post(medico, '/api/pep/prescricao/1001/reconciliacao', {
      atendimento: 10011,
      momento: 'admissao',
      medicamentos: [
        {
          descricao: 'Losartana sintética',
          fonte: 'paciente',
          conduta: 'suspender',
          justificativa: 'Hipotensão sintética.',
        },
        { descricao: 'Metformina sintética', fonte: 'receita', conduta: 'manter' },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    const lidas = (await get(medico, '/api/pep/prescricao/1001/reconciliacao?atendimento=10011')).json();
    expect(lidas[0].medicamentos.length).toBe(2);
  });

  it('farmácia clínica: regra versionada e simulador; horários-padrão da enfermagem', async () => {
    const farm = await entrar('SINT.FARMACIA');
    const r0 = (await get(farm, '/api/farmacia-clinica/regras')).json();
    expect(r0.padrao.length).toBeGreaterThan(5);
    expect(r0.baseInteracoes).toBe('nao-contratada');
    const g = await post(farm, '/api/farmacia-clinica/regras', {
      senha: SENHA,
      codigo: 'duplicidade',
      tipo: 'duplicidade',
      nivel: 'bloqueio',
      vigenteDesde: '2026-01-01',
      ativa: true,
      descricao: 'Duplicidade bloqueia sem exceção (sintético).',
      justificativa: 'Decisão da comissão sintética.',
    });
    expect(g.statusCode, g.body).toBe(201);
    expect(g.json().versao).toBe(2);
    const s = await post(farm, '/api/farmacia-clinica/simular', {
      itens: [
        dipirona(),
        {
          chave: 'm2',
          detalhe: {
            tipo: 'medicamento',
            item: { produto: 507 },
            dose: 1,
            unidade: 'G',
            via: 'VO',
            frequencia: 11,
          },
        },
      ],
    });
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json().impede).toBe(true);
    const enf = await entrar('SINT.ENFERMAGEM');
    const h = (await get(enf, '/api/enfermagem/horarios-padrao')).json();
    expect(h.regras.find((x: { id: number }) => x.id === 4).horarioInicial).toBe('1601');
    const gc = await post(enf, '/api/enfermagem/horarios-padrao/classe', {
      unidade: 1,
      classe: 'antimicrobiano',
      numDoses: 2,
      horarios: ['0800', '2000'],
      vigenteDesde: '2026-11-01',
      ativa: true,
    });
    expect(gc.statusCode, gc.body).toBe(201);
    expect((await get(enf, '/api/pep/prescricao/1001/futuras?atendimento=10011')).statusCode).toBe(200);
  });

  it('cadastros de prescrição em consulta: kits, receitas padrão, não padronizados e parâmetros do item', async () => {
    // Cada cadastro pela permissão dele: a farmácia (sem a opção da prescrição) lê; o médico (só a prescrição), não.
    expect((await get(medico, '/api/pep/prescricao/cadastros/kitsMedicamento')).statusCode).toBe(403);
    const farm = await entrar('SINT.FARMACIA');
    const kits = await get(farm, '/api/pep/prescricao/cadastros/kitsMedicamento');
    expect(kits.statusCode).toBe(200);
    const k = kits.json() as {
      secao: string;
      linhas: { nome: string; filhos: unknown[] }[];
      truncada: boolean;
    };
    expect(k.secao).toBe('kitsMedicamento');
    expect(k.linhas[0]?.nome).toMatch(/CEFTRIAXONA/);
    expect(k.linhas[0]?.filhos).toHaveLength(2);
    const sol = (await get(farm, '/api/pep/prescricao/cadastros/kitsSolucao?termo=soro')).json() as {
      linhas: { filhos: { campos: { principal?: boolean } }[] }[];
    };
    expect(sol.linhas[0]?.filhos.filter((f) => f.campos.principal)).toHaveLength(1);
    const rp = (await get(farm, '/api/pep/prescricao/cadastros/receitasPadrao')).json() as {
      linhas: { campos: Record<string, unknown> }[];
    };
    // A receita padrão sai sem o texto e sem o autor.
    expect(Object.keys(rp.linhas[0]?.campos ?? {}).sort()).toEqual(['geral', 'vigenteAte', 'vigenteDesde']);
    expect((await get(farm, '/api/pep/prescricao/cadastros/naoPadronizados')).statusCode).toBe(200);
    // Parâmetros do item: só com a busca (2 letras ou mais).
    const vazio = (await get(farm, '/api/pep/prescricao/cadastros/parametrosItem')).json() as {
      linhas: unknown[];
    };
    expect(vazio.linhas).toEqual([]);
    const morfina = (
      await get(farm, '/api/pep/prescricao/cadastros/parametrosItem?termo=morfina')
    ).json() as {
      linhas: { campos: { altaVigilancia: boolean } }[];
    };
    expect(morfina.linhas).toHaveLength(1);
    expect(morfina.linhas[0]?.campos.altaVigilancia).toBe(true);
    expect((await get(farm, '/api/pep/prescricao/cadastros/outro')).statusCode).toBe(404);
    expect(
      (await get(farm, `/api/pep/prescricao/cadastros/kitsMedicamento?termo=${'x'.repeat(61)}`)).statusCode,
    ).toBe(400);
    // Protocolos e frequências: a consulta do cadastro pela permissão dele; a farmácia não prescreve (403 com paciente).
    expect((await get(farm, '/api/pep/prescricao/protocolos')).statusCode).toBe(200);
    expect((await get(farm, '/api/pep/prescricao/protocolos?paciente=1001')).statusCode).toBe(403);
    expect((await get(farm, '/api/pep/prescricao/dominios')).statusCode).toBe(200);
    expect((await get(farm, '/api/enfermagem/horarios-padrao')).statusCode).toBe(200);
  });

  it('permissões: a recepção não abre a prescrição', async () => {
    const rec = await entrar('SINT.RECEPCAO');
    expect((await get(rec, '/api/pep/prescricao/1001/contexto')).statusCode).toBe(403);
    expect((await get(rec, '/api/farmacia-clinica/regras')).statusCode).toBe(403);
    expect((await get(rec, '/api/pep/prescricao/cadastros/kitsMedicamento')).statusCode).toBe(403);
  });
});

describe('correções da revisão do M24', () => {
  let medico: Sessao;
  beforeAll(async () => {
    medico = await entrar('SINT.MEDICO');
  });

  it('cancelar a prescrição futura de outro paciente pela rota de um: 404 e nada gravado', async () => {
    const f = await post(medico, '/api/pep/prescricao/1001/futuras', {
      atendimento: 10011,
      aPartirDe: '2030-02-03',
      item: dipirona('fx'),
    });
    expect(f.statusCode, f.body).toBe(201);
    const id = f.json().id as number;
    const alheia = await post(medico, `/api/pep/prescricao/1003/futuras/${id}/cancelar`, {
      motivo: 'Tentativa sintética.',
    });
    expect(alheia.statusCode).toBe(404);
    const fs = (await get(medico, '/api/pep/prescricao/1001/futuras?atendimento=10011')).json();
    expect(fs.futuras.find((x: { id: number }) => x.id === id).situacao).toBe('programada');
    const url = `/api/pep/prescricao/1001/futuras/${id}/cancelar`;
    expect((await post(medico, url, { motivo: 'Mudou o plano.' })).statusCode).toBe(200);
    const de_novo = await post(medico, url, { motivo: 'Mudou o plano.' });
    expect(de_novo.statusCode).toBe(409);
    // Motivo fora do CP1252: recusado na entrada, com a troca sugerida.
    expect((await post(medico, url, { motivo: 'dose ≥ 5 ✓ sintético' })).statusCode).toBe(400);
  });

  it('textos livres gravados no novo sem caractere fora do CP1252 (regra de alerta)', async () => {
    const farm = await entrar('SINT.FARMACIA');
    const r = await post(farm, '/api/farmacia-clinica/regras', {
      senha: SENHA,
      codigo: 'dose-maxima',
      tipo: 'dose-maxima',
      nivel: 'justificar',
      vigenteDesde: '2026-01-01',
      ativa: true,
      descricao: 'Dose ≥ máxima pede justificativa (sintético).',
      justificativa: 'Decisão da comissão sintética ✓.',
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().detail).toMatch(/não é aceito/);
  });

  it('o contexto (peso, creatinina, clearance) é leitura do paciente: a Consulta do RES vai à trilha', async () => {
    const outro = await entrar('SINT.MEDICO');
    const antes = trilha.eventos.length;
    expect((await get(outro, '/api/pep/prescricao/1003/contexto')).statusCode).toBe(200);
    expect(
      trilha.eventos
        .slice(antes)
        .some((e) => e.evento === EVENTOS_AUDITAVEIS.consultaRes.codigo && e.paciente === 1003),
    ).toBe(true);
    // Sem a trilha, nada é mostrado (falha fechada).
    const terceiro = await entrar('SINT.MEDICO');
    trilha.falhar = true;
    try {
      expect((await get(terceiro, '/api/pep/prescricao/1001/contexto')).statusCode).toBe(503);
    } finally {
      trilha.falhar = false;
    }
  });

  it('regra 7: a faixa de dose do cadastro do item (por unidade de prescrição) gera o alerta', async () => {
    const morfina = (dose: number) => ({
      chave: 'mo',
      detalhe: {
        tipo: 'medicamento',
        item: { produto: 503 },
        dose,
        unidade: 'MG',
        via: 'EV',
        frequencia: 11,
      },
    });
    const acima = (
      await post(medico, '/api/pep/prescricao/1001/verificar', {
        atendimento: 10011,
        periodo: 'atual',
        itens: [morfina(20)],
      })
    ).json();
    const a = acima.alertas.find((x: { tipo: string }) => x.tipo === 'dose-maxima');
    expect(a).toMatchObject({ nivel: 'justificar' });
    expect(a.detalhe).toContain('10');
    const dentro = (
      await post(medico, '/api/pep/prescricao/1001/verificar', {
        atendimento: 10011,
        periodo: 'atual',
        itens: [morfina(5)],
      })
    ).json();
    expect(dentro.alertas.some((x: { tipo: string }) => x.tipo === 'dose-maxima')).toBe(false);
    const busca = (await get(medico, '/api/pep/prescricao/produtos?termo=morfina')).json();
    expect(busca.find((p: { produto: number }) => p.produto === 503)).toMatchObject({ doseMaxima: 10 });
  });

  it('protocolos aplicáveis pela idade, o peso e o sexo do paciente e pela especialidade de quem prescreve', async () => {
    const sem = (await get(medico, '/api/pep/prescricao/protocolos')).json();
    expect(sem.every((p: { aplicavel: boolean }) => p.aplicavel)).toBe(true);
    const r = (await get(medico, '/api/pep/prescricao/protocolos?paciente=1001')).json();
    const de = (id: number) => r.find((p: { id: number }) => p.id === id);
    expect(de(1)).toMatchObject({ aplicavel: true });
    // 68 anos e 72 kg no cadastro sintético: o pediátrico não vale.
    expect(de(2)).toMatchObject({ aplicavel: false });
    expect(de(2).motivo).toMatch(/12 anos/);
    expect(de(3)).toMatchObject({ aplicavel: false, motivo: 'Protocolo de outra especialidade.' });
  });

  it('adendo e correção só dos tipos que a gravação cobre (POL-3): recusa em português, nada gravado', async () => {
    const lista = (await get(medico, '/api/pep/prescricao/1003/atendimentos/10031')).json();
    const p = lista.find((x: { feitaNoNovo: boolean; situacao: string }) => x.feitaNoNovo);
    expect(p).toBeDefined();
    const solucao = await post(medico, `/api/pep/prescricao/1003/prescricoes/${p.id}/itens`, {
      dataHora: agora(),
      item: {
        chave: 's1',
        detalhe: {
          tipo: 'solucao',
          via: 'EV',
          frequencia: 11,
          componentes: [{ produto: 504, dose: 500, unidade: 'ML', principal: true }],
          etapas: [{ etapa: 1, velocidade: 100, unidadeInfusao: 1 }],
        },
      },
    });
    expect(solucao.statusCode, solucao.body).toBe(409);
    expect(solucao.json().codigo).toBe('tipo-nao-liberado');
    const cuidadoSn = await post(medico, `/api/pep/prescricao/1003/prescricoes/${p.id}/itens`, {
      dataHora: agora(),
      item: {
        chave: 'c1',
        detalhe: {
          tipo: 'procedimento',
          procedimento: 1,
          frequencia: 5,
          seNecessario: { motivos: [1], intervaloMinimoHoras: 6 },
        },
      },
    });
    expect(cuidadoSn.statusCode).toBe(409);
    const depois = (await get(medico, `/api/pep/prescricao/1003/prescricoes/${p.id}`)).json();
    expect(depois.itens).toBe(p.itens);
  });

  it('ficha de antimicrobiano e reconciliação: o item ligado precisa ser do atendimento', async () => {
    const r = await post(medico, '/api/pep/prescricao/1001/reconciliacao', {
      atendimento: 10011,
      momento: 'admissao',
      medicamentos: [
        { descricao: 'Metformina sintética', fonte: 'receita', conduta: 'manter', itemPrescricao: 999999 },
      ],
    });
    expect(r.statusCode).toBe(404);
    const farm = await entrar('SINT.FARMACIA');
    const f = await post(farm, '/api/farmacia-clinica/antimicrobianos', {
      paciente: 1001,
      atendimento: 10011,
      produto: 502,
      prescricao: 999999,
      item: null,
      indicacao: 'Infecção sintética',
      sitio: 'Pulmão',
      tipo: 'empirico',
      culturaColhida: false,
      diaTratamento: 1,
    });
    // Liberada a ficha: 404 (a prescrição não é do atendimento); desligada: 403 antes de qualquer conferência.
    expect([403, 404]).toContain(f.statusCode);
  });

  it('as que vencem no turno: paciente, unidade e leito; filtro pela unidade', async () => {
    const r = await get(medico, '/api/pep/prescricao/a-renovar?horas=24');
    expect(r.statusCode).toBe(200);
    for (const x of r.json() as Record<string, unknown>[])
      expect(Object.keys(x)).toEqual(
        expect.arrayContaining(['paciente', 'nome', 'unidade', 'unidadeNome', 'leito', 'prescricao']),
      );
    expect((await get(medico, '/api/pep/prescricao/a-renovar?horas=24&unidade=2')).json()).toEqual([]);
  });
});
