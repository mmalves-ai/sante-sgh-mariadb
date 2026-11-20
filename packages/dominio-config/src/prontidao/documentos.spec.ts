// Documentos da consolidação (ficha do M35, regras 5, 6 e 7): os passos tirados das jornadas automáticas, o guia de
// uma página e o roteiro de vídeo, o pacote de homologação e o relatório em Markdown com os estabelecimentos separados.
import {
  type RelatorioProntidao,
  esquemaRelatorioProntidao,
  SETORES_PRONTIDAO,
  TAREFAS_TREINAMENTO,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  guiaMarkdown,
  pacoteHomologacaoMarkdown,
  passosDoTeste,
  relatorioProntidaoMarkdown,
  roteiroVideoMarkdown,
  testesDaJornada,
  testesDoArquivo,
} from './documentos.js';
import { avaliarHospital } from './prontidao.js';

const ESPEC = `
test.describe('x', () => {
  test('marcar e confirmar; axe', async ({ page }) => {
    await page.goto('/agenda/consultas/marcar');
    await page.getByLabel('Agenda').selectOption('1');
    await page.getByLabel(/Convênio/).fill('SINTETICO');
    await page.getByLabel('Aceite').check();
    await page.getByLabel('Observação').click();
    await page.getByRole('button', { name: 'Buscar vagas' }).click();
    await page.getByRole('button', { name: 'Buscar vagas' }).click();
    await page.getByRole('tab', { name: /^Histórico$/ }).click();
    await page.getByRole('link', { name: "Abrir a ficha" }).click();
    await page.getByRole('checkbox', { name: 'Encaixe' }).check();
    await page.getByRole('textbox', { name: 'Motivo' }).fill('x');
    await page.getByRole('combobox', { name: 'Tipo' }).selectOption('a');
    await page.getByRole('button', { name: /(?:Salvar|Gravar)/ }).click();
    await page.getByRole('button', { name: /^$/ }).click();
    await expect(page.getByText('Consulta marcada')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Marcação' })).toBeVisible();
    await expect(page.getByText('ok')).toBeVisible();
    await expect(page.getByTestId('estado')).toHaveText('Confirmada');
    await expect(page.getByTestId('hora')).toContainText('08:00');
    await expect(page.getByTestId('nome')).toContainText('PACIENTE');
    await expect(page.getByTestId('nome')).toContainText('Paciente Sintético');
    await page.getByTestId('campo-cep').fill('30130-000');
    await page.getByTestId('campo-tipo').selectOption('1');
    await page.getByTestId('campo-ativo').check();
    await page.getByTestId('botao-procurar-cpf').click();
    await page.getByTestId('acao-linha-12').click();
    await page.goto('/rota/sem/menu');
    await page.goto(\`/inicio\`);
  });
  test(\`axe \${c.tema}: casca\`, async () => {});
});
`;

const rotulo = (r: string) =>
  ({ '/agenda/consultas/marcar': 'Agenda › Marcação', '/inicio': 'Início' })[r] ?? null;

describe('jornadas automáticas', () => {
  it('separa os testes do arquivo e filtra pelo trecho do título', () => {
    const t = testesDoArquivo(ESPEC);
    expect(t.map((x) => x.titulo)).toEqual(['marcar e confirmar; axe', 'axe : casca']);
    expect(testesDaJornada(t, 'MARCAR').length).toBe(1);
    expect(testesDaJornada(t, '').length).toBe(2);
  });

  it('passos legíveis: tela pelo menu, ações, campos e conferências, sem valores da massa', () => {
    const [t] = testesDoArquivo(ESPEC);
    const p = passosDoTeste(t?.corpo ?? '', rotulo);
    expect(p).toEqual([
      'Abra **Agenda › Marcação**.',
      'Escolha em **Agenda**.',
      'Preencha **Convênio**.',
      'Marque **Aceite**.',
      'Use o campo **Observação**.',
      'Clique em **Buscar vagas**.',
      'Vá à aba **Histórico**.',
      'Abra **Abrir a ficha**.',
      'Marque **Encaixe**.',
      'Preencha **Motivo**.',
      'Escolha em **Tipo**.',
      'Clique em **Salvar**.',
      'Confira: aparece **Consulta marcada**.',
      'Confira: aparece **Marcação**.',
      'Confira: aparece **Confirmada**.',
      'Preencha **CEP**.',
      'Escolha em **tipo**.',
      'Marque **ativo**.',
      'Clique em **procurar CPF**.',
      'Clique em **linha**.',
      'Abra **Início**.',
    ]);
    expect(p.join(' ')).not.toMatch(/SINTETICO|Sintético|08:00|30130/);
  });
});

describe('material de treinamento', () => {
  const t = TAREFAS_TREINAMENTO[0];
  if (!t) throw new Error('sem tarefa');
  it('guia de uma página com o passo a passo e as jornadas de origem', () => {
    const g = guiaMarkdown(t, ['Abra **X**.', 'Clique em **Y**.'], ['jornada A']);
    expect(g).toContain(`# ${t.titulo}`);
    expect(g).toContain('1. Abra **X**.');
    expect(g).toContain('2. Clique em **Y**.');
    expect(g).toContain('“jornada A”');
    expect(guiaMarkdown({ ...t, jornada: { arquivo: 'a.spec.ts', teste: '' } }, [], [])).toContain(
      '(a jornada não tem passos de tela)',
    );
    expect(g).not.toMatch(/SPDATA|legado/i);
  });

  it('roteiro de vídeo: uma cena por passo, abertura e fechamento, duração de poucos minutos', () => {
    const v = roteiroVideoMarkdown(t, ['Abra **X**.', 'Clique em **Y**.']);
    expect(v).toContain('| 1 | Abra X. |');
    expect(v).toContain('| 3 | O resultado na tela |');
    expect(v).toContain('Duração estimada: 1 min');
    expect(roteiroVideoMarkdown(t, [])).toContain('| 1 | (a jornada não tem passos de tela)');
  });
});

describe('pacote de homologação', () => {
  const s = SETORES_PRONTIDAO.find((x) => x.id === 'agendamento');
  if (!s) throw new Error('sem setor');
  it('operações com estado e cenários, roteiro de conferência, jornada e dúvidas', () => {
    const md = pacoteHomologacaoMarkdown(s, {
      hospital: 'pc',
      geradoEm: '2026-10-23T00:00:00Z',
      operacoes: [
        { nome: 'agenda.agendarConsulta', estado: 'verde', cenarios: ['simples'], motivo: '' },
        {
          nome: 'agenda.agendarSemProntuario',
          estado: 'especificada',
          cenarios: ['a'],
          motivo: 'D-SPR-1 | x',
        },
      ],
      jornadas: [
        { arquivo: 'apps/web/e2e/agenda.spec.ts', titulos: ['marcar'] },
        { arquivo: 'b.spec.ts', titulos: [] },
      ],
    });
    expect(md).toContain('# Pacote de homologação: Agendamento e call center (onda 1)');
    expect(md).toContain('| `agenda.agendarConsulta` | verde | simples | — |');
    expect(md).toContain('D-SPR-1 \\| x');
    expect(md).toContain('| 1 | Marcação feita no novo');
    expect(md).toContain('“marcar”');
    expect(md).toContain('(nenhum teste com o trecho)');
    expect(md).toContain('- DP-3: call center e recepção');
    expect(md).not.toMatch(/SPDATA|legado/i);
  });

  it('setor só de leitura, sem jornada e sem dúvidas', () => {
    const md = pacoteHomologacaoMarkdown(
      { ...s, duvidas: [], leituras: [], recursos: [] },
      { hospital: 'pc', geradoEm: '2026-10-23', operacoes: [], jornadas: [] },
    );
    expect(md).toContain('Só leitura');
    expect(md).toContain('Nenhuma: o setor não está construído');
    expect(md).toContain('- Nenhuma.');
  });
});

describe('relatório em Markdown', () => {
  const base = {
    operacoes: [{ nome: 'agenda.agendarSemProntuario', estado: 'especificada' as const, motivo: 'D-SPR-1' }],
    marcos: { M17: 'aguardando-validacao' },
    guiasPorPapel: { recepcao: 2 },
  };
  const pc = avaliarHospital({
    ...base,
    codigo: 'pc',
    nome: 'Hospital Geral',
    bloqueio: null,
    carga: null,
    porGrupo: { MEDICOS: 320, FINANCEIRO: 2 },
    chaves: { preparadas: 3, ligadas: 0 },
  });
  const hs = avaliarHospital({
    ...base,
    codigo: 'hs',
    nome: 'Hospital Serrano',
    bloqueio: 'HS-1: sem a cópia',
    carga: null,
    porGrupo: null,
    chaves: null,
  });

  it('os dois estabelecimentos separados, a carga, os setores e o público (<5 nunca vira número)', () => {
    const r: RelatorioProntidao = esquemaRelatorioProntidao.parse({
      formato: 1,
      geradoEm: '2026-10-23T00:00:00Z',
      estados: { verde: 1 },
      liberadas: 0,
      hospitais: [pc, hs],
      carga: {
        cenario: 'carga-somada',
        executadoEm: '2026-10-23T00:00:00Z',
        usuarios: 400,
        resultado: 'verde',
        indicativo: true,
        jornadas: [
          { jornada: 'login', p95Ms: 12, metaMs: 2000, atendida: true },
          { jornada: 'x', p95Ms: null, metaMs: null, atendida: null },
          { jornada: 'y', p95Ms: 3000, metaMs: 2000, atendida: false },
        ],
        outroSistema: [{ operacao: 'abrir-paciente', antesP95Ms: 170, duranteP95Ms: null }],
        mon: { transacaoMaisLongaMs: null, acimaDoLimite: 0, escritas: 0 },
        arquivo: 'a.json',
      },
    });
    const md = relatorioProntidaoMarkdown(r);
    expect(md.indexOf('## Hospital Geral (`pc`)')).toBeLessThan(md.indexOf('## Hospital Serrano (`hs`)'));
    expect(md).toContain('**Bloqueio:** HS-1: sem a cópia');
    expect(md).toContain('| login | 12 | 2000 | sim |');
    expect(md).toContain('| y | 3000 | 2000 | não |');
    expect(md).toContain('| abrir-paciente | 170 | — |');
    expect(md).toContain('indicativo');
    expect(md).toContain('FINANCEIRO <5');
    expect(md).not.toContain('FINANCEIRO 2');
    expect(md).toContain('| `agenda.agendarSemProntuario` | especificada | D-SPR-1 |');
    expect(md).toContain('Onda 0 (só leitura)');
    expect(md).toContain('Total medido: 322');
    const sem = relatorioProntidaoMarkdown({ ...r, carga: null, hospitais: [hs] });
    expect(sem).toContain('Sem medição.');
    expect(sem).toContain('nenhum setor');
    expect(sem).toContain('— (sem medida)');
  });
});
