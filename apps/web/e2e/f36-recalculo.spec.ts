// E2E @F3.6 (05-SUP linha 16): o recálculo auditado do saldo pelo caminho da tela, entrando como
// SINT.SUPERVISOR.ESTOQUE (fonte sintética, sem banco próprio). O que passa pela API REAL, sem simulação:
//   - o estado de gravação (/api/suprimentos/gravacao): só é observado, nunca alterado; a ação
//     suprimentos.recalcularSaldos tem de vir ligada para o supervisor (permissão + liberação + catálogo do servidor);
//   - a lista (GET /api/suprimentos/recalculos) na abertura da tela, conferida pelo esquema do contrato;
//   - o pedido da prévia e o da aplicação chegam ao controller: o corpo que a tela envia é conferido pelo esquema da
//     entrada (esquemaRecalcularSaldos), e a resposta real da aplicação não pode ser recusa de permissão, liberação ou
//     entrada.
// O que é SIMULADO, e por isso NÃO é provado por este E2E: (1) o conteúdo da prévia, porque sem o banco próprio a
// porta da prévia não existe e a API responde 503 recalculo-sem-banco (conferido aqui na resposta real); (2) o sucesso
// da aplicação e a lista depois dela, porque a porta de memória não grava o recálculo (a resposta real é conferida e
// trocada pela simulada). As respostas simuladas são validadas pelos esquemas do contrato (esquemaPreviaRecalculo,
// esquemaResultadoSuprimentos, esquemaRecalculos). O efeito no banco (saldo, lotes, histórico do item, registro com
// todas as diferenças, trilha e outbox) é provado pelo contrato de efeito
// apps/api/src/modulos/suprimentos/recalculo-saldo.int.spec.ts.
import {
  esquemaPreviaRecalculo,
  esquemaRecalcularSaldos,
  esquemaRecalculos,
  esquemaResultadoSuprimentos,
} from '@sgh/contratos';
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const OP = 'suprimentos.recalcularSaldos';

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

const diferenca = (saldo: number, extra: Record<string, unknown>) => ({
  saldo,
  local: 1,
  localNome: 'LOCAL SINTETICO',
  insumo: saldo,
  insumoNome: `ITEM SINTETICO ${saldo}`,
  movimentos: 3,
  quantidadeGravada: 99,
  quantidadeRefeita: 15,
  custoGravado: 1,
  custoRefeito: 20,
  diferencaQuantidade: -84,
  diferencaValor: 201,
  negativoNoMovimento: null,
  pendencia: null,
  ...extra,
});

test.describe('recálculo auditado do saldo (05-SUP linha 16) @F3.6 @C1-073', () => {
  test('prévia com o período refeito e os pendentes, aplicação com motivo e registro na lista; axe', async ({
    page,
  }) => {
    const registros: Record<string, unknown>[] = [];
    const pedidos: Record<string, unknown>[] = [];
    let gravacao: { operacoes: Record<string, unknown> } | null = null;
    let listaReal: unknown = null;
    let aplicado = false;
    // As respostas reais e as conferências de contrato ficam registradas e são afirmadas no corpo do teste (um erro
    // dentro do tratador da rota deixaria o pedido pendurado em vez de falhar com a mensagem certa).
    const reais: { rota: 'previa' | 'aplicar'; status: number; codigo: string | undefined }[] = [];
    const contrato: string[] = [];
    const conferir = <T>(nome: string, r: { success: boolean; data?: T }): T | undefined => {
      if (!r.success) contrato.push(nome);
      return r.data;
    };
    // O estado de gravação vem do servidor e só é observado (nunca forçado).
    await page.route('**/api/suprimentos/gravacao', async (rota) => {
      const r = await rota.fetch();
      if (r.ok()) gravacao = (await r.json()) as { operacoes: Record<string, unknown> };
      return rota.fulfill({ response: r });
    });
    await page.route('**/api/suprimentos/recalculos**', async (rota) => {
      const req = rota.request();
      if (req.method() === 'GET') {
        if (!aplicado) {
          // A lista na abertura: a API real, conferida pelo esquema do contrato.
          const r = await rota.fetch();
          listaReal = conferir('lista real', esquemaRecalculos.safeParse(await r.json())) ?? null;
          return rota.fulfill({ response: r });
        }
        return json(rota, conferir('lista simulada', esquemaRecalculos.safeParse({ itens: registros })));
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      // O corpo que a tela envia é o que o controller aceita (o mesmo esquema da rota).
      conferir('entrada enviada pela tela', esquemaRecalcularSaldos.safeParse(corpo));
      pedidos.push(corpo);
      const real = await rota.fetch();
      const problema = (await real.json().catch(() => ({}))) as { codigo?: string };
      const ehPrevia = new URL(req.url()).pathname.endsWith('/previa');
      reais.push({ rota: ehPrevia ? 'previa' : 'aplicar', status: real.status(), codigo: problema.codigo });
      if (ehPrevia) {
        return json(
          rota,
          conferir(
            'prévia simulada',
            esquemaPreviaRecalculo.safeParse({
              abertura: '08/2026',
              inicio: '09/2026',
              saldos: 4,
              diferencas: [
                diferenca(11, {}),
                diferenca(12, { pendencia: 'razao-negativo', negativoNoMovimento: 2 }),
                diferenca(13, { pendencia: 'lote-divergente' }),
                diferenca(14, { pendencia: 'sem-razao', movimentos: 0 }),
              ],
              diferencaQuantidadeTotal: -84,
              diferencaValorTotal: 201,
              pendentes: 3,
            }),
          ),
        );
      }
      aplicado = true;
      registros.push({
        id: 1,
        inicio: '2026-11-24T10:00:00',
        fim: '2026-11-24T10:00:01',
        usuario: 'sint.supervisor.estoque',
        tela: null,
        terminado: true,
        competencia: '2026-09 a 2026-11',
        motivo: String(corpo['motivo']),
        insumos: 1,
        diferencaValor: 201,
      });
      return json(
        rota,
        conferir(
          'resultado simulado',
          esquemaResultadoSuprimentos.safeParse({
            mensagem: 'Recálculo aplicado.',
            repetida: false,
            ids: { id: 1 },
            avisos: [],
          }),
        ),
      );
    });

    // O supervisor do estoque tem suprimentos.recalculo.ler e .executar (fonte sintética); o SINT.ADMIN não tem o módulo.
    await entrar(page, 'SINT.SUPERVISOR.ESTOQUE');
    await page.goto('/suprimentos/recalculos');
    await expect(page.getByTestId('tela-suprimentos-recalculos')).toBeVisible();
    await expect(page.getByTestId('rec-form')).toBeVisible();
    // Sem campo de mês: o período vem do razão.
    await expect(page.getByTestId('rec-mes')).toHaveCount(0);
    await semViolacaoAxe(page, '/suprimentos/recalculos');
    // A ação vem ligada do servidor para o supervisor do estoque, e a lista real abriu pelo contrato.
    await expect.poll(() => gravacao?.operacoes[OP]).toEqual({ ligada: true, motivo: null });
    expect(listaReal).not.toBeNull();
    await expect(page.getByTestId('rec-tabela')).toBeVisible();

    // O motivo curto é recusado na hora e a prévia fica desligada.
    await page.getByTestId('rec-motivo').fill('curto');
    await expect(page.getByTestId('rec-recusas')).toContainText('ao menos 10 caracteres');
    await expect(page.getByTestId('rec-previa')).toBeDisabled();
    await page.getByTestId('rec-motivo').fill('Saldo divergente do razão no teste sintético');
    await expect(page.getByTestId('rec-recusas')).toHaveCount(0);
    await page.getByTestId('rec-previa').click();

    await expect(page.getByTestId('rec-resumo')).toContainText('desde 09/2026');
    await expect(page.getByTestId('rec-resumo')).toContainText('3 pendente(s)');
    const pend = page.getByTestId('rec-pendencia');
    await expect(pend).toHaveCount(3);
    await expect(pend.nth(0)).toContainText('negativo no movimento 2');
    await expect(pend.nth(1)).toContainText('soma dos lotes');
    await expect(pend.nth(2)).toContainText('não é zerado');
    expect(pedidos[0]).toMatchObject({ local: null, insumo: null, recalculaCusto: true });
    expect(pedidos[0]).not.toHaveProperty('ano');

    await page.getByTestId('rec-aplicar').click();
    await expect(page.getByTestId('rec-mensagem')).toContainText('Recálculo aplicado');
    expect(pedidos[1]).toMatchObject({ motivo: 'Saldo divergente do razão no teste sintético' });
    await expect(page.getByTestId('rec-tabela')).toContainText(
      'Saldo divergente do razão no teste sintético',
    );
    await expect(page.getByTestId('rec-tabela')).toContainText('2026-09 a 2026-11');

    // Sem o banco próprio a porta da prévia não existe: a API real respondeu 503 recalculo-sem-banco (por isso a prévia
    // é simulada). A aplicação real chegou à porta: nem a permissão, nem a liberação, nem a entrada a recusaram.
    expect(reais.find((x) => x.rota === 'previa')).toMatchObject({
      status: 503,
      codigo: 'recalculo-sem-banco',
    });
    const aplicar = reais.find((x) => x.rota === 'aplicar');
    expect(aplicar).toBeDefined();
    expect([401, 403]).not.toContain(aplicar?.status);
    expect(['sem-permissao', 'recurso-desligado', 'operacao-bloqueada', 'entrada-invalida']).not.toContain(
      aplicar?.codigo,
    );
    // Toda resposta (real ou simulada) e todo corpo enviado batem com os esquemas do contrato.
    expect(contrato).toEqual([]);
  });
});
