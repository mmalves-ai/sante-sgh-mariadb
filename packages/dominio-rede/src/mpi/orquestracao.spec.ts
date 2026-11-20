// Orquestração entre os bancos (M57, etapa 1; regras 1, 4 e 5): o ciclo de pareamento com massa sintética (automático,
// fila, duplicado local à fila do cadastro, inelegível, já decidido, marca d'água, banco fora), a execução do plano banco
// a banco (pendente; todos fora), o relatório de divergência (lotes) e o reparo (o par sai da fila; pessoa diferente
// para revisão humana; idempotente). Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import { planejarDesfazer } from './desfazer.js';
import { cadastro, CPF_A, CPF_B, cpfSintetico } from './massa.spec-util.js';
import {
  cicloPareamentoRede,
  divergenciasRede,
  proximoCursorAlterados,
  ErroBancosIndisponiveis,
  executarPlanoRede,
  repararIndiceRede,
  vinculosPorBanco,
} from './orquestracao.js';
import { lido, PortaIndiceMemoria } from './porta-memoria.spec-util.js';
import { planejarVinculo } from './vincular.js';

const EM = '2026-10-24T12:00:00.000Z';
const CPF_C = cpfSintetico('555550003');

function massa() {
  const a = (extra: Parameters<typeof cadastro>[0]) => lido(cadastro({ estabelecimento: 'hs', ...extra }));
  const p = (extra: Parameters<typeof cadastro>[0]) => lido(cadastro({ estabelecimento: 'pc', ...extra }));
  return new PortaIndiceMemoria({
    hs: [
      a({ id: 1, idUnificado: 1, prontuario: 11 }),
      // Mesmo CPF no mesmo banco: duplicado local (regra 5).
      a({ id: 2, idUnificado: 2, prontuario: 12, cpf: CPF_B, nome: 'BRUNO TESTE FICTICIO' }),
      a({ id: 3, idUnificado: 3, prontuario: 13, cpf: CPF_B, nome: 'BRUNO TESTE FICTICIO' }),
      // Inativo: não pareia.
      a({ id: 4, idUnificado: 4, prontuario: 14, cpf: CPF_C, ativo: false }),
      // Sem CPF e sem a mãe, nome e nascimento iguais: só sugere (fila, pontuação 50).
      a({
        id: 5,
        idUnificado: 5,
        prontuario: 15,
        cpf: null,
        mae: null,
        nome: 'CARLA TESTE FICTICIA',
        nascimento: '1990-02-01',
      }),
    ],
    pc: [
      p({ id: 101, idUnificado: 101, prontuario: 1101 }),
      p({
        id: 105,
        idUnificado: 105,
        prontuario: 1105,
        cpf: null,
        nome: 'CARLA TESTE FICTICIA',
        nascimento: '1990-02-01',
      }),
      p({ id: 106, idUnificado: 106, prontuario: 1106, cpf: CPF_C }),
    ],
  });
}

let n = 0;
const opcoes = {
  lote: 50,
  por: 'SINT.GESTOR',
  em: EM,
  usuarioAutomatico: 'SGH.REDE',
  novaPessoa: () => `pessoa-sintetica-${++n}`,
  eventoCiclo: 'rede.fila.atualizada',
};

describe('ciclo de pareamento entre os bancos', () => {
  it("automático nos dois bancos, fila, duplicado local, inelegível e marca d'água", async () => {
    const porta = massa();
    const avisos: string[] = [];
    const r = await cicloPareamentoRede(porta, ['hs', 'pc'], { ...opcoes, aviso: (m) => avisos.push(m) });
    expect(r).toMatchObject({ automaticos: 1, naFila: 1, duplicadosLocais: 1, inelegiveis: 1 });
    expect(r.lidos).toBe(8);
    expect(r.marcas).toEqual([
      { estabelecimento: 'hs', ultimoId: 5, ultimaAtualizacao: '2026-10-01T10:00:00.000Z' },
      { estabelecimento: 'pc', ultimoId: 106, ultimaAtualizacao: '2026-10-01T10:00:00.000Z' },
    ]);
    const hs = porta.b('hs');
    const pc = porta.b('pc');
    expect(hs.vinculos.get('hs:1|pc:101')?.pessoa).toBe(pc.vinculos.get('hs:1|pc:101')?.pessoa);
    expect(hs.candidatos.get('hs:1|pc:101')?.situacao).toBe('vinculado');
    expect(pc.candidatos.get('hs:5|pc:105')).toMatchObject({ situacao: 'aberto', idLocal: 105, idRemoto: 5 });
    expect(hs.duplicidades).toHaveLength(1);
    expect(hs.duplicidades[0]).toMatchObject({ a: { id: 2 }, b: { id: 3 }, criterios: ['cpf'] });
    expect(hs.rotulos.at(-1)).toMatchObject({
      evento: 'rede.fila.atualizada',
      chave: expect.stringContaining('auto=1'),
    });
    expect(avisos).toEqual([]);
    // Segundo ciclo sem alteração: nada relido (o cursor por carimbo e ID não relê o empate).
    expect((await cicloPareamentoRede(porta, ['hs', 'pc'], opcoes)).lidos).toBe(0);
    // Com o cadastro alterado: o vinculado é "já decidido", nada duplicado, a marca não volta.
    porta.b('hs').cadastros[0] = { ...porta.b('hs').cadastros[0]!, atualizadoEm: '2026-10-02T10:00:00.000' };
    const de = await cicloPareamentoRede(porta, ['hs', 'pc'], opcoes);
    expect(de.automaticos).toBe(0);
    expect(de.descartados).toBeGreaterThan(0);
    expect(porta.b('pc').vinculos.size).toBe(1);
    expect(de.marcas[1]).toMatchObject({ ultimoId: 106 });
  });

  it('banco fora: a marca dele não anda; pessoas diferentes já ligadas ficam na fila', async () => {
    const porta = massa();
    // Os dois lados do par automático já ligados a pessoas diferentes.
    for (const [est, id, pessoa] of [
      ['hs', 1, 'pessoa-x-aaaaaaaa'],
      ['pc', 101, 'pessoa-y-bbbbbbbb'],
    ] as const)
      porta.b(est).vinculos.set(`outro-${id}`, {
        estabelecimento: est,
        chave: `outro-${id}`,
        pessoa,
        idLocal: id,
        prontuarioLocal: 1,
        estabelecimentoRemoto: 'zz',
        idRemoto: 9,
        prontuarioRemoto: 9,
        origem: 'humano',
        situacao: 'ativo',
        criadoPor: 'X',
        criadoEm: EM,
        desfeitoPor: null,
        desfeitoEm: null,
        justificativa: null,
        id: 900,
      });
    porta.falhar.add('pc');
    const avisos: string[] = [];
    const r = await cicloPareamentoRede(porta, ['hs', 'pc'], {
      ...opcoes,
      lote: 0,
      aviso: (m) => avisos.push(m),
    });
    expect(r.naFila).toBe(1);
    expect(r.automaticos).toBe(0);
    expect(r.marcas.find((m) => m.estabelecimento === 'pc')).toEqual({
      estabelecimento: 'pc',
      ultimoId: 0,
      ultimaAtualizacao: null,
    });
    expect(avisos.some((a) => a.includes('pc'))).toBe(true);
    expect(porta.b('hs').candidatos.get('hs:1|pc:101')?.situacao).toBe('aberto');
  });

  it('desfazer com "devolver à fila": o cadastro alterado e o ciclo seguinte NÃO religam o par', async () => {
    const porta = massa();
    await cicloPareamentoRede(porta, ['hs', 'pc'], opcoes);
    const chave = 'hs:1|pc:101';
    expect(porta.b('hs').vinculos.get(chave)?.origem).toBe('automatico');
    const d = planejarDesfazer({
      chave,
      linhas: [porta.b('hs').vinculos.get(chave)!, porta.b('pc').vinculos.get(chave)!],
      por: 'SINT.GESTOR',
      em: EM,
      justificativa: 'vínculo errado',
      reabrir: true,
    });
    if (d.resultado !== 'plano') throw new Error('plano');
    await executarPlanoRede(porta, d.plano, { evento: 'rede.vinculo.desfeito', operacao: 'x' });
    for (const est of ['hs', 'pc'])
      expect(porta.b(est).candidatos.get(chave)).toMatchObject({ situacao: 'aberto', origem: 'humano' });
    // A recepção atualiza os dois cadastros (o carimbo anda) e o ciclo roda de novo, duas vezes.
    porta.b('hs').cadastros[0] = { ...porta.b('hs').cadastros[0]!, atualizadoEm: '2026-10-25T08:00:00.000' };
    porta.b('pc').cadastros[0] = { ...porta.b('pc').cadastros[0]!, atualizadoEm: '2026-10-25T08:00:00.000' };
    const r = await cicloPareamentoRede(porta, ['hs', 'pc'], opcoes);
    await cicloPareamentoRede(porta, ['hs', 'pc'], { ...opcoes, lote: 0 });
    expect(r.automaticos).toBe(0);
    expect(r.naFila).toBeGreaterThanOrEqual(1);
    for (const est of ['hs', 'pc']) {
      expect(porta.b(est).candidatos.get(chave)).toMatchObject({ situacao: 'aberto', origem: 'humano' });
      expect(porta.b(est).vinculos.get(chave)?.situacao).toBe('desfeito');
    }
  });

  it('alterados além do lote e um cadastro novo mais recente: a marca não pula os alterados não lidos', async () => {
    const porta = massa();
    await cicloPareamentoRede(porta, ['hs', 'pc'], opcoes);
    const pc = porta.b('pc');
    // Os 3 do pc alterados no mesmo carimbo (empate) e um novo, mais recente.
    pc.cadastros = pc.cadastros.map((c) => ({ ...c, atualizadoEm: '2026-10-10T08:00:00.000' }));
    pc.cadastros.push(
      lido(cadastro({ estabelecimento: 'pc', id: 107, idUnificado: 107, prontuario: 1107, cpf: null }), {
        atualizadoEm: '2026-10-15T08:00:00.000',
      }),
    );
    const lidosAlterados: number[] = [];
    const original = porta.cadastrosAlterados.bind(porta);
    porta.cadastrosAlterados = async (est, desde, depoisDoId, n) => {
      const r = await original(est, desde, depoisDoId, n);
      if (est === 'pc') lidosAlterados.push(...r.map((c) => c.id));
      return r;
    };
    const r1 = await cicloPareamentoRede(porta, ['hs', 'pc'], { ...opcoes, lote: 2 });
    // Lote de alterados cheio (101 e 105): a marca para no último lido, não no carimbo do novo (107).
    expect(r1.marcas[1]).toMatchObject({ ultimoId: 107, ultimaAtualizacao: '2026-10-10T08:00:00.000Z' });
    expect(porta.b('pc').marca?.ultimoIdAlterado).toBe(105);
    await cicloPareamentoRede(porta, ['hs', 'pc'], { ...opcoes, lote: 2 });
    // O 106 (mesmo carimbo, ID maior) é lido no ciclo seguinte; nenhum alterado fica de fora nem é relido.
    expect(lidosAlterados).toEqual([101, 105, 106, 107]);
    expect(porta.b('pc').marca).toMatchObject({
      ultimaAtualizacao: '2026-10-15T08:00:00.000Z',
      ultimoIdAlterado: 107,
    });
    const r3 = await cicloPareamentoRede(porta, ['hs', 'pc'], { ...opcoes, lote: 2 });
    expect(r3.lidos).toBe(0);
  });

  it('o cursor dos alterados: novos só empurram com o lote de alterados incompleto; nunca volta', () => {
    const marca = { ultimaAtualizacao: '2026-10-10T08:00:00.000Z', ultimoIdAlterado: 5 };
    const a = (id: number, em: string) => ({ id, atualizadoEm: em });
    expect(
      proximoCursorAlterados(marca, [a(7, '2026-10-11T00:00:00.000')], [a(99, '2026-10-12T00:00:00.000')], 1),
    ).toEqual({
      ultimaAtualizacao: '2026-10-11T00:00:00.000Z',
      ultimoIdAlterado: 7,
    });
    expect(
      proximoCursorAlterados(marca, [a(7, '2026-10-11T00:00:00.000')], [a(99, '2026-10-12T00:00:00.000')], 2),
    ).toEqual({
      ultimaAtualizacao: '2026-10-12T00:00:00.000Z',
      ultimoIdAlterado: 99,
    });
    expect(proximoCursorAlterados(marca, [], [a(1, '2026-01-01T00:00:00.000')], 2)).toEqual({
      ultimaAtualizacao: '2026-10-10T08:00:00.000Z',
      ultimoIdAlterado: 5,
    });
    expect(proximoCursorAlterados({ ultimaAtualizacao: null }, [], [], 2)).toEqual({
      ultimaAtualizacao: null,
      ultimoIdAlterado: 0,
    });
  });

  it('alterados desde o carimbo são relidos; o mais recente vira a marca', async () => {
    const porta = massa();
    await cicloPareamentoRede(porta, ['hs', 'pc'], opcoes);
    const hs = porta.b('hs');
    hs.cadastros[0] = { ...hs.cadastros[0]!, atualizadoEm: '2026-10-20T08:00:00.000' };
    const r = await cicloPareamentoRede(porta, ['hs', 'pc'], opcoes);
    expect(r.marcas[0]).toMatchObject({ ultimoId: 5, ultimaAtualizacao: '2026-10-20T08:00:00.000Z' });
  });
});

describe('plano banco a banco, divergência e reparo (regra 4)', () => {
  const plano = () => {
    const r = planejarVinculo({
      a: { estabelecimento: 'hs', id: 1, prontuario: 11, pessoaAtual: null },
      b: { estabelecimento: 'pc', id: 101, prontuario: 1101, pessoaAtual: null },
      origem: 'humano',
      por: 'SINT.GESTOR',
      em: EM,
      justificativa: null,
      novaPessoa: () => 'pessoa-sintetica-plano',
    });
    if (r.resultado !== 'plano') throw new Error('plano');
    return r.plano;
  };

  it('queda do segundo: pendente → 1 divergência → reparo (o par sai da fila) → 0; repetir não grava', async () => {
    const porta = massa();
    await cicloPareamentoRede(porta, ['hs', 'pc'], { ...opcoes, lote: 0 });
    porta
      .b('hs')
      .candidatos.set('hs:1|pc:101', { ...porta.b('hs').candidatos.get('hs:1|pc:101')!, situacao: 'aberto' });
    porta
      .b('pc')
      .candidatos.set('hs:1|pc:101', { ...porta.b('pc').candidatos.get('hs:1|pc:101')!, situacao: 'aberto' });
    porta.b('hs').vinculos.clear();
    porta.b('pc').vinculos.clear();
    porta.falhar.add('pc');
    const avisos: string[] = [];
    const r = await executarPlanoRede(porta, plano(), { evento: 'rede.vinculo.criado', operacao: 'x' }, (m) =>
      avisos.push(m),
    );
    expect(r.bancos).toEqual([
      { estabelecimento: 'hs', situacao: 'gravado' },
      { estabelecimento: 'pc', situacao: 'pendente' },
    ]);
    expect(avisos).toHaveLength(1);
    porta.falhar.clear();
    const d = await divergenciasRede(porta, ['hs', 'pc']);
    expect(d).toEqual([expect.objectContaining({ chave: 'hs:1|pc:101', tipo: 'ausente_em_um_banco' })]);
    expect(await repararIndiceRede(porta, ['hs', 'pc'], 'rede.indice.reparado')).toEqual({
      reparados: 1,
      pendentes: 0,
      manuais: [],
    });
    expect(porta.b('pc').candidatos.get('hs:1|pc:101')?.situacao).toBe('vinculado');
    expect(await divergenciasRede(porta, ['hs', 'pc'])).toEqual([]);
    expect(await repararIndiceRede(porta, ['hs', 'pc'], 'rede.indice.reparado')).toEqual({
      reparados: 0,
      pendentes: 0,
      manuais: [],
    });
    // Repetir o plano: "já estava" nos dois.
    const de = await executarPlanoRede(porta, plano(), { evento: 'rede.vinculo.criado', operacao: 'x' });
    expect(de.bancos.map((b) => b.situacao)).toEqual(['ja_estava', 'ja_estava']);
  });

  it('todos fora: ErroBancosIndisponiveis; reparo com o banco fora fica pendente; pessoa diferente é manual', async () => {
    const porta = massa();
    porta.falhar.add('hs');
    porta.falhar.add('pc');
    await expect(
      executarPlanoRede(porta, plano(), { evento: 'rede.vinculo.criado', operacao: 'x' }),
    ).rejects.toBeInstanceOf(ErroBancosIndisponiveis);
    porta.falhar.clear();
    porta.falhar.add('pc');
    await executarPlanoRede(porta, plano(), { evento: 'rede.vinculo.criado', operacao: 'x' });
    expect(await repararIndiceRede(porta, ['hs', 'pc'], 'r')).toEqual({
      reparados: 0,
      pendentes: 1,
      manuais: [],
    });
    porta.falhar.clear();
    const v = porta.b('hs').vinculos.get('hs:1|pc:101')!;
    porta.b('pc').pessoas.add('outra-pessoa-cccccccc');
    porta.b('pc').vinculos.set('hs:1|pc:101', {
      ...v,
      estabelecimento: 'pc',
      idLocal: 101,
      estabelecimentoRemoto: 'hs',
      idRemoto: 1,
      pessoa: 'outra-pessoa-cccccccc',
      id: 77,
    });
    expect(await repararIndiceRede(porta, ['hs', 'pc'], 'r')).toEqual({
      reparados: 0,
      pendentes: 0,
      manuais: ['hs:1|pc:101'],
    });
  });

  it('o relatório lê cada banco em lotes de 2.000 até o fim', async () => {
    const chamadas: [string, number][] = [];
    const porta = {
      loteVinculos: async (est: string, depois: number) => {
        chamadas.push([est, depois]);
        const total = est === 'hs' ? 2500 : 0;
        const itens = Array.from(
          { length: Math.max(0, Math.min(2000, total - depois)) },
          () => ({}) as never,
        );
        return { itens, ultimoId: depois + itens.length };
      },
    };
    const m = await vinculosPorBanco(porta, ['hs', 'pc']);
    expect(m.get('hs')).toHaveLength(2500);
    expect(chamadas).toEqual([
      ['hs', 0],
      ['hs', 2000],
      ['pc', 0],
    ]);
  });

  it('CPF diferente nos dois lados não vira automático (massa)', async () => {
    const porta = new PortaIndiceMemoria({
      hs: [lido(cadastro({ estabelecimento: 'hs', id: 1, idUnificado: 1, cpf: CPF_A }))],
      pc: [lido(cadastro({ estabelecimento: 'pc', id: 2, idUnificado: 2, cpf: CPF_B }))],
    });
    const r = await cicloPareamentoRede(porta, ['hs', 'pc'], opcoes);
    expect(r.automaticos).toBe(0);
  });
});
