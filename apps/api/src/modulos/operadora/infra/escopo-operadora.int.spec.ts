// M56 regra 3 contra o MariaDB real (cliente f22_o2): a operadora é empresa distinta e o escopo dos dados é ela e o
// estabelecimento. A carteira SINTÉTICA de um estabelecimento não aparece no outro (leitura vazia, gravação recusada);
// a lista de contratos e de beneficiários filtra pela operadora; cada gravação deixa a trilha com o recurso da
// operadora, no estabelecimento e pelo usuário da sessão. Massa apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  criarNucleo,
  limparMassa,
  type MassaBase,
  montarCarteira,
  PODE,
  prepararBase,
  servicoNoBanco,
  sessao,
} from './copia.spec-util.js';

describe.skipIf(!PODE)('M56 regra 3: escopo da operadora e do estabelecimento (MariaDB, f22_o2)', () => {
  let nucleo: NucleoProprio;
  let m: MassaBase;

  beforeAll(async () => {
    nucleo = criarNucleo();
    m = await prepararBase(nucleo);
    await limparMassa(nucleo, m);
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (m) await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('a carteira de um estabelecimento não aparece no outro; as listas filtram pela operadora; a trilha leva o recurso', async () => {
    const { servico, porta } = servicoNoBanco(nucleo);
    const s = sessao(m);
    const outro = sessao(m, 'todas', true);
    const k = await montarCarteira(servico, s, { registro: '902104', base: '90211' });
    expect((await porta.contratos(s.porta, { operadora: k.operadora })).itens.map((x) => x.id)).toEqual([
      k.contrato,
    ]);
    expect((await porta.contratos(s.porta, { operadora: k.operadora + 1_000_000 })).itens).toEqual([]);
    expect(
      (await porta.beneficiarios(s.porta, { operadora: k.operadora })).itens.map((x) => x.id).sort(),
    ).toEqual([k.titular.id, k.dependente].sort());
    // O outro estabelecimento não lê nem grava nada desta carteira.
    expect(await porta.operadora(outro.porta, k.operadora)).toBeNull();
    expect(await porta.contrato(outro.porta, k.contrato)).toBeNull();
    expect(await porta.beneficiario(outro.porta, k.titular.id)).toBeNull();
    expect((await porta.beneficiarios(outro.porta, { operadora: k.operadora })).itens).toEqual([]);
    expect(await codigoDe(servico.contrato(outro, k.contrato))).not.toBe('gravou');
    // A trilha de cada gravação: no estabelecimento, pelo usuário e com o recurso da operadora nos dados.
    const t = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10' }, (l) =>
      l.consultar<{ estabelecimento_id: unknown; usuario_id: unknown; recurso: unknown }>(
        `SELECT estabelecimento_id, usuario_id, JSON_VALUE(dados_depois, '$.dados.recurso') AS recurso FROM trilha_auditoria
          WHERE entidade = 'beneficiario_plano' AND entidade_id IN (?, ?)`,
        [k.titular.id, k.dependente],
      ),
    );
    expect(t).toHaveLength(2);
    for (const x of t) {
      expect(Number(x.estabelecimento_id)).toBe(m.est);
      expect(Number(x.usuario_id)).toBe(m.usuario);
      expect(String(x.recurso)).toMatch(/^operadora/);
    }
  });
});
