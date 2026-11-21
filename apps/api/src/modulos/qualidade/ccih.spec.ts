// CCIH pela HTTP (M48, etapa 3; regras 5, 6, 7 e 11), com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA
// (nada conecta a banco; dados sintéticos): a vigilância com o restrito sem liberação, a febre e a cultura; o
// dispositivo (um ativo por tipo); a ficha de IRAS com os critérios, o 3º dia e a associação ao CVC; os denominadores
// com as parcelas; a fila do restrito, o alerta ao prescritor, a liberação única e as revisões; o consumo em DDD e DOT;
// a precaução que reflete no leito e bloqueia o vizinho livre; higiene das mãos e surtos; permissão e chave desligada.
import { criarAppQualidade } from './teste.spec-util.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import {
  INTERNACAO_SINTETICA_CCIH,
  ITEM_PRESCRITO_SINTETICO_CCIH,
  PACIENTE_SINTETICO_CCIH,
  PortaCcihMemoria,
} from './porta-ccih-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-22 13:00 em São Paulo. */
const agora = () => new Date('2026-10-22T16:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar(o: { semChave?: boolean } = {}) {
  const trilha = new RegistradorTrilhaMemoria();
  const configuracao = o.semChave
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'qualidade.ccih'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const porta = new PortaCcihMemoria({ agora });
  const app: NestFastifyApplication = await criarAppQualidade(env, {
    trilha,
    ccih: porta,
    vigiaEnfermagem: null,
    vigia: null,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    trilha,
    porta,
    async entrar(login: string): Promise<Sessao> {
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
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: unknown = {}) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf },
        payload: payload as object,
      }),
  };
}

type App = Awaited<ReturnType<typeof montar>>;
let a: App;
let ccih: Sessao;
beforeAll(async () => {
  a = await montar();
  ccih = await a.entrar('SINT.CCIH');
});
afterAll(async () => {
  await a.app.close();
});

const codigo = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;

describe('vigilância ativa', () => {
  it('formulário com a chave ligada e as ações da CCIH; sem o perfil, 403', async () => {
    const r = await a.get(ccih, '/qualidade/ccih/formulario');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      ligada: true,
      prazoLiberacaoHoras: 48,
      acoes: { registrar: true, iras: true, liberar: true, precaucao: true },
    });
    const enf = await a.entrar('SINT.ENFERMEIRO');
    expect((await a.get(enf, '/qualidade/ccih/vigilancia')).statusCode).toBe(403);
  });

  it('o restrito sem liberação no prazo, a febre e a cultura põem o internado no topo; o cartão só conta', async () => {
    const r = await a.get(ccih, '/qualidade/ccih/vigilancia');
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.itens[0]).toMatchObject({
      internacao: INTERNACAO_SINTETICA_CCIH,
      febre: true,
      motivos: expect.arrayContaining(['antimicrobianoSemLiberacao', 'febre', 'cultura', 'antimicrobiano']),
    });
    expect(b.itens.find((i: { internacao: number }) => i.internacao === 4803)?.motivos).toEqual(
      expect.arrayContaining(['posOperatorio', 'antimicrobiano']),
    );
    expect(b.itens.some((i: { internacao: number }) => i.internacao === 4802)).toBe(false);
    expect(b.resumo).toMatchObject({ internados: 3, semLiberacao: 1 });
    const c = await a.get(ccih, '/qualidade/ccih/resumo');
    expect(c.json()).toEqual({ ligada: true, emVigilancia: 2, semLiberacao: 1 });
    // A escolha do paciente nos formulários: todos os internados, também o que não está em vigilância.
    const ints = await a.get(ccih, '/qualidade/ccih/internados');
    expect(ints.statusCode, ints.body).toBe(200);
    expect(
      ints
        .json()
        .itens.map((i: { internacao: number }) => i.internacao)
        .sort(),
    ).toEqual([4801, 4802, 4803]);
    expect(ints.json().itens[0]).toMatchObject({ setor: expect.any(String), leito: expect.any(String) });
  });
});

describe('dispositivos, IRAS e denominadores', () => {
  let cvc = 0;
  it('registra o CVC; um ativo por tipo; não no futuro', async () => {
    const base = {
      internacao: INTERNACAO_SINTETICA_CCIH,
      tipo: 'cvc',
      sitio: 'Subclávia direita',
      inseridoEm: '2026-10-17T10:00',
      itemPrescricao: null,
      observacao: null,
    };
    const r = await a.post(ccih, '/qualidade/ccih/dispositivos', base);
    expect(r.statusCode, r.body).toBe(201);
    cvc = r.json().id;
    const dup = await a.post(ccih, '/qualidade/ccih/dispositivos', base);
    expect([dup.statusCode, codigo(dup)]).toEqual([409, 'dispositivo-ja-ativo']);
    const fut = await a.post(ccih, '/qualidade/ccih/dispositivos', {
      ...base,
      tipo: 'sondaVesical',
      inseridoEm: '2026-10-22T14:00',
    });
    expect([fut.statusCode, codigo(fut)]).toEqual([422, 'instante-futuro']);
    const ant = await a.post(ccih, '/qualidade/ccih/dispositivos', {
      ...base,
      tipo: 'sondaVesical',
      inseridoEm: '2026-10-15T14:00',
    });
    expect([ant.statusCode, codigo(ant)]).toEqual([422, 'antes-da-internacao']);
  });

  it('IPCS com hemocultura associa ao CVC; critérios, 3º dia e cultura de outro paciente recusados', async () => {
    const ficha = {
      internacao: INTERNACAO_SINTETICA_CCIH,
      sitio: 'ipcs',
      dataInfeccao: '2026-10-21',
      criterios: ['hemoculturaPatogeno', 'febre'],
      nivelIsc: null,
      cirurgia: null,
      implante: false,
      exame: 480_000_000_001,
      microrganismo: 'Klebsiella pneumoniae',
      multirresistente: true,
      descricao: null,
    };
    const r = await a.post(ccih, '/qualidade/ccih/iras', ficha);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().dispositivoAssociado).toBe(cvc);
    const ins = await a.post(ccih, '/qualidade/ccih/iras', { ...ficha, criterios: ['febre'] });
    expect([ins.statusCode, codigo(ins)]).toEqual([422, 'criterios-insuficientes']);
    const cedo = await a.post(ccih, '/qualidade/ccih/iras', {
      ...ficha,
      internacao: 4802,
      exame: null,
      dataInfeccao: '2026-10-21',
    });
    expect([cedo.statusCode, codigo(cedo)]).toEqual([422, 'antes-do-terceiro-dia']);
    const outro = await a.post(ccih, '/qualidade/ccih/iras', { ...ficha, internacao: 4803 });
    expect([outro.statusCode, codigo(outro)]).toEqual([422, 'exame-de-outra-internacao']);
    const isc = await a.post(ccih, '/qualidade/ccih/iras', {
      ...ficha,
      internacao: 4803,
      sitio: 'isc',
      exame: null,
      criterios: ['drenagemPurulenta'],
      cirurgia: 48_301,
      nivelIsc: 'superficial',
      multirresistente: false,
      microrganismo: null,
    });
    expect(isc.statusCode, isc.body).toBe(201);
    expect(isc.json().dispositivoAssociado).toBeNull();
    const lista = await a.get(ccih, '/qualidade/ccih/iras?competencia=2026-10');
    expect(lista.json().itens).toHaveLength(2);
  });

  it('denominadores da competência com as parcelas; o censo incompleto avisado', async () => {
    const r = await a.get(ccih, '/qualidade/ccih/denominadores?competencia=2026-10');
    expect(r.statusCode, r.body).toBe(200);
    const uti = r.json().setores.find((x: { setor: string }) => x.setor === 'UTI');
    // CVC inserido em 17/10 10h, em uso; dias terminados até 21/10: 17, 18, 19, 20, 21 → 5.
    expect(uti.dispositivosDia.cvc).toBe(5);
    expect(uti.pacientesDia).toBe(8 * 21);
    expect(uti.densidade.ipcs).toEqual({ numerador: 1, denominador: 5, fator: 1000, valor: 200 });
    expect(r.json().todos.setor).toBe('todos');
    expect(r.json().censo).toEqual({ diasFechados: 21, diasTerminados: 21, completo: true });
    const ruim = await a.get(ccih, '/qualidade/ccih/denominadores?competencia=2026-13');
    expect(ruim.statusCode).toBe(400);
  });

  it('a retirada acidental sugere a notificação; a versão velha é recusada', async () => {
    const r = await a.post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/retirar`, {
      versao: 1,
      retiradoEm: '2026-10-22T09:00',
      motivo: 'acidental',
      observacao: null,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toEqual({ versao: 2, sugerirNotificacao: true });
    const de = await a.post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/retirar`, {
      versao: 1,
      retiradoEm: '2026-10-22T09:00',
      motivo: 'eletiva',
      observacao: null,
    });
    expect([de.statusCode, codigo(de)]).toEqual([409, 'ja-retirado']);
  });
});

describe('antimicrobianos', () => {
  let liberacao = 0;
  it('a fila mostra o restrito vencido com alerta; o prescritor vê o alerta', async () => {
    const r = await a.get(ccih, '/qualidade/ccih/antimicrobianos');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().itens).toHaveLength(1);
    expect(r.json().itens[0]).toMatchObject({
      itemPrescricao: ITEM_PRESCRITO_SINTETICO_CCIH,
      restrito: true,
      situacao: { situacao: 'vencida', alerta: true },
      liberacao: null,
    });
    expect((await a.get(ccih, '/qualidade/ccih/antimicrobianos?todos=1')).json().itens).toHaveLength(2);
    const med = await a.entrar('SINT.MEDICO');
    const al = await a.get(
      med,
      `/qualidade/ccih/antimicrobianos/alertas/${String(INTERNACAO_SINTETICA_CCIH)}`,
    );
    expect(al.statusCode, al.body).toBe(200);
    expect(al.json().itens).toEqual([
      expect.objectContaining({ itemPrescricao: ITEM_PRESCRITO_SINTETICO_CCIH, situacao: 'vencida' }),
    ]);
    // Pelo atendimento da tela da prescrição: o da internação dá o mesmo alerta; outro atendimento, nada.
    const pa = await a.get(med, '/qualidade/ccih/antimicrobianos/alertas?atendimento=10031');
    expect(pa.statusCode, pa.body).toBe(200);
    expect(pa.json().itens).toEqual(al.json().itens);
    expect(
      (await a.get(med, '/qualidade/ccih/antimicrobianos/alertas?atendimento=99999')).json().itens,
    ).toEqual([]);
  });

  it('libera fora do prazo; a segunda decisão e o não restrito são recusados', async () => {
    const r = await a.post(ccih, '/qualidade/ccih/antimicrobianos/liberar', {
      itemPrescricao: ITEM_PRESCRITO_SINTETICO_CCIH,
      decisao: 'liberado',
      diasAutorizados: 7,
      justificativa: null,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().noPrazo).toBe(false);
    liberacao = r.json().id;
    const de = await a.post(ccih, '/qualidade/ccih/antimicrobianos/liberar', {
      itemPrescricao: ITEM_PRESCRITO_SINTETICO_CCIH,
      decisao: 'liberado',
      diasAutorizados: 7,
      justificativa: null,
    });
    expect([de.statusCode, codigo(de)]).toEqual([409, 'ja-decidido']);
    const nr = await a.post(ccih, '/qualidade/ccih/antimicrobianos/liberar', {
      itemPrescricao: 480_301,
      decisao: 'liberado',
      diasAutorizados: 7,
      justificativa: null,
    });
    expect([nr.statusCode, codigo(nr)]).toEqual([409, 'nao-e-restrito']);
    const f = await a.get(ccih, '/qualidade/ccih/antimicrobianos');
    expect(f.json().itens[0]).toMatchObject({
      situacao: { situacao: 'liberado', alerta: false },
      revisaoDevida: { marco: 'd3', devidaEm: '2026-10-22', atrasada: false },
    });
  });

  it('revisão do 3º dia; a do 7º ainda não cabe; a versão velha é recusada', async () => {
    const url = `/qualidade/ccih/antimicrobianos/liberacoes/${String(liberacao)}/revisar`;
    const r = await a.post(ccih, url, { versao: 1, marco: 'd3', conduta: 'descalonar', observacao: null });
    expect(r.statusCode, r.body).toBe(201);
    const d7 = await a.post(ccih, url, { versao: 2, marco: 'd7', conduta: 'manter', observacao: null });
    expect([d7.statusCode, codigo(d7)]).toEqual([409, 'revisao-antes-do-dia']);
    const rep = await a.post(ccih, url, { versao: 1, marco: 'd3', conduta: 'manter', observacao: null });
    expect([rep.statusCode, codigo(rep)]).toEqual([409, 'revisao-ja-feita']);
  });

  it('configuração do item e consumo em DDD e DOT com as parcelas', async () => {
    const nao = await a.post(ccih, '/qualidade/ccih/antimicrobianos/itens', {
      item: 9003,
      restrito: false,
      atc: null,
      dddGramas: null,
      gramasPorUnidade: null,
    });
    expect([nao.statusCode, codigo(nao)]).toEqual([422, 'nao-e-antimicrobiano']);
    const ok = await a.post(ccih, '/qualidade/ccih/antimicrobianos/itens', {
      item: 9002,
      restrito: false,
      atc: 'J01DD04',
      dddGramas: 2,
      gramasPorUnidade: 1,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const itens = (await a.get(ccih, '/qualidade/ccih/antimicrobianos/itens')).json().itens;
    expect(itens).toEqual([
      expect.objectContaining({ item: 9001, restrito: true, configurado: true }),
      expect.objectContaining({ item: 9002, restrito: false, dddGramas: 2, configurado: true }),
    ]);
    const c = await a.get(ccih, '/qualidade/ccih/antimicrobianos/consumo?competencia=2026-10');
    expect(c.statusCode, c.body).toBe(200);
    const b = c.json();
    expect(b.pacientesDia).toBe(28 * 21);
    // Meropeném 60 frascos de 1 g ÷ DDD 3 g = 20; ceftriaxona 30 ÷ 2 = 15.
    expect(b.itens.map((i: { item: number; ddd: number }) => [i.item, i.ddd])).toEqual([
      [9001, 20],
      [9002, 15],
    ]);
    expect(b.dddPorMilPacientesDia).toMatchObject({ numerador: 35, denominador: 588 });
    // DOT: meropeném de 20/10 11h a 23/10 11h (4 dias) e ceftriaxona de 22/10 8h a 23/10 8h (2 dias).
    expect(b.dotPorMilPacientesDia.numerador).toBe(6);
  });
});

describe('precauções no mapa de leitos', () => {
  let tb = 0;
  it('aerossóis em quarto compartilhado exige bloquear; só o vizinho livre é bloqueado', async () => {
    const p = {
      internacao: INTERNACAO_SINTETICA_CCIH,
      motivo: 'tuberculose',
      motivoOutro: null,
      tipo: 'aerossois',
      origem: 'manual',
      exame: null,
      bloquearVizinhos: false,
      observacao: null,
    };
    const sem = await a.post(ccih, '/qualidade/ccih/precaucoes', p);
    expect([sem.statusCode, codigo(sem)]).toEqual([409, 'bloqueio-vizinho-exigido']);
    const r = await a.post(ccih, '/qualidade/ccih/precaucoes', { ...p, bloquearVizinhos: true });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      leito: 'abriu',
      tipoDoLeito: 'aerossois',
      bloqueados: 1,
      bloqueioVizinho: 'exigido',
      vizinhosOcupados: ['UTI · 01 · C'],
    });
    tb = r.json().id;
    expect(a.porta.estadoDoLeito({ bloco: 'UTI', acomodacao: '01', leito: 'A' }).get('precaucao')).toBe(
      'aerossois',
    );
    expect(a.porta.estadoDoLeito({ bloco: 'UTI', acomodacao: '01', leito: 'B' }).has('bloqueio')).toBe(true);
    const dup = await a.post(ccih, '/qualidade/ccih/precaucoes', { ...p, bloquearVizinhos: true });
    expect([dup.statusCode, codigo(dup)]).toEqual([409, 'precaucao-ja-aberta']);
  });

  it('KPC da microbiologia junto: o leito fica com a mais restritiva; ao encerrar a TB, passa a contato', async () => {
    const kpc = await a.post(ccih, '/qualidade/ccih/precaucoes', {
      internacao: INTERNACAO_SINTETICA_CCIH,
      motivo: 'kpc',
      motivoOutro: null,
      tipo: 'contato',
      origem: 'microbiologia',
      exame: 480_000_000_001,
      bloquearVizinhos: false,
      observacao: null,
    });
    expect(kpc.statusCode, kpc.body).toBe(201);
    expect(kpc.json()).toMatchObject({ leito: 'manteve', tipoDoLeito: 'aerossois' });
    const lista = await a.get(ccih, '/qualidade/ccih/precaucoes');
    expect(
      lista
        .json()
        .itens.map((x: { motivo: string }) => x.motivo)
        .sort(),
    ).toEqual(['kpc', 'tuberculose']);
    // Regra 7: o cabeçalho do prontuário do paciente (1003 na memória) mostra as duas, sem leito nem autor.
    const med = await a.entrar('SINT.MEDICO');
    const cab = await a.get(med, `/qualidade/ccih/precaucoes/do-paciente/${String(PACIENTE_SINTETICO_CCIH)}`);
    expect(cab.statusCode, cab.body).toBe(200);
    expect(
      cab
        .json()
        .itens.map((x: { tipo: string }) => x.tipo)
        .sort(),
    ).toEqual(['aerossois', 'contato']);
    expect(Object.keys(cab.json().itens[0]).sort()).toEqual([
      'motivo',
      'motivoOutro',
      'multirresistente',
      'tipo',
    ]);
    expect((await a.get(med, '/qualidade/ccih/precaucoes/do-paciente/99999')).json()).toEqual({ itens: [] });
    const enc = await a.post(ccih, `/qualidade/ccih/precaucoes/${String(tb)}/encerrar`, {
      versao: 1,
      motivo: 'reavaliacao',
      observacao: null,
    });
    expect(enc.statusCode, enc.body).toBe(201);
    expect(enc.json()).toEqual({ versao: 2, liberados: 1 });
    expect(a.porta.estadoDoLeito({ bloco: 'UTI', acomodacao: '01', leito: 'A' }).get('precaucao')).toBe(
      'contato',
    );
    expect(a.porta.estadoDoLeito({ bloco: 'UTI', acomodacao: '01', leito: 'B' }).has('bloqueio')).toBe(false);
    const de = await a.post(ccih, `/qualidade/ccih/precaucoes/${String(tb)}/encerrar`, {
      versao: 2,
      motivo: 'reavaliacao',
      observacao: null,
    });
    expect([de.statusCode, codigo(de)]).toEqual([409, 'precaucao-encerrada']);
  });
});

describe('higiene das mãos e surtos', () => {
  it('observação e consumo; a adesão com as parcelas', async () => {
    const o = await a.post(ccih, '/qualidade/ccih/maos/observacoes', {
      unidade: 2,
      setor: 'UTI',
      observadoEm: '2026-10-22T09:00',
      categoria: 'enfermeiro',
      oportunidades: [
        { momento: 'antesContato', acao: 'friccao', luvas: false },
        { momento: 'aposContato', acao: 'naoRealizada', luvas: true },
      ],
      observacao: null,
    });
    expect(o.statusCode, o.body).toBe(201);
    const fut = await a.post(ccih, '/qualidade/ccih/maos/consumo', {
      unidade: 2,
      setor: 'UTI',
      competencia: '2026-11',
      mililitros: 100,
    });
    expect([fut.statusCode, codigo(fut)]).toEqual([422, 'data-futura']);
    const c = await a.post(ccih, '/qualidade/ccih/maos/consumo', {
      unidade: 2,
      setor: 'UTI',
      competencia: '2026-10',
      mililitros: 3360,
    });
    expect(c.statusCode, c.body).toBe(201);
    const uni = await a.post(ccih, '/qualidade/ccih/maos/consumo', {
      unidade: 99,
      setor: 'UTI',
      competencia: '2026-10',
      mililitros: 1,
    });
    expect(uni.statusCode).toBe(422);
    const r = (await a.get(ccih, '/qualidade/ccih/maos?competencia=2026-10')).json();
    expect(r.adesao.total).toMatchObject({ numerador: 1, denominador: 2, valor: 50 });
    // 3.360 mL ÷ 168 pacientes-dia da UTI = 20 mL por paciente-dia.
    expect(r.consumo[0].porPacienteDia).toMatchObject({ numerador: 3360, denominador: 168, valor: 20 });
  });

  it('surto: abre, atualiza, encerra; encerrado não muda mais', async () => {
    const r = await a.post(ccih, '/qualidade/ccih/surtos', {
      titulo: 'Surto sintético de KPC na UTI',
      tipoSurto: 1,
      agente: 'KPC',
      unidade: 2,
      setor: 'UTI',
      inicio: '2026-10-15',
      casos: 2,
      medidas: null,
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    const t = await a.post(ccih, '/qualidade/ccih/surtos', {
      titulo: 'Surto sintético inválido',
      tipoSurto: 99,
      agente: null,
      unidade: 2,
      setor: null,
      inicio: '2026-10-15',
      casos: 1,
      medidas: null,
    });
    expect(t.statusCode).toBe(422);
    const enc = await a.post(ccih, `/qualidade/ccih/surtos/${String(id)}`, {
      versao: 1,
      situacao: 'encerrado',
      casos: 3,
      medidas: 'Coorte e reforço da higiene das mãos.',
      encerradoEm: '2026-10-21',
    });
    expect(enc.statusCode, enc.body).toBe(201);
    const de = await a.post(ccih, `/qualidade/ccih/surtos/${String(id)}`, {
      versao: 2,
      situacao: 'controle',
      casos: 3,
      medidas: null,
      encerradoEm: null,
    });
    expect([de.statusCode, codigo(de)]).toEqual([409, 'surto-encerrado']);
    expect((await a.get(ccih, '/qualidade/ccih/surtos')).json().itens).toHaveLength(1);
  });

  it('o detalhe do internado junta tudo; a trilha leva só os IDs', async () => {
    const r = await a.get(ccih, `/qualidade/ccih/internacoes/${String(INTERNACAO_SINTETICA_CCIH)}`);
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.internacao).toMatchObject({ internacao: INTERNACAO_SINTETICA_CCIH, setor: 'UTI', aberta: true });
    expect(b.dispositivos).toHaveLength(1);
    expect(b.iras).toHaveLength(1);
    expect(b.temperaturaMaxima48h).toBe(38.4);
    expect(b.vizinhos.map((v: { leito: string }) => v.leito)).toEqual(['B', 'C']);
    const eventos = a.trilha.eventos.map((l) => l.evento);
    expect(eventos).toEqual(
      expect.arrayContaining([
        'qualidade.dispositivo.registrado',
        'qualidade.iras.registrada',
        'qualidade.antimicrobiano.liberado',
        'qualidade.precaucao.definida',
        'qualidade.ccih.lida',
      ]),
    );
    expect(JSON.stringify(a.trilha.eventos)).not.toContain('PACIENTE SINTETICO');
  });
});

describe('chave desligada', () => {
  it('a CCIH fica em consulta: gravar devolve recurso-desligado', async () => {
    const b = await montar({ semChave: true });
    try {
      const s = await b.entrar('SINT.CCIH');
      expect((await b.get(s, '/qualidade/ccih/formulario')).json()).toMatchObject({ ligada: false });
      expect((await b.get(s, '/qualidade/ccih/resumo')).json()).toEqual({
        ligada: false,
        emVigilancia: 0,
        semLiberacao: 0,
      });
      const r = await b.post(s, '/qualidade/ccih/surtos', {
        titulo: 'Surto sintético',
        tipoSurto: null,
        agente: null,
        unidade: 2,
        setor: null,
        inicio: '2026-10-15',
        casos: 1,
        medidas: null,
      });
      expect([r.statusCode, codigo(r)]).toEqual([403, 'recurso-desligado']);
    } finally {
      await b.app.close();
    }
  });
});
