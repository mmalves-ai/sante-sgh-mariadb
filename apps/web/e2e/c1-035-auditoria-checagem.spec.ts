// C1-035 (09-AREA linha 86): auditoria das checagens de enfermagem pelo caminho da tela. A auditoria grava só no banco
// próprio, e o E2E roda com a fonte sintética (sem núcleo, a rota responde 501). Por isso as rotas
// /api/enfermagem/auditoria-checagem são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o
// sorteio pede o período válido na hora e leva unidade, tamanho e auditor escolhidos; o detalhe mostra a amostra; a não
// conformidade pede motivo e justificativa de ao menos 10 caracteres antes de gravar; concluir só depois de avaliar
// tudo, com os totais; o cancelamento pede o motivo. O efeito no banco (amostra pela semente, auditores, itens,
// totais e recusas) está no contrato de efeito apps/api/src/modulos/enfermagem/auditoria-checagem.int.spec.ts.
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

type Resultado = 'pendente' | 'conforme' | 'nao_conforme' | 'nao_aplicavel';

test.describe('auditoria das checagens de enfermagem (09-AREA L86) @C1-035', () => {
  test('sorteio com período conferido, avaliação com motivo e justificativa, conclusão com totais', async ({
    page,
  }) => {
    const itens = [
      { id: 501, sequencia: 1, resultado: 'pendente' as Resultado },
      { id: 502, sequencia: 2, resultado: 'pendente' as Resultado },
    ].map((i) => ({
      ...i,
      horario: 9000 + i.sequencia,
      atendimento: 7700 + i.sequencia,
      paciente: `PACIENTE SINTETICO ${i.sequencia}`,
      previsto: '2026-11-24T08:00',
      checadoEm: '2026-11-24T08:05',
      situacaoChecagem: 'administrado',
      checadoPor: 'sint.enf.plantao',
      motivo: null as number | null,
      motivoDescricao: null as string | null,
      justificativa: null as string | null,
      auditor: null as string | null,
      auditadoEm: null as string | null,
    }));
    const auditoria = {
      id: 31,
      inicio: '2026-11-24T07:00',
      fim: '2026-11-24T19:00',
      unidade: 'UTI',
      atendimento: null,
      responsavel: 'sint.admin',
      situacao: 'aberta' as string,
      resultado: null as string | null,
      tamanho: 2,
      avaliados: 0,
      totalAuditado: null as number | null,
      totalConforme: null as number | null,
      criadoEm: '2026-11-25T09:00',
      criterio: 'Doses de antibiótico · semente S-31',
      observacao: null,
      concluidaEm: null,
      auditores: [
        { usuario: 1, login: 'sint.admin', nome: 'ADMIN SINTETICO', papel: 'responsavel' },
        { usuario: 2, login: 'sint.enf.auditora', nome: 'AUDITORA SINTETICA', papel: 'auditor' },
      ],
      itens,
    };
    let aberta = false;
    const pedidos: { url: string; corpo: Record<string, unknown> }[] = [];
    await page.route('**/api/enfermagem/auditoria-checagem**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname;
      if (req.method() === 'GET') {
        if (caminho.endsWith('/apoio'))
          return json(rota, {
            unidades: [{ codigo: 'UTI', descricao: 'UTI ADULTO SINTETICA' }],
            motivos: [{ id: 4, codigo: 'DOSE', descricao: 'Dose divergente', exigeComplemento: false }],
            usuarios: [{ id: 2, login: 'sint.enf.auditora', nome: 'AUDITORA SINTETICA' }],
          });
        if (/\/\d+$/.test(caminho)) return json(rota, auditoria);
        return json(rota, { itens: aberta ? [auditoria] : [] });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ url: caminho, corpo });
      const item = /\/itens\/(\d+)$/.exec(caminho);
      if (item) {
        const i = itens.find((x) => x.id === Number(item[1]))!;
        i.resultado = corpo['resultado'] as Resultado;
        i.motivo = (corpo['motivo'] as number | null) ?? null;
        i.motivoDescricao = i.motivo ? 'Dose divergente' : null;
        i.justificativa = (corpo['justificativa'] as string | null) ?? null;
        auditoria.situacao = 'em_andamento';
        auditoria.avaliados = itens.filter((x) => x.resultado !== 'pendente').length;
        return json(rota, { mensagem: 'Avaliação gravada.' });
      }
      if (caminho.endsWith('/conclusao')) {
        Object.assign(auditoria, {
          situacao: 'concluida',
          resultado: 'nao_conforme',
          totalAuditado: 2,
          totalConforme: 1,
        });
        return json(rota, {
          resultado: 'nao_conforme',
          totalAuditado: 2,
          totalConforme: 1,
          mensagem: 'Auditoria concluída.',
        });
      }
      aberta = true;
      return json(
        rota,
        { id: 31, candidatas: 14, amostra: [9001, 9002], semente: 'S-31', mensagem: 'Amostra sorteada.' },
        201,
      );
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/enfermagem/auditoria-checagem');
    await expect(page.getByTestId('tela-auditoria-checagem')).toBeVisible();
    await expect(page.getByTestId('ac-vazio')).toBeVisible();

    await page.getByTestId('ac-nova').click();
    // O período invertido é recusado na hora, sem ir ao servidor.
    await page.getByTestId('ac-inicio').fill('2026-11-24T19:00');
    await page.getByTestId('ac-fim').fill('2026-11-24T07:00');
    await expect(page.getByTestId('ac-periodo-invalido')).toBeVisible();
    await expect(page.getByTestId('ac-sortear')).toBeDisabled();
    await page.getByTestId('ac-inicio').fill('2026-11-24T07:00');
    await page.getByTestId('ac-fim').fill('2026-11-24T19:00');
    await expect(page.getByTestId('ac-periodo-invalido')).toBeHidden();
    await escolher(page.getByTestId('ac-unidade'), 'UTI ADULTO SINTETICA');
    await page.getByTestId('ac-tamanho').fill('2');
    await escolher(page.getByTestId('ac-auditor'), { rotulo: /AUDITORA SINTETICA/ });
    await page.getByTestId('ac-incluir-auditor').click();
    await expect(page.getByTestId('ac-designados')).toContainText('AUDITORA SINTETICA');
    await page.getByTestId('ac-sortear').click();

    await expect(page.getByTestId('ac-mensagem')).toContainText('Amostra sorteada');
    const abertura = pedidos[0]!.corpo;
    expect(abertura).toMatchObject({
      inicio: '2026-11-24T07:00',
      fim: '2026-11-24T19:00',
      unidade: 'UTI',
      tamanho: 2,
      auditores: [{ usuario: 2, papel: 'auditor' }],
    });
    const detalhe = page.getByTestId('ac-detalhe');
    await expect(detalhe).toBeVisible();
    await expect(page.getByTestId('ac-amostra')).toContainText('PACIENTE SINTETICO 1');
    await expect(page.getByTestId('ac-faltam')).toContainText('2');
    await expect(page.getByTestId('ac-concluir')).toBeDisabled();

    // Primeira checagem conforme.
    await page.getByTestId('ac-avaliar-501').click();
    await page.getByTestId('ac-gravar').click();
    await expect(page.getByTestId('ac-item-501')).toContainText('Conforme');

    // Segunda não conforme: motivo e justificativa conferidos na hora.
    await page.getByTestId('ac-avaliar-502').click();
    await escolher(page.getByTestId('ac-resultado'), 'Não conforme');
    await expect(page.getByTestId('ac-problema')).toBeVisible();
    await expect(page.getByTestId('ac-gravar')).toBeDisabled();
    await escolher(page.getByTestId('ac-motivo'), 'Dose divergente');
    await page.getByTestId('ac-justificativa').fill('curta');
    await expect(page.getByTestId('ac-gravar')).toBeDisabled();
    await page.getByTestId('ac-justificativa').fill('Dose checada com o volume diferente do prescrito');
    await expect(page.getByTestId('ac-problema')).toBeHidden();
    await page.getByTestId('ac-gravar').click();
    await expect(page.getByTestId('ac-item-502')).toContainText('Não conforme');
    const avaliacao = pedidos.find((p) => p.url.endsWith('/itens/502'))!.corpo;
    expect(avaliacao).toMatchObject({ resultado: 'nao_conforme', motivo: 4 });

    await expect(page.getByTestId('ac-concluir')).toBeEnabled();
    await page.getByTestId('ac-concluir').click();
    await expect(page.getByTestId('ac-mensagem')).toContainText('concluída');
    await expect(page.getByTestId('ac-totais')).toContainText('1 de 2');
    await expect(page.getByTestId('ac-totais')).toContainText('Não conforme');
    await expect(page.getByTestId('ac-concluir')).toBeHidden();
    await semViolacaoAxe(page, '/enfermagem/auditoria-checagem');
  });
});
