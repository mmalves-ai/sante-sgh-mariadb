// E2E @F3.5-11 (F3.5, 05-SADT linha 19): a escala de execução do diagnóstico pelo caminho da tela. A coordenação do
// laboratório chega pelo menu (Diagnóstico › Escala de execução), escolhe o setor e vê a grade da semana do
// estabelecimento (o dia vem do servidor, nunca do relógio do navegador): uma linha por executante, o plantão noturno
// no dia em que começa e o dia sem ninguém marcado como sem cobertura. Ao montar a escala nova, a linha dela aparece na
// grade na hora; o que falta é listado sem ir ao servidor, e o plantão que choca com outra escala do mesmo profissional
// (de OUTRO setor) fica marcado como conflito, com o botão de gravar travado. Corrigido o horário, a gravação manda o
// corpo certo e a grade se refaz. A fila do setor aparece na ordem devolvida pelo servidor, com o aviso de exame sem
// ninguém escalado. Encerrar manda a data e a versão. Só o combo do tema (nada de <select> cru); axe sem violação.
// As rotas /api/sadt/escalas-execucao exigem o banco próprio e o E2E roda com a fonte sintética: as respostas são
// simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco (escala, plantões, choque, encerramento, fila na
// ordem da regra) está em apps/api/src/modulos/sadt/aplicacao/escala-execucao.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// Terça-feira; a semana da grade vai de domingo 22/11 a sábado 28/11.
const HOJE = '2026-11-24';

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

const OPCOES = {
  setores: [
    { id: 601, nome: 'LABORATORIO SINTETICO' },
    { id: 602, nome: 'IMAGEM SINTETICA' },
  ],
  profissionais: [
    { id: 71, nome: 'PROFISSIONAL SINTETICO A' },
    { id: 72, nome: 'PROFISSIONAL SINTETICO B' },
  ],
  recursos: [{ id: 81, nome: 'SALA SINTETICA 1' }],
  exames: [{ id: 501, nome: 'HEMOGRAMA SINTETICO' }],
  gruposPrioridade: [{ id: 1, nome: 'MAIOR DE 80 ANOS' }],
  hoje: HOJE,
};

const escala = (id: number, setor: number, profissional: number, descricao: string, plantoes: unknown[]) => ({
  id,
  setor,
  profissional,
  recurso: null,
  papel: 'executa',
  descricao,
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
  atendeFeriado: false,
  ativa: true,
  versao: 3,
  plantoes,
  exames: [{ exame: 501, limitePorTurno: null, grupoPrioridade: null, vagasReservadas: 0 }],
});
const plantao = (diaSemana: number, inicio: string, fim: string, capacidade = 10) => ({
  diaSemana,
  data: null,
  inicio,
  fim,
  capacidade,
});

const FILA = {
  setor: 601,
  data: HOJE,
  hora: '10:00',
  semExecutante: 1,
  itens: [
    {
      id: 9002,
      posicao: 1,
      urgente: true,
      ordemPrioridade: null,
      chegada: '2026-11-24T12:30:00.000Z',
      requisicao: 'SINT-R2',
      paciente: 'PACIENTE SINTETICO DOIS',
      exame: 501,
      exameNome: 'HEMOGRAMA SINTETICO',
      situacao: 'solicitado',
      grupoPrioridade: null,
      grupoPrioridadeNome: null,
      executantes: [{ escala: 11, descricao: 'Bancada da manhã', profissional: 71, recurso: null }],
    },
    {
      id: 9001,
      posicao: 2,
      urgente: false,
      ordemPrioridade: 1,
      chegada: '2026-11-24T12:00:00.000Z',
      requisicao: 'SINT-R1',
      paciente: 'PACIENTE SINTETICO UM',
      exame: 501,
      exameNome: 'HEMOGRAMA SINTETICO',
      situacao: 'solicitado',
      grupoPrioridade: 1,
      grupoPrioridadeNome: 'MAIOR DE 80 ANOS',
      executantes: [],
    },
  ],
};

test.describe('@F3.5-11 escala de execução do diagnóstico', () => {
  test.setTimeout(180_000);
  test('grade da semana, conflito na hora, gravação, fila do setor e encerramento; axe', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    // O laboratório tem a bancada da manhã (segunda e terça) e o noturno de terça; o profissional B já está escalado
    // na IMAGEM na quarta das 08:00 às 12:00: é com ela que a escala nova vai chocar.
    let escalas: unknown[] = [
      escala(11, 601, 71, 'Bancada da manhã', [plantao(2, '07:00', '13:00'), plantao(3, '07:00', '13:00')]),
      escala(12, 601, 71, 'Noturno', [plantao(3, '19:00', '07:00', 6)]),
      escala(21, 602, 72, 'Ultrassom quarta', [plantao(4, '08:00', '12:00', 8)]),
    ];
    await page.route('**/api/sadt/escalas-execucao**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/escalas-execucao\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === 'opcoes') return json(rota, OPCOES);
        if (caminho === 'fila') return json(rota, FILA);
        return json(rota, escalas);
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === '') {
        escalas = [...escalas, escala(13, 601, 72, 'Bancada da quarta', [plantao(4, '13:00', '18:00', 12)])];
        return json(rota, { id: 13 });
      }
      if (caminho === '11/encerrar') {
        escalas = escalas.map((e) =>
          (e as { id: number }).id === 11 ? { ...(e as object), vigenciaFim: '2026-11-25', versao: 4 } : e,
        );
        return json(rota, { id: 11 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.LABORATORIO');
    await (await itemDoMenu(page, 'Escala de execução')).click();
    await expect(page).toHaveURL(/\/sadt\/escala-execucao$/);
    const tela = page.getByTestId('escala-execucao');
    await expect(tela).toBeVisible();
    await expect(tela.locator('select')).toHaveCount(0);

    // O setor abre a grade na semana do dia do estabelecimento.
    await escolher(page.getByTestId('escala-setor'), { rotulo: 'LABORATORIO SINTETICO' });
    await expect(page.getByTestId('escala-semana')).toContainText('22/11');
    await expect(page.getByTestId('escala-semana')).toContainText('28/11');
    // Só as escalas do setor; o noturno aparece na terça, dia em que começa, avisando que vai até o dia seguinte.
    await expect(page.getByTestId('escala-linha-11')).toContainText('PROFISSIONAL SINTETICO A');
    await expect(page.getByTestId('escala-linha-12')).toContainText('19:00 às 07:00');
    await expect(page.getByTestId('escala-linha-12')).toContainText('até o dia seguinte');
    await expect(page.getByTestId('escala-linha-21')).toHaveCount(0);
    // Segunda e terça cobertas; de quarta a domingo, sem cobertura.
    await expect(page.getByTestId('escala-sem-cobertura-2')).toHaveCount(0);
    await expect(page.getByTestId('escala-sem-cobertura-3')).toHaveCount(0);
    for (const d of [1, 4, 5, 6, 7])
      await expect(page.getByTestId(`escala-sem-cobertura-${d}`)).toBeVisible();
    await semViolacaoAxe(page, '/sadt/escala-execucao');

    // A fila do setor na ordem do servidor: o urgente antes do prioritário; o aviso do exame sem ninguém escalado.
    const linhasDaFila = page.getByTestId('escala-fila').locator('tbody tr');
    await expect(linhasDaFila).toHaveCount(2);
    await expect(linhasDaFila.nth(0)).toContainText('PACIENTE SINTETICO DOIS');
    await expect(linhasDaFila.nth(0)).toContainText('Urgente');
    await expect(linhasDaFila.nth(0)).toContainText('PROFISSIONAL SINTETICO A');
    await expect(linhasDaFila.nth(1)).toContainText('MAIOR DE 80 ANOS');
    await expect(linhasDaFila.nth(1)).toContainText('Ninguém escalado');
    await expect(page.getByTestId('escala-fila-sem-executante')).toBeVisible();

    // A escala nova: antes de mexer, nada de aviso; o botão só libera com tudo conferido.
    const gravar = page.getByTestId('escala-gravar');
    await expect(page.getByTestId('escala-pendencias')).toHaveCount(0);
    await expect(page.getByTestId('escala-linha-nova')).toHaveCount(0);
    await expect(gravar).toBeDisabled();
    await page.getByTestId('escala-descricao').fill('Bancada da quarta');
    // Tudo o que falta de uma vez (executante e exame), sem ir ao servidor.
    await expect(page.getByTestId('escala-pendencias')).toContainText('Informe o profissional');
    await expect(page.getByTestId('escala-pendencias')).toContainText('ao menos um exame');
    await escolher(page.getByTestId('escala-profissional'), { rotulo: 'PROFISSIONAL SINTETICO B' });
    await escolher(page.getByTestId('escala-exame-mais'), { rotulo: 'HEMOGRAMA SINTETICO' });
    await expect(page.getByTestId('escala-exame-0')).toContainText('HEMOGRAMA SINTETICO');
    // Quarta das 07:00 às 13:00 (o padrão do plantão): choca com a escala do profissional B na IMAGEM.
    await escolher(page.getByTestId('escala-plantao-dia-0'), { rotulo: 'Quarta' });
    await expect(page.getByTestId('escala-conflito-0')).toBeVisible();
    await expect(page.getByTestId('escala-pendencias')).toContainText('Ultrassom quarta');
    await expect(gravar).toBeDisabled();
    // A tarde resolve: o conflito some, a linha nova fica na quarta e a quarta deixa de estar sem cobertura só ao gravar.
    await page.getByTestId('escala-plantao-inicio-0').fill('13:00');
    await page.getByTestId('escala-plantao-fim-0').fill('18:00');
    await page.getByTestId('escala-plantao-capacidade-0').fill('12');
    await expect(page.getByTestId('escala-conflito-0')).toHaveCount(0);
    await expect(page.getByTestId('escala-pendencias')).toHaveCount(0);
    await expect(page.getByTestId('escala-linha-nova')).toContainText('13:00 às 18:00');
    await expect(gravar).toBeEnabled();
    expect(pedidos).toHaveLength(0);
    await semViolacaoAxe(page, '/sadt/escala-execucao (escala nova)');
    await gravar.click();

    await expect(page.getByTestId('escala-mensagem')).toBeVisible();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      caminho: '',
      corpo: {
        setor: 601,
        profissional: 72,
        recurso: null,
        papel: 'executa',
        descricao: 'Bancada da quarta',
        vigenciaInicio: HOJE,
        vigenciaFim: null,
        plantoes: [{ diaSemana: 4, data: null, inicio: '13:00', fim: '18:00', capacidade: 12 }],
        exames: [{ exame: 501, limitePorTurno: null, grupoPrioridade: null, vagasReservadas: 0 }],
      },
    });
    // A grade se refaz com a escala gravada e a quarta passa a ter cobertura; o formulário volta ao começo.
    await expect(page.getByTestId('escala-linha-13')).toContainText('PROFISSIONAL SINTETICO B');
    await expect(page.getByTestId('escala-sem-cobertura-4')).toHaveCount(0);
    await expect(page.getByTestId('escala-linha-nova')).toHaveCount(0);
    await expect(page.getByTestId('escala-descricao')).toHaveValue('');

    // Encerrar na própria linha: só com a data; manda a data e a versão lida, e a linha mostra o término.
    await expect(page.getByTestId('escala-encerrar-11')).toBeDisabled();
    await page.getByTestId('escala-fim-11').fill('2026-11-25');
    await page.getByTestId('escala-encerrar-11').click();
    await expect(page.getByTestId('escala-mensagem')).toContainText('encerrada');
    expect(pedidos[1]).toEqual({ caminho: '11/encerrar', corpo: { vigenciaFim: '2026-11-25', versao: 3 } });
    await expect(page.getByTestId('escala-linha-11')).toContainText('Termina em 25/11');
    // Na semana seguinte a escala encerrada saiu da grade (segue no cadastro); voltar à semana de hoje a traz de novo.
    await page.getByTestId('escala-semana-proxima').click();
    await expect(page.getByTestId('escala-semana')).toContainText('29/11');
    await expect(page.getByTestId('escala-linha-11')).toHaveCount(0);
    await expect(page.getByTestId('escala-linha-12')).toBeVisible();
    await page.getByTestId('escala-semana-hoje').click();
    await expect(page.getByTestId('escala-linha-11')).toBeVisible();
  });

  test('a recusa do servidor pelo choque marca o plantão na grade', async ({ page }) => {
    await page.route('**/api/sadt/escalas-execucao**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/escalas-execucao\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === 'opcoes') return json(rota, OPCOES);
        if (caminho === 'fila') return json(rota, { ...FILA, itens: [], semExecutante: 0 });
        return json(rota, []);
      }
      // Outra pessoa gravou uma escala do mesmo profissional enquanto a tela estava aberta: o servidor recusa.
      return rota.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'urn:sgh:problema:recusa-de-negocio',
          title: 'Recusa',
          status: 409,
          codigo: 'escala-conflito',
          campos: ['plantoes.0'],
        }),
      });
    });
    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/escala-execucao');
    await escolher(page.getByTestId('escala-setor'), { rotulo: 'LABORATORIO SINTETICO' });
    await expect(page.getByTestId('escala-vazia')).toBeVisible();
    await expect(page.getByTestId('escala-fila-vazia')).toBeVisible();
    await page.getByTestId('escala-descricao').fill('Bancada da manhã');
    await escolher(page.getByTestId('escala-profissional'), { rotulo: 'PROFISSIONAL SINTETICO A' });
    await escolher(page.getByTestId('escala-exame-mais'), { rotulo: 'HEMOGRAMA SINTETICO' });
    await escolher(page.getByTestId('escala-plantao-dia-0'), { rotulo: 'Quarta' });
    await expect(page.getByTestId('escala-conflito-0')).toHaveCount(0);
    await expect(page.getByTestId('escala-plantao-conflito-0')).toHaveCount(0);
    await page.getByTestId('escala-gravar').click();
    await expect(page.getByTestId('escala-recusa')).toBeVisible();
    // O plantão recusado fica marcado no formulário e na linha da escala nova, na grade.
    await expect(page.getByTestId('escala-plantao-conflito-0')).toBeVisible();
    await expect(page.getByTestId('escala-conflito-0')).toBeVisible();
    // O que foi digitado continua na tela; mexer no plantão tira a marca do servidor.
    await expect(page.getByTestId('escala-descricao')).toHaveValue('Bancada da manhã');
    await page.getByTestId('escala-plantao-inicio-0').fill('08:00');
    await expect(page.getByTestId('escala-conflito-0')).toHaveCount(0);
    await expect(page.getByTestId('escala-plantao-conflito-0')).toHaveCount(0);
  });

  test('quem não lê o catálogo do diagnóstico não tem o item nem abre a tela', async ({ page }) => {
    await entrar(page, 'SINT.RECEPCAO');
    await expect(await itemDoMenu(page, 'Escala de execução')).toHaveCount(0);
    await page.goto('/sadt/escala-execucao');
    await expect(page.getByTestId('escala-execucao')).toHaveCount(0);
  });
});
