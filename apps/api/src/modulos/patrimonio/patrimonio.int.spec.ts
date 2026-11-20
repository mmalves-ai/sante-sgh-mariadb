// Integração do patrimônio (M54, etapa 6; ficha, F6) na cópia, numa transação SEMPRE desfeita, com o escritor só SGH_
// (somenteSgh) e o serviço da API sobre a porta das transações:
//   1. as leituras (domínios do patrimônio, notas fiscais de entrada de 2026-03 pelo índice de ANO, itens da nota), cada
//      uma abaixo de 2 s;
//   2. o ciclo gravado: cadastrar um bem do item de uma nota real (valor da unidade, plaqueta pela sequência), achar
//      pelo QR, a prévia da depreciação (com os parâmetros do patrimônio da empresa como estão no banco) e o cálculo
//      gravado pelas regras puras (a cota e a acumulada), alterar, transferir com o aceite de outra pessoa, emprestar e
//      devolver, baixar, inventariar pelo QR e encerrar;
//   3. as contagens de SGH_PAT_* e da trilha iguais antes e depois do ROLLBACK.
// Só contagens, tempos e IDs técnicos saem no log (o fornecedor e o item da nota não são impressos).
import {
  calcularDepreciacaoSgh,
  contagensPatrimonioSgh,
  type Leitor,
  lerDominiosPatrimonio,
  lerNotasEntrada,
  somenteSgh,
} from '@sgh/legado';
import { planoDaDepreciacao, resumoDoCalculo } from '@sgh/dominio-patrimonio';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { portaPatrimonioNasTransacoes } from './porta-legado.js';
import { hojeNoEstabelecimento, ServicoPatrimonio, type SessaoPatrimonio } from './servico.js';

const COMPETENCIA_NOTAS = '2026-03';

function medir(msg: string): void {
  const pasta = resolve(import.meta.dirname, '../../../../../.tmp');
  mkdirSync(pasta, { recursive: true });
  appendFileSync(resolve(pasta, 'm54-e6-int.log'), `${new Date().toISOString()} ${msg}\n`);
}

async function cronometrar<T>(nome: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  const ms = Math.round(performance.now() - t0);
  medir(`${nome}: ${ms} ms`);
  expect(ms, `${nome} em ${ms} ms`).toBeLessThan(2000);
  return r;
}

const contagens = (l: Leitor) => contagensPatrimonioSgh(l);

function sessao(hospital: string, rede: string, login: string): SessaoPatrimonio {
  return {
    rede,
    hospital,
    login,
    centrosQueRecebe: null,
    pode: () => true,
    trilha: (evento, operacao, tabela, id) => ({
      rede,
      hospital,
      usuario: login,
      evento,
      recurso: 'patrimonio',
      operacao,
      tabelaAlvo: tabela,
      idAlvo: id === null ? null : String(id),
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: null,
      correlacao: 'int-m54e6',
    }),
  };
}

describe.skipIf(!PODE_ESCREVER)('patrimônio na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  const retrato = () => a.nucleo.lerSomente({ ...a.c, traceId: 'int-m54e6-contagens' }, contagens);
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('leituras dos domínios e das notas de entrada de 2026-03, cada uma abaixo de 2 s', async () => {
    await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m54e6-leituras' }, async (l) => {
      await lerDominiosPatrimonio(l);
      const d = await cronometrar('dominios', () => lerDominiosPatrimonio(l));
      await lerNotasEntrada(l, 2026, 3);
      const n = await cronometrar('notas 2026-03', () => lerNotasEntrada(l, 2026, 3));
      medir(
        `origens=${d.origens.length} coeficientes=${d.coeficientes.length} centros=${d.centros.length}` +
          ` empresas=${d.empresas.length} parametros=${JSON.stringify(d.parametros)} notas=${n.notas.length} truncado=${n.truncado}`,
      );
      expect(d.origens.length).toBeGreaterThan(0);
      expect(d.coeficientes.length).toBeGreaterThan(0);
      expect(n.notas.length).toBeGreaterThan(0);
    });
  });

  it('o ciclo do bem: nota → bem → depreciação → transferência com aceite → baixa → inventário; ROLLBACK', async () => {
    const antes = await retrato();
    let dentro: Record<string, number> = {};
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m54e6' }, async (e0) => {
      const e = somenteSgh(e0);
      const servico = new ServicoPatrimonio(portaPatrimonioNasTransacoes(new Map([[a.cod, e]])));
      const s = sessao(a.cod, a.c.rede, 'SINT.PATRIMONIO');
      const outro = sessao(a.cod, a.c.rede, 'SINT.PATRIMONIO.SETOR');

      const apoio = await cronometrar('apoio', () =>
        servico.apoio(s, true, {
          cadastrar: 'x',
          calcular: 'x',
          registrar: 'x',
          aceitar: 'x',
          baixar: 'x',
          contar: 'x',
        }),
      );
      const ativos = apoio.centros.filter((c) => c.ativo);
      expect(ativos.length).toBeGreaterThan(1);
      const [setorA, setorB] = ativos as [(typeof ativos)[0], (typeof ativos)[0]];

      // 1. a nota com um item que pode virar bem (valor positivo, unidade sem bem)
      const { notas } = await cronometrar('notas', () =>
        servico.notas(s, { competencia: COMPETENCIA_NOTAS }),
      );
      let escolha: { nota: number; item: number; valor: number } | null = null;
      for (const n of notas.slice(0, 20)) {
        const r = await servico.itensDaNota(s, n.id);
        const it = r.itens.find((i) => i.disponiveis > 0 && i.valorUnitarioCent > 100 && n.data !== null);
        if (it) {
          escolha = { nota: n.id, item: it.id, valor: it.valorUnitarioCent };
          break;
        }
      }
      expect(escolha).not.toBeNull();
      const cad = await cronometrar('cadastrar', () =>
        servico.cadastrar(
          s,
          {
            documento: 'nota',
            nota: escolha!.nota,
            itemNota: escolha!.item,
            descricao: 'Bem de integração sintético',
            grupo: 'equipamentoMedico',
            origem: apoio.origens[0]!.id,
            centro: setorA.id,
            localDetalhe: null,
            tipoResponsavel: null,
            responsavel: null,
            marca: null,
            modelo: null,
            numeroSerie: null,
            plaqueta: null,
            vidaUtilMeses: 12,
            residualCent: 0,
            coeficiente: null,
            inicioDepreciacao: null,
            depreciavel: true,
            quantidade: 1,
          },
          'patrimonio.bem.cadastrado',
        ),
      );
      const bem = cad.bens[0]!;
      // D-TRAVA-ITEM-546: o cadastro simultâneo do MESMO item em outra transação (a tela leu as mesmas unidades livres)
      // espera a linha-guarda do item, ainda não confirmada, e sai `desatualizado`: o item não vira mais bens que unidades.
      const t0 = performance.now();
      await expect(
        a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m54e6-corrida' }, async (e1) => {
          const concorrente = new ServicoPatrimonio(
            portaPatrimonioNasTransacoes(new Map([[a.cod, somenteSgh(e1)]])),
          );
          await concorrente.cadastrar(
            outro,
            {
              documento: 'nota',
              nota: escolha!.nota,
              itemNota: escolha!.item,
              descricao: 'Bem de integração sintético',
              grupo: 'equipamentoMedico',
              origem: apoio.origens[0]!.id,
              centro: setorA.id,
              localDetalhe: null,
              tipoResponsavel: null,
              responsavel: null,
              marca: null,
              modelo: null,
              numeroSerie: null,
              plaqueta: null,
              vidaUtilMeses: 12,
              residualCent: 0,
              coeficiente: null,
              inicioDepreciacao: null,
              depreciavel: true,
              quantidade: 1,
            },
            'patrimonio.bem.cadastrado',
          );
        }),
      ).rejects.toMatchObject({ problema: { codigo: 'desatualizado' } });
      medir(`corrida do item: ${Math.round(performance.now() - t0)} ms (espera da linha-guarda)`);
      expect(bem.valorCent).toBeGreaterThanOrEqual(escolha!.valor);
      expect(bem.plaqueta).toMatch(/^[A-Z0-9]+\d{6}$/);
      expect((await servico.porCodigo(s, bem.qr)).id).toBe(bem.id);
      expect((await servico.listar(s, { busca: bem.plaqueta, pagina: 1, tamanho: 10 })).total).toBe(1);

      // 2. depreciação: a prévia com os parâmetros como estão; o cálculo gravado pelas regras puras
      const previa = await cronometrar('previa', () =>
        servico.depreciacao(s, { empresa: bem.empresa, competencia: bem.inicioDepreciacao }),
      );
      medir(`previa: cotas=${previa.cotas.length} impedimentos=${JSON.stringify(previa.impedimentos)}`);
      expect(previa.cotas.some((c) => c.bem === bem.id)).toBe(true);
      expect(previa.totalCent).toBe(previa.cotas.reduce((t, c) => t + c.valorCent, 0));
      const par = { aplicarCoeficiente: false, considerarResidual: false };
      const calcular = () =>
        calcularDepreciacaoSgh(
          e,
          { empresa: bem.empresa, competencia: bem.inicioDepreciacao },
          s.login,
          ({ bens }) => {
            const p = planoDaDepreciacao(
              bens.map((b) => ({ ...b, grupo: 'equipamentoMedico' as const })),
              bem.inicioDepreciacao,
              par,
            );
            return {
              impedimentos: [],
              cotas: p.cotas,
              ignorados: p.semCota.length,
              totalCent: p.totalCent,
              resumo: resumoDoCalculo(p),
            };
          },
        );
      const primeiro = await calcular();
      expect(primeiro.calculo.rodada).toBe(1);
      // W0-08, parte 5: o estorno do último cálculo (fato novo com motivo, origem e quem; o cálculo e as cotas ficam)
      const estornado = await servico.estornar(
        s,
        {
          empresa: bem.empresa,
          competencia: bem.inicioDepreciacao,
          motivo: 'Estorno de integração sintético',
        },
        'patrimonio.depreciacao.estornada',
      );
      medir(
        `estorno: estornos=${estornado.estornos.length} calculo=${String(estornado.calculo?.id ?? null)}`,
      );
      expect(estornado.calculo).toBeNull();
      expect(estornado.estornos[0]).toMatchObject({
        calculo: primeiro.calculo.id,
        origem: 'patrimonio/estorno-depreciacao',
        motivo: 'Estorno de integração sintético',
      });
      expect((await servico.detalhe(s, bem.id)).acumuladaCent).toBe(0);
      await expect(
        servico.estornar(
          s,
          { empresa: bem.empresa, competencia: bem.inicioDepreciacao, motivo: 'De novo, sem cálculo' },
          'x',
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'sem-calculo' } });
      // A competência estornada se calcula de novo (rodada 2), sem apagar nada.
      const r = await calcular();
      expect(r.calculo.rodada).toBe(2);
      expect(r.calculo.totalCent).toBe(r.plano.totalCent);
      const depois = await servico.detalhe(s, bem.id);
      expect(depois.acumuladaCent).toBe(Math.round(bem.valorCent / 12));
      expect(depois.contabilCent).toBe(depois.valorCent - depois.acumuladaCent);
      const gravada = await servico.depreciacao(s, {
        empresa: bem.empresa,
        competencia: bem.inicioDepreciacao,
      });
      expect(gravada.calculo?.id).toBe(r.calculo.id);

      // 3. alterar (sem mexer na depreciação já gravada), transferir com o aceite de outra pessoa
      const alt = await servico.alterar(
        s,
        bem.id,
        {
          descricao: 'Bem de integração sintético alterado',
          grupo: 'equipamentoMedico',
          localDetalhe: 'Sala 1',
          tipoResponsavel: null,
          responsavel: null,
          marca: null,
          modelo: null,
          numeroSerie: null,
          vidaUtilMeses: 12,
          residualCent: 0,
          coeficiente: null,
          inicioDepreciacao: bem.inicioDepreciacao,
          depreciavel: true,
          versao: depois.versao,
        },
        'patrimonio.bem.alterado',
      );
      expect(alt.mudou).toBe(true);
      // A data do estabelecimento (America/Sao_Paulo), não a UTC: depois das 21 h, a UTC já é amanhã (data futura).
      const hoje = hojeNoEstabelecimento();
      const t = await servico.registrar(
        s,
        {
          tipo: 'transferencia',
          bem: bem.id,
          versao: alt.bem.versao,
          data: hoje,
          motivo: 'Integração',
          destino: setorB.id,
          destinoResponsavel: null,
        },
        'patrimonio.movimento.registrado',
      );
      expect(t.movimento.situacao).toBe('pendente');
      await expect(
        servico.decidir(
          s,
          t.movimento.id,
          { aceitar: true, motivo: null, versao: t.movimento.versao },
          'patrimonio.movimento.decidido',
        ),
      ).rejects.toThrow();
      const ac = await servico.decidir(
        outro,
        t.movimento.id,
        { aceitar: true, motivo: null, versao: t.movimento.versao },
        'patrimonio.movimento.decidido',
      );
      expect(ac.bem.centro.id).toBe(setorB.id);

      // 4. emprestar, devolver e baixar
      const emp = await servico.registrar(
        s,
        {
          tipo: 'emprestimo',
          bem: bem.id,
          versao: ac.bem.versao,
          data: hoje,
          motivo: 'Integração',
          terceiro: 'Parceiro sintético',
          retornoPrevisto: null,
          termoNumero: null,
        },
        'patrimonio.movimento.registrado',
      );
      const dev = await servico.registrar(
        s,
        { tipo: 'devolucao', bem: bem.id, versao: emp.bem.versao, data: hoje, motivo: 'Integração' },
        'patrimonio.movimento.registrado',
      );
      expect(dev.movimento.referencia).toBe(emp.movimento.id);

      // 5. inventário pelo QR no setor de destino (antes da baixa) e encerramento
      const inv = await servico.abrirInventario(
        s,
        { descricao: 'Inventário de integração', centro: setorB.id },
        'patrimonio.inventario.aberto',
      );
      expect(inv.resumo.esperados).toBeGreaterThanOrEqual(1);
      const l1 = await servico.ler(
        s,
        inv.id,
        { codigo: bem.qr, centro: setorB.id, observacao: null },
        'patrimonio.inventario.leitura',
      );
      expect(l1.leitura.resultado).toBe('conforme');
      const l2 = await servico.ler(
        s,
        inv.id,
        { codigo: bem.plaqueta, centro: setorB.id, observacao: null },
        'patrimonio.inventario.leitura',
      );
      expect(l2.leitura.resultado).toBe('repetida');
      const enc = await servico.encerrar(s, inv.id, 'patrimonio.inventario.encerrado');
      expect(enc.situacao).toBe('encerrado');
      expect(enc.resumo.porResultado.conforme).toBe(1);
      // W0-08: o inventário aberto se cancela com motivo; a leitura feita fica; o cancelado recusa leitura nova
      const inv2 = await servico.abrirInventario(
        s,
        { descricao: 'Inventário de integração a cancelar', centro: setorB.id },
        'patrimonio.inventario.aberto',
      );
      await servico.ler(
        s,
        inv2.id,
        { codigo: bem.qr, centro: setorB.id, observacao: null },
        'patrimonio.inventario.leitura',
      );
      const cancelado = await servico.cancelarInventario(
        s,
        inv2.id,
        { motivo: 'Cancelamento de integração' },
        'patrimonio.inventario.cancelado',
      );
      expect(cancelado).toMatchObject({
        situacao: 'cancelado',
        motivoCancelamento: 'Cancelamento de integração',
      });
      expect(cancelado.leituras).toHaveLength(1);
      const recusa = await servico
        .ler(s, inv2.id, { codigo: bem.qr, centro: setorB.id, observacao: null }, 'x')
        .then(
          () => null,
          (e: unknown) => e as { getStatus: () => number },
        );
      expect(recusa?.getStatus()).toBe(409);

      const bx = await servico.registrar(
        s,
        {
          tipo: 'baixa',
          bem: bem.id,
          versao: dev.bem.versao,
          data: hoje,
          motivo: 'Integração',
          termoNumero: 'TB-INT',
          valorVendaCent: null,
        },
        'patrimonio.movimento.registrado',
      );
      expect(bx.bem.situacao).toBe('baixado');
      dentro = await contagens(e);
    });
    const depois = await retrato();
    medir(
      `contagens antes=${JSON.stringify(antes)} dentro=${JSON.stringify(dentro)} depois=${JSON.stringify(depois)}`,
    );
    expect(dentro['SGH_PAT_BEM']).toBe((antes['SGH_PAT_BEM'] ?? 0) + 1);
    expect(dentro['SGH_PAT_MOVIMENTO']).toBe((antes['SGH_PAT_MOVIMENTO'] ?? 0) + 4);
    expect(dentro['SGH_TRILHA']).toBeGreaterThan(antes['SGH_TRILHA'] ?? 0);
    expect(depois).toEqual(antes);
  }, 600_000);
});
