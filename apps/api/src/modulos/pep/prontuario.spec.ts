// M15 pela HTTP, com a sessão real sobre a fonte sintética e as portas do cadastro e do prontuário EM MEMÓRIA
// (nada conecta a banco; registros SINTÉTICOS): busca do paciente; motivo de acesso (sem motivo → 422, regra 11);
// lista com as marcas legais (regra 8) e a exceção "sem conteúdo" (regra 9); as cinco abas de um registro de
// 2021 (sem documento: o formulário da época) e de 2024 (documento emitido, suspenso); filtros; busca de
// palavra; toda leitura na trilha sem conteúdo (regra 10: 3 aberturas = 3 eventos); cada estabelecimento no
// seu banco (regra 14); registro de acesso para o Auditor (e 403 para o médico); exportação em CSV.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaProntuarioMemoria } from './porta-memoria.js';
import { csvAcessos, hash } from './servico.js';
import { criarAppPep } from './teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const prontuario = new PortaProntuarioMemoria(trilha);
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarAppPep(env, {
    trilha,
    cadastro: new PortaCadastroMemoria(),
    prontuario,
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
async function entrar(login: string, estabelecimento = 'aa'): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento, login, senha: SENHA },
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
const motivo = (s: Sessao, paciente: number, m: unknown) =>
  app.inject({
    method: 'POST',
    url: `/api/pep/prontuario/${paciente}/motivo`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf },
    payload: { motivo: m },
  });

const R2021 = 900_001;
const R2022 = 900_002;
const R2023 = 900_003;
const R2024 = 900_004;
const R2026 = 900_006;

describe('prontuário ao vivo (consulta)', () => {
  let medico: Sessao;
  beforeAll(async () => {
    medico = await entrar('SINT.MEDICO');
  });

  it('busca o paciente pela tela do prontuário (mascarada; o termo nunca vai à trilha)', async () => {
    const r = await get(medico, '/api/pep/pacientes?termo=cinthya%20vianna');
    expect(r.statusCode).toBe(200);
    expect(r.json().itens.map((x: { id: number }) => x.id)).toEqual([1003]);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'cadastro.paciente.buscado' });
    expect(JSON.stringify(trilha.eventos.at(-1))).not.toMatch(/cinthya/i);
  });

  it('sem motivo: 422; motivo fora da lista: 422; com motivo: abre e vai à trilha', async () => {
    const sem = await get(medico, '/api/pep/prontuario/1003');
    expect(sem.statusCode).toBe(422);
    expect(sem.json().codigo).toBe('motivo-necessario');
    expect((await get(medico, '/api/pep/prontuario/1003/motivo')).json()).toMatchObject({ motivo: null });
    expect((await motivo(medico, 1003, 'curiosidade')).statusCode).toBe(422);
    const ok = await motivo(medico, 1003, 'assistencia');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ paciente: 1003, motivo: 'assistencia' });
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'pep.motivo.informado', paciente: 1003 });
    expect((await motivo(medico, 9999, 'assistencia')).statusCode).toBe(404);
  });

  it('lista com as marcas legais e a exceção; a abertura é a Consulta do RES (trilha dupla)', async () => {
    const antes = trilha.eventos.length;
    const r = await get(medico, '/api/pep/prontuario/1003');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.cabecalho).toMatchObject({ paciente: 1003, estabelecimento: 'aa' });
    expect(b.itens.map((x: { id: number }) => x.id)).toEqual([900_006, 900_005, R2024, R2023, R2022, R2021]);
    const por = new Map(b.itens.map((x: { id: number }) => [x.id, x]));
    expect(por.get(R2024)).toMatchObject({
      fonteComoEmitido: 'documento',
      marcas: { suspenso: true, justificativaSuspensao: expect.any(String) },
    });
    expect(por.get(R2023)).toMatchObject({ marcas: { corrigeRegistro: R2021 } });
    expect(por.get(R2022)).toMatchObject({ fonteComoEmitido: 'nenhuma', marcas: { semConteudo: true } });
    expect(por.get(R2026)).toMatchObject({
      marcas: { retroativo: true, supervisao: true, semAssinaturaIcp: true },
    });
    expect(por.get(R2021)).toMatchObject({
      fonteComoEmitido: 'layout',
      profissional: { categoria: 'medico' },
    });
    expect(b.excecoes).toEqual({ semConteudo: 1, dataImpossivel: 0 });
    expect(b.modelos.map((m: { codigo: string }) => m.codigo).sort()).toEqual(['ENF091', 'EVAM']);
    // A primeira leitura do paciente na sessão: a Consulta do RES (trilha dupla) e a página (só a própria).
    // (o alerta "fora do horário" depende da hora em que o teste roda: fora da conta)
    const novos = trilha.eventos.slice(antes).filter((e) => e.evento !== 'auditoria.leitura.alertada');
    expect(novos.map((e) => [e.evento, e.legado])).toEqual([
      ['pep.prontuario.lido', true],
      ['pep.prontuario.listado', false],
    ]);
    expect(novos[0]).toMatchObject({ paciente: 1003, recurso: 'pep.prontuario' });
    expect(novos[0]!.chaveNaturalAlvo).toMatch(/^parte:lista;motivo:assistencia;abertura/);
    expect(novos[1]!.chaveNaturalAlvo).toMatch(/^parte:lista;motivo:assistencia;p:1/);
  });

  it('a Consulta do RES vai à trilha do legado uma vez por paciente na sessão (páginas e filtros não)', async () => {
    const s = await entrar('SINT.MEDICO');
    expect((await motivo(s, 1003, 'same')).statusCode).toBe(200);
    const antes = trilha.eventos.length;
    expect((await get(s, '/api/pep/prontuario/1003')).statusCode).toBe(200);
    expect((await get(s, '/api/pep/prontuario/1003?pagina=2')).statusCode).toBe(200);
    expect((await get(s, '/api/pep/prontuario/1003?pagina=3')).statusCode).toBe(200);
    expect((await get(s, '/api/pep/prontuario/1003?categoria=enfermagem')).statusCode).toBe(200);
    expect((await get(s, `/api/pep/prontuario/1003/registros/${R2021}`)).statusCode).toBe(200);
    const novos = trilha.eventos.slice(antes);
    expect(novos.filter((e) => e.legado)).toHaveLength(1);
    expect(novos.filter((e) => e.evento === 'pep.prontuario.lido')).toHaveLength(1);
    expect(novos.filter((e) => e.evento === 'pep.prontuario.listado')).toHaveLength(4);
  });

  it('filtros: categoria, modelo e período', async () => {
    const enf = (await get(medico, '/api/pep/prontuario/1003?categoria=enfermagem')).json();
    expect(enf.itens.map((x: { id: number }) => x.id)).toEqual([900_005, R2022]);
    const per = (await get(medico, '/api/pep/prontuario/1003?de=2021-01-01&ate=2021-12-31')).json();
    expect(per.itens.map((x: { id: number }) => x.id)).toEqual([R2021]);
    expect((await get(medico, '/api/pep/prontuario/1003?modelo=62')).json().itens).toHaveLength(2);
    expect((await get(medico, '/api/pep/prontuario/1003?pagina=x')).statusCode).toBe(400);
    expect((await get(medico, '/api/pep/prontuario/1003?outro=1')).statusCode).toBe(400);
  });

  it('registro de 2021 sem documento: o formulário da época, o texto, as respostas e o contexto', async () => {
    const a = (await get(medico, `/api/pep/prontuario/1003/registros/${R2021}`)).json();
    expect(a.abas).toMatchObject({ 'como-emitido': { disponivel: true }, layout: { disponivel: true } });
    const ce = (await get(medico, `/api/pep/prontuario/1003/registros/${R2021}/como-emitido`)).json();
    expect(ce.conteudo).toMatchObject({
      fonte: 'layout',
      aviso: expect.stringMatching(/não tem o documento emitido/),
    });
    expect(ce.conteudo.blocos[0].titulo).toMatch(/momento do ato/);
    // O layout da época: a pergunta "Conduta" ainda não existia em 2021.
    const l = (await get(medico, `/api/pep/prontuario/1003/registros/${R2021}/layout`)).json();
    expect(l.conteudo.campos.map((c: { titulo: string }) => c.titulo)).toEqual([
      'EVOLUÇÃO MÉDICA',
      'Queixa principal',
      'PA',
      'Dor ao esforço',
    ]);
    const t = (await get(medico, `/api/pep/prontuario/1003/registros/${R2021}/texto`)).json();
    expect(JSON.stringify(t.conteudo.paragrafos)).toContain('Dor torácica há 2 dias, não irradiada');
    const resp = (await get(medico, `/api/pep/prontuario/1003/registros/${R2021}/respostas`)).json();
    const titulos = JSON.stringify(resp.conteudo.itens);
    expect(titulos).toContain('Dor ao esforço');
    expect(
      resp.conteudo.itens[0].itens.find((i: { titulo: string }) => i.titulo === 'Dor ao esforço').valores,
    ).toEqual(['Sim']);
    expect(resp.conteudo.representacao.origem).toBe('convertida');
    const ctx = (await get(medico, `/api/pep/prontuario/1003/registros/${R2021}/contexto`)).json();
    expect(ctx.conteudo).toMatchObject({
      responsavel: { parentesco: 'FILHO' },
      atendimento: { numero: 31337 },
    });
    expect((await get(medico, `/api/pep/prontuario/1003/registros/${R2021}/outra`)).statusCode).toBe(404);
  });

  it('registro de 2024 com documento emitido e suspenso: o cabeçalho congelado sem CPF para o médico', async () => {
    const ce = (await get(medico, `/api/pep/prontuario/1003/registros/${R2024}/como-emitido`)).json();
    expect(ce.conteudo.fonte).toBe('documento');
    expect(ce.conteudo.blocos.map((b: { titulo: string }) => b.titulo)).toContain('Lançamento');
    expect(JSON.stringify(ce.conteudo.blocos)).not.toContain('00000000191');
    expect(ce.conteudo.eventos.map((e: { situacao: string }) => e.situacao)).toEqual(['Lançado', 'Suspenso']);
    expect(ce.conteudo.campos.map((c: { titulo: string }) => c.titulo)).toContain('Conduta');
    const semConteudo = (await get(medico, `/api/pep/prontuario/1003/registros/${R2022}`)).json();
    expect(semConteudo.abas['como-emitido']).toMatchObject({ disponivel: false });
    const ce2 = (await get(medico, `/api/pep/prontuario/1003/registros/${R2022}/como-emitido`)).json();
    expect(ce2.conteudo).toMatchObject({ fonte: 'nenhuma', aviso: expect.stringMatching(/sem conteúdo/) });
  });

  it('toda leitura vai à trilha: 3 aberturas = 3 eventos, sem texto clínico nem nome', async () => {
    const antes = trilha.eventos.filter((e) => e.evento === 'pep.registro.lido').length;
    await get(medico, `/api/pep/prontuario/1003/registros/${R2026}`);
    await get(medico, `/api/pep/prontuario/1003/registros/${R2026}/texto`);
    await get(medico, `/api/pep/prontuario/1003/registros/${R2026}/respostas`);
    const depois = trilha.eventos.filter((e) => e.evento === 'pep.registro.lido');
    expect(depois.length - antes).toBe(3);
    expect(depois.at(-1)).toMatchObject({
      paciente: 1003,
      tabelaAlvo: 'registro_assistencial',
      idAlvo: String(R2026),
      chaveNaturalAlvo: 'parte:respostas;motivo:assistencia',
    });
    const tudo = JSON.stringify(trilha.eventos);
    expect(tudo).not.toMatch(/torácica|CINTHYA|Observação e reavaliação/);
  });

  it('busca de palavra: sem acento; o termo nunca vai à trilha', async () => {
    const r = (await get(medico, '/api/pep/prontuario/1003/busca?termo=toracica')).json();
    expect(r.itens.length).toBeGreaterThan(0);
    expect(r.itens[0].trecho).toMatch(/torácica/);
    const ev = trilha.eventos.at(-1)!;
    expect(ev.evento).toBe('pep.prontuario.buscado');
    expect(JSON.stringify(ev)).not.toMatch(/toracica/i);
    expect((await get(medico, '/api/pep/prontuario/1003/busca?termo=ab')).statusCode).toBe(400);
  });

  it('cada estabelecimento no seu banco: o registro do outro não abre', async () => {
    const outro = await entrar('SINT.MEDICO', 'bb');
    expect((await motivo(outro, 1003, 'assistencia')).statusCode).toBe(200);
    expect((await get(outro, `/api/pep/prontuario/1003/registros/${R2021}`)).statusCode).toBe(404);
    const b = (await get(outro, '/api/pep/prontuario/1003')).json();
    expect(b.cabecalho.estabelecimento).toBe('bb');
    expect(b.itens.every((x: { id: number }) => x.id > 901_000)).toBe(true);
  });

  it('sem a permissão do prontuário: 403 (a recepção)', async () => {
    const recepcao = await entrar('SINT.RECEPCAO');
    expect((await get(recepcao, '/api/pep/prontuario/1003')).statusCode).toBe(403);
  });
});

describe('registro de acesso ao prontuário', () => {
  it('o Auditor vê as leituras (parte e motivo) e exporta; o médico não', async () => {
    const medico = await entrar('SINT.MEDICO');
    expect((await get(medico, '/api/administracao/auditoria/acessos-prontuario')).statusCode).toBe(403);
    const auditor = await entrar('SINT.AUDITOR');
    const r = await get(auditor, '/api/administracao/auditoria/acessos-prontuario?paciente=1003');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.itens.length).toBeGreaterThan(5);
    expect(
      b.itens.some(
        (a: { parte: string; motivo: string }) => a.parte === 'respostas' && a.motivo === 'assistencia',
      ),
    ).toBe(true);
    expect(b.itens.some((a: { registro: number | null }) => a.registro === R2026)).toBe(true);
    expect(JSON.stringify(b)).not.toMatch(/torácica|CINTHYA/);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'auditoria.acessos.consultados' });
    const csv = await get(auditor, '/api/administracao/auditoria/acessos-prontuario/exportar?paciente=1003');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\r\n')[0]).toBe(
      'em;usuario;estacao;paciente;registro;parte;motivo;resultado;origem;alerta',
    );
    expect((await get(auditor, '/api/administracao/auditoria/acessos-prontuario?pagina=0')).statusCode).toBe(
      400,
    );
  });

  it('CSV neutraliza fórmula de planilha e aspas; hash curto estável', () => {
    const c = csvAcessos({
      itens: [
        {
          id: '1',
          em: '2026-10-20T10:00',
          usuario: '=CMD',
          estacao: 'a;b',
          paciente: 1,
          registro: null,
          parte: 'lista',
          motivo: 'x"y',
          resultado: 'sucesso',
          origem: null,
          alerta: { tipo: 'fora-do-horario', criticidade: 4 },
        },
      ],
      pagina: 1,
      porPagina: 100,
      haMais: false,
    });
    expect(c).toContain("'=CMD");
    expect(c).toContain('"a;b"');
    expect(c).toContain('"x""y"');
    expect(c).toContain(';fora-do-horario:4');
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });
});
