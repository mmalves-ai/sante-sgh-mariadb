// Os textos da manutenção não citam sistema antigo nem tabela (ADR 0023), não mandam o usuário "fazer em outro
// sistema", pedem para não escrever dado de paciente na descrição da OS e imprimem as contas dos indicadores (regra 3).
import { describe, expect, it } from 'vitest';
import { mensagensManutencao } from './i18n.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos da manutenção e engenharia clínica', () => {
  it('nenhum texto cita o sistema antigo nem nome de tabela', () => {
    const achados = textos(mensagensManutencao).filter(([, t]) =>
      /spdata|legado|sistema atual|sistema antigo|outro sistema|\bTB[A-Z]{3,}|\bGM[A-Z]{3,}|\bGP[A-Z]{3,}|SGH_/i.test(
        t,
      ),
    );
    expect(achados).toEqual([]);
  });

  it('a descrição da OS avisa para não escrever dado de paciente', () => {
    expect(mensagensManutencao.os.campos.descricaoAjuda).toMatch(/Não escreva dados de pacientes/);
  });

  it('os indicadores imprimem a conta com as parcelas', () => {
    expect(mensagensManutencao.indicadores.contas.disponibilidade).toContain('{operacao}');
    expect(mensagensManutencao.indicadores.contas.mtbf).toContain('{falhas}');
    expect(mensagensManutencao.indicadores.contas.mttr).toContain('{reparos}');
  });

  it('toda recusa tem texto', () => {
    for (const grupo of Object.values(mensagensManutencao.recusas))
      for (const t of Object.values(grupo)) expect(t.length).toBeGreaterThan(10);
  });
});
