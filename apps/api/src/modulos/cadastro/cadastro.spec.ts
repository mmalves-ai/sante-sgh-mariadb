// M11 pela HTTP, com a sessão real sobre a fonte sintética e a porta do cadastro EM MEMÓRIA (nada conecta a
// banco): busca (erro de grafia com sugestão fonética, telefone, nome da mãe, CPF, prontuário), ficha mascarada
// por perfil (recepção sem raça/cor nem religião; registro de acesso na trilha), procurar antes de criar
// (candidatos com nome mascarado), cadastro e alteração (colisão 409 com os campos), linha do tempo, fila de
// duplicidades com "é outra pessoa" e o alerta de homônimo, consentimentos, profissionais (dois conselhos),
// solicitantes (duplicado e incompleto), pessoas e especialidades.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from './porta-memoria.js';
import { montarFicha } from './servico.js';
import { contextoDeTeste, moduloConfiguracaoDeTeste, registroDeTeste } from './teste.spec-util.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,cadastro',
};
const trilha = new RegistradorTrilhaMemoria();
const porta = new PortaCadastroMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: registroDeTeste(
      { cadastro: porta },
      { configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx) },
    ),
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m11-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });

describe('busca de paciente (regra 5)', () => {
  it('por nome sem acento, por palavra; grafia errada vira sugestão fonética; lista mascarada', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const r = await get(s, '/api/cadastros/pacientes?termo=jose%20silva');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.tipo).toBe('nome');
    expect(b.itens.map((x: { id: number }) => x.id).sort()).toEqual([1001, 1002]);
    expect(b.itens[0].cpfMascarado ?? '').not.toMatch(/^9000/);
    expect(JSON.stringify(b)).not.toMatch(/MARIA DA SILVA SINTETICO/);
    const g = (await get(s, '/api/cadastros/pacientes?termo=cintia%20gabriela%20viana')).json();
    expect(g.itens).toEqual([]);
    expect(g.sugestoes.map((x: { id: number }) => x.id)).toEqual([1003]);
    const ev = trilha.eventos.filter((e) => e.evento === 'cadastro.paciente.buscado');
    expect(ev.at(-1)?.chaveNaturalAlvo).toBe('busca:nome;n:0');
    expect(JSON.stringify(ev)).not.toMatch(/cintia/i);
  });
  it('por telefone (8 últimos), nome da mãe, CPF, prontuário e nascimento; termo inválido 400', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const ids = async (q: string) =>
      (await get(s, `/api/cadastros/pacientes?${q}`))
        .json()
        .itens.map((x: { id: number }) => x.id)
        .sort();
    expect(await ids('termo=98765-0003&tipo=telefone')).toEqual([1003]);
    expect(await ids('termo=joana%20conceicao&tipo=mae')).toEqual([1004]);
    expect(await ids('termo=900.000.001-75')).toEqual([1001]);
    expect(await ids('termo=503')).toEqual([1003]);
    expect(await ids('termo=15/03/1980')).toEqual([1001, 1002]);
    expect((await get(s, '/api/cadastros/pacientes?termo=dr')).statusCode).toBe(400);
    expect((await get(s, '/api/cadastros/pacientes?termo=111.111.111-11&tipo=cpf')).json().codigo).toBe(
      'cpf-invalido',
    );
    expect(await ids('termo=pedro%20antigo')).toEqual([]);
    expect(await ids('termo=pedro%20antigo&inativos=sim')).toEqual([1006]);
  });
});

describe('ficha do paciente (regra 9) e registro de acesso', () => {
  it('recepção: documentos sim, raça/cor e religião não; a abertura vai à trilha com o paciente', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const f = (await get(s, '/api/cadastros/pacientes/1001')).json();
    expect(f.documentos).toMatchObject({ cpf: '900.000.001-75', mascarados: false });
    expect(f.sensiveis).toBeNull();
    expect(f.permissoes).toMatchObject({ editar: true, verDocumento: true, verSensivel: false });
    expect(f.clinicoLegado.alergia).toMatch(/DIPIRONA/);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'cadastro.paciente.lido', paciente: 1001 });
    const same = await entrar('SINT.SAME');
    const g = (await get(same, '/api/cadastros/pacientes/1001')).json();
    expect(g.sensiveis?.racaCor?.codigo).toBe(1);
    expect((await get(s, '/api/cadastros/pacientes/9999')).statusCode).toBe(404);
    expect((await get(s, '/api/cadastros/pacientes/abc')).statusCode).toBe(404);
  });
  it('sem a permissão de leitura do cadastro, 403', async () => {
    const s = await entrar('SINT.USUARIO');
    expect((await get(s, '/api/cadastros/pacientes?termo=jose')).statusCode).toBe(403);
  });
});

describe('cadastrar e alterar (regras 1, 2 e colisão)', () => {
  const novo = {
    nome: 'Paciente Novo Sintetico',
    nascimento: '1999-09-09',
    sexo: 'F',
    cpf: '900.000.003-37',
    naturalidade: 'Cidade Sintetica',
    cep: '30130-000',
    celular: '(31) 98888-7777',
  };
  it('procurar antes de criar: candidatos mascarados; CPF repetido é recusado com o caminho', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const c = (await get(s, '/api/cadastros/pacientes/candidatos?cpf=900.000.001-75')).json();
    expect(c.candidatos).toEqual([
      { id: 1001, prontuario: 501, nomeMascarado: 'J*** D*** S*** S***', nascimento: '1980-03-15' },
    ]);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes',
      headers: h(s),
      payload: { ...novo, cpf: '900.000.001-75' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ codigo: 'cpf-existente' });
  });
  it('cadastra, acha pelo nome, altera e recusa a colisão (409 com os campos)', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const r = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes',
      headers: h(s),
      payload: novo,
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().idPaciente as number;
    const busca = (await get(s, '/api/cadastros/pacientes?termo=paciente%20novo')).json();
    expect(busca.itens.map((x: { id: number }) => x.id)).toContain(id);
    const f = (await get(s, `/api/cadastros/pacientes/${id}`)).json();
    const alt = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/pacientes/${id}`,
      headers: h(s),
      payload: { versao: f.versao, alteracoes: { complemento: 'apto 1' } },
    });
    expect(alt.statusCode).toBe(200);
    porta.alterarPorFora('aa', id, { NOME: 'NOME MUDADO NO OUTRO SISTEMA' });
    const col = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/pacientes/${id}`,
      headers: h(s),
      payload: { versao: f.versao, alteracoes: { numero: 5 } },
    });
    expect(col.statusCode).toBe(409);
    expect(col.json().alteracoes.map((x: { campo: string }) => x.campo)).toEqual(
      expect.arrayContaining(['nome', 'versao']),
    );
    const h2 = (await get(s, `/api/cadastros/pacientes/${id}/historico`)).json();
    expect(h2.versoes.length).toBe(2);
    expect(h2.versoes[0].mudancas.map((m: { campo: string }) => m.campo)).toContain('complemento');
    const sem = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/pacientes/${id}`,
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
      payload: { versao: f.versao, alteracoes: { numero: 6 } },
    });
    expect(sem.statusCode).toBe(400);
  });
  it('quem não tem a opção de alterar recebe 403', async () => {
    const s = await entrar('SINT.MEDICO');
    const r = await app.inject({
      method: 'PUT',
      url: '/api/cadastros/pacientes/1001',
      headers: h(s),
      payload: { versao: '{}', alteracoes: { numero: 1 } },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('fila de duplicidades (regras 6 e 7)', () => {
  it('atualiza a fila (CPF primeiro), compara lado a lado e marca "é outra pessoa" com o alerta de homônimo', async () => {
    const s = await entrar('SINT.SAME');
    const a = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes/duplicidades/atualizar',
      headers: h(s),
    });
    expect(a.statusCode).toBe(200);
    expect(a.json().novos).toBeGreaterThanOrEqual(2);
    const fila = (await get(s, '/api/cadastros/pacientes/duplicidades')).json();
    expect(fila.itens[0].criterios).toContain('cpf');
    // M57.2: na sessão sintética a chave cadastro.unificacao está ligada (com o núcleo, a receita segue desligada).
    expect(fila.unificacao.disponivel).toBe(true);
    const par = fila.itens.find((x: { a: { id: number } }) => x.a.id === 1001);
    const um = (await get(s, `/api/cadastros/pacientes/duplicidades/${par.id}`)).json();
    expect(um).toMatchObject({ a: { id: 1001 }, b: { id: 1002 } });
    const d = await app.inject({
      method: 'POST',
      url: `/api/cadastros/pacientes/duplicidades/${par.id}/decisao`,
      headers: h(s),
      payload: { decisao: 'outra_pessoa', justificativa: 'Mães e documentos diferentes' },
    });
    expect(d.statusCode).toBe(200);
    const de_novo = await app.inject({
      method: 'POST',
      url: `/api/cadastros/pacientes/duplicidades/${par.id}/decisao`,
      headers: h(s),
      payload: { decisao: 'outra_pessoa', justificativa: 'Mães e documentos diferentes' },
    });
    expect(de_novo.json().codigo).toBe('par-decidido');
    const busca = (await get(s, '/api/cadastros/pacientes?termo=jose%20silva')).json();
    expect(busca.itens.every((x: { homonimo: boolean }) => x.homonimo)).toBe(true);
    const r = await entrar('SINT.RECEPCAO');
    expect((await get(r, '/api/cadastros/pacientes/duplicidades')).statusCode).toBe(403);
  });
});

describe('unificação de prontuários (M57.2, cadastro.unificarPaciente)', () => {
  it('unifica o par aberto com a senha; o absorvido fica inativo e o par sai da fila; recusas', async () => {
    const s = await entrar('SINT.SAME');
    await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes/duplicidades/atualizar',
      headers: h(s),
    });
    const fila = (await get(s, '/api/cadastros/pacientes/duplicidades')).json();
    expect(fila.unificacao).toMatchObject({ disponivel: true });
    const par = fila.itens[0] as { id: number; a: { id: number }; b: { id: number } };
    expect(par).toBeDefined();
    const url = `/api/cadastros/pacientes/duplicidades/${par.id}/unificar`;
    // Sem a justificativa: 400; sem a senha (sessão real): 401; quem não unifica: 403.
    expect(
      (await app.inject({ method: 'POST', url, headers: h(s), payload: { fica: 'a' } })).statusCode,
    ).toBe(400);
    const semSenha = await app.inject({
      method: 'POST',
      url,
      headers: h(s),
      payload: { fica: 'a', justificativa: 'Mesmo CPF e mesma mãe' },
    });
    expect(semSenha.statusCode).toBe(401);
    const rec = await entrar('SINT.RECEPCAO');
    const negado = await app.inject({
      method: 'POST',
      url,
      headers: h(rec),
      payload: { fica: 'a', justificativa: 'Mesmo CPF e mesma mãe', senha: SENHA },
    });
    expect(negado.statusCode).toBe(403);
    const antes = trilha.eventos.length;
    const ok = await app.inject({
      method: 'POST',
      url,
      headers: h(s),
      payload: { fica: 'b', justificativa: 'Mesmo CPF e mesma mãe', senha: SENHA },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ idAbsorvido: par.a.id, idSobrevivente: par.b.id });
    const ev = trilha.eventos.slice(antes).filter((e) => e.evento === 'cadastro.paciente.unificado');
    expect(ev).toHaveLength(1);
    expect(ev[0]?.idAlvo).toBe(`${par.a.id}>${par.b.id}`);
    // O par saiu da fila aberta; repetir: 409 (par já decidido).
    const depois = (await get(s, '/api/cadastros/pacientes/duplicidades')).json();
    expect(depois.itens.some((x: { id: number }) => x.id === par.id)).toBe(false);
    const repete = await app.inject({
      method: 'POST',
      url,
      headers: h(s),
      payload: { fica: 'b', justificativa: 'Mesmo CPF e mesma mãe', senha: SENHA },
    });
    expect(repete.json().codigo).toBe('par-decidido');
  });

  it('a porta em memória segue as regras da receita: destino inativo e absorvido já unificado recusados', async () => {
    const p = new PortaCadastroMemoria();
    const c = contextoDeTeste('aa', 'sante');
    const ctx = { login: 'SINT.SAME' } as never;
    await p.unificar(c, { idAbsorvido: 1002, idSobrevivente: 1001 }, ctx);
    await expect(p.unificar(c, { idAbsorvido: 1003, idSobrevivente: 1002 }, ctx)).rejects.toThrow(/inativo/);
    await expect(p.unificar(c, { idAbsorvido: 1002, idSobrevivente: 1003 }, ctx)).rejects.toThrow(
      /já foi unificado/,
    );
    await expect(p.unificar(c, { idAbsorvido: 1001, idSobrevivente: 1001 }, ctx)).rejects.toThrow();
  });
});

describe('consentimentos', () => {
  it('registra e revoga; domínios do legado conferidos', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes/1003/consentimentos',
      headers: h(s),
      payload: {
        acao: 'registrar',
        finalidade: 'comunicacao',
        versao: 'v2026.1',
        situacao: 3,
        signatario: 1,
      },
    });
    expect(ok.statusCode).toBe(200);
    const lista = (await get(s, '/api/cadastros/pacientes/1003/consentimentos')).json();
    expect(lista.itens[0]).toMatchObject({ finalidade: 'comunicacao', situacao: { codigo: 3 } });
    const rv = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes/1003/consentimentos',
      headers: h(s),
      payload: { acao: 'revogar', id: ok.json().id, motivo: 2 },
    });
    expect(rv.statusCode).toBe(200);
    const ruim = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes/1003/consentimentos',
      headers: h(s),
      payload: { acao: 'registrar', finalidade: 'comunicacao', versao: 'v1', situacao: 99, signatario: 1 },
    });
    expect(ruim.json().codigo).toBe('situacao-invalida');
  });
});

describe('profissionais, solicitantes, pessoas e especialidades (consulta)', () => {
  it('ficha com dois conselhos; categoria pelo CBO; situação "a confirmar"; sem dado bancário', async () => {
    const s = await entrar('SINT.ADMIN');
    const l = (await get(s, '/api/cadastros/profissionais?termo=bruno')).json();
    expect(l.itens.map((x: { id: number }) => x.id)).toEqual([4]);
    const f = (await get(s, '/api/cadastros/profissionais/4')).json();
    expect(f.registros.map((r: { conselho: string }) => r.conselho)).toEqual(['CRM', 'CRO']);
    expect(f.categoria).toBe('medico');
    expect(f.situacaoLegado).toEqual({ codigo: 'O', aConfirmar: true });
    expect(JSON.stringify(f)).not.toMatch(/AGENCIA|CONTA|REPASSE/i);
    expect((await get(s, '/api/cadastros/profissionais?termo=11111')).json().itens[0].id).toBe(3);
    expect((await get(s, '/api/cadastros/profissionais?ativos=nao')).json().itens).toHaveLength(6);
    expect((await get(s, '/api/cadastros/profissionais')).json().itens).toHaveLength(5);
    const h2 = (await get(s, '/api/cadastros/profissionais/3/historico')).json();
    expect(h2.versoes).toHaveLength(1);
  });
  it('solicitantes com duplicado e incompleto; pessoas por documento; procedimentos paginados; siglas', async () => {
    const s = await entrar('SINT.ADMIN');
    const sol = (await get(s, '/api/cadastros/solicitantes')).json();
    expect(
      sol.itens.filter((x: { duplicado: boolean }) => x.duplicado).map((x: { id: number }) => x.id),
    ).toEqual([1, 2]);
    expect(sol.itens.find((x: { id: number }) => x.id === 3).incompleto).toBe(true);
    const pes = (await get(s, '/api/cadastros/pessoas?documento=11.222.333/0001-81')).json();
    expect(pes.itens[0]).toMatchObject({ tipo: 'J', profissionais: 1 });
    expect((await get(s, '/api/cadastros/pessoas?documento=123')).statusCode).toBe(400);
    const pr = (await get(s, '/api/cadastros/especialidades/1/procedimentos?pagina=2')).json();
    expect(pr).toMatchObject({ pagina: 2, porPagina: 50, total: 60 });
    expect(pr.itens).toHaveLength(10);
    expect((await get(s, '/api/cadastros/conselhos/siglas')).json().itens.length).toBeGreaterThan(0);
  });
});

describe('correções da verificação do M11', () => {
  const c = contextoDeTeste('aa', 'rede-teste');
  const perm = (verDocumento: boolean) => ({
    editar: true,
    verDocumento,
    verSensivel: false,
    lerHistorico: true,
    registrarConsentimento: false,
  });

  it('sem verDocumento, nem a versão opaca leva CPF ou identidade (nada no JSON da ficha)', async () => {
    const f = await montarFicha(porta, c, 1001, perm(false) as never, 'SINT.RECEPCAO');
    expect(f?.documentos.mascarados).toBe(true);
    const json = JSON.stringify(f);
    expect(json).not.toMatch(/90000000175|900\.000\.001-75/);
    const v = JSON.parse(f?.versao ?? '{}') as Record<string, unknown>;
    expect('CPF' in v || 'IDENT' in v).toBe(false);
    // A versão parcial ainda grava (a colisão segue pelo carimbo e pelas outras colunas).
    const s = await entrar('SINT.RECEPCAO');
    const alt = await app.inject({
      method: 'PUT',
      url: '/api/cadastros/pacientes/1001',
      headers: h(s),
      payload: { versao: f?.versao, alteracoes: { complemento: 'casa 2' } },
    });
    expect(alt.statusCode).toBe(200);
    const com = await montarFicha(porta, c, 1001, perm(true) as never, 'SINT.RECEPCAO');
    expect(JSON.parse(com?.versao ?? '{}')).toHaveProperty('CPF');
  });

  it('em produção com a operação só verde, a ficha não oferece Editar e mostra o motivo do executor', async () => {
    // O passo 0 do executor recusa (operação não liberada neste estabelecimento): a ficha esconde "Editar" com o motivo.
    const prod = new PortaCadastroMemoria();
    prod.podeGravar = async () => ({
      pode: false,
      codigo: 'operacao-nao-liberada',
      motivo: 'Esta operação não está liberada para gravar.',
    });
    const f = await montarFicha(prod, c, 1001, perm(true) as never, 'SINT.RECEPCAO');
    expect(f?.gravacao).toMatchObject({ cadastrar: false, alterar: false });
    expect(f?.gravacao.motivo).toBeTruthy();
  });

  it('"Cadastrar paciente": a busca pergunta antes; sem a opção de incluir, o motivo do perfil', async () => {
    const r = await entrar('SINT.RECEPCAO');
    expect((await get(r, '/api/cadastros/pacientes/gravacao')).json()).toEqual({
      cadastrar: { pode: true, motivo: null },
    });
    const same = await entrar('SINT.SAME');
    const g = (await get(same, '/api/cadastros/pacientes/gravacao')).json();
    expect(g.cadastrar.pode).toBe(false);
    expect(g.cadastrar.motivo).toMatch(/perfil/);
  });

  it('endereço pelo CEP antes de salvar; CEP inexistente avisa sem citar o sistema antigo', async () => {
    const s = await entrar('SINT.RECEPCAO');
    const ok = (await get(s, '/api/cadastros/pacientes/cep/30130-000')).json();
    expect(ok).toMatchObject({ cidade: 'BELO HORIZONTE', uf: 'MG' });
    const nao = await get(s, '/api/cadastros/pacientes/cep/99999999');
    expect(nao.statusCode).toBe(404);
    expect(nao.json().detail).not.toMatch(/legado|SPDATA|sistema atual/i);
    expect((await get(s, '/api/cadastros/pacientes/cep/123')).statusCode).toBe(400);
    const cad = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes',
      headers: h(s),
      payload: {
        nome: 'Paciente Cep Sintetico',
        nascimento: '1990-01-01',
        sexo: 'M',
        cpf: '900.000.004-18',
        naturalidade: 'Cidade Sintetica',
        cep: '99999999',
      },
    });
    expect(cad.json().detail).toBe('CEP não encontrado no cadastro de CEPs. Confira o CEP.');
  });

  it('a fila de duplicidades é evento de acesso (só situação e quantidade na trilha)', async () => {
    const s = await entrar('SINT.SAME');
    await get(s, '/api/cadastros/pacientes/duplicidades?situacao=outra_pessoa');
    const ev = trilha.eventos.filter((e) => e.evento === 'cadastro.duplicidade.listada').at(-1);
    expect(ev?.chaveNaturalAlvo).toMatch(/^fila:outra_pessoa;p:1;n:\d+$/);
    expect(JSON.stringify(ev)).not.toMatch(/SINTETICO/);
  });

  it('trilha da porta em memória: estação pelo prefixo (nunca o IP cru)', async () => {
    const s = await entrar('SINT.SAME');
    await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes/duplicidades/atualizar',
      headers: h(s),
    });
    const ev = trilha.eventos.filter((e) => e.evento === 'cadastro.duplicidade.fila').at(-1);
    expect(ev?.estacao).toMatch(/^SGH-WEB:/);
  });

  it('revisão do M39: inclui o solicitante externo (sigla do conselho), recusa o repetido e quem não tem a inclusão', async () => {
    const s = await entrar('SINT.ADMIN');
    const incluir = (x: Sessao, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/cadastros/solicitantes', headers: h(x), payload });
    const corpo = { nome: 'dra solicitante nova sintetica', conselho: 'crm', uf: 'sp', numero: 812345 };
    const r = await incluir(s, corpo);
    expect(r.statusCode).toBe(201);
    const id = r.json().solicitante as number;
    expect(id).toBeGreaterThan(3);
    const achado = (await get(s, '/api/cadastros/solicitantes?numero=812345&conselho=CRM&uf=SP')).json();
    expect(achado.itens).toMatchObject([
      { id, nome: 'DRA SOLICITANTE NOVA SINTETICA', conselho: 'CRM', uf: 'SP' },
    ]);
    expect((await get(s, '/api/cadastros/solicitantes?termo=solicitante%20nova')).json().itens[0].id).toBe(
      id,
    );
    expect(
      trilha.eventos.some((e) => e.evento === 'cadastro.solicitante.cadastrado' && e.idAlvo === String(id)),
    ).toBe(true);
    // Regra 12 do M11: o mesmo conselho, UF e número não entra duas vezes.
    const dup = await incluir(s, { ...corpo, nome: 'OUTRO NOME SINTETICO' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('solicitante-duplicado');
    expect((await incluir(s, { ...corpo, conselho: 'XYZ', numero: 1 })).json().campos).toEqual(['conselho']);
    expect((await incluir(s, { ...corpo, uf: 'S' })).statusCode).toBe(400);
    // Sem a opção de inclusão no gerenciamento de profissionais: 403.
    expect((await incluir(await entrar('SINT.RECEPCAO'), corpo)).statusCode).toBe(403);
  });

  it('profissional e solicitante por conselho + UF + número; telefone do profissional mascarado', async () => {
    const s = await entrar('SINT.ADMIN');
    const sol = (await get(s, '/api/cadastros/solicitantes?numero=70001&conselho=crm&uf=MG')).json();
    expect(sol.itens.map((x: { id: number }) => x.id)).toEqual([1, 2]);
    expect((await get(s, '/api/cadastros/solicitantes?termo=CRM%2070003%20RJ')).json().itens[0].id).toBe(3);
    expect((await get(s, '/api/cadastros/solicitantes?termo=70003/MG')).json().itens).toEqual([]);
    expect((await get(s, '/api/cadastros/profissionais?termo=CRM%2011111')).json().itens[0].id).toBe(3);
    expect((await get(s, '/api/cadastros/profissionais?numero=11111&conselho=CRO')).json().itens).toEqual([]);
    const h2 = (await get(s, '/api/cadastros/profissionais/3/historico')).json();
    const tel = h2.versoes[0].telefones[0].numero as string;
    // SINT.ADMIN não tem verDocumento: mascarado; o SAME (unificação) tem: o número inteiro.
    expect(tel).toBe('(**) *****-0004');
    const same = (await get(await entrar('SINT.SAME'), '/api/cadastros/profissionais/3/historico')).json();
    expect(same.versoes[0].telefones[0].numero).toBe('3133330004');
  });
});
