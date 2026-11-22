// M56 (etapa F0) contra o MariaDB real (cliente f22_o2): regra 1 — sem nenhuma linha de liberação da operadora no
// estabelecimento de teste, o serviço da situação, sobre a fonte de configuração própria do banco, devolve o módulo e
// as fatias desligados; e os catálogos da ANS respondem pela porta própria mesmo assim (são consulta). Nada é gravado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FonteConfiguracaoPropria } from '../../config/public-api.js';
import { ServicoSituacaoOperadora } from '../aplicacao/situacao.js';
import { PortaOperadoraPropria } from '../porta-propria.js';
import {
  CLIENTE,
  COD_OUTRO,
  contexto,
  criarNucleo,
  type MassaBase,
  PODE,
  prepararBase,
  USUARIO,
} from './copia.spec-util.js';

describe.skipIf(!PODE)('M56 regra 1 e catálogos da ANS (MariaDB, f22_o2)', () => {
  let nucleo: NucleoProprio;
  let m: MassaBase;

  beforeAll(async () => {
    nucleo = criarNucleo();
    m = await prepararBase(nucleo);
  });

  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('sem linha de liberação no estabelecimento: módulo e fatias desligados; os catálogos respondem', async () => {
    const fonte = new FonteConfiguracaoPropria(nucleo, CLIENTE);
    const s = await new ServicoSituacaoOperadora(fonte, null).situacao({
      rede: 'rede-teste',
      hospital: COD_OUTRO,
      login: USUARIO,
      setor: null,
    });
    expect(s.modulo.situacao).toBe('desligada');
    expect(s.fatias.length).toBeGreaterThan(0);
    expect(s.fatias.every((f) => f.situacao === 'desligada')).toBe(true);
    const porta = new PortaOperadoraPropria(nucleo, CLIENTE);
    const c = contexto(m, true);
    expect(Array.isArray(await porta.gruposSip(c))).toBe(true);
    const p = await porta.procedimentosSip(c, {});
    expect(p.itens.length).toBeLessThanOrEqual(200);
    expect(Array.isArray((await porta.classificacoesAns(c, {})).itens)).toBe(true);
  });
});
