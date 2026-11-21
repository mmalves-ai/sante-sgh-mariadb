// E2E @M42 (ficha, seções 7, 8 e 10; regras 1, 2, 4, 5, 6 e 9 da onda): a conta lançada fora, conferida (auditoria) e
// fechada aqui aparece no "Acompanhamento da competência" como fechada por este sistema, com as parcelas (regra 2: a
// conta é uma só); lote, protocolo, recurso e desfecho do recurso gravados aqui aparecem nos lotes e nas gravações da
// competência; a conferência com o outro sistema sem diferença e com diferença; a aba "Onda 4" do painel de migração
// (nove setores na ordem, abertura da competência, dias sem versão, saídas externas desligadas, SUS, códigos a
// confirmar) com o início recusado fora do primeiro dia útil e aceito nele. Sessão real sobre a fonte sintética de dev e
// as portas em MEMÓRIA (nada vai à cópia). O título a pagar do repasse e a baixa do título a receber por demonstrativo
// são as jornadas do @M33 e do @M32, marcadas também com @M42 (o `--grep @M42` as roda; D-E2E-42); aqui o painel
// mostra os blocos de títulos e repasse com a leitura do setor e o motivo sem ela. axe em cada tela.
import { expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

/** POST da página com o CSRF da sessão e a Idempotency-Key, como a tela faz. */
async function postar(page: Page, url: string, data: unknown = {}) {
  const csrf = (await page.context().cookies(ORIGEM)).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: {
      'x-csrf': csrf,
      'idempotency-key': `e2e-m42-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

const hoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const mesAnterior = () => {
  const [a, m] = hoje().split('-').map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};

test.describe('Onda 4: acompanhamento da competência e critério por setor @M42 @fase4', () => {
  test.setTimeout(300_000);

  test('conta lançada fora, conferida e fechada aqui: o acompanhamento conta como deste sistema, com as parcelas; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CONTAS');
    // A conta 9001 veio do outro sistema (lançamentos da massa). Se já foi fechada por outra jornada, reabre antes.
    await page.goto('/faturamento/contas/9001');
    await expect(page.getByTestId('tela-faturamento-conta')).toBeVisible();
    if (/Fechada/.test((await page.getByTestId('cta-situacao').textContent()) ?? '')) {
      await page.getByTestId('cta-motivo').fill('Reabrir para a jornada da onda 4');
      await page.getByTestId('cta-reabrir').click();
      await expect(page.getByTestId('cta-mensagem')).toContainText('reaberta');
    }
    // Auditoria: conferência em bloco dos lançamentos.
    await page.goto('/faturamento/contas/9001/lancamentos');
    // (Se outra jornada já conferiu todos os itens, não há o que marcar.)
    await page.getByTestId('lan-marcar-todos').click();
    if (await page.getByTestId('lan-conferir').isEnabled()) {
      await page.getByTestId('lan-conferir').click();
      await expect(page.getByTestId('lan-mensagem')).toContainText('conferidos');
    }
    // Fechamento aqui.
    await page.goto('/faturamento/contas/9001');
    await page.getByTestId('cta-aba-resumo').click();
    await page.getByTestId('cta-fechar').click();
    await expect(page.getByTestId('cta-mensagem')).toContainText('Conta fechada');

    await entrar(page, 'SINT.COMPETENCIA');
    await page.goto('/relatorios/glosas');
    const ac = page.getByTestId('painel-acompanhamento');
    await expect(ac).toBeVisible();
    await expect(ac.getByTestId('ac-fechadas')).toContainText(
      /Fechadas: \d+ = [1-9]\d* por este sistema \+ \d+ pelo outro sistema/,
    );
    await expect(ac.getByTestId('ac-contas-total')).toContainText('=');
    await expect(ac.getByTestId('ac-convenios')).toContainText('91');
    // As gravações com os rótulos de produto (a operação e o setor pelo nome, nunca o identificador técnico).
    await expect(ac.locator('[data-operacao="faturamento.fecharConta"]')).toContainText(
      'Fechamento de conta',
    );
    await expect(ac.locator('[data-operacao="faturamento.fecharConta"]')).toContainText(
      'Faturamento por convênio',
    );
    await expect(ac.getByTestId('ac-gravacoes')).not.toContainText(/faturamento\.|faturamento-convenio/);
    await expect(ac.locator('[data-operacao="faturamento.conferirItem"]')).not.toContainText(/\t0$/);
    // Títulos e repasse com a leitura do setor; o movimento com a legenda a confirmar; uso sem a leitura da migração.
    await expect(ac.getByTestId('ac-titulos')).toContainText('A pagar');
    await expect(ac.getByTestId('ac-movimento')).toContainText('a confirmar');
    await expect(ac.getByTestId('ac-repasse')).toContainText('RPA');
    await expect(ac.getByTestId('ac-uso-indisponivel')).toBeVisible();
    await expect(ac).not.toContainText(/spdata|legado|sistema atual/i);
    await semViolacaoAxe(page, '/relatorios/glosas (acompanhamento da competência)');

    // Conferência com o outro sistema: os campos começam vazios (nada é copiado do lido aqui) e o chave-usuário digita
    // o relatório do outro sistema. Os valores digitados são os conhecidos da massa sintética (títulos, movimento e
    // repasse do mês, fixos na sessão sintética): conferem, sem diferença.
    await expect(ac.getByTestId('ac-copiar')).toHaveCount(0);
    await expect(ac.getByTestId('ac-inf-valor-91')).toHaveValue('');
    await expect(ac.getByTestId('ac-conferir')).toBeDisabled();
    const digitar = async (campos: Record<string, string>) => {
      for (const [id, v] of Object.entries(campos)) await ac.getByTestId(id).fill(v);
    };
    await digitar({
      'ac-inf-aPagar-titulos': '12',
      'ac-inf-aPagar-valor': '18.400,00',
      'ac-inf-aReceber-titulos': '6',
      'ac-inf-aReceber-valor': '22.310,40',
      'ac-inf-mov-lancamentos-I': '7',
      'ac-inf-mov-valor-I': '9.120,00',
      'ac-inf-mov-lancamentos-O': '11',
      'ac-inf-mov-valor-O': '13.250,50',
      'ac-inf-repasse-eventos': '3',
      'ac-inf-repasse-valorEventos': '420,00',
      'ac-inf-repasse-rpas': '2',
    });
    await ac.getByTestId('ac-conferir').click();
    await expect(ac.getByTestId('ac-sem-diferenca')).toBeVisible();
    // O bloco começado e não terminado é avisado e não vai.
    await ac.getByTestId('ac-inf-lotes-lotes').fill('1');
    await expect(ac.getByTestId('ac-incompleto')).toContainText('Lotes e protocolos');
    await expect(ac.getByTestId('ac-conferir')).toBeDisabled();
    await ac.getByTestId('ac-inf-lotes-lotes').fill('');
    // Um valor diferente no convênio 91 aparece. O convênio 92 é "só de um lado": deixado em branco, se este sistema
    // tem conta dele na competência; acrescentado pela lista com busca e digitado, se só o outro sistema o mostra.
    await digitar({ 'ac-inf-contas-91': '1', 'ac-inf-fechadas-91': '0', 'ac-inf-valor-91': '1,00' });
    if ((await ac.getByTestId('ac-inf-linha-92').count()) === 0) {
      await escolher(ac.getByTestId('ac-acrescentar-convenio'), '92');
      await ac.getByTestId('ac-acrescentar').click();
      await expect(ac.getByTestId('ac-inf-linha-92')).toContainText('OPERADORA SINTETICA 2');
      await digitar({ 'ac-inf-contas-92': '2', 'ac-inf-fechadas-92': '2', 'ac-inf-valor-92': '50,00' });
    }
    await ac.getByTestId('ac-conferir').click();
    await expect(ac.getByTestId('ac-com-diferenca')).toBeVisible();
    const dif = ac.getByTestId('ac-diferencas');
    await expect(dif.locator('[data-chave="convenio 91"]').first()).toContainText('CONVENIO SINTETICO');
    await expect(dif).toContainText('Valor');
    await expect(dif.locator('[data-chave="convenio 92"]')).toContainText('só de um lado');
    await expect(dif).not.toContainText(/convenio \d|presenca/);
    await semViolacaoAxe(page, '/relatorios/glosas (conferência)');
    await ac.getByTestId('ac-limpar').click();
    await expect(ac.getByTestId('ac-inf-valor-91')).toHaveValue('');
    await expect(ac.getByTestId('ac-resultado')).toHaveCount(0);

    // Quem não lê o financeiro nem o repasse vê o motivo, não zero.
    await entrar(page, 'SINT.TISS');
    await page.goto('/relatorios/glosas');
    await expect(page.getByTestId('ac-titulos-indisponivel')).toContainText('financeiro');
    await expect(page.getByTestId('ac-repasse-indisponivel')).toContainText('repasse');
    expect(externas).toEqual([]);
  });

  test('lote, protocolo, recurso e desfecho gravados aqui aparecem nos lotes e nas gravações da competência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.TISS');
    const prontas = (await (
      await page.request.get('/api/tiss/lotes/contas-prontas?convenio=91&tipoGuia=2')
    ).json()) as {
      conta: number;
      versao: string;
    }[];
    if (prontas.length > 0) {
      const l = await postar(page, '/api/tiss/lotes', {
        convenio: 91,
        tipoGuia: 2,
        contas: prontas.slice(0, 1).map((c) => ({ id: c.conta, versao: c.versao })),
      });
      expect(l.status(), await l.text()).toBe(200);
      const lote = (await l.json()).ids.lote as number;
      const env = await postar(page, `/api/tiss/lotes/${lote}/envio`);
      expect(env.status()).toBe(200);
      const r = (await env.json()).resposta as { protocolo: string; recibo: string };
      const p = await postar(page, `/api/tiss/lotes/${lote}/protocolo`, {
        acao: 'registrar',
        protocolo: r.protocolo,
        data: hoje(),
        recibo: r.recibo,
        situacao: 1,
      });
      expect(p.status(), await p.text()).toBe(200);
    }
    // Recurso de um item glosado pendente (decidir recorrer e recorrer) e desfecho do que já estava em recurso.
    const itens = (await (await page.request.get('/api/tiss/glosas/contas/9201')).json()) as {
      item: number;
      versao: string;
      estado: string;
    }[];
    const pendente = itens.find((i) => i.estado === 'pendente');
    if (pendente) {
      const d = await postar(page, '/api/tiss/glosas/decisao', {
        item: pendente.item,
        decisao: 'recorrer',
        texto: 'Procedimento realizado conforme prescrição',
        evidencia: 'Evolução médica do dia do atendimento',
      });
      expect(d.status(), await d.text()).toBe(200);
      const atual = (
        (await (await page.request.get('/api/tiss/glosas/contas/9201')).json()) as typeof itens
      ).find((i) => i.item === pendente.item)!;
      const rec = await postar(page, '/api/tiss/glosas/recurso', {
        itens: [{ item: atual.item, versao: atual.versao }],
        dataProtocolo: hoje(),
      });
      expect(rec.status(), await rec.text()).toBe(200);
    }
    const emRecurso = itens.find((i) => i.estado === 'recorrida');
    if (emRecurso) {
      const des = await postar(page, '/api/tiss/glosas/desfecho', {
        itens: [{ item: emRecurso.item, versao: emRecurso.versao, desfecho: 'negado', motivo: 0 }],
        data: hoje(),
        numeroDemonstrativo: 'DEM-E2E-42',
      });
      expect(des.status(), await des.text()).toBe(200);
    }

    await page.goto('/relatorios/glosas');
    const ac = page.getByTestId('painel-acompanhamento');
    await ac.getByTestId('ac-competencia').fill(mesAnterior());
    await ac.getByTestId('ac-aplicar').click();
    await expect(ac.getByTestId('ac-lotes')).toContainText(/protocolado/);
    for (const op of [
      'faturamento.gerarLote',
      'faturamento.registrarProtocolo',
      'faturamento.registrarRecurso',
      'faturamento.registrarRetornoRecurso',
    ])
      await expect(ac.locator(`[data-operacao="${op}"]`)).toBeVisible();
    await expect(ac.locator('[data-operacao="faturamento.registrarProtocolo"] td').last()).not.toHaveText(
      '0',
    );
    await expect(ac.getByTestId('ac-glosas')).toContainText('Contestado');
    // O convênio por lista com busca.
    await escolher(ac.getByTestId('ac-convenio'), '91');
    await ac.getByTestId('ac-aplicar').click();
    await expect(ac.getByTestId('ac-convenios')).not.toContainText('92 —');
    await semViolacaoAxe(page, '/relatorios/glosas (competência anterior)');
    expect(externas).toEqual([]);
  });
});
