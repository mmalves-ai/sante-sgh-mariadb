// Regra 6 do M37: a lista proposta da condução, o impacto por grupo e a decisão do gestor.
import { describe, expect, it } from 'vitest';
import { chavePar, conferirRetirada, proporConducao } from './conducao.js';

const concessoes = [
  { grupo: 'RECEPCAO', opcao: 10, titulo: 'Agendar' },
  { grupo: 'RECEPCAO', opcao: 10, titulo: 'Agendar' },
  { grupo: 'RECEPCAO', opcao: 99, titulo: 'Outra coisa' },
  { grupo: 'MISTO', opcao: 10, titulo: 'Agendar' },
  { grupo: 'MEDICOS', opcao: 10, titulo: 'Agendar' },
];
const usuarios = { RECEPCAO: { noSetor: 12, fora: 0 }, MISTO: { noSetor: 3, fora: 2 } };

describe('condução opcional (regra 6)', () => {
  it('propõe os pares dos grupos do setor nas opções das operações liberadas; o grupo com gente fora exige decisão', () => {
    const p = proporConducao(['RECEPCAO', 'MISTO'], new Set([10]), concessoes, usuarios, [
      { id: '7', grupo: 'MISTO', opcao: 11, situacao: 'retirada' },
      { id: '8', grupo: 'RECEPCAO', opcao: 12, situacao: 'devolvida' },
    ]);
    expect(p.map((x) => [x.grupo, x.opcao, x.situacao, x.exigeDecisao])).toEqual([
      ['MISTO', 10, 'proposta', true],
      ['MISTO', 11, 'retirada', true],
      ['RECEPCAO', 10, 'proposta', false],
    ]);
    expect(p.find((x) => x.situacao === 'retirada')?.idConducao).toBe('7');
    expect(
      proporConducao(['SEM'], new Set([10]), [{ grupo: 'SEM', opcao: 10, titulo: null }], {}, [])[0],
    ).toMatchObject({
      usuariosNoSetor: 0,
      usuariosFora: 0,
    });
  });

  it('confere o pedido: fora da proposta recusa; com gente fora, só com a decisão; agrupa por grupo', () => {
    const p = proporConducao(
      ['RECEPCAO', 'MISTO'],
      new Set([10, 20]),
      [...concessoes, { grupo: 'RECEPCAO', opcao: 20, titulo: null }],
      usuarios,
      [],
    );
    expect(conferirRetirada([{ grupo: 'RECEPCAO', opcao: 99 }], p, [])).toMatchObject({ ok: false });
    const semDecisao = conferirRetirada([{ grupo: 'MISTO', opcao: 10 }], p, []);
    expect(semDecisao.ok).toBe(false);
    if (!semDecisao.ok) expect(semDecisao.motivo).toContain('decisão do gestor');
    const ok = conferirRetirada(
      [
        { grupo: 'RECEPCAO', opcao: 10 },
        { grupo: 'RECEPCAO', opcao: 20 },
        { grupo: 'MISTO', opcao: 10 },
      ],
      p,
      [chavePar('misto', 10).toLowerCase()],
    );
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect([...ok.porGrupo.entries()]).toEqual([
        ['RECEPCAO', [10, 20]],
        ['MISTO', [10]],
      ]);
  });
});
