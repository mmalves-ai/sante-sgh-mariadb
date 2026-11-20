// Desfazer (M57, regra 1; cap-07 §7.7.3): apaga só a ligação do índice; nenhum cadastro de paciente é tocado; as duas
// linhas ficam `desfeito` com quem, quando e por quê; o candidato volta à fila ou fica "outra pessoa".
import { describe, expect, it } from 'vitest';
import { planejarDesfazer } from './desfazer.js';
import { espelho, garantirSomenteIndice, tabelasDoPlano } from './indice.js';
import { linha } from './indice.spec-util.js';

const base = {
  chave: 'hs:909|pc:101',
  por: 'GESTOR.TESTE',
  em: '2026-10-24T12:00:00.000Z',
  justificativa: 'vínculo errado',
};

describe('desfazer', () => {
  it('marca desfeito nos dois bancos e só toca o índice', () => {
    const r = planejarDesfazer({ ...base, linhas: [linha(), espelho(linha())], reabrir: false });
    expect(r.resultado).toBe('plano');
    if (r.resultado !== 'plano') return;
    garantirSomenteIndice(r.plano);
    expect(tabelasDoPlano(r.plano)).toEqual(['SGH_REDE_CANDIDATO', 'SGH_REDE_VINCULO']);
    expect(JSON.stringify(r.plano)).not.toMatch(/RICADPAC|DELETE/);
    for (const b of r.plano.bancos) {
      const v = b.escritas.find((e) => e.tabela === 'SGH_REDE_VINCULO');
      expect(v && v.tabela === 'SGH_REDE_VINCULO' && v.linha.situacao).toBe('desfeito');
      expect(v && v.tabela === 'SGH_REDE_VINCULO' && v.linha.estabelecimento).toBe(b.estabelecimento);
      const c = b.escritas.find((e) => e.tabela === 'SGH_REDE_CANDIDATO');
      expect(c && c.tabela === 'SGH_REDE_CANDIDATO' && c.situacao).toBe('outra_pessoa');
    }
  });

  it('com a linha de um banco só (queda anterior), reconstrói a do outro pelo espelho', () => {
    const r = planejarDesfazer({ ...base, linhas: [linha()], reabrir: true });
    expect(r.resultado === 'plano' && r.plano.bancos.map((b) => b.estabelecimento)).toEqual(['hs', 'pc']);
    if (r.resultado !== 'plano') return;
    const c = r.plano.bancos[0]!.escritas.find((e) => e.tabela === 'SGH_REDE_CANDIDATO');
    expect(c && c.tabela === 'SGH_REDE_CANDIDATO' && c.situacao).toBe('aberto');
    // Reaberto por uma pessoa: a marca que impede o automático de religar o par.
    expect(c && c.tabela === 'SGH_REDE_CANDIDATO' && c.origem).toBe('humano');
  });

  it('já desfeito ou inexistente: nada a gravar', () => {
    expect(
      planejarDesfazer({ ...base, linhas: [linha({ situacao: 'desfeito' })], reabrir: false }).resultado,
    ).toBe('ja_desfeito');
    expect(
      planejarDesfazer({ ...base, linhas: [linha({ chave: 'hs:1|pc:2' })], reabrir: false }).resultado,
    ).toBe('inexistente');
  });
});
