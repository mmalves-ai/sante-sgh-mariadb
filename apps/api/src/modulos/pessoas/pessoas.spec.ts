// M52.1 (fatia F1) pela HTTP, com a sessão real sobre a fonte sintética e a porta da gestão de pessoas EM MEMÓRIA
// (nada conecta a banco; CPF SINTÉTICO de dígito calculado): com a chave desligada, a tela fica em consulta e as
// gravações dão 403; com a chave ligada (e a conferência do RH cumprida), a prévia pelo CPF reusa o profissional e o
// usuário (regra 1), a admissão, a recusa do vínculo duplicado, a ficha com o CPF mascarado e a legenda "a confirmar"
// (regra 4), a mudança funcional no histórico com a versão, o dependente, a validade do conselho e os alertas
// (regra 3), o desligamento com o bloqueio do usuário no mesmo dia e a sessão derrubada (regra 2), a recusa de data
// futura e do desligamento de si mesmo, o 404 de outro estabelecimento e quem só consulta.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { estadoAcessoSintetico } from '../acesso/fonte-sintetica.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { CifraCpf } from './cifra-cpf.js';
import { cpfSintetico, PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const conferencia: PrerequisitoGravado = {
  recurso: 'pessoas.colaborador',
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};

let ligado: NestFastifyApplication;
let desligado: NestFastifyApplication;
let semChave: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();
const porta = new PortaPessoasMemoria();
porta.hojeFixo = '2026-10-25';

beforeAll(async () => {
  const configuracao = () =>
    fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [chave('pessoas.colaborador')],
      prerequisitosIniciais: () => [conferencia],
    });
  ligado = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    pessoas: porta,
    cifraCpf: new CifraCpf(Buffer.alloc(32, 7)),
    configuracao: configuracao(),
  });
  desligado = await criarApp(lerConfiguracao(env), null, env, { pessoas: new PortaPessoasMemoria() });
  semChave = await criarApp(lerConfiguracao(env), null, env, {
    pessoas: new PortaPessoasMemoria(),
    cifraCpf: null,
    configuracao: configuracao(),
  });
  for (const a of [ligado, desligado, semChave]) {
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
  }
  // Três aplicações (ligada, desligada e sem a chave do CPF): com a VM carregada, a subida passa dos 10 s padrão.
}, 120_000);
afterAll(async () => {
  await ligado.close();
  await desligado.close();
  await semChave.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(app: NestFastifyApplication, login: string, estabelecimento = 'aa'): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento, login, senha: SENHA },
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
const pedir = (app: NestFastifyApplication, s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m52-teste-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const P = '/api/pessoas';
const C = PESSOAS_SINTETICAS_M52;
const admissao = (extra: Record<string, unknown> = {}) => ({
  cpf: C.comLogin.cpf,
  nome: 'ENFERMEIRA SINTETICA UM',
  tipo: 'clt',
  admissao: '2026-10-01',
  cargo: 'Enfermeira assistencial',
  funcao: null,
  cargaSemanalHoras: 36,
  lotacao: { centroCusto: 9521, unidade: 1, setor: 'Clínica médica' },
  matricula: 'SINT-0001',
  profissional: C.comLogin.profissional,
  usuario: null,
  ...extra,
});

describe('gestão de pessoas, fatia F1, pela HTTP', { timeout: 120_000 }, () => {
  it('chave desligada: apoio em consulta e as gravações dão 403', async () => {
    const c = pedir(desligado, await entrar(desligado, 'SINT.RH'));
    const a = await c.get(`${P}/apoio`);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({
      gravacao: { ligada: false },
      acoes: { admitir: false, desligar: false },
    });
    expect(a.json().centrosCusto.map((x: { codigo: number }) => x.codigo)).not.toContain(9529);
    const r = await c.post(`${P}/colaboradores`, admissao());
    expect(r.statusCode).toBe(403);
  });

  it('sem a chave do CPF no cofre: a admissão fica desligada com o motivo', async () => {
    const c = pedir(semChave, await entrar(semChave, 'SINT.RH'));
    const a = (await c.get(`${P}/apoio`)).json();
    expect(a.acoes.admitir).toBe(false);
    expect(a.gravacao.motivo).toMatch(/chave de proteção do CPF/);
    expect((await c.post(`${P}/admissao/previa`, { cpf: C.nova.cpf })).statusCode).toBe(403);
  });

  it('ciclo: prévia (regra 1) → admissão → duplicado → ficha → mudança → dependente → conselho → desligamento (regra 2)', async () => {
    const rh = pedir(ligado, await entrar(ligado, 'SINT.RH'));
    // O colaborador está com a sessão aberta (a regra 2 derruba).
    const colab = await entrar(ligado, 'SINT.COLAB');
    expect((await pedir(ligado, colab).get('/api/sessao')).statusCode).toBe(200);

    const apoio = (await rh.get(`${P}/apoio`)).json();
    expect(apoio).toMatchObject({ gravacao: { ligada: true }, acoes: { admitir: true, desligar: true } });

    const pv = await rh.post(`${P}/admissao/previa`, { cpf: C.comLogin.cpf });
    expect(pv.statusCode).toBe(200);
    const previa = pv.json();
    expect(previa.profissional).toMatchObject({ id: C.comLogin.profissional, registros: 1 });
    expect(previa.usuarios).toEqual([expect.objectContaining({ login: 'SINT.COLAB', bloqueado: false })]);
    expect(JSON.stringify(previa)).not.toContain(C.comLogin.cpf);
    const usuario = previa.usuarios[0].id;

    // A prévia desatualizada (o usuário mudou) é recusada.
    const velho = await rh.post(`${P}/colaboradores`, admissao({ usuario: null }));
    expect(velho.statusCode).toBe(409);
    expect(velho.json().codigo).toBe('previa-desatualizada');
    // Carga acima do teto do CLT (44 h).
    const carga = await rh.post(`${P}/colaboradores`, admissao({ usuario, cargaSemanalHoras: 50 }));
    expect(carga.json().codigo).toBe('carga-acima-do-limite');
    // Centro de custo inativo.
    const cc = await rh.post(
      `${P}/colaboradores`,
      admissao({ usuario, lotacao: { centroCusto: 9529, unidade: null, setor: null } }),
    );
    expect(cc.json().codigo).toBe('centro-custo-inativo');

    const ok = await rh.post(`${P}/colaboradores`, admissao({ usuario }));
    expect(ok.statusCode).toBe(200);
    const vinculo: number = ok.json().id;
    expect(porta.eventos('aa').map((e) => e.tipo)).toContain('PESSOAS_COLABORADOR_ADMITIDO');
    // O mesmo tipo no mesmo centro de custo: recusado; outro vínculo da mesma pessoa (residente) é aceito.
    const dup = await rh.post(`${P}/colaboradores`, admissao({ usuario, matricula: 'SINT-0002' }));
    expect(dup.json().codigo).toBe('vinculo-duplicado');
    const segundo = await rh.post(
      `${P}/colaboradores`,
      admissao({
        usuario,
        matricula: 'SINT-0003',
        tipo: 'pj',
        lotacao: { centroCusto: 9522, unidade: null, setor: null },
      }),
    );
    expect(segundo.statusCode).toBe(200);
    const vinculo2: number = segundo.json().id;
    const mat = await rh.post(
      `${P}/colaboradores`,
      admissao({ cpf: C.nova.cpf, nome: 'PESSOA NOVA SINTETICA', profissional: null, usuario: null }),
    );
    expect(mat.json().codigo).toBe('matricula-em-uso');

    const lista = (await rh.get(`${P}/colaboradores?centroCusto=9521`)).json();
    expect(lista.itens).toEqual([
      expect.objectContaining({ vinculo, estado: 'ativo', conselho: 'semValidade', tipo: 'clt' }),
    ]);
    expect(JSON.stringify(lista)).not.toMatch(/cpf/i);
    // Por unidade e setor (ficha, seção 4), e pelo CPF digitado (filtro exato; o CPF não volta).
    const porUnidade = (await rh.get(`${P}/colaboradores?unidade=1&setor=cl%C3%ADnica`)).json();
    expect(porUnidade.itens.map((x: { vinculo: number }) => x.vinculo)).toEqual([vinculo]);
    expect(porUnidade.itens[0].lotacao).toMatchObject({ unidade: 1, unidadeNome: 'Unidade sintética' });
    const porCpf = (await rh.get(`${P}/colaboradores?estado=todos&termo=${C.comLogin.cpf}`)).json();
    expect(porCpf.itens.map((x: { vinculo: number }) => x.vinculo).sort()).toEqual(
      [vinculo, vinculo2].sort(),
    );
    expect(JSON.stringify(porCpf)).not.toContain(C.comLogin.cpf);

    let ficha = (await rh.get(`${P}/colaboradores/${vinculo}`)).json();
    expect(ficha.cpfMascarado).toBe(`***.***.${C.comLogin.cpf.slice(6, 9)}-${C.comLogin.cpf.slice(9)}`);
    expect(ficha.profissional).toMatchObject({ situacaoLegado: 'F' });
    expect(ficha.profissional.registros[0].unidades).toEqual([
      { codigo: 1, nome: 'Unidade sintética', ativo: true },
    ]);
    expect(ficha.outrosVinculos).toEqual([expect.objectContaining({ vinculo: vinculo2, tipo: 'pj' })]);
    expect(ficha.historico.map((h: { tipo: string }) => h.tipo)).toEqual(['admissao']);
    expect(trilha.eventos.some((l) => l.evento === 'pessoas.colaborador.lido')).toBe(true);

    // Mudança: a versão lida volta; a vigência não vai antes da admissão.
    const antes = await rh.post(`${P}/colaboradores/${vinculo}/mudanca`, {
      versao: ficha.versao,
      vigencia: '2026-09-01',
      cargo: 'Enfermeira supervisora',
      motivo: 'Promoção aprovada pela coordenação',
    });
    expect(antes.json().codigo).toBe('vigencia-anterior');
    const mud = await rh.post(`${P}/colaboradores/${vinculo}/mudanca`, {
      versao: ficha.versao,
      vigencia: '2026-10-20',
      cargo: 'Enfermeira supervisora',
      lotacao: { centroCusto: 9523, unidade: 1, setor: null },
      motivo: 'Promoção aprovada pela coordenação',
    });
    expect(mud.statusCode).toBe(200);
    const velhaVersao = await rh.post(`${P}/colaboradores/${vinculo}/mudanca`, {
      versao: ficha.versao,
      vigencia: '2026-10-21',
      cargo: 'Outro',
      motivo: 'Mudança com a ficha antiga aberta',
    });
    expect(velhaVersao.statusCode).toBe(409);

    const dep = await rh.post(`${P}/colaboradores/${vinculo}/dependentes`, {
      nome: 'FILHO SINTETICO',
      nascimento: '2020-05-10',
      parentesco: '03',
      cpf: cpfSintetico('900520009'),
      dependenteIr: true,
    });
    expect(dep.statusCode).toBe(200);
    // O dependente incluído por engano se encerra (nunca apagado); repetir dá 404; quem só consulta não encerra.
    const engano = await rh.post(`${P}/colaboradores/${vinculo}/dependentes`, {
      nome: 'DEPENDENTE POR ENGANO',
      nascimento: '2019-01-02',
      parentesco: '03',
    });
    const fimUrl = `${P}/colaboradores/${vinculo}/dependentes/${engano.json().id}/encerramento`;
    const fimCorpo = { ate: '2026-10-25', motivo: 'Incluído por engano no cadastro' };
    expect((await rh.post(fimUrl, fimCorpo)).statusCode).toBe(200);
    expect((await rh.post(fimUrl, fimCorpo)).statusCode).toBe(404);
    expect((await rh.post(fimUrl, { ate: '2026-10-25' })).statusCode).toBe(400);
    expect(trilha.eventos.some((l) => l.evento === 'pessoas.dependente.encerrado')).toBe(true);

    // Regra 3: sem validade, a vencer e o alerta.
    let painel = (await rh.get(`${P}/habilitacoes`)).json();
    expect(painel.itens).toEqual([
      expect.objectContaining({ registro: C.comLogin.registro, situacao: 'semValidade' }),
    ]);
    const hab = await rh.post(`${P}/habilitacoes`, {
      registro: C.comLogin.registro,
      validade: '2026-11-30',
      conferidoEm: '2026-10-25',
    });
    expect(hab.statusCode).toBe(200);
    painel = (await rh.get(`${P}/habilitacoes?situacao=aVencer`)).json();
    expect(painel.itens).toEqual([expect.objectContaining({ situacao: 'aVencer', diasParaVencer: 36 })]);
    const alheio = await rh.post(`${P}/habilitacoes`, {
      registro: 1,
      validade: null,
      conferidoEm: '2026-10-25',
    });
    expect(alheio.statusCode).toBe(404);

    ficha = (await rh.get(`${P}/colaboradores/${vinculo}`)).json();
    expect(ficha.cargo).toBe('Enfermeira supervisora');
    expect(ficha.historico.map((h: { tipo: string }) => h.tipo).sort()).toEqual([
      'admissao',
      'cargo',
      'lotacao',
    ]);
    expect(ficha.dependentes).toEqual([
      expect.objectContaining({ nome: 'FILHO SINTETICO', parentesco: '03' }),
    ]);
    expect(ficha.dependentes[0].cpfMascarado).toMatch(/^\*\*\*\.\*\*\*\.\d{3}-\d{2}$/);
    expect(ficha.profissional.registros[0]).toMatchObject({ situacao: 'aVencer', validade: '2026-11-30' });

    // Regra 2: data futura recusada; desligamento sem a senha: 401.
    const futuro = await rh.post(`${P}/colaboradores/${vinculo2}/desligamento`, {
      data: '2026-10-26',
      tipoRescisao: 3,
      motivo: 'Término de contrato sintético',
      senha: SENHA,
    });
    expect(futuro.json().codigo).toBe('data-futura');
    const semSenha = await rh.post(`${P}/colaboradores/${vinculo2}/desligamento`, {
      data: '2026-10-25',
      tipoRescisao: 3,
      motivo: 'Término de contrato sintético',
    });
    expect(semSenha.statusCode).toBe(401);
    // Desligar um vínculo com outro ativo no mesmo estabelecimento mantém o acesso (D-DESL-52).
    const mantido = await rh.post(`${P}/colaboradores/${vinculo2}/desligamento`, {
      data: '2026-10-25',
      tipoRescisao: 3,
      motivo: 'Término de contrato sintético',
      senha: SENHA,
    });
    expect(mantido.statusCode).toBe(200);
    expect(mantido.json().usuarios).toEqual([
      expect.objectContaining({ login: 'SINT.COLAB', acao: 'mantido' }),
    ]);
    expect(estadoAcessoSintetico().bloqueio.get('SINT.COLAB') ?? false).toBe(false);

    // O último vínculo: o usuário é bloqueado no mesmo dia e a sessão cai; nada é apagado.
    const desl = await rh.post(`${P}/colaboradores/${vinculo}/desligamento`, {
      data: '2026-10-25',
      tipoRescisao: 1,
      motivo: 'Pedido de demissão sintético',
      senha: SENHA,
    });
    expect(desl.statusCode).toBe(200);
    expect(desl.json()).toMatchObject({
      vinculo,
      usuarios: [{ login: 'SINT.COLAB', acao: 'bloqueado' }],
    });
    expect(desl.json().sessoesEncerradas).toBeGreaterThanOrEqual(1);
    expect(desl.json().sessoesPendentes).toEqual([]);
    expect(estadoAcessoSintetico().bloqueio.get('SINT.COLAB')).toBe(true);
    expect((await pedir(ligado, colab).get('/api/sessao')).statusCode).toBe(401);
    expect(porta.eventos('aa').map((e) => e.tipo)).toContain('PESSOAS_COLABORADOR_DESLIGADO');
    const de2 = await rh.post(`${P}/colaboradores/${vinculo}/desligamento`, {
      data: '2026-10-25',
      tipoRescisao: 1,
      motivo: 'Pedido de demissão sintético',
      senha: SENHA,
    });
    expect(de2.json().codigo).toBe('ja-desligado');
    ficha = (await rh.get(`${P}/colaboradores/${vinculo}`)).json();
    expect(ficha).toMatchObject({
      estado: 'desligado',
      desligamento: { data: '2026-10-25', tipoRescisao: 1 },
    });
    expect(ficha.usuarios).toEqual([expect.objectContaining({ login: 'SINT.COLAB', bloqueado: true })]);
    // O desligado sai dos alertas.
    expect((await rh.get(`${P}/habilitacoes`)).json().itens).toEqual([]);
  });

  it('ninguém desliga a si mesmo; quem só consulta não grava; outro estabelecimento: 404', async () => {
    const rh = pedir(ligado, await entrar(ligado, 'SINT.RH'));
    const proprio = await rh.post(`${P}/admissao/previa`, { cpf: C.soProfissional.cpf });
    expect(proprio.json().usuarios).toEqual([]);
    const v = (
      await rh.post(
        `${P}/colaboradores`,
        admissao({
          cpf: C.soProfissional.cpf,
          nome: 'TECNICO SINTETICO DOIS',
          matricula: 'SINT-0101',
          profissional: C.soProfissional.profissional,
          usuario: null,
        }),
      )
    ).json().id as number;
    const consulta = pedir(ligado, await entrar(ligado, 'SINT.RH.CONSULTA'));
    expect((await consulta.get(`${P}/colaboradores/${v}`)).statusCode).toBe(200);
    expect((await consulta.post(`${P}/colaboradores/${v}/dependentes`, {})).statusCode).toBe(403);
    expect(
      (
        await consulta.post(`${P}/colaboradores/${v}/desligamento`, {
          data: '2026-10-25',
          tipoRescisao: 1,
          motivo: 'Tentativa sem permissão',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(403);
    const outro = pedir(ligado, await entrar(ligado, 'SINT.RH', 'bb'));
    expect((await outro.get(`${P}/colaboradores/${v}`)).statusCode).toBe(404);
  });

  it('W0-06 (5d-3a): o RH liga o cargo do quadro com motivo; sem motivo 400; quem só consulta 403', async () => {
    const rh = pedir(ligado, await entrar(ligado, 'SINT.RH'));
    const cargo = await rh.post(`${P}/cargos`, {
      nome: 'Técnico de enfermagem',
      cbo: '322205',
      descricao: null,
      requisitos: null,
      conselho: 'COREN',
    });
    expect(cargo.statusCode).toBe(200);
    const idCargo = cargo.json().id as number;
    const v = (
      await rh.post(
        `${P}/colaboradores`,
        admissao({
          cpf: C.nova.cpf,
          nome: 'TECNICO SINTETICO CARGO',
          matricula: 'SINT-0501',
          profissional: null,
          usuario: null,
        }),
      )
    ).json().id as number;
    const versao = (await rh.get(`${P}/colaboradores/${v}`)).json().versao as number;
    const MOTIVO = 'Cargo do quadro conferido com o contrato de trabalho';
    expect((await rh.post(`${P}/colaboradores/${v}/cargo`, { versao, cargo: idCargo })).statusCode).toBe(400);
    const consulta = pedir(ligado, await entrar(ligado, 'SINT.RH.CONSULTA'));
    expect(
      (await consulta.post(`${P}/colaboradores/${v}/cargo`, { versao, cargo: idCargo, motivo: MOTIVO }))
        .statusCode,
    ).toBe(403);
    const r = await rh.post(`${P}/colaboradores/${v}/cargo`, { versao, cargo: idCargo, motivo: MOTIVO });
    expect(r.statusCode).toBe(200);
    const f = (await rh.get(`${P}/colaboradores/${v}`)).json();
    expect(f.cargoQuadro).toMatchObject({
      id: idCargo,
      nome: 'Técnico de enfermagem',
      cbo: '322205',
      ativo: true,
    });
    expect(f.correcoes[0]).toMatchObject({ operacao: 'colaborador.cargo_ligado', motivo: MOTIVO });
    expect(
      (await rh.post(`${P}/colaboradores/${v}/cargo`, { versao, cargo: idCargo, motivo: MOTIVO })).statusCode,
    ).toBe(409);
    expect(
      (await rh.post(`${P}/colaboradores/${v}/cargo`, { versao: f.versao, cargo: 999, motivo: MOTIVO }))
        .statusCode,
    ).toBe(404);
  });
});
