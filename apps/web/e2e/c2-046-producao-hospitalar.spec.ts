// E2E @C2-046 (F8, 09-AREA linha 87): produção hospitalar mensal e categoria clínica do paciente. As rotas
// `/api/internacao/producao-hospitalar*` só existem no banco do cliente (na fonte sintética respondem 503), então este
// E2E simula essas rotas com um estado em memória que segue a regra do servidor. O que fica no banco está no contrato de
// efeito apps/api/src/modulos/adt/producao-hospitalar-propria.int.spec.ts. Aqui se prova o fluxo: os indicadores do mês
// por categoria e do hospital com as parcelas impressas, apurar e fechar o mês; a visão por paciente pelo número do
// atendimento com o valor de cada período e a troca de categoria com a validação na hora (início antes do vigente e
// mesma categoria recusados sem ida ao servidor); a faixa de valor com o valor negativo recusado na hora. Axe na tela.
// Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const ind = (o: Record<string, number | null>) => ({
  leitosOperacionais: 0,
  entradas: 0,
  saidas: 0,
  obitos: 0,
  transferenciasExternas: 0,
  pacienteDia: 0,
  leitoDia: 0,
  taxaOcupacao: null,
  mediaPermanencia: null,
  giroLeito: null,
  intervaloSubstituicao: null,
  taxaMortalidade: null,
  saidasComPrevisao: 0,
  saidasNoPrazo: 0,
  pontualidadeAlta: null,
  valorProduzido: 0,
  diasSemFaixa: 0,
  ...o,
});

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  const clinicas = [
    { id: 1, rotulo: 'CLINICA FICTICIA MEDICA' },
    { id: 2, rotulo: 'CLINICA FICTICIA CIRURGICA' },
  ];
  let situacao: 'nao_apurada' | 'aberta' | 'fechada' = 'nao_apurada';
  const med = ind({
    leitosOperacionais: 2,
    entradas: 2,
    saidas: 1,
    pacienteDia: 5,
    leitoDia: 62,
    taxaOcupacao: 8.06,
    mediaPermanencia: 5,
    giroLeito: 0.5,
    intervaloSubstituicao: 57,
    taxaMortalidade: 0,
    saidasComPrevisao: 1,
    saidasNoPrazo: 1,
    pontualidadeAlta: 100,
    valorProduzido: 540,
  });
  const cir = ind({
    leitosOperacionais: 1,
    saidas: 1,
    obitos: 1,
    pacienteDia: 36,
    leitoDia: 31,
    taxaOcupacao: 116.13,
    mediaPermanencia: 36,
    giroLeito: 1,
    intervaloSubstituicao: 0,
    taxaMortalidade: 100,
    saidasComPrevisao: 1,
    pontualidadeAlta: 0,
    valorProduzido: 10800,
  });
  const total = ind({
    leitosOperacionais: 3,
    entradas: 2,
    saidas: 2,
    obitos: 1,
    pacienteDia: 41,
    leitoDia: 93,
    taxaOcupacao: 44.09,
    mediaPermanencia: 20.5,
    giroLeito: 0.67,
    intervaloSubstituicao: 26,
    taxaMortalidade: 50,
    saidasComPrevisao: 2,
    saidasNoPrazo: 1,
    pontualidadeAlta: 50,
    valorProduzido: 11340,
  });
  const periodos = [
    {
      id: 11,
      clinicaId: 1,
      clinica: 'CLINICA FICTICIA MEDICA',
      implicito: false,
      inicio: '2025-03-18T08:00:00',
      fim: null as string | null,
      diarias: 2,
      valor: 240,
      diasSemFaixa: 0,
      emAberto: true,
    },
  ];
  const faixas = [
    {
      id: 5,
      clinicaId: 1,
      clinica: 'CLINICA FICTICIA MEDICA',
      todasUnidades: false,
      inicio: '2025-01-01',
      fim: null,
      valorDiaria: 120,
      observacao: null,
      vigente: true,
    },
  ];
  return {
    corpos,
    async ligar() {
      await page.route(/\/api\/internacao\/producao-hospitalar\?mes=/, (rota) =>
        json(rota, {
          mes: '2025-03',
          hoje: '2025-04-10',
          situacao,
          aoVivo: {
            mes: '2025-03',
            de: '2025-03-01',
            ate: '2025-03-31',
            dias: 31,
            total,
            porClinica: [
              { clinicaId: 1, ...med },
              { clinicaId: 2, ...cir },
            ],
          },
          gravada:
            situacao === 'nao_apurada'
              ? []
              : [
                  {
                    clinicaId: null,
                    ...total,
                    situacao,
                    apuradoAte: '2025-03-31',
                    apuradoEm: '2025-04-10T09:00:00',
                    fechadoEm: null,
                    versao: 1,
                  },
                ],
          clinicas,
        }),
      );
      await page.route('**/api/internacao/producao-hospitalar/apurar', async (rota) => {
        const c = rota.request().postDataJSON() as { fechar: boolean };
        corpos.push(c);
        situacao = c.fechar ? 'fechada' : 'aberta';
        await json(rota, {
          ok: true,
          mensagem: c.fechar ? 'Produção do mês apurada e fechada.' : 'Produção do mês apurada.',
          resultado: {},
          repetida: false,
        });
      });
      await page.route(/\/api\/internacao\/producao-hospitalar\/categorias\?atendimento=/, (rota) =>
        json(rota, {
          atendimento: {
            id: 900,
            numero: 'FIC-46',
            entrada: '2025-03-18T08:00:00',
            saida: null,
            internado: true,
          },
          periodos,
          valorTotal: periodos.reduce((s, p) => s + p.valor, 0),
          clinicas,
        }),
      );
      await page.route('**/api/internacao/producao-hospitalar/categorias', async (rota) => {
        const c = rota.request().postDataJSON() as { clinicaId: number; inicio: string };
        corpos.push(c);
        periodos[0]!.fim = `${c.inicio}:00`;
        periodos[0]!.emAberto = false;
        periodos.push({
          id: 12,
          clinicaId: c.clinicaId,
          clinica: 'CLINICA FICTICIA CIRURGICA',
          implicito: false,
          inicio: `${c.inicio}:00`,
          fim: null,
          diarias: 1,
          valor: 300,
          diasSemFaixa: 0,
          emAberto: true,
        });
        await json(rota, {
          ok: true,
          mensagem: 'Categoria clínica atualizada.',
          resultado: { id: 12 },
          repetida: false,
        });
      });
      await page.route('**/api/internacao/producao-hospitalar/faixas', async (rota) => {
        if (rota.request().method() === 'POST') {
          corpos.push(rota.request().postDataJSON() as Record<string, unknown>);
          return json(rota, {
            ok: true,
            mensagem: 'Faixa de valor gravada.',
            resultado: { id: 6 },
            repetida: false,
          });
        }
        return json(rota, { hoje: '2025-04-10', faixas, clinicas });
      });
    },
  };
}

test.describe('@C2-046 produção hospitalar mensal', () => {
  test('indicadores do mês com as parcelas, categoria do paciente com validação na hora e faixa de valor', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/internacao/producao-hospitalar');
    await expect(page.getByTestId('tela-producao-hospitalar')).toBeVisible();
    await page.getByTestId('producao-mes').fill('2025-03');
    await expect(page.getByTestId('producao-situacao')).toContainText('Ainda não apurado');
    // O total do hospital com as parcelas impressas (paciente-dia / leito-dia; altas no prazo / com previsão).
    await expect(page.getByTestId('producao-linha-total')).toContainText('44,09');
    await expect(page.getByTestId('producao-linha-total')).toContainText('41 / 93');
    await expect(page.getByTestId('producao-linha-total')).toContainText('1 / 2');
    await expect(page.getByTestId('producao-linha-c2')).toContainText('CLINICA FICTICIA CIRURGICA');

    await page.getByTestId('producao-apurar').click();
    await expect(page.getByTestId('producao-situacao')).toContainText('Apurado (aberto)');
    await page.getByTestId('producao-fechar').click();
    await expect(page.getByTestId('producao-situacao')).toContainText('Fechado');
    await expect(page.getByTestId('producao-apurar')).toBeDisabled();
    expect(api.corpos.slice(-2)).toEqual([
      { mes: '2025-03', fechar: false },
      { mes: '2025-03', fechar: true },
    ]);
    await semViolacaoAxe(page, '/internacao/producao-hospitalar');

    // Visão por paciente: períodos com o valor; a troca é validada na hora.
    await page.getByTestId('producao-aba-paciente').click();
    await page.getByTestId('producao-atendimento').fill('FIC-46');
    await page.getByTestId('producao-buscar').click();
    await expect(page.getByTestId('producao-periodo-11')).toContainText('CLINICA FICTICIA MEDICA');
    await escolher(page.getByTestId('producao-troca-categoria'), '1');
    await page.getByTestId('producao-troca-inicio').fill('2025-03-19T10:00');
    await expect(page.getByTestId('producao-troca-problemas')).toContainText('já está nesta categoria');
    await escolher(page.getByTestId('producao-troca-categoria'), '2');
    await page.getByTestId('producao-troca-inicio').fill('2025-03-17T10:00');
    await expect(page.getByTestId('producao-troca-problemas')).toContainText('entrada');
    await expect(page.getByTestId('producao-troca-gravar')).toBeDisabled();
    await page.getByTestId('producao-troca-inicio').fill('2025-03-20T09:00');
    await expect(page.getByTestId('producao-troca-problemas')).toHaveCount(0);
    await page.getByTestId('producao-troca-gravar').click();
    await expect(page.getByTestId('producao-periodo-12')).toContainText('CLINICA FICTICIA CIRURGICA');
    await expect(page.getByTestId('producao-valor-total')).toContainText('540,00');
    expect(api.corpos.at(-1)).toEqual({ atendimentoId: 900, clinicaId: 2, inicio: '2025-03-20T09:00' });
    await semViolacaoAxe(page, '/internacao/producao-hospitalar');

    // Faixa de valor: negativo recusado na hora; a válida grava.
    await page.getByTestId('producao-aba-faixas').click();
    await expect(page.getByTestId('producao-faixas')).toContainText('CLINICA FICTICIA MEDICA');
    await escolher(page.getByTestId('producao-faixa-categoria'), '2');
    await page.getByTestId('producao-faixa-valor').fill('-5');
    await expect(page.getByTestId('producao-faixa-problemas')).toContainText('zero ou maior');
    await expect(page.getByTestId('producao-faixa-incluir')).toBeDisabled();
    await page.getByTestId('producao-faixa-valor').fill('300');
    await page.getByTestId('producao-faixa-inicio').fill('2025-04-01');
    await page.getByTestId('producao-faixa-incluir').click();
    await expect(page.getByTestId('producao-aviso')).toContainText('Faixa de valor gravada');
    expect(api.corpos.at(-1)).toMatchObject({
      clinicaId: 2,
      valorDiaria: 300,
      inicio: '2025-04-01',
      fim: null,
    });
    expect(externas).toEqual([]);
  });
});
