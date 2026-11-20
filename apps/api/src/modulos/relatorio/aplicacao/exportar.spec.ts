// Regra 4 (M34): a exportação com dado de pessoa sem máscara exige a justificativa, gravada na execução e na trilha;
// a coluna de pessoa sai mascarada para quem não tem a permissão (e aí não pede justificativa); exportar exige a
// permissão de exportar do relatório. Os arquivos: CSV das planilhas em português (com a proteção contra fórmula),
// XLSX válido (pacote ZIP com a planilha) e o PDF pelo conversor (indisponível = 503). Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { relatorioDoCatalogo } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { PortaRelatorioMemoria } from '../porta-memoria.js';
import { gerarCsv, gerarXlsx, htmlDoRelatorio } from './exportar.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', GOTENBERG_URL: 'http://127.0.0.1:1' };
const trilha = new RegistradorTrilhaMemoria();
const relatorio = new PortaRelatorioMemoria(trilha);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, relatorio, vigia: null });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
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
const exportar = (s: { cookie: string; csrf: string }, codigo: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: `/api/relatorios/catalogo/${codigo}/exportar`,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m34-exp-${++chave}-${Date.now()}`,
    },
    payload: payload as object,
  });

const CONTAS = { inicio: '2026-10-01', fim: '2026-10-10', tipo: 'todas' };

describe('exportação com dado de pessoa (regra 4)', () => {
  it('sem justificativa, recusada antes de ler; com ela, o arquivo sai e a justificativa fica registrada', async () => {
    const s = await entrar('SINT.ADMIN');
    const sem = await exportar(s, 'contasNaoFechadas', { parametros: CONTAS, formato: 'csv' });
    expect(sem.statusCode).toBe(400);
    expect(sem.json()).toMatchObject({ codigo: 'justificativa-obrigatoria', campos: ['justificativa'] });
    const curta = await exportar(s, 'contasNaoFechadas', {
      parametros: CONTAS,
      formato: 'csv',
      justificativa: 'curta',
    });
    expect(curta.statusCode).toBe(400);
    const r = await exportar(s, 'contasNaoFechadas', {
      parametros: CONTAS,
      formato: 'csv',
      justificativa: 'Conferência das contas pendentes com o faturamento.',
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toBe('attachment; filename="contasNaoFechadas.csv"');
    expect(r.body).toContain('Paciente Fictício Um');
    const ex = (
      await app.inject({
        method: 'GET',
        url: '/api/relatorios/execucoes?relatorio=contasNaoFechadas',
        headers: { cookie: s.cookie },
      })
    ).json();
    expect(ex[0]).toMatchObject({
      tipo: 'exportacao',
      formato: 'csv',
      dadoPessoal: true,
      mascarado: false,
      temJustificativa: true,
    });
    expect(trilha.eventos.some((e) => e.evento === 'relatorio.exportado')).toBe(true);
  });

  it('sem a permissão de ver o dado de pessoa, sai mascarado; a justificativa vale para toda exportação (W0-09)', async () => {
    const s = await entrar('SINT.LEITOS');
    const sem = await exportar(s, 'internadosNaData', { parametros: { dia: '2026-10-20' }, formato: 'csv' });
    expect(sem.statusCode).toBe(400);
    expect(sem.json().codigo).toBe('justificativa-obrigatoria');
    const r = await exportar(s, 'internadosNaData', {
      parametros: { dia: '2026-10-20' },
      formato: 'csv',
      justificativa: 'Conferência do censo do dia',
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('Fictício');
    expect(r.body).toContain('•••');
  });

  it('sem a permissão de exportar o relatório, 403; o PDF sem o conversor, 503', async () => {
    const s = await entrar('SINT.RECEPCAO');
    expect(
      (
        await exportar(s, 'atendimentosPorDia', {
          parametros: { inicio: '2026-10-01', fim: '2026-10-02' },
          formato: 'csv',
        })
      ).statusCode,
    ).toBe(403);
    const adm = await entrar('SINT.ADMIN');
    const pdf = await exportar(adm, 'atendimentosPorDia', {
      parametros: { inicio: '2026-10-01', fim: '2026-10-02' },
      formato: 'pdf',
      justificativa: 'Envio à diretoria do mês',
    });
    expect(pdf.statusCode).toBe(503);
  });
});

describe('arquivos', () => {
  const r = relatorioDoCatalogo('contasNaoFechadas')!;
  const linhas = [
    {
      conta: 1,
      tipo: 'I',
      competencia: '2026-10',
      convenio: 1,
      alta: '2026-10-01T10:00:00',
      situacao: 'aberta',
      paciente: '=HYPERLINK("x")',
    },
  ];
  it('CSV: ponto e vírgula, BOM, número com vírgula e proteção contra fórmula', () => {
    const c = gerarCsv({ relatorio: r, linhas, totais: {} });
    expect(c.startsWith('﻿Conta;Tipo;')).toBe(true);
    expect(c).toContain(`"'=HYPERLINK(""x"")"`);
    const f = gerarCsv({
      relatorio: relatorioDoCatalogo('faturamentoPorConvenio')!,
      linhas: [{ convenio: 1, nomeConvenio: 'A', contas: 1, itens: 2, cobrado: 10.5, pago: 3 }],
      totais: { cobrado: 10.5 },
    });
    expect(f).toContain('10,50');
    expect(f.trim().split('\r\n').at(-1)).toMatch(/^Total;/);
  });

  it('XLSX: pacote ZIP com o tipo, o livro e a planilha (texto inline, número como número)', () => {
    const z = Buffer.from(gerarXlsx({ relatorio: r, linhas, totais: {} }));
    expect(z.subarray(0, 4).toString('hex')).toBe('504b0304');
    const t = z.toString('latin1');
    for (const n of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
      expect(t).toContain(n);
    expect(t).toContain('<c r="A2"><v>1</v></c>');
    expect(t).toContain('t="inlineStr"');
  });

  it('PDF: HTML autocontido com o título, os parâmetros e quem emitiu (sem recurso externo)', () => {
    const h = htmlDoRelatorio({
      relatorio: r,
      linhas,
      totais: {},
      parametros: { inicio: '2026-10-01' },
      produto: 'Produto',
      estabelecimento: 'aa',
      emitidoPor: 'SINT.ADMIN',
      emitidoEm: new Date('2026-10-22T10:00:00Z'),
      pdf: null,
    });
    expect(h).toContain('<h1>Contas não emitidas ou não fechadas</h1>');
    expect(h).toContain('De: 2026-10-01');
    expect(h).not.toMatch(/https?:\/\/|<script/);
    expect(h).toContain('&quot;x&quot;');
  });
});
