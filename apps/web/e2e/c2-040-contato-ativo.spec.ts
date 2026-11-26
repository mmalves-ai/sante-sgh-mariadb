// E2E @C2-040 (F8, 02-REC linha 39): contato ativo com o paciente antes da consulta pelo caminho da tela
// (`/agenda/consultas/contato-ativo`). A central vê a fila (quem disse "não" à mensagem em primeiro, com o destaque),
// abre o registro na própria linha, vê na hora o que vai acontecer (sem resultado, recusa; "desistiu", cancela e
// devolve a vaga), grava e a fila se atualiza; o histórico do paciente abre na mesma tela. O contato ativo só existe no
// banco do cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA, no contrato do servidor. O efeito no banco está em apps/api/src/modulos/agenda/contato-ativo.int.spec.ts.
// Segundo caso: os programados fora da fila (busca ativa avulsa e o pendente de consulta já encerrada) são feitos na
// própria lista, e a programação (da linha da consulta e do histórico do paciente) é validada na hora.
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

const RESULTADOS = [
  {
    id: 1,
    codigo: 'confirmou',
    descricao: 'Paciente confirmou a consulta',
    sucesso: true,
    encerraTentativas: true,
    efeitoMarcacao: 'confirmar',
  },
  {
    id: 2,
    codigo: 'desistiu',
    descricao: 'Paciente desistiu da consulta',
    sucesso: true,
    encerraTentativas: true,
    efeitoMarcacao: 'cancelar',
  },
  {
    id: 3,
    codigo: 'nao_atendeu',
    descricao: 'Não atendeu',
    sucesso: false,
    encerraTentativas: false,
    efeitoMarcacao: null,
  },
];
const item = (marcacao: number, negativa: boolean, horas: number) => ({
  marcacao,
  paciente: 9400 + marcacao,
  nome: `PACIENTE SINTETICO C2040 ${marcacao}`,
  prontuario: 90000 + marcacao,
  telefone: '11999990040',
  agenda: 'AGENDA SINTETICA C2040',
  inicioEm: new Date(Date.now() + horas * 3_600_000).toISOString(),
  respostaNegativa: negativa,
  tentativas: 0,
  contatoPendente: null,
  programadoPara: null,
});

const programado = (id: number, marcacao: number | null, motivo: string, encerrada: boolean) => ({
  id,
  paciente: 9403,
  nome: 'PACIENTE SINTETICO C2040 3',
  marcacao,
  canal: 'telefone',
  motivo,
  situacao: 'pendente',
  resultado: null,
  programadoPara: new Date(Date.now() - 3_600_000).toISOString(),
  contatoEm: null,
  informante: null,
  descricao: null,
  anterior: null,
  marcacaoEncerrada: encerrada,
});
/** Data e hora local no formato do campo datetime-local. */
const campo = (horas: number) => {
  const d = new Date(Date.now() + horas * 3_600_000);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};

function simular(page: Page) {
  const st = {
    itens: [item(2, true, 50), item(1, false, 30)],
    programados: [programado(9701, null, 'busca_ativa', false), programado(9702, 5, 'lembrete', true)],
    corpos: [] as Record<string, unknown>[],
    programacoes: [] as Record<string, unknown>[],
  };
  void page.route('**/api/agenda/contato-ativo**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/resultados')) return json(r, RESULTADOS);
    if (url.pathname.includes('/pacientes/'))
      return json(r, [
        {
          id: 9601,
          paciente: 9402,
          nome: 'PACIENTE SINTETICO C2040 2',
          marcacao: 2,
          canal: 'telefone',
          motivo: 'confirmacao_marcacao',
          situacao: 'realizado',
          resultado: 'Paciente desistiu da consulta',
          programadoPara: null,
          contatoEm: new Date().toISOString(),
          informante: null,
          descricao: 'Viaja na data (sintético).',
          anterior: null,
          marcacaoEncerrada: false,
        },
      ]);
    if (r.request().method() === 'GET') return json(r, { itens: st.itens, programados: st.programados });
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    if (url.pathname.endsWith('/programar')) {
      st.programacoes.push(corpo);
      return json(r, {
        ok: true,
        resultado: { contato: 9801 },
        repetida: false,
        mensagem: 'Contato programado.',
      });
    }
    st.corpos.push(corpo);
    if (corpo['pendente'] !== null && corpo['marcacao'] === null) {
      st.programados = st.programados.filter((c) => c.id !== corpo['pendente']);
      return json(r, {
        ok: true,
        resultado: { contato: Number(corpo['pendente']), efeito: null, novaTentativa: 9802, alertas: [] },
        repetida: false,
        mensagem: 'Contato registrado.',
      });
    }
    st.itens = st.itens.filter((i) => i.marcacao !== corpo['marcacao']);
    return json(r, {
      ok: true,
      resultado: {
        contato: 9601,
        efeito: 'cancelar',
        novaTentativa: null,
        alertas: [],
        pendentesEncerrados: 1,
        esperaCompativel: 2,
      },
      repetida: false,
      mensagem: 'Contato registrado.',
    });
  });
  return st;
}

test.describe('@C2-040 contato ativo antes da consulta', () => {
  test('a resposta negativa vem primeiro e a desistência cancela com a previsão na hora', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/contato-ativo');
    const linhas = page.getByTestId('contato-fila').locator('tbody tr');
    await expect(linhas.first()).toHaveAttribute('data-testid', 'contato-item-2');
    await expect(page.getByTestId('contato-negativa-2')).toHaveText('Disse não na mensagem');

    // Registro na linha: sem resultado, recusa na hora e o botão fica desabilitado.
    await page.getByTestId('contato-registrar-2').click();
    await expect(page.getByTestId('contato-recusa')).toContainText('resultado');
    await expect(page.getByTestId('contato-gravar')).toBeDisabled();
    await escolher(page.getByTestId('contato-edicao').getByLabel('Resultado'), 'desistiu');
    await expect(page.getByTestId('contato-previsao')).toContainText('cancelada pela desistência');
    await page.getByTestId('contato-descricao').locator('input, textarea').first().fill('Viaja na data.');
    await page.getByTestId('contato-gravar').click();
    await expect(page.getByTestId('contato-mensagem')).toHaveText(
      'Contato registrado. 1 contato programado da consulta encerrado.',
    );
    expect(st.corpos[0]).toMatchObject({
      paciente: 9402,
      marcacao: 2,
      canal: 'telefone',
      motivo: 'confirmacao_marcacao',
      resultado: 'desistiu',
      descricao: 'Viaja na data.',
      pendente: null,
    });
    await expect(page.getByTestId('contato-item-2')).toHaveCount(0);
    // A vaga liberada avisa a lista de espera, com o atalho.
    await expect(page.getByTestId('contato-mensagem')).toContainText(
      '1 contato programado da consulta encerrado',
    );
    await expect(page.getByTestId('contato-espera')).toContainText('2 pedidos da lista de espera');
    await expect(page.getByTestId('contato-espera').getByRole('link')).toHaveAttribute(
      'href',
      '/agenda/espera',
    );

    // Visão por paciente: o histórico abre na mesma tela.
    await page.getByTestId('contato-historico-1').click();
    await expect(page.getByTestId('contato-historico')).toContainText('Paciente desistiu da consulta');

    await semViolacaoAxe(page, 'contato ativo antes da consulta');
    expect(externas).toEqual([]);
  });

  test('programados fora da fila são feitos na lista e a programação valida na hora', async ({ page }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/contato-ativo');

    // O pendente de consulta já encerrada aparece marcado (a central cancela).
    await expect(page.getByTestId('contato-orfao-9702')).toContainText('Consulta já encerrada');
    await expect(page.getByTestId('contato-orfao-9701')).toHaveCount(0);

    // Registrar o programado avulso (busca ativa): resultado que confirma é recusado na hora; sem sucesso grava.
    await page.getByTestId('contato-programado-registrar-9701').click();
    const edicao = page.getByTestId('contato-edicao');
    await expect(edicao).toContainText('Busca ativa');
    await escolher(edicao.getByLabel('Resultado'), 'confirmou');
    await expect(page.getByTestId('contato-recusa')).toContainText('contato avulso');
    await expect(page.getByTestId('contato-gravar')).toBeDisabled();
    await escolher(edicao.getByLabel('Resultado'), 'nao_atendeu');
    await expect(page.getByTestId('contato-previsao')).toContainText('próxima tentativa');
    await page.getByTestId('contato-gravar').click();
    await expect(page.getByTestId('contato-mensagem')).toContainText('Nova tentativa programada.');
    expect(st.corpos[0]).toMatchObject({
      paciente: 9403,
      marcacao: null,
      pendente: 9701,
      motivo: 'busca_ativa',
      resultado: 'nao_atendeu',
    });
    await expect(page.getByTestId('contato-programado-9701')).toHaveCount(0);

    // Programar da linha da consulta: lembrete, a data no passado é recusada na hora.
    await page.getByTestId('contato-programar-1').click();
    const prog = page.getByTestId('contato-programacao');
    await page.getByTestId('programar-quando').fill(campo(-24));
    await expect(page.getByTestId('programar-recusa')).toContainText('agora ou depois');
    await expect(page.getByTestId('programar-gravar')).toBeDisabled();
    await page.getByTestId('programar-quando').fill(campo(40));
    await expect(page.getByTestId('programar-recusa')).toContainText('antes da consulta');
    await page.getByTestId('programar-quando').fill(campo(2));
    await expect(page.getByTestId('programar-recusa')).toHaveCount(0);
    await escolher(prog.getByLabel('Canal'), 'whatsapp');
    await page.getByTestId('programar-gravar').click();
    await expect(page.getByTestId('contato-mensagem')).toHaveText('Contato programado.');
    expect(st.programacoes[0]).toMatchObject({
      paciente: 9401,
      marcacao: 1,
      canal: 'whatsapp',
      motivo: 'lembrete',
    });

    // Programar do histórico do paciente, sem consulta: resultado de exame.
    await page.getByTestId('contato-historico-1').click();
    await page.getByTestId('contato-historico-programar').click();
    await escolher(prog.getByLabel('Motivo'), 'lembrete');
    await expect(page.getByTestId('programar-recusa')).toContainText('escolha a consulta');
    await escolher(prog.getByLabel('Motivo'), 'resultado_exame');
    await page.getByTestId('programar-assunto').locator('input, textarea').first().fill('Retorno do exame.');
    await page.getByTestId('programar-gravar').click();
    expect(st.programacoes[1]).toMatchObject({
      paciente: 9401,
      marcacao: null,
      motivo: 'resultado_exame',
      assunto: 'Retorno do exame.',
    });

    await semViolacaoAxe(page, 'contato ativo: programados e programação');
    expect(externas).toEqual([]);
  });
});
