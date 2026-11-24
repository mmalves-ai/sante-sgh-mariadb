// Contrato de efeito da nota fiscal que documenta a fatura ou a conta (F3.7, 06-FAT linha 36) contra o MariaDB real.
// Massa SINTÉTICA com códigos "F379" (nenhuma pessoa real): a visão da fatura (valor, documentado, candidatas com o
// sugerido), a ligação (linha em vinculo_nota_faturamento com autoria), o ajuste na mesma linha, a recusa acima do saldo
// e da conta aberta, o desligamento marcado (não apagado) e o religamento que restaura a mesma linha. No fim, a massa é
// apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoNotaVinculo } from './nota-vinculo.controller.js';
import { documentacaoFiscalPropria } from './nota-vinculo-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F379';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema['codigo'] ?? e.problema['tipo'] ?? '');
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('nota fiscal que documenta a fatura ou a conta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoNotaVinculo;
  const ids = {
    est: 0,
    fonte: 0,
    municipio: 0,
    fatura: 0,
    nota1: 0,
    nota2: 0,
    conta: 0,
    pessoa: 0,
    paciente: 0,
  };
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-f379',
    chaveIdempotencia: `f379-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-f379',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f379' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    await e.executar(
      'DELETE v FROM vinculo_nota_faturamento v JOIN nota_servico ns ON ns.id = v.nota_servico_id WHERE ns.estabelecimento_id = ?',
      [ids.est],
    );
    await e.executar('DELETE FROM nota_servico WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM fatura_fonte_pagadora WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [ids.est]);
  };
  const nota = (e: Escritor, rps: number, valor: number, situacao: string) =>
    e.inserir(
      `INSERT INTO nota_servico (estabelecimento_id, numero_rps, serie_rps, numero_nota, data_emissao, competencia,
         municipio_prestacao_id, tipo_tomador, fonte_pagadora_id, tomador_nome, tomador_documento, discriminacao,
         valor_servicos, base_calculo, valor_liquido, situacao, criado_em)
       VALUES (?, ?, 'T', ?, '2026-02-05 10:00:00', '2026-01-01', ?, 'pessoa_juridica', ?, ?, '00000000000191',
         'SERVICOS HOSPITALARES SINTETICOS', ?, ?, ?, ?, NOW(3))`,
      [
        ids.est,
        rps,
        `${P}${rps}`,
        ids.municipio,
        ids.fonte,
        `TOMADOR SINTETICO ${P}`,
        valor,
        valor,
        valor,
        situacao,
      ],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      const m = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM municipio_ibge', []);
      ids.municipio = Number(m?.id ?? 0);
      ids.pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [ids.pessoa, 837_901, agora],
      );
      await limpar(e);
      ids.fatura = await e.inserir(
        `INSERT INTO fatura_fonte_pagadora (estabelecimento_id, numero, fonte_pagadora_id, competencia, data_abertura,
           fechado_em, valor_apresentado, valor_acrescimo, valor_desconto, situacao, criado_em)
         VALUES (?, ?, ?, '2026-01-01', '2026-02-01', '2026-02-03 09:00:00', 1000, 50, 50, 'fechada', ?)`,
        [ids.est, `${P}-F1`, ids.fonte, agora],
      );
      ids.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, paciente_id, fonte_pagadora_id, natureza,
           competencia, inicio_em, valor_total, criado_em)
         VALUES (?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 300, ?)`,
        [ids.est, `${P}-C1`, ids.paciente, ids.fonte, agora],
      );
      ids.nota1 = await nota(e, 1, 600, 'autorizada');
      ids.nota2 = await nota(e, 2, 700, 'autorizada');
      await nota(e, 3, 900, 'cancelada');
    });
    s = new ServicoNotaVinculo(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('visão da fatura, ligação, ajuste, recusa acima do saldo, desligamento marcado e religamento', async () => {
    const v0 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(v0.alvo).toMatchObject({
      valorDocumentavel: 1000,
      valorDocumentado: 0,
      saldo: 1000,
      documentacao: 'sem_nota',
    });
    // A cancelada não aparece; as duas autorizadas aparecem com o sugerido limitado pelo saldo de cada lado.
    expect(v0.candidatas.map((c) => c.id).sort()).toEqual([ids.nota1, ids.nota2].sort());
    expect(v0.candidatas.find((c) => c.id === ids.nota1)?.sugerido).toBe(600);

    const r1 = await s.gravar('vincular', op(), {
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId: ids.nota1,
      valorApropriado: 600,
    });
    expect(r1['acao']).toBe('ligado');
    const [linha] = await linhas(
      'SELECT nota_servico_id, fatura_fonte_pagadora_id, conta_hospitalar_id, valor_apropriado, excluido_em, versao FROM vinculo_nota_faturamento WHERE id = ?',
      [r1['id']],
    );
    expect(linha).toMatchObject({
      nota_servico_id: ids.nota1,
      fatura_fonte_pagadora_id: ids.fatura,
      conta_hospitalar_id: null,
      excluido_em: null,
    });
    expect(Number(linha?.['valor_apropriado'])).toBe(600);

    // Acima do que falta na fatura (400): recusa com o campo.
    expect(
      await codigoDo(
        s.gravar('vincular', op(), {
          tipo: 'fatura',
          alvoId: ids.fatura,
          notaServicoId: ids.nota2,
          valorApropriado: 401,
        }),
      ),
    ).toBe('entrada-invalida');
    const r2 = await s.gravar('vincular', op(), {
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId: ids.nota2,
      valorApropriado: 400,
    });
    const v1 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(v1.alvo).toMatchObject({ valorDocumentado: 1000, documentacao: 'documentada', saldo: 0 });
    expect(v1.ligadas).toHaveLength(2);

    // Ligar de novo a mesma nota ajusta o valor na mesma linha.
    const r3 = await s.gravar('vincular', op(), {
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId: ids.nota2,
      valorApropriado: 300,
    });
    expect(r3).toMatchObject({ id: r2['id'], acao: 'ajustado' });

    // Desligar marca e não apaga; religar restaura a mesma linha.
    const lig = (
      await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura))
    ).ligadas.find((x) => x.notaServicoId === ids.nota1);
    await s.gravar('desvincular', op(), { id: lig?.id, versao: lig?.versao });
    const [marcada] = await linhas('SELECT excluido_em FROM vinculo_nota_faturamento WHERE id = ?', [
      r1['id'],
    ]);
    expect(marcada?.['excluido_em']).not.toBeNull();
    const v2 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(v2.alvo).toMatchObject({ valorDocumentado: 300, documentacao: 'parcial' });
    const r4 = await s.gravar('vincular', op(), {
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId: ids.nota1,
      valorApropriado: 500,
    });
    expect(r4).toMatchObject({ id: r1['id'], acao: 'religado' });
    const [cont] = await linhas(
      'SELECT COUNT(*) AS n FROM vinculo_nota_faturamento WHERE nota_servico_id IN (?, ?)',
      [ids.nota1, ids.nota2],
    );
    expect(Number(cont?.['n'])).toBe(2);
  });

  it('conta ainda aberta não recebe nota', async () => {
    expect(
      await codigoDo(
        s.gravar('vincular', op(), {
          tipo: 'conta',
          alvoId: ids.conta,
          notaServicoId: ids.nota2,
          valorApropriado: 10,
        }),
      ),
    ).toBe('entrada-invalida');
    const v = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'conta', ids.conta));
    expect(v.alvo).toMatchObject({ tipo: 'conta', valorDocumentavel: 300, documentacao: 'sem_nota' });
  });
});
