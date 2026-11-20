// M58 (etapa 1) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o
// painel da prontidão do desligamento (sessões pela tabela de conexões e pela medida diária, inventário com a checklist,
// contas técnicas, plataforma e os três passos bloqueados), o registro de um item com a senha de novo e a trilha, as
// recusas (sem permissão, sem senha, substituto não confirmado, situação pendente) e o cartão da plataforma do banco.
// E o serviço com o registro dos passos ausente e fora do esquema (falha fechada).
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { INVENTARIO_DESLIGAMENTO } from '@sgh/contratos';
import { relatorioEnsaioUtf8Vazio, relatorioEnsaioVazio } from '@sgh/dominio-config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { impressaoHomologada, lerRegistroDesligamento } from './aplicacao/desligamento.js';
import { lerRelatorioEnsaioFirebird5, resumirEnsaioFirebird5 } from './aplicacao/ensaio-firebird5.js';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__');
const RAIZ_FIM = mkdtempSync(join(tmpdir(), 'm58-fim-'));
cpSync(join(FIXTURES, 'fim'), RAIZ_FIM, { recursive: true });
const RAIZ_DESLIG = mkdtempSync(join(tmpdir(), 'm58-deslig-'));
cpSync(join(FIXTURES, 'desligamento'), RAIZ_DESLIG, { recursive: true });
// O ensaio do Firebird 5 (M58-F2) do estabelecimento sintético: o relatório vazio, com o backup e a restauração medidos.
const RAIZ_ENSAIOS = mkdtempSync(join(tmpdir(), 'm58-ensaios-'));
const ENSAIO_AA = relatorioEnsaioVazio(
  'aa',
  '2026-10-26',
  { versaoMotor: '3.0.14', ods: '12.0' },
  { versaoMotor: '5.0.3', ods: '13.1' },
);
ENSAIO_AA.etapas.backup = { ...ENSAIO_AA.etapas.backup, situacao: 'aprovada', segundos: 1800, bytes: 10 };
ENSAIO_AA.etapas['sante-api'] = {
  ...ENSAIO_AA.etapas['sante-api'],
  situacao: 'bloqueada',
  bloqueio: 'equipe-hal-ai',
};
mkdirSync(join(RAIZ_ENSAIOS, 'aa'));
writeFileSync(join(RAIZ_ENSAIOS, 'aa', 'firebird5.json'), JSON.stringify(ENSAIO_AA));
// O ensaio da conversão para UTF-8 (M58-F3): o vazio, com a conversão e a equivalência medidas e um índice estourado.
const UTF8_AA = relatorioEnsaioUtf8Vazio(
  'aa',
  '2026-10-27',
  { versaoMotor: '5.0.3', charset: 'NONE' },
  { versaoMotor: '5.0.3', charset: 'UTF8' },
);
UTF8_AA.etapas.conversao = { ...UTF8_AA.etapas.conversao, situacao: 'aprovada', segundos: 3600, tabelas: 2 };
UTF8_AA.etapas.equivalencia = { ...UTF8_AA.etapas.equivalencia, segundos: 1200 };
UTF8_AA.etapas.indices = {
  ...UTF8_AA.etapas.indices,
  situacao: 'aprovada',
  tamanhoPagina: 8192,
  limiteChave: 2039,
  comTexto: 2,
  estouram: [{ nome: 'IX_GRANDE', tabela: 'T', chaveBytes: 2400, paginaMinima: 16384 }],
  paginaAlvo: 16384,
};
writeFileSync(join(RAIZ_ENSAIOS, 'aa', 'utf8.json'), JSON.stringify(UTF8_AA));
const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  SGH_COEX_FIM: RAIZ_FIM,
  SGH_COEX_DESLIGAMENTO: RAIZ_DESLIG,
  SGH_M58_ENSAIOS: RAIZ_ENSAIOS,
};
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
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
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m58-${++chave}-${Date.now()}` },
    payload: payload as Record<string, unknown>,
  });
const D = '/api/administracao/coexistencia/desligamento';

describe('prontidão do desligamento pela HTTP', { timeout: 60_000 }, () => {
  it('painel: sessões na janela, medida diária sem medida, inventário pendente e os três passos bloqueados', async () => {
    const s = await entrar('SINT.ONDA5');
    const r = await get(s, D);
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.hospital).toBe('aa');
    // A tabela sintética: 12 + 7 + 4 pessoas nos 14 dias; a de 30 dias também tem uso.
    expect(p.sessoes).toMatchObject({
      janelaDias: 14,
      pessoasNaJanela: 23,
      cumprido: false,
      cumpridoCap14: false,
    });
    expect(p.sessoes.diasSemSessao).toBe(1);
    // Em memória não há retrato nem coleta: a medida diária para no primeiro dia (falha fechada).
    expect(p.medidaDiaria).toMatchObject({ diasLimpos: 0, exigidos: 14 });
    expect(p.medidaDiaria.paradaSemMedida).not.toBeNull();
    expect(p.sessoesCumprido).toBe(false);
    expect(p.contasCombinadas).toBe(1);
    expect(p.dp6).toEqual({ decididaEm: null, previstaPara: '2027-03-01' });
    expect(p.fimRegistradoEm).toBeNull();
    expect(p.registroInvalido).toBeNull();
    expect(p.podeRegistrar).toBe(true);
    expect(p.itens.map((i: { item: string }) => i.item)).toEqual(INVENTARIO_DESLIGAMENTO.map((i) => i.id));
    expect(p.itens.every((i: { situacao: string }) => i.situacao === 'pendente')).toBe(true);
    expect(p.contas.declaradas).toHaveLength(28);
    expect(p.contas.naoDeclaradas).toBe(0);
    expect(p.plataforma).toMatchObject({
      versaoMotor: '3.0.14',
      versaoMaior: 3,
      charsetBanco: 'NONE',
      charsetParametro: 'CP1252',
      charsetConfere: true,
    });
    expect(p.plataforma.funcoesExternas.map((f: { nome: string }) => f.nome)).toEqual([
      'LTRIM',
      'RTRIM',
      'STRLEN',
      'SUBSTR',
      'VLR_MED',
    ]);
    expect(p.passos.map((x: { situacao: string }) => x.situacao)).toEqual([
      'bloqueado',
      'bloqueado',
      'bloqueado',
    ]);
    // O ensaio da F1 está aprovado no registro sintético: o primeiro passo fica só com o que a F1 mede e o fim.
    expect(p.passos[0].motivos).toEqual([
      'fim-da-coexistencia-nao-registrado',
      'dp6-sem-data',
      'sessoes-na-janela',
      'inventario-pendente',
    ]);
    // A VLR_MED está resolvida no registro; as quatro da ib_udf seguram a troca do motor.
    expect(p.passos[1].motivos).toEqual([
      'passo-anterior-pendente',
      'funcoes-externas-pendentes',
      'parceiros-nao-avisados',
      'sante-api-sem-contrato',
      'ensaio-nao-aprovado',
    ]);
  });

  it('registrar: com a senha de novo, grava o item com a trilha e o painel mostra resolvido', async () => {
    const s = await entrar('SINT.ONDA5');
    const corpo = {
      situacao: 'substituto-em-uso',
      contingencia: 'reinstalavel-no-periodo',
      papelResponsavel: 'TI do hospital',
      evidencia: 'ata sintética do comitê',
    };
    // Sem a senha: 401 (reautenticação), nada gravado.
    expect((await post(s, `${D}/itens/paineis-tv`, corpo)).statusCode).toBe(401);
    const antes = trilha.eventos.length;
    const r = await post(s, `${D}/itens/paineis-tv`, { ...corpo, senha: SENHA });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ item: 'paineis-tv' });
    const ev = trilha.eventos.slice(antes).find((e) => e.evento === 'coexistencia.desligamento.item');
    expect(ev).toMatchObject({ recurso: 'config.desligamento', tabelaAlvo: 'SGH_CFG_COEX_DESLIG' });
    const item = (await get(s, D)).json().itens.find((i: { item: string }) => i.item === 'paineis-tv');
    expect(item).toMatchObject({
      situacao: 'substituto-em-uso',
      contingencia: 'reinstalavel-no-periodo',
      resolvido: true,
      pendencias: [],
      papelResponsavel: 'TI do hospital',
      evidencia: 'ata sintética do comitê',
    });
    // Trocar o registro do item atualiza a linha (o último vale).
    const r2 = await post(s, `${D}/itens/paineis-tv`, {
      ...corpo,
      situacao: 'aceito-como-perdido',
      contingencia: 'nenhuma',
      senha: SENHA,
    });
    expect(r2.statusCode).toBe(200);
    const depois = (await get(s, D)).json().itens.find((i: { item: string }) => i.item === 'paineis-tv');
    expect(depois).toMatchObject({
      situacao: 'aceito-como-perdido',
      contingencia: 'nenhuma',
      resolvido: true,
    });
  });

  it('recusas: substituto não confirmado ou inexistente, pendente, item fora do inventário, sem permissão', async () => {
    const s = await entrar('SINT.ONDA5');
    const base = {
      contingencia: 'nenhuma',
      papelResponsavel: 'TI do hospital',
      evidencia: 'chamado sintético',
      senha: SENHA,
    };
    const semSubst = await post(s, `${D}/itens/servico-sac-movel`, {
      ...base,
      situacao: 'substituto-em-uso',
    });
    expect(semSubst.statusCode).toBe(409);
    expect(semSubst.json().detail).toContain('não tem substituto');
    const aConfirmar = await post(s, `${D}/itens/servico-autorizador`, {
      ...base,
      situacao: 'substituto-em-uso',
    });
    expect(aConfirmar.statusCode).toBe(409);
    expect(aConfirmar.json().detail).toContain('não foi confirmada');
    // O aceite da área resolve os dois.
    expect(
      (await post(s, `${D}/itens/servico-sac-movel`, { ...base, situacao: 'aceito-como-perdido' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await post(s, `${D}/itens/portal-resultados`, { ...base, situacao: 'pendente' })).statusCode,
    ).toBe(400);
    expect(
      (await post(s, `${D}/itens/nao-existe`, { ...base, situacao: 'aceito-como-perdido' })).statusCode,
    ).toBe(400);
    expect(
      (
        await post(s, `${D}/itens/portal-resultados`, {
          ...base,
          situacao: 'aceito-como-perdido',
          evidencia: 'x',
        })
      ).statusCode,
    ).toBe(400);
    // Dado pessoal na evidência ou no papel: 400 com a orientação, nada gravado.
    const comCpf = await post(s, `${D}/itens/portal-resultados`, {
      ...base,
      situacao: 'aceito-como-perdido',
      evidencia: 'paciente com CPF 123.456.789-09',
    });
    expect(comCpf.statusCode).toBe(400);
    expect(JSON.stringify(comCpf.json())).toContain('sem número de documento, prontuário ou e-mail');
    expect(
      (
        await post(s, `${D}/itens/portal-resultados`, {
          ...base,
          situacao: 'aceito-como-perdido',
          papelResponsavel: 'fulano@exemplo.com',
        })
      ).statusCode,
    ).toBe(400);
    const r = await entrar('SINT.RECEPCAO');
    expect((await get(r, D)).statusCode).toBe(403);
    expect((await get(r, `${D}/plataforma`)).statusCode).toBe(403);
    expect(
      (await post(r, `${D}/itens/portal-resultados`, { ...base, situacao: 'aceito-como-perdido' }))
        .statusCode,
    ).toBe(403);
  });

  it('cartão da plataforma: versão, codificações, funções pendentes para a versão 5, colunas e restrição de entrada', async () => {
    const s = await entrar('SINT.ONDA5');
    const r = await get(s, `${D}/plataforma`);
    expect(r.statusCode).toBe(200);
    const c = r.json();
    expect(c.restricaoEntrada).toBe('cp1252');
    expect(c.funcoesPendentes).toEqual(['LTRIM', 'RTRIM', 'STRLEN', 'SUBSTR']);
    expect(c.indicesComTexto).toBe(1509);
    expect(c.colunasTexto).toContainEqual({ tipo: 'varchar', charset: 'NONE', colunas: 11522 });
    expect(c.plataforma.charsetConfere).toBe(true);
  });

  it('ensaio do Firebird 5: etapas reavaliadas, a bloqueada com o motivo, sem janela sem a restauração', async () => {
    const s = await entrar('SINT.ONDA5');
    const r = await get(s, `${D}/ensaios/firebird5`);
    expect(r.statusCode).toBe(200);
    const e = r.json();
    expect(e).toMatchObject({
      hospital: 'aa',
      relatorio: 'docs/marcos/M58/aa/firebird5.json',
      relatorioInvalido: null,
      ensaiadoEm: '2026-10-26',
      origem: '3.0.14 (ODS 12.0)',
      alvo: '5.0.3 (ODS 13.1)',
      aprovavel: false,
      janelaMinutos: null,
      registro: null,
    });
    expect(e.etapas).toHaveLength(13);
    expect(e.etapas[0]).toEqual({ etapa: 'backup', situacao: 'aprovada', bloqueio: null, achados: [] });
    expect(e.etapas.find((x: { etapa: string }) => x.etapa === 'sante-api')).toMatchObject({
      situacao: 'bloqueada',
      bloqueio: 'equipe-hal-ai',
    });
    const sem = await entrar('SINT.RECEPCAO');
    expect((await get(sem, `${D}/ensaios/firebird5`)).statusCode).toBe(403);
  });

  it('ensaio do UTF-8: etapas reavaliadas, janela pela conversão, índices que pedem página maior', async () => {
    const s = await entrar('SINT.ONDA5');
    const r = await get(s, `${D}/ensaios/utf8`);
    expect(r.statusCode).toBe(200);
    const e = r.json();
    expect(e).toMatchObject({
      hospital: 'aa',
      relatorio: 'docs/marcos/M58/aa/utf8.json',
      relatorioInvalido: null,
      ensaiadoEm: '2026-10-27',
      origem: '5.0.3 (NONE)',
      alvo: '5.0.3 (UTF8)',
      aprovavel: false,
      janelaMinutos: 120,
      paginaAlvo: 16384,
      firebird5Aprovado: false,
      registro: null,
    });
    expect(e.indicesEstourados).toEqual([
      { nome: 'IX_GRANDE', tabela: 'T', chaveBytes: 2400, paginaMinima: 16384 },
    ]);
    expect(e.etapas).toHaveLength(16);
    expect(e.etapas.find((x: { etapa: string }) => x.etapa === 'indices')).toMatchObject({
      situacao: 'aprovada',
    });
    expect(e.etapas.find((x: { etapa: string }) => x.etapa === 'conversao')).toMatchObject({
      situacao: 'aprovada',
    });
    const sem = await entrar('SINT.RECEPCAO');
    expect((await get(sem, `${D}/ensaios/utf8`)).statusCode).toBe(403);
  });
});

describe('relatório do ensaio do Firebird 5 (falha fechada)', () => {
  const registro = lerRegistroDesligamento(mkdtempSync(join(tmpdir(), 'm58-reg5-')), 'pc').registro;

  it('ausente, de outro estabelecimento, fora do esquema ou ilegível: nada aprovável, com o aviso', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'm58-ens-'));
    expect(lerRelatorioEnsaioFirebird5(raiz, 'pc').invalido).toBe('ensaio ainda não executado');
    mkdirSync(join(raiz, 'pc'));
    const r = relatorioEnsaioVazio(
      'hs',
      '2026-10-26',
      { versaoMotor: '3.0.14', ods: '12.0' },
      { versaoMotor: '5.0.3', ods: '13.1' },
    );
    writeFileSync(join(raiz, 'pc', 'firebird5.json'), JSON.stringify(r));
    expect(lerRelatorioEnsaioFirebird5(raiz, 'pc').invalido).toBe('relatório de outro estabelecimento');
    writeFileSync(
      join(raiz, 'pc', 'firebird5.json'),
      JSON.stringify({ ...r, estabelecimento: 'pc', formato: 2 }),
    );
    expect(lerRelatorioEnsaioFirebird5(raiz, 'pc').invalido).toContain('fora do esquema');
    writeFileSync(join(raiz, 'pc', 'firebird5.json'), '{');
    const l = lerRelatorioEnsaioFirebird5(raiz, 'pc');
    expect(l.invalido).toBe('relatório ilegível');
    const s = resumirEnsaioFirebird5('pc', new Date('2026-10-26T12:00:00Z'), l, registro);
    expect(s.aprovavel).toBe(false);
    expect(s.ensaiadoEm).toBeNull();
    expect(s.etapas.every((x) => x.situacao === 'nao-executada')).toBe(true);
  });

  it('janela pelos tempos medidos; "aprovada" sem número que a sustente vira reprovada', () => {
    const r = relatorioEnsaioVazio(
      'pc',
      '2026-10-26',
      { versaoMotor: '3.0.14', ods: '12.0' },
      { versaoMotor: '5.0.3', ods: '13.1' },
    );
    r.etapas.backup = { ...r.etapas.backup, situacao: 'aprovada', segundos: 1200 };
    r.etapas.restauracao = {
      ...r.etapas.restauracao,
      situacao: 'aprovada',
      segundos: 2400,
      verificacaoSegundos: 300,
    };
    r.etapas.contagens = { ...r.etapas.contagens, situacao: 'aprovada', segundos: 300 };
    const s = resumirEnsaioFirebird5(
      'pc',
      new Date('2026-10-26T12:00:00Z'),
      { relatorio: r, invalido: null },
      registro,
    );
    expect(s.janelaMinutos).toBe(105); // (1200 + 2400 + 300 + 300) s × 1,5 = 105 min
    expect(s.etapas.find((x) => x.etapa === 'restauracao')).toMatchObject({
      situacao: 'reprovada',
      achados: ['integridade-nao-verificada'],
    });
    expect(s.etapas.find((x) => x.etapa === 'contagens')?.situacao).toBe('reprovada');
  });
});

describe('registro dos passos e impressão homologada (falha fechada)', () => {
  it('ausente, de outro estabelecimento ou fora do esquema: vazio com o aviso', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'm58-reg-'));
    expect(lerRegistroDesligamento(raiz, 'pc').invalido).toBe('registro dos passos ausente');
    writeFileSync(join(raiz, 'pc.yaml'), 'formato: 1\nestabelecimento: hs\n');
    expect(lerRegistroDesligamento(raiz, 'pc').invalido).toBe('registro de outro estabelecimento');
    writeFileSync(
      join(raiz, 'pc.yaml'),
      "formato: 1\nestabelecimento: pc\npassos:\n  utf8: { execucao: { data: '2027-01-01', referencia: janela } }\n",
    );
    const r = lerRegistroDesligamento(raiz, 'pc');
    expect(r.invalido).toContain('fora do esquema');
    expect(r.registro.passos.utf8.execucao).toBeNull();
    writeFileSync(join(raiz, 'pc.yaml'), 'formato: [');
    expect(lerRegistroDesligamento(raiz, 'pc').invalido).toBe('registro ilegível');
  });

  it('o registro versionado do pc vale e não tem nada registrado (DP-6 no padrão)', () => {
    const r = lerRegistroDesligamento(
      resolve(import.meta.dirname, '../../../../../docs/coexistencia/desligamento'),
      'pc',
    );
    expect(r.invalido).toBeNull();
    expect(Object.values(r.registro.passos).every((p) => !p.autorizacao && !p.ensaio && !p.execucao)).toBe(
      true,
    );
  });

  it('a impressão homologada do pc sai resumida; sem arquivo, null', () => {
    const pasta = resolve(import.meta.dirname, '../../../../../tools/schema-check/homologado');
    expect(impressaoHomologada(pasta, 'pc')).toMatch(/^[0-9a-f]{16}$/);
    expect(impressaoHomologada(pasta, 'zz')).toBeNull();
  });
});
