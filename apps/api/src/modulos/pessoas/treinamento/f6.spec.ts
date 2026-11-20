// M52.6 (fatia F6) pela HTTP, com a sessão real sobre a fonte sintética e as portas da gestão de pessoas, da escala, do
// ponto, do SESMT, dos treinamentos e do realizado EM MEMÓRIA (nada conecta a banco; CPF SINTÉTICO):
//   - treinamentos (regra 20): o RH cria o curso obrigatório, publica o POP, abre a turma do POP, inscreve, registra a
//     conclusão (a ciência da versão vai junto) e a situação do painel muda; a versão 2 do POP pede a ciência de novo;
//     quem não tem a permissão não grava;
//   - "Meu espaço" (regra 21): o colaborador vê só o próprio (o pedido de outro vínculo é recusado), os plantões, os
//     treinamentos e POPs pendentes e dá a ciência (a segunda é recusada); o holerite só com a folha; desligada a chave,
//     nada pessoal sai;
//   - plantão realizado (seção 5; DP-33): a coordenação registra, a mesma pessoa não aprova (quatro olhos), outra aprova
//     com o valor pela tarifa; o relatório ao repasse traz só o prestador; o lançamento fica desligado sem a chave e o
//     evento, e com eles lança e liga os realizados; a tela do repasse recusa a origem plantão.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaEscalaMemoria } from '../escala/porta-escala-memoria.js';
import { PortaRealizadoMemoria } from '../escala/porta-realizado-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaPontoMemoria } from '../ponto/porta-ponto-memoria.js';
import { PortaSesmtMemoria } from '../sesmt/porta-sesmt-memoria.js';
import { PortaTreinamentoMemoria } from './porta-treinamento-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave = (c: string, ligada = true): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();
const pessoas = new PortaPessoasMemoria();
pessoas.hojeFixo = '2026-10-26';
const escala = new PortaEscalaMemoria(pessoas);
const ponto = new PortaPontoMemoria(pessoas);
ponto.agoraFixo = '2026-10-26T10:00';
const sesmt = new PortaSesmtMemoria(pessoas);
sesmt.agoraFixo = '2026-10-26T10:00';
const treinamento = new PortaTreinamentoMemoria(pessoas);
treinamento.agoraFixo = '2026-10-26T10:00';
const realizado = new PortaRealizadoMemoria(escala, pessoas);
realizado.agoraFixo = '2026-10-26T10:00';
const C = PESSOAS_SINTETICAS_M52;
const RECURSOS = [
  'pessoas.colaborador',
  'pessoas.escala',
  'pessoas.ponto',
  'pessoas.sesmt',
  'pessoas.treinamento',
  'pessoas.autoatendimento',
  'pessoas.plantaoRealizado',
  'pessoas.repassePlantao',
];
const chaves: ChaveGravada[] = RECURSOS.map((r) => chave(r));
// O evento de repasse do plantão definido (com a chave ligada); o lançamento desligado é provado em servico-f6.spec.
const parametros: { chave: string; valor: string }[] = [
  { chave: 'pessoas.repasse.eventoPlantao', valor: '40' },
];
const cfg = fonteConfiguracaoMemoria(trilha, {
  chavesIniciais: () => chaves,
  prerequisitosIniciais: () => RECURSOS.map(cumprido),
  parametrosIniciais: (hospital) =>
    parametros.map((p, i) => ({
      id: `teste-m52-6-${i}`,
      chave: p.chave,
      nivel: 'estabelecimento' as const,
      alvo: hospital,
      valor: p.valor,
      vigenteDesde: '2026-10-01T00:00:00.000Z',
      vigenteAte: null,
      justificativa: 'Teste sintético da F6',
      autor: 'SINT.ADMIN',
    })),
});

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    pessoas,
    escala,
    ponto,
    sesmt,
    treinamento,
    realizado,
    cifraCpf: new CifraCpf(Buffer.alloc(32, 7)),
    configuracao: cfg,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
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
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
let n = 0;
const pedir = (s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m52-6-teste-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const P = '/api/pessoas';
const T = `${P}/treinamentos`;
const R = `${P}/realizado`;
const ctx = { rede: '', hospital: 'aa' };

let colab = 0;
let outro = 0;
let medico = 0;

async function admitir(
  rh: ReturnType<typeof pedir>,
  cpf: string,
  nome: string,
  tipo: string,
  extra: Record<string, unknown>,
) {
  const pv = await rh.post(`${P}/admissao/previa`, { cpf });
  expect(pv.statusCode).toBe(200);
  const usuario = (pv.json().usuarios[0]?.id as number | undefined) ?? null;
  const adm = await rh.post(`${P}/colaboradores`, {
    cpf,
    nome,
    tipo,
    admissao: '2026-08-01',
    cargo: 'Técnico de enfermagem',
    funcao: null,
    cargaSemanalHoras: 36,
    lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 1' },
    matricula: null,
    profissional: null,
    usuario,
    ...extra,
  });
  expect(adm.statusCode, adm.body).toBe(200);
  return adm.json().id as number;
}

describe('gestão de pessoas, fatia F6, pela HTTP', { timeout: 180_000 }, () => {
  it('admissões (o colaborador com login, outro sem e o médico PJ)', async () => {
    const rh = pedir(await entrar('SINT.RH'));
    colab = await admitir(rh, C.ponto.cpf, 'COLABORADORA SINTETICA DO PONTO', 'clt', { matricula: 'F6-1' });
    outro = await admitir(rh, C.nova.cpf, 'COLABORADOR SINTETICO NOVO', 'clt', { matricula: 'F6-2' });
    medico = await admitir(rh, C.escalaMedico.cpf, 'MEDICO SINTETICO QUATRO', 'pj', {
      cargo: 'Médico plantonista',
      profissional: C.escalaMedico.profissional,
      matricula: 'F6-3',
    });
    expect(colab && outro && medico).toBeTruthy();
  });

  it('treinamentos: curso obrigatório, POP, turma, conclusão com a ciência, painel e a versão 2 (regra 20)', async () => {
    const rh = pedir(await entrar('SINT.RH'));
    const ap = await rh.get(`${T}/apoio`);
    expect(ap.json()).toMatchObject({
      gravacao: { ligada: true },
      acoes: { registrar: true },
      alertaDias: 30,
    });
    const curso = await rh.post(`${T}/cursos`, {
      codigo: 'NR32-BIO',
      titulo: 'Riscos biológicos (NR-32)',
      conteudo: 'Precauções padrão, perfurocortantes e conduta no acidente.',
      categoria: 'nr32',
      cargaMinimaMin: 240,
      validadeMeses: 12,
      obrigatorio: true,
      alvos: [{ tipo: 'unidade', valor: '1' }],
    });
    expect(curso.statusCode, curso.body).toBe(200);
    const idCurso = curso.json().id as number;
    const dup = await rh.post(`${T}/cursos`, {
      codigo: 'NR32-BIO',
      titulo: 'Outro',
      conteudo: 'Conteúdo qualquer sintético.',
      categoria: 'outro',
      cargaMinimaMin: 60,
      validadeMeses: 0,
      obrigatorio: false,
      alvos: [],
    });
    expect(dup.json().codigo).toBe('codigo-repetido');
    // Painel: os três ativos da unidade 1 com o curso pendente.
    const p0 = (await rh.get(`${T}/situacao?situacao=todas`)).json();
    expect(p0.contagem).toMatchObject({ colaboradores: 3, pendentes: 3 });
    const pop = await rh.post(`${T}/pops`, {
      codigo: 'POP-ENF-001',
      titulo: 'Higiene das mãos',
      vigencia: '2026-10-26',
      resumo: 'Os cinco momentos e a técnica de fricção.',
    });
    expect(pop.statusCode, pop.body).toBe(200);
    const idPop = pop.json().id as number;
    const turma = await rh.post(`${T}/turmas`, {
      curso: idCurso,
      inicio: '2026-10-20',
      fim: '2026-10-20',
      cargaMin: 240,
      instrutor: 'INSTRUTORA SINTETICA',
      modalidade: 'presencial',
      pop: idPop,
    });
    expect(turma.statusCode, turma.body).toBe(200);
    const idTurma = turma.json().id as number;
    expect(
      (await rh.post(`${T}/turmas/${idTurma}/inscricoes`, { vinculos: [outro, medico] })).statusCode,
    ).toBe(200);
    expect((await rh.post(`${T}/turmas/${idTurma}/inscricoes`, { vinculos: [outro] })).json().codigo).toBe(
      'ja-inscrito',
    );
    // A conclusão sem presença é recusada; com presença, a ciência da versão vai junto.
    const sem = await rh.post(`${T}/turmas/${idTurma}/participacao`, {
      vinculo: outro,
      presenca: 'inscrito',
      aproveitamento: 'aprovado',
      conclusao: '2026-10-20',
      versao: 0,
    });
    expect(sem.json().codigo).toBe('presenca-obrigatoria');
    const ok = await rh.post(`${T}/turmas/${idTurma}/participacao`, {
      vinculo: outro,
      presenca: 'presente',
      aproveitamento: 'aprovado',
      conclusao: '2026-10-20',
      versao: 0,
    });
    expect(ok.json().mensagem).toContain('ciência do POP');
    const t = (await rh.get(`${T}/turmas/${idTurma}`)).json();
    expect(t.lista.find((x: { vinculo: number }) => x.vinculo === outro)).toMatchObject({
      validoAte: '2027-10-20',
      presenca: 'presente',
    });
    expect((await rh.post(`${T}/turmas/${idTurma}/encerramento`, { versao: 0 })).json().codigo).toBe(
      'presenca-pendente',
    );
    const ficha = (await rh.get(`${T}/colaboradores/${outro}`)).json();
    expect(ficha.cursos[0]).toMatchObject({ situacao: 'valido', validoAte: '2027-10-20' });
    expect(ficha.pops[0]).toMatchObject({ codigo: 'POP-ENF-001', origemCiencia: 'treinamento' });
    const p1 = (await rh.get(`${T}/situacao`)).json();
    expect(p1.itens.map((x: { vinculo: number }) => x.vinculo).sort()).toEqual([colab, medico].sort());
    // A lista de presença (HTML sem o conversor) sem CPF.
    const lista = await rh.get(`${T}/turmas/${idTurma}/lista/pdf`);
    expect(lista.body).toContain('Lista de presença');
    expect(lista.body).not.toContain(C.nova.cpf);
    // Versão 2 do POP: alterações obrigatórias; a ciência é pedida de novo.
    const v2sem = await rh.post(`${T}/pops`, {
      codigo: 'POP-ENF-001',
      titulo: 'Higiene das mãos',
      vigencia: '2026-10-27',
      resumo: 'Os cinco momentos e a técnica de fricção.',
    });
    expect(v2sem.json().codigo).toBe('alteracoes-obrigatorias');
    const v2 = await rh.post(`${T}/pops`, {
      codigo: 'POP-ENF-001',
      titulo: 'Higiene das mãos',
      vigencia: '2026-10-27',
      resumo: 'Os cinco momentos e a técnica de fricção.',
      alteracoes: 'Novo antisséptico padronizado.',
    });
    expect(v2.json().mensagem).toContain('Versão 2');
    const det = (await rh.get(`${T}/pops/POP-ENF-001`)).json();
    expect(det.versoes.map((x: { situacao: string }) => x.situacao)).toEqual(['vigente', 'substituido']);
    expect(det.pendentes).toHaveLength(3);
    const lista2 = (await rh.get(`${T}/pops`)).json();
    expect(lista2.itens[0].adesao).toEqual({ alcancados: 3, cientes: 0, percentual: 0 });
    // Sem a permissão de registrar (o colaborador), nada grava.
    const col = pedir(await entrar('SINT.COLAB.PONTO'));
    expect((await col.post(`${T}/cursos`, { codigo: 'X1' })).statusCode).toBe(403);
    expect((await col.get(`${T}/situacao`)).statusCode).toBe(403);
  });

  it('Meu espaço: só o próprio, plantões, pendências, ciência do POP e o holerite só com a folha (regra 21)', async () => {
    // Um plantão publicado da colaboradora amanhã.
    const v = (await pessoas.vinculo(ctx, colab))!;
    await escala.gravarSgh(ctx, {} as never, async (g) => {
      const es = await g.incluirEscala({
        unidade: 1,
        setor: 'Posto F6',
        competencia: '2026-10',
        tipo: 'enfermagem',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
        por: 'SINT.ESCALA',
      });
      await g.incluirPlantao({
        escala: es,
        vinculo: colab,
        pessoa: v.pessoa,
        profissional: null,
        registro: null,
        tipo: 'presencial',
        inicio: '2026-10-27T07:00',
        fim: '2026-10-27T19:00',
        chegadaMin: null,
        alertaConselho: null,
        redeNaoConferida: false,
        motivo: null,
        por: 'SINT.ESCALA',
      });
      await g.publicarEscala({ id: es, versao: 0, justificativaFuro: null, por: 'SINT.ESCALA' });
    });
    const col = pedir(await entrar('SINT.COLAB.PONTO'));
    const m = (await col.get(`${P}/meu`)).json();
    expect(m.colaborador).toMatchObject({ vinculo: colab, nome: 'COLABORADORA SINTETICA DO PONTO' });
    expect(JSON.stringify(m)).not.toContain(C.ponto.cpf);
    expect(m.plantoes).toEqual([
      expect.objectContaining({ inicio: '2026-10-27T07:00', fim: '2026-10-27T19:00', tipo: 'presencial' }),
    ]);
    expect(m.treinamentos[0]).toMatchObject({ codigo: 'NR32-BIO', situacao: 'pendente' });
    expect(m.pops).toEqual([expect.objectContaining({ codigo: 'POP-ENF-001', versao: 2 })]);
    expect(m.folha).toMatchObject({ disponivel: false });
    expect(m.saude).toMatchObject({ proximoAso: null, asoVencido: true });
    expect(m.indisponiveis).toEqual([]);
    // A leitura que falha não vira "sem plantões" nem "ASO pendente": o bloco sai indisponível e a tela avisa.
    const falha = () => Promise.reject(new Error('banco fora'));
    const orig = { p: escala.plantoesDaPessoa, o: sesmt.ocupacional, b: ponto.saldosBanco };
    escala.plantoesDaPessoa = falha;
    sesmt.ocupacional = falha;
    ponto.saldosBanco = falha;
    try {
      const mf = (await col.get(`${P}/meu`)).json();
      expect([...mf.indisponiveis].sort()).toEqual(['plantoes', 'ponto', 'saude']);
      expect(mf.plantoes).toEqual([]);
      expect(mf.saude.asoVencido).toBe(false);
      expect(mf.pops).toEqual([expect.objectContaining({ codigo: 'POP-ENF-001' })]);
    } finally {
      escala.plantoesDaPessoa = orig.p;
      sesmt.ocupacional = orig.o;
      ponto.saldosBanco = orig.b;
    }
    // O pedido do vínculo de outra pessoa é recusado (nunca cai no primeiro).
    const alheio = await col.get(`${P}/meu?vinculo=${outro}`);
    expect(alheio.statusCode).toBe(403);
    expect(alheio.json().codigo).toBe('so-o-proprio');
    const ci = await col.post(`${P}/meu/pops/${m.pops[0].id}/ciencia`, {});
    expect(ci.statusCode, ci.body).toBe(200);
    expect((await col.post(`${P}/meu/pops/${m.pops[0].id}/ciencia`, {})).json().codigo).toBe('ja-ciente');
    expect((await col.get(`${P}/meu`)).json().pops).toEqual([]);
    // Quem não tem vínculo (o administrador) vê o espaço vazio; o RH não dá a ciência por outra pessoa.
    const rh = pedir(await entrar('SINT.RH'));
    expect((await rh.post(`${P}/meu/pops/${m.pops[0].id}/ciencia`, { vinculo: outro })).json().codigo).toBe(
      'ciencia-so-propria',
    );
    expect(trilha.eventos.some((e) => e.evento === 'pessoas.autoatendimento.lido')).toBe(true);
  });

  it('plantão realizado: registrar, quatro olhos, tarifa, relatório e o lançamento desligado e ligado (seção 5; DP-33)', async () => {
    const v = (await pessoas.vinculo(ctx, medico))!;
    const c = (await pessoas.vinculo(ctx, colab))!;
    const ids = await escala.gravarSgh(ctx, {} as never, async (g) => {
      const es = await g.incluirEscala({
        unidade: 1,
        setor: 'Posto médico',
        competencia: '2026-10',
        tipo: 'medica',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
        por: 'SINT.ESCALA',
      });
      const base = {
        escala: es,
        profissional: null,
        tipo: 'presencial',
        chegadaMin: null,
        alertaConselho: null,
        redeNaoConferida: false,
        motivo: null,
        por: 'SINT.ESCALA',
      };
      const pm = await g.incluirPlantao({
        ...base,
        vinculo: medico,
        pessoa: v.pessoa,
        registro: C.escalaMedico.registro,
        inicio: '2026-10-24T19:00',
        fim: '2026-10-25T07:00',
      });
      const pc = await g.incluirPlantao({
        ...base,
        vinculo: colab,
        pessoa: c.pessoa,
        registro: null,
        inicio: '2026-10-23T07:00',
        fim: '2026-10-23T19:00',
      });
      await g.publicarEscala({ id: es, versao: 0, justificativaFuro: null, por: 'SINT.ESCALA' });
      return { pm, pc };
    });
    const coord = pedir(await entrar('SINT.ESCALA'));
    const ap = (await coord.get(`${R}/apoio`)).json();
    expect(ap.acoes).toMatchObject({ registrar: true, aprovar: true, lancar: false });
    expect(ap.repasse).toEqual({ ligado: true, evento: 40, motivo: null });
    const l0 = (await coord.get(`${R}?competencia=2026-10&situacao=semRealizado`)).json();
    expect(l0.itens.map((x: { plantao: number }) => x.plantao)).toEqual(
      expect.arrayContaining([ids.pm, ids.pc]),
    );
    // Fim no futuro é recusado; o noturno com a passagem é aceito.
    const fut = await coord.post(`${R}/plantoes/${ids.pm}`, {
      inicio: '2026-10-25T06:00',
      fim: '2026-10-26T10:30',
    });
    expect(fut.json().codigo).toBe('fim-futuro');
    const reg = await coord.post(`${R}/plantoes/${ids.pm}`, {
      inicio: '2026-10-24T19:05',
      fim: '2026-10-25T07:20',
    });
    expect(reg.statusCode, reg.body).toBe(200);
    const idReal = reg.json().id as number;
    expect(
      (await coord.post(`${R}/plantoes/${ids.pc}`, { inicio: '2026-10-23T07:00', fim: '2026-10-23T19:00' }))
        .statusCode,
    ).toBe(200);
    // Quatro olhos: quem registrou não aprova.
    expect(
      (await coord.post(`${R}/${idReal}/decisao`, { decisao: 'aprovar', versao: 0 })).json().codigo,
    ).toBe('quatro-olhos');
    // A aprovação por outra pessoa antes de existir a tarifa: aprovado sem valor, fora do repasse até a tarifa.
    const apr = pedir(await entrar('SINT.ESCALA.APROVA'));
    const dec = await apr.post(`${R}/${idReal}/decisao`, { decisao: 'aprovar', versao: 0 });
    expect(dec.json().mensagem).toMatch(/sem tarifa vigente/);
    const rep = pedir(await entrar('SINT.REP.ANALISTA'));
    expect((await rep.get(`${R}/repasse?competencia=2026-10`)).json().grupos).toEqual([]);
    // A tarifa por hora (quem lança no repasse) incluída depois dá o valor ao aprovado que ficou sem.
    const tar = await rep.post(`${R}/tarifas`, { tipo: 'presencial', inicio: '2026-01-01', valorHora: 120 });
    expect(tar.statusCode, tar.body).toBe(200);
    expect(tar.json().mensagem).toMatch(/1 plantão\(ões\) realizado\(s\)/);
    expect(
      (await rep.post(`${R}/tarifas`, { tipo: 'presencial', inicio: '2026-06-01', valorHora: 130 })).json()
        .codigo,
    ).toBe('vigencia-sobreposta');
    const l1 = (await apr.get(`${R}?competencia=2026-10`)).json();
    const linha = l1.itens.find((x: { plantao: number }) => x.plantao === ids.pm);
    expect(linha.realizado).toMatchObject({
      situacao: 'aprovado',
      minutos: 735,
      valor: 1470,
      parcelas: '12 h 15 min × R$ 120,00/h = R$ 1.470,00',
    });
    const realColab = l1.itens.find((x: { plantao: number }) => x.plantao === ids.pc).realizado.id as number;
    expect((await apr.post(`${R}/${realColab}/decisao`, { decisao: 'aprovar', versao: 0 })).statusCode).toBe(
      200,
    );
    // Relatório: só o prestador; o CLT fica fora com o motivo.
    const rel = (await rep.get(`${R}/repasse?competencia=2026-10`)).json();
    expect(rel.grupos).toEqual([
      expect.objectContaining({
        prestador: C.escalaMedico.registro + 9000,
        valor: 1470,
        plantoes: 1,
        minutos: 735,
      }),
    ]);
    expect(rel.foraDoRepasse).toEqual([
      expect.objectContaining({ realizado: realColab, motivo: expect.stringMatching(/folha/) }),
    ]);
    const csv = await rep.get(`${R}/repasse/csv?competencia=2026-10`);
    expect(csv.body).toContain('1470.00');
    // O pedido com outro conjunto de realizados (o relatório mudou) é recusado sem gravar.
    const mudou = await rep.post(`${R}/repasse/lancamento`, {
      competencia: '2026-10',
      prestador: C.escalaMedico.registro + 9000,
      registro: C.escalaMedico.registro,
      realizados: [idReal, realColab],
    });
    expect(mudou.json().codigo).toBe('relatorio-mudou');
    expect(realizado.lancados).toHaveLength(0);
    // Com a chave e o evento: lança e liga o realizado ao lançamento.
    const lanc = await rep.post(`${R}/repasse/lancamento`, {
      competencia: '2026-10',
      prestador: C.escalaMedico.registro + 9000,
      registro: C.escalaMedico.registro,
      realizados: [idReal],
    });
    expect(lanc.statusCode, lanc.body).toBe(200);
    expect(realizado.lancados[0]).toMatchObject({
      origem: 'plantao',
      evento: 40,
      valor: 1470,
      plantoes: [idReal],
    });
    const rel2 = (await rep.get(`${R}/repasse?competencia=2026-10`)).json();
    expect(rel2.grupos).toEqual([]);
    expect(rel2.lancados).toEqual([expect.objectContaining({ realizado: idReal, valor: 1470 })]);
    // A tela do repasse não lança plantão (só pela gestão de pessoas).
    const doRepasse = await rep.post('/api/repasse/lancamentos', {
      origem: 'plantao',
      empresa: 1,
      competencia: '2026-10',
      data: '2026-10-26',
      evento: 40,
      tipo: 'M',
      prestador: 1,
      profissional: 1,
      valor: 10,
      justificativa: 'Tentativa sintética pela tela do repasse',
      plantoes: [idReal],
    });
    expect([403, 409]).toContain(doRepasse.statusCode);
  });

  it('o mesmo prestador com dois registros na competência: dois grupos, cada um lançado sozinho', async () => {
    const v = (await pessoas.vinculo(ctx, medico))!;
    const r1 = C.escalaMedico.registro;
    const r2 = r1 + 1;
    const original = realizado.codigosDosRegistros.bind(realizado);
    // Os dois registros (TBCBOPRO.ID) do mesmo código de prestador (TBCBOPRO.COD).
    realizado.codigosDosRegistros = async (_c, rs) => new Map(rs.map((r) => [r, 7777]));
    try {
      const ids = await escala.gravarSgh(ctx, {} as never, async (g) => {
        const es = await g.incluirEscala({
          unidade: 1,
          setor: 'Posto médico dois registros',
          competencia: '2026-10',
          tipo: 'medica',
          cobertura: { manha: 0, tarde: 0, noite: 0 },
          por: 'SINT.ESCALA',
        });
        const base = {
          escala: es,
          vinculo: medico,
          pessoa: v.pessoa,
          profissional: null,
          tipo: 'presencial',
          chegadaMin: null,
          alertaConselho: null,
          redeNaoConferida: false,
          motivo: null,
          por: 'SINT.ESCALA',
        };
        const a = await g.incluirPlantao({
          ...base,
          registro: r1,
          inicio: '2026-10-20T07:00',
          fim: '2026-10-20T19:00',
        });
        const b = await g.incluirPlantao({
          ...base,
          registro: r2,
          inicio: '2026-10-21T07:00',
          fim: '2026-10-21T19:00',
        });
        await g.publicarEscala({ id: es, versao: 0, justificativaFuro: null, por: 'SINT.ESCALA' });
        return { a, b };
      });
      const coord = pedir(await entrar('SINT.ESCALA'));
      const apr = pedir(await entrar('SINT.ESCALA.APROVA'));
      const rep = pedir(await entrar('SINT.REP.ANALISTA'));
      const reais: number[] = [];
      for (const [p, d] of [
        [ids.a, '2026-10-20'],
        [ids.b, '2026-10-21'],
      ] as const) {
        const reg = await coord.post(`${R}/plantoes/${p}`, { inicio: `${d}T07:00`, fim: `${d}T19:00` });
        expect(reg.statusCode, reg.body).toBe(200);
        reais.push(reg.json().id as number);
        const dec = await apr.post(`${R}/${reg.json().id}/decisao`, { decisao: 'aprovar', versao: 0 });
        expect(dec.statusCode, dec.body).toBe(200);
      }
      const rel = (await rep.get(`${R}/repasse?competencia=2026-10`)).json();
      const grupos = rel.grupos.filter((g: { prestador: number }) => g.prestador === 7777);
      expect(grupos.map((g: { registro: number }) => g.registro).sort()).toEqual([r1, r2].sort());
      // O segundo grupo primeiro: lança só os seus realizados.
      const g2 = grupos.find((g: { registro: number }) => g.registro === r2);
      const l2 = await rep.post(`${R}/repasse/lancamento`, {
        competencia: '2026-10',
        prestador: 7777,
        registro: r2,
        realizados: g2.realizados,
      });
      expect(l2.statusCode, l2.body).toBe(200);
      expect(realizado.lancados.at(-1)).toMatchObject({ profissional: r2, plantoes: [reais[1]] });
      const l1 = await rep.post(`${R}/repasse/lancamento`, {
        competencia: '2026-10',
        prestador: 7777,
        registro: r1,
        realizados: [reais[0]],
      });
      expect(l1.statusCode, l1.body).toBe(200);
      expect(realizado.lancados.at(-1)).toMatchObject({ profissional: r1, plantoes: [reais[0]] });
    } finally {
      realizado.codigosDosRegistros = original;
    }
  });
});
