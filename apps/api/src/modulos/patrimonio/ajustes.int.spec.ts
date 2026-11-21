// Ajustes de valor e laudos do bem (W0-08, M1) na porta própria contra o MariaDB real, cliente f22_o2 (onda 2), com
// massa SINTÉTICA (massa.spec-util.ts). O laudo anexado grava em laudo_bem (o mesmo PDF no mesmo bem não duplica) e
// volta nas leituras. O ajuste (revisão de estimativa, recuperabilidade e reavaliação) e o seu estorno ainda pedem
// modelo (pedido ao orquestrador, DDL na saída do lote 02-11): a porta recusa com `modelo-pendente`, sem gravar nada
// (o bem fica na mesma versão e a trilha não ganha linha), e a leitura dos ajustes devolve vazio. A regra do ajuste segue provada pura em @sgh/dominio-patrimonio e na memória (patrimonio-http.spec).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_PAT,
  contextoPat,
  encerrarMassaPatrimonio,
  type MassaPatrimonio,
  prepararMassaPatrimonio,
  SEM_BANCO_PAT,
  trilhaPat,
} from './massa.spec-util.js';
import { PortaPatrimonioPropria } from './porta-propria.js';

describe.skipIf(SEM_BANCO_PAT)('ajustes e laudos do bem na porta própria (MariaDB, cliente f22_o2)', () => {
  let m: MassaPatrimonio | null = null;
  let porta: PortaPatrimonioPropria;
  let bem = 0;

  beforeAll(async () => {
    m = await prepararMassaPatrimonio('J');
    porta = new PortaPatrimonioPropria(m.nucleo, CLIENTE_PAT);
    const [b] = await porta.cadastrar(
      contextoPat(m),
      {
        bens: [
          {
            empresa: 1,
            plaqueta: 'L0211-AJ1',
            descricao: 'BEM SINTETICO DO AJUSTE',
            grupo: 'maquinas',
            origem: m.origem,
            documento: 'termo',
            nota: null,
            itemNota: null,
            item: null,
            termo: { numero: 'T-AJ', data: '2025-01-05', doador: '' },
            dataAquisicao: '2025-01-05',
            valorCent: 60_000_00,
            residualCent: 0,
            vidaUtilMeses: 60,
            coeficiente: null,
            inicioDepreciacao: '2025-02',
            depreciavel: true,
            centro: m.centro1,
            localDetalhe: null,
            tipoResponsavel: null,
            responsavel: null,
            marca: null,
            modelo: null,
            numeroSerie: null,
          },
        ],
        item: null,
      },
      'l0211p.patrimonio',
      (n) => `AJ${n}`,
      trilhaPat(m, 'patrimonio.bem.cadastrado', 'bem_patrimonial', null),
    );
    bem = b!.id;
  });
  afterAll(async () => {
    await encerrarMassaPatrimonio(m);
  });

  const contarTrilha = async () =>
    Number(
      (
        await m!.nucleo.lerSomente({ cliente: CLIENTE_PAT, correlacao: 'int-0211-aj' }, (l) =>
          l.uma<{ n: number }>("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'bem_patrimonial' AND entidade_id = ?", [bem]),
        )
      )?.n,
    );

  it('registrar e estornar o ajuste: recusados com modelo-pendente, sem gravar', async () => {
    const antes = (await porta.bem(contextoPat(m!), bem))!;
    const trilhaAntes = await contarTrilha();
    for (const p of [porta.registrarAjuste(), porta.estornarAjuste()])
      await expect(p).rejects.toMatchObject({ problema: { status: 409, codigo: 'modelo-pendente' } });
    expect((await porta.bem(contextoPat(m!), bem))?.versao).toBe(antes.versao);
    expect(await contarTrilha()).toBe(trilhaAntes);
  });

  it('leitura do ajuste: vazia', async () => {
    expect(await porta.ajustes()).toEqual([]);
  });

  it('laudo: anexa ao bem, o mesmo PDF não duplica e as leituras devolvem o laudo', async () => {
    const c = contextoPat(m!);
    const sha256 = 'ab'.repeat(32);
    const dados = { bem, nome: 'laudo-sintetico.pdf', descricao: 'Laudo de teste', chave: `teste/${sha256}`, sha256, tamanho: 1234 };
    const trilha = trilhaPat(m!, 'patrimonio.laudo.anexado', 'laudo_bem', bem);
    const l = await porta.anexarLaudo(c, dados, 'teste', trilha);
    expect(l).toMatchObject({ bem, nome: 'laudo-sintetico.pdf', descricao: 'Laudo de teste', sha256, tamanho: 1234 });
    expect(l.enviadoEm).not.toBe('');
    expect((await porta.anexarLaudo(c, dados, 'teste', trilha)).id).toBe(l.id);
    expect(await porta.laudos(c, bem)).toEqual([l]);
    expect(await porta.laudo(c, l.id)).toEqual(l);
    expect(await porta.laudo(c, l.id + 1_000_000)).toBeNull();
  });
});
