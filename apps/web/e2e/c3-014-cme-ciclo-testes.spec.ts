// F7 (04-CME linha 116) @C3-014: ciclo de esterilização pelos testes dos indicadores, liberação e rejeição no
// reprocessamento, pelo caminho da tela. As rotas exigem o banco próprio e o E2E roda com a fonte sintética, então as
// respostas da API são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o ciclo escolhido mostra
// os indicadores pelos testes; o teste do biológico pede o controle positivo e vai com lote, leitura e resultado; o
// encerramento leva a versão lida; a rejeição do ciclo vai com motivo, fase e retorno; a rejeição em recolhimento
// oferece o pacote distribuído e o recolhe. O efeito no banco está no contrato de efeito
// apps/api/src/modulos/cirurgia/cme-ciclo-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const rejeicaoAberta = {
  id: 71,
  motivo: 'MOTIVO SINTETICO',
  fase: 'Esterilização',
  pacote: null,
  etiqueta: null,
  ciclo: 9,
  numeroCiclo: 'CE-000009',
  situacao: 'em_recolhimento',
  exigeRecolhimento: true,
  recolhidos: 0,
  pendentes: 1,
  rejeitadoEm: '2026-11-26T11:00',
};
const painel = (rejeicoes: unknown[]) => ({
  ciclos: [{ id: 9, numero: 'CE-000009', lote: 'L000009', situacao: 'concluido', inicio: '2026-11-26T08:00' }],
  tipos: [
    { id: 1, descricao: 'FISICO SINTETICO', categoria: 'fisico', exigeLote: false, exigeControle: false, liberacaoDepende: true },
    { id: 3, descricao: 'BIOLOGICO SINTETICO', categoria: 'biologico', exigeLote: true, exigeControle: true, liberacaoDepende: true },
  ],
  motivos: [{ id: 5, descricao: 'MOTIVO SINTETICO', fase: null, exigeRecolhimento: true }],
  fases: [
    { id: 2, descricao: 'Limpeza', ordem: 2 },
    { id: 5, descricao: 'Esterilização', ordem: 5 },
  ],
  rejeicoes,
});
const CICLO = {
  id: 9,
  numero: 'CE-000009',
  lote: 'L000009',
  equipamento: 'AUTOCLAVE SINTETICA',
  metodo: 'VAPOR SINTETICO',
  situacao: 'concluido',
  inicio: '2026-11-26T08:00',
  fim: '2026-11-26T09:00',
  versao: 4,
  implante: true,
  indicadores: { fisico: 'conforme', quimico: 'conforme', biologico: 'pendente' },
  testes: [
    {
      id: 11,
      sequencia: 1,
      tipo: 1,
      descricao: 'FISICO SINTETICO',
      categoria: 'fisico',
      resultado: 'aprovado',
      lote: null,
      validade: null,
      leitura: '2026-11-26T09:00',
      responsavel: 'SINT.CME',
    },
  ],
  pacotes: [
    { id: 21, etiqueta: 'PCT-SINT-21', situacao: 'distribuido' },
    { id: 22, etiqueta: 'PCT-SINT-22', situacao: 'esteril' },
  ],
};

test.describe('@C3-014 CME: testes dos indicadores do ciclo, liberação e rejeição', () => {
  test('registra o biológico com controle, encerra pelos testes, rejeita o ciclo e recolhe o distribuído', async ({
    page,
  }) => {
    const corpos: Record<string, unknown[]> = { teste: [], encerrar: [], rejeitar: [], recolher: [] };
    let rejeitado = false;
    await page.route('**/api/cirurgia/cme/ciclos', (r) => json(r, painel(rejeitado ? [rejeicaoAberta] : [])));
    await page.route('**/api/cirurgia/cme/ciclos/9/testes', (r) => {
      if (r.request().method() === 'POST') {
        corpos['teste']!.push(r.request().postDataJSON());
        return json(r, { teste: 12 }, 201);
      }
      return json(r, CICLO);
    });
    await page.route('**/api/cirurgia/cme/ciclos/9/encerrar', (r) => {
      corpos['encerrar']!.push(r.request().postDataJSON());
      return json(r, { situacao: 'liberado', motivo: 'Indicador biológico conforme.' });
    });
    await page.route('**/api/cirurgia/cme/rejeicoes', (r) => {
      corpos['rejeitar']!.push(r.request().postDataJSON());
      rejeitado = true;
      return json(r, { rejeicao: 71, situacao: 'em_recolhimento', distribuidos: 1 }, 201);
    });
    await page.route('**/api/cirurgia/cme/rejeicoes/71/recolher', (r) => {
      corpos['recolher']!.push(r.request().postDataJSON());
      return json(r, { pendentes: 0, situacao: 'concluida' });
    });

    // A CME é permissão clínica por perfil (cirurgia.cme.ler e .operar, perfil central-material-esteril): a segregação de
    // funções a tira do administrador sem perfil assistencial. Quem testa, libera e rejeita o ciclo é a equipe da CME.
    await entrar(page, 'SINT.CME');
    await page.goto('/cirurgia/cme/ciclos');
    await expect(page.getByTestId('tela-cme-ciclos')).toBeVisible();
    await escolher(page.getByTestId('cme-ciclo-escolha'), { rotulo: /CE-000009/ });
    await expect(page.getByTestId('cme-indicador-biologico')).toContainText('Pendente');
    await expect(page.getByTestId('cme-ciclo-testes')).toContainText('SINT.CME');

    await escolher(page.getByTestId('cme-teste-tipo'), { rotulo: /BIOLOGICO SINTETICO/ });
    await page.getByTestId('cme-teste-lote').fill('LB-SINT');
    await page.getByTestId('cme-teste-incubacao').fill('2026-11-26T09:10');
    await page.getByTestId('cme-teste-leitura').fill('2026-11-27T09:10');
    await page.getByTestId('cme-teste-controle').check();
    await page.getByTestId('cme-teste-registrar').click();
    await expect(page.getByTestId('cme-ciclo-aviso')).toBeVisible();
    expect(corpos['teste']![0]).toMatchObject({
      tipo: 3,
      resultado: 'aprovado',
      lote: 'LB-SINT',
      incubacaoInicio: '2026-11-26T09:10',
      leitura: '2026-11-27T09:10',
      controlePositivoOk: true,
    });

    await page.getByTestId('cme-ciclo-encerrar').click();
    await expect.poll(() => corpos['encerrar']!.length).toBe(1);
    expect(corpos['encerrar']![0]).toMatchObject({ versao: 4 });

    await escolher(page.getByTestId('cme-rejeicao-objeto'), { rotulo: 'O ciclo inteiro' });
    await escolher(page.getByTestId('cme-rejeicao-motivo'), { rotulo: 'MOTIVO SINTETICO' });
    await escolher(page.getByTestId('cme-rejeicao-fase'), { rotulo: 'Esterilização' });
    await escolher(page.getByTestId('cme-rejeicao-fase-retorno'), { rotulo: 'Limpeza' });
    await page.getByTestId('cme-rejeicao-descricao').fill('Causa sintética');
    await page.getByTestId('cme-rejeicao-salvar').click();
    await expect.poll(() => corpos['rejeitar']!.length).toBe(1);
    expect(corpos['rejeitar']![0]).toMatchObject({
      objeto: 'ciclo',
      ciclo: 9,
      pacote: null,
      motivo: 5,
      fase: 5,
      retorna: true,
      faseRetorno: 2,
      descricao: 'Causa sintética',
    });

    await expect(page.getByTestId('cme-rejeicao-71')).toContainText('Em recolhimento');
    await page.getByTestId('cme-recolher-71-21').click();
    await expect.poll(() => corpos['recolher']!.length).toBe(1);
    expect(corpos['recolher']![0]).toEqual({ pacote: 21 });
    await semViolacaoAxe(page, 'C3-014 testes do ciclo da CME');
  });
});
