import { describe, expect, it } from 'vitest';
import { exigeVinculo, VinculoSintetico } from './vinculo.js';

describe('vínculo assistencial (regra 7)', () => {
  it('dado do legado segue o parâmetro do legado; recurso novo exige sempre', () => {
    expect(exigeVinculo(false, false)).toBe(false); // PRPARAM desligado: igual ao SPDATA
    expect(exigeVinculo(false, true)).toBe(true);
    expect(exigeVinculo(true, false)).toBe(true);
  });

  it('porta servida por massa sintética até o M15/M21', async () => {
    const v = new VinculoSintetico([{ login: 'SINT.MEDICO', idPaciente: 1, forma: 'internado-no-setor' }]);
    await expect(v.vinculo('SINT.MEDICO', { idPaciente: 1 })).resolves.toBe('internado-no-setor');
    await expect(v.vinculo('SINT.MEDICO', { idPaciente: 2, atendimento: 9 })).resolves.toBeNull();
    await expect(new VinculoSintetico().vinculo('X', { idPaciente: 1 })).resolves.toBeNull();
  });
});
