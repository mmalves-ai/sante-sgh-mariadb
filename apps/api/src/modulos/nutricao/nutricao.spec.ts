// M45, etapa 5 (nutrição, mapa de dietas, acompanhante e serviço social) pela HTTP, com a sessão real sobre a fonte
// sintética e a porta EM MEMÓRIA com o relógio fixo (nada conecta a banco): a fila com a triagem vencida em vermelho, a
// triagem com o total calculado no servidor e a categoria conferida, a meta e o acompanhamento da EMTN com o volume da
// checagem e o motivo abaixo do adequado, o mapa no corte com o jejum do bloco e a alergia, o retrato com o hash visto,
// as etiquetas em ZPL, o acompanhante com direito legal e o serviço social com o sigilo do parecer e a barreira social.
// Cada gravação com o evento na trilha; quem não tem a permissão ou a categoria não grava. Dados sintéticos.
import { EVENTOS_AUDITAVEIS as E } from '@sgh/contratos';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaNutricaoMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
// 25/10/2026 às 15:00 (local): o almoço (11:45, corte 09:45) já passou do corte; a ceia (20:00, corte 18:00), não.
const nutricao = new PortaNutricaoMemoria(() => new Date(2026, 9, 25, 15, 0, 0));
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, nutricao, vigia: null });
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
  'idempotency-key': `teste-m45-5-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const eventos = (codigo: string) => trilha.eventos.filter((l) => l.evento === codigo).length;

const NRS_RISCO = {
  instrumento: 'nrs2002',
  imcAbaixoDe20e5: false,
  perdaDePeso3Meses: true,
  ingestaoReduzidaSemana: true,
  gravementeDoente: false,
  estadoNutricional: 2,
  gravidade: 1,
};

describe('nutrição, mapa de dietas e serviço social (M45, etapa 5)', () => {
  let nutri: Sessao;
  let copa: Sessao;
  let social: Sessao;
  let medico: Sessao;

  beforeAll(async () => {
    nutri = await entrar('SINT.NUTRI.CLINICA');
    copa = await entrar('SINT.COPA');
    social = await entrar('SINT.SOCIAL');
    medico = await entrar('SINT.MEDICO');
  });

  it('a gravação: ligada na sintética; a triagem só da nutricionista; a copa não lê a fila da triagem', async () => {
    const g = await get(nutri, '/nutricao/gravacao');
    expect(g.statusCode, g.body).toBe(200);
    expect(g.json()).toMatchObject({ ligada: true, categoria: 'nutricao' });
    expect(g.json().operacoes.triar.pode).toBe(true);
    const gm = await get(medico, '/nutricao/gravacao');
    expect(gm.json().operacoes.triar).toMatchObject({ pode: false });
    expect(gm.json().operacoes.triar.motivo).toMatch(/nutricionista/);
    expect((await get(copa, '/nutricao/fila')).statusCode).toBe(403);
    const gc = await get(copa, '/nutricao/mapa/gravacao');
    expect(gc.statusCode, gc.body).toBe(200);
    expect(gc.json().operacoes).toMatchObject({
      fecharMapa: { pode: true },
      imprimir: { pode: true },
      acompanhante: { pode: true },
    });
  });

  it('a fila (regra 10): vencidas em vermelho primeiro, atenção e a triar; a terapia intensiva marcada; auditada', async () => {
    const antes = eventos(E.nutricaoFilaLida.codigo);
    const r = await get(nutri, '/nutricao/fila');
    expect(r.statusCode, r.body).toBe(200);
    const f = r.json();
    expect(f.itens.map((i: { internacao: number; situacao: string }) => [i.internacao, i.situacao])).toEqual([
      [950_005, 'vencida'],
      [950_004, 'vencida'],
      [950_001, 'vencida'],
      [950_002, 'atencao'],
      [950_003, 'a-triar'],
    ]);
    expect(f.contagens).toMatchObject({ vencida: 3, atencao: 1, 'a-triar': 1, triado: 0 });
    expect(f.itens.find((i: { internacao: number }) => i.internacao === 950_004).intensiva).toBe(true);
    expect(f.indicadores).toEqual({ admitidos: 4, triados24h: 0, triados48h: 0 });
    expect(eventos(E.nutricaoFilaLida.codigo)).toBe(antes + 1);
    const u = await get(nutri, '/nutricao/fila?unidade=UTI');
    expect(u.json().itens).toHaveLength(1);
  });

  it('a triagem: o total calculado no servidor (com a idade do cadastro), fora do prazo; as recusas', async () => {
    const antes = eventos(E.nutricaoTriagemRegistrada.codigo);
    const r = await post(nutri, '/nutricao/triagens', {
      internacao: 950_001,
      respostas: NRS_RISCO,
      pesoKg: 52,
      alturaCm: 160,
      conduta: 'Suplemento oral e reavaliação',
    });
    expect(r.statusCode, r.body).toBe(201);
    // Estado 2 + gravidade 1 + 1 ponto pelos 78 anos = 4: em risco; 50 h depois da admissão (prazo de 48 h).
    expect(r.json()).toMatchObject({ total: 4, risco: 'risco', dentroDoPrazo: false });
    expect(eventos(E.nutricaoTriagemRegistrada.codigo)).toBe(antes + 1);
    const t = await get(nutri, '/nutricao/internacoes/950001/triagens');
    expect(t.json().itens[0]).toMatchObject({
      total: 4,
      imc: 20.3,
      parcelas: { estado: 2, gravidade: 1, idade: 1 },
    });
    const f = await get(nutri, '/nutricao/fila');
    expect(f.json().itens.find((i: { internacao: number }) => i.internacao === 950_001).situacao).toBe(
      'triado',
    );
    // A triagem final pendente; a categoria; a internação inexistente.
    const pend = await post(nutri, '/nutricao/triagens', {
      internacao: 950_002,
      respostas: { ...NRS_RISCO, estadoNutricional: null },
    });
    expect(pend.statusCode).toBe(409);
    expect(pend.json().codigo).toBe('triagem-final-pendente');
    const cat = await post(social, '/nutricao/triagens', { internacao: 950_002, respostas: NRS_RISCO });
    expect(cat.statusCode).toBe(403);
    expect(cat.json().codigo).toBe('categoria-nao-autorizada');
    expect(
      (await post(copa, '/nutricao/triagens', { internacao: 950_002, respostas: NRS_RISCO })).statusCode,
    ).toBe(403);
    expect(
      (await post(nutri, '/nutricao/triagens', { internacao: 1, respostas: NRS_RISCO })).statusCode,
    ).toBe(404);
    // NUTRIC na terapia intensiva: 71 anos (1), APACHE 22 (2), SOFA 7 (1), 2 comorbidades (1) = 5, alto risco.
    const nutric = await post(nutri, '/nutricao/triagens', {
      internacao: 950_004,
      respostas: { instrumento: 'nutric', apache2: 22, sofa: 7, comorbidades: 2, diasInternadoAntesUti: 0 },
    });
    expect(nutric.json()).toMatchObject({ total: 5, risco: 'alto' });
  });

  it('a terapia (EMTN): a dieta enteral prescrita, a meta, o acompanhamento com o volume da checagem e o motivo', async () => {
    const t = await get(nutri, '/nutricao/terapias/950004');
    expect(t.statusCode, t.body).toBe(200);
    expect(t.json().dietas[0]).toMatchObject({
      itemDieta: 970_004,
      via: 'enteral',
      prescritor: 'nutricionista',
    });
    expect(t.json().checagens.find((c: { data: string }) => c.data === '2026-10-24')).toMatchObject({
      horariosAdministrados: 4,
      volumeMl: 1000,
    });
    expect(t.json().horasAteIniciar).toBeGreaterThan(0);
    const m = await post(nutri, '/nutricao/terapias/metas', {
      internacao: 950_004,
      via: 'enteral',
      itemDieta: 970_004,
      pesoKg: 70,
      kcalPorKg: 25,
      proteinaGPorKg: 1.5,
      densidadeKcalMl: 1.5,
      proteinaGL: 60,
    });
    expect(m.statusCode, m.body).toBe(201);
    expect(m.json().mensagem).toMatch(/1750 kcal/);
    const errada = await post(nutri, '/nutricao/terapias/metas', {
      internacao: 950_004,
      via: 'enteral',
      itemDieta: 123,
      pesoKg: 70,
      kcalPorKg: 25,
      proteinaGPorKg: 1.5,
      densidadeKcalMl: 1.5,
      proteinaGL: 60,
    });
    expect(errada.json().codigo).toBe('dieta-nao-enteral');
    const meta = m.json().id;
    const sem = await post(nutri, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_004,
      meta,
      data: '2026-10-24',
    });
    expect(sem.statusCode).toBe(409);
    expect(sem.json().codigo).toBe('motivo-obrigatorio');
    const ok = await post(nutri, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_004,
      meta,
      data: '2026-10-24',
      motivo: 'progressao',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ pctKcal: 85.7, pctProteina: 57.1 });
    expect(ok.json().mensagem).toMatch(/da checagem/);
    // Hoje a checagem ainda não traz volume: sem o volume informado, recusa; com ele, grava como informado.
    const hoje = await post(nutri, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_004,
      meta,
      data: '2026-10-25',
    });
    expect(hoje.json().codigo).toBe('volume-ausente');
    const informado = await post(nutri, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_004,
      meta,
      data: '2026-10-25',
      volumeInformadoMl: 1750,
    });
    expect(informado.json().mensagem).toMatch(/informado/);
    const outra = await post(nutri, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_001,
      meta,
      data: '2026-10-24',
      volumeInformadoMl: 500,
      motivo: 'intolerancia',
    });
    expect(outra.json().codigo).toBe('meta-de-outra-internacao');
    expect((await post(copa, '/nutricao/terapias/metas', {})).statusCode).toBe(403);
    const lida = await get(nutri, '/nutricao/terapias/950004');
    expect(lida.json().metas).toHaveLength(1);
    expect(lida.json().acompanhamentos).toHaveLength(2);
  });

  it('o mapa no corte (regras 11 e 12): jejum do bloco, alergia, o retrato pelo hash visto, nunca regravado', async () => {
    const o = await get(copa, '/nutricao/mapa/opcoes');
    expect(o.statusCode, o.body).toBe(200);
    expect(o.json().refeicoes.find((r: { codigo: number }) => r.codigo === 2)).toMatchObject({
      horario: '11:45',
      corte: '09:45',
    });
    const r = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=2&data=2026-10-25');
    expect(r.statusCode, r.body).toBe(200);
    const m = r.json();
    expect(m.passouDoCorte).toBe(true);
    expect(m.linhas.map((l: { internacao: number; tipo: string }) => [l.internacao, l.tipo])).toEqual([
      [950_001, 'oral'],
      [950_002, 'jejum'],
      [950_003, 'livre'],
      [950_005, 'oral'],
    ]);
    const joao = m.linhas.find((l: { internacao: number }) => l.internacao === 950_002);
    expect(joao.jejum).toMatchObject({ origem: 'cirurgia', procedimentoEm: '2026-10-25T13:30' });
    expect(joao.dieta).toBe('DIETA ORAL');
    expect(m.linhas[0].alergiasAlimentares).toEqual(['Leite']);
    expect(m.contagens).toMatchObject({ jejum: 1, oral: 2, livre: 1 });
    expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(eventos(E.mapaDietaLido.codigo)).toBeGreaterThan(0);
    const mudou = await post(copa, '/nutricao/mapa/fechar', {
      unidade: '2A',
      refeicao: 2,
      data: '2026-10-25',
      hashVisto: 'a'.repeat(64),
    });
    expect(mudou.json().codigo).toBe('mapa-mudou');
    const antes = eventos(E.mapaDietaFechado.codigo);
    const f = await post(copa, '/nutricao/mapa/fechar', {
      unidade: '2A',
      refeicao: 2,
      data: '2026-10-25',
      hashVisto: m.hash,
    });
    expect(f.statusCode, f.body).toBe(201);
    expect(eventos(E.mapaDietaFechado.codigo)).toBe(antes + 1);
    const de_novo = await post(copa, '/nutricao/mapa/fechar', {
      unidade: '2A',
      refeicao: 2,
      data: '2026-10-25',
      hashVisto: m.hash,
    });
    expect(de_novo.json().codigo).toBe('mapa-ja-fechado');
    const fechado = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=2&data=2026-10-25');
    expect(fechado.json().retrato).toMatchObject({ itens: 4, jejuns: 1, hash: m.hash });
    expect(fechado.json().alertas).toEqual([]);
    const ceia = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=6&data=2026-10-25');
    const cedo = await post(copa, '/nutricao/mapa/fechar', {
      unidade: '2A',
      refeicao: 6,
      data: '2026-10-25',
      hashVisto: ceia.json().hash,
    });
    expect(cedo.json().codigo).toBe('antes-do-corte');
    expect((await get(copa, '/nutricao/mapa?unidade=XX&refeicao=2&data=2026-10-25')).statusCode).toBe(404);
    expect((await get(copa, '/nutricao/mapa?unidade=2A&refeicao=99&data=2026-10-25')).statusCode).toBe(404);
    expect((await get(copa, '/nutricao/mapa?unidade=2A&refeicao=2&data=hoje')).statusCode).toBe(400);
  });

  it('as etiquetas de bandeja (ZPL): dois identificadores e a alergia; o jejum não tem bandeja; na trilha', async () => {
    const antes = eventos(E.etiquetaBandejaImpressa.codigo);
    const r = await post(copa, '/nutricao/mapa/etiquetas', {
      unidade: '2A',
      refeicao: 2,
      data: '2026-10-25',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ formato: 'zpl', etiquetas: 3, semBandeja: 1, semIdentificador: 0 });
    expect(r.json().conteudo).toContain('MARIA SINTETICA DA SILVA');
    expect(r.json().conteudo).toContain('NASC. 07/03/1948');
    expect(r.json().conteudo).toContain('ALERGIA ALIMENTAR: LEITE');
    expect(r.json().conteudo).not.toContain('JOAO SINTETICO');
    expect(eventos(E.etiquetaBandejaImpressa.codigo)).toBe(antes + 1);
    const uma = await post(copa, '/nutricao/mapa/etiquetas', {
      unidade: '2A',
      refeicao: 2,
      data: '2026-10-25',
      internacoes: [950_003],
    });
    expect(uma.json().etiquetas).toBe(1);
  });

  it('o acompanhante só com direito legal; uma vigente; o encerramento; aparece no mapa', async () => {
    const semDireito = await post(copa, '/nutricao/acompanhantes', {
      internacao: 950_002,
      baseLegal: 'idoso',
      refeicoes: [2],
      inicio: '2026-10-25',
    });
    expect(semDireito.json().codigo).toBe('sem-direito-legal');
    const ok = await post(copa, '/nutricao/acompanhantes', {
      internacao: 950_001,
      baseLegal: 'idoso',
      refeicoes: [1, 2, 5],
      inicio: '2026-10-25',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const dup = await post(copa, '/nutricao/acompanhantes', {
      internacao: 950_001,
      baseLegal: 'idoso',
      refeicoes: [2],
      inicio: '2026-10-25',
    });
    expect(dup.json().codigo).toBe('acompanhante-vigente');
    const mapa = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=5&data=2026-10-25');
    expect(mapa.json().acompanhantes).toBe(1);
    expect((await get(copa, '/nutricao/acompanhantes/950001')).json().itens).toHaveLength(1);
    const enc = await post(copa, `/nutricao/acompanhantes/${ok.json().id}/encerrar`, {
      motivo: 'Alta do paciente',
    });
    expect(enc.statusCode, enc.body).toBe(200);
    const enc2 = await post(copa, `/nutricao/acompanhantes/${ok.json().id}/encerrar`, {
      motivo: 'Alta do paciente',
    });
    expect(enc2.json().codigo).toBe('acompanhante-desatualizado');
    expect(
      (await post(copa, '/nutricao/acompanhantes/9999/encerrar', { motivo: 'Alta do paciente' })).statusCode,
    ).toBe(404);
  });

  it('o serviço social: a barreira social no NIR, o parecer só para a categoria (sigilo), o risco nunca abaixo', async () => {
    const corpo = {
      internacao: 950_001,
      tipo: 'avaliacao',
      redeApoio: 'fragil',
      vulnerabilidades: ['idoso-sozinho', 'transporte'],
      risco: 'medio',
      encaminhamentos: ['cras-creas', 'familia'],
      parecer: 'Parecer social sintético: mora sozinha, sem cuidador para a alta.',
      orientacoes: 'Avisar o serviço social antes da alta.',
      barreira: { descricao: 'Sem cuidador para a alta', responsavel: 'Serviço social', prazo: '2026-10-28' },
    };
    const baixo = await post(social, '/servico-social/registros', { ...corpo, risco: 'baixo' });
    expect(baixo.json().codigo).toBe('risco-abaixo-do-calculado');
    const antes = eventos(E.avaliacaoSocialRegistrada.codigo);
    const r = await post(social, '/servico-social/registros', corpo);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().barreira).not.toBeNull();
    expect(eventos(E.avaliacaoSocialRegistrada.codigo)).toBe(antes + 1);
    const daCategoria = await get(social, '/servico-social/internacoes/950001');
    expect(daCategoria.json()).toMatchObject({ daCategoria: true });
    expect(daCategoria.json().registros[0]).toMatchObject({ sigilo: false, risco: 'medio' });
    expect(daCategoria.json().registros[0].parecer).toMatch(/mora sozinha/);
    expect(daCategoria.json().barreiras[0]).toMatchObject({ tipo: 'social', vencida: false });
    const equipe = await get(nutri, '/servico-social/internacoes/950001');
    expect(equipe.json().daCategoria).toBe(false);
    expect(equipe.json().registros[0]).toMatchObject({ sigilo: true, parecer: null });
    expect(equipe.json().registros[0].orientacoes).toMatch(/antes da alta/);
    const naoSocial = await post(nutri, '/servico-social/registros', corpo);
    expect(naoSocial.json().codigo).toBe('categoria-nao-autorizada');
    expect((await post(copa, '/servico-social/registros', corpo)).statusCode).toBe(403);
    const fila = await get(social, '/servico-social/fila');
    expect(fila.json().itens.find((i: { internacao: number }) => i.internacao === 950_001)).toMatchObject({
      barreirasSociais: 1,
      ultima: { risco: 'medio' },
    });
    const g = await get(social, '/servico-social/gravacao');
    expect(g.json()).toMatchObject({ ligada: true, categoria: 'servico-social' });
    expect((await get(nutri, '/servico-social/gravacao')).json().operacoes.registrar.pode).toBe(false);
  });

  it('correções da revisão: o Salvar da evolução (4581) não fecha nem imprime; a janela do fechamento', async () => {
    // A assistente social tem a 4581 (o Salvar da evolução) e não opera a copa: o retrato é irreversível.
    const corpoMapa = { unidade: '2A', refeicao: 3, data: '2026-10-24', hashVisto: 'a'.repeat(64) };
    expect((await post(social, '/nutricao/mapa/fechar', corpoMapa)).statusCode).toBe(403);
    expect(
      (await post(social, '/nutricao/mapa/etiquetas', { unidade: '2A', refeicao: 3, data: '2026-10-24' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post(social, '/nutricao/acompanhantes', {
          internacao: 950_001,
          baseLegal: 'idoso',
          refeicoes: [2],
          inicio: '2026-10-25',
        })
      ).statusCode,
    ).toBe(403);
    // O lanche de anteontem (servido 23/10 às 14:45; a tolerância é de 24 h): o censo de agora não é o do corte.
    const velho = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=3&data=2026-10-23');
    expect(velho.json().fechamentoAte).toBe('2026-10-24T14:45');
    const fora = await post(copa, '/nutricao/mapa/fechar', {
      unidade: '2A',
      refeicao: 3,
      data: '2026-10-23',
      hashVisto: velho.json().hash,
    });
    expect(fora.statusCode).toBe(409);
    expect(fora.json().codigo).toBe('fora-da-janela');
    // O lanche de ontem (servido 24/10 às 14:45) fechava até hoje às 14:45; agora são 15:00.
    const ontem = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=3&data=2026-10-24');
    const f2 = await post(copa, '/nutricao/mapa/fechar', {
      unidade: '2A',
      refeicao: 3,
      data: '2026-10-24',
      hashVisto: ontem.json().hash,
    });
    expect(f2.json().codigo).toBe('fora-da-janela');
  });

  it('correções da revisão: o internado sem atendimento entra no mapa; quem sai da unidade depois do retrato alerta', async () => {
    try {
      nutricao.semAtendimento.add(950_003);
      const r = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=1&data=2026-10-25');
      expect(r.statusCode, r.body).toBe(200);
      const m = r.json();
      expect(m.cortada).toBe(false);
      const sem = m.linhas.find((l: { internacao: number }) => l.internacao === 950_003);
      expect(sem).toMatchObject({ tipo: 'sem-prescricao', leito: { bloco: '2A' } });
      expect(m.contagens['sem-prescricao']).toBe(1);
      const f = await post(copa, '/nutricao/mapa/fechar', {
        unidade: '2A',
        refeicao: 1,
        data: '2026-10-25',
        hashVisto: m.hash,
      });
      expect(f.statusCode, f.body).toBe(201);
      expect(f.json().mensagem).toMatch(/4 internado/);
      // A alta (ou transferência) de 950.005 depois do fechamento: o alerta à copa, com o leito do retrato.
      nutricao.sairam.add(950_005);
      const depois = (await get(copa, '/nutricao/mapa?unidade=2A&refeicao=1&data=2026-10-25')).json();
      expect(depois.retrato).toMatchObject({ itens: 4 });
      expect(depois.alertas).toEqual([
        expect.objectContaining({ internacao: 950_005, agora: expect.stringMatching(/Saiu da unidade/) }),
      ]);
      expect(depois.alertas[0].leito.acomodacao).not.toBe('');
    } finally {
      nutricao.semAtendimento.clear();
      nutricao.sairam.clear();
    }
  });
});
