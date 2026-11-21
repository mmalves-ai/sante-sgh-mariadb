// Revisão do W0-04 (corretor, 18/11/2026), gestão da qualidade e revisão de prontuários pela HTTP, sobre a porta EM
// MEMÓRIA (dados SINTÉTICOS):
//   - a ata assinada retificada: pede a senha, a assinatura sai do texto novo (fica a anterior), a reunião segue sem
//     cancelamento e a nova assinatura passa;
//   - a NC nova não nasce presa a auditoria nem a manifestação canceladas (409 origem-cancelada);
//   - a comissão com checklist vigente ou sorteio em andamento não se inativa nem deixa de ser de prontuário (409 com
//     quantos e quais); a alteração guarda a composição anterior;
//   - a inativação do checklist guarda o motivo próprio e o da publicação fica legível; o retrato vai às versões;
//   - o sorteio com o universo cortado pelo teto é recusado; a conferência devolve `cortada`;
//   - a pendência ao médico é avisada na central (sino) e a do médico sem usuário volta como sem destinatário;
//   - o indicador da ouvidoria por área junta "UTI", "uti" e "U.T.I.".
import { criarAppQualidade } from './teste.spec-util.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { avisoDePendencia, avisarPendenciaNaCentral, LINK_MINHAS_PENDENCIAS } from './central-pendencias.js';
import { PortaCcihMemoria } from './porta-ccih-memoria.js';
import { PortaGestaoMemoria } from './porta-gestao-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-27 12:00 em São Paulo. */
const agora = () => new Date('2026-10-27T15:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}
let app: NestFastifyApplication;
let porta: PortaGestaoMemoria;
let qu: Sessao;
let ou: Sessao;

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
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf },
    payload: payload as object,
  });
const json = <T = Record<string, unknown>>(r: { body: string }) => JSON.parse(r.body) as T;
const codigo = (r: { body: string }) => json<{ codigo?: string }>(r).codigo;
const B = '/qualidade/revisao-prontuarios';

const ALTAS = Array.from({ length: 12 }, (_, i) => ({
  reg: 9_300_000 + i,
  paciente: 9_400_000 + i,
  alta: `2026-09-${String(i + 1).padStart(2, '0')}`,
  clinica: 'Clínica médica',
  // O médico 601 tem usuário; o 602, não (pendência sem destinatário).
  medicoRegistro: i % 2 ? 602 : 601,
  medicoNome: i % 2 ? 'MEDICO SEM USUARIO' : 'MEDICO SINTETICO',
}));

const avisados: string[] = [];

beforeAll(async () => {
  porta = new PortaGestaoMemoria({ agora });
  porta.altasSint.set('2026-09', ALTAS);
  porta.loginsSint.set(601, 'SINT.MEDICO');
  app = await criarAppQualidade(env, {
    trilha: new RegistradorTrilhaMemoria(),
    // A central de avisos de teste (o sino): guarda o login de cada aviso emitido.
    centralAvisos: {
      emitir: (_c, _a, novo) => {
        avisados.push(novo.login);
        return Promise.resolve(avisados.length);
      },
    },
    gestao: porta,
    ccih: new PortaCcihMemoria({ agora }),
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  qu = await entrar('SINT.QUALIDADE');
  ou = await entrar('SINT.OUVIDORIA');
});
afterAll(async () => {
  await app.close();
});

const comissao = (tipo: string, nome: string) => ({
  comissao: null,
  versao: null,
  tipo,
  nome,
  periodicidade: 'mensal',
  membros: [
    { nome: 'Médica sintética', funcao: 'Presidente', login: null },
    { nome: 'Enfermeira sintética', funcao: 'Secretária', login: null },
  ],
  ativa: true,
});

describe('revisão do W0-04: ata assinada retificada', () => {
  it('pede a senha; a assinatura não fica sobre o texto novo; sem cancelamento; a nova assinatura passa', async () => {
    const c = json<{ id: number }>(
      await post(qu, '/qualidade/gestao/comissoes', comissao('ccih', 'CCIH sintética (revisão)')),
    ).id;
    const r = json<{ id: number }>(
      await post(qu, `/qualidade/gestao/comissoes/${String(c)}/reunioes`, {
        tipo: 'ordinaria',
        realizadaEm: '2026-10-20T14:00',
        pauta: 'Indicadores de setembro',
        ata: 'Apresentada a densidade de IPCS; aprovado o reforço do bundle (sintético).',
        versaoComissao: 1,
        presentes: [0],
        convidados: null,
        deliberacoes: null,
      }),
    ).id;
    const ass = await post(qu, `/qualidade/gestao/reunioes/${String(r)}/assinatura`, {
      versao: 1,
      senha: SENHA,
    });
    expect(ass.statusCode, ass.body).toBe(201);
    const corpo = {
      versao: 2,
      pauta: 'Indicadores de setembro',
      ata: 'Texto trocado depois da assinatura: aprovada a compra de cateteres (sintético).',
      presentes: [0, 1],
      convidados: null,
      deliberacoes: 'Compra aprovada',
      justificativa: 'Faltou registrar a deliberação de compra',
    };
    // Sem a senha: a retificação da ata assinada é crítica.
    const semSenha = await post(qu, `/qualidade/gestao/reunioes/${String(r)}/retificacao`, corpo);
    expect(semSenha.statusCode).toBe(401);
    const ret = await post(qu, `/qualidade/gestao/reunioes/${String(r)}/retificacao`, {
      ...corpo,
      senha: SENHA,
    });
    expect(ret.statusCode, ret.body).toBe(201);
    const lida = json<{
      itens: {
        id: number;
        ata: string;
        ataAssinadaEm: string | null;
        ataAssinadaPor: string | null;
        assinaturaAnteriorPor: string | null;
      }[];
    }>(await get(qu, `/qualidade/gestao/comissoes/${String(c)}/reunioes`)).itens.find((x) => x.id === r);
    // O conteúdo novo NÃO aparece como assinado: a assinatura anterior fica à parte.
    expect(lida).toMatchObject({
      ata: corpo.ata,
      ataAssinadaEm: null,
      ataAssinadaPor: null,
      assinaturaAnteriorPor: 'SINT.QUALIDADE',
    });
    // A versão assinada inteira continua no histórico.
    const vs = json<{ itens: { acao: string; dados: { ata: string; ataAssinadaEm: string | null } }[] }>(
      await get(qu, `/qualidade/gestao/versoes/reuniao/${String(r)}`),
    ).itens;
    expect(vs[0]).toMatchObject({ acao: 'retificacao', dados: { ataAssinadaEm: expect.any(String) } });
    // A reunião que já teve ata assinada continua sem cancelamento.
    const can = await post(qu, `/qualidade/gestao/reunioes/${String(r)}/cancelamento`, {
      versao: 3,
      justificativa: 'Tentativa de cancelar depois da retificação',
      senha: SENHA,
    });
    expect([can.statusCode, codigo(can)]).toEqual([409, 'ata-assinada']);
    // A retificada se assina de novo.
    const nova = await post(qu, `/qualidade/gestao/reunioes/${String(r)}/assinatura`, {
      versao: 3,
      senha: SENHA,
    });
    expect(nova.statusCode, nova.body).toBe(201);
  });
});

describe('revisão do W0-04: origem cancelada', () => {
  const nc = (origem: string, idOrigem: number) => ({
    naoConformidade: null,
    versao: null,
    origem,
    idOrigem,
    descricao: 'NC sintética da revisão do W0-04.',
    area: 'UTI',
    classificacao: 'menor',
    acaoImediata: null,
    causa: null,
    plano: null,
    responsavel: null,
    prazo: null,
    situacao: 'aberta',
    eficacia: null,
    eficaciaTexto: null,
  });
  it('a NC nova não nasce presa a auditoria nem a manifestação canceladas', async () => {
    const a = json<{ id: number }>(
      await post(qu, '/qualidade/gestao/auditorias', {
        titulo: 'Auditoria sintética da revisão',
        area: 'UTI',
        referencial: 'interno',
        realizadaEm: '2026-10-20',
        auditores: 'Equipe sintética',
        itens: [{ requisito: 'Pulseira', secao: 'Meta 1', resultado: 'conforme', evidencia: null }],
        conclusao: 'Conclusão sintética.',
      }),
    ).id;
    const ca = await post(qu, `/qualidade/gestao/auditorias/${String(a)}/cancelamento`, {
      versao: 1,
      justificativa: 'Auditoria lançada em duplicidade',
      senha: SENHA,
    });
    expect(ca.statusCode, ca.body).toBe(201);
    const n = await post(qu, '/qualidade/gestao/nao-conformidades', nc('auditoria', a));
    expect([n.statusCode, codigo(n)]).toEqual([409, 'origem-cancelada']);
    const m = json<{ id: number }>(
      await post(ou, '/qualidade/ouvidoria/manifestacoes', {
        canal: 'telefone',
        tipo: 'reclamacao',
        identificada: false,
        paciente: null,
        manifestante: null,
        contato: null,
        area: 'Recepção',
        relato: 'Relato sintético da revisão do W0-04.',
        recebidaEm: '2026-10-26T10:00',
        pesquisa: null,
      }),
    ).id;
    const cm = await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(m)}/cancelamento`, {
      versao: 1,
      justificativa: 'Protocolada em duplicidade',
      senha: SENHA,
    });
    expect(cm.statusCode, cm.body).toBe(201);
    const n2 = await post(qu, '/qualidade/gestao/nao-conformidades', nc('ouvidoria', m));
    expect([n2.statusCode, codigo(n2)]).toEqual([409, 'origem-cancelada']);
  });
});

describe('revisão do W0-04: comissão de revisão de prontuários', () => {
  let com = 0;
  let chk = 0;
  it('com checklist vigente, a comissão não se inativa nem troca de tipo (quantos e quais)', async () => {
    com = json<{ id: number }>(
      await post(qu, '/qualidade/gestao/comissoes', comissao('prontuario', 'Revisão sintética (corretor)')),
    ).id;
    chk = json<{ id: number }>(
      await post(qu, `${B}/checklists`, {
        comissao: com,
        itens: [
          { codigo: 'evolucao-diaria', titulo: 'Evolução diária' },
          { codigo: 'sumario-alta', titulo: 'Sumário de alta' },
        ],
        motivo: 'Inclusão do item de alergia (pedido da diretoria)',
        vigente: null,
      }),
    ).id;
    const base = { ...comissao('prontuario', 'Revisão sintética (corretor)'), comissao: com, versao: 1 };
    const inativa = await post(qu, '/qualidade/gestao/comissoes', {
      ...base,
      ativa: false,
      justificativa: 'Comissão suspensa pela diretoria',
    });
    expect([inativa.statusCode, codigo(inativa)]).toEqual([409, 'com-dependentes']);
    expect(json<{ avisos: string[] }>(inativa).avisos).toEqual([
      `Checklist vigente da revisão de prontuários (inative-o antes) (1): nº ${String(chk)}.`,
    ]);
    const troca = await post(qu, '/qualidade/gestao/comissoes', {
      ...base,
      tipo: 'outra',
      justificativa: 'Comissão passa a ser de outro assunto',
    });
    expect([troca.statusCode, codigo(troca)]).toEqual([409, 'com-dependentes']);
  });

  it('inativar o checklist guarda o motivo próprio; o da publicação fica legível e o retrato vai às versões', async () => {
    const r = await post(qu, `${B}/checklists/${String(chk)}/inativacao`, {
      versao: 1,
      justificativa: 'Comissão suspensa',
    });
    expect(r.statusCode, r.body).toBe(201);
    const [c] = json<{ itens: { motivo: string; motivoInativacao: string; situacao: string }[] }>(
      await get(qu, `${B}/checklists?comissao=${String(com)}`),
    ).itens;
    expect(c).toMatchObject({
      situacao: 'inativa',
      motivo: 'Inclusão do item de alergia (pedido da diretoria)',
      motivoInativacao: 'Comissão suspensa',
    });
    const vs = json<{ itens: { acao: string; motivo: string; dados: { motivo: string } }[] }>(
      await get(qu, `${B}/versoes/checklist-revisao/${String(chk)}`),
    ).itens;
    expect(vs[0]).toMatchObject({
      acao: 'cancelamento',
      motivo: 'Comissão suspensa',
      dados: { motivo: 'Inclusão do item de alergia (pedido da diretoria)' },
    });
    // Sem dependentes, a comissão se inativa (a composição anterior nas versões).
    const ok = await post(qu, '/qualidade/gestao/comissoes', {
      ...comissao('prontuario', 'Revisão sintética (corretor)'),
      comissao: com,
      versao: 1,
      ativa: false,
      justificativa: 'Comissão suspensa pela diretoria',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const vc = json<{ itens: { acao: string }[] }>(
      await get(qu, `/qualidade/gestao/versoes/comissao/${String(com)}`),
    ).itens;
    expect(vc.map((v) => v.acao)).toEqual(['cancelamento']);
  });

  it('sorteio: o universo cortado é recusado; a pendência avisa o médico e a sem usuário volta sem destinatário', async () => {
    const c2 = json<{ id: number }>(
      await post(qu, '/qualidade/gestao/comissoes', comissao('prontuario', 'Revisão sintética 2 (corretor)')),
    ).id;
    await post(qu, `${B}/checklists`, {
      comissao: c2,
      itens: [{ codigo: 'sumario-alta', titulo: 'Sumário de alta' }],
      motivo: null,
      vigente: null,
    });
    porta.cortadaSint = true;
    const cortado = await post(qu, `${B}/sorteios`, {
      comissao: c2,
      competencia: '2026-09',
      quantidade: 4,
      semente: 'SINT-CORTE',
    });
    expect([cortado.statusCode, codigo(cortado)]).toEqual([422, 'universo-cortado']);
    porta.cortadaSint = false;
    const so = json<{ id: number }>(
      await post(qu, `${B}/sorteios`, {
        comissao: c2,
        competencia: '2026-09',
        quantidade: 12,
        semente: 'SINT-C2',
      }),
    ).id;
    porta.cortadaSint = true;
    expect(json<{ cortada: boolean }>(await get(qu, `${B}/sorteios/${String(so)}/conferencia`)).cortada).toBe(
      true,
    );
    porta.cortadaSint = false;
    const ps = json<{ prontuarios: { id: number; medico: string | null }[] }>(
      await get(qu, `${B}/sorteios/${String(so)}`),
    ).prontuarios;
    const comUsuario = ps.find((p) => p.medico === 'MEDICO SINTETICO')!;
    const semUsuario = ps.find((p) => p.medico === 'MEDICO SEM USUARIO')!;
    const naoConforme = {
      versao: 1,
      respostas: [{ item: 'sumario-alta', resultado: 'naoConforme', observacao: 'Sem orientações.' }],
      observacao: null,
      justificativa: null,
    };
    const r1 = await post(qu, `${B}/prontuarios/${String(comUsuario.id)}/revisao`, naoConforme);
    expect(r1.statusCode, r1.body).toBe(201);
    expect(json(r1)).toMatchObject({ avisado: true, semDestinatario: false });
    expect(avisados).toEqual(['SINT.MEDICO']);
    const r2 = await post(qu, `${B}/prontuarios/${String(semUsuario.id)}/revisao`, naoConforme);
    expect(r2.statusCode, r2.body).toBe(201);
    expect(json(r2)).toMatchObject({ avisado: false, semDestinatario: true });
  });
});

describe('revisão do W0-04: aviso da pendência (puro)', () => {
  it('o aviso leva o link de Minhas pendências, sem dado do paciente; sem login ou sem central não emite', async () => {
    const a = avisoDePendencia({ login: 'SINT.MEDICO', prontuario: 7, versao: 2 });
    expect(a).toMatchObject({
      login: 'SINT.MEDICO',
      modulo: 'qualidade',
      link: LINK_MINHAS_PENDENCIAS,
      objetoChave: '7:2',
    });
    const emitidos: unknown[] = [];
    const central = {
      emitir: (_c: unknown, _a: unknown, n: unknown) => {
        emitidos.push(n);
        return Promise.resolve(1);
      },
    };
    const c = { rede: 'r', hospital: 'h' };
    const autor = { login: 'SINT.QUALIDADE', estacao: 'e', correlacao: 'x' };
    expect(await avisarPendenciaNaCentral(central, c, autor, { login: null, prontuario: 7, versao: 2 })).toBe(
      false,
    );
    expect(await avisarPendenciaNaCentral(null, c, autor, { login: 'A', prontuario: 7, versao: 2 })).toBe(
      false,
    );
    expect(await avisarPendenciaNaCentral(central, c, autor, { login: 'A', prontuario: 7, versao: 2 })).toBe(
      true,
    );
    const falha = { emitir: () => Promise.reject(new Error('canal fora')) };
    expect(await avisarPendenciaNaCentral(falha, c, autor, { login: 'A', prontuario: 7, versao: 2 })).toBe(
      false,
    );
    expect(emitidos).toHaveLength(1);
  });
});

describe('revisão do W0-04: ouvidoria por área', () => {
  it('"UTI", "uti" e "U.T.I." caem na mesma área do indicador', async () => {
    for (const area of ['UTI', 'uti', 'U.T.I.'])
      expect(
        (
          await post(ou, '/qualidade/ouvidoria/manifestacoes', {
            canal: 'telefone',
            tipo: 'elogio',
            identificada: false,
            paciente: null,
            manifestante: null,
            contato: null,
            area,
            relato: 'Elogio sintético da equipe da UTI.',
            recebidaEm: '2026-10-26T11:00',
            pesquisa: null,
          })
        ).statusCode,
      ).toBe(201);
    const ind = json<{ porArea: { chave: string; total: number }[] }>(
      await get(ou, '/qualidade/ouvidoria/indicadores?competencia=2026-10'),
    );
    const uti = ind.porArea.filter((g) => /^u\.?t\.?i\.?$/i.test(g.chave));
    expect(uti).toHaveLength(1);
    expect(uti[0]!.total).toBeGreaterThanOrEqual(3);
  });
});
