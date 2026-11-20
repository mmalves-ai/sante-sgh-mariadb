// W0-09 (catálogos A e B): cada relatório novo do catálogo (censo diário por unidade, altas e óbitos, produção por
// profissional e setor, consumo por centro de custo, curva ABC, validade e lote; B: dietas servidas, prontuários emprestados, atendimentos por convênio, produção SUS e escala das agendas) é uma definição declarada, só de
// leitura, que executa na grade, exporta em CSV, XLSX e PDF, exige a justificativa em toda exportação e grava a
// execução e a trilha. O PDF passa por um conversor falso local (o mesmo contrato do Gotenberg). Dados sintéticos.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { relatorioDoCatalogo } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { PortaRelatorioMemoria } from '../porta-memoria.js';

/** Os relatórios do catálogos A e B do W0-09 com parâmetros válidos. */
const CATALOGO_W0_09: Readonly<Record<string, Record<string, string | number>>> = {
  censoDiarioPorUnidade: { dia: '2026-10-20' },
  altasEObitos: { inicio: '2026-10-01', fim: '2026-10-10' },
  producaoPorProfissionalSetor: { mesInicio: '2026-09', mesFim: '2026-09' },
  consumoPorCentroCusto: { mesInicio: '2026-09', mesFim: '2026-10' },
  curvaAbcConsumo: { mesInicio: '2026-09', mesFim: '2026-09', local: 1 },
  validadeLote: { dias: 90 },
  // Catálogo B.
  dietasServidas: { inicio: '2026-10-01', fim: '2026-10-03' },
  prontuariosEmprestados: { setorSame: 8, inicio: '2026-10-01', fim: '2026-10-31' },
  atendimentosPorConvenio: { inicio: '2026-10-01', fim: '2026-10-10', convenio: 306 },
  producaoSus: { mesInicio: '2026-09', mesFim: '2026-09' },
  escalaAgendas: { situacao: 'ativas' },
};

const trilha = new RegistradorTrilhaMemoria();
const relatorio = new PortaRelatorioMemoria(trilha);
let app: NestFastifyApplication;
let conversor: Server;
let chave = 0;

beforeAll(async () => {
  conversor = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(Buffer.from('%PDF-1.7\n% sintetico W0-09\n%%EOF\n'));
    });
  });
  await new Promise<void>((ok) => conversor.listen(0, '127.0.0.1', ok));
  const porta = (conversor.address() as AddressInfo).port;
  const env: Record<string, string> = {
    ...envTeste,
    AMBIENTE: 'dev',
    GOTENBERG_URL: `http://127.0.0.1:${porta}`,
  };
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, relatorio, vigia: null });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  await new Promise((ok) => conversor.close(ok));
});

async function entrar(login: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
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
type S = Awaited<ReturnType<typeof entrar>>;
const post = (s: S, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `w0-09-cat-${++chave}-${Date.now()}` },
    payload: payload as object,
  });

describe('catálogos A e B do W0-09: executa, exporta (PDF/XLSX/CSV), exige justificativa e grava a trilha', () => {
  it('as seis definições estão no catálogo e aparecem para quem pode', async () => {
    const s = await entrar('SINT.ADMIN');
    const c = (
      await app.inject({ method: 'GET', url: '/api/relatorios/catalogo', headers: { cookie: s.cookie } })
    ).json() as { codigo: string; podeExecutar: boolean; podeExportar: boolean }[];
    for (const codigo of Object.keys(CATALOGO_W0_09)) {
      expect(relatorioDoCatalogo(codigo), codigo).toBeDefined();
      expect(
        c.find((x) => x.codigo === codigo),
        codigo,
      ).toMatchObject({ podeExecutar: true, podeExportar: true });
    }
  });

  for (const [codigo, parametros] of Object.entries(CATALOGO_W0_09))
    it(`${codigo}: grade, três formatos com justificativa, recusa sem ela, execuções e trilha`, async () => {
      const s = await entrar('SINT.ADMIN');
      const r = relatorioDoCatalogo(codigo)!;
      const grade = await post(s, `/relatorios/catalogo/${codigo}/executar`, { parametros });
      expect(grade.statusCode, grade.body).toBe(200);
      const g = grade.json() as { linhas: Record<string, unknown>[]; colunas: { campo: string }[] };
      expect(g.linhas.length).toBeGreaterThan(0);
      expect(g.colunas.map((x) => x.campo)).toEqual(r.colunas.map((x) => x.campo));
      for (const l of g.linhas)
        for (const k of Object.keys(l)) expect(r.colunas.map((x) => x.campo)).toContain(k);

      const antes = trilha.eventos.filter((e) => e.evento === 'relatorio.exportado').length;
      for (const formato of ['csv', 'xlsx', 'pdf'] as const) {
        const sem = await post(s, `/relatorios/catalogo/${codigo}/exportar`, { parametros, formato });
        expect(sem.statusCode, `${codigo} ${formato}`).toBe(400);
        expect(sem.json()).toMatchObject({ codigo: 'justificativa-obrigatoria', campos: ['justificativa'] });
        const ok = await post(s, `/relatorios/catalogo/${codigo}/exportar`, {
          parametros,
          formato,
          justificativa: `Conferência W0-09 em ${formato}`,
        });
        expect(ok.statusCode, `${codigo} ${formato}: ${ok.body.slice(0, 200)}`).toBe(200);
        expect(ok.headers['content-disposition']).toContain(`${codigo}.${formato}`);
        const corpo = ok.rawPayload;
        if (formato === 'pdf') expect(corpo.subarray(0, 5).toString()).toBe('%PDF-');
        if (formato === 'xlsx') expect(corpo.subarray(0, 2).toString()).toBe('PK');
        if (formato === 'csv') expect(corpo.toString('utf8')).toContain(r.colunas[0]!.rotulo);
      }
      const ex = (
        await app.inject({
          method: 'GET',
          url: `/api/relatorios/execucoes?relatorio=${codigo}`,
          headers: { cookie: s.cookie },
        })
      ).json() as { tipo: string; formato: string; temJustificativa: boolean; situacao: string }[];
      const exportacoes = ex.filter((x) => x.tipo === 'exportacao' && x.situacao === 'ok');
      expect(exportacoes.map((x) => x.formato).sort()).toEqual(['csv', 'pdf', 'xlsx']);
      expect(exportacoes.every((x) => x.temJustificativa)).toBe(true);
      expect(ex.some((x) => x.tipo === 'execucao' && x.formato === 'grade')).toBe(true);
      expect(trilha.eventos.filter((e) => e.evento === 'relatorio.exportado').length - antes).toBe(3);
      expect(trilha.eventos.some((e) => e.evento === 'relatorio.executado')).toBe(true);
    });
});
