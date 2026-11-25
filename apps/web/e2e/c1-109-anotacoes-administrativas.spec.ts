// E2E @C1-109 (03-PEP L147): a anotação administrativa do caso (registro NÃO clínico da equipe) pelo caminho da tela.
// O médico sintético (SINT.MEDICO: pep.prontuario.ler e pep.evolucao.criar) abre a fila de leitura
// (/pep/anotacoes-administrativas), segue a anotação endereçada a ele até a visão do paciente, marca como lida num
// clique, registra uma anotação nova (o atendimento mais recente já vem escolhido; categoria; "só os destinatários"
// segura o botão até avisar alguém, escolhido pela busca da conta) e cancela a própria com motivo (o botão só libera
// com 5 letras). Os combos são SanteSelecao (nenhum <select> nativo). As anotações só existem no banco do cliente (na
// fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato do
// servidor. O que fica no banco, quem vê o quê e as recusas estão no contrato de efeito
// (apps/api/src/modulos/pep/anotacoes-administrativas-propria.int.spec.ts) e no domínio
// (packages/dominio-pep/src/anotacao-administrativa.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;
const RESERVA = 77;

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

interface Anotacao {
  id: number;
  versao: number;
  atendimento: { id: number; numero: string };
  categoria: { id: number; descricao: string };
  texto: string;
  acesso: string;
  finalizaAcao: boolean;
  automatica: boolean;
  reserva: number | null;
  registradaEm: string;
  autor: string;
  doAutor: boolean;
  destinatarios: { usuario: number; nome: string; lidaEm: string | null }[];
  pendenteParaMim: boolean;
  situacao: 'ativa' | 'cancelada';
  canceladaEm: string | null;
  motivoCancelamento: string | null;
}

const CATEGORIAS = [
  { id: 71, descricao: 'Serviço social' },
  { id: 72, descricao: 'Gestão de leito' },
];
const ATENDIMENTOS = [
  { id: 501, numero: 'SINT-501', entradaEm: '2026-11-24T09:00:00.000Z' },
  { id: 400, numero: 'SINT-400', entradaEm: '2026-10-02T09:00:00.000Z' },
];

function simular(page: Page) {
  const st = {
    corpos: [] as Record<string, unknown>[],
    anotacoes: [
      {
        id: 9001,
        versao: 1,
        atendimento: { id: 501, numero: 'SINT-501' },
        categoria: CATEGORIAS[0]!,
        texto: 'Família aguarda a vaga da casa de apoio',
        acesso: 'destinatarios',
        finalizaAcao: false,
        automatica: false,
        reserva: null,
        registradaEm: '2026-11-25T08:00:00.000Z',
        autor: 'Conta sintética do serviço social',
        doAutor: false,
        destinatarios: [{ usuario: 2, nome: 'Médico sintético', lidaEm: null }],
        pendenteParaMim: true,
        situacao: 'ativa',
        canceladaEm: null,
        motivoCancelamento: null,
      },
    ] as Anotacao[],
  };
  let proximo = 9100;
  void page.route(/\/api\/pep\/anotacoes-administrativas\/pendentes$/, (r) =>
    json(
      r,
      st.anotacoes
        .filter((a) => a.pendenteParaMim)
        .map((a) => ({
          anotacao: a.id,
          paciente: PACIENTE,
          prontuario: '1001',
          atendimento: a.atendimento.numero,
          categoria: a.categoria.descricao,
          registradaEm: a.registradaEm,
          autor: a.autor,
        })),
    ),
  );
  void page.route(/\/api\/pep\/anotacoes-administrativas\/usuarios\?/, (r) =>
    json(r, [
      { id: 31, nome: 'Assistente social sintética' },
      { id: 32, nome: 'Enfermeira do NIR sintética' },
    ]),
  );
  void page.route(/\/api\/pep\/anotacoes-administrativas\/paciente\/\d+$/, (r) =>
    json(r, {
      anotacoes: st.anotacoes,
      atendimentos: ATENDIMENTOS,
      categorias: CATEGORIAS,
      pendentesParaMim: st.anotacoes.filter((a) => a.pendenteParaMim).length,
      podeEscrever: true,
    }),
  );
  // Leitura confirmada pelo destinatário: rota própria, aberta a quem só lê.
  void page.route(/\/api\/pep\/anotacoes-administrativas\/\d+\/lida$/, (r) => {
    const id = Number(/\/(\d+)\/lida$/.exec(r.request().url())![1]);
    st.corpos.push({ lida: id });
    const a = st.anotacoes.find((x) => x.id === id)!;
    a.pendenteParaMim = false;
    a.destinatarios[0]!.lidaEm = '2026-11-25T10:00:00.000Z';
    return json(r, { ok: true, resultado: { anotacao: a.id, situacao: 'ativa' }, repetida: false });
  });
  void page.route(/\/api\/pep\/anotacoes-administrativas\/reserva\/\d+$/, (r) =>
    json(r, { reserva: RESERVA, paciente: PACIENTE }),
  );
  void page.route(/\/api\/pep\/anotacoes-administrativas$/, async (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push(corpo);
    if (corpo['acao'] === 'marcar_lida') {
      const a = st.anotacoes.find((x) => x.id === corpo['anotacao'])!;
      a.pendenteParaMim = false;
      a.destinatarios[0]!.lidaEm = '2026-11-25T10:00:00.000Z';
      return json(r, { ok: true, resultado: { anotacao: a.id, situacao: 'ativa' }, repetida: false });
    }
    if (corpo['acao'] === 'cancelar') {
      const a = st.anotacoes.find((x) => x.id === corpo['anotacao'])!;
      Object.assign(a, {
        situacao: 'cancelada',
        canceladaEm: '2026-11-25T10:05:00.000Z',
        motivoCancelamento: corpo['motivo'],
        versao: a.versao + 1,
      });
      return json(r, { ok: true, resultado: { anotacao: a.id, situacao: 'cancelada' }, repetida: false });
    }
    const id = proximo++;
    st.anotacoes.unshift({
      id,
      versao: 1,
      atendimento: { id: Number(corpo['atendimento']), numero: 'SINT-501' },
      categoria: CATEGORIAS.find((c) => c.id === corpo['categoria'])!,
      texto: String(corpo['texto']).trim(),
      acesso: String(corpo['acesso']),
      finalizaAcao: Boolean(corpo['finalizaAcao']),
      automatica: false,
      reserva: typeof corpo['reserva'] === 'number' ? corpo['reserva'] : null,
      registradaEm: '2026-11-25T10:02:00.000Z',
      autor: 'Médico sintético',
      doAutor: true,
      destinatarios: ((corpo['destinatarios'] as number[]) ?? []).map((u) => ({
        usuario: u,
        nome: 'Assistente social sintética',
        lidaEm: null,
      })),
      pendenteParaMim: false,
      situacao: 'ativa',
      canceladaEm: null,
      motivoCancelamento: null,
    });
    return json(r, { ok: true, resultado: { anotacao: id, situacao: 'ativa' }, repetida: false });
  });
  return st;
}

test.describe('Anotações administrativas do caso @C1-109 @fase8', () => {
  test.setTimeout(120_000);
  test('fila de leitura, marcar como lida, anotação restrita com destinatário e cancelamento com motivo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.MEDICO');

    await page.goto('/pep/anotacoes-administrativas');
    await expect(page.getByTestId('anotacoes-adm-painel')).toBeVisible();
    await expect(page.getByTestId('anotacoes-adm-fila-9001')).toBeVisible();
    await semViolacaoAxe(page, '/pep/anotacoes-administrativas');
    await page.getByTestId('anotacoes-adm-fila-9001').getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/anotacoes-administrativas$`));

    const tela = page.getByTestId('anotacoes-adm-tela');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);
    await expect(page.getByTestId('anotacoes-adm-pendentes')).toBeVisible();

    // Marcar como lida num clique: a pendência some.
    await page.getByTestId('anotacao-lida-9001').click();
    await expect(page.getByTestId('anotacoes-adm-ok')).toBeVisible();
    await expect(page.getByTestId('anotacoes-adm-pendentes')).toHaveCount(0);
    expect(st.corpos.at(-1)).toEqual({ lida: 9001 });

    // Anotação nova: o atendimento mais recente já vem escolhido; a restrita segura o botão até avisar alguém.
    const registrar = page.getByTestId('anotacoes-adm-registrar');
    await escolher(page.getByTestId('anotacoes-adm-categoria'), { rotulo: 'Gestão de leito' });
    await page.getByTestId('anotacoes-adm-texto').fill('Aguardando a vaga de retaguarda');
    await expect(registrar).toBeEnabled();
    await escolher(page.getByTestId('anotacoes-adm-acesso'), { rotulo: 'Só os destinatários' });
    await expect(page.getByTestId('anotacoes-adm-falta-destinatario')).toBeVisible();
    await expect(registrar).toBeDisabled();
    await page.getByTestId('anotacoes-adm-busca-conta').fill('assist');
    await page.getByTestId('anotacoes-adm-busca-conta').press('Enter');
    await page.getByTestId('anotacoes-adm-conta-31').click();
    await expect(page.getByTestId('anotacoes-adm-falta-destinatario')).toHaveCount(0);
    await registrar.click();
    await expect(page.getByTestId('anotacao-9100')).toBeVisible();
    expect(st.corpos.at(-1)).toEqual({
      acao: 'registrar',
      paciente: PACIENTE,
      atendimento: 501,
      categoria: 72,
      texto: 'Aguardando a vaga de retaguarda',
      acesso: 'destinatarios',
      destinatarios: [31],
      finalizaAcao: false,
    });

    // Cancelar a própria: o botão só libera com o motivo; a anotação sai da lista das ativas e fica nas canceladas.
    const cancelar = page.getByTestId('anotacao-cancelar-9100');
    await expect(cancelar).toBeDisabled();
    await page.getByTestId('anotacao-motivo-9100').fill('Registrada no caso errado');
    await cancelar.click();
    await expect(page.getByTestId('anotacao-9100')).toHaveCount(0);
    await page.getByTestId('anotacoes-adm-canceladas').check();
    await expect(page.getByTestId('anotacao-situacao-9100')).toHaveText('Cancelada');
    expect(st.corpos.at(-1)).toEqual({
      acao: 'cancelar',
      anotacao: 9100,
      versao: 1,
      motivo: 'Registrada no caso errado',
    });

    await semViolacaoAxe(page, '/pep/paciente/:id/anotacoes-administrativas');
    expect(externas).toEqual([]);
  });

  test('vinda da reserva de leito do NIR: abre o paciente da reserva e a anotação nova sai ligada a ela', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.MEDICO');

    await page.goto(`/pep/anotacoes-administrativas?reserva=${RESERVA}`);
    await expect(page).toHaveURL(
      new RegExp(`/pep/paciente/${PACIENTE}/anotacoes-administrativas\\?reserva=${RESERVA}$`),
    );
    await expect(page.getByTestId('anotacoes-adm-reserva')).toBeVisible();
    await escolher(page.getByTestId('anotacoes-adm-categoria'), { rotulo: 'Gestão de leito' });
    await page.getByTestId('anotacoes-adm-texto').fill('Família confirma a chegada amanhã');
    await page.getByTestId('anotacoes-adm-registrar').click();
    await expect(page.getByTestId('anotacao-reserva-9100')).toBeVisible();
    expect(st.corpos.at(-1)).toMatchObject({ acao: 'registrar', reserva: RESERVA });
    await semViolacaoAxe(page, '/pep/paciente/:id/anotacoes-administrativas?reserva');
    expect(externas).toEqual([]);
  });
});
