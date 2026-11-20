// M59 (etapa 6) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o
// painel da retrocompatibilidade (condições, decisão vigente, passos do plano com o tamanho, retiradas) e a recusa sem
// a permissão. E o serviço: extinção sem as condições vale mantida (falha fechada), extinção com as condições destrava
// o primeiro passo, registro ausente/fora do esquema/de outro hospital, cache e falha do catálogo.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PASSOS_EVOLUCAO } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import {
  lerRegistroRetrocompatibilidade,
  ServicoRetrocompatibilidade,
} from './aplicacao/retrocompatibilidade.js';
import type { PortaCoexistencia } from './porta.js';
import { PortaCoexistenciaMemoria } from './porta-memoria.js';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__');
const copia = (nome: string) => {
  const d = mkdtempSync(join(tmpdir(), `m59-6-${nome}-`));
  cpSync(join(FIXTURES, nome), d, { recursive: true });
  return d;
};
const RAIZ_FIM = copia('fim');
const RAIZ_DESLIG = copia('desligamento');
const RAIZ_RETRO = copia('retrocompatibilidade');
const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  SGH_COEX_FIM: RAIZ_FIM,
  SGH_COEX_DESLIGAMENTO: RAIZ_DESLIG,
  SGH_COEX_RETROCOMPAT: RAIZ_RETRO,
};
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha: new RegistradorTrilhaMemoria() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return set.map((c) => c.split(';')[0]).join('; ');
}
const R = '/api/administracao/coexistencia/retrocompatibilidade';

describe('retrocompatibilidade pela HTTP', { timeout: 60_000 }, () => {
  it('painel: decisão pendente vale mantida, condições não cumpridas, passos bloqueados com o tamanho medido', async () => {
    const r = await app.inject({ method: 'GET', url: R, headers: { cookie: await entrar('SINT.ONDA5') } });
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p).toMatchObject({
      hospital: 'aa',
      adr: { numero: '0033' },
      decisaoRegistrada: 'pendente',
      decisaoVigente: 'mantida',
      podeDecidirExtincao: false,
      extincaoSemCondicoes: [],
      registroInvalido: null,
      inventarioIndisponivel: false,
      registro: 'docs/coexistencia/retrocompatibilidade/aa.yaml',
    });
    expect(p.condicoes.map((c: { cumprida: boolean }) => c.cumprida)).toEqual([false, false, false, false]);
    expect(p.passos.map((x: { passo: string }) => x.passo)).toEqual([...PASSOS_EVOLUCAO]);
    expect(p.passos.every((x: { situacao: string }) => x.situacao === 'bloqueado')).toBe(true);
    expect(p.passos[0].ficha).toContain('0033');
    // O catálogo sintético da porta em memória: 3 gatilhos (2 ativos), 2 letras, 2 pares, 1 chave em texto.
    expect(p.inventario).toMatchObject({
      tabelas: 4,
      gatilhos: { total: 3, ativos: 2, tabelas: 3 },
      colunasDeUmaLetra: { colunas: 2, tabelas: 2 },
      paresDataHora: { pares: 2, tabelas: 2 },
      chavesEmTexto: { chaves: 1, deTotal: 2, tabelas: 1 },
      gatilhosSghEmTabelaLegada: 0,
    });
    expect(p.passos.map((x: { tamanho: number }) => x.tamanho)).toEqual([
      p.inventario.tabelasClinicas.presentes,
      2,
      2,
      2,
      1,
    ]);
    expect(p.operacoesDeRetirada.every((x: { estadoEsperado: string }) => x.estadoEsperado === 'verde')).toBe(
      true,
    );
  });

  it('sem config.coexistencia.ler: 403', async () => {
    const r = await app.inject({ method: 'GET', url: R, headers: { cookie: await entrar('SINT.RECEPCAO') } });
    expect(r.statusCode).toBe(403);
  });
});

// ── Serviço com o registro em pasta temporária ─────────────────────────────────────────────────────────────

const sessao = (hospital = 'aa') =>
  ({
    hospital,
    rede: 'sint',
    login: 'SINT.ADMIN',
    porta: { rede: 'sint', hospital },
    pode: () => true,
  }) as unknown as SessaoCadastro;

function pastas(retro: string | null, fim: string, deslig: string) {
  const base = mkdtempSync(join(tmpdir(), 'm59-6-svc-'));
  const r = join(base, 'retro');
  const f = join(base, 'fim');
  const d = join(base, 'deslig');
  for (const x of [r, f, d]) mkdirSync(x);
  if (retro !== null) writeFileSync(join(r, 'aa.yaml'), retro);
  writeFileSync(join(f, 'aa.yaml'), fim);
  writeFileSync(join(d, 'aa.yaml'), deslig);
  return { r, f, d };
}

const FIM_FEITO = `formato: 1
estabelecimento: aa
ata: { data: '2027-01-05', referencia: ata do comite de coexistencia }
aceiteDiretoria: { data: '2027-01-06', papel: diretoria }
fimRegistrado: { data: '2027-01-10', papel: dono-do-projeto }
dp6: { decididaEm: '2027-01-15', decisao: contingencia de trinta dias }
`;
const DESLIG_FEITO = `formato: 1
estabelecimento: aa
passos:
  desligamento:
    autorizacao: { data: '2027-01-20', referencia: ESTADO Autorizacoes }
    ensaio: { data: '2027-01-18', relatorio: checklist revista, resultado: aprovado }
    execucao: { data: '2027-02-01', referencia: janela da TI }
`;
const EXTINTA = `formato: 1
estabelecimento: aa
decisao:
  situacao: extinta
  data: '2027-03-01'
  referencia: ESTADO Autorizacoes
  adr: '0033'
  papel: dono-do-projeto
passos:
  imutabilidade-por-linha:
    ficha: docs/adr/0033-retrocompatibilidade-e-evolucao-do-modelo.md
    regressao: { data: '2027-03-05', relatorio: relatorio da regressao, resultado: aprovado }
`;

function servico(
  p: { r: string; f: string; d: string },
  contingencia: boolean | Error,
  porta?: PortaCoexistencia,
) {
  let leituras = 0;
  const base =
    porta ??
    new PortaCoexistenciaMemoria(
      new RegistradorTrilhaMemoria(),
      fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria()),
    );
  const contada = {
    ...base,
    catalogoRetrocompatibilidade: (c: { rede: string; hospital: string }) => {
      leituras += 1;
      return base.catalogoRetrocompatibilidade(c);
    },
  } as PortaCoexistencia;
  const s = new ServicoRetrocompatibilidade({
    porta: contada,
    raizRetrocompatibilidade: p.r,
    raizFim: p.f,
    raizDesligamento: p.d,
    contingenciaLigada: () =>
      contingencia instanceof Error ? Promise.reject(contingencia) : Promise.resolve(contingencia),
    // o catálogo de operações declara as retiradas em verde (como o docs/operacoes/catalogo no pc)
    estadoOperacao: () => 'verde',
  });
  return { s, leituras: () => leituras };
}

describe('serviço da retrocompatibilidade', () => {
  it('extinção registrada com as quatro condições: vigente extinta e o primeiro passo pronto para autorizar', async () => {
    const { s } = servico(pastas(EXTINTA, FIM_FEITO, DESLIG_FEITO), false);
    const p = await s.painel(sessao());
    expect(p.condicoes.every((c) => c.cumprida)).toBe(true);
    expect(p.decisaoVigente).toBe('extinta');
    expect(p.podeDecidirExtincao).toBe(true);
    expect(p.passos[0]?.situacao).toBe('pronto-para-autorizar');
    expect(p.passos[1]?.motivos).toContain('passo-anterior-pendente');
  });

  it('extinção com a contingência ligada (ou ilegível) vale mantida e diz o que falta (falha fechada)', async () => {
    for (const c of [true, new Error('fonte fora')]) {
      const { s } = servico(pastas(EXTINTA, FIM_FEITO, DESLIG_FEITO), c);
      const p = await s.painel(sessao());
      expect(p.decisaoRegistrada).toBe('extinta');
      expect(p.decisaoVigente).toBe('mantida');
      expect(p.extincaoSemCondicoes).toEqual(['contingencia-encerrada']);
      expect(p.passos[0]?.motivos).toEqual(['retrocompatibilidade-nao-extinta']);
    }
  });

  it('registro ausente, fora do esquema ou de outro hospital: pendente, com o aviso', async () => {
    const vazio = 'formato: 1\nestabelecimento: aa\n';
    for (const [txt, aviso] of [
      [null, 'ausente'],
      ['formato: 2\n', 'fora do esquema'],
      ['formato: 1\nestabelecimento: bb\n', 'outro estabelecimento'],
      [': : :', 'ilegível'],
    ] as const) {
      const p = pastas(txt, vazio, vazio);
      expect(lerRegistroRetrocompatibilidade(p.r, 'aa').invalido).toContain(aviso);
      const painel = await servico(p, true).s.painel(sessao());
      expect(painel.decisaoRegistrada).toBe('pendente');
      expect(painel.registroInvalido).toContain(aviso);
    }
  });

  it('mantida com contingência longa: as retiradas ficam especificadas', async () => {
    const vazio = 'formato: 1\nestabelecimento: aa\n';
    const mantida = `formato: 1
estabelecimento: aa
decisao: { situacao: mantida, data: '2026-11-10', referencia: ata do comite, contingenciaLonga: true, revisarEm: '2027-06-01' }
`;
    const p = await servico(pastas(mantida, vazio, vazio), true).s.painel(sessao());
    expect(p).toMatchObject({
      decisaoRegistrada: 'mantida',
      contingenciaLonga: true,
      revisarEm: '2027-06-01',
    });
    expect(p.operacoesDeRetirada.every((x) => x.estadoEsperado === 'especificada')).toBe(true);
    // o catálogo segue em verde: o painel avisa a divergência em cada retirada
    expect(p.operacoesDeRetirada.every((x) => x.estadoAtual === 'verde' && x.divergente)).toBe(true);
  });

  it('o catálogo é lido uma vez por hora; a falha da leitura deixa o tamanho sem medida', async () => {
    const vazio = 'formato: 1\nestabelecimento: aa\n';
    const { s, leituras } = servico(pastas(vazio, vazio, vazio), true);
    await s.painel(sessao());
    await s.painel(sessao());
    expect(leituras()).toBe(1);
    const falha = {
      catalogoRetrocompatibilidade: () => Promise.reject(new Error('banco fora')),
    } as unknown as PortaCoexistencia;
    const p = await servico(pastas(vazio, vazio, vazio), true, falha).s.painel(sessao());
    expect(p.inventarioIndisponivel).toBe(true);
    expect(p.inventario).toBeNull();
    expect(p.passos.every((x) => x.tamanho === null)).toBe(true);
  });
});
