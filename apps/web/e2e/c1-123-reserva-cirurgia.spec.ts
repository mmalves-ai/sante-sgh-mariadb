// E2E @C1-123 (F8, 04-CC linha 103): reserva de equipamentos e hemocomponentes no pedido da cirurgia, pela tela. As
// rotas `/api/cirurgia/agendamentos/:id/reservas/...` só existem no banco do cliente (na fonte sintética respondem
// 503), então este E2E simula essas rotas com um estado em memória que segue a regra do servidor (período padrão =
// janela da cirurgia; o equipamento ocupado por outra cirurgia no horário é recusado com 422; a reserva ligada à
// requisição fica "reservada" com as bolsas liberadas; cancelar não apaga). O agendamento 701 e o resto da tela vêm
// da fonte sintética de dev. O que fica no banco está no contrato de efeito
// apps/api/src/modulos/cirurgia/reserva-cirurgia-propria.int.spec.ts. Aqui se prova o fluxo: o período já vem da
// cirurgia, a validação aparece na hora, um clique reserva, o conflito aparece como recusa, o sangue pedido mostra a
// prova cruzada e se liga à requisição do paciente, o cancelado fica na lista e a cirurgia fechada só mostra. Axe na
// tela. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AG = 701;

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

const recusa = (rota: Route) =>
  json(
    rota,
    {
      type: 'urn:sgh:problema:regra-violada',
      title: 'Reserva de equipamento recusada',
      status: 422,
      codigo: 'regra-violada',
    },
    422,
  );

const EQUIPAMENTOS = [
  { id: 41, codigo: 'EQ-FIC-1', nome: 'ARCO CIRURGICO FICTICIO' },
  { id: 42, codigo: 'EQ-FIC-2', nome: 'MICROSCOPIO FICTICIO' },
];
const HEMOS = [{ id: 7, sigla: 'CHF', descricao: 'CONCENTRADO FICTICIO', exigeProva: true }];
const REQUISICOES = [
  {
    item: 301,
    requisicao: 'RT-FIC-1',
    hemocomponente: 7,
    sigla: 'CHF',
    bolsas: 2,
    liberadas: 1,
    situacao: 'parcial',
  },
];

interface Eq {
  id: number;
  versao: number;
  sequencia: number;
  equipamento: number;
  inicio: string;
  fim: string;
  quantidade: number;
  situacao: string;
}
interface Hemo {
  id: number;
  versao: number;
  sequencia: number;
  hemocomponente: number;
  quantidade: number;
  situacao: string;
  requisicaoItem: number | null;
  observacao: string | null;
}

function simular(page: Page, aberta: () => boolean) {
  const eqs: Eq[] = [];
  const hemos: Hemo[] = [];
  const corpos: Record<string, unknown>[] = [];
  // Outra cirurgia já ocupa o microscópio das 09:00 às 11:00.
  const ocupado = { equipamento: 42, inicio: '2030-03-10 09:00', fim: '2030-03-10 11:00' };
  const leitura = () => ({
    agendamento: AG,
    numero: 'CC-FIC-1',
    situacao: aberta() ? 'agendado' : 'realizado',
    aberta: aberta(),
    periodo: { inicio: '2030-03-10 08:00', fim: '2030-03-10 10:00' },
    equipamentos: eqs.map((e) => {
      const o = EQUIPAMENTOS.find((x) => x.id === e.equipamento)!;
      return { ...e, codigo: o.codigo, nome: o.nome };
    }),
    hemocomponentes: hemos.map((h) => {
      const r = REQUISICOES.find((x) => x.item === h.requisicaoItem);
      return {
        ...h,
        sigla: 'CHF',
        descricao: 'CONCENTRADO FICTICIO',
        quantidadeReservada: r ? Math.min(h.quantidade, r.liberadas) : 0,
        provaCruzada: 'solicitada',
        requisicaoNumero: r?.requisicao ?? null,
        bolsasLiberadas: r?.liberadas ?? null,
      };
    }),
    opcoes: { equipamentos: EQUIPAMENTOS, hemocomponentes: HEMOS, requisicoes: REQUISICOES },
  });
  return {
    corpos,
    async ligar() {
      const base = `**/api/cirurgia/agendamentos/${AG}/reservas`;
      await page.route(base, (rota) => json(rota, leitura()));
      await page.route(`${base}/equipamentos`, async (rota) => {
        const c = rota.request().postDataJSON() as Omit<Eq, 'id' | 'versao' | 'sequencia' | 'situacao'>;
        corpos.push(c as unknown as Record<string, unknown>);
        if (c.equipamento === ocupado.equipamento && c.inicio < ocupado.fim && ocupado.inicio < c.fim)
          return recusa(rota);
        eqs.push({ ...c, id: 800 + eqs.length, versao: 1, sequencia: eqs.length + 1, situacao: 'reservado' });
        return json(rota, { id: 800 + eqs.length - 1, agendamento: AG });
      });
      await page.route(`${base}/hemocomponentes`, async (rota) => {
        const c = rota.request().postDataJSON() as {
          hemocomponente: number;
          quantidade: number;
          observacao?: string;
        };
        corpos.push(c);
        hemos.push({
          id: 900 + hemos.length,
          versao: 1,
          sequencia: hemos.length + 1,
          hemocomponente: c.hemocomponente,
          quantidade: c.quantidade,
          situacao: 'solicitada',
          requisicaoItem: null,
          observacao: c.observacao ?? null,
        });
        return json(rota, { id: 900 + hemos.length - 1, agendamento: AG });
      });
      await page.route(`${base}/hemocomponentes/*/requisicao`, async (rota) => {
        const id = Number(rota.request().url().split('/hemocomponentes/')[1]!.split('/')[0]);
        const c = rota.request().postDataJSON() as { requisicaoItem: number; versao: number };
        corpos.push(c);
        const h = hemos.find((x) => x.id === id)!;
        h.requisicaoItem = c.requisicaoItem;
        h.situacao = 'reservada';
        h.versao += 1;
        return json(rota, { id, agendamento: AG, requisicao: 'RT-FIC-1' });
      });
      await page.route(`${base}/*/*/cancelar`, async (rota) => {
        const [tipo, id] = rota.request().url().split('/reservas/')[1]!.split('/');
        const lista: (Eq | Hemo)[] = tipo === 'equipamentos' ? eqs : hemos;
        const r = lista.find((x) => x.id === Number(id))!;
        r.situacao = tipo === 'equipamentos' ? 'cancelado' : 'cancelada';
        r.versao += 1;
        return json(rota, { id: Number(id), agendamento: AG });
      });
    },
  };
}

test.describe('Reserva de equipamentos e hemocomponentes da cirurgia @C1-123', () => {
  test('período da cirurgia de saída, validação na hora, conflito recusado, sangue ligado à requisição; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    let aberta = true;
    const api = simular(page, () => aberta);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');

    await page.goto(`/cirurgia/agendamentos/${AG}`);
    const painel = page.getByTestId('reservas-cirurgia');
    await expect(painel).toBeVisible();
    await expect(page.getByTestId('reservas-sem-equipamento')).toBeVisible();
    await expect(page.getByTestId('reservas-periodo')).toContainText('2030-03-10 08:00 a 10:00');
    await expect(page.getByTestId('reservas-inicio')).toHaveValue('2030-03-10T08:00');
    await expect(page.getByTestId('reservas-fim')).toHaveValue('2030-03-10T10:00');
    await expect(page.getByTestId('reservas-reservar')).toBeDisabled();

    // Um equipamento e um clique: o período da cirurgia vai no pedido.
    await escolher(page.getByTestId('reservas-equipamento'), '41');
    await page.getByTestId('reservas-reservar').click();
    await expect(page.getByTestId('reservas-mensagem')).toContainText('Reserva gravada');
    expect(api.corpos[0]).toEqual({
      equipamento: 41,
      quantidade: 1,
      inicio: '2030-03-10 08:00',
      fim: '2030-03-10 10:00',
    });
    await expect(page.getByTestId('reserva-equipamento-1')).toContainText('ARCO CIRURGICO FICTICIO');
    await expect(page.getByTestId('reserva-equipamento-1')).toContainText('reservado');

    // Validação na hora: fim antes do início desliga o botão e mostra o motivo.
    await escolher(page.getByTestId('reservas-equipamento'), '42');
    await page.getByTestId('reservas-fim').fill('2030-03-10T07:00');
    await expect(page.getByTestId('reservas-problemas-equipamento')).toContainText('depois do início');
    await expect(page.getByTestId('reservas-reservar')).toBeDisabled();

    // O microscópio está com outra cirurgia no horário: o servidor recusa e nada entra na lista.
    await page.getByTestId('reservas-fim').fill('2030-03-10T10:00');
    await expect(page.getByTestId('reservas-problemas-equipamento')).toHaveCount(0);
    await page.getByTestId('reservas-reservar').click();
    await expect(painel.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('reservas-equipamentos').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('reserva-equipamento-2')).toHaveCount(0);

    // Hemocomponente: zero bolsas é recusado na hora; duas bolsas entram com a prova cruzada pedida.
    await escolher(page.getByTestId('reservas-hemocomponente'), '7');
    await page.getByTestId('reservas-hemo-qtd').fill('0');
    await expect(page.getByTestId('reservas-problemas-hemo')).toContainText('1 a 20 bolsas');
    await expect(page.getByTestId('reservas-pedir')).toBeDisabled();
    await page.getByTestId('reservas-hemo-qtd').fill('2');
    await page.getByTestId('reservas-pedir').click();
    await expect(page.getByTestId('reserva-hemo-1')).toContainText('solicitada');
    await expect(page.getByTestId('reserva-hemo-1')).toContainText('prova cruzada: solicitada');

    // Ligada à requisição transfusional do paciente: reservada, com as bolsas já liberadas pela agência.
    await escolher(page.getByTestId('reserva-hemo-escolha-requisicao-1'), '301');
    await page.getByTestId('reserva-hemo-ligar-1').click();
    await expect(page.getByTestId('reserva-hemo-requisicao-1')).toContainText(
      'RT-FIC-1: 1 bolsa(s) liberada(s)',
    );
    await expect(page.getByTestId('reserva-hemo-1')).toContainText('reservada');
    expect(api.corpos.at(-1)).toEqual({ requisicaoItem: 301, versao: 1 });
    await semViolacaoAxe(page, `/cirurgia/agendamentos/${AG}`);

    // Cancelar o arco: a linha fica, com a situação cancelada, sem o botão.
    await page.getByTestId('reserva-equipamento-cancelar-1').click();
    await expect(page.getByTestId('reservas-mensagem')).toContainText('cancelada');
    await expect(page.getByTestId('reserva-equipamento-1')).toContainText('cancelado');
    await expect(page.getByTestId('reserva-equipamento-cancelar-1')).toHaveCount(0);

    // Cirurgia realizada: só a leitura.
    aberta = false;
    await page.reload();
    await expect(page.getByTestId('reservas-fechada')).toBeVisible();
    await expect(page.getByTestId('reservas-novo-equipamento')).toHaveCount(0);
    await expect(page.getByTestId('reservas-novo-hemo')).toHaveCount(0);
    await expect(page.locator('[data-testid^="reserva-hemo-cancelar-"]')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
